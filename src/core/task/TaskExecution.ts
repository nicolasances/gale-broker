import { AgentsCatalog } from "../catalog/AgentsCatalog";
import { AgentNotFoundError } from "../../model/error/AgentNotFoundError";
import { AgentCall } from "../../api/AgentCall";
import { ExecutionContext, TotoRuntimeError, ValidationError } from "toto-api-controller";
import { GaleConfig } from "../../Config";
import { AgentTaskRequest, AgentTaskResponse, TaskInfo, ParentTaskInfo } from "../../model/AgentTask";
import { v4 as uuidv4 } from "uuid";
import { isRootTaskFirstStart, isParentTaskResumption, isSubtaskStart } from "./TaskExecutionUtil";
import { AgentStatusTracker } from "../tracking/AgentStatusTracker";

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

            const tracker = new AgentStatusTracker(db, this.execContext);

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
                    await tracker.rootAgentCompleted(agent, task, agentTaskResponse);
                    return agentTaskResponse;
                }
                else if (agentTaskResponse.stopReason === "failed") {
                    await tracker.agentFailed(agent, task, agentTaskResponse);
                    return agentTaskResponse;
                }
                else if (agentTaskResponse.stopReason === "subtasks") {
                    await tracker.agentSpawnedSubtasks(agent, task, agentTaskResponse);

                    // Spawn subtasks by publishing them to the Message Bus
                    // TODO

                }
                else throw new TotoRuntimeError(500, `Unknown stop reason received from agent ${agent.name} for task ${task.taskId}: ${agentTaskResponse.stopReason}`);

            }
            else if (isSubtaskStart(task)) {

                // Tracks
                await tracker.trackSubtaskStarted(agent, task);

                // I'm executing a subtask
                const agentTaskResponse: AgentTaskResponse = await new AgentCall(agent, this.execContext, this.bearerToken).execute(task, task.correlationId!);

                // Handle the response 
                if (agentTaskResponse.stopReason === 'failed') {
                    await tracker.agentFailed(agent, task, agentTaskResponse);

                    // TODO: resume the parent task with failure info - or retry automatically once before resuming the parent
                }
                else if (agentTaskResponse.stopReason === 'completed') {
                    await tracker.agentCompleted(agent, task, agentTaskResponse);

                    // TODO: Check if all subtasks in the group are done and if so, RESUME the parent task
                    const groupDone = await tracker.isGroupDone(task.taskGroupId!); 

                    if (groupDone) await resumeParentTask(task, agentTaskResponse);

                    return agentTaskResponse;
                }
                else if (agentTaskResponse.stopReason === 'subtasks') {
                    await tracker.agentSpawnedSubtasks(agent, task, agentTaskResponse);

                    // Create branches for each task group (or a single branch if there's only one group)
                    
                    // TODO: Spawn subtasks. Each subtask has a branchId on top of a groupId
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
                    await tracker.agentFailed(agent, task, agentTaskResponse);

                    // TODO If this parent task had a parent itself, notify the parent  - or retry automatically once before resuming the parent
                }
                else if (agentTaskResponse.stopReason === 'completed') {
                    // The parent agent is saying it's done with this branch

                    // Mark the branch as completed
                    await tracker.markBranchCompleted(branchId);
                    
                    // Check if the branches siblings to this one are also already completed
                    const branchesCompleted = await tracker.areSiblingBranchesCompleted(branchId);

                    if (branchesCompleted) {
                        // TODO: gather the outputs of all branches and return the final output
                        return ; // TODO: replace return
                    }

                    // Not all branches are completed yet: wait for the others
                    return agentTaskResponse;
                }
                else if (agentTaskResponse.stopReason === 'subtasks') {
                    // This means that the parent agent has more work to do on this branch
                    
                    await tracker.agentSpawnedSubtasks(agent, task, agentTaskResponse);
                    
                    // TODO: Spawn subtasks
                }

            }
            else {
                // Unknown scenario: should not happen
            }



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
}
