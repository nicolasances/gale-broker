import { Logger, ProcessingResponse, TotoMessage, TotoMessageHandler } from "totoms";
import { TaskExecution } from "../../core/task/TaskExecution";
import { generateTotoJWTToken } from "../../util/GenerateTotoJWTToken";
import { AgentTaskRequest } from "../../model/AgentTask";
import { DefaultAgentCallFactory } from "../../api/AgentCall";
import { AgenticFlowTracker } from "../../core/tracking/AgenticFlowTracker";
import { AgentsCatalog } from "../../core/catalog/AgentsCatalog";
import { AgentStatusTracker } from "../../core/tracking/AgentStatusTracker";
import { GaleConfig } from "../../Config";

export class GaleMessageHandler extends TotoMessageHandler {

    protected handledMessageType: string = "task";

    protected async onMessage(msg: TotoMessage): Promise<ProcessingResponse> {

        const logger = Logger.getInstance();
        const cid = this.cid || msg.cid || "";
        const config = this.config as GaleConfig;

        logger.compute(cid, `Handling Gale Message of type [${msg.type}]`, "info");

        const db = await config.getMongoDb(config.getDBName());

        // Get a token 
        const token = generateTotoJWTToken("gale-broker", config);

        try {

            if (msg.type === 'task') {

                const taskRequest = AgentTaskRequest.fromHTTPRequest({ body: msg.data });

                await new TaskExecution({
                    config,
                    logger,
                    cid,
                    messageBus: this.messageBus,
                    agentCallFactory: new DefaultAgentCallFactory(logger, cid, token),
                    agenticFlowTracker: new AgenticFlowTracker(db, config, new AgentStatusTracker(db, config)),
                    agentsCatalog: new AgentsCatalog(db, config)
                }).do(taskRequest);

                return { status: "processed" };
            }

            logger.compute(cid, `Unknown event type [${msg.type}] received`);
            return { status: "ignored", responsePayload: `Unknown event type ${msg.type}` };

        } catch (error) {
            logger.compute(cid, `${error}`, "error");
            return { status: "failed", responsePayload: error };
        }

    }

}