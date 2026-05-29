export function resolveVideoUrl(el) {
  if (!el) return null;
  if (el.tagName === "VIDEO") return el.currentSrc || el.src || null;
  if (el.tagName === "SOURCE") {
    const vid = el.closest("video");
    return vid ? (vid.currentSrc || vid.src || null) : null;
  }
  return null;
}
