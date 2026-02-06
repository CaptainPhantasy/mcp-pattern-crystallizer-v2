/**
 * FLOYD Terminal Sessions MCP Server
 *
 * Provides persistent terminal session and process management:
 * - start_process: Start long-running processes with interactive I/O
 * - interact_with_process: Send input and get response from running processes
 * - read_process_output: Read output without sending input
 * - force_terminate: Force terminate a process/session
 * - list_sessions: List all active terminal sessions
 * - list_processes: List system processes with CPU/memory info
 * - kill_process: Kill process by PID
 * - execute_code: Execute code in memory without saving
 * - create_directory: Create directory (mkdir -p)
 * - get_file_info: Get detailed file metadata
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
import { spawn, execSync } from 'child_process';
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  statSync,
} from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Terminal sessions directory
const SESSIONS_DIR = join(homedir(), '.floyd', 'terminal-sessions');
const HISTORY_DIR = join(SESSIONS_DIR, 'history');

// Ensure directories exist
for (const dir of [SESSIONS_DIR, HISTORY_DIR]) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

interface Session {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  startTime: number;
  process?: any;
  historyPath: string;
  status: 'running' | 'terminated';
}

// Active sessions (in-memory)
const activeSessions = new Map<string, Session>();

// Load saved sessions on startup
function loadSavedSessions(): void {
  if (!existsSync(SESSIONS_DIR)) return;

  const files = readdirSync(SESSIONS_DIR);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    try {
      const data = JSON.parse(readFileSync(join(SESSIONS_DIR, file), 'utf8'));
      if (data.status === 'terminated') {
        // Clean up terminated sessions
        unlinkSync(join(SESSIONS_DIR, file));
      } else {
        // Session was interrupted - mark as terminated
        data.status = 'terminated';
        writeFileSync(join(SESSIONS_DIR, file), JSON.stringify(data, null, 2), 'utf8');
      }
    } catch (e) {
      // Invalid session file, remove it
      unlinkSync(join(SESSIONS_DIR, file));
    }
  }
}

loadSavedSessions();

export async function createTerminalServer(): Promise<Server> {
  const server = new Server(
    { name: 'floyd-terminal-server', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  const RESOURCE_NAMESPACE = 'floyd-terminal-server';
  const TOOL_DEFINITIONS = [
        {
          name: 'start_process',
          description: 'Start a long-running process (SSH session, database server, dev server) with persistent I/O history',
          inputSchema: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'Command to execute (e.g., "ssh", "python", "node", "mysql")',
              },
              args: {
                type: 'array',
                items: { type: 'string' },
                description: 'Command arguments',
              },
              cwd: {
                type: 'string',
                description: 'Working directory (default: current directory)',
              },
              env: {
                type: 'object',
                description: 'Environment variables for the process',
              },
              sessionName: {
                type: 'string',
                description: 'Optional name for the session (default: auto-generated)',
              },
              detached: {
                type: 'boolean',
                description: 'Run in detached mode (process continues after Claude Code exits)',
                default: false,
              },
            },
            required: ['command'],
          },
        },
        {
          name: 'interact_with_process',
          description: 'Send input to a running process/session and get the response',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'Session ID to interact with',
              },
              input: {
                type: 'string',
                description: 'Input to send to the process',
              },
              timeout: {
                type: 'number',
                description: 'Wait timeout in milliseconds for response (default: 5000)',
                default: 5000,
              },
            },
            required: ['sessionId', 'input'],
          },
        },
        {
          name: 'read_process_output',
          description: 'Read output from a running process without sending input',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'Session ID to read from',
              },
              lines: {
                type: 'number',
                description: 'Number of lines to read (default: all available)',
              },
            },
            required: ['sessionId'],
          },
        },
        {
          name: 'force_terminate',
          description: 'Force terminate a running process/session',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'Session ID to terminate',
              },
              kill: {
                type: 'boolean',
                description: 'Force kill (SIGKILL) instead of graceful shutdown (SIGTERM)',
                default: false,
              },
            },
            required: ['sessionId'],
          },
        },
        {
          name: 'list_sessions',
          description: 'List all active terminal sessions with their status',
          inputSchema: {
            type: 'object',
            properties: {
              includeTerminated: {
                type: 'boolean',
                description: 'Include recently terminated sessions',
                default: false,
              },
            },
          },
        },
        {
          name: 'list_processes',
          description: 'List all running system processes with CPU and memory information',
          inputSchema: {
            type: 'object',
            properties: {
              filter: {
                type: 'string',
                description: 'Filter by process name or PID',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of processes to return (default: 100)',
                default: 100,
              },
            },
          },
        },
        {
          name: 'kill_process',
          description: 'Terminate a running process by PID',
          inputSchema: {
            type: 'object',
            properties: {
              pid: {
                type: 'number',
                description: 'Process ID to terminate',
              },
              signal: {
                type: 'string',
                enum: ['SIGTERM', 'SIGKILL', 'SIGHUP', 'SIGINT'],
                description: 'Signal to send (default: SIGTERM)',
                default: 'SIGTERM',
              },
            },
            required: ['pid'],
          },
        },
        {
          name: 'execute_code',
          description: 'Execute code in memory (Python, Node.js, Bash) without saving to a file',
          inputSchema: {
            type: 'object',
            properties: {
              language: {
                type: 'string',
                enum: ['python', 'javascript', 'node', 'bash', 'sh'],
                description: 'Programming language to execute',
              },
              code: {
                type: 'string',
                description: 'Code to execute',
              },
              timeout: {
                type: 'number',
                description: 'Execution timeout in seconds (default: 30)',
                default: 30,
              },
            },
            required: ['language', 'code'],
          },
        },
        {
          name: 'create_directory',
          description: 'Create a directory or ensure it exists (equivalent to mkdir -p)',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Directory path to create (absolute or relative to cwd)',
              },
              cwd: {
                type: 'string',
                description: 'Working directory for relative paths',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'get_file_info',
          description: 'Get detailed metadata about a file or directory',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'File or directory path',
              },
              cwd: {
                type: 'string',
                description: 'Working directory for relative paths',
              },
            },
            required: ['path'],
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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));

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
        case 'start_process': {
          const {
            command,
            args: processArgs = [],
            cwd: procCwd = process.cwd(),
            env = {},
            sessionName,
            detached = false,
          } = args as any;

          const sessionId = sessionName || uuidv4();
          const historyPath = join(HISTORY_DIR, `${sessionId}.log`);
          const startTime = Date.now();

          // Spawn the process
          const proc = spawn(command, processArgs, {
            cwd: procCwd,
            env: { ...process.env, ...env },
            detached,
            stdio: ['pipe', 'pipe', 'pipe'],
          });

          // Create session record
          const session: Session = {
            id: sessionId,
            command,
            args: processArgs,
            cwd: procCwd,
            startTime,
            process: proc,
            historyPath,
            status: 'running',
          };
          activeSessions.set(sessionId, session);

          // Store session info
          writeFileSync(
            join(SESSIONS_DIR, `${sessionId}.json`),
            JSON.stringify(
              {
                id: sessionId,
                command,
                args: processArgs,
                cwd: procCwd,
                startTime,
                pid: proc.pid,
                status: 'running',
                historyPath,
              },
              null,
              2
            ),
            'utf8'
          );

          // Set up output handling
          const logStream = {
            write: (chunk: string) => {
              try {
                writeFileSync(historyPath, chunk, { flag: 'a' });
              } catch {
                // Ignore write errors
              }
            },
          };

          proc.stdout?.on('data', (data: Buffer) => logStream.write(data.toString()));
          proc.stderr?.on('data', (data: Buffer) => logStream.write(data.toString()));

          proc.on('close', (code: number) => {
            session.status = 'terminated';
            try {
              const sessionFile = join(SESSIONS_DIR, `${sessionId}.json`);
              if (existsSync(sessionFile)) {
                const data = JSON.parse(readFileSync(sessionFile, 'utf8'));
                data.status = 'terminated';
                data.exitCode = code;
                writeFileSync(sessionFile, JSON.stringify(data, null, 2), 'utf8');
              }
            } catch {
              // Ignore errors
            }
          });

          if (detached) {
            proc.unref();
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    sessionId,
                    pid: proc.pid,
                    command: `${command} ${processArgs.join(' ')}`,
                    cwd: procCwd,
                    startTime: new Date(startTime).toISOString(),
                    historyPath,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'interact_with_process': {
          const { sessionId, input: processInput, timeout = 5000 } = args as any;

          const session = activeSessions.get(sessionId);
          if (!session || session.status !== 'running') {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      error: 'Session not found or not running',
                      sessionId,
                      availableSessions: Array.from(activeSessions.keys()),
                    },
                    null,
                    2
                  ),
                },
              ],
              isError: false,
            };
          }

          if (!session.process || !session.process.stdin) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      error: 'Process stdin not available',
                      sessionId,
                      status: session.status,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          // Get last known position in history before sending input
          let historySizeBefore = 0;
          if (existsSync(session.historyPath)) {
            const stats = statSync(session.historyPath);
            historySizeBefore = stats.size;
          }

          // Send input
          session.process.stdin.write(processInput + '\n');

          // Wait for output with timeout using a proper buffer accumulation strategy
          const output = await new Promise<string>((resolve) => {
            const deadline = Date.now() + timeout;
            let buffer = '';
            let lastDataTime = Date.now();
            let settled = false;

            const onData = (data: Buffer) => {
              buffer += data.toString();
              lastDataTime = Date.now();
            };

            session.process.stdout?.on('data', onData);

            const checkInterval = setInterval(() => {
              const now = Date.now();
              const timeSinceLastData = now - lastDataTime;

              // Resolve if:
              // 1. We have output AND it's been 100ms since last data (output settled)
              // 2. OR we hit the deadline
              if (buffer.length > 0 && timeSinceLastData > 100) {
                if (!settled) {
                  settled = true;
                  // Wait a bit more to ensure output is complete
                  return;
                }
              }

              if (settled || now >= deadline) {
                clearInterval(checkInterval);
                session.process.stdout?.removeListener('data', onData);
                resolve(buffer || 'No output (process may be waiting for more input)');
              }
            }, 50);

            // Fallback timeout to ensure we don't hang forever
            setTimeout(() => {
              clearInterval(checkInterval);
              session.process.stdout?.removeListener('data', onData);
              resolve(buffer || 'No output (timeout)');
            }, timeout + 100);
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    sessionId,
                    input: processInput,
                    output,
                    timestamp: new Date().toISOString(),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'read_process_output': {
          const { sessionId, lines } = args as any;

          const session = activeSessions.get(sessionId);
          if (!session) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ error: 'Session not found', sessionId }, null, 2),
                },
              ],
            };
          }

          let output = '';
          if (existsSync(session.historyPath)) {
            output = readFileSync(session.historyPath, 'utf8');
          }

          if (lines && lines > 0) {
            const outputLines = output.split('\n');
            output = outputLines.slice(-lines).join('\n');
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    sessionId,
                    output,
                    lines: output.split('\n').length,
                    lastRead: new Date().toISOString(),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'force_terminate': {
          const { sessionId, kill = false } = args as any;

          const session = activeSessions.get(sessionId);
          if (!session) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ error: 'Session not found', sessionId }, null, 2),
                },
              ],
            };
          }

          let result: any = { killed: false, method: '' };

          if (session.process) {
            try {
              if (kill) {
                session.process.kill('SIGKILL');
                result = { killed: true, method: 'SIGKILL' };
              } else {
                session.process.kill('SIGTERM');
                result = { killed: true, method: 'SIGTERM' };
              }
            } catch (e: any) {
              result = { killed: false, error: e.message };
            }
          }

          session.status = 'terminated';
          activeSessions.delete(sessionId);

          // Update session file
          const sessionFile = join(SESSIONS_DIR, `${sessionId}.json`);
          if (existsSync(sessionFile)) {
            const data = JSON.parse(readFileSync(sessionFile, 'utf8'));
            data.status = 'terminated';
            data.terminatedAt = new Date().toISOString();
            data.termination = result;
            writeFileSync(sessionFile, JSON.stringify(data, null, 2), 'utf8');
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    sessionId,
                    success: result.killed,
                    ...result,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'list_sessions': {
          const { includeTerminated = false } = args as any;

          const sessions: any[] = [];

          // Active sessions
          for (const [id, session] of activeSessions.entries()) {
            sessions.push({
              id,
              command: session.command,
              args: session.args,
              cwd: session.cwd,
              startTime: session.startTime,
              status: session.status,
              pid: session.process?.pid,
            });
          }

          // Terminated sessions from files
          if (includeTerminated) {
            const files = readdirSync(SESSIONS_DIR);
            for (const file of files) {
              if (!file.endsWith('.json')) continue;

              const id = file.replace('.json', '');
              if (activeSessions.has(id)) continue;

              try {
                const data = JSON.parse(readFileSync(join(SESSIONS_DIR, file), 'utf8'));
                if (data.status === 'terminated') {
                  sessions.push({
                    id,
                    command: data.command,
                    args: data.args,
                    cwd: data.cwd,
                    startTime: data.startTime,
                    status: 'terminated',
                  });
                }
              } catch {
                // Skip invalid files
              }
            }
          }

          // Sort by start time (newest first)
          sessions.sort((a, b) => b.startTime - a.startTime);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    total: sessions.length,
                    active: sessions.filter((s) => s.status === 'running').length,
                    sessions: sessions.map((s) => ({
                      ...s,
                      startTime: new Date(s.startTime).toISOString(),
                      duration: Date.now() - s.startTime,
                    })),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'list_processes': {
          const { filter, limit = 100 } = args as any;

          let cmd = '';
          if (process.platform === 'darwin') {
            cmd = 'ps -ax -o pid,comm,%cpu,%mem,time';
          } else if (process.platform === 'linux') {
            cmd = 'ps aux --sort=-%cpu | head -n 100';
          } else {
            cmd = 'tasklist'; // Windows
          }

          try {
            const output = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
            let lines = output.split('\n').slice(1); // Skip header

            const processes: any[] = [];

            for (const line of lines) {
              if (!line.trim()) continue;
              if (processes.length >= limit) break;

              const parts = line.trim().split(/\s+/);
              if (parts.length < 4) continue;

              const pid = parseInt(parts[0], 10);
              const comm = parts[1];
              const cpu = parseFloat(parts[2]);
              const mem = parseFloat(parts[3]);
              const time = parts[4];

              // Apply filter
              if (filter) {
                if (
                  !filter.toLowerCase().includes(comm.toLowerCase()) &&
                  !filter.includes(pid.toString())
                ) {
                  continue;
                }
              }

              processes.push({ pid, comm, cpu, mem, time });
            }

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      total: processes.length,
                      processes,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } catch (error: any) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      error: error.message,
                      platform: process.platform,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }
        }

        case 'kill_process': {
          const { pid, signal = 'SIGTERM' } = args as any;

          try {
            process.kill(pid, signal);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      pid,
                      signal,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } catch (error: any) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: false,
                      pid,
                      signal,
                      error: error.message,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }
        }

        case 'execute_code': {
          const { language, code, timeout: timeoutSec = 30 } = args as any;

          const result: any = { language, output: '', error: '', success: false };
          const timeoutMs = timeoutSec * 1000;

          try {
            let command: string;
            let args: string[];
            let inputCode: string = code;

            switch (language) {
              case 'python': {
                command = 'python3';
                args = ['-c', inputCode];
                break;
              }
              case 'javascript':
              case 'node': {
                command = 'node';
                args = ['-e', inputCode];
                break;
              }
              case 'bash':
              case 'sh': {
                command = '/bin/sh';
                args = ['-c', inputCode];
                break;
              }
              default:
                throw new Error(`Unknown language: ${language}`);
            }

            // Use spawn with separate args to avoid shell injection
            const proc = spawn(command, args, {
              stdio: ['pipe', 'pipe', 'pipe'],
              timeout: timeoutMs,
            });

            let stdout = '';
            let stderr = '';

            proc.stdout?.on('data', (data: Buffer) => {
              stdout += data.toString();
            });

            proc.stderr?.on('data', (data: Buffer) => {
              stderr += data.toString();
            });

            // Wait for process completion
            await new Promise<void>((resolve, reject) => {
              proc.on('error', reject);
              proc.on('close', (code: number) => {
                result.exitCode = code;
                resolve();
              });
            });

            result.output = stdout;
            result.error = stderr;
            result.success = proc.exitCode === 0;
          } catch (error: any) {
            result.success = false;
            result.error = error.stderr || error.stdout || error.message || String(error);
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case 'create_directory': {
          const { path: dirPath, cwd: procCwd = process.cwd() } = args as any;

          let fullPath = dirPath.startsWith('~')
            ? dirPath.replace('~', homedir())
            : dirPath;
          if (!fullPath.startsWith('/')) {
            fullPath = join(procCwd, dirPath);
          }

          try {
            mkdirSync(fullPath, { recursive: true });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      path: fullPath,
                      created: true,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } catch (error: any) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: false,
                      path: fullPath,
                      error: error.message,
                    },
                    null,
                    2
                  ),
                },
              ],
              isError: true,
            };
          }
        }

        case 'get_file_info': {
          const { path: filePath, cwd: procCwd = process.cwd() } = args as any;

          let fullPath = filePath.startsWith('~')
            ? filePath.replace('~', homedir())
            : filePath;
          if (!fullPath.startsWith('/')) {
            fullPath = join(procCwd, filePath);
          }

          if (!existsSync(fullPath)) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      error: 'Path does not exist',
                      path: fullPath,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          try {
            const stats = statSync(fullPath);
            const info = {
              path: fullPath,
              type: stats.isDirectory() ? 'directory' : 'file',
              size: stats.size,
              created: stats.birthtime,
              modified: stats.mtime,
              accessed: stats.atime,
              permissions: stats.mode.toString(8),
              isFile: stats.isFile(),
              isDirectory: stats.isDirectory(),
              readable: Boolean(stats.mode & parseInt('400', 8)),
              writable: Boolean(stats.mode & parseInt('200', 8)),
            };

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(info, null, 2),
                },
              ],
            };
          } catch (error: any) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      error: error.message,
                      path: fullPath,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { error: (error as Error).message, tool: name },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

export async function startTerminalServer(): Promise<void> {
  const server = await createTerminalServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('FLOYD Terminal Sessions MCP Server started');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startTerminalServer().catch(console.error);
}
