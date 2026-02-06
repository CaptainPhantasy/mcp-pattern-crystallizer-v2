/**
 * File-based task board storage for distributed agent coordination.
 * Maintains task graph with nodes = tasks, edges = dependencies.
 */

import * as fs from "fs/promises";
import * as path from "path";

export type TaskState = "pending" | "ready" | "in_progress" | "completed" | "blocked";

export interface Task {
  id: string;
  description: string;
  priority: number; // 1-10, higher = more important
  estimated_effort?: number; // In "effort units" (optional)
  state: TaskState;
  dependencies: string[]; // Task IDs this task depends on
  assignee?: string; // Agent who claimed this task
  claimed_at?: number;
  completed_at?: number;
  created: number;
  metadata?: Record<string, unknown>;
}

export interface ClaimResult {
  success: boolean;
  reason?: string;
  task?: Task;
}

export interface CompletionResult {
  newly_ready: string[];
  blocked_tasks: string[];
  completed_task: Task;
}

interface TaskBoardData {
  tasks: Task[];
  lastUpdated: number;
}

const STORAGE_DIR = process.env.NovelConceptsDataDir || path.join(process.env.HOME || ".", ".novel-concepts-mcp");
const STORAGE_FILE = path.join(STORAGE_DIR, "task-board.json");

/**
 * TaskBoard class for managing distributed tasks
 */
export class TaskBoard {
  private tasks: Map<string, Task>;
  private storagePath: string;

  constructor(storagePath?: string) {
    this.tasks = new Map();
    this.storagePath = storagePath || STORAGE_FILE;
  }

  /**
   * Initialize from storage
   */
  async init(): Promise<void> {
    try {
      const data = await fs.readFile(this.storagePath, "utf-8");
      const parsed: TaskBoardData = JSON.parse(data);
      this.tasks.clear();
      for (const task of parsed.tasks) {
        this.tasks.set(task.id, task);
      }
    } catch (error) {
      // File doesn't exist or is invalid - start fresh
      this.tasks.clear();
    }
  }

