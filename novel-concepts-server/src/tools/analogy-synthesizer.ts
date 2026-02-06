/**
 * analogy_synthesizer tool
 * Generates cross-domain analogies by mapping structural patterns.
 * Applies SEAL pattern: successful analogies crystallize as reusable patterns.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getPatternLibrary } from "../storage/patterns.js";

// Input validation schema
export const AnalogySynthesizerInputSchema = z.object({
  problem_description: z.string().min(1),
  source_domains: z.array(z.string()).optional(),
  abstraction_level: z.enum(["shallow", "deep"]).optional().default("deep"),
  max_results: z.number().min(1).max(10).optional().default(3)
});

export type AnalogySynthesizerInput = z.infer<typeof AnalogySynthesizerInputSchema>;

// Extract structural features from problem description
function extractStructure(description: string): {
  key_terms: string[];
  relationships: Array<{ from: string; to: string; type: string }>;
  constraints: string[];
} {
  const lower = description.toLowerCase();
  const key_terms: string[] = [];
  const relationships: Array<{ from: string; to: string; type: string }> = [];
  const constraints: string[] = [];

  // Extract key terms (nouns, verbs)
  const termPatterns = [
    /(\w+)s?\s+(?:need|must|should|can)\s+/g,
    /(\w+)s?\s+(?:coordinate|communicate|interact)/g,
    /(?:manage|handle|process)\s+(\w+)/g,
    /(?:implement|build|create)\s+(?:a\s+)?(\w+)/g
  ];

  for (const pattern of termPatterns) {
    let match;
    while ((match = pattern.exec(description)) !== null) {
      const term = match[1];
      if (term.length > 3 && !key_terms.includes(term)) {
        key_terms.push(term);
      }
    }
  }

  // Extract relationships
  if (lower.includes("depend") || lower.includes("require") || lower.includes("wait for")) {
    relationships.push({ from: "dependent", to: "dependency", type: "depends_on" });
  }
  if (lower.includes("communicate") || lower.includes("share") || lower.includes("send")) {
    relationships.push({ from: "participants", to: "information", type: "flows_to" });
  }
  if (lower.includes("compete") || lower.includes("claim") || lower.includes("acquire")) {
    relationships.push({ from: "actors", to: "resources", type: "competes_for" });
  }
  if (lower.includes("coordinate") || lower.includes("organize") || lower.includes("synchronize")) {
    relationships.push({ from: "participants", to: "central", type: "coordinates_with" });
  }
  if (lower.includes("queue") || lower.includes("waiting") || lower.includes("pending")) {
    relationships.push({ from: "items", to: "queue", type: "wait_in" });
  }

  // Extract constraints
  if (lower.includes("without duplicate") || lower.includes("avoid duplicate")) {
    constraints.push("no_duplication");
  }
  if (lower.includes("real-time") || lower.includes("immediate") || lower.includes("instant")) {
    constraints.push("real_time");
  }
  if (lower.includes("scalable") || lower.includes("scale") || lower.includes("growing")) {
    constraints.push("scalability");
  }
  if (lower.includes("unknown") || lower.includes("dynamic") || lower.includes("uncertain")) {
    constraints.push("dynamic_workload");
  }
  if (lower.includes("fault") || lower.includes("failure") || lower.includes("resilient")) {
    constraints.push("fault_tolerance");
  }

  return { key_terms, relationships, constraints };
}

// Calculate structural similarity between problem and pattern
function calculateStructuralSimilarity(
  problemStructure: ReturnType<typeof extractStructure>,
  pattern: {
    key_features: string[];
    common_problems: string[];
    typical_solutions: string[];
  }
): number {
  let score = 0;
  let maxScore = 0;

  // Check key terms against pattern features
  const problemText = problemStructure.key_terms.join(" ").toLowerCase();
  const patternText = [
    ...pattern.key_features,
    ...pattern.common_problems,
    ...pattern.typical_solutions
  ].join(" ").toLowerCase();

  const problemWords = new Set(problemText.split(/\s+/));
  const patternWords = new Set(patternText.split(/\s+/));

  let overlap = 0;
  for (const word of problemWords) {
    if (word.length > 3 && patternWords.has(word)) {
      overlap++;
    }
  }

  maxScore += 10;
  score += Math.min(overlap * 2, 10);

  // Check relationships
  maxScore += 10;
  for (const rel of problemStructure.relationships) {
    for (const feature of pattern.key_features) {
      const lower = feature.toLowerCase();
      if ((rel.type.includes("depend") && lower.includes("depend")) ||
          (rel.type.includes("compete") && lower.includes("claim")) ||
          (rel.type.includes("wait") && lower.includes("queue"))) {
        score += 3;
      }
    }
  }

  // Check constraints
  maxScore += 10;
  for (const constraint of problemStructure.constraints) {
    for (const problem of pattern.common_problems) {
      if (problem.toLowerCase().includes(constraint.replace("_", " "))) {
        score += 2;
      }
    }
  }

  return maxScore > 0 ? Math.min(score / maxScore, 1) : 0;
}

// Generate mapping between source domain and target problem
function generateMapping(
  pattern: {
    key_features: string[];
    typical_solutions: string[];
  },
  problemDescription: string
): Array<{ source_feature: string; target_feature: string }> {
  const mapping: Array<{ source_feature: string; target_feature: string }> = [];

  // Common mappings
  const mappings: Array<{ source: string[]; target: string[] }> = [
    {
      source: ["ticket", "order", "task"],
      target: ["task", "job", "work item", "request"]
    },
    {
      source: ["worker", "chef", "server"],
      target: ["agent", "worker", "process", "service"]
    },
    {
      source: ["ticket rail", "expediter", "kitchen display"],
      target: ["task queue", "message broker", "coordination service"]
    },
    {
      source: ["customer", "diner"],
      target: ["user", "client", "requester"]
    },
    {
      source: ["table", "station"],
      target: ["resource", "endpoint", "service instance"]
    },
    {
      source: ["menu", "menu board"],
      target: ["API", "service catalog", "available operations"]
    }
  ];

  const problemLower = problemDescription.toLowerCase();

  for (const { source, target } of mappings) {
    for (const s of source) {
      if (pattern.key_features.some(f => f.toLowerCase().includes(s))) {
        // Find corresponding target term
        for (const t of target) {
          if (problemLower.includes(t)) {
            mapping.push({ source_feature: s, target_feature: t });
            break;
          }
        }
      }
    }
  }

  // Add generic mappings if few found
  if (mapping.length < 3) {
    mapping.push(
      { source_feature: "central coordination point", target_feature: "orchestrator/coordinator" },
      { source_feature: "worker/unit of work", target_feature: "task/job" }
    );
  }

  return mapping;
}

// Generate transferable insights
function generateInsights(
  pattern: {
    key_features: string[];
    typical_solutions: string[];
  },
  problemDescription: string
): string[] {
  const insights: string[] = [];
  const lower = problemDescription.toLowerCase();

  for (const solution of pattern.typical_solutions) {
    // Convert solution to apply to software context
    let insight = solution;

    // Common translations
    if (insight.toLowerCase().includes("pull")) {
      insights.push(`Use pull-based model: workers claim tasks rather than having tasks pushed`);
    }
    if (insight.toLowerCase().includes("priority")) {
      insights.push(`Implement priority queue for handling urgent items`);
    }
    if (insight.toLowerCase().includes("state") || insight.toLowerCase().includes("status")) {
      insights.push(`Track state transitions: pending -> claimed -> in_progress -> complete`);
    }
    if (insight.toLowerCase().includes("specialization") || insight.toLowerCase().includes("station")) {
      insights.push(`Allow workers to specialize by capability/skill type`);
    }
    if (insight.toLowerCase().includes("central")) {
      insights.push(`Use central coordination point for visibility and deduplication`);
    }
    if (insight.toLowerCase().includes("feedback")) {
      insights.push(`Implement feedback mechanism for adaptive behavior`);
    }
  }

  // Add insights based on key features
  for (const feature of pattern.key_features) {
    const f = feature.toLowerCase();
    if (f.includes("visibility") && lower.includes("multiple")) {
      insights.push(`Ensure all participants have visibility into available work to avoid duplication`);
    }
    if (f.includes("reservation") && lower.includes("share")) {
      insights.push(`Implement reservation system for fair resource access`);
    }
  }

  return insights.slice(0, 5); // Limit to 5 insights
}

// Generate suggested approach
function generateApproach(
  pattern: { source_domain: string; abstract_structure: string },
  insights: string[],
  problemDescription: string
): string {
  const lower = problemDescription.toLowerCase();

  let approach = `Apply the ${pattern.source_domain.replace(/_/g, " ")} pattern: `;

  // Build approach from insights
  if (insights.length > 0) {
    approach += insights[0];
    if (insights.length > 1) {
      approach += `. ${insights.slice(1, 3).join(". ")}`;
    }
  } else {
    approach += pattern.abstract_structure;
  }

  // Add specific recommendations based on problem content
  if (lower.includes("task") && lower.includes("multiple")) {
    approach += `. Implement a task board where agents can claim available work, ensuring no duplication.`;
  }
  if (lower.includes("depend") || lower.includes("wait")) {
    approach += `. Track dependencies between items and only make work available when prerequisites are satisfied.`;
  }
  if (lower.includes("priority")) {
    approach += `. Support priority levels to ensure important work is handled first.`;
  }

  return approach;
}

export const analogySynthesizerDefinition: Tool = {
  name: "analogy_synthesizer",
  description: `Generate cross-domain analogies to solve novel problems by mapping structural patterns.

This tool implements the SEAL pattern: successful analogies crystallize as reusable transfer patterns.
It finds domains with matching structure but different surface details and generates analogical mappings.

**Abstraction Levels:**
- \`shallow\`: Surface-level similarity, more matches but less reliable
- \`deep\`: Structural similarity, fewer matches but more reliable (default)

**Output:**
- Source domains that map to your problem
- Structural match explanation
- Feature mappings (source -> target)
- Transferable insights
- Suggested approach based on best analogy

**Built-in Source Domains:**
- \`restaurant_kitchen\`: Task coordination with specialized workers
- \`ant_colony\`: Decentralized optimization through positive feedback
- \`library_system\`: Resource sharing with reservations
- \`traffic_control\`: State-based flow control
- \`restaurant_service\`: Multi-tier service architecture
- \`supply_chain\`: Multi-echelon inventory management

**Example:**
\`\`\`json
{
  "problem_description": "Need to implement a system where multiple agents can work on tasks without duplicating work",
  "source_domains": ["restaurant_kitchen", "ant_colony"],
  "abstraction_level": "deep",
  "max_results": 3
}
\`\`\``,
  inputSchema: {
    type: "object",
    properties: {
      problem_description: {
        type: "string",
        description: "Description of the problem to solve"
      },
      source_domains: {
        type: "array",
        items: { type: "string" },
        description: "Optional: restrict to specific source domains"
      },
      abstraction_level: {
        type: "string",
        enum: ["shallow", "deep"],
        description: "Depth of structural analysis",
        default: "deep"
      },
      max_results: {
        type: "number",
        description: "Maximum number of analogies to return",
        minimum: 1,
        maximum: 10,
        default: 3
      }
    },
    required: ["problem_description"]
  }
};

export async function handleAnalogySynthesizer(args: unknown) {
  try {
    const input = AnalogySynthesizerInputSchema.parse(args);
    const library = await getPatternLibrary();

    // Extract structure from problem description
    const problemStructure = extractStructure(input.problem_description);

    // Get patterns to analyze
    let patterns = library.getAll();
    if (input.source_domains && input.source_domains.length > 0) {
      patterns = patterns.filter(p =>
        input.source_domains!.some(d => p.source_domain.toLowerCase().includes(d.toLowerCase()))
      );
    }

    // Calculate structural similarity for each pattern
    const analogies = patterns.map(pattern => {
      const similarity = calculateStructuralSimilarity(problemStructure, {
        key_features: pattern.key_features,
        common_problems: pattern.common_problems,
        typical_solutions: pattern.typical_solutions
      });

      const mapping = generateMapping(
        {
          key_features: pattern.key_features,
          typical_solutions: pattern.typical_solutions
        },
        input.problem_description
      );

      const insights = generateInsights(
        {
          key_features: pattern.key_features,
          typical_solutions: pattern.typical_solutions
        },
        input.problem_description
      );

      // Adjust confidence based on abstraction level
      let confidence = similarity;
      if (input.abstraction_level === "shallow") {
        confidence = Math.min(confidence + 0.2, 1);
      } else {
        // Deep - more conservative
        confidence = confidence * 0.9;
      }

      return {
        source_domain: pattern.source_domain,
        structural_match: pattern.abstract_structure,
        mapping,
        transferable_insights: insights,
        confidence: Math.round(confidence * 100) / 100,
        pattern_id: pattern.id
      };
    });

    // Sort by confidence and limit results
    analogies.sort((a, b) => b.confidence - a.confidence);
    const topAnalogies = analogies.slice(0, input.max_results);

    // Select best analogy
    const bestAnalogy = topAnalogies[0];
    const suggestedApproach = bestAnalogy
      ? generateApproach(
          { source_domain: bestAnalogy.source_domain, abstract_structure: bestAnalogy.structural_match },
          bestAnalogy.transferable_insights,
          input.problem_description
        )
      : "No suitable analogy found";

    // Strengthen the best pattern (SEAL pattern)
    if (bestAnalogy && bestAnalogy.confidence > 0.6) {
      await library.strengthen(bestAnalogy.pattern_id);
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          problem_analyzed: input.problem_description.substring(0, 100) + "...",
          extracted_structure: {
            key_terms: problemStructure.key_terms,
            relationship_types: problemStructure.relationships.map(r => r.type),
            constraints: problemStructure.constraints
          },
          analogies: topAnalogies,
          best_analogy: {
            domain: bestAnalogy?.source_domain || "none",
            rationale: bestAnalogy?.structural_match || "",
            suggested_approach: suggestedApproach,
            confidence: bestAnalogy?.confidence || 0
          },
          abstraction_level: input.abstraction_level
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
