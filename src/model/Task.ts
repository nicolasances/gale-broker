import { Request } from "express";
import { ValidationError } from "toto-api-controller";

/**
 * A Task ID identifies the TYPE of task to be executed by an Agent. 
 */
export type TaskId = string;

/**
 * Models the data needed to send a task request TO Gale Broker. 
 */
export class TaskRequest {

    taskId: TaskId;             // Unique identifier of the task to be executed. E.g. "text.summarize"
    taskInputData: any | null;  // Input data needed for the task execution.

    constructor(taskId: TaskId, taskInputData: any | null = null) {
        this.taskId = taskId;
        this.taskInputData = taskInputData;
    }

    static fromHTTPRequest(req: Request): TaskRequest {

        // 1. Validate mandatory fields
        if (!req.body.taskId) throw new ValidationError(400, "Missing mandatory field: taskId");

        // 2. Extract fields
        return new TaskRequest(
            req.body.taskId,
            req.body.taskInputData || null
        );

    }

}