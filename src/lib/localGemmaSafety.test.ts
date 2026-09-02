import { describe, expect, it } from "vitest";
import { isLocalRuntimeCapacityError, LOCAL_GENERATION_LIMITS, localGenerationTokenBudget } from "./localGemma";

describe("本機 Gemma 推論安全邊界", () => {
  it("不接受功能把本機輸出上限拉到數千 token", () => {
    expect(localGenerationTokenBudget(6_000)).toBe(LOCAL_GENERATION_LIMITS.maxNewTokens);
    expect(localGenerationTokenBudget()).toBe(LOCAL_GENERATION_LIMITS.maxNewTokens);
    expect(localGenerationTokenBudget(384)).toBe(384);
    expect(localGenerationTokenBudget(0)).toBe(32);
  });

  it("辨識 ONNX Runtime 容量溢位並轉成友善錯誤", () => {
    expect(isLocalRuntimeCapacityError(new Error("failed to call OrtRun(): SafeIntOnOverflow Integer overflow"))).toBe(true);
    expect(isLocalRuntimeCapacityError(new Error("ordinary model response error"))).toBe(false);
  });
});
