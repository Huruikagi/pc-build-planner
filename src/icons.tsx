/**
 * ナビゲーションと操作のアイコン。すべて stroke ベースの inline SVG で、
 * 色は `currentColor` に従う。
 *
 * アイコン単独に意味を持たせない。ナビゲーションでは必ずラベルを併記する
 * (`docs/reverse/changes.md` C-2-5)。
 */

interface IconProps {
  readonly size?: number;
}

export const PartsIcon = ({ size = 14 }: IconProps) => (
  <svg
    aria-hidden="true"
    className="nav__icon"
    fill="none"
    height={size}
    stroke="currentColor"
    strokeLinecap="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width={size}
  >
    <line x1="8" x2="21" y1="6" y2="6" />
    <line x1="8" x2="21" y1="12" y2="12" />
    <line x1="8" x2="21" y1="18" y2="18" />
    <circle cx="3.5" cy="6" fill="currentColor" r="1.2" stroke="none" />
    <circle cx="3.5" cy="12" fill="currentColor" r="1.2" stroke="none" />
    <circle cx="3.5" cy="18" fill="currentColor" r="1.2" stroke="none" />
  </svg>
);

export const BuildIcon = ({ size = 14 }: IconProps) => (
  <svg
    aria-hidden="true"
    className="nav__icon"
    fill="none"
    height={size}
    stroke="currentColor"
    strokeLinecap="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width={size}
  >
    <rect height="10" rx="1" width="10" x="7" y="7" />
    <path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />
  </svg>
);

/**
 * 噛み合う 2 ピース。1 ピースの線画は 14px で凹凸が潰れて読めなかったため、
 * 塗りの 2 ピースにしている (`changes.md` C-2-5)。濃淡は `currentColor` の
 * 不透明度で作るので、非選択のグレーでも選択時の青でも成立する。
 */
export const CompatibilityIcon = ({ size = 14 }: IconProps) => (
  <svg
    aria-hidden="true"
    className="nav__icon"
    fill="currentColor"
    height={size}
    viewBox="0 0 24 24"
    width={size}
  >
    <path d="M3 3h5.4v1.4a1.8 1.8 0 0 0 3.6 0V3h.6v18h-.6v-1.4a1.8 1.8 0 0 0-3.6 0V21H3z" />
    <path
      d="M21 3h-5.4v1.4a1.8 1.8 0 0 1-3.6 0V3h-.6v18h.6v-1.4a1.8 1.8 0 0 1 3.6 0V21H21z"
      opacity="0.45"
    />
  </svg>
);

export const ChevronIcon = ({ open }: { readonly open: boolean }) => (
  <svg
    aria-hidden="true"
    fill="none"
    height="12"
    stroke="currentColor"
    strokeLinecap="round"
    strokeWidth="2.5"
    viewBox="0 0 24 24"
    width="12"
  >
    <polyline points={open ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
  </svg>
);

export const CheckIcon = () => (
  <svg
    aria-hidden="true"
    fill="none"
    height="14"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2.5"
    viewBox="0 0 24 24"
    width="14"
  >
    <polyline points="4 12 9 17 20 6" />
  </svg>
);

export const RenameIcon = () => (
  <svg
    aria-hidden="true"
    fill="none"
    height="14"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width="14"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

export const DeleteIcon = () => (
  <svg
    aria-hidden="true"
    fill="none"
    height="14"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width="14"
  >
    <path d="M4 7h16" />
    <path d="M9 7V5h6v2" />
    <path d="M6 7l1 13h10l1-13" />
  </svg>
);

export const PlusIcon = () => (
  <svg
    aria-hidden="true"
    fill="none"
    height="14"
    stroke="currentColor"
    strokeLinecap="round"
    strokeWidth="2.5"
    viewBox="0 0 24 24"
    width="14"
  >
    <line x1="12" x2="12" y1="5" y2="19" />
    <line x1="5" x2="19" y1="12" y2="12" />
  </svg>
);
