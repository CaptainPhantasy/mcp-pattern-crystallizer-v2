/**
 * Hooks Storage
 * In-memory storage for registered hooks and execution audit logs
 */

export interface RegisteredHook {
  id: string;
  name: string;
  event: string;
  code: string;
  timeout_ms: number;
  max_memory_mb: number;
  allowed_apis: string[];
  createdAt: string;
  updatedAt: string;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

export interface HookExecutionLog {
  id: string;
  hookId: string;
  hookName: string;
  event: string;
  timestamp: string;
  duration_ms: number;
  success: boolean;
  result?: unknown;
  error?: string;
  context?: Record<string, unknown>;
}

// In-memory storage
const registeredHooks: Map<string, RegisteredHook> = new Map();
const executionLogs: HookExecutionLog[] = [];
const MAX_LOGS = 1000;

/**
 * Register a new hook
 */
export function registerHook(hook: Omit<RegisteredHook, 'id' | 'createdAt' | 'updatedAt'>): RegisteredHook {
  const id = `hook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();
  
  const newHook: RegisteredHook = {
    ...hook,
    id,
    createdAt: now,
    updatedAt: now
  };
  
  registeredHooks.set(id, newHook);
  return newHook;
}

/**
 * Get a hook by ID
 */
export function getHook(id: string): RegisteredHook | undefined {
  return registeredHooks.get(id);
}

/**
 * Get hook by name
 */
export function getHookByName(name: string): RegisteredHook | undefined {
  for (const hook of registeredHooks.values()) {
    if (hook.name === name) {
      return hook;
    }
  }
  return undefined;
}

/**
 * Get all hooks for an event
 */
export function getHooksForEvent(event: string): RegisteredHook[] {
  const hooks: RegisteredHook[] = [];
  for (const hook of registeredHooks.values()) {
    if (hook.event === event && hook.enabled) {
      hooks.push(hook);
    }
  }
  return hooks;
}

/**
 * Update a hook
 */
export function updateHook(id: string, updates: Partial<Omit<RegisteredHook, 'id' | 'createdAt'>>): RegisteredHook | undefined {
  const hook = registeredHooks.get(id);
  if (!hook) {
    return undefined;
  }
  
  const updated: RegisteredHook = {
    ...hook,
    ...updates,
    updatedAt: new Date().toISOString()
  };
  
  registeredHooks.set(id, updated);
  return updated;
}

/**
 * Delete a hook
 */
export function deleteHook(id: string): boolean {
  return registeredHooks.delete(id);
}

/**
 * List all registered hooks
 */
export function listHooks(filter?: { event?: string; enabled?: boolean }): RegisteredHook[] {
  let hooks = Array.from(registeredHooks.values());
  
  if (filter) {
    if (filter.event !== undefined) {
      hooks = hooks.filter(h => h.event === filter.event);
    }
    if (filter.enabled !== undefined) {
      hooks = hooks.filter(h => h.enabled === filter.enabled);
    }
  }
  
  return hooks;
}

/**
 * Log a hook execution
 */
export function logExecution(log: Omit<HookExecutionLog, 'id'>): HookExecutionLog {
  const id = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const newLog: HookExecutionLog = {
    ...log,
    id
  };
  
  executionLogs.push(newLog);
  
  // Keep only last MAX_LOGS entries
  if (executionLogs.length > MAX_LOGS) {
    executionLogs.shift();
  }
  
  return newLog;
}

/**
 * Get execution logs for a hook
 */
export function getExecutionLogs(hookId: string, limit: number = 50): HookExecutionLog[] {
  return executionLogs
    .filter(log => log.hookId === hookId)
    .slice(-limit);
}

/**
 * Get recent execution logs
 */
export function getRecentLogs(limit: number = 50): HookExecutionLog[] {
  return executionLogs.slice(-limit);
}

/**
 * Get audit summary for a hook
 */
export function getHookAuditSummary(hookId: string): {
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  avgDuration: number;
  lastExecution?: HookExecutionLog;
} {
  const logs = executionLogs.filter(log => log.hookId === hookId);
  
  if (logs.length === 0) {
    return {
      totalExecutions: 0,
      successCount: 0,
      failureCount: 0,
      avgDuration: 0
    };
  }
  
  const successCount = logs.filter(l => l.success).length;
  const totalDuration = logs.reduce((sum, l) => sum + l.duration_ms, 0);
  
  return {
    totalExecutions: logs.length,
    successCount,
    failureCount: logs.length - successCount,
    avgDuration: totalDuration / logs.length,
    lastExecution: logs[logs.length - 1]
  };
}

/**
 * Clear all hooks and logs
 */
export function clearHooks(): void {
  registeredHooks.clear();
  executionLogs.length = 0;
}

/**
 * Export all data for persistence
 */
export function exportHooksData(): {
  hooks: RegisteredHook[];
  logs: HookExecutionLog[];
} {
  return {
    hooks: Array.from(registeredHooks.values()),
    logs: [...executionLogs]
  };
}

/**
 * Import data for restoration
 */
export function importHooksData(data: {
  hooks?: RegisteredHook[];
  logs?: HookExecutionLog[];
}): void {
  if (data.hooks) {
    for (const hook of data.hooks) {
      registeredHooks.set(hook.id, hook);
    }
  }
  if (data.logs) {
    executionLogs.push(...data.logs);
    // Trim to MAX_LOGS
    while (executionLogs.length > MAX_LOGS) {
      executionLogs.shift();
    }
  }
}
