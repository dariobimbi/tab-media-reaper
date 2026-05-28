/** Return the leaf filename from a URL, with a .jpg fallback. */
export function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "data:") return "image.jpg";
    const last = u.pathname.split("/").filter(Boolean).pop() || "image";
    if (!/\.[a-z0-9]{2,5}$/i.test(last)) return last + ".jpg";
    return last;
  } catch {
    return "image.jpg";
  }
}
