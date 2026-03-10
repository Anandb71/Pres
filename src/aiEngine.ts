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
        const userPrompt = buildPrompt(prContext);
        const generated = await generateWithProvider(userPrompt);
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
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: AI_MODEL,
                temperature: 0.1,
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
function buildPrompt(ctx: PRContext): string {
    let prompt = `## PR: ${ctx.title}\n`;

    if (ctx.description) {
        prompt += `### Description\n${ctx.description}\n\n`;
    }

    prompt += `## File: \`${ctx.filePath}\`\n\n`;
    prompt += `### Current File Content\n\`\`\`\n${ctx.fileContent}\n\`\`\`\n\n`;

    if (ctx.diffHunk) {
        prompt += `### Relevant Diff\n\`\`\`diff\n${ctx.diffHunk}\n\`\`\`\n\n`;
    }

    if (ctx.commentLine) {
        prompt += `### Comment Location\nLine ${ctx.commentLine}\n\n`;
    }

    prompt += `### Reviewer's Feedback (@${ctx.reviewer})\n${ctx.reviewComment}\n\n`;
    prompt += `## Task\nApply the reviewer's feedback and return the COMPLETE corrected file content. Return ONLY the code, no explanations or markdown fences.`;

    return prompt;
}

/**
 * Try to extract a brief explanation from the AI's response.
 * If the AI included comments about what it changed, capture those.
 */
function extractExplanation(_fullResponse: string, _fixedContent: string): string {
    return "Applied reviewer's suggested fix.";
}
