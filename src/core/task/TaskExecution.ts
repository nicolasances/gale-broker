import { AgentsCatalog } from "../catalog/AgentsCatalog";
import { AgentNotFoundError } from "../../model/error/AgentNotFoundError";
import { AgentCall } from "../../api/AgentCall";
import { ExecutionContext, TotoRuntimeError, ValidationError } from "toto-api-controller";
import { GaleConfig } from "../../Config";
import { AgentTaskRequest, AgentTaskResponse, TaskInfo, ParentTaskInfo, TaskGroup } from "../../model/AgentTask";
import { v4 as uuidv4 } from "uuid";
import { isRootTaskFirstStart, isParentTaskResumption, isSubtaskStart } from "./TaskExecutionUtil";
import { AgentStatusTracker, TaskStatusRecord } from "../tracking/AgentStatusTracker";
import { AgenticFlowTracker } from "../tracking/AgenticFlowTracker";

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
     * Reacts to receiving a request of executing a task. 
     */
    async do(task: AgentTaskRequest): Promise<AgentTaskResponse> {

        const config = this.execContext.config as GaleConfig;
        const cid = this.cid;
        const logger = this.execContext.logger;

        try {

            const client = await config.getMongoClient();
            const db = client.db(config.getDBName());

            const tracker = new AgenticFlowTracker(db, this.execContext, new AgentStatusTracker(db, this.execContext));

            // 0. Find an available Agent that can execute the task.
            const agent = await new AgentsCatalog(db, this.execContext).findAgentByTaskId(task.taskId);

            if (!agent) throw new AgentNotFoundError(task.taskId);

            logger.compute(cid, `[RECEIVED TASK] - [${task.taskId} - ${task.taskInstanceId}] - Command [${JSON.stringify(task.command)}] - Correlation Id: ${task.correlationId}`, "info");

            if (isRootTaskFirstStart(task)) {

                // Assign task instance id and correlation id
                task.taskInstanceId = uuidv4();
                task.correlationId = uuidv4();

                // Log the start of the root task
                await tracker.rootAgentStarted(agent, task);

                // Trigger the agent (orchestrator, most likely)
                const agentTaskResponse: AgentTaskResponse = await new AgentCall(agent, this.execContext, this.bearerToken).execute(task, task.correlationId);

                // Response handling
                // If you're done, just return: it wasn't an orchestrator flow after all
                if (agentTaskResponse.stopReason === "completed") {
                    await tracker.agentCompleted(task, agentTaskResponse);
                    return agentTaskResponse;
                }
                else if (agentTaskResponse.stopReason === "failed") {
                    await tracker.agentFailed(task, agentTaskResponse);
                    return agentTaskResponse;
                }
                else if (agentTaskResponse.stopReason === "subtasks") {
                    await this.spawnSubtasks(agentTaskResponse.subtasks!, {
                        taskId: task.taskId,
                        taskInstanceId: task.taskInstanceId!,
                        correlationId: task.correlationId!,
                    }, null, tracker);

                    return agentTaskResponse;
                }
                else throw new TotoRuntimeError(500, `Unknown stop reason received from agent ${agent.name} for task ${task.taskId}: ${agentTaskResponse.stopReason}`);

            }
            else if (isSubtaskStart(task)) {
                // I'm executing a subtask

                if (!task.taskGroupId) throw new ValidationError(400, "Missing taskGroupId when starting a subtask. Task Id: " + task.taskId);
                if (!task.parentTask) throw new ValidationError(400, "Missing parentTask info when starting a subtask. Task Id: " + task.taskId);

                await tracker.agentStarted(agent, task);

                const agentTaskResponse: AgentTaskResponse = await new AgentCall(agent, this.execContext, this.bearerToken).execute(task, task.correlationId!);

                // Handle the response 
                if (agentTaskResponse.stopReason === 'failed') {
                    await tracker.agentFailed(task, agentTaskResponse);

                    // TODO: resume the parent task with failure info - or retry automatically once before resuming the parent
                }
                else if (agentTaskResponse.stopReason === 'completed') {
                    await tracker.agentCompleted(task, agentTaskResponse);

                    // Check if all subtasks in the group are done and if so, RESUME the parent task
                    const groupDone = await tracker.isGroupDone(task.taskGroupId);

                    if (groupDone) await this.resumeParentTask(task.taskGroupId, task.parentTask!.taskInstanceId, task.correlationId!, tracker.agentStatusTracker);

                    return agentTaskResponse;
                }
                else if (agentTaskResponse.stopReason === 'subtasks') {
                    await this.spawnSubtasks(agentTaskResponse.subtasks!, {
                        taskId: task.taskId,
                        taskInstanceId: task.taskInstanceId!,
                        correlationId: task.correlationId!,
                    }, task.taskGroupId, tracker);

                    return agentTaskResponse;
                }

            }
            else if (isParentTaskResumption(task)) {
                // The Parent Task is being resumed after a group of subtasks or a standalone agent not part of a group was completed

                const completedGroupId = task.command.completedTaskGroupId;
                const branchId = task.command.branchId; // Branch on which the completed task group (or lone agent) is located

                if (!completedGroupId) throw new ValidationError(400, "Missing completedTaskGroupId in command to resume parent task. Task Id: " + task.taskId);
                if (!branchId) throw new ValidationError(400, "Missing branchId in command to resume parent task. Task Id: " + task.taskId);

                // Resume the parent <=> ask if there is more to do on the branch or not
                const agentTaskResponse: AgentTaskResponse = await new AgentCall(agent, this.execContext, this.bearerToken).execute(task, task.correlationId!);

                if (agentTaskResponse.stopReason === 'failed') {
                    await tracker.agentFailed(task, agentTaskResponse);

                    // TODO If this parent task had a parent itself, notify the parent  - or retry automatically once before resuming the parent
                }
                else if (agentTaskResponse.stopReason === 'completed') {
                    // The parent agent is saying it's done with this branch

                    // Mark the branch as completed
                    await tracker.markBranchCompleted(task.correlationId!, branchId);

                    // Check if the branches siblings to this one are also already completed
                    const branchesCompleted = await tracker.areSiblingBranchesCompleted(task.correlationId!, branchId);

                    if (branchesCompleted) {
                        await tracker.agentCompleted(task, agentTaskResponse);

                        // TODO: gather the outputs of all branches and return the final output instead of the current one
                        return agentTaskResponse;
                    }

                    // Not all branches are completed yet: wait for the others
                    return agentTaskResponse;
                }
                else if (agentTaskResponse.stopReason === 'subtasks') {
                    // This means that the parent agent has more work to do on this branch

                    await this.spawnSubtasks(agentTaskResponse.subtasks!, {
                        taskId: task.taskId,
                        taskInstanceId: task.taskInstanceId!,
                        correlationId: task.correlationId!,
                    }, task.command.completedTaskGroupId!, tracker);

                    return agentTaskResponse;
                }

            }
            else {
                // Unknown scenario: should not happen
            }

            return new AgentTaskResponse({
                correlationId: task.correlationId!,
                stopReason: "completed",
            });

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
     * Resumes the parent task after all subtasks in a group have been completed.
     * 
     * This method also makes sure that the parent task is not already resumed by another concurrent process.
     * 
     * @param taskGroupId 
     * @param parentTaskInstanceId 
     * @param correlationId 
     * @param statusTracker 
     */
    private async resumeParentTask(taskGroupId: string, parentTaskInstanceId: string, correlationId: string, statusTracker: AgentStatusTracker): Promise<void> {

        // Acquire lock on the parent task
        await statusTracker.acquireTaskLock(parentTaskInstanceId);

        try {

            // Check that the parent task is not already resumed
            const parentTask = await statusTracker.findTaskByInstanceId(parentTaskInstanceId!);

            if (parentTask?.completedSubtaskGroups?.includes(taskGroupId)) return; // Already resumed

            // Get all the subtasks in the group and the parent task 
            const groupTasks = await statusTracker.findGroupTasks(taskGroupId);

            if (!parentTask) throw new TotoRuntimeError(500, `Could not find parent task with instance id ${parentTaskInstanceId} to resume it after completing subtasks in group ${taskGroupId}.`);

            // Publish a message to notify the parent task's agent that all subtasks are completed. The parent task will be a NEW INSTANCE of the task (stateless, so with new task instance Id)
            const agentTaskRequest = new AgentTaskRequest({
                command: {
                    command: "resume",
                    completedTaskGroupId: taskGroupId,
                    branchId: groupTasks[0].branchId,
                },
                correlationId: correlationId,
                taskId: parentTask.taskId,
                taskInstanceId: parentTask.taskInstanceId,
                taskInputData: {
                    originalInput: parentTask?.taskInput.originalInput || parentTask?.taskInput,
                    childrenOutputs: groupTasks.map(child => child.taskOutput),
                },
            });

            const bus = this.config.messageBus;

            await bus.publishTask(agentTaskRequest, this.cid);

            // Mark the parent task as resumed in the tracker
            await statusTracker.markTaskResumedAfterGroupCompletion(parentTaskInstanceId, taskGroupId);

        } catch (error) {
            throw error;
        }
        finally {
            // Release the lock
            await statusTracker.releaseTaskLock(parentTaskInstanceId);
        }

    }

    /**
     * Spawns the given subtasks so that they can be asynchronously executed by the agents. 
     * 
     * This concretely uses the Message Bus to publish the subtask requests.
     * 
     * @param subtasks subtasks to be spawn off
     * @param parentTask info about the parent task
     * @param afterGroup the group (identified by the groupId) after which these subtasks are spawned
     * @param tracker the Agentic Flow tracker to use for tracking
     */
    private async spawnSubtasks(subtaskGroups: TaskGroup[], parentTask: ParentTaskInfo, afterGroup: string | null, tracker: AgenticFlowTracker): Promise<void> {

        const bus = this.config.messageBus;

        const publishPromises: Promise<void>[] = [];
        const branches: { branchId: string, tasks: AgentTaskRequest[] }[] = [];

        // Each task group represents a branch. 
        for (const group of subtaskGroups) {

            // Create a branch id 
            const branchId = uuidv4();

            // Create the subtasks in the group
            const groupTasks = group.tasks.map((task) => {
                return new AgentTaskRequest({
                    command: { command: "start" },
                    correlationId: parentTask.correlationId,
                    taskId: task.taskId,
                    taskInstanceId: uuidv4(),
                    taskInputData: task.taskInputData,
                    parentTask: parentTask,
                    taskGroupId: group.groupId,
                    branchId: branchId,
                });
            })

            branches.push({ branchId, tasks: groupTasks });

            // Publish each subtask to the bus
            for (const task of groupTasks) {

                // Publish the subtask to the message bus
                publishPromises.push(new Promise<void>(async (resolve, reject) => {

                    try {

                        // 1. Publish the task to the bus
                        await bus.publishTask(task, this.cid);

                        this.execContext.logger.compute(this.cid, `Subtask [${task.taskId}] successfully spawned.`, "info");

                        resolve();

                    } catch (error) {
                        this.execContext.logger.compute(this.cid, `Failed to spawn subtask [${task.taskId}]: ${error}`, "error");
                        reject(error);
                    }

                }));
            }
        }

        // Wait for all to be published
        await Promise.all(publishPromises);

        // Track
        await tracker.branch(branches, afterGroup);
    }

}
