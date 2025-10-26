import { TaskId } from "../../model/TaskId";
import { AgentsCatalog } from "../catalog/AgentsCatalog";
import { AgentNotFoundError } from "../../model/error/AgentNotFoundError";
import { AgentCall } from "../../api/AgentCall";
import { TaskInputData } from "../../model/TaskInputData";
import { ExecutionContext, TotoRuntimeError, ValidationError } from "toto-api-controller";
import { ControllerConfig } from "../../Config";
import { AgentTracker } from "../tracking/AgentTracker";
import { AgentTriggerReponse } from "../../model/AgentTriggerReponse";

export class TaskExecution {
    bearerToken: string;
    execContext: ExecutionContext;

    constructor(execContext: ExecutionContext, bearerToken: string) {
        this.execContext = execContext;
        this.bearerToken = bearerToken;
    }

    /**
     * Starts the execution of a task. 
     * 
     * 1. Find an available Agent that can execute the task.
     * 2. Send the task to the Agent for execution.
     * 
     * @param taskId the unique identifier of the task to start. 
     */
    async startTask(taskId: TaskId, taskInputData: TaskInputData): Promise<AgentTriggerReponse> {

        const config = this.execContext.config as ControllerConfig;
        const cid = this.execContext.cid;
        const logger = this.execContext.logger;

        let client;

        try {

            client = await config.getMongoClient();
            const db = client.db(config.getDBName());

            // 1. Find an available Agent that can execute the task.
            const agent = await new AgentsCatalog(db, this.execContext).findAgentByTaskId(taskId);

            if (!agent) throw new AgentNotFoundError(taskId);

            // 2. Send the task to the Agent for execution.
            logger.compute(cid, `Triggering Agent ${agent.name} to execute task ${taskId}.`, "info");

            const agentTriggerResponse: AgentTriggerReponse = await new AgentCall(agent, this.execContext, this.bearerToken).execute(taskInputData);

            logger.compute(cid, `Agent ${agent.name} triggered successfully for task ${taskId}. Received response: ${JSON.stringify(agentTriggerResponse)}.`, "info");

            // 3. Persist the task execution status.
            await new AgentTracker(db, this.execContext).trackAgentStatus({
                taskId: taskId,
                agentName: agent.name,
                taskExecutionId: agentTriggerResponse.taskExecutionId,
                status: "running",
                executionTimeS: 0 // Initial execution time is 0.
            });

            return agentTriggerResponse;

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
        finally {
            if (client) client.close();
        }

    }
}