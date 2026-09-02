import { chromium } from "playwright";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(15_000);
const externalRuntimeRequests = [];
const requestFailures = [];
const errors = [];
page.on("request", (request) => { if (/cdn\.jsdelivr\.net\/npm\/onnxruntime-web/i.test(request.url())) externalRuntimeRequests.push(request.url()); });
page.on("requestfailed", (request) => requestFailures.push({ url: request.url(), error: request.failure()?.errorText || "failed" }));
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(base, { waitUntil: "networkidle" });
const probeModel = new Uint8Array(await (await fetch("https://raw.githubusercontent.com/microsoft/onnxruntime/main/onnxruntime/test/testdata/mul_1.onnx")).arrayBuffer());

const report = await page.evaluate(async (modelBytes) => {
  try {
  const pathsModule = await import("/src/lib/localGemma.ts");
  const probeModule = await import("/src/lib/localOnnxProbe.ts");
  const paths = pathsModule.localOnnxRuntimePaths(document.baseURI);
  const [mjsResponse, wasmResponse] = await Promise.all([fetch(paths.mjs), fetch(paths.wasm)]);
  const runtimeModule = await import(paths.mjs);
  return {
    paths,
    mjsStatus: mjsResponse.status,
    wasmStatus: wasmResponse.status,
    mjsBytes: (await mjsResponse.arrayBuffer()).byteLength,
    wasmBytes: (await wasmResponse.arrayBuffer()).byteLength,
    runtimeFactory: typeof runtimeModule.default === "function",
    inference: await probeModule.runLocalOnnxProbe(Uint8Array.from(modelBytes).buffer),
  };
  } catch (error) {
    return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}, [...probeModel]);

console.log(JSON.stringify({ ...report, externalRuntimeRequests, requestFailures, errors }, null, 2));
await browser.close();

if (report.mjsStatus !== 200 || report.wasmStatus !== 200 || report.mjsBytes < 10_000 || report.wasmBytes < 10_000_000 || !report.runtimeFactory || JSON.stringify(report.inference) !== JSON.stringify([1, 4, 9, 16, 25, 36]) || externalRuntimeRequests.length || requestFailures.length || errors.length) process.exitCode = 1;
