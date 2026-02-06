/**
 * distributed_task_board tool
 * Coordinates work on a shared task board with explicit dependencies.
 * Applies Concept-Sync pattern: dependency relationships are explicit.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getTaskBoard, TaskState } from "../storage/tasks.js";

// Zod schemas for validation
export const TaskInputSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  priority: z.number().int().min(1).max(10),
  estimated_effort: z.number().min(1).optional(),
  assignee: z.string().optional()
});

export const DistributedTaskBoardInputSchema = z.object({
  action: z.enum([
    "create_task",
    "claim_task",
    "complete_task",
    "get_ready_tasks",
    "add_dependency",
    "get_task",
    "get_stats",
    "list_tasks",
    "get_agent_tasks",
    "delete_task"
  ]),
  task: TaskInputSchema.optional(),
  task_id: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  agent_id: z.string().optional(),
  state: z.enum(["pending", "ready", "in_progress", "completed", "blocked"]).optional()
});

export type DistributedTaskBoardInput = z.infer<typeof DistributedTaskBoardInputSchema>;

// JSON Schema for MCP
export const distributedTaskBoardDefinition: Tool = {
  name: "distributed_task_board",
  description: `Coordinate work on a shared task board with explicit dependencies between tasks.

This tool implements the Concept-Sync pattern, ensuring dependency relationships are explicit and
visible to all agents. Tasks have states: pending, ready (dependencies satisfied), in_progress,
completed, or blocked.

**Task States:**
- \`pending\`: Created but dependencies not yet satisfied
- \`ready\`: All dependencies completed, available to be claimed
- \`in_progress\`: Claimed by an agent, being worked on
- \`completed\`: Finished, may unlock dependent tasks
- \`blocked\`: Dependencies include a failed/missing task

**Actions:**

- **create_task**: Create a new task with optional priority (1-10, higher = more important)
- **claim_task**: Agent claims a ready task (prevents duplicate work)
- **complete_task**: Mark a task as complete (may unlock dependent tasks)
- **get_ready_tasks**: Get all tasks whose dependencies are satisfied
- **add_dependency**: Add a dependency relationship between tasks
- **get_task**: Get details of a specific task
- **get_stats**: Get task board statistics
- **list_tasks**: List all tasks (optionally filtered by state)
- **get_agent_tasks**: Get all tasks assigned to an agent
- **delete_task**: Remove a task (only if no other tasks depend on it)

**Examples:**

Create tasks with dependencies:
\`\`\`json
{
  "action": "create_task",
  "task": {
    "id": "design_schema",
    "description": "Design database schema for user authentication",
    "priority": 10,
    "estimated_effort": 3
  }
}
\`\`\`

Add dependency:
\`\`\`json
{
  "action": "add_dependency",
  "task_id": "implement_user_model",
  "dependencies": ["design_schema"]
}
\`\`\`

Claim a task:
\`\`\`json
{
  "action": "claim_task",
  "task_id": "design_schema",
  "agent_id": "agent_1"
}
\`\`\`

Complete a task:
\`\`\`json
{
  "action": "complete_task",
  "task_id": "design_schema"
}
\`\`\``,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "create_task",
          "claim_task",
          "complete_task",
          "get_ready_tasks",
          "add_dependency",
          "get_task",
          "get_stats",
          "list_tasks",
          "get_agent_tasks",
          "delete_task"
        ],
        description: "The action to perform on the task board"
      },
      task: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Unique task identifier"
          },
          description: {
            type: "string",
            description: "Human-readable description of the task"
          },
          priority: {
            type: "number",
            minimum: 1,
            maximum: 10,
            description: "Priority level (1-10, higher = more important)"
          },
          estimated_effort: {
            type: "number",
            minimum: 1,
            description: "Estimated effort in abstract units"
          },
          assignee: {
            type: "string",
            description: "Preferred agent ID for this task"
          }
        },
        required: ["id", "description", "priority"]
      },
      task_id: {
        type: "string",
        description: "Task ID for claim, complete, get, delete, or add_dependency actions"
      },
      dependencies: {
        type: "array",
        items: { type: "string" },
        description: "List of task IDs this task depends on (for add_dependency action)"
      },
      agent_id: {
        type: "string",
        description: "Agent ID claiming the task (for claim_task action)"
      },
      state: {
        type: "string",
        enum: ["pending", "ready", "in_progress", "completed", "blocked"],
        description: "Filter tasks by state (for list_tasks action)"
      }
    },
    required: ["action"]
  }
};

/**
 * Format task for output
 */
function formatTask(task: unknown): unknown {
  const t = task as {
    id: string;
    description: string;
    priority: number;
    estimated_effort?: number;
    state: TaskState;
    dependencies: string[];
    assignee?: string;
    claimed_at?: number;
    completed_at?: number;
    created: number;
  };

  return {
    id: t.id,
    description: t.description,
    priority: t.priority,
    estimated_effort: t.estimated_effort,
    state: t.state,
    dependencies: t.dependencies,
    assignee: t.assignee,
    created: new Date(t.created).toISOString(),
    claimed_at: t.claimed_at ? new Date(t.claimed_at).toISOString() : undefined,
    completed_at: t.completed_at ? new Date(t.completed_at).toISOString() : undefined
  };
}

/**
 * Handler function for distributed_task_board tool
 */
