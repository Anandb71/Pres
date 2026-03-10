// ============================================================
//  PResolution — AI Engine Tests
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PRContext } from "../src/types.js";

// Mock the Google Generative AI module
vi.mock("@google/generative-ai", () => {
    return {
        GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
            getGenerativeModel: vi.fn().mockReturnValue({
                generateContent: vi.fn().mockResolvedValue({
                    response: {
                        text: () =>
                            'function getUser(id) {\n  if (!id) return null;\n  return users.find(u => u.id === id);\n}',
                        usageMetadata: { totalTokenCount: 150 },
                    },
                }),
            }),
        })),
    };
});

describe("generateFix", () => {
    const basePRContext: PRContext = {
        owner: "testowner",
        repo: "testrepo",
        pullNumber: 42,
        title: "Fix user lookup",
        description: "Improves user lookup function",
        headBranch: "fix/user-lookup",
        headRef: "refs/heads/fix/user-lookup",
        headSha: "abc123",
        reviewComment: "This will crash if id is null",
        filePath: "src/users.ts",
        fileContent:
            'function getUser(id) {\n  return users.find(u => u.id === id);\n}',
        diffHunk: "@@ -1,3 +1,3 @@\n function getUser(id) {",
        reviewer: "reviewer1",
    };

    beforeEach(() => {
        vi.stubEnv("GEMINI_API_KEY", "test-api-key");
    });

    it("generates a fix successfully", async () => {
        // Dynamic import after mocking
        const { generateFix } = await import("../src/aiEngine.js");
        const result = await generateFix(basePRContext);

        expect(result.success).toBe(true);
        expect(result.fixedContent).toBeDefined();
        expect(result.model).toBeDefined();
    });

    it("fails when no API key is set", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        // Re-import to pick up env change
        const { generateFix } = await import("../src/aiEngine.js");
        const result = await generateFix(basePRContext);

        expect(result.success).toBe(false);
        expect(result.error).toContain("GEMINI_API_KEY");
    });

    it("fails when file content is empty", async () => {
        const { generateFix } = await import("../src/aiEngine.js");
        const contextNoFile = { ...basePRContext, fileContent: "" };
        const result = await generateFix(contextNoFile);

        expect(result.success).toBe(false);
        expect(result.error).toContain("file content");
    });
});
