/**
 * Floyd DevTools MCP Server
 *
 * Implements 10 development tools:
 *
 * Code Analysis:
 * 1. dependency_analyzer - Detect circular dependencies using Tarjan's SCC
 * 2. typescript_semantic_analyzer - TypeScript-aware mismatches and type tracing
 * 3. monorepo_dependency_analyzer - Monorepo dependency graph + blast radius
 * 4. build_error_correlator - Correlate build errors across projects
 *
 * Schema & Migration:
 * 5. schema_migrator - Config/state migrations with versioning
 *
 * Performance:
 * 6. benchmark_runner - Performance tracking with statistical analysis
 *
 * Security:
 * 7. secure_hook_executor - Sandboxed hook execution with safety checks
 *
 * API Compatibility:
 * 8. api_format_verifier - LLM API format validation (OpenAI, Anthropic, Google)
 *
 * Testing:
 * 9. test_generator - Auto-generate test cases from code
 * 10. git_bisect - Intelligent git bisect automation
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Import tool handlers
import { dependencyAnalyzerDefinition, handleDependencyAnalyzer } from "./tools/dependency-analyzer.js";
import { schemaMigratorDefinition, handleSchemaMigrator } from "./tools/schema-migrator.js";
import { benchmarkRunnerDefinition, handleBenchmarkRunner } from "./tools/benchmark-runner.js";
import { secureHookExecutorDefinition, handleSecureHookExecutor } from "./tools/secure-hook-executor.js";
import { apiFormatVerifierDefinition, handleApiFormatVerifier } from "./tools/api-format-verifier.js";
import { testGeneratorDefinition, handleTestGenerator } from "./tools/test-generator.js";
import { typescriptSemanticAnalyzerDefinition, handleTypeScriptSemanticAnalyzer } from "./tools/typescript-semantic-analyzer.js";
import { gitBisectDefinition, handleGitBisect } from "./tools/git-bisect.js";
import { monorepoDependencyAnalyzerDefinition, handleMonorepoDependencyAnalyzer } from "./tools/monorepo-dependency-analyzer.js";
import { buildErrorCorrelatorDefinition, handleBuildErrorCorrelator } from "./tools/build-error-correlator.js";

// Create MCP server
const server = new Server(
  {
    name: "floyd-devtools-server",
    version: "1.0.0",
  },
  {
    capabilities: { tools: {}, resources: {} },
  }
);

const RESOURCE_NAMESPACE = "floyd-devtools-server";

const TOOL_DEFINITIONS = [
  // Code Analysis
  dependencyAnalyzerDefinition,
  typescriptSemanticAnalyzerDefinition,
  monorepoDependencyAnalyzerDefinition,
  buildErrorCorrelatorDefinition,

  // Schema & Migration
  schemaMigratorDefinition,

  // Performance
  benchmarkRunnerDefinition,

  // Security
  secureHookExecutorDefinition,

  // API Compatibility
  apiFormatVerifierDefinition,

  // Testing
  testGeneratorDefinition,

  // Git
  gitBisectDefinition,
];

function buildToolRegistry() {
  return TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

function findToolByName(name: string) {
  return TOOL_DEFINITIONS.find((tool) => tool.name === name);
}

function parseToolSchemaUri(uri: string): string | null {
  const match = uri.match(/\/tool\/([^/]+)\/schema$/);
  return match ? match[1] : null;
}

// List all tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOL_DEFINITIONS };
});

// List resources
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

// List resource templates
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

// Read resources
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
            version: "1.0.0",
            toolCount: TOOL_DEFINITIONS.length,
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

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // Code Analysis
      case "dependency_analyzer":
        return await handleDependencyAnalyzer(args);
      case "typescript_semantic_analyzer":
        return await handleTypeScriptSemanticAnalyzer(args);
      case "monorepo_dependency_analyzer":
        return await handleMonorepoDependencyAnalyzer(args);
      case "build_error_correlator":
        return await handleBuildErrorCorrelator(args);

      // Schema & Migration
      case "schema_migrator":
        return await handleSchemaMigrator(args);

      // Performance
      case "benchmark_runner":
        return await handleBenchmarkRunner(args);

      // Security
      case "secure_hook_executor":
        return await handleSecureHookExecutor(args);

      // API Compatibility
      case "api_format_verifier":
        return await handleApiFormatVerifier(args);

      // Testing
      case "test_generator":
        return await handleTestGenerator(args);

      // Git
      case "git_bisect":
        return await handleGitBisect(args);

      default:
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "Unknown tool",
              tool: name,
              available_tools: [
                "dependency_analyzer",
                "typescript_semantic_analyzer",
                "monorepo_dependency_analyzer",
                "build_error_correlator",
                "schema_migrator",
                "benchmark_runner",
                "secure_hook_executor",
                "api_format_verifier",
                "test_generator",
                "git_bisect"
              ]
            }, null, 2)
          }],
          isError: true
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error handling tool call for ${name}:`, errorMessage);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "Internal server error",
          tool: name,
          message: errorMessage
        }, null, 2)
      }],
      isError: true
    };
  }
});

/**
 * Main entry point - server runs on stdio
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Floyd DevTools MCP server running on stdio");
  console.error("Available tools (10):");
  console.error("  Code Analysis:");
  console.error("    - dependency_analyzer");
  console.error("    - typescript_semantic_analyzer");
  console.error("    - monorepo_dependency_analyzer");
  console.error("    - build_error_correlator");
  console.error("  Schema & Migration:");
  console.error("    - schema_migrator");
  console.error("  Performance:");
  console.error("    - benchmark_runner");
  console.error("  Security:");
  console.error("    - secure_hook_executor");
  console.error("  API Compatibility:");
  console.error("    - api_format_verifier");
  console.error("  Testing:");
  console.error("    - test_generator");
  console.error("  Git:");
  console.error("    - git_bisect");
}

// Start the server
main().catch((error) => {
  console.error("Fatal error starting server:", error);
  process.exit(1);
});
