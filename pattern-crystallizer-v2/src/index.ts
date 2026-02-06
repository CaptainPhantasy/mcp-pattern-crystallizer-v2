/**
 * Pattern Crystallizer MCP Server V2
 *
 * SuperTool #1 - Orchestrates existing Novel Concepts + SUPERCACHE tools
 *
 * Power Level: ⚡⚡⚡⚡⚡ (Integration-focused)
 *
 * This server shares storage with existing tools and provides orchestrated workflows.
 * Rather than calling MCP servers (which run on stdio), it directly accesses
 * the same underlying storage that novel-concepts-server and floyd-supercache use.
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
import { z } from "zod";

import { join, dirname } from "path";
import { homedir } from "os";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync
} from "fs";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// === SHARED STORAGE PATHS (same as novel-concepts-server and floyd-supercache) ===

const EPISODES_DIR = join(homedir(), '.floyd', 'novel-concepts', 'episodes');
const GRAPH_DIR = join(homedir(), '.floyd', 'novel-concepts', 'graph');
const PATTERNS_DIR = join(homedir(), '.floyd', 'novel-concepts', 'patterns');
const CACHE_DIR = join(homedir(), '.floyd', 'supercache');
const VAULT_DIR = join(CACHE_DIR, 'vault');
const REASONING_DIR = join(CACHE_DIR, 'reasoning');
const PROJECT_DIR = join(CACHE_DIR, 'project');

// Ensure directories exist
for (const dir of [
  EPISODES_DIR, GRAPH_DIR, PATTERNS_DIR,
  VAULT_DIR, REASONING_DIR, PROJECT_DIR, CACHE_DIR
]) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// === QUALITY SCORING (140-point algorithm) ===

interface PatternQualityScore {
  total: number;
  breakdown: {
    novelty: number;        // 0-20
    reusability: number;    // 0-20
    correctness: number;    // 0-30
    completeness: number;   // 0-20
    clarity: number;        // 0-20
    adoption: number;       // 0-30
  };
  verdict: "bronze" | "silver" | "gold" | "diamond";
}

function calculatePatternQuality(pattern: any, usageCount: number = 0): PatternQualityScore {
  let novelty = 10;
  let reusability = 10;
  let correctness = 15;
  let completeness = 10;
  let clarity = 10;
  let adoption = Math.min(usageCount * 3, 30);

  const content = JSON.stringify(pattern).toLowerCase();

  // Novelty
  const uniqueKeywords = new Set(content.split(/\s+/).filter((w: string) => w.length > 5));
  novelty = Math.min(10 + uniqueKeywords.size * 0.5, 20);

  // Reusability
  if (pattern.template || pattern.parameters || pattern.configurable) {
    reusability = 18;
  } else if (content.includes("function") || content.includes("class")) {
    reusability = 15;
  }

  // Correctness
  if (pattern.tests || pattern.validation || pattern.verified || pattern.trace_analysis) {
    correctness = 25;
  } else if (pattern.example || pattern.usage) {
    correctness = 20;
  }

  // Completeness
  const requiredSections = ["name", "description", "implementation"];
  const hasSections = requiredSections.filter((s: string) =>
    pattern[s] || (pattern.pattern && pattern.pattern[s])
  ).length;
  completeness = Math.round((hasSections / requiredSections.length) * 20);

  // Clarity
  const docLength = content.length;
  if (docLength > 1000) clarity = 18;
  else if (docLength > 500) clarity = 15;
  else if (docLength > 200) clarity = 12;

  const total = Math.round(novelty + reusability + correctness + completeness + clarity + adoption);

  let verdict: "bronze" | "silver" | "gold" | "diamond";
  if (total >= 120) verdict = "diamond";
  else if (total >= 100) verdict = "gold";
  else if (total >= 80) verdict = "silver";
  else verdict = "bronze";

  return {
    total,
    breakdown: { novelty, reusability, correctness, completeness, clarity, adoption },
    verdict
  };
}

// === EPISODIC MEMORY (shared with novel-concepts-server) ===

interface Episode {
  id: string;
  trigger: string;
  reasoning: string;
  solution: string;
  outcome: "success" | "partial" | "failure";
  metadata: Record<string, any>;
  created: number;
  access_count: number;
}

function getEpisodePath(id: string): string {
  return join(EPISODES_DIR, `${id}.json`);
}

function storeEpisode(episode: Omit<Episode, "id" | "created" | "access_count">): Episode {
  const randomPart = Math.random().toString(36).substring(2, 11);
  const id = `ep_${Date.now()}_${randomPart}`;
  const full: Episode = {
    id,
    created: Date.now(),
    access_count: 0,
    ...episode
  };
  writeFileSync(getEpisodePath(id), JSON.stringify(full, null, 2));
  return full;
}

function retrieveEpisodes(query: string, maxResults: number = 3): Array<{ episode: Episode; similarity_score: number }> {
  const results: Array<{ episode: Episode; similarity_score: number }> = [];
  const queryLower = query.toLowerCase();

  if (!existsSync(EPISODES_DIR)) {
    return results;
  }

  const files = readdirSync(EPISODES_DIR).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const data: Episode = JSON.parse(readFileSync(join(EPISODES_DIR, file), 'utf-8'));

      // Simple similarity scoring
      const triggerLower = data.trigger.toLowerCase();
      const solutionLower = data.solution.toLowerCase();

      let score = 0;
      const queryWords = new Set(queryLower.split(/\s+/).filter((w: string) => w.length > 3));
      const triggerWords = new Set(triggerLower.split(/\s+/).filter((w: string) => w.length > 3));

      for (const word of queryWords) {
        if (triggerWords.has(word)) score += 0.3;
        if (triggerLower.includes(word)) score += 0.2;
        if (solutionLower.includes(word)) score += 0.1;
      }

      if (score > 0) {
        results.push({ episode: data, similarity_score: Math.min(score, 1) });
      }
    } catch (e) {
      // Skip invalid files
    }
  }

  results.sort((a, b) => b.similarity_score - a.similarity_score);
  return results.slice(0, maxResults);
}

// === CONCEPT WEB (shared with novel-concepts-server) ===

interface ConceptNode {
  id: string;
  name: string;
  relationships: Array<{ type: string; target: string }>;
  metadata: Record<string, any>;
}

function getConceptPath(name: string): string {
  return join(GRAPH_DIR, `${name.replace(/[^a-z0-9]/gi, '_')}.json`);
}

function registerConcept(name: string, relationships: Array<{ type: string; target: string }>): ConceptNode {
  const path = getConceptPath(name);
  const node: ConceptNode = {
    id: `concept_${name}`,
    name,
    relationships,
    metadata: { created: Date.now() }
  };
  writeFileSync(path, JSON.stringify(node, null, 2));
  return node;
}

function queryConcept(concept: string): ConceptNode | null {
  const path = getConceptPath(concept);
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf-8'));
  }
  return null;
}

// === SUPERCACHE OPERATIONS ===

function cacheStore(key: string, value: any, tier: 'project' | 'reasoning' | 'vault', tags: string[] = []) {
  const tierDir = tier === 'vault' ? VAULT_DIR : tier === 'reasoning' ? REASONING_DIR : PROJECT_DIR;
  const sanitizedKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = join(tierDir, `${sanitizedKey}.json`);

  const entry = {
    key,
    value,
    tier,
    tags,
    created: new Date().toISOString(),
    accessCount: 0
  };

  writeFileSync(path, JSON.stringify(entry, null, 2));
  return { success: true, key, tier, path };
}

function cacheRetrieve(key: string): any | null {
  for (const tier of [PROJECT_DIR, REASONING_DIR, VAULT_DIR]) {
    const path = join(tier, `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
    if (existsSync(path)) {
      const entry = JSON.parse(readFileSync(path, 'utf-8'));
      entry.accessCount = (entry.accessCount || 0) + 1;
      writeFileSync(path, JSON.stringify(entry, null, 2));
      return entry.value;
    }
  }
  return null;
}

// === TOOL DEFINITIONS ===

const tools: Tool[] = [
  {
    name: "detect_and_crystallize",
    description: `Auto-detect reusable patterns from code/conversation and crystallize to vault.

Orchestrated workflow:
1. Extract code structure and analyze for patterns
2. Validate semantic correctness
3. Score quality using 140-point algorithm
4. Store to SUPERCACHE vault if quality >= silver

**Example:**
\`\`\`json
{
  "code": "function parseCommand(input) { ... }",
  "language": "typescript",
  "context": "CLI command prefix parser",
  "tags": ["cli", "parser"]
}
\`\`\``,
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Code to analyze for patterns" },
        language: { type: "string", enum: ["javascript", "typescript", "python", "java", "rust", "go"], default: "typescript" },
        context: { type: "string", description: "Context where pattern was found" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
        auto_crystallize: { type: "boolean", description: "Auto-store to vault if quality >= silver", default: true }
      },
      required: ["code"]
    }
  },
  {
    name: "extract_pattern",
    description: `Extract a reusable pattern template from code.`,
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string" },
        language: { type: "string" },
        name: { type: "string" },
        description: { type: "string" }
      },
      required: ["code", "name"]
    }
  },
  {
    name: "adapt_pattern",
    description: `Find and adapt a similar pattern from episodic memory to current context.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What are you trying to solve?" },
        current_context: { type: "string", description: "Your current tech stack/context" },
        max_results: { type: "number", default: 3 }
      },
      required: ["query", "current_context"]
    }
  },
  {
    name: "validate_pattern",
    description: `Validate pattern quality before crystallizing.`,
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "object", description: "Pattern to validate" }
      },
      required: ["pattern"]
    }
  },
  {
    name: "list_crystallized",
    description: `List all crystallized patterns in the vault.`,
    inputSchema: {
      type: "object",
      properties: {
        min_quality: { type: "string", enum: ["diamond", "gold", "silver", "bronze"] },
        tags: { type: "array", items: { type: "string" } }
      }
    }
  },
  {
    name: "store_episode",
    description: `Store a problem-solving episode to episodic memory.`,
    inputSchema: {
      type: "object",
      properties: {
        trigger: { type: "string" },
        reasoning: { type: "string" },
        solution: { type: "string" },
        outcome: { type: "string", enum: ["success", "partial", "failure"] },
        metadata: { type: "object" }
      },
      required: ["trigger", "reasoning", "solution", "outcome"]
    }
  },
  {
    name: "retrieve_episodes",
    description: `Retrieve similar episodes from episodic memory.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "number", default: 3 }
      },
      required: ["query"]
    }
  }
];

// === SERVER SETUP ===

const server = new Server(
  { name: "pattern-crystallizer-mcp", version: "2.0.0" },
  { capabilities: { tools: {}, resources: {} } }
);

const RESOURCE_NAMESPACE = "pattern-crystallizer-mcp";

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
      case "detect_and_crystallize": {
        const { code, language = "typescript", context = "", tags = [], auto_crystallize = true } = args as any;

        // Extract structure from code
        const structure = extractCodeStructure(code, language);

        // Build pattern
        const pattern = {
          name: context.replace(/\s+/g, '_').toLowerCase() || 'auto_pattern',
          description: `Auto-extracted from: ${context}`,
          language,
          code,
          structure,
          extracted_at: new Date().toISOString()
        };

        // Quality scoring
        const quality = calculatePatternQuality(pattern, 0);

        // Store if threshold met
        let stored = false;
        if (auto_crystallize && (quality.verdict === "gold" || quality.verdict === "diamond" || quality.verdict === "silver")) {
          cacheStore(`pattern:${pattern.name}`, { ...pattern, quality, tags }, 'vault', tags);
          stored = true;
        }

        // Register in concept web
        if (context) {
          registerConcept(pattern.name, [
            { type: "extracted_from", target: "code_analysis" },
            { type: "stored_in", target: "supercache_vault" }
          ]);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ pattern, quality, crystallized: stored }, null, 2)
          }]
        };
      }

      case "extract_pattern": {
        const { code, language, name, description = "" } = args as any;

        const structure = extractCodeStructure(code, language);
        const pattern = {
          name,
          description: description || `Reusable ${name} pattern`,
          language,
          implementation: code,
          structure,
          parameters: extractParameters(code),
          configurable_parts: extractConfigurableParts(code)
        };

        const quality = calculatePatternQuality(pattern);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ pattern, quality }, null, 2)
          }]
        };
      }

      case "adapt_pattern": {
        const { query, current_context, max_results = 3 } = args as any;

        const results = retrieveEpisodes(query, max_results);

        if (results.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                message: "No similar episodes found",
                query,
                hint: "Try storing similar episodes first"
              }, null, 2)
            }]
          };
        }

        // Generate adaptations
        const adaptations = results.map(r => {
          const modifications = generateAdaptations(r.episode, current_context);
          return {
            base_episode: {
              id: r.episode.id,
              trigger: r.episode.trigger,
              solution: r.episode.solution
            },
            similarity_score: r.similarity_score,
            suggested_modifications: modifications,
            adapted_solution: applyModifications(r.episode.solution, modifications)
          };
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ query, current_context, adaptations }, null, 2)
          }]
        };
      }

      case "validate_pattern": {
        const { pattern } = args as any;
        const quality = calculatePatternQuality(pattern);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              quality,
              recommendation: quality.verdict === "diamond" || quality.verdict === "gold"
                ? "Excellent. Ready for vault."
                : quality.verdict === "silver"
                ? "Good quality."
                : "Needs improvement."
            }, null, 2)
          }]
        };
      }

      case "list_crystallized": {
        const { min_quality, tags } = args as any;

        const qualityOrder: Record<string, number> = { diamond: 4, gold: 3, silver: 2, bronze: 1 };
        const patterns: any[] = [];

        if (existsSync(VAULT_DIR)) {
          const files = readdirSync(VAULT_DIR).filter((f: string) => f.startsWith("pattern_") || f.startsWith("pattern:"));

          for (const file of files) {
            try {
              const entry = JSON.parse(readFileSync(join(VAULT_DIR, file), 'utf-8'));
              const data = entry.value || entry;

              if (min_quality && qualityOrder[data.quality?.verdict || "bronze"] < qualityOrder[min_quality]) {
                continue;
              }
              if (tags && tags.length > 0 && !tags.some((t: string) => data.tags?.includes(t))) {
                continue;
              }

              patterns.push({
                name: data.name,
                quality: data.quality?.verdict,
                score: data.quality?.total,
                tags: data.tags,
                language: data.language,
                created: data.created || data.extracted_at
              });
            } catch (e) { /* skip invalid */ }
          }
        }

        patterns.sort((a, b) => (b.score || 0) - (a.score || 0));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ total: patterns.length, patterns }, null, 2)
          }]
        };
      }

      case "store_episode": {
        const { trigger, reasoning, solution, outcome, metadata = {} } = args as any;

        const episode = storeEpisode({ trigger, reasoning, solution, outcome, metadata });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              episode_id: episode.id,
              message: "Episode stored to episodic memory"
            }, null, 2)
          }]
        };
      }

      case "retrieve_episodes": {
        const { query, max_results = 3 } = args as any;

        const results = retrieveEpisodes(query, max_results);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              query,
              episodes: results.map(r => ({
                id: r.episode.id,
                trigger: r.episode.trigger,
                reasoning: r.episode.reasoning,
                solution: r.episode.solution,
                outcome: r.episode.outcome,
                similarity_score: r.similarity_score
              })),
              count: results.length
            }, null, 2)
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

