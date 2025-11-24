import { Request } from "express";
import { ExecutionContext, TotoDelegate, TotoRuntimeError, UserContext, ValidationError } from "toto-api-controller";
import { AgentDefinition } from "../../model/AgentDefinition";
import { GaleConfig } from "../../Config";
import { AgentsCatalog } from "../../core/catalog/AgentsCatalog";

export class GetAgent implements TotoDelegate {

    async do(req: Request, userContext: UserContext, execContext: ExecutionContext): Promise<GetAgentResponse> {

        const config = execContext.config as GaleConfig;
        const logger = execContext.logger;
        const cid = execContext.cid;

        try {

            const client = await config.getMongoClient();
            const db = client.db(config.getDBName());

            // Register the agent in the catalog
            const agent = await new AgentsCatalog(db, execContext).getAgent(req.params.taskId);

            return { agent };


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

}

interface GetAgentResponse {
    agent: AgentDefinition;
}

