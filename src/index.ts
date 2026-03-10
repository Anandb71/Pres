// ============================================================
//  PResolution — Main Entry Point
//  The Probot app that orchestrates the entire fix pipeline
// ============================================================

import { Probot, createNodeMiddleware, createProbot, type Context } from "probot";
import express from "express";
import { createDashboardApp } from "./dashboard/server.js";
import { parseCommand, mightBeCommand } from "./commandParser.js";
import { fetchPRContext } from "./contextFetcher.js";
import { generateFix } from "./aiEngine.js";
import { commitFix } from "./commitEngine.js";
import {
    addReaction,
    postProcessingComment,
    postSuccessComment,
    postFailureComment,
} from "./replyHandler.js";
import {
    logActivity,
    updateActivity,
    generateId,
} from "./utils.js";

type BotContext =
    | Context<"issue_comment.created">
    | Context<"pull_request_review_comment.created">;

/**
 * PResolution — Autonomous PR Resolution Agent
 *
 * Listens for PR comments containing trigger commands (@PResolve /fix)
 * and automatically generates code fixes using AI, then commits them
 * directly to the PR branch.
 */
export default function presolution(app: Probot): void {
    app.log.info("🚀 PResolution bot loaded and ready!");

    // ──────────────────────────────────────────────
    // Primary handler: issue_comment.created
    // This fires for ALL issue and PR comments
    // ──────────────────────────────────────────────
    app.on("issue_comment.created", async (context) => {
        const { comment, issue } = context.payload;

        // 1. Quick filter: skip if not a PR comment
        if (!issue.pull_request) {
            return;
        }

        // 2. Quick filter: skip bot comments to prevent loops
        if (comment.user?.type === "Bot") {
            return;
        }

        // 3. Quick filter: skip if comment doesn't look like a command
        if (!mightBeCommand(comment.body)) {
            return;
        }

        // 4. Parse the command
        const command = parseCommand(comment.body, false);
        if (!command) {
            return;
        }

        const pullNumber = issue.number;
        const { owner, repo } = context.repo();
        const repoFullName = `${owner}/${repo}`;

        context.log.info(
            `⚡ Command detected: /${command.action} on PR #${pullNumber} in ${repoFullName}`
        );

        // 5. Handle the command
        if (command.action === "fix" || command.action === "resolve") {
            await handleFixCommand(context, pullNumber, command.instructions);
        } else if (command.action === "explain") {
            await handleExplainCommand(context, pullNumber);
        }
    });

    // ──────────────────────────────────────────────
    // Secondary handler: pull_request_review_comment.created
    // This fires for inline review comments on diffs
    // ──────────────────────────────────────────────
    app.on("pull_request_review_comment.created", async (context) => {
        const { comment, pull_request } = context.payload;

        // Skip bot comments
        if (comment.user?.type === "Bot") return;

        // Check for command
        if (!mightBeCommand(comment.body)) return;

        const command = parseCommand(comment.body, true);
        if (!command) return;

        const reviewCommentId = comment.in_reply_to_id ?? comment.id;

        if (command.action === "fix" || command.action === "resolve") {
            const pullNumber = pull_request.number;
            context.log.info(
                `⚡ Review comment command: /${command.action} on PR #${pullNumber}`
            );
            // For review-replies, use the parent review comment as the fix target.
            // If this is a direct review comment command, fall back to this comment's ID.
            await handleFixCommand(
                context,
                pullNumber,
                command.instructions,
                reviewCommentId
            );
        } else if (command.action === "explain") {
            await handleExplainCommand(context, pull_request.number, reviewCommentId);
        }
    });

    app.log.info("✅ Event handlers registered for issue_comment and pull_request_review_comment");
}

// ──────────────────────────────────────────────
// Command Handlers
// ──────────────────────────────────────────────

/**
 * Handle the /fix or /resolve command.
 * Full pipeline: fetch context → generate fix → commit → reply
 */