  /**
   * Save to storage
   */
  private async save(): Promise<void> {
    try {
      await fs.mkdir(STORAGE_DIR, { recursive: true });
      const data: TaskBoardData = {
        tasks: Array.from(this.tasks.values()),
        lastUpdated: Date.now()
      };
      await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (error) {
      console.error("Failed to save task board:", error);
    }
  }

  /**
   * Create a new task
   */
  async create(task: Omit<Task, "state" | "dependencies" | "created"> & { dependencies?: string[] }): Promise<Task> {
    const newTask: Task = {
      ...task,
      state: "pending",
      dependencies: task.dependencies || [],
      created: Date.now()
    };

    this.tasks.set(newTask.id, newTask);
    await this.updateTaskState(newTask.id);
    await this.save();

    return newTask;
  }

  /**
   * Update task state based on dependencies
   */
  private async updateTaskState(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // Check if all dependencies are completed
    const depsCompleted = task.dependencies.every(depId => {
      const dep = this.tasks.get(depId);
      return dep?.state === "completed";
    });

    if (depsCompleted && task.state === "pending") {
      task.state = "ready";
    } else if (!depsCompleted && task.state === "ready") {
      task.state = "pending";
    }

    // Check for newly ready dependent tasks when completing
    if (task.state === "completed") {
      task.completed_at = Date.now();
    }
  }

  /**
   * Get ready tasks (dependencies satisfied, not yet claimed)
   */
  getReadyTasks(): Task[] {
    return Array.from(this.tasks.values())
      .filter(t => t.state === "ready" && !t.assignee)
      .sort((a, b) => b.priority - a.priority); // Higher priority first
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Claim a task for an agent
   */
  async claimTask(taskId: string, agentId: string): Promise<ClaimResult> {
    const task = this.tasks.get(taskId);

    if (!task) {
      return { success: false, reason: "Task not found" };
    }

    if (task.state !== "ready") {
      return { success: false, reason: `Task is not ready (current state: ${task.state})` };
    }

    if (task.assignee) {
      return { success: false, reason: `Task already claimed by ${task.assignee}` };
    }

    // Claim the task
    task.assignee = agentId;
    task.state = "in_progress";
    task.claimed_at = Date.now();

    await this.save();

    return { success: true, task };
  }

  /**
   * Complete a task
   */
  async completeTask(taskId: string): Promise<CompletionResult> {
    const task = this.tasks.get(taskId);

    if (!task) {
      throw new Error("Task not found");
    }

    if (task.state !== "in_progress") {
      throw new Error(`Task is not in progress (current state: ${task.state})`);
    }

    task.state = "completed";
    task.completed_at = Date.now();

    // Find tasks that depend on this one and update their states
    const newlyReady: string[] = [];
    const blockedTasks: string[] = [];

    for (const [id, t] of this.tasks.entries()) {
      if (t.dependencies.includes(taskId)) {
        await this.updateTaskState(id);
        if (t.state === "ready") {
          newlyReady.push(id);
        } else {
          blockedTasks.push(id);
        }
      }
    }

    await this.save();

    return {
      newly_ready: newlyReady,
      blocked_tasks: blockedTasks,
      completed_task: task
    };
  }

  /**
   * Add dependency between tasks
   */
  async addDependency(taskId: string, dependsOnTaskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    const depTask = this.tasks.get(dependsOnTaskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (!depTask) {
      throw new Error(`Dependency task not found: ${dependsOnTaskId}`);
    }

    // Check for circular dependency
    if (this.wouldCreateCycle(taskId, dependsOnTaskId)) {
      throw new Error("Adding this dependency would create a circular dependency");
    }

    if (!task.dependencies.includes(dependsOnTaskId)) {
      task.dependencies.push(dependsOnTaskId);
      await this.updateTaskState(taskId);
      await this.save();
    }
  }

  /**
   * Check if adding a dependency would create a cycle
   */
  private wouldCreateCycle(from: string, to: string): boolean {
    // BFS to see if we can reach 'from' starting from 'to'
    const visited = new Set<string>();
    const queue = [to];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === from) {
        return true; // Cycle detected
      }

      if (visited.has(current)) continue;
      visited.add(current);

      const currentTask = this.tasks.get(current);
      if (currentTask) {
        queue.push(...currentTask.dependencies);
      }
    }

    return false;
  }

  /**
   * Get all tasks
   */
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get tasks by state
   */
  getTasksByState(state: TaskState): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.state === state);
  }

  /**
   * Get tasks for an agent
   */
  getAgentTasks(agentId: string): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.assignee === agentId);
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<void> {
    if (!this.tasks.has(taskId)) {
      throw new Error("Task not found");
    }

    // Check if any tasks depend on this one
    for (const task of this.tasks.values()) {
      if (task.dependencies.includes(taskId)) {
        throw new Error(`Cannot delete task: other tasks depend on it`);
      }
    }

    this.tasks.delete(taskId);
    await this.save();
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    byState: Record<TaskState, number>;
    assigned: number;
    unassigned: number;
  } {
    const tasks = Array.from(this.tasks.values());
    const byState: Record<TaskState, number> = {
      pending: 0,
      ready: 0,
      in_progress: 0,
      completed: 0,
      blocked: 0
    };

    for (const task of tasks) {
      byState[task.state]++;
    }

    const assigned = tasks.filter(t => t.assignee).length;

    return {
      total: tasks.length,
      byState,
      assigned,
      unassigned: tasks.length - assigned
    };
  }

  /**
   * Clear all tasks
   */
  async clear(): Promise<void> {
    this.tasks.clear();
    await this.save();
  }
}

// Singleton instance
let taskBoardInstance: TaskBoard | null = null;

export async function getTaskBoard(): Promise<TaskBoard> {
  if (!taskBoardInstance) {
    taskBoardInstance = new TaskBoard();
    await taskBoardInstance.init();
  }
  return taskBoardInstance;
}
