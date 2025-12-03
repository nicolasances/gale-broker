import { Request } from "express";
import { ExecutionContext, TotoDelegate, UserContext } from "toto-api-controller";
import { TaskExecution } from "../core/task/TaskExecution";
import { extractBearerToken } from "../util/HeaderUtils";
import { AgentTaskRequest, AgentTaskResponse } from "../model/AgentTask";
import { AgentsCatalog } from "../core/catalog/AgentsCatalog";
import { AgenticFlowTracker } from "../core/tracking/AgenticFlowTracker";
import { DefaultAgentCallFactory } from "../api/AgentCall";
import { GaleConfig } from "../Config";
import { AgentStatusTracker } from "../core/tracking/AgentStatusTracker";

/**
 * Endpoint to post a task to an Agent for execution.
 */
export class PostTask implements TotoDelegate {

    async do(req: Request, userContext: UserContext, execContext: ExecutionContext): Promise<AgentTaskResponse> {

        const token = extractBearerToken(req);
        const config = execContext.config as GaleConfig;

        const client = await config.getMongoClient();
        const db = client.db(config.getDBName());

        const result = await new TaskExecution({
            execContext,
            agentCallFactory: new DefaultAgentCallFactory(execContext, token ? token : undefined),
            agenticFlowTracker: new AgenticFlowTracker(db, execContext, new AgentStatusTracker(db, execContext)),
            agentsCatalog: new AgentsCatalog(db, execContext)
        }).do(AgentTaskRequest.fromHTTPRequest(req));

        return result;

    }

}