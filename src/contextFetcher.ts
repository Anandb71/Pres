// ============================================================
//  PResolution — PR Context Fetcher
//  Fetches all necessary data from the PR for the AI engine
// ============================================================

import type { Context } from "probot";
import type { PRContext } from "./types.js";
import { decodeBase64 } from "./utils.js";

type BotContext =
    | Context<"issue_comment.created">
    | Context<"pull_request_review_comment.created">;

/**
 * Fetch complete context from a PR for generating a fix.
 *
 * This includes:
 * - PR metadata (title, description, branch)
 * - The review comment text and thread context
 * - The file content being discussed
 * - The relevant diff hunk
 *
 * @param context - Probot webhook context
 * @param pullNumber - PR number
 * @param commentId - The review comment ID to get context for
 */
export async function fetchPRContext(
    context: BotContext,
    pullNumber: number,
    commentId?: number
): Promise<PRContext> {
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;
    const octokit = context.octokit;

    // 1. Get PR details
    const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
    });

    // 2. Get the comment that triggered the bot + find the review context
    const triggerComment = context.payload.comment;
    let reviewComment = triggerComment.body;
    let filePath = ("path" in triggerComment && typeof triggerComment.path === "string")
        ? triggerComment.path
        : "";
    let diffHunk = ("diff_hunk" in triggerComment && typeof triggerComment.diff_hunk === "string")
        ? triggerComment.diff_hunk
        : "";
    let commentLine: number | undefined =
        ("line" in triggerComment && typeof triggerComment.line === "number" && triggerComment.line > 0
            ? triggerComment.line
            : undefined) ||
        ("original_line" in triggerComment && typeof triggerComment.original_line === "number" && triggerComment.original_line > 0
            ? triggerComment.original_line
            : undefined);
    let reviewer = triggerComment.user?.login || "unknown";

    // 3. If this is a reply to a review comment, get the parent review comment
    if (commentId) {
        try {
            const { data: parentComment } =
                await octokit.rest.pulls.getReviewComment({
                    owner,
                    repo,
                    pull_number: pullNumber,
                    comment_id: commentId,
                });
            reviewComment = parentComment.body;
            filePath = parentComment.path || filePath;
            diffHunk = parentComment.diff_hunk || diffHunk;
            commentLine = parentComment.line || parentComment.original_line || commentLine || undefined;
            reviewer = parentComment.user?.login || reviewer;
        } catch {
            // If we can't get the review comment, fall through to diff-based detection
        }
    }

    // 4. If no file path yet, try to extract from the PR diff
    if (!filePath) {
        const result = await extractFromDiff(octokit, owner, repo, pullNumber, reviewComment);
        filePath = result.filePath;
        diffHunk = result.diffHunk;
    }

    // 5. Fetch the file content from the PR's head branch
    let fileContent = "";
    if (filePath) {
        try {
            const { data: fileData } = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: filePath,
                ref: pr.head.ref,
            });

            if ("content" in fileData && typeof fileData.content === "string") {
                fileContent = decodeBase64(fileData.content);
            }
        } catch {
            // File might not exist or be binary
            fileContent = "";
        }
    }

    return {
        owner,
        repo,
        pullNumber,
        title: pr.title,
        description: pr.body || "",
        headBranch: pr.head.ref,
        headRef: `refs/heads/${pr.head.ref}`,
        headSha: pr.head.sha,
        reviewComment,
        filePath,
        fileContent,
        diffHunk,
        commentLine,
        reviewer,
    };
}

/**
 * Extracts file path and diff hunk from the PR diff based on the comment context.
 */
async function extractFromDiff(
    octokit: Context["octokit"],
    owner: string,
    repo: string,
    pullNumber: number,
    _reviewComment: string
): Promise<{ filePath: string; diffHunk: string }> {
    try {
        const { data: files } = await (octokit as any).rest.pulls.listFiles({
            owner,
            repo,
            pull_number: pullNumber,
        });

        if (files.length === 1) {
            // If only one file changed, that's our target
            return {
                filePath: files[0].filename,
                diffHunk: files[0].patch || "",
            };
        }

        // Return the first file as a fallback (AI will figure it out from context)
        if (files.length > 0) {
            return {
                filePath: files[0].filename,
                diffHunk: files[0].patch || "",
            };
        }
    } catch {
        // Diff fetch failed
    }

    return { filePath: "", diffHunk: "" };
}

/**
 * Fetch the full diff of a PR for multi-file context.
 */
export async function fetchPRDiff(
    octokit: Context["octokit"],
    owner: string,
    repo: string,
    pullNumber: number
): Promise<string> {
    try {
        const { data } = await (octokit as any).rest.pulls.get({
            owner,
            repo,
            pull_number: pullNumber,
            mediaType: { format: "diff" },
        });
        return data as unknown as string;
    } catch {
        return "";
    }
}
