import { Logger, TotoMessageBus } from "totoms";
import { GaleConfig } from "../../Config";
import { AgentsCatalog } from "../catalog/AgentsCatalog";
import { ConversationStore } from "../../store/ConversationStore";
import { DefaultAgentCallFactory } from "../../api/AgentCall";
import { AgentConversationMessage } from "../../model/AgentMessage";

/**
 * This class contains all the conversation-related logic. 
 * 
 * That means: 
 * - Receiving messages from users and adding them to the conversation and triggering the agents target of the conversation to process the new message
 */
export class Conversation {

    constructor(private config: GaleConfig, private messageBus: TotoMessageBus, private cid: string) { }

    /**
     * This method is called when a new message is sent to an Agent.
     * 
     * @param message the caller's message
     */
    async processNewMessage(message: AgentConversationMessage): Promise<{ conversationId: string, messageId: string }> {

        const db = await this.config.getMongoDb(this.config.getDBName());
        const conversationStore = new ConversationStore(db, this.config);

        // Store the message (creates a new conversation if needed) and resolve the conversationId and messageId
        const { conversationId, messageId } = await conversationStore.storeMessage(message);

        // If this is a user message (hance directed to the Agent), send it to the Agent for processing
        if (message.actor !== "user") return { conversationId, messageId };

        // Send the message to the Agent for processing - through the message bus, so it's processed asynchronously
        message.conversationId = conversationId;
        message.messageId = messageId;

        await this.messageBus.publishMessage({ topic: "galeagents" }, {
            type: "agentMessagePosted",
            cid: this.cid,
            id: messageId,
            msg: `New message posted to conversation ${conversationId} for agent ${message.agentId}`,
            timestamp: new Date().toISOString(),
            data: message
        })

        return { conversationId, messageId };
    }

    /**
     * Sends the message to the agent (synchronourly) for processing.
     * 
     * @param agentMessage 
     */
    async sendMessageToAgent(agentMessage: AgentConversationMessage) {

        const logger = Logger.getInstance();
        const db = await this.config.getMongoDb(this.config.getDBName());

        const agentsCatalog = new AgentsCatalog(db, this.config);

        const agentDefinition = await agentsCatalog.getAgent(agentMessage.agentId);

        if (!agentDefinition) {
            logger.compute(this.cid, `Agent with ID [${agentMessage.agentId}] not found`, "error");
            throw new Error(`Agent with ID [${agentMessage.agentId}] not found`);
        }

        const agentResponse = await new DefaultAgentCallFactory(this.cid, this.config).createAgentCall(agentDefinition).sendMessage(agentMessage);

        // Persist the agent's final response so the SSE stream can detect stream.last
        if (agentResponse && agentResponse.conversationId) {
            const conversationStore = new ConversationStore(db, this.config);
            await conversationStore.storeMessage(agentResponse);
        }

    }


}
