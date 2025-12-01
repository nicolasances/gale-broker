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
import e from "express";

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
 * 4. Branching with groups
 * An (orchestrator) agent spawns multiple branches, each containing a group of agents.
 * 
 * 5. Group followed by branching
 * An (orchestrator) agent spawns a group of agents, and upon their completion, spawns multiple branches.
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
            next: new BranchNode({
                branches: [{
                    branchId: actualBranchId,
                    branch: new GroupNode({
                        groupId: "group-1",
                        agents: [
                            new AgentNode({ taskId: "child-task-1", taskInstanceId: publishedTask1.taskInstanceId! }),
                            new AgentNode({ taskId: "child-task-2", taskInstanceId: publishedTask2.taskInstanceId! })
                        ]
                    })
                }]
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

        const rootResponse = await taskExecution.do(rootTaskRequest);

        expect(msgBus.publishedTasks).to.have.length(3);

        const branchG1 = msgBus.publishedTasks[0].branchId;

        expect(branchG1).to.exist;

        // Get the published tasks and execute them 
        const g1A1 = msgBus.publishedTasks[0];
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
        expect(msgBus.publishedTasks).to.have.length(4); // the three subtasks + 1 resume after G1

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
        expect(await mockAgentStatusTracker.areBranchesCompleted([branchG1!])).to.be.false;

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
        
        // Expect the main branch to be done since the two others are done
        expect(await mockAgentStatusTracker.areBranchesCompleted([branchG1!])).to.be.true;

        // // Verify the flow
        const expectedFlow = new AgenticFlow(rootTaskRequest.correlationId!, new AgentNode({
            taskId: orchestrator.taskId,
            taskInstanceId: rootTaskRequest.taskInstanceId!,
            next: new BranchNode({
                branches: [
                    {
                        branchId: branchG1!,
                        branch: new GroupNode({
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
                    },
                ]
            })
        }));
        const actualFlow = await agenticFlowTracker.getFlow(cid);

        expect(removePrev(actualFlow!)).to.deep.equal(removePrev(expectedFlow));
    });
});
