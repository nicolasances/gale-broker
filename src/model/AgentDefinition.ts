import { ValidationError } from "totoms";
import { AgentEndpoint } from "./AgentEndpoint";
import { TaskId } from "./AgentTask";

export class AgentDefinition {

    /**
     * Unique identifier of the Agent. 
     * Human-readable code that is programmatically used to refer to the Agent. 
     * 
     * For Backward compatibility reasons, if agentId is not provided, taskId will be used instead
     */
    agentId: string = "";    

    /**
     * Technical Id (MongoDB ObjectId) of the AgentDefinition document in the database.
     */
    id?: string;
    
    /**
     * LEGACY
     * 
     * The unique identifier of the type of task this Agent can execute. This is used to match the Agent with the tasks it can execute.
     * This was there when I thought of Agents as executors of backend async tasks, not as conversational agents. 
     * 
     * It's still used for backward compatibility. 
     */
    taskId: TaskId = ""; // The unique identifier of the type of task this Agent can execute.

    /**
     * Where can the agent be reached.
     */
    endpoint: AgentEndpoint = new AgentEndpoint(""); // The endpoint (URL) where the Agent can be reached.
    
    name: string = ""; // The name of the Agent.
    description: string = ""; // The description of the Agent.
    inputSchema: any = {}; 
    outputSchema: any = {}; 

    static fromJSON(data: any): AgentDefinition {

        if (!data.name || !data.taskId || !data.endpoint || !data.inputSchema || !data.outputSchema) throw new ValidationError(400, `Invalid AgentDefinition JSON: missing required fields. Received ${JSON.stringify(data)}.`);

        const def = new AgentDefinition();
        def.agentId = data.agentId || data.taskId; // For backward compatibility, if agentId is not provided, use taskId as agentId
        def.name = data.name;
        def.description = data.description || "";
        def.taskId = data.taskId;
        def.inputSchema = data.inputSchema;
        def.outputSchema = data.outputSchema;
        def.endpoint = AgentEndpoint.fromJSON(data.endpoint);

        return def;
    }

    static fromBSON(data: any): AgentDefinition {
        const agent = AgentDefinition.fromJSON(data);
        agent.id = data._id?.toString();
        return agent;
    }
}