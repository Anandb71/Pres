/**
 * Standalone dashboard server for local preview
 * Serves the redesigned website without needing full Probot setup
 */

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// View engine setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "src/dashboard/views"));

// Static assets
app.use("/static", express.static(path.join(__dirname, "src/dashboard/public")));

const activityFile = process.env.PREVIEW_ACTIVITY_FILE;

function loadActivities() {
    if (!activityFile) return [];
    try {
        if (!fs.existsSync(activityFile)) return [];
        const raw = fs.readFileSync(activityFile, "utf-8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function deriveStats(activities) {
    const completed = activities.filter((e) => e?.status !== "processing");
    const successes = completed.filter((e) => e?.status === "success");
    const times = successes
        .map((e) => e?.processingTimeMs)
        .filter((t) => typeof t === "number");

    return {
        totalFixes: completed.length,
        successRate: completed.length > 0 ? Math.round((successes.length / completed.length) * 100) : 0,
        avgTimeMs: times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
        reposServed: new Set(activities.map((e) => e?.repo).filter(Boolean)).size,
    };
}

// Landing page
app.get("/", (_req, res) => {
    const activities = loadActivities();
    const stats = deriveStats(activities);
    res.render("index", { stats });
});

// Dashboard page
app.get("/dashboard", (_req, res) => {
    const activities = loadActivities();
    const stats = deriveStats(activities);
    res.render("dashboard", { stats, activities });
});

// Setup page
app.get("/setup", (_req, res) => {
    res.render("setup");
});

// Human-readable status page
app.get("/status", (_req, res) => {
    const activities = loadActivities();
    const stats = deriveStats(activities);
    res.render("status", { stats, activities, now: new Date().toISOString() });
});

// API activity endpoint
app.get("/api/activity", (_req, res) => {
    const activities = loadActivities();
    const stats = deriveStats(activities);
    res.json({
        stats,
        activities,
    });
});

// Canonical repository redirect
app.get("/github", (_req, res) => {
    res.redirect(302, "https://github.com/Anandb71/Pres");
});

// Health check
app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        service: "presolution-dashboard-preview",
    });
});

// Start server
app.listen(PORT, "127.0.0.1", () => {
    console.log(`\n✨ Dashboard running at http://127.0.0.1:${PORT}`);
    console.log(`Press Ctrl+C to stop\n`);
});
