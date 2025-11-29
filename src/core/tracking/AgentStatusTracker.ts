import { Db } from "mongodb";
import { ExecutionContext, TotoRuntimeError } from "toto-api-controller";
import { AgentTaskRequest, ParentTaskInfo, TaskInfo, TaskId, AgentTaskResponse } from "../../model/AgentTask";
import { GaleConfig } from "../../Config";
import { StopReason } from "../../model/AgentTask";
import { AgentDefinition } from "../../model/AgentDefinition";
import { v4 as uuidv4 } from 'uuid';

const MAX_LOCK_ATTEMPTS = 10;

export class AgentStatusTracker {

    config: GaleConfig;
    tasksCollection: any;
    branchesCollection: any;

    constructor(private db: Db, private execContext: ExecutionContext) {
        this.config = execContext.config as GaleConfig;
        this.tasksCollection = this.db.collection(this.config.getCollections().tasks);
        this.branchesCollection = this.db.collection(this.config.getCollections().branches);
    }

    /**
     * Locks the specific task for update
     * @param taskInstanceId
     */
    async acquireTaskLock(taskInstanceId: string, attempt: number = 1): Promise<void> {

        if (attempt > MAX_LOCK_ATTEMPTS) {
            throw new TotoRuntimeError(500, `Failed to lock task ${taskInstanceId} after ${MAX_LOCK_ATTEMPTS} attempts`);
        }

        const updateResult = await this.tasksCollection.updateOne({ taskInstanceId: taskInstanceId, locked: { $ne: true } }, { $set: { locked: true } });

        if (updateResult.matchedCount === 0) {
            // Means it's already locked: wait and retry
            await new Promise(resolve => setTimeout(resolve, 50));
            return this.acquireTaskLock(taskInstanceId, attempt + 1);
        }
    }

    /**
     * Releases the lock on the flow after update.
     * @param correlationId 
     */
    async releaseTaskLock(taskInstanceId: string): Promise<void> {
        await this.tasksCollection.updateOne({ taskInstanceId: taskInstanceId }, { $set: { locked: false } });
    }


    /**
     * Tracks the fact that an agent has started executing a task.
     * 
     * @param task 
     * @param agentDefinition 
     */
    async agentStatusStarted(task: AgentTaskRequest, agentDefinition: AgentDefinition): Promise<void> {

        const record: TaskStatusRecord = {
            correlationId: task.correlationId!,
            agentName: agentDefinition.name,
            taskId: task.taskId,
            taskInstanceId: task.taskInstanceId!,
            startedAt: new Date(Date.now()),
            status: "started",
            taskInput: task.taskInputData,
            groupId: task.taskGroupId,
            parentTaskId: task.parentTask?.taskId,
            parentTaskInstanceId: task.parentTask?.taskInstanceId,
            branchId: task.branchId,
        }

        await this.tasksCollection.updateOne({ taskInstanceId: task.taskInstanceId }, { $set: record }, { upsert: true });
    }

    /**
     * Tracks the fact that an agent has completed executing a task.
     * 
     * @param taskInstanceId 
     * @param agentTaskResponse 
     */
    async agentStatusCompleted(taskInstanceId: string, agentTaskResponse: AgentTaskResponse): Promise<void> {

        await this.tasksCollection.updateOne({ taskInstanceId }, {
            $set: {
                status: "completed",
                stoppedAt: new Date(Date.now()),
                taskOutput: agentTaskResponse.taskOutput
            }
        });

    }

    /**
     * Tracks the fact that an agent has failed executing a task.
     * 
     * @param taskInstanceId 
     * @param agentTaskResponse 
     */
    async agentStatusFailed(taskInstanceId: string, agentTaskResponse: AgentTaskResponse): Promise<void> {

        await this.tasksCollection.updateOne({ taskInstanceId }, {
            $set: {
                status: "failed",
                stoppedAt: new Date(Date.now()),
                taskOutput: agentTaskResponse.taskOutput
            }
        });

    }

    /**
     * Tracks the publication of a set of agent tasks.
     * 
     * @param tasks the list of tasks being published
     */
    async agentTasksPublished(tasks: AgentTaskRequest[]): Promise<void> {

        const records: TaskStatusRecord[] = tasks.map(task => ({
            correlationId: task.correlationId!,
            taskId: task.taskId,
            taskInstanceId: task.taskInstanceId!,
            startedAt: new Date(Date.now()),
            status: "published",
            taskInput: task.taskInputData,
            groupId: task.taskGroupId,
            parentTaskId: task.parentTask?.taskId,
            parentTaskInstanceId: task.parentTask?.taskInstanceId,
            branchId: task.branchId,
        }));

        await this.tasksCollection.insertMany(records);

    }


