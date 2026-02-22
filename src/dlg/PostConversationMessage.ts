import { Request } from "express";
import { TotoDelegate, UserContext, ValidationError } from "totoms";
import { GaleConfig } from "../Config";
import { v4 as uuid } from "uuid";
import { Conversation } from "../core/conversation/Conversation";

/**
 * Delegate for a client to post a new message to a conversation with an Agent. 
 * 
 * If the conversationId is not provided, a new conversation will be created.
 */
export class PostConversationMessage extends TotoDelegate<PostConversationMessageRequest, PostConversationMessageResponse> {

    async do(req: PostConversationMessageRequest, userContext?: UserContext): Promise<PostConversationMessageResponse> {

        const config = this.config as GaleConfig;

        const { conversationId, messageId } = await new Conversation(config, this.messageBus, this.cid || uuid()).processNewMessage({
            conversationId: req.conversationId,
            messageId: uuid(),
            agentId: req.agentId,
            actor: req.actor,
            message: req.message,
            extras: {
                subjectEmail: userContext?.email || undefined
            }, 
        })

        return { conversationId, messageId }

    }

    parseRequest(req: Request): PostConversationMessageRequest {

        const conversationId = req.body.conversationId;
        const message = req.body.message;
        const agentId = req.body.agentId;
        const actor = req.body.actor;

        if (!agentId) throw new ValidationError(400, "agentId is required in the request body");
        if (!message) throw new ValidationError(400, "message is required in the request body");
        if (!actor) throw new ValidationError(400, "actor is required in the request body");
        if (actor !== "user" && actor !== "agent") throw new ValidationError(400, "actor must be either 'user' or 'agent'");

        return {
            agentId,
            conversationId,
            message, 
            actor
        };

    }



}

interface PostConversationMessageRequest {
    agentId: string;            // ID of the agent to which the message should be posted
    conversationId?: string;    // ID of the conversation to which the message should be posted. If not provided, a new conversation will be created.
    message: string;            // The message to post to the conversation
    actor: "user" | "agent";    // The actor posting the message (either "user" or "agent")
}

interface PostConversationMessageResponse {
    conversationId: string; // ID of the conversation to which the message was posted (useful if the conversationId was not provided in the request and a new conversation was created)
    messageId: string;      // ID of the message that was posted to the conversation
    answer?: string;        // Optional answer if the message was processed synchronously
}