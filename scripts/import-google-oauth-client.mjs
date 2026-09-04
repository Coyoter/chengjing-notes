import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const source = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!source || !fs.existsSync(source)) {
  console.error("請提供剛從 Google Cloud 下載的 OAuth 用戶端 JSON 路徑。");
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(source, "utf8"));
const client = payload.installed || payload.desktop || {};
const expectedClientId = "594584088822-b0d7nn1cdlshaqqgfiijo2lkep87n713.apps.googleusercontent.com";
if (client.client_id !== expectedClientId || !String(client.client_secret || "").trim()) {
  console.error("這不是澄境剛建立的桌面 OAuth 用戶端 JSON。");
  process.exit(1);
}

if (process.platform !== "darwin") {
  console.error("這個匯入工具目前只用於 macOS 發行建置；其他環境請使用 CHENGJING_GOOGLE_OAUTH_CLIENT_SECRET。");
  process.exit(1);
}

execFileSync("/usr/bin/security", [
  "add-generic-password",
  "-U",
  "-s", "tw.techtarian.chengjing.google-oauth-build",
  "-a", "chengjing-desktop-oauth",
  "-w", String(client.client_secret),
], { stdio: "ignore" });

console.log(JSON.stringify({ imported: true, clientIdVerified: true, storage: "macOS-keychain" }));
