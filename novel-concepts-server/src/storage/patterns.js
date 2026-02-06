/**
 * Pattern library storage for analogy_synthesizer.
 * Stores structural patterns from various domains.
 */
import * as fs from "fs/promises";
import * as path from "path";
const STORAGE_DIR = process.env.NovelConceptsDataDir || path.join(process.env.HOME || ".", ".novel-concepts-mcp");
const STORAGE_FILE = path.join(STORAGE_DIR, "patterns.json");
// Default patterns to initialize with
const DEFAULT_PATTERNS = [
    {
        id: "restaurant_kitchen",
        source_domain: "restaurant_kitchen",
        abstract_structure: "Central coordination point with distributed workers claiming tasks",
        key_features: [
            "Ticket rail / task board for visibility",
            "Workers claim tasks to avoid duplication",
            "Priority handling (VIP tickets)",
            "Station specialization (grill, fry, prep)",
            "Expeditor coordinates final assembly"
        ],
        common_problems: [
            "Multiple workers need to see available tasks",
            "Tasks need to be done in specific order",
            "Some workers specialize in certain tasks",
            "Need to handle priority/rush orders"
        ],
        typical_solutions: [
            "Central task queue with pull model",
            "Task states: pending, in_progress, ready, complete",
            "Worker registration by capability",
            "Dependency tracking between tasks"
        ],
        relationships: [
            { type: "maps_to", target: "distributed_task_board" },
            { type: "similar_to", target: "kanban_board" }
        ],
        created: Date.now(),
        usage_count: 0
    },
    {
        id: "ant_colony",
        source_domain: "ant_colony",
        abstract_structure: "Decentralized coordination through pheromone trails",
        key_features: [
            "No central coordinator",
            "Pheromone trails strengthen with use",
            "Multiple paths explored in parallel",
            "Shortest path emerges naturally"
        ],
        common_problems: [
            "Find optimal path without global knowledge",
            "Adapt to changing conditions",
            "Load balancing across multiple paths"
        ],
        typical_solutions: [
            "Positive feedback loops",
            "Evaporative trails (forget unused paths)",
            "Random exploration + reinforcement"
        ],
        relationships: [
            { type: "maps_to", target: "load_balancing" },
            { type: "similar_to", target: "reinforcement_learning" }
        ],
        created: Date.now(),
        usage_count: 0
    },
    {
        id: "library_system",
        source_domain: "library_system",
        abstract_structure: "Centralized catalog with distributed lending",
        key_features: [
            "Catalog for discovery",
            "Multiple copies of popular items",
            "Due dates and reservations",
            "Physical item tracking"
        ],
        common_problems: [
            "Resource sharing without conflicts",
            "Fair access to limited resources",
            "Tracking resource location"
        ],
        typical_solutions: [
            "Reservation system",
            "Check-out/check-in protocol",
            "Search and discovery interface",
            "Fine/penalty for overdue items"
        ],
        relationships: [
            { type: "maps_to", target: "resource_pool" },
            { type: "similar_to", target: "connection_pool" }
        ],
        created: Date.now(),
        usage_count: 0
    },
    {
        id: "traffic_control",
        source_domain: "traffic_control",
        abstract_structure: "Coordinated flow control through intersection management",
        key_features: [
            "Traffic lights for state-based flow control",
            "Sensors detect queue length",
            "Timing optimization based on demand",
            "Emergency vehicle preemption"
        ],
        common_problems: [
            "Prevent collisions at intersections",
            "Optimize flow during varying demand",
            "Handle special cases (emergency, construction)"
        ],
        typical_solutions: [
            "State machine (red, yellow, green)",
            "Priority queue for special cases",
            "Sensor feedback for adaptive timing",
            "Rules for right-of-way"
        ],
        relationships: [
            { type: "maps_to", target: "mutex" },
            { type: "similar_to", target: "load_balancer" }
        ],
        created: Date.now(),
        usage_count: 0
    },
    {
        id: "restaurant_service",
        source_domain: "restaurant_service",
        abstract_structure: "Multi-tier service with dedicated roles",
        key_features: [
            "Host: manages seating and queue",
            "Server: customer interface, order taking",
            "Kitchen: order fulfillment",
            "Bussers: cleanup between customers"
        ],
        common_problems: [
            "Coordination between front and back of house",
            "Managing customer expectations during delays",
            "Efficient table turnover"
        ],
        typical_solutions: [
            "Clear role boundaries",
            "Communication protocol (tickets, displays)",
            "Queue management for waiting customers",
            "Handoff protocols between roles"
        ],
        relationships: [
            { type: "maps_to", target: "microservices" },
            { type: "similar_to", target: "tiered_architecture" }
        ],
        created: Date.now(),
        usage_count: 0
    },
    {
        id: "supply_chain",
        source_domain: "supply_chain",
        abstract_structure: "Multi-echelon inventory and logistics management",
        key_features: [
            "Suppliers -> Warehouses -> Retailers -> Customers",
            "Just-in-time delivery",
            "Safety stock for demand variance",
            "Backorder handling"
        ],
        common_problems: [
            "Balance inventory costs vs stockouts",
            "Coordinate across multiple levels",
            "Handle supply disruptions"
        ],
        typical_solutions: [
            "Demand forecasting",
            "Multi-echelon inventory optimization",
            "Supplier diversification",
            "Real-time tracking"
        ],
        relationships: [
            { type: "maps_to", target: "data_pipeline" },
            { type: "similar_to", target: "event_sourcing" }
        ],
        created: Date.now(),
        usage_count: 0
    }
];
/**
 * PatternLibrary class for managing structural patterns
 */
