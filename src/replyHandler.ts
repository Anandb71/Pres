// ============================================================
//  PResolution — Reply Handler
//  Posts status comments and reactions back to the PR
// ============================================================

import type { Context } from "probot";
import type { CommitResult } from "./types.js";
import { formatDuration } from "./utils.js";

type BotContext =
    | Context<"issue_comment.created">
    | Context<"pull_request_review_comment.created">;

/**
 * Add a reaction to the trigger comment (quick visual feedback).
 */
export async function addReaction(
    context: BotContext,
    reaction: "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket" | "eyes"
): Promise<void> {
    try {
        const owner = context.payload.repository.owner.login;
        const repo = context.payload.repository.name;
        const commentId = context.payload.comment.id;

        if ("issue" in context.payload) {
            await context.octokit.rest.reactions.createForIssueComment({
                owner,
                repo,
                comment_id: commentId,
                content: reaction,
            });
        } else {
            await context.octokit.rest.reactions.createForPullRequestReviewComment({
                owner,
                repo,
                comment_id: commentId,
                content: reaction,
            });
        }
    } catch {
        // Reactions are nice-to-have, don't fail on them
    }
}

/**
 * Post a "processing" status comment on the PR.
 */
export async function postProcessingComment(
    context: BotContext,
    pullNumber: number
): Promise<number | undefined> {
    try {
        const owner = context.payload.repository.owner.login;
        const repo = context.payload.repository.name;
        const { data: comment } = await context.octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: pullNumber,
            body: [
                "## 🔄 PResolution — Processing",
                "",
                "I'm analyzing the review feedback and generating a fix...",
                "",
                "<details>",
                "<summary>What I'm doing</summary>",
                "",
                "1. 📖 Reading the review comment",
                "2. 📂 Fetching the file content and diff",
                "3. 🧠 Sending context to AI for analysis",
                "4. ✍️ Generating the corrected code",
                "5. 📦 Committing the fix to this branch",
                "",
                "</details>",
                "",
                "_This usually takes 10-30 seconds..._",
            ].join("\n"),
        });
        return comment.id;
    } catch {
        return undefined;
    }
}

/**
 * Update the processing comment with a success result.
 */
export async function postSuccessComment(
    context: BotContext,
    pullNumber: number,
    commentId: number | undefined,
    result: CommitResult,
    filePath: string,
    processingTimeMs: number
): Promise<void> {
    const body = [
        "## ✅ PResolution — Fix Committed!",
        "",
        `I've applied the fix and committed it to this branch.`,
        "",
        "| Detail | Value |",
        "|--------|-------|",
        `| **File** | \`${filePath}\` |`,
        `| **Commit** | [\`${result.commitSha?.slice(0, 7)}\`](${result.commitUrl}) |`,
        `| **Time** | ${formatDuration(processingTimeMs)} |`,
        "",
        "> 💡 **Tip:** Review the commit to make sure the fix looks correct. If it's not quite right, leave another comment and I'll try again!",
    ].join("\n");

    await updateOrCreateComment(context, pullNumber, commentId, body);
}

/**
 * Post a failure comment on the PR.
 */
export async function postFailureComment(
    context: BotContext,
    pullNumber: number,
    commentId: number | undefined,
    error: string,
    processingTimeMs: number
): Promise<void> {
    const body = [
        "## ❌ PResolution — Fix Failed",
        "",
        "I wasn't able to generate a fix for this review comment.",
        "",
        `**Reason:** ${error}`,
        "",
        `_Processing time: ${formatDuration(processingTimeMs)}_`,
        "",
        "> 💡 **Tips:**",
        "> - Make sure the review comment clearly describes the issue",
        "> - Try adding specific instructions: `@PResolve /fix add a null check before the loop`",
        "> - Check that I have write access to this repository",
    ].join("\n");

    await updateOrCreateComment(context, pullNumber, commentId, body);
}

/**
 * Update an existing comment or create a new one.
 */
async function updateOrCreateComment(
    context: BotContext,
    pullNumber: number,
    commentId: number | undefined,
    body: string
): Promise<void> {
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;

    try {
        if (commentId) {
            await context.octokit.rest.issues.updateComment({
                owner,
                repo,
                comment_id: commentId,
                body,
            });
        } else {
            await context.octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: pullNumber,
                body,
            });
        }
    } catch {
        // Last resort: try to create a new comment
        try {
            await context.octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: pullNumber,
                body,
            });
        } catch {
            // If we can't even create a comment, there's nothing we can do
        }
    }
}
