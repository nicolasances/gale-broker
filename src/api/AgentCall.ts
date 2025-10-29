import http from "request";
import { AgentDefinition } from "../model/AgentDefinition";
import { ExecutionContext } from "toto-api-controller";
import { AgentTaskRequest, AgentTaskResponse } from "../model/AgentTask";

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
    async execute(task: AgentTaskRequest): Promise<AgentTaskResponse> {

        this.execContext.logger.compute(this.execContext.cid, `Calling Agent [${this.agentDefinition.name}] at [${this.agentDefinition.endpoint.baseURL}${this.agentDefinition.endpoint.executionPath}]`);

        return new Promise<AgentTaskResponse>((success, failure) => {

            http({
                uri: `${this.agentDefinition.endpoint.baseURL}${this.agentDefinition.endpoint.executionPath}`,
                method: 'POST',
                headers: {
                    'x-correlation-id': this.execContext.cid,
                    'Authorization': `Bearer ${this.bearerToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(task)
            }, (err: any, resp: any, body: any) => {


                if (err) {
                    console.log(err)
                    failure(err);
                    return;
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
