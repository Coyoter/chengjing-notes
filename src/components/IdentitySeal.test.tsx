import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IdentitySeal } from "./IdentitySeal";

describe("共享身分向量印記", () => {
  it("在固定圓形內輸出可縮放的向量紋路", () => {
    const html = renderToStaticMarkup(<IdentitySeal color="#718a9a" pattern={5} size="medium" />);
    expect(html).toContain("identity-seal size-medium");
    expect(html).toContain("data-identity-pattern=\"5\"");
    expect(html).toContain("<svg");
    expect(html).toContain("<path");
  });

  it("不同種子會選擇不同的具象紋路家族", () => {
    const orbit = renderToStaticMarkup(<IdentitySeal color="#718a9a" pattern={0} />);
    const circuit = renderToStaticMarkup(<IdentitySeal color="#718a9a" pattern={5} />);
    expect(orbit).not.toBe(circuit);
    expect(orbit).toContain("data-identity-pattern=\"0\"");
    expect(circuit).toContain("data-identity-pattern=\"5\"");
  });
});
