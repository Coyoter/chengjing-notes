import fs from "node:fs/promises";
import path from "node:path";

const source = path.resolve("node_modules/onnxruntime-web/dist");
const destination = path.resolve("public/ort");
const assets = [
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
];

await fs.mkdir(destination, { recursive: true });
for (const name of assets) {
  const input = path.join(source, name);
  const output = path.join(destination, name);
  const metadata = await fs.stat(input);
  if (!metadata.isFile() || metadata.size < 10_000) throw new Error(`Invalid ONNX Runtime asset: ${input}`);
  await fs.copyFile(input, output);
}
console.log(`Prepared ${assets.length} local ONNX Runtime assets in ${destination}`);
