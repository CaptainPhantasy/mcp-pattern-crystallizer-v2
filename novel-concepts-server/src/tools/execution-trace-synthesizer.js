/**
 * execution_trace_synthesizer tool
 * Generates predictive execution traces using regex-based AST simulation.
 * Applies PaTH pattern for state evolution tracking.
 */
import { z } from "zod";
// Input validation schema
export const ExecutionTraceSynthesizerInputSchema = z.object({
    code: z.string().min(1),
    language: z.enum(["javascript", "typescript", "python", "java"]).default("javascript"),
    entry_point: z.string().optional().default("main"),
    input_scenarios: z.array(z.object({
        name: z.string(),
        inputs: z.record(z.unknown())
    })).optional().default([]),
    trace_depth: z.number().min(1).max(500).optional().default(100)
});
// Language-specific patterns
const LANGUAGE_PATTERNS = {
    javascript: {
        functionDecl: /function\s+(\w+)\s*\(([^)]*)\)\s*\{|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g,
        ifStatement: /if\s*\(([^)]+)\)\s*\{/g,
        loop: /(?:for|while)\s*\(([^)]+)\)\s*\{/g,
        returnStatement: /return\s+([^;]+)/g,
        variableAssignment: /(?:const|let|var)\s+(\w+)\s*=\s*([^;]+)/g,
        propertyAccess: /(\w+)\.(\w+)/g
    },
    typescript: {
        functionDecl: /function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\{|(?:const|let|var)\s+(\w+)\s*(?::\s[^=]+)?\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s[^=]+)?=>/g,
        ifStatement: /if\s*\(([^)]+)\)\s*\{/g,
        loop: /(?:for|while)\s*\(([^)]+)\)\s*\{/g,
        returnStatement: /return\s+([^;]+)/g,
        variableAssignment: /(?:const|let|var)\s+(\w+)\s*(?::\s[^=]+)?\s*=\s*([^;]+)/g,
        propertyAccess: /(\w+)\.(\w+)/g
    },
    python: {
        functionDecl: /def\s+(\w+)\s*\(([^)]*)\)\s*:/g,
        ifStatement: /if\s+([^:]+):/g,
        loop: /(?:for|while)\s+([^:]+):/g,
        returnStatement: /return\s+([^#\n]+)/g,
        variableAssignment: /(\w+)\s*=\s*([^#\n]+)/g,
        propertyAccess: /(\w+)\.(\w+)/g
    },
    java: {
        functionDecl: /(?:public|private|protected)?\s*(?:static\s+)?(?:\w+)\s+(\w+)\s*\(([^)]*)\)\s*\{/g,
        ifStatement: /if\s*\(([^)]+)\)\s*\{/g,
        loop: /(?:for|while)\s*\(([^)]+)\)\s*\{/g,
        returnStatement: /return\s+([^;]+)/g,
        variableAssignment: /(?:\w+)\s+(\w+)\s*=\s*([^;]+)/g,
        propertyAccess: /(\w+)\.(\w+)/g
    }
};
// Extract code structure
function extractStructure(code, language) {
    const patterns = LANGUAGE_PATTERNS[language] || LANGUAGE_PATTERNS.javascript;
    const lines = code.split("\n");
    const functions = [];
    const conditionals = [];
    const loops = [];
    const returns = [];
    const assignments = [];
    const propertyAccesses = [];
    lines.forEach((line, lineIndex) => {
        // Functions
        let match;
        patterns.functionDecl.lastIndex = 0;
        while ((match = patterns.functionDecl.exec(line)) !== null) {
            const name = match[1] || match[3];
            const paramsStr = match[2] || match[4] || "";
            const params = paramsStr.split(",").map(p => p.trim()).filter(Boolean);
            functions.push({ name, params, startLine: lineIndex + 1 });
        }
        // If statements
        patterns.ifStatement.lastIndex = 0;
        while ((match = patterns.ifStatement.exec(line)) !== null) {
            conditionals.push({ condition: match[1], line: lineIndex + 1 });
        }
        // Loops
        patterns.loop.lastIndex = 0;
        while ((match = patterns.loop.exec(line)) !== null) {
            loops.push({ condition: match[1], line: lineIndex + 1 });
        }
        // Returns
        patterns.returnStatement.lastIndex = 0;
        while ((match = patterns.returnStatement.exec(line)) !== null) {
            returns.push({ value: match[1].trim(), line: lineIndex + 1 });
        }
        // Assignments
        patterns.variableAssignment.lastIndex = 0;
        while ((match = patterns.variableAssignment.exec(line)) !== null) {
            assignments.push({ variable: match[1], value: match[2].trim(), line: lineIndex + 1 });
        }
        // Property access
        patterns.propertyAccess.lastIndex = 0;
        while ((match = patterns.propertyAccess.exec(line)) !== null) {
            propertyAccesses.push({ object: match[1], property: match[2], line: lineIndex + 1 });
        }
    });
    return { functions, conditionals, loops, returns, assignments, propertyAccesses };
}
// Simulate execution for a given scenario
function simulateExecution(code, language, structure, inputs, traceDepth) {
    const path = [];
    const state = { ...inputs };
    let step = 0;
    let result = undefined;
    let error = undefined;
    const lines = code.split("\n");
    // Initialize state with inputs
    for (const [key, value] of Object.entries(inputs)) {
        state[key] = value;
    }
    // Simulate execution through code lines
    for (let i = 0; i < lines.length && step < traceDepth; i++) {
        const line = lines[i];
        const lineNum = i + 1;
        // Skip empty lines and comments
        if (!line.trim() || line.trim().startsWith("//") || line.trim().startsWith("#")) {
            continue;
        }
        let decision = `Line ${lineNum}: ${line.trim().substring(0, 50)}...`;
        // Check for conditionals
        for (const cond of structure.conditionals) {
            if (cond.line === lineNum) {
                const conditionResult = evaluateCondition(cond.condition, state);
                decision = `Line ${lineNum}: IF ${cond.condition} evaluates to ${conditionResult}, ${conditionResult ? "take branch" : "skip branch"}`;
                state._lastCondition = conditionResult;
            }
        }
        // Check for loops
        for (const loop of structure.loops) {
            if (loop.line === lineNum) {
                decision = `Line ${lineNum}: LOOP ${loop.condition}, potential iteration`;
                state._inLoop = true;
            }
        }
        // Check for assignments
        for (const assign of structure.assignments) {
            if (assign.line === lineNum) {
                const value = evaluateExpression(assign.value, state);
                state[assign.variable] = value;
                decision = `Line ${lineNum}: Assign ${assign.variable} = ${JSON.stringify(value)}`;
            }
        }
        // Check for returns
        for (const ret of structure.returns) {
            if (ret.line === lineNum) {
                result = evaluateExpression(ret.value, state);
                decision = `Line ${lineNum}: RETURN ${JSON.stringify(result)}`;
                state._returned = true;
            }
        }
        // Check for property access (potential null dereference)
        for (const access of structure.propertyAccesses) {
            if (access.line === lineNum) {
                const obj = state[access.object];
                if (obj === null || obj === undefined) {
                    decision = `Line ${lineNum}: WARNING - Potential null dereference of '${access.object}'`;
                    state._nullRisk = `${access.object}.${access.property}`;
                }
                else {
                    decision = `Line ${lineNum}: Access ${access.object}.${access.property}`;
                }
            }
        }
        path.push({
            step: ++step,
            line: lineNum,
            state: { ...state },
            decision
        });
        // Stop if returned
        if (state._returned) {
            break;
        }
    }
    const finalState = {};
    for (const [key, value] of Object.entries(state)) {
        if (!key.startsWith("_")) {
            finalState[key] = value;
        }
    }
    return {
        scenario: "custom",
        path,
        final_state: finalState,
        result: result ?? (state._returned ? undefined : "no_return"),
        error
    };
}
// Simple condition evaluation (heuristic)
function evaluateCondition(condition, state) {
    const lower = condition.toLowerCase();
    // Check for null/undefined checks
    if (lower.includes("== null") || lower.includes("=== null") || lower.includes("=== undefined")) {
        const varName = condition.split(/\s+/)[0];
        return state[varName] === null || state[varName] === undefined;
    }
    // Check for truthy/falsy patterns
    for (const [key, value] of Object.entries(state)) {
        if (lower.includes(`${key.toLowerCase()}`)) {
            if (lower.includes("!") || lower.includes("== false")) {
                return !value;
            }
            return Boolean(value);
        }
    }
    // Default: assume true for simulation
    return true;
}
// Simple expression evaluation (heuristic)
function evaluateExpression(expr, state) {
    const trimmed = expr.trim();
    // Check for literal values
    if (trimmed === "true")
        return true;
    if (trimmed === "false")
        return false;
    if (trimmed === "null")
        return null;
    if (trimmed === "undefined")
        return undefined;
    if (/^\d+$/.test(trimmed))
        return parseInt(trimmed, 10);
    if (/^\d+\.\d+$/.test(trimmed))
        return parseFloat(trimmed);
    if (/^["'].*["']$/.test(trimmed))
        return trimmed.slice(1, -1);
    // Check for variable references
    for (const [key, value] of Object.entries(state)) {
        if (trimmed === key) {
            return value;
        }
    }
    // Check for property access
    const propertyMatch = trimmed.match(/^(\w+)\.(\w+)$/);
    if (propertyMatch) {
        const obj = state[propertyMatch[1]];
        if (obj && typeof obj === "object") {
            return obj[propertyMatch[2]];
        }
    }
    // Return as-is for complex expressions
    return trimmed;
}
// Analyze potential issues
function analyzeIssues(code, language, structure, scenarios) {
    const issues = [];
    // Check for missing returns
    const functionsWithReturns = new Set();
    for (const ret of structure.returns) {
        for (const fn of structure.functions) {
            if (ret.line > fn.startLine) {
                functionsWithReturns.add(fn.name);
            }
        }
    }
    for (const fn of structure.functions) {
        if (!functionsWithReturns.has(fn.name) && !fn.name.includes("void") && !fn.name.includes("proc")) {
            issues.push({
                type: "missing_return",
                location: `function ${fn.name}`,
                scenario: "all",
                confidence: 0.6,
                description: `Function '${fn.name}' may not have a return statement on all paths`
            });
        }
    }
    // Check for potential null dereferences
    for (const access of structure.propertyAccesses) {
        let checkedBefore = false;
        for (const cond of structure.conditionals) {
            if (cond.line < access.line && cond.condition.includes(access.object)) {
                if (cond.condition.includes("null") || cond.condition.includes("undefined")) {
                    checkedBefore = true;
                    break;
                }
            }
        }
        if (!checkedBefore) {
            issues.push({
                type: "null_dereference",
                location: `line ${access.line}: ${access.object}.${access.property}`,
                scenario: "when " + access.object + " is null/undefined",
                confidence: 0.7,
                description: `Potential null dereference of '${access.object}' - no null check detected before access`
            });
        }
    }
    // Check for potential infinite loops
    for (const loop of structure.loops) {
        const lower = loop.condition.toLowerCase();
        if (lower.includes("true") || lower === ";") {
            issues.push({
                type: "infinite_loop",
                location: `line ${loop.line}`,
                scenario: "all",
                confidence: 0.9,
                description: "Loop condition may never become false - potential infinite loop"
            });
        }
    }
    // Check for type mismatches (JavaScript/TypeScript specific)
    if (language === "javascript" || language === "typescript") {
        for (const assign of structure.assignments) {
            const valueLower = assign.value.toLowerCase();
            if (valueLower.includes("parseint") && !assign.variable.toLowerCase().includes("num")) {
                issues.push({
                    type: "type_mismatch",
                    location: `line ${assign.line}`,
                    scenario: "all",
                    confidence: 0.4,
                    description: `Variable '${assign.variable}' assigned integer value but name doesn't indicate numeric type`
                });
            }
        }
    }
    // Check for unreachable code (after return)
    const returnLines = new Set(structure.returns.map(r => r.line));
    for (const assign of structure.assignments) {
        for (const retLine of returnLines) {
            if (assign.line === retLine + 1) {
                issues.push({
                    type: "unreachable",
                    location: `line ${assign.line}`,
                    scenario: "all",
                    confidence: 0.85,
                    description: "Code after return statement may be unreachable"
                });
                break;
            }
        }
    }
    return issues;
}
export const executionTraceSynthesizerDefinition = {
    name: "execution_trace_synthesizer",
    description: `Generate predictive execution traces before running code to catch logical errors.

This tool applies the PaTH (Pattern-based Trace Heuristics) pattern to simulate code execution
and identify potential issues without actually running the code.

**Features:**
- Parses code structure using regex-based patterns
- Simulates execution through control flow paths
- Tracks state evolution at each step
- Identifies potential issues: null dereferences, infinite loops, unreachable code, missing returns

**Supported Languages:**
- JavaScript
- TypeScript
- Python
- Java

**Issue Detection:**
- \`null_dereference\`: Property access without null check
- \`infinite_loop\`: Loop condition that may never become false
- \`unreachable\`: Code after return statement
- \`type_mismatch\`: Variable naming inconsistent with assigned type
- \`missing_return\`: Function without return on all paths

**Example:**
\`\`\`json
{
  "code": "function processUser(user) { if (user.isActive) { return user.profile.settings.theme; } return 'default'; }",
  "language": "javascript",
  "entry_point": "processUser",
  "input_scenarios": [
    { "name": "active user with profile", "inputs": { "user": { "isActive": true, "profile": { "settings": { "theme": "dark" } } } } },
    { "name": "active user without profile", "inputs": { "user": { "isActive": true } } }
  ],
  "trace_depth": 50
}
\`\`\``,
    inputSchema: {
        type: "object",
        properties: {
            code: {
                type: "string",
                description: "The code to analyze and trace"
            },
            language: {
                type: "string",
                enum: ["javascript", "typescript", "python", "java"],
                description: "Programming language",
                default: "javascript"
            },
            entry_point: {
                type: "string",
                description: "Function/method to trace (default: 'main')"
            },
            input_scenarios: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        inputs: { type: "object" }
                    },
                    required: ["name", "inputs"]
                },
                description: "Input scenarios to trace",
                default: []
            },
            trace_depth: {
                type: "number",
                description: "Maximum steps to trace (default: 100)",
                minimum: 1,
                maximum: 500,
                default: 100
            }
        },
        required: ["code"]
    }
};
export async function handleExecutionTraceSynthesizer(args) {
    try {
        const input = ExecutionTraceSynthesizerInputSchema.parse(args);
        // Extract code structure
        const structure = extractStructure(input.code, input.language);
        // Prepare scenarios
        let scenarios = input.input_scenarios;
        if (scenarios.length === 0) {
            // Generate default scenarios
            scenarios = [
                { name: "default", inputs: {} }
            ];
        }
        // Simulate execution for each scenario
        const traces = [];
        for (const scenario of scenarios) {
            const trace = simulateExecution(input.code, input.language, structure, scenario.inputs, input.trace_depth);
            trace.scenario = scenario.name;
            traces.push(trace);
        }
        // Analyze potential issues
        const potentialIssues = analyzeIssues(input.code, input.language, structure, traces);
        // Calculate execution path count
        const pathCount = structure.conditionals.length + 1;
        // Estimate coverage
        const coverageEstimate = scenarios.length > 0
            ? Math.min(scenarios.length / Math.max(pathCount, 1), 1.0)
            : 0.5;
        // Identify unreachable code
        const unreachableCode = [];
        const returnLines = new Set(structure.returns.map(r => r.line));
        for (const cond of structure.conditionals) {
            if (cond.line > Math.max(...returnLines, 0)) {
                // Check if this conditional might be unreachable
                for (const retLine of returnLines) {
                    if (cond.line > retLine) {
                        unreachableCode.push({ line: cond.line, reason: "After return statement" });
                        break;
                    }
                }
            }
        }
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        traces,
                        analysis: {
                            execution_paths: pathCount,
                            unreachable_code: unreachableCode,
                            potential_issues: potentialIssues.map(issue => ({
                                type: issue.type,
                                location: issue.location,
                                scenario: issue.scenario,
                                confidence: Math.round(issue.confidence * 100) / 100,
                                description: issue.description
                            })),
                            coverage_estimate: Math.round(coverageEstimate * 100) / 100
                        },
                        structure_summary: {
                            functions_found: structure.functions.length,
                            conditionals_found: structure.conditionals.length,
                            loops_found: structure.loops.length,
                            returns_found: structure.returns.length
                        }
                    }, null, 2)
                }]
        };
    }
    catch (error) {
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
