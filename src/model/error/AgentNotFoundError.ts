
export class AgentNotFoundError extends Error {

    name: string = "AgentNotFoundError";
    taskId: string;
    code: number = 404;

    constructor(taskId: string) {
        super(`No Agent found for Task ID: ${taskId}`);
        this.taskId = taskId;
    }
}