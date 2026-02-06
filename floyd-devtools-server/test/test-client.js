/**
 * Test client for floyd-devtools-server
 * Tests all 6 tools with various inputs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "child_process";
async function runTests() {
    console.log("🧪 Floyd DevTools Server Test Suite\n");
    console.log("=".repeat(50));
    const serverProcess = spawn("node", ["dist/src/index.js"], {
        stdio: ["pipe", "pipe", "pipe"]
    });
    const transport = new StdioClientTransport({
        command: "node",
        args: ["dist/src/index.js"]
    });
    const client = new Client({
        name: "test-client",
        version: "1.0.0"
    }, {
        capabilities: {}
    });
    await client.connect(transport);
    const results = [];
    // Helper to run a test
    async function test(tool, testName, args) {
        try {
            console.log(`\n📋 Testing: ${tool} - ${testName}`);
            const result = await client.callTool({ name: tool, arguments: args });
            const content = result.content[0];
            if (content && content.type === "text") {
                const parsed = JSON.parse(content.text);
                const passed = !parsed.error;
                results.push({ tool, test: testName, passed, details: passed ? "Success" : parsed.error });
                console.log(passed ? "  ✅ PASSED" : `  ❌ FAILED: ${parsed.error}`);
                if (passed && parsed.summary) {
                    console.log(`  📊 Summary: ${JSON.stringify(parsed.summary)}`);
                }
                return parsed;
            }
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            results.push({ tool, test: testName, passed: false, details: msg });
            console.log(`  ❌ ERROR: ${msg}`);
        }
    }
    // 1. Test dependency_analyzer
    console.log("\n" + "=".repeat(50));
    console.log("1️⃣  DEPENDENCY ANALYZER TESTS");
    console.log("=".repeat(50));
    await test("dependency_analyzer", "analyze project", {
        action: "analyze",
        project_path: process.cwd(),
        language: "typescript"
    });
    await test("dependency_analyzer", "visualize graph", {
        action: "visualize",
        project_path: process.cwd()
    });
    await test("dependency_analyzer", "find cycles", {
        action: "find_cycles",
        project_path: process.cwd()
    });
    // 2. Test schema_migrator
    console.log("\n" + "=".repeat(50));
    console.log("2️⃣  SCHEMA MIGRATOR TESTS");
    console.log("=".repeat(50));
    await test("schema_migrator", "generate migration", {
        action: "generate_migration",
        schema_name: "test_config",
        old_schema: { name: "string", port: 3000 },
        new_schema: { name: "string", port: 8080, debug: false }
    });
    await test("schema_migrator", "validate schema", {
        action: "validate_schema",
        data: { name: "test", port: 3000 },
        new_schema: { name: "string", port: 3000, version: "1.0" }
    });
    await test("schema_migrator", "diff versions", {
        action: "diff_versions",
        old_schema: { a: 1, b: 2 },
        new_schema: { a: 1, c: 3 }
    });
    // 3. Test benchmark_runner
    console.log("\n" + "=".repeat(50));
    console.log("3️⃣  BENCHMARK RUNNER TESTS");
    console.log("=".repeat(50));
    await test("benchmark_runner", "run benchmark", {
        action: "run",
        benchmark_id: "test_sort",
        code_snippet: "const arr = [3,1,2]; arr.sort();",
        iterations: 50,
        warmup_runs: 5
    });
    await test("benchmark_runner", "set baseline", {
        action: "baseline",
        benchmark_id: "test_sort"
    });
    await test("benchmark_runner", "list benchmarks", {
        action: "list"
    });
    // 4. Test secure_hook_executor
    console.log("\n" + "=".repeat(50));
    console.log("4️⃣  SECURE HOOK EXECUTOR TESTS");
    console.log("=".repeat(50));
    await test("secure_hook_executor", "validate safe code", {
        action: "validate",
        hook_code: "return context.files.length;"
    });
    await test("secure_hook_executor", "validate dangerous code", {
        action: "validate",
        hook_code: "require('fs').readFileSync('/etc/passwd')"
    });
    await test("secure_hook_executor", "execute inline hook", {
        action: "execute",
        hook_code: "return 1 + 1;",
        context: { test: true }
    });
    await test("secure_hook_executor", "register hook", {
        action: "register",
        hook_name: "test_hook",
        hook_code: "return context.value * 2;",
        event: "test"
    });
    await test("secure_hook_executor", "list hooks", {
        action: "list_hooks"
    });
    // 5. Test api_format_verifier
    console.log("\n" + "=".repeat(50));
    console.log("5️⃣  API FORMAT VERIFIER TESTS");
    console.log("=".repeat(50));
    await test("api_format_verifier", "verify OpenAI request", {
        action: "verify_request",
        api_type: "openai",
        payload: {
            model: "gpt-4o",
            messages: [{ role: "user", content: "Hello" }]
        },
        check_token_limits: true,
        estimate_cost: true
    });
    await test("api_format_verifier", "verify Anthropic request", {
        action: "verify_request",
        api_type: "anthropic",
        payload: {
            model: "claude-3-sonnet",
            messages: [{ role: "user", content: "Hello" }],
            max_tokens: 1000
        }
    });
    await test("api_format_verifier", "check compatibility", {
        action: "check_compatibility",
        api_type: "anthropic",
        payload: {
            model: "claude-3-sonnet",
            messages: [{ role: "system", content: "You are helpful" }]
        }
    });
    await test("api_format_verifier", "estimate tokens", {
        action: "estimate_tokens",
        api_type: "openai",
        model: "gpt-4o",
        payload: {
            messages: [{ role: "user", content: "This is a test message for token estimation" }]
        },
        estimate_cost: true
    });
    // 6. Test test_generator
    console.log("\n" + "=".repeat(50));
    console.log("6️⃣  TEST GENERATOR TESTS");
    console.log("=".repeat(50));
    const sampleCode = `
export function add(a: number, b: number): number {
  return a + b;
}

export async function fetchData(url: string, options?: object): Promise<Response> {
  return fetch(url, options);
}
`;
    await test("test_generator", "generate tests", {
        action: "generate",
        source_code: sampleCode,
        framework: "jest",
        include_edge_cases: true
    });
    await test("test_generator", "analyze coverage", {
        action: "analyze_coverage",
        source_code: sampleCode
    });
    await test("test_generator", "suggest edge cases", {
        action: "suggest_edge_cases",
        source_code: sampleCode
    });
    await test("test_generator", "generate mocks", {
        action: "generate_mocks",
        source_code: sampleCode,
        framework: "vitest"
    });
    // Summary
    console.log("\n" + "=".repeat(50));
    console.log("📊 TEST SUMMARY");
    console.log("=".repeat(50));
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;
    console.log(`\n✅ Passed: ${passed}/${total}`);
    console.log(`❌ Failed: ${failed}/${total}`);
    console.log(`📈 Success Rate: ${((passed / total) * 100).toFixed(1)}%\n`);
    if (failed > 0) {
        console.log("Failed tests:");
        results.filter(r => !r.passed).forEach(r => {
            console.log(`  - ${r.tool}: ${r.test} - ${r.details}`);
        });
    }
    await client.close();
    console.log("\n🏁 Tests complete!");
    process.exit(failed > 0 ? 1 : 0);
}
runTests().catch(console.error);
//# sourceMappingURL=test-client.js.map