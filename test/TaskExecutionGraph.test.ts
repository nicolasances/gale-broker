import { expect } from "chai";
import { TaskExecutionGraph, SubtaskGroupNode, TaskExecutionGraphNode } from "../src/util/TaskExecutionGraph";
import { TaskStatusRecord } from "../src/core/tracking/TaskTracker";

describe("TaskExecutionGraph", () => {

    it("should build a graph with a single root task", () => {
        // Create a simple task record
        const rootTask: TaskStatusRecord = { correlationId: "1", taskId: "root", taskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a" };

        // Build the graph
        const graph = TaskExecutionGraph.buildGraphFromRecords([rootTask]);

        const expected: TaskExecutionGraph = {
            rootNode: {
                record: rootTask,
                next: null
            }
        };

        // Verify the graph structure
        expect(graph).to.not.be.null;
        expect(graph).to.be.deep.equal(expected);
    });

    it("should build a graph with root and 2 children", () => {

        const t1: TaskStatusRecord = { correlationId: "1", taskId: "root", taskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a" };
        const t2: TaskStatusRecord = { correlationId: "1", taskId: "a", taskInstanceId: "2", parentTaskInstanceId: "1", subtaskGroupId: "g1", startedAt: new Date(), status: "completed", taskInput: "a" };
        const t3: TaskStatusRecord = { correlationId: "1", taskId: "a", taskInstanceId: "3", parentTaskInstanceId: "1", subtaskGroupId: "g1", startedAt: new Date(), status: "completed", taskInput: "a" };

        // Build the graph
        const graph = TaskExecutionGraph.buildGraphFromRecords([t1, t2, t3]);

        const expected: TaskExecutionGraph = {
            rootNode: {
                record: t1,
                next: [{
                    groupId: "g1",
                    nodes: [
                        { record: t2, next: null },
                        { record: t3, next: null }
                    ],
                    next: null
                }]
            }
        }

        // Verify the graph structure
        expect(graph).to.not.be.null;
        expect(graph).to.be.deep.equal(expected);
    });

    it("should build a graph with root and 2 children that resume (consolidate into) the root", () => {

        const t1: TaskStatusRecord = { correlationId: "1", taskId: "root", taskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a" };
        const t2: TaskStatusRecord = { correlationId: "1", taskId: "a", taskInstanceId: "2", parentTaskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a", subtaskGroupId: "g1" };
        const t3: TaskStatusRecord = { correlationId: "1", taskId: "a", taskInstanceId: "3", parentTaskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a", subtaskGroupId: "g1" };
        const t2resumed: TaskStatusRecord = { correlationId: "1", taskId: "root", taskInstanceId: "4", resumedAfterSubtasksGroupId: "g1", startedAt: new Date(), status: "completed", taskInput: "a" };

        // Build the graph
        const graph = TaskExecutionGraph.buildGraphFromRecords([t1, t2, t3, t2resumed]);

        const expected: TaskExecutionGraph = {
            rootNode: {
                record: t1,
                next: [{
                    groupId: "g1",
                    nodes: [
                        { record: t2, next: null },
                        { record: t3, next: null }
                    ],
                    next: { record: t2resumed, next: null }
                }]
            }
        }

        // Verify the graph structure
        expect(graph).to.not.be.null;
        expect(graph).to.be.deep.equal(expected);
    });

    it("should build a graph with two subtrees", () => {

        const t1: TaskStatusRecord = { correlationId: "1", taskId: "root", taskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a" };
        const t2: TaskStatusRecord = { correlationId: "1", taskId: "a", taskInstanceId: "2", parentTaskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a", subtaskGroupId: "g1" };
        const t3: TaskStatusRecord = { correlationId: "1", taskId: "a", taskInstanceId: "3", parentTaskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a", subtaskGroupId: "g1" };
        const t4: TaskStatusRecord = { correlationId: "1", taskId: "b", taskInstanceId: "4", parentTaskInstanceId: "3", startedAt: new Date(), status: "completed", taskInput: "a", subtaskGroupId: "g2" };
        const t3resumed: TaskStatusRecord = { correlationId: "1", taskId: "a", taskInstanceId: "5", resumedAfterSubtasksGroupId: "g2", startedAt: new Date(), status: "completed", taskInput: "a" };
        const t2resumed: TaskStatusRecord = { correlationId: "1", taskId: "root", taskInstanceId: "6", resumedAfterSubtasksGroupId: "g1", startedAt: new Date(), status: "completed", taskInput: "a" };

        // Build the graph
        const graph = TaskExecutionGraph.buildGraphFromRecords([t1, t2, t3, t4, t3resumed, t2resumed]);
        const expected: TaskExecutionGraph = {
            rootNode: {
                record: t1,
                next: [{
                    groupId: "g1",
                    nodes: [
                        { record: t2, next: null },
                        {
                            record: t3, next: [{
                                groupId: "g2",
                                nodes: [
                                    { record: t4, next: null }
                                ],
                                next: { record: t3resumed, next: null }
                            }]
                        }
                    ],
                    next: { record: t2resumed, next: null }
                }]
            }
        }

        // Verify the graph structure
        expect(graph).to.not.be.null;
        expect(graph).to.be.deep.equal(expected);

    });

    it("should build a graph with root and 2 subgroups with 2 children each", () => {

        const t1: TaskStatusRecord = { correlationId: "1", taskId: "root", taskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a" };

        const s1t1: TaskStatusRecord = { correlationId: "1", taskId: "a", taskInstanceId: "2", parentTaskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a", subtaskGroupId: "g1" };
        const s1t2: TaskStatusRecord = { correlationId: "1", taskId: "a", taskInstanceId: "3", parentTaskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a", subtaskGroupId: "g1" };

        const s2t1: TaskStatusRecord = { correlationId: "1", taskId: "b", taskInstanceId: "4", parentTaskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a", subtaskGroupId: "g2" };
        const s2t2: TaskStatusRecord = { correlationId: "1", taskId: "b", taskInstanceId: "5", parentTaskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a", subtaskGroupId: "g2" };

        // Build the graph
        const graph = TaskExecutionGraph.buildGraphFromRecords([t1, s1t1, s1t2, s2t1, s2t2]);

        const expected: TaskExecutionGraph = {
            rootNode: {
                record: t1,
                next: [
                    {
                        groupId: "g1",
                        nodes: [
                            { record: s1t1, next: null },
                            { record: s1t2, next: null }
                        ],
                        next: null
                    }, 
                    {
                        groupId: "g2",
                        nodes: [
                            { record: s2t1, next: null },
                            { record: s2t2, next: null }
                        ],
                        next: null
                    }
                ]
            }
        }

        // Verify the graph structure
        expect(graph).to.not.be.null;
        expect(graph).to.be.deep.equal(expected);
    });

    it("should build a graph with root and 2 subgroups with 2 children eac that consolidate", () => {

        const t1: TaskStatusRecord = { correlationId: "1", taskId: "root", taskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a" };

        const s1t1: TaskStatusRecord = { correlationId: "1", taskId: "a", taskInstanceId: "2", parentTaskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a", subtaskGroupId: "g1" };
        const s1t2: TaskStatusRecord = { correlationId: "1", taskId: "a", taskInstanceId: "3", parentTaskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a", subtaskGroupId: "g1" };
        const s1Res: TaskStatusRecord = { correlationId: "1", taskId: "root", taskInstanceId: "6", startedAt: new Date(), status: "completed", taskInput: "a", resumedAfterSubtasksGroupId: "g1" };

        const s2t1: TaskStatusRecord = { correlationId: "1", taskId: "b", taskInstanceId: "4", parentTaskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a", subtaskGroupId: "g2" };
        const s2t2: TaskStatusRecord = { correlationId: "1", taskId: "b", taskInstanceId: "5", parentTaskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a", subtaskGroupId: "g2" };
        const s2Res: TaskStatusRecord = { correlationId: "1", taskId: "root", taskInstanceId: "7", startedAt: new Date(), status: "completed", taskInput: "a", resumedAfterSubtasksGroupId: "g2" };

        // Build the graph
        const graph = TaskExecutionGraph.buildGraphFromRecords([t1, s1t1, s1t2, s2t1, s2t2, s1Res, s2Res]);

        const expected: TaskExecutionGraph = {
            rootNode: {
                record: t1,
                next: [
                    {
                        groupId: "g1",
                        nodes: [
                            { record: s1t1, next: null },
                            { record: s1t2, next: null }
                        ],
                        next: {
                            record: s1Res,
                            next: null
                        }
                    }, 
                    {
                        groupId: "g2",
                        nodes: [
                            { record: s2t1, next: null },
                            { record: s2t2, next: null }
                        ],
                        next: {
                            record: s2Res,
                            next: null
                        }
                    }
                ]
            }
        }

        // Verify the graph structure
        expect(graph).to.not.be.null;
        expect(graph).to.be.deep.equal(expected);
    });

});
