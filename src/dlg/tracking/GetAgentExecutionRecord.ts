
import { Request } from "express";
import { TotoDelegate, TotoRequest, UserContext, ValidationError } from "totoms";
import { GaleConfig } from "../../Config";
import { TaskStatusRecord, AgentStatusTracker } from "../../core/tracking/AgentStatusTracker";

/**
 */
export class GetAgentExecutionRecord extends TotoDelegate<GetAgentExecutionRecordRequest, GetAgentExecutionRecordResponse> {

    async do(req: GetAgentExecutionRecordRequest, userContext?: UserContext): Promise<GetAgentExecutionRecordResponse> {

        const config = this.config as GaleConfig;

                const db = await config.getMongoDb(config.getDBName());

        // 1. Retrieve the exeuction records from the database
        const task: TaskStatusRecord | null = await new AgentStatusTracker(db, config).findTaskByInstanceId(req.taskInstanceId);

        return { task }

    }
    public parseRequest(req: Request): GetAgentExecutionRecordRequest {
        const taskInstanceId = req.params.taskInstanceId;
        if (!taskInstanceId) throw new ValidationError(400, "taskInstanceId is required");

        return { taskInstanceId };
    }

}

interface GetAgentExecutionRecordRequest extends TotoRequest {
    taskInstanceId: string;
}

export interface GetAgentExecutionRecordResponse {

    task: TaskStatusRecord | null;

}