export class PatternLibrary {
    patterns;
    storagePath;
    constructor(storagePath) {
        this.patterns = new Map();
        this.storagePath = storagePath || STORAGE_FILE;
    }
    /**
     * Initialize from storage
     */
    async init() {
        try {
            const data = await fs.readFile(this.storagePath, "utf-8");
            const parsed = JSON.parse(data);
            this.patterns.clear();
            for (const pattern of parsed.patterns) {
                this.patterns.set(pattern.id, pattern);
            }
        }
        catch (error) {
            // File doesn't exist or is invalid - initialize with defaults
            this.patterns.clear();
            for (const pattern of DEFAULT_PATTERNS) {
                this.patterns.set(pattern.id, pattern);
            }
            await this.save();
        }
    }
    /**
     * Save to storage
     */
    async save() {
        try {
            await fs.mkdir(STORAGE_DIR, { recursive: true });
            const data = {
                patterns: Array.from(this.patterns.values()),
                lastUpdated: Date.now()
            };
            await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2), "utf-8");
        }
        catch (error) {
            console.error("Failed to save patterns:", error);
        }
    }
    /**
     * Get all patterns
     */
    getAll() {
        return Array.from(this.patterns.values());
    }
    /**
     * Get pattern by ID
     */
    get(id) {
        return this.patterns.get(id);
    }
    /**
     * Get patterns by source domain
     */
    getByDomain(domain) {
        return Array.from(this.patterns.values()).filter(p => p.source_domain.toLowerCase().includes(domain.toLowerCase()));
    }
    /**
     * Search patterns by keyword
     */
    search(keyword) {
        const lower = keyword.toLowerCase();
        return Array.from(this.patterns.values()).filter(p => p.source_domain.toLowerCase().includes(lower) ||
            p.abstract_structure.toLowerCase().includes(lower) ||
            p.key_features.some(f => f.toLowerCase().includes(lower)) ||
            p.common_problems.some(pr => pr.toLowerCase().includes(lower)));
    }
    /**
     * Add a new pattern
     */
    async add(pattern) {
        const id = pattern.source_domain.toLowerCase().replace(/\s+/g, "_") + "_" + Date.now();
        const newPattern = {
            ...pattern,
            id,
            created: Date.now(),
            usage_count: 0
        };
        this.patterns.set(id, newPattern);
        await this.save();
        return newPattern;
    }
    /**
     * Strengthen a pattern (SEAL pattern)
     */
    async strengthen(id) {
        const pattern = this.patterns.get(id);
        if (pattern) {
            pattern.usage_count++;
            await this.save();
        }
    }
    /**
     * Get statistics
     */
    getStats() {
        const patterns = Array.from(this.patterns.values());
        return {
            total: patterns.length,
            most_used: patterns
                .sort((a, b) => b.usage_count - a.usage_count)
                .slice(0, 5)
                .map(p => ({ id: p.id, source_domain: p.source_domain, usage_count: p.usage_count })),
            domains: [...new Set(patterns.map(p => p.source_domain))]
        };
    }
}
// Singleton instance
let patternLibraryInstance = null;
export async function getPatternLibrary() {
    if (!patternLibraryInstance) {
        patternLibraryInstance = new PatternLibrary();
        await patternLibraryInstance.init();
    }
    return patternLibraryInstance;
}
