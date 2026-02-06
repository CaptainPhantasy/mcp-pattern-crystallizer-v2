/**
 * test_generator tool
 * Auto-generate test cases from code
 * Supports: Jest, Vitest, pytest, Go testing
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Input validation schema
export const TestGeneratorInputSchema = z.object({
  action: z.enum(["generate", "analyze_coverage", "suggest_edge_cases", "generate_mocks"]),
  source_code: z.string(),
  function_name: z.string().optional(),
  framework: z.enum(["jest", "vitest", "pytest", "go"]).optional().default("jest"),
  test_type: z.enum(["unit", "integration", "property"]).optional().default("unit"),
  include_edge_cases: z.boolean().optional().default(true),
  mock_dependencies: z.boolean().optional().default(true),
  language: z.enum(["typescript", "javascript", "python", "go"]).optional()
});

export type TestGeneratorInput = z.infer<typeof TestGeneratorInputSchema>;

// Function signature interface
interface FunctionSignature {
  name: string;
  params: Array<{
    name: string;
    type: string;
    optional: boolean;
    defaultValue?: string;
  }>;
  returnType: string;
  isAsync: boolean;
  isExported: boolean;
  docComment?: string;
}

// Test case interface
interface TestCase {
  description: string;
  input: Record<string, unknown>;
  expectedOutput?: unknown;
  expectation: string;
  type: "happy_path" | "edge_case" | "error_case";
}

/**
 * Detect language from code
 */
function detectLanguage(code: string): string {
  // TypeScript indicators
  if (code.includes(": string") || code.includes(": number") || code.includes(": boolean") ||
      code.includes("interface ") || code.includes("<T>") || code.includes(": Promise<")) {
    return "typescript";
  }
  
  // Python indicators
  if (code.includes("def ") || code.includes("import ") && !code.includes("import {") ||
      code.includes("    ") && !code.includes("{") || code.includes("->") && code.includes(":")) {
    return "python";
  }
  
  // Go indicators
  if (code.includes("func ") || code.includes("package ") || code.includes(":= ")) {
    return "go";
  }
  
  return "javascript";
}

/**
 * Extract function signatures from TypeScript/JavaScript code
 */
function extractTSFunctions(code: string): FunctionSignature[] {
  const functions: FunctionSignature[] = [];
  const lines = code.split("\n");
  
  // Patterns for different function declarations
  const patterns = [
    // export function name(params): ReturnType
    /export\s+(async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?\s*\{/,
    // export const name = (params): ReturnType =>
    /export\s+const\s+(\w+)\s*=\s*(async\s+)?\(([^)]*)\)(?:\s*:\s*([^=]+))?\s*=>/,
    // function name(params): ReturnType
    /(async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?\s*\{/,
    // const name = (params): ReturnType =>
    /const\s+(\w+)\s*=\s*(async\s+)?\(([^)]*)\)(?:\s*:\s*([^=]+))?\s*=>/
  ];
  
  let docComment = "";
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Capture doc comments
    if (line.trim().startsWith("/**") || line.trim().startsWith("*") || line.trim().startsWith("//")) {
      docComment += line + "\n";
      continue;
    }
    
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        const isExported = line.includes("export");
        const isAsync = line.includes("async");
        
        // Parse based on pattern type
        let name: string;
        let paramsStr: string;
        let returnType: string;
        
        if (line.includes("function")) {
          name = match[2] || match[1];
          paramsStr = match[3] || "";
          returnType = match[4]?.trim() || "void";
        } else {
          name = match[1];
          paramsStr = match[3] || "";
          returnType = match[4]?.trim() || "void";
        }
        
        // Parse parameters
        const params = parseParams(paramsStr);
        
        functions.push({
          name,
          params,
          returnType: returnType.replace(/\{?\s*$/, "").trim(),
          isAsync,
          isExported,
          docComment: docComment.trim() || undefined
        });
        
        docComment = "";
        break;
      }
    }
    
    // Reset doc comment if we hit non-comment, non-function line
    if (!line.trim().startsWith("*") && !line.trim().startsWith("/") && !patterns.some(p => p.test(line))) {
      docComment = "";
    }
  }
  
  return functions;
}

