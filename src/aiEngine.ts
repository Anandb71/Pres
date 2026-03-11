// ============================================================
//  PResolution — AI Engine
//  Sends PR context to an LLM and parses the code fix response
// ============================================================

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { PRContext, AIResponse } from "./types.js";
import { stripCodeFences } from "./utils.js";

/**
 * The AI model to use for generating fixes.
 */
const AI_PROVIDER = (process.env.AI_PROVIDER || "gemini").toLowerCase();
const AI_MODEL = process.env.AI_MODEL || (AI_PROVIDER === "gemini" ? "gemini-2.0-flash" : "gpt-4o-mini");
const MAX_REQUEST_TOKENS = Number(process.env.MAX_REQUEST_TOKENS ?? 7800);
const RESERVE_OUTPUT_TOKENS = Number(process.env.RESERVE_OUTPUT_TOKENS ?? 1600);
const MIN_OUTPUT_TOKENS = Number(process.env.MIN_OUTPUT_TOKENS ?? 512);

/**
 * System prompt that instructs the AI how to behave.
 */
const SYSTEM_PROMPT = `You are PResolution, an expert AI code assistant that fixes code based on pull request review feedback.

Your role:
- You receive a file's source code, the relevant diff, and a reviewer's feedback comment.
- You must generate the CORRECTED version of the ENTIRE file.
- Apply the fix described in the reviewer's feedback precisely.
- Maintain the existing code style, indentation, and conventions.
- Do NOT add unnecessary changes beyond what the reviewer requested.
- Do NOT include any explanation, markdown formatting, or code fences in your response.
- Return ONLY the complete, corrected file content — nothing else.

Rules:
1. If the reviewer's comment suggests a specific fix, implement exactly that.
2. If the comment identifies a bug without specifying the fix, use your expertise to write the best fix.
3. Preserve all existing functionality that isn't related to the fix.
4. Ensure the fixed code compiles/runs correctly.
5. Never remove or modify unrelated code.`;

/**
 * Generate a code fix using the AI model.
 *
 * @param prContext - The complete PR context including file content and review comment
 * @returns AIResponse with the fixed file content
 */
export async function generateFix(prContext: PRContext): Promise<AIResponse> {
    if (!prContext.fileContent) {
        return {
            success: false,
            error: "Could not fetch the file content. The file may not exist or may be binary.",
            model: AI_MODEL,
        };
    }

    try {
        const fullPrompt = buildPrompt(prContext, {
            includeDescription: true,
            includeDiff: true,
            compact: false,
        });

        console.info(
            `[AI ENGINE] Sending prompt to provider=${AI_PROVIDER} model=${AI_MODEL} file=${prContext.filePath}`
        );

        let generated: { text: string; tokensUsed?: number };
        try {
            generated = await generateWithProvider(fullPrompt);
        } catch (firstError) {
            const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
            if (!isRequestTooLargeError(firstMessage)) {
                throw firstError;
            }

            console.warn("[AI ENGINE] Request too large; retrying with compact prompt");
            const compactPrompt = buildPrompt(prContext, {
                includeDescription: false,
                includeDiff: false,
                compact: true,
            });
            try {
                generated = await generateWithProvider(compactPrompt);
            } catch (secondError) {
                const secondMessage = secondError instanceof Error ? secondError.message : String(secondError);
                if (!isRequestTooLargeError(secondMessage)) {
                    throw secondError;
                }

                if (!prContext.commentLine) {
                    throw secondError;
                }

                console.warn("[AI ENGINE] Compact prompt still too large; retrying with targeted line-fix prompt");
                const linePrompt = buildLineFixPrompt(prContext);
                const lineGenerated = await generateWithProvider(linePrompt);
                const fixedContent = applyTargetLineFix(
                    prContext.fileContent,
                    prContext.commentLine,
                    lineGenerated.text
                );

                return {
                    success: true,
                    fixedContent,
                    explanation: "Applied targeted line fix from reviewer feedback.",
                    model: AI_MODEL,
                    tokensUsed: lineGenerated.tokensUsed,
                };
            }
        }

        const text = generated.text;

        if (!text || text.trim().length === 0) {
            return {
                success: false,
                error: "AI returned an empty response. The review comment may be unclear.",
                model: AI_MODEL,
            };
        }

        // Strip any accidental code fences the AI might have added
        const fixedContent = stripCodeFences(text);

        // Basic validation: the fix should be roughly the same size as the original
        const originalLines = prContext.fileContent.split("\n").length;
        const fixedLines = fixedContent.split("\n").length;
        const ratio = fixedLines / originalLines;

        if (ratio < 0.3 || ratio > 5) {
            return {
                success: false,
                error: `AI response seems invalid — line count changed dramatically (${originalLines} → ${fixedLines}). This might indicate the AI misunderstood the task.`,
                model: AI_MODEL,
            };
        }

        return {
            success: true,
            fixedContent,
            explanation: extractExplanation(text, fixedContent),
            model: AI_MODEL,
            tokensUsed: generated.tokensUsed,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[AI ENGINE CRASH] ${message}`);
        return {
            success: false,
            error: `AI generation failed: ${message}`,
            model: AI_MODEL,
        };
    }
}

async function generateWithProvider(userPrompt: string): Promise<{ text: string; tokensUsed?: number }> {
    switch (AI_PROVIDER) {
        case "gemini": {
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) {
                throw new Error("GEMINI_API_KEY is not configured. Please set it in your environment variables.");
            }

            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
                model: AI_MODEL,
                systemInstruction: SYSTEM_PROMPT,
            });

            const result = await model.generateContent(userPrompt);
            const response = result.response;
            return {
                text: response.text(),
                tokensUsed: response.usageMetadata?.totalTokenCount,
            };
        }

        case "openai":
        case "openai-compatible":
        case "github-models": {
            const baseUrl =
                AI_PROVIDER === "github-models"
                    ? process.env.OPENAI_BASE_URL || "https://models.inference.ai.azure.com"
                    : process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

            const apiKey =
                AI_PROVIDER === "github-models"
                    ? process.env.GITHUB_TOKEN || process.env.OPENAI_API_KEY
                    : process.env.OPENAI_API_KEY;

            if (!apiKey) {
                throw new Error(
                    AI_PROVIDER === "github-models"
                        ? "GITHUB_TOKEN (or OPENAI_API_KEY) is not configured for github-models provider."
                        : "OPENAI_API_KEY is not configured. Please set it in your environment variables."
                );
            }

            return await generateWithOpenAICompatible(baseUrl, apiKey, userPrompt);
        }

        default:
            throw new Error(
                `Unsupported AI_PROVIDER: ${AI_PROVIDER}. Use one of: gemini, openai, openai-compatible, github-models.`
            );
    }
}

async function generateWithOpenAICompatible(
    baseUrl: string,
    apiKey: string,
    userPrompt: string
): Promise<{ text: string; tokensUsed?: number }> {
    const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);

    try {
        const promptTokensEstimate = estimateTokens(userPrompt);
        const maxOutputTokens = Math.max(
            MIN_OUTPUT_TOKENS,
            Math.min(RESERVE_OUTPUT_TOKENS, MAX_REQUEST_TOKENS - promptTokensEstimate)
        );

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: AI_MODEL,
                temperature: 0.1,
                max_tokens: maxOutputTokens,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: userPrompt },
                ],
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Provider request failed (${response.status}): ${body.slice(0, 400)}`);
        }

        const json = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: { total_tokens?: number };
        };

        const text = json.choices?.[0]?.message?.content || "";
        return {
            text,
            tokensUsed: json.usage?.total_tokens,
        };
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Build the user prompt with all the context the AI needs.
 */
