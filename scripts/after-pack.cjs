const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");

const exec = promisify(execFile);

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const quickCaptureApp = path.join(appPath, "Contents", "Resources", "native", "ChengJingQuickCapture.app");
  await exec("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", quickCaptureApp]);
  await exec("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath]);
};
