#!/usr/bin/env node

/**
 * MCP Lab Scanner
 *
 * Dynamically scans all MCP servers in the lab and extracts:
 * - Server metadata (name, version, location)
 * - Tool definitions (name, description, input schema)
 * - Resource definitions
 *
 * Output: JSON registry of all lab capabilities
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LAB_ROOT = '/Volumes/Storage/MCP';
const FLOYD_CLI_LOCATION = '/Volumes/Storage/FLOYD_CLI/dist/mcp';

// Known servers with their paths
const KNOWN_SERVERS = {
  // V2 Servers (Current Generation)
  'floyd-supercache': `${LAB_ROOT}/floyd-supercache-server`,
  'floyd-devtools': `${LAB_ROOT}/floyd-devtools-server`,
  'floyd-safe-ops': `${LAB_ROOT}/floyd-safe-ops-server`,
  'floyd-terminal': `${LAB_ROOT}/floyd-terminal-server`,
  'pattern-crystallizer-v2': `${LAB_ROOT}/pattern-crystallizer-v2`,
  'context-singularity-v2': `${LAB_ROOT}/context-singularity-v2`,
  'hivemind-v2': `${LAB_ROOT}/hivemind-v2`,
  'omega-v2': `${LAB_ROOT}/omega-v2`,
  'novel-concepts': `${LAB_ROOT}/novel-concepts-server`,

  // Lab Prototypes
  'ast-indexing': `${LAB_ROOT}/ast-indexing-prototype`,
  'semantic-search': `${LAB_ROOT}/semantic-search-prototype`,
  'joern': `${LAB_ROOT}/joern-prototype`,
};

// External HTTP servers (no local scanning needed)
const EXTERNAL_SERVERS = {
  '4_5v_mcp': {
    provider: 'zai',
    base_url: 'https://api.z.ai',
    tools: [
      { name: 'analyze_image', description: 'Analyze images with 4.5v vision' }
    ]
  },
  'zai-mcp-server': {
    provider: 'zai',
    base_url: 'https://api.z.ai',
    tools: [
      { name: 'analyze_image', description: 'General image analysis' },
      { name: 'analyze_video', description: 'Video content analysis' },
      { name: 'diagnose_error_screenshot', description: 'Error screenshot diagnosis' },
      { name: 'extract_text_from_screenshot', description: 'OCR text extraction' },
      { name: 'ui_diff_check', description: 'UI comparison' },
      { name: 'ui_to_artifact', description: 'UI to code conversion' },
      { name: 'understand_technical_diagram', description: 'Diagram understanding' },
      { name: 'analyze_data_visualization', description: 'Chart/graph analysis' }
    ]
  },
  'web-search-prime': {
    provider: 'zai',
    base_url: 'https://api.z.ai',
    tools: [
      { name: 'webSearchPrime', description: 'Web search with results' }
    ]
  },
  'web-reader': {
    provider: 'zai',
    base_url: 'https://api.z.ai',
    tools: [
      { name: 'webReader', description: 'Fetch and convert web content' }
    ]
  },
  'zread': {
    provider: 'zai',
    base_url: 'https://api.z.ai',
    tools: [
      { name: 'get_repo_structure', description: 'Get GitHub repo directory tree' },
      { name: 'read_file', description: 'Read file from GitHub repo' },
      { name: 'search_doc', description: 'Search repo documentation' }
    ]
  },
};

/**
 * Extract tool definitions from TypeScript source code
 */
function extractToolsFromFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');

    const tools = [];

    // Pattern 1: TOOL_DEFINITIONS array
    const toolDefArrayMatch = content.match(/TOOL_DEFINITIONS\s*=\s*\[([\s\S]*?)\];/);
    if (toolDefArrayMatch) {
      const arrayContent = toolDefArrayMatch[1];
      // Extract individual tool objects
      const toolMatches = arrayContent.matchAll(/\{\s*name:\s*['"]([^'"]+)['"],\s*description:\s*['"]([^'"]+)['"]/g);
      for (const match of toolMatches) {
        tools.push({
          name: match[1],
          description: match[2],
          source: 'TOOL_DEFINITIONS'
        });
      }
    }

    // Pattern 2: Individual tool exports (e.g., export const cache_storeDefinition)
    const exportMatches = content.matchAll(/export\s+const\s+(\w+Definition)\s*[:=]\s*\{[^}]*name:\s*['"]([^'"]+)['"],[^}]*description:\s*['"]([^'"]+)['"]/g);
    for (const match of exportMatches) {
      tools.push({
        name: match[2],
        description: match[3],
        source: 'export'
      });
    }

    // Pattern 3: Tool objects in switch/case handlers
    const caseMatches = content.matchAll(/case\s+['"]([^'"]+)['"]:/g);
    for (const match of caseMatches) {
      const toolName = match[1];
      if (!tools.find(t => t.name === toolName)) {
        // Try to find description
        const descMatch = content.match(new RegExp(`${toolName}\\D*?description[:\\s]*['"]([^'"]+)['"]`));
        tools.push({
          name: toolName,
          description: descMatch ? descMatch[1] : '',
          source: 'handler'
        });
      }
    }

    return tools;
  } catch (error) {
    return [];
  }
}

/**
 * Scan a single server directory
 */
function scanServer(serverName, serverPath) {
  const result = {
    name: serverName,
    path: serverPath,
    exists: existsSync(serverPath),
    tools: [],
    resources: [],
    metadata: {}
  };

  if (!result.exists) {
    return result;
  }

  // Try to find and parse package.json
  const packageJsonPath = join(serverPath, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      result.metadata.version = pkg.version;
      result.metadata.description = pkg.description;
      result.metadata.keywords = pkg.keywords;
    } catch (e) {
      // Ignore parse errors
    }
  }

  // Find source files - common entry points
  const entryPoints = [
    join(serverPath, 'src/index.ts'),
    join(serverPath, 'src/index.js'),
    join(serverPath, 'server.ts'),
    join(serverPath, 'server.js'),
    join(serverPath, 'dist/index.js'),
    join(serverPath, 'dist/server.js'),
    join(serverPath, 'index.ts'),
    join(serverPath, 'index.js'),
  ];

  for (const entryPoint of entryPoints) {
    if (existsSync(entryPoint)) {
      const tools = extractToolsFromFile(entryPoint);
      result.tools.push(...tools);
      result.entryPoint = entryPoint;
      break;
    }
  }

  // Also scan tools directory if it exists (modular pattern)
  const toolsDir = join(serverPath, 'src/tools');
  if (existsSync(toolsDir)) {
    try {
      const toolFiles = readdirSync(toolsDir).filter(f => f.endsWith('.ts') || f.endsWith('.js'));
      for (const toolFile of toolFiles) {
        const tools = extractToolsFromFile(join(toolsDir, toolFile));
        result.tools.push(...tools);
      }
    } catch (e) {
      // Ignore
    }
  }

  // Deduplicate tools by name
  const uniqueTools = new Map();
  for (const tool of result.tools) {
    if (!uniqueTools.has(tool.name) || tool.description) {
      uniqueTools.set(tool.name, tool);
    }
  }
  result.tools = Array.from(uniqueTools.values());

  return result;
}

/**
 * Scan all known servers
 */
function scanLab() {
  const registry = {
    scanDate: new Date().toISOString(),
    servers: [],
    externalServers: EXTERNAL_SERVERS,
    summary: {
      totalServers: 0,
      totalTools: 0,
      builtServers: 0
    }
  };

  // Scan local servers
  for (const [name, path] of Object.entries(KNOWN_SERVERS)) {
    const server = scanServer(name, path);
    registry.servers.push(server);

    registry.summary.totalServers++;
    if (server.exists) {
      registry.summary.builtServers++;
      registry.summary.totalTools += server.tools.length;
    }
  }

  // Count external tools
  for (const server of Object.values(EXTERNAL_SERVERS)) {
    registry.summary.totalServers++;
    registry.summary.totalTools += server.tools.length;
  }

  return registry;
}

