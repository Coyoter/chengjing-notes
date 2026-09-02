import { describe, expect, it } from "vitest";
import { languageOptions, translate } from "../i18n";
import { getKnowledgeCopy } from "./knowledgeCopy";

describe("知識架構五語文案", () => {
  it("每種語言都有領域與主題管理文案", () => {
    for (const { value } of languageOptions) {
      const knowledge = getKnowledgeCopy(value);
      expect(knowledge.area).toBeTruthy();
      expect(knowledge.topic).toBeTruthy();
      expect(knowledge.confirmRemove("Test")).toContain("Test");
      expect(knowledge.confirmRemoveArea("Test")).toContain("Test");
      expect(translate(value, "card.backToLibrary")).toBeTruthy();
      expect(translate(value, "ai.newConversation")).toBeTruthy();
      expect(translate(value, "ai.referenceLabel")).toBeTruthy();
      expect(translate(value, "ai.referenceTitle", { title: "Test" })).toContain("Test");
      expect(translate(value, "ai.recommendedPrompts")).toBeTruthy();
      expect(translate(value, "ai.summarizeCard")).toBeTruthy();
      expect(translate(value, "ai.syncLocalHintOn")).toBeTruthy();
      expect(translate(value, "ai.syncLocalHintOff")).toBeTruthy();
      expect(translate(value, "ai.searchOtherCards")).toBeTruthy();
      expect(translate(value, "update.dailyDescription")).toBeTruthy();
      expect(translate(value, "update.dailyAutoCheck")).toBeTruthy();
      expect(translate(value, "update.quitDescription")).toBeTruthy();
      expect(translate(value, "update.quitForReplace")).toBeTruthy();
    }
  });
});
