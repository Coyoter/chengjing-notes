import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const architecture = process.argv[2];
if (!["arm64", "x64"].includes(architecture)) throw new Error("usage: node scripts/build-windows-installer.mjs <arm64|x64>");

const projectRoot = process.cwd();
const metadata = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
const version = metadata.version;
const goRoot = path.join(projectRoot, "tools", "windows-installer");
const appDirectory = path.join(projectRoot, "release", architecture === "arm64" ? "win-arm64-unpacked" : "win-unpacked");
const applicationPath = path.join(appDirectory, "ChengJing.exe");
const uninstallerPath = path.join(appDirectory, "ChengJingUninstall.exe");
const payloadPath = path.join(goRoot, "installer", "payload.zip");
const installerName = `ChengJing-${version}-${architecture}-Installer.exe`;
const installerPath = path.join(projectRoot, "release", installerName);
const goArchitecture = architecture === "x64" ? "amd64" : "arm64";
const expectedMachine = architecture === "x64" ? 0x8664 : 0xaa64;

await verifyPeArchitecture(applicationPath, expectedMachine);
const goEnvironment = { ...process.env, GOOS: "windows", GOARCH: goArchitecture, CGO_ENABLED: "0" };
const baseLdFlags = `-s -w -H=windowsgui -X main.appVersion=${version}`;

await exec("go", ["build", "-buildvcs=false", "-trimpath", "-ldflags", baseLdFlags, "-o", uninstallerPath, "./uninstaller"], { cwd: goRoot, env: goEnvironment, maxBuffer: 8 * 1024 * 1024 });
await verifyPeArchitecture(uninstallerPath, expectedMachine);
await exec("go", ["run", "./packager", "-source", appDirectory, "-output", payloadPath], { cwd: goRoot, maxBuffer: 8 * 1024 * 1024 });

try {
  await exec("go", ["build", "-buildvcs=false", "-trimpath", "-ldflags", `${baseLdFlags} -X main.expectedArch=${architecture}`, "-o", installerPath, "./installer"], { cwd: goRoot, env: goEnvironment, maxBuffer: 8 * 1024 * 1024 });
} finally {
  await fs.rm(payloadPath, { force: true });
}
await verifyPeArchitecture(installerPath, expectedMachine);
const digest = await sha256(installerPath);
await fs.writeFile(`${installerPath}.sha256`, `${digest}  ${installerName}\n`);
const report = {
  version,
  architecture,
  installer: installerPath,
  installerBytes: (await fs.stat(installerPath)).size,
  installedBytes: await directoryBytes(appDirectory),
  sha256: digest,
  executable: applicationPath,
  uninstaller: uninstallerPath,
};
console.log(JSON.stringify(report, null, 2));

async function verifyPeArchitecture(filePath, expected) {
  const file = await fs.open(filePath, "r");
  try {
    const dos = Buffer.alloc(64);
    await file.read(dos, 0, dos.length, 0);
    if (dos.toString("ascii", 0, 2) !== "MZ") throw new Error(`not a PE executable: ${filePath}`);
    const peOffset = dos.readUInt32LE(0x3c);
    const header = Buffer.alloc(6);
    await file.read(header, 0, header.length, peOffset);
    if (header.toString("ascii", 0, 4) !== "PE\0\0") throw new Error(`invalid PE header: ${filePath}`);
    const machine = header.readUInt16LE(4);
    if (machine !== expected) throw new Error(`wrong PE architecture for ${filePath}: 0x${machine.toString(16)}`);
  } finally {
    await file.close();
  }
}

async function sha256(filePath) {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function directoryBytes(root) {
  let total = 0;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    total += entry.isDirectory() ? await directoryBytes(target) : (await fs.stat(target)).size;
  }
  return total;
}
