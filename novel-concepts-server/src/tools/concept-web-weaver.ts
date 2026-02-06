/**
 * concept_web_weaver tool
 * Builds a directed graph where nodes = concepts, edges = relationships.
 * Applies SEAL pattern: reinforces frequently-used concept paths.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getGraph } from "../storage/graph.js";

// Zod schemas for validation
export const ConceptWebWeaverInputSchema = z.object({
  action: z.enum(["register", "query", "strengthen", "traverse", "stats", "list"]),
  concept: z.string().optional(),
  relationships: z.array(z.object({
    type: z.enum(["depends_on", "implements", "generalizes", "conflicts_with"]),
    target: z.string()
  })).optional(),
  query_type: z.enum(["neighbors", "path_to", "impact_analysis", "dependents"]).optional(),
  target_concept: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

export type ConceptWebWeaverInput = z.infer<typeof ConceptWebWeaverInputSchema>;

// JSON Schema for MCP
export const conceptWebWeaverDefinition: Tool = {
  name: "concept_web_weaver",
  description: `Maintain a semantic graph of interconnected concepts that evolves through interaction.

This tool implements the SEAL (Study-Extract-Apply-Learn) pattern, reinforcing frequently-used concept
paths like neural pathways. Enables context-aware retrieval based on conceptual proximity.

**Actions:**

- **register**: Add a new concept with optional relationships to other concepts
- **query**: Query the graph for neighbors, paths, or impact analysis
- **strengthen**: Reinforce a concept-path (SEAL pattern - called after successful problem-solving)
- **traverse**: Find a path between two concepts
- **stats**: Get graph statistics
- **list**: List all registered concepts

**Relationship Types:**
- \`depends_on\`: This concept requires the target to exist/work
- \`implements\`: This concept is an implementation of the target
- \`generalizes\`: This concept is a broader category of the target
- \`conflicts_with\`: This concept cannot coexist with the target

**Examples:**

Register a new concept:
\`\`\`json
{
  "action": "register",
  "concept": "authentication_middleware",
  "relationships": [
    { "type": "depends_on", "target": "session_storage" },
    { "type": "implements", "target": "auth_strategy" }
  ]
}
\`\`\`

Query impact analysis (what breaks if I modify X?):
\`\`\`json
{
  "action": "query",
  "query_type": "impact_analysis",
  "concept": "session_storage"
}
\`\`\`

Find path between concepts:
\`\`\`json
{
  "action": "traverse",
  "concept": "service_layer",
  "target_concept": "database_connection"
}
\`\`\``,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["register", "query", "strengthen", "traverse", "stats", "list"],
        description: "The action to perform on the concept graph"
      },
      concept: {
        type: "string",
        description: "The concept name (for register, query, strengthen, traverse)"
      },
      relationships: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["depends_on", "implements", "generalizes", "conflicts_with"]
            },
            target: {
              type: "string"
            }
          },
          required: ["type", "target"]
        },
        description: "Relationships to create (for register action)"
      },
      query_type: {
        type: "string",
        enum: ["neighbors", "path_to", "impact_analysis", "dependents"],
        description: "Type of query (for query action)"
      },
      target_concept: {
        type: "string",
        description: "Target concept for path traversal or impact analysis"
      },
      metadata: {
        type: "object",
        description: "Optional metadata to attach to a concept (for register action)"
      }
    },
    required: ["action"]
  }
};

/**
 * Handler function for concept_web_weaver tool
 */
