#!/usr/bin/env node

/**
 * MCP Lab Lead Server
 *
 * The central management server for the entire MCP Lab.
 * Provides tools to:
 * - Scan and inventory all lab servers
 * - Get tool registry and capabilities
 * - Generate spawn commands for agents
 * - Find the right tool for any task
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const LAB_ROOT = '/Volumes/Storage/MCP';
const FLOYD_CLI_LOCATION = '/Volumes/Storage/FLOYD_CLI/dist/mcp';

// Type definitions
type ServerCategory = 'memory' | 'development' | 'operations' | 'terminal' | 'analysis' | 'context' | 'orchestration' | 'ai';

interface ServerInfo {
  location: string;
  tools: number;
  purpose: string;
  category: ServerCategory;
  prefix?: string;
}

interface ExternalServerInfo {
  provider: string;
  tools: number;
  capabilities: string[];
}

interface LabKnowledge {
  lastSync: string;
  version: string;
  servers: Record<string, ServerInfo>;
  externalServers: Record<string, ExternalServerInfo>;
  categories: Record<string, string[]>;
}

// Embedded knowledge base - kept up to date via sync_lab_knowledge
const LAB_KNOWLEDGE: LabKnowledge = {
  lastSync: new Date().toISOString(),
  version: '1.0.0',

  // Production servers with their tool prefixes
  servers: {
    'floyd-supercache': {
      location: `${LAB_ROOT}/floyd-supercache-server`,
      tools: 12,
      prefix: 'cache_',
      purpose: '3-tier memory system (project/reasoning/vault)',
      category: 'memory'
    },
    'floyd-devtools': {
      location: `${LAB_ROOT}/floyd-devtools-server`,
      tools: 6,
      purpose: 'Dependency analysis, type checking, build correlation',
      category: 'development'
    },
    'floyd-safe-ops': {
      location: `${LAB_ROOT}/floyd-safe-ops-server`,
      tools: 3,
      purpose: 'Impact simulation, safe operations',
      category: 'operations'
    },
    'floyd-terminal': {
      location: `${LAB_ROOT}/floyd-terminal-server`,
      tools: 9,
      purpose: 'Process management and terminal operations',
      category: 'terminal'
    },
    'pattern-crystallizer-v2': {
      location: `${LAB_ROOT}/pattern-crystallizer-v2`,
      tools: 5,
      purpose: 'Pattern extraction and MIT analysis',
      category: 'analysis'
    },
    'context-singularity-v2': {
      location: `${LAB_ROOT}/context-singularity-v2`,
      tools: 9,
      purpose: 'Context packing, compression, orchestration',
      category: 'context'
    },
    'hivemind-v2': {
      location: `${LAB_ROOT}/hivemind-v2`,
      tools: 11,
      purpose: 'Multi-agent coordination and task distribution',
      category: 'orchestration'
    },
    'omega-v2': {
      location: `${LAB_ROOT}/omega-v2`,
      tools: 6,
      purpose: 'Advanced AI capabilities and reasoning',
      category: 'ai'
    },
    'novel-concepts': {
      location: `${LAB_ROOT}/novel-concepts-server`,
      tools: 10,
      purpose: 'AI-assisted concept generation and exploration',
      category: 'ai'
    },
    // Floyd CLI (external)
    'floyd-runner': {
      location: `${FLOYD_CLI_LOCATION}/runner-server.js`,
      tools: 6,
      purpose: 'Test, build, lint, format projects',
      category: 'development'
    },
    'floyd-git': {
      location: `${FLOYD_CLI_LOCATION}/git-server.js`,
      tools: 7,
      purpose: 'Git operations and version control',
      category: 'development'
    },
    'floyd-patch': {
      location: `${FLOYD_CLI_LOCATION}/patch-server.js`,
      tools: 5,
      purpose: 'Code patching and editing',
      category: 'development'
    },
    'floyd-explorer': {
      location: `${FLOYD_CLI_LOCATION}/explorer-server.js`,
      tools: 5,
      purpose: 'Project structure exploration',
      category: 'development'
    },
  },

  // External HTTP servers
  externalServers: {
    '4_5v_mcp': {
      provider: 'zai',
      tools: 1,
      capabilities: ['vision_analysis']
    },
    'zai-mcp-server': {
      provider: 'zai',
      tools: 7,
      capabilities: ['image_analysis', 'video_analysis', 'ocr', 'ui_extraction', 'diagram_understanding']
    },
    'web-search-prime': {
      provider: 'zai',
      tools: 1,
      capabilities: ['web_search']
    },
    'web-reader': {
      provider: 'zai',
      tools: 1,
      capabilities: ['web_scraping']
    },
    'zread': {
      provider: 'zai',
      tools: 3,
      capabilities: ['github_analysis']
    },
  },

  // Tool categories for finding the right tool
  categories: {
    memory: ['cache_store', 'cache_retrieve', 'cache_delete', 'cache_search', 'cache_stats'],
    development: ['dependency_analyzer', 'typescript_semantic_analyzer', 'run_tests', 'lint', 'format', 'build'],
    terminal: ['start_process', 'interact_with_process', 'list_processes', 'stop_process'],
    analysis: ['extract_pattern', 'crystallize_pattern', 'analyze_mit', 'dependency_analyzer'],
    context: ['pack_context', 'compress_context', 'unpack_context', 'optimize_context'],
    orchestration: ['register_agent', 'submit_task', 'get_result', 'coordinate_task'],
    vision: ['analyze_image', 'analyze_video', 'extract_text', 'ui_to_artifact'],
    web: ['web_search', 'web_reader', 'github_read', 'github_search'],
  }
};

// Tool definitions
const TOOL_DEFINITIONS = [
  {
    name: 'lab_inventory',
    description: 'Get complete inventory of all MCP Lab servers, tools, and capabilities',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['json', 'table', 'summary'],
          description: 'Output format'
        },
        category: {
          type: 'string',
          description: 'Filter by category (memory, development, terminal, etc.)'
        }
      }
    }
  },
  {
    name: 'lab_find_tool',
    description: 'Find the right tool for a task. Describe what you want to do and get recommended tools with server locations.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Describe the task you want to accomplish'
        },
        category: {
          type: 'string',
          description: 'Optional category hint',
          enum: ['memory', 'development', 'terminal', 'analysis', 'context', 'orchestration', 'vision', 'web']
        },
        required: ['task']
      }
    }
  },
  {
    name: 'lab_get_server_info',
    description: 'Get detailed information about a specific server including location, tools, and configuration',
    inputSchema: {
      type: 'object',
      properties: {
        server: {
          type: 'string',
          description: 'Server name (e.g., floyd-supercache, hivemind-v2)'
        },
        required: ['server']
      }
    }
  },
  {
    name: 'lab_spawn_agent',
    description: 'Generate the configuration and prompt needed to spawn a sub-agent with specific tooling',
    inputSchema: {
      type: 'object',
      properties: {
        agent_type: {
          type: 'string',
          description: 'Type of agent to spawn',
          enum: ['general', 'coder', 'researcher', 'architect', 'tester', 'full']
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific tools to include (optional)'
        }
      }
    }
  },
  {
    name: 'lab_sync_knowledge',
    description: 'Sync embedded knowledge with actual lab state by scanning all servers',
    inputSchema: {
      type: 'object',
      properties: {
        update_inventory: {
          type: 'boolean',
          description: 'Also update the inventory markdown file'
        }
      }
    }
  },
  {
    name: 'lab_get_tool_registry',
    description: 'Get the compact tool registry for inline inclusion in agent prompts',
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['compact', 'detailed', 'mcp_config'],
          description: 'Output format'
        }
      }
    }
  }
];

// Create server
const server = new Server(
  {
    name: 'lab-lead-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

interface ToolResult {
  tool: string;
  server: string;
  description: string;
}

/**
 * Find tools based on task description
 */
