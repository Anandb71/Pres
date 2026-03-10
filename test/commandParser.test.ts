// ============================================================
//  PResolution — Command Parser Tests
// ============================================================

import { describe, it, expect } from "vitest";
import { parseCommand, mightBeCommand } from "../src/commandParser.js";

describe("parseCommand", () => {
    // ── Bot mention patterns ──
    describe("@PResolve mention", () => {
        it("detects @PResolve /fix", () => {
            const result = parseCommand("@PResolve /fix", false);
            expect(result).not.toBeNull();
            expect(result!.action).toBe("fix");
            expect(result!.isReviewReply).toBe(false);
        });

        it("detects @presolve /fix (case insensitive)", () => {
            const result = parseCommand("@presolve /fix", false);
            expect(result).not.toBeNull();
            expect(result!.action).toBe("fix");
        });

        it("detects @PResolve /resolve", () => {
            const result = parseCommand("@PResolve /resolve", false);
            expect(result).not.toBeNull();
            expect(result!.action).toBe("resolve");
        });

        it("detects @PResolve /explain", () => {
            const result = parseCommand("@PResolve /explain", false);
            expect(result).not.toBeNull();
            expect(result!.action).toBe("explain");
        });

        it("captures extra instructions after the command", () => {
            const result = parseCommand(
                "@PResolve /fix also add input validation",
                false
            );
            expect(result).not.toBeNull();
            expect(result!.action).toBe("fix");
            expect(result!.instructions).toBe("also add input validation");
        });

        it("handles @presolution mention variant", () => {
            const result = parseCommand("@presolution /fix", false);
            expect(result).not.toBeNull();
            expect(result!.action).toBe("fix");
        });
    });

    // ── Standalone command patterns ──
    describe("standalone commands", () => {
        it("detects /fix at start of comment", () => {
            const result = parseCommand("/fix", false);
            expect(result).not.toBeNull();
            expect(result!.action).toBe("fix");
        });

        it("detects /fix with leading whitespace", () => {
            const result = parseCommand("  /fix", false);
            expect(result).not.toBeNull();
            expect(result!.action).toBe("fix");
        });

        it("detects /resolve standalone", () => {
            const result = parseCommand("/resolve", false);
            expect(result).not.toBeNull();
            expect(result!.action).toBe("resolve");
        });

        it("detects /explain standalone", () => {
            const result = parseCommand("/explain", false);
            expect(result).not.toBeNull();
            expect(result!.action).toBe("explain");
        });
    });

    // ── Review reply context ──
    describe("review reply context", () => {
        it("sets isReviewReply when passed as true", () => {
            const result = parseCommand("@PResolve /fix", true);
            expect(result).not.toBeNull();
            expect(result!.isReviewReply).toBe(true);
        });
    });

    // ── Non-matching patterns ──
    describe("non-matching patterns", () => {
        it("returns null for empty string", () => {
            expect(parseCommand("", false)).toBeNull();
        });

        it("returns null for null input", () => {
            expect(parseCommand(null as any, false)).toBeNull();
        });

        it("returns null for regular comments", () => {
            expect(parseCommand("Looks good to me!", false)).toBeNull();
        });

        it("returns null for comments mentioning fix without command", () => {
            expect(
                parseCommand("Can you fix this issue please?", false)
            ).toBeNull();
        });

        it("returns null for invalid command", () => {
            expect(parseCommand("@PResolve /deploy", false)).toBeNull();
        });
    });
});

describe("mightBeCommand", () => {
    it("returns true for comments with /fix", () => {
        expect(mightBeCommand("Please /fix this")).toBe(true);
    });

    it("returns true for comments with @presolve", () => {
        expect(mightBeCommand("Hey @presolve can you help")).toBe(true);
    });

    it("returns false for regular comments", () => {
        expect(mightBeCommand("This looks great, approved!")).toBe(false);
    });

    it("returns false for empty string", () => {
        expect(mightBeCommand("")).toBe(false);
    });

    it("returns false for null", () => {
        expect(mightBeCommand(null as any)).toBe(false);
    });
});
