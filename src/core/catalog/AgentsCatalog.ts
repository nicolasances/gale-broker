import { Db } from "mongodb";
import { AgentDefinition } from "../../model/AgentDefinition";
import { ExecutionContext, ValidationError } from "toto-api-controller";
import { GaleConfig } from "../../Config";
import { TaskId } from "../../model/AgentTask";

export class AgentsCatalog {

    private config: GaleConfig;

    constructor(private db: Db, private execContext: ExecutionContext) {
        this.config = execContext.config as GaleConfig;
    }

    /**
     * Finds an Agent that can execute the given taskId.
     * 
     * @param taskId the type of task to be executed
     * @returns the AgentDefinition that can execute the task, or null if none found.
     */
    async findAgentByTaskId(taskId: TaskId): Promise<AgentDefinition | null> {

        const agentsCollection = this.db.collection(this.config.getCollections().agents);

        const agentData = await agentsCollection.findOne({ taskId: taskId });

        if (!agentData) return null;

        return AgentDefinition.fromBSON(agentData);

    }

    /**
     * Retrieves all registered agents.
     * @returns All registered agents
     */
    async getAgents(): Promise<AgentDefinition[]> {

        const agentsCollection = this.db.collection(this.config.getCollections().agents);

        const agentsData = await agentsCollection.find({}).toArray();

        return agentsData.map(agentData => AgentDefinition.fromBSON(agentData));

    }

    /**
     * Deletes all agents that can execute the given taskId.
     * @param taskId the task type to find all agents to delete
     * @returns 
     */
    async deleteAgentsWithTaskId(taskId: TaskId): Promise<number> {
        const agentsCollection = this.db.collection(this.config.getCollections().agents);   
        const result = await agentsCollection.deleteMany({ taskId: taskId });
        return result.deletedCount || 0;
    }

    /**
     * Registers a new agent 
     * Makes sure that there is no other agent with the same name already registered and no other agent that can execute the same taskId.
     * 
     * @param agentDefinition the AgentDefinition to register.
     * @returns the ID of the newly registered Agent.
     * @throws ValidationError if an agent with the same name or taskId already exists.
     */
    async registerAgent(agentDefinition: AgentDefinition): Promise<string> {

        const agentsCollection = this.db.collection(this.config.getCollections().agents);

        // Check for existing agent with same name or same taskId
        const existing = await agentsCollection.findOne({ $or: [{ name: agentDefinition.name }, { taskId: agentDefinition.taskId }] });

        if (existing) throw new ValidationError(400, `Agent with name ${agentDefinition.name} or taskId ${agentDefinition.taskId} already exists.`);

        const result = await agentsCollection.insertOne(agentDefinition);

        return result.insertedId.toHexString();
    }

    /**
     * Updates the definition of an existing agent.
     * 
     * @param agentDefinition 
     */
    async updateAgent(agentDefinition: AgentDefinition): Promise<number> {

        const agentsCollection = this.db.collection(this.config.getCollections().agents);

        const result = await agentsCollection.updateOne(
            { name: agentDefinition.name },
            { $set: { ...agentDefinition } },
            { upsert: true }
        );

        return result.modifiedCount;

    }
}