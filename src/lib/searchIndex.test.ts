import { describe, expect, it } from "vitest";
import { searchIndexTerms, searchQueryTerms } from "./searchIndex";

describe("search index", () => {
  it("為中日韓文字建立可搜尋的雙字索引", () => {
    expect(searchIndexTerms("股市下跌讓人心累", "zh-TW")).toEqual(expect.arrayContaining(["股市", "下跌", "心累"]));
  });

  it("為拉丁文字保留完整詞與前綴", () => {
    expect(searchQueryTerms("Product", "en")).toEqual(expect.arrayContaining(["product", "pro"]));
  });
});
