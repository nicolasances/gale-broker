import { Request } from "express";
import { ExecutionContext, TotoDelegate, UserContext, ValidationError } from "toto-api-controller";
import { TaskExecution } from "../core/task/TaskExecution";
import { extractBearerToken } from "../util/HeaderUtils";
import { TaskInputData } from "../model/TaskInputData";
import { AgentTriggerReponse } from "../model/AgentTriggerReponse";

/**
 * Endpoint to post a task to an Agent for execution.
 */
export class PostTask implements TotoDelegate {

    async do(req: Request, userContext: UserContext, execContext: ExecutionContext): Promise<PostTaskResponse> {

        const postTaskRequest = PostTaskRequest.fromRequest(req);

        const result = await new TaskExecution(execContext, extractBearerToken(req)!).startTask(postTaskRequest.taskId, postTaskRequest.taskInputData);

        return {
            agentTriggerResponse: result
        };

    }

}

class PostTaskRequest {
    taskId: string;
    taskInputData: TaskInputData;

    constructor(taskId: string, taskInputData: TaskInputData) {
        this.taskId = taskId;
        this.taskInputData = taskInputData;
    }

    static fromRequest(req: Request): PostTaskRequest {
        const body = req.body;

        if (!body.taskId) throw new ValidationError(400, "taskId is required");

        return new PostTaskRequest(body.taskId, body.taskInputData || {});
    }
}
interface PostTaskResponse {
    agentTriggerResponse: AgentTriggerReponse;
}