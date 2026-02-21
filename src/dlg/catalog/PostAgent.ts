import { Request } from "express";
import { Logger, TotoDelegate, TotoRequest, TotoRuntimeError, UserContext, ValidationError } from "totoms";
import { AgentDefinition } from "../../model/AgentDefinition";
import { GaleConfig } from "../../Config";
import { AgentsCatalog } from "../../core/catalog/AgentsCatalog";

/**
 * Endpoint to register a new Agent Definition
 */
export class RegisterAgent extends TotoDelegate<RegisterAgentRequest, RegisterAgentResponse> {

    async do(req: RegisterAgentRequest, userContext?: UserContext): Promise<RegisterAgentResponse> {

        const config = this.config as GaleConfig;
        const logger = Logger.getInstance();
        const cid = this.cid;

        try {

                        const db = await config.getMongoDb(config.getDBName());

            // Register the agent in the catalog
            const insertedId = await new AgentsCatalog(db, config).registerAgent(req.agentDefinition);

            logger.compute(cid, `Agent [${req.agentDefinition.name}] registered with id [${insertedId}]`);

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

    }

    public parseRequest(req: Request): RegisterAgentRequest {
        const body = req.body;

        if (!body.agentDefinition) throw new ValidationError(400, "agentDefinition is required");

        return {
            agentDefinition: AgentDefinition.fromJSON(body.agentDefinition)
        };
    }

}

interface RegisterAgentRequest extends TotoRequest {
    agentDefinition: AgentDefinition;
}
interface RegisterAgentResponse {
    insertedId: string;
}
