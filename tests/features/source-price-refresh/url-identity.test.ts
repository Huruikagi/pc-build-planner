import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSourcePageUrl,
  sameSourcePageUrl,
} from "../../../src/features/source-price-refresh/url-identity.js";

const normalized = (value: string): string => {
  const result = normalizeSourcePageUrl(value);
  assert.equal(result.ok, true, `正規化に失敗した: ${value}`);
  if (!result.ok) throw new Error("expected normalized url");
  return result.value;
};

const invalid = (value: string): void => {
  assert.deepEqual(
    normalizeSourcePageUrl(value),
    { ok: false, error: { kind: "invalid-url" } },
    `受理してはならないURL: ${value}`,
  );
};

test("HTTPとHTTPSだけを受理し、それ以外のschemeを invalid-url として拒否する", () => {
  assert.equal(
    normalized("http://shop.example.invalid/p/1"),
    "http://shop.example.invalid/p/1",
  );
  assert.equal(
    normalized("https://shop.example.invalid/p/1"),
    "https://shop.example.invalid/p/1",
  );

  for (const value of [
    "ftp://shop.example.invalid/p/1",
    "file:///c:/p/1",
    "javascript:alert(1)",
    "data:text/plain,price",
    "chrome-extension://abcdefghijklmnop/panel.html",
    "mailto:shop@example.invalid",
    "about:blank",
  ])
    invalid(value);
});

test("URLとして解釈できない文字列を invalid-url として拒否する", () => {
  for (const value of [
    "",
    "   ",
    "not a url",
    "/p/1",
    "shop.example.invalid/p/1",
    "http://",
    "https://",
  ])
    invalid(value);
});

test("schemeは同一性へ含め、httpとhttpsを別ソースとして扱う", () => {
  assert.equal(
    sameSourcePageUrl(
      "http://shop.example.invalid/p/1",
      "https://shop.example.invalid/p/1",
    ),
    false,
  );
});

test("hostnameのASCII大文字小文字差を吸収する", () => {
  assert.equal(
    normalized("https://Shop.Example.INVALID/p/1"),
    "https://shop.example.invalid/p/1",
  );
  assert.equal(
    sameSourcePageUrl(
      "https://SHOP.example.invalid/p/1",
      "https://shop.example.invalid/p/1",
    ),
    true,
  );
});

test("既定portだけを除去し、非既定portは同一性へ残す", () => {
  assert.equal(
    normalized("http://shop.example.invalid:80/p/1"),
    "http://shop.example.invalid/p/1",
  );
  assert.equal(
    normalized("https://shop.example.invalid:443/p/1"),
    "https://shop.example.invalid/p/1",
  );
  assert.equal(
    normalized("https://shop.example.invalid:8443/p/1"),
    "https://shop.example.invalid:8443/p/1",
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid:8443/p/1",
      "https://shop.example.invalid/p/1",
    ),
    false,
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid:443/p/1",
      "https://shop.example.invalid/p/1",
    ),
    true,
  );
});

test("fragmentを同一性から除去する", () => {
  assert.equal(
    normalized("https://shop.example.invalid/p/1#spec"),
    "https://shop.example.invalid/p/1",
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1#spec",
      "https://shop.example.invalid/p/1#price",
    ),
    true,
  );
  assert.equal(
    normalized("https://shop.example.invalid/p/1?sku=9#spec"),
    "https://shop.example.invalid/p/1?sku=9",
  );
});

test("root以外の末尾slashだけを除去し、root pathは保持する", () => {
  assert.equal(
    normalized("https://shop.example.invalid/p/1/"),
    "https://shop.example.invalid/p/1",
  );
  assert.equal(
    normalized("https://shop.example.invalid/"),
    "https://shop.example.invalid/",
  );
  assert.equal(
    normalized("https://shop.example.invalid"),
    "https://shop.example.invalid/",
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1/",
      "https://shop.example.invalid/p/1",
    ),
    true,
  );
  assert.equal(
    normalized("https://shop.example.invalid/p/1/?sku=9"),
    "https://shop.example.invalid/p/1?sku=9",
  );
  assert.equal(
    normalized("https://shop.example.invalid/p/1//"),
    "https://shop.example.invalid/p/1/",
    "pathの意味を保つため末尾slashは一つだけ除去する",
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1//",
      "https://shop.example.invalid/p/1",
    ),
    false,
  );
});

test("既知のtracking queryだけをcase-insensitiveに除去する", () => {
  assert.equal(
    normalized(
      "https://shop.example.invalid/p/1?utm_source=mail&utm_medium=cpc&UTM_Campaign=summer",
    ),
    "https://shop.example.invalid/p/1",
  );
  assert.equal(
    normalized(
      "https://shop.example.invalid/p/1?gclid=a&DCLID=b&fbclid=c&MsClkId=d",
    ),
    "https://shop.example.invalid/p/1",
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1?utm_source=mail",
      "https://shop.example.invalid/p/1",
    ),
    true,
  );
});

