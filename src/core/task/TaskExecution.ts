import { AgentsCatalog } from "../catalog/AgentsCatalog";
import { AgentNotFoundError } from "../../model/error/AgentNotFoundError";
import { AgentCall } from "../../api/AgentCall";
import { ExecutionContext, TotoRuntimeError, ValidationError } from "toto-api-controller";
import { GaleConfig } from "../../Config";
import { Status, TaskTracker } from "../tracking/TaskTracker";
import { v4 as uuidv4 } from "uuid";
import { AgentTaskRequest, AgentTaskResponse, SubTaskInfo } from "../../model/AgentTask";

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

            // CORRELATION ID: if the task request has a correlation ID, use it; otherwise, generate a new one.
            const correlationId = task.correlationId || uuidv4();

            // 1. Find an available Agent that can execute the task.
            const agent = await new AgentsCatalog(db, this.execContext).findAgentByTaskId(task.taskId);

            if (!agent) throw new AgentNotFoundError(task.taskId);

            // 2. Send the task to the Agent for execution.
            logger.compute(cid, `Triggering Agent [${agent.name}] to execute task [${task.taskId}]. Correlation Id: ${correlationId}`, "info");

            // 2.1. Add any needed missing field to the task request 
            task.correlationId = correlationId;
            task.taskInstanceId = task.taskInstanceId || uuidv4();

            // 2.2. Call the agent
            const startTime = Date.now();
            const agentTaskResponse: AgentTaskResponse = await new AgentCall(agent, this.execContext, this.bearerToken).execute(task);
            const endTime = Date.now();

            logger.compute(cid, `Agent [${agent.name}] executed successfully task [${task.taskId}]. Stop reason: ${agentTaskResponse.stopReason}. Correlation Id: ${correlationId}`, "info");

            // Based on the answer, determine the task's status
            let status: Status;
            switch (agentTaskResponse.stopReason) {
                case 'completed':
                    status = 'completed';
                    break;
                case 'failed':
                    status = 'failed';
                    break;
                case 'subtasks':
                    status = 'waiting';
                    break;
                default:
                    status = 'started';
                    break;
            }

            // 3. Persist the task execution status.
            await taskTracker.trackTaskStatus({
                correlationId: correlationId,
                taskId: task.taskId,
                agentName: agent.name,
                taskInstanceId: task.taskInstanceId,
                startedAt: new Date(startTime),
                status: status,
                stopReason: agentTaskResponse.stopReason,
                executionTimeMs: endTime - startTime,
                parentTaskId: task.parentTask?.taskId,
                parentTaskInstanceId: task.parentTask?.taskInstanceId
            });

            // 4. Check the Stop Reason
            // 4.1. If 'subtasks', then spawn the subtasks. 
            if (agentTaskResponse.stopReason === 'subtasks') {

                if (!agentTaskResponse.subtasks || agentTaskResponse.subtasks.length === 0) return agentTaskResponse;

                logger.compute(cid, `Spawning [${agentTaskResponse.subtasks.length}] subtasks for parent task [${task.taskId}].`, "info");

                await this.spawnSubtasks(agentTaskResponse.subtasks, agentTaskResponse.subtasksGroupId!, {
                    correlationId: correlationId,
                    taskId: task.taskId,
                    taskInstanceId: task.taskInstanceId
                }, taskTracker);
            }

            // 5. If this is a subtask running and it completed, check if all sibling subtasks are completed, and if so, notify the parent task.
            if (task.parentTask && agentTaskResponse.stopReason === 'completed') {

                logger.compute(cid, `Subtask [${task.taskId} - ${task.taskInstanceId}] completed. Checking if all siblings spawned by parent task [${task.parentTask.taskId} - ${task.parentTask.taskInstanceId}] are done.`, "info");

                // 5.1. Check if all sibling subtasks are completed
                const allSiblingsCompleted = await taskTracker.areSiblingsCompleted(task.parentTask.taskInstanceId);

                logger.compute(cid, `Siblings completion status for parent task [${task.parentTask.taskId} - ${task.parentTask.taskInstanceId}]: ${allSiblingsCompleted}`, "info");

                // 5.2. If so, update the parent task status 
                if (allSiblingsCompleted) {

                    logger.compute(cid, `All sibling subtasks for parent task [${task.parentTask.taskId} - ${task.parentTask.taskInstanceId}] are completed. Updating parent task status.`, "info");

                    const mustNotifyParent = await taskTracker.flagParentAsChildrenCompleted(task.parentTask.taskInstanceId);

                    // 5.3. If the parent task is now completed, notify the parent task's agent
                    if (mustNotifyParent) {

                        logger.compute(cid, `Notifying parent task [${task.parentTask.taskId} - ${task.parentTask.taskInstanceId}] that all subtasks are completed.`, "info");

                        // Get the subtasksGroupId of the batch of subtasks that were executed
                        const completedSubtask = await taskTracker.findTaskByInstanceId(task.taskInstanceId);

                        if (!completedSubtask) throw new TotoRuntimeError(500, `Inconsistent state: completed subtask [${task.taskId} - ${task.taskInstanceId}] not found in tracking database.`);

                        const subtaskGroupId = completedSubtask.subtaskGroupId!;

                        // Publish a message to notify the parent task's agent that all subtasks are completed 
                        const agentTaskRequest = new AgentTaskRequest({
                            command: {
                                command: "resume",
                                completedSubtaskGroupId: subtaskGroupId
                            },
                            correlationId: completedSubtask.correlationId,
                            taskId: completedSubtask.parentTaskId!,
                            taskInstanceId: completedSubtask.parentTaskInstanceId!,
                            taskInputData: {},
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
    private async spawnSubtasks(subtasks: SubTaskInfo[], subtaskGroupId: string, parentTask: ParentTaskInfo, taskTracker: TaskTracker): Promise<void> {

        const bus = this.config.messageBus;

        let publishPromises: Promise<void>[] = [];

        for (const subtask of subtasks) {

            this.execContext.logger.compute(this.cid, `Spawning subtask [${subtask.taskId}].`, "info");

            // 1. Build the task request
            const agentTaskRequest = new AgentTaskRequest({
                command: { command: "start" },
                correlationId: parentTask.correlationId,
                taskId: subtask.taskId,
                taskInstanceId: uuidv4(),
                taskInputData: subtask.taskInputData,
                parentTask: parentTask
            });

            // Publish the subtask to the message bus
            publishPromises.push(new Promise<void>(async (resolve, reject) => {

                try {

                    // 1. Publish the task to the bus
                    await bus.publishTask(agentTaskRequest, this.cid)

                    // 2. Save a record
                    await taskTracker.trackTaskStatus({
                        correlationId: parentTask.correlationId,
                        taskId: agentTaskRequest.taskId,
                        taskInstanceId: agentTaskRequest.taskInstanceId!,
                        startedAt: new Date(),
                        status: "published",
                        parentTaskId: parentTask.taskId,
                        parentTaskInstanceId: parentTask.taskInstanceId,
                        subtaskGroupId: subtaskGroupId
                    });

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

interface ParentTaskInfo {
    correlationId: string;
    taskId: string;
    taskInstanceId: string;
}