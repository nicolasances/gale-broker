import { Request } from "express";
import { ExecutionContext, TotoDelegate, TotoRuntimeError, UserContext, ValidationError } from "toto-api-controller";
import { AgentDefinition } from "../../model/AgentDefinition";
import { ControllerConfig } from "../../Config";
import { AgentsCatalog } from "../../core/catalog/AgentsCatalog";

/**
 * Endpoint to register a new Agent Definition
 */
export class UpdateAgent implements TotoDelegate {

    async do(req: Request, userContext: UserContext, execContext: ExecutionContext): Promise<UpdateAgentResponse> {

        const config = execContext.config as ControllerConfig;
        const logger = execContext.logger;
        const cid = execContext.cid;

        let client;

        try {

            client = await config.getMongoClient();
            const db = client.db(config.getDBName());

            const updateAgentRequest = UpdateAgentRequest.fromRequest(req);

            logger.compute(cid, `Updating Agent [${updateAgentRequest.agentDefinition.name}] in catalog.`);
            logger.compute(cid, `Updating Agent [${updateAgentRequest.agentDefinition.name}] in catalog. Caller is [${req.headers.origin || req.headers.referer || req.headers['x-forwarded-for'] || req.connection.remoteAddress}]`);

            // Register the agent in the catalog
            const modifiedCount = await new AgentsCatalog(db, execContext).updateAgent(updateAgentRequest.agentDefinition);

            logger.compute(cid, `Agent [${updateAgentRequest.agentDefinition.name}] registration updated. Modified count: [${modifiedCount}]`);

            return { modifiedCount }


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

class UpdateAgentRequest {

    agentDefinition: AgentDefinition;

    constructor(agentDefinition: AgentDefinition) {
        this.agentDefinition = agentDefinition;
    }

    /**
     * Creates a RegisterAgentRequest from an Express request.
     * @param req the Express request.
     * @returns a UpdateAgentRequest instance.
     */
    static fromRequest(req: Request): UpdateAgentRequest {
        const body = req.body;

        if (!body.agentDefinition) throw new ValidationError(400, "agentDefinition is required");

        return new UpdateAgentRequest(AgentDefinition.fromJSON(body.agentDefinition));
    }
}
interface UpdateAgentResponse {
}
