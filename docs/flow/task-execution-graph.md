# Building the Task Execution Graph

## Overview

The Task Execution Graph is an in-memory tree structure that represents the execution flow of tasks and their subtasks. It reconstructs the hierarchy and sequence of task executions from a flat list of task status records.

![Task Execution Flow](flow.drawio.svg)

## Core Elements

### TaskStatusRecord
A `TaskStatusRecord` represents a single task execution instance. Key fields include:
- **taskInstanceId**: Unique identifier for this specific execution instance
- **taskId**: The type/name of the task being executed
- **parentTaskInstanceId**: Links to the parent task that spawned this task (if any)
- **subtaskGroupId**: Groups together multiple subtasks spawned from the same parent
- **resumedAfterSubtasksGroupId**: Indicates this task resumed execution after a group of subtasks completed
- **correlationId**: Links all tasks in the same execution flow

### TaskExecutionGraphNode
Represents a single node in the execution graph. Contains:
- **record**: The TaskStatusRecord for this execution
- **next**: Either a SubtaskGroupNode (if this task spawned subtasks), another TaskExecutionGraphNode (if execution continued), or null (if this is a leaf node)

### SubtaskGroupNode
Represents a collection of parallel subtasks spawned by a parent task. Contains:
- **groupId**: The identifier linking these subtasks to their parent
- **nodes**: Array of TaskExecutionGraphNode instances (the parallel subtasks)
- **next**: What happens after this group completes - either the parent resumes (TaskExecutionGraphNode) or null

## Graph Building Logic

### Finding the Root
The graph building process starts by identifying the root task - the single record that has:
- No `parentTaskInstanceId` (it wasn't spawned by another task)
- No `resumedAfterSubtasksGroupId` (it's not a resumption)

Only one root record should exist per correlation ID.

### Building the Tree Structure

The graph is built recursively using these key rules:

1. **Parent-Child Relationships**: For each node, find all records where `parentTaskInstanceId` matches the current node's `taskInstanceId`. These become child nodes.

2. **Subtask Grouping**: When children are found, they are grouped together in a `SubtaskGroupNode` using their `subtaskGroupId`. All subtasks spawned from the same parent share the same group ID.

3. **Task Resumption**: After a subtask group completes, the parent task may resume. This is identified by finding a record where `resumedAfterSubtasksGroupId` matches the group's ID. This resumed task becomes the `next` node after the subtask group.<br>
The logic here is that **resumed tasks** are basically a new instance of the parent agent being run but with as input a "resume" command and the `subtaskGroupId` to identify the point of the process to start on. 

4. **Recursive Building**: The process repeats for each child node, building their own subtrees, creating a complete hierarchical representation.


## Key Design Principles

- **Flat to Hierarchical**: The graph transforms a flat list of execution records into a tree that reveals the actual execution structure
- **Preservation of Sequence**: The `next` pointers maintain the temporal sequence of task executions
- **Parallel Representation**: SubtaskGroupNodes explicitly represent parallel execution branches
- **Resumption Tracking**: The distinction between spawning subtasks and resuming after them is preserved through separate node types and linking mechanisms

