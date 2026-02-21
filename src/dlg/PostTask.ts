import { Request } from "express";
import { Logger, TotoDelegate, TotoRequest, UserContext } from "totoms";
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
export class PostTask extends TotoDelegate<PostTaskRequest, AgentTaskResponse> {

    async do(req: PostTaskRequest, userContext?: UserContext): Promise<AgentTaskResponse> {

        const config = this.config as GaleConfig;
        const logger = Logger.getInstance();
        const cid = this.cid || "";

                const db = await config.getMongoDb(config.getDBName());

        const result = await new TaskExecution({
            config,
            logger,
            cid,
            messageBus: this.messageBus,
            agentCallFactory: new DefaultAgentCallFactory(logger, cid, req.bearerToken || undefined),
            agenticFlowTracker: new AgenticFlowTracker(db, config, new AgentStatusTracker(db, config)),
            agentsCatalog: new AgentsCatalog(db, config)
        }).do(req.taskRequest);

        return result;

    }

    public parseRequest(req: Request): PostTaskRequest {
        return {
            bearerToken: extractBearerToken(req),
            taskRequest: AgentTaskRequest.fromHTTPRequest(req)
        };
    }

}

interface PostTaskRequest extends TotoRequest {
    bearerToken: string | null;
    taskRequest: AgentTaskRequest;
}