/**
 * Generate Claude-friendly tool registry prompt
 */
function generateToolRegistryPrompt(registry) {
  let output = '# MCP Lab Tool Registry\n\n';
  output += `Generated: ${registry.scanDate}\n\n`;
  output += `## Summary\n`;
  output += `- Total Servers: ${registry.summary.totalServers}\n`;
  output += `- Built Servers: ${registry.summary.builtServers}\n`;
  output += `- Total Tools: ${registry.summary.totalTools}\n\n`;

  output += '## Local Servers\n\n';
  for (const server of registry.servers) {
    if (!server.exists) continue;

    output += `### ${server.name}\n`;
    output += `- Location: \`${server.path}\`\n`;
    output += `- Version: ${server.metadata.version || 'unknown'}\n`;
    output += `- Tools: ${server.tools.length}\n\n`;

    if (server.tools.length > 0) {
      output += '| Tool | Description |\n';
      output += '|------|-------------|\n';
      for (const tool of server.tools) {
        output += `| \`${tool.name}\` | ${tool.description} |\n`;
      }
      output += '\n';
    }
  }

  output += '## External Servers (ZAI)\n\n';
  for (const [name, server] of Object.entries(registry.externalServers)) {
    output += `### ${name}\n`;
    output += '- Tools: ' + server.tools.length + '\n\n';
    output += '| Tool | Description |\n';
    output += '|------|-------------|\n';
    for (const tool of server.tools) {
      output += `| \`${tool.name}\` | ${tool.description} |\n`;
    }
    output += '\n';
  }

  return output;
}

/**
 * Generate spawn command for agent with specific tools
 */
function generateAgentSpawnCommand(registry, agentType = 'general') {
  // Map agent types to required tools
  const agentToolProfiles = {
    'coder': ['cache_store', 'cache_retrieve', 'floyd-runner', 'floyd-git', 'floyd-patch', 'dependency_analyzer'],
    'researcher': ['web_search_prime', 'web_reader', 'zread', 'cache_store', 'cache_retrieve'],
    'architect': ['dependency_analyzer', 'monorepo_dependency_analyzer', 'typescript_semantic_analyzer', 'floyd-explorer'],
    'general': [] // Will include all non-specialized tools
  };

  const requiredTools = agentToolProfiles[agentType] || [];

  let command = `# Spawn ${agentType} agent with MCP Lab tools\n\n`;
  command += `## Required MCP Servers\n\n`;

  const neededServers = new Set();

  if (requiredTools.length === 0) {
    // General agent gets everything
    command += `Configure ALL servers in ~/.claude/config.json:\n\n`;
    command += '```json\n';
    command += JSON.stringify({
      mcpServers: registry.servers.filter(s => s.exists).reduce((acc, s) => {
        acc[s.name] = {
          command: 'node',
          args: [`${s.path}/dist/index.js`]
        };
        return acc;
      }, {})
    }, null, 2);
    command += '\n```\n';
  } else {
    command += `Based on required tools: ${requiredTools.join(', ')}\n\n`;
  }

  return command;
}

// CLI
const args = process.argv.slice(2);
const command = args[0] || 'scan';

switch (command) {
  case 'scan':
  case 'json': {
    const registry = scanLab();
    console.log(JSON.stringify(registry, null, 2));
    break;
  }
  case 'prompt': {
    const registry = scanLab();
    console.log(generateToolRegistryPrompt(registry));
    break;
  }
  case 'spawn': {
    const registry = scanLab();
    const agentType = args[1] || 'general';
    console.log(generateAgentSpawnCommand(registry, agentType));
    break;
  }
  case 'summary': {
    const registry = scanLab();
    console.log(JSON.stringify(registry.summary, null, 2));
    break;
  }
  default:
    console.log(`
MCP Lab Scanner

Usage:
  node scanner.js scan      - Full scan (JSON output)
  node scanner.js prompt    - Generate tool registry prompt
  node scanner.js spawn     - Generate agent spawn command
  node scanner.js summary   - Summary statistics
    `);
}
