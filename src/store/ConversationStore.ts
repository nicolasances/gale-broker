import { Db } from "mongodb";
import { GaleConfig } from "../Config";
import { v4 as uuid } from "uuid";

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
     * @param agentId         ID of the agent this conversation is directed to
     * @param message         The user message content
     * @param userEmail       Email of the user who sent the message
     * @param conversationId  Optional existing conversation ID
     * @returns               The conversation ID (existing or newly created)
     */
    async storeMessage(agentId: string, message: string, userEmail: string, conversationId?: string): Promise<{ conversationId: string, messageId: string }> {

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

}