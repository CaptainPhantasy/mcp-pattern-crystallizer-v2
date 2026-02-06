import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Input validation schema
export const ComputeBudgetInputSchema = z.object({
  task: z.string().describe("The task description to analyze for complexity"),
  context: z.object({
    domain: z.string().optional(),
    available_patterns: z.array(z.string()).optional(),
    risk_tolerance: z.enum(["low", "medium", "high"]).optional()
  }).optional(),
  override: z.object({
    compute_level: z.enum(["minimal", "standard", "maximum"])
  }).optional()
});

export type ComputeBudgetInput = z.infer<typeof ComputeBudgetInputSchema>;

// Complexity indicators with their point values
const COMPLEXITY_INDICATORS = [
  { pattern: /\b(multiple|several|various|many)\b/gi, points: 15, name: "multiple_items" },
  { pattern: /\b(integrate|connect|coordinate|combine)\b/gi, points: 20, name: "integration" },
  { pattern: /\b(refactor|migrate|migration)\b/gi, points: 30, name: "migration" },
  { pattern: /\b(authentication|security|encryption|authorization)\b/gi, points: 25, name: "security" },
  { pattern: /\b(database|schema|sql|nosql|orm)\b/gi, points: 20, name: "database" },
  { pattern: /\b(async|parallel|concurrent|thread)\b/gi, points: 20, name: "concurrency" },
  { pattern: /\b(api|rest|graphql|endpoint)\b/gi, points: 15, name: "api" },
  { pattern: /\b(test|mock|stub|verify|validate)\b/gi, points: 10, name: "testing" },
  { pattern: /\b(docker|container|deploy|pipeline)\b/gi, points: 15, name: "infrastructure" },
  { pattern: /\b(performance|optimize|scalability|cache)\b/gi, points: 20, name: "optimization" },
  { pattern: /\b(parse|validate|transform|convert)\b/gi, points: 10, name: "data_processing" }
];

// Historical task database (SEAL pattern - learns from past tasks)
const historicalTasks: Array<{ task: string; actual_complexity: number }> = [
  { task: "add validation to login form", actual_complexity: 30 },
  { task: "add retry logic to api calls", actual_complexity: 40 },
  { task: "implement authentication with jwt", actual_complexity: 65 },
  { task: "create database schema for users", actual_complexity: 45 },
  { task: "write unit tests for controller", actual_complexity: 35 },
  { task: "migrate from rest to graphql", actual_complexity: 85 }
];

function estimateComplexity(task: string, context?: ComputeBudgetInput["context"]): number {
  let score = 20; // baseline complexity

  const taskLower = task.toLowerCase();
  const foundIndicators: string[] = [];

  // Check for complexity indicators
  for (const { pattern, points, name } of COMPLEXITY_INDICATORS) {
    const matches = taskLower.match(pattern);
    if (matches) {
      score += points * Math.min(matches.length, 3); // Cap multiplier at 3
      foundIndicators.push(name);
    }
  }

  // Word count factor (longer descriptions tend to be more complex)
  const wordCount = task.split(/\s+/).length;
  if (wordCount > 50) score += 15;
  else if (wordCount > 30) score += 10;
  else if (wordCount > 15) score += 5;

  // Context adjustments
  if (context) {
    // Risk tolerance increases compute budget
    if (context.risk_tolerance === "low") score += 20;
    else if (context.risk_tolerance === "high") score -= 5;

    // Available patterns reduce complexity (reuse)
    if (context.available_patterns && context.available_patterns.length > 0) {
      score -= context.available_patterns.length * 3;
    }
  }

  return Math.min(Math.max(Math.round(score), 10), 100);
}

