import { Db } from "mongodb";
import { GaleConfig } from "../Config";
import { AgentConversationMessage, agentConversationMessageFromMongo } from "../model/AgentMessage";

export class ConversationStore {

    private conversationsCollection: string;
    private conversationMessagesCollection: string;

    constructor(private db: Db, private config: GaleConfig) {
        this.conversationsCollection = config.getCollections().conversations;
        this.conversationMessagesCollection = config.getCollections().conversationMessages;
    }

    /**
     * Stores a message in the conversation.
     * 
     * If no conversation exists with the provided conversationId (or none is provided),
     * a new conversation is created and its id is returned.
     * In either case the message is added to the conversationMessages collection.
     *
     * @param msg  The agent conversation message to store
     * @returns    The conversation ID (existing or newly created) and the message ID
     */
    async storeMessage(msg: AgentConversationMessage): Promise<{ conversationId: string, messageId: string }> {

        const { agentId, message, extras } = msg;
        const userEmail = extras?.subjectEmail ?? "unknown";
        let conversationId: string | undefined = msg.conversationId || undefined;

        const now = new Date().toISOString();

        // Check if conversation exists (or needs to be created)
        const existingConversation = conversationId
            ? await this.db.collection(this.conversationsCollection).findOne({ conversationId })
            : null;

        if (!existingConversation) {

            conversationId = (await this.db.collection(this.conversationsCollection).insertOne({
                agentId,
                userEmail,
                createdAt: now,
                updatedAt: now,
            })).insertedId.toString();
        }
        else {

            await this.db.collection(this.conversationsCollection).updateOne(
                { conversationId },
                { $set: { updatedAt: now, agentId } }
            );
        }

        const messageId = await this.db.collection(this.conversationMessagesCollection).insertOne({
            conversationId,
            role: 'user',
            content: message,
            userEmail,
            timestamp: now,
        });

        return { conversationId: conversationId!, messageId: messageId.insertedId.toString() };
    }

    /**
     * Retrieve all the messages of the given conversation 
     * 
     * @param conversationId 
     */
    async getConversationMessages(conversationId: string): Promise<AgentConversationMessage[]> {

        const messages = await this.db.collection(this.conversationMessagesCollection).find({ conversationId }).sort({ timestamp: 1 }).toArray();

        return messages.map(msg => {return agentConversationMessageFromMongo(msg)}); // Convert MongoDB documents to AgentConversationMessage

    }

    /**
     * Rerieve only the messages of the given conversation that are coming from the agent (i.e., messages with actor "agent")
     * 
     * @param conversationId 
     * @returns 
     */
    async getAgentMessages(conversationId: string): Promise<AgentConversationMessage[]> {

        const messages = await this.db.collection(this.conversationMessagesCollection).find({ conversationId, actor: 'agent' }).sort({ timestamp: 1 }).toArray();

        return messages.map(msg => {return agentConversationMessageFromMongo(msg)}); // Convert MongoDB documents to AgentConversationMessage
    }
}
