import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PrivacyPolicyPage, meta } from "./routes/privacy";

describe("privacy policy route", () => {
  it("renders the company privacy policy for Shopify review", () => {
    const html = renderToStaticMarkup(<PrivacyPolicyPage />);

    expect(meta()).toContainEqual({ title: "Privacy Policy | Lens Search" });
    expect(html).toContain("Privacy Policy");
    expect(html).toContain("隐私政策");
    expect(html).toContain("本版生效时间：2026年6月1日");
    expect(html).toContain("上海竟策科技有限公司");
  });
});
