/**
 * dependency_analyzer tool
 * Detect circular dependencies in codebases using Tarjan's SCC algorithm
 * Supports: JavaScript/TypeScript, Python, Go
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, dirname, extname, relative, resolve } from "path";

// Input validation schema
export const DependencyAnalyzerInputSchema = z.object({
  action: z.enum(["analyze", "visualize", "find_cycles", "suggest_fixes"]),
  entry_point: z.string().optional(),
  project_path: z.string().optional(),
  include_dev_deps: z.boolean().optional().default(false),
  max_depth: z.number().optional().default(50),
  language: z.enum(["typescript", "javascript", "python", "go", "auto"]).optional().default("auto")
});

export type DependencyAnalyzerInput = z.infer<typeof DependencyAnalyzerInputSchema>;

// Dependency graph structures
interface DependencyNode {
  id: string;
  path: string;
  imports: string[];
  importedBy: string[];
  depth: number;
}

interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: Array<{ from: string; to: string }>;
}

interface Cycle {
  nodes: string[];
  strength: number; // Number of edges in cycle
  risk: "low" | "medium" | "high";
}

// File extensions by language
const EXTENSIONS: Record<string, string[]> = {
  typescript: [".ts", ".tsx", ".mts", ".cts"],
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  python: [".py"],
  go: [".go"]
};

// Directories to skip
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", "dist", "build", "out",
  "coverage", ".cache", ".vscode", ".idea", "target", "__pycache__",
  ".venv", "venv", ".floyd", ".claude", "vendor"
]);

/**
 * Detect language from file extension or project structure
 */
function detectLanguage(projectPath: string): string {
  // Check for language-specific files
  if (existsSync(join(projectPath, "package.json"))) {
    return "typescript"; // Covers both TS and JS
  }
  if (existsSync(join(projectPath, "go.mod"))) {
    return "go";
  }
  if (existsSync(join(projectPath, "requirements.txt")) || 
      existsSync(join(projectPath, "setup.py")) ||
      existsSync(join(projectPath, "pyproject.toml"))) {
    return "python";
  }
  return "typescript"; // Default
}

/**
 * Extract imports from TypeScript/JavaScript file
 */