/**
 * Parse parameter string into structured params
 */
function parseParams(paramsStr: string): FunctionSignature["params"] {
  if (!paramsStr.trim()) return [];
  
  const params: FunctionSignature["params"] = [];
  
  // Split by comma, but handle nested types
  let depth = 0;
  let current = "";
  
  for (const char of paramsStr) {
    if (char === "<" || char === "{" || char === "[" || char === "(") depth++;
    if (char === ">" || char === "}" || char === "]" || char === ")") depth--;
    
    if (char === "," && depth === 0) {
      if (current.trim()) {
        params.push(parseParam(current.trim()));
      }
      current = "";
    } else {
      current += char;
    }
  }
  
  if (current.trim()) {
    params.push(parseParam(current.trim()));
  }
  
  return params;
}

/**
 * Parse a single parameter
 */
function parseParam(param: string): FunctionSignature["params"][0] {
  // Handle optional params with ?
  const optional = param.includes("?");
  param = param.replace("?", "");
  
  // Handle default values
  let defaultValue: string | undefined;
  const defaultMatch = param.match(/=\s*(.+)$/);
  if (defaultMatch) {
    defaultValue = defaultMatch[1].trim();
    param = param.replace(/=\s*.+$/, "").trim();
  }
  
  // Split name and type
  const parts = param.split(":").map(p => p.trim());
  const name = parts[0];
  const type = parts[1] || "any";
  
  return {
    name,
    type,
    optional: optional || defaultValue !== undefined,
    defaultValue
  };
}

/**
 * Extract function signatures from Python code
 */
function extractPythonFunctions(code: string): FunctionSignature[] {
  const functions: FunctionSignature[] = [];
  const lines = code.split("\n");
  
  // Pattern: def name(params) -> ReturnType:
  const pattern = /(async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?\s*:/;
  
  let docstring = "";
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    const match = line.match(pattern);
    if (match) {
      const name = match[2];
      const paramsStr = match[3];
      const returnType = match[4]?.trim() || "None";
      const isAsync = !!match[1];
      
      // Check for docstring on next lines
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (nextLine.startsWith('"""') || nextLine.startsWith("'''")) {
          docstring = nextLine;
        }
      }
      
      // Parse Python params
      const params = paramsStr.split(",").filter(p => p.trim() && p.trim() !== "self").map(p => {
        const parts = p.trim().split(":").map(x => x.trim());
        const name = parts[0].replace("*", "").replace("**", "");
        const type = parts[1]?.split("=")[0]?.trim() || "Any";
        const hasDefault = p.includes("=");
        
        return {
          name,
          type,
          optional: hasDefault,
          defaultValue: hasDefault ? p.split("=")[1]?.trim() : undefined
        };
      });
      
      functions.push({
        name,
        params,
        returnType,
        isAsync,
        isExported: !name.startsWith("_"),
        docComment: docstring || undefined
      });
      
      docstring = "";
    }
  }
  
  return functions;
}

/**
 * Generate edge cases for a parameter type
 */
function generateEdgeCases(paramType: string, paramName: string): Array<{ value: unknown; description: string }> {
  const cases: Array<{ value: unknown; description: string }> = [];
  const typeLower = paramType.toLowerCase();
  
  if (typeLower.includes("string")) {
    cases.push(
      { value: "", description: "empty string" },
      { value: " ", description: "whitespace only" },
      { value: "a".repeat(1000), description: "very long string" },
      { value: "<script>alert('xss')</script>", description: "XSS attempt" },
      { value: "特殊字符", description: "unicode characters" }
    );
  }
  
  if (typeLower.includes("number") || typeLower.includes("int") || typeLower.includes("float")) {
    cases.push(
      { value: 0, description: "zero" },
      { value: -1, description: "negative number" },
      { value: Number.MAX_SAFE_INTEGER, description: "max safe integer" },
      { value: Number.MIN_SAFE_INTEGER, description: "min safe integer" },
      { value: 0.1 + 0.2, description: "floating point precision" },
      { value: Infinity, description: "infinity" },
      { value: NaN, description: "NaN" }
    );
  }
  
  if (typeLower.includes("array") || typeLower.includes("[]") || typeLower.includes("list")) {
    cases.push(
      { value: [], description: "empty array" },
      { value: [null], description: "array with null" },
      { value: Array(1000).fill(0), description: "large array" }
    );
  }
  
  if (typeLower.includes("object") || typeLower.includes("record") || typeLower.includes("dict")) {
    cases.push(
      { value: {}, description: "empty object" },
      { value: { nested: { deep: { value: 1 } } }, description: "deeply nested object" },
      { value: null, description: "null value" }
    );
  }
  
  if (typeLower.includes("boolean") || typeLower.includes("bool")) {
    cases.push(
      { value: true, description: "true" },
      { value: false, description: "false" }
    );
  }
  
  // Add null/undefined for optional types
  if (paramType.includes("?") || paramType.includes("undefined") || paramType.includes("null") || paramType.includes("Optional")) {
    cases.push(
      { value: null, description: "null value" },
      { value: undefined, description: "undefined value" }
    );
  }
  
  return cases;
}

