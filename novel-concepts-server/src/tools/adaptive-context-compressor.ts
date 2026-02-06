/**
 * adaptive_context_compressor tool
 * Dynamically compresses conversation context using semantic importance.
 * Applies IAS and RLM patterns for intelligent compression.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Input validation schema
export const AdaptiveContextCompressorInputSchema = z.object({
  conversation: z.array(z.object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string(),
    timestamp: z.string().optional(),
    metadata: z.record(z.unknown()).optional()
  })),
  compression_target: z.number().min(100).optional().default(10000),
  preserve_types: z.array(z.enum(["reasoning", "code", "decisions", "errors"])).optional().default(["reasoning", "decisions"]),
  strategy: z.enum(["semantic", "recency", "hybrid"]).optional().default("semantic")
});

export type AdaptiveContextCompressorInput = z.infer<typeof AdaptiveContextCompressorInputSchema>;

// Approximate token counter (rough estimation: ~4 chars per token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Semantic importance classifier
interface ContentElement {
  role: string;
  content: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
  importance: number;
  type: string;
  originalIndex: number;
}

function classifyContent(content: string, role: string): { type: string; importance: number } {
  const lower = content.toLowerCase();

  // High importance indicators
  if (lower.includes("decision:") || lower.includes("decided:") || lower.includes("will implement")) {
    return { type: "decision", importance: 1.0 };
  }
  if (lower.includes("error:") || lower.includes("failed") || lower.includes("exception")) {
    return { type: "error", importance: 0.95 };
  }
  if (lower.includes("reasoning:") || lower.includes("because ") || lower.includes("therefore")) {
    return { type: "reasoning", importance: 0.9 };
  }
  if (content.includes("```") || content.includes("function ") || content.includes("class ")) {
    return { type: "code", importance: 0.85 };
  }
  if (lower.includes("todo:") || lower.includes("need to") || lower.includes("should ")) {
    return { type: "task", importance: 0.8 };
  }

  // Medium importance
  if (lower.startsWith("yes") || lower.startsWith("no") || lower.startsWith("ok") || lower.startsWith("proceed")) {
    return { type: "confirmation", importance: 0.3 };
  }

  // Low importance - general conversation
  return { type: "general", importance: 0.5 };
}

function compressElement(element: ContentElement, targetLength: number): string {
  const { content, type } = element;
  const originalLength = content.length;

  // Don't compress high-value types too much
  if (type === "code" || type === "error") {
    return content;
  }

  // Compress decisions to key format
  if (type === "decision" && originalLength > targetLength) {
    const lines = content.split("\n");
    const keyLines = lines.filter((l, i) => {
      const lower = l.toLowerCase();
      return lower.includes("decision") || lower.includes("implement") ||
             lower.includes("will:") || lower.includes("use ") ||
             i < 3; // Keep first few lines
    });
    return "DECISION: " + keyLines.join(" ").substring(0, targetLength) + "...";
  }

  // Compress reasoning to key points
  if (type === "reasoning" && originalLength > targetLength) {
    const sentences = content.split(/(?<=[.!?])\s+/);
    const keySentences = sentences.filter((s, i) => {
      const lower = s.toLowerCase();
      return lower.includes("because") || lower.includes("therefore") ||
             lower.includes("need") || i < 2;
    });
    return "REASONING: " + keySentences.join(" ").substring(0, targetLength) + "...";
  }

  // Truncate general content
  if (originalLength > targetLength) {
    return content.substring(0, targetLength - 3) + "...";
  }

  return content;
}

export const adaptiveContextCompressorDefinition: Tool = {
  name: "adaptive_context_compressor",
  description: `Dynamically compress conversation context using semantic importance rather than token count.

This tool implements the IAS pattern for adaptive compression and RLM pattern for external variable storage.
It preserves high-value information (reasoning chains, key decisions) while discarding redundancy.

**Features:**
- Semantic "hotspot" detection: identifies decisions, reasoning, code, errors
- Multiple compression strategies: semantic, recency, hybrid
- Preserves provenance: each compressed item tracks its source
- Configurable preservation: choose which content types to preserve

**Compression Strategies:**
- \`semantic\`: Keeps high-importance content, compresses low-importance
- \`recency\`: Prioritizes recent messages
- \`hybrid\`: Combines semantic importance with recency bias

**Preserve Types:**
- \`reasoning\`: Reasoning chains and explanations
- \`code\`: Code blocks and technical content
- \`decisions\`: Key decisions and action items
- \`errors\`: Errors and failures

**Example:**
\`\`\`json
{
  "conversation": [
    { "role": "user", "content": "I need to implement authentication" },
    { "role": "assistant", "content": "I'll help. DECISION: Use JWT with refresh tokens", "metadata": { "type": "decision" } }
  ],
  "compression_target": 5000,
  "preserve_types": ["reasoning", "decisions", "code"],
  "strategy": "semantic"
}
\`\`\``,
  inputSchema: {
    type: "object",
    properties: {
      conversation: {
        type: "array",
        items: {
          type: "object",
          properties: {
            role: { type: "string", enum: ["user", "assistant", "system"] },
            content: { type: "string" },
            timestamp: { type: "string" },
            metadata: { type: "object" }
          },
          required: ["role", "content"]
        },
        description: "Array of conversation messages to compress"
      },
      compression_target: {
        type: "number",
        description: "Target token count for compressed conversation (default: 10000)",
        minimum: 100
      },
      preserve_types: {
        type: "array",
        items: { type: "string", enum: ["reasoning", "code", "decisions", "errors"] },
        description: "Content types to preserve during compression",
        default: ["reasoning", "decisions"]
      },
      strategy: {
        type: "string",
        enum: ["semantic", "recency", "hybrid"],
        description: "Compression strategy to use",
        default: "semantic"
      }
    },
    required: ["conversation"]
  }
};

export async function handleAdaptiveContextCompressor(args: unknown) {
  try {
    const input = AdaptiveContextCompressorInputSchema.parse(args);

    // Calculate original token count
    const originalTokens = input.conversation.reduce(
      (sum, msg) => sum + estimateTokens(msg.content),
      0
    );

    // Classify and score each message
    const elements: ContentElement[] = input.conversation.map((msg, index) => {
      const classification = classifyContent(msg.content, msg.role);
      return {
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        metadata: msg.metadata,
        importance: classification.importance,
        type: classification.type,
        originalIndex: index
      };
    });

    // Apply strategy modifiers
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];

      // Recency boost for newer messages (last 20% get boost)
      if (input.strategy === "recency" || input.strategy === "hybrid") {
        const recencyFactor = 1 + (i / elements.length) * 0.5;
        el.importance *= recencyFactor;
      }

      // Preserve types boost
      if (input.preserve_types.includes(el.type as "reasoning" | "code" | "decisions" | "errors")) {
        el.importance *= 1.5;
      }

      // Cap importance at 1.0
      el.importance = Math.min(el.importance, 1.0);
    }

    // Sort by importance (but maintain some recency for hybrid)
    let sortedElements = [...elements];
    if (input.strategy === "semantic") {
      sortedElements.sort((a, b) => b.importance - a.importance);
    } else if (input.strategy === "recency") {
      // Keep original order for recency
    } else {
      // Hybrid: weighted sort
      sortedElements.sort((a, b) => {
        const scoreA = a.importance * 0.7 + (a.originalIndex / elements.length) * 0.3;
        const scoreB = b.importance * 0.7 + (b.originalIndex / elements.length) * 0.3;
        return scoreB - scoreA;
      }
      );
    }

    // Compress to target
    const compressed: ContentElement[] = [];
    let currentTokens = 0;
    const targetTokens = input.compression_target;

    // First pass: add high-priority items without compression
    for (const el of sortedElements) {
      if (el.importance >= 0.85) {
        const tokens = estimateTokens(el.content);
        if (currentTokens + tokens <= targetTokens * 0.7) {
          compressed.push(el);
          currentTokens += tokens;
        }
      }
    }

    // Second pass: add remaining items with compression
    const maxItemLength = Math.max(100, (targetTokens - currentTokens) / (sortedElements.length - compressed.length) * 4);
    for (const el of sortedElements) {
      if (!compressed.includes(el)) {
        const compressedContent = compressElement(el, maxItemLength);
        const tokens = estimateTokens(compressedContent);
        if (currentTokens + tokens <= targetTokens) {
          compressed.push({ ...el, content: compressedContent });
          currentTokens += tokens;
        }
      }
    }

    // Sort by original index for output
    compressed.sort((a, b) => a.originalIndex - b.originalIndex);

    // Generate compression report
    const compressedTokens = currentTokens;
    const compressionRatio = originalTokens > 0 ? compressedTokens / originalTokens : 1;

    const preservedElements = compressed.reduce((acc, el) => {
      acc[el.type] = (acc[el.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Generate external references (RLM pattern)
    const externalReferences = elements
      .filter(el => !compressed.includes(el))
      .map(el => ({
        id: `ref_${el.originalIndex.toString().padStart(4, "0")}`,
        content_location: `external_var_${el.type}_${el.originalIndex}`
      }));

    // Generate expansion guide
    const expansionGuide = compressed
      .filter(el => el.content.includes("..."))
      .map(el => ({
        compressed_item: el.content.substring(0, 50) + "...",
        expansion_key: `ref_${el.originalIndex.toString().padStart(4, "0")}`
      }));

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          compressed_conversation: compressed.map(el => {
            const result: {
              role: string;
              content: string;
              metadata: {
                type: string;
                original_index: number;
                importance: number;
                timestamp?: string;
              };
            } = {
              role: el.role,
              content: el.content,
              metadata: {
                type: el.type,
                original_index: el.originalIndex,
                importance: Math.round(el.importance * 100) / 100
              }
            };
            if (el.timestamp) {
              result.metadata.timestamp = el.timestamp;
            }
            return result;
          }),
          compression_report: {
            original_tokens: originalTokens,
            compressed_tokens: Math.round(compressedTokens),
            compression_ratio: Math.round(compressionRatio * 100) / 100,
            preserved_elements: Object.entries(preservedElements).map(([type, count]) => ({ type, count }))
          },
          external_references: externalReferences,
          expansion_guide: expansionGuide,
          strategy_used: input.strategy
        }, null, 2)
      }]
    };
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