    /**
     * Finds all tasks that belong to a specific subtask group.
     * 
     * @param groupId the group id of the subtasks
     * @returns 
     */
    async findGroupTasks(groupId: string): Promise<TaskStatusRecord[]> {

        const children = await this.db.collection(this.config.getCollections().tasks).find({ groupId: groupId }).toArray();

        return children.map(doc => doc as any as TaskStatusRecord);
    }

    /**
     * Marks a parent task as resumed after its subtasks have completed.
     * 
     * @param parentTaskInstanceId the instance ID of the parent task
     * @param completedSubtaskGroupId the ID of the completed subtask group
     */
    async markTaskResumedAfterGroupCompletion(parentTaskInstanceId: string, completedSubtaskGroupId: string): Promise<void> {

        await this.tasksCollection.updateOne(
            { taskInstanceId: parentTaskInstanceId },
            { $addToSet: { completedSubtaskGroups: completedSubtaskGroupId } }
        );

    }

    /**
     * Creates the branches records in the tracking system.
     * @param branches the branches to create
     */
    async createBranches(parentTaskInstanceId: string, branches: { branchId: string, tasks: AgentTaskRequest[] }[]): Promise<void> {
        await this.branchesCollection.insertMany(branches.map(branch => ({ branchId: branch.branchId, parentTaskInstanceId: parentTaskInstanceId, createdAt: new Date(Date.now()), status: 'active' })));
    }

    /**
     * Marks a branch as completed.
     * 
     * @param branchId the branchId to mark as completed
     */
    async markBranchCompleted(branchId: string): Promise<void> {
        await this.branchesCollection.updateOne(
            { branchId },
            { $set: { status: 'completed', completedAt: new Date(Date.now()) } }
        );
    }

