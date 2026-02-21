import { Request } from "express";
import { Logger, TotoDelegate, TotoRequest, TotoRuntimeError, UserContext, ValidationError } from "totoms";
import { AgentDefinition } from "../../model/AgentDefinition";
import { GaleConfig } from "../../Config";
import { AgentsCatalog } from "../../core/catalog/AgentsCatalog";

/**
 * Endpoint to register a new Agent Definition
 */
export class UpdateAgent extends TotoDelegate<UpdateAgentRequest, UpdateAgentResponse> {

    async do(req: UpdateAgentRequest, userContext?: UserContext): Promise<UpdateAgentResponse> {

        const config = this.config as GaleConfig;
        const logger = Logger.getInstance();
        const cid = this.cid;

        try {

                        const db = await config.getMongoDb(config.getDBName());

            logger.compute(cid, `Updating Agent [${req.agentDefinition.name}] in catalog. Agent Task Endpoint: [${req.agentDefinition.endpoint?.baseURL}${req.agentDefinition.endpoint?.executionPath}]`);

            // Register the agent in the catalog
            const modifiedCount = await new AgentsCatalog(db, config).updateAgent(req.agentDefinition);

            logger.compute(cid, `Agent [${req.agentDefinition.name}] registration updated. Modified count: [${modifiedCount}]`);

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

    }

    public parseRequest(req: Request): UpdateAgentRequest {
        const body = req.body;

        if (!body.agentDefinition) throw new ValidationError(400, "agentDefinition is required");

        return {
            agentDefinition: AgentDefinition.fromJSON(body.agentDefinition)
        };
    }

}

interface UpdateAgentRequest extends TotoRequest {
    agentDefinition: AgentDefinition;
}
interface UpdateAgentResponse {
}
