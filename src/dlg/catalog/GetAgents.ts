import { Request } from "express";
import { Logger, TotoDelegate, TotoRequest, TotoRuntimeError, UserContext, ValidationError } from "totoms";
import { AgentDefinition } from "../../model/AgentDefinition";
import { GaleConfig } from "../../Config";
import { AgentsCatalog } from "../../core/catalog/AgentsCatalog";

export class GetAgents extends TotoDelegate<GetAgentsRequest, GetAgentsResponse> {

    async do(req: GetAgentsRequest, userContext?: UserContext): Promise<GetAgentsResponse> {

        const config = this.config as GaleConfig;
        const logger = Logger.getInstance();
        const cid = this.cid;

        try {

            const db = await config.getMongoDb(config.getDBName());

            // Register the agent in the catalog
            const agents = await new AgentsCatalog(db, config).getAgents();

            return { agents }


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

    public parseRequest(req: Request): GetAgentsRequest {
        return {};
    }

}

interface GetAgentsRequest extends TotoRequest { }

interface GetAgentsResponse {
    agents: AgentDefinition[];
}
