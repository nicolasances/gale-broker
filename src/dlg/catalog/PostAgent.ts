import { Request } from "express";
import { ExecutionContext, TotoDelegate, TotoRuntimeError, UserContext, ValidationError } from "toto-api-controller";
import { AgentDefinition } from "../../model/AgentDefinition";
import { ControllerConfig } from "../../Config";
import { AgentsCatalog } from "../../core/catalog/AgentsCatalog";

/**
 * Endpoint to register a new Agent Definition
 */
export class RegisterAgent implements TotoDelegate {

    async do(req: Request, userContext: UserContext, execContext: ExecutionContext): Promise<RegisterAgentResponse> {

        const config = execContext.config as ControllerConfig;
        const logger = execContext.logger;
        const cid = execContext.cid;

        let client;

        try {

            client = await config.getMongoClient();
            const db = client.db(config.getDBName());

            const registerAgentRequest = RegisterAgentRequest.fromRequest(req);

            // Register the agent in the catalog
            const insertedId = await new AgentsCatalog(db, execContext).registerAgent(registerAgentRequest.agentDefinition);

            logger.compute(cid, `Agent [${registerAgentRequest.agentDefinition.name}] registered with id [${insertedId}]`);

            return { insertedId }


        } catch (error) {

            logger.compute(cid, `${error}`, "error")

            if (error instanceof ValidationError || error instanceof TotoRuntimeError) {
                throw error;
            }
            else {
                console.log(error);
                throw error;
            }

        }
        finally {
            if (client) client.close();
        }

    }

}

class RegisterAgentRequest {

    agentDefinition: AgentDefinition;

    constructor(agentDefinition: AgentDefinition) {
        this.agentDefinition = agentDefinition;
    }

    /**
     * Creates a RegisterAgentRequest from an Express request.
     * @param req the Express request.
     * @returns a RegisterAgentRequest instance.
     */
    static fromRequest(req: Request): RegisterAgentRequest {
        const body = req.body;

        if (!body.agentDefinition) throw new ValidationError(400, "agentDefinition is required");

        return new RegisterAgentRequest(AgentDefinition.fromJSON(body.agentDefinition));
    }
}
interface RegisterAgentResponse {
    insertedId: string;
}
