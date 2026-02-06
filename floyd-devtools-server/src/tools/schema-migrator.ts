/**
 * schema_migrator tool
 * Handle configuration and state schema migrations
 * Supports: JSON, YAML-like structures, versioned migrations
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  storeSchemaVersion,
  getSchemaVersion,
  getLatestSchemaVersion,
  storeMigration,
  getMigrations,
  getMigrationPath,
  updateMigrationStatus,
  diffSchemas,
  type MigrationTransform,
  type Migration
} from "../storage/schemas.js";

// Input validation schema
export const SchemaMigratorInputSchema = z.object({
  action: z.enum(["generate_migration", "validate_schema", "apply_migration", "rollback", "diff_versions", "list_migrations"]),
  schema_name: z.string().optional(),
  old_schema: z.record(z.unknown()).optional(),
  new_schema: z.record(z.unknown()).optional(),
  data: z.record(z.unknown()).optional(),
  from_version: z.string().optional(),
  to_version: z.string().optional(),
  migration_id: z.string().optional(),
  migration_strategy: z.enum(["strict", "lenient", "transform"]).optional().default("lenient")
});

export type SchemaMigratorInput = z.infer<typeof SchemaMigratorInputSchema>;

/**
 * Generate a semantic version from timestamp
 */
function generateVersion(): string {
  const now = new Date();
  return `${now.getFullYear()}.${(now.getMonth() + 1).toString().padStart(2, '0')}.${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;
}

/**
 * Apply a single transform to data
 */
function applyTransform(data: Record<string, unknown>, transform: MigrationTransform, strategy: string): {
  success: boolean;
  data: Record<string, unknown>;
  error?: string;
} {
  const path = transform.path.split(".");
  
  // Navigate to parent
  let current: Record<string, unknown> = data;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (typeof current[key] !== "object" || current[key] === null) {
      if (strategy === "strict") {
        return { success: false, data, error: `Path '${transform.path}' not found in data` };
      }
      // Lenient: create path
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  
  const finalKey = path[path.length - 1];
  
  switch (transform.type) {
    case "add_field":
      if (current[finalKey] !== undefined && strategy === "strict") {
        return { success: false, data, error: `Field '${transform.path}' already exists` };
      }
      current[finalKey] = transform.newValue;
      break;
      
    case "remove_field":
      if (current[finalKey] === undefined && strategy === "strict") {
        return { success: false, data, error: `Field '${transform.path}' does not exist` };
      }
      delete current[finalKey];
      break;
      
    case "rename_field":
      if (current[finalKey] === undefined && strategy === "strict") {
        return { success: false, data, error: `Field '${transform.path}' does not exist` };
      }
      if (transform.newValue && typeof transform.newValue === "string") {
        const value = current[finalKey];
        delete current[finalKey];
        current[transform.newValue] = value;
      }
      break;
      
    case "transform_value":
      if (current[finalKey] === undefined && strategy === "strict") {
        return { success: false, data, error: `Field '${transform.path}' does not exist` };
      }
      current[finalKey] = transform.newValue;
      break;
      
    case "change_type":
      if (current[finalKey] === undefined && strategy === "strict") {
        return { success: false, data, error: `Field '${transform.path}' does not exist` };
      }
      // Attempt type coercion
      try {
        const oldValue = current[finalKey];
        const newType = typeof transform.newValue;
        
        if (newType === "string") {
          current[finalKey] = String(oldValue);
        } else if (newType === "number") {
          current[finalKey] = Number(oldValue);
        } else if (newType === "boolean") {
          current[finalKey] = Boolean(oldValue);
        } else if (Array.isArray(transform.newValue)) {
          current[finalKey] = Array.isArray(oldValue) ? oldValue : [oldValue];
        } else {
          current[finalKey] = transform.newValue;
        }
      } catch {
        if (strategy === "strict") {
          return { success: false, data, error: `Failed to convert '${transform.path}' to new type` };
        }
        current[finalKey] = transform.newValue;
      }
      break;
  }
  
  return { success: true, data };
}

/**
 * Apply a full migration to data
 */
function applyMigration(data: Record<string, unknown>, migration: Migration, strategy: string): {
  success: boolean;
  data: Record<string, unknown>;
  errors: string[];
  appliedTransforms: number;
} {
  const result = { ...data };
  const errors: string[] = [];
  let appliedTransforms = 0;
  
  for (const transform of migration.transforms) {
    const transformResult = applyTransform(result, transform, strategy);
    if (transformResult.success) {
      appliedTransforms++;
    } else if (transformResult.error) {
      errors.push(transformResult.error);
      if (strategy === "strict") {
        return { success: false, data: result, errors, appliedTransforms };
      }
    }
  }
  
  return {
    success: errors.length === 0 || strategy !== "strict",
    data: result,
    errors,
    appliedTransforms
  };
}

/**
 * Validate data against a schema (basic structural validation)
 */
function validateAgainstSchema(data: Record<string, unknown>, schema: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  function validate(obj: Record<string, unknown>, schemaObj: Record<string, unknown>, path: string = ""): void {
    const objKeys = new Set(Object.keys(obj));
    const schemaKeys = new Set(Object.keys(schemaObj));
    
    // Check for missing required fields (in schema but not in data)
    for (const key of schemaKeys) {
      const fieldPath = path ? `${path}.${key}` : key;
      if (!objKeys.has(key)) {
        errors.push(`Missing field: ${fieldPath}`);
      }
    }
    
    // Check for extra fields (in data but not in schema)
    for (const key of objKeys) {
      const fieldPath = path ? `${path}.${key}` : key;
      if (!schemaKeys.has(key)) {
        warnings.push(`Extra field: ${fieldPath}`);
      }
    }
    
    // Recursively validate nested objects
    for (const key of objKeys) {
      if (schemaKeys.has(key)) {
        const fieldPath = path ? `${path}.${key}` : key;
        const objValue = obj[key];
        const schemaValue = schemaObj[key];
        
        // Type check
        const objType = Array.isArray(objValue) ? "array" : typeof objValue;
        const schemaType = Array.isArray(schemaValue) ? "array" : typeof schemaValue;
        
        if (objType !== schemaType && schemaValue !== null && objValue !== null) {
          errors.push(`Type mismatch at ${fieldPath}: expected ${schemaType}, got ${objType}`);
        }
        
        // Recursive validation for objects
        if (objType === "object" && schemaType === "object" && objValue !== null && schemaValue !== null) {
          validate(
            objValue as Record<string, unknown>,
            schemaValue as Record<string, unknown>,
            fieldPath
          );
        }
      }
    }
  }
  
  validate(data, schema);
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Generate rollback transforms from a migration
 */
function generateRollback(migration: Migration): MigrationTransform[] {
  return migration.transforms.map(t => {
    switch (t.type) {
      case "add_field":
        return { ...t, type: "remove_field" as const, newValue: undefined, oldValue: t.newValue };
      case "remove_field":
        return { ...t, type: "add_field" as const, newValue: t.oldValue, oldValue: undefined };
      case "rename_field":
        return { ...t, type: "rename_field" as const, newValue: t.path.split(".").pop(), path: t.newValue as string };
      case "transform_value":
      case "change_type":
        return { ...t, newValue: t.oldValue, oldValue: t.newValue };
      default:
        return t;
    }
  }).reverse();
}

export const schemaMigratorDefinition: Tool = {
  name: "schema_migrator",
  description: `Handle configuration and state schema migrations.

**Actions:**
- \`generate_migration\`: Generate migration from old to new schema
- \`validate_schema\`: Validate data against a schema
- \`apply_migration\`: Apply a migration to data
- \`rollback\`: Rollback a migration
- \`diff_versions\`: Show diff between two schema versions
- \`list_migrations\`: List all migrations for a schema

**Migration Strategies:**
- \`strict\`: Fail on any error
- \`lenient\`: Continue on errors, collect warnings (default)
- \`transform\`: Attempt type coercion and transformations

**Example:**
\`\`\`json
{
  "action": "generate_migration",
  "schema_name": "app_config",
  "old_schema": { "name": "string", "port": 3000 },
  "new_schema": { "name": "string", "port": 8080, "debug": false }
}
\`\`\``,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["generate_migration", "validate_schema", "apply_migration", "rollback", "diff_versions", "list_migrations"],
        description: "Action to perform"
      },
      schema_name: {
        type: "string",
        description: "Name of the schema (for storage/retrieval)"
      },
      old_schema: {
        type: "object",
        description: "The old/current schema"
      },
      new_schema: {
        type: "object",
        description: "The new/target schema"
      },
      data: {
        type: "object",
        description: "Data to migrate or validate"
      },
      from_version: {
        type: "string",
        description: "Source version for migration"
      },
      to_version: {
        type: "string",
        description: "Target version for migration"
      },
      migration_id: {
        type: "string",
        description: "Specific migration ID for apply/rollback"
      },
      migration_strategy: {
        type: "string",
        enum: ["strict", "lenient", "transform"],
        description: "How to handle migration errors",
        default: "lenient"
      }
    },
    required: ["action"]
  }
};

