
import { Request } from "express";
import { Logger, TotoDelegate, TotoRequest, TotoRuntimeError, UserContext, ValidationError } from "totoms";
import { GaleConfig } from "../../Config";

/**
 * This endpoint retrieves an AgenticFlow by its correlation ID.
 * 
 * The flow is returned as stored in the database, without the prev references
 * to avoid circular references in the response.
 */
export class GetAgenticFlow extends TotoDelegate<GetAgenticFlowRequest, GetAgenticFlowResponse> {

    async do(req: GetAgenticFlowRequest, userContext?: UserContext): Promise<GetAgenticFlowResponse> {

        const config = this.config as GaleConfig;
        const logger = Logger.getInstance();
        const cid = this.cid;

        try {

                        const db = await config.getMongoDb(config.getDBName());

            const correlationId = req.correlationId;

            // Retrieve the flow from the database
            // The flow is stored without prev references (see AgenticFlow.toBSON())
            const flowsCollection = db.collection(config.getCollections().flows);
            
            const flow = await flowsCollection.findOne({ correlationId });

            return { flow };

        } catch (error) {

            logger.compute(cid, `${error}`, "error");

            if (error instanceof ValidationError || error instanceof TotoRuntimeError) {
                throw error;
            }
            else {
                console.log(error);
                throw error;
            }

        }

    }
    public parseRequest(req: Request): GetAgenticFlowRequest {
        const correlationId = req.params.correlationId;

        if (!correlationId) {
            throw new ValidationError(400, "Missing correlationId parameter");
        }

        return { correlationId };
    }

}

interface GetAgenticFlowRequest extends TotoRequest {
    correlationId: string;
}

export interface GetAgenticFlowResponse {

    flow: any | null;

}
