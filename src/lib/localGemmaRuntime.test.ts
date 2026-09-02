import { describe, expect, it } from "vitest";
import { localOnnxRuntimePaths } from "./localGemma";

describe("Gemma 4 本機 ONNX Runtime", () => {
  it("永遠指向 App 內的 asyncify 執行檔，不再依賴 jsDelivr", () => {
    const paths = localOnnxRuntimePaths("file:///Applications/澄境.app/Contents/Resources/app.asar/dist/index.html");
    expect(decodeURI(paths.mjs)).toBe("file:///Applications/澄境.app/Contents/Resources/app.asar/dist/ort/ort-wasm-simd-threaded.asyncify.mjs");
    expect(decodeURI(paths.wasm)).toBe("file:///Applications/澄境.app/Contents/Resources/app.asar/dist/ort/ort-wasm-simd-threaded.asyncify.wasm");
    expect(JSON.stringify(paths)).not.toContain("cdn.jsdelivr.net");
  });

  it("開發環境同樣使用相同來源的本機靜態檔", () => {
    const paths = localOnnxRuntimePaths("http://127.0.0.1:5173/index.html");
    expect(paths.mjs).toBe("http://127.0.0.1:5173/ort/ort-wasm-simd-threaded.asyncify.mjs");
    expect(paths.wasm).toBe("http://127.0.0.1:5173/ort/ort-wasm-simd-threaded.asyncify.wasm");
  });
});
