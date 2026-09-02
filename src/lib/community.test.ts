import { beforeEach, describe, expect, it } from "vitest";
import { clearCommunityIdentity, communityIdentityPattern, getCommunityIdentity, normalizeCommunityDisplayName, saveCommunityIdentity, validateCommunityDisplayName } from "./community";

describe("共享身分", () => {
  beforeEach(() => localStorage.clear());

  it("只接受中英日韓純文字與單一內部空格", () => {
    expect(validateCommunityDisplayName("Amber")).toBeNull();
    expect(validateCommunityDisplayName("山田 花子")).toBeNull();
    expect(validateCommunityDisplayName("김 민수")).toBeNull();
    expect(normalizeCommunityDisplayName("  Amber   Lin  ")).toBe("Amber Lin");
    expect(validateCommunityDisplayName("Amber_01")).toBe("characters");
    expect(validateCommunityDisplayName("<script>")) .toBe("characters");
    expect(validateCommunityDisplayName("管理員")).toBe("reserved");
  });

  it("同一份共享身分可由許願池與第二大腦共同讀取", () => {
    const identity = { id: crypto.randomUUID(), displayName: "Amber", token: `${crypto.randomUUID()}.${"a".repeat(44)}`, seal: "#718a9a" };
    saveCommunityIdentity(identity);
    expect(getCommunityIdentity()).toEqual({ ...identity, pattern: communityIdentityPattern(identity.id) });
    clearCommunityIdentity();
    expect(getCommunityIdentity()).toBeNull();
  });

  it("同一身分的紋路穩定，同名但不同 ID 會產生不同指紋", () => {
    const first = communityIdentityPattern("11111111-1111-4111-8111-111111111111");
    expect(communityIdentityPattern("11111111-1111-4111-8111-111111111111")).toBe(first);
    expect(communityIdentityPattern("22222222-2222-4222-8222-222222222222")).not.toBe(first);
  });
});