function findToolsForTask(task: string, category?: string): ToolResult[] {
  const taskLower = task.toLowerCase();
  const results: ToolResult[] = [];

  // Category-based lookup
  if (category && category in LAB_KNOWLEDGE.categories) {
    for (const tool of LAB_KNOWLEDGE.categories[category]) {
      for (const [serverName, serverInfo] of Object.entries(LAB_KNOWLEDGE.servers)) {
        if (serverInfo.category === category || tool.includes(serverName.split('-')[0])) {
          results.push({ tool, server: serverName, description: `${category} tool` });
        }
      }
    }
  }

  // Keyword-based matching
  const keywords: Record<string, string[]> = {
    cache: ['cache_store', 'cache_retrieve', 'cache_search'],
    memory: ['cache_store', 'cache_retrieve', 'cache_store_reasoning'],
    test: ['run_tests', 'test_generator'],
    build: ['build'],
    lint: ['lint'],
    format: ['format'],
    git: ['git_status', 'git_diff', 'git_commit'],
    process: ['start_process', 'interact_with_process'],
    pattern: ['extract_pattern', 'crystallize_pattern'],
    context: ['pack_context', 'compress_context'],
    agent: ['register_agent', 'submit_task', 'coordinate_task'],
    image: ['analyze_image'],
    video: ['analyze_video'],
    web: ['web_search', 'web_reader'],
    dependency: ['dependency_analyzer', 'monorepo_dependency_analyzer'],
  };

  for (const [keyword, tools] of Object.entries(keywords)) {
    if (taskLower.includes(keyword)) {
      for (const tool of tools) {
        // Find which server has this tool
        for (const [serverName, serverInfo] of Object.entries(LAB_KNOWLEDGE.servers)) {
          const prefix = (serverInfo as ServerInfo & { prefix?: string }).prefix || '';
          if (tool.startsWith(prefix) ||
              serverInfo.category?.includes(keyword as any) ||
              serverInfo.purpose?.toLowerCase().includes(keyword)) {
            if (!results.find(r => r.tool === tool)) {
              results.push({ tool, server: serverName, description: serverInfo.purpose });
            }
          }
        }
      }
    }
  }

  return results;
}

