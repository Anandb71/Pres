// ============================================================
//  PResolution — Utility Functions
// ============================================================

import type { ActivityEntry } from "./types.js";

/**
 * In-memory activity log (in production, this would be a database)
 */
const activityLog: ActivityEntry[] = [];
const MAX_LOG_SIZE = 500;

/**
 * Add an activity entry to the log.
 */
export function logActivity(entry: ActivityEntry): void {
    activityLog.unshift(entry);
    if (activityLog.length > MAX_LOG_SIZE) {
        activityLog.pop();
    }
}

/**
 * Update an existing activity entry by ID.
 */
export function updateActivity(
    id: string,
    updates: Partial<ActivityEntry>
): void {
    const entry = activityLog.find((e) => e.id === id);
    if (entry) {
        Object.assign(entry, updates);
    }
}

/**
 * Get the activity log (most recent first).
 */
export function getActivityLog(limit: number = 50): ActivityEntry[] {
    return activityLog.slice(0, limit);
}

/**
 * Get aggregated stats from the activity log.
 */
export function getStats(): {
    totalFixes: number;
    successRate: number;
    avgTimeMs: number;
    reposServed: number;
} {
    const completed = activityLog.filter((e) => e.status !== "processing");
    const successes = completed.filter((e) => e.status === "success");
    const times = successes
        .map((e) => e.processingTimeMs)
        .filter((t): t is number => t !== undefined);

    return {
        totalFixes: completed.length,
        successRate:
            completed.length > 0
                ? Math.round((successes.length / completed.length) * 100)
                : 0,
        avgTimeMs:
            times.length > 0
                ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
                : 0,
        reposServed: new Set(activityLog.map((e) => e.repo)).size,
    };
}

/**
 * Generate a unique ID for activity entries.
 */
export function generateId(): string {
    return `pr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Extract the file path from a diff hunk header.
 * e.g., "diff --git a/src/utils.ts b/src/utils.ts" → "src/utils.ts"
 */
export function extractFilePathFromDiff(diffLine: string): string | null {
    const match = diffLine.match(/^diff --git a\/(.+) b\/(.+)$/);
    return match ? match[2] : null;
}

/**
 * Strip markdown code fences from AI response.
 * The AI sometimes wraps code in ```lang ... ``` blocks.
 */
export function stripCodeFences(content: string): string {
    // Match opening fence with optional language
    const fencePattern = /^```[\w]*\n?([\s\S]*?)\n?```$/;
    const match = content.trim().match(fencePattern);
    return match ? match[1] : content;
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
export function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Truncate a string to a maximum length, adding an ellipsis if needed.
 */
export function truncate(str: string, maxLength: number = 100): string {
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + "...";
}

/**
 * Safe base64 decode for GitHub API responses.
 */
export function decodeBase64(encoded: string): string {
    return Buffer.from(encoded, "base64").toString("utf-8");
}
