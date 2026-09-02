import type { AppLanguage, OpenRouterRoutingMode } from "../types";

type RoutingOption = { value: OpenRouterRoutingMode; label: string; description: string };

const copies: Record<AppLanguage, { title: string; description: string; defaultLabel: string; note: string; options: RoutingOption[] }> = {
  "zh-TW": {
    title: "Provider 路由模式",
    description: "決定同一個模型要優先交給哪個 OpenRouter Provider。",
    defaultLabel: "預設",
    note: "速度依 OpenRouter 最近 5 分鐘的統計判斷；平衡門檻是偏好，不會阻止備援 Provider 接手。",
    options: [
      { value: "balanced", label: "平衡", description: "優先約 45 tokens/s 以上的節點，再從中選擇便宜方案。" },
      { value: "speed", label: "極速", description: "吞吐量最高者優先；與 Nitro 路由等價，費用可能較高。" },
      { value: "economy", label: "省錢", description: "最低價格優先，適合背景整理與不急著等待的工作。" },
    ],
  },
  "zh-CN": {
    title: "Provider 路由模式",
    description: "决定同一个模型优先交给哪个 OpenRouter Provider。",
    defaultLabel: "默认",
    note: "速度依据 OpenRouter 最近 5 分钟的统计；平衡门槛属于偏好，不会阻止备用 Provider 接手。",
    options: [
      { value: "balanced", label: "平衡", description: "优先约 45 tokens/s 以上的节点，再从中选择便宜方案。" },
      { value: "speed", label: "极速", description: "吞吐量最高者优先；等同 Nitro 路由，费用可能较高。" },
      { value: "economy", label: "省钱", description: "最低价格优先，适合后台整理和不急着等待的工作。" },
    ],
  },
  en: {
    title: "Provider routing",
    description: "Choose which OpenRouter provider should handle the same model first.",
    defaultLabel: "Default",
    note: "Speed uses OpenRouter's recent five-minute metrics. The Balanced threshold is a preference, so fallback providers remain available.",
    options: [
      { value: "balanced", label: "Balanced", description: "Prefer providers near or above 45 tokens/s, then choose the cheaper option." },
      { value: "speed", label: "Max speed", description: "Highest throughput first. Equivalent to Nitro routing and may cost more." },
      { value: "economy", label: "Economy", description: "Lowest price first, best for background work that can wait." },
    ],
  },
  ja: {
    title: "Provider ルーティング",
    description: "同じモデルをどのOpenRouter Providerへ優先的に送るかを選びます。",
    defaultLabel: "既定",
    note: "速度はOpenRouterの直近5分の統計で判断します。バランスの基準は優先条件であり、フォールバックを妨げません。",
    options: [
      { value: "balanced", label: "バランス", description: "約45 tokens/s以上を優先し、その中から安いProviderを選びます。" },
      { value: "speed", label: "最速", description: "スループット順。Nitroと同等で、料金が高くなる場合があります。" },
      { value: "economy", label: "節約", description: "最低価格を優先。待ち時間を許容できるバックグラウンド作業向けです。" },
    ],
  },
  ko: {
    title: "Provider 라우팅 모드",
    description: "같은 모델을 어느 OpenRouter Provider에 먼저 보낼지 선택합니다.",
    defaultLabel: "기본",
    note: "속도는 OpenRouter의 최근 5분 통계를 사용합니다. 균형 기준은 선호 조건이므로 예비 Provider는 계속 사용할 수 있습니다.",
    options: [
      { value: "balanced", label: "균형", description: "약 45 tokens/s 이상을 우선한 뒤 그중 저렴한 Provider를 선택합니다." },
      { value: "speed", label: "최고 속도", description: "처리량이 높은 순서. Nitro와 같으며 비용이 더 높을 수 있습니다." },
      { value: "economy", label: "절약", description: "최저 가격 우선. 기다려도 되는 백그라운드 정리에 적합합니다." },
    ],
  },
};

export function getOpenRouterRoutingCopy(language: AppLanguage) {
  return copies[language] || copies.en;
}
