import { Request } from "express";
import { ExecutionContext, TotoDelegate, TotoRuntimeError, UserContext, ValidationError } from "toto-api-controller";
import { AgentDefinition } from "../../model/AgentDefinition";
import { GaleConfig } from "../../Config";
import { AgentsCatalog } from "../../core/catalog/AgentsCatalog";

export class DeleteAgent implements TotoDelegate {

    async do(req: Request, userContext: UserContext, execContext: ExecutionContext): Promise<DeleteAgentResponse> {

        const config = execContext.config as GaleConfig;
        const logger = execContext.logger;
        const cid = execContext.cid;

        const taskId = req.params.taskId;

        try {

            const client = await config.getMongoClient();
            const db = client.db(config.getDBName());

            // Register the agent in the catalog
            const deletedCount = await new AgentsCatalog(db, execContext).deleteAgentsWithTaskId(taskId);

            return { deletedCount }


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

interface DeleteAgentResponse {
    deletedCount: number;
}
