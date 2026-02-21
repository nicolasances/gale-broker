import { Request } from "express";
import { Logger, TotoDelegate, TotoRequest, TotoRuntimeError, UserContext, ValidationError } from "totoms";
import { GaleConfig } from "../../Config";
import { AgentsCatalog } from "../../core/catalog/AgentsCatalog";

export class DeleteAgent extends TotoDelegate<DeleteAgentRequest, DeleteAgentResponse> {

    async do(req: DeleteAgentRequest, userContext?: UserContext): Promise<DeleteAgentResponse> {

        const config = this.config as GaleConfig;
        const logger = Logger.getInstance();
        const cid = this.cid;

        const taskId = req.taskId;

        try {

                        const db = await config.getMongoDb(config.getDBName());

            // Register the agent in the catalog
            const deletedCount = await new AgentsCatalog(db, this.config as GaleConfig).deleteAgentsWithTaskId(taskId);

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

    public parseRequest(req: Request): DeleteAgentRequest {
        const taskId = req.params.taskId;
        if (!taskId) throw new ValidationError(400, "taskId is required");

        return { taskId };
    }

}

interface DeleteAgentRequest extends TotoRequest {
    taskId: string;
}

interface DeleteAgentResponse {
    deletedCount: number;
}
