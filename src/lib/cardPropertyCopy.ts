import type { AppLanguage } from "../types";

const copies = {
  "zh-TW": { name: "屬性名稱", value: "屬性內容", exists: "這個屬性已經存在。", added: "已新增卡片屬性。", remove: "移除屬性" },
  "zh-CN": { name: "属性名称", value: "属性内容", exists: "这个属性已经存在。", added: "已新增卡片属性。", remove: "移除属性" },
  en: { name: "Property name", value: "Property value", exists: "This property already exists.", added: "Card property added.", remove: "Remove property" },
  ja: { name: "プロパティ名", value: "プロパティの内容", exists: "このプロパティはすでに存在します。", added: "カードのプロパティを追加しました。", remove: "プロパティを削除" },
  ko: { name: "속성 이름", value: "속성 내용", exists: "이미 존재하는 속성입니다.", added: "카드 속성을 추가했습니다.", remove: "속성 제거" },
} as const;

export function getCardPropertyCopy(language: AppLanguage) { return copies[language] || copies.en; }
