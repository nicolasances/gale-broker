import { Request } from "express";
import { ExecutionContext, TotoDelegate, UserContext, ValidationError } from "toto-api-controller";
import { TaskExecution } from "../core/task/TaskExecution";
import { extractBearerToken } from "../util/HeaderUtils";
import { AgentTaskResponse } from "../model/AgentTask";
import { TaskRequest } from "../model/Task";

/**
 * Endpoint to post a task to an Agent for execution.
 */
export class PostTask implements TotoDelegate {

    async do(req: Request, userContext: UserContext, execContext: ExecutionContext): Promise<AgentTaskResponse> {

        const result = await new TaskExecution(execContext, extractBearerToken(req)!).startTask(TaskRequest.fromHTTPRequest(req));

        return result;

    }

}