/**
 * Generate test cases for a function
 */
function generateTestCases(func: FunctionSignature): TestCase[] {
  const testCases: TestCase[] = [];
  
  // Happy path test
  const happyInput: Record<string, unknown> = {};
  for (const param of func.params) {
    happyInput[param.name] = getDefaultValue(param.type);
  }
  
  testCases.push({
    description: `should return expected result for valid input`,
    input: happyInput,
    expectation: `expect result to match expected output`,
    type: "happy_path"
  });
  
  // Edge cases for each parameter
  for (const param of func.params) {
    const edgeCases = generateEdgeCases(param.type, param.name);
    
    for (const edge of edgeCases.slice(0, 3)) { // Limit to 3 edge cases per param
      const edgeInput = { ...happyInput, [param.name]: edge.value };
      
      testCases.push({
        description: `should handle ${param.name} with ${edge.description}`,
        input: edgeInput,
        expectation: param.optional 
          ? `expect function to handle gracefully`
          : `expect function to throw or handle error`,
        type: "edge_case"
      });
    }
  }
  
  // Error cases
  if (func.params.some(p => !p.optional)) {
    testCases.push({
      description: `should throw error when required params are missing`,
      input: {},
      expectation: `expect function to throw`,
      type: "error_case"
    });
  }
  
  return testCases;
}

/**
 * Get a sensible default value for a type
 */
function getDefaultValue(type: string): unknown {
  const typeLower = type.toLowerCase();
  
  if (typeLower.includes("string")) return "test";
  if (typeLower.includes("number") || typeLower.includes("int") || typeLower.includes("float")) return 42;
  if (typeLower.includes("boolean") || typeLower.includes("bool")) return true;
  if (typeLower.includes("array") || typeLower.includes("[]") || typeLower.includes("list")) return [1, 2, 3];
  if (typeLower.includes("object") || typeLower.includes("record") || typeLower.includes("dict")) return { key: "value" };
  if (typeLower.includes("date")) return "2024-01-01";
  if (typeLower.includes("null") || typeLower.includes("none")) return null;
  
  return "testValue";
}

/**
 * Generate test code for Jest/Vitest
 */
function generateJestTests(func: FunctionSignature, testCases: TestCase[], moduleName: string): string {
  const lines: string[] = [];
  
  lines.push(`import { ${func.name} } from './${moduleName}';`);
  lines.push("");
  lines.push(`describe('${func.name}', () => {`);
  
  for (const tc of testCases) {
    lines.push(`  it('${tc.description}', ${func.isAsync ? "async " : ""}() => {`);
    
    // Generate input
    const inputStr = JSON.stringify(tc.input, null, 4).split("\n").map((l, i) => i === 0 ? l : "    " + l).join("\n");
    
    if (Object.keys(tc.input).length > 0) {
      lines.push(`    const input = ${inputStr};`);
    }
    
    // Generate assertion based on type
    if (tc.type === "error_case") {
      if (func.isAsync) {
        lines.push(`    await expect(${func.name}(${Object.keys(tc.input).length > 0 ? "...Object.values(input)" : ""})).rejects.toThrow();`);
      } else {
        lines.push(`    expect(() => ${func.name}(${Object.keys(tc.input).length > 0 ? "...Object.values(input)" : ""})).toThrow();`);
      }
    } else {
      const callArgs = func.params.map(p => `input.${p.name}`).join(", ");
      if (func.isAsync) {
        lines.push(`    const result = await ${func.name}(${Object.keys(tc.input).length > 0 ? callArgs : ""});`);
      } else {
        lines.push(`    const result = ${func.name}(${Object.keys(tc.input).length > 0 ? callArgs : ""});`);
      }
      
      if (tc.type === "edge_case") {
        lines.push(`    // ${tc.expectation}`);
        lines.push(`    expect(result).toBeDefined();`);
      } else {
        lines.push(`    // TODO: Add specific assertion`);
        lines.push(`    expect(result).toBeDefined();`);
      }
    }
    
    lines.push(`  });`);
    lines.push("");
  }
  
  lines.push(`});`);
  
  return lines.join("\n");
}

