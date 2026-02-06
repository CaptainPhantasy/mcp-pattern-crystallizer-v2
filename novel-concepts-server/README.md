# Novel Concepts MCP Server

A Model Context Protocol (MCP) server implementing **all 10 tools** from the Novel Concepts catalog. This server provides LLM agents with advanced capabilities for memory management, task coordination, code manipulation, multi-agent deliberation, context management, and verification.

## Overview

This server implements MIT scaffolding methodologies including:
- **IAS (Instance-Adaptive Scaling)**: Dynamic computational resource allocation
- **RLM (Reference Large Memory)**: External variable storage for large content
- **SEAL (Study-Extract-Apply-Learn)**: Reinforcement learning from successful patterns
- **Concept-Sync**: Explicit dependency relationships
- **PaTH (Pattern-based Trace Heuristics)**: State evolution tracking

## Tools

### Memory & Learning

#### 1. concept_web_weaver

Maintains an in-memory semantic graph of interconnected concepts using the **SEAL** pattern.

**Features:**
- Directed graph with nodes = concepts, edges = relationships
- Relationship types: `depends_on`, `implements`, `generalizes`, `conflicts_with`
- Path finding and impact analysis
- Edge weights strengthen through usage

**Actions:** `register`, `query`, `strengthen`, `traverse`, `stats`, `list`

#### 2. episodic_memory_bank

Stores and retrieves problem-solving episodes with full reasoning chains using the **RLM** pattern.

**Features:**
- Episode storage: { trigger, reasoning, solution, outcome, metadata }
- Semantic similarity search
- Adaptation guidance for applying past solutions to new contexts
- File-based persistence

**Actions:** `store`, `retrieve`, `adapt`, `get`, `stats`, `list`

#### 3. analogy_synthesizer

Generates cross-domain analogies by mapping structural patterns from familiar domains to unfamiliar ones.

**Features:**
- Pattern library of structural abstractions
- Structural similarity matching
- Feature mapping (source -> target)
- Transferable insights extraction

**Built-in domains:** restaurant_kitchen, ant_colony, library_system, traffic_control, restaurant_service, supply_chain

### Safe Code Manipulation

#### 4. semantic_diff_validator

Validates code changes preserve semantic behavior before applying them, using the **PaTH** pattern.

**Features:**
- Regex-based AST simulation for JavaScript/TypeScript
- Signature change detection
- Breaking change identification
- Caller impact estimation
- Test assertion generation

**Validation depths:** `syntax`, `semantic`, `behavioral`

#### 5. refactoring_orchestrator

Coordinates complex multi-file refactorings with dependency tracking using the **Concept-Sync** pattern.

**Features:**
- Impact analysis before changes
- Detailed change plans with synchronization points
- Risk assessment per file
- Rollback snapshots
- Dry-run mode by default

**Refactoring types:** `rename_symbol`, `extract_interface`, `change_signature`, `move_module`, `inline_function`

### Multi-Agent Coordination

#### 6. consensus_protocol

Enables structured deliberation where multiple perspectives are synthesized into decisions.

**Features:**
- Multiple perspective simulation (optimistic, pessimistic, pragmatic, security, performance, etc.)
- Agreement/disagreement identification
- Confidence scoring
- Caveat generation

**Perspectives:** optimistic, pessimistic, pragmatic, security, performance, maintainability, user_experience, cost

#### 7. distributed_task_board

Coordinates work on a shared task board with explicit dependencies using the **Concept-Sync** pattern.

**Features:**
- Task states: `pending`, `ready`, `in_progress`, `completed`, `blocked`
- Dependency graph with cycle detection
- Agent task claiming (prevents duplicate work)
- File-based persistence

**Actions:** `create_task`, `claim_task`, `complete_task`, `get_ready_tasks`, `add_dependency`, `get_task`, `get_stats`, `list_tasks`, `get_agent_tasks`, `delete_task`

### Context Management

#### 8. adaptive_context_compressor

Dynamically compresses conversation context using semantic importance rather than token count.

**Features:**
- Semantic "hotspot" detection (decisions, reasoning, code, errors)
- Multiple compression strategies
- Preserves provenance for expansion
- Configurable preservation types

**Strategies:** `semantic`, `recency`, `hybrid`

**Preserve types:** `reasoning`, `code`, `decisions`, `errors`

#### 9. compute_budget_allocator

Dynamically allocates computational resources based on task complexity using the **IAS** pattern.

**Features:**
- Complexity estimation via pattern matching
- Historical task similarity (SEAL pattern learning)
- Risk-aware allocation adjustments
- Manual override support

**Output:** complexity_score, compute_level, thinking_budget, max_tools, verification_depth, timeout_seconds

### Verification & Testing

#### 10. execution_trace_synthesizer

Generates predictive execution traces before running code to catch logical errors.

**Features:**
- Regex-based AST simulation
- Control flow path exploration
- State evolution tracking
- Issue detection (null dereferences, infinite loops, unreachable code)

**Supported languages:** JavaScript, TypeScript, Python, Java

## Installation

### Prerequisites

- Node.js 18.0.0 or higher
- npm or yarn

### Install Dependencies

```bash
cd /path/to/novel-concepts-mcp
npm install
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

## Claude Desktop Setup

1. Build the server:
   ```bash
   npm run build
   ```

2. Edit Claude Desktop configuration:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

3. Add the server configuration:
   ```json
   {
     "mcpServers": {
       "novel-concepts": {
         "command": "node",
         "args": ["/path/to/novel-concepts-mcp/dist/src/index.js"]
       }
     }
   }
   ```

4. Restart Claude Desktop

## Storage

All storage uses files in `~/.novel-concepts-mcp/`:

- `task-board.json` - Distributed task board data
- `episodes.json` - Episodic memory bank data
- `patterns.json` - Analogy synthesizer pattern library

Concept graph data is in-memory only (ephemeral).

## Project Structure

```
novel-concepts-mcp/
├── src/
│   ├── index.ts                          # MCP server entry point (all 10 tools)
│   ├── tools/
│   │   ├── compute-budget-allocator.ts    # IAS pattern
│   │   ├── concept-web-weaver.ts          # SEAL pattern
│   │   ├── distributed-task-board.ts      # Concept-Sync pattern
│   │   ├── episodic-memory-bank.ts        # RLM pattern
│   │   ├── analogy-synthesizer.ts         # SEAL pattern
│   │   ├── semantic-diff-validator.ts     # PaTH pattern
│   │   ├── refactoring-orchestrator.ts    # Concept-Sync pattern
│   │   ├── consensus-protocol.ts          # Concept-Sync pattern
│   │   ├── adaptive-context-compressor.ts # IAS + RLM patterns
│   │   └── execution-trace-synthesizer.ts # PaTH pattern
│   └── storage/
│       ├── graph.ts                       # In-memory concept graph
│       ├── tasks.ts                       # File-based task storage
│       ├── episodes.ts                    # File-based episode storage
│       └── patterns.ts                    # File-based pattern library
├── test/
│   └── test-client.ts                    # Tests all 10 tools
├── dist/                                 # Compiled JavaScript
├── package.json
├── tsconfig.json
├── README.md
└── IMPLEMENTATION_NOTES.md
```

## Build Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run watch` | Watch mode for development |
| `npm test` | Run test suite (all 10 tools) |

## License

MIT

## Authors

Novel Concepts - LLM capability research and tool development

## Version

0.2.0 | All 10 tools implemented
