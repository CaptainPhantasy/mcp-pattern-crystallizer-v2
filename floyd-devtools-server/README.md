# Floyd DevTools MCP Server

A comprehensive MCP server providing 6 powerful development tools for code analysis, testing, performance tracking, and API compatibility.

## 🛠️ Tools

### 1. `dependency_analyzer`
Detect circular dependencies using Tarjan's Strongly Connected Components algorithm.

**Actions:**
- `analyze` - Full dependency graph analysis with cycle detection
- `visualize` - ASCII visualization of dependency graph
- `find_cycles` - Find only circular dependencies
- `suggest_fixes` - Get suggestions for breaking cycles

**Supported Languages:** TypeScript, JavaScript, Python, Go

```json
{
  "action": "analyze",
  "project_path": "/path/to/project",
  "language": "auto"
}
```

---

### 2. `schema_migrator`
Handle configuration and state schema migrations with versioning.

**Actions:**
- `generate_migration` - Generate migration from old to new schema
- `validate_schema` - Validate data against a schema
- `apply_migration` - Apply a migration to data
- `rollback` - Rollback a migration
- `diff_versions` - Show diff between schema versions
- `list_migrations` - List all migrations

**Strategies:** `strict`, `lenient`, `transform`

```json
{
  "action": "generate_migration",
  "schema_name": "app_config",
  "old_schema": { "port": 3000 },
  "new_schema": { "port": 8080, "debug": false }
}
```

---

### 3. `benchmark_runner`
Performance tracking with statistical analysis.

**Actions:**
- `run` - Execute a benchmark and store results
- `compare` - Compare current results to baseline
- `baseline` - Set a baseline for comparisons
- `report` - Generate a performance report
- `regression_check` - Check for performance regressions
- `list` - List all tracked benchmarks

**Metrics:** Mean, Median, Min, Max, StdDev, P95, P99, Throughput

```json
{
  "action": "run",
  "benchmark_id": "array_sort",
  "code_snippet": "const arr = [...Array(1000)].map(() => Math.random()); arr.sort();",
  "iterations": 100
}
```

---

### 4. `secure_hook_executor`
Safe hook execution with sandboxing and safety checks.

**Actions:**
- `execute` - Execute a hook by name or inline code
- `validate` - Validate hook code for security issues
- `register` - Register a new hook
- `list_hooks` - List all registered hooks
- `audit` - Get audit logs for executions
- `enable/disable` - Toggle hook state

**Safety Features:**
- Timeout limits (default: 5000ms)
- vm sandbox execution
- API allowlist validation
- Dangerous pattern detection
- Execution audit logging

```json
{
  "action": "execute",
  "hook_code": "return context.files.filter(f => f.endsWith('.ts')).length;",
  "context": { "files": ["a.ts", "b.js", "c.ts"] }
}
```

---

### 5. `api_format_verifier`
Verify API formats for LLM compatibility.

**Actions:**
- `verify_request` - Validate request payload against API schema
- `verify_response` - Validate response payload
- `validate_schema` - Check against custom schema
- `check_compatibility` - Check API-specific compatibility
- `estimate_tokens` - Estimate token count and cost

**Supported APIs:** OpenAI, Anthropic, Google AI, Custom

```json
{
  "action": "verify_request",
  "api_type": "openai",
  "payload": {
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}]
  },
  "estimate_cost": true
}
```

---

### 6. `test_generator`
Auto-generate test cases from source code.

**Actions:**
- `generate` - Generate complete test file
- `analyze_coverage` - Analyze code for coverage potential
- `suggest_edge_cases` - Get edge case suggestions
- `generate_mocks` - Generate mock implementations

**Frameworks:** Jest, Vitest, pytest, Go testing

```json
{
  "action": "generate",
  "source_code": "export function add(a: number, b: number): number { return a + b; }",
  "framework": "jest",
  "include_edge_cases": true
}
```

---

## 📦 Installation

```bash
cd floyd-devtools-server
npm install
npm run build
```

## 🚀 Usage

### Run the server
```bash
npm start
```

### Add to MCP configuration
Add to your `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "floyd-devtools": {
      "command": "node",
      "args": ["/Volumes/Storage/MCP/floyd-devtools-server/dist/src/index.js"],
      "disabled": false
    }
  }
}
```

## 🧪 Testing

```bash
npm test
```

## 📁 Project Structure

```
floyd-devtools-server/
├── src/
│   ├── index.ts              # Main server entry
│   ├── storage/              # Data storage modules
│   │   ├── benchmarks.ts     # Benchmark results storage
│   │   ├── hooks.ts          # Hook registration & audit
│   │   └── schemas.ts        # Schema version storage
│   └── tools/                # Tool implementations
│       ├── dependency-analyzer.ts
│       ├── schema-migrator.ts
│       ├── benchmark-runner.ts
│       ├── secure-hook-executor.ts
│       ├── api-format-verifier.ts
│       └── test-generator.ts
├── test/
│   └── test-client.ts
├── package.json
├── tsconfig.json
└── README.md
```

## 📄 License

MIT
