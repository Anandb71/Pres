// ============================================================
//  PResolution — Commit Engine Tests (mocked GitHub API)
// ============================================================

import { describe, it, expect, vi } from "vitest";
import type { PRContext } from "../src/types.js";

describe("commitFix", () => {
    const mockPRContext: PRContext = {
        owner: "testowner",
        repo: "testrepo",
        pullNumber: 42,
        title: "Fix user lookup",
        description: "",
        headBranch: "fix/user-lookup",
        headRef: "refs/heads/fix/user-lookup",
        headSha: "abc123",
        reviewComment: "Add null check",
        filePath: "src/users.ts",
        fileContent: "old content",
        diffHunk: "",
        reviewer: "reviewer1",
    };

    it("executes the full blob → tree → commit → ref update flow", async () => {
        // Create mock Octokit with rest.git namespace (matching Probot's Octokit)
        const gitMock = {
            getRef: vi.fn().mockResolvedValue({
                data: { object: { sha: "ref-sha-123" } },
            }),
            getCommit: vi.fn().mockResolvedValue({
                data: { tree: { sha: "tree-sha-456" } },
            }),
            createBlob: vi.fn().mockResolvedValue({
                data: { sha: "blob-sha-789" },
            }),
            createTree: vi.fn().mockResolvedValue({
                data: { sha: "new-tree-sha-abc" },
            }),
            createCommit: vi.fn().mockResolvedValue({
                data: { sha: "new-commit-sha-def" },
            }),
            updateRef: vi.fn().mockResolvedValue({
                data: { ref: "refs/heads/fix/user-lookup" },
            }),
        };

        const mockOctokit = {
            rest: { git: gitMock },
        };

        const mockContext = {
            octokit: mockOctokit,
            repo: () => ({ owner: "testowner", repo: "testrepo" }),
        };

        const { commitFix } = await import("../src/commitEngine.js");
        const result = await commitFix(
            mockContext as any,
            mockPRContext,
            "fixed content here",
            "Added null check"
        );

        // Verify success
        expect(result.success).toBe(true);
        expect(result.commitSha).toBe("new-commit-sha-def");
        expect(result.commitUrl).toContain("new-commit-sha-def");

        // Verify the full API call chain
        expect(gitMock.getRef).toHaveBeenCalledWith({
            owner: "testowner",
            repo: "testrepo",
            ref: "heads/fix/user-lookup",
        });

        expect(gitMock.getCommit).toHaveBeenCalledWith({
            owner: "testowner",
            repo: "testrepo",
            commit_sha: "ref-sha-123",
        });

        expect(gitMock.createBlob).toHaveBeenCalledWith({
            owner: "testowner",
            repo: "testrepo",
            content: Buffer.from("fixed content here").toString("base64"),
            encoding: "base64",
        });

        expect(gitMock.createTree).toHaveBeenCalledWith({
            owner: "testowner",
            repo: "testrepo",
            base_tree: "tree-sha-456",
            tree: [
                {
                    path: "src/users.ts",
                    mode: "100644",
                    type: "blob",
                    sha: "blob-sha-789",
                },
            ],
        });

        expect(gitMock.createCommit).toHaveBeenCalledWith(
            expect.objectContaining({
                owner: "testowner",
                repo: "testrepo",
                tree: "new-tree-sha-abc",
                parents: ["ref-sha-123"],
            })
        );

        expect(gitMock.updateRef).toHaveBeenCalledWith({
            owner: "testowner",
            repo: "testrepo",
            ref: "heads/fix/user-lookup",
            sha: "new-commit-sha-def",
        });
    });

    it("handles API errors gracefully", async () => {
        const mockOctokit = {
            rest: {
                git: {
                    getRef: vi.fn().mockRejectedValue(new Error("Not Found")),
                },
            },
        };

        const mockContext = {
            octokit: mockOctokit,
            repo: () => ({ owner: "testowner", repo: "testrepo" }),
        };

        const { commitFix } = await import("../src/commitEngine.js");
        const result = await commitFix(
            mockContext as any,
            mockPRContext,
            "fixed content",
            "fix"
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain("Not Found");
    });
});
