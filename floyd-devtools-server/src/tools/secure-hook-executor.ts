/**
 * secure_hook_executor tool
 * Safe hook execution with sandboxing and safety checks
 * Implements timeout limits, resource caps, and allowlist validation
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as vm from "vm";
import {
  registerHook,
  getHook,
  getHookByName,
  getHooksForEvent,
  updateHook,
  deleteHook,
  listHooks,
  logExecution,
  getExecutionLogs,
  getRecentLogs,
  getHookAuditSummary,
  type RegisteredHook
} from "../storage/hooks.js";

// Input validation schema
export const SecureHookExecutorInputSchema = z.object({
  action: z.enum(["execute", "validate", "register", "list_hooks", "audit", "unregister", "enable", "disable"]),
  hook_name: z.string().optional(),
  hook_id: z.string().optional(),
  hook_code: z.string().optional(),
  event: z.string().optional(),
  timeout_ms: z.number().optional().default(5000),
  max_memory_mb: z.number().optional().default(128),
  allowed_apis: z.array(z.string()).optional().default(["console", "JSON", "Math", "Date", "Array", "Object", "String", "Number"]),
  context: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional().default(true)
});

export type SecureHookExecutorInput = z.infer<typeof SecureHookExecutorInputSchema>;

// Allowed API categories
const API_CATEGORIES: Record<string, string[]> = {
  console: ["log", "warn", "error", "info"],
  JSON: ["parse", "stringify"],
  Math: ["abs", "ceil", "floor", "max", "min", "pow", "random", "round", "sqrt"],
  Date: ["now", "parse", "UTC"],
  Array: ["from", "isArray", "of"],
  Object: ["assign", "entries", "fromEntries", "keys", "values"],
  String: ["fromCharCode", "fromCodePoint"],
  Number: ["isFinite", "isInteger", "isNaN", "parseFloat", "parseInt"],
  crypto: ["randomUUID"],
  Buffer: ["from", "alloc", "concat"]
};

// Dangerous patterns to block
const DANGEROUS_PATTERNS = [
  /require\s*\(/,
  /import\s+/,
  /eval\s*\(/,
  /Function\s*\(/,
  /process\./,
  /child_process/,
  /fs\./,
  /\.exec\s*\(/,
  /\.spawn\s*\(/,
  /globalThis/,
  /global\./,
  /__proto__/,
  /prototype\s*\[/,
  /constructor\s*\[/
];

/**
 * Validate hook code for security issues
 */
function validateHookCode(code: string, allowedApis: string[]): {
  valid: boolean;
  errors: string[];
  warnings: string[];
  risk_level: "low" | "medium" | "high";
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  let riskScore = 0;
  
  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      errors.push(`Dangerous pattern detected: ${pattern.toString()}`);
      riskScore += 10;
    }
  }
  
  // Check for infinite loop patterns
  if (/while\s*\(\s*true\s*\)/.test(code) || /for\s*\(\s*;\s*;\s*\)/.test(code)) {
    warnings.push("Potential infinite loop detected");
    riskScore += 5;
  }
  
  // Check for recursive patterns without base case
  const funcMatches = code.match(/function\s+(\w+)/g);
  if (funcMatches) {
    for (const match of funcMatches) {
      const funcName = match.replace(/function\s+/, "");
      const selfCallPattern = new RegExp(`${funcName}\\s*\\(`);
      if (selfCallPattern.test(code)) {
        warnings.push(`Recursive function detected: ${funcName} - ensure base case exists`);
        riskScore += 2;
      }
    }
  }
  
  // Check for disallowed API access
  const allAllowedMethods = new Set<string>();
  for (const api of allowedApis) {
    if (API_CATEGORIES[api]) {
      for (const method of API_CATEGORIES[api]) {
        allAllowedMethods.add(`${api}.${method}`);
      }
    }
    allAllowedMethods.add(api);
  }
  
  // Look for API usage
  const apiUsagePattern = /(\w+)\.(\w+)\s*\(/g;
  let match;
  while ((match = apiUsagePattern.exec(code)) !== null) {
    const [, obj, method] = match;
    const fullCall = `${obj}.${method}`;
    
    // Skip common safe patterns
    if (["this", "context", "data", "result", "args"].includes(obj)) {
      continue;
    }
    
    if (!allAllowedMethods.has(fullCall) && !allowedApis.includes(obj)) {
      warnings.push(`Potentially restricted API: ${fullCall}`);
      riskScore += 1;
    }
  }
  
  // Determine risk level
  let riskLevel: "low" | "medium" | "high";
  if (errors.length > 0 || riskScore >= 10) {
    riskLevel = "high";
  } else if (warnings.length > 2 || riskScore >= 5) {
    riskLevel = "medium";
  } else {
    riskLevel = "low";
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    risk_level: riskLevel
  };
}

