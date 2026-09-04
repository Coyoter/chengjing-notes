import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const required = process.argv.includes("--required");
const destination = path.resolve("electron/google-oauth-runtime.cjs");
const service = "tw.techtarian.chengjing.google-oauth-build";
const account = "chengjing-desktop-oauth";
let clientSecret = String(process.env.CHENGJING_GOOGLE_OAUTH_CLIENT_SECRET || "").trim();

if (!clientSecret && process.platform === "darwin") {
  try {
    clientSecret = execFileSync("/usr/bin/security", ["find-generic-password", "-w", "-s", service, "-a", account], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {}
}

if (!clientSecret) {
  if (required) {
    console.error("找不到澄境 Google OAuth 建置憑證。請先匯入桌面 OAuth 用戶端 JSON，或設定 CHENGJING_GOOGLE_OAUTH_CLIENT_SECRET。");
    process.exit(1);
  }
  process.exit(0);
}

fs.writeFileSync(destination, `module.exports = { clientSecret: ${JSON.stringify(clientSecret)} };\n`, { mode: 0o600 });
fs.chmodSync(destination, 0o600);
console.log(JSON.stringify({ googleOAuthRuntimePrepared: true, source: process.env.CHENGJING_GOOGLE_OAUTH_CLIENT_SECRET ? "environment" : "macOS-keychain" }));
