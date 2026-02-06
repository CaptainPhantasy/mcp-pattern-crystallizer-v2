# MCP Lab Lead Server

The central management server for the entire MCP Lab infrastructure.

## Purpose

The Lab Lead server knows about ALL MCP Lab servers, tools, and capabilities. It provides:

1. **Complete Inventory** - List all servers, tools, and their purposes
2. **Tool Discovery** - Find the right tool for any task
3. **Agent Spawning** - Generate configurations for spawning specialized agents
4. **Knowledge Sync** - Sync embedded knowledge with actual lab state

## Tools

| Tool | Description |
|------|-------------|
| `lab_inventory` | Get complete inventory of all MCP Lab servers, tools, and capabilities |
| `lab_find_tool` | Find the right tool for a task based on description |
| `lab_get_server_info` | Get detailed information about a specific server |
| `lab_spawn_agent` | Generate configuration for spawning a sub-agent |
| `lab_sync_knowledge` | Sync embedded knowledge with actual lab state |
| `lab_get_tool_registry` | Get compact tool registry for agent prompts |

## Installation

Add to your `~/.claude/config.json`:

```json
{
  "mcpServers": {
    "lab-lead": {
      "command": "node",
      "args": ["/Volumes/Storage/MCP/lab-lead-server/dist/index.js"]
    }
  }
}
```

## Usage Examples

### Get Lab Summary
```
lab_inventory({ format: "summary" })
```

### Find Tools for a Task
```
lab_find_tool({ task: "I need to analyze code dependencies" })
```

### Spawn a Coder Agent
```
lab_spawn_agent({ agent_type: "coder" })
```

### Get MCP Config for All Servers
```
lab_get_tool_registry({ format: "mcp_config" })
```

## Agent Types

| Type | Description | Servers |
|------|-------------|---------|
| `general` | General purpose agent with core tools | floyd-supercache, floyd-runner, floyd-git, floyd-explorer |
| `coder` | Full development toolchain | + floyd-patch, floyd-devtools, floyd-terminal |
| `researcher` | Web and GitHub access | floyd-supercache, web-search-prime, web-reader, zread |
| `architect` | Architecture and dependency analysis | floyd-supercache, floyd-devtools, floyd-explorer |
| `tester` | Test execution and process management | floyd-runner, floyd-git, floyd-terminal |
| `full` | All local servers | Complete lab access |

## Embedded Knowledge

The Lab Lead has embedded knowledge of:

- **13 local MCP servers** (V2 + Floyd CLI)
- **5 external ZAI servers** (vision, web, GitHub)
- **100+ tools** across categories:
  - memory (caching)
  - development (build, test, lint)
  - terminal (process management)
  - analysis (patterns, dependencies)
  - context (packing, compression)
  - orchestration (multi-agent)
  - vision (image/video)
  - web (search, scraping)

## Scanner

A standalone scanner is available at `src/scanner.js`:

```bash
# Full scan (JSON output)
node src/scanner.js scan

# Generate tool registry prompt
node src/scanner.js prompt

# Generate agent spawn command
node src/scanner.js spawn coder

# Summary statistics
node src/scanner.js summary
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     LAB LEAD SERVER                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Embedded Knowledge (LAB_KNOWLEDGE constant)          │  │
│  │  - Server locations, tool counts, purposes            │  │
│  │  - Categories, keywords, mappings                     │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Tool Handlers                                        │  │
│  │  - lab_inventory, lab_find_tool, lab_spawn_agent      │  │
│  │  - lab_sync_knowledge, lab_get_tool_registry          │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    MCP LAB INFRASTRUCTURE                   │
│  V2 Servers          Floyd CLI          External (ZAI)      │
│  - supercache        - runner           - 4_5v_mcp          │
│  - devtools         - git              - zai-mcp-server    │
│  - safe-ops         - patch            - web-search-prime  │
│  - terminal         - explorer         - web-reader        │
│  - pattern-v2                           - zread            │
│  - context-v2                                                 │
│  - hivemind-v2                                                 │
│  - omega-v2                                                   │
│  - novel-concepts                                             │
└─────────────────────────────────────────────────────────────┘
```

## License

MIT