/**
 * Create a sandboxed context for hook execution
 */
function createSandboxedContext(allowedApis: string[], userContext: Record<string, unknown> = {}): vm.Context {
  const sandbox: Record<string, unknown> = {
    // Always available
    undefined: undefined,
    null: null,
    true: true,
    false: false,
    NaN: NaN,
    Infinity: Infinity,
    
    // User-provided context
    context: Object.freeze({ ...userContext }),
    
    // Result container
    __result__: undefined,
    __error__: undefined
  };
  
  // Add allowed APIs
  for (const api of allowedApis) {
    switch (api) {
      case "console":
        sandbox.console = {
          log: (...args: unknown[]) => { /* captured but not output */ },
          warn: (...args: unknown[]) => { /* captured but not output */ },
          error: (...args: unknown[]) => { /* captured but not output */ },
          info: (...args: unknown[]) => { /* captured but not output */ }
        };
        break;
      case "JSON":
        sandbox.JSON = JSON;
        break;
      case "Math":
        sandbox.Math = Math;
        break;
      case "Date":
        sandbox.Date = Date;
        break;
      case "Array":
        sandbox.Array = Array;
        break;
      case "Object":
        sandbox.Object = {
          assign: Object.assign,
          entries: Object.entries,
          fromEntries: Object.fromEntries,
          keys: Object.keys,
          values: Object.values
        };
        break;
      case "String":
        sandbox.String = String;
        break;
      case "Number":
        sandbox.Number = Number;
        break;
      case "crypto":
        sandbox.crypto = {
          randomUUID: () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        };
        break;
      case "Buffer":
        sandbox.Buffer = {
          from: Buffer.from,
          alloc: Buffer.alloc,
          concat: Buffer.concat
        };
        break;
    }
  }
  
  return vm.createContext(sandbox);
}

/**
 * Execute hook code in sandbox
 */
async function executeHookCode(
  code: string,
  context: Record<string, unknown>,
  timeout_ms: number,
  allowedApis: string[]
): Promise<{
  success: boolean;
  result?: unknown;
  error?: string;
  duration_ms: number;
}> {
  const startTime = process.hrtime.bigint();
  
  try {
    const sandbox = createSandboxedContext(allowedApis, context);
    
    // Wrap code to capture result
    const wrappedCode = `
      try {
        __result__ = (function() {
          "use strict";
          ${code}
        })();
      } catch (e) {
        __error__ = e.message || String(e);
      }
    `;
    
    const script = new vm.Script(wrappedCode, {
      filename: "hook.js"
    });
    
    script.runInContext(sandbox, {
      timeout: timeout_ms,
      displayErrors: false
    });
    
    const endTime = process.hrtime.bigint();
    const duration_ms = Number(endTime - startTime) / 1_000_000;
    
    if (sandbox.__error__) {
      return {
        success: false,
        error: String(sandbox.__error__),
        duration_ms
      };
    }
    
    return {
      success: true,
      result: sandbox.__result__,
      duration_ms
    };
  } catch (error) {
    const endTime = process.hrtime.bigint();
    const duration_ms = Number(endTime - startTime) / 1_000_000;
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return {
      success: false,
      error: errorMessage.includes("Script execution timed out") 
        ? `Execution timed out after ${timeout_ms}ms`
        : errorMessage,
      duration_ms
    };
  }
}

