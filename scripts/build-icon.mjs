import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

const exec = promisify(execFile);
const buildDir = path.resolve("build");
const iconset = path.join(buildDir, "icon.iconset");
const source = path.join(buildDir, "icon-1024.png");
const windowsIcon = path.join(buildDir, "icon.ico");
const windowsTrayIcon = path.resolve("electron/assets/ChengJingTray.png");
await fs.mkdir(buildDir, { recursive: true });
await fs.rm(iconset, { recursive: true, force: true });
await fs.mkdir(iconset, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><style>
  *{box-sizing:border-box}html,body{margin:0;width:1024px;height:1024px;overflow:hidden;background:transparent}
  body{display:grid;place-items:center}.icon{position:relative;width:900px;height:900px;overflow:hidden;border-radius:210px;background:linear-gradient(145deg,#17201d 0%,#0b100e 72%);box-shadow:inset 0 0 0 2px rgba(255,255,255,.08),inset 0 45px 90px rgba(255,255,255,.025)}
  .glow{position:absolute;width:540px;height:540px;left:80px;top:75px;border-radius:50%;background:radial-gradient(circle,#30c8a044 0%,#30c8a000 68%);filter:blur(12px)}
  svg{position:absolute;inset:125px;width:650px;height:650px;color:#35c7a2;filter:drop-shadow(0 24px 42px rgba(0,0,0,.32))}
  .paper{position:absolute;right:90px;bottom:88px;width:220px;height:36px;border-radius:18px;background:#f3efe4;opacity:.9;transform:rotate(-9deg)}.paper:after{position:absolute;right:0;width:36px;height:36px;border-radius:50%;background:#35c7a2;content:''}
</style><div class="icon"><div class="glow"></div><svg viewBox="0 0 650 650" fill="none"><path d="M325 70C198 70 95 173 95 300C95 427 198 530 325 530C452 530 555 427 555 300" stroke="currentColor" stroke-width="42" stroke-linecap="round"/><path d="M325 176C256 176 201 231 201 300C201 369 256 424 325 424C394 424 449 369 449 300" stroke="currentColor" stroke-opacity=".62" stroke-width="42" stroke-linecap="round"/><circle cx="325" cy="300" r="48" fill="#F3EFE4"/><path d="M325 530V590" stroke="#F3EFE4" stroke-width="42" stroke-linecap="round"/></svg><div class="paper"></div></div>`);
await page.screenshot({ path: source, omitBackground: true });
await browser.close();

const variants = [
  [16, "icon_16x16.png"], [32, "icon_16x16@2x.png"], [32, "icon_32x32.png"], [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"], [256, "icon_128x128@2x.png"], [256, "icon_256x256.png"], [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"], [1024, "icon_512x512@2x.png"],
];
for (const [size, name] of variants) {
  await sharp(source).resize(size, size).png().toFile(path.join(iconset, name));
}

const icoPng = await sharp(source).resize(256, 256).png().toBuffer();
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader.writeUInt8(0, 6);
icoHeader.writeUInt8(0, 7);
icoHeader.writeUInt8(0, 8);
icoHeader.writeUInt8(0, 9);
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(icoPng.byteLength, 14);
icoHeader.writeUInt32LE(22, 18);
await fs.writeFile(windowsIcon, Buffer.concat([icoHeader, icoPng]));
await sharp(source).resize(32, 32).png().toFile(windowsTrayIcon);

if (process.platform === "darwin") await exec("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", path.join(buildDir, "icon.icns")]);
await fs.rm(iconset, { recursive: true, force: true });
console.log(JSON.stringify({ mac: path.join(buildDir, "icon.icns"), windows: windowsIcon, windowsTray: windowsTrayIcon }));
