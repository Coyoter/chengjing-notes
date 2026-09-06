// Deliberately avoid connectedAndroidTest: its automatic cleanup removes the app.
// Install with -r and invoke instrumentation directly to preserve development data.
import { spawnSync } from "node:child_process";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"..");
const env={...process.env,JAVA_HOME:process.env.JAVA_HOME||"/Applications/Android Studio.app/Contents/jbr/Contents/Home",ANDROID_HOME:process.env.ANDROID_HOME||"/Users/coyoter/Library/Android/sdk"};
const adb=path.join(env.ANDROID_HOME,"platform-tools/adb");
function run(command,args){const result=spawnSync(command,args,{cwd:root,env,stdio:"inherit"});if(result.status!==0)process.exit(result.status||1);}
run("./android/gradlew",["-p","android",":app:assembleDebug",":app:assembleDebugAndroidTest","--console=plain"]);
run(adb,["install","-r","android/app/build/outputs/apk/debug/app-debug.apk"]);
run(adb,["install","-r","android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"]);
const result=spawnSync(adb,["shell","am","instrument","-w","-r","tw.techtarian.chengjing.test/androidx.test.runner.AndroidJUnitRunner"],{cwd:root,env,encoding:"utf8",maxBuffer:10_000_000});
process.stdout.write(result.stdout||"");process.stderr.write(result.stderr||"");
if(result.status!==0||!/^OK \([0-9]+ tests?\)/m.test(result.stdout)||/FAILURES!!!|INSTRUMENTATION_FAILED/.test(result.stdout))process.exit(1);
run(adb,["shell","am","start","-n","tw.techtarian.chengjing/.MainActivity"]);
