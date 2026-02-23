import { Request } from "express";
import { Logger, TotoDelegate, UserContext } from "totoms";
import { Readable } from "stream";
import { ConversationStore } from "../store/ConversationStore";
import { GaleConfig } from "../Config";

/**
 * This delegate allows a client to subscribe to a conversation stream, where it can receive messages sent by the agent in real-time as they are generated.
 */
export class ConversationMessagesStream extends TotoDelegate<ConversationStatusStreamRequest, ConversationStatusStreamResponse> {

    protected async do(req: ConversationStatusStreamRequest, userContext?: UserContext): Promise<ConversationStatusStreamResponse> {

        const config = this.config as GaleConfig;
        const logger = Logger.getInstance();
        const db = await config.getMongoDb(config.getDBName());
        const stream = new Readable({ read() { } });
        const INTERVAL_MS = 2000;

        let closed = false;

        const send = (event: string, data: unknown) => {
            stream.push(`event: ${event}\n`);
            stream.push(`data: ${JSON.stringify(data)}\n\n`);
        };

        stream.on("close", () => { closed = true; });

        let lastMessageIndexRead = 0;

        const interval = setInterval(async () => {

            if (closed) { clearInterval(interval); return; }

            logger.compute(this.cid, `Checking for new messages in conversation ${req.conversationId}...`);

            // Read the conversation from the DB
            const messages = await new ConversationStore(db, config).getAgentMessages(req.conversationId)

            // Send the latest, unread message as an event
            // Pick only one message: the last one that has not been sent yet
            if (lastMessageIndexRead < messages.length - 1) {

                // Send the last message
                const messageToSend = messages[messages.length - 1];

                logger.compute(this.cid, `Sending message ${messageToSend.messageId} of conversation ${req.conversationId} to client...`);

                send("message", { message: JSON.stringify(messageToSend.message) });

                // Update the index
                lastMessageIndexRead = messages.length;

                // Check if the message is the last of a stream 
                if (messageToSend.stream?.last) {
                    
                    logger.compute(this.cid, `Stream complete for conversation ${req.conversationId}`);

                    send("done", { message: "Stream complete", totalMessages: messages.length });
                    
                    stream.push(null);
                    
                    clearInterval(interval);

                }
            }

        }, INTERVAL_MS);

        return stream;
    }

    parseRequest(req: Request): ConversationStatusStreamRequest {

        return {
            conversationId: req.params.conversationId
        }
    }

}

interface ConversationStatusStreamRequest {
    conversationId: string;
}
interface ConversationStatusStreamResponse { }