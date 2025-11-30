import { Db } from "mongodb";
import { ExecutionContext } from "toto-api-controller";
import { AgentStatusTracker, TaskStatusRecord } from "../../../src/core/tracking/AgentStatusTracker";
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
    
    // Track calls for verification
    startedCalls: any[] = [];
    completedCalls: any[] = [];
    failedCalls: any[] = [];
    publishedCalls: any[] = [];
    createBranchesCalls: any[] = [];
    markBranchCompletedCalls: any[] = [];
    
    // Mock return values
    groupTasks: TaskStatusRecord[] = [];
    branchesCompleted: boolean = true;

    async agentStatusStarted(task: AgentTaskRequest, agentDefinition: AgentDefinition): Promise<void> {
        this.startedCalls.push({ task, agentDefinition });
    }

    async agentStatusCompleted(taskInstanceId: string, agentTaskResponse: AgentTaskResponse): Promise<void> {
        this.completedCalls.push({ taskInstanceId, agentTaskResponse });
    }

    async agentStatusFailed(taskInstanceId: string, agentTaskResponse: AgentTaskResponse): Promise<void> {
        this.failedCalls.push({ taskInstanceId, agentTaskResponse });
    }

    async agentTasksPublished(tasks: AgentTaskRequest[]): Promise<void> {
        this.publishedCalls.push(tasks);
    }

    async createBranches(parentTaskInstanceId: string, branches: { branchId: string, tasks: AgentTaskRequest[] }[]): Promise<void> {
        this.createBranchesCalls.push({ parentTaskInstanceId, branches });
    }

    async findGroupTasks(groupId: string): Promise<TaskStatusRecord[]> {
        return this.groupTasks;
    }

    async markBranchCompleted(branchId: string): Promise<void> {
        this.markBranchCompletedCalls.push(branchId);
    }

    async areBranchesCompleted(branchIds: string[]): Promise<boolean> {
        return this.branchesCompleted;
    }
}
