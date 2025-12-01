import { ExecutionContext, Logger } from "toto-api-controller";
import { GaleMessage } from "../../bus/MessageBus";
import { TaskExecution } from "../../core/task/TaskExecution";
import { APINAME, galeConfig } from "../..";
import { generateTotoJWTToken } from "../../util/GenerateTotoJWTToken";
import { AgentTaskRequest } from "../../model/AgentTask";
import { DefaultAgentCallFactory } from "../../api/AgentCall";
import { AgenticFlowTracker } from "../../core/tracking/AgenticFlowTracker";
import { AgentsCatalog } from "../../core/catalog/AgentsCatalog";
import { AgentStatusTracker } from "../../core/tracking/AgentStatusTracker";

export class GaleMessageHandler {

    async onMessage(msg: GaleMessage): Promise<void> {

        const logger = new Logger(APINAME);

        logger.compute(msg.cid, `Handling Gale Message of type [${msg.type}]`, "info");

        // Create an execution context
        const execContext = new ExecutionContext(logger, APINAME, galeConfig, msg.cid);

        const client = await galeConfig.getMongoClient();
        const db = client.db(galeConfig.getDBName());

        // Get a token 
        const token = generateTotoJWTToken("gale-broker", galeConfig);

        switch (msg.type) {
            case 'task':
                // Trigger a task execution
                await new TaskExecution({
                    execContext,
                    agentCallFactory: new DefaultAgentCallFactory(execContext, token),
                    agenticFlowTracker: new AgenticFlowTracker(db, execContext, new AgentStatusTracker(db, execContext)),
                    agentsCatalog: new AgentsCatalog(db, execContext)
                }).do(AgentTaskRequest.fromHTTPRequest({ body: msg.payload }));
                break;
            default:
                logger.compute("", `Unknown event type [${msg.type}] received`);
        }

    }

}