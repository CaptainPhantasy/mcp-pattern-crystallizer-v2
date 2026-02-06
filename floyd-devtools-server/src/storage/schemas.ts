/**
 * Schema Storage
 * In-memory storage for schema versions and migrations
 */

export interface SchemaVersion {
  id: string;
  name: string;
  version: string;
  schema: Record<string, unknown>;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface Migration {
  id: string;
  fromVersion: string;
  toVersion: string;
  schemaName: string;
  transforms: MigrationTransform[];
  createdAt: string;
  appliedAt?: string;
  status: 'pending' | 'applied' | 'failed' | 'rolled_back';
}

export interface MigrationTransform {
  type: 'add_field' | 'remove_field' | 'rename_field' | 'transform_value' | 'change_type';
  path: string;
  oldValue?: unknown;
  newValue?: unknown;
  transformer?: string;
}

// In-memory storage
const schemaVersions: Map<string, SchemaVersion[]> = new Map();
const migrations: Map<string, Migration[]> = new Map();

/**
 * Store a schema version
 */
export function storeSchemaVersion(name: string, version: string, schema: Record<string, unknown>, metadata?: Record<string, unknown>): SchemaVersion {
  const id = `schema_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const schemaVersion: SchemaVersion = {
    id,
    name,
    version,
    schema,
    createdAt: new Date().toISOString(),
    metadata
  };
  
  const versions = schemaVersions.get(name) || [];
  versions.push(schemaVersion);
  schemaVersions.set(name, versions);
  
  return schemaVersion;
}

/**
 * Get all versions of a schema
 */
export function getSchemaVersions(name: string): SchemaVersion[] {
  return schemaVersions.get(name) || [];
}

/**
 * Get a specific schema version
 */
export function getSchemaVersion(name: string, version: string): SchemaVersion | undefined {
  const versions = schemaVersions.get(name) || [];
  return versions.find(v => v.version === version);
}

/**
 * Get the latest schema version
 */
export function getLatestSchemaVersion(name: string): SchemaVersion | undefined {
  const versions = schemaVersions.get(name) || [];
  return versions[versions.length - 1];
}

/**
 * Store a migration
 */
export function storeMigration(migration: Omit<Migration, 'id' | 'createdAt' | 'status'>): Migration {
  const id = `migration_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const newMigration: Migration = {
    ...migration,
    id,
    createdAt: new Date().toISOString(),
    status: 'pending'
  };
  
  const schemaMigrations = migrations.get(migration.schemaName) || [];
  schemaMigrations.push(newMigration);
  migrations.set(migration.schemaName, schemaMigrations);
  
  return newMigration;
}

/**
 * Get migrations for a schema
 */
export function getMigrations(schemaName: string): Migration[] {
  return migrations.get(schemaName) || [];
}

/**
 * Get migration by ID
 */
export function getMigration(id: string): Migration | undefined {
  for (const schemaMigrations of migrations.values()) {
    const migration = schemaMigrations.find(m => m.id === id);
    if (migration) {
      return migration;
    }
  }
  return undefined;
}

/**
 * Update migration status
 */
export function updateMigrationStatus(id: string, status: Migration['status'], appliedAt?: string): Migration | undefined {
  for (const schemaMigrations of migrations.values()) {
    const migration = schemaMigrations.find(m => m.id === id);
    if (migration) {
      migration.status = status;
      if (appliedAt) {
        migration.appliedAt = appliedAt;
      }
      return migration;
    }
  }
  return undefined;
}

/**
 * Get pending migrations for a schema
 */
export function getPendingMigrations(schemaName: string): Migration[] {
  const schemaMigrations = migrations.get(schemaName) || [];
  return schemaMigrations.filter(m => m.status === 'pending');
}

/**
 * Get migration path between two versions
 */
export function getMigrationPath(schemaName: string, fromVersion: string, toVersion: string): Migration[] {
  const schemaMigrations = migrations.get(schemaName) || [];
  const path: Migration[] = [];
  
  let currentVersion = fromVersion;
  while (currentVersion !== toVersion) {
    const nextMigration = schemaMigrations.find(
      m => m.fromVersion === currentVersion && m.status !== 'failed'
    );
    
    if (!nextMigration) {
      break; // No path found
    }
    
    path.push(nextMigration);
    currentVersion = nextMigration.toVersion;
    
    // Prevent infinite loops
    if (path.length > 100) {
      break;
    }
  }
  
  return path;
}

/**
 * Diff two schemas
 */
export function diffSchemas(oldSchema: Record<string, unknown>, newSchema: Record<string, unknown>): MigrationTransform[] {
  const transforms: MigrationTransform[] = [];
  
  function getType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }
  
  function diffObject(oldObj: Record<string, unknown>, newObj: Record<string, unknown>, path: string = ''): void {
    const oldKeys = new Set(Object.keys(oldObj));
    const newKeys = new Set(Object.keys(newObj));
    
    // Check for removed fields
    for (const key of oldKeys) {
      const fieldPath = path ? `${path}.${key}` : key;
      if (!newKeys.has(key)) {
        transforms.push({
          type: 'remove_field',
          path: fieldPath,
          oldValue: oldObj[key]
        });
      }
    }
    
    // Check for added fields
    for (const key of newKeys) {
      const fieldPath = path ? `${path}.${key}` : key;
      if (!oldKeys.has(key)) {
        transforms.push({
          type: 'add_field',
          path: fieldPath,
          newValue: newObj[key]
        });
      }
    }
    
    // Check for changed fields
    for (const key of oldKeys) {
      if (newKeys.has(key)) {
        const fieldPath = path ? `${path}.${key}` : key;
        const oldValue = oldObj[key];
        const newValue = newObj[key];
        
        const oldType = getType(oldValue);
        const newType = getType(newValue);
        
        if (oldType !== newType) {
          transforms.push({
            type: 'change_type',
            path: fieldPath,
            oldValue,
            newValue
          });
        } else if (oldType === 'object' && newType === 'object') {
          diffObject(
            oldValue as Record<string, unknown>,
            newValue as Record<string, unknown>,
            fieldPath
          );
        } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
          transforms.push({
            type: 'transform_value',
            path: fieldPath,
            oldValue,
            newValue
          });
        }
      }
    }
  }
  
  diffObject(oldSchema, newSchema);
  return transforms;
}

/**
 * Get all schema names
 */
export function getAllSchemaNames(): string[] {
  return Array.from(schemaVersions.keys());
}

/**
 * Clear all schema data
 */
export function clearSchemas(): void {
  schemaVersions.clear();
  migrations.clear();
}

/**
 * Export all data for persistence
 */
export function exportSchemaData(): {
  versions: Record<string, SchemaVersion[]>;
  migrations: Record<string, Migration[]>;
} {
  return {
    versions: Object.fromEntries(schemaVersions),
    migrations: Object.fromEntries(migrations)
  };
}

/**
 * Import data for restoration
 */
export function importSchemaData(data: {
  versions?: Record<string, SchemaVersion[]>;
  migrations?: Record<string, Migration[]>;
}): void {
  if (data.versions) {
    for (const [name, versions] of Object.entries(data.versions)) {
      schemaVersions.set(name, versions);
    }
  }
  if (data.migrations) {
    for (const [name, migs] of Object.entries(data.migrations)) {
      migrations.set(name, migs);
    }
  }
}
