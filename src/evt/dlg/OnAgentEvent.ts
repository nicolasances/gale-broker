import { Request } from "express";
import { ExecutionContext, TotoDelegate, UserContext } from "toto-api-controller";
import { GaleConfig } from "../../Config";
import { TaskExecution } from "../../core/task/TaskExecution";
import { extractAuthHeader, extractBearerToken } from "../../util/HeaderUtils";

/**
 * Endpoint to receive Agent-related events.
 * 
 * These events are for example: 
 * - A request to execute a task
 */
export class OnAgentEvent implements TotoDelegate {

    async do(req: Request, userContext: UserContext, execContext: ExecutionContext): Promise<any> {

        console.log("-------------------------------------------------------------------");
        console.log("AUTH HEADER:");
        console.log(extractAuthHeader(req));
        console.log("-------------------------------------------------------------------");
        

        const logger = execContext.logger;
        const messageBus = (execContext.config as GaleConfig).messageBus;

        // 1. Based on the message bus being used, decode the message appropriately.
        const decodedMessage = messageBus.decodeMessage(req.body);

        logger.compute("", `Received Agent Event with body [${JSON.stringify(decodedMessage)}]`, "info");

        // 2. Check the type of message and process accordingly.
        switch (decodedMessage.type) {
            case 'task':
                // Trigger a task execution
                await new TaskExecution(execContext).startTask(decodedMessage.payload);
                break;
            default:
                logger.compute("", `Unknown event type [${decodedMessage.type}] received`);
        }

        return { processed: true }

    }

}