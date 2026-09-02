import { spawn } from "node:child_process";
import net from "node:net";
import { chromium } from "playwright";

const migrationUserData = process.env.CHENGJING_MIGRATION_USER_DATA || "";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function inspect(executable, label) {
  const port = await freePort();
  const child = spawn(executable, [`--remote-debugging-port=${port}`], { env: { ...process.env, ...(migrationUserData ? { CHENGJING_SMOKE_USER_DATA: migrationUserData } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  let browser;
  try {
    const endpoint = `http://127.0.0.1:${port}`;
    const startedAt = Date.now();
    while (true) {
      try { if ((await fetch(`${endpoint}/json/version`)).ok) break; } catch {}
      if (Date.now() - startedAt > 20_000) throw new Error(`${label}-launch-timeout:${output.slice(-1000)}`);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    let page = context.pages().find((candidate) => !candidate.url().includes("quick-capture")) || context.pages()[0] || await context.waitForEvent("page");
    if (page.url().includes("quick-capture")) {
      await page.evaluate(() => window.chengjing?.quickCapture?.showMain?.()).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
      page = context.pages().find((candidate) => !candidate.url().includes("quick-capture")) || page;
    }
    page.setDefaultTimeout(20_000);
    try { await page.locator(".app-shell").waitFor({ state: "attached" }); }
    catch (error) { throw new Error(`${label}-app-shell-timeout:pages=${context.pages().map((candidate) => candidate.url()).join(",")}:text=${(await page.locator("body").innerText().catch(() => "")).slice(0, 800)}:process=${output.slice(-800)}:${error.message}`); }
    await page.waitForTimeout(label === "after" ? 2_500 : 500);
    const snapshot = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("chengjing");
      request.onerror = () => reject(request.error);
      request.onsuccess = async () => {
        const database = request.result;
        const names = ["cards", "boards", "boardNodes", "boardEdges", "tasks", "highlights", "attachments", "fragments", "brainEdges", "brainReports", "brainShares", "knowledgeGroups", "kanbanBoards", "kanbanLists", "kanbanPlacements"];
        const records = {};
        for (const name of names) {
          if (!database.objectStoreNames.contains(name)) { records[name] = []; continue; }
          records[name] = await new Promise((done, fail) => {
            const query = database.transaction(name, "readonly").objectStore(name).getAll();
            query.onsuccess = () => done(query.result);
            query.onerror = () => fail(query.error);
          });
        }
        const normalize = (value) => String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "").trim();
        const materializedCard = (card) => {
          if (card.kind !== "journal" || card.journalTouched === true) return true;
          const localDate = /^\d{4}-\d{2}-\d{2}$/.test(card.journalDate || "") ? new Date(`${card.journalDate}T12:00:00`) : null;
          const defaultTitles = localDate ? new Set(["zh-TW", "zh-CN", "en", "ja", "ko"].map((locale) => normalize(new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric" }).format(localDate)))) : new Set();
          if (normalize(card.title) && !defaultTitles.has(normalize(card.title))) return true;
          const plain = String(card.plainText || "").trim() || String(card.contentHtml || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|h[1-6]|li)>/gi, "\n").replace(/<[^>]+>/g, " ");
          return plain.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).some((line) => !["今天", "今日", "today", "오늘"].includes(normalize(line)));
        };
        const materializedCards = records.cards.filter(materializedCard);
        const clean = {
          cards: materializedCards.map(({ searchTerms, taskSyncState, journalTouched, ...item }) => item),
          boards: records.boards,
          boardNodes: records.boardNodes,
          boardEdges: records.boardEdges,
          tasks: records.tasks.map(({ searchTerms, doneKey, scheduleKey, ...item }) => item),
          highlights: records.highlights,
          attachments: records.attachments.map(({ blob, storage, relativePath, sha256, ...item }) => item),
          fragments: records.fragments.map(({ searchTerms, pinnedKey, ...item }) => item),
          brainEdges: records.brainEdges,
          brainReports: records.brainReports,
          brainShares: records.brainShares,
          knowledgeGroups: records.knowledgeGroups,
          kanbanBoards: records.kanbanBoards,
          kanbanLists: records.kanbanLists,
          kanbanPlacements: records.kanbanPlacements,
        };
        for (const value of Object.values(clean)) value.sort((left, right) => String(left.id || left.key).localeCompare(String(right.id || right.key)));
        const payload = JSON.stringify(clean);
        let hash = 2166136261;
        for (let index = 0; index < payload.length; index += 1) { hash ^= payload.charCodeAt(index); hash = Math.imul(hash, 16777619); }
        const counts = Object.fromEntries(Object.entries(records).map(([name, value]) => [name, name === "cards" ? materializedCards.length : value.length]));
        const rawCounts = Object.fromEntries(Object.entries(records).map(([name, value]) => [name, value.length]));
        resolve({ version: database.version, contentHash: (hash >>> 0).toString(16).padStart(8, "0"), counts, rawCounts, derived: { searchableCards: records.cards.filter((item) => Array.isArray(item.searchTerms) && item.searchTerms.length).length, indexedTasks: records.tasks.filter((item) => item.doneKey && Number.isFinite(item.scheduleKey)).length, indexedFragments: records.fragments.filter((item) => item.pinnedKey).length, fileAttachments: records.attachments.filter((item) => item.storage === "file" && item.relativePath && item.sha256).length } });
      };
    }));
    await page.evaluate(() => window.chengjing.app.quit()).catch(() => {});
    return snapshot;
  } finally {
    await browser?.close().catch(() => {});
    if (child.exitCode === null) child.kill("SIGTERM");
    if (child.exitCode === null) await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 3_000))]);
  }
}

const beforeExecutable = process.env.CHENGJING_BEFORE_APP;
const afterExecutable = process.env.CHENGJING_AFTER_APP;
if (!beforeExecutable || !afterExecutable) throw new Error("CHENGJING_BEFORE_APP and CHENGJING_AFTER_APP are required");
const before = await inspect(beforeExecutable, "before");
const after = await inspect(afterExecutable, "after");
const report = { before, after, contentPreserved: before.contentHash === after.contentHash, countsPreserved: JSON.stringify(before.counts) === JSON.stringify(after.counts), schemaUpgraded: before.version < after.version && after.version === 130, derivedIndexesReady: after.derived.searchableCards === after.rawCounts.cards && after.derived.indexedTasks === after.rawCounts.tasks && after.derived.indexedFragments === after.rawCounts.fragments, emptyJournalDraftsCleaned: after.rawCounts.cards <= before.rawCounts.cards };
console.log(JSON.stringify(report, null, 2));
if (!report.contentPreserved || !report.countsPreserved || !report.schemaUpgraded || !report.derivedIndexesReady || !report.emptyJournalDraftsCleaned) process.exitCode = 1;
