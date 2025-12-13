
import { Request } from "express";
import { ExecutionContext, TotoDelegate, UserContext } from "toto-api-controller";
import { GaleConfig } from "../../Config";
import { TaskStatusRecord, AgentStatusTracker } from "../../core/tracking/AgentStatusTracker";

/**
 */
export class GetAgentExecutionRecord implements TotoDelegate {

    async do(req: Request, userContext: UserContext, execContext: ExecutionContext): Promise<GetAgentExecutionRecordResponse> {

        const config = execContext.config as GaleConfig;

        const client = await config.getMongoClient();
        const db = client.db(config.getDBName());

        // 1. Retrieve the exeuction records from the database
        const task: TaskStatusRecord | null = await new AgentStatusTracker(db, execContext).findTaskByInstanceId(req.params.taskInstanceId);

        return { task }

    }
}

export interface GetAgentExecutionRecordResponse {

    task: TaskStatusRecord | null;

}