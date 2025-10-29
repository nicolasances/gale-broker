import { ValidationError } from "toto-api-controller";
import { TaskEndpoint } from "./TaskEndpoint";
import { TaskId } from "./Task";

export class AgentDefinition {

    name: string; // The name of the Agent.
    taskId: TaskId; // The unique identifier of the type of task this Agent can execute.
    endpoint: TaskEndpoint; // The endpoint (URL) where the Agent can be reached.
    orchestrator: boolean;

    constructor(name: string, taskId: TaskId, endpoint: TaskEndpoint, orchestrator: boolean = false) {
        this.name = name;
        this.taskId = taskId;
        this.endpoint = endpoint;
        this.orchestrator = orchestrator;
    }

    static fromJSON(data: any): AgentDefinition {

        if (!data.name || !data.taskId || !data.endpoint) throw new ValidationError(400, `Invalid AgentDefinition JSON: missing required fields. Received ${JSON.stringify(data)}.`);

        return new AgentDefinition(
            data.name,
            data.taskId,
            TaskEndpoint.fromJSON(data.endpoint),
            data.orchestrator
        );
    }

    static fromBSON(data: any): AgentDefinition {
        return new AgentDefinition(
            data.name,
            data.taskId,
            TaskEndpoint.fromBSON(data.endpoint),
            data.orchestrator
        );
    }
}