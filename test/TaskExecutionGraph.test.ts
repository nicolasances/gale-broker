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
                next: {
                    groupId: "g1",
                    nodes: [
                        { record: t2, next: null },
                        { record: t3, next: null }
                    ], 
                    next: null
                }
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
                next: {
                    groupId: "g1",
                    nodes: [
                        { record: t2, next: null },
                        { record: t3, next: null }
                    ], 
                    next: { record: t2resumed, next: null}
                }
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
                next: {
                    groupId: "g1",
                    nodes: [
                        { record: t2, next: null },
                        { record: t3, next: {
                            groupId: "g2",
                            nodes: [
                                { record: t4, next: null}
                            ], 
                            next: { record: t3resumed, next: null}
                        } }
                    ], 
                    next: { record: t2resumed, next: null }
                }
            }
        }

        // Verify the graph structure
        expect(graph).to.not.be.null;
        expect(graph).to.be.deep.equal(expected);

    });

});
