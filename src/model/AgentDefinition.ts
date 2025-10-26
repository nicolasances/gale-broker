import { TaskEndpoint } from "./TaskEndpoint";
import { TaskId } from "./TaskId";

export class AgentDefinition {

    name: string; // The name of the Agent.
    taskId: TaskId; // The unique identifier of the type of task this Agent can execute.
    endpoint: TaskEndpoint; // The endpoint (URL) where the Agent can be reached.

    constructor(name: string, taskId: TaskId, endpoint: TaskEndpoint) {
        this.name = name;
        this.taskId = taskId;
        this.endpoint = endpoint;
    }

    static fromJSON(data: any): AgentDefinition {
        return new AgentDefinition(
            data.name,
            data.taskId,
            TaskEndpoint.fromJSON(data.endpoint)
        );
    }

    static fromBSON(data: any): AgentDefinition {
        return new AgentDefinition(
            data.name,
            data.taskId,
            TaskEndpoint.fromBSON(data.endpoint)
        );
    }
}