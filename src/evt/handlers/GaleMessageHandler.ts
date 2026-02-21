import { Logger, ProcessingResponse, TotoMessage, TotoMessageHandler } from "totoms";
import { TaskExecution } from "../../core/task/TaskExecution";
import { AgentTaskRequest } from "../../model/AgentTask";
import { DefaultAgentCallFactory } from "../../api/AgentCall";
import { AgenticFlowTracker } from "../../core/tracking/AgenticFlowTracker";
import { AgentsCatalog } from "../../core/catalog/AgentsCatalog";
import { AgentStatusTracker } from "../../core/tracking/AgentStatusTracker";
import { GaleConfig } from "../../Config";
import { agentConversationMessageFromTotoMessage } from "../../model/AgentMessage";
import { Conversation } from "../../core/conversation/Conversation";

export class GaleMessageHandler extends TotoMessageHandler {

    protected handledMessageType: string = "task";

    /**
     * Handles these types of message: 
     * - Messages for task execution
     * - Messages for conversation message
     * 
     * @param msg 
     * @returns 
     */
    protected async onMessage(msg: TotoMessage): Promise<ProcessingResponse> {

        const logger = Logger.getInstance();
        const cid = this.cid || msg.cid || "";
        const config = this.config as GaleConfig;

        logger.compute(cid, `Handling Gale Message of type [${msg.type}]`, "info");

        const db = await config.getMongoDb(config.getDBName());

        try {

            if (msg.type === 'task') {

                const taskRequest = AgentTaskRequest.fromHTTPRequest({ body: msg.data });

                await new TaskExecution({
                    config,
                    logger,
                    cid,
                    messageBus: this.messageBus,
                    agentCallFactory: new DefaultAgentCallFactory(cid, config),
                    agenticFlowTracker: new AgenticFlowTracker(db, config, new AgentStatusTracker(db, config)),
                    agentsCatalog: new AgentsCatalog(db, config)
                }).do(taskRequest);

                return { status: "processed" };
            }
            else if (msg.type === 'agentMessagePosted') {

                const agentMessage = agentConversationMessageFromTotoMessage(msg);

                await new Conversation(config, this.messageBus, cid).processNewMessage(agentMessage);

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

export type SupportedMessageType = "task" | "agentMessagePosted";