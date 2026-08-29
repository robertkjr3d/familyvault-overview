// Bug fix (Aug 28, 2026): each household member picks their own raw hex
// color (stored in the members table), and MemberDot has always applied it
// directly as inline style with no theme adjustment. That's fine on light
// mode's white background, but a color a member picked for contrast against
// white can be nearly unreadable against dark mode's near-black background
// (or the reverse) — confirmed as the real cause of the "member cards hard
// to read in dark mode" report, not a CSS variable issue like the status
// tint colors below it.
//
// Fix: convert the stored hex to HSL and clamp lightness away from the
// background it'll actually sit on, per theme — brighten a too-dark color
// for dark mode, darken a too-light color for light mode — while leaving
// hue and saturation untouched, so it's still recognizably "that member's
// color," just guaranteed legible.

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  return [parseInt(m.substring(0, 2), 16) / 255, parseInt(m.substring(2, 4), 16) / 255, parseInt(m.substring(4, 6), 16) / 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

function toHexByte(x: number): string {
  return Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0");
}

/**
 * Returns a hex color guaranteed to have enough lightness contrast for the
 * given theme, preserving the original hue/saturation. Safe to call with an
 * already-legible color — it's a no-op in that case (only clamps when the
 * lightness is actually on the wrong side of the threshold).
 */
export function readableMemberColor(hex: string, isDark: boolean): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex; // not a plain hex value — leave untouched rather than guess
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  let l2 = l;
  if (isDark && l < 0.55) l2 = 0.65;
  if (!isDark && l > 0.75) l2 = 0.55;
  if (l2 === l) return hex;
  const [r2, g2, b2] = hslToRgb(h, s, l2);
  return `#${toHexByte(r2)}${toHexByte(g2)}${toHexByte(b2)}`;
}
