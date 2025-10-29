import { Db } from "mongodb";
import { ExecutionContext } from "toto-api-controller";
import { TaskId } from "../../model/Task";
import { GaleConfig } from "../../Config";
import { StopReason } from "../../model/AgentTask";

export class TaskTracker {

    constructor(private db: Db, private execContext: ExecutionContext) { }

    /**
     * Tracks the status of a task.
     * 
     * @param taskStatus the status to record
     */
    async trackTaskStatus(taskStatus: TaskStatusRecord): Promise<void> {

        const collection = this.db.collection((this.execContext.config as GaleConfig).getCollections().tasks);

        await collection.updateOne(
            { taskInstanceId: taskStatus.taskInstanceId },
            { $set: taskStatus },
            { upsert: true }
        );

    }

}

export interface TaskStatusRecord {
    taskId: TaskId; // The type of task being executed
    taskInstanceId: string; // The task execution ID assigned by the Agent
    agentName?: string; // The name of the Agent executing the task
    status: Status; // Current status of the task execution
    stopReason?: StopReason; // The reason why the task execution stopped
    executionTimeMs?: number; // Execution time, in milliseconds
    parentTaskId?: string; // If this is a subtask, the parent task ID
    parentTaskInstanceId?: string; // If this is a subtask, the parent task instance ID
}

export type Status = "published" | "started" | "stopped"; 