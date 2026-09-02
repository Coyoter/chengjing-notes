import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
if (process.platform !== "darwin") {
  console.log("Skipping macOS hotkey helper outside macOS");
  process.exit(0);
}

const source = path.resolve("electron/native/ChengJingHotkey.m");
const appBundle = path.resolve("build/ChengJingQuickCapture.app");
const output = path.join(appBundle, "Contents", "MacOS", "ChengJingQuickCapture");
const resources = path.join(appBundle, "Contents", "Resources");
await fs.rm(appBundle, { recursive: true, force: true });
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(resources, { recursive: true });
await run("xcrun", ["clang", source, "-O2", "-fobjc-arc", "-mmacosx-version-min=12.0", "-framework", "Cocoa", "-framework", "Carbon", "-framework", "QuartzCore", "-o", output]);
await fs.chmod(output, 0o755);
await fs.writeFile(path.join(appBundle, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_TW</string>
  <key>CFBundleDisplayName</key><string>澄境快速記錄</string>
  <key>CFBundleExecutable</key><string>ChengJingQuickCapture</string>
  <key>CFBundleIdentifier</key><string>tw.techtarian.chengjing.quickcapture</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>澄境快速記錄</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>\n`);
await new Promise((resolve, reject) => {
  const child = spawn(output, ["80", "6656", "--self-test"], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`Native hotkey self-test timed out: ${stdout} ${stderr}`)); }, 2_000);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (stdout.includes("ready\n") && stdout.includes("trigger\n")) {
      clearTimeout(timer);
      child.kill("SIGTERM");
      resolve();
    }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => { clearTimeout(timer); reject(error); });
  child.on("exit", (code, signal) => {
    if (!stdout.includes("trigger\n") && signal !== "SIGTERM") {
      clearTimeout(timer);
      reject(new Error(`Native hotkey self-test exited (${code}): ${stdout} ${stderr}`));
    }
  });
});
console.log(appBundle);
