/**
 * benchmark_runner tool
 * Performance tracking with statistical analysis
 * Uses high-resolution timing for accurate measurements
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  storeBenchmarkResult,
  getBenchmarkHistory,
  setBaseline,
  getBaseline,
  compareToBaseline,
  getAllBenchmarkNames,
  type BenchmarkResult
} from "../storage/benchmarks.js";

// Input validation schema
export const BenchmarkRunnerInputSchema = z.object({
  action: z.enum(["run", "compare", "baseline", "report", "regression_check", "list"]),
  benchmark_id: z.string().optional(),
  code_snippet: z.string().optional(),
  iterations: z.number().optional().default(100),
  warmup_runs: z.number().optional().default(10),
  compare_to: z.string().optional(),
  threshold_percent: z.number().optional().default(10),
  metadata: z.record(z.unknown()).optional()
});

export type BenchmarkRunnerInput = z.infer<typeof BenchmarkRunnerInputSchema>;

/**
 * Calculate statistics from timing data
 */
function calculateStats(times: number[]): {
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
  p95: number;
  p99: number;
} {
  const sorted = [...times].sort((a, b) => a - b);
  const n = sorted.length;
  
  // Mean
  const mean = times.reduce((a, b) => a + b, 0) / n;
  
  // Median
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];
  
  // Min/Max
  const min = sorted[0];
  const max = sorted[n - 1];
  
  // Standard deviation
  const squaredDiffs = times.map(t => Math.pow(t - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / n;
  const stdDev = Math.sqrt(avgSquaredDiff);
  
  // Percentiles
  const p95Index = Math.floor(n * 0.95);
  const p99Index = Math.floor(n * 0.99);
  const p95 = sorted[p95Index] || max;
  const p99 = sorted[p99Index] || max;
  
  return { mean, median, min, max, stdDev, p95, p99 };
}

/**
 * Execute code snippet and measure time
 * Uses Function constructor for simple expressions
 */
async function executeAndMeasure(code: string): Promise<number> {
  const startTime = process.hrtime.bigint();
  
  try {
    // Create a function from the code snippet
    // This is sandboxed enough for benchmarking simple expressions
    const fn = new Function(`
      "use strict";
      ${code}
    `);
    
    // Execute
    const result = fn();
    
    // If result is a promise, await it
    if (result && typeof result.then === "function") {
      await result;
    }
  } catch (error) {
    // Ignore execution errors for timing purposes
    // The benchmark is about measuring execution time, not correctness
  }
  
  const endTime = process.hrtime.bigint();
  return Number(endTime - startTime) / 1_000_000; // Convert to milliseconds
}

/**
 * Run a synthetic benchmark (no code provided)
 * Measures baseline system performance
 */
function runSyntheticBenchmark(iterations: number): number[] {
  const times: number[] = [];
  
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    
    // Simple operations to measure
    let sum = 0;
    for (let j = 0; j < 1000; j++) {
      sum += j * j;
    }
    
    const end = process.hrtime.bigint();
    times.push(Number(end - start) / 1_000_000);
  }
  
  return times;
}

/**
 * Run benchmark with warmup and iterations
 */
async function runBenchmark(
  code: string | undefined,
  iterations: number,
  warmupRuns: number
): Promise<number[]> {
  const times: number[] = [];
  
  // Warmup runs (not measured)
  for (let i = 0; i < warmupRuns; i++) {
    if (code) {
      await executeAndMeasure(code);
    } else {
      runSyntheticBenchmark(1);
    }
  }
  
  // Actual benchmark runs
  for (let i = 0; i < iterations; i++) {
    if (code) {
      const time = await executeAndMeasure(code);
      times.push(time);
    } else {
      const syntheticTimes = runSyntheticBenchmark(1);
      times.push(syntheticTimes[0]);
    }
  }
  
  return times;
}

/**
 * Generate benchmark report
 */
