import { AgentTaskRequest } from "../../model/AgentTask";


export function getTaskExecutionScenario(task: AgentTaskRequest): "subtaskExecution" | "rootTaskStart" | "parentTaskResumption" {

    if (task.parentTask) return "subtaskExecution";

    if (task.command.command == 'resume') return "parentTaskResumption";

    return "rootTaskStart";
}

export function isRootTaskFirstStart(task: AgentTaskRequest): boolean {
    return getTaskExecutionScenario(task) === "rootTaskStart";
}

export function isParentTaskResumption(task: AgentTaskRequest): boolean {
    return getTaskExecutionScenario(task) === "parentTaskResumption";
}

export function isSubtaskStart(task: AgentTaskRequest): boolean {
    return getTaskExecutionScenario(task) === "subtaskExecution";
}