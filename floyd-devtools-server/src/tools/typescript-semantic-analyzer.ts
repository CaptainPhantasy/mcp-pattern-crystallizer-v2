/**
 * typescript_semantic_analyzer tool
 * TypeScript-aware code intelligence for mismatches, tracing, and comparison
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as ts from "typescript";
import { resolve, join } from "path";
import { existsSync } from "fs";

export const TypeScriptSemanticAnalyzerInputSchema = z.object({
  action: z.enum(["find_type_mismatches", "trace_type", "compare_types"]),
  project_path: z.string(),
  error_code: z.number().optional(),
  type_name: z.string().optional(),
  type_a: z.string().optional(),
  type_b: z.string().optional(),
  include_diagnostics: z.boolean().optional().default(false),
});

export type TypeScriptSemanticAnalyzerInput = z.infer<typeof TypeScriptSemanticAnalyzerInputSchema>;

export const typescriptSemanticAnalyzerDefinition: Tool = {
  name: "typescript_semantic_analyzer",
  description: "TypeScript-aware analysis: find mismatches, trace types, compare types",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["find_type_mismatches", "trace_type", "compare_types"] },
      project_path: { type: "string", description: "Path to TS project (folder containing tsconfig.json)" },
      error_code: { type: "number", description: "TypeScript diagnostic code to filter (e.g., 2322)" },
      type_name: { type: "string", description: "Type name to trace" },
      type_a: { type: "string", description: "First type name to compare" },
      type_b: { type: "string", description: "Second type name to compare" },
      include_diagnostics: { type: "boolean", default: false },
    },
    required: ["action", "project_path"],
  },
};

interface FileLocation {
  file: string;
  line: number;
  column: number;
}

interface TypeTraceResult {
  typeName: string;
  definitions: FileLocation[];
  usages: FileLocation[];
  aliases: string[];
}

function createProgram(projectPath: string): ts.Program {
  const configPath = ts.findConfigFile(projectPath, ts.sys.fileExists, "tsconfig.json");
  if (!configPath || !existsSync(configPath)) {
    throw new Error(`tsconfig.json not found under: ${projectPath}`);
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  }

  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, join(projectPath, ""));
  return ts.createProgram(parsed.fileNames, parsed.options);
}

function toLocation(file: ts.SourceFile, pos: number): FileLocation {
  const { line, character } = file.getLineAndCharacterOfPosition(pos);
  return {
    file: file.fileName,
    line: line + 1,
    column: character + 1,
  };
}

function parseMismatchMessage(message: string): { actual?: string; expected?: string } {
  const match = message.match(/Type '(.+)' is not assignable to type '(.+)'\.?/);
  if (!match) return {};
  return { actual: match[1], expected: match[2] };
}

function traceType(program: ts.Program, typeName: string): TypeTraceResult {
  const definitions: FileLocation[] = [];
  const usages: FileLocation[] = [];
  const aliases: string[] = [];

  const checker = program.getTypeChecker();

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;

    function visit(node: ts.Node) {
      if (
        (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isClassDeclaration(node)) &&
        node.name &&
        node.name.text === typeName
      ) {
        definitions.push(toLocation(sourceFile, node.name.getStart()));
      }

      if (ts.isIdentifier(node) && node.text === typeName) {
        // Avoid counting the identifier if it's the definition itself
        const parent = node.parent;
        const isDefinition = ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isEnumDeclaration(parent) || ts.isClassDeclaration(parent);
        if (!isDefinition) {
          usages.push(toLocation(sourceFile, node.getStart()));
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  // Discover aliases using the checker
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    ts.forEachChild(sourceFile, (node) => {
      if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol && symbol.declarations) {
          symbol.declarations.forEach((decl) => {
            if (ts.isTypeAliasDeclaration(decl) && decl.name.text !== typeName) {
              aliases.push(decl.name.text);
            }
          });
        }
      }
    });
  }

  return { typeName, definitions, usages, aliases };
}

function normalizeUnion(typeText: string): string[] {
  return typeText
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean)
    .sort();
}

function getTypeStringByName(program: ts.Program, checker: ts.TypeChecker, typeName: string): string | null {
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    let found: string | null = null;

    function visit(node: ts.Node) {
      if (
        (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isClassDeclaration(node)) &&
        node.name &&
        node.name.text === typeName
      ) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol) {
          found = checker.typeToString(checker.getDeclaredTypeOfSymbol(symbol));
          return;
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    if (found) return found;
  }

  return null;
}

export async function handleTypeScriptSemanticAnalyzer(args: unknown) {
  const input = TypeScriptSemanticAnalyzerInputSchema.parse(args);
  const projectPath = resolve(input.project_path);
  const program = createProgram(projectPath);
  const checker = program.getTypeChecker();

  switch (input.action) {
    case "find_type_mismatches": {
      const code = input.error_code ?? 2322;
      const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => d.code === code);

      const mismatches = diagnostics.map((diag) => {
        const message = ts.flattenDiagnosticMessageText(diag.messageText, " ");
        const parsed = parseMismatchMessage(message);
        const file = diag.file ? diag.file.fileName : "";
        const pos = diag.file && diag.start !== undefined ? toLocation(diag.file, diag.start) : null;

        let expectedTrace: TypeTraceResult | null = null;
        let actualTrace: TypeTraceResult | null = null;

        if (parsed.expected) {
          expectedTrace = traceType(program, parsed.expected);
        }
        if (parsed.actual) {
          actualTrace = traceType(program, parsed.actual);
        }

        return {
          code: diag.code,
          message,
          location: pos || { file, line: 0, column: 0 },
          expectedType: parsed.expected,
          actualType: parsed.actual,
          expectedTrace,
          actualTrace,
        };
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ mismatches, total: mismatches.length, code }, null, 2),
        }],
      };
    }

    case "trace_type": {
      if (!input.type_name) {
        throw new Error("type_name is required for trace_type");
      }

      const trace = traceType(program, input.type_name);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(trace, null, 2),
        }],
      };
    }

    case "compare_types": {
      if (!input.type_a || !input.type_b) {
        throw new Error("type_a and type_b are required for compare_types");
      }

      const traceA = traceType(program, input.type_a);
      const traceB = traceType(program, input.type_b);

      let typeAText = getTypeStringByName(program, checker, input.type_a) || input.type_a;
      let typeBText = getTypeStringByName(program, checker, input.type_b) || input.type_b;

      const unionA = normalizeUnion(typeAText);
      const unionB = normalizeUnion(typeBText);

      const onlyInA = unionA.filter((v) => !unionB.includes(v));
      const onlyInB = unionB.filter((v) => !unionA.includes(v));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            typeA: input.type_a,
            typeB: input.type_b,
            typeAText,
            typeBText,
            onlyInA,
            onlyInB,
            traceA,
            traceB,
          }, null, 2),
        }],
      };
    }

    default:
      throw new Error(`Unknown action: ${input.action}`);
  }
}
