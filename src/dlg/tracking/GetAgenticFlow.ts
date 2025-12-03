
import { Request } from "express";
import { ExecutionContext, TotoDelegate, UserContext } from "toto-api-controller";
import { GaleConfig } from "../../Config";

/**
 * This endpoint retrieves an AgenticFlow by its correlation ID.
 * 
 * The flow is returned as stored in the database, without the prev references
 * to avoid circular references in the response.
 */
export class GetAgenticFlow implements TotoDelegate {

    async do(req: Request, userContext: UserContext, execContext: ExecutionContext): Promise<GetAgenticFlowResponse> {

        const config = execContext.config as GaleConfig;

        const client = await config.getMongoClient();
        const db = client.db(config.getDBName());

        const correlationId = req.params.correlationId;

        // Retrieve the flow from the database
        // The flow is stored without prev references (see AgenticFlow.toBSON())
        const flowsCollection = db.collection(config.getCollections().flows);
        const flow = await flowsCollection.findOne({ correlationId });

        return { flow }

    }
}

export interface GetAgenticFlowResponse {

    flow: any | null;

}