function buildPrompt(
    ctx: PRContext,
    options: { includeDescription: boolean; includeDiff: boolean; compact: boolean }
): string {
    let prompt = `## PR: ${ctx.title}\n`;

    if (options.includeDescription && ctx.description) {
        prompt += `### Description\n${ctx.description}\n\n`;
    }

    prompt += `## File: \`${ctx.filePath}\`\n\n`;
    prompt += `### Current File Content\n\`\`\`\n${ctx.fileContent}\n\`\`\`\n\n`;

    if (options.includeDiff && ctx.diffHunk) {
        prompt += `### Relevant Diff\n\`\`\`diff\n${ctx.diffHunk}\n\`\`\`\n\n`;
    }

    if (ctx.commentLine) {
        prompt += `### Comment Location\nLine ${ctx.commentLine}\n\n`;
    }

    prompt += `### Reviewer's Feedback (@${ctx.reviewer})\n${ctx.reviewComment}\n\n`;
    prompt += options.compact
        ? "## Task\nApply only the requested fix and return ONLY the complete corrected file content. No markdown or explanations."
        : "## Task\nApply the reviewer's feedback and return the COMPLETE corrected file content. Return ONLY the code, no explanations or markdown fences.";

    return prompt;
}

function buildLineFixPrompt(ctx: PRContext): string {
    const window = extractLineWindow(ctx.fileContent, ctx.commentLine ?? 1, 25);
    return [
        `## File: ${ctx.filePath}`,
        `## Target line number: ${ctx.commentLine}`,
        "## Reviewer feedback",
        ctx.reviewComment,
        "",
        "## Nearby code (line-numbered)",
        "```",
        window,
        "```",
        "",
        "## Task",
        "Return ONLY the corrected code for the target line number.",
        "Do not include line numbers, markdown, backticks, or explanation.",
        "Preserve indentation exactly.",
    ].join("\n");
}

function extractLineWindow(fileContent: string, lineNumber: number, radius: number): string {
    const lines = fileContent.split("\n");
    const center = Math.max(1, Math.min(lineNumber, lines.length));
    const start = Math.max(1, center - radius);
    const end = Math.min(lines.length, center + radius);

    const numbered: string[] = [];
    for (let i = start; i <= end; i += 1) {
        numbered.push(`${i}: ${lines[i - 1]}`);
    }
    return numbered.join("\n");
}

function applyTargetLineFix(fileContent: string, lineNumber: number, modelOutput: string): string {
    const lines = fileContent.split("\n");
    const idx = lineNumber - 1;
    if (idx < 0 || idx >= lines.length) {
        throw new Error(`Target line ${lineNumber} is out of range for file`);
    }

    const cleaned = stripCodeFences(modelOutput)
        .split("\n")
        .map((line) => line.trimEnd())
        .find((line) => line.trim().length > 0);

    if (!cleaned) {
        throw new Error("Targeted line-fix response was empty");
    }

    lines[idx] = cleaned;
    return lines.join("\n");
}

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function isRequestTooLargeError(message: string): boolean {
    const m = message.toLowerCase();
    return (
        m.includes("request too large") ||
        m.includes("413") ||
        m.includes("tokens per minute") ||
        m.includes("rate_limit_exceeded")
    );
}

/**
 * Try to extract a brief explanation from the AI's response.
 * If the AI included comments about what it changed, capture those.
 */
function extractExplanation(_fullResponse: string, _fixedContent: string): string {
    return "Applied reviewer's suggested fix.";
}
