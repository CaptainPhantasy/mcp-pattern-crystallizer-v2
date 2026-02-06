/**
 * FLOYD Safe Operations MCP Server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative, extname, basename } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SAFE_OPS_DIR = join(homedir(), '.floyd', 'safe-ops');
const BACKUP_DIR = join(SAFE_OPS_DIR, 'backups');

if (!existsSync(BACKUP_DIR)) {
  mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * Extract the module/export name from a file path
 * e.g., /src/utils/helpers.ts -> utils/helpers or helpers
 */
function extractModuleName(filePath: string): string {
  const base = basename(filePath, extname(filePath));
  const dir = dirname(filePath);

  // Convert path to module-like name
  if (dir.includes('src')) {
    const relativeToSrc = relative(join(dir, '..', '..'), dir)
      .replace(/\\/g, '/')
      .replace(/^src\//, '');
    return relativeToSrc ? `${relativeToSrc}/${base}` : base;
  }

  // For lib/components/etc., use the directory structure
  const parts = dir.split(/[/\\]/).filter(Boolean);
  if (parts.length > 0) {
    const lastDir = parts[parts.length - 1];
    if (lastDir !== 'src' && lastDir !== 'lib' && lastDir !== 'components') {
      return `${lastDir}/${base}`;
    }
  }

  return base;
}

/**
 * Find all files that import a given module
 * Scans source files for import/require statements matching the module
 */
function findImportingFiles(modulePath: string, resolvedProjectPath: string): string[] {
  const moduleName = extractModuleName(modulePath);
  const importingFiles: string[] = [];

  // File extensions to scan
  const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs'];

  // Directories to skip during scan
  const skipDirs = new Set([
    'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
    'coverage', '.cache', '.vscode', '.idea', 'target', '__pycache__',
    '.venv', 'venv', '.floyd', '.claude'
  ]);

  function scanDir(dir: string, depth: number = 0): void {
    if (depth > 10) return; // Limit recursion depth

    try {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (skipDirs.has(entry.name)) continue;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          scanDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = extname(entry.name);

          if (sourceExtensions.includes(ext)) {
            try {
              const content = readFileSync(fullPath, 'utf8');
              const hasImport = checkForImport(content, moduleName, fullPath);

              if (hasImport) {
                // Store relative path from project root
                const relPath = relative(resolvedProjectPath, fullPath);
                importingFiles.push(relPath);
              }
            } catch {
              // Skip unreadable files
            }
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  scanDir(resolvedProjectPath);
  return importingFiles;
}

/**
 * Check if a file imports a given module
 */
function checkForImport(content: string, moduleName: string, filePath: string): boolean {
  const lowerContent = content.toLowerCase();
  const lowerModule = moduleName.toLowerCase();

  // Language-specific patterns
  const ext = extname(filePath).toLowerCase();

  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    // TypeScript/JavaScript patterns
    const patterns = [
      // ES6 imports
      `from ['"]${lowerModule}`,
      `from ['"].*${lowerModule}`,
      `import ['"]${lowerModule}`,
      // Require statements
      `require(['"]${lowerModule}`,
      `require(['"].*${lowerModule}`,
      // Dynamic imports
      `import(['"]${lowerModule}`,
    ];

    for (const pattern of patterns) {
      const regex = new RegExp(pattern.replace(/\*\.\*/g, '[^"\']*'), 'i');
      if (regex.test(content)) return true;
    }

    // Also check for relative imports that might match
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.startsWith('import ') ||
        trimmed.startsWith('const ') && trimmed.includes('= require') ||
        trimmed.startsWith('export ')
      ) {
        // Extract the module path from the import
        const importMatch = trimmed.match(/from ['"]([^'"]+)['"]/);
        if (importMatch && importMatch[1].includes(moduleName)) {
          return true;
        }

        const requireMatch = trimmed.match(/require\(['"]([^'"]+)['"]\)/);
        if (requireMatch && requireMatch[1].includes(moduleName)) {
          return true;
        }
      }
    }
  } else if (ext === '.py') {
    // Python patterns
    const patterns = [
      `from ${lowerModule}`,
      `import ${lowerModule}`,
    ];

    for (const pattern of patterns) {
      if (lowerContent.includes(pattern)) return true;
    }

    // Check for relative imports
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('from ') || trimmed.startsWith('import ')) {
        if (trimmed.toLowerCase().includes(lowerModule)) {
          return true;
        }
      }
    }
  } else if (ext === '.go') {
    // Go patterns
    if (lowerContent.includes(`"${lowerModule}"`) || lowerContent.includes(`'${lowerModule}'`)) {
      return true;
    }
  } else if (ext === '.rs') {
    // Rust patterns
    if (lowerContent.includes(`mod ${lowerModule}`) || lowerContent.includes(`use ${lowerModule}`)) {
      return true;
    }
  }

  return false;
}

