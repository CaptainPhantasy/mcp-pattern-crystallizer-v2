/**
 * Hivemind Orchestrator MCP Server V2
 *
 * SuperTool #3 - Multi-agent coordination via shared distributed_task_board
 *
 * Power Level: ⚡⚡⚡⚡⚡⚡⚡ (Integration-focused)
 *
 * This server shares storage with novel-concepts-server and uses:
 * - distributed_task_board for task coordination (not custom queue)
 * - SUPERCACHE reasoning tier for file locks and state
 * - concept_web_weaver for capability tracking
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { join } from "path";
import { homedir } from "os";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync
} from "fs";

// === SHARED STORAGE (same as novel-concepts-server) ===

const TASKS_DIR = join(homedir(), '.floyd', 'novel-concepts', 'tasks');
const GRAPH_DIR = join(homedir(), '.floyd', 'novel-concepts', 'graph');
const CACHE_DIR = join(homedir(), '.floyd', 'supercache');
const REASONING_DIR = join(CACHE_DIR, 'reasoning');

// Ensure directories exist
for (const dir of [TASKS_DIR, GRAPH_DIR, REASONING_DIR]) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// === DATA STRUCTURES ===

interface Agent {
  id: string;
  name: string;
  type: string;
  capabilities: string[];
  status: 'idle' | 'busy' | 'offline';
  currentTasks: string[];
  completedTasks: number;
  averageScore: number;
  lastSeen: number;
}

interface Task {
  id: string;
  description: string;
  priority: number;
  estimatedEffort: number;
  requiredCapabilities: string[];
  state: 'pending' | 'ready' | 'claimed' | 'in_progress' | 'completed' | 'failed';
  dependencies: string[];
  claimedBy?: string;
  startedAt?: number;
  completedAt?: number;
  result?: any;
  error?: string;
}

interface Collaboration {
  id: string;
  participants: string[];
  task: string;
  state: 'forming' | 'active' | 'consensus' | 'completed';
  messages: Array<{ from: string; content: string; timestamp: number }>;
  consensus?: any;
}

// === TASK BOARD (shared with novel-concepts-server) ===

class DistributedTaskBoard {
  private tasks: Map<string, Task> = new Map();
  private agents: Map<string, Agent> = new Map();
  private collaborations: Map<string, Collaboration> = new Map();

  constructor() {
    this.load();
  }

  private getTaskPath(id: string): string {
    return join(TASKS_DIR, `task_${id}.json`);
  }

  private getAgentPath(id: string): string {
    return join(TASKS_DIR, `agent_${id}.json`);
  }

  private getCollabPath(id: string): string {
    return join(TASKS_DIR, `collab_${id}.json`);
  }

  load(): void {
    if (!existsSync(TASKS_DIR)) {
      mkdirSync(TASKS_DIR, { recursive: true });
      return;
    }

    const files = readdirSync(TASKS_DIR);
    for (const file of files) {
      const path = join(TASKS_DIR, file);
      try {
        const data = JSON.parse(readFileSync(path, 'utf-8'));

        if (file.startsWith('task_')) {
          this.tasks.set(data.id, data);
        } else if (file.startsWith('agent_')) {
          this.agents.set(data.id, data);
        } else if (file.startsWith('collab_')) {
          this.collaborations.set(data.id, data);
        }
      } catch (e) {
        // Skip invalid files
      }
    }
  }

  saveTask(task: Task): void {
    writeFileSync(this.getTaskPath(task.id), JSON.stringify(task, null, 2));
  }

  saveAgent(agent: Agent): void {
    writeFileSync(this.getAgentPath(agent.id), JSON.stringify(agent, null, 2));
  }

  saveCollaboration(collab: Collaboration): void {
    writeFileSync(this.getCollabPath(collab.id), JSON.stringify(collab, null, 2));
  }

  // Task operations
  createTask(task: Omit<Task, 'id' | 'state'>): Task {
    const randomPart = Math.random().toString(36).substring(2, 11);
    const id = `task_${Date.now()}_${randomPart}`;
    const newTask: Task = {
      ...task,
      id,
      state: 'pending'
    };
    this.tasks.set(id, newTask);
    this.saveTask(newTask);

    // Register in concept web
    this.registerConcept(id, 'task', task.requiredCapabilities);

    return newTask;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getReadyTasks(): Task[] {
    const ready: Task[] = [];

    for (const task of this.tasks.values()) {
      if (task.state === 'completed' || task.state === 'failed') continue;

      // Check if all dependencies are complete
      const depsComplete = task.dependencies.every(depId => {
        const dep = this.tasks.get(depId);
        return dep && dep.state === 'completed';
      });

      if (depsComplete && task.state === 'pending') {
        task.state = 'ready';
        this.saveTask(task);
      }

      if (task.state === 'ready') {
        ready.push(task);
      }
    }

    ready.sort((a, b) => b.priority - a.priority);
    return ready;
  }

  claimTask(taskId: string, agentId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.state !== 'ready') return false;

    task.state = 'claimed';
    task.claimedBy = agentId;
    task.startedAt = Date.now();
    this.saveTask(task);

    // Update agent
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.currentTasks.push(taskId);
      agent.status = 'busy';
      agent.lastSeen = Date.now();
      this.saveAgent(agent);
    }

    return true;
  }

  completeTask(taskId: string, result: any, success: boolean = true): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.state = success ? 'completed' : 'failed';
    task.completedAt = Date.now();
    task.result = result;

    if (!success) {
      task.error = result?.error || 'Task failed';
    }

    this.saveTask(task);

    // Update agent
    if (task.claimedBy) {
      const agent = this.agents.get(task.claimedBy);
      if (agent) {
        agent.currentTasks = agent.currentTasks.filter(t => t !== taskId);
        agent.completedTasks++;
        if (agent.currentTasks.length === 0) {
          agent.status = 'idle';
        }
        if (success) {
          // Update average score
          agent.averageScore = (agent.averageScore * (agent.completedTasks - 1) + (result?.score || 0.8)) / agent.completedTasks;
        }
        this.saveAgent(agent);
      }
    }
  }

  // Agent operations
  registerAgent(agent: Omit<Agent, 'lastSeen' | 'currentTasks' | 'completedTasks' | 'averageScore'>): Agent {
    const existing = this.agents.get(agent.id);

    const newAgent: Agent = {
      ...agent,
      lastSeen: Date.now(),
      currentTasks: existing?.currentTasks || [],
      completedTasks: existing?.completedTasks || 0,
      averageScore: existing?.averageScore || 0.5
    };

    this.agents.set(agent.id, newAgent);
    this.saveAgent(newAgent);

    // Register in concept web
    this.registerConcept(agent.id, 'agent', agent.capabilities);

    return newAgent;
  }

  updateAgentStatus(id: string, status: Agent['status']): void {
    const agent = this.agents.get(id);
    if (agent) {
      agent.status = status;
      agent.lastSeen = Date.now();
      this.saveAgent(agent);
    }
  }

  getAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  // Collaboration operations
  createCollaboration(participants: string[], task: string): Collaboration {
    const randomPart = Math.random().toString(36).substring(2, 11);
    const id = `collab_${Date.now()}_${randomPart}`;

    const collab: Collaboration = {
      id,
      participants,
      task,
      state: 'forming',
      messages: []
    };

    this.collaborations.set(id, collab);
    this.saveCollaboration(collab);

    return collab;
  }

  addMessage(collabId: string, from: string, content: string): void {
    const collab = this.collaborations.get(collabId);
    if (collab) {
      collab.messages.push({
        from,
        content,
        timestamp: Date.now()
      });
      collab.state = 'active';
      this.saveCollaboration(collab);
    }
  }

  setConsensus(collabId: string, consensus: any): void {
    const collab = this.collaborations.get(collabId);
    if (collab) {
      collab.consensus = consensus;
      collab.state = 'completed';
      this.saveCollaboration(collab);
    }
  }

  getCollaborations(): Collaboration[] {
    return Array.from(this.collaborations.values());
  }

  // Statistics
  getStats(): any {
    const tasks = Array.from(this.tasks.values());
    const agents = Array.from(this.agents.values());

    return {
      totalAgents: agents.length,
      activeAgents: agents.filter(a => a.status !== 'offline').length,
      totalTasks: tasks.length,
      pendingTasks: tasks.filter(t => t.state === 'pending').length,
      inProgressTasks: tasks.filter(t => t.state === 'in_progress' || t.state === 'claimed').length,
      completedTasks: tasks.filter(t => t.state === 'completed').length,
      failedTasks: tasks.filter(t => t.state === 'failed').length,
      activeCollaborations: this.collaborations.size
    };
  }

  // Register in concept web
  private registerConcept(id: string, type: string, tags: string[]): void {
    const conceptPath = join(GRAPH_DIR, `${id.replace(/[^a-z0-9]/gi, '_')}.json`);

    let concept: any = { id, relationships: [] };
    if (existsSync(conceptPath)) {
      concept = JSON.parse(readFileSync(conceptPath, 'utf-8'));
    }

    const relationships = concept.relationships || [];
    if (!relationships.some((r: any) => r.type === 'is_a' && r.target === type)) {
      relationships.push({ type: 'is_a', target: type });
    }
    for (const tag of tags) {
      if (!relationships.some((r: any) => r.type === 'has_capability' && r.target === tag)) {
        relationships.push({ type: 'has_capability', target: tag });
      }
    }

    concept.relationships = relationships;
    writeFileSync(conceptPath, JSON.stringify(concept, null, 2));
  }
}

const taskBoard = new DistributedTaskBoard();

// === REASONING TIER LOCKS ===

function acquireLock(resourceId: string, agentId: string, ttl: number = 300000): boolean {
  const lockPath = join(REASONING_DIR, `lock_${resourceId.replace(/[^a-zA-Z0-9_]/g, '_')}.json`);

  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
    if (Date.now() - lock.timestamp < lock.ttl) {
      return false; // Still locked
    }
  }

  writeFileSync(lockPath, JSON.stringify({
    agent: agentId,
    timestamp: Date.now(),
    ttl
  }, null, 2));

  return true;
}

function releaseLock(resourceId: string, agentId: string): void {
  const lockPath = join(REASONING_DIR, `lock_${resourceId.replace(/[^a-zA-Z0-9_]/g, '_')}.json`);

  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
    if (lock.agent === agentId) {
      unlinkSync(lockPath);
    }
  }
}

// === TOOL DEFINITIONS ===

const tools: Tool[] = [
  {
    name: "register_agent",
    description: `Register an AI agent with its capabilities.`,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        type: { type: "string", description: "Agent type (e.g., 'coder', 'tester', 'reviewer')" },
        capabilities: { type: "array", items: { type: "string" }, description: "List of capabilities" },
        status: { type: "string", enum: ["idle", "busy", "offline"], default: "idle" }
      },
      required: ["id", "name", "type", "capabilities"]
    }
  },
  {
    name: "submit_task",
    description: `Submit a task for distribution to agents.`,
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string" },
        priority: { type: "number", minimum: 1, maximum: 10 },
        estimated_effort: { type: "number", description: "Estimated effort (1-10)" },
        required_capabilities: { type: "array", items: { type: "string" } },
        dependencies: { type: "array", items: { type: "string" }, description: "Task IDs this depends on" }
      },
      required: ["description", "priority", "estimated_effort", "required_capabilities"]
    }
  },
  {
    name: "get_task_status",
    description: `Get the status of a specific task.`,
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" }
      },
      required: ["task_id"]
    }
  },
  {
    name: "list_tasks",
    description: `List tasks with optional filtering.`,
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", enum: ["pending", "ready", "claimed", "in_progress", "completed", "failed"] },
        claimed_by: { type: "string" }
      }
    }
  },
  {
    name: "assign_tasks",
    description: `Automatically assign ready tasks to available agents based on capability match.`,
    inputSchema: {
      type: "object",
      properties: {
        max_tasks_per_agent: { type: "number", default: 3 }
      }
    }
  },
  {
    name: "claim_task",
    description: `Claim a specific task for an agent.`,
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        agent_id: { type: "string" }
      },
      required: ["task_id", "agent_id"]
    }
  },
  {
    name: "complete_task",
    description: `Mark a task as complete with result.`,
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        result: { type: "object" },
        success: { type: "boolean", default: true }
      },
      required: ["task_id", "result"]
    }
  },
  {
    name: "collaborate",
    description: `Create a collaboration session between multiple agents.`,
    inputSchema: {
      type: "object",
      properties: {
        participants: { type: "array", items: { type: "string" } },
        task_id: { type: "string" }
      },
      required: ["participants", "task_id"]
    }
  },
  {
    name: "send_message",
    description: `Send a message in a collaboration.`,
    inputSchema: {
      type: "object",
      properties: {
        collaboration_id: { type: "string" },
        from: { type: "string" },
        content: { type: "string" }
      },
      required: ["collaboration_id", "from", "content"]
    }
  },
  {
    name: "build_consensus",
    description: `Build and record consensus from a collaboration.`,
    inputSchema: {
      type: "object",
      properties: {
        collaboration_id: { type: "string" },
        consensus: { type: "object" }
      },
      required: ["collaboration_id", "consensus"]
    }
  },
  {
    name: "get_stats",
    description: `Get hivemind statistics.`,
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "update_agent_status",
    description: `Update an agent's availability status.`,
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        status: { type: "string", enum: ["idle", "busy", "offline"] }
      },
      required: ["agent_id", "status"]
    }
  }
];

// === SERVER SETUP ===

const server = new Server(
  { name: "hivemind-orchestrator-mcp", version: "2.0.0" },
  { capabilities: { tools: {}, resources: {} } }
);

const RESOURCE_NAMESPACE = "hivemind-orchestrator-mcp";

function buildToolRegistry() {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

function findToolByName(name: string) {
  return tools.find((tool) => tool.name === name);
}

function parseToolSchemaUri(uri: string): string | null {
  const match = uri.match(/\/tool\/([^/]+)\/schema$/);
  return match ? match[1] : null;
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: `mcp://${RESOURCE_NAMESPACE}/tool-registry.json`,
        name: "tool-registry",
        description: "Tool definitions and input schemas",
        mimeType: "application/json",
      },
      {
        uri: `mcp://${RESOURCE_NAMESPACE}/health.json`,
        name: "health",
        description: "Server health and tool count",
        mimeType: "application/json",
      },
    ],
  };
});

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
  return {
    resourceTemplates: [
      {
        name: "tool-schema",
        uriTemplate: `mcp://${RESOURCE_NAMESPACE}/tool/{name}/schema`,
        description: "Tool input schema and description",
        mimeType: "application/json",
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === `mcp://${RESOURCE_NAMESPACE}/tool-registry.json`) {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ tools: buildToolRegistry() }, null, 2),
        },
      ],
    };
  }

  if (uri === `mcp://${RESOURCE_NAMESPACE}/health.json`) {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({
            name: RESOURCE_NAMESPACE,
            version: "2.0.0",
            toolCount: tools.length,
            updatedAt: new Date().toISOString(),
          }, null, 2),
        },
      ],
    };
  }

  const toolName = parseToolSchemaUri(uri);
  if (toolName) {
    const tool = findToolByName(toolName);
    if (!tool) {
      throw new Error(`Unknown tool in schema request: ${toolName}`);
    }

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          }, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "register_agent": {
        const { id, name, type, capabilities, status = "idle" } = args as any;

        const agent = taskBoard.registerAgent({
          id,
          name,
          type,
          capabilities,
          status
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              agent: {
                id: agent.id,
                name: agent.name,
                type: agent.type,
                capabilities: agent.capabilities,
                status: agent.status
              }
            }, null, 2)
          }]
        };
      }

      case "submit_task": {
        const { description, priority, estimated_effort, required_capabilities = [], dependencies = [] } = args as any;

        const task = taskBoard.createTask({
          description,
          priority,
          estimatedEffort: estimated_effort,
          requiredCapabilities: required_capabilities,
          dependencies
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              task_id: task.id,
              state: task.state,
              message: "Task submitted and awaiting dependencies"
            }, null, 2)
          }]
        };
      }

      case "get_task_status": {
        const { task_id } = args as { task_id: string };

        const task = taskBoard.getTask(task_id);

        if (!task) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "Task not found", task_id }, null, 2)
            }],
            isError: true
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              task_id: task.id,
              description: task.description,
              state: task.state,
              priority: task.priority,
              claimed_by: task.claimedBy,
              started_at: task.startedAt,
              completed_at: task.completedAt,
              result: task.result
            }, null, 2)
          }]
        };
      }

      case "list_tasks": {
        const { state, claimed_by } = args as any;

        const tasks = taskBoard.getReadyTasks(); // Gets all with state checks
        const allTasks = Array.from((taskBoard as any).tasks.values());

        let filtered = allTasks;
        if (state) {
          filtered = filtered.filter((t: any) => t.state === state);
        }
        if (claimed_by) {
          filtered = filtered.filter((t: any) => t.claimedBy === claimed_by);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              tasks: filtered.map((t: any) => ({
                id: t.id,
                description: t.description,
                state: t.state,
                priority: t.priority,
                claimed_by: t.claimedBy
              })),
              count: filtered.length
            }, null, 2)
          }]
        };
      }

      case "assign_tasks": {
        const { max_tasks_per_agent = 3 } = args as any;

        const readyTasks = taskBoard.getReadyTasks();
        const agents = taskBoard.getAgents().filter(a => a.status !== 'offline');
        const assignments: Array<{ task_id: string; agent_id: string }> = [];

        for (const task of readyTasks) {
          // Find best matching agent
          const availableAgents = agents.filter(
            a => a.currentTasks.length < max_tasks_per_agent &&
            task.requiredCapabilities.some((cap: string) => a.capabilities.includes(cap))
          );

          if (availableAgents.length > 0) {
            // Sort by capability match and current workload
            availableAgents.sort((a, b) => {
              const aMatches = task.requiredCapabilities.filter((cap: string) => a.capabilities.includes(cap)).length;
              const bMatches = task.requiredCapabilities.filter((cap: string) => b.capabilities.includes(cap)).length;
              if (aMatches !== bMatches) return bMatches - aMatches;
              return a.currentTasks.length - b.currentTasks.length;
            });

            const agent = availableAgents[0];
            if (taskBoard.claimTask(task.id, agent.id)) {
              assignments.push({ task_id: task.id, agent_id: agent.id });
            }
          }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              assignments_made: assignments.length,
              assignments,
              unassigned: readyTasks.length - assignments.length
            }, null, 2)
          }]
        };
      }

      case "claim_task": {
        const { task_id, agent_id } = args as { task_id: string; agent_id: string };

        const success = taskBoard.claimTask(task_id, agent_id);

        if (!success) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Could not claim task",
                task_id,
                reason: "Task not ready or already claimed"
              }, null, 2)
            }],
            isError: true
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              task_id,
              claimed_by: agent_id
            }, null, 2)
          }]
        };
      }

      case "complete_task": {
        const { task_id, result, success = true } = args as any;

        taskBoard.completeTask(task_id, result, success);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              task_id,
              state: success ? "completed" : "failed"
            }, null, 2)
          }]
        };
      }

      case "collaborate": {
        const { participants, task_id } = args as { participants: string[]; task_id: string };

        const collab = taskBoard.createCollaboration(participants, task_id);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              collaboration_id: collab.id,
              participants,
              task_id,
              state: collab.state
            }, null, 2)
          }]
        };
      }

      case "send_message": {
        const { collaboration_id, from, content } = args as any;

        taskBoard.addMessage(collaboration_id, from, content);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message_sent: true }, null, 2)
          }]
        };
      }

      case "build_consensus": {
        const { collaboration_id, consensus } = args as any;

        taskBoard.setConsensus(collaboration_id, consensus);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, consensus_recorded: true }, null, 2)
          }]
        };
      }

      case "get_stats": {
        const stats = taskBoard.getStats();
        const agents = taskBoard.getAgents();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ...stats,
              agents: agents.map(a => ({
                id: a.id,
                name: a.name,
                type: a.type,
                status: a.status,
                current_tasks: a.currentTasks.length,
                completed_tasks: a.completedTasks,
                average_score: a.averageScore
              }))
            }, null, 2)
          }]
        };
      }

      case "update_agent_status": {
        const { agent_id, status } = args as { agent_id: string; status: Agent['status'] };

        taskBoard.updateAgentStatus(agent_id, status);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, agent_id, status }, null, 2)
          }]
        };
      }

      default:
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "Unknown tool",
              tool: name,
              available: tools.map(t => t.name)
            }, null, 2)
          }],
          isError: true
        };
    }
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: (error as Error).message,
          tool: name
        }, null, 2)
      }],
      isError: true
    };
  }
});

// === MAIN ===

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Hivemind Orchestrator V2 MCP server running");
  console.error("Uses shared distributed_task_board from novel-concepts-server");
  console.error("Tools:", tools.map(t => t.name).join(", "));
}

main().catch(console.error);
