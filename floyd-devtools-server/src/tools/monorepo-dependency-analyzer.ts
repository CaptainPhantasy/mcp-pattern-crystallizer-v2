/**
 * monorepo_dependency_analyzer tool
 * Build dependency graphs and analyze blast radius in monorepos
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";

export const MonorepoDependencyAnalyzerInputSchema = z.object({
  action: z.enum(["build_dependency_graph", "analyze_blast_radius", "suggest_fix_order", "detect_config_issues"]),
  root_path: z.string(),
  include_dev_deps: z.boolean().optional().default(false),
  include_transitive: z.boolean().optional().default(false),
  failed_package: z.string().optional(),
  failure_type: z.enum(["build", "types", "runtime"]).optional(),
  broken_packages: z.array(z.string()).optional(),
});

export type MonorepoDependencyAnalyzerInput = z.infer<typeof MonorepoDependencyAnalyzerInputSchema>;

export const monorepoDependencyAnalyzerDefinition: Tool = {
  name: "monorepo_dependency_analyzer",
  description: "Build dependency graphs and analyze blast radius for monorepos",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["build_dependency_graph", "analyze_blast_radius", "suggest_fix_order", "detect_config_issues"] },
      root_path: { type: "string" },
      include_dev_deps: { type: "boolean", default: false },
      include_transitive: { type: "boolean", default: false },
      failed_package: { type: "string" },
      failure_type: { type: "string", enum: ["build", "types", "runtime"] },
      broken_packages: { type: "array", items: { type: "string" } },
    },
    required: ["action", "root_path"],
  },
};

interface PackageNode {
  name: string;
  path: string;
  dependencies: string[];
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && readdirSync(path) !== undefined;
  } catch {
    return false;
  }
}

function walk(root: string, skipDirs: Set<string>): string[] {
  const results: string[] = [];
  const entries = readdirSync(root, { withFileTypes: true });

  for (const entry of entries) {
    if (skipDirs.has(entry.name)) continue;
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(fullPath, skipDirs));
    } else if (entry.isFile() && entry.name === "package.json") {
      results.push(fullPath);
    }
  }

  return results;
}

function buildGraph(rootPath: string, includeDevDeps: boolean): Map<string, PackageNode> {
  const skipDirs = new Set(["node_modules", ".git", "dist", "build", "out", ".floyd", ".claude"]);
  const pkgFiles = walk(rootPath, skipDirs);
  const graph = new Map<string, PackageNode>();

  for (const pkgPath of pkgFiles) {
    const raw = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (!raw.name) continue;

    const deps = {
      ...(raw.dependencies || {}),
      ...(includeDevDeps ? raw.devDependencies || {} : {}),
      ...(raw.peerDependencies || {}),
    };

    graph.set(raw.name, {
      name: raw.name,
      path: dirname(pkgPath),
      dependencies: Object.keys(deps),
    });
  }

  return graph;
}

function buildReverseGraph(graph: Map<string, PackageNode>): Map<string, string[]> {
  const reverse = new Map<string, string[]>();

  for (const [name, node] of graph) {
    for (const dep of node.dependencies) {
      if (!reverse.has(dep)) reverse.set(dep, []);
      reverse.get(dep)!.push(name);
    }
  }

  return reverse;
}

function analyzeBlastRadius(graph: Map<string, PackageNode>, failed: string): { directlyAffected: string[]; transitivelyAffected: string[] } {
  const reverse = buildReverseGraph(graph);
  const directly = reverse.get(failed) || [];
  const visited = new Set<string>(directly);
  const queue = [...directly];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents = reverse.get(current) || [];
    for (const dep of dependents) {
      if (!visited.has(dep)) {
        visited.add(dep);
        queue.push(dep);
      }
    }
  }

  const transitively = Array.from(visited).filter((d) => !directly.includes(d));
  return { directlyAffected: directly, transitivelyAffected: transitively };
}

function suggestFixOrder(graph: Map<string, PackageNode>, broken: string[]): string[] {
  const order: string[] = [];
  const visited = new Set<string>();

  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const node = graph.get(name);
    if (!node) return;
    node.dependencies.forEach(visit);
    order.push(name);
  }

  broken.forEach(visit);
  return order.filter((pkg) => broken.includes(pkg));
}

function detectConfigIssues(graph: Map<string, PackageNode>): Array<{ project: string; issue: string; details: string; suggestedFix: string }> {
  const issues: Array<{ project: string; issue: string; details: string; suggestedFix: string }> = [];

  for (const node of graph.values()) {
    const tsconfig = join(node.path, "tsconfig.json");
    if (!existsSync(tsconfig)) {
      issues.push({
        project: node.name,
        issue: "missing_tsconfig",
        details: "No tsconfig.json found",
        suggestedFix: "Add a project-specific tsconfig.json",
      });
    }
  }

  return issues;
}

export async function handleMonorepoDependencyAnalyzer(args: unknown) {
  const input = MonorepoDependencyAnalyzerInputSchema.parse(args);
  const graph = buildGraph(input.root_path, input.include_dev_deps ?? false);

  switch (input.action) {
    case "build_dependency_graph": {
      const edges: Array<{ from: string; to: string }> = [];
      for (const [name, node] of graph) {
        for (const dep of node.dependencies) {
          if (graph.has(dep)) edges.push({ from: name, to: dep });
        }
      }

      const roots = Array.from(graph.keys()).filter((name) => !edges.some((edge) => edge.to === name));
      const leaves = Array.from(graph.keys()).filter((name) => !edges.some((edge) => edge.from === name));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            nodes: Array.from(graph.values()),
            edges,
            roots,
            leaves,
          }, null, 2),
        }],
      };
    }

    case "analyze_blast_radius": {
      if (!input.failed_package) {
        throw new Error("failed_package is required for analyze_blast_radius");
      }

      const { directlyAffected, transitivelyAffected } = analyzeBlastRadius(graph, input.failed_package);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            failedPackage: input.failed_package,
            failureType: input.failure_type || "types",
            directlyAffected,
            transitivelyAffected,
          }, null, 2),
        }],
      };
    }

    case "suggest_fix_order": {
      if (!input.broken_packages || input.broken_packages.length === 0) {
        throw new Error("broken_packages is required for suggest_fix_order");
      }

      const order = suggestFixOrder(graph, input.broken_packages);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ order }, null, 2),
        }],
      };
    }

    case "detect_config_issues": {
      const issues = detectConfigIssues(graph);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ issues, total: issues.length }, null, 2),
        }],
      };
    }

    default:
      throw new Error(`Unknown action: ${input.action}`);
  }
}
