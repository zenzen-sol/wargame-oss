import { ImageResponse } from "next/og";

// Saas-side OG card. Mirrors apps/www/app/opengraph-image.tsx so a
// share of either domain renders the same graphic — the user lands
// at the product either way; no point splitting the framing.
//
// Runtime: Node.js (the default). Vercel's docs (as of 2026) call
// out Node.js as the supported runtime for OG image generation;
// `runtime = "edge"` is no longer the recommended path.

export const maxDuration = 30;
export const alt = "Wargame. Simulated negotiations for business contracts.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const WORDMARK = "Wargame";
const TAGLINE = "Simulated negotiations for business contracts";

// See apps/www/app/opengraph-image.tsx for the rationale on the
// User-Agent spoof and format regex. Kept inline (not extracted to
// a shared package) because the two OG generators are small enough
// that the duplication is cheaper than the package boundary.
async function loadGoogleFont(
  family: string,
  weight: 400 | 700,
  italic: boolean,
  text: string,
): Promise<ArrayBuffer> {
  const familyParam = family.replace(/ /g, "+");
  const cssUrl = `https://fonts.googleapis.com/css2?family=${familyParam}:ital,wght@${italic ? 1 : 0},${weight}&text=${encodeURIComponent(text)}`;
  const css = await fetch(cssUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    },
  }).then((r) => r.text());
  const match = css.match(
    /src: url\((.+?)\) format\('(?:woff2|woff|truetype|opentype)'\)/,
  );
  if (!match?.[1]) {
    throw new Error(
      `Could not find ${family} ${weight}${italic ? " italic" : ""} font URL`,
    );
  }
  return (await fetch(match[1])).arrayBuffer();
}

export default async function Image() {
  const [serifItalicBold, serifRegular] = await Promise.all([
    loadGoogleFont("Source Serif 4", 700, true, WORDMARK),
    loadGoogleFont("Source Serif 4", 400, true, TAGLINE),
  ]);

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignContent: "center",
        alignItems: "center",
        width: "100%",
        height: "100%",
        padding: 96,
        background: "#b91c1c",
        fontFamily: "Source Serif 4",
      }}
    >
      <div
        style={{
          fontSize: 128,
          fontStyle: "italic",
          fontWeight: 700,
          color: "rgba(255, 255, 255, 0.9)",
          letterSpacing: "-0.02em",
          marginBottom: 20,
          textAlign: "center",
        }}
      >
        {WORDMARK}
      </div>
      <div
        style={{
          fontSize: 48,
          fontStyle: "italic",
          color: "rgba(255, 255, 255, 0.6)",
          lineHeight: 1.2,
          maxWidth: 900,
          fontWeight: 400,
          textWrap: "balance",
          textAlign: "center",
        }}
      >
        {TAGLINE}
      </div>
    </div>,
    {
      ...size,
      fonts: [
        {
          name: "Source Serif 4",
          data: serifItalicBold,
          weight: 700,
          style: "italic",
        },
        {
          name: "Source Serif 4",
          data: serifRegular,
          weight: 400,
          style: "normal",
        },
      ],
    },
  );
}
