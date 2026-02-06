/**
 * Novel Concepts MCP Server
 *
 * Implements all 10 tools from the Novel Concepts catalog:
 *
 * Memory & Learning:
 * 1. concept_web_weaver - In-memory semantic concept graph (SEAL pattern)
 * 2. episodic_memory_bank - Problem-solving episodes with reasoning chains (RLM pattern)
 * 3. analogy_synthesizer - Cross-domain analogies via structural mapping (SEAL pattern)
 *
 * Safe Code Manipulation:
 * 4. semantic_diff_validator - Validate code changes preserve semantics (PaTH pattern)
 * 5. refactoring_orchestrator - Coordinate multi-file refactorings (Concept-Sync pattern)
 *
 * Multi-Agent Coordination:
 * 6. consensus_protocol - Multiple agents deliberate to reach decisions (Concept-Sync pattern)
 * 7. distributed_task_board - File-based task coordination (Concept-Sync pattern)
 *
 * Context Management:
 * 8. adaptive_context_compressor - Semantic compression preserving high-value info (IAS + RLM patterns)
 * 9. compute_budget_allocator - Dynamic computational resource allocation (IAS pattern)
 *
 * Verification & Testing:
 * 10. execution_trace_synthesizer - Predictive execution traces (PaTH pattern)
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
import { computeBudgetAllocator, handleComputeBudgetAllocator } from "./tools/compute-budget-allocator.js";
import { conceptWebWeaverDefinition, handleConceptWebWeaver } from "./tools/concept-web-weaver.js";
import { distributedTaskBoardDefinition, handleDistributedTaskBoard } from "./tools/distributed-task-board.js";
import { episodicMemoryBankDefinition, handleEpisodicMemoryBank } from "./tools/episodic-memory-bank.js";
import { analogySynthesizerDefinition, handleAnalogySynthesizer } from "./tools/analogy-synthesizer.js";
import { semanticDiffValidatorDefinition, handleSemanticDiffValidator } from "./tools/semantic-diff-validator.js";
import { refactoringOrchestratorDefinition, handleRefactoringOrchestrator } from "./tools/refactoring-orchestrator.js";
import { consensusProtocolDefinition, handleConsensusProtocol } from "./tools/consensus-protocol.js";
import { adaptiveContextCompressorDefinition, handleAdaptiveContextCompressor } from "./tools/adaptive-context-compressor.js";
import { executionTraceSynthesizerDefinition, handleExecutionTraceSynthesizer } from "./tools/execution-trace-synthesizer.js";

// Create MCP server
const server = new Server(
  {
    name: "novel-concepts-mcp",
    version: "0.2.0",
  },
  {
    capabilities: { tools: {}, resources: {} },
  }
);

const RESOURCE_NAMESPACE = "novel-concepts-mcp";
const TOOL_DEFINITIONS = [
  // Memory & Learning
  computeBudgetAllocator,
  conceptWebWeaverDefinition,
  episodicMemoryBankDefinition,
  analogySynthesizerDefinition,

  // Safe Code Manipulation
  semanticDiffValidatorDefinition,
  refactoringOrchestratorDefinition,

  // Multi-Agent Coordination
  consensusProtocolDefinition,
  distributedTaskBoardDefinition,

  // Context Management
  adaptiveContextCompressorDefinition,
  // computeBudgetAllocator already listed above

  // Verification & Testing
  executionTraceSynthesizerDefinition
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
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));

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
            version: "0.2.0",
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
      // Memory & Learning
      case "compute_budget_allocator":
        return await handleComputeBudgetAllocator(args);

      case "concept_web_weaver":
        return await handleConceptWebWeaver(args);

      case "episodic_memory_bank":
        return await handleEpisodicMemoryBank(args);

      case "analogy_synthesizer":
        return await handleAnalogySynthesizer(args);

      // Safe Code Manipulation
      case "semantic_diff_validator":
        return await handleSemanticDiffValidator(args);

      case "refactoring_orchestrator":
        return await handleRefactoringOrchestrator(args);

      // Multi-Agent Coordination
      case "consensus_protocol":
        return await handleConsensusProtocol(args);

      case "distributed_task_board":
        return await handleDistributedTaskBoard(args);

      // Context Management
      case "adaptive_context_compressor":
        return await handleAdaptiveContextCompressor(args);

      // Verification & Testing
      case "execution_trace_synthesizer":
        return await handleExecutionTraceSynthesizer(args);

      default:
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "Unknown tool",
              tool: name,
              available_tools: [
                "compute_budget_allocator",
                "concept_web_weaver",
                "episodic_memory_bank",
                "analogy_synthesizer",
                "semantic_diff_validator",
                "refactoring_orchestrator",
                "consensus_protocol",
                "distributed_task_board",
                "adaptive_context_compressor",
                "execution_trace_synthesizer"
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
  console.error("Novel Concepts MCP server running on stdio");
  console.error("Available tools (10):");
  console.error("  Memory & Learning:");
  console.error("    - concept_web_weaver");
  console.error("    - episodic_memory_bank");
  console.error("    - analogy_synthesizer");
  console.error("  Safe Code Manipulation:");
  console.error("    - semantic_diff_validator");
  console.error("    - refactoring_orchestrator");
  console.error("  Multi-Agent Coordination:");
  console.error("    - consensus_protocol");
  console.error("    - distributed_task_board");
  console.error("  Context Management:");
  console.error("    - adaptive_context_compressor");
  console.error("    - compute_budget_allocator");
  console.error("  Verification & Testing:");
  console.error("    - execution_trace_synthesizer");
}

// Start the server
main().catch((error) => {
  console.error("Fatal error starting server:", error);
  process.exit(1);
});
