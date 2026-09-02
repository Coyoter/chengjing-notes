const assert = require("node:assert/strict");
const test = require("node:test");

test("Gemma 4 generation forwards num_logits_to_keep=1 to ONNX", async () => {
  const { Gemma4ForCausalLM, Tensor } = await import("@huggingface/transformers");
  let captured;
  const model = Object.create(Gemma4ForCausalLM.prototype);
  model.config = {
    model_type: "gemma4",
    text_config: { model_type: "gemma4_text", num_hidden_layers: 0, num_kv_shared_layers: 0, num_key_value_heads: 1, head_dim: 1 },
    image_token_id: 999,
    audio_token_id: 998,
  };
  model.sessions = {
    decoder_model_merged: {
      inputNames: ["inputs_embeds", "per_layer_inputs", "attention_mask", "position_ids", "num_logits_to_keep"],
      inputMetadata: [],
      run: async (feeds) => {
        captured = feeds;
        return { logits: new Tensor("float32", new Float32Array([0]), [1, 1, 1]).ort_tensor };
      },
    },
  };
  await model.forward({
    input_ids: new Tensor("int64", new BigInt64Array([1n]), [1, 1]),
    inputs_embeds: new Tensor("float32", new Float32Array([0, 0]), [1, 1, 2]),
    per_layer_inputs: new Tensor("float32", new Float32Array([0, 0]), [1, 1, 2]),
    attention_mask: new Tensor("int64", new BigInt64Array([1n]), [1, 1]),
    position_ids: new Tensor("int64", new BigInt64Array([0n]), [1, 1]),
    num_logits_to_keep: new Tensor("int64", new BigInt64Array([1n]), []),
  });
  assert.equal(captured.num_logits_to_keep.data[0], 1n);
});
