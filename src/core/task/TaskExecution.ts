import { AgentsCatalog } from "../catalog/AgentsCatalog";
import { AgentNotFoundError } from "../../model/error/AgentNotFoundError";
import { AgentCall } from "../../api/AgentCall";
import { ExecutionContext, TotoRuntimeError, ValidationError } from "toto-api-controller";
import { GaleConfig } from "../../Config";
import { TaskStatusRecord, TaskTracker } from "../tracking/TaskTracker";
import { AgentTaskRequest, AgentTaskResponse, SubTaskInfo, ParentTaskInfo } from "../../model/AgentTask";
import { v4 as uuidv4 } from "uuid";

/**
 * This class is responsible for executing tasks, by finding suitable Agents and delegating the execution to them.
 * 
 * The main steps involved in task execution are:
 * 1. Finding an available Agent that can execute the task.
 * 2. Sending the task to the Agent for execution.
 * 3. Handling subtasks if the Agent indicates that more tasks need to be spawned.
 * 
 * Subtasks are spawned by publishing them to the Message Bus, allowing for asynchronous execution by other Agents.
 */
export class TaskExecution {

    bearerToken: string;
    execContext: ExecutionContext;
    config: GaleConfig;
    cid: string;

    constructor(execContext: ExecutionContext, bearerToken: string) {
        this.execContext = execContext;
        this.bearerToken = bearerToken;
        this.config = execContext.config as GaleConfig;
        this.cid = execContext.cid ?? "";
    }

