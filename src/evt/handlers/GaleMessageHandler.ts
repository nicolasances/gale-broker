import { ExecutionContext, Logger } from "toto-api-controller";
import { GaleMessage } from "../../bus/MessageBus";
import { TaskExecution } from "../../core/task/TaskExecution";
import { APINAME, galeConfig } from "../..";
import { generateTotoJWTToken } from "../../util/GenerateTotoJWTToken";
import { AgentTaskRequest } from "../../model/AgentTask";

export class GaleMessageHandler {

    async onMessage(msg: GaleMessage): Promise<void> {

        const logger = new Logger(APINAME);

        logger.compute(msg.cid, `Handling Gale Message of type [${msg.type}]`, "info");

        // Create an execution context
        const execContext = new ExecutionContext(logger, APINAME, galeConfig, msg.cid);

        // Get a token 
        const token = generateTotoJWTToken("gale-broker", galeConfig);

        switch (msg.type) {
            case 'task':
                // Trigger a task execution
                await new TaskExecution(execContext, token).do(AgentTaskRequest.fromHTTPRequest({ body: msg.payload }));
                break;
            default:
                logger.compute("", `Unknown event type [${msg.type}] received`);
        }

    }

}