/**
 * Generate test code for pytest
 */
function generatePytestTests(func: FunctionSignature, testCases: TestCase[], moduleName: string): string {
  const lines: string[] = [];
  
  lines.push(`import pytest`);
  lines.push(`from ${moduleName} import ${func.name}`);
  lines.push("");
  
  for (const tc of testCases) {
    const testName = tc.description.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
    
    if (func.isAsync) {
      lines.push(`@pytest.mark.asyncio`);
      lines.push(`async def test_${func.name}_${testName}():`);
    } else {
      lines.push(`def test_${func.name}_${testName}():`);
    }
    
    lines.push(`    """${tc.description}"""`);
    
    // Generate input
    for (const [key, value] of Object.entries(tc.input)) {
      const pyValue = JSON.stringify(value).replace(/null/g, "None").replace(/true/g, "True").replace(/false/g, "False");
      lines.push(`    ${key} = ${pyValue}`);
    }
    
    // Generate assertion
    if (tc.type === "error_case") {
      lines.push(`    with pytest.raises(Exception):`);
      const callArgs = func.params.map(p => p.name).join(", ");
      if (func.isAsync) {
        lines.push(`        await ${func.name}(${callArgs})`);
      } else {
        lines.push(`        ${func.name}(${callArgs})`);
      }
    } else {
      const callArgs = func.params.map(p => p.name).join(", ");
      if (func.isAsync) {
        lines.push(`    result = await ${func.name}(${callArgs})`);
      } else {
        lines.push(`    result = ${func.name}(${callArgs})`);
      }
      lines.push(`    # ${tc.expectation}`);
      lines.push(`    assert result is not None`);
    }
    
    lines.push("");
  }
  
  return lines.join("\n");
}

/**
 * Generate mock code
 */
function generateMocks(func: FunctionSignature, framework: string): string {
  const lines: string[] = [];
  
  if (framework === "jest" || framework === "vitest") {
    lines.push(`// Mock for ${func.name}`);
    lines.push(`const mock${func.name} = ${framework === "vitest" ? "vi" : "jest"}.fn();`);
    lines.push("");
    lines.push(`// Setup mock implementation`);
    lines.push(`mock${func.name}.mockImplementation(${func.isAsync ? "async " : ""}(${func.params.map(p => p.name).join(", ")}) => {`);
    lines.push(`  // Return mock value`);
    lines.push(`  return ${JSON.stringify(getDefaultValue(func.returnType))};`);
    lines.push(`});`);
    lines.push("");
    lines.push(`// Reset mock between tests`);
    lines.push(`beforeEach(() => {`);
    lines.push(`  mock${func.name}.mockClear();`);
    lines.push(`});`);
  } else if (framework === "pytest") {
    lines.push(`# Mock for ${func.name}`);
    lines.push(`from unittest.mock import Mock, patch, AsyncMock`);
    lines.push("");
    lines.push(`@pytest.fixture`);
    lines.push(`def mock_${func.name}():`);
    lines.push(`    ${func.isAsync ? "mock = AsyncMock()" : "mock = Mock()"}`);
    lines.push(`    mock.return_value = ${JSON.stringify(getDefaultValue(func.returnType)).replace(/null/g, "None")}`);
    lines.push(`    return mock`);
    lines.push("");
    lines.push(`# Usage in test`);
    lines.push(`def test_with_mock(mock_${func.name}):`);
    lines.push(`    with patch('module.${func.name}', mock_${func.name}):`);
    lines.push(`        # Test code here`);
    lines.push(`        pass`);
  }
  
  return lines.join("\n");
}

