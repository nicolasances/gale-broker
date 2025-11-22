import { Db } from "mongodb";
import { ExecutionContext } from "toto-api-controller";
import { TaskId } from "../../model/AgentTask";
import { GaleConfig } from "../../Config";
import { StopReason } from "../../model/AgentTask";

export class TaskTracker {

    config: GaleConfig;

    constructor(private db: Db, private execContext: ExecutionContext) {
        this.config = execContext.config as GaleConfig;
    }

    /**
     * Tracks the status of a task.
     * 
     * @param taskStatus the status to record
     */
    async trackTaskStatus(taskStatus: TaskStatusRecord): Promise<void> {

        const collection = this.db.collection(this.config.getCollections().tasks);

        await collection.updateOne(
            { taskInstanceId: taskStatus.taskInstanceId },
            { $set: taskStatus },
            { upsert: true }
        );

    }

    /**
     * Finds a task by its instance ID.
     * 
     * @param taskInstanceId the task instance ID
     */
    async findTaskByInstanceId(taskInstanceId: string): Promise<TaskStatusRecord | null> {

        const collection = this.db.collection(this.config.getCollections().tasks);

        return await collection.findOne({ taskInstanceId }) as any as TaskStatusRecord | null;
    }

    /**
     * Finds all child tasks of a given parent task that belong to a specific subtask group.
     * 
     * @param parentTaskInstanceId the instance Id of the parent task
     * @param subtaskGroupId the group id of the subtasks
     * @returns 
     */
    async findChildrenWithSubtaskGroupId(parentTaskInstanceId: string, subtaskGroupId: string): Promise<TaskStatusRecord[]> {

        const children = await this.db.collection(this.config.getCollections().tasks).find({ parentTaskInstanceId, subtaskGroupId }).toArray();

        return children.map(doc => doc as any as TaskStatusRecord);
    }

    /**
     * Flags the speified parent task (by its task instance Id) as 'childrenCompleted'. 
     * 
     * IMPORTANT: this method helps avoiding RACE CONDITIONS by using an upsert and returning the count of modified documents.
     * IF the count is 0, it means the task was already marked as 'childrenCompleted' by another concurrent process.
     * 
     * @param parentTaskInstanceId 
     * 
     * @returns true if the parent task was successfully marked as 'childrenCompleted', false if it was already marked.
     */
    async flagParentAsChildrenCompleted(parentTaskInstanceId: string, completedSubtaskGroupId: string): Promise<boolean> {

        const collection = this.db.collection(this.config.getCollections().subgroupTracking);

        const result = await collection.updateOne(
            { taskInstanceId: parentTaskInstanceId, subtaskGroupId: completedSubtaskGroupId },
            { $set: { status: 'childrenCompleted' } },
            { upsert: true }
        );

        return result.modifiedCount > 0 || result.upsertedCount > 0;
    }

    /**
     * Finds all tasks that are associated with the given correlation Id. 
     * Those are all the tasks that were spawned as part of the same root task.
     * 
     * @param correlationId the correlation Id 
     * @returns the list of task status records 
     */
    async findTasksByCorrelationId(correlationId: string): Promise<TaskStatusRecord[]> {

        const collection = this.db.collection(this.config.getCollections().tasks).find({ correlationId });

        return (await collection.toArray()).map(doc => doc as any as TaskStatusRecord);
    }

    /**
     * This method finds all root tasks (tasks without a parent).
     * This would typically be used to get a list of all tasks that were started independently (e.g. by a user or a process). 
     * 
     * @returns the list of root task status records
     */
    async findAllRoots(): Promise<TaskStatusRecord[]> {

        const collection = this.db.collection(this.config.getCollections().tasks).find({ $or: [{ parentTaskInstanceId: { $exists: false } }, { parentTaskInstanceId: null }] }).sort({ startedAt: -1 });

        return (await collection.toArray()).map(doc => doc as any as TaskStatusRecord);
    }

    /**
     * Checks if all sibling tasks of the given parent task are completed.
     * 
     * @param parentTaskInstanceId the task instance id of the parent of the task to check
     */
    async areSiblingsCompleted(parentTaskInstanceId: string, subtaskGroupId: string): Promise<boolean> {

        const siblingTasks = await this.db.collection(this.config.getCollections().tasks).find({ parentTaskInstanceId, subtaskGroupId }).toArray() as any as TaskStatusRecord[];

        if (siblingTasks.length === 0) return true;

        return siblingTasks.every(task => task.status === 'completed');
    }

}

export interface TaskStatusRecord {
    correlationId: string; // Correlation ID for tracing. All task instances with the same correlation ID are related to the same original root task. 
    taskId: TaskId; // The type of task being executed
    taskInstanceId: string; // The task execution ID assigned by the Agent
    agentName?: string; // The name of the Agent executing the task
    startedAt: Date; // Timestamp when the task execution started
    status: Status; // Current status of the task execution
    stopReason?: StopReason; // The reason why the task execution stopped
    executionTimeMs?: number; // Execution time, in milliseconds
    parentTaskId?: string; // If this is a subtask, the parent task ID
    parentTaskInstanceId?: string; // If this is a subtask, the parent task instance ID
    resumedAfterSubtasksGroupId?: string; // If this is a task that is resumed after a subtasks group finished, track the group ID here
    subtaskGroupId?: string; // If this is a subtask, the group ID of the subtask batch
    taskOutput?: any; // The output produced by the task execution
    taskInput: any; // The input data provided to the task execution
}

export type Status = "published" | "started" | "waiting" | "completed" | "failed" | "childrenCompleted"; 