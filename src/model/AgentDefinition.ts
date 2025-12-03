import { ValidationError } from "toto-api-controller";
import { AgentEndpoint } from "./AgentEndpoint";
import { TaskId } from "./AgentTask";

export class AgentDefinition {

    name: string = ""; // The name of the Agent.
    description: string = ""; // The description of the Agent.
    taskId: TaskId = ""; // The unique identifier of the type of task this Agent can execute.
    inputSchema: any = {}; 
    outputSchema: any = {}; 
    endpoint: AgentEndpoint = new AgentEndpoint(""); // The endpoint (URL) where the Agent can be reached.

    static fromJSON(data: any): AgentDefinition {

        if (!data.name || !data.taskId || !data.endpoint || !data.inputSchema || !data.outputSchema) throw new ValidationError(400, `Invalid AgentDefinition JSON: missing required fields. Received ${JSON.stringify(data)}.`);

        const def = new AgentDefinition();
        def.name = data.name;
        def.description = data.description || "";
        def.taskId = data.taskId;
        def.inputSchema = data.inputSchema;
        def.outputSchema = data.outputSchema;
        def.endpoint = AgentEndpoint.fromJSON(data.endpoint);

        return def;
    }

    static fromBSON(data: any): AgentDefinition {
        return AgentDefinition.fromJSON(data);
    }
}