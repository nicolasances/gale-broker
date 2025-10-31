import { Request } from "express";
import { ExecutionContext, TotoDelegate, UserContext } from "toto-api-controller";
import { TaskExecution } from "../core/task/TaskExecution";
import { extractBearerToken } from "../util/HeaderUtils";
import { AgentTaskRequest, AgentTaskResponse } from "../model/AgentTask";

/**
 * Endpoint to post a task to an Agent for execution.
 */
export class PostTask implements TotoDelegate {

    async do(req: Request, userContext: UserContext, execContext: ExecutionContext): Promise<AgentTaskResponse> {

        const result = await new TaskExecution(execContext, extractBearerToken(req)!).startTask(AgentTaskRequest.fromHTTPRequest(req));

        return result;

    }

}