import fs from "node:fs/promises";
import path from "node:path";

const checkOnly = process.argv.includes("--check");
const packageRoot = path.resolve("node_modules", "@huggingface", "transformers");
const metadata = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
if (metadata.version !== "4.2.0") {
  throw new Error(`Gemma 4 patch only supports @huggingface/transformers 4.2.0; found ${metadata.version}. Check whether upstream PR #1681 is included before changing this guard.`);
}

const targets = [
  { file: "src/models/gemma3n/modeling_gemma3n.js", start: "export class Gemma3nForConditionalGeneration", end: "export class Gemma3nForCausalLM" },
  ...["dist/transformers.web.js", "dist/transformers.js", "dist/transformers.node.mjs", "dist/transformers.node.cjs"].map((file) => ({
    file,
    start: "// src/models/gemma3n/modeling_gemma3n.js",
    end: "// src/models/gemma4/modeling_gemma4.js",
  })),
];

const reports = [];
for (const target of targets) reports.push(await patchTarget(target));
console.log(JSON.stringify({ package: metadata.version, mode: checkOnly ? "check" : "apply", reports }, null, 2));

async function patchTarget(target) {
  const filePath = path.join(packageRoot, target.file);
  const raw = await fs.readFile(filePath, "utf8");
  const start = raw.indexOf(target.start);
  const end = raw.indexOf(target.end, start + target.start.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`Cannot isolate Gemma3n forward section in ${target.file}`);

  const before = raw.slice(0, start);
  let section = raw.slice(start, end);
  const after = raw.slice(end);
  const alreadyPatched = hasPatch(section);
  if (!alreadyPatched) {
    if (checkOnly) throw new Error(`Official Gemma 4 num_logits_to_keep backport is missing from ${target.file}`);
    section = applyOfficialBackport(section, target.file);
  }
  if (!hasPatch(section)) throw new Error(`Gemma 4 num_logits_to_keep backport verification failed for ${target.file}`);

  if (!alreadyPatched) await fs.writeFile(filePath, `${before}${section}${after}`);
  return { file: target.file, patched: !alreadyPatched, verified: true };
}

function hasPatch(section) {
  return /num_logits_to_keep\s*=\s*null/.test(section)
    && /logits_processor,?\s*\n\s*num_logits_to_keep,?\s*\n\s*},\s*\n\s*true/.test(section);
}

function applyOfficialBackport(section, file) {
  let parameterEdits = 0;
  section = section.replace(
    /(generation_config\s*=\s*null,\s*\n)(\s*)logits_processor\s*=\s*null,(?!\s*\n\s*num_logits_to_keep)/,
    (_match, generationLine, indent) => {
      parameterEdits += 1;
      return `${generationLine}${indent}logits_processor = null,\n${indent}num_logits_to_keep = null,`;
    },
  );

  let forwardEdits = 0;
  section = section.replace(
    /(generation_config,\s*\n)(\s*)logits_processor(,?)(\s*\n\s*},\s*\n\s*true)/,
    (_match, generationLine, indent, trailingComma, suffix) => {
      forwardEdits += 1;
      return `${generationLine}${indent}logits_processor,\n${indent}num_logits_to_keep${trailingComma}${suffix}`;
    },
  );
  if (parameterEdits !== 1 || forwardEdits !== 1) {
    throw new Error(`Expected one official Gemma 4 backport edit in ${file}; got parameters=${parameterEdits}, forward=${forwardEdits}`);
  }
  return section;
}
