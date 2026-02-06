/**
 * git_bisect tool
 * Intelligent git bisect automation for finding breaking commits
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { execSync } from "child_process";
import { resolve } from "path";

export const GitBisectInputSchema = z.object({
  action: z.enum(["find_breaking_commit", "analyze_commit_impact"]),
  repo_path: z.string().optional(),
  good_commit: z.string().optional(),
  bad_commit: z.string().optional(),
  test_command: z.string().optional(),
  target_files: z.array(z.string()).optional(),
  max_depth: z.number().optional().default(200),
  error_pattern: z.string().optional(),
  dry_run: z.boolean().optional().default(false),
  preserve_state: z.boolean().optional().default(true),
});

export type GitBisectInput = z.infer<typeof GitBisectInputSchema>;

export const gitBisectDefinition: Tool = {
  name: "git_bisect",
  description: "Find breaking commits and analyze git changes with context",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["find_breaking_commit", "analyze_commit_impact"] },
      repo_path: { type: "string" },
      good_commit: { type: "string" },
      bad_commit: { type: "string" },
      test_command: { type: "string" },
      target_files: { type: "array", items: { type: "string" } },
      max_depth: { type: "number", default: 200 },
      error_pattern: { type: "string" },
      dry_run: { type: "boolean", default: false },
      preserve_state: { type: "boolean", default: true },
    },
    required: ["action"],
  },
};

function run(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

function isGitRepo(cwd: string): boolean {
  try {
    run("git rev-parse --is-inside-work-tree", cwd);
    return true;
  } catch {
    return false;
  }
}

function listCommits(cwd: string, good: string, bad: string): string[] {
  const list = run(`git rev-list ${good}..${bad}`, cwd);
  if (!list) return [];
  return list.split("\n").reverse();
}

function commitTouchesTarget(cwd: string, commit: string, targets: string[]): boolean {
  const files = run(`git diff-tree --no-commit-id --name-only -r ${commit}`, cwd).split("\n");
  return files.some((file) => targets.some((target) => file.includes(target)));
}

function parseRelevantChanges(diffText: string, errorPattern?: string) {
  if (!errorPattern) return [];
  const regex = new RegExp(errorPattern, "i");
  return diffText
    .split("\n")
    .filter((line) => regex.test(line))
    .slice(0, 200);
}

export async function handleGitBisect(args: unknown) {
  const input = GitBisectInputSchema.parse(args);
  const repoPath = resolve(input.repo_path || process.cwd());

  if (!isGitRepo(repoPath)) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          skipped: true,
          reason: "Not a git repository",
          repo_path: repoPath,
        }, null, 2),
      }],
    };
  }

  if (input.action === "analyze_commit_impact") {
    if (!input.bad_commit) {
      throw new Error("bad_commit is required for analyze_commit_impact");
    }

    const commit = input.bad_commit;
    const filesChanged = run(`git diff-tree --no-commit-id --name-only -r ${commit}`, repoPath).split("\n").filter(Boolean);
    const diffText = run(`git show ${commit}`, repoPath);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          commit,
          filesChanged,
          relevantLines: parseRelevantChanges(diffText, input.error_pattern),
        }, null, 2),
      }],
    };
  }

  if (!input.good_commit || !input.test_command) {
    throw new Error("good_commit and test_command are required for find_breaking_commit");
  }

  const badCommit = input.bad_commit || "HEAD";
  let commits = listCommits(repoPath, input.good_commit, badCommit);

  if (input.target_files && input.target_files.length > 0) {
    commits = commits.filter((commit) => commitTouchesTarget(repoPath, commit, input.target_files!));
  }

  if (input.max_depth && commits.length > input.max_depth) {
    commits = commits.slice(0, input.max_depth);
  }

  if (commits.length === 0) {
    throw new Error("No commits found in range");
  }

  if (input.dry_run) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          dryRun: true,
          totalCommits: commits.length,
          firstCommit: commits[0],
          lastCommit: commits[commits.length - 1],
        }, null, 2),
      }],
    };
  }

  const originalRef = run("git rev-parse --abbrev-ref HEAD", repoPath);
  const originalSha = run("git rev-parse HEAD", repoPath);
  const dirty = run("git status --porcelain", repoPath);
  let stashed = false;

  try {
    if (input.preserve_state && dirty) {
      run("git stash push -u -m 'mcp-git-bisect'", repoPath);
      stashed = true;
    }

    let low = 0;
    let high = commits.length - 1;

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const commit = commits[mid];
      run(`git checkout ${commit}`, repoPath);

      try {
        execSync(input.test_command, { cwd: repoPath, stdio: "pipe" });
        low = mid + 1; // commit is good
      } catch {
        high = mid; // commit is bad
      }
    }

    const breakingCommit = commits[high];
    const message = run(`git log -1 --pretty=%B ${breakingCommit}`, repoPath);
    const author = run(`git log -1 --pretty=%an ${breakingCommit}`, repoPath);
    const date = run(`git log -1 --pretty=%ad ${breakingCommit}`, repoPath);
    const filesChanged = run(`git diff-tree --no-commit-id --name-only -r ${breakingCommit}`, repoPath).split("\n").filter(Boolean);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          breakingCommit,
          commitMessage: message.trim(),
          author,
          commitDate: date,
          filesChanged,
          totalCommitsSearched: commits.length,
        }, null, 2),
      }],
    };
  } finally {
    run(`git checkout ${originalSha}`, repoPath);
    if (originalRef !== "HEAD") {
      run(`git checkout ${originalRef}`, repoPath);
    }
    if (input.preserve_state && stashed) {
      try {
        run("git stash pop", repoPath);
      } catch {
        // Leave stash if conflicts occur
      }
    }
  }
}