    /**
     * Starts the execution of a task. 
     * 
     * 1. Find an available Agent that can execute the task.
     * 2. Send the task to the Agent for execution.
     * 
     * @param taskId the unique identifier of the task to start. 
     */
    async startTask(task: AgentTaskRequest): Promise<AgentTaskResponse> {

        const config = this.execContext.config as GaleConfig;
        const cid = this.cid;
        const logger = this.execContext.logger;

        try {

            const client = await config.getMongoClient();
            const db = client.db(config.getDBName());

            const taskTracker = new TaskTracker(db, this.execContext);

            // 1. Find an available Agent that can execute the task.
            const agent = await new AgentsCatalog(db, this.execContext).findAgentByTaskId(task.taskId);

            if (!agent) throw new AgentNotFoundError(task.taskId);

            // The correlation Id and task instance id that will be used for tracking
            let correlationId = task.correlationId; 
            let taskInstanceId = task.taskInstanceId;

            // 2. Send the task to the Agent for execution.
            logger.compute(cid, `Received task for Agent [${agent.name}] to execute task [${task.taskId}] with command [${JSON.stringify(task.command)}]. Correlation Id: ${correlationId}`, "info");

            // If this is a root task (no parent), track its start, as it has not been tracked yet. Subtasks are tracked when spawned.
            if (!task.parentTask && !task.taskInstanceId) {

                // 1. Make sure there's no correlation Id yet, otherwise something is inconsistent: 
                if (correlationId) throw new TotoRuntimeError(500, `Inconsistent state: root task [${task.taskId}] that has NO TASK INSTANCE ID should have a correlation ID already assigned. Received correlation ID: ${correlationId}`);

                const rootTaskStatus: TaskStatusRecord = await taskTracker.trackRootTaskStarted(task, agent);

                correlationId = rootTaskStatus.correlationId;
                taskInstanceId = rootTaskStatus.taskInstanceId;

                logger.compute(cid, `Root task [${rootTaskStatus.taskId} - ${taskInstanceId}] started and tracked successfully. Correlation Id: ${correlationId}`, "info");
            }
            else if (task.parentTask && !task.taskInstanceId) throw new TotoRuntimeError(500, `Inconsistent state: subtask [${task.taskId}] was triggered with no task instance Id. Subtasks must always have a task instance Id assigned when triggered by Gale Broker.`);   
            else if (!task.parentTask && task.command.command === 'resume') {

                // Make sure that there is a task Instance ID
                if (!task.taskInstanceId) throw new TotoRuntimeError(500, `Inconsistent state: root task [${task.taskId}] triggered with a 'resume' command must have a task instance Id assigned by Gale Broker when the request was created.`);

                logger.compute(cid, `Resuming root task [${task.taskId} - ${task.taskInstanceId}] as per command request. Correlation Id: ${correlationId}`, "info");

                // Track the resumption of the root task as a new record
                await taskTracker.trackRootTaskStarted(task, agent);

            }

            // 2.2. Call the agent
            const agentTaskResponse: AgentTaskResponse = await new AgentCall(agent, this.execContext, this.bearerToken).execute(task, correlationId!);

            logger.compute(cid, `Agent [${agent.name}] executed successfully task [${task.taskId} - ${task.taskInstanceId}]. Stop reason: ${agentTaskResponse.stopReason}. Correlation Id: ${correlationId}`, "info");

            // 3. Track the task completion
            await taskTracker.trackTaskCompletion(taskInstanceId!, agentTaskResponse.stopReason!, agentTaskResponse.taskOutput);

            // 4. Check the Stop Reason
            // 4.1. If 'subtasks', then spawn the subtasks. 
            if (agentTaskResponse.stopReason === 'subtasks') {

                if (!agentTaskResponse.subtasks || agentTaskResponse.subtasks.length === 0) return agentTaskResponse;

                logger.compute(cid, `Spawning [${agentTaskResponse.subtasks.length}] subtasks for parent task [${task.taskId}].`, "info");

                await this.spawnSubtasks(agentTaskResponse.subtasks, {
                    correlationId: correlationId!,
                    taskId: task.taskId,
                    taskInstanceId: taskInstanceId!
                }, taskTracker);
            }

            // 5. If this is a subtask running and it completed, check if all sibling subtasks are completed, and if so, notify the parent task.
            if (task.parentTask && agentTaskResponse.stopReason === 'completed') {

                logger.compute(cid, `Subtask [${task.taskId} - ${taskInstanceId}] completed. Checking if all siblings spawned by parent task [${task.parentTask.taskId} - ${task.parentTask.taskInstanceId}] with group [${task.subtaskGroupId}] are done.`, "info");

                // 5.1. Check if all sibling subtasks are completed
                const allSiblingsCompleted = await taskTracker.areSiblingsCompleted(task.parentTask.taskInstanceId, task.subtaskGroupId!);

                logger.compute(cid, `Siblings completion status for parent task [${task.parentTask.taskId} - ${task.parentTask.taskInstanceId}] with group [${task.subtaskGroupId}] : ${allSiblingsCompleted}`, "info");

                // 5.2. If so, update the parent task status 
                if (allSiblingsCompleted) {

                    logger.compute(cid, `All sibling subtasks for parent task [${task.parentTask.taskId} - ${task.parentTask.taskInstanceId}] with group [${task.subtaskGroupId}] are completed. Updating parent task status.`, "info");

                    const mustNotifyParent = await taskTracker.flagParentAsChildrenCompleted(task.parentTask.taskInstanceId, task.subtaskGroupId!);

                    // 5.3. If the parent task is now completed, notify the parent task's agent
                    if (mustNotifyParent) {

                        // Get the subtasksGroupId of the batch of subtasks that were executed
                        const completedSubtask = await taskTracker.findTaskByInstanceId(taskInstanceId!) ;

                        if (!completedSubtask) throw new TotoRuntimeError(500, `Inconsistent state: completed subtask [${task.taskId} - ${taskInstanceId}] not found in tracking database.`);

                        const subtaskGroupId = completedSubtask.subtaskGroupId!;

                        logger.compute(cid, `Notifying parent task [${task.parentTask.taskId} - ${task.parentTask.taskInstanceId}] that all subtasks of group [${subtaskGroupId}] are completed.`, "info");

                        // Get the output data of all the completed child tasks to be able to send the output data to the parent task if needed
                        const completedChildren = await taskTracker.findChildrenWithSubtaskGroupId(completedSubtask.parentTaskInstanceId!, subtaskGroupId);

                        const childrenOutputs: any[] = completedChildren.map(child => child.taskOutput);

                        // Find the parent
                        const parentTask = await taskTracker.findTaskByInstanceId(completedSubtask.parentTaskInstanceId!);

                        // Publish a message to notify the parent task's agent that all subtasks are completed. The parent task will be a NEW INSTANCE of the task (stateless, so with new task instance Id)
                        const agentTaskRequest = new AgentTaskRequest({
                            command: {
                                command: "resume",
                                completedSubtaskGroupId: subtaskGroupId
                            },
                            correlationId: completedSubtask.correlationId,
                            taskId: completedSubtask.parentTaskId!,
                            taskInstanceId: uuidv4(),   // Important: new instance of the parent task since stateless and should be tracked separately. 
                            taskInputData: { 
                                originalInput: parentTask?.taskInput.originalInput || parentTask?.taskInput,
                                childrenOutputs 
                            },
                        });

                        const bus = this.config.messageBus;

                        await bus.publishTask(agentTaskRequest, this.cid);

                        logger.compute(cid, `Parent task [${task.parentTask.taskId} - ${task.parentTask.taskInstanceId}] notified successfully with a resume command: ${JSON.stringify(agentTaskRequest.command)}.`, "info");

                    }
                    else logger.compute(cid, `Parent task [${task.parentTask.taskId} - ${task.parentTask.taskInstanceId}] has been already marked as 'childrenCompleted'. No notification sent.`, "info");
                }
            }

            return agentTaskResponse;

        } catch (error) {

            logger.compute(cid, `${error}`, "error")

            if (error instanceof ValidationError || error instanceof TotoRuntimeError) {
                throw error;
            }
            else {
                console.log(error);
                throw error;
            }

        }

    }

