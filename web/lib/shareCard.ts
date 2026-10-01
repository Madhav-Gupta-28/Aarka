"use client";

import {RELIC} from "./relics";

/**
 * A picture of a position, ready to post: 1200×630, the size X and most chats preview. Drawn on a
 * canvas in the site's own type and pixel art, so it looks like the product and not a screenshot.
 * On a phone that can share files it opens the share sheet; everywhere else it downloads the image
 * and opens a post on X with the words filled in, for the person to attach it.
 */

export type Card = {
  kicker: string;     // "SPLIT · NVIDIA · $230 LINE · ENDS OCT 2"
  headline: string;   // "Kept the Floor. Took $1.66 in cash."
  big: string;        // "$1.66"
  sub: string;        // "cash today, on one NVIDIA share"
  half: "floor" | "upside" | "both";
  post: string;       // the words for the post
};

const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = rej;
  i.src = src;
});

const cssVar = (n: string, fb: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;

export async function drawCard(c: Card): Promise<Blob> {
  const W = 1200, H = 630;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const x = cv.getContext("2d")!;
  x.imageSmoothingEnabled = false;
  await (document.fonts?.ready ?? Promise.resolve());
  const serif = cssVar("--f-display", "serif"), mono = cssVar("--f-num", "monospace"), px = cssVar("--f-px", "monospace");

  // Basalt, the column grid, and a warm sun glow behind the coin.
  x.fillStyle = "#0E1116"; x.fillRect(0, 0, W, H);
  x.strokeStyle = "#191D24"; x.lineWidth = 1;
  for (let gx = 60; gx < W; gx += 90) { x.beginPath(); x.moveTo(gx + 0.5, 0); x.lineTo(gx + 0.5, H); x.stroke(); }
  const g = x.createRadialGradient(930, 300, 0, 930, 300, 300);
  g.addColorStop(0, "rgba(240,180,110,.30)"); g.addColorStop(1, "rgba(217,146,74,0)");
  x.fillStyle = g; x.fillRect(560, 0, 640, H);
  x.fillStyle = "#D9924A"; x.fillRect(0, 0, W, 6);

  // The halves, apart, with the one kept lit and the other dim.
  const [fl, up] = await Promise.all([load(RELIC.coinFloor), load(RELIC.coinUp)]);
  const S = 224;
  x.globalAlpha = c.half === "upside" ? 0.28 : 1; x.drawImage(fl, 770, 190, S, S);
  x.globalAlpha = c.half === "floor" ? 0.28 : 1; x.drawImage(up, 880, 210, S, S);
  x.globalAlpha = 1;

  // Words.
  x.textBaseline = "alphabetic";
  x.fillStyle = "#D9924A"; x.font = `500 20px ${mono}`;
  x.fillText(c.kicker.toUpperCase(), 64, 104);
  x.fillStyle = "#F7F4ED"; x.font = `64px ${serif}`;
  wrap(x, c.headline, 64, 190, 660, 72);
  x.fillStyle = "#F0B46E"; x.font = `600 120px ${mono}`;
  x.fillText(c.big, 60, 470);
  x.fillStyle = "#A9A49A"; x.font = `24px ${mono}`;
  x.fillText(c.sub, 64, 516);

  // Signature.
  x.fillStyle = "#2A2F38"; x.fillRect(64, 560, W - 128, 1);
  x.fillStyle = "#F7F4ED"; x.font = `30px ${serif}`;
  x.fillText("AARKA", 64, 604);
  x.fillStyle = "#A9A49A"; x.font = `18px ${px}`;
  const tag = "ONE SHARE · TWO HALVES · NO LIQUIDATIONS";
  x.fillText(tag, W - 64 - x.measureText(tag).width, 600);

  return new Promise((res) => cv.toBlob((b) => res(b!), "image/png"));
}

function wrap(x: CanvasRenderingContext2D, text: string, left: number, top: number, max: number, lh: number) {
  let line = "", y = top;
  for (const w of text.split(" ")) {
    const t = line ? `${line} ${w}` : w;
    if (x.measureText(t).width > max && line) { x.fillText(line, left, y); line = w; y += lh; }
    else line = t;
  }
  if (line) x.fillText(line, left, y);
}

/** Share the card: the native sheet where it can carry a file, else download and open X. */
export async function shareCard(c: Card): Promise<"shared" | "posted" | "cancelled"> {
  const blob = await drawCard(c);
  const file = new File([blob], "aarka-split.png", {type: "image/png"});
  const nav = navigator as Navigator & {canShare?: (d: ShareData) => boolean};
  if (nav.canShare?.({files: [file]})) {
    try { await nav.share({files: [file], text: c.post}); return "shared"; }
    catch { return "cancelled"; }
  }
  downloadBlob(blob, "aarka-split.png");
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(c.post)}`, "_blank", "noopener,noreferrer");
  return "posted";
}

export async function downloadCard(c: Card) {
  downloadBlob(await drawCard(c), "aarka-split.png");
}

function downloadBlob(b: Blob, name: string) {
  const u = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = u; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