/**
 * Find test files related to a given source file
 */
function findTestFiles(sourcePath: string, resolvedProjectPath: string): string[] {
  const baseName = basename(sourcePath, extname(sourcePath));
  const dirName = dirname(sourcePath);
  const testFiles: string[] = [];

  // Common test file patterns
  const testPatterns = [
    // Exact match with test suffix
    `${baseName}.test`,
    `${baseName}.spec`,
    `${baseName}_test`,
    `${baseName}_spec`,
    // Test prefix/suffix
    `test_${baseName}`,
    `spec_${baseName}`,
  ];

  // Test directories to check
  const testDirs = [
    join(dirName, '__tests__'),
    join(dirName, '__test__'),
    join(dirName, 'tests'),
    join(dirName, 'test'),
    join(resolvedProjectPath, '__tests__'),
    join(resolvedProjectPath, 'tests'),
    join(resolvedProjectPath, 'test'),
    join(resolvedProjectPath, 'spec'),
    join(resolvedProjectPath, 'specs'),
  ];

  // Test file extensions
  const testExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'];

  function scanDir(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          // Check if this is a test directory
          const isTestDir = ['__tests__', '__test__', 'tests', 'test', 'spec', 'specs']
            .some(t => fullPath.endsWith(t) || fullPath.includes(`/${t}/`));

          if (isTestDir) {
            scanDir(fullPath);
          }
        } else if (entry.isFile()) {
          const entryBase = basename(entry.name, extname(entry.name));
          const entryExt = extname(entry.name);

          // Check if filename matches test patterns
          const isTestFile = testPatterns.some(pattern =>
            entryBase.includes(pattern) || entryBase === pattern
          ) || entryBase.toLowerCase().startsWith('test') ||
             entryBase.toLowerCase().startsWith('spec') ||
             entryBase.toLowerCase().endsWith('.test') ||
             entryBase.toLowerCase().endsWith('.spec');

          if (isTestFile && testExtensions.includes(entryExt)) {
            const relPath = relative(resolvedProjectPath, fullPath);
            testFiles.push(relPath);
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  // Scan source directory and test directories
  try {
    scanDir(resolvedProjectPath);
  } catch {
    // If scan fails, try direct pattern matching in known locations
  }

  return [...new Set(testFiles)]; // Remove duplicates
}

/**
 * Get git status for a file
 */
function getGitStatus(filePath: string, resolvedProjectPath: string): {
  inRepo: boolean;
  status?: string;
  branch?: string;
} {
  try {
    // Check if in a git repo
    execSync('git rev-parse --git-dir', {
      cwd: resolvedProjectPath,
      stdio: 'pipe'
    });

    // Get current branch
    let branch = 'main';
    try {
      branch = execSync('git branch --show-current', {
        cwd: resolvedProjectPath,
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim() || 'main';
    } catch {
      branch = 'main';
    }

    // Get file status
    const relPath = relative(resolvedProjectPath, filePath);
    let status = 'unmodified';

    try {
      const statusOutput = execSync(`git status --porcelain "${relPath}"`, {
        cwd: resolvedProjectPath,
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();

      if (statusOutput) {
        const statusCode = statusOutput.charAt(0);
        switch (statusCode) {
          case 'M': status = 'modified'; break;
          case 'A': status = 'added'; break;
          case 'D': status = 'deleted'; break;
          case 'R': status = 'renamed'; break;
          case 'C': status = 'copied'; break;
          case '??': status = 'untracked'; break;
          default: status = 'modified';
        }
      }

      // Check for staged changes
      try {
        const diffOutput = execSync(`git diff --cached --name-only "${relPath}"`, {
          cwd: resolvedProjectPath,
          encoding: 'utf8',
          stdio: 'pipe',
        }).trim();

        if (diffOutput) {
          status = status === 'unmodified' ? 'staged' : `${status} (staged)`;
        }
      } catch {
        // No staged changes
      }
    } catch {
      // File might not exist yet or is untracked
      status = 'unknown';
    }

    return { inRepo: true, status, branch };
  } catch {
    return { inRepo: false };
  }
}

export async function createSafeOpsServer(): Promise<Server> {
  const server = new Server(
    { name: 'floyd-safe-ops-server', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  const RESOURCE_NAMESPACE = 'floyd-safe-ops-server';
  const TOOL_DEFINITIONS = [
    {
      name: 'safe_refactor',
      description: 'Refactor code with automatic rollback on failure',
      inputSchema: {
        type: 'object',
        properties: {
          operations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['edit', 'create', 'delete', 'move'] },
                path: { type: 'string' },
                content: { type: 'string' },
                search: { type: 'string' },
                replace: { type: 'string' },
              },
              required: ['type', 'path'],
            },
            minItems: 1,
          },
          verifyCommand: { type: 'string' },
          verifyTimeout: { type: 'number', default: 60 },
          gitCommit: { type: 'boolean', default: false },
          commitMessage: { type: 'string' },
        },
        required: ['operations'],
      },
    },
    {
      name: 'impact_simulate',
      description: 'Simulate the impact of changes before applying',
      inputSchema: {
        type: 'object',
        properties: {
          operations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                path: { type: 'string' },
              },
              required: ['type', 'path'],
            },
            minItems: 1,
          },
          resolvedProjectPath: { type: 'string', default: process.cwd() },
          checkImports: { type: 'boolean', default: true },
          checkTests: { type: 'boolean', default: true },
          checkGit: { type: 'boolean', default: true },
        },
        required: ['operations'],
      },
    },
    {
      name: 'verify',
      description: 'Explicit verification tool to confirm changes work',
      inputSchema: {
        type: 'object',
        properties: {
          strategy: {
            type: 'string',
            enum: ['command', 'file_exists', 'content_check', 'import_test', 'custom'],
          },
          command: { type: 'string' },
          file: { type: 'string' },
          expectedContent: { type: 'string' },
          timeout: { type: 'number', default: 30 },
          workingDirectory: { type: 'string' },
        },
        required: ['strategy'],
      },
    },
  ];

  function buildToolRegistry() {
    return TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  function findToolByName(name: string) {
    return TOOL_DEFINITIONS.find((tool) => tool.name === name);
  }

  function parseToolSchemaUri(uri: string): string | null {
    const match = uri.match(/\/tool\/([^/]+)\/schema$/);
    return match ? match[1] : null;
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOL_DEFINITIONS };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: `mcp://${RESOURCE_NAMESPACE}/tool-registry.json`,
          name: 'tool-registry',
          description: 'Tool definitions and input schemas',
          mimeType: 'application/json',
        },
        {
          uri: `mcp://${RESOURCE_NAMESPACE}/health.json`,
          name: 'health',
          description: 'Server health and tool count',
          mimeType: 'application/json',
        },
      ],
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: [
        {
          name: 'tool-schema',
          uriTemplate: `mcp://${RESOURCE_NAMESPACE}/tool/{name}/schema`,
          description: 'Tool input schema and description',
          mimeType: 'application/json',
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === `mcp://${RESOURCE_NAMESPACE}/tool-registry.json`) {
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({ tools: buildToolRegistry() }, null, 2),
          },
        ],
      };
    }

    if (uri === `mcp://${RESOURCE_NAMESPACE}/health.json`) {
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              name: RESOURCE_NAMESPACE,
              version: '1.0.0',
              toolCount: TOOL_DEFINITIONS.length,
              updatedAt: new Date().toISOString(),
            }, null, 2),
          },
        ],
      };
    }

    const toolName = parseToolSchemaUri(uri);
    if (toolName) {
      const tool = findToolByName(toolName);
      if (!tool) {
        throw new Error(`Unknown tool in schema request: ${toolName}`);
      }

      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            }, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'safe_refactor': {
          const { operations, verifyCommand, verifyTimeout = 60, gitCommit = false, commitMessage } = args as any;

          const opId = uuidv4();
          const startTime = new Date().toISOString();
          const opFile = join(BACKUP_DIR, `${opId}.json`);
          const backups: any[] = [];

          // Create backups
          for (const op of operations) {
            const opPath = op.path.startsWith('~') ? op.path.replace('~', homedir()) : op.path;

            if ((op.type === 'edit' || op.type === 'delete') && existsSync(opPath)) {
              backups.push({ path: opPath, content: readFileSync(opPath, 'utf8') });
            }
          }

          // Save operation state
          writeFileSync(opFile, JSON.stringify({ id: opId, operations, backups, startTime }, null, 2), 'utf8');

          try {
            // Apply changes
            for (const op of operations) {
              const opPath = op.path.startsWith('~') ? op.path.replace('~', homedir()) : op.path;

              switch (op.type) {
                case 'edit': {
                  let newContent = op.content;
                  if (op.search && op.replace) {
                    const backup = backups.find((b: any) => b.path === opPath);
                    if (backup) {
                      newContent = backup.content.replace(new RegExp(op.search, 'g'), op.replace);
                    }
                  }
                  if (newContent !== undefined) {
                    const dir = dirname(opPath);
                    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
                    writeFileSync(opPath, newContent, 'utf8');
                  }
                  break;
                }
                case 'create': {
                  const dir = dirname(opPath);
                  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
                  writeFileSync(opPath, op.content || '', 'utf8');
                  break;
                }
                case 'delete':
                  if (existsSync(opPath)) unlinkSync(opPath);
                  break;
                case 'move':
                  if (existsSync(op.oldPath!)) {
                    const dir = dirname(opPath);
                    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
                    const { renameSync, copyFileSync } = require('fs');
                    try {
                      renameSync(op.oldPath!, opPath);
                    } catch {
                      copyFileSync(op.oldPath!, opPath);
                      unlinkSync(op.oldPath!);
                    }
                  }
                  break;
              }
            }

            // Verify
            let verified = true;
            let verificationOutput = '';

            if (verifyCommand) {
              try {
                verificationOutput = execSync(verifyCommand, {
                  encoding: 'utf8',
                  timeout: verifyTimeout * 1000,
                  stdio: 'pipe',
                });
              } catch (error: any) {
                verified = false;
                verificationOutput = error.stdout || error.stderr || error.message;
                throw new Error(`Verification failed: ${verificationOutput}`);
              }
            }

            // Git commit
            if (gitCommit && verified) {
              try {
                execSync('git add -A', { stdio: 'pipe' });
                const msg = commitMessage || `chore: refactor ${opId.slice(0, 8)}`;
                execSync(`git commit -m "${msg}"`, { stdio: 'pipe' });
              } catch {}
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  opId,
                  operationsCompleted: operations.length,
                  verified,
                  verificationOutput: verificationOutput ? verificationOutput.slice(0, 500) : undefined,
                }, null, 2),
              }],
            };

          } catch (error) {
            // Rollback
            for (const backup of backups.reverse()) {
              writeFileSync(backup.path, backup.content, 'utf8');
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  opId,
                  rolledBack: true,
                  error: (error as Error).message,
                }, null, 2),
              }],
            };
          }
        }

        case 'impact_simulate': {
          const { operations, projectPath, checkImports = true, checkTests = true, checkGit = true } = args as any;
          const resolvedProjectPath = projectPath || process.cwd();

          const impact: any = {
            affectedFiles: [],
            newFiles: [],
            deletedFiles: [],
            modifiedFiles: [],
            risks: [],
            dependencies: [],
            reverseDependencies: [], // Files that import the affected files
            testFilesAffected: [],
            gitStatus: null,
            branch: null,
            summary: { high: 0, medium: 0, low: 0 },
          };

          // Check if we're in a git repo
          let inGitRepo = false;
          let currentBranch = null;
          if (checkGit) {
            try {
              currentBranch = execSync('git branch --show-current', {
                cwd: resolvedProjectPath,
                encoding: 'utf8',
                stdio: 'pipe',
                timeout: 2000,
              }).trim() || null;
              inGitRepo = true;
              impact.branch = currentBranch;
            } catch {
              // Not in git repo
              inGitRepo = false;
            }
          }

          // Process each operation
          for (const op of operations) {
            const opPath = op.path.startsWith('~') ? op.path.replace('~', homedir()) : op.path;

            // Resolve absolute path if relative
            let absolutePath = opPath;
            if (!opPath.startsWith('/')) {
              absolutePath = join(resolvedProjectPath, opPath);
            }

            impact.affectedFiles.push(absolutePath);

            switch (op.type) {
              case 'create':
                impact.newFiles.push(absolutePath);
                impact.risks.push(`New file: ${absolutePath}`);
                impact.summary.low++;
                break;

              case 'delete':
                impact.deletedFiles.push(absolutePath);
                impact.risks.push(`Deleting: ${absolutePath}`);
                impact.summary.high++;
                break;

              case 'edit':
              case 'move':
              default:
                impact.modifiedFiles.push(absolutePath);
                impact.summary.low++;
                break;
            }
          }

          // Check imports - find files that depend on modified files
          if (checkImports) {
            const filesToCheck = [...impact.modifiedFiles, ...impact.deletedFiles];
            const allImporters = new Set<string>();

            for (const filePath of filesToCheck) {
              if (existsSync(filePath)) {
                const importers = findImportingFiles(filePath, resolvedProjectPath);
                for (const importer of importers) {
                  allImporters.add(importer);
                }
              }
            }

            impact.reverseDependencies = Array.from(allImporters);

            if (impact.reverseDependencies.length > 0) {
              impact.risks.push(`${impact.reverseDependencies.length} file(s) import modified module(s)`);
              if (impact.reverseDependencies.length > 5) {
                impact.summary.medium++;
              }
            }
          }

          // Check tests - find test files for affected modules
          if (checkTests) {
            const allTestFiles = new Set<string>();

            for (const filePath of [...impact.modifiedFiles, ...impact.deletedFiles, ...impact.newFiles]) {
              const tests = findTestFiles(filePath, resolvedProjectPath);
              for (const test of tests) {
                allTestFiles.add(test);
              }
            }

            impact.testFilesAffected = Array.from(allTestFiles);

            if (impact.testFilesAffected.length > 0) {
              impact.risks.push(`${impact.testFilesAffected.length} test file(s) may be affected`);
            }
          }

          // Check git status
          if (checkGit && inGitRepo) {
            const gitStatuses: Record<string, { status: string; staged?: boolean }> = {};

            for (const filePath of impact.affectedFiles) {
              try {
                const relPath = relative(resolvedProjectPath, filePath);
                const status = getGitStatus(filePath, resolvedProjectPath);

                if (status.inRepo) {
                  gitStatuses[relPath] = {
                    status: status.status || 'unknown',
                  };
                }
              } catch {
                // Skip files we can't check
              }
            }

            impact.gitStatus = Object.keys(gitStatuses).length > 0 ? gitStatuses : null;
          }

          // Calculate overall risk level
          const totalRisks = impact.risks.length;
          const hasDeletion = impact.deletedFiles.length > 0;
          const hasHighImpactDeps = impact.reverseDependencies.length > 10;

          let overallRisk = 'low';
          if (hasDeletion || hasHighImpactDeps || totalRisks > 5) {
            overallRisk = 'high';
          } else if (totalRisks > 2 || impact.reverseDependencies.length > 3) {
            overallRisk = 'medium';
          }

          impact.overallRisk = overallRisk;

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(impact, null, 2),
            }],
          };
        }

        case 'verify': {
          const { strategy, command, file, expectedContent, timeout = 30, workingDirectory } = args as any;

          const result: any = { strategy, passed: false, message: '', details: {} };

          switch (strategy) {
            case 'command': {
              try {
                const output = execSync(command, {
                  cwd: workingDirectory || process.cwd(),
                  encoding: 'utf8',
                  timeout: timeout * 1000,
                  stdio: 'pipe',
                });
                result.passed = true;
                result.message = 'Command executed successfully';
                result.details = { output: output.slice(0, 1000) };
              } catch (error: any) {
                result.passed = false;
                result.message = 'Command failed';
                result.details = {
                  exitCode: error.status || error.exitCode,
                  output: error.stdout?.slice(0, 1000) || error.stderr?.slice(0, 1000),
                };
              }
              break;
            }

            case 'file_exists': {
              const filePath = file?.startsWith('~') ? file.replace('~', homedir()) : join(workingDirectory || process.cwd(), file);
              result.passed = existsSync(filePath);
              result.message = result.passed ? 'File exists' : 'File does not exist';
              result.details = { path: filePath };
              break;
            }

            case 'content_check': {
              const filePath = file?.startsWith('~') ? file.replace('~', homedir()) : join(workingDirectory || process.cwd(), file);
              if (!existsSync(filePath)) {
                result.passed = false;
                result.message = 'File does not exist';
              } else {
                const content = readFileSync(filePath, 'utf8');
                result.passed = expectedContent ? content.includes(expectedContent) : true;
                result.message = result.passed ? 'Content check passed' : 'Expected content not found';
              }
              break;
            }

            default:
              throw new Error(`Unknown strategy: ${strategy}`);
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2),
            }],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: (error as Error).message, tool: name }, null, 2),
        }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startSafeOpsServer(): Promise<void> {
  const server = await createSafeOpsServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('FLOYD Safe Operations MCP Server started');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startSafeOpsServer().catch(console.error);
}