function findSimilarTasks(task: string): Array<{ task: string; actual_complexity: number }> {
  // Simple word overlap similarity
  const taskWords = new Set(task.toLowerCase().split(/\s+/).filter(w => w.length > 3));

  return historicalTasks
    .map(ht => {
      const htWords = new Set(ht.task.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      let overlap = 0;
      for (const word of taskWords) {
        if (htWords.has(word)) overlap++;
      }
      return { ...ht, similarity: overlap };
    })
    .filter(ht => ht.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3)
    .map(({ task, actual_complexity }) => ({ task, actual_complexity }));
}

function mapComplexityToAllocation(complexity: number, context?: ComputeBudgetInput["context"]) {
  let computeLevel: "minimal" | "standard" | "deep" | "maximum";
  let thinkingBudget: number;
  let maxTools: number;
  let verificationDepth: "none" | "basic" | "thorough";
  let timeoutSeconds: number;

  if (complexity >= 80) {
    computeLevel = "maximum";
    thinkingBudget = 8000;
    maxTools = 10;
    verificationDepth = "thorough";
    timeoutSeconds = 120;
  } else if (complexity >= 60) {
    computeLevel = "deep";
    thinkingBudget = 5000;
    maxTools = 7;
    verificationDepth = "thorough";
    timeoutSeconds = 90;
  } else if (complexity >= 40) {
    computeLevel = "standard";
    thinkingBudget = 2500;
    maxTools = 5;
    verificationDepth = "basic";
    timeoutSeconds = 60;
  } else {
    computeLevel = "minimal";
    thinkingBudget = 1000;
    maxTools = 3;
    verificationDepth = "basic";
    timeoutSeconds = 30;
  }

  // Adjust for risk tolerance
  if (context?.risk_tolerance === "low") {
    thinkingBudget = Math.round(thinkingBudget * 1.3);
    verificationDepth = "thorough";
  }

  return {
    complexity_score: complexity,
    compute_level: computeLevel,
    thinking_budget: thinkingBudget,
    max_tools: maxTools,
    verification_depth: verificationDepth,
    timeout_seconds: timeoutSeconds
  };
}

function generateRationale(
  task: string,
  _complexity: number,
  context?: ComputeBudgetInput["context"]
): {
  complexity_indicators: string[];
  similar_tasks: Array<{ task: string; actual_complexity: number }>;
  confidence: number;
} {
  const indicators: string[] = [];
  const taskLower = task.toLowerCase();

  for (const { pattern, name } of COMPLEXITY_INDICATORS) {
    if (pattern.test(taskLower)) {
      indicators.push(
        `Detected ${name} pattern in task description`
      );
    }
  }

  const wordCount = task.split(/\s+/).length;
  if (wordCount > 30) {
    indicators.push(`Detailed task description (${wordCount} words) suggests complexity`);
  } else if (wordCount < 15) {
    indicators.push("Concise task description suggests focused scope");
  }

  if (context?.risk_tolerance === "low") {
    indicators.push("Low risk tolerance requires additional verification");
  }

  if (context && context.available_patterns && context.available_patterns.length > 0) {
    indicators.push(`${context.available_patterns.length} reusable patterns available reduce complexity`);
  }

  const similarTasks = findSimilarTasks(task);

  // Confidence based on pattern clarity
  let confidence = 0.7;
  if (indicators.length > 3) confidence = 0.85;
  else if (indicators.length < 2) confidence = 0.6;

  if (similarTasks.length > 0) confidence += 0.1;

  return {
    complexity_indicators: indicators,
    similar_tasks: similarTasks,
    confidence: Math.min(confidence, 0.95)
  };
}

export const computeBudgetAllocator: Tool = {
  name: "compute_budget_allocator",
  description: `Dynamically allocate computational resources based on task complexity (IAS pattern).

Analyzes task to estimate complexity and maps to compute allocation including thinking budget,
tool allowance, and verification depth. Uses the Instance-Adaptive Scaling (IAS) pattern to ensure
simple tasks get fast responses while complex tasks get adequate thinking time.

Key features:
- Complexity estimation via pattern matching and task analysis
- Historical task similarity (SEAL pattern learning)
- Risk-aware allocation adjustments
- Manual override support

Example:
{
  "task": "Implement JWT authentication with refresh tokens",
  "context": {
    "domain": "backend",
    "risk_tolerance": "low"
  }
}`,
  inputSchema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "The task description to analyze for complexity"
      },
      context: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            description: "Domain context (e.g., 'backend', 'frontend', 'devops')"
          },
          available_patterns: {
            type: "array",
            items: { type: "string" },
            description: "Reusable patterns available that reduce complexity"
          },
          risk_tolerance: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "Risk tolerance affects verification depth"
          }
        }
      },
      override: {
        type: "object",
        properties: {
          compute_level: {
            type: "string",
            enum: ["minimal", "standard", "maximum"],
            description: "Manual override for compute level"
          }
        }
      }
    },
    required: ["task"]
  }
};

export async function handleComputeBudgetAllocator(args: unknown) {
  try {
    const input = ComputeBudgetInputSchema.parse(args);

    // If override is provided, use it
    if (input.override) {
      const level = input.override.compute_level;
      const overrideAllocation = {
        complexity_score: level === "maximum" ? 90 : level === "standard" ? 50 : 20,
        compute_level: level === "maximum" ? "maximum" as const : level === "standard" ? "standard" as const : "minimal" as const,
        thinking_budget: level === "maximum" ? 8000 : level === "standard" ? 2500 : 1000,
        max_tools: level === "maximum" ? 10 : level === "standard" ? 5 : 3,
        verification_depth: (level === "maximum" ? "thorough" : "basic") as "thorough" | "basic",
        timeout_seconds: level === "maximum" ? 120 : level === "standard" ? 60 : 30
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            allocation: overrideAllocation,
            rationale: {
              complexity_indicators: ["Manual override applied"],
              similar_tasks: [],
              confidence: 1.0
            },
            recompute_trigger: ["subtask_failure", "unexpected_dependency"],
            note: "Manual override was used for compute allocation"
          }, null, 2)
        }]
      };
    }

    const complexity = estimateComplexity(input.task, input.context);
    const allocation = mapComplexityToAllocation(complexity, input.context);
    const rationale = generateRationale(input.task, complexity, input.context);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          allocation,
          rationale,
          recompute_trigger: ["subtask_failure", "unexpected_dependency"]
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
