
import { Request } from "express";
import { ExecutionContext, TotoDelegate, UserContext } from "toto-api-controller";
import { GaleConfig } from "../../Config";
import { TaskStatusRecord, TaskTracker } from "../../core/tracking/TaskTracker";

/**
 * This endpoint retrieves all the root tasks
 */
export class GetRootTasks implements TotoDelegate {

    async do(req: Request, userContext: UserContext, execContext: ExecutionContext): Promise<GetRootTasksResponse> {

        const config = execContext.config as GaleConfig;

        const client = await config.getMongoClient();
        const db = client.db(config.getDBName());

        // 1. Retrieve the exeuction records from the database
        const tasks = await new TaskTracker(db, execContext).findAllRoots();

        return { tasks }

    }
}

export interface GetRootTasksResponse {

    tasks: TaskStatusRecord[];

}