/**
 * Analyze code coverage potential
 */
function analyzeCoverage(code: string, functions: FunctionSignature[]): {
  totalFunctions: number;
  exportedFunctions: number;
  asyncFunctions: number;
  branches: number;
  coverageNotes: string[];
} {
  const coverageNotes: string[] = [];
  
  // Count branches (if/else, switch, ternary)
  const ifMatches = code.match(/if\s*\(/g) || [];
  const elseMatches = code.match(/else\s*[{:]/g) || [];
  const switchMatches = code.match(/switch\s*\(/g) || [];
  const ternaryMatches = code.match(/\?.*:/g) || [];
  const tryMatches = code.match(/try\s*\{/g) || [];
  
  const branches = ifMatches.length + elseMatches.length + switchMatches.length + ternaryMatches.length + tryMatches.length;
  
  // Notes for coverage improvement
  if (ifMatches.length > 5) {
    coverageNotes.push(`High branching complexity (${ifMatches.length} if statements) - ensure all paths are tested`);
  }
  
  if (tryMatches.length > 0) {
    coverageNotes.push(`${tryMatches.length} try-catch block(s) - test both success and error paths`);
  }
  
  const privateFunc = functions.filter(f => !f.isExported);
  if (privateFunc.length > 0) {
    coverageNotes.push(`${privateFunc.length} private function(s) - consider testing through public API`);
  }
  
  return {
    totalFunctions: functions.length,
    exportedFunctions: functions.filter(f => f.isExported).length,
    asyncFunctions: functions.filter(f => f.isAsync).length,
    branches,
    coverageNotes
  };
}

export const testGeneratorDefinition: Tool = {
  name: "test_generator",
  description: `Auto-generate test cases from source code.

**Actions:**
- \`generate\`: Generate complete test file
- \`analyze_coverage\`: Analyze code for coverage potential
- \`suggest_edge_cases\`: Get edge case suggestions
- \`generate_mocks\`: Generate mock implementations

**Supported Frameworks:**
- Jest (JavaScript/TypeScript)
- Vitest (JavaScript/TypeScript)
- pytest (Python)
- Go testing (Go)

**Test Types:**
- \`unit\`: Unit tests for individual functions
- \`integration\`: Integration tests
- \`property\`: Property-based tests

**Features:**
- Automatic function signature extraction
- Edge case generation based on parameter types
- Mock generation for dependencies
- Coverage analysis

**Example:**
\`\`\`json
{
  "action": "generate",
  "source_code": "export function add(a: number, b: number): number { return a + b; }",
  "framework": "jest",
  "include_edge_cases": true
}
\`\`\``,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["generate", "analyze_coverage", "suggest_edge_cases", "generate_mocks"],
        description: "Action to perform"
      },
      source_code: {
        type: "string",
        description: "Source code to generate tests for"
      },
      function_name: {
        type: "string",
        description: "Specific function to generate tests for"
      },
      framework: {
        type: "string",
        enum: ["jest", "vitest", "pytest", "go"],
        description: "Test framework to use",
        default: "jest"
      },
      test_type: {
        type: "string",
        enum: ["unit", "integration", "property"],
        description: "Type of tests to generate",
        default: "unit"
      },
      include_edge_cases: {
        type: "boolean",
        description: "Include edge case tests",
        default: true
      },
      mock_dependencies: {
        type: "boolean",
        description: "Generate mocks for dependencies",
        default: true
      },
      language: {
        type: "string",
        enum: ["typescript", "javascript", "python", "go"],
        description: "Source code language (auto-detected if not specified)"
      }
    },
    required: ["action", "source_code"]
  }
};

export async function handleTestGenerator(args: unknown) {
  try {
    const input = TestGeneratorInputSchema.parse(args);
    
    // Detect language if not specified
    const language = input.language || detectLanguage(input.source_code);
    
    // Extract functions based on language
    let functions: FunctionSignature[];
    if (language === "python") {
      functions = extractPythonFunctions(input.source_code);
    } else {
      functions = extractTSFunctions(input.source_code);
    }
    
    // Filter to specific function if requested
    if (input.function_name) {
      functions = functions.filter(f => f.name === input.function_name);
      if (functions.length === 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: `Function '${input.function_name}' not found in source code`,
              available_functions: extractTSFunctions(input.source_code).map(f => f.name)
            }, null, 2)
          }],
          isError: true
        };
      }
    }
    
    if (functions.length === 0) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: "No functions found in source code",
            hint: "Ensure code contains function declarations"
          }, null, 2)
        }],
        isError: true
      };
    }
    
    switch (input.action) {
      case "generate": {
        const allTests: string[] = [];
        const testCasesSummary: Array<{
          function: string;
          test_count: number;
          types: Record<string, number>;
        }> = [];
        
        for (const func of functions) {
          let testCases = generateTestCases(func);
          
          if (!input.include_edge_cases) {
            testCases = testCases.filter(tc => tc.type !== "edge_case");
          }
          
          let testCode: string;
          if (input.framework === "pytest") {
            testCode = generatePytestTests(func, testCases, "module");
          } else {
            testCode = generateJestTests(func, testCases, "module");
          }
          
          allTests.push(testCode);
          
          testCasesSummary.push({
            function: func.name,
            test_count: testCases.length,
            types: {
              happy_path: testCases.filter(tc => tc.type === "happy_path").length,
              edge_case: testCases.filter(tc => tc.type === "edge_case").length,
              error_case: testCases.filter(tc => tc.type === "error_case").length
            }
          });
        }
        
        // Add mocks if requested
        let mockCode = "";
        if (input.mock_dependencies) {
          const mocks = functions.map(f => generateMocks(f, input.framework));
          mockCode = mocks.join("\n\n");
        }
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              language,
              framework: input.framework,
              functions_analyzed: functions.length,
              test_cases_summary: testCasesSummary,
              generated_tests: allTests.join("\n\n// " + "=".repeat(50) + "\n\n"),
              mock_code: mockCode || undefined
            }, null, 2)
          }]
        };
      }
      
      case "analyze_coverage": {
        const coverage = analyzeCoverage(input.source_code, functions);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              language,
              coverage_analysis: {
                total_functions: coverage.totalFunctions,
                exported_functions: coverage.exportedFunctions,
                async_functions: coverage.asyncFunctions,
                estimated_branches: coverage.branches,
                testability_score: Math.round(
                  (coverage.exportedFunctions / Math.max(coverage.totalFunctions, 1)) * 100 *
                  (1 - Math.min(coverage.branches / 50, 0.5))
                )
              },
              functions: functions.map(f => ({
                name: f.name,
                params: f.params.length,
                is_async: f.isAsync,
                is_exported: f.isExported,
                return_type: f.returnType
              })),
              recommendations: coverage.coverageNotes,
              suggested_test_count: functions.reduce((sum, f) => {
                return sum + 1 + f.params.length * 2; // 1 happy path + 2 edge cases per param
              }, 0)
            }, null, 2)
          }]
        };
      }
      
      case "suggest_edge_cases": {
        const suggestions: Array<{
          function: string;
          parameter: string;
          edge_cases: Array<{ value: unknown; description: string }>;
        }> = [];
        
        for (const func of functions) {
          for (const param of func.params) {
            const edgeCases = generateEdgeCases(param.type, param.name);
            if (edgeCases.length > 0) {
              suggestions.push({
                function: func.name,
                parameter: param.name,
                edge_cases: edgeCases
              });
            }
          }
        }
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              language,
              total_suggestions: suggestions.reduce((sum, s) => sum + s.edge_cases.length, 0),
              suggestions
            }, null, 2)
          }]
        };
      }
      
      case "generate_mocks": {
        const mocks = functions.map(f => ({
          function: f.name,
          mock_code: generateMocks(f, input.framework)
        }));
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              framework: input.framework,
              mocks
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
