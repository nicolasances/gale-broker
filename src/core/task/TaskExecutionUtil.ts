import { AgentTaskRequest } from "../../model/AgentTask";


export function getTaskExecutionScenario(task: AgentTaskRequest): "subtaskExecution" | "rootTaskStart" | "rootTaskResumption" {

    if (task.parentTask) return "subtaskExecution";

    if (task.command.command == 'resume') return "rootTaskResumption";

    return "rootTaskStart";
}

export function isRootTaskFirstStart(task: AgentTaskRequest): boolean {
    return getTaskExecutionScenario(task) === "rootTaskStart";
}

export function isRootTaskResumption(task: AgentTaskRequest): boolean {
    return getTaskExecutionScenario(task) === "rootTaskResumption";
}

export function isSubtaskStart(task: AgentTaskRequest): boolean {
    return getTaskExecutionScenario(task) === "subtaskExecution";
}