import fs from "node:fs/promises";
import path from "node:path";

const assets = path.resolve("dist", "assets");
const candidates = (await fs.readdir(assets)).filter((name) => /^transformers\.web-.*\.js$/.test(name));
if (candidates.length !== 1) throw new Error(`Expected one bundled Transformers.js chunk; found ${candidates.length}`);
const file = path.join(assets, candidates[0]);
const raw = await fs.readFile(file, "utf8");
const markerCount = raw.match(/num_logits_to_keep/g)?.length || 0;
if (markerCount < 8) throw new Error(`Bundled Gemma 4 backport marker is missing from ${candidates[0]} (count=${markerCount})`);
console.log(JSON.stringify({ file, markerCount, verified: true }, null, 2));
