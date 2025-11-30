import { TaskStatusRecord } from "../../../src/core/tracking/AgentStatusTracker";
import { AgentTaskRequest, AgentTaskResponse } from "../../../src/model/AgentTask";
import { AgentDefinition } from "../../../src/model/AgentDefinition";

export class MockConfig {
    getCollections() {
        return {
            tasks: "tasks",
            branches: "branches",
            flows: "flows"
        }
    }
}

export class MockExecContext {
    config = new MockConfig();
    correlationId = "test-correlation-id";
}

export class MockCollection {
    data: Map<string, any> = new Map();
    name: string;

    constructor(name: string) {
        this.name = name;
    }

    async updateOne(filter: any, update: any, options?: any) {
        // Simple mock implementation for specific cases
        // For flows, we usually filter by correlationId
        if (this.name === 'flows' && filter.correlationId) {
            let doc = this.data.get(filter.correlationId);
            
            // Handle lock
            if (update.$set && update.$set.locked !== undefined) {
                if (doc) doc.locked = update.$set.locked;
                return { matchedCount: doc ? 1 : 0 };
            }

            // Handle update
            if (doc) {
                if (update.$set) {
                    Object.assign(doc, update.$set);
                }
                this.data.set(filter.correlationId, doc);
                return { matchedCount: 1 };
            }
        }
        
        return { matchedCount: 0 };
    }

    async insertOne(doc: any) {
        if (this.name === 'flows') {
            this.data.set(doc.correlationId, doc);
        }
        return { insertedId: "123" };
    }

    async findOne(filter: any) {
        if (this.name === 'flows' && filter.correlationId) {
            return this.data.get(filter.correlationId);
        }
        return null;
    }
}

export class MockDb {
    collections: Map<string, MockCollection> = new Map();

    collection(name: string) {
        if (!this.collections.has(name)) {
            this.collections.set(name, new MockCollection(name));
        }
        return this.collections.get(name);
    }
}

export class MockAgentStatusTracker {
    
    // In-memory database of task status records
    private tasks: Map<string, TaskStatusRecord> = new Map();
    private branches: Map<string, { branchId: string, parentTaskInstanceId: string, status: 'active' | 'completed', createdAt: Date, completedAt?: Date }> = new Map();

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
        };

        this.tasks.set(task.taskInstanceId!, record);
    }

    async agentStatusCompleted(taskInstanceId: string, agentTaskResponse: AgentTaskResponse): Promise<void> {
        const record = this.tasks.get(taskInstanceId);
        if (record) {
            record.status = "completed";
            record.stoppedAt = new Date(Date.now());
            record.taskOutput = agentTaskResponse.taskOutput;
            this.tasks.set(taskInstanceId, record);
        }
    }

    async agentStatusFailed(taskInstanceId: string, agentTaskResponse: AgentTaskResponse): Promise<void> {
        const record = this.tasks.get(taskInstanceId);
        if (record) {
            record.status = "failed";
            record.stoppedAt = new Date(Date.now());
            record.taskOutput = agentTaskResponse.taskOutput;
            this.tasks.set(taskInstanceId, record);
        }
    }

    async agentTasksPublished(tasks: AgentTaskRequest[]): Promise<void> {
        for (const task of tasks) {
            const record: TaskStatusRecord = {
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
            };

            this.tasks.set(task.taskInstanceId!, record);
        }
    }

    async createBranches(parentTaskInstanceId: string, branches: { branchId: string, tasks: AgentTaskRequest[] }[]): Promise<void> {
        for (const branch of branches) {
            this.branches.set(branch.branchId, {
                branchId: branch.branchId,
                parentTaskInstanceId: parentTaskInstanceId,
                createdAt: new Date(Date.now()),
                status: 'active'
            });
        }
    }

    async findGroupTasks(groupId: string): Promise<TaskStatusRecord[]> {
        const results: TaskStatusRecord[] = [];
        for (const record of this.tasks.values()) {
            if (record.groupId === groupId) {
                results.push(record);
            }
        }
        return results;
    }

    async markBranchCompleted(branchId: string): Promise<void> {
        const branch = this.branches.get(branchId);
        if (branch) {
            branch.status = 'completed';
            branch.completedAt = new Date(Date.now());
            this.branches.set(branchId, branch);
        }
    }

    async areBranchesCompleted(branchIds: string[]): Promise<boolean> {
        for (const branchId of branchIds) {
            const branch = this.branches.get(branchId);
            if (!branch || branch.status !== 'completed') {
                return false;
            }
        }
        return true;
    }

    // Helper method to manually set task status for testing
    setTaskStatus(taskInstanceId: string, status: "published" | "started" | "completed" | "failed"): void {
        const record = this.tasks.get(taskInstanceId);
        if (record) {
            record.status = status;
            if (status === "completed" || status === "failed") {
                record.stoppedAt = new Date(Date.now());
            }
            this.tasks.set(taskInstanceId, record);
        }
    }

    // Helper method to get all tasks for debugging
    getAllTasks(): TaskStatusRecord[] {
        return Array.from(this.tasks.values());
    }

    // Helper method to clear all data
    clear(): void {
        this.tasks.clear();
        this.branches.clear();
    }

}