    /**
     * Checks if the specified branches are all completed.
     * 
     * @param branchIds the branches
     * @returns 
     */
    async areBranchesCompleted(branchIds: string[]): Promise<boolean> {

        const branches = await this.branchesCollection.find({ branchId: { $in: branchIds } }).toArray() as any[];

        if (branches.length === 0) return true;

        return branches.every(branch => branch.status === 'completed');
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
     * Tracks the start of a root task (a task without a parent).
     * IMPORTANT: this method expects taskInstanceId and correlationId to have been already set on the task.
     * IMPORTANT: this method does NOT track the RESUMPTION of a parent task after its subtasks are completed.
     * 
     * Creates a new record in the tasks collection with status 'started'.
     */
    async trackRootTaskStatusUpdate(task: AgentTaskRequest, agentDefinition: AgentDefinition, status: Status, resumedAfterSubtasksGroupId?: string): Promise<TaskStatusRecord> {

        // Create the task status record
        const record: TaskStatusRecord = {
            correlationId: task.correlationId!,
            taskId: task.taskId,
            agentName: agentDefinition.name,
            taskInstanceId: task.taskInstanceId!,
            startedAt: new Date(Date.now()),
            status: status,
            taskInput: task.taskInputData,
        }

        if (resumedAfterSubtasksGroupId) record.resumedAfterSubtasksGroupId = resumedAfterSubtasksGroupId;

        // Insert the record into the database
        const collection = this.db.collection(this.config.getCollections().tasks);

        await collection.insertOne(record);

        return record;
    }

    async trackRootTaskStarted(task: AgentTaskRequest, agentDefinition: AgentDefinition): Promise<TaskStatusRecord> {
        return this.trackRootTaskStatusUpdate(task, agentDefinition, "started");
    }

    /**
     * Tracks the resumption of a root task (a task without a parent that has been resumed as per a 'resume' command).
     * 
     * @param task the task
     * @param agentDefinition the agent definition
     * @param correlationId the correlation Id
     * @returns 
     */
    async trackRootTaskResumed(task: AgentTaskRequest, agentDefinition: AgentDefinition): Promise<TaskStatusRecord> {
        return this.trackRootTaskStatusUpdate(task, agentDefinition, "resumed", task.command.completedSubtaskGroupId);
    }

    /**
     * Tracks that a subtask has been sent by the parent task to Gale Broker for execution 
     * 
     * @param subtask the subtask to track
     * @param parentTask the parent task
     * @returns the inserted record
     */
    async trackSubtaskRequested(subtask: TaskInfo, parentTask: ParentTaskInfo,): Promise<TaskStatusRecord> {

        // Create the task status record
        const taskStatus: TaskStatusRecord = {
            correlationId: parentTask.correlationId,
            taskId: subtask.taskId,
            taskInstanceId: uuidv4(),
            startedAt: new Date(Date.now()),
            status: "published",
            parentTaskId: parentTask.taskId,
            parentTaskInstanceId: parentTask.taskInstanceId,
            subtaskGroupId: subtask.subtasksGroupId,
            taskInput: subtask.taskInputData
        }

        // Insert the record into the database
        const collection = this.db.collection(this.config.getCollections().tasks);

        await collection.insertOne(taskStatus);

        return taskStatus;

    }

    /**
     * Tracks the start of a subtask.
     * 
     * @param taskInstanceId the task instance id
     * @param agentDefinition the definition of the agent
     */
    async trackSubtaskStarted(taskInstanceId: string, agentDefinition: AgentDefinition): Promise<void> {

        const collection = this.db.collection(this.config.getCollections().tasks);

        await collection.updateOne(
            { taskInstanceId },
            { $set: { status: "started", agentName: agentDefinition.name, startedAt: new Date(Date.now()) } }
        );
    }

    /**
     * Tracks the completion of a task.
     * The completion of a task tracks the following updates: 
     * - status
     * - stopReason
     * - executionTimeMs
     * - taskOutput
     * 
     * @param taskInstanceId the task instance id   
     * @param stopReason the reason why the task stopped
     * @param taskOutput the output produced by the task    
     */
    async trackTaskCompletion(taskInstanceId: string, stopReason: StopReason, taskOutput: any): Promise<void> {

        const collection = this.db.collection(this.config.getCollections().tasks);

        // Read the existing record to calculate execution time
        const existingRecord = await collection.findOne({ taskInstanceId }) as any as TaskStatusRecord | null;

        if (!existingRecord) throw new Error(`Cannot track completion for unknown taskInstanceId: ${taskInstanceId}`);

        const executionTimeMs = Date.now() - existingRecord.startedAt.getTime();

        // Update the record with completion details
        let status: Status;
        switch (stopReason) {
            case 'completed':
                status = 'completed';
                break;
            case 'failed':
                status = 'failed';
                break;
            case 'subtasks':
                status = 'childrenTriggered';
                break;
            default:
                status = 'started';
                break;
        }

        const updateStatement = {
            $set: {
                status: status,
                stopReason: stopReason,
                executionTimeMs: executionTimeMs,
                taskOutput: taskOutput
            }
        };

        await collection.updateOne({ taskInstanceId }, updateStatement);
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

        const collection = this.db.collection(this.config.getCollections().tasks).find({
            $and: [
                { $or: [{ parentTaskInstanceId: { $exists: false } }, { parentTaskInstanceId: null }] },
                { $or: [{ resumedAfterSubtasksGroupId: { $exists: false } }, { resumedAfterSubtasksGroupId: null }] }
            ]
        }).sort({ startedAt: -1 });

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
    correlationId: string;                          // Correlation ID for tracing. All task instances with the same correlation ID are related to the same original root task. 
    taskId: TaskId;                                 // The type of task being executed
    taskInstanceId: string;                         // The task execution ID assigned by the Agent
    agentName?: string;                             // The name of the Agent executing the task
    startedAt: Date;                                // Timestamp when the task execution started
    stoppedAt?: Date;                               // Timestamp when the task execution stopped
    status: Status;                                 // Current status of the task execution

    parentTaskId?: string;                          // If this is a subtask, the parent task ID
    parentTaskInstanceId?: string;                  // If this is a subtask, the parent task instance ID

    completedSubtaskGroups?: string[];              // List of completed subtasks groups IDs

    groupId?: string;                               // If this is a subtask, the group ID of the subtask batch
    branchId?: string;                              // The branch on which the task is located

    taskInput: any;                                 // The input data provided to the task execution
    taskOutput?: any;                               // The output produced by the task execution
}

export type Status = "published" | "started" | "completed" | "failed"; 