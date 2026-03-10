// ============================================================
//  PResolution — Shared Type Definitions
// ============================================================

/**
 * A parsed command extracted from a GitHub comment body.
 */
export interface ParsedCommand {
    /** The action to perform: 'fix', 'resolve', 'explain' */
    action: "fix" | "resolve" | "explain";
    /** Raw comment body that triggered the command */
    triggerComment: string;
    /** Whether the command was found as a reply to a review comment */
    isReviewReply: boolean;
    /** Optional extra instructions from the user (text after the command) */
    instructions?: string;
}

/**
 * Context fetched from the PR for the AI to work with.
 */
export interface PRContext {
    /** Repository owner */
    owner: string;
    /** Repository name */
    repo: string;
    /** PR number */
    pullNumber: number;
    /** PR title */
    title: string;
    /** PR description/body */
    description: string;
    /** The branch the PR is merging from */
    headBranch: string;
    /** The full ref (e.g., refs/heads/feature-branch) */
    headRef: string;
    /** SHA of the head commit on the PR branch */
    headSha: string;
    /** The reviewer's comment text (the feedback to fix) */
    reviewComment: string;
    /** The file path the comment is about */
    filePath: string;
    /** The full content of the file being discussed */
    fileContent: string;
    /** The relevant diff hunk for the file */
    diffHunk: string;
    /** The specific line(s) the comment references */
    commentLine?: number;
    /** The commenter's username */
    reviewer: string;
}

/**
 * Response from the AI engine after generating a fix.
 */
export interface AIResponse {
    /** Whether the fix was successfully generated */
    success: boolean;
    /** The corrected full file content */
    fixedContent?: string;
    /** A brief explanation of what was changed */
    explanation?: string;
    /** Error message if generation failed */
    error?: string;
    /** The AI model used */
    model: string;
    /** Tokens used (if available) */
    tokensUsed?: number;
}

/**
 * Result of committing the fix to GitHub.
 */
export interface CommitResult {
    /** Whether the commit was successful */
    success: boolean;
    /** The SHA of the new commit */
    commitSha?: string;
    /** The commit URL on GitHub */
    commitUrl?: string;
    /** Error message if commit failed */
    error?: string;
}

/**
 * Activity log entry for the dashboard.
 */
export interface ActivityEntry {
    id: string;
    timestamp: Date;
    repo: string;
    pullNumber: number;
    reviewer: string;
    filePath: string;
    status: "processing" | "success" | "failed";
    commitSha?: string;
    commitUrl?: string;
    error?: string;
    processingTimeMs?: number;
}
