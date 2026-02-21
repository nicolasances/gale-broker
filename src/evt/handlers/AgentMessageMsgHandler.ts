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

export class AgentMessageMsgHandler extends TotoMessageHandler {

    protected handledMessageType: string = "agentMessagePosted";

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

        try {

            const agentMessage = agentConversationMessageFromTotoMessage(msg);

            await new Conversation(config, this.messageBus, cid).sendMessageToAgent(agentMessage);

            return { status: "processed" };

        } catch (error) {
            logger.compute(cid, `${error}`, "error");
            return { status: "failed", responsePayload: error };
        }

    }

}
