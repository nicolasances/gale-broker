// import { AgentsCatalog } from "../catalog/AgentsCatalog";
// import { AgentNotFoundError } from "../../model/error/AgentNotFoundError";
// import { AgentCall } from "../../api/AgentCall";
// import { ExecutionContext, TotoRuntimeError, ValidationError } from "toto-api-controller";
// import { GaleConfig } from "../../Config";
// import { TaskStatusRecord, TaskTracker } from "../tracking/AgentStatusTracker";
// import { AgentTaskRequest, AgentTaskResponse, TaskInfo, ParentTaskInfo } from "../../model/AgentTask";
// import { v4 as uuidv4 } from "uuid";
// import { getTaskExecutionScenario, isRootTaskFirstStart, isParentTaskResumption, isSubtaskStart } from "./TaskExecutionUtil";

// /**
//  * This class is responsible for executing tasks, by finding suitable Agents and delegating the execution to them.
//  * 
//  * The main steps involved in task execution are:
//  * 1. Finding an available Agent that can execute the task.
//  * 2. Sending the task to the Agent for execution.
//  * 3. Handling subtasks if the Agent indicates that more tasks need to be spawned.
//  * 
//  * Subtasks are spawned by publishing them to the Message Bus, allowing for asynchronous execution by other Agents.
//  */
// export class TaskExecution {

//     bearerToken: string;
//     execContext: ExecutionContext;
//     config: GaleConfig;
//     cid: string;

//     constructor(execContext: ExecutionContext, bearerToken: string) {
//         this.execContext = execContext;
//         this.bearerToken = bearerToken;
//         this.config = execContext.config as GaleConfig;
//         this.cid = execContext.cid ?? "";
//     }

//     /**
//      * Starts the execution of a task. 
//      * 
//      * 1. Find an available Agent that can execute the task.
//      * 2. Send the task to the Agent for execution.
//      * 
//      * @param taskId the unique identifier of the task to start. 
//      */
//     async startTask(task: AgentTaskRequest): Promise<AgentTaskResponse> {

//         const config = this.execContext.config as GaleConfig;
//         const cid = this.cid;
//         const logger = this.execContext.logger;

//         try {

//             const client = await config.getMongoClient();
//             const db = client.db(config.getDBName());

//             const taskTracker = new TaskTracker(db, this.execContext);

//             // 0. Find an available Agent that can execute the task.
//             const agent = await new AgentsCatalog(db, this.execContext).findAgentByTaskId(task.taskId);

//             if (!agent) throw new AgentNotFoundError(task.taskId);

//             logger.compute(cid, `[${agent.name}] - Task [${task.taskId} - ${task.taskInstanceId}] - Command [${JSON.stringify(task.command)}] - [RECEIVED TASK] - Correlation Id: ${task.correlationId}`, "info");

//             // 1. Pre-work
//             // 1.1. Assign a correlation Id if not present
//             if (!task.correlationId) task.correlationId = uuidv4();

//             // 1.2. Assign a task instance Id if not present
//             if (!task.taskInstanceId) task.taskInstanceId = uuidv4();

//             // Update tracking information 
//             if (isRootTaskFirstStart(task)) await taskTracker.trackRootTaskStarted(task, agent);
//             else if (isParentTaskResumption(task)) await taskTracker.trackRootTaskResumed(task, agent);
//             else if (isSubtaskStart(task)) await taskTracker.trackSubtaskStarted(task.taskInstanceId, agent);

//             // 2. Send the task to the Agent for execution.
//             logger.compute(cid, `[${agent.name}] - Task [${task.taskId} - ${task.taskInstanceId}] - Command [${JSON.stringify(task.command)}] - [SENDING TASK TO AGENT] - Correlation Id: ${task.correlationId}`, "info");

//             // 2.2. Call the agent
//             const agentTaskResponse: AgentTaskResponse = await new AgentCall(agent, this.execContext, this.bearerToken).execute(task, task.correlationId);

//             logger.compute(cid, `[${agent.name}] - Task [${task.taskId} - ${task.taskInstanceId}] - Command [${JSON.stringify(task.command)}] - [AGENT RESPONDED] - ${JSON.stringify(agentTaskResponse.stopReason)} - Correlation Id: ${task.correlationId}`, "info");

//             // 3. Track the task completion
//             await taskTracker.trackTaskCompletion(task.taskInstanceId, agentTaskResponse.stopReason!, agentTaskResponse.taskOutput);

//             // 4. Check the Stop Reason
//             // 4.1. If 'subtasks', then spawn the subtasks. 
//             if (agentTaskResponse.stopReason === 'subtasks') {

//                 if (!agentTaskResponse.subtasks || agentTaskResponse.subtasks.length === 0) return agentTaskResponse;

//                 logger.compute(cid, `[${agent.name}] - Task [${task.taskId} - ${task.taskInstanceId}] - Command [${JSON.stringify(task.command)}] - [SPAWNING ${agentTaskResponse.subtasks.length} SUBTASKS] - Correlation Id: ${task.correlationId}`, "info");

//                 await this.spawnSubtasks(agentTaskResponse.subtasks, {
//                     correlationId: task.correlationId!,
//                     taskId: task.taskId,
//                     taskInstanceId: task.taskInstanceId!
//                 }, taskTracker);
//             }

//             // 5. If this is a subtask running and it completed, check if all sibling subtasks are completed, and if so, notify the parent task.
//             if (task.parentTask && agentTaskResponse.stopReason === 'completed') {