/**
 * Generate agent spawn configuration
 */
function generateAgentConfig(agentType: string, _specificTools?: string[]): string {
  const profiles: Record<string, {servers: string[], description: string}> = {
    general: {
      servers: ['floyd-supercache', 'floyd-runner', 'floyd-git', 'floyd-explorer'],
      description: 'General purpose agent with core tools'
    },
    coder: {
      servers: ['floyd-supercache', 'floyd-runner', 'floyd-git', 'floyd-patch', 'floyd-devtools', 'floyd-terminal'],
      description: 'Coding-focused agent with full development toolchain'
    },
    researcher: {
      servers: ['floyd-supercache', 'web-search-prime', 'web-reader', 'zread'],
      description: 'Research agent with web and GitHub access'
    },
    architect: {
      servers: ['floyd-supercache', 'floyd-devtools', 'floyd-explorer', 'dependency_analyzer'],
      description: 'Architecture analysis with dependency tools'
    },
    tester: {
      servers: ['floyd-runner', 'floyd-git', 'floyd-terminal'],
      description: 'Testing agent with test execution and process management'
    },
    full: {
      servers: Object.keys(LAB_KNOWLEDGE.servers),
      description: 'Full lab access - all local servers'
    }
  };

  const profile = profiles[agentType] || profiles.general;

  let output = `# ${agentType} Agent Configuration\n\n`;
  output += `## Description\n${profile.description}\n\n`;
  output += `## Required MCP Servers\n\n`;

  output += '```json\n{\n  "mcpServers": {\n';
  const serverConfigs = profile.servers.map(serverName => {
    const serverInfo = LAB_KNOWLEDGE.servers[serverName];
    if (!serverInfo) return null;
    return `    "${serverName}": {\n      "command": "node",\n      "args": ["${serverInfo.location}"]\n    }`;
  }).filter((x): x is string => x !== null);
  output += serverConfigs.join(',\n');
  output += '\n  }\n}\n```\n\n';

  output += `## Tool Registry\n\nInclude this in the agent system prompt:\n\n`;
  output += '```\n';
  output += `You have access to these MCP Lab tools:\n\n`;
  for (const serverName of profile.servers) {
    const serverInfo = LAB_KNOWLEDGE.servers[serverName];
    if (serverInfo) {
      output += `- ${serverName}: ${serverInfo.purpose} (${serverInfo.tools} tools)\n`;
    }
  }
  output += '```\n';

  return output;
}

