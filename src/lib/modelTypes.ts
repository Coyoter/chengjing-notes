export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIResponse {
  text: string;
  model: string;
  usage: Record<string, number> | null;
  finishReason: string | null;
}

