const tests = [];
export function test(name, fn) { tests.push({ name, fn }); }
export function ok(v, msg) { if (!v) throw new Error(msg || `expected truthy, got ${v}`); }
export function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg || `expected ${e}, got ${a}`);
}
export function throws(fn, msg) {
  try { fn(); } catch { return; }
  throw new Error(msg || "expected function to throw");
}
export async function run() {
  const root = document.getElementById("results");
  let pass = 0, fail = 0;
  for (const t of tests) {
    try { await t.fn(); pass++; line(root, `✓ ${t.name}`, "green"); }
    catch (e) { fail++; line(root, `✗ ${t.name} — ${e.message}`, "crimson"); }
  }
  const h = document.createElement("h2");
  h.textContent = `${pass} passed, ${fail} failed`;
  h.style.color = fail ? "crimson" : "green";
  root.prepend(h);
  console.log(`${pass} passed, ${fail} failed`);
}
function line(root, text, color) {
  const d = document.createElement("div");
  d.textContent = text; d.style.color = color; d.style.fontFamily = "monospace";
  root.appendChild(d);
}