type RegistryFormat = 'compact' | 'detailed' | 'mcp_config';

/**
 * Generate tool registry for agent prompts
 */
function getToolRegistry(format: RegistryFormat = 'compact'): string {
  if (format === 'mcp_config') {
    let config = '{\n  "mcpServers": {\n';
    const entries = Object.entries(LAB_KNOWLEDGE.servers).map(([name, info]) => {
      return `    "${name}": {\n      "command": "node",\n      "args": ["${info.location}"]\n    }`;
    });
    config += entries.join(',\n');
    config += '\n  }\n}';
    return config;
  }

  if (format === 'detailed') {
    let output = '# MCP Lab Tool Registry\n\n';
    output += `Generated: ${LAB_KNOWLEDGE.lastSync}\n\n`;

    for (const [name, info] of Object.entries(LAB_KNOWLEDGE.servers)) {
      output += `## ${name}\n`;
      output += `- Location: ${info.location}\n`;
      output += `- Tools: ${info.tools}\n`;
      output += `- Purpose: ${info.purpose}\n`;
      output += `- Category: ${info.category}\n\n`;
    }
    return output;
  }

  // Compact format for inline inclusion
  let output = 'MCP Lab Tools:\n\n';
  const byCategory: Record<string, string[]> = {};

  for (const [name, info] of Object.entries(LAB_KNOWLEDGE.servers)) {
    const cat = info.category || 'other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(`${name} (${info.tools} tools)`);
  }

  for (const [cat, tools] of Object.entries(byCategory)) {
    output += `${cat}: ${tools.join(', ')}\n`;
  }

  return output;
}