function generateReport(name: string, history: BenchmarkResult[]): {
  name: string;
  runs: number;
  trend: "improving" | "degrading" | "stable";
  latest: BenchmarkResult | null;
  average_mean: number;
  best_run: BenchmarkResult | null;
  worst_run: BenchmarkResult | null;
} {
  if (history.length === 0) {
    return {
      name,
      runs: 0,
      trend: "stable",
      latest: null,
      average_mean: 0,
      best_run: null,
      worst_run: null
    };
  }
  
  const latest = history[history.length - 1];
  const averageMean = history.reduce((sum, r) => sum + r.metrics.mean, 0) / history.length;
  
  const best = history.reduce((best, r) => 
    r.metrics.mean < best.metrics.mean ? r : best, history[0]);
  const worst = history.reduce((worst, r) => 
    r.metrics.mean > worst.metrics.mean ? r : worst, history[0]);
  
  // Calculate trend from last 5 runs
  let trend: "improving" | "degrading" | "stable" = "stable";
  if (history.length >= 3) {
    const recent = history.slice(-5);
    const older = recent.slice(0, Math.floor(recent.length / 2));
    const newer = recent.slice(Math.floor(recent.length / 2));
    
    const olderAvg = older.reduce((sum, r) => sum + r.metrics.mean, 0) / older.length;
    const newerAvg = newer.reduce((sum, r) => sum + r.metrics.mean, 0) / newer.length;
    
    const changePercent = ((newerAvg - olderAvg) / olderAvg) * 100;
    
    if (changePercent < -5) {
      trend = "improving";
    } else if (changePercent > 5) {
      trend = "degrading";
    }
  }
  
  return {
    name,
    runs: history.length,
    trend,
    latest,
    average_mean: averageMean,
    best_run: best,
    worst_run: worst
  };
}

export const benchmarkRunnerDefinition: Tool = {
  name: "benchmark_runner",
  description: `Track performance metrics over time with statistical analysis.

**Actions:**
- \`run\`: Execute a benchmark and store results
- \`compare\`: Compare current results to baseline or previous run
- \`baseline\`: Set a baseline for future comparisons
- \`report\`: Generate a performance report
- \`regression_check\`: Check for performance regressions
- \`list\`: List all tracked benchmarks

**Metrics Collected:**
- Mean, Median, Min, Max execution time
- Standard deviation
- P95 and P99 percentiles
- Throughput (ops/sec)

**Example:**
\`\`\`json
{
  "action": "run",
  "benchmark_id": "array_sort",
  "code_snippet": "const arr = Array.from({length: 1000}, () => Math.random()); arr.sort();",
  "iterations": 100,
  "warmup_runs": 10
}
\`\`\``,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["run", "compare", "baseline", "report", "regression_check", "list"],
        description: "Action to perform"
      },
      benchmark_id: {
        type: "string",
        description: "Unique identifier for the benchmark"
      },
      code_snippet: {
        type: "string",
        description: "JavaScript code to benchmark"
      },
      iterations: {
        type: "number",
        description: "Number of benchmark iterations",
        default: 100
      },
      warmup_runs: {
        type: "number",
        description: "Number of warmup runs before measuring",
        default: 10
      },
      compare_to: {
        type: "string",
        description: "Baseline ID to compare against"
      },
      threshold_percent: {
        type: "number",
        description: "Regression threshold percentage",
        default: 10
      },
      metadata: {
        type: "object",
        description: "Additional metadata to store with results"
      }
    },
    required: ["action"]
  }
};