export async function handleDistributedTaskBoard(args: unknown) {
  try {
    const input = DistributedTaskBoardInputSchema.parse(args);
    const board = await getTaskBoard();

    switch (input.action) {
      case "create_task": {
        if (!input.task) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Missing required field: task",
                hint: "The 'task' object is required when action is 'create_task'"
              }, null, 2)
            }],
            isError: true
          };
        }

        try {
          const task = await board.create(input.task);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                task: formatTask(task),
                message: `Task "${task.id}" created successfully with state "${task.state}"`
              }, null, 2)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Failed to create task",
                reason: (error as Error).message
              }, null, 2)
            }],
            isError: true
          };
        }
      }

      case "claim_task": {
        if (!input.task_id || !input.agent_id) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Missing required fields",
                required: ["task_id", "agent_id"],
                provided: {
                  task_id: input.task_id,
                  agent_id: input.agent_id
                }
              }, null, 2)
            }],
            isError: true
          };
        }

        const result = await board.claimTask(input.task_id, input.agent_id);

        if (!result.success) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                claim_result: {
                  success: false,
                  task_id: input.task_id,
                  reason: result.reason
                }
              }, null, 2)
            }],
            isError: true
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              claim_result: {
                success: true,
                task: formatTask(result.task!),
                agent_id: input.agent_id,
                message: `Task "${input.task_id}" claimed by "${input.agent_id}"`
              }
            }, null, 2)
          }]
        };
      }

      case "complete_task": {
        if (!input.task_id) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Missing required field: task_id"
              }, null, 2)
            }],
            isError: true
          };
        }

        try {
          const result = await board.completeTask(input.task_id);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                completion_result: {
                  task_id: input.task_id,
                  completed_task: formatTask(result.completed_task),
                  newly_ready: result.newly_ready,
                  blocked_tasks: result.blocked_tasks,
                  message: result.newly_ready.length > 0
                    ? `Task completed. ${result.newly_ready.length} task(s) now ready: ${result.newly_ready.join(", ")}`
                    : "Task completed. No dependent tasks became ready."
                }
              }, null, 2)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Failed to complete task",
                task_id: input.task_id,
                reason: (error as Error).message
              }, null, 2)
            }],
            isError: true
          };
        }
      }

      case "get_ready_tasks": {
        const readyTasks = board.getReadyTasks();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ready_tasks: readyTasks.map(formatTask),
              count: readyTasks.length,
              message: readyTasks.length === 0
                ? "No ready tasks available. Create tasks or wait for dependencies to complete."
                : `${readyTasks.length} task(s) available to claim.`
            }, null, 2)
          }]
        };
      }

      case "add_dependency": {
        if (!input.task_id || !input.dependencies || input.dependencies.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Missing required fields",
                required: ["task_id", "dependencies"],
                hint: "Provide a task_id and an array of dependency task IDs"
              }, null, 2)
            }],
            isError: true
          };
        }

        try {
          // Add each dependency
          for (const depId of input.dependencies) {
            await board.addDependency(input.task_id, depId);
          }

          const task = board.getTask(input.task_id);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                task_id: input.task_id,
                dependencies_added: input.dependencies,
                task: task ? formatTask(task) : undefined,
                message: `Added ${input.dependencies.length} dependenc(y/ies) to task "${input.task_id}"`
              }, null, 2)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Failed to add dependency",
                reason: (error as Error).message
              }, null, 2)
            }],
            isError: true
          };
        }
      }

      case "get_task": {
        if (!input.task_id) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Missing required field: task_id"
              }, null, 2)
            }],
            isError: true
          };
        }

        const task = board.getTask(input.task_id);

        if (!task) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Task not found",
                task_id: input.task_id
              }, null, 2)
            }],
            isError: true
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              task: formatTask(task)
            }, null, 2)
          }]
        };
      }

      case "get_stats": {
        const stats = board.getStats();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              statistics: {
                total_tasks: stats.total,
                by_state: stats.byState,
                assigned: stats.assigned,
                unassigned: stats.unassigned,
                completion_rate: stats.total > 0
                  ? Math.round((stats.byState.completed / stats.total) * 100)
                  : 0
              },
              message: `Task board has ${stats.total} task(s). ${stats.byState.ready} ready, ${stats.byState.in_progress} in progress.`
            }, null, 2)
          }]
        };
      }

      case "list_tasks": {
        let tasks;

        if (input.state) {
          tasks = board.getTasksByState(input.state);
        } else {
          tasks = board.getAllTasks();
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              tasks: tasks.map(formatTask),
              count: tasks.length,
              filter: input.state || "none"
            }, null, 2)
          }]
        };
      }

      case "get_agent_tasks": {
        if (!input.agent_id) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Missing required field: agent_id"
              }, null, 2)
            }],
            isError: true
          };
        }

        const tasks = board.getAgentTasks(input.agent_id);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              agent_id: input.agent_id,
              tasks: tasks.map(formatTask),
              count: tasks.length
            }, null, 2)
          }]
        };
      }

      case "delete_task": {
        if (!input.task_id) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Missing required field: task_id"
              }, null, 2)
            }],
            isError: true
          };
        }

        try {
          await board.deleteTask(input.task_id);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                task_id: input.task_id,
                message: `Task "${input.task_id}" deleted successfully`
              }, null, 2)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Failed to delete task",
                task_id: input.task_id,
                reason: (error as Error).message
              }, null, 2)
            }],
            isError: true
          };
        }
      }

      default:
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "Unknown action",
              action: input.action
            }, null, 2)
          }],
          isError: true
        };
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: "Validation error",
            details: error.errors
          }, null, 2)
        }],
        isError: true
      };
    }
    throw error;
  }
}
