/**
 * メーカー公式サイトの登録簿。
 *
 * この表はページを巡回したり、サイト固有の DOM を読んだりしない。利用者が
 * 開いている URL のホスト名だけを、登録済みの公式ドメインと照合するためのもの。
 * `manufacturer` は製品を販売するメーカーであり、CPU/GPU の設計元ではない。
 */
import type { PartCategory } from "../model.js";

export interface ManufacturerDomainEntry {
  readonly manufacturer: string;
  /** パスを含まない、メーカーに帰属する登録可能ドメイン。 */
  readonly domains: readonly string[];
  readonly categories: readonly PartCategory[];
}

export interface ManufacturerDomainMatch {
  readonly entry: ManufacturerDomainEntry;
  /** 実際に URL と一致した、登録済み公式ドメイン。 */
  readonly domain: string;
}

const GPU: readonly PartCategory[] = ["gpu"];
const COOLING: readonly PartCategory[] = ["cpu-cooler", "case-fan"];

/**
 * 初期登録分。カテゴリは登録簿の保守・将来の source kind 判定用であり、
 * manufacturer の補完自体はカテゴリによって制限しない。
 */
export const MANUFACTURER_DOMAIN_ENTRIES: readonly ManufacturerDomainEntry[] = [
  { manufacturer: "Intel", domains: ["intel.com"], categories: ["cpu", "gpu"] },
  { manufacturer: "AMD", domains: ["amd.com"], categories: ["cpu", "gpu"] },
  {
    manufacturer: "ASUS",
    domains: ["asus.com"],
    categories: ["gpu", "motherboard"],
  },
  {
    manufacturer: "ASRock",
    domains: ["asrock.com"],
    categories: ["gpu", "motherboard"],
  },
  {
    manufacturer: "MSI",
    domains: ["msi.com"],
    categories: ["gpu", "motherboard"],
  },
  {
    manufacturer: "GIGABYTE",
    domains: ["gigabyte.com"],
    categories: ["gpu", "motherboard"],
  },
  { manufacturer: "ZOTAC", domains: ["zotac.com"], categories: GPU },
  { manufacturer: "Palit", domains: ["palit.com"], categories: GPU },
  { manufacturer: "PNY", domains: ["pny.com"], categories: GPU },
  { manufacturer: "Sapphire", domains: ["sapphiretech.com"], categories: GPU },
  { manufacturer: "PowerColor", domains: ["powercolor.com"], categories: GPU },
  { manufacturer: "玄人志向", domains: ["kuroutoshikou.com"], categories: GPU },
  {
    manufacturer: "BIOSTAR",
    domains: ["biostar.com.tw"],
    categories: ["motherboard"],
  },
  {
    manufacturer: "Crucial",
    domains: ["crucial.com"],
    categories: ["memory", "storage"],
  },
  {
    manufacturer: "Corsair",
    domains: ["corsair.com"],
    categories: ["memory", "power-supply", "case", ...COOLING],
  },
  {
    manufacturer: "Kingston",
    domains: ["kingston.com"],
    categories: ["memory", "storage"],
  },
  { manufacturer: "G.Skill", domains: ["gskill.com"], categories: ["memory"] },
  {
    manufacturer: "TeamGroup",
    domains: ["teamgroupinc.com"],
    categories: ["memory", "storage"],
  },
  {
    manufacturer: "ADATA",
    domains: ["adata.com"],
    categories: ["memory", "storage"],
  },
  { manufacturer: "CFD", domains: ["cfd.co.jp"], categories: ["memory"] },
  {
    manufacturer: "Samsung",
    domains: ["samsung.com"],
    categories: ["storage"],
  },
  {
    manufacturer: "Western Digital",
    domains: ["westerndigital.com"],
    categories: ["storage"],
  },
  {
    manufacturer: "Seagate",
    domains: ["seagate.com"],
    categories: ["storage"],
  },
  { manufacturer: "KIOXIA", domains: ["kioxia.com"], categories: ["storage"] },
  {
    manufacturer: "Solidigm",
    domains: ["solidigm.com"],
    categories: ["storage"],
  },
  {
    manufacturer: "SK hynix",
    domains: ["skhynix.com"],
    categories: ["storage"],
  },
  {
    manufacturer: "Seasonic",
    domains: ["seasonic.com"],
    categories: ["power-supply"],
  },
  {
    manufacturer: "Thermaltake",
    domains: ["thermaltake.com"],
    categories: ["power-supply", "case", "cpu-cooler"],
  },
  {
    manufacturer: "Cooler Master",
    domains: ["coolermaster.com"],
    categories: ["power-supply", "case", ...COOLING],
  },
  {
    manufacturer: "be quiet!",
    domains: ["bequiet.com"],
    categories: ["power-supply", "case", "case-fan"],
  },
  {
    manufacturer: "FSP",
    domains: ["fsplifestyle.com"],
    categories: ["power-supply"],
  },
  {
    manufacturer: "Super Flower",
    domains: ["super-flower.com"],
    categories: ["power-supply"],
  },
  {
    manufacturer: "Antec",
    domains: ["antec.com"],
    categories: ["power-supply", "case"],
  },
  {
    manufacturer: "Fractal Design",
    domains: ["fractal-design.com"],
    categories: ["case"],
  },
  {
    manufacturer: "NZXT",
    domains: ["nzxt.com"],
    categories: ["case", "cpu-cooler"],
  },
  {
    manufacturer: "Lian Li",
    domains: ["lian-li.com"],
    categories: ["case", "case-fan"],
  },
  { manufacturer: "Noctua", domains: ["noctua.at"], categories: COOLING },
  {
    manufacturer: "DeepCool",
    domains: ["deepcool.com"],
    categories: ["cpu-cooler"],
  },
  {
    manufacturer: "Thermalright",
    domains: ["thermalright.com"],
    categories: ["cpu-cooler"],
  },
  {
    manufacturer: "Scythe",
    domains: ["scythe.co.jp", "scytheus.com"],
    categories: COOLING,
  },
  { manufacturer: "Arctic", domains: ["arctic.de"], categories: ["case-fan"] },
];

const domainMatchesHost = (hostname: string, domain: string): boolean =>
  hostname === domain || hostname.endsWith(`.${domain}`);

/** URL が登録済みメーカー公式ドメインなら、一致した登録内容を返す。 */
export const manufacturerDomainMatchForUrl = (
  pageUrl: string,
): ManufacturerDomainMatch | undefined => {
  let hostname: string;
  try {
    hostname = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  for (const entry of MANUFACTURER_DOMAIN_ENTRIES) {
    const domain = entry.domains.find((candidate) =>
      domainMatchesHost(hostname, candidate),
    );
    if (domain !== undefined) return { entry, domain };
  }
  return undefined;
};

/** URL が登録済みメーカー公式ドメインなら、そのエントリを返す。 */
export const manufacturerDomainEntryForUrl = (
  pageUrl: string,
): ManufacturerDomainEntry | undefined =>
  manufacturerDomainMatchForUrl(pageUrl)?.entry;