async function handleFixCommand(
    context: BotContext,
    pullNumber: number,
    instructions?: string,
    reviewCommentId?: number
): Promise<void> {
    const startTime = Date.now();
    const activityId = generateId();
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;

    // Log the activity
    logActivity({
        id: activityId,
        timestamp: new Date(),
        repo: `${owner}/${repo}`,
        pullNumber,
        reviewer: context.payload.comment.user?.login || "unknown",
        filePath: "",
        status: "processing",
    });

    try {
        // React with 👀 to acknowledge
        await addReaction(context, "eyes");

        // Post processing comment
        const processingCommentId = await postProcessingComment(context, pullNumber);

        // Step 1: Fetch PR context
        context.log.info("📖 Fetching PR context...");
        const prContext = await fetchPRContext(context, pullNumber, reviewCommentId);

        // Update activity with file path
        updateActivity(activityId, { filePath: prContext.filePath });

        if (!prContext.filePath) {
            throw new Error(
                "Could not determine which file to fix. Please make sure the review comment is on a specific file."
            );
        }

        // If user provided extra instructions, append them to the review comment
        if (instructions) {
            prContext.reviewComment += `\n\nAdditional instructions: ${instructions}`;
        }

        // Step 2: Generate the fix with AI
        context.log.info(`🧠 Generating fix for ${prContext.filePath}...`);
        const aiResponse = await generateFix(prContext);

        if (!aiResponse.success || !aiResponse.fixedContent) {
            throw new Error(aiResponse.error || "AI failed to generate a fix");
        }

        // Step 3: Commit the fix
        context.log.info("📦 Committing fix...");
        const commitResult = await commitFix(
            context,
            prContext,
            aiResponse.fixedContent,
            aiResponse.explanation || "Applied reviewer's suggested fix"
        );

        if (!commitResult.success) {
            throw new Error(commitResult.error || "Failed to commit the fix");
        }

        // Step 4: Post success comment
        const processingTime = Date.now() - startTime;
        await postSuccessComment(
            context,
            pullNumber,
            processingCommentId,
            commitResult,
            prContext.filePath,
            processingTime
        );

        // React with 🚀
        await addReaction(context, "rocket");

        // Update activity log
        updateActivity(activityId, {
            status: "success",
            commitSha: commitResult.commitSha,
            commitUrl: commitResult.commitUrl,
            processingTimeMs: processingTime,
        });

        context.log.info(
            `✅ Fix committed: ${commitResult.commitSha?.slice(0, 7)} (${processingTime}ms)`
        );
    } catch (error) {
        const processingTime = Date.now() - startTime;
        const message = error instanceof Error ? error.message : String(error);

        context.log.error(`❌ Fix failed: ${message}`);

        await postFailureComment(context, pullNumber, undefined, message, processingTime);
        await addReaction(context, "confused");

        updateActivity(activityId, {
            status: "failed",
            error: message,
            processingTimeMs: processingTime,
        });
    }
}

/**
 * Handle the /explain command.
 * Provides an explanation of the review comment without making changes.
 */
async function handleExplainCommand(
    context: BotContext,
    pullNumber: number,
    reviewCommentId?: number
): Promise<void> {
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;

    try {
        await addReaction(context, "eyes");

        const prContext = await fetchPRContext(context, pullNumber, reviewCommentId);

        await context.octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: pullNumber,
            body: [
                "## 📖 PResolution — Explanation",
                "",
                "Here's my analysis of the review feedback:",
                "",
                `**File:** \`${prContext.filePath}\``,
                `**Reviewer's Comment:** ${prContext.reviewComment}`,
                "",
                "> 💡 Use `@PResolve /fix` to automatically apply a fix based on this feedback.",
            ].join("\n"),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        context.log.error(`❌ Explain failed: ${message}`);
    }
}

// ──────────────────────────────────────────────
// Server startup
// Single Express server combining Probot webhooks
// + dashboard, so Render only needs one port.
// ──────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3000);

(async () => {
    const probot = createProbot();

    // Probot webhook middleware — handles /api/github/webhooks
    const webhookMiddleware = await createNodeMiddleware(presolution, { probot });

    const server = express();
    server.use(webhookMiddleware);
    server.use(createDashboardApp());

    server.listen(PORT, () => {
        probot.log.info(`🚀 PResolution running on port ${PORT}`);
    });
})();
