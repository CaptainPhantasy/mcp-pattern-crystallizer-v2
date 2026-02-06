/**
 * Test client for Novel Concepts MCP Server
 *
 * This client runs the MCP server as a subprocess and tests all 10 tools.
 * Run with: npm test
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ToolCallResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

class MCPTestClient {
  private serverProcess: ReturnType<typeof spawn>;
  private messageId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  constructor() {
    // When compiled, test/test-client.js goes to dist/test/test-client.js
    // We need to find the path to dist/src/index.js
    // Since __dirname will be absolute path to dist/test/, we can navigate from there
    // But __dirname is relative to the project root during TypeScript compilation
    // So we need to handle both cases
    let distPath: string;
    if (__dirname.includes("dist/test")) {
      // Already in dist directory structure
      distPath = join(__dirname, "..", "src", "index.js");
    } else {
      // In project root during development, look for dist folder
      distPath = join(process.cwd(), "dist", "src", "index.js");
    }
    this.serverProcess = spawn("node", [distPath], {
      stdio: ["pipe", "pipe", "inherit"]
    });

    this.serverProcess.stdout?.on("data", (data) => {
      try {
        const messages = data.toString().split("\n").filter(Boolean);
        for (const msgStr of messages) {
          const message = JSON.parse(msgStr);

          if (message.id !== undefined && this.pendingRequests.has(message.id)) {
            const { resolve, reject } = this.pendingRequests.get(message.id)!;
            this.pendingRequests.delete(message.id);

            if (message.error) {
              reject(new Error(JSON.stringify(message.error)));
            } else {
              resolve(message.result);
            }
          }
        }
      } catch (e) {
        console.error("Failed to parse server response:", e);
      }
    });

    this.serverProcess.on("error", (error) => {
      console.error("Server process error:", error);
    });
  }

  private async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.messageId++;

    const request = {
      jsonrpc: "2.0",
      id,
      method,
      params: params || {}
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.serverProcess.stdin?.write(JSON.stringify(request) + "\n");
    });
  }

  async initialize(): Promise<void> {
    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "test-client",
        version: "1.0.0"
      }
    });
  }

  async listTools(): Promise<unknown> {
    return await this.sendRequest("tools/list");
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return await this.sendRequest("tools/call", { name, arguments: args });
  }

  async close(): Promise<void> {
    this.serverProcess.kill();
  }
}

// Test suite
async function runTests() {
  const client = new MCPTestClient();

  try {
    console.log("\n=== Novel Concepts MCP Server Tests (All 10 Tools) ===\n");

    // Initialize
    console.log("1. Initializing server...");
    await client.initialize();
    console.log("   Server initialized.\n");

    // List tools
    console.log("2. Listing available tools...");
    const tools = await client.listTools() as { tools: Array<{ name: string }> };
    console.log(`   Found ${tools.tools.length} tools:`);
    for (const tool of tools.tools) {
      console.log(`   - ${tool.name}`);
    }
    console.log("");

    // Test compute_budget_allocator
    console.log("3. Testing compute_budget_allocator...");
    const budgetResult = await client.callTool("compute_budget_allocator", {
      task: "Implement JWT authentication with refresh tokens and secure cookie handling",
      context: {
        domain: "backend",
        risk_tolerance: "low"
      }
    }) as { content: Array<{ type: string; text: string }> };

    const budgetData = JSON.parse(budgetResult.content[0].text);
    console.log(`   Complexity Score: ${budgetData.allocation.complexity_score}`);
    console.log(`   Compute Level: ${budgetData.allocation.compute_level}`);
    console.log("   Budget allocation test PASSED\n");

    // Test concept_web_weaver
    console.log("4. Testing concept_web_weaver...");
    await client.callTool("concept_web_weaver", {
      action: "register",
      concept: "authentication_middleware",
      relationships: [
        { type: "depends_on", target: "session_storage" },
        { type: "implements", target: "auth_strategy" }
      ]
    });
    const neighborsResult = await client.callTool("concept_web_weaver", {
      action: "query",
      query_type: "neighbors",
      concept: "authentication_middleware"
    }) as { content: Array<{ type: string; text: string }> };
    const neighborsData = JSON.parse(neighborsResult.content[0].text);
    console.log(`   Found ${neighborsData.neighbors.length} neighbor(s)`);
    console.log("   Concept web weaver test PASSED\n");

    // Test episodic_memory_bank
    console.log("5. Testing episodic_memory_bank...");
    const storeResult = await client.callTool("episodic_memory_bank", {
      action: "store",
      episode: {
        trigger: "User reported session timeout after 5 minutes of inactivity",
        reasoning: "Root cause: Redis default TTL is 300 seconds",
        solution: "Set session.cookie.maxAge to 24 hours and Redis TTL to match",
        outcome: "success",
        metadata: { domain: "backend", complexity: 3 }
      }
    }) as { content: Array<{ type: string; text: string }> };
    const storeData = JSON.parse(storeResult.content[0].text);
    console.log(`   Episode stored: ${storeData.episode_id}`);
    console.log("   Episodic memory bank test PASSED\n");

    // Test analogy_synthesizer
    console.log("6. Testing analogy_synthesizer...");
    const analogyResult = await client.callTool("analogy_synthesizer", {
      problem_description: "Need to implement a system where multiple agents can work on tasks without duplicating work",
      source_domains: ["restaurant_kitchen"],
      abstraction_level: "deep"
    }) as { content: Array<{ type: string; text: string }> };
    const analogyData = JSON.parse(analogyResult.content[0].text);
    console.log(`   Best analogy domain: ${analogyData.best_analogy.domain}`);
    console.log(`   Confidence: ${analogyData.best_analogy.confidence}`);
    console.log("   Analogy synthesizer test PASSED\n");

    // Test semantic_diff_validator
    console.log("7. Testing semantic_diff_validator...");
    const diffResult = await client.callTool("semantic_diff_validator", {
      diff: `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -15,7 +15,7 @@
-export async function authenticate(email: string, password: string): Promise<User>
+export async function authenticate(email: string): Promise<User | null>
 {
-  const user = await db.users.find({email, password})
+  const user = await db.users.find({email})
   return user
 }`,
      validation_depth: "semantic",
      generate_tests: true
    }) as { content: Array<{ type: string; text: string }> };
    const diffData = JSON.parse(diffResult.content[0].text);
    console.log(`   Validation safe: ${diffData.validation_result.safe}`);
    console.log(`   Risk score: ${diffData.validation_result.risk_score}`);
    console.log("   Semantic diff validator test PASSED\n");

    // Test refactoring_orchestrator
    console.log("8. Testing refactoring_orchestrator...");
    const refactorResult = await client.callTool("refactoring_orchestrator", {
      refactoring_type: "extract_interface",
      target: "UserService",
      new_name: "IUserService",
      dry_run: true
    }) as { content: Array<{ type: string; text: string }> };
    const refactorData = JSON.parse(refactorResult.content[0].text);
    console.log(`   Files affected: ${refactorData.impact_analysis.files_affected}`);
    console.log(`   Dry run: ${refactorData.dry_run}`);
    console.log("   Refactoring orchestrator test PASSED\n");

    // Test consensus_protocol
    console.log("9. Testing consensus_protocol...");
    const consensusResult = await client.callTool("consensus_protocol", {
      question: "Should we migrate from REST to GraphQL for the API layer?",
      domain: "backend_architecture",
      perspectives: ["optimistic", "pessimistic", "pragmatic"],
      consensus_threshold: 0.7
    }) as { content: Array<{ type: string; text: string }> };
    const consensusData = JSON.parse(consensusResult.content[0].text);
    console.log(`   Agent views: ${consensusData.agent_views.length}`);
    console.log(`   Consensus reached: ${consensusData.consensus_reached}`);
    console.log("   Consensus protocol test PASSED\n");

    // Test adaptive_context_compressor
    console.log("10. Testing adaptive_context_compressor...");
    const compressResult = await client.callTool("adaptive_context_compressor", {
      conversation: [
        { role: "user", content: "I need to implement authentication" },
        { role: "assistant", content: "DECISION: Use JWT with refresh tokens. Reasoning: JWT provides stateless auth..." },
        { role: "user", content: "That sounds good, proceed" },
        { role: "assistant", content: "// JWT implementation code..." }
      ],
      compression_target: 2000,
      preserve_types: ["reasoning", "decisions"],
      strategy: "semantic"
    }) as { content: Array<{ type: string; text: string }> };
    const compressData = JSON.parse(compressResult.content[0].text);
    console.log(`   Original tokens: ${compressData.compression_report.original_tokens}`);
    console.log(`   Compressed tokens: ${compressData.compression_report.compressed_tokens}`);
    console.log(`   Compression ratio: ${compressData.compression_report.compression_ratio}`);
    console.log("   Adaptive context compressor test PASSED\n");

    // Test execution_trace_synthesizer
    console.log("11. Testing execution_trace_synthesizer...");
    const traceResult = await client.callTool("execution_trace_synthesizer", {
      code: `function processUser(user) {
  if (user.isActive) {
    return user.profile.settings.theme;
  }
  return "default";
}`,
      language: "javascript",
      entry_point: "processUser",
      input_scenarios: [
        { name: "active user", inputs: { user: { isActive: true, profile: { settings: { theme: "dark" } } } } },
        { name: "inactive user", inputs: { user: { isActive: false } } }
      ]
    }) as { content: Array<{ type: string; text: string }> };
    const traceData = JSON.parse(traceResult.content[0].text);
    console.log(`   Traces generated: ${traceData.traces.length}`);
    console.log(`   Potential issues: ${traceData.analysis.potential_issues.length}`);
    console.log("   Execution trace synthesizer test PASSED\n");

    // Test distributed_task_board
    console.log("12. Testing distributed_task_board...");
    await client.callTool("distributed_task_board", {
      action: "create_task",
      task: {
        id: "test_task_ephemeral",
        description: "Ephemeral test task",
        priority: 5
      }
    });
    const readyTasksResult = await client.callTool("distributed_task_board", {
      action: "get_ready_tasks"
    }) as { content: Array<{ type: string; text: string }> };
    const readyTasksData = JSON.parse(readyTasksResult.content[0].text);
    console.log(`   Ready tasks: ${readyTasksData.count}`);
    console.log("   Distributed task board test PASSED\n");

    console.log("=== All 10 Tool Tests PASSED ===\n");

  } catch (error) {
    console.error("TEST FAILED:", error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

// Run tests
runTests().catch(console.error);
