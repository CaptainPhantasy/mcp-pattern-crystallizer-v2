# SuperTool #2: Context Singularity

**Power Level:** ⚡⚡⚡⚡⚡⚡ (Semantic Understanding)  
**Status:** Fully Specified  
**Problem Solved:** Codebase paralysis (can't understand large projects)  
**Universal Need Score:** 9/10 (used hourly)

---

## Problem Statement

**Current Reality:**
You join a new codebase. 500 files. 100,000 lines of code. Who calls this function? Where's authentication handled? What depends on this module?

Traditional tools:
- `grep` - finds text, not meaning
- `find` - finds files, not relationships
- IDE "Find References" - syntax only, no semantics

**You need:** "Show me everything related to authentication"  
**You get:** 10,000 grep results with no context.

**The Context Singularity solves this by:**
1. Building semantic knowledge graph of entire codebase
2. Understanding relationships between files/functions/concepts
3. Natural language queries return meaningful results
4. Auto-updates as code changes

---

## Architecture Overview

### Core Insight
Code isn't text. It's a graph of concepts, dependencies, and relationships. Understanding code = understanding the graph.

### Three-Layer Architecture

```
┌────────────────────────────────────────────────────────┐
│ Layer 3: Query Interface (Natural Language)           │
│ ↓ "What handles authentication?"                      │
├────────────────────────────────────────────────────────┤
│ Layer 2: Knowledge Graph (Concepts + Relationships)   │
│ ↓ Nodes: Files, Functions, Classes, Modules          │
│ ↓ Edges: Calls, Imports, Implements, Depends         │
├────────────────────────────────────────────────────────┤
│ Layer 1: AST Analysis (Parse + Extract)               │
│ ↓ TypeScript/Python/Rust/etc → AST → Concepts        │
└────────────────────────────────────────────────────────┘
```

---

## Layer 1: AST Analysis & Extraction

### Goal
Parse source code into semantic concepts and relationships.

### Process

**Step 1: File Discovery**
```typescript
// Find all source files
const files = await glob({
  pattern: '**/*.{ts,tsx,js,jsx,py,rs,go}',
  path: projectRoot,
  ignore: ['node_modules', 'dist', '__pycache__']
});
```

**Step 2: Parse to AST**
```typescript
import * as ts from 'typescript';
import * as acorn from 'acorn';

async function parseFile(filePath: string): Promise<AST> {
  const content = await readFile(filePath);
  const ext = path.extname(filePath);
  
  if (ext === '.ts' || ext === '.tsx') {
    return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest);
  } else if (ext === '.js' || ext === '.jsx') {
    return acorn.parse(content, {ecmaVersion: 2022});
  }
  // Add Python, Rust, etc. parsers
}
```

**Step 3: Extract Concepts**
```typescript
interface CodeConcept {
  id: string;              // Unique identifier
  type: 'file' | 'function' | 'class' | 'variable' | 'import';
  name: string;            // Human-readable name
  filePath: string;        // Where it's defined
  lineStart: number;       // Start line
  lineEnd: number;         // End line
  signature?: string;      // For functions/methods
  visibility?: 'public' | 'private' | 'protected';
  metadata: {
    description?: string;  // From comments/docstrings
    tags?: string[];       // Inferred semantic tags
  };
}

function extractConcepts(ast: AST, filePath: string): CodeConcept[] {
  const concepts: CodeConcept[] = [];
  
  // Walk AST
  ts.forEachChild(ast, node => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      concepts.push({
        id: `${filePath}:fn:${node.name.text}`,
        type: 'function',
        name: node.name.text,
        filePath,
        lineStart: ast.getLineAndCharacterOfPosition(node.pos).line,
        lineEnd: ast.getLineAndCharacterOfPosition(node.end).line,
        signature: node.parameters.map(p => p.name.getText()).join(', '),
        metadata: {
          description: extractJSDoc(node),
          tags: inferTags(node)
        }
      });
    }
    
    if (ts.isClassDeclaration(node) && node.name) {
      concepts.push({
        id: `${filePath}:class:${node.name.text}`,
        type: 'class',
        name: node.name.text,
        filePath,
        lineStart: ast.getLineAndCharacterOfPosition(node.pos).line,
        lineEnd: ast.getLineAndCharacterOfPosition(node.end).line,
        metadata: {
          description: extractJSDoc(node),
          tags: inferTags(node)
        }
      });
    }
    
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier.getText().replace(/['"]/g, '');
      concepts.push({
        id: `${filePath}:import:${moduleSpecifier}`,
        type: 'import',
        name: moduleSpecifier,
        filePath,
        lineStart: ast.getLineAndCharacterOfPosition(node.pos).line,
        lineEnd: ast.getLineAndCharacterOfPosition(node.end).line,
        metadata: {
          tags: ['dependency']
        }
      });
    }
  });
  
  return concepts;
}
```

**Step 4: Extract Relationships**
```typescript
interface Relationship {
  from: string;        // Source concept ID
  to: string;          // Target concept ID
  type: 'calls' | 'imports' | 'extends' | 'implements' | 'depends_on';
  metadata?: {
    count?: number;    // How many times (for calls)
    critical?: boolean;
  };
}

function extractRelationships(ast: AST, concepts: CodeConcept[]): Relationship[] {
  const relationships: Relationship[] = [];
  
  ts.forEachChild(ast, node => {
    if (ts.isCallExpression(node)) {
      const callerConcept = findContainingFunction(node, concepts);
      const calleeName = node.expression.getText();
      const calleeConcept = concepts.find(c => c.name === calleeName);
      
      if (callerConcept && calleeConcept) {
        relationships.push({
          from: callerConcept.id,
          to: calleeConcept.id,
          type: 'calls'
        });
      }
    }
    
    if (ts.isImportDeclaration(node)) {
      const importingFile = concepts.find(c => c.type === 'file' && c.filePath === node.getSourceFile().fileName);
      const moduleSpecifier = node.moduleSpecifier.getText().replace(/['"]/g, '');
      const importedConcept = concepts.find(c => c.name === moduleSpecifier);
      
      if (importingFile && importedConcept) {
        relationships.push({
          from: importingFile.id,
          to: importedConcept.id,
          type: 'imports'
        });
      }
    }
  });
  
  return relationships;
}
```

---

## Layer 2: Knowledge Graph Construction

### Goal
Store concepts and relationships in queryable graph structure using Concept Web Weaver.

### Implementation

```typescript
class CodebaseKnowledgeGraph {
  
  async buildGraph(projectRoot: string): Promise<void> {
    console.log('Building knowledge graph...');
    
    // 1. Discover all source files
    const files = await this.discoverFiles(projectRoot);
    console.log(`Found ${files.length} source files`);
    
    // 2. Parse each file and extract concepts
    const allConcepts: CodeConcept[] = [];
    const allRelationships: Relationship[] = [];
    
    for (const file of files) {
      const ast = await parseFile(file);
      const concepts = extractConcepts(ast, file);
      const relationships = extractRelationships(ast, concepts);
      
      allConcepts.push(...concepts);
      allRelationships.push(...relationships);
    }
    
    console.log(`Extracted ${allConcepts.length} concepts`);
    console.log(`Extracted ${allRelationships.length} relationships`);
    
    // 3. Register all concepts in concept web
    for (const concept of allConcepts) {
      await mcp_novel_concepts_concept_web_weaver({
        action: 'register',
        concept: concept.id,
        metadata: {
          type: concept.type,
          name: concept.name,
          filePath: concept.filePath,
          lineStart: concept.lineStart,
          lineEnd: concept.lineEnd,
          ...concept.metadata
        }
      });
    }
    
    // 4. Add relationships
    for (const rel of allRelationships) {
      await mcp_novel_concepts_concept_web_weaver({
        action: 'register',
        concept: rel.from,
        relationships: [{
          type: rel.type as any,
          target: rel.to
        }]
      });
    }
    
    console.log('Knowledge graph built successfully');
  }
  
  private async discoverFiles(projectRoot: string): Promise<string[]> {
    const result = await glob({
      pattern: '**/*.{ts,tsx,js,jsx,py,rs,go}',
      path: projectRoot
    });
    
    return result.matches || [];
  }
}
```

---

## Layer 3: Natural Language Query Interface

### Goal
Allow developers to ask questions in plain English and get semantic answers.

### Query Types

**1. "What" Queries - Concept Discovery**
```
"What handles authentication?"
"What components use the database?"
"What files import React?"
```

**2. "Where" Queries - Location**
```
"Where is the user model defined?"
"Where do we validate JWT tokens?"
```

**3. "Who" Queries - Dependency/Usage**
```
"Who calls the sendEmail function?"
"Who depends on the auth module?"
```

**4. "How" Queries - Flow Analysis**
```
"How does login work?"
"How is data fetched from the API?"
```

### Query Pipeline

```typescript
async function query(question: string): Promise<QueryResult> {
  // 1. Parse question to extract intent and keywords
  const intent = parseIntent(question);
  const keywords = extractKeywords(question);
  
  // 2. Route to appropriate query type
  if (intent === 'what') {
    return await queryWhat(keywords);
  } else if (intent === 'where') {
    return await queryWhere(keywords);
  } else if (intent === 'who') {
    return await queryWho(keywords);
  } else if (intent === 'how') {
    return await queryHow(keywords);
  }
  
  return {error: 'Unknown query intent'};
}

async function queryWhat(keywords: string[]): Promise<QueryResult> {
  // Search for concepts matching keywords
  const matches = await mcp_novel_concepts_concept_web_weaver({
    action: 'query',
    query_type: 'neighbors',
    concept: keywords[0]
  });
  
  // Rank by relevance (tag matching, name similarity)
  const ranked = rankByRelevance(matches, keywords);
  
  return {
    answer: `Found ${ranked.length} concepts related to ${keywords.join(' ')}`,
    concepts: ranked.slice(0, 10),
    visualization: generateGraphVisualization(ranked)
  };
}

async function queryWho(keywords: string[]): Promise<QueryResult> {
  // Find concept being asked about
  const targetConcept = await findConceptByName(keywords[0]);
  
  if (!targetConcept) {
    return {error: `Concept '${keywords[0]}' not found`};
  }
  
  // Query dependents
  const dependents = await mcp_novel_concepts_concept_web_weaver({
    action: 'query',
    query_type: 'dependents',
    concept: targetConcept.id
  });
  
  return {
    answer: `${dependents.length} concepts depend on ${targetConcept.name}`,
    concepts: dependents,
    visualization: generateDependencyTree(targetConcept, dependents)
  };
}

async function queryHow(keywords: string[]): Promise<QueryResult> {
  // Find start and end concepts
  const startConcept = await findConceptByName(keywords[0]);
  const endConcept = keywords.length > 1 ? await findConceptByName(keywords[1]) : null;
  
  if (!startConcept) {
    return {error: `Start concept '${keywords[0]}' not found`};
  }
  
  // Traverse execution path
  const path = await mcp_novel_concepts_concept_web_weaver({
    action: 'traverse',
    concept: startConcept.id,
    target_concept: endConcept?.id
  });
  
  return {
    answer: `Execution flow from ${startConcept.name}`,
    path: path.path,
    visualization: generateFlowDiagram(path)
  };
}
```

### Example Queries

**Query 1: "What handles authentication?"**
```typescript
const result = await query("What handles authentication?");

// Response:
{
  answer: "Found 5 concepts related to authentication",
  concepts: [
    {
      id: "src/auth/jwt.ts:fn:validateToken",
      name: "validateToken",
      type: "function",
      filePath: "src/auth/jwt.ts",
      line: 42,
      tags: ["authentication", "security"]
    },
    {
      id: "src/auth/middleware.ts:fn:authMiddleware",
      name: "authMiddleware",
      type: "function",
      filePath: "src/auth/middleware.ts",
      line: 15,
      tags: ["authentication", "middleware"]
    },
    // ... 3 more
  ],
  visualization: "graph TD; validateToken -->|calls| verifyJWT; authMiddleware -->|uses| validateToken"
}
```

**Query 2: "Who calls sendEmail?"**
```typescript
const result = await query("Who calls sendEmail?");

// Response:
{
  answer: "3 functions call sendEmail",
  concepts: [
    {name: "registerUser", filePath: "src/users/register.ts", line: 67},
    {name: "resetPassword", filePath: "src/auth/password.ts", line: 23},
    {name: "sendNotification", filePath: "src/notify/email.ts", line: 102}
  ],
  visualization: "graph LR; registerUser -->|calls| sendEmail; resetPassword -->|calls| sendEmail"
}
```

---

## Auto-Update System

### Goal
Keep knowledge graph in sync with code changes without manual rebuilds.

### File Watcher Integration

```typescript
import chokidar from 'chokidar';

class AutoUpdater {
  private watcher: chokidar.FSWatcher;
  private graph: CodebaseKnowledgeGraph;
  
  constructor(projectRoot: string) {
    this.graph = new CodebaseKnowledgeGraph();
    this.watcher = chokidar.watch(`${projectRoot}/**/*.{ts,tsx,js,jsx}`, {
      ignored: /(node_modules|dist|__pycache__)/,
      persistent: true
    });
    
    this.setupWatchers();
  }
  
  private setupWatchers(): void {
    this.watcher
      .on('add', path => this.handleFileAdded(path))
      .on('change', path => this.handleFileChanged(path))
      .on('unlink', path => this.handleFileDeleted(path));
  }
  
  private async handleFileAdded(filePath: string): Promise<void> {
    console.log(`File added: ${filePath}`);
    
    // Parse new file
    const ast = await parseFile(filePath);
    const concepts = extractConcepts(ast, filePath);
    const relationships = extractRelationships(ast, concepts);
    
    // Add to graph
    for (const concept of concepts) {
      await mcp_novel_concepts_concept_web_weaver({
        action: 'register',
        concept: concept.id,
        metadata: concept.metadata
      });
    }
    
    for (const rel of relationships) {
      await mcp_novel_concepts_concept_web_weaver({
        action: 'register',
        concept: rel.from,
        relationships: [{type: rel.type as any, target: rel.to}]
      });
    }
  }
  
  private async handleFileChanged(filePath: string): Promise<void> {
    console.log(`File changed: ${filePath}`);
    
    // Remove old concepts for this file
    await this.removeConceptsForFile(filePath);
    
    // Re-parse and add new concepts
    await this.handleFileAdded(filePath);
  }
  
  private async handleFileDeleted(filePath: string): Promise<void> {
    console.log(`File deleted: ${filePath}`);
    
    // Remove all concepts for this file
    await this.removeConceptsForFile(filePath);
  }
  
  private async removeConceptsForFile(filePath: string): Promise<void> {
    // Query all concepts for this file
    const concepts = await mcp_novel_concepts_concept_web_weaver({
      action: 'query',
      query_type: 'neighbors',
      concept: filePath
    });
    
    // Delete each one
    for (const concept of concepts.neighbors || []) {
      // Note: Current concept_web_weaver doesn't support delete
      // Would need to extend MCP server to support this
      console.log(`Would delete concept: ${concept}`);
    }
  }
}
```

---

## Semantic Tagging System

### Goal
Auto-generate meaningful tags for concepts based on code analysis.

### Tag Inference

```typescript
function inferTags(node: ts.Node): string[] {
  const tags: string[] = [];
  const text = node.getText().toLowerCase();
  
  // Security-related
  if (text.includes('auth') || text.includes('login') || text.includes('password')) {
    tags.push('authentication');
  }
  if (text.includes('encrypt') || text.includes('decrypt') || text.includes('hash')) {
    tags.push('security');
  }
  
  // Data access
  if (text.includes('query') || text.includes('select') || text.includes('db')) {
    tags.push('database');
  }
  if (text.includes('api') || text.includes('fetch') || text.includes('http')) {
    tags.push('api');
  }
  
  // UI/Frontend
  if (text.includes('component') || text.includes('render') || text.includes('usestate')) {
    tags.push('frontend');
  }
  
  // Business logic
  if (text.includes('validate') || text.includes('verify') || text.includes('check')) {
    tags.push('validation');
  }
  if (text.includes('calculate') || text.includes('compute')) {
    tags.push('computation');
  }
  
  // Error handling
  if (text.includes('error') || text.includes('exception') || text.includes('throw')) {
    tags.push('error-handling');
  }
  
  return tags;
}
```

---

## Visualization Layer

### Goal
Generate visual representations of code relationships.

### Graph Visualization Formats

**1. Mermaid (for documentation)**
```typescript
function generateMermaidGraph(concepts: CodeConcept[], relationships: Relationship[]): string {
  let mermaid = 'graph TD;\n';
  
  for (const rel of relationships) {
    const fromConcept = concepts.find(c => c.id === rel.from);
    const toConcept = concepts.find(c => c.id === rel.to);
    
    if (fromConcept && toConcept) {
      mermaid += `${fromConcept.name} -->|${rel.type}| ${toConcept.name};\n`;
    }
  }
  
  return mermaid;
}
```

**2. D3 Force Graph (for interactive UI)**
```typescript
function generateD3Graph(concepts: CodeConcept[], relationships: Relationship[]) {
  return {
    nodes: concepts.map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      group: c.metadata.tags?.[0] || 'other'
    })),
    links: relationships.map(r => ({
      source: r.from,
      target: r.to,
      type: r.type
    }))
  };
}
```

---

## Usage Examples

### Example 1: Initial Graph Build

```typescript
const graph = new CodebaseKnowledgeGraph();
await graph.buildGraph('/path/to/project');

// Output:
// Found 247 source files
// Extracted 1,834 concepts
// Extracted 5,621 relationships
// Knowledge graph built successfully
```

### Example 2: Query Interface

```typescript
const result = await query("What files handle user registration?");

console.log(result.answer);
// "Found 3 files related to user registration"

console.log(result.concepts);
// [
//   {name: "registerUser", filePath: "src/users/register.ts", line: 15},
//   {name: "validateRegistration", filePath: "src/users/validate.ts", line: 42},
//   {name: "createUserAccount", filePath: "src/db/users.ts", line: 67}
// ]
```

### Example 3: Dependency Analysis

```typescript
const result = await query("Who depends on the database module?");

console.log(result.answer);
// "12 modules depend on the database module"

console.log(result.concepts.slice(0, 5));
// [
//   {name: "userModel", filePath: "src/models/user.ts"},
//   {name: "postModel", filePath: "src/models/post.ts"},
//   {name: "authService", filePath: "src/services/auth.ts"},
//   {name: "queryBuilder", filePath: "src/utils/query.ts"},
//   {name: "migrationRunner", filePath: "src/db/migrations.ts"}
// ]
```

### Example 4: Auto-Update

```typescript
const updater = new AutoUpdater('/path/to/project');

// Make code changes...
// Auto-updater detects and processes:
// File added: src/services/payment.ts
// File changed: src/models/user.ts
// File deleted: src/legacy/old-auth.ts
```

---

## Benefits

### 1. Instant Codebase Understanding
New developers understand project structure in minutes, not weeks.

### 2. Natural Language Interface
No need to learn complex query syntax. Ask questions like you would a teammate.

### 3. Always Up-to-Date
File watcher keeps graph in sync automatically.

### 4. Impact Analysis
Know exactly what breaks when you change a module.

### 5. Documentation Generator
Auto-generate architecture diagrams from live code.

---

## Limitations

### 1. Language Support
Currently focused on TypeScript/JavaScript. Python/Rust support needs additional parsers.

### 2. Dynamic Code Analysis
Static AST analysis can't see runtime behavior (reflection, dynamic imports).

### 3. Graph Size
Very large codebases (1M+ LoC) may need graph database (Neo4j) instead of Concept Web.

### 4. Query Ambiguity
Natural language queries sometimes ambiguous ("What does this do?" - what is "this"?).

---

## Future Enhancements

### 1. Runtime Behavior Tracking
Integrate with execution trace to capture actual runtime calls.

### 2. Historical Analysis
Track how code evolved over time (git blame integration).

### 3. Multi-Language Support
Add parsers for Python, Rust, Go, Java, C++.

### 4. AI-Powered Summaries
Generate natural language explanations of complex code flows.

### 5. Refactoring Suggestions
Detect code smells and suggest improvements based on graph structure.

---

## Validation Results

**Consensus Protocol:**
- Optimistic: "Game-changer for large codebases" ✅
- Pessimistic: "AST parsing brittle, language support limited" ⚠️
- Pragmatic: "High value, feasible with existing tools" ✅
- Security: "Read-only analysis, safe" ✅
- Performance: "Initial build slow, queries fast" ⚠️

**Overall Consensus:** 78% agreement, APPROVED with caveats

**Complexity Estimate:** 8/10 (requires AST parsing, graph management, NLP)

**Risk Level:** MEDIUM (complex implementation, language-specific parsers)

---

## Storage

- **Vault Key:** `supertool:context_singularity:v1`
- **Concept Web:** Registered as `context_singularity`
- **Episode ID:** `ep_context_singularity_design_2026`

---

**Created:** 2026-02-02  
**Status:** Fully Specified  
**Next Step:** Implement AST parsers + Concept Web integration
