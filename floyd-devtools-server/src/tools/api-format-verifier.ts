/**
 * api_format_verifier tool
 * Verify API formats for LLM compatibility
 * Supports: OpenAI, Anthropic, Google AI, Custom endpoints
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Input validation schema
export const ApiFormatVerifierInputSchema = z.object({
  action: z.enum(["verify_request", "verify_response", "validate_schema", "check_compatibility", "estimate_tokens"]),
  api_type: z.enum(["openai", "anthropic", "google", "custom"]),
  payload: z.record(z.unknown()),
  model: z.string().optional(),
  check_token_limits: z.boolean().optional().default(true),
  estimate_cost: z.boolean().optional().default(false),
  custom_schema: z.record(z.unknown()).optional()
});

export type ApiFormatVerifierInput = z.infer<typeof ApiFormatVerifierInputSchema>;

// Model token limits and pricing
const MODEL_SPECS: Record<string, {
  maxInputTokens: number;
  maxOutputTokens: number;
  contextWindow: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}> = {
  // OpenAI models
  "gpt-4": { maxInputTokens: 8192, maxOutputTokens: 8192, contextWindow: 8192, inputPricePerMillion: 30, outputPricePerMillion: 60 },
  "gpt-4-turbo": { maxInputTokens: 128000, maxOutputTokens: 4096, contextWindow: 128000, inputPricePerMillion: 10, outputPricePerMillion: 30 },
  "gpt-4o": { maxInputTokens: 128000, maxOutputTokens: 16384, contextWindow: 128000, inputPricePerMillion: 5, outputPricePerMillion: 15 },
  "gpt-4o-mini": { maxInputTokens: 128000, maxOutputTokens: 16384, contextWindow: 128000, inputPricePerMillion: 0.15, outputPricePerMillion: 0.6 },
  "gpt-3.5-turbo": { maxInputTokens: 16385, maxOutputTokens: 4096, contextWindow: 16385, inputPricePerMillion: 0.5, outputPricePerMillion: 1.5 },
  "o1": { maxInputTokens: 200000, maxOutputTokens: 100000, contextWindow: 200000, inputPricePerMillion: 15, outputPricePerMillion: 60 },
  "o1-mini": { maxInputTokens: 128000, maxOutputTokens: 65536, contextWindow: 128000, inputPricePerMillion: 3, outputPricePerMillion: 12 },
  
  // Anthropic models
  "claude-3-opus": { maxInputTokens: 200000, maxOutputTokens: 4096, contextWindow: 200000, inputPricePerMillion: 15, outputPricePerMillion: 75 },
  "claude-3-sonnet": { maxInputTokens: 200000, maxOutputTokens: 4096, contextWindow: 200000, inputPricePerMillion: 3, outputPricePerMillion: 15 },
  "claude-3-haiku": { maxInputTokens: 200000, maxOutputTokens: 4096, contextWindow: 200000, inputPricePerMillion: 0.25, outputPricePerMillion: 1.25 },
  "claude-3.5-sonnet": { maxInputTokens: 200000, maxOutputTokens: 8192, contextWindow: 200000, inputPricePerMillion: 3, outputPricePerMillion: 15 },
  "claude-3.5-haiku": { maxInputTokens: 200000, maxOutputTokens: 8192, contextWindow: 200000, inputPricePerMillion: 0.8, outputPricePerMillion: 4 },
  
  // Google models
  "gemini-1.5-pro": { maxInputTokens: 2097152, maxOutputTokens: 8192, contextWindow: 2097152, inputPricePerMillion: 3.5, outputPricePerMillion: 10.5 },
  "gemini-1.5-flash": { maxInputTokens: 1048576, maxOutputTokens: 8192, contextWindow: 1048576, inputPricePerMillion: 0.075, outputPricePerMillion: 0.3 },
  "gemini-2.0-flash": { maxInputTokens: 1048576, maxOutputTokens: 8192, contextWindow: 1048576, inputPricePerMillion: 0.1, outputPricePerMillion: 0.4 }
};

// OpenAI request schema
const OPENAI_REQUEST_SCHEMA = {
  required: ["model", "messages"],
  properties: {
    model: { type: "string" },
    messages: {
      type: "array",
      items: {
        required: ["role", "content"],
        properties: {
          role: { type: "string", enum: ["system", "user", "assistant", "function", "tool"] },
          content: { type: ["string", "array", "null"] },
          name: { type: "string" },
          function_call: { type: "object" },
          tool_calls: { type: "array" }
        }
      }
    },
    temperature: { type: "number", min: 0, max: 2 },
    max_tokens: { type: "integer", min: 1 },
    top_p: { type: "number", min: 0, max: 1 },
    n: { type: "integer", min: 1 },
    stream: { type: "boolean" },
    stop: { type: ["string", "array"] },
    presence_penalty: { type: "number", min: -2, max: 2 },
    frequency_penalty: { type: "number", min: -2, max: 2 },
    tools: { type: "array" },
    tool_choice: { type: ["string", "object"] },
    response_format: { type: "object" }
  }
};

// Anthropic request schema
const ANTHROPIC_REQUEST_SCHEMA = {
  required: ["model", "messages", "max_tokens"],
  properties: {
    model: { type: "string" },
    messages: {
      type: "array",
      items: {
        required: ["role", "content"],
        properties: {
          role: { type: "string", enum: ["user", "assistant"] },
          content: { type: ["string", "array"] }
        }
      }
    },
    max_tokens: { type: "integer", min: 1 },
    system: { type: "string" },
    temperature: { type: "number", min: 0, max: 1 },
    top_p: { type: "number", min: 0, max: 1 },
    top_k: { type: "integer", min: 0 },
    stop_sequences: { type: "array" },
    stream: { type: "boolean" },
    tools: { type: "array" },
    tool_choice: { type: "object" }
  }
};

// Google AI request schema
const GOOGLE_REQUEST_SCHEMA = {
  required: ["contents"],
  properties: {
    contents: {
      type: "array",
      items: {
        required: ["parts"],
        properties: {
          role: { type: "string", enum: ["user", "model"] },
          parts: {
            type: "array",
            items: {
              properties: {
                text: { type: "string" },
                inlineData: { type: "object" }
              }
            }
          }
        }
      }
    },
    systemInstruction: { type: "object" },
    generationConfig: {
      type: "object",
      properties: {
        temperature: { type: "number" },
        topP: { type: "number" },
        topK: { type: "integer" },
        maxOutputTokens: { type: "integer" },
        stopSequences: { type: "array" }
      }
    },
    tools: { type: "array" },
    toolConfig: { type: "object" }
  }
};

/**
 * Estimate token count (simple approximation)
 * Real implementation would use tiktoken or similar
 */
