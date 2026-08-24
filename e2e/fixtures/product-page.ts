/**
 * 検証用の商品ページ。**架空のもののみ**で、実在のサイト・商品・URL は
 * 使わない (`docs/reverse/features.md` 9 章)。
 *
 * 取り込みが見る手掛かりを一通り含めてある: JSON-LD、OpenGraph、パンくず、
 * 見出し、仕様表、定義リスト。最後の 1 件は制御文字を混ぜてあり、棄却が
 * 理由付きで提示されることの検証に使う。
 */
export const PRODUCT_PAGE_URL = "http://pcbp.test/gpu/syn-5080s";

export const PRODUCT_PAGE_HTML = `<!doctype html><html lang="ja"><head>
<meta charset="utf-8">
<title>SYN GeForce RTX 5080 SUPER 16GB - 架空ストア</title>
<meta property="og:title" content="SYN GeForce RTX 5080 SUPER 16GB">
<meta property="og:site_name" content="架空ストア">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product",
"name":"SYN GeForce RTX 5080 SUPER 16GB",
"category":"グラフィックボード",
"brand":{"@type":"Brand","name":"SYNVIDIA"},
"mpn":"SYN-5080S-16G",
"offers":{"@type":"Offer","price":"189800","priceCurrency":"JPY"}}
</script></head><body>
<nav aria-label="breadcrumb"><ol class="breadcrumb">
<li>トップ</li><li>PCパーツ</li><li>グラフィックボード</li></ol></nav>
<h1>SYN GeForce RTX 5080 SUPER 16GB</h1>
<table>
<tr><th>メーカー</th><td>SYNVIDIA</td></tr>
<tr><th>型番</th><td>SYN-5080S-16G</td></tr>
</table>
<dl><dt>ブランド</dt><dd>SYNVIDIA</dd></dl>
</body></html>`;

/** 商品情報を何も持たないページ。自動取得できない場合の検証に使う。 */
export const BLANK_PAGE_URL = "http://pcbp.test/blank";

export const BLANK_PAGE_HTML =
  '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>SYN blank</title></head><body><p>本文だけのページ</p></body></html>';