//                 logger.compute(cid, `[${agent.name}] - Task [${task.taskId} - ${task.taskInstanceId}] - Command [${JSON.stringify(task.command)}] - [CHECKING SIBLINGS COMPLETION - Group ${task.subtaskGroupId}] - Correlation Id: ${task.correlationId}`, "info");

//                 // 5.1. Check if all sibling subtasks are completed
//                 const allSiblingsCompleted = await taskTracker.areSiblingsCompleted(task.parentTask.taskInstanceId, task.subtaskGroupId!);

//                 logger.compute(cid, `[${agent.name}] - Task [${task.taskId} - ${task.taskInstanceId}] - Command [${JSON.stringify(task.command)}] - [CHECKING SIBLINGS COMPLETION - Group ${task.subtaskGroupId}] - Result: ${allSiblingsCompleted} - Correlation Id: ${task.correlationId}`, "info");

//                 // 5.2. If so, update the parent task status 
//                 if (allSiblingsCompleted) {

//                     const mustNotifyParent = await taskTracker.flagParentAsChildrenCompleted(task.parentTask.taskInstanceId, task.subtaskGroupId!);

//                     // 5.3. If the parent task is now completed, notify the parent task's agent
//                     if (mustNotifyParent) {

//                         const subtaskGroupId = task.subtaskGroupId!;

//                         logger.compute(cid, `[${agent.name}] - Task [${task.taskId} - ${task.taskInstanceId}] - Command [${JSON.stringify(task.command)}] - [PARENT NOTIFICATION OF SUBTASKS COMPLETION - Group ${subtaskGroupId}] - Correlation Id: ${task.correlationId}`, "info");

//                         // Get the output data of all the completed child tasks to be able to send the output data to the parent task if needed
//                         const completedChildren = await taskTracker.findChildrenWithSubtaskGroupId(task.parentTask.taskInstanceId!, subtaskGroupId);

//                         const childrenOutputs: any[] = completedChildren.map(child => child.taskOutput);

//                         // Find the parent
//                         const parentTask = await taskTracker.findTaskByInstanceId(task.parentTask.taskInstanceId!);

//                         // Publish a message to notify the parent task's agent that all subtasks are completed. The parent task will be a NEW INSTANCE of the task (stateless, so with new task instance Id)
//                         const agentTaskRequest = new AgentTaskRequest({
//                             command: {
//                                 command: "resume",
//                                 completedSubtaskGroupId: subtaskGroupId
//                             },
//                             correlationId: task.correlationId!,
//                             taskId: task.parentTask.taskId,
//                             taskInstanceId: uuidv4(),   // Important: new instance of the parent task since stateless and should be tracked separately. 
//                             taskInputData: {
//                                 originalInput: parentTask?.taskInput.originalInput || parentTask?.taskInput,
//                                 childrenOutputs
//                             },
//                         });

//                         const bus = this.config.messageBus;

//                         await bus.publishTask(agentTaskRequest, this.cid);

//                         logger.compute(cid, `[${agent.name}] - Task [${task.taskId} - ${task.taskInstanceId}] - Command [${JSON.stringify(task.command)}] - [PARENT NOTIFICATION SENT] - Correlation Id: ${task.correlationId}`, "info");

//                     }
//                 }
//             }

//             return agentTaskResponse;

//         } catch (error) {

//             logger.compute(cid, `${error}`, "error")

//             if (error instanceof ValidationError || error instanceof TotoRuntimeError) {
//                 throw error;
//             }
//             else {
//                 console.log(error);
//                 throw error;
//             }

//         }

//     }

//     /**
//      * Spawns the given subtasks so that they can be asynchronously executed by the agents. 
//      * 
//      * This concretely uses the Message Bus to publish the subtask requests.
//      * 
//      * @param subtasks subtasks to be spawn off
//      */
//     private async spawnSubtasks(subtasks: TaskInfo[], parentTask: ParentTaskInfo, taskTracker: TaskTracker): Promise<void> {

//         const bus = this.config.messageBus;

//         let publishPromises: Promise<void>[] = [];

//         for (const subtask of subtasks) {

//             this.execContext.logger.compute(this.cid, `Spawning subtask [${subtask.taskId}].`, "info");

//             // 2. Track the subtask as 'started' in the tracking database
//             const taskStatus: TaskStatusRecord = await taskTracker.trackSubtaskRequested(subtask, parentTask);

//             // 1. Build the task request
//             const agentTaskRequest = new AgentTaskRequest({
//                 command: { command: "start" },
//                 correlationId: parentTask.correlationId,
//                 taskId: subtask.taskId,
//                 taskInstanceId: taskStatus.taskInstanceId,
//                 taskInputData: subtask.taskInputData,
//                 parentTask: parentTask,
//                 subtaskGroupId: subtask.subtasksGroupId
//             });

//             // Publish the subtask to the message bus
//             publishPromises.push(new Promise<void>(async (resolve, reject) => {

//                 try {

//                     // 1. Publish the task to the bus
//                     await bus.publishTask(agentTaskRequest, this.cid);

//                     this.execContext.logger.compute(this.cid, `Subtask [${subtask.taskId}] successfully spawned.`, "info");

//                     resolve();

//                 } catch (error) {
//                     this.execContext.logger.compute(this.cid, `Failed to spawn subtask [${subtask.taskId}]: ${error}`, "error");
//                     reject(error);
//                 }

//             }));

//         }

//         // Wait for all to be published
//         await Promise.all(publishPromises);

//     }
// }