function estimateTokenCount(text: string): number {
  // Rough approximation: ~4 chars per token for English
  return Math.ceil(text.length / 4);
}

/**
 * Extract text content from messages for token estimation
 */
function extractTextFromPayload(payload: Record<string, unknown>, apiType: string): string {
  let text = "";
  
  if (apiType === "openai" || apiType === "anthropic") {
    const messages = payload.messages as Array<{ content?: string | unknown[] }> | undefined;
    if (messages && Array.isArray(messages)) {
      for (const msg of messages) {
        if (typeof msg.content === "string") {
          text += msg.content + " ";
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (typeof part === "object" && part !== null && "text" in part) {
              text += (part as { text: string }).text + " ";
            }
          }
        }
      }
    }
    if (apiType === "anthropic" && typeof payload.system === "string") {
      text += payload.system + " ";
    }
  } else if (apiType === "google") {
    const contents = payload.contents as Array<{ parts?: Array<{ text?: string }> }> | undefined;
    if (contents && Array.isArray(contents)) {
      for (const content of contents) {
        if (content.parts && Array.isArray(content.parts)) {
          for (const part of content.parts) {
            if (part.text) {
              text += part.text + " ";
            }
          }
        }
      }
    }
  }
  
  return text.trim();
}

/**
 * Validate payload against schema
 */
