import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { extractFile, listPackage } from "@electron/asar";

const releaseDirectory = path.resolve("release");
const version = JSON.parse(await fs.readFile("package.json", "utf8")).version;
const packages = [
  { arch: "x64", machine: 0x8664, directory: path.join(releaseDirectory, "win-unpacked") },
  { arch: "arm64", machine: 0xaa64, directory: path.join(releaseDirectory, "win-arm64-unpacked") },
];

async function sha256(filePath) {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function peMachine(filePath) {
  const file = await fs.open(filePath, "r");
  try {
    const dos = Buffer.alloc(64);
    await file.read(dos, 0, dos.length, 0);
    if (dos.toString("ascii", 0, 2) !== "MZ") throw new Error(`not-pe:${filePath}`);
    const peOffset = dos.readUInt32LE(0x3c);
    const header = Buffer.alloc(6);
    await file.read(header, 0, header.length, peOffset);
    if (header.toString("ascii", 0, 4) !== "PE\0\0") throw new Error(`invalid-pe:${filePath}`);
    return header.readUInt16LE(4);
  } finally {
    await file.close();
  }
}

const architectureReports = [];
for (const target of packages) {
  const executable = path.join(target.directory, "ChengJing.exe");
  const uninstaller = path.join(target.directory, "ChengJingUninstall.exe");
  const asarPath = path.join(target.directory, "resources", "app.asar");
  const machine = await peMachine(executable);
  const uninstallerMachine = await peMachine(uninstaller);
  const files = listPackage(asarPath);
  const packagedMetadata = JSON.parse(extractFile(asarPath, "package.json").toString("utf8"));
  const mainSource = extractFile(asarPath, "electron/main.cjs").toString("utf8");
  const transformersBundle = files.find((file) => /^\/dist\/assets\/transformers\.web-.*\.js$/.test(file));
  const transformersSource = transformersBundle ? extractFile(asarPath, transformersBundle.slice(1)).toString("utf8") : "";
  const checks = {
    nativeArchitecture: machine === target.machine,
    nativeUninstallerArchitecture: uninstallerMachine === target.machine,
    versionMatches: packagedMetadata.version === version,
    windowsTrayBundled: files.includes("/electron/assets/ChengJingTray.png"),
    rendererBundled: files.includes("/dist/index.html"),
    macHelperExcluded: !files.some((file) => file.includes("ChengJingQuickCapture.app")),
    windowsUpdateEnabled: mainSource.includes('process.platform === "win32" ? ".exe" : ".dmg"'),
    singleInstanceEnabled: mainSource.includes("requestSingleInstanceLock"),
    menuBarHiddenUntilAlt: mainSource.includes('autoHideMenuBar: process.platform === "win32"'),
    gemmaNumLogitsPatchBundled: (transformersSource.match(/num_logits_to_keep/g) || []).length >= 8,
  };
  if (Object.values(checks).some((value) => value !== true)) throw new Error(`windows-package-${target.arch}:${JSON.stringify(checks)}`);
  architectureReports.push({ arch: target.arch, machine: `0x${machine.toString(16)}`, uninstallerMachine: `0x${uninstallerMachine.toString(16)}`, executableBytes: (await fs.stat(executable)).size, asarSha256: await sha256(asarPath), checks });
}

const installers = await Promise.all(packages.map(async ({ arch }) => {
  const name = `ChengJing-${version}-${arch}-Installer.exe`;
  const installerPath = path.join(releaseDirectory, name);
  const stat = await fs.stat(installerPath);
  const digest = await sha256(installerPath);
  const machine = await peMachine(installerPath);
  const sidecar = await fs.readFile(`${installerPath}.sha256`, "utf8");
  const expectedMachine = arch === "x64" ? 0x8664 : 0xaa64;
  return {
    arch,
    name,
    bytes: stat.size,
    machine: `0x${machine.toString(16)}`,
    sha256: digest,
    architectureSpecific: machine === expectedMachine && stat.size > 100_000_000 && stat.size < 220_000_000,
    checksumSidecarMatches: sidecar.trim() === `${digest}  ${name}`,
  };
}));
const report = {
  version,
  installers,
  architectures: architectureReports,
  sharedApplicationCode: architectureReports[0].asarSha256 === architectureReports[1].asarSha256,
};

if (report.installers.some((installer) => !installer.architectureSpecific || !installer.checksumSidecarMatches) || !report.sharedApplicationCode) throw new Error(`windows-architecture-installers:${JSON.stringify(report)}`);
await fs.writeFile(path.join(releaseDirectory, `windows-package-qa-v${version}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
