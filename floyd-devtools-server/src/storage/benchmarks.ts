/**
 * Benchmark Storage
 * In-memory storage for benchmark results with history tracking
 */

export interface BenchmarkResult {
  id: string;
  name: string;
  timestamp: string;
  iterations: number;
  warmupRuns: number;
  metrics: {
    mean: number;
    median: number;
    min: number;
    max: number;
    stdDev: number;
    p95: number;
    p99: number;
    throughput?: number;
  };
  metadata?: Record<string, unknown>;
}

export interface BenchmarkBaseline {
  id: string;
  name: string;
  createdAt: string;
  result: BenchmarkResult;
}

// In-memory storage
const benchmarkResults: Map<string, BenchmarkResult[]> = new Map();
const baselines: Map<string, BenchmarkBaseline> = new Map();

/**
 * Store a benchmark result
 */
export function storeBenchmarkResult(result: BenchmarkResult): void {
  const history = benchmarkResults.get(result.name) || [];
  history.push(result);
  
  // Keep last 100 results per benchmark
  if (history.length > 100) {
    history.shift();
  }
  
  benchmarkResults.set(result.name, history);
}

/**
 * Get benchmark history
 */
export function getBenchmarkHistory(name: string, limit: number = 10): BenchmarkResult[] {
  const history = benchmarkResults.get(name) || [];
  return history.slice(-limit);
}

/**
 * Set a baseline for comparison
 */
export function setBaseline(name: string, result: BenchmarkResult): BenchmarkBaseline {
  const baseline: BenchmarkBaseline = {
    id: `baseline_${Date.now()}`,
    name,
    createdAt: new Date().toISOString(),
    result
  };
  baselines.set(name, baseline);
  return baseline;
}

/**
 * Get baseline for a benchmark
 */
export function getBaseline(name: string): BenchmarkBaseline | undefined {
  return baselines.get(name);
}

/**
 * Compare result to baseline
 */
export function compareToBaseline(name: string, result: BenchmarkResult): {
  hasBaseline: boolean;
  baseline?: BenchmarkBaseline;
  comparison?: {
    meanDiff: number;
    meanDiffPercent: number;
    isRegression: boolean;
    regressionThreshold: number;
  };
} {
  const baseline = baselines.get(name);
  
  if (!baseline) {
    return { hasBaseline: false };
  }
  
  const meanDiff = result.metrics.mean - baseline.result.metrics.mean;
  const meanDiffPercent = (meanDiff / baseline.result.metrics.mean) * 100;
  const regressionThreshold = 10; // 10% threshold
  
  return {
    hasBaseline: true,
    baseline,
    comparison: {
      meanDiff,
      meanDiffPercent,
      isRegression: meanDiffPercent > regressionThreshold,
      regressionThreshold
    }
  };
}

/**
 * Get all benchmark names
 */
export function getAllBenchmarkNames(): string[] {
  return Array.from(benchmarkResults.keys());
}

/**
 * Clear all benchmark data
 */
export function clearBenchmarks(): void {
  benchmarkResults.clear();
  baselines.clear();
}

/**
 * Export all data for persistence
 */
export function exportBenchmarkData(): {
  results: Record<string, BenchmarkResult[]>;
  baselines: Record<string, BenchmarkBaseline>;
} {
  return {
    results: Object.fromEntries(benchmarkResults),
    baselines: Object.fromEntries(baselines)
  };
}

/**
 * Import data for restoration
 */
export function importBenchmarkData(data: {
  results?: Record<string, BenchmarkResult[]>;
  baselines?: Record<string, BenchmarkBaseline>;
}): void {
  if (data.results) {
    for (const [name, results] of Object.entries(data.results)) {
      benchmarkResults.set(name, results);
    }
  }
  if (data.baselines) {
    for (const [name, baseline] of Object.entries(data.baselines)) {
      baselines.set(name, baseline);
    }
  }
}
