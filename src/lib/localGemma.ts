import type { AIMessage } from "./modelTypes";
import { translate } from "../i18n";
import { useAppStore } from "../store";

export const LOCAL_MODEL = {
  id: "onnx-community/gemma-4-E2B-it-ONNX",
  name: "Gemma 4 E2B",
  task: "text-generation",
  dtype: "q4f16",
  approximateBytes: 3_110_384_405,
} as const;

let generatorPromise: Promise<any> | null = null;
let generatorReady = false;
let localGenerationQueue: Promise<void> = Promise.resolve();
type TransformersRuntimeEnv = (typeof import("@huggingface/transformers"))["env"];

export const LOCAL_GENERATION_LIMITS = {
  maxInputCharacters: 16_000,
  maxNewTokens: 1_024,
  timeoutMs: 60_000,
} as const;

export function localGenerationTokenBudget(requested?: number) {
  const value = Number.isFinite(requested) ? Math.floor(Number(requested)) : LOCAL_GENERATION_LIMITS.maxNewTokens;
  return Math.max(32, Math.min(LOCAL_GENERATION_LIMITS.maxNewTokens, value));
}

export function isLocalRuntimeCapacityError(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error || "");
  return /SafeInt(?:OnOverflow)?|Integer overflow|failed to call OrtRun|out of memory|allocation failed|WebGPU.*buffer/i.test(message);
}

export function localOnnxRuntimePaths(base = document.baseURI) {
  const directory = new URL("./ort/", base);
  return {
    mjs: new URL("ort-wasm-simd-threaded.asyncify.mjs", directory).href,
    wasm: new URL("ort-wasm-simd-threaded.asyncify.wasm", directory).href,
  };
}

export function configureLocalOnnxRuntime(runtime: TransformersRuntimeEnv, base = document.baseURI) {
  const wasm = runtime.backends.onnx.wasm;
  if (!wasm) throw new Error("onnx-wasm-runtime-unavailable");
  runtime.useWasmCache = true;
  wasm.proxy = false;
  wasm.wasmPaths = localOnnxRuntimePaths(base);
}

function t(key: Parameters<typeof translate>[1], variables?: Record<string, string | number>) {
  return translate(useAppStore.getState().language || "zh-TW", key, variables);
}

function hasWebGPU() {
  return Boolean((navigator as Navigator & { gpu?: unknown }).gpu);
}

function sanitize(text: string) {
  return String(text || "")
    .replace(/<\|end_of_text\|>/g, "")
    .replace(/<\|im_end\|>/g, "")
    .trim();
}

export async function inspectLocalModel() {
  if (!hasWebGPU()) {
    return { state: "unsupported" as const, cached: false, progress: 0, size: LOCAL_MODEL.approximateBytes, message: t("local.unsupported") };
  }
  try {
    const { ModelRegistry } = await import("@huggingface/transformers");
    const files = await ModelRegistry.get_pipeline_files(LOCAL_MODEL.task, LOCAL_MODEL.id, { dtype: LOCAL_MODEL.dtype });
    const metadata = await Promise.all(files.map((file: string) => ModelRegistry.get_file_metadata(LOCAL_MODEL.id, file)));
    const cached = await ModelRegistry.is_pipeline_cached(LOCAL_MODEL.task, LOCAL_MODEL.id, { dtype: LOCAL_MODEL.dtype });
    return {
      state: cached ? "ready" as const : "not-downloaded" as const,
      cached,
      progress: cached ? 100 : 0,
      size: metadata.reduce((sum: number, item: { size?: number } | null) => sum + Number(item?.size || 0), 0) || LOCAL_MODEL.approximateBytes,
      message: cached ? t("local.downloaded") : t("local.notDownloaded"),
    };
  } catch (error) {
    return {
      state: generatorReady ? "ready" as const : "unknown" as const,
      cached: generatorReady,
      progress: generatorReady ? 100 : 0,
      size: LOCAL_MODEL.approximateBytes,
      message: generatorReady ? t("local.loaded") : t("local.checkFailed", { error: error instanceof Error ? error.message : t("local.unknown") }),
    };
  }
}

export async function prepareLocalModel(onProgress?: (progress: number, file: string) => void) {
  if (generatorPromise) return generatorPromise;
  if (!hasWebGPU()) throw new Error(t("local.noWebGPU"));
  generatorPromise = (async () => {
    const { env, pipeline } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    configureLocalOnnxRuntime(env);
    const generator = await pipeline(LOCAL_MODEL.task, LOCAL_MODEL.id, {
      dtype: LOCAL_MODEL.dtype,
      device: "webgpu",
      progress_callback: (info: { status?: string; progress?: number; file?: string }) => {
        if (info?.status === "progress_total" || info?.status === "progress") {
          onProgress?.(Math.max(0, Math.min(100, Number(info.progress || 0))), info.file || "");
        }
      },
    });
    generatorReady = true;
    return generator;
  })().catch((error) => {
    generatorPromise = null;
    generatorReady = false;
    throw error;
  });
  return generatorPromise;
}

async function performLocalChat(messages: AIMessage[], options?: {
  temperature?: number;
  maxTokens?: number;
  onToken?: (text: string) => void;
  onProgress?: (progress: number, file: string) => void;
}) {
  const inputCharacters = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (inputCharacters > LOCAL_GENERATION_LIMITS.maxInputCharacters) throw new Error(t("local.inputTooLarge"));
  const generator = await prepareLocalModel(options?.onProgress);
  const { InterruptableStoppingCriteria, TextStreamer } = await import("@huggingface/transformers");
  let streamed = "";
  let timedOut = false;
  const stoppingCriteria = new InterruptableStoppingCriteria();
  const timeout = setTimeout(() => {
    timedOut = true;
    stoppingCriteria.interrupt();
  }, LOCAL_GENERATION_LIMITS.timeoutMs);
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (token: string) => {
      streamed += token;
      options?.onToken?.(sanitize(streamed));
    },
  });
  const temperature = options?.temperature ?? 0.55;
  const doSample = temperature > 0.05;
  let output;
  try {
    output = await generator(messages, {
      max_new_tokens: localGenerationTokenBudget(options?.maxTokens),
      do_sample: doSample,
      ...(doSample ? { temperature, top_k: 40 } : {}),
      stopping_criteria: [stoppingCriteria],
      streamer,
    });
  } catch (error) {
    if (isLocalRuntimeCapacityError(error)) throw new Error(t("local.capacityExceeded"));
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (timedOut) throw new Error(t("local.timedOut"));
  const generated = output?.[0]?.generated_text;
  const fallback = typeof generated === "string"
    ? generated
    : Array.isArray(generated)
      ? generated.at(-1)?.content || generated.at(-1) || ""
      : "";
  const text = sanitize(streamed || fallback);
  if (!text) throw new Error(t("local.noText"));
  return { text, model: LOCAL_MODEL.id, usage: null, finishReason: "stop" };
}

export function generateLocalChat(messages: AIMessage[], options?: {
  temperature?: number;
  maxTokens?: number;
  onToken?: (text: string) => void;
  onProgress?: (progress: number, file: string) => void;
}) {
  const task = localGenerationQueue.then(
    () => performLocalChat(messages, options),
    () => performLocalChat(messages, options),
  );
  localGenerationQueue = task.then(() => undefined, () => undefined);
  return task;
}

export async function clearLocalModel() {
  generatorPromise = null;
  generatorReady = false;
  const names = await caches.keys();
  const modelNames = names.filter((name) => /transformers|huggingface|model|onnx/i.test(name));
  await Promise.all((modelNames.length ? modelNames : names).map((name) => caches.delete(name)));
  return { cleared: true };
}
