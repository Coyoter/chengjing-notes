import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const folder=path.resolve("android/signing");await fs.mkdir(folder,{recursive:true,mode:0o700});
const configPath=path.join(folder,"credentials.json");
let config;
try{config=JSON.parse(await fs.readFile(configPath,"utf8"))}catch(error){if(error.code!=="ENOENT")throw error;config={password:randomBytes(32).toString("base64url"),alias:"chengjing-android"};await fs.writeFile(configPath,JSON.stringify(config),{mode:0o600,flag:"wx"})}
const keytool=path.join(process.env.JAVA_HOME||"/Applications/Android Studio.app/Contents/jbr/Contents/Home","bin/keytool");
const store=path.join(folder,"chengjing-release.jks");
const env={...process.env,CHENGJING_SIGNING_PASSWORD:config.password};
try{await fs.access(store)}catch{
  const result=spawnSync(keytool,["-genkeypair","-keystore",store,"-storepass:env","CHENGJING_SIGNING_PASSWORD","-keypass:env","CHENGJING_SIGNING_PASSWORD","-alias",config.alias,"-keyalg","RSA","-keysize","3072","-validity","10000","-dname","CN=Techtarian, O=Techtarian, C=TW"],{env,encoding:"utf8"});
  if(result.status!==0)throw Error("Android signing key generation failed");
  await fs.chmod(store,0o600);
}
const result=spawnSync(keytool,["-list","-v","-keystore",store,"-storepass:env","CHENGJING_SIGNING_PASSWORD","-alias",config.alias],{env,encoding:"utf8"});
console.log(result.stdout.split("\n").filter(line=>/SHA1:|SHA256:/.test(line)).join("\n"));