function validateSchema(payload: Record<string, unknown>, schema: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  const required = schema.required as string[] | undefined;
  const properties = schema.properties as Record<string, unknown> | undefined;
  
  // Check required fields
  if (required) {
    for (const field of required) {
      if (!(field in payload)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }
  
  // Check property types and constraints
  if (properties) {
    for (const [key, value] of Object.entries(payload)) {
      const propSchema = properties[key] as Record<string, unknown> | undefined;
      
      if (!propSchema) {
        warnings.push(`Unknown field: ${key}`);
        continue;
      }
      
      const expectedType = propSchema.type as string | string[];
      const actualType = Array.isArray(value) ? "array" : typeof value;
      
      // Check type
      if (expectedType) {
        const allowedTypes = Array.isArray(expectedType) ? expectedType : [expectedType];
        if (!allowedTypes.includes(actualType) && value !== null) {
          errors.push(`Field '${key}' has wrong type: expected ${allowedTypes.join(" or ")}, got ${actualType}`);
        }
      }
      
      // Check numeric constraints
      if (typeof value === "number") {
        if (propSchema.min !== undefined && value < (propSchema.min as number)) {
          errors.push(`Field '${key}' is below minimum: ${value} < ${propSchema.min}`);
        }
        if (propSchema.max !== undefined && value > (propSchema.max as number)) {
          errors.push(`Field '${key}' is above maximum: ${value} > ${propSchema.max}`);
        }
      }
      
      // Check enum
      if (propSchema.enum && !((propSchema.enum as unknown[]).includes(value))) {
        errors.push(`Field '${key}' has invalid value: ${value}. Allowed: ${(propSchema.enum as unknown[]).join(", ")}`);
      }
    }
  }
  
  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Get schema for API type
 */
function getSchemaForApi(apiType: string): Record<string, unknown> {
  switch (apiType) {
    case "openai":
      return OPENAI_REQUEST_SCHEMA;
    case "anthropic":
      return ANTHROPIC_REQUEST_SCHEMA;
    case "google":
      return GOOGLE_REQUEST_SCHEMA;
    default:
      return {};
  }
}

/**
 * Check API-specific compatibility issues
 */
function checkCompatibility(payload: Record<string, unknown>, apiType: string, model?: string): {
  compatible: boolean;
  issues: string[];
  suggestions: string[];
} {
  const issues: string[] = [];
  const suggestions: string[] = [];
  
  // Check model compatibility
  if (model) {
    const modelLower = model.toLowerCase();
    
    if (apiType === "openai") {
      if (!modelLower.startsWith("gpt") && !modelLower.startsWith("o1") && !modelLower.startsWith("text-")) {
        issues.push(`Model '${model}' may not be compatible with OpenAI API`);
      }
    } else if (apiType === "anthropic") {
      if (!modelLower.includes("claude")) {
        issues.push(`Model '${model}' may not be compatible with Anthropic API`);
      }
    } else if (apiType === "google") {
      if (!modelLower.includes("gemini")) {
        issues.push(`Model '${model}' may not be compatible with Google AI API`);
      }
    }
  }
  
  // API-specific checks
  if (apiType === "openai") {
    const messages = payload.messages as Array<{ role?: string }> | undefined;
    if (messages && Array.isArray(messages)) {
      // Check message ordering
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (i === 0 && msg.role !== "system" && msg.role !== "user") {
          suggestions.push("First message should typically be 'system' or 'user' role");
        }
      }
      
      // Check for alternating roles
      let lastRole = "";
      for (const msg of messages) {
        if (msg.role === lastRole && msg.role !== "system") {
          suggestions.push("Consider alternating user/assistant roles for better context");
          break;
        }
        lastRole = msg.role || "";
      }
    }
    
    // Check deprecated parameters
    if ("function_call" in payload) {
      suggestions.push("'function_call' is deprecated, use 'tools' and 'tool_choice' instead");
    }
    
  } else if (apiType === "anthropic") {
    const messages = payload.messages as Array<{ role?: string }> | undefined;
    if (messages && Array.isArray(messages)) {
      // Check for system message in messages (should be in 'system' field)
      for (const msg of messages) {
        if (msg.role === "system") {
          issues.push("Anthropic API doesn't support 'system' role in messages. Use 'system' field instead.");
        }
      }
      
      // Check first message is user
      if (messages.length > 0 && messages[0].role !== "user") {
        issues.push("Anthropic API requires first message to have 'user' role");
      }
    }
    
    // max_tokens is required
    if (!("max_tokens" in payload)) {
      issues.push("Anthropic API requires 'max_tokens' field");
    }
    
  } else if (apiType === "google") {
    const contents = payload.contents as Array<{ role?: string }> | undefined;
    if (contents && Array.isArray(contents)) {
      for (const content of contents) {
        if (content.role === "system") {
          suggestions.push("Google AI uses 'systemInstruction' field for system prompts, not role='system'");
        }
      }
    }
  }
  
  return {
    compatible: issues.length === 0,
    issues,
    suggestions
  };
}

/**
 * Find matching model spec
 */
function findModelSpec(model: string): typeof MODEL_SPECS[string] | null {
  const modelLower = model.toLowerCase();
  
  // Exact match
  if (MODEL_SPECS[modelLower]) {
    return MODEL_SPECS[modelLower];
  }
  
  // Partial match
  for (const [key, spec] of Object.entries(MODEL_SPECS)) {
    if (modelLower.includes(key) || key.includes(modelLower)) {
      return spec;
    }
  }
  
  return null;
}

export const apiFormatVerifierDefinition: Tool = {
  name: "api_format_verifier",
  description: `Verify API formats for LLM compatibility.

**Actions:**
- \`verify_request\`: Validate a request payload against API schema
- \`verify_response\`: Validate a response payload
- \`validate_schema\`: Check against custom schema
- \`check_compatibility\`: Check API-specific compatibility
- \`estimate_tokens\`: Estimate token count and cost

**Supported APIs:**
- OpenAI (GPT-4, GPT-4o, GPT-3.5, o1 series)
- Anthropic (Claude 3, Claude 3.5 series)
- Google AI (Gemini 1.5, Gemini 2.0 series)
- Custom endpoints

**Features:**
- Schema validation with detailed errors
- Token limit checks
- Cost estimation
- API-specific compatibility warnings

**Example:**
\`\`\`json
{
  "action": "verify_request",
  "api_type": "openai",
  "payload": {
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}]
  },
  "check_token_limits": true,
  "estimate_cost": true
}
\`\`\``,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["verify_request", "verify_response", "validate_schema", "check_compatibility", "estimate_tokens"],
        description: "Action to perform"
      },
      api_type: {
        type: "string",
        enum: ["openai", "anthropic", "google", "custom"],
        description: "Target API type"
      },
      payload: {
        type: "object",
        description: "Request or response payload to verify"
      },
      model: {
        type: "string",
        description: "Model name for token limits and pricing"
      },
      check_token_limits: {
        type: "boolean",
        description: "Check against model token limits",
        default: true
      },
      estimate_cost: {
        type: "boolean",
        description: "Estimate API call cost",
        default: false
      },
      custom_schema: {
        type: "object",
        description: "Custom schema for validation"
      }
    },
    required: ["action", "api_type", "payload"]
  }
};

