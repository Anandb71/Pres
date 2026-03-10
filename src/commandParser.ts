// ============================================================
//  PResolution — Command Parser
//  Detects trigger commands in GitHub PR comments
// ============================================================

import type { ParsedCommand } from "./types.js";

/**
 * Bot mention patterns — matches @PResolve or @presolution (case-insensitive)
 */
const BOT_MENTION_PATTERN =
    /(?:@presol(?:ve|ution))\s+\/(fix|resolve|explain)/i;

/**
 * Standalone command pattern — matches /fix, /resolve, /explain directly
 */
const STANDALONE_COMMAND_PATTERN = /^\s*\/(fix|resolve|explain)\b/im;

/**
 * Parse a comment body and extract the bot command if present.
 *
 * Supported patterns:
 *   @PResolve /fix
 *   @PResolve /resolve
 *   @PResolve /explain
 *   /fix (standalone)
 *   /resolve (standalone)
 *   /explain (standalone)
 *
 * @param commentBody - The raw comment text from GitHub
 * @param isReviewReply - Whether this comment is a reply to a review comment
 * @returns ParsedCommand if a valid command was detected, null otherwise
 */
export function parseCommand(
    commentBody: string,
    isReviewReply: boolean = false
): ParsedCommand | null {
    if (!commentBody || typeof commentBody !== "string") {
        return null;
    }

    const trimmed = commentBody.trim();

    // Try bot mention first (higher priority)
    const mentionMatch = trimmed.match(BOT_MENTION_PATTERN);
    if (mentionMatch) {
        const action = mentionMatch[1].toLowerCase() as ParsedCommand["action"];
        const instructions = extractInstructions(
            trimmed,
            mentionMatch.index! + mentionMatch[0].length
        );

        return {
            action,
            triggerComment: trimmed,
            isReviewReply,
            ...(instructions && { instructions }),
        };
    }

    // Try standalone command
    const standaloneMatch = trimmed.match(STANDALONE_COMMAND_PATTERN);
    if (standaloneMatch) {
        const action = standaloneMatch[1].toLowerCase() as ParsedCommand["action"];
        const instructions = extractInstructions(
            trimmed,
            standaloneMatch.index! + standaloneMatch[0].length
        );

        return {
            action,
            triggerComment: trimmed,
            isReviewReply,
            ...(instructions && { instructions }),
        };
    }

    return null;
}

/**
 * Extract any additional instructions that follow the command.
 * e.g., "@PResolve /fix also add a null check" → "also add a null check"
 */
function extractInstructions(body: string, commandEndIndex: number): string | undefined {
    const rest = body.slice(commandEndIndex).trim();
    return rest.length > 0 ? rest : undefined;
}

/**
 * Quick check if a comment body might contain a bot command.
 * Use this for fast filtering before full parsing.
 */
export function mightBeCommand(commentBody: string): boolean {
    if (!commentBody) return false;
    const lower = commentBody.toLowerCase();
    return (
        lower.includes("/fix") ||
        lower.includes("/resolve") ||
        lower.includes("/explain") ||
        lower.includes("@presolve") ||
        lower.includes("@presolution")
    );
}
