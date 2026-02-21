import { Request } from "express";
import { MessageDestination, TotoDelegate, TotoMessage, UserContext, ValidationError } from "totoms";
import { GaleConfig } from "../../Config";
import { ConversationStore } from "../../store/ConversationStore";
import { v4 as uuid } from "uuid";

export class PostConversationMessage extends TotoDelegate<PostConversationMessageRequest, PostConversationMessageResponse> {

    async do(req: PostConversationMessageRequest, userContext?: UserContext): Promise<PostConversationMessageResponse> {

        const db = await this.config.getMongoDb((this.config as GaleConfig).getDBName());
        const conversationStore = new ConversationStore(db, this.config as GaleConfig);

        let conversationId = req.conversationId || uuid();

        // 1. Create a conversation if needed 
        if (!req.conversationId) conversationStore.createConversation(conversationId, req.agentId, req.message, userContext?.email);

        // 2. Otherwise add the message to the conversation
        if (req.conversationId) conversationStore.addMessageToConversation(req.conversationId, req.agentId, req.message, userContext?.email);

        // 3. Trigger the processing of the message by the agents subscribed to the conversation and return the answer if it's processed synchronously
        const msg: TotoMessage = {
            type: "userMessagePosted",
            cid: this.cid || uuid(),
            id: conversationId,
            msg: `New message posted to conversation ${conversationId} for agent ${req.agentId}`,
            timestamp: new Date().toISOString(),
            data: {
                conversationId,
                agentId: req.agentId,
                message: req.message,
                userEmail: userContext?.email
            }
        }

        await this.messageBus.publishMessage(new MessageDestination({ topic: "galeagents" }), msg);

        return { conversationId };

    }

    parseRequest(req: Request): PostConversationMessageRequest {

        const conversationId = req.params.conversationId;
        const message = req.body.message;
        const agentId = req.body.agentId;

        if (!agentId) throw new ValidationError(400, "agentId is required in the request body");
        if (!message) throw new ValidationError(400, "message is required in the request body");

        return {
            agentId,
            conversationId,
            message
        };

    }



}

interface PostConversationMessageRequest {
    agentId: string;            // ID of the agent to which the message should be posted
    conversationId?: string;    // ID of the conversation to which the message should be posted. If not provided, a new conversation will be created.
    message: string;            // The message to post to the conversation
}

interface PostConversationMessageResponse {
    conversationId: string; // ID of the conversation to which the message was posted (useful if the conversationId was not provided in the request and a new conversation was created)
    answer?: string;        // Optional answer if the message was processed synchronously
}