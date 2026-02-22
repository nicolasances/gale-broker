import http from "request";
import { Logger } from "totoms";
import { AgentDefinition } from "../model/AgentDefinition";
import { AgentTaskRequest, AgentTaskResponse } from "../model/AgentTask";
import { AgentConversationMessage } from "../model/AgentMessage";
import { GaleConfig } from "../Config";
import { generateTotoJWTToken } from "../util/GenerateTotoJWTToken";

export interface AgentCallFactory {
    createAgentCall(agentDefinition: AgentDefinition): AgentCall;
}

export class DefaultAgentCallFactory implements AgentCallFactory {

    private bearerToken: string;

    constructor(private cid: string, private config: GaleConfig, bearerToken?: string) {

        if (!bearerToken) this.bearerToken = generateTotoJWTToken("gale-broker", config);
        else this.bearerToken = bearerToken;

    }

    createAgentCall(agentDefinition: AgentDefinition): AgentCall {
        return new AgentCall(agentDefinition, Logger.getInstance(), this.cid, this.bearerToken);
    }
}

export class AgentCall {

    logger: Logger;
    cid: string;
    agentDefinition: AgentDefinition;
    bearerToken: string;

    constructor(agentDefinition: AgentDefinition, logger: Logger, cid: string, bearerToken: string) {

        this.agentDefinition = agentDefinition;
        this.logger = logger;
        this.cid = cid;
        this.bearerToken = bearerToken;

    }

    /**
     * Sends a message to the Agent
     * 
     * @param msg 
     * @returns 
     */
    async sendMessage(msg: AgentConversationMessage): Promise<AgentTaskResponse> {

        this.logger.compute(this.cid, `Calling Agent [${this.agentDefinition.name}] at [${this.agentDefinition.endpoint.baseURL}${this.agentDefinition.endpoint.messagesPath}]`);

        return new Promise<AgentTaskResponse>((success, failure) => {

            http({
                uri: `${this.agentDefinition.endpoint.baseURL}${this.agentDefinition.endpoint.messagesPath}`,
                method: 'POST',
                headers: {
                    'x-correlation-id': this.cid,
                    'Authorization': `Bearer ${this.bearerToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(msg)
            }, (err: any, resp: any, body: any) => {

                if (err) {
                    console.log(err)
                    failure(err);
                    return;
                }

                if (resp.statusCode != 200) {
                    success(new AgentTaskResponse({
                        correlationId: msg.conversationId,
                        stopReason: "failed",
                        taskOutput: { error: `Agent responded with status code ${resp.statusCode}: ${body}` },
                    }));
                }

                // Parse the output
                try {
                    const agentResponse = AgentTaskResponse.fromHTTPResponse(body);
                    success(agentResponse);
                }
                catch (error) {
                    failure(error);
                }


            })
        })

    }

    /**
     * Executes the agent with the given input.
     * @param agentInput any input data to provide to the agent. This is agent-specific.
     * @returns a promise that resolves to the agent trigger response.
     */
    async sendTask(task: AgentTaskRequest, correlationId: string): Promise<AgentTaskResponse> {

        this.logger.compute(this.cid, `Calling Agent [${this.agentDefinition.name}] at [${this.agentDefinition.endpoint.baseURL}${this.agentDefinition.endpoint.executionPath}]`);

        return new Promise<AgentTaskResponse>((success, failure) => {

            http({
                uri: `${this.agentDefinition.endpoint.baseURL}${this.agentDefinition.endpoint.executionPath}`,
                method: 'POST',
                headers: {
                    'x-correlation-id': this.cid,
                    'Authorization': this.bearerToken ? `Bearer ${this.bearerToken}` : null,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ...task, correlationId })
            }, (err: any, resp: any, body: any) => {

                if (err) {
                    console.log(err)
                    failure(err);
                    return;
                }

                if (resp.statusCode != 200) {
                    success(new AgentTaskResponse({
                        correlationId: task.correlationId!,
                        stopReason: "failed",
                        taskOutput: { error: `Agent responded with status code ${resp.statusCode}: ${body}` },
                    }));
                }

                // Parse the output
                try {
                    const agentResponse = AgentTaskResponse.fromHTTPResponse(body);
                    success(agentResponse);
                }
                catch (error) {
                    failure(error);
                }


            })
        })

    }
}
