/**
 * build_error_correlator tool
 * Correlate build errors across projects and identify root causes
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { execSync } from "child_process";
import { resolve } from "path";

export const BuildErrorCorrelatorInputSchema = z.object({
  action: z.enum(["correlate_errors", "identify_root_error"]),
  projects: z.array(z.string()).optional(),
  build_command: z.string().optional(),
  errors: z.array(z.object({
    project: z.string(),
    file: z.string().optional(),
    line: z.number().optional(),
    code: z.string().optional(),
    message: z.string(),
  })).optional(),
});

export type BuildErrorCorrelatorInput = z.infer<typeof BuildErrorCorrelatorInputSchema>;

export const buildErrorCorrelatorDefinition: Tool = {
  name: "build_error_correlator",
  description: "Correlate build errors across projects and identify root causes",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["correlate_errors", "identify_root_error"] },
      projects: { type: "array", items: { type: "string" } },
      build_command: { type: "string" },
      errors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            project: { type: "string" },
            file: { type: "string" },
            line: { type: "number" },
            code: { type: "string" },
            message: { type: "string" },
          },
          required: ["project", "message"],
        },
      },
    },
    required: ["action"],
  },
};

interface BuildError {
  project: string;
  file?: string;
  line?: number;
  code?: string;
  message: string;
}

function parseErrors(project: string, output: string): BuildError[] {
  const errors: BuildError[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const tsMatch = line.match(/(.*)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.*)/);
    if (tsMatch) {
      errors.push({
        project,
        file: tsMatch[1].trim(),
        line: Number(tsMatch[2]),
        code: tsMatch[4],
        message: tsMatch[5].trim(),
      });
      continue;
    }

    const genericMatch = line.match(/error\s+(TS\d+):\s*(.*)/);
    if (genericMatch) {
      errors.push({
        project,
        code: genericMatch[1],
        message: genericMatch[2].trim(),
      });
    }
  }

  return errors;
}

function groupErrors(errors: BuildError[]) {
  const groups = new Map<string, BuildError[]>();

  for (const err of errors) {
    const key = `${err.code || "unknown"}:${err.message}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(err);
  }

  return Array.from(groups.entries()).map(([key, items]) => ({
    key,
    rootError: items[0],
    symptomErrors: items.slice(1),
    affectedProjects: Array.from(new Set(items.map((e) => e.project))),
  }));
}

function identifyRoot(groups: Array<{ key: string; rootError: BuildError; symptomErrors: BuildError[]; affectedProjects: string[] }>) {
  if (groups.length === 0) return null;
  const sorted = [...groups].sort((a, b) => b.affectedProjects.length - a.affectedProjects.length);
  return sorted[0].rootError;
}

export async function handleBuildErrorCorrelator(args: unknown) {
  const input = BuildErrorCorrelatorInputSchema.parse(args);
  let errors: BuildError[] = [];

  if (input.errors && input.errors.length > 0) {
    errors = input.errors as BuildError[];
  } else if (input.projects && input.projects.length > 0) {
    const command = input.build_command || "npm run build";

    for (const project of input.projects) {
      try {
        execSync(command, { cwd: resolve(project), stdio: "pipe" });
      } catch (error: any) {
        const output = `${error.stdout || ""}\n${error.stderr || ""}`;
        errors.push(...parseErrors(project, output));
      }
    }
  } else {
    throw new Error("Provide either errors or projects to analyze");
  }

  const groups = groupErrors(errors);

  if (input.action === "identify_root_error") {
    const root = identifyRoot(groups);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ rootError: root, confidence: root ? 0.7 : 0 }, null, 2),
      }],
    };
  }

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        errorGroups: groups,
        fixOrder: groups.map((group) => group.rootError.project),
        independentErrors: errors.filter((err) => err.code === undefined),
      }, null, 2),
    }],
  };
}
