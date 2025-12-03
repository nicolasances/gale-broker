import { expect } from "chai";
import { TaskExecution } from "../../../src/core/task/TaskExecution";
import { AgentTaskRequest, AgentTaskResponse } from "../../../src/model/AgentTask";
import { AgentDefinition } from "../../../src/model/AgentDefinition";
import { AgenticFlowTracker } from "../../../src/core/tracking/AgenticFlowTracker";
import { AgentStatusTracker } from "../../../src/core/tracking/AgentStatusTracker";
import {
    MockDb,
    MockExecContext,
    MockAgentCallFactory,
    MockAgentsCatalog,
    MockAgentStatusTracker,
} from "../tracking/Mocks";
import { AgenticFlow, AgentNode, BranchNode, GroupNode } from "../../../src/core/tracking/AgenticFlow";
import { removePrev } from "./util/FlowUtils";

/**
 * Test cases: 
 * 
 * 1. Simple agent completion 
 * The agent is executed and completes successfully.
 * 
 * 2. Group execution with subtasks
 * An (orchestrator) agent spawns a group of subtasks and they all get executed. 
 * 
 * 3. Branching 
 * An (orchestrator) agent spawns multiple branches of subtasks and they all get executed.
 * Each branch just contains one agent each for simplicity.
 * 
 * 4. Group followed by branching
 * An (orchestrator) agent spawns a group of agents, and upon their completion, spawns multiple branches.
 * 
 * 5. Branch started within in a group
 * An (orchestrator) agent spawns two branches. 
 * Within one branch, a group of agents is spawned.
 * Within that group, one of the agents spawns two branches. Each branch contains one agent.
 * 
 * 6. Asymmetric branching
 * An (orchestrator) agent spawns two branches.
 * - Branch 1 contains a group of two agents.
 *  - When this group completes, a single agent is spawned. 
 *  - When that agent completes, Branch 1 is considered complete.
 * - Branch 2 contains a group of 3 agents. 
 *  - When this group completes, Branch 2 is considered complete.
 * 
 * 7. Deep nesting (multi-level hierarchy)
 * An orchestrator spawns a branch with a group. Within that group, an agent spawns a branch with another group.
 * Within that nested group, an agent spawns yet another branch. Tests 3+ levels of nesting.
 * 
 * 8. Agent failure scenarios
 * Tests error handling when agents fail at different levels:
 * - Root agent failure
 * - Agent failure within a group
 * - Agent failure within a branch
 * 
 * 9. Multiple agents spawning branches within same group
 * A group contains 3 agents. Two of them spawn their own branches while one completes normally.
 * Tests concurrent branching from different agents in the same group.
 * 
 * 10. Sequential branching (NOT IMPLEMENTED - for future reference)
 * After one set of branches completes, orchestrator spawns a completely new set of branches.
 * 
 * 11. Diamond/convergence pattern (NOT IMPLEMENTED - for future reference)
 * Two branches that later converge to spawn the same follow-up work.
 * 
 */
