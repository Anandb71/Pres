// ============================================================
//  PResolution — Utility Function Tests
// ============================================================

import { describe, it, expect } from "vitest";
import {
    stripCodeFences,
    formatDuration,
    truncate,
    decodeBase64,
    extractFilePathFromDiff,
    generateId,
    logActivity,
    getActivityLog,
    getStats,
} from "../src/utils.js";

describe("stripCodeFences", () => {
    it("strips ```typescript fences", () => {
        const input = '```typescript\nconst x = 1;\n```';
        expect(stripCodeFences(input)).toBe("const x = 1;");
    });

    it("strips ``` fences with no language", () => {
        const input = '```\nconst x = 1;\n```';
        expect(stripCodeFences(input)).toBe("const x = 1;");
    });

    it("returns content unchanged if no fences", () => {
        const input = "const x = 1;";
        expect(stripCodeFences(input)).toBe("const x = 1;");
    });

    it("handles multi-line content inside fences", () => {
        const input = '```js\nline1\nline2\nline3\n```';
        expect(stripCodeFences(input)).toBe("line1\nline2\nline3");
    });
});

describe("formatDuration", () => {
    it("formats milliseconds", () => {
        expect(formatDuration(500)).toBe("500ms");
    });

    it("formats seconds", () => {
        expect(formatDuration(12300)).toBe("12.3s");
    });

    it("formats minutes", () => {
        expect(formatDuration(90000)).toBe("1.5m");
    });
});

describe("truncate", () => {
    it("returns short strings unchanged", () => {
        expect(truncate("hello", 10)).toBe("hello");
    });

    it("truncates long strings with ellipsis", () => {
        expect(truncate("hello world this is a long string", 15)).toBe(
            "hello world ..."
        );
    });
});

describe("decodeBase64", () => {
    it("decodes base64 to UTF-8", () => {
        const encoded = Buffer.from("Hello, World!").toString("base64");
        expect(decodeBase64(encoded)).toBe("Hello, World!");
    });
});

describe("extractFilePathFromDiff", () => {
    it("extracts file path from git diff line", () => {
        expect(
            extractFilePathFromDiff("diff --git a/src/utils.ts b/src/utils.ts")
        ).toBe("src/utils.ts");
    });

    it("returns null for non-diff lines", () => {
        expect(extractFilePathFromDiff("some random text")).toBeNull();
    });
});

describe("generateId", () => {
    it("generates unique IDs", () => {
        const id1 = generateId();
        const id2 = generateId();
        expect(id1).not.toBe(id2);
        expect(id1).toMatch(/^pr_\d+_\w+$/);
    });
});

describe("Activity Log", () => {
    it("logs and retrieves activities", () => {
        logActivity({
            id: "test-1",
            timestamp: new Date(),
            repo: "owner/repo",
            pullNumber: 1,
            reviewer: "user1",
            filePath: "test.ts",
            status: "success",
            processingTimeMs: 5000,
        });

        const log = getActivityLog(10);
        expect(log.length).toBeGreaterThan(0);
        expect(log[0].id).toBe("test-1");
    });

    it("returns stats correctly", () => {
        const stats = getStats();
        expect(stats).toHaveProperty("totalFixes");
        expect(stats).toHaveProperty("successRate");
        expect(stats).toHaveProperty("avgTimeMs");
        expect(stats).toHaveProperty("reposServed");
    });
});
