import { Request } from "express";
import { ExecutionContext, TotoDelegate, UserContext, ValidationError } from "toto-api-controller";
import { GaleConfig } from "../../Config";
import { GaleMessage } from "../../bus/MessageBus";
import { GaleMessageHandler } from "../handlers/GaleMessageHandler";

/**
 * Endpoint to receive Agent-related events.
 * 
 * These events are for example: 
 * - A request to execute a task
 */
export class OnAgentEvent implements TotoDelegate {

    async do(req: Request, userContext: UserContext, execContext: ExecutionContext): Promise<any> {

        const messageBus = (execContext.config as GaleConfig).messageBus;

        // 1. Based on the message bus being used, decode the message appropriately.
        const decodedMessage: GaleMessage = messageBus.decodeMessage(req.body);

        // 2. Call the Gale Message handler
        await new GaleMessageHandler().onMessage(decodedMessage);

        return { processed: true };

    }

}