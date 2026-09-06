import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

function run(command,args,env={}) { const result=spawnSync(command,args,{stdio:"inherit",env:{...process.env,...env}});if(result.status!==0)process.exit(result.status||1); }
run("npm",["run","build"]);
const assets=path.resolve("android/app/src/main/assets/public");
await fs.mkdir(assets,{recursive:true});
run("rsync",["-a","--delete","dist/",assets+"/"]);
run("./android/gradlew",["-p","android",":app:assembleDebug","--console=plain"],{
  JAVA_HOME: process.env.JAVA_HOME || "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
  ANDROID_HOME: process.env.ANDROID_HOME || "/Users/coyoter/Library/Android/sdk",
});
