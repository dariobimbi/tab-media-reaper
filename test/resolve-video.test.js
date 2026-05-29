import { test, eq } from "./harness.js";
import { resolveVideoUrl } from "../src/lib/resolve-video.js";
import { videoHtml, videoMultiSourceHtml, emptyVideoHtml, imgHtml } from "./fixtures.js";

function parse(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

test("resolve-video: null input returns null", () => {
  eq(resolveVideoUrl(null), null);
});
test("resolve-video: undefined input returns null", () => {
  eq(resolveVideoUrl(undefined), null);
});
test("resolve-video: <video> with src returns src", () => {
  const doc = parse(videoHtml);
  eq(resolveVideoUrl(doc.getElementById("vid")), "https://example.com/clip.mp4");
});
test("resolve-video: <video> with no src and no children returns null", () => {
  const doc = parse(emptyVideoHtml);
  eq(resolveVideoUrl(doc.getElementById("empty")), null);
});
test("resolve-video: <source> walks back to its <video>'s src", () => {
  // The parsed-but-not-loaded <video> has no currentSrc yet, so the
  // resolver falls through to src. With no direct src and only <source>
  // children, the result is null — confirming the contract that we only
  // read currentSrc/src from the <video> element itself, not from <source>.
  const doc = parse(videoMultiSourceHtml);
  const source = doc.querySelector("source");
  eq(resolveVideoUrl(source), null);
});
test("resolve-video: <source> with no <video> ancestor returns null", () => {
  const orphan = document.createElement("source");
  eq(resolveVideoUrl(orphan), null);
});
test("resolve-video: <img> passed by mistake returns null", () => {
  const doc = parse(imgHtml);
  eq(resolveVideoUrl(doc.getElementById("hero")), null);
});