// === HELPER FUNCTIONS ===

function extractCodeStructure(code: string, language: string): any {
  const lines = code.split('\n');
  const functions: string[] = [];
  const classes: string[] = [];
  const imports: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('import ') || trimmed.startsWith('require(')) {
      imports.push(trimmed);
    }

    const fnMatch = trimmed.match(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*=>|function))/);
    if (fnMatch) {
      functions.push(fnMatch[1] || fnMatch[2]);
    }

    const classMatch = trimmed.match(/class\s+(\w+)/);
    if (classMatch) {
      classes.push(classMatch[1]);
    }
  }

  return { functions, classes, imports, line_count: lines.length };
}

function extractParameters(code: string): string[] {
  const fnMatch = code.match(/function\s+\w+\s*\(([^)]*)\)/);
  if (fnMatch) {
    return fnMatch[1].split(',').map(p => p.trim()).filter(Boolean);
  }
  const arrowMatch = code.match(/\(([^)]*)\)\s*=>/);
  if (arrowMatch) {
    return arrowMatch[1].split(',').map(p => p.trim()).filter(Boolean);
  }
  return [];
}

function extractConfigurableParts(code: string): string[] {
  const parts: string[] = [];
  const patterns = [
    /const\s+(\w+)\s*=\s*['"`]([^'"`]+)['"`]/g,
    /(\w+):\s*['"`]([^'"`]+)['"`]/g
  ];
  return parts;
}

function generateAdaptations(episode: Episode, currentContext: string): Array<{ what: string; why: string }> {
  const modifications: Array<{ what: string; why: string }> = [];
  const contextLower = currentContext.toLowerCase();
  const triggerLower = episode.trigger.toLowerCase();

  const techMapping: Record<string, string[]> = {
    redis: ["mongodb", "postgresql", "memcached"],
    express: ["fastify", "koa", "nestjs"],
    jwt: ["oauth", "session", "passport"],
    graphql: ["rest", "grpc"]
  };

  for (const [fromTech, toTechs] of Object.entries(techMapping)) {
    if (triggerLower.includes(fromTech)) {
      for (const toTech of toTechs) {
        if (contextLower.includes(toTech)) {
          modifications.push({
            what: `Replace ${fromTech} with ${toTech}`,
            why: `Current context uses ${toTech}`
          });
        }
      }
    }
  }

  return modifications.slice(0, 5);
}

function applyModifications(solution: string, modifications: Array<{ what: string; why: string }>): string {
  let adapted = solution;
  for (const mod of modifications) {
    adapted = adapted.replace(new RegExp(mod.what.split(' with ')[0], 'gi'), mod.what.split(' with ')[1]);
  }
  return adapted;
}

// === MAIN ===

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Pattern Crystallizer V2 MCP server running");
  console.error("Shared storage with: novel-concepts-server, floyd-supercache-server");
  console.error("Tools:", tools.map(t => t.name).join(", "));
}

main().catch(console.error);
