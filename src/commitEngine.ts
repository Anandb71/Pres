// ============================================================
//  PResolution — Git Commit Engine
//  Creates commits via GitHub's Git Database API
//  Flow: Get Ref → Create Blob → Create Tree → Create Commit → Update Ref
// ============================================================

import type { Context } from "probot";
import type { PRContext, CommitResult } from "./types.js";

type BotContext =
    | Context<"issue_comment.created">
    | Context<"pull_request_review_comment.created">;

/**
 * Commit a fixed file to the PR's branch using the Git Database API.
 *
 * This uses the low-level Git API to create proper commits without
 * needing a local git clone. The flow is:
 *
 * 1. Get the latest commit SHA on the PR branch
 * 2. Get the base tree SHA from that commit
 * 3. Create a new blob with the fixed file content
 * 4. Create a new tree that references the base tree + new blob
 * 5. Create a new commit pointing to the new tree
 * 6. Update the branch ref to point to the new commit
 *
 * @param context - Probot webhook context (provides authenticated Octokit)
 * @param prContext - PR context with branch info
 * @param fixedContent - The corrected file content to commit
 * @param explanation - Brief description of the fix for the commit message
 */
export async function commitFix(
    context: BotContext,
    prContext: PRContext,
    fixedContent: string,
    explanation: string = "Applied reviewer's suggested fix"
): Promise<CommitResult> {
    const { owner, repo, headBranch, filePath, reviewer } = prContext;
    const octokit = context.octokit;

    try {
        // ──────────────────────────────────────────────
        // Step 1: Get the latest commit on the PR branch
        // ──────────────────────────────────────────────
        const { data: refData } = await octokit.rest.git.getRef({
            owner,
            repo,
            ref: `heads/${headBranch}`,
        });
        const latestCommitSha = refData.object.sha;

        // ──────────────────────────────────────────────
        // Step 2: Get the base tree from the latest commit
        // ──────────────────────────────────────────────
        const { data: commitData } = await octokit.rest.git.getCommit({
            owner,
            repo,
            commit_sha: latestCommitSha,
        });
        const baseTreeSha = commitData.tree.sha;

        // ──────────────────────────────────────────────
        // Step 3: Create a blob with the fixed file content
        // ──────────────────────────────────────────────
        const { data: blobData } = await octokit.rest.git.createBlob({
            owner,
            repo,
            content: Buffer.from(fixedContent).toString("base64"),
            encoding: "base64",
        });

        // ──────────────────────────────────────────────
        // Step 4: Create a new tree with the updated file
        // ──────────────────────────────────────────────
        const { data: treeData } = await octokit.rest.git.createTree({
            owner,
            repo,
            base_tree: baseTreeSha,
            tree: [
                {
                    path: filePath,
                    mode: "100644", // Regular file
                    type: "blob",
                    sha: blobData.sha,
                },
            ],
        });

        // ──────────────────────────────────────────────
        // Step 5: Create the commit
        // ──────────────────────────────────────────────
        const commitMessage = buildCommitMessage(filePath, reviewer, explanation);

        const { data: newCommit } = await octokit.rest.git.createCommit({
            owner,
            repo,
            message: commitMessage,
            tree: treeData.sha,
            parents: [latestCommitSha],
        });

        // ──────────────────────────────────────────────
        // Step 6: Update the branch reference
        // ──────────────────────────────────────────────
        await octokit.rest.git.updateRef({
            owner,
            repo,
            ref: `heads/${headBranch}`,
            sha: newCommit.sha,
        });

        const commitUrl = `https://github.com/${owner}/${repo}/commit/${newCommit.sha}`;

        return {
            success: true,
            commitSha: newCommit.sha,
            commitUrl,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: `Failed to commit fix: ${message}`,
        };
    }
}

/**
 * Build a descriptive commit message.
 */
function buildCommitMessage(
    filePath: string,
    reviewer: string,
    explanation: string
): string {
    const fileName = filePath.split("/").pop() || filePath;
    return [
        `fix: resolve review feedback on ${fileName}`,
        "",
        explanation,
        "",
        `Co-authored-by: PResolution Bot <presolution[bot]@users.noreply.github.com>`,
        `Reviewed-by: @${reviewer}`,
    ].join("\n");
}
