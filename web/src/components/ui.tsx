// Waggle's drawn pieces: the bee logo and the faint hexagon background.

/** The bee from the Waggle logo, inline so stroke and fill follow the theme. */
export function BeeLogo({ size = 96, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className="bee"
    >
      <g stroke="var(--ink)" strokeWidth="2">
        <ellipse cx="20" cy="13" rx="6" ry="9" transform="rotate(-25 20 13)" fill="var(--card)" />
        <ellipse cx="29" cy="12" rx="5" ry="8" transform="rotate(20 29 12)" fill="var(--card)" />
        <ellipse cx="24" cy="28" rx="15" ry="11" fill="var(--honey)" />
        <path d="M19 18.6V37.4M26.5 17.8V38.2" strokeWidth="3" />
        <circle cx="34" cy="25" r="1.8" fill="var(--ink)" stroke="none" />
        <path d="M9 28H5" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Faint hexagons behind the sign-in hero. Decoration only. */
export function HexBackground() {
  return (
    <svg className="hex-bg" aria-hidden>
      <defs>
        <pattern id="waggle-hex" width="56" height="97" patternUnits="userSpaceOnUse">
          <path d="M28 0l28 16v32L28 64 0 48V16zM28 64v33M0 48v49M56 48v49" fill="none" stroke="var(--hex-line-soft)" strokeWidth="2" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#waggle-hex)" />
    </svg>
  );
}
