import { Db, ObjectId } from "mongodb";
import { GaleConfig } from "../Config";
import { AgentConversationMessage, agentConversationMessageFromMongo } from "../model/AgentMessage";

export interface ConversationReasoning {
    conversationId: string;
    messageId: string;
    agentId: string;
    chainOfThought: any[];
    timestamp: string;
}

export class ConversationStore {

    private conversationsCollection: string;
    private conversationMessagesCollection: string;
    private conversationReasoningCollection: string;

    constructor(private db: Db, private config: GaleConfig) {
        this.conversationsCollection = config.getCollections().conversations;
        this.conversationMessagesCollection = config.getCollections().conversationMessages;
        this.conversationReasoningCollection = config.getCollections().conversationReasoning;
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
            ? await this.db.collection(this.conversationsCollection).findOne({ _id: new ObjectId(conversationId) })
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
                { _id: new ObjectId(conversationId) },
                { $set: { updatedAt: now, agentId } }
            );
        }

        msg.conversationId = conversationId;

        // Extract chainOfThought from agent messages before storing in conversationMessages
        const { chainOfThought, ...msgWithoutChainOfThought } = msg;

        const messageId = await this.db.collection(this.conversationMessagesCollection).insertOne({
            ...msgWithoutChainOfThought,
            timestamp: now
        });

        const insertedMessageId = messageId.insertedId.toString();

        // If this is an agent message with chainOfThought data, store it in the reasoning collection
        if (msg.actor === "agent" && chainOfThought && chainOfThought.length > 0) {
            await this.db.collection(this.conversationReasoningCollection).insertOne({
                conversationId: conversationId!,
                messageId: insertedMessageId,
                agentId: msg.agentId,
                chainOfThought,
                timestamp: now
            });
        }

        return { conversationId: conversationId!, messageId: insertedMessageId };
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

    /**
     * Retrieve all chain-of-thought reasoning data for the given conversation.
     * 
     * @param conversationId 
     * @returns 
     */
    async getConversationReasoning(conversationId: string): Promise<ConversationReasoning[]> {

        const docs = await this.db.collection(this.conversationReasoningCollection).find({ conversationId }).sort({ timestamp: 1 }).toArray();

        return docs.map(doc => ({
            conversationId: doc.conversationId,
            messageId: doc.messageId,
            agentId: doc.agentId,
            chainOfThought: doc.chainOfThought,
            timestamp: doc.timestamp
        }));
    }
}