    /**
     * Spawns the given subtasks so that they can be asynchronously executed by the agents. 
     * 
     * This concretely uses the Message Bus to publish the subtask requests.
     * 
     * @param subtasks subtasks to be spawn off
     */
    private async spawnSubtasks(subtasks: SubTaskInfo[], parentTask: ParentTaskInfo, taskTracker: TaskTracker): Promise<void> {

        const bus = this.config.messageBus;

        let publishPromises: Promise<void>[] = [];

        for (const subtask of subtasks) {

            this.execContext.logger.compute(this.cid, `Spawning subtask [${subtask.taskId}].`, "info");

            // 2. Track the subtask as 'started' in the tracking database
            const taskStatus: TaskStatusRecord = await taskTracker.trackSubtaskStarted(subtask, parentTask);

            // 1. Build the task request
            const agentTaskRequest = new AgentTaskRequest({
                command: { command: "start" },
                correlationId: parentTask.correlationId,
                taskId: subtask.taskId,
                taskInstanceId: taskStatus.taskInstanceId,
                taskInputData: subtask.taskInputData,
                parentTask: parentTask, 
                subtaskGroupId: subtask.subtasksGroupId
            });

            // Publish the subtask to the message bus
            publishPromises.push(new Promise<void>(async (resolve, reject) => {

                try {

                    // 1. Publish the task to the bus
                    await bus.publishTask(agentTaskRequest, this.cid);

                    this.execContext.logger.compute(this.cid, `Subtask [${subtask.taskId}] successfully spawned.`, "info");

                    resolve();

                } catch (error) {
                    this.execContext.logger.compute(this.cid, `Failed to spawn subtask [${subtask.taskId}]: ${error}`, "error");
                    reject(error);
                }

            }));

        }

        // Wait for all to be published
        await Promise.all(publishPromises);

    }
}