test("tracking風でも既知key以外のqueryは商品識別値として保持する", () => {
  assert.equal(
    normalized("https://shop.example.invalid/p/1?utm=1&utmsource=2&clid=3"),
    "https://shop.example.invalid/p/1?clid=3&utm=1&utmsource=2",
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1?utm=1",
      "https://shop.example.invalid/p/1",
    ),
    false,
  );
});

test("商品を識別し得るquery値の差を不一致として扱う", () => {
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1?sku=9",
      "https://shop.example.invalid/p/1?sku=10",
    ),
    false,
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1?sku=9",
      "https://shop.example.invalid/p/1",
    ),
    false,
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1?sku=9&color=red",
      "https://shop.example.invalid/p/1?sku=9",
    ),
    false,
  );
});

test("query順序差を安定sortで吸収し、valueを変更しない", () => {
  assert.equal(
    normalized("https://shop.example.invalid/p/1?sku=9&color=red"),
    "https://shop.example.invalid/p/1?color=red&sku=9",
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1?sku=9&color=red&utm_source=mail",
      "https://shop.example.invalid/p/1?color=red&sku=9",
    ),
    true,
  );
});

test("同じkeyの複数valueを損失なく保持し安定sortする", () => {
  assert.equal(
    normalized("https://shop.example.invalid/p/1?color=red&color=blue"),
    "https://shop.example.invalid/p/1?color=blue&color=red",
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1?color=red&color=blue",
      "https://shop.example.invalid/p/1?color=blue&color=red",
    ),
    true,
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1?color=red&color=blue",
      "https://shop.example.invalid/p/1?color=red",
    ),
    false,
  );
  assert.equal(
    normalized("https://shop.example.invalid/p/1?tag=b&tag=a&tag=b"),
    "https://shop.example.invalid/p/1?tag=a&tag=b&tag=b",
  );
});

test("空valueのqueryを保持し、値なしqueryと同一に扱う", () => {
  assert.equal(
    normalized("https://shop.example.invalid/p/1?sale="),
    "https://shop.example.invalid/p/1?sale=",
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1?sale",
      "https://shop.example.invalid/p/1?sale=",
    ),
    true,
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1?sale=",
      "https://shop.example.invalid/p/1",
    ),
    false,
  );
});

test("percent encodingは標準URL serializationのまま維持する", () => {
  assert.equal(
    normalized("https://shop.example.invalid/p/%E5%95%86%E5%93%81/1"),
    "https://shop.example.invalid/p/%E5%95%86%E5%93%81/1",
  );
  assert.equal(
    normalized("https://shop.example.invalid/p/1?q=a%20b"),
    normalized("https://shop.example.invalid/p/1?q=a+b"),
  );
  assert.equal(
    normalized("https://shop.example.invalid/p/1?q=~"),
    normalized("https://shop.example.invalid/p/1?q=%7E"),
    "URLSearchParams標準serializationで同値になる表現を独自処理しない",
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1?q=%E5%95%86",
      "https://shop.example.invalid/p/1?q=商",
    ),
    true,
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1?q=a%26b",
      "https://shop.example.invalid/p/1?q=a&b=",
    ),
    false,
  );
});

test("hostとpathの部分一致や登録ドメイン一致を同一取得元として扱わない", () => {
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1",
      "https://other.example.invalid/p/1",
    ),
    false,
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1",
      "https://www.shop.example.invalid/p/1",
    ),
    false,
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1",
      "https://shop.example.invalid/p/12",
    ),
    false,
  );
  assert.equal(
    sameSourcePageUrl(
      "https://shop.example.invalid/p/1",
      "https://shop.example.invalid/p/1/review",
    ),
    false,
  );
});

test("片側でも正規化できないURLは同一と判定しない", () => {
  assert.equal(
    sameSourcePageUrl("https://shop.example.invalid/p/1", "not a url"),
    false,
  );
  assert.equal(
    sameSourcePageUrl("ftp://shop.example.invalid/p/1", "not a url"),
    false,
  );
  assert.equal(
    sameSourcePageUrl(
      "ftp://shop.example.invalid/p/1",
      "ftp://shop.example.invalid/p/1",
    ),
    false,
  );
});

test("正規化結果は再正規化しても不変である", () => {
  const once = normalized(
    "https://Shop.Example.invalid:443/p/1/?utm_source=mail&sku=9&color=red#spec",
  );
  assert.equal(once, "https://shop.example.invalid/p/1?color=red&sku=9");
  assert.equal(normalized(once), once);
});
