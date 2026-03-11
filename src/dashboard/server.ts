// ============================================================
//  PResolution — Dashboard Server
//  Express-based web UI for the bot's landing page and activity
// ============================================================

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { getActivityLog, getStats } from "../utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create and configure the Express dashboard app.
 */
export function createDashboardApp(): express.Application {
    const app = express();
    const rawDashboardAccessToken = process.env.DASHBOARD_ACCESS_TOKEN?.trim();
    const dashboardAccessToken =
        rawDashboardAccessToken && !rawDashboardAccessToken.startsWith("PASTE_")
            ? rawDashboardAccessToken
            : undefined;
    const isProduction = process.env.NODE_ENV === "production";
    const rateLimitWindowMs = Number(process.env.DASHBOARD_RATE_WINDOW_MS ?? 60_000);
    const rateLimitMaxRequests = Number(process.env.DASHBOARD_RATE_MAX_REQUESTS ?? 240);
    const requestWindow = new Map<string, { count: number; windowStart: number }>();

    // View engine setup
    app.set("view engine", "ejs");
    app.set("views", path.join(__dirname, "views"));

    // Security hardening
    app.disable("x-powered-by");

    app.use((req, res, next) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
        res.setHeader(
            "Content-Security-Policy",
            [
                "default-src 'self'",
                "script-src 'self' 'unsafe-inline'",
                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
                "font-src 'self' https://fonts.gstatic.com data:",
                "img-src 'self' data: https:",
                "connect-src 'self'",
                "object-src 'none'",
                "base-uri 'self'",
                "frame-ancestors 'none'",
            ].join("; ")
        );
        next();
    });

    app.use((req, res, next) => {
        const forwardedFor = req.headers["x-forwarded-for"];
        const ipCandidate =
            typeof forwardedFor === "string"
                ? forwardedFor.split(",")[0]?.trim() || req.ip
                : req.ip;
        const ip = ipCandidate || "unknown";
        const now = Date.now();
        const current = requestWindow.get(ip);

        if (!current || now - current.windowStart >= rateLimitWindowMs) {
            requestWindow.set(ip, { count: 1, windowStart: now });
            return next();
        }

        if (current.count >= rateLimitMaxRequests) {
            return res.status(429).json({ error: "Too many requests" });
        }

        current.count += 1;
        requestWindow.set(ip, current);
        next();
    });

    // Static assets
    app.use("/static", express.static(path.join(__dirname, "public")));

    // Route protection for non-public operational endpoints
    app.use((req, res, next) => {
        const protectedRoutes = ["/api/activity"];
        const shouldProtect = protectedRoutes.some((route) => req.path.startsWith(route));
        if (!shouldProtect) return next();

        // Fail closed in production if token is not configured
        if (isProduction && !dashboardAccessToken) {
            return res.status(503).json({ error: "Dashboard access token not configured" });
        }

        if (!dashboardAccessToken) return next();

        const authorization = req.header("authorization") || "";
        const bearerToken = authorization.startsWith("Bearer ")
            ? authorization.slice("Bearer ".length).trim()
            : "";

        const providedToken =
            req.header("x-dashboard-token") ||
            bearerToken;

        if (providedToken !== dashboardAccessToken) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        next();
    });

    // ──────────────────────────────────────────────
    // Routes
    // ──────────────────────────────────────────────

    // Landing page
    app.get("/", (_req, res) => {
        const stats = getStats();
        res.render("index", { stats });
    });

    // Dashboard — activity log
    app.get("/dashboard", (_req, res) => {
        const activities = getActivityLog(50);
        const stats = getStats();
        res.render("dashboard", { activities, stats });
    });

    // Setup guide
    app.get("/setup", (_req, res) => {
        res.render("setup");
    });

    // Status page (human-readable)
    app.get("/status", (_req, res) => {
        const stats = getStats();
        const activities = getActivityLog(10);
        res.render("status", { stats, activities, now: new Date().toISOString() });
    });

    // Canonical repository redirect
    app.get("/github", (_req, res) => {
        res.redirect(302, "https://github.com/Anandb71/Pres");
    });

    // API: activity data (for live updates)
    app.get("/api/activity", (_req, res) => {
        const activities = getActivityLog(50);
        const stats = getStats();
        res.json({ activities, stats });
    });

    // Health check
    app.get("/health", (_req, res) => {
        res.json({
            status: "ok",
            timestamp: new Date().toISOString(),
            service: "presolution-dashboard",
        });
    });

    return app;
}
