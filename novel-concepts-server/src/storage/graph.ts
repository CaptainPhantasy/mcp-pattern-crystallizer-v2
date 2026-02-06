/**
 * In-memory concept graph storage.
 * Implements a directed graph where nodes = concepts, edges = relationships.
 * Edge weights strengthen through usage (like neural pathways).
 */

export interface ConceptNode {
  id: string;
  concept: string;
  created: number;
  access_count: number;
  metadata?: Record<string, unknown>;
}

export interface RelationshipEdge {
  from: string;
  to: string;
  type: RelationshipType;
  strength: number; // 0.0 to 1.0, increases with usage
  created: number;
}

export type RelationshipType = "depends_on" | "implements" | "generalizes" | "conflicts_with";

export interface PathStep {
  concept: string;
  relationship: RelationshipType;
  strength: number;
}

export interface Neighbor {
  concept: string;
  relationship: RelationshipType;
  strength: number;
}

export interface ImpactResult {
  concept: string;
  affected_edges: RelationshipType[];
}

export class ConceptGraph {
  private nodes: Map<string, ConceptNode>;
  private edges: Map<string, RelationshipEdge[]>; // key: from concept id

  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
  }

  /**
   * Generate a deterministic ID from a concept string
   */
  private conceptToId(concept: string): string {
    return concept.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  }

  /**
   * Register a new concept with optional relationships
   */
  register(concept: string, relationships: Array<{ type: RelationshipType; target: string }>, metadata?: Record<string, unknown>): string {
    const id = this.conceptToId(concept);

    // Create or update node
    if (!this.nodes.has(id)) {
      this.nodes.set(id, {
        id,
        concept,
        created: Date.now(),
        access_count: 0,
        metadata
      });
    } else {
      // Update metadata if provided
      const node = this.nodes.get(id)!;
      if (metadata) {
        node.metadata = { ...node.metadata, ...metadata };
      }
    }

    // Create relationships
    if (relationships && relationships.length > 0) {
      if (!this.edges.has(id)) {
        this.edges.set(id, []);
      }

      for (const rel of relationships) {
        const targetId = this.conceptToId(rel.target);

        // Ensure target node exists
        if (!this.nodes.has(targetId)) {
          this.nodes.set(targetId, {
            id: targetId,
            concept: rel.target,
            created: Date.now(),
            access_count: 0
          });
        }

        // Check if edge already exists
        const existingEdge = this.edges.get(id)!.find(
          e => e.to === targetId && e.type === rel.type
        );

        if (existingEdge) {
          // Strengthen existing edge
          existingEdge.strength = Math.min(existingEdge.strength + 0.1, 1.0);
        } else {
          // Create new edge
          this.edges.get(id)!.push({
            from: id,
            to: targetId,
            type: rel.type,
            strength: 0.3, // Starting strength
            created: Date.now()
          });
        }
      }
    }

    return id;
  }

  /**
   * Get node by concept string
   */
  getNode(concept: string): ConceptNode | undefined {
    const id = this.conceptToId(concept);
    return this.nodes.get(id);
  }

  /**
   * Get neighbors of a concept (outgoing relationships)
   */
  getNeighbors(concept: string): Neighbor[] {
    const id = this.conceptToId(concept);
    const outgoing = this.edges.get(id) || [];

    // Increment access count
    const node = this.nodes.get(id);
    if (node) {
      node.access_count++;
      // Strengthen edges when accessed
      for (const edge of outgoing) {
        edge.strength = Math.min(edge.strength + 0.05, 1.0);
      }
    }

    return outgoing.map(edge => ({
      concept: this.nodes.get(edge.to)?.concept || edge.to,
      relationship: edge.type,
      strength: edge.strength
    }));
  }

  /**
   * Find all concepts that depend on the given concept (reverse lookup)
   */
  getDependents(concept: string): Neighbor[] {
    const id = this.conceptToId(concept);
    const dependents: Neighbor[] = [];

    for (const [fromId, edges] of this.edges.entries()) {
      for (const edge of edges) {
        if (edge.to === id) {
          dependents.push({
            concept: this.nodes.get(fromId)?.concept || fromId,
            relationship: edge.type,
            strength: edge.strength
          });
        }
      }
    }

    return dependents;
  }

  /**
   * Find path from one concept to another using BFS
   */
  findPath(from: string, to: string): PathStep[] | null {
    const fromId = this.conceptToId(from);
    const toId = this.conceptToId(to);

    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) {
      return null;
    }

    if (fromId === toId) {
      return [];
    }

    // BFS
    const queue: Array<{ id: string; path: PathStep[] }> = [{ id: fromId, path: [] }];
    const visited = new Set<string>([fromId]);

    while (queue.length > 0) {
      const { id, path } = queue.shift()!;

      const edges = this.edges.get(id) || [];
      for (const edge of edges) {
        if (edge.to === toId) {
          // Found path
          return [
            ...path,
            {
              concept: this.nodes.get(edge.to)?.concept || edge.to,
              relationship: edge.type,
              strength: edge.strength
            }
          ];
        }

        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          queue.push({
            id: edge.to,
            path: [
              ...path,
              {
                concept: this.nodes.get(edge.to)?.concept || edge.to,
                relationship: edge.type,
                strength: edge.strength
              }
            ]
          });
        }
      }
    }

    return null; // No path found
  }

  /**
   * Impact analysis: what would be affected if a concept changes?
   */
  impactAnalysis(concept: string): ImpactResult[] {
    const impact: ImpactResult[] = [];
    const id = this.conceptToId(concept);

    // Find all nodes that depend on this one
    for (const [fromId, edges] of this.edges.entries()) {
      const affectedEdges: RelationshipType[] = [];
      for (const edge of edges) {
        if (edge.to === id) {
          affectedEdges.push(edge.type);
        }
      }

      if (affectedEdges.length > 0) {
        impact.push({
          concept: this.nodes.get(fromId)?.concept || fromId,
          affected_edges: affectedEdges
        });
      }
    }

    return impact;
  }

  /**
   * Strengthen a relationship (SEAL pattern - reinforces successful patterns)
   */
  strengthen(concept: string, relationshipType?: RelationshipType): void {
    const id = this.conceptToId(concept);
    const node = this.nodes.get(id);
    if (node) {
      node.access_count++;
    }

    if (relationshipType) {
      const edges = this.edges.get(id) || [];
      for (const edge of edges) {
        if (edge.type === relationshipType) {
          edge.strength = Math.min(edge.strength + 0.15, 1.0);
        }
      }
    }
  }

  /**
   * Query by relationship type
   */
  queryByRelationship(relType: RelationshipType): Array<{ from: string; to: string; strength: number }> {
    const results: Array<{ from: string; to: string; strength: number }> = [];

    for (const [fromId, edges] of this.edges.entries()) {
      for (const edge of edges) {
        if (edge.type === relType) {
          results.push({
            from: this.nodes.get(fromId)?.concept || fromId,
            to: this.nodes.get(edge.to)?.concept || edge.to,
            strength: edge.strength
          });
        }
      }
    }

    return results.sort((a, b) => b.strength - a.strength);
  }

  /**
   * Get all concepts
   */
  getAllConcepts(): string[] {
    return Array.from(this.nodes.values()).map(n => n.concept);
  }

  /**
   * Get graph statistics
   */
  getStats(): { nodeCount: number; edgeCount: number; avgStrength: number } {
    let edgeCount = 0;
    let totalStrength = 0;

    for (const edges of this.edges.values()) {
      edgeCount += edges.length;
      for (const edge of edges) {
        totalStrength += edge.strength;
      }
    }

    return {
      nodeCount: this.nodes.size,
      edgeCount,
      avgStrength: edgeCount > 0 ? totalStrength / edgeCount : 0
    };
  }

  /**
   * Export graph for persistence
   */
  export(): { nodes: ConceptNode[]; edges: RelationshipEdge[] } {
    const allEdges: RelationshipEdge[] = [];
    for (const edges of this.edges.values()) {
      allEdges.push(...edges);
    }

    return {
      nodes: Array.from(this.nodes.values()),
      edges: allEdges
    };
  }

  /**
   * Import graph from persisted data
   */
  import(data: { nodes: ConceptNode[]; edges: RelationshipEdge[] }): void {
    this.nodes.clear();
    this.edges.clear();

    for (const node of data.nodes) {
      this.nodes.set(node.id, node);
    }

    for (const edge of data.edges) {
      if (!this.edges.has(edge.from)) {
        this.edges.set(edge.from, []);
      }
      this.edges.get(edge.from)!.push(edge);
    }
  }
}

// Singleton instance
let graphInstance: ConceptGraph | null = null;

export function getGraph(): ConceptGraph {
  if (!graphInstance) {
    graphInstance = new ConceptGraph();
  }
  return graphInstance;
}