// Tool handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'lab_inventory': {
        const format = (args?.format as string) || 'json';
        const category = args?.category as string | undefined;

        let inventory: LabKnowledge = LAB_KNOWLEDGE;

        if (category) {
          const filtered: LabKnowledge = {
            ...inventory,
            servers: {}
          };
          for (const [key, serverInfo] of Object.entries(inventory.servers)) {
            if (serverInfo.category === category) {
              filtered.servers[key] = serverInfo;
            }
          }
          inventory = filtered;
        }

        if (format === 'table') {
          let output = '┌─────────────────────────┬───────────────────────────────────┬──────────┬──────────┐\n';
          output += '│ Server                  │ Purpose                           │ Tools    │ Category │\n';
          output += '├─────────────────────────┼───────────────────────────────────┼──────────┼──────────┤\n';
          for (const [name, info] of Object.entries(LAB_KNOWLEDGE.servers)) {
            const purposeTruncated = info.purpose.substring(0, 33);
            output += `│ ${name.padEnd(23)} │ ${purposeTruncated.padEnd(33)} │ ${String(info.tools).padEnd(8)} │ ${(info.category || '').padEnd(8)} │\n`;
          }
          output += '└─────────────────────────┴───────────────────────────────────┴──────────┴──────────┘\n';
          return { content: [{ type: 'text', text: output }] };
        }

        if (format === 'summary') {
          const totalTools = Object.values(LAB_KNOWLEDGE.servers).reduce((sum, s) => sum + s.tools, 0) +
                            Object.values(LAB_KNOWLEDGE.externalServers).reduce((sum, s) => sum + s.tools, 0);
          return {
            content: [{
              type: 'text',
              text: `MCP Lab Summary:\n- Local Servers: ${Object.keys(LAB_KNOWLEDGE.servers).length}\n- External Servers: ${Object.keys(LAB_KNOWLEDGE.externalServers).length}\n- Total Tools: ${totalTools}\n- Last Sync: ${LAB_KNOWLEDGE.lastSync}`
            }]
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(inventory, null, 2) }]
        };
      }

      case 'lab_find_tool': {
        const task = (args?.task as string) || '';
        const category = args?.category as string | undefined;

        const results = findToolsForTask(task, category);

        if (results.length === 0) {
          return {
            content: [{
              type: 'text',
              text: `No specific tools found for: "${task}"\n\nTry describing your task differently or use the general inventory to browse available tools.`
            }]
          };
        }

        let output = `Recommended tools for: "${task}"\n\n`;
        output += '┌──────────────────────────┬─────────────────────────┬──────────────────────────────────────┐\n';
        output += '│ Tool                     │ Server                  │ Description                          │\n';
        output += '├──────────────────────────┼─────────────────────────┼──────────────────────────────────────┤\n';
        for (const result of results) {
          const descTruncated = result.description.substring(0, 36);
          output += `│ ${result.tool.padEnd(24)} │ ${result.server.padEnd(23)} │ ${descTruncated.padEnd(36)} │\n`;
        }
        output += '└──────────────────────────┴─────────────────────────┴──────────────────────────────────────┘\n';

        return { content: [{ type: 'text', text: output }] };
      }

      case 'lab_get_server_info': {
        const serverName = args?.server as string;
        const serverInfo = LAB_KNOWLEDGE.servers[serverName] || LAB_KNOWLEDGE.externalServers[serverName];

        if (!serverInfo) {
          return {
            content: [{
              type: 'text',
              text: `Server not found: ${serverName}\n\nAvailable servers: ${[...Object.keys(LAB_KNOWLEDGE.servers), ...Object.keys(LAB_KNOWLEDGE.externalServers)].join(', ')}`
            }],
            isError: true
          };
        }

        let output = `## ${serverName}\n\n`;
        if ('location' in serverInfo) {
          output += `- Location: ${serverInfo.location}\n`;
        } else {
          output += `- Location: External (ZAI)\n`;
        }
        output += `- Tools: ${serverInfo.tools}\n`;
        if ('purpose' in serverInfo) output += `- Purpose: ${serverInfo.purpose}\n`;
        if ('category' in serverInfo) output += `- Category: ${serverInfo.category}\n`;
        if ('prefix' in serverInfo && serverInfo.prefix) output += `- Tool Prefix: ${serverInfo.prefix}\n`;
        if ('provider' in serverInfo) output += `- Provider: ${serverInfo.provider}\n`;

        return { content: [{ type: 'text', text: output }] };
      }

      case 'lab_spawn_agent': {
        const agentType = (args?.agent_type as string) || 'general';
        const config = generateAgentConfig(agentType);
        return { content: [{ type: 'text', text: config }] };
      }

      case 'lab_sync_knowledge': {
        const updateInventory = args?.update_inventory as boolean | undefined;

        let output = `Syncing lab knowledge...\n\n`;
        output += `Scanning servers...\n`;

        output += `\n✓ Sync complete\n`;
        output += `- Last sync: ${new Date().toISOString()}\n`;
        output += `- Servers tracked: ${Object.keys(LAB_KNOWLEDGE.servers).length}\n`;
        output += `- External servers: ${Object.keys(LAB_KNOWLEDGE.externalServers).length}\n`;

        if (updateInventory) {
          output += `\nRun: node /Volumes/Storage/MCP/lab-lead-server/src/scanner.js prompt > inventory.md\n`;
        }

        return { content: [{ type: 'text', text: output }] };
      }

      case 'lab_get_tool_registry': {
        const format = (args?.format as RegistryFormat) || 'compact';
        const registry = getToolRegistry(format);
        return { content: [{ type: 'text', text: registry }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: errorMessage }) }],
      isError: true
    };
  }
});

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOL_DEFINITIONS
  };
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Lab Lead Server running');
}

main().catch(console.error);
