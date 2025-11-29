
import { Request } from "express";
import { ExecutionContext, TotoDelegate, TotoRuntimeError, UserContext, ValidationError } from "toto-api-controller";
import { TaskExecutionGraph } from "../../util/TaskExecutionGraph";
import { GaleConfig } from "../../Config";
import { AgentStatusTracker } from "../../core/tracking/AgentStatusTracker";

/**
 * This endpoint retrieves all the Tasks associated with a given correlation ID and creates a GRAPH view of their execution.
 */
export class GetTaskExecutionGraph implements TotoDelegate {

    async do(req: Request, userContext: UserContext, execContext: ExecutionContext): Promise<GetTaskExecutionGraphResponse> {

        const config = execContext.config as GaleConfig;

        const client = await config.getMongoClient();
        const db = client.db(config.getDBName());

        const correlationId = req.params.correlationId;

        // 1. Retrieve the exeuction records from the database
        const tasks = await new AgentStatusTracker(db, execContext).findTasksByCorrelationId(correlationId);

        // 2. Build the graph 
        const graph = TaskExecutionGraph.buildGraphFromRecords(tasks);

        return { graph: graph }

    }
}

export interface GetTaskExecutionGraphResponse {

    graph: TaskExecutionGraph | null;

}