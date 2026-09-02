import * as ort from "onnxruntime-web/wasm";
import { localOnnxRuntimePaths } from "./localGemma";

export async function runLocalOnnxProbe(model: ArrayBuffer, base = document.baseURI) {
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = localOnnxRuntimePaths(base);
  const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
  const input = new ort.Tensor("float32", Float32Array.from([1, 2, 3, 4, 5, 6]), [3, 2]);
  const output = await session.run({ X: input });
  const values = Array.from(output.Y?.data || [], Number);
  await session.release();
  return values;
}
