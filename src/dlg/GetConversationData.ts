import { Request } from "express";
import { TotoDelegate, TotoRequest, UserContext, ValidationError } from "totoms";
import { GaleConfig } from "../Config";
import { ConversationStore, ConversationReasoning } from "../store/ConversationStore";
import { AgentConversationMessage } from "../model/AgentMessage";

/**
 * Delegate to retrieve the full data of a conversation: messages and associated chain-of-thought reasoning.
 */
export class GetConversationData extends TotoDelegate<GetConversationDataRequest, GetConversationDataResponse> {

    async do(req: GetConversationDataRequest, userContext?: UserContext): Promise<GetConversationDataResponse> {

        const config = this.config as GaleConfig;
        const db = await config.getMongoDb(config.getDBName());
        const store = new ConversationStore(db, config);

        const messages = await store.getConversationMessages(req.conversationId);
        const reasoning = await store.getConversationReasoning(req.conversationId);

        return {
            conversationId: req.conversationId,
            messages,
            reasoning
        };
    }

    parseRequest(req: Request): GetConversationDataRequest {
        const conversationId = req.params.conversationId;
        if (!conversationId) throw new ValidationError(400, "conversationId is required");

        return { conversationId };
    }

}

interface GetConversationDataRequest extends TotoRequest {
    conversationId: string;
}

export interface GetConversationDataResponse {
    conversationId: string;
    messages: AgentConversationMessage[];
    reasoning: ConversationReasoning[];
}