export async function handleSchemaMigrator(args: unknown) {
  try {
    const input = SchemaMigratorInputSchema.parse(args);
    
    switch (input.action) {
      case "generate_migration": {
        if (!input.old_schema || !input.new_schema) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Both old_schema and new_schema are required for generate_migration"
              }, null, 2)
            }],
            isError: true
          };
        }
        
        const schemaName = input.schema_name || "unnamed";
        const fromVersion = input.from_version || getLatestSchemaVersion(schemaName)?.version || "1.0.0";
        const toVersion = input.to_version || generateVersion();
        
        // Store new schema version
        storeSchemaVersion(schemaName, toVersion, input.new_schema);
        
        // Generate transforms
        const transforms = diffSchemas(input.old_schema, input.new_schema);
        
        // Store migration
        const migration = storeMigration({
          schemaName,
          fromVersion,
          toVersion,
          transforms
        });
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              migration_id: migration.id,
              schema_name: schemaName,
              from_version: fromVersion,
              to_version: toVersion,
              transforms: transforms.map(t => ({
                type: t.type,
                path: t.path,
                change: t.type === "add_field" ? `+ ${JSON.stringify(t.newValue)}` :
                        t.type === "remove_field" ? `- ${JSON.stringify(t.oldValue)}` :
                        `${JSON.stringify(t.oldValue)} → ${JSON.stringify(t.newValue)}`
              })),
              summary: {
                total_changes: transforms.length,
                additions: transforms.filter(t => t.type === "add_field").length,
                removals: transforms.filter(t => t.type === "remove_field").length,
                modifications: transforms.filter(t => !["add_field", "remove_field"].includes(t.type)).length
              },
              backwards_compatible: transforms.every(t => t.type === "add_field")
            }, null, 2)
          }]
        };
      }
      
      case "validate_schema": {
        if (!input.data || !input.new_schema) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Both data and new_schema are required for validate_schema"
              }, null, 2)
            }],
            isError: true
          };
        }
        
        const validation = validateAgainstSchema(input.data, input.new_schema);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              valid: validation.valid,
              errors: validation.errors,
              warnings: validation.warnings,
              summary: {
                error_count: validation.errors.length,
                warning_count: validation.warnings.length
              }
            }, null, 2)
          }]
        };
      }
      
      case "apply_migration": {
        if (!input.data) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "data is required for apply_migration"
              }, null, 2)
            }],
            isError: true
          };
        }
        
        let migration: Migration | undefined;
        
        if (input.migration_id) {
          // Use specific migration
          const schemaName = input.schema_name || "unnamed";
          const migrations = getMigrations(schemaName);
          migration = migrations.find(m => m.id === input.migration_id);
        } else if (input.schema_name && input.from_version && input.to_version) {
          // Find migration path
          const path = getMigrationPath(input.schema_name, input.from_version, input.to_version);
          if (path.length > 0) {
            // Apply all migrations in path
            let currentData = { ...input.data };
            const allErrors: string[] = [];
            let totalTransforms = 0;
            
            for (const mig of path) {
              const result = applyMigration(currentData, mig, input.migration_strategy);
              currentData = result.data;
              allErrors.push(...result.errors);
              totalTransforms += result.appliedTransforms;
              
              if (result.success) {
                updateMigrationStatus(mig.id, "applied", new Date().toISOString());
              }
            }
            
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: allErrors.length === 0 || input.migration_strategy !== "strict",
                  migrations_applied: path.length,
                  transforms_applied: totalTransforms,
                  errors: allErrors,
                  migrated_data: currentData
                }, null, 2)
              }]
            };
          }
        } else if (input.old_schema && input.new_schema) {
          // Generate and apply inline migration
          const transforms = diffSchemas(input.old_schema, input.new_schema);
          migration = {
            id: `inline_${Date.now()}`,
            schemaName: input.schema_name || "inline",
            fromVersion: "1.0.0",
            toVersion: "2.0.0",
            transforms,
            createdAt: new Date().toISOString(),
            status: "pending"
          };
        }
        
        if (!migration) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Could not find or create migration. Provide migration_id, schema versions, or old/new schemas."
              }, null, 2)
            }],
            isError: true
          };
        }
        
        const result = applyMigration(input.data, migration, input.migration_strategy);
        
        if (result.success && migration.id && !migration.id.startsWith("inline_")) {
          updateMigrationStatus(migration.id, "applied", new Date().toISOString());
        }
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: result.success,
              migration_id: migration.id,
              transforms_applied: result.appliedTransforms,
              total_transforms: migration.transforms.length,
              errors: result.errors,
              migrated_data: result.data
            }, null, 2)
          }]
        };
      }
      
      case "rollback": {
        if (!input.migration_id || !input.data) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "migration_id and data are required for rollback"
              }, null, 2)
            }],
            isError: true
          };
        }
        
        const schemaName = input.schema_name || "unnamed";
        const migrations = getMigrations(schemaName);
        const migration = migrations.find(m => m.id === input.migration_id);
        
        if (!migration) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: `Migration '${input.migration_id}' not found`
              }, null, 2)
            }],
            isError: true
          };
        }
        
        // Generate rollback transforms
        const rollbackTransforms = generateRollback(migration);
        const rollbackMigration: Migration = {
          ...migration,
          id: `rollback_${migration.id}`,
          transforms: rollbackTransforms
        };
        
        const result = applyMigration(input.data, rollbackMigration, input.migration_strategy);
        
        if (result.success) {
          updateMigrationStatus(migration.id, "rolled_back", new Date().toISOString());
        }
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: result.success,
              original_migration: migration.id,
              transforms_reverted: result.appliedTransforms,
              errors: result.errors,
              rolled_back_data: result.data
            }, null, 2)
          }]
        };
      }
      
      case "diff_versions": {
        if (!input.old_schema || !input.new_schema) {
          // Try to load from storage
          if (input.schema_name && input.from_version && input.to_version) {
            const oldVer = getSchemaVersion(input.schema_name, input.from_version);
            const newVer = getSchemaVersion(input.schema_name, input.to_version);
            
            if (oldVer && newVer) {
              const transforms = diffSchemas(oldVer.schema, newVer.schema);
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    schema_name: input.schema_name,
                    from_version: input.from_version,
                    to_version: input.to_version,
                    diff: transforms.map(t => ({
                      type: t.type,
                      path: t.path,
                      old: t.oldValue,
                      new: t.newValue
                    })),
                    summary: {
                      additions: transforms.filter(t => t.type === "add_field").length,
                      removals: transforms.filter(t => t.type === "remove_field").length,
                      modifications: transforms.filter(t => !["add_field", "remove_field"].includes(t.type)).length
                    }
                  }, null, 2)
                }]
              };
            }
          }
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Provide old_schema and new_schema, or schema_name with from_version and to_version"
              }, null, 2)
            }],
            isError: true
          };
        }
        
        const transforms = diffSchemas(input.old_schema, input.new_schema);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              diff: transforms.map(t => ({
                type: t.type,
                path: t.path,
                old: t.oldValue,
                new: t.newValue
              })),
              summary: {
                total_changes: transforms.length,
                additions: transforms.filter(t => t.type === "add_field").length,
                removals: transforms.filter(t => t.type === "remove_field").length,
                modifications: transforms.filter(t => !["add_field", "remove_field"].includes(t.type)).length
              }
            }, null, 2)
          }]
        };
      }
      
      case "list_migrations": {
        const schemaName = input.schema_name;
        
        if (!schemaName) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "schema_name is required for list_migrations"
              }, null, 2)
            }],
            isError: true
          };
        }
        
        const migrations = getMigrations(schemaName);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              schema_name: schemaName,
              total_migrations: migrations.length,
              migrations: migrations.map(m => ({
                id: m.id,
                from_version: m.fromVersion,
                to_version: m.toVersion,
                status: m.status,
                created_at: m.createdAt,
                applied_at: m.appliedAt,
                transform_count: m.transforms.length
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
