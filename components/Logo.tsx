// Mastermind Behavior Services logo — vector recreation of the brand mark
// (graduated "staircase" of bars + downward wedge) with the wordmark and
// tagline. Rendered inline so the page's Manrope font applies.
//
// To use the official artwork instead, drop the supplied file at
// public/mastermind-logo.svg (or .png) and swap this component for an <img>.

export default function Logo({ height = 40 }: { height?: number }) {
  // viewBox sized so the full wordmark fits without clipping.
  const width = (1230 / 300) * height;
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 1230 300"
      role="img"
      aria-label="Mastermind Behavior Services — Potential Into Reality"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* ----- staircase mark ----- */}
      {/* upper light bars, stepping wider */}
      <rect x="200" y="30" width="150" height="16" rx="8" fill="#b9e0e3" />
      <rect x="183" y="58" width="172" height="20" rx="9" fill="#93cace" />
      <rect x="166" y="89" width="190" height="24" rx="11" fill="#6fb3b8" />
      {/* central downward wedge */}
      <path d="M160 119 H300 L232 188 Z" fill="#3f8a90" />
      {/* lower base bars, stepping down to deep navy-teal */}
      <rect x="96" y="150" width="150" height="24" rx="11" fill="#357f86" />
      <rect x="72" y="182" width="160" height="26" rx="12" fill="#236b75" />
      <rect x="48" y="215" width="170" height="28" rx="13" fill="#14535f" />

      {/* ----- wordmark ----- */}
      <text
        x="372"
        y="170"
        fontFamily="var(--font-manrope, Manrope, system-ui, sans-serif)"
        fontSize="150"
        fontWeight="600"
        letterSpacing="-3"
        fill="#5fa7ad"
      >
        mastermind
      </text>

      {/* ----- tagline ----- */}
      <text
        x="378"
        y="232"
        fontFamily="var(--font-manrope, Manrope, system-ui, sans-serif)"
        fontSize="22"
        fontWeight="500"
        letterSpacing="5"
      >
        <tspan fill="#e8734a">BEHAVIOR SERVICES</tspan>
        <tspan fill="#c9c2b6"> │ </tspan>
        <tspan fill="#5fa7ad">POTENTIAL INTO REALITY</tspan>
      </text>
    </svg>
  );
}
