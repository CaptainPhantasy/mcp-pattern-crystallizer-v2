/**
 * consensus_protocol tool
 * Simulates multiple agents with different perspectives to reach consensus.
 * Applies Concept-Sync pattern for explicit shared concepts.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Input validation schema
export const ConsensusProtocolInputSchema = z.object({
  question: z.string().min(1),
  domain: z.string().optional(),
  perspectives: z.array(z.string()).optional().default(["optimistic", "pessimistic", "pragmatic", "security", "performance"]),
  consensus_threshold: z.number().min(0).max(1).optional().default(0.7)
});

export type ConsensusProtocolInput = z.infer<typeof ConsensusProtocolInputSchema>;

// Perspective prompts for analysis
const PERSPECTIVE_TEMPLATES: Record<string, {
  focus: string;
  biases: string[];
  weight: number;
}> = {
  optimistic: {
    focus: "Best-case scenarios, opportunities, potential gains",
    biases: ["Assumes things will work out", "Focuses on benefits", "Minimizes risks"],
    weight: 1.0
  },
  pessimistic: {
    focus: "Worst-case scenarios, risks, potential failures",
    biases: ["Assumes things will go wrong", "Focuses on problems", "Minimizes benefits"],
    weight: 1.0
  },
  pragmatic: {
    focus: "Practical implementation, cost-benefit analysis, tradeoffs",
    biases: ["Considers constraints", "Values simplicity", "Avoids over-engineering"],
    weight: 1.2
  },
  security: {
    focus: "Security implications, vulnerabilities, attack surface",
    biases: ["Assumes malicious actors", "Prioritizes safety", "Considers privacy"],
    weight: 1.1
  },
  performance: {
    focus: "Performance impact, scalability, resource usage",
    biases: ["Prioritizes speed", "Considers load", "Values efficiency"],
    weight: 1.0
  },
  maintainability: {
    focus: "Code quality, documentation, future maintenance",
    biases: ["Values clarity", "Considers technical debt", "Prioritizes standards"],
    weight: 1.0
  },
  user_experience: {
    focus: "User-facing impact, usability, accessibility",
    biases: ["User-centric", "Values simplicity", "Considers edge cases"],
    weight: 1.1
  },
  cost: {
    focus: "Development cost, time investment, opportunity cost",
    biases: ["Resource-aware", "Time-conscious", "ROI-focused"],
    weight: 1.0
  }
};

// Heuristic analysis based on question content
function analyzeFromPerspective(question: string, domain: string | undefined, perspective: string): {
  recommendation: string;
  justification: string;
  confidence: number;
} {
  const lowerQ = question.toLowerCase();
  const template = PERSPECTIVE_TEMPLATES[perspective] || PERSPECTIVE_TEMPLATES.pragmatic;

  // Extract key terms from question
  const hasShould = lowerQ.includes("should");
  const hasHow = lowerQ.includes("how");
  const hasWhat = lowerQ.includes("what");
  const hasImplement = lowerQ.includes("implement") || lowerQ.includes("add") || lowerQ.includes("create");
  const hasMigrate = lowerQ.includes("migrate") || lowerQ.includes("move") || lowerQ.includes("change");
  const hasApi = lowerQ.includes("api");
  const hasAuth = lowerQ.includes("auth") || lowerQ.includes("login") || lowerQ.includes("security");

  let recommendation = "";
  let justification = "";
  let confidence = 0.7;

  // Perspective-specific analysis
  switch (perspective) {
    case "optimistic":
      if (hasImplement) {
        recommendation = `Yes - proceed with ${extractSubject(question)}`;
        justification = "This implementation provides new capabilities and growth opportunities. Benefits outweigh risks.";
        confidence = 0.85;
      } else if (hasMigrate) {
        recommendation = `Yes - migrate to ${extractTarget(question)}`;
        justification = "Migration will modernize the stack and provide long-term benefits.";
        confidence = 0.8;
      } else {
        recommendation = "Yes - move forward with this approach";
        justification = "Positive outcomes likely; benefits include improved functionality and competitive advantage.";
        confidence = 0.75;
      }
      break;

    case "pessimistic":
      if (hasImplement) {
        recommendation = `No - avoid ${extractSubject(question)}`;
        justification = "Implementation risks include bugs, maintenance burden, and potential failures.";
        confidence = 0.8;
      } else if (hasMigrate) {
        recommendation = `No - delay migration to ${extractTarget(question)}`;
        justification = "Migration risks include data loss, downtime, and unforeseen complications.";
        confidence = 0.85;
      } else {
        recommendation = "No - reconsider this approach";
        justification = "Risks include unexpected failures, resource overruns, and technical debt accumulation.";
        confidence = 0.75;
      }
      break;

    case "pragmatic":
      if (hasImplement) {
        const complexity = estimateComplexity(question);
        if (complexity > 70) {
          recommendation = "Phase the implementation";
          justification = "Break into smaller increments. Test thoroughly before full rollout.";
          confidence = 0.85;
        } else {
          recommendation = `Yes - implement ${extractSubject(question)} with proper testing`;
          justification = "Straightforward implementation. Ensure tests and documentation are included.";
          confidence = 0.8;
        }
      } else if (hasMigrate) {
        recommendation = "Plan migration with rollback strategy";
        justification = "Use parallel implementation. Migrate incrementally with fallback options.";
        confidence = 0.85;
      } else {
        recommendation = "Evaluate based on available resources and timeline";
        justification = "Consider team capacity, existing commitments, and ROI before proceeding.";
        confidence = 0.75;
      }
      break;

    case "security":
      if (hasAuth || lowerQ.includes("token") || lowerQ.includes("password")) {
        recommendation = "Yes - but follow security best practices";
        justification = "Use established libraries. Implement rate limiting, input validation, and audit logging.";
        confidence = 0.9;
      } else if (hasApi) {
        recommendation = "Yes - with proper security controls";
        justification = "Implement authentication, rate limiting, input validation, and CORS policies.";
        confidence = 0.85;
      } else if (hasMigrate) {
        recommendation = "Conduct security review before migration";
        justification = "New stack may have different security considerations. Audit before production.";
        confidence = 0.85;
      } else {
        recommendation = "Assess security implications";
        justification = "Consider data exposure, attack surface changes, and compliance requirements.";
        confidence = 0.75;
      }
      break;

    case "performance":
      if (hasApi || lowerQ.includes("cache") || lowerQ.includes("database")) {
        recommendation = "Yes - but optimize for performance";
        justification = "Use caching, efficient queries, and consider load testing before production.";
        confidence = 0.85;
      } else if (hasMigrate && lowerQ.includes("graphql")) {
        recommendation = "Yes - GraphQL can improve performance for certain use cases";
        justification = "Reduces over-fetching. Consider DataLoader for N+1 query prevention.";
        confidence = 0.8;
      } else {
        recommendation = "Benchmark before and after";
        justification = "Establish performance baseline. Measure impact of changes before committing.";
        confidence = 0.75;
      }
      break;

    case "maintainability":
      recommendation = "Yes - with focus on clean code and documentation";
      justification = "Write tests, document decisions, and follow established patterns for maintainability.";
      confidence = 0.8;
      break;

    case "user_experience":
      recommendation = "Consider user impact first";
      justification = "Changes should improve user experience. Avoid breaking existing workflows.";
      confidence = 0.8;
      break;

    case "cost":
      if (hasMigrate) {
        recommendation = "Calculate total cost of migration";
        justification = "Consider development time, testing, deployment, and ongoing maintenance costs.";
        confidence = 0.85;
      } else {
        recommendation = "Evaluate ROI";
        justification = "Consider implementation cost vs. expected benefit. Look for quick wins first.";
        confidence = 0.75;
      }
      break;

    default:
      recommendation = "Further analysis needed";
      justification = "Consider multiple factors including risk, cost, and benefit.";
      confidence = 0.6;
  }

  return { recommendation, justification, confidence };
}

function extractSubject(question: string): string {
  const lower = question.toLowerCase();
  if (lower.includes("jwt")) return "JWT authentication";
  if (lower.includes("graphql")) return "GraphQL";
  if (lower.includes("redis")) return "Redis caching";
  if (lower.includes("websocket")) return "WebSockets";
  if (lower.includes("oauth")) return "OAuth";
  return "this feature";
}

function extractTarget(question: string): string {
  const lower = question.toLowerCase();
  if (lower.includes("graphql")) return "GraphQL";
  if (lower.includes("microservice")) return "microservices";
  if (lower.includes("typescript")) return "TypeScript";
  if (lower.includes("postgres")) return "PostgreSQL";
  return "the new technology";
}

function estimateComplexity(question: string): number {
  let score = 20;
  const complexTerms = [
    "migrate", "migration", "rewrite", "refactor",
    "authentication", "authorization", "security",
    "database", "schema", "sql",
    "distributed", "microservice", "api",
    "integration", "connect", "coordinate"
  ];

  const lower = question.toLowerCase();
  for (const term of complexTerms) {
    if (lower.includes(term)) score += 10;
  }

  return Math.min(score, 100);
}

// Synthesize multiple perspectives into consensus
function synthesizeConsensus(
  question: string,
  agentViews: Array<{ perspective: string; recommendation: string; justification: string; confidence: number }>
): {
  agreement_score: number;
  agreed_points: string[];
  disagreed_points: Array<{ point: string; view1: string; view2: string }>;
  final_recommendation: string;
  confidence: number;
  caveats: string[];
} {
  // Count positive vs negative recommendations
  const positive = agentViews.filter(v =>
    v.recommendation.toLowerCase().startsWith("yes") ||
    v.recommendation.toLowerCase().includes("proceed")
  );
  const negative = agentViews.filter(v =>
    v.recommendation.toLowerCase().startsWith("no") ||
    v.recommendation.toLowerCase().includes("avoid") ||
    v.recommendation.toLowerCase().includes("delay")
  );

  const total = agentViews.length;
  const positiveRatio = positive.length / total;
  const negativeRatio = negative.length / total;

  // Calculate agreement score
  const agreementScore = Math.max(positiveRatio, negativeRatio);

  // Extract agreed points
  const agreed_points: string[] = [];

  if (positiveRatio > 0.6) {
    agreed_points.push("Overall support for proceeding with the approach");
  } else if (negativeRatio > 0.6) {
    agreed_points.push("Overall concern about risks or costs");
  }

  // Check for specific agreements
  const justifications = agentViews.map(v => v.justification.toLowerCase());
  if (justifications.some(j => j.includes("test"))) {
    agreed_points.push("Testing and validation are important");
  }
  if (justifications.some(j => j.includes("security"))) {
    agreed_points.push("Security considerations should be addressed");
  }
  if (justifications.some(j => j.includes("incremental")) || justifications.some(j => j.includes("phase"))) {
    agreed_points.push("Incremental approach is preferred");
  }

  // Extract disagreement points
  const disagreed_points: Array<{ point: string; view1: string; view2: string }> = [];

  if (positive.length > 0 && negative.length > 0) {
    disagreed_points.push({
      point: "Overall approach",
      view1: `${positive[0].perspective}: ${positive[0].recommendation}`,
      view2: `${negative[0].perspective}: ${negative[0].recommendation}`
    });
  }

  // Generate final recommendation
  let final_recommendation = "";
  let confidence = 0;
  const caveats: string[] = [];

  if (agreementScore >= 0.7) {
    // Strong agreement
    if (positiveRatio > negativeRatio) {
      final_recommendation = "Proceed with the proposed approach";
      confidence = agreementScore;
      caveats.push("Implement proper testing and validation");
      caveats.push("Monitor for unexpected issues");
    } else {
      final_recommendation = "Reconsider the proposed approach";
      confidence = agreementScore;
      caveats.push("Risks appear to outweigh benefits");
      caveats.push("Alternative approaches should be explored");
    }
  } else if (agreementScore >= 0.5) {
    // Moderate agreement
    final_recommendation = "Proceed with caution and mitigation strategies";
    confidence = agreementScore;
    caveats.push("Divergent views exist - key concerns should be addressed");
  } else {
    // Low agreement - suggest hybrid/compromise
    final_recommendation = "Use a hybrid or phased approach";
    confidence = 0.5 + (agreementScore * 0.2);

    if (agentViews.some(v => v.perspective === "optimistic" && v.recommendation.toLowerCase().startsWith("yes")) &&
        agentViews.some(v => v.perspective === "pessimistic" && v.recommendation.toLowerCase().startsWith("no"))) {
      final_recommendation = "Pilot the approach in a limited scope before full commitment";
      caveats.push("Start with proof of concept or trial");
      caveats.push("Gather data before expanding");
    }

    caveats.push("Strong disagreement indicates need for more analysis");
    caveats.push("Consider bringing in additional expertise");
  }

  // Add domain-specific caveats
  const lowerQ = question.toLowerCase();
  if (lowerQ.includes("migrate") || lowerQ.includes("migration")) {
    caveats.push("Ensure rollback plan is in place");
  }
  if (lowerQ.includes("api") || lowerQ.includes("service")) {
    caveats.push("Consider backward compatibility");
  }

  return {
    agreement_score: Math.round(agreementScore * 100) / 100,
    agreed_points,
    disagreed_points,
    final_recommendation,
    confidence: Math.round(confidence * 100) / 100,
    caveats: caveats.slice(0, 5) // Limit to 5 caveats
  };
}

export const consensusProtocolDefinition: Tool = {
  name: "consensus_protocol",
  description: `Reach decisions through structured deliberation with multiple perspectives.

This tool simulates multiple agent perspectives and synthesizes them into a consensus decision,
applying the Concept-Sync pattern for explicit shared concepts and references.

**Perspectives:**
- \`optimistic\`: Best-case scenarios, opportunities, potential gains
- \`pessimistic\`: Worst-case scenarios, risks, potential failures
- \`pragmatic\`: Practical implementation, cost-benefit analysis, tradeoffs
- \`security\`: Security implications, vulnerabilities, attack surface
- \`performance\`: Performance impact, scalability, resource usage
- \`maintainability\`: Code quality, documentation, future maintenance
- \`user_experience\`: User-facing impact, usability, accessibility
- \`cost\`: Development cost, time investment, opportunity cost

**Output:**
- Individual perspective views with recommendations
- Agreement score (0-1)
- Agreed and disagreed points
- Final recommendation with confidence
- Caveats and concerns

**Example:**
\`\`\`json
{
  "question": "Should we migrate from REST to GraphQL?",
  "domain": "backend_architecture",
  "perspectives": ["performance", "maintainability", "security", "cost"],
  "consensus_threshold": 0.7
}
\`\`\``,
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question or decision to deliberate"
      },
      domain: {
        type: "string",
        description: "Domain context for the decision (e.g., 'backend', 'frontend')"
      },
      perspectives: {
        type: "array",
        items: {
          type: "string",
          enum: ["optimistic", "pessimistic", "pragmatic", "security", "performance", "maintainability", "user_experience", "cost"]
        },
        description: "Perspectives to include (default: all five core perspectives)",
        default: ["optimistic", "pessimistic", "pragmatic", "security", "performance"]
      },
      consensus_threshold: {
        type: "number",
        description: "Required agreement score for consensus (0-1, default: 0.7)",
        minimum: 0,
        maximum: 1,
        default: 0.7
      }
    },
    required: ["question"]
  }
};

export async function handleConsensusProtocol(args: unknown) {
  try {
    const input = ConsensusProtocolInputSchema.parse(args);

    // Generate views from each perspective
    const agentViews = input.perspectives.map(perspective => {
      const analysis = analyzeFromPerspective(input.question, input.domain, perspective);
      return {
        perspective,
        recommendation: analysis.recommendation,
        justification: analysis.justification,
        confidence: analysis.confidence
      };
    });

    // Synthesize into consensus
    const consensus = synthesizeConsensus(input.question, agentViews);
    const consensusReached = consensus.agreement_score >= input.consensus_threshold;

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          question: input.question,
          domain: input.domain || "general",
          agent_views: agentViews,
          consensus_analysis: {
            agreement_score: consensus.agreement_score,
            agreed_points: consensus.agreed_points,
            disagreed_points: consensus.disagreed_points
          },
          final_recommendation: {
            decision: consensus.final_recommendation,
            confidence: consensus.confidence,
            caveats: consensus.caveats
          },
          consensus_reached: consensusReached,
          threshold_used: input.consensus_threshold,
          note: consensusReached
            ? "Consensus threshold met. Recommendation can proceed."
            : "Below consensus threshold. Further discussion recommended."
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
