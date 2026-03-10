// Copies non-TypeScript assets (EJS views, CSS, SVG) to dist/ after tsc
import { cpSync, mkdirSync } from "fs";

const pairs = [
    ["src/dashboard/views", "dist/dashboard/views"],
    ["src/dashboard/public", "dist/dashboard/public"],
];

for (const [src, dst] of pairs) {
    mkdirSync(dst, { recursive: true });
    cpSync(src, dst, { recursive: true });
    console.log(`✔ copied ${src} → ${dst}`);
}
