import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ignoredDirectories = new Set([
  ".git", ".next", ".vinext", "node_modules", "dist", "mobile-dist", "mac-dist", "work", "xcuserdata",
]);
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".md", ".json", ".yml", ".yaml"]);
const forbiddenContent = [
  { label: "embedded journey seed", pattern: /const\s+seed(?:Journeys|20\d{2})/ },
  { label: "legacy private journey id", pattern: /j(?:23|24|25|26)\d{4}/ },
  { label: "legacy private migration note", pattern: /多地点区间推定日期|自驾前往日照|武汉乘高铁到济南/ },
];
const privateFilename = /^(?:journeys(?:-v\d+)?|行迹数据.*)\.json$/i;
const findings = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }

    const displayPath = relative(root, path);
    if (privateFilename.test(entry.name)) {
      findings.push(`${displayPath}: private journey filename`);
      continue;
    }
    if (!sourceExtensions.has(extname(entry.name)) || displayPath === "scripts/privacy-check.mjs") continue;
    const content = await readFile(path, "utf8");
    for (const rule of forbiddenContent) {
      if (rule.pattern.test(content)) findings.push(`${displayPath}: ${rule.label}`);
    }
  }
}

await walk(root);
if (findings.length) {
  console.error("Privacy check failed:\n" + findings.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Privacy check passed: no embedded personal journey data found.");
}