function extractTSImports(content: string, filePath: string): string[] {
  const imports: string[] = [];
  const lines = content.split("\n");
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // ES6 imports: import ... from "module"
    const importMatch = trimmed.match(/import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s*,?\s*)*\s*from\s*['""]([^'""]+)['""];?/);
    if (importMatch) {
      imports.push(importMatch[1]);
      continue;
    }
    
    // Dynamic imports: import("module")
    const dynamicMatch = trimmed.match(/import\s*\(\s*['""]([^'""]+)['""]s*\)/g);
    if (dynamicMatch) {
      for (const match of dynamicMatch) {
        const moduleMatch = match.match(/['""]([^'""]+)['""]/)
        if (moduleMatch) {
          imports.push(moduleMatch[1]);
        }
      }
      continue;
    }
    
    // CommonJS require: require("module")
    const requireMatch = trimmed.match(/require\s*\(\s*['""]([^'""]+)['""]s*\)/g);
    if (requireMatch) {
      for (const match of requireMatch) {
        const moduleMatch = match.match(/['""]([^'""]+)['""]/)
        if (moduleMatch) {
          imports.push(moduleMatch[1]);
        }
      }
      continue;
    }
    
    // Export from: export ... from "module"
    const exportMatch = trimmed.match(/export\s+(?:\{[^}]*\}|\*)\s+from\s+['""]([^'""]+)['""];?/);
    if (exportMatch) {
      imports.push(exportMatch[1]);
    }
  }
  
  return imports;
}

/**
 * Extract imports from Python file
 */
function extractPythonImports(content: string): string[] {
  const imports: string[] = [];
  const lines = content.split("\n");
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // from module import ...
    const fromMatch = trimmed.match(/^from\s+([^\s]+)\s+import/);
    if (fromMatch) {
      imports.push(fromMatch[1]);
      continue;
    }
    
    // import module
    const importMatch = trimmed.match(/^import\s+([^\s,]+)/);
    if (importMatch) {
      imports.push(importMatch[1]);
    }
  }
  
  return imports;
}

/**
 * Extract imports from Go file
 */
function extractGoImports(content: string): string[] {
  const imports: string[] = [];
  
  // Single import: import "module"
  const singleMatches = content.matchAll(/import\s+['""]([^'""]+)['""];?/g);
  for (const match of singleMatches) {
    imports.push(match[1]);
  }
  
  // Block import: import ( "module1" "module2" )
  const blockMatch = content.match(/import\s*\(([\s\S]*?)\)/);
  if (blockMatch) {
    const blockContent = blockMatch[1];
    const moduleMatches = blockContent.matchAll(/['""]([^'""]+)['""];?/g);
    for (const match of moduleMatches) {
      imports.push(match[1]);
    }
  }
  
  return imports;
}

/**
 * Resolve import path to actual file path
 */
function resolveImportPath(importPath: string, fromFile: string, projectPath: string, language: string): string | null {
  // Skip external packages
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
    return null; // External dependency
  }
  
  const dir = dirname(fromFile);
  let resolvedPath = resolve(dir, importPath);
  
  // Try different extensions
  const extensions = language === "python" ? EXTENSIONS.python :
                     language === "go" ? EXTENSIONS.go :
                     [...EXTENSIONS.typescript, ...EXTENSIONS.javascript];
  
  // Check if exact file exists
  if (existsSync(resolvedPath)) {
    const stat = statSync(resolvedPath);
    if (stat.isFile()) {
      return resolvedPath;
    }
    // It's a directory, look for index file
    for (const ext of extensions) {
      const indexPath = join(resolvedPath, `index${ext}`);
      if (existsSync(indexPath)) {
        return indexPath;
      }
    }
  }
  
  // Try with extensions
  for (const ext of extensions) {
    const withExt = resolvedPath + ext;
    if (existsSync(withExt)) {
      return withExt;
    }
  }
  
  return null;
}

/**
 * Scan project directory and build dependency graph
 */
function buildDependencyGraph(projectPath: string, language: string, maxDepth: number): DependencyGraph {
  const graph: DependencyGraph = {
    nodes: new Map(),
    edges: []
  };
  
  const extensions = language === "python" ? EXTENSIONS.python :
                     language === "go" ? EXTENSIONS.go :
                     [...EXTENSIONS.typescript, ...EXTENSIONS.javascript];
  
  function scanDir(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry.name)) continue;
        
        const fullPath = join(dir, entry.name);
        
        if (entry.isDirectory()) {
          scanDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (!extensions.includes(ext)) continue;
          
          try {
            const content = readFileSync(fullPath, "utf8");
            const relPath = relative(projectPath, fullPath);
            
            // Extract imports based on language
            let imports: string[];
            if (language === "python") {
              imports = extractPythonImports(content);
            } else if (language === "go") {
              imports = extractGoImports(content);
            } else {
              imports = extractTSImports(content, fullPath);
            }
            
            // Create node
            const node: DependencyNode = {
              id: relPath,
              path: fullPath,
              imports: [],
              importedBy: [],
              depth
            };
            
            // Resolve imports to actual files
            for (const imp of imports) {
              const resolved = resolveImportPath(imp, fullPath, projectPath, language);
              if (resolved) {
                const resolvedRel = relative(projectPath, resolved);
                node.imports.push(resolvedRel);
                graph.edges.push({ from: relPath, to: resolvedRel });
              }
            }
            
            graph.nodes.set(relPath, node);
          } catch {
            // Skip unreadable files
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }
  
  scanDir(projectPath, 0);
  
  // Build reverse dependencies
  for (const edge of graph.edges) {
    const toNode = graph.nodes.get(edge.to);
    if (toNode) {
      toNode.importedBy.push(edge.from);
    }
  }
  
  return graph;
}

/**
 * Tarjan's algorithm for finding strongly connected components
 */
function findStronglyConnectedComponents(graph: DependencyGraph): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let currentIndex = 0;
  
  function strongConnect(node: string): void {
    index.set(node, currentIndex);
    lowlink.set(node, currentIndex);
    currentIndex++;
    stack.push(node);
    onStack.add(node);
    
    const nodeData = graph.nodes.get(node);
    if (nodeData) {
      for (const successor of nodeData.imports) {
        if (!index.has(successor)) {
          strongConnect(successor);
          lowlink.set(node, Math.min(lowlink.get(node)!, lowlink.get(successor)!));
        } else if (onStack.has(successor)) {
          lowlink.set(node, Math.min(lowlink.get(node)!, index.get(successor)!));
        }
      }
    }
    
    if (lowlink.get(node) === index.get(node)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== node);
      
      if (scc.length > 1) {
        sccs.push(scc);
      }
    }
  }
  
  for (const node of graph.nodes.keys()) {
    if (!index.has(node)) {
      strongConnect(node);
    }
  }
  
  return sccs;
}

/**
 * Convert SCCs to Cycle objects with risk assessment
 */
function analyzeCycles(sccs: string[][], graph: DependencyGraph): Cycle[] {
  return sccs.map(scc => {
    // Count edges within the cycle
    let edgeCount = 0;
    for (const node of scc) {
      const nodeData = graph.nodes.get(node);
      if (nodeData) {
        for (const imp of nodeData.imports) {
          if (scc.includes(imp)) {
            edgeCount++;
          }
        }
      }
    }
    
    // Assess risk based on cycle size and edge density
    let risk: "low" | "medium" | "high";
    if (scc.length > 5 || edgeCount > scc.length * 1.5) {
      risk = "high";
    } else if (scc.length > 3 || edgeCount > scc.length) {
      risk = "medium";
    } else {
      risk = "low";
    }
    
    return {
      nodes: scc,
      strength: edgeCount,
      risk
    };
  });
}

/**
 * Generate ASCII visualization of dependency graph
 */
function visualizeGraph(graph: DependencyGraph, cycles: Cycle[]): string {
  const lines: string[] = [];
  const cycleNodes = new Set(cycles.flatMap(c => c.nodes));
  
  lines.push("=== Dependency Graph Visualization ===\n");
  
  // Show summary
  lines.push(`Total files: ${graph.nodes.size}`);
  lines.push(`Total dependencies: ${graph.edges.length}`);
  lines.push(`Circular dependencies: ${cycles.length}\n`);
  
  // Show files with most imports
  const sortedByImports = Array.from(graph.nodes.values())
    .sort((a, b) => b.imports.length - a.imports.length)
    .slice(0, 10);
  
  lines.push("Top 10 files by import count:");
  for (const node of sortedByImports) {
    const marker = cycleNodes.has(node.id) ? " [CYCLE]" : "";
    lines.push(`  ${node.id}: ${node.imports.length} imports${marker}`);
  }
  
  lines.push("");
  
  // Show files most imported
  const sortedByImportedBy = Array.from(graph.nodes.values())
    .sort((a, b) => b.importedBy.length - a.importedBy.length)
    .slice(0, 10);
  
  lines.push("Top 10 most imported files:");
  for (const node of sortedByImportedBy) {
    const marker = cycleNodes.has(node.id) ? " [CYCLE]" : "";
    lines.push(`  ${node.id}: imported by ${node.importedBy.length} files${marker}`);
  }
  
  // Show cycles
  if (cycles.length > 0) {
    lines.push("\n=== Circular Dependencies ===\n");
    for (let i = 0; i < cycles.length; i++) {
      const cycle = cycles[i];
      lines.push(`Cycle ${i + 1} (${cycle.risk.toUpperCase()} risk):`);
      lines.push(`  Nodes: ${cycle.nodes.length}, Edges: ${cycle.strength}`);
      lines.push(`  Path: ${cycle.nodes.join(" → ")} → ${cycle.nodes[0]}`);
      lines.push("");
    }
  }
  
  return lines.join("\n");
}

/**
 * Generate fix suggestions for cycles
 */
function suggestFixes(cycles: Cycle[], graph: DependencyGraph): Array<{
  cycle: Cycle;
  suggestions: string[];
}> {
  return cycles.map(cycle => {
    const suggestions: string[] = [];
    
    // Find the "weakest" edge to break (file with fewest imports in cycle)
    let weakestNode = cycle.nodes[0];
    let minImports = Infinity;
    
    for (const node of cycle.nodes) {
      const nodeData = graph.nodes.get(node);
      if (nodeData) {
        const cycleImports = nodeData.imports.filter(i => cycle.nodes.includes(i)).length;
        if (cycleImports < minImports) {
          minImports = cycleImports;
          weakestNode = node;
        }
      }
    }
    
    suggestions.push(`Consider extracting shared code from '${weakestNode}' to break the cycle`);
    
    // If cycle involves index files, suggest reorganization
    if (cycle.nodes.some(n => n.includes("index."))) {
      suggestions.push("Index files are involved - consider restructuring barrel exports");
    }
    
    // If high risk, suggest more aggressive refactoring
    if (cycle.risk === "high") {
      suggestions.push("High-risk cycle: Consider using dependency injection or event-based communication");
      suggestions.push("Consider splitting into separate packages/modules");
    }
    
    // Suggest lazy loading for medium risk
    if (cycle.risk === "medium") {
      suggestions.push("Medium-risk cycle: Consider lazy/dynamic imports to break the cycle");
    }
    
    return {
      cycle,
      suggestions
    };
  });
}

export const dependencyAnalyzerDefinition: Tool = {
  name: "dependency_analyzer",
  description: `Detect and analyze circular dependencies in codebases.

**Actions:**
- \`analyze\`: Full dependency graph analysis with cycle detection
- \`visualize\`: ASCII visualization of dependency graph
- \`find_cycles\`: Find only circular dependencies (faster)
- \`suggest_fixes\`: Get suggestions for breaking circular dependencies

**Supported Languages:**
- TypeScript/JavaScript (ES6 imports, CommonJS require)
- Python (import/from statements)
- Go (import statements)

**Uses Tarjan's SCC Algorithm** for efficient cycle detection.

**Example:**
\`\`\`json
{
  "action": "analyze",
  "project_path": "/path/to/project",
  "language": "typescript",
  "max_depth": 50
}
\`\`\``,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["analyze", "visualize", "find_cycles", "suggest_fixes"],
        description: "Action to perform"
      },
      entry_point: {
        type: "string",
        description: "Optional entry point file for focused analysis"
      },
      project_path: {
        type: "string",
        description: "Root path of the project to analyze"
      },
      include_dev_deps: {
        type: "boolean",
        description: "Include dev dependencies in analysis",
        default: false
      },
      max_depth: {
        type: "number",
        description: "Maximum directory depth to scan",
        default: 50
      },
      language: {
        type: "string",
        enum: ["typescript", "javascript", "python", "go", "auto"],
        description: "Language to analyze (auto-detected if not specified)",
        default: "auto"
      }
    },
    required: ["action"]
  }
};