export async function handleConceptWebWeaver(args: unknown) {
  try {
    const input = ConceptWebWeaverInputSchema.parse(args);
    const graph = getGraph();

    switch (input.action) {
      case "register": {
        if (!input.concept) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Missing required field: concept",
                hint: "The 'concept' field is required when action is 'register'"
              }, null, 2)
            }],
            isError: true
          };
        }

        const conceptId = graph.register(
          input.concept,
          input.relationships || [],
          input.metadata
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              concept_id: conceptId,
              concept: input.concept,
              relationships_created: input.relationships?.length || 0,
              message: `Concept "${input.concept}" registered successfully`
            }, null, 2)
          }]
        };
      }

      case "query": {
        if (!input.concept) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Missing required field: concept",
                hint: "The 'concept' field is required when action is 'query'"
              }, null, 2)
            }],
            isError: true
          };
        }

        const node = graph.getNode(input.concept);
        if (!node) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Concept not found",
                concept: input.concept,
                hint: "Register the concept first using action: 'register'"
              }, null, 2)
            }],
            isError: true
          };
        }

        const queryType = input.query_type || "neighbors";

        switch (queryType) {
          case "neighbors": {
            const neighbors = graph.getNeighbors(input.concept);
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  concept: input.concept,
                  neighbors: neighbors.map(n => ({
                    concept: n.concept,
                    relationship: n.relationship,
                    strength: Math.round(n.strength * 100) / 100
                  })),
                  count: neighbors.length
                }, null, 2)
              }]
            };
          }

          case "dependents": {
            const dependents = graph.getDependents(input.concept);
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  concept: input.concept,
                  dependents: dependents.map(d => ({
                    concept: d.concept,
                    relationship: d.relationship,
                    strength: Math.round(d.strength * 100) / 100
                  })),
                  count: dependents.length
                }, null, 2)
              }]
            };
          }

          case "impact_analysis": {
            const impact = graph.impactAnalysis(input.concept);
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  concept: input.concept,
                  impact: impact.map(i => ({
                    concept: i.concept,
                    affected_edges: i.affected_edges
                  })),
                  affected_count: impact.length,
                  severity: impact.length > 5 ? "high" : impact.length > 2 ? "medium" : "low"
                }, null, 2)
              }]
            };
          }

          case "path_to": {
            if (!input.target_concept) {
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    error: "Missing required field: target_concept",
                    hint: "The 'target_concept' field is required for path_to queries"
                  }, null, 2)
                }],
                isError: true
              };
            }

            const path = graph.findPath(input.concept, input.target_concept);
            if (path === null) {
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    concept: input.concept,
                    target_concept: input.target_concept,
                    path: null,
                    message: "No path found between these concepts"
                  }, null, 2)
                }]
              };
            }

            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  from: input.concept,
                  to: input.target_concept,
                  path: path.map((p, i) => ({
                    step: i + 1,
                    concept: p.concept,
                    relationship: p.relationship,
                    strength: Math.round(p.strength * 100) / 100
                  })),
                  path_length: path.length
                }, null, 2)
              }]
            };
          }

          default:
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  error: "Unknown query_type",
                  query_type: queryType
                }, null, 2)
              }],
              isError: true
            };
        }
      }

      case "strengthen": {
        if (!input.concept) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Missing required field: concept"
              }, null, 2)
            }],
            isError: true
          };
        }

        const node = graph.getNode(input.concept);
        if (!node) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Concept not found",
                concept: input.concept
              }, null, 2)
            }],
            isError: true
          };
        }

        graph.strengthen(input.concept);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              concept: input.concept,
              message: "Concept and its relationships strengthened (SEAL pattern)",
              access_count: node.access_count + 1
            }, null, 2)
          }]
        };
      }

      case "traverse": {
        if (!input.concept || !input.target_concept) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Missing required fields",
                required: ["concept", "target_concept"],
                provided: {
                  concept: input.concept,
                  target_concept: input.target_concept
                }
              }, null, 2)
            }],
            isError: true
          };
        }

        const path = graph.findPath(input.concept, input.target_concept);

        if (path === null) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                from: input.concept,
                to: input.target_concept,
                path: null,
                message: "No path exists between these concepts",
                hint: "Consider registering relationships to connect these concepts"
              }, null, 2)
            }]
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              from: input.concept,
              to: input.target_concept,
              path: path.map((p, i) => ({
                step: i + 1,
                concept: p.concept,
                relationship: p.relationship,
                strength: Math.round(p.strength * 100) / 100
              })),
              path_length: path.length
            }, null, 2)
          }]
        };
      }

      case "stats": {
        const stats = graph.getStats();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              graph_statistics: {
                total_concepts: stats.nodeCount,
                total_relationships: stats.edgeCount,
                average_connection_strength: Math.round(stats.avgStrength * 100) / 100
              },
              seal_pattern_active: true,
              message: "Graph grows stronger with use"
            }, null, 2)
          }]
        };
      }

      case "list": {
        const concepts = graph.getAllConcepts();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              concepts: concepts,
              count: concepts.length
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