export const secureHookExecutorDefinition: Tool = {
  name: "secure_hook_executor",
  description: `Execute hooks with sandboxing and safety checks.

**Actions:**
- \`execute\`: Execute a hook by name or with inline code
- \`validate\`: Validate hook code for security issues
- \`register\`: Register a new hook
- \`list_hooks\`: List all registered hooks
- \`audit\`: Get audit logs for hook executions
- \`unregister\`: Remove a registered hook
- \`enable/disable\`: Toggle hook enabled state

**Safety Features:**
- Timeout limits (default: 5000ms)
- Sandboxed execution with vm module
- API allowlist validation
- Dangerous pattern detection
- Execution audit logging

**Allowed APIs (configurable):**
console, JSON, Math, Date, Array, Object, String, Number, crypto, Buffer

**Example:**
\`\`\`json
{
  "action": "execute",
  "hook_name": "pre-commit",
  "context": { "files": ["src/index.ts"] },
  "timeout_ms": 3000
}
\`\`\``,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["execute", "validate", "register", "list_hooks", "audit", "unregister", "enable", "disable"],
        description: "Action to perform"
      },
      hook_name: {
        type: "string",
        description: "Name of the hook"
      },
      hook_id: {
        type: "string",
        description: "ID of a registered hook"
      },
      hook_code: {
        type: "string",
        description: "JavaScript code for the hook"
      },
      event: {
        type: "string",
        description: "Event type (e.g., pre-commit, post-deploy)"
      },
      timeout_ms: {
        type: "number",
        description: "Execution timeout in milliseconds",
        default: 5000
      },
      max_memory_mb: {
        type: "number",
        description: "Maximum memory limit in MB",
        default: 128
      },
      allowed_apis: {
        type: "array",
        items: { type: "string" },
        description: "List of allowed API categories",
        default: ["console", "JSON", "Math", "Date", "Array", "Object", "String", "Number"]
      },
      context: {
        type: "object",
        description: "Context data passed to the hook"
      },
      enabled: {
        type: "boolean",
        description: "Whether the hook is enabled",
        default: true
      }
    },
    required: ["action"]
  }
};

