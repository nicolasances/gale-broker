import { Request } from "express";
import { Logger, TotoDelegate, TotoRequest, TotoRuntimeError, UserContext, ValidationError } from "totoms";
import { AgentDefinition } from "../../model/AgentDefinition";
import { GaleConfig } from "../../Config";
import { AgentsCatalog } from "../../core/catalog/AgentsCatalog";

export class GetAgent extends TotoDelegate<GetAgentRequest, GetAgentResponse> {

    async do(req: GetAgentRequest, userContext?: UserContext): Promise<GetAgentResponse> {

        const config = this.config as GaleConfig;
        const logger = Logger.getInstance();
        const cid = this.cid;

        try {

                        const db = await config.getMongoDb(config.getDBName());

            // Register the agent in the catalog
            const agent = await new AgentsCatalog(db, config).getAgent(req.taskId);

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

    public parseRequest(req: Request): GetAgentRequest {
        const taskId = req.params.taskId;
        if (!taskId) throw new ValidationError(400, "taskId is required");

        return { taskId };
    }

}

interface GetAgentRequest extends TotoRequest {
    taskId: string;
}

interface GetAgentResponse {
    agent: AgentDefinition;
}