export async function handleBenchmarkRunner(args: unknown) {
  try {
    const input = BenchmarkRunnerInputSchema.parse(args);
    
    switch (input.action) {
      case "run": {
        const benchmarkId = input.benchmark_id || `benchmark_${Date.now()}`;
        
        // Run the benchmark
        const times = await runBenchmark(
          input.code_snippet,
          input.iterations,
          input.warmup_runs
        );
        
        // Calculate statistics
        const stats = calculateStats(times);
        
        // Calculate throughput (operations per second)
        const throughput = stats.mean > 0 ? 1000 / stats.mean : 0;
        
        // Create result
        const result: BenchmarkResult = {
          id: `result_${Date.now()}`,
          name: benchmarkId,
          timestamp: new Date().toISOString(),
          iterations: input.iterations,
          warmupRuns: input.warmup_runs,
          metrics: {
            ...stats,
            throughput
          },
          metadata: input.metadata
        };
        
        // Store result
        storeBenchmarkResult(result);
        
        // Check against baseline if exists
        const baselineComparison = compareToBaseline(benchmarkId, result);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              benchmark_id: benchmarkId,
              result_id: result.id,
              iterations: input.iterations,
              warmup_runs: input.warmup_runs,
              metrics: {
                mean_ms: stats.mean.toFixed(4),
                median_ms: stats.median.toFixed(4),
                min_ms: stats.min.toFixed(4),
                max_ms: stats.max.toFixed(4),
                std_dev_ms: stats.stdDev.toFixed(4),
                p95_ms: stats.p95.toFixed(4),
                p99_ms: stats.p99.toFixed(4),
                throughput_ops_sec: throughput.toFixed(2)
              },
              baseline_comparison: baselineComparison.hasBaseline ? {
                baseline_mean: baselineComparison.baseline!.result.metrics.mean.toFixed(4),
                current_mean: stats.mean.toFixed(4),
                diff_ms: baselineComparison.comparison!.meanDiff.toFixed(4),
                diff_percent: baselineComparison.comparison!.meanDiffPercent.toFixed(2) + "%",
                is_regression: baselineComparison.comparison!.isRegression
              } : null
            }, null, 2)
          }]
        };
      }
      
      case "compare": {
        if (!input.benchmark_id) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "benchmark_id is required for compare"
              }, null, 2)
            }],
            isError: true
          };
        }
        
        const history = getBenchmarkHistory(input.benchmark_id, 10);
        
        if (history.length < 2) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Need at least 2 benchmark runs to compare",
                runs_available: history.length
              }, null, 2)
            }],
            isError: true
          };
        }
        
        const latest = history[history.length - 1];
        const previous = history[history.length - 2];
        const baseline = getBaseline(input.benchmark_id);
        
        const vsPreious = {
          diff_ms: latest.metrics.mean - previous.metrics.mean,
          diff_percent: ((latest.metrics.mean - previous.metrics.mean) / previous.metrics.mean) * 100
        };
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              benchmark_id: input.benchmark_id,
              latest: {
                id: latest.id,
                timestamp: latest.timestamp,
                mean_ms: latest.metrics.mean.toFixed(4)
              },
              vs_previous: {
                previous_id: previous.id,
                previous_mean_ms: previous.metrics.mean.toFixed(4),
                diff_ms: vsPreious.diff_ms.toFixed(4),
                diff_percent: vsPreious.diff_percent.toFixed(2) + "%",
                status: vsPreious.diff_percent > input.threshold_percent ? "REGRESSION" :
                        vsPreious.diff_percent < -input.threshold_percent ? "IMPROVEMENT" : "STABLE"
              },
              vs_baseline: baseline ? {
                baseline_id: baseline.id,
                baseline_mean_ms: baseline.result.metrics.mean.toFixed(4),
                diff_ms: (latest.metrics.mean - baseline.result.metrics.mean).toFixed(4),
                diff_percent: (((latest.metrics.mean - baseline.result.metrics.mean) / baseline.result.metrics.mean) * 100).toFixed(2) + "%"
              } : null,
              history_summary: {
                total_runs: history.length,
                best_mean: Math.min(...history.map(h => h.metrics.mean)).toFixed(4),
                worst_mean: Math.max(...history.map(h => h.metrics.mean)).toFixed(4)
              }
            }, null, 2)
          }]
        };
      }
      
      case "baseline": {
        if (!input.benchmark_id) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "benchmark_id is required for baseline"
              }, null, 2)
            }],
            isError: true
          };
        }
        
        // Get the latest result or run a new benchmark
        let result: BenchmarkResult;
        const history = getBenchmarkHistory(input.benchmark_id, 1);
        
        if (history.length > 0) {
          result = history[0];
        } else if (input.code_snippet) {
          // Run a new benchmark
          const times = await runBenchmark(
            input.code_snippet,
            input.iterations,
            input.warmup_runs
          );
          const stats = calculateStats(times);
          result = {
            id: `result_${Date.now()}`,
            name: input.benchmark_id,
            timestamp: new Date().toISOString(),
            iterations: input.iterations,
            warmupRuns: input.warmup_runs,
            metrics: {
              ...stats,
              throughput: stats.mean > 0 ? 1000 / stats.mean : 0
            }
          };
          storeBenchmarkResult(result);
        } else {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "No existing results and no code_snippet provided. Run a benchmark first or provide code."
              }, null, 2)
            }],
            isError: true
          };
        }
        
        // Set as baseline
        const baseline = setBaseline(input.benchmark_id, result);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              baseline_id: baseline.id,
              benchmark_id: input.benchmark_id,
              created_at: baseline.createdAt,
              baseline_metrics: {
                mean_ms: baseline.result.metrics.mean.toFixed(4),
                median_ms: baseline.result.metrics.median.toFixed(4),
                p95_ms: baseline.result.metrics.p95.toFixed(4),
                p99_ms: baseline.result.metrics.p99.toFixed(4)
              }
            }, null, 2)
          }]
        };
      }
      
      case "report": {
        const benchmarkId = input.benchmark_id;
        
        if (benchmarkId) {
          // Report for specific benchmark
          const history = getBenchmarkHistory(benchmarkId, 100);
          const report = generateReport(benchmarkId, history);
          const baseline = getBaseline(benchmarkId);
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                benchmark_id: benchmarkId,
                report: {
                  total_runs: report.runs,
                  trend: report.trend,
                  average_mean_ms: report.average_mean.toFixed(4),
                  latest: report.latest ? {
                    timestamp: report.latest.timestamp,
                    mean_ms: report.latest.metrics.mean.toFixed(4)
                  } : null,
                  best: report.best_run ? {
                    timestamp: report.best_run.timestamp,
                    mean_ms: report.best_run.metrics.mean.toFixed(4)
                  } : null,
                  worst: report.worst_run ? {
                    timestamp: report.worst_run.timestamp,
                    mean_ms: report.worst_run.metrics.mean.toFixed(4)
                  } : null
                },
                baseline: baseline ? {
                  id: baseline.id,
                  created_at: baseline.createdAt,
                  mean_ms: baseline.result.metrics.mean.toFixed(4)
                } : null,
                history: history.slice(-10).map(h => ({
                  timestamp: h.timestamp,
                  mean_ms: h.metrics.mean.toFixed(4)
                }))
              }, null, 2)
            }]
          };
        } else {
          // Report for all benchmarks
          const allNames = getAllBenchmarkNames();
          const reports = allNames.map(name => {
            const history = getBenchmarkHistory(name, 100);
            return generateReport(name, history);
          });
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                total_benchmarks: reports.length,
                benchmarks: reports.map(r => ({
                  name: r.name,
                  runs: r.runs,
                  trend: r.trend,
                  latest_mean_ms: r.latest?.metrics.mean.toFixed(4) || "N/A"
                }))
              }, null, 2)
            }]
          };
        }
      }
      
      case "regression_check": {
        if (!input.benchmark_id) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "benchmark_id is required for regression_check"
              }, null, 2)
            }],
            isError: true
          };
        }
        
        const history = getBenchmarkHistory(input.benchmark_id, 10);
        const baseline = getBaseline(input.benchmark_id);
        
        if (history.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "No benchmark history available",
                benchmark_id: input.benchmark_id
              }, null, 2)
            }],
            isError: true
          };
        }
        
        const latest = history[history.length - 1];
        const regressions: Array<{
          comparison: string;
          diff_percent: number;
          severity: "warning" | "critical";
        }> = [];
        
        // Check against baseline
        if (baseline) {
          const diffPercent = ((latest.metrics.mean - baseline.result.metrics.mean) / baseline.result.metrics.mean) * 100;
          if (diffPercent > input.threshold_percent) {
            regressions.push({
              comparison: "vs_baseline",
              diff_percent: diffPercent,
              severity: diffPercent > input.threshold_percent * 2 ? "critical" : "warning"
            });
          }
        }
        
        // Check against previous
        if (history.length >= 2) {
          const previous = history[history.length - 2];
          const diffPercent = ((latest.metrics.mean - previous.metrics.mean) / previous.metrics.mean) * 100;
          if (diffPercent > input.threshold_percent) {
            regressions.push({
              comparison: "vs_previous",
              diff_percent: diffPercent,
              severity: diffPercent > input.threshold_percent * 2 ? "critical" : "warning"
            });
          }
        }
        
        // Check against average
        if (history.length >= 5) {
          const avgMean = history.slice(0, -1).reduce((sum, h) => sum + h.metrics.mean, 0) / (history.length - 1);
          const diffPercent = ((latest.metrics.mean - avgMean) / avgMean) * 100;
          if (diffPercent > input.threshold_percent) {
            regressions.push({
              comparison: "vs_average",
              diff_percent: diffPercent,
              severity: diffPercent > input.threshold_percent * 2 ? "critical" : "warning"
            });
          }
        }
        
        const hasRegression = regressions.length > 0;
        const hasCritical = regressions.some(r => r.severity === "critical");
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              benchmark_id: input.benchmark_id,
              threshold_percent: input.threshold_percent,
              status: hasCritical ? "CRITICAL_REGRESSION" :
                      hasRegression ? "REGRESSION_DETECTED" : "PASS",
              latest_mean_ms: latest.metrics.mean.toFixed(4),
              regressions: regressions.map(r => ({
                ...r,
                diff_percent: r.diff_percent.toFixed(2) + "%"
              })),
              recommendation: hasCritical ? "Immediate investigation required" :
                             hasRegression ? "Review recent changes" :
                             "Performance is within acceptable limits"
            }, null, 2)
          }]
        };
      }
      
      case "list": {
        const allNames = getAllBenchmarkNames();
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total_benchmarks: allNames.length,
              benchmarks: allNames.map(name => {
                const history = getBenchmarkHistory(name, 1);
                const baseline = getBaseline(name);
                return {
                  name,
                  has_history: history.length > 0,
                  has_baseline: !!baseline,
                  latest_run: history.length > 0 ? history[0].timestamp : null
                };
              })
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
