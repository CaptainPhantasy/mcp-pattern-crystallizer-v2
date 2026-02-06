/**
 * episodic_memory_bank tool
 * Stores and retrieves problem-solving episodes with reasoning chains.
 * Applies RLM pattern: episodes stored externally, metadata in context.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getEpisodeBank } from "../storage/episodes.js";

// Input validation schema
export const EpisodeMetadataSchema = z.object({
  domain: z.string().optional(),
  complexity: z.number().min(1).max(10).optional(),
  tags: z.array(z.string()).optional()
}).passthrough(); // Allow additional fields

export const EpisodeInputSchema = z.object({
  trigger: z.string().min(1),
  reasoning: z.string().min(1),
  solution: z.string().min(1),
  outcome: z.enum(["success", "partial", "failure"]),
  metadata: EpisodeMetadataSchema.optional()
});

export const EpisodicMemoryBankInputSchema = z.object({
  action: z.enum(["store", "retrieve", "adapt", "get", "stats", "list"]),
  episode: EpisodeInputSchema.optional(),
  query: z.string().optional(),
  current_context: z.string().optional(),
  max_results: z.number().min(1).max(20).optional().default(3),
  episode_id: z.string().optional()
});

export type EpisodicMemoryBankInput = z.infer<typeof EpisodicMemoryBankInputSchema>;

// Generate adaptation suggestions
function generateAdaptation(
  baseEpisode: {
    trigger: string;
    reasoning: string;
    solution: string;
  },
  currentContext: string,
  query: string
): {
  base_solution: string;
  suggested_modifications: Array<{ what: string; why: string }>;
  confidence: number;
} {
  const modifications: Array<{ what: string; why: string }> = [];
  const baseSolution = baseEpisode.solution;

  // Analyze differences between base and current context
  const contextLower = currentContext.toLowerCase();
  const triggerLower = baseEpisode.trigger.toLowerCase();

  // Technology differences
  const techMapping: Record<string, string[]> = {
    redis: ["mongodb", "postgresql", "memcached", "database"],
    express: ["fastify", "koa", "nestjs", "hapi"],
    jwt: ["oauth", "session", "passport", "saml"],
    graphql: ["rest", "grpc", "soap"],
    sql: ["nosql", "mongodb", "cassandra", "dynamodb"]
  };

  for (const [fromTech, toTechs] of Object.entries(techMapping)) {
    if (triggerLower.includes(fromTech)) {
      for (const toTech of toTechs) {
        if (contextLower.includes(toTech)) {
          modifications.push({
            what: `Replace ${fromTech} with ${toTech}`,
            why: `Current context uses ${toTech} instead of ${fromTech}`
          });
        }
      }
    }
  }

  // Framework differences
  if (triggerLower.includes("express") && contextLower.includes("fastify")) {
    modifications.push({
      what: "Use Fastify plugin system instead of Express middleware",
      why: "Fastify uses a plugin architecture rather than middleware"
    });
  }

  // Session storage differences
  if (triggerLower.includes("redis") && contextLower.includes("mongodb")) {
    modifications.push({
      what: "Use MongoDB TTL index instead of Redis TTL",
      why: "MongoDB doesn't have Redis-style key expiration, use TTL indexes instead"
    });
  }

  // Check for specific keywords
  const currentKeywords = new Set(currentContext.toLowerCase().split(/\s+/).filter(w => w.length > 4));
  const baseKeywords = new Set(triggerLower.split(/\s+/).filter(w => w.length > 4));

  // Find unique current context keywords
  for (const keyword of currentKeywords) {
    if (!baseKeywords.has(keyword)) {
      modifications.push({
        what: `Consider ${keyword} in the solution`,
        why: `Current context mentions '${keyword}' which was not in the original scenario`
      });
    }
  }

  // Calculate confidence based on similarity
  const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const triggerWords = new Set(triggerLower.split(/\s+/).filter(w => w.length > 3));

  let overlap = 0;
  for (const word of queryWords) {
    if (triggerWords.has(word)) overlap++;
  }

  const similarity = queryWords.size > 0 ? overlap / queryWords.size : 0;
  const confidence = Math.min(0.5 + similarity + (modifications.length > 0 ? 0.1 : 0), 0.95);

  return {
    base_solution: baseSolution,
    suggested_modifications: modifications.slice(0, 5), // Limit to 5 modifications
    confidence: Math.round(confidence * 100) / 100
  };
}

export const episodicMemoryBankDefinition: Tool = {
  name: "episodic_memory_bank",
  description: `Store and retrieve problem-solving episodes with full reasoning chains.

This tool implements the RLM pattern: episode content is stored as external variable,
with only metadata in context. Enables case-based reasoning where past solutions
can be adapted to novel but similar situations.

**Actions:**

- **store**: Save a new problem-solving episode with reasoning chain
- **retrieve**: Find similar episodes based on semantic similarity
- **adapt**: Retrieve and adapt a solution to current context
- **get**: Get a specific episode by ID
- **stats**: Get memory bank statistics
- **list**: List all episodes (optionally filtered by outcome/domain)

**Episode Structure:**
- \`trigger\`: What prompted this episode (the problem)
- \`reasoning\`: Full reasoning chain to solution
- \`solution\`: What was done to solve it
- \`outcome\`: "success", "partial", or "failure"
- \`metadata\`: Optional tags, domain, complexity

**Example (store):**
\`\`\`json
{
  "action": "store",
  "episode": {
    "trigger": "User reported session timeout after 5 minutes of inactivity",
    "reasoning": "Root cause: Redis default TTL is 300 seconds. Need to configure session middleware with custom ttl.",
    "solution": "Set session.cookie.maxAge to 24 hours and Redis TTL to match",
    "outcome": "success",
    "metadata": { "domain": "backend", "complexity": 3 }
  }
}
\`\`\`

**Example (adapt):**
\`\`\`json
{
  "action": "adapt",
  "query": "Users getting logged out unexpectedly after short time",
  "current_context": "Using Express-session with MongoDB store",
  "max_results": 3
}
\`\`\``,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["store", "retrieve", "adapt", "get", "stats", "list"],
        description: "The action to perform"
      },
      episode: {
        type: "object",
        properties: {
          trigger: {
            type: "string",
            description: "What prompted this episode (the problem)"
          },
          reasoning: {
            type: "string",
            description: "Full reasoning chain to solution"
          },
          solution: {
            type: "string",
            description: "What was done to solve it"
          },
          outcome: {
            type: "string",
            enum: ["success", "partial", "failure"],
            description: "The outcome of applying the solution"
          },
          metadata: {
            type: "object",
            properties: {
              domain: { type: "string" },
              complexity: { type: "number", minimum: 1, maximum: 10 },
              tags: { type: "array", items: { type: "string" } }
            }
          }
        },
        required: ["trigger", "reasoning", "solution", "outcome"]
      },
      query: {
        type: "string",
        description: "Query for retrieving similar episodes"
      },
      current_context: {
        type: "string",
        description: "Current context for adaptation (for adapt action)"
      },
      max_results: {
        type: "number",
        description: "Maximum number of results to return (default: 3)",
        minimum: 1,
        maximum: 20,
        default: 3
      },
      episode_id: {
        type: "string",
        description: "Episode ID (for get action)"
      }
    },
    required: ["action"]
  }
};

export async function handleEpisodicMemoryBank(args: unknown) {
  try {
    const input = EpisodicMemoryBankInputSchema.parse(args);
    const bank = await getEpisodeBank();

    switch (input.action) {
      case "store": {
        if (!input.episode) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Missing required field: episode",
                hint: "The 'episode' object is required when action is 'store'"
              }, null, 2)
            }],
            isError: true
          };
        }

        const episode = await bank.store({
          trigger: input.episode.trigger,
          reasoning: input.episode.reasoning,
          solution: input.episode.solution,
          outcome: input.episode.outcome,
          metadata: (input.episode.metadata as Record<string, unknown> | undefined) ?? {}
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              episode_id: episode.id,
              episode: {
                trigger: episode.trigger,
                solution: episode.solution,
                outcome: episode.outcome,
                metadata: episode.metadata
              },
              created: new Date(episode.created).toISOString(),
              message: `Episode "${episode.id}" stored successfully`
            }, null, 2)
          }]
        };
      }

      case "retrieve": {
        if (!input.query) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Missing required field: query",
                hint: "The 'query' field is required when action is 'retrieve'"
              }, null, 2)
            }],
            isError: true
          };
        }

        const results = bank.retrieve(input.query, input.max_results);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              query: input.query,
              episodes: results.map(r => ({
                id: r.episode.id,
                trigger: r.episode.trigger,
                reasoning: r.episode.reasoning,
                solution: r.episode.solution,
                outcome: r.episode.outcome,
                similarity_score: r.similarity_score,
                metadata: r.episode.metadata
              })),
              count: results.length,
              message: results.length === 0
                ? "No similar episodes found. Consider storing this as a new episode."
                : `Found ${results.length} similar episode(s)`
            }, null, 2)
          }]
        };
      }

      case "adapt": {
        if (!input.query) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Missing required field: query"
              }, null, 2)
            }],
            isError: true
          };
        }

        const results = bank.retrieve(input.query, input.max_results);

        if (results.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "No similar episodes found",
                query: input.query,
                hint: "Store similar episodes first, or try a different query"
              }, null, 2)
            }],
            isError: true
          };
        }

        // Use the most similar episode for adaptation
        const bestMatch = results[0].episode;
        const currentContext = input.current_context || "";

        const adaptation = generateAdaptation(bestMatch, currentContext, input.query);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              query: input.query,
              current_context: currentContext || "not provided",
              base_episode: {
                id: bestMatch.id,
                trigger: bestMatch.trigger,
                outcome: bestMatch.outcome
              },
              adaptation,
              alternatives: results.slice(1).map(r => ({
                id: r.episode.id,
                trigger: r.episode.trigger,
                similarity_score: r.similarity_score
              }))
            }, null, 2)
          }]
        };
      }

      case "get": {
        if (!input.episode_id) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Missing required field: episode_id"
              }, null, 2)
            }],
            isError: true
          };
        }

        const episode = bank.get(input.episode_id);

        if (!episode) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Episode not found",
                episode_id: input.episode_id
              }, null, 2)
            }],
            isError: true
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              episode: {
                id: episode.id,
                trigger: episode.trigger,
                reasoning: episode.reasoning,
                solution: episode.solution,
                outcome: episode.outcome,
                metadata: episode.metadata,
                created: new Date(episode.created).toISOString(),
                access_count: episode.access_count
              }
            }, null, 2)
          }]
        };
      }

      case "stats": {
        const stats = bank.getStats();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              statistics: {
                total_episodes: stats.total,
                by_outcome: stats.byOutcome,
                by_domain: stats.byDomain,
                avg_access_count: Math.round(stats.avgAccessCount * 100) / 100
              },
              message: `Memory bank contains ${stats.total} episode(s)`
            }, null, 2)
          }]
        };
      }

      case "list": {
        const episodes = bank.getAll();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              episodes: episodes.map(ep => ({
                id: ep.id,
                trigger: ep.trigger,
                outcome: ep.outcome,
                domain: ep.metadata.domain,
                created: new Date(ep.created).toISOString()
              })),
              count: episodes.length
            }, null, 2)
          }]
        };
      }

      default:
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "Unknown action",
              action: input.action
            }, null, 2)
          }],
          isError: true
        };
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: "Validation error",
            details: error.errors
          }, null, 2)
        }],
        isError: true
      };
    }
    throw error;
  }
}