describe("TaskExecution", () => {

    let mockDb: MockDb;
    let mockExecContext: MockExecContext;
    let mockAgentCallFactory: MockAgentCallFactory;
    let mockAgentsCatalog: MockAgentsCatalog;
    let mockAgentStatusTracker: MockAgentStatusTracker;
    let agenticFlowTracker: AgenticFlowTracker;
    let taskExecution: TaskExecution;

    beforeEach(() => {
        // Initialize mocks
        mockDb = new MockDb();
        mockExecContext = new MockExecContext();
        mockAgentCallFactory = new MockAgentCallFactory();
        mockAgentsCatalog = new MockAgentsCatalog();
        mockAgentStatusTracker = new MockAgentStatusTracker();

        // Create AgentStatusTracker with mock db
        const agentStatusTracker = new AgentStatusTracker(mockDb as any, mockExecContext as any);

        // Replace the real methods with mock methods
        Object.setPrototypeOf(agentStatusTracker, mockAgentStatusTracker);
        Object.assign(agentStatusTracker, mockAgentStatusTracker);

        // Create AgenticFlowTracker with real implementation but mock dependencies
        agenticFlowTracker = new AgenticFlowTracker(mockDb as any, mockExecContext as any, agentStatusTracker);

        // Create TaskExecution
        taskExecution = new TaskExecution({
            execContext: mockExecContext as any,
            agentCallFactory: mockAgentCallFactory as any,
            agenticFlowTracker: agenticFlowTracker,
            agentsCatalog: mockAgentsCatalog as any,
        });
    });

    afterEach(() => {
        // Clean up
        mockAgentCallFactory.clear();
        mockAgentsCatalog.clear();
        mockAgentStatusTracker.clear();
        mockExecContext.config.messageBus.clear();
    });

    it("simple agent completion", async () => {
        // Setup: Register an agent
        const agentDef = new AgentDefinition();
        agentDef.taskId = "simple-task";

        mockAgentsCatalog.registerAgent(agentDef);

        // Configure the agent to return a completed response
        mockAgentCallFactory.setAgentResponse("simple-task", new AgentTaskResponse({ correlationId: "test-correlation", stopReason: "completed", taskOutput: { result: "success" } }));

        // Create a root task request
        const taskRequest = new AgentTaskRequest({
            command: { command: "start" },
            taskId: "simple-task",
            taskInputData: { input: "test" }
        });

        // Execute the task
        const response = await taskExecution.do(taskRequest);

        // Verify the response
        expect(response.stopReason).to.equal("completed");
        expect(response.taskOutput).to.deep.equal({ result: "success" });

        // Verify that the task was tracked
        const allTasks = mockAgentStatusTracker.getAllTasks();
        expect(allTasks).to.have.length(1);
        expect(allTasks[0].status).to.equal("completed");
        expect(allTasks[0].taskId).to.equal("simple-task");

        // Verify that correlationId and taskInstanceId were assigned
        expect(taskRequest.correlationId).to.exist;
        expect(taskRequest.taskInstanceId).to.exist;

        // Verify no subtasks were published
        expect(mockExecContext.config.messageBus.publishedTasks).to.have.length(0);

        // Verify the flow
        const expectedFlow = new AgenticFlow(taskRequest.correlationId!, new AgentNode({
            taskId: "simple-task",
            taskInstanceId: taskRequest.taskInstanceId!,
        }));

        const actualFlow = await agenticFlowTracker.getFlow(taskRequest.correlationId!);

        expect(actualFlow).to.deep.equal(expectedFlow);
    });

    it("group execution", async () => {
        // Setup: Register parent agent
        const parentAgentDef = new AgentDefinition();
        const childAgent1Def = new AgentDefinition();
        const childAgent2Def = new AgentDefinition();

        parentAgentDef.taskId = "orchestrator-task";
        childAgent1Def.taskId = "child-task-1";
        childAgent2Def.taskId = "child-task-2";

        mockAgentsCatalog.registerAgent(parentAgentDef);
        mockAgentsCatalog.registerAgent(childAgent1Def);
        mockAgentsCatalog.registerAgent(childAgent2Def);

        // Step 1: Configure parent agent to return subtasks
        const subtasksResponse = new AgentTaskResponse({
            correlationId: "test-correlation",
            stopReason: "subtasks",
            subtasks: [
                {
                    groupId: "group-1",
                    tasks: [
                        { taskId: "child-task-1", taskInputData: { childInput: "data1" } },
                        { taskId: "child-task-2", taskInputData: { childInput: "data2" } }
                    ]
                }
            ]
        });
        mockAgentCallFactory.setAgentResponse("orchestrator-task", subtasksResponse);

        // Execute the root task
        const rootTaskRequest = new AgentTaskRequest({
            command: { command: "start" },
            taskId: "orchestrator-task",
            correlationId: "test-correlation",
            taskInputData: { input: "root-data" }
        });

        const rootResponse = await taskExecution.do(rootTaskRequest);

        // Verify root response indicates subtasks were spawned
        expect(rootResponse.stopReason).to.equal("subtasks");
        expect(rootResponse.subtasks).to.have.length(1);

        // Verify subtasks were published to message bus
        expect(mockExecContext.config.messageBus.publishedTasks).to.have.length(2);

        // Verify subtasks have correct structure
        const publishedTask1 = mockExecContext.config.messageBus.publishedTasks[0];
        const publishedTask2 = mockExecContext.config.messageBus.publishedTasks[1];

        expect(publishedTask1.taskId).to.equal("child-task-1");
        expect(publishedTask1.correlationId).to.equal(rootTaskRequest.correlationId);
        expect(publishedTask1.parentTask?.taskInstanceId).to.equal(rootTaskRequest.taskInstanceId);
        expect(publishedTask1.taskGroupId).to.equal("group-1");

        expect(publishedTask2.taskId).to.equal("child-task-2");
        expect(publishedTask2.correlationId).to.equal(rootTaskRequest.correlationId);
        expect(publishedTask2.parentTask?.taskInstanceId).to.equal(rootTaskRequest.taskInstanceId);
        expect(publishedTask2.taskGroupId).to.equal("group-1");

        // Step 2: Execute first child task
        mockAgentCallFactory.setAgentResponse("child-task-1", new AgentTaskResponse({
            correlationId: "test-correlation",
            stopReason: "completed",
            taskOutput: { childResult: "result1" }
        }));

        const child1Response = await taskExecution.do(publishedTask1);
        expect(child1Response.stopReason).to.equal("completed");

        // Verify first child is marked completed but parent not resumed yet
        const child1Task = mockAgentStatusTracker.getAllTasks().find(t => t.taskId === "child-task-1");
        expect(child1Task?.status).to.equal("completed");

        // Parent should not be resumed yet (group not complete)
        expect(mockExecContext.config.messageBus.publishedTasks).to.have.length(2);

        // Step 3: Execute second child task
        mockAgentCallFactory.setAgentResponse("child-task-2", new AgentTaskResponse({
            correlationId: "test-correlation",
            stopReason: "completed",
            taskOutput: { childResult: "result2" }
        }));

        const child2Response = await taskExecution.do(publishedTask2);
        expect(child2Response.stopReason).to.equal("completed");

        // Verify second child is marked completed
        const child2Task = mockAgentStatusTracker.getAllTasks().find(t => t.taskId === "child-task-2");
        expect(child2Task?.status).to.equal("completed");

        // Now parent should be resumed (published as new task)
        expect(mockExecContext.config.messageBus.publishedTasks).to.have.length(3);
        const resumeTask = mockExecContext.config.messageBus.publishedTasks[2];
        expect(resumeTask.command.command).to.equal("resume");
        expect(resumeTask.command.completedTaskGroupId).to.equal("group-1");
        expect(resumeTask.taskId).to.equal("orchestrator-task");

        // Step 4: Configure parent agent to complete on resume
        mockAgentCallFactory.setAgentResponse("orchestrator-task", new AgentTaskResponse({
            correlationId: "test-correlation",
            stopReason: "completed",
            taskOutput: { finalResult: "all done" }
        }));

        // Execute the resume task
        const resumeResponse = await taskExecution.do(resumeTask);
        expect(resumeResponse.stopReason).to.equal("completed");
        expect(resumeResponse.taskOutput).to.deep.equal({ finalResult: "all done" });

        // Verify the original root task instance status
        const parentTask = mockAgentStatusTracker.getAllTasks().find(
            t => t.taskId === "orchestrator-task" && t.taskInstanceId === rootTaskRequest.taskInstanceId
        );
        // The original root instance should be completed after the branch is marked completed
        expect(parentTask?.status).to.equal("completed");

        // Verify the flow
        // Get the actual branchId from the published tasks
        const actualBranchId = publishedTask1.branchId!;

        const expectedFlow = new AgenticFlow(rootTaskRequest.correlationId!, new AgentNode({
            taskId: "orchestrator-task",
            taskInstanceId: rootTaskRequest.taskInstanceId!,
            next: new GroupNode({
                groupId: "group-1",
                agents: [
                    new AgentNode({ taskId: "child-task-1", taskInstanceId: publishedTask1.taskInstanceId! }),
                    new AgentNode({ taskId: "child-task-2", taskInstanceId: publishedTask2.taskInstanceId! })
                ]
            })
        }));

        const actualFlow = await agenticFlowTracker.getFlow(rootTaskRequest.correlationId!);

        expect(removePrev(actualFlow!)).to.deep.equal(removePrev(expectedFlow));
    });

    it("branching", async () => {

        const cid = 'branching-correlation-id'

        const orchestrator = new AgentDefinition();
        const a1 = new AgentDefinition();
        const a2 = new AgentDefinition();

        orchestrator.taskId = "orchestrator-task";
        a1.taskId = "task-1";
        a2.taskId = "task-2";

        mockAgentsCatalog.registerAgent(orchestrator);
        mockAgentsCatalog.registerAgent(a1);
        mockAgentsCatalog.registerAgent(a2);

        const orchestratorResponse1 = new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [
                {
                    groupId: "group-1",
                    tasks: [
                        { taskId: "task-1", taskInputData: { childInput: "data2" } }
                    ]
                },
                {
                    groupId: "group-2",
                    tasks: [
                        { taskId: "task-2", taskInputData: { childInput: "data3" } }
                    ]
                }
            ]
        });
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, orchestratorResponse1);

        // Execute the root task
        const rootTaskRequest = new AgentTaskRequest({
            command: { command: "start" },
            taskId: orchestrator.taskId,
            correlationId: cid,
            taskInputData: { input: "root-data" }
        });

        const rootResponse = await taskExecution.do(rootTaskRequest);

        // Get the published tasks and execute them 
        const publishedTask1 = mockExecContext.config.messageBus.publishedTasks[0];
        const publishedTask2 = mockExecContext.config.messageBus.publishedTasks[1];

        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "completed",
            taskOutput: { result: "a1 done" }
        }));
        mockAgentCallFactory.setAgentResponse(a2.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "completed",
            taskOutput: { result: "a2 done" }
        }));

        const response1 = await taskExecution.do(publishedTask1);
        const response2 = await taskExecution.do(publishedTask2);

        expect(response1.stopReason).to.equal("completed");
        expect(response2.stopReason).to.equal("completed");

        // Now parent should be resumed (published as new task)
        expect(mockExecContext.config.messageBus.publishedTasks).to.have.length(4); // the two subtasks + two resumes

        const resumeTask = mockExecContext.config.messageBus.publishedTasks[2];

        expect(resumeTask.command.command).to.equal("resume");
        expect(resumeTask.taskId).to.equal(orchestrator.taskId);

        // Step 4: Configure parent agent to complete on resume
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "completed",
            taskOutput: { finalResult: "all done" }
        }));

        // Execute the resume task
        const resumeResponse = await taskExecution.do(resumeTask);
        expect(resumeResponse.stopReason).to.equal("completed");
        expect(resumeResponse.taskOutput).to.deep.equal({ finalResult: "all done" });

        // Verify the flow
        const expectedFlow = new AgenticFlow(rootTaskRequest.correlationId!, new AgentNode({
            taskId: orchestrator.taskId,
            taskInstanceId: rootTaskRequest.taskInstanceId!,
            next: new BranchNode({
                branches: [
                    {
                        branchId: publishedTask1.branchId!,
                        branch: new AgentNode({ taskId: a1.taskId, taskInstanceId: publishedTask1.taskInstanceId! })
                    },
                    {
                        branchId: publishedTask2.branchId!,
                        branch: new AgentNode({ taskId: a2.taskId, taskInstanceId: publishedTask2.taskInstanceId! })
                    }
                ]
            })
        }));
        const actualFlow = await agenticFlowTracker.getFlow(cid);

        expect(removePrev(actualFlow!)).to.deep.equal(removePrev(expectedFlow));
    });

    it("group followed by branching", async () => {
        /**
         * Group followed by branching
         * An (orchestrator) agent spawns a group of agents, and upon their completion, spawns multiple branches.
         */

        const cid = 'branching-correlation-id'

        const msgBus = mockExecContext.config.messageBus;

        const orchestrator = new AgentDefinition();
        const a1 = new AgentDefinition();
        const a2 = new AgentDefinition();

        orchestrator.taskId = "orchestrator-task";
        a1.taskId = "task-1";
        a2.taskId = "task-2";

        mockAgentsCatalog.registerAgent(orchestrator);
        mockAgentsCatalog.registerAgent(a1);
        mockAgentsCatalog.registerAgent(a2);

        const orchestratorResponse1 = new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [
                {
                    groupId: "group-1",
                    tasks: [
                        { taskId: "task-1", taskInputData: { childInput: "data1.1" } },
                        { taskId: "task-1", taskInputData: { childInput: "data1.2" } },
                        { taskId: "task-1", taskInputData: { childInput: "data1.3" } }
                    ]
                },
            ]
        });
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, orchestratorResponse1);

        // Execute the root task
        const rootTaskRequest = new AgentTaskRequest({
            command: { command: "start" },
            taskId: orchestrator.taskId,
            correlationId: cid,
            taskInputData: { input: "root-data" }
        });

        await taskExecution.do(rootTaskRequest);

        expect(msgBus.publishedTasks).to.have.length(3);

        // Get the published tasks and execute them 
        const g1A1 = msgBus.publishedTasks[0];  // Published tasks are [0-2]: Group 1 G1: A1, A2, A3
        const g1A2 = msgBus.publishedTasks[1];
        const g1A3 = msgBus.publishedTasks[2];

        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "a1.1 done" } }));
        const response1 = await taskExecution.do(g1A1);
        expect(msgBus.publishedTasks).to.have.length(3); // the three subtasks - A2 and A3 not executed yet

        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "a1.2 done" } }));
        const response2 = await taskExecution.do(g1A2);
        expect(msgBus.publishedTasks).to.have.length(3); // the three subtasks - A3 not executed yet hence the group is not done

        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "a1.3 done" } }));
        const response3 = await taskExecution.do(g1A3);
        expect(msgBus.publishedTasks).to.have.length(4); // the three subtasks + 1 resume after G1 finished

        expect(response1.stopReason).to.equal("completed");
        expect(response2.stopReason).to.equal("completed");
        expect(response3.stopReason).to.equal("completed");
        expect(response1.taskOutput).to.deep.equal({ result: "a1.1 done" });
        expect(response2.taskOutput).to.deep.equal({ result: "a1.2 done" });
        expect(response3.taskOutput).to.deep.equal({ result: "a1.3 done" });

        // Step 4: Configure parent agent to spawn two branches on resume
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [
                {
                    groupId: "g1.1",
                    tasks: [
                        { taskId: "task-1", taskInputData: { childInput: "data2.1" } },
                        { taskId: "task-1", taskInputData: { childInput: "data2.2" } }
                    ]
                },
                {
                    groupId: "g1.2",
                    tasks: [
                        { taskId: "task-2", taskInputData: { childInput: "data3.1" } },
                        { taskId: "task-2", taskInputData: { childInput: "data3.2" } }
                    ]
                }
            ]
        }));

        const resumeAfterG1 = await taskExecution.do(msgBus.publishedTasks[3]);

        expect(resumeAfterG1.stopReason).to.equal("subtasks");
        expect(msgBus.publishedTasks).to.have.length(8); // [0-2] the three G1 subtasks + [3] resume after G1 + [4-7] two branches with 2 tasks each

        const branchOfGroupG11 = msgBus.publishedTasks[4].branchId;
        const branchOfGroupG12 = msgBus.publishedTasks[6].branchId;

        expect(branchOfGroupG11).to.exist;
        expect(branchOfGroupG12).to.exist;
        expect(branchOfGroupG11).to.not.equal(branchOfGroupG12);

        // Complete the g1.1 tasks
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "g1.1-a1.1 done" } }));
        await taskExecution.do(msgBus.publishedTasks[4]);

        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "g1.1-a1.2 done" } }));
        await taskExecution.do(msgBus.publishedTasks[5]);
        expect(msgBus.publishedTasks).to.have.length(9); // [8]: resume after g1.1

        // Resume after G1.1
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "Nothing to do after G1.1" } }));
        await taskExecution.do(msgBus.publishedTasks[8]);

        expect(await mockAgentStatusTracker.areBranchesCompleted([branchOfGroupG11!])).to.be.true;
        expect(await mockAgentStatusTracker.areBranchesCompleted([branchOfGroupG12!])).to.be.false;

        // Complete the g1.2 tasks
        mockAgentCallFactory.setAgentResponse(a2.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "g1.2-a2.1 done" } }));
        await taskExecution.do(msgBus.publishedTasks[6]);

        mockAgentCallFactory.setAgentResponse(a2.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "g1.2-a2.2 done" } }));
        await taskExecution.do(msgBus.publishedTasks[7]);
        expect(msgBus.publishedTasks).to.have.length(10); // [9]: resume after g1.2

        // Resume after G1.2
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "Nothing to do after G1.2" } }));
        await taskExecution.do(msgBus.publishedTasks[9]);

        // Now I expect branches  branch-g1.1 and branch-g1.2 to be done
        expect(await mockAgentStatusTracker.areBranchesCompleted([branchOfGroupG11!, branchOfGroupG12!])).to.be.true;

        // // Verify the flow
        const expectedFlow = new AgenticFlow(rootTaskRequest.correlationId!, new AgentNode({
            taskId: orchestrator.taskId,
            taskInstanceId: rootTaskRequest.taskInstanceId!,
            next: new GroupNode({
                groupId: "group-1",
                agents: [
                    new AgentNode({ taskId: "task-1", taskInstanceId: g1A1.taskInstanceId! }),
                    new AgentNode({ taskId: "task-1", taskInstanceId: g1A2.taskInstanceId! }),
                    new AgentNode({ taskId: "task-1", taskInstanceId: g1A3.taskInstanceId! })
                ],
                next: new BranchNode({
                    branches: [
                        {
                            branchId: branchOfGroupG11!,
                            branch: new GroupNode({
                                groupId: "g1.1",
                                agents: [
                                    new AgentNode({ taskId: "task-1", taskInstanceId: msgBus.publishedTasks[4].taskInstanceId! }),
                                    new AgentNode({ taskId: "task-1", taskInstanceId: msgBus.publishedTasks[5].taskInstanceId! })
                                ]
                            })
                        },
                        {
                            branchId: branchOfGroupG12!,
                            branch: new GroupNode({
                                groupId: "g1.2",
                                agents: [
                                    new AgentNode({ taskId: "task-2", taskInstanceId: msgBus.publishedTasks[6].taskInstanceId! }),
                                    new AgentNode({ taskId: "task-2", taskInstanceId: msgBus.publishedTasks[7].taskInstanceId! })
                                ]
                            })
                        }
                    ]
                })
            })
        }));
        const actualFlow = await agenticFlowTracker.getFlow(cid);

        expect(removePrev(actualFlow!)).to.deep.equal(removePrev(expectedFlow));
    });

    it("branch started within in a group", async () => {
        /**
         * 5. Branch started within in a group
         * An (orchestrator) agent spawns two branches. 
         * Within one branch, a group of agents is spawned.
         * Within that group, one of the agents spawns two branches. Each branch contains one agent.
         */

        const cid = 'branch-in-group-correlation-id';
        const msgBus = mockExecContext.config.messageBus;

        const orchestrator = new AgentDefinition();
        const a1 = new AgentDefinition();
        const a2 = new AgentDefinition();

        orchestrator.taskId = "orchestrator-task";
        a1.taskId = "task-1";
        a2.taskId = "task-2";

        mockAgentsCatalog.registerAgent(orchestrator);
        mockAgentsCatalog.registerAgent(a1);
        mockAgentsCatalog.registerAgent(a2);

        // Step 1: Orchestrator spawns two branches
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [
                {
                    groupId: "branch1-group", tasks: [
                        { taskId: "task-1", taskInputData: { input: "branch1-t1" } },
                        { taskId: "task-1", taskInputData: { input: "branch1-t2" } }
                    ]
                },
                { groupId: "branch2-group", tasks: [{ taskId: "task-2", taskInputData: { input: "branch2" } }] }
            ]
        }));

        const rootTaskRequest = new AgentTaskRequest({
            command: { command: "start" },
            taskId: orchestrator.taskId,
            correlationId: cid,
            taskInputData: { input: "root-data" }
        });

        await taskExecution.do(rootTaskRequest);
        expect(msgBus.publishedTasks).to.have.length(3);

        const branch1Task1 = msgBus.publishedTasks[0];
        const branch1Task2 = msgBus.publishedTasks[1];
        const branch2Task = msgBus.publishedTasks[2];
        const branch1Id = branch1Task1.branchId!;
        const branch2Id = branch2Task.branchId!;

        expect(branch1Id).to.exist;
        expect(branch2Id).to.exist;
        expect(branch1Id).to.not.equal(branch2Id);
        expect(branch1Task1.branchId).to.equal(branch1Task2.branchId);

        // Step 2: Complete branch2 (simple completion)
        mockAgentCallFactory.setAgentResponse(a2.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "branch2 done" } }));
        await taskExecution.do(branch2Task);
        expect(msgBus.publishedTasks).to.have.length(4); // +1 resume after branch2
        expect(await mockAgentStatusTracker.areBranchesCompleted([branch2Id])).to.be.false;

        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "Nothing after branch2" } }));
        await taskExecution.do(msgBus.publishedTasks[3]);
        expect(await mockAgentStatusTracker.areBranchesCompleted([branch2Id])).to.be.true;  // Branch is marked as complete only when the parent said "nothing more to do after branch"

        // Step 3: Complete branch1-task1 (simple completion)
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "branch1-t1 done" } }));
        await taskExecution.do(branch1Task1);
        expect(msgBus.publishedTasks).to.have.length(4); // No resume yet, group not complete

        // Step 4: branch1-task2 spawns two branches with 2 tasks each
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [
                {
                    groupId: "nested-branch1", tasks: [
                        { taskId: "task-1", taskInputData: { input: "nb1-t1" } },
                        { taskId: "task-1", taskInputData: { input: "nb1-t2" } }
                    ]
                },
                {
                    groupId: "nested-branch2", tasks: [
                        { taskId: "task-2", taskInputData: { input: "nb2-t1" } },
                        { taskId: "task-2", taskInputData: { input: "nb2-t2" } }
                    ]
                }
            ]
        }));

        await taskExecution.do(branch1Task2);
        expect(msgBus.publishedTasks).to.have.length(8); // +4 branch tasks

        const nb1T1 = msgBus.publishedTasks[4];
        const nb1T2 = msgBus.publishedTasks[5];
        const nb2T1 = msgBus.publishedTasks[6];
        const nb2T2 = msgBus.publishedTasks[7];
        const nestedBranch1Id = nb1T1.branchId!;
        const nestedBranch2Id = nb2T1.branchId!;

        expect(nestedBranch1Id).to.exist;
        expect(nestedBranch2Id).to.exist;
        expect(nestedBranch1Id).to.not.equal(nestedBranch2Id);

        // Step 5: Complete nested-branch1 tasks
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "nb1-t1 done" } }));
        await taskExecution.do(nb1T1);
        expect(msgBus.publishedTasks).to.have.length(8);

        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "nb1-t2 done" } }));
        await taskExecution.do(nb1T2);
        expect(msgBus.publishedTasks).to.have.length(9); // +1 resume
        expect(await agenticFlowTracker.isGroupDone(cid, "nested-branch1")).to.be.true;

        // Resuming B1T2 => nothing more to do after nested-branch1
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "Nothing after nb1" } }));
        await taskExecution.do(msgBus.publishedTasks[8]);
        expect(await mockAgentStatusTracker.areBranchesCompleted([nestedBranch1Id])).to.be.true;
        expect(await mockAgentStatusTracker.areBranchesCompleted([branch1Id])).to.be.false; // Because nested-branch2 is not done yet

        // Step 6: Complete nested-branch2 tasks
        mockAgentCallFactory.setAgentResponse(a2.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "nb2-t1 done" } }));
        await taskExecution.do(nb2T1);
        expect(msgBus.publishedTasks).to.have.length(9);
        expect(await mockAgentStatusTracker.areBranchesCompleted([nestedBranch2Id])).to.be.false;

        mockAgentCallFactory.setAgentResponse(a2.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "nb2-t2 done" } }));
        await taskExecution.do(nb2T2);
        expect(msgBus.publishedTasks).to.have.length(10); // +1 resume
        expect(await mockAgentStatusTracker.areBranchesCompleted([nestedBranch2Id])).to.be.false;

        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "Nothing after nb2" } }));
        await taskExecution.do(msgBus.publishedTasks[9]);
        expect(await mockAgentStatusTracker.areBranchesCompleted([nestedBranch1Id, nestedBranch2Id])).to.be.true;
        expect(await mockAgentStatusTracker.areBranchesCompleted([branch1Id])).to.be.true;

        expect(await agenticFlowTracker.isGroupDone(cid, "branch1-group")).to.be.true;

        // Step 7: Now branch1's group is complete, resume the orchestrator after branch1
        expect(msgBus.publishedTasks).to.have.length(11);
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "flow done" } }));
        await taskExecution.do(msgBus.publishedTasks[10]);
        expect(msgBus.publishedTasks).to.have.length(11);

        // Verify the flow
        const expectedFlow = new AgenticFlow(rootTaskRequest.correlationId!, new AgentNode({
            taskId: orchestrator.taskId,
            taskInstanceId: rootTaskRequest.taskInstanceId!,
            next: new BranchNode({
                branches: [
                    {
                        branchId: branch1Id,
                        branch: new GroupNode({
                            groupId: "branch1-group",
                            agents: [
                                new AgentNode({ taskId: "task-1", taskInstanceId: branch1Task1.taskInstanceId! }),
                                new AgentNode({
                                    taskId: "task-1",
                                    taskInstanceId: branch1Task2.taskInstanceId!,
                                    next: new BranchNode({
                                        branches: [
                                            {
                                                branchId: nestedBranch1Id,
                                                branch: new GroupNode({
                                                    groupId: "nested-branch1",
                                                    agents: [
                                                        new AgentNode({ taskId: "task-1", taskInstanceId: nb1T1.taskInstanceId! }),
                                                        new AgentNode({ taskId: "task-1", taskInstanceId: nb1T2.taskInstanceId! })
                                                    ]
                                                })
                                            },
                                            {
                                                branchId: nestedBranch2Id,
                                                branch: new GroupNode({
                                                    groupId: "nested-branch2",
                                                    agents: [
                                                        new AgentNode({ taskId: "task-2", taskInstanceId: nb2T1.taskInstanceId! }),
                                                        new AgentNode({ taskId: "task-2", taskInstanceId: nb2T2.taskInstanceId! })
                                                    ]
                                                })
                                            }
                                        ]
                                    })
                                })
                            ]
                        })
                    },
                    {
                        branchId: branch2Id,
                        branch: new AgentNode({ taskId: "task-2", taskInstanceId: branch2Task.taskInstanceId! })
                    }
                ]
            })
        }));

        const actualFlow = await agenticFlowTracker.getFlow(cid);
        expect(removePrev(actualFlow!)).to.deep.equal(removePrev(expectedFlow));
    });

    it("asymmetric branching", async () => {
        /**
         * 6. Asymmetric branching
         * An (orchestrator) agent spawns two branches.
         * - Branch 1 contains a group of two agents.
         *  - When this group completes, a single agent is spawned. 
         *  - When that agent completes, Branch 1 is considered complete.
         * - Branch 2 contains a group of 3 agents. 
         *  - When this group completes, Branch 2 is considered complete.
         */

        const cid = 'asymmetric-branching-correlation-id';
        const msgBus = mockExecContext.config.messageBus;

        const orchestrator = new AgentDefinition();
        const a1 = new AgentDefinition();
        const a2 = new AgentDefinition();

        orchestrator.taskId = "orchestrator-task";
        a1.taskId = "task-1";
        a2.taskId = "task-2";

        mockAgentsCatalog.registerAgent(orchestrator);
        mockAgentsCatalog.registerAgent(a1);
        mockAgentsCatalog.registerAgent(a2);

        // Step 1: Orchestrator spawns two branches
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [
                {
                    groupId: "branch1-group", tasks: [
                        { taskId: "task-1", taskInputData: { input: "b1-t1" } },
                        { taskId: "task-1", taskInputData: { input: "b1-t2" } }
                    ]
                },
                {
                    groupId: "branch2-group", tasks: [
                        { taskId: "task-2", taskInputData: { input: "b2-t1" } },
                        { taskId: "task-2", taskInputData: { input: "b2-t2" } },
                        { taskId: "task-2", taskInputData: { input: "b2-t3" } }
                    ]
                }
            ]
        }));

        const rootTaskRequest = new AgentTaskRequest({
            command: { command: "start" },
            taskId: orchestrator.taskId,
            correlationId: cid,
            taskInputData: { input: "root-data" }
        });

        await taskExecution.do(rootTaskRequest);
        expect(msgBus.publishedTasks).to.have.length(5);

        const b1T1 = msgBus.publishedTasks[0];
        const b1T2 = msgBus.publishedTasks[1];
        const b2T1 = msgBus.publishedTasks[2];
        const b2T2 = msgBus.publishedTasks[3];
        const b2T3 = msgBus.publishedTasks[4];

        const branch1Id = b1T1.branchId!;
        const branch2Id = b2T1.branchId!;

        expect(branch1Id).to.exist;
        expect(branch2Id).to.exist;
        expect(branch1Id).to.not.equal(branch2Id);
        expect(b1T1.branchId).to.equal(b1T2.branchId);
        expect(b2T1.branchId).to.equal(b2T2.branchId);
        expect(b2T1.branchId).to.equal(b2T3.branchId);

        // Step 2: Complete branch1 group
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "b1-t1 done" } }));
        await taskExecution.do(b1T1);
        expect(msgBus.publishedTasks).to.have.length(5);    // Length hasn't changed: [0-1] branch1 tasks, [2-4] branch2 tasks

        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "b1-t2 done" } }));
        await taskExecution.do(b1T2);
        expect(msgBus.publishedTasks).to.have.length(6); // +1 resume after branch1 group0: [0-1] branch1 tasks, [2-4] branch2 tasks, [5] resume after branch1 group

        const resumeCommand = msgBus.publishedTasks[5];
        expect(resumeCommand.command.command).to.equal("resume");
        expect(resumeCommand.command.completedTaskGroupId).to.equal("branch1-group");
        expect(resumeCommand.command.branchId).to.equal(branch1Id);

        // Step 3: Branch1 orchestrator spawns one more agent
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [{
                groupId: "branch1-final",
                tasks: [{ taskId: "task-1", taskInputData: { input: "b1-final" } }]
            }]
        }));

        await taskExecution.do(msgBus.publishedTasks[5]);
        expect(msgBus.publishedTasks).to.have.length(7); // +1 final task for branch1 - [0-1] branch1 tasks, [2-4] branch2 tasks, [5] resume after branch1 group, [6] branch1 final task

        const b1Final = msgBus.publishedTasks[6];
        expect(b1Final.branchId).to.equal(branch1Id);
        expect(await mockAgentStatusTracker.areBranchesCompleted([branch1Id])).to.be.false;

        // Step 4: Complete branch1 final task
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "b1-final done" } }));
        await taskExecution.do(b1Final);
        expect(msgBus.publishedTasks).to.have.length(8); // +1 resume - [0-1] branch1 tasks, [2-4] branch2 tasks, [5] resume after branch1 group, [6] branch1 final task, [7] resume after branch1 final task

        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "Nothing after branch1" } }));
        await taskExecution.do(msgBus.publishedTasks[7]);
        expect(await mockAgentStatusTracker.areBranchesCompleted([branch1Id])).to.be.true;
        expect(await mockAgentStatusTracker.areBranchesCompleted([branch2Id])).to.be.false;

        // Step 5: Complete branch2 group
        mockAgentCallFactory.setAgentResponse(a2.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "b2-t1 done" } }));
        await taskExecution.do(b2T1);
        expect(msgBus.publishedTasks).to.have.length(8);

        mockAgentCallFactory.setAgentResponse(a2.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "b2-t2 done" } }));
        await taskExecution.do(b2T2);
        expect(msgBus.publishedTasks).to.have.length(8);

        mockAgentCallFactory.setAgentResponse(a2.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "b2-t3 done" } }));
        await taskExecution.do(b2T3);
        expect(msgBus.publishedTasks).to.have.length(9); // +1 resume after branch2 group

        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "Nothing after branch2" } }));
        await taskExecution.do(msgBus.publishedTasks[8]);
        expect(await mockAgentStatusTracker.areBranchesCompleted([branch1Id, branch2Id])).to.be.true;

        // Verify the flow
        const expectedFlow = new AgenticFlow(rootTaskRequest.correlationId!, new AgentNode({
            taskId: orchestrator.taskId,
            taskInstanceId: rootTaskRequest.taskInstanceId!,
            next: new BranchNode({
                branches: [
                    {
                        branchId: branch1Id,
                        branch: new GroupNode({
                            groupId: "branch1-group",
                            agents: [
                                new AgentNode({ taskId: "task-1", taskInstanceId: b1T1.taskInstanceId! }),
                                new AgentNode({ taskId: "task-1", taskInstanceId: b1T2.taskInstanceId! })
                            ],
                            next: new AgentNode({ taskId: "task-1", taskInstanceId: b1Final.taskInstanceId! })
                        })
                    },
                    {
                        branchId: branch2Id,
                        branch: new GroupNode({
                            groupId: "branch2-group",
                            agents: [
                                new AgentNode({ taskId: "task-2", taskInstanceId: b2T1.taskInstanceId! }),
                                new AgentNode({ taskId: "task-2", taskInstanceId: b2T2.taskInstanceId! }),
                                new AgentNode({ taskId: "task-2", taskInstanceId: b2T3.taskInstanceId! })
                            ]
                        })
                    }
                ]
            })
        }));

        const actualFlow = await agenticFlowTracker.getFlow(cid);
        expect(removePrev(actualFlow!)).to.deep.equal(removePrev(expectedFlow));
    });

    it("deep nesting - multi-level hierarchy", async () => {
        /**
         * 7. Deep nesting (3+ levels)
         * Orchestrator -> Branch -> Group -> Agent spawns Branch -> Group -> Agent spawns Branch -> Single Agent
         */

        const cid = 'deep-nesting-correlation-id';
        const msgBus = mockExecContext.config.messageBus;

        const orchestrator = new AgentDefinition();
        const a1 = new AgentDefinition();

        orchestrator.taskId = "orchestrator-task";
        a1.taskId = "task-1";

        mockAgentsCatalog.registerAgent(orchestrator);
        mockAgentsCatalog.registerAgent(a1);

        // Level 1: Orchestrator spawns a branch with a group
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [{
                groupId: "level1-group",
                tasks: [
                    { taskId: "task-1", taskInputData: { level: "1-1" } },
                    { taskId: "task-1", taskInputData: { level: "1-2" } }
                ]
            }]
        }));

        const rootTaskRequest = new AgentTaskRequest({
            command: { command: "start" },
            taskId: orchestrator.taskId,
            correlationId: cid,
            taskInputData: { input: "root" }
        });

        await taskExecution.do(rootTaskRequest);
        expect(msgBus.publishedTasks).to.have.length(2);

        const l1T1 = msgBus.publishedTasks[0];
        const l1T2 = msgBus.publishedTasks[1];
        expect(l1T1.branchId!).to.be.undefined;

        // Complete l1T1 normally
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "l1-t1 done" } }));
        await taskExecution.do(l1T1);

        // Level 2: l1T2 spawns nested branch with group
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [{
                groupId: "level2-group",
                tasks: [
                    { taskId: "task-1", taskInputData: { level: "2-1" } },
                    { taskId: "task-1", taskInputData: { level: "2-2" } }
                ]
            }]
        }));

        await taskExecution.do(l1T2);
        expect(msgBus.publishedTasks).to.have.length(4);

        const l2T1 = msgBus.publishedTasks[2];
        const l2T2 = msgBus.publishedTasks[3];
        expect(l2T1.branchId!).to.be.undefined;

        // Complete l2T1 normally
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "l2-t1 done" } }));
        await taskExecution.do(l2T1);

        // Level 3: l2T2 spawns another branch with single agent
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [{
                groupId: "level3-group",
                tasks: [{ taskId: "task-1", taskInputData: { level: "3-1" } }]
            }]
        }));

        await taskExecution.do(l2T2);
        expect(msgBus.publishedTasks).to.have.length(5);

        const l3T1 = msgBus.publishedTasks[4];
        expect(l3T1.branchId!).to.be.undefined;

        // Complete level 3
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "l3-t1 done" } }));
        await taskExecution.do(l3T1);
        expect(msgBus.publishedTasks).to.have.length(6); // +1 resume

        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "Nothing after l3" } }));
        await taskExecution.do(msgBus.publishedTasks[5]);

        // At this point, level 3 is complete, and level 2 should be too. 
        expect(await agenticFlowTracker.isGroupDone(cid, "level2-group")).to.be.true;

        // Complete level 2 group (resume l2T2's parent)
        expect(msgBus.publishedTasks).to.have.length(7); // +1 resume after level2 group
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "Nothing after l2 group" } }));
        await taskExecution.do(msgBus.publishedTasks[6]);

        // Complete level 1 group (resume l1T2's parent)
        expect(msgBus.publishedTasks).to.have.length(8); // +1 resume after level1 group
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "All done" } }));
        await taskExecution.do(msgBus.publishedTasks[7]);

        // Verify flow structure
        const expectedFlow = new AgenticFlow(rootTaskRequest.correlationId!, new AgentNode({
            taskId: orchestrator.taskId,
            taskInstanceId: rootTaskRequest.taskInstanceId!,
            next: new GroupNode({
                groupId: "level1-group",
                agents: [
                    new AgentNode({ taskId: "task-1", taskInstanceId: l1T1.taskInstanceId! }),
                    new AgentNode({
                        taskId: "task-1",
                        taskInstanceId: l1T2.taskInstanceId!,
                        next: new GroupNode({
                            groupId: "level2-group",
                            agents: [
                                new AgentNode({ taskId: "task-1", taskInstanceId: l2T1.taskInstanceId! }),
                                new AgentNode({
                                    taskId: "task-1",
                                    taskInstanceId: l2T2.taskInstanceId!,
                                    next: new AgentNode({ taskId: "task-1", taskInstanceId: l3T1.taskInstanceId! })
                                })
                            ]
                        })
                    })
                ]
            })
        }));

        const actualFlow = await agenticFlowTracker.getFlow(cid);
        expect(removePrev(actualFlow!)).to.deep.equal(removePrev(expectedFlow));
    });

    it.skip("agent failure scenarios - NOT IMPLEMENTED", async () => {
        /**
         * 8. Tests various failure scenarios:
         * - Agent failure within a group
         * - Verifies the failure is tracked and flow stops appropriately
         */

        const cid = 'failure-correlation-id';
        const msgBus = mockExecContext.config.messageBus;

        const orchestrator = new AgentDefinition();
        const a1 = new AgentDefinition();

        orchestrator.taskId = "orchestrator-task";
        a1.taskId = "task-1";

        mockAgentsCatalog.registerAgent(orchestrator);
        mockAgentsCatalog.registerAgent(a1);

        // Orchestrator spawns a group
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [{
                groupId: "test-group",
                tasks: [
                    { taskId: "task-1", taskInputData: { input: "t1" } },
                    { taskId: "task-1", taskInputData: { input: "t2" } }
                ]
            }]
        }));

        const rootTaskRequest = new AgentTaskRequest({
            command: { command: "start" },
            taskId: orchestrator.taskId,
            correlationId: cid,
            taskInputData: { input: "root" }
        });

        await taskExecution.do(rootTaskRequest);
        expect(msgBus.publishedTasks).to.have.length(2);

        const t1 = msgBus.publishedTasks[0];
        const t2 = msgBus.publishedTasks[1];

        // First agent completes successfully
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "completed",
            taskOutput: { result: "t1 done" }
        }));
        await taskExecution.do(t1);

        const t1Task = mockAgentStatusTracker.getAllTasks().find(task => task.taskInstanceId === t1.taskInstanceId);
        expect(t1Task?.status).to.equal("completed");

        // Second agent fails
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "failed"
        }));
        const failureResponse = await taskExecution.do(t2);

        expect(failureResponse.stopReason).to.equal("failed");

        // Verify the failed task is tracked
        const t2Task = mockAgentStatusTracker.getAllTasks().find(task => task.taskInstanceId === t2.taskInstanceId);
        expect(t2Task?.status).to.equal("failed");

        // Verify no resume task was published (group didn't complete due to failure)
        expect(msgBus.publishedTasks).to.have.length(2);

        // Test root agent failure
        const failedRootRequest = new AgentTaskRequest({
            command: { command: "start" },
            taskId: orchestrator.taskId,
            correlationId: "root-failure-cid",
            taskInputData: { input: "root" }
        });

        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({
            correlationId: "root-failure-cid",
            stopReason: "failed"
        }));

        const rootFailureResponse = await taskExecution.do(failedRootRequest);
        expect(rootFailureResponse.stopReason).to.equal("failed");

        const rootTask = mockAgentStatusTracker.getAllTasks().find(
            task => task.taskInstanceId === failedRootRequest.taskInstanceId
        );
        expect(rootTask?.status).to.equal("failed");
    });

    it("multiple agents spawning branches within same group", async () => {
        /**
         * 9. Group contains 3 agents. Two of them spawn branches, one completes normally.
         * Tests concurrent branching from different agents in the same group.
         */

        const cid = 'multi-branch-group-correlation-id';
        const msgBus = mockExecContext.config.messageBus;

        const orchestrator = new AgentDefinition();
        const a1 = new AgentDefinition();

        orchestrator.taskId = "orchestrator-task";
        a1.taskId = "task-1";

        mockAgentsCatalog.registerAgent(orchestrator);
        mockAgentsCatalog.registerAgent(a1);

        // Orchestrator spawns a group of 3 agents
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [{
                groupId: "main-group",
                tasks: [
                    { taskId: "task-1", taskInputData: { input: "agent1" } },
                    { taskId: "task-1", taskInputData: { input: "agent2" } },
                    { taskId: "task-1", taskInputData: { input: "agent3" } }
                ]
            }]
        }));

        const rootTaskRequest = new AgentTaskRequest({
            command: { command: "start" },
            taskId: orchestrator.taskId,
            correlationId: cid,
            taskInputData: { input: "root" }
        });

        await taskExecution.do(rootTaskRequest);
        expect(msgBus.publishedTasks).to.have.length(3);

        const agent1 = msgBus.publishedTasks[0];
        const agent2 = msgBus.publishedTasks[1];
        const agent3 = msgBus.publishedTasks[2];
        const mainBranchId = agent1.branchId!;

        // Agent1 spawns branches
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [
                { groupId: "agent1-branch1", tasks: [{ taskId: "task-1", taskInputData: { input: "a1-b1" } }] },
                { groupId: "agent1-branch2", tasks: [{ taskId: "task-1", taskInputData: { input: "a1-b2" } }] }
            ]
        }));

        await taskExecution.do(agent1);
        expect(msgBus.publishedTasks).to.have.length(5);

        const a1B1 = msgBus.publishedTasks[3];
        const a1B2 = msgBus.publishedTasks[4];
        const agent1Branch1Id = a1B1.branchId!;
        const agent1Branch2Id = a1B2.branchId!;

        // Agent2 spawns branches
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [
                { groupId: "agent2-branch1", tasks: [{ taskId: "task-1", taskInputData: { input: "a2-b1" } }] }
            ]
        }));

        await taskExecution.do(agent2);
        expect(msgBus.publishedTasks).to.have.length(6);

        const a2B1 = msgBus.publishedTasks[5];
        const agent2Branch1Id = a2B1.branchId!;

        // Agent3 completes normally
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "completed",
            taskOutput: { result: "agent3 done" }
        }));

        await taskExecution.do(agent3);
        expect(msgBus.publishedTasks).to.have.length(6); // No resume yet, branches not complete

        // Complete agent1's branches
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "a1-b1 done" } }));
        await taskExecution.do(a1B1);
        expect(msgBus.publishedTasks).to.have.length(7); // +1 resume

        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "Nothing after a1-b1" } }));
        await taskExecution.do(msgBus.publishedTasks[6]);

        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "a1-b2 done" } }));
        await taskExecution.do(a1B2);
        expect(msgBus.publishedTasks).to.have.length(8); // +1 resume

        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "Nothing after a1-b2" } }));
        await taskExecution.do(msgBus.publishedTasks[7]);

        expect(await mockAgentStatusTracker.areBranchesCompleted([agent1Branch1Id, agent1Branch2Id])).to.be.true;

        // Complete agent2's branch
        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "a2-b1 done" } }));
        await taskExecution.do(a2B1);
        expect(msgBus.publishedTasks).to.have.length(9); // +1 resume

        mockAgentCallFactory.setAgentResponse(a1.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "Nothing after a2-b1" } }));
        await taskExecution.do(msgBus.publishedTasks[8]);

        expect(await mockAgentStatusTracker.areBranchesCompleted([agent2Branch1Id])).to.be.true;

        // Now the entire main group should be done, triggering orchestrator resume
        expect(msgBus.publishedTasks).to.have.length(10); // +1 resume after main group

        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "All done" } }));
        await taskExecution.do(msgBus.publishedTasks[9]);

        expect(await mockAgentStatusTracker.areBranchesCompleted([mainBranchId])).to.be.true;

        // Verify flow
        const expectedFlow = new AgenticFlow(rootTaskRequest.correlationId!, new AgentNode({
            taskId: orchestrator.taskId,
            taskInstanceId: rootTaskRequest.taskInstanceId!,
            next: new BranchNode({
                branches: [{
                    branchId: mainBranchId,
                    branch: new GroupNode({
                        groupId: "main-group",
                        agents: [
                            new AgentNode({
                                taskId: "task-1",
                                taskInstanceId: agent1.taskInstanceId!,
                                next: new BranchNode({
                                    branches: [
                                        { branchId: agent1Branch1Id, branch: new AgentNode({ taskId: "task-1", taskInstanceId: a1B1.taskInstanceId! }) },
                                        { branchId: agent1Branch2Id, branch: new AgentNode({ taskId: "task-1", taskInstanceId: a1B2.taskInstanceId! }) }
                                    ]
                                })
                            }),
                            new AgentNode({
                                taskId: "task-1",
                                taskInstanceId: agent2.taskInstanceId!,
                                next: new BranchNode({
                                    branches: [
                                        { branchId: agent2Branch1Id, branch: new AgentNode({ taskId: "task-1", taskInstanceId: a2B1.taskInstanceId! }) }
                                    ]
                                })
                            }),
                            new AgentNode({ taskId: "task-1", taskInstanceId: agent3.taskInstanceId! })
                        ]
                    })
                }]
            })
        }));

        const actualFlow = await agenticFlowTracker.getFlow(cid);
        expect(removePrev(actualFlow!)).to.deep.equal(removePrev(expectedFlow));
    });

    it.skip("sequential branching - NOT IMPLEMENTED", async () => {
        /**
         * 10. Sequential branching (future feature)
         * After one set of branches completes, orchestrator spawns a completely new set of branches.
         * This would require the system to support continuing execution after all branches complete.
         */
    });

    it.skip("diamond convergence pattern - NOT IMPLEMENTED", async () => {
        /**
         * 11. Diamond/convergence pattern (future feature)
         * Two branches that later converge to spawn the same follow-up work.
         * This would require the system to detect and handle convergence points.
         */
    });
});

