const messages = {
  "zh-TW": { auth: "AI Provider 拒絕授權，請確認金鑰與使用權限。", missing: "AI Provider 找不到這個模型或 API 路徑。", rate: "AI Provider 已達額度或請求速率限制，請稍後再試。", server: "AI Provider 服務發生錯誤，請稍後再試。", rejected: "AI Provider 已收到請求，但不接受其中的設定。" },
  "zh-CN": { auth: "AI Provider 拒绝授权，请检查密钥与权限。", missing: "AI Provider 找不到该模型或 API 路径。", rate: "AI Provider 已达额度或请求频率限制，请稍后重试。", server: "AI Provider 服务发生错误，请稍后重试。", rejected: "AI Provider 已收到请求，但不接受其中的设置。" },
  en: { auth: "The AI provider denied authorization. Check your key and permissions.", missing: "The AI provider could not find this model or API path.", rate: "The AI provider reached a quota or rate limit. Try again later.", server: "The AI provider encountered a server error. Try again later.", rejected: "The AI provider received the request but rejected its settings." },
  ja: { auth: "AI Providerが認証を拒否しました。キーと権限を確認してください。", missing: "モデルまたはAPIパスが見つかりません。", rate: "AI Providerの利用枠または回数制限に達しました。後でもう一度お試しください。", server: "AI Providerでサーバーエラーが発生しました。", rejected: "AI Providerがリクエストの設定を受け付けませんでした。" },
  ko: { auth: "AI Provider가 인증을 거부했습니다. 키와 권한을 확인하세요.", missing: "AI Provider가 모델 또는 API 경로를 찾지 못했습니다.", rate: "AI Provider의 할당량 또는 요청 제한에 도달했습니다. 나중에 다시 시도하세요.", server: "AI Provider에 서버 오류가 발생했습니다.", rejected: "AI Provider가 요청을 받았지만 설정을 거부했습니다." },
};
function providerHttpError(code, language) {
  const match = /^provider-http-(\d+)(?::(.*))?$/s.exec(code);
  if (!match) return null;
  const status = Number(match[1]);
  const copy = messages[language] || messages.en;
  const reason = [401, 403].includes(status) ? copy.auth : status === 404 ? copy.missing : status === 429 ? copy.rate : status >= 500 ? copy.server : copy.rejected;
  return match[2]?.trim() ? `${reason} (${match[2].trim()})` : reason;
}
module.exports = { providerHttpError };
