import { test, eq } from "./harness.js";
import { resolveImageUrl } from "../src/lib/resolve-image.js";
import { imgHtml, pictureHtml, emptyImgHtml } from "./fixtures.js";

function parse(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

test("resolve: null input returns null", () => {
  eq(resolveImageUrl(null), null);
});
test("resolve: undefined input returns null", () => {
  eq(resolveImageUrl(undefined), null);
});
test("resolve: <img> with src returns src", () => {
  const doc = parse(imgHtml);
  eq(resolveImageUrl(doc.getElementById("hero")), "https://example.com/hero.jpg");
});
test("resolve: <img> with no src returns null", () => {
  const doc = parse(emptyImgHtml);
  eq(resolveImageUrl(doc.getElementById("empty")), null);
});
test("resolve: <img> with srcset prefers currentSrc when set", () => {
  // Build a live <img> with currentSrc populated by attaching to the document.
  const img = document.createElement("img");
  img.src = "https://example.com/small.jpg";
  // currentSrc reflects what the UA picked. In a JSDOM-free real browser
  // it equals src once src is set on an attached img element.
  document.body.appendChild(img);
  // Force layout / resource resolution.
  void img.currentSrc;
  eq(resolveImageUrl(img), img.currentSrc || "https://example.com/small.jpg");
  document.body.removeChild(img);
});
test("resolve: <picture> reads inner <img>", () => {
  const doc = parse(pictureHtml);
  eq(resolveImageUrl(doc.getElementById("pic")), "https://example.com/fallback.jpg");
});
test("resolve: <source> walks back to its <picture>'s <img>", () => {
  const doc = parse(pictureHtml);
  const source = doc.querySelector("source");
  eq(resolveImageUrl(source), "https://example.com/fallback.jpg");
});
test("resolve: <div> returns null", () => {
  const doc = parse(imgHtml);
  eq(resolveImageUrl(doc.getElementById("root")), null);
});
test("resolve: detached <source> with no parent <picture> returns null", () => {
  const orphan = document.createElement("source");
  eq(resolveImageUrl(orphan), null);
});
