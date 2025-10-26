import http from "request";
import { AgentDefinition } from "../model/AgentDefinition";
import { ExecutionContext } from "toto-api-controller";
import { AgentTriggerReponse } from "../model/AgentTriggerReponse";
import { TaskInputData } from "../model/TaskInputData";

export class AgentCall {

    execContext: ExecutionContext;
    agentDefinition: AgentDefinition;
    bearerToken: string;

    constructor(agentDefinition: AgentDefinition, execContext: ExecutionContext, bearerToken: string) {

        this.agentDefinition = agentDefinition;
        this.execContext = execContext;
        this.bearerToken = bearerToken;

    }

    /**
     * Executes the agent with the given input.
     * @param agentInput any input data to provide to the agent. This is agent-specific.
     * @returns a promise that resolves to the agent trigger response.
     */
    async execute(agentInput: TaskInputData = {}): Promise<AgentTriggerReponse> {

        return new Promise<AgentTriggerReponse>((success, failure) => {

            http({
                uri: `${this.agentDefinition.endpoint.baseURL}${this.agentDefinition.endpoint.executionPath}`,
                method: 'POST',
                headers: {
                    'x-correlation-id': this.execContext.cid,
                    'Authorization': `Bearer ${this.bearerToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    input: agentInput
                })
            }, (err: any, resp: any, body: any) => {

                if (err) {
                    console.log(err)
                    failure(err);
                    return;
                }

                // Parse the output
                success(AgentTriggerReponse.fromHTTPResponse(body));

            })
        })

    }
}