export async function handleApiFormatVerifier(args: unknown) {
  try {
    const input = ApiFormatVerifierInputSchema.parse(args);
    
    switch (input.action) {
      case "verify_request": {
        const schema = getSchemaForApi(input.api_type);
        const validation = validateSchema(input.payload, schema);
        const compatibility = checkCompatibility(input.payload, input.api_type, input.model);
        
        // Token estimation
        let tokenInfo = null;
        let costInfo = null;
        
        if (input.check_token_limits || input.estimate_cost) {
          const text = extractTextFromPayload(input.payload, input.api_type);
          const estimatedTokens = estimateTokenCount(text);
          const model = input.model || (input.payload.model as string) || "";
          const modelSpec = findModelSpec(model);
          
          tokenInfo = {
            estimated_input_tokens: estimatedTokens,
            model: model,
            max_input_tokens: modelSpec?.maxInputTokens || "unknown",
            max_output_tokens: modelSpec?.maxOutputTokens || "unknown",
            within_limits: modelSpec ? estimatedTokens <= modelSpec.maxInputTokens : null
          };
          
          if (input.estimate_cost && modelSpec) {
            const maxOutputTokens = (input.payload.max_tokens as number) || modelSpec.maxOutputTokens;
            const inputCost = (estimatedTokens / 1_000_000) * modelSpec.inputPricePerMillion;
            const maxOutputCost = (maxOutputTokens / 1_000_000) * modelSpec.outputPricePerMillion;
            
            costInfo = {
              estimated_input_cost: `$${inputCost.toFixed(6)}`,
              max_output_cost: `$${maxOutputCost.toFixed(6)}`,
              max_total_cost: `$${(inputCost + maxOutputCost).toFixed(6)}`,
              pricing: {
                input_per_million: `$${modelSpec.inputPricePerMillion}`,
                output_per_million: `$${modelSpec.outputPricePerMillion}`
              }
            };
          }
        }
        
        const isValid = validation.valid && compatibility.compatible;
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              valid: isValid,
              api_type: input.api_type,
              schema_validation: {
                valid: validation.valid,
                errors: validation.errors,
                warnings: validation.warnings
              },
              compatibility: {
                compatible: compatibility.compatible,
                issues: compatibility.issues,
                suggestions: compatibility.suggestions
              },
              token_info: tokenInfo,
              cost_estimate: costInfo,
              summary: isValid 
                ? "Request payload is valid and compatible"
                : `Found ${validation.errors.length + compatibility.issues.length} issue(s)`
            }, null, 2)
          }]
        };
      }
      
      case "verify_response": {
        // Basic response structure validation
        const errors: string[] = [];
        const warnings: string[] = [];
        
        if (input.api_type === "openai") {
          if (!("choices" in input.payload)) {
            errors.push("Missing 'choices' field in OpenAI response");
          }
          if (!("id" in input.payload)) {
            warnings.push("Missing 'id' field");
          }
          if (!("usage" in input.payload)) {
            warnings.push("Missing 'usage' field");
          }
        } else if (input.api_type === "anthropic") {
          if (!("content" in input.payload)) {
            errors.push("Missing 'content' field in Anthropic response");
          }
          if (!("role" in input.payload)) {
            warnings.push("Missing 'role' field");
          }
          if (!("usage" in input.payload)) {
            warnings.push("Missing 'usage' field");
          }
        } else if (input.api_type === "google") {
          if (!("candidates" in input.payload)) {
            errors.push("Missing 'candidates' field in Google AI response");
          }
        }
        
        // Check for error response
        if ("error" in input.payload) {
          errors.push(`Response contains error: ${JSON.stringify(input.payload.error)}`);
        }
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              valid: errors.length === 0,
              api_type: input.api_type,
              errors,
              warnings,
              has_usage_info: "usage" in input.payload,
              is_error_response: "error" in input.payload
            }, null, 2)
          }]
        };
      }
      
      case "validate_schema": {
        if (!input.custom_schema) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "custom_schema is required for validate_schema action"
              }, null, 2)
            }],
            isError: true
          };
        }
        
        const validation = validateSchema(input.payload, input.custom_schema);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              valid: validation.valid,
              errors: validation.errors,
              warnings: validation.warnings
            }, null, 2)
          }]
        };
      }
      
      case "check_compatibility": {
        const compatibility = checkCompatibility(input.payload, input.api_type, input.model);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              api_type: input.api_type,
              model: input.model || (input.payload.model as string) || "not specified",
              compatible: compatibility.compatible,
              issues: compatibility.issues,
              suggestions: compatibility.suggestions,
              recommendation: compatibility.compatible 
                ? "Payload is compatible with target API"
                : "Fix issues before sending request"
            }, null, 2)
          }]
        };
      }
      
      case "estimate_tokens": {
        const text = extractTextFromPayload(input.payload, input.api_type);
        const estimatedTokens = estimateTokenCount(text);
        const model = input.model || (input.payload.model as string) || "";
        const modelSpec = findModelSpec(model);
        
        const result: Record<string, unknown> = {
          estimated_input_tokens: estimatedTokens,
          character_count: text.length,
          model: model || "not specified",
          estimation_method: "character-based approximation (~4 chars/token)"
        };
        
        if (modelSpec) {
          result.model_limits = {
            max_input_tokens: modelSpec.maxInputTokens,
            max_output_tokens: modelSpec.maxOutputTokens,
            context_window: modelSpec.contextWindow
          };
          
          result.within_limits = estimatedTokens <= modelSpec.maxInputTokens;
          result.tokens_remaining = modelSpec.maxInputTokens - estimatedTokens;
          result.usage_percent = ((estimatedTokens / modelSpec.maxInputTokens) * 100).toFixed(1) + "%";
          
          if (input.estimate_cost) {
            const maxOutputTokens = (input.payload.max_tokens as number) || modelSpec.maxOutputTokens;
            const inputCost = (estimatedTokens / 1_000_000) * modelSpec.inputPricePerMillion;
            const outputCost = (maxOutputTokens / 1_000_000) * modelSpec.outputPricePerMillion;
            
            result.cost_estimate = {
              input_cost: `$${inputCost.toFixed(6)}`,
              max_output_cost: `$${outputCost.toFixed(6)}`,
              max_total_cost: `$${(inputCost + outputCost).toFixed(6)}`
            };
          }
        } else if (model) {
          result.warning = `Model '${model}' not found in specs database`;
        }
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
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