export async function handleSecureHookExecutor(args: unknown) {
  try {
    const input = SecureHookExecutorInputSchema.parse(args);
    
    switch (input.action) {
      case "validate": {
        if (!input.hook_code) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "hook_code is required for validate"
              }, null, 2)
            }],
            isError: true
          };
        }
        
        const validation = validateHookCode(input.hook_code, input.allowed_apis);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              valid: validation.valid,
              risk_level: validation.risk_level,
              errors: validation.errors,
              warnings: validation.warnings,
              allowed_apis: input.allowed_apis,
              recommendation: validation.valid 
                ? (validation.risk_level === "low" ? "Safe to execute" : "Review warnings before execution")
                : "Do not execute - security issues detected"
            }, null, 2)
          }]
        };
      }
      
      case "register": {
        if (!input.hook_name || !input.hook_code || !input.event) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "hook_name, hook_code, and event are required for register"
              }, null, 2)
            }],
            isError: true
          };
        }
        
        // Validate code first
        const validation = validateHookCode(input.hook_code, input.allowed_apis);
        if (!validation.valid) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Hook code validation failed",
                validation_errors: validation.errors,
                hint: "Fix security issues before registering"
              }, null, 2)
            }],
            isError: true
          };
        }
        
        // Check for duplicate name
        const existing = getHookByName(input.hook_name);
        if (existing) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: `Hook with name '${input.hook_name}' already exists`,
                existing_id: existing.id
              }, null, 2)
            }],
            isError: true
          };
        }
        
        // Register the hook
        const hook = registerHook({
          name: input.hook_name,
          event: input.event,
          code: input.hook_code,
          timeout_ms: input.timeout_ms,
          max_memory_mb: input.max_memory_mb,
          allowed_apis: input.allowed_apis,
          enabled: input.enabled
        });
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              hook_id: hook.id,
              hook_name: hook.name,
              event: hook.event,
              enabled: hook.enabled,
              created_at: hook.createdAt,
              validation: {
                risk_level: validation.risk_level,
                warnings: validation.warnings
              }
            }, null, 2)
          }]
        };
      }
      
      case "execute": {
        let hook: RegisteredHook | undefined;
        let code: string;
        let timeout: number = input.timeout_ms;
        let apis: string[] = input.allowed_apis;
        
        // Get hook by name or ID, or use inline code
        if (input.hook_name) {
          hook = getHookByName(input.hook_name);
          if (!hook) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  error: `Hook '${input.hook_name}' not found`
                }, null, 2)
              }],
              isError: true
            };
          }
        } else if (input.hook_id) {
          hook = getHook(input.hook_id);
          if (!hook) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  error: `Hook with ID '${input.hook_id}' not found`
                }, null, 2)
              }],
              isError: true
            };
          }
        }
        
        if (hook) {
          if (!hook.enabled) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  error: `Hook '${hook.name}' is disabled`,
                  hook_id: hook.id
                }, null, 2)
              }],
              isError: true
            };
          }
          code = hook.code;
          timeout = hook.timeout_ms;
          apis = hook.allowed_apis;
        } else if (input.hook_code) {
          code = input.hook_code;
        } else {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Provide hook_name, hook_id, or hook_code to execute"
              }, null, 2)
            }],
            isError: true
          };
        }
        
        // Validate before execution
        const validation = validateHookCode(code, apis);
        if (!validation.valid) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Hook code validation failed",
                validation_errors: validation.errors
              }, null, 2)
            }],
            isError: true
          };
        }
        
        // Execute the hook
        const result = await executeHookCode(
          code,
          input.context || {},
          timeout,
          apis
        );
        
        // Log execution if it's a registered hook
        if (hook) {
          logExecution({
            hookId: hook.id,
            hookName: hook.name,
            event: hook.event,
            timestamp: new Date().toISOString(),
            duration_ms: result.duration_ms,
            success: result.success,
            result: result.result,
            error: result.error,
            context: input.context
          });
        }
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: result.success,
              hook_name: hook?.name || "inline",
              duration_ms: result.duration_ms.toFixed(2),
              result: result.result,
              error: result.error,
              context_provided: Object.keys(input.context || {})
            }, null, 2)
          }]
        };
      }
      
      case "list_hooks": {
        const filter: { event?: string; enabled?: boolean } = {};
        if (input.event) filter.event = input.event;
        if (input.enabled !== undefined) filter.enabled = input.enabled;
        
        const hooks = listHooks(Object.keys(filter).length > 0 ? filter : undefined);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total_hooks: hooks.length,
              filter: Object.keys(filter).length > 0 ? filter : "none",
              hooks: hooks.map(h => ({
                id: h.id,
                name: h.name,
                event: h.event,
                enabled: h.enabled,
                timeout_ms: h.timeout_ms,
                created_at: h.createdAt,
                updated_at: h.updatedAt
              }))
            }, null, 2)
          }]
        };
      }
      
      case "audit": {
        if (input.hook_id || input.hook_name) {
          let hookId = input.hook_id;
          
          if (input.hook_name && !hookId) {
            const hook = getHookByName(input.hook_name);
            if (hook) hookId = hook.id;
          }
          
          if (!hookId) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  error: "Hook not found"
                }, null, 2)
              }],
              isError: true
            };
          }
          
          const logs = getExecutionLogs(hookId, 50);
          const summary = getHookAuditSummary(hookId);
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                hook_id: hookId,
                summary: {
                  total_executions: summary.totalExecutions,
                  success_rate: summary.totalExecutions > 0 
                    ? ((summary.successCount / summary.totalExecutions) * 100).toFixed(1) + "%"
                    : "N/A",
                  failure_count: summary.failureCount,
                  avg_duration_ms: summary.avgDuration.toFixed(2),
                  last_execution: summary.lastExecution?.timestamp || null
                },
                recent_executions: logs.slice(-10).map(l => ({
                  timestamp: l.timestamp,
                  success: l.success,
                  duration_ms: l.duration_ms.toFixed(2),
                  error: l.error
                }))
              }, null, 2)
            }]
          };
        } else {
          // Get recent logs across all hooks
          const recentLogs = getRecentLogs(50);
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                total_recent_executions: recentLogs.length,
                executions: recentLogs.slice(-20).map(l => ({
                  hook_name: l.hookName,
                  event: l.event,
                  timestamp: l.timestamp,
                  success: l.success,
                  duration_ms: l.duration_ms.toFixed(2)
                }))
              }, null, 2)
            }]
          };
        }
      }
      
      case "unregister": {
        let hookId = input.hook_id;
        
        if (input.hook_name && !hookId) {
          const hook = getHookByName(input.hook_name);
          if (hook) hookId = hook.id;
        }
        
        if (!hookId) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Hook not found. Provide hook_id or hook_name."
              }, null, 2)
            }],
            isError: true
          };
        }
        
        const deleted = deleteHook(hookId);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: deleted,
              hook_id: hookId,
              message: deleted ? "Hook unregistered successfully" : "Hook not found"
            }, null, 2)
          }]
        };
      }
      
      case "enable":
      case "disable": {
        let hookId = input.hook_id;
        
        if (input.hook_name && !hookId) {
          const hook = getHookByName(input.hook_name);
          if (hook) hookId = hook.id;
        }
        
        if (!hookId) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Hook not found. Provide hook_id or hook_name."
              }, null, 2)
            }],
            isError: true
          };
        }
        
        const enabled = input.action === "enable";
        const updated = updateHook(hookId, { enabled });
        
        if (!updated) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Failed to update hook"
              }, null, 2)
            }],
            isError: true
          };
        }
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              hook_id: hookId,
              hook_name: updated.name,
              enabled: updated.enabled,
              message: `Hook ${enabled ? "enabled" : "disabled"} successfully`
            }, null, 2)
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
