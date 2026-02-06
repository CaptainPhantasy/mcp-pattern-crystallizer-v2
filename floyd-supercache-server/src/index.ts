/**
 * FLOYD SUPERCACHE MCP Server
 *
 * 3-tier intelligent memory system:
 * - Project Tier: Fast in-memory cache for current session
 * - Reasoning Tier: Persistent reasoning chains across sessions
 * - Vault Tier: Long-term archival patterns and solutions
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Cache storage paths
const CACHE_DIR = join(homedir(), '.floyd', 'supercache');
const PROJECT_TIER = join(CACHE_DIR, 'project');
const REASONING_TIER = join(CACHE_DIR, 'reasoning');
const VAULT_TIER = join(CACHE_DIR, 'vault');

// Ensure directories exist
for (const dir of [CACHE_DIR, PROJECT_TIER, REASONING_TIER, VAULT_TIER]) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Index file for fast lookups
const INDEX_FILE = join(CACHE_DIR, 'index.json');

interface CacheEntry {
  key: string;
  value: any;
  tier: 'project' | 'reasoning' | 'vault';
  createdAt: string;
  expiresAt?: string;
  accessCount: number;
  lastAccessed: string;
  tags: string[];
  metadata?: Record<string, any>;
  archivedFrom?: string;
  archivedAt?: string;
}

interface CacheIndex {
  entries: Record<string, CacheEntry>;
}

function loadIndex(): CacheIndex {
  if (existsSync(INDEX_FILE)) {
    try {
      return JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
    } catch {
      return { entries: {} };
    }
  }
  return { entries: {} };
}

function saveIndex(index: CacheIndex): void {
  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), 'utf8');
}

function getTierPath(tier: 'project' | 'reasoning' | 'vault'): string {
  switch (tier) {
    case 'project': return PROJECT_TIER;
    case 'reasoning': return REASONING_TIER;
    case 'vault': return VAULT_TIER;
  }
}

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getPath(key: string, tier: 'project' | 'reasoning' | 'vault'): string {
  return join(getTierPath(tier), `${sanitizeKey(key)}.json`);
}

export async function createSupercacheServer(): Promise<Server> {
  const server = new Server(
    {
      name: 'floyd-supercache-server',
      version: '1.0.0',
    },
    {
      capabilities: { tools: {}, resources: {} },
    },
  );

  const RESOURCE_NAMESPACE = 'floyd-supercache-server';

  const TOOL_DEFINITIONS = [
        // Store operations
        {
          name: 'cache_store',
          description: 'Store data in SUPERCACHE with automatic tier selection',
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Unique key for the cached data',
              },
              value: {
                type: ['string', 'number', 'boolean', 'object', 'array'],
                description: 'Value to store (any JSON-serializable data)',
              },
              tier: {
                type: 'string',
                enum: ['project', 'reasoning', 'vault'],
                description: 'Cache tier: project=temporal session, reasoning=persistent chains, vault=long-term archive',
                default: 'project',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags for categorization and search',
              },
              ttl: {
                type: 'number',
                description: 'Time-to-live in seconds (project tier only, default: 1 hour)',
              },
              metadata: {
                type: 'object',
                description: 'Additional metadata to store',
              },
            },
            required: ['key', 'value'],
          },
        },
        {
          name: 'cache_retrieve',
          description: 'Retrieve cached data by key',
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Key to retrieve',
              },
              tier: {
                type: 'string',
                enum: ['project', 'reasoning', 'vault'],
                description: 'Specific tier to search, or search all if omitted',
              },
            },
            required: ['key'],
          },
        },
        {
          name: 'cache_delete',
          description: 'Delete a specific cache entry',
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Key to delete',
              },
              tier: {
                type: 'string',
                enum: ['project', 'reasoning', 'vault'],
                description: 'Specific tier to delete from',
              },
            },
            required: ['key'],
          },
        },
        {
          name: 'cache_clear',
          description: 'Clear all entries in a cache tier',
          inputSchema: {
            type: 'object',
            properties: {
              tier: {
                type: 'string',
                enum: ['project', 'reasoning', 'vault', 'all'],
                description: 'Tier to clear (default: project)',
                default: 'project',
              },
              confirm: {
                type: 'boolean',
                description: 'Confirmation required for clearing operations',
              },
            },
            required: ['confirm'],
          },
        },
        {
          name: 'cache_list',
          description: 'List all keys in a cache tier',
          inputSchema: {
            type: 'object',
            properties: {
              tier: {
                type: 'string',
                enum: ['project', 'reasoning', 'vault', 'all'],
                description: 'Tier to list (default: all)',
                default: 'all',
              },
              filter: {
                type: 'string',
                description: 'Filter keys by pattern (supports wildcards)',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by tags',
              },
            },
          },
        },
        {
          name: 'cache_search',
          description: 'Search cache by semantic query or pattern matching',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query - matches keys, values, and tags',
              },
              tier: {
                type: 'string',
                enum: ['project', 'reasoning', 'vault', 'all'],
                description: 'Tier to search (default: all)',
                default: 'all',
              },
              limit: {
                type: 'number',
                description: 'Maximum results to return (default: 50)',
                default: 50,
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'cache_stats',
          description: 'Get cache statistics (hits, misses, size, distribution)',
          inputSchema: {
            type: 'object',
            properties: {
              tier: {
                type: 'string',
                enum: ['project', 'reasoning', 'vault', 'all'],
                description: 'Tier for stats (default: all)',
                default: 'all',
              },
            },
          },
        },
        {
          name: 'cache_prune',
          description: 'Remove expired or old cache entries',
          inputSchema: {
            type: 'object',
            properties: {
              tier: {
                type: 'string',
                enum: ['project', 'reasoning', 'vault', 'all'],
                description: 'Tier to prune (default: all)',
                default: 'all',
              },
              olderThan: {
                type: 'number',
                description: 'Remove entries older than this many seconds (default: 30 days)',
                default: 2592000,
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview what would be pruned without deleting',
                default: false,
              },
            },
          },
        },
        {
          name: 'cache_store_pattern',
          description: 'Store a reusable code/solution pattern in the vault tier',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Pattern name (e.g., react-component-with-hooks)',
              },
              pattern: {
                type: 'object',
                description: 'Pattern definition with template and usage',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags like "react", "api", "auth"',
              },
              category: {
                type: 'string',
                description: 'Pattern category (e.g., frontend, backend, database)',
              },
            },
            required: ['name', 'pattern'],
          },
        },
        {
          name: 'cache_store_reasoning',
          description: 'Persist reasoning chain for future sessions',
          inputSchema: {
            type: 'object',
            properties: {
              context: {
                type: 'string',
                description: 'Context identifier (e.g., filename, task name)',
              },
              reasoning: {
                type: 'string',
                description: 'Reasoning chain or thought process',
              },
              conclusion: {
                type: 'string',
                description: 'Final conclusion or decision made',
              },
              metadata: {
                type: 'object',
                description: 'Additional context (files involved, options considered)',
              },
            },
            required: ['context', 'reasoning'],
          },
        },
        {
          name: 'cache_load_reasoning',
          description: 'Load previously stored reasoning chain',
          inputSchema: {
            type: 'object',
            properties: {
              context: {
                type: 'string',
                description: 'Context identifier to load reasoning for',
              },
              recent: {
                type: 'boolean',
                description: 'Return most recent reasoning if multiple exist',
                default: true,
              },
            },
            required: ['context'],
          },
        },
        {
          name: 'cache_archive_reasoning',
          description: 'Archive reasoning from project/reasoning tier to vault for long-term storage',
          inputSchema: {
            type: 'object',
            properties: {
              context: {
                type: 'string',
                description: 'Context identifier to archive',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags for the archived reasoning',
              },
            },
            required: ['context'],
          },
        },
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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: `mcp://${RESOURCE_NAMESPACE}/tool-registry.json`,
          name: 'tool-registry',
          description: 'Tool definitions and input schemas',
          mimeType: 'application/json',
        },
        {
          uri: `mcp://${RESOURCE_NAMESPACE}/health.json`,
          name: 'health',
          description: 'Server health and tool count',
          mimeType: 'application/json',
        },
      ],
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: [
        {
          name: 'tool-schema',
          uriTemplate: `mcp://${RESOURCE_NAMESPACE}/tool/{name}/schema`,
          description: 'Tool input schema and description',
          mimeType: 'application/json',
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
            mimeType: 'application/json',
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
            mimeType: 'application/json',
            text: JSON.stringify({
              name: RESOURCE_NAMESPACE,
              version: '1.0.0',
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
            mimeType: 'application/json',
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
        case 'cache_store': {
          const { key = '', value = '', tier = 'project', tags = [], ttl, metadata } = args as {
            key: string;
            value: any;
            tier: 'project' | 'reasoning' | 'vault';
            tags?: string[];
            ttl?: number;
            metadata?: Record<string, any>;
          };

          const index = loadIndex();
          const now = new Date().toISOString();
          const expiresAt = ttl ? new Date(Date.now() + ttl * 1000).toISOString() : undefined;

          const entry: CacheEntry = {
            key,
            value,
            tier,
            createdAt: now,
            expiresAt,
            accessCount: 0,
            lastAccessed: now,
            tags,
            metadata,
          };

          // Store in tier-specific file
          const filePath = getPath(key, tier);
          writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');

          // Update index
          index.entries[key] = entry;
          saveIndex(index);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                key,
                tier,
                storedAt: now,
                expiresAt,
              }, null, 2),
            }],
          };
        }

        case 'cache_retrieve': {
          const { key, tier } = args as { key: string; tier?: 'project' | 'reasoning' | 'vault' };

          const index = loadIndex();
          let entry = index.entries[key];

          if (!entry) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ error: 'Key not found', key }, null, 2),
              }],
              isError: false,
            };
          }

          // Check tier filter
          if (tier && entry.tier !== tier) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ error: 'Key found in different tier', key, actualTier: entry.tier }, null, 2),
              }],
            };
          }

          // Check expiration
          if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ error: 'Entry expired', key }, null, 2),
              }],
            };
          }

          // Update access stats
          entry.accessCount++;
          entry.lastAccessed = new Date().toISOString();
          index.entries[key] = entry;
          saveIndex(index);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                key,
                value: entry.value,
                tier: entry.tier,
                accessCount: entry.accessCount,
                lastAccessed: entry.lastAccessed,
              }, null, 2),
            }],
          };
        }

        case 'cache_delete': {
          const { key, tier } = args as { key: string; tier?: 'project' | 'reasoning' | 'vault' };

          const index = loadIndex();
          const entry = index.entries[key];

          if (!entry) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ error: 'Key not found', key }, null, 2),
              }],
            };
          }

          if (tier && entry.tier !== tier) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ error: 'Key found in different tier', key, actualTier: entry.tier }, null, 2),
              }],
            };
          }

          const filePath = getPath(key, entry.tier);
          if (existsSync(filePath)) {
            unlinkSync(filePath);
          }

          delete index.entries[key];
          saveIndex(index);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, deleted: key }, null, 2),
            }],
          };
        }

        case 'cache_clear': {
          const { tier = 'project', confirm } = args as { tier: string; confirm: boolean };

          if (!confirm) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ error: 'Confirmation required', message: 'Set confirm=true to proceed' }, null, 2),
              }],
            };
          }

          const index = loadIndex();
          let cleared = 0;

          if (tier === 'all') {
            for (const key of Object.keys(index.entries)) {
              const entry = index.entries[key];
              const filePath = getPath(key, entry.tier);
              if (existsSync(filePath)) {
                unlinkSync(filePath);
              }
              cleared++;
            }
            index.entries = {};
          } else {
            const tiers: Array<'project' | 'reasoning' | 'vault'> = tier === 'all'
              ? ['project', 'reasoning', 'vault']
              : [tier as 'project' | 'reasoning' | 'vault'];

            for (const key of Object.keys(index.entries)) {
              if (tiers.includes(index.entries[key].tier)) {
                const filePath = getPath(key, index.entries[key].tier);
                if (existsSync(filePath)) {
                  unlinkSync(filePath);
                }
                delete index.entries[key];
                cleared++;
              }
            }
          }

          saveIndex(index);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, cleared, tier }, null, 2),
            }],
          };
        }

        case 'cache_list': {
          const { tier = 'all', filter, tags } = args as {
            tier: string;
            filter?: string;
            tags?: string[]
          };

          const index = loadIndex();
          const results: CacheEntry[] = [];

          for (const [key, entry] of Object.entries(index.entries)) {
            // Tier filter
            if (tier !== 'all' && entry.tier !== tier) continue;

            // Pattern filter
            if (filter) {
              const regex = new RegExp(filter.replace('*', '.*'));
              if (!regex.test(key)) continue;
            }

            // Tag filter
            if (tags && tags.length > 0) {
              if (!tags.some(t => entry.tags.includes(t))) continue;
            }

            results.push(entry);
          }

          // Sort by last accessed
          results.sort((a, b) => new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime());

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                total: results.length,
                entries: results.map(e => ({
                  key: e.key,
                  tier: e.tier,
                  tags: e.tags,
                  createdAt: e.createdAt,
                  accessCount: e.accessCount,
                  lastAccessed: e.lastAccessed,
                  expiresAt: e.expiresAt,
                  hasValue: typeof e.value !== 'undefined',
                })),
              }, null, 2),
            }],
          };
        }

        case 'cache_search': {
          const { query, tier = 'all', limit = 50 } = args as {
            query: string;
            tier: string;
            limit: number
          };

          const index = loadIndex();
          const results: Array<{ key: string; tier: string; score: number; snippet: string }> = [];
          const queryLower = query.toLowerCase();

          for (const [key, entry] of Object.entries(index.entries)) {
            if (tier !== 'all' && entry.tier !== tier) continue;

            // Skip expired
            if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) continue;

            let score = 0;
            const valueStr = JSON.stringify(entry.value).toLowerCase();

            // Key match
            if (key.toLowerCase().includes(queryLower)) {
              score += 10;
            }

            // Value match
            if (valueStr.includes(queryLower)) {
              score += 5;
            }

            // Tag match
            for (const tag of entry.tags) {
              if (tag.toLowerCase().includes(queryLower)) {
                score += 3;
              }
            }

            if (score > 0) {
              const snippet = valueStr.slice(0, 100);
              results.push({ key, tier: entry.tier, score, snippet });
            }
          }

          // Sort by score and limit
          results.sort((a, b) => b.score - a.score);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                query,
                found: results.length,
                results: results.slice(0, limit),
              }, null, 2),
            }],
          };
        }

        case 'cache_stats': {
          const { tier = 'all' } = args as { tier: string };

          const index = loadIndex();
          const stats: Record<string, any> = {
            totalEntries: 0,
            byTier: { project: 0, reasoning: 0, vault: 0 },
            expired: 0,
            totalSize: 0,
            topAccessed: [] as Array<{ key: string; accessCount: number }>,
          };

          for (const [key, entry] of Object.entries(index.entries)) {
            if (tier !== 'all' && entry.tier !== tier) continue;

            stats.totalEntries++;
            stats.byTier[entry.tier]++;

            if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
              stats.expired++;
            }

            const filePath = getPath(key, entry.tier);
            if (existsSync(filePath)) {
              stats.totalSize += statSync(filePath).size;
            }
          }

          // Top accessed
          const sorted = Object.entries(index.entries)
            .sort(([, a], [, b]) => b.accessCount - a.accessCount)
            .slice(0, 10);

          stats.topAccessed = sorted.map(([key, entry]) => ({
            key,
            accessCount: entry.accessCount,
          }));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(stats, null, 2),
            }],
          };
        }

        case 'cache_prune': {
          const { tier = 'all', olderThan = 2592000, dryRun = false } = args as {
            tier: string;
            olderThan: number;
            dryRun: boolean;
          };

          const index = loadIndex();
          const cutoff = Date.now() - olderThan * 1000;
          const toPrune: string[] = [];

          for (const [key, entry] of Object.entries(index.entries)) {
            if (tier !== 'all' && entry.tier !== tier) continue;

            const entryTime = new Date(entry.createdAt).getTime();
            const isExpired = entry.expiresAt && new Date(entry.expiresAt) < new Date();
            const isOld = entryTime < cutoff;

            if (isExpired || isOld) {
              toPrune.push(key);
            }
          }

          if (!dryRun) {
            for (const key of toPrune) {
              const entry = index.entries[key];
              const filePath = getPath(key, entry.tier);
              if (existsSync(filePath)) {
                unlinkSync(filePath);
              }
              delete index.entries[key];
            }
            saveIndex(index);
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                dryRun,
                wouldPrune: toPrune.length,
                pruned: dryRun ? 0 : toPrune.length,
                keys: toPrune.slice(0, 100), // Limit output
              }, null, 2),
            }],
          };
        }

        case 'cache_store_pattern': {
          const { name, pattern, tags = [], category } = args as {
            name: string;
            pattern: any;
            tags?: string[];
            category?: string;
          };

          return cache_store(name, {
            ...pattern,
            _patternType: 'reusable',
            category,
            tags,
          }, ['pattern', ...tags], 'vault');
        }

        case 'cache_store_reasoning': {
          const { context, reasoning, conclusion, metadata } = args as {
            context: string;
            reasoning: string;
            conclusion?: string;
            metadata?: Record<string, any>;
          };

          const value = {
            reasoning,
            conclusion,
            metadata,
            timestamp: new Date().toISOString(),
          };

          return cache_store(`reasoning:${context}`, value, ['reasoning', context], 'reasoning');
        }

        case 'cache_load_reasoning': {
          const { context, recent = true } = args as {
            context: string;
            recent: boolean;
          };

          const index = loadIndex();
          const matching: CacheEntry[] = [];

          for (const [key, entry] of Object.entries(index.entries)) {
            if (entry.tier === 'reasoning' && key.includes(context)) {
              matching.push(entry);
            }
          }

          if (matching.length === 0) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ error: 'No reasoning found for context', context }, null, 2),
              }],
            };
          }

          // Sort by most recent
          matching.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

          const entry = recent ? matching[0] : matching[matching.length - 1];

          // Update access
          entry.accessCount++;
          entry.lastAccessed = new Date().toISOString();
          index.entries[entry.key] = entry;
          saveIndex(index);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                context,
                reasoning: entry.value.reasoning,
                conclusion: entry.value.conclusion,
                timestamp: entry.value.timestamp,
                accessCount: entry.accessCount,
              }, null, 2),
            }],
          };
        }

        case 'cache_archive_reasoning': {
          const { context, tags = [] } = args as {
            context: string;
            tags?: string[];
          };

          const index = loadIndex();
          const key = `reasoning:${context}`;
          const entry = index.entries[key];

          if (!entry || entry.tier !== 'reasoning') {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ error: 'Reasoning not found in reasoning tier', context }, null, 2),
              }],
            };
          }

          // Archive to vault
          const vaultKey = `archived:${key}`;
          const vaultEntry: CacheEntry = {
            ...entry,
            key: vaultKey,
            tier: 'vault',
            tags: [...entry.tags, 'archived', ...tags],
            archivedFrom: 'reasoning',
            archivedAt: new Date().toISOString(),
          };

          const vaultPath = getPath(vaultKey, 'vault');
          writeFileSync(vaultPath, JSON.stringify(vaultEntry, null, 2), 'utf8');

          // Remove from reasoning tier
          const reasoningPath = getPath(key, 'reasoning');
          if (existsSync(reasoningPath)) {
            unlinkSync(reasoningPath);
          }

          delete index.entries[key];
          index.entries[vaultKey] = vaultEntry;
          saveIndex(index);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                archived: key,
                vaultKey,
                archivedAt: vaultEntry.archivedAt,
              }, null, 2),
            }],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: (error as Error).message,
            tool: name,
          }, null, 2),
        }],
        isError: true,
      };
    }
  });

  return server;
}

// Helper function for storing cache entries
async function cache_store(
  key: string,
  value: any,
  tags: string[],
  tier: 'project' | 'reasoning' | 'vault'
) {
  const index = loadIndex();
  const now = new Date().toISOString();

  const entry: CacheEntry = {
    key,
    value,
    tier,
    createdAt: now,
    accessCount: 0,
    lastAccessed: now,
    tags,
  };

  const filePath = getPath(key, tier);
  writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');

  index.entries[key] = entry;
  saveIndex(index);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ success: true, key, tier, storedAt: now }, null, 2),
    }],
  };
}

export async function startSupercacheServer(): Promise<void> {
  const server = await createSupercacheServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('FLOYD SUPERCACHE MCP Server started');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startSupercacheServer().catch(console.error);
}
