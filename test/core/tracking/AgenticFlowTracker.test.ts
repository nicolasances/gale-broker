import { AgenticFlowTracker } from "../../../src/core/tracking/AgenticFlowTracker";
import { AgentStatusTracker, TaskStatusRecord } from "../../../src/core/tracking/AgentStatusTracker";
import { AgentTaskRequest, AgentTaskResponse } from "../../../src/model/AgentTask";
import { AgentDefinition } from "../../../src/model/AgentDefinition";
import { AgenticFlow, AgentNode, BranchNode, GroupNode } from "../../../src/core/tracking/AgenticFlow";
import { Db } from "mongodb";
import { ExecutionContext } from "toto-api-controller";
import { v4 as uuidv4 } from 'uuid';
import { expect } from 'chai';
import { MockDb, MockExecContext, MockAgentStatusTracker } from "./Mocks";

// ------------------------------------------------------------------------------------------------------------
// TESTS
// ------------------------------------------------------------------------------------------------------------

describe('AgenticFlowTracker', () => {

    let mockDb: Db;
    let mockExecContext: ExecutionContext;
    let mockStatusTracker: MockAgentStatusTracker;
    let tracker: AgenticFlowTracker;

    beforeEach(() => {
        mockDb = new MockDb() as any as Db;
        mockExecContext = new MockExecContext() as any as ExecutionContext;
        mockStatusTracker = new MockAgentStatusTracker();
        tracker = new AgenticFlowTracker(mockDb, mockExecContext, mockStatusTracker as any as AgentStatusTracker);
    });

    const removePrev = (obj: any, seen = new Set()) => {
        if (!obj || typeof obj !== 'object') return;
        if (seen.has(obj)) return;
        seen.add(obj);

        if ('prev' in obj) delete obj.prev;
        if ('locked' in obj) delete obj.locked;

        for (const key in obj) {
            removePrev(obj[key], seen);
        }
    };

    it('should start and complete a root agent successfully', async () => {
        const correlationId = uuidv4();
        const taskInstanceId = uuidv4();

        const task = new AgentTaskRequest({
            command: { command: "start" },
            taskId: "test.task",
            correlationId: correlationId,
            taskInstanceId: taskInstanceId,
            taskInputData: {}
        });

        const agent = new AgentDefinition();
        agent.name = "root-agent";

        // 1. Start Root Agent
        await tracker.rootAgentStarted(agent, task);

        // Verify task was stored
        const tasks = mockStatusTracker.getAllTasks();
        expect(tasks.length).to.equal(1);
        expect(tasks[0].taskInstanceId).to.equal(taskInstanceId);
        expect(tasks[0].status).to.equal("started");

        // Verify Flow created in DB
        const flow = await mockDb.collection('flows').findOne({ correlationId });
        expect(flow).to.not.be.null;

        const expectedFlow = new AgenticFlow(correlationId, new AgentNode({
            taskId: "test.task",
            taskInstanceId: taskInstanceId,
            name: "root-agent"
        }));

        removePrev(flow);
        removePrev(expectedFlow);

        expect(flow).to.deep.equal(expectedFlow);

        // 2. Complete Root Agent
        const response = new AgentTaskResponse({
            correlationId: correlationId,
            stopReason: "completed",
            taskOutput: { result: "success" }
        });

        await tracker.agentCompleted(task, response);

        // Verify task was marked as completed
        const completedTasks = mockStatusTracker.getAllTasks();
        expect(completedTasks.length).to.equal(1);
        expect(completedTasks[0].status).to.equal("completed");
        expect(completedTasks[0].taskOutput).to.deep.equal({ result: "success" });
    });

    /**
     * Tests handling of root agent spinning off subtasks
     * - Subtasks are grouped into a single group 
     * - under a single branch
     */
    it('should handle root agent spinning off subtasks', async () => {
        const correlationId = uuidv4();
        const rootTaskInstanceId = uuidv4();

        const rootTask = new AgentTaskRequest({
            command: { command: "start" },
            taskId: "root.task",
            correlationId: correlationId,
            taskInstanceId: rootTaskInstanceId,
            taskInputData: {}
        });

        const rootAgent = new AgentDefinition();
        rootAgent.name = "root-agent";

        // 1. Start Root Agent
        await tracker.rootAgentStarted(rootAgent, rootTask);

        // 2. Spin off subtasks (using branch with 1 branch containing 3 tasks)
        const branchId = uuidv4();
        const subtasks = [1, 2, 3].map(i => new AgentTaskRequest({
            command: { command: "start" },
            taskId: "sub.task",
            correlationId: correlationId,
            taskInstanceId: uuidv4(),
            taskInputData: { index: i },
            parentTask: { taskId: "root.task", taskInstanceId: rootTaskInstanceId },
            branchId: branchId,
            taskGroupId: "group-1"
        }));

        await tracker.branch([{ branchId: branchId, tasks: subtasks }], null);

        // Verify tasks were published
        const allTasks = mockStatusTracker.getAllTasks();
        const publishedTasks = allTasks.filter(t => t.status === "published");
        expect(publishedTasks.length).to.equal(3);

        // Verify Flow created in DB
        const flow = await mockDb.collection('flows').findOne({ correlationId });
        expect(flow).to.not.be.null;

        const expectedFlow = new AgenticFlow(correlationId, new AgentNode({
            taskId: "root.task",
            taskInstanceId: rootTaskInstanceId,
            name: "root-agent",
            next: new BranchNode({
                branches: [{
                    branchId: branchId,
                    branch: new GroupNode({
                        agents: subtasks.map(t => new AgentNode({ taskId: t.taskId, taskInstanceId: t.taskInstanceId! })),
                        groupId: "group-1"
                    })
                }]
            })
        }));

        removePrev(flow);
        removePrev(expectedFlow);

        expect(flow).to.deep.equal(expectedFlow);

        // 3. Check if group is done (should be false initially since tasks are published, not completed)
        let isDone = await tracker.isGroupDone("group-1");
        expect(isDone).to.be.false;

        // 4. Complete tasks
        for (const task of subtasks) {
            mockStatusTracker.setTaskStatus(task.taskInstanceId!, "completed");
        }

        isDone = await tracker.isGroupDone("group-1");
        expect(isDone).to.be.true;
    });

    /**
     * Tests handling of root agent creating branches and completing them
     * - 2 branches created under the root agent
     * - Completing branches should mark parent branches as completed if all siblings are completed
     */
    it('should handle root agent creating branches', async () => {
        const correlationId = uuidv4();
        const rootTaskInstanceId = uuidv4();

        const rootTask = new AgentTaskRequest({
            command: { command: "start" },
            taskId: "root.task",
            correlationId: correlationId,
            taskInstanceId: rootTaskInstanceId,
            taskInputData: {}
        });

        const rootAgent = new AgentDefinition();
        rootAgent.name = "root-agent";

        // 1. Start Root Agent
        await tracker.rootAgentStarted(rootAgent, rootTask);

        // 2. Create 2 branches
        const branch1Id = uuidv4();
        const branch2Id = uuidv4();

        const task1 = new AgentTaskRequest({
            command: { command: "start" },
            taskId: "branch1.task",
            correlationId: correlationId,
            taskInstanceId: uuidv4(),
            parentTask: { taskId: "root.task", taskInstanceId: rootTaskInstanceId },
            branchId: branch1Id
        });

        const task2 = new AgentTaskRequest({
            command: { command: "start" },
            taskId: "branch2.task",
            correlationId: correlationId,
            taskInstanceId: uuidv4(),
            parentTask: { taskId: "root.task", taskInstanceId: rootTaskInstanceId },
            branchId: branch2Id
        });

        await tracker.branch([
            { branchId: branch1Id, tasks: [task1] },
            { branchId: branch2Id, tasks: [task2] }
        ], null);

        // Verify Flow created in DB
        const flow = await mockDb.collection('flows').findOne({ correlationId });
        expect(flow).to.not.be.null;

        const expectedFlow = new AgenticFlow(correlationId, new AgentNode({
            taskId: "root.task",
            taskInstanceId: rootTaskInstanceId,
            name: "root-agent",
            next: new BranchNode({
                branches: [
                    { branchId: branch1Id, branch: new AgentNode({ taskId: task1.taskId, taskInstanceId: task1.taskInstanceId! }) },
                    { branchId: branch2Id, branch: new AgentNode({ taskId: task2.taskId, taskInstanceId: task2.taskInstanceId! }) }
                ]
            })
        }));

        removePrev(flow);
        removePrev(expectedFlow);

        expect(flow).to.deep.equal(expectedFlow);

        // 3. Complete Branch 1
        await tracker.markBranchCompleted(correlationId, branch1Id);

        // Verify branch 1 is completed but branch 2 is not
        let branch1Completed = await mockStatusTracker.areBranchesCompleted([branch1Id]);
        let branch2Completed = await mockStatusTracker.areBranchesCompleted([branch2Id]);
        expect(branch1Completed).to.be.true;
        expect(branch2Completed).to.be.false;

        // 4. Complete Branch 2
        await tracker.markBranchCompleted(correlationId, branch2Id);

        // Verify both branches are completed
        let allBranchesCompleted = await mockStatusTracker.areBranchesCompleted([branch1Id, branch2Id]);
        expect(allBranchesCompleted).to.be.true;
    });

    it('should handle 2 branches, the first one longer than the second', async () => {
        const correlationId = uuidv4();
        const rootTaskInstanceId = uuidv4();
        const rootAgent = new AgentDefinition();
        rootAgent.name = "root-agent";

        const rootTask = new AgentTaskRequest({ command: { command: "start" }, taskId: "root.task", correlationId: correlationId, taskInstanceId: rootTaskInstanceId, taskInputData: {} });

        // 1. Start Root Agent
        await tracker.rootAgentStarted(rootAgent, rootTask);

        // 2. Create 2 branches
        const branch1Id = `b1-${uuidv4()}`;
        const branch2Id = `b2-${uuidv4()}`;

        const task1 = new AgentTaskRequest({ command: { command: "start" }, taskId: "branch1.task", correlationId: correlationId, taskInstanceId: uuidv4(), parentTask: { taskId: "root.task", taskInstanceId: rootTaskInstanceId }, taskGroupId: "g1", branchId: branch1Id });
        const task2 = new AgentTaskRequest({ command: { command: "start" }, taskId: "branch1.task", correlationId: correlationId, taskInstanceId: uuidv4(), parentTask: { taskId: "root.task", taskInstanceId: rootTaskInstanceId }, taskGroupId: "g1", branchId: branch1Id });
        const task3 = new AgentTaskRequest({ command: { command: "start" }, taskId: "branch2.task", correlationId: correlationId, taskInstanceId: uuidv4(), parentTask: { taskId: "root.task", taskInstanceId: rootTaskInstanceId }, taskGroupId: "g2", branchId: branch2Id });

        await tracker.branch([
            { branchId: branch1Id, tasks: [task1, task2] },
            { branchId: branch2Id, tasks: [task3] }
        ], null);

        // 3. Task 1 and 2 complete 
        await tracker.agentCompleted(task1, new AgentTaskResponse({ correlationId: correlationId, stopReason: "completed" }));
        expect(await tracker.isGroupDone(task1.taskGroupId!)).to.be.false;

        await tracker.agentCompleted(task2, new AgentTaskResponse({ correlationId: correlationId, stopReason: "completed" }));
        expect(await tracker.isGroupDone(task1.taskGroupId!)).to.be.true;
        expect(await tracker.isGroupDone(task3.taskGroupId!)).to.be.false;

        // 4. Parent is resumed => create subtasks
        const branch3Id = `b3-${uuidv4()}`;
        const task4 = new AgentTaskRequest({ command: { command: "start" }, taskId: "task4", correlationId: correlationId, taskInstanceId: uuidv4(), parentTask: { taskId: "root.task", taskInstanceId: rootTaskInstanceId }, taskGroupId: "g3", branchId: branch3Id });

        await tracker.branch([{ branchId: branch3Id, tasks: [task4] }], "g1");

        // So far no branch is completed
        expect(await tracker.areSiblingBranchesCompleted(correlationId, branch1Id)).to.be.false;
        expect(await tracker.areSiblingBranchesCompleted(correlationId, branch2Id)).to.be.false;
        expect(await mockStatusTracker.areBranchesCompleted([branch1Id, branch2Id, branch3Id])).to.be.false;

        // 5. Task 3 completes
        await tracker.agentCompleted(task3, new AgentTaskResponse({ correlationId: correlationId, stopReason: "completed" }));
        expect(await tracker.isGroupDone(task3.taskGroupId!)).to.be.true;

        await tracker.markBranchCompleted(correlationId, branch2Id);
        expect(await tracker.areSiblingBranchesCompleted(correlationId, branch1Id)).to.be.true;
        expect(await tracker.areSiblingBranchesCompleted(correlationId, branch2Id)).to.be.false;
        expect(await mockStatusTracker.areBranchesCompleted([branch2Id])).to.be.true;
        expect(await mockStatusTracker.areBranchesCompleted([branch1Id, branch3Id])).to.be.false;

        // 6. Task 4 completes
        await tracker.agentCompleted(task4, new AgentTaskResponse({ correlationId: correlationId, stopReason: "completed" }));
        expect(await tracker.isGroupDone(task4.taskGroupId!)).to.be.true;

        await tracker.markBranchCompleted(correlationId, branch3Id);

        // Now we expect that recursively branch 1 is also marked as completed
        expect(await mockStatusTracker.areBranchesCompleted([branch1Id])).to.be.true;
        expect(await tracker.areSiblingBranchesCompleted(correlationId, branch1Id)).to.be.true;
        expect(await tracker.areSiblingBranchesCompleted(correlationId, branch2Id)).to.be.true;

        const flow = await mockDb.collection('flows').findOne({ correlationId });

        const expectedFlow = new AgenticFlow(correlationId, new AgentNode({
            taskId: "root.task",
            taskInstanceId: rootTaskInstanceId,
            name: "root-agent",
            next: new BranchNode({
                branches: [
                    {
                        branchId: branch1Id,
                        branch: new GroupNode({
                            agents: [
                                new AgentNode({ taskId: task1.taskId, taskInstanceId: task1.taskInstanceId! }),
                                new AgentNode({ taskId: task2.taskId, taskInstanceId: task2.taskInstanceId! })
                            ],
                            groupId: "g1",
                            next: new BranchNode({
                                branches: [
                                    { branchId: branch3Id, branch: new AgentNode({ taskId: task4.taskId, taskInstanceId: task4.taskInstanceId! }) }
                                ]
                            })
                        })
                    },
                    { branchId: branch2Id, branch: new AgentNode({ taskId: task3.taskId, taskInstanceId: task3.taskInstanceId! }) }
                ]
            })
        }));

        removePrev(flow);
        removePrev(expectedFlow);

        expect(flow).to.deep.equal(expectedFlow);

        // // 3. Complete Branch 1
        // await tracker.markBranchCompleted(correlationId, branch1Id);

        // // Verify markBranchCompleted called for branch1
        // expect(mockStatusTracker.markBranchCompletedCalls).to.include(branch1Id);

        // // 4. Complete Branch 2
        // // Now mock that all branches are completed
        // mockStatusTracker.branchesCompleted = true;

        // await tracker.markBranchCompleted(correlationId, branch2Id);

        // // Verify branch 2 marked completed
        // expect(mockStatusTracker.markBranchCompletedCalls).to.include(branch2Id);
    });
});
