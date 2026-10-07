import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
if (process.platform !== "darwin") process.exit(0);
const require = createRequire(import.meta.url);
const run = promisify(execFile);
const output = path.resolve("build/mac-window-presentation.node");
await fs.mkdir(path.dirname(output), { recursive: true });
await run("xcrun", ["clang++", "electron/native/WindowPresentation.mm", "-O2", "-std=c++17", "-fobjc-arc", "-bundle", "-undefined", "dynamic_lookup",
  "-mmacosx-version-min=12.0", "-DNAPI_VERSION=8", "-I", require("node-api-headers").include_dir, "-framework", "Cocoa", "-o", output]);
console.log("Built macOS window presentation bridge");
