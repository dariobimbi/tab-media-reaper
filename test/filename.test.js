import { test, eq } from "./harness.js";
import { filenameFromUrl } from "../src/lib/filename.js";

test("filename: standard URL with .jpg", () => {
  eq(filenameFromUrl("https://example.com/path/photo.jpg"), "photo.jpg");
});
test("filename: case-insensitive extension (.PNG)", () => {
  eq(filenameFromUrl("https://example.com/IMG.PNG"), "IMG.PNG");
});
test("filename: no extension gets .jpg", () => {
  eq(filenameFromUrl("https://example.com/path/photo"), "photo.jpg");
});
test("filename: query string is stripped", () => {
  eq(filenameFromUrl("https://example.com/photo.jpg?w=800&v=2"), "photo.jpg");
});
test("filename: hash is stripped", () => {
  eq(filenameFromUrl("https://example.com/photo.jpg#anchor"), "photo.jpg");
});
test("filename: trailing slash falls back to 'image.jpg'", () => {
  eq(filenameFromUrl("https://example.com/"), "image.jpg");
});
test("filename: data: URL falls through to 'image.jpg'", () => {
  eq(filenameFromUrl("data:image/png;base64,iVBOR..."), "image.jpg");
});
test("filename: blob: URL with UUID gets .jpg", () => {
  const out = filenameFromUrl("blob:https://example.com/12345678-1234-1234-1234-123456789abc");
  eq(out, "12345678-1234-1234-1234-123456789abc.jpg");
});
test("filename: garbage string falls back to 'image.jpg'", () => {
  eq(filenameFromUrl("not a url"), "image.jpg");
});
test("filename: null/undefined falls back to 'image.jpg'", () => {
  eq(filenameFromUrl(null), "image.jpg");
  eq(filenameFromUrl(undefined), "image.jpg");
});