export async function handleDependencyAnalyzer(args: unknown) {
  try {
    const input = DependencyAnalyzerInputSchema.parse(args);
    const projectPath = input.project_path || process.cwd();
    
    // Detect or use specified language
    const language = input.language === "auto" ? detectLanguage(projectPath) : input.language;
    
    // Build dependency graph
    const graph = buildDependencyGraph(projectPath, language, input.max_depth);
    
    if (graph.nodes.size === 0) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: "No source files found",
            project_path: projectPath,
            language,
            hint: "Check that the project path is correct and contains source files"
          }, null, 2)
        }],
        isError: true
      };
    }
    
    // Find cycles using Tarjan's algorithm
    const sccs = findStronglyConnectedComponents(graph);
    const cycles = analyzeCycles(sccs, graph);
    
    switch (input.action) {
      case "analyze": {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              project_path: projectPath,
              language,
              summary: {
                total_files: graph.nodes.size,
                total_dependencies: graph.edges.length,
                circular_dependencies: cycles.length,
                high_risk_cycles: cycles.filter(c => c.risk === "high").length,
                medium_risk_cycles: cycles.filter(c => c.risk === "medium").length,
                low_risk_cycles: cycles.filter(c => c.risk === "low").length
              },
              cycles: cycles.map(c => ({
                nodes: c.nodes,
                strength: c.strength,
                risk: c.risk
              })),
              top_importers: Array.from(graph.nodes.values())
                .sort((a, b) => b.imports.length - a.imports.length)
                .slice(0, 5)
                .map(n => ({ file: n.id, imports: n.imports.length })),
              most_imported: Array.from(graph.nodes.values())
                .sort((a, b) => b.importedBy.length - a.importedBy.length)
                .slice(0, 5)
                .map(n => ({ file: n.id, imported_by: n.importedBy.length }))
            }, null, 2)
          }]
        };
      }
      
      case "visualize": {
        const graphText = visualizeGraph(graph, cycles);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              project_path: projectPath,
              language,
              cycles_found: cycles.length,
              graph: graphText
            }, null, 2)
          }]
        };
      }
      
      case "find_cycles": {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              project_path: projectPath,
              language,
              cycles_found: cycles.length,
              cycles: cycles.map(c => ({
                path: [...c.nodes, c.nodes[0]].join(" → "),
                size: c.nodes.length,
                risk: c.risk
              }))
            }, null, 2)
          }]
        };
      }
      
      case "suggest_fixes": {
        const fixes = suggestFixes(cycles, graph);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              project_path: projectPath,
              cycles_analyzed: fixes.length,
              recommendations: fixes.map(f => ({
                cycle_path: [...f.cycle.nodes, f.cycle.nodes[0]].join(" → "),
                risk: f.cycle.risk,
                suggestions: f.suggestions
              }))
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
