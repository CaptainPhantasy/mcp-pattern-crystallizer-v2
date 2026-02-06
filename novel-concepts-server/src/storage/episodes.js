/**
 * File-based storage for episodic memory bank.
 * Stores problem-solving episodes with reasoning chains.
 */
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
const STORAGE_DIR = process.env.NovelConceptsDataDir || path.join(process.env.HOME || ".", ".novel-concepts-mcp");
const STORAGE_FILE = path.join(STORAGE_DIR, "episodes.json");
/**
 * Semantic similarity calculation (heuristic-based)
 */
function calculateSimilarity(text1, text2) {
    const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    if (words1.size === 0 || words2.size === 0)
        return 0;
    let intersection = 0;
    for (const word of words1) {
        if (words2.has(word))
            intersection++;
    }
    const union = words1.size + words2.size - intersection;
    return union > 0 ? intersection / union : 0;
}
/**
 * EpisodeBank class for managing episodic memory
 */
export class EpisodeBank {
    episodes;
    storagePath;
    constructor(storagePath) {
        this.episodes = new Map();
        this.storagePath = storagePath || STORAGE_FILE;
    }
    /**
     * Initialize from storage
     */
    async init() {
        try {
            const data = await fs.readFile(this.storagePath, "utf-8");
            const parsed = JSON.parse(data);
            this.episodes.clear();
            for (const episode of parsed.episodes) {
                this.episodes.set(episode.id, episode);
            }
        }
        catch (error) {
            // File doesn't exist or is invalid - start fresh
            this.episodes.clear();
        }
    }
    /**
     * Save to storage
     */
    async save() {
        try {
            await fs.mkdir(STORAGE_DIR, { recursive: true });
            const data = {
                episodes: Array.from(this.episodes.values()),
                lastUpdated: Date.now()
            };
            await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2), "utf-8");
        }
        catch (error) {
            console.error("Failed to save episodes:", error);
        }
    }
    /**
     * Store a new episode
     */
    async store(episode) {
        const newEpisode = {
            ...episode,
            id: crypto.randomBytes(8).toString("hex"),
            created: Date.now(),
            access_count: 0
        };
        this.episodes.set(newEpisode.id, newEpisode);
        await this.save();
        return newEpisode;
    }
    /**
     * Retrieve episodes by similarity to query
     */
    retrieve(query, maxResults = 3, minSimilarity = 0.2) {
        const results = [];
        for (const episode of this.episodes.values()) {
            // Calculate similarity based on trigger
            const triggerSimilarity = calculateSimilarity(query, episode.trigger);
            // Also check reasoning and solution
            const reasoningSimilarity = calculateSimilarity(query, episode.reasoning);
            const solutionSimilarity = calculateSimilarity(query, episode.solution);
            // Combined similarity with weights
            const combinedSimilarity = (triggerSimilarity * 0.5 +
                reasoningSimilarity * 0.3 +
                solutionSimilarity * 0.2);
            if (combinedSimilarity >= minSimilarity) {
                results.push({
                    episode,
                    similarity_score: Math.round(combinedSimilarity * 1000) / 1000
                });
                // Increment access count
                episode.access_count++;
            }
        }
        // Sort by similarity and limit results
        results.sort((a, b) => b.similarity_score - a.similarity_score);
        return results.slice(0, maxResults);
    }
    /**
     * Get episode by ID
     */
    get(id) {
        const episode = this.episodes.get(id);
        if (episode) {
            episode.access_count++;
        }
        return episode;
    }
    /**
     * Get all episodes
     */
    getAll() {
        return Array.from(this.episodes.values());
    }
    /**
     * Get episodes by domain
     */
    getByDomain(domain) {
        return Array.from(this.episodes.values()).filter(ep => ep.metadata.domain?.toLowerCase() === domain.toLowerCase());
    }
    /**
     * Get episodes by outcome
     */
    getByOutcome(outcome) {
        return Array.from(this.episodes.values()).filter(ep => ep.outcome === outcome);
    }
    /**
     * Delete an episode
     */
    async delete(id) {
        const deleted = this.episodes.delete(id);
        if (deleted) {
            await this.save();
        }
        return deleted;
    }
    /**
     * Get statistics
     */
    getStats() {
        const episodes = Array.from(this.episodes.values());
        const byOutcome = {
            success: 0,
            partial: 0,
            failure: 0
        };
        const byDomain = {};
        let totalAccessCount = 0;
        for (const ep of episodes) {
            byOutcome[ep.outcome]++;
            if (ep.metadata.domain) {
                byDomain[ep.metadata.domain] = (byDomain[ep.metadata.domain] || 0) + 1;
            }
            totalAccessCount += ep.access_count;
        }
        return {
            total: episodes.length,
            byOutcome,
            byDomain,
            avgAccessCount: episodes.length > 0 ? totalAccessCount / episodes.length : 0
        };
    }
    /**
     * Clear all episodes
     */
    async clear() {
        this.episodes.clear();
        await this.save();
    }
}
// Singleton instance
let episodeBankInstance = null;
export async function getEpisodeBank() {
    if (!episodeBankInstance) {
        episodeBankInstance = new EpisodeBank();
        await episodeBankInstance.init();
    }
    return episodeBankInstance;
}
