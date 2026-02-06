/**
 * Context Singularity MCP Server V2
 *
 * SuperTool #2 - Omniscient codebase understanding via shared concept_web_weaver
 *
 * Power Level: ⚡⚡⚡⚡⚡⚡ (Integration-focused)
 *
 * This server shares storage with novel-concepts-server and uses:
 * - concept_web_weaver for semantic relationships (not custom graph)
 * - SUPERCACHE for persistent code index
 *
 * Features:
 * - Code node indexing with semantic tags
 * - Relationship tracking (imports, calls, implements, extends)
 * - Natural language queries over codebase
 * - Impact analysis and dependency tracing
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

import { join } from "path";
import { homedir } from "os";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync
} from "fs";

// === SHARED STORAGE (same as novel-concepts-server) ===

const GRAPH_DIR = join(homedir(), '.floyd', 'novel-concepts', 'graph');
const CACHE_DIR = join(homedir(), '.floyd', 'supercache');
const VAULT_DIR = join(CACHE_DIR, 'vault');
const CODEX_DIR = join(VAULT_DIR, 'codex'); // Code index storage

// Ensure directories exist
for (const dir of [GRAPH_DIR, VAULT_DIR, CODEX_DIR]) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// === DATA STRUCTURES ===

interface CodeNode {
  id: string;
  type: 'file' | 'function' | 'class' | 'interface' | 'variable' | 'import';
  name: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  signature?: string;
  exports: string[];
  imports: string[];
  calls: string[];
  calledBy: string[];
  extends?: string;
  implements?: string[];
  tags: string[];
  metadata: Record<string, any>;
  indexed: string; // timestamp
}

interface SemanticRelation {
  from: string;
  to: string;
  type: 'imports' | 'calls' | 'extends' | 'implements' | 'instantiates' | 'returns';
  strength: number; // 0-1
}

interface CodeIndex {
  nodes: Map<string, CodeNode>;
  relations: SemanticRelation[];
  byFilePath: Map<string, string[]>;
  byName: Map<string, string[]>;
  byType: Map<string, string[]>;
}

class CodeIndexer {
  private index: CodeIndex;

  constructor() {
    this.index = {
      nodes: new Map(),
      relations: [],
      byFilePath: new Map(),
      byName: new Map(),
      byType: new Map()
    };
    this.load();
  }

  private getNodePath(id: string): string {
    return join(CODEX_DIR, `node_${id.replace(/[^a-zA-Z0-9_]/g, '_')}.json`);
  }

  private getIndexPath(): string {
    return join(CODEX_DIR, 'index.json');
  }

  load(): void {
    const indexPath = this.getIndexPath();
    if (existsSync(indexPath)) {
      try {
        const data = JSON.parse(readFileSync(indexPath, 'utf-8'));
        this.index.nodes = new Map(data.nodes || []);
        this.index.relations = data.relations || [];
        this.index.byFilePath = new Map(data.byFilePath || []);
        this.index.byName = new Map(data.byName || []);
        this.index.byType = new Map(data.byType || []);
      } catch (e) {
        console.error('Failed to load index:', e);
      }
    }
  }

  save(): void {
    const data = {
      nodes: Array.from(this.index.nodes.entries()),
      relations: this.index.relations,
      byFilePath: Array.from(this.index.byFilePath.entries()),
      byName: Array.from(this.index.byName.entries()),
      byType: Array.from(this.index.byType.entries())
    };
    writeFileSync(this.getIndexPath(), JSON.stringify(data, null, 2));
  }

  // Add a code node
  addNode(node: CodeNode): void {
    this.index.nodes.set(node.id, node);

    // Update indices
    if (!this.index.byFilePath.has(node.filePath)) {
      this.index.byFilePath.set(node.filePath, []);
    }
    this.index.byFilePath.get(node.filePath)!.push(node.id);

    if (!this.index.byName.has(node.name)) {
      this.index.byName.set(node.name, []);
    }
    this.index.byName.get(node.name)!.push(node.id);

    if (!this.index.byType.has(node.type)) {
      this.index.byType.set(node.type, []);
    }
    this.index.byType.get(node.type)!.push(node.id);

    // Register in concept web
    this.registerConcept(node.name, node.type, node.tags);
  }

  // Add semantic relation
  addRelation(relation: SemanticRelation): void {
    // Check if already exists
    const exists = this.index.relations.some(
      r => r.from === relation.from && r.to === relation.to && r.type === relation.type
    );
    if (!exists) {
      this.index.relations.push(relation);
    }
  }

  // Register in concept web (shared storage)
  private registerConcept(name: string, type: string, tags: string[]): void {
    const conceptPath = join(GRAPH_DIR, `${name.replace(/[^a-z0-9]/gi, '_')}.json`);

    let concept: any = { name, relationships: [] };
    if (existsSync(conceptPath)) {
      concept = JSON.parse(readFileSync(conceptPath, 'utf-8'));
    }

    // Add relationships based on type
    const relationships = concept.relationships || [];
    if (!relationships.some((r: any) => r.type === 'is_a' && r.target === type)) {
      relationships.push({ type: 'is_a', target: type });
    }
    for (const tag of tags) {
      if (!relationships.some((r: any) => r.type === 'tagged' && r.target === tag)) {
        relationships.push({ type: 'tagged', target: tag });
      }
    }

    concept.relationships = relationships;
    writeFileSync(conceptPath, JSON.stringify(concept, null, 2));
  }

  // Query nodes
  getNodesByFilePath(filePath: string): CodeNode[] {
    const ids = this.index.byFilePath.get(filePath) || [];
    return ids.map(id => this.index.nodes.get(id)!).filter(Boolean);
  }

  getNodesByName(name: string): CodeNode[] {
    const ids = this.index.byName.get(name) || [];
    return ids.map(id => this.index.nodes.get(id)!).filter(Boolean);
  }

  getNodesByType(type: string): CodeNode[] {
    const ids = this.index.byType.get(type) || [];
    return ids.map(id => this.index.nodes.get(id)!).filter(Boolean);
  }

  // Natural language query
  query(query: string, limit: number = 20): Array<{ node: CodeNode; score: number }> {
    const results: Array<{ node: CodeNode; score: number }> = [];
    const queryLower = query.toLowerCase();

    for (const node of this.index.nodes.values()) {
      let score = 0;

      // Name match
      if (node.name.toLowerCase().includes(queryLower)) {
        score += 0.5;
      }

      // Tag match
      for (const tag of node.tags) {
        if (tag.toLowerCase().includes(queryLower)) {
          score += 0.3;
        }
      }

      // Signature match
      if (node.signature && node.signature.toLowerCase().includes(queryLower)) {
        score += 0.2;
      }

      // Path match
      if (node.filePath.toLowerCase().includes(queryLower)) {
        score += 0.1;
      }

      if (score > 0) {
        results.push({ node, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  // Find relations
  getRelations(fromNode?: string, toNode?: string, type?: string): SemanticRelation[] {
    return this.index.relations.filter(r => {
      if (fromNode && r.from !== fromNode) return false;
      if (toNode && r.to !== toNode) return false;
      if (type && r.type !== type) return false;
      return true;
    });
  }

  // Impact analysis
  findImpact(nodeId: string): {
    upstream: CodeNode[];  // Things that depend on this
    downstream: CodeNode[]; // Things this depends on
  } {
    const upstream: CodeNode[] = [];
    const downstream: CodeNode[] = [];

    // Find upstream (who depends on me?)
    for (const relation of this.index.relations) {
      if (relation.to === nodeId) {
        const node = this.index.nodes.get(relation.from);
        if (node) upstream.push(node);
      }
      if (relation.from === nodeId) {
        const node = this.index.nodes.get(relation.to);
        if (node) downstream.push(node);
      }
    }

    return { upstream, downstream };
  }

  // Get statistics
  getStats(): any {
    return {
      totalNodes: this.index.nodes.size,
      totalRelations: this.index.relations.length,
      nodesByType: Object.fromEntries(
        Array.from(this.index.byType.entries()).map(([k, v]) => [k, v.length])
      ),
      filesIndexed: this.index.byFilePath.size
    };
  }

  // Clear index
  clear(): void {
    this.index = {
      nodes: new Map(),
      relations: [],
      byFilePath: new Map(),
      byName: new Map(),
      byType: new Map()
    };
    this.save();
  }
}

// Global indexer
const indexer = new CodeIndexer();

// === CODE ANALYSIS ===

function analyzeFile(content: string, filePath: string): {
  nodes: CodeNode[];
  relations: SemanticRelation[];
} {
  const nodes: CodeNode[] = [];
  const relations: SemanticRelation[] = [];
  const lines = content.split('\n');

  // Detect language
  const ext = filePath.split('.').pop();
  const language = ext === 'ts' || ext === 'tsx' ? 'typescript' :
                  ext === 'js' || ext === 'jsx' ? 'javascript' :
                  ext === 'py' ? 'python' :
                  ext === 'rs' ? 'rust' :
                  ext === 'go' ? 'go' : 'unknown';

  // Extract imports
  const imports: string[] = [];
  const importPatterns: RegExp[] = [
    /import\s+.*?from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /use\s+(\S+);/g,
  ];

  for (const pattern of importPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const module = match[1] || match[2];
      if (module) imports.push(module);
    }
  }

  // Extract functions
  const funcPatterns: Record<string, RegExp> = {
    typescript: /(?:async\s+)?function\s+(\w+)\s*\(|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\s*\(/g,
    javascript: /(?:async\s+)?function\s+(\w+)\s*\(|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\s*\(/g,
    python: /def\s+(\w+)\s*\(/g,
    rust: /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*</g,
    go: /func\s+(?:\(\w+\)\.)?(\w+)\s*\(/g
  };

  const funcPattern = funcPatterns[language] || funcPatterns.typescript;
  let match;
  while ((match = funcPattern.exec(content)) !== null) {
    const name = match[1] || match[2];
    if (name) {
      const startPos = match.index;
      const startLine = content.substring(0, startPos).split('\n').length;

      nodes.push({
        id: `${filePath}:${name}`,
        type: 'function',
        name,
        filePath,
        startLine,
        signature: extractSignature(content, startPos),
        imports: [],
        exports: [name],
        calls: [],
        calledBy: [],
        tags: [language, 'function'],
        metadata: { language },
        indexed: new Date().toISOString()
      });
    }
  }

  // Extract classes
  const classPattern = /(?:abstract\s+)?class\s+(\w+)/g;
  while ((match = classPattern.exec(content)) !== null) {
    const name = match[1];
    const startPos = match.index;
    const startLine = content.substring(0, startPos).split('\n').length;

    // Find extends
    const extendsMatch = content.substring(startPos, startPos + 200).match(/extends\s+(\w+)/);

    nodes.push({
      id: `${filePath}:${name}`,
      type: 'class',
      name,
      filePath,
      startLine,
      extends: extendsMatch?.[1],
      imports: [],
      exports: [name],
      calls: [],
      calledBy: [],
      tags: [language, 'class'],
      metadata: { language },
      indexed: new Date().toISOString()
    });

    if (extendsMatch) {
      relations.push({
        from: `${filePath}:${name}`,
        to: extendsMatch[1],
        type: 'extends',
        strength: 1
      });
    }
  }

  // Extract interfaces
  const interfacePattern = /interface\s+(\w+)/g;
  while ((match = interfacePattern.exec(content)) !== null) {
    const name = match[1];
    const startPos = match.index;
    const startLine = content.substring(0, startPos).split('\n').length;

    nodes.push({
      id: `${filePath}:${name}`,
      type: 'interface',
      name,
      filePath,
      startLine,
      imports: [],
      exports: [name],
      calls: [],
      calledBy: [],
      tags: [language, 'interface'],
      metadata: { language },
      indexed: new Date().toISOString()
    });
  }

  // Add file node
  nodes.push({
    id: filePath,
    type: 'file',
    name: filePath.split('/').pop() || filePath,
    filePath,
    imports,
    exports: nodes.filter(n => n.type !== 'file').map(n => n.name),
    calls: [],
    calledBy: [],
    tags: [language, 'file'],
    metadata: { language, lineCount: lines.length },
    indexed: new Date().toISOString()
  });

  // Build relations
  for (const node of nodes) {
    if (node.type === 'file') continue;

    // File -> element relation
    relations.push({
      from: filePath,
      to: node.id,
      type: 'instantiates',
      strength: 1
    });

    // Import relations
    for (const imp of imports) {
      relations.push({
        from: node.id,
        to: imp,
        type: 'imports',
        strength: 0.8
      });
    }
  }

  return { nodes, relations };
}

function extractSignature(content: string, startPos: number): string {
  const snippet = content.substring(startPos, startPos + 200);
  const lines = snippet.split('\n');
  return lines[0].trim().substring(0, 100);
}

// === TOOL DEFINITIONS ===

const tools: Tool[] = [
  {
    name: "ingest_file",
    description: `Analyze and index a single code file.`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file" }
      },
      required: ["path"]
    }
  },
  {
    name: "ingest_codebase",
    description: `Recursively index an entire codebase.`,
    inputSchema: {
      type: "object",
      properties: {
        root_path: { type: "string", description: "Root directory of codebase" },
        pattern: { type: "string", description: "File glob pattern (default: **/*.{ts,js,py,rs,go})", default: "**/*.{ts,js,py,rs,go}" }
      },
      required: ["root_path"]
    }
  },
  {
    name: "ask",
    description: `Natural language query over the indexed codebase.

Examples: "where is the auth handler", "show me all API routes", "find database queries"`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", default: 20 }
      },
      required: ["query"]
    }
  },
  {
    name: "search",
    description: `Find code elements by name, type, or pattern.`,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        type: { type: "string", enum: ["file", "function", "class", "interface", "variable"] },
        pattern: { type: "string" }
      }
    }
  },
  {
    name: "explain",
    description: `Get detailed explanation of a code element.`,
    inputSchema: {
      type: "object",
      properties: {
        element_id: { type: "string", description: "Node ID (e.g., /path/to/file.ts:functionName)" }
      },
      required: ["element_id"]
    }
  },
  {
    name: "find_impact",
    description: `Find upstream and downstream dependencies for a code element.`,
    inputSchema: {
      type: "object",
      properties: {
        element_id: { type: "string" }
      },
      required: ["element_id"]
    }
  },
  {
    name: "trace_origin",
    description: `Trace the origin of a function/class across the codebase.`,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Function or class name to trace" }
      },
      required: ["name"]
    }
  },
  {
    name: "summarize_context",
    description: `Get a summary of the indexed codebase.`,
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get_stats",
    description: `Get indexing statistics.`,
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "clear_index",
    description: `Clear the entire code index.`,
    inputSchema: {
      type: "object",
      properties: {
        confirm: { type: "boolean", description: "Must be true to confirm" }
      },
      required: ["confirm"]
    }
  }
];

// === SERVER SETUP ===

const server = new Server(
  { name: "context-singularity-mcp", version: "2.0.0" },
  { capabilities: { tools: {}, resources: {} } }
);

const RESOURCE_NAMESPACE = "context-singularity-mcp";

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
      case "ingest_file": {
        const { path } = args as { path: string };

        if (!existsSync(path)) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "File not found", path }, null, 2)
            }],
            isError: true
          };
        }

        const content = readFileSync(path, 'utf-8');
        const { nodes, relations } = analyzeFile(content, path);

        // Add to index
        for (const node of nodes) {
          indexer.addNode(node);
        }
        for (const relation of relations) {
          indexer.addRelation(relation);
        }

        indexer.save();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              indexed: path,
              nodes_found: nodes.length,
              relations_found: relations.length,
              node_types: nodes.reduce((acc, n) => {
                acc[n.type] = (acc[n.type] || 0) + 1;
                return acc;
              }, {} as Record<string, number>)
            }, null, 2)
          }]
        };
      }

      case "ingest_codebase": {
        const { root_path, pattern = "**/*.{ts,js,py,rs,go}" } = args as any;

        if (!existsSync(root_path)) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "Path not found", root_path }, null, 2)
            }],
            isError: true
          };
        }

        const { globSync } = await import('glob');
        const files = globSync(pattern, { cwd: root_path, absolute: true });

        let totalNodes = 0;
        let totalRelations = 0;

        for (const file of files) {
          try {
            const content = readFileSync(file, 'utf-8');
            const { nodes, relations } = analyzeFile(content, file);

            for (const node of nodes) {
              indexer.addNode(node);
            }
            for (const relation of relations) {
              indexer.addRelation(relation);
            }

            totalNodes += nodes.length;
            totalRelations += relations.length;
          } catch (e) {
            // Skip files that can't be read
          }
        }

        indexer.save();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              indexed: root_path,
              files_processed: files.length,
              total_nodes: totalNodes,
              total_relations: totalRelations
            }, null, 2)
          }]
        };
      }

      case "ask": {
        const { query, limit = 20 } = args as { query: string; limit?: number };

        const results = indexer.query(query, limit);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              query,
              results: results.map(r => ({
                id: r.node.id,
                name: r.node.name,
                type: r.node.type,
                file: r.node.filePath,
                line: r.node.startLine,
                score: r.score,
                tags: r.node.tags
              })),
              count: results.length
            }, null, 2)
          }]
        };
      }

      case "search": {
        const { name, type, pattern } = args as any;

        let results: CodeNode[] = [];

        if (name) {
          results = indexer.getNodesByName(name);
        } else if (type) {
          results = indexer.getNodesByType(type);
        } else if (pattern) {
          results = indexer.query(pattern, 50).map(r => r.node);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              results: results.map(r => ({
                id: r.id,
                name: r.name,
                type: r.type,
                file: r.filePath,
                line: r.startLine
              })),
              count: results.length
            }, null, 2)
          }]
        };
      }

      case "explain": {
        const { element_id } = args as { element_id: string };

        const node = (indexer as any).index.nodes.get(element_id);

        if (!node) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "Element not found", element_id }, null, 2)
            }],
            isError: true
          };
        }

        const relations = indexer.getRelations(element_id);
        const impact = indexer.findImpact(element_id);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              element: {
                id: node.id,
                name: node.name,
                type: node.type,
                file: node.filePath,
                line: node.startLine,
                signature: node.signature,
                tags: node.tags
              },
              relations: relations.map(r => ({
                type: r.type,
                with: r.to === element_id ? r.from : r.to,
                strength: r.strength
              })),
              impact: {
                depends_on: impact.downstream.map(n => n.id),
                used_by: impact.upstream.map(n => n.id)
              }
            }, null, 2)
          }]
        };
      }

      case "find_impact": {
        const { element_id } = args as { element_id: string };

        const impact = indexer.findImpact(element_id);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              element_id,
              upstream: impact.upstream.map(n => ({
                id: n.id,
                name: n.name,
                type: n.type,
                file: n.filePath
              })),
              downstream: impact.downstream.map(n => ({
                id: n.id,
                name: n.name,
                type: n.type,
                file: n.filePath
              })),
              risk_level: impact.upstream.length > 10 ? "HIGH" : impact.upstream.length > 3 ? "MEDIUM" : "LOW"
            }, null, 2)
          }]
        };
      }

      case "trace_origin": {
        const { name } = args as { name: string };

        const nodes = indexer.getNodesByName(name);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              name,
              occurrences: nodes.map(n => ({
                id: n.id,
                file: n.filePath,
                line: n.startLine,
                type: n.type,
                signature: n.signature
              })),
              count: nodes.length
            }, null, 2)
          }]
        };
      }

      case "summarize_context": {
        const stats = indexer.getStats();
        const sampleNodes = Array.from((indexer as any).index.nodes.values()).slice(0, 20);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              summary: {
                total_files: stats.filesIndexed,
                total_elements: stats.totalNodes,
                total_relations: stats.totalRelations,
                element_types: stats.nodesByType
              },
              sample_elements: sampleNodes.map((n: any) => ({
                name: n.name,
                type: n.type,
                file: n.filePath.split('/').slice(-2).join('/')
              }))
            }, null, 2)
          }]
        };
      }

      case "get_stats": {
        const stats = indexer.getStats();

        return {
          content: [{
            type: "text",
            text: JSON.stringify(stats, null, 2)
          }]
        };
      }

      case "clear_index": {
        const { confirm } = args as { confirm: boolean };

        if (!confirm) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "Must confirm=true" }, null, 2)
            }],
            isError: true
          };
        }

        indexer.clear();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, message: "Index cleared" }, null, 2)
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

// === MAIN ===

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Context Singularity V2 MCP server running");
  console.error("Uses shared concept_web_weaver from novel-concepts-server");
  console.error("Tools:", tools.map(t => t.name).join(", "));
}

main().catch(console.error);
