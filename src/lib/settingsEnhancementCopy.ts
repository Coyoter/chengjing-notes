import type { AppLanguage } from "../types";

const copies = {
  "zh-TW": {
    eyebrow: "支持實驗",
    title: "打賞作者",
    description: "澄境是一項實驗性的嘗試，會永久保持免費、無廣告。如果這個工具對你有幫助，歡迎自願打賞，支持後續改進。",
    promise: "打賞完全自願，不會解鎖或限制任何功能。",
    ecpay: "綠界",
    ecpayHint: "使用綠界科技贊助",
    paypal: "PayPal",
    paypalHint: "使用 PayPal 贊助",
  },
  "zh-CN": {
    eyebrow: "支持实验",
    title: "赞赏作者",
    description: "澄境是一项实验性的尝试，将永久保持免费、无广告。如果这个工具对你有帮助，欢迎自愿赞赏，支持后续改进。",
    promise: "赞赏完全自愿，不会解锁或限制任何功能。",
    ecpay: "绿界",
    ecpayHint: "使用绿界科技赞助",
    paypal: "PayPal",
    paypalHint: "使用 PayPal 赞助",
  },
  en: {
    eyebrow: "Support the experiment",
    title: "Tip the author",
    description: "ChengJing is an experimental project and will remain free and ad-free. If it helps you, an optional tip can support future improvements.",
    promise: "Tips are entirely optional and never unlock or restrict features.",
    ecpay: "ECPay",
    ecpayHint: "Support through ECPay",
    paypal: "PayPal",
    paypalHint: "Support through PayPal",
  },
  ja: {
    eyebrow: "実験を応援",
    title: "作者を支援",
    description: "澄境は実験的な試みで、これからも無料・広告なしを維持します。役に立ったと感じた場合は、任意の支援で今後の改善を応援できます。",
    promise: "支援は完全に任意で、機能の解放や制限には関係しません。",
    ecpay: "ECPay",
    ecpayHint: "ECPayで支援",
    paypal: "PayPal",
    paypalHint: "PayPalで支援",
  },
  ko: {
    eyebrow: "실험 응원하기",
    title: "제작자 후원",
    description: "ChengJing은 실험적인 프로젝트이며 앞으로도 무료·무광고로 유지됩니다. 도움이 되었다면 선택적인 후원으로 향후 개선을 응원할 수 있습니다.",
    promise: "후원은 전적으로 선택 사항이며 기능을 잠금 해제하거나 제한하지 않습니다.",
    ecpay: "ECPay",
    ecpayHint: "ECPay로 후원",
    paypal: "PayPal",
    paypalHint: "PayPal로 후원",
  },
} as const;

export function getSettingsEnhancementCopy(language: AppLanguage) {
  return copies[language] || copies.en;
}
