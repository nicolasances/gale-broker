
import { Request } from "express";
import { TotoDelegate, TotoRequest, UserContext } from "totoms";
import { GaleConfig } from "../../Config";
import { TaskStatusRecord, AgentStatusTracker } from "../../core/tracking/AgentStatusTracker";

/**
 * This endpoint retrieves all the root tasks
 */
export class GetRootTasks extends TotoDelegate<GetRootTasksRequest, GetRootTasksResponse> {

    async do(req: GetRootTasksRequest, userContext?: UserContext): Promise<GetRootTasksResponse> {

        const config = this.config as GaleConfig;

                const db = await config.getMongoDb(config.getDBName());

        // 1. Retrieve the exeuction records from the database
        const tasks = await new AgentStatusTracker(db, config).findAllRoots();

        return { tasks }

    }
    public parseRequest(req: Request): GetRootTasksRequest {
        return {};
    }

}

interface GetRootTasksRequest extends TotoRequest {}

export interface GetRootTasksResponse {

    tasks: TaskStatusRecord[];

}