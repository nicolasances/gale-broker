import { Request } from "express";
import { Logger, TotoDelegate, UserContext } from "totoms";
import { Readable } from "stream";
import { ConversationStore } from "../store/ConversationStore";
import { GaleConfig } from "../Config";
import { log } from "console";

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
        const MAX_STREAM_DURATION_MS = 10 * 60 * 1000;
        let interval: NodeJS.Timeout;

        let closed = false;

        const send = (event: string, data: unknown) => {
            stream.push(`event: ${event}\n`);
            stream.push(`data: ${JSON.stringify(data)}\n\n`);
        };

        const hardStopTimeout = setTimeout(() => {

            if (closed) { return; }

            logger.compute(this.cid, `Stream timeout reached for conversation ${req.conversationId}. Closing stream after 10 minutes.`);

            send("done", { message: "Stream timeout reached (10 minutes)" });

            stream.push(null);

        }, MAX_STREAM_DURATION_MS);

        stream.on("close", () => {
            closed = true;
            clearTimeout(hardStopTimeout);
            if (interval) clearTimeout(interval);
        });

        let lastMessageIndexRead = -1;

        const checkForNewMessages = async () => {

            if (closed) { clearTimeout(interval); return; }

            logger.compute(this.cid, `Checking for new messages in conversation ${req.conversationId}...`);

            // Read the conversation from the DB
            try {

                const messages = await new ConversationStore(db, config).getAgentMessages(req.conversationId)

                // Send the latest, unread message as an event
                // Pick only one message: the last one that has not been sent yet
                if (lastMessageIndexRead < messages.length - 1) {

                    // Send the last message
                    // POTENTIAL TODO: maybe the best would be to send all the messages that have not been sent yet and let the consumer decide if to only take the last one... 
                    const messageToSend = messages[messages.length - 1];

                    logger.compute(this.cid, `Sending message ${messageToSend.messageId} of conversation ${req.conversationId} to client...`);

                    send("message", { message: messageToSend.message });

                    // Update the index
                    lastMessageIndexRead = messages.length;

                    // Check if the message is the last of a stream 
                    if (messageToSend.stream?.last) {

                        logger.compute(this.cid, `Stream complete for conversation ${req.conversationId}`);

                        send("done", { message: "Stream complete", totalMessages: messages.length });

                        stream.push(null);

                        clearTimeout(hardStopTimeout);
                        clearTimeout(interval);

                        return;

                    }
                }

                interval = setTimeout(checkForNewMessages, INTERVAL_MS);

            } catch (error) {

                logger.compute(this.cid, `Error while checking for new messages in conversation ${req.conversationId}: ${error}`);
                log(error);

                // Close the stream: something is not working
                send("done", { message: `Error occurred while checking for new messages: ${error}` });
                stream.push(null);
                clearTimeout(hardStopTimeout);
                clearTimeout(interval);

            }

        }

        // Start checking for new messages
        interval = setTimeout(checkForNewMessages, INTERVAL_MS);

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