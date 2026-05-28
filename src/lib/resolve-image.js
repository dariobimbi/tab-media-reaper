export function resolveImageUrl(el) {
  if (!el) return null;
  if (el.tagName === "IMG") return el.currentSrc || el.src || null;
  if (el.tagName === "PICTURE") {
    const img = el.querySelector("img");
    return img ? (img.currentSrc || img.src || null) : null;
  }
  if (el.tagName === "SOURCE") {
    const pic = el.closest("picture");
    const img = pic ? pic.querySelector("img") : null;
    return img ? (img.currentSrc || img.src || null) : null;
  }
  return null;
}
