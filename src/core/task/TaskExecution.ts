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
                    await tracker.rootAgentFailed(agent, task, agentTaskResponse);
                    return agentTaskResponse;
                }
                else if (agentTaskResponse.stopReason === "subtasks") {
                    await tracker.agentSpawnedSubtasks(agent, task, agentTaskResponse);

                    // Spawn subtasks by publishing them to the Message Bus

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
                    await tracker.subtaskFailed(agent, task, agentTaskResponse);

                    // TODO: resume the parent task with failure info - or retry automatically once before resuming the parent
                }
                else if (agentTaskResponse.stopReason === 'completed') {

                    // TODO: Check if all subtasks in the group are done and if so, RESUME the parent task

                    // If not all are done, just return
                }
                else if (agentTaskResponse.stopReason === 'subtasks') {

                    // Spawn subtasks
                }

            }
            else if (isParentTaskResumption(task)) {
                // I'm resuming a parent task 

                // Trigger the parent agent with a resume command
                const agentTaskResponse: AgentTaskResponse = await new AgentCall(agent, this.execContext, this.bearerToken).execute(task, task.correlationId!);

                if (agentTaskResponse.stopReason === 'failed') {
                    // TODO
                }
                else if (agentTaskResponse.stopReason === 'completed') {
                    // If the parent is DONE (no more subtasks), check if it was part of a group 
                    // - If not, IT WAS THE ROOT TASK => the whole flow is done 
                    // NOT CORRECT!!!!! if the left group finished but not the right one and the left one has no more things after but the right one does, I won't be able to handle that

                    // - If yes, check if all other tasks in the group are done. 
                    //     - If not return. 

                    //     - If yes, RESUME the UPPER PARENT TASK
                }
                else if (agentTaskResponse.stopReason === 'subtasks') {
                    // There's more to do 
                    // Spawn subtasks
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
