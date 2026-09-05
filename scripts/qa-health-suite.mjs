import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const cases = [
  "functional", "regressions", "board", "board-kanban", "content-editing", "content-conversions",
  "second-brain", "database-share", "pinned-cards", "journal-polish", "board-ime-security",
  "frameless-themes", "i18n", "update", "tags", "preferences-tasks", "auto-backup",
  "task-timeline", "task-hierarchy", "task-knowledge", "knowledge-library", "pdf-viewer",
  "ai-actions", "ai-conversation", "ai-markdown", "highlight-theme", "openrouter-routing",
  "wish-pool", "shared-brain", "scale-architecture", "responsive", "windows-ui", "advanced-integrations",
];
const destination = path.resolve("qa-artifacts/health-check");
await fs.mkdir(destination, { recursive: true });
const results = [];
const requested = process.argv.slice(2);
const selected = requested.length ? cases.filter((name) => requested.includes(name)) : cases;
if (requested.length && selected.length !== requested.length) throw new Error("unknown QA case");
for (const name of selected) {
  const startedAt = Date.now();
  const child = spawn(process.execPath, [`scripts/qa-${name}.mjs`], { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (part) => { output += part; }); child.stderr.on("data", (part) => { output += part; });
  const timeout = setTimeout(() => child.kill("SIGTERM"), 240000);
  const exitCode = await new Promise((resolve) => child.on("exit", resolve)); clearTimeout(timeout);
  if (process.platform !== "win32") { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  await fs.writeFile(path.join(destination, `${name}.log`), output);
  results.push({ name, passed: exitCode === 0, elapsedMs: Date.now() - startedAt });
  console.log(`${exitCode === 0 ? "PASS" : "FAIL"} ${name} (${Date.now() - startedAt}ms)`);
  if (exitCode !== 0) console.log(output.slice(-1800));
}
const prior = requested.length ? await fs.readFile(path.join(destination, "suite.json"), "utf8").then(JSON.parse).catch(() => []) : [];
const latest = cases.map((name) => {
  const next = results.find((result) => result.name === name); const previous = prior.find((result) => result.name === name);
  return next && previous ? { ...next, previousAttempts: [...(previous.previousAttempts || []), { passed: previous.passed, elapsedMs: previous.elapsedMs }] } : next || previous;
}).filter(Boolean);
await fs.writeFile(path.join(destination, "suite.json"), JSON.stringify(latest, null, 2));
if (results.some((result) => !result.passed)) process.exitCode = 1;
