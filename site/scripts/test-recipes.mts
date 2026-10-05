// every recipe and example in the AI's reference must compile
import { languageReference } from "../app/lib/node/engine/reference.ts";
import { compileRules, decompileRules } from "../app/lib/node/engine/lang.ts";
import { validateCode } from "../app/lib/node/engine/vm.ts";
const A = "DXFqi6tXYGjavSCXEV7NHGYwsaWMqSszrx6VKcg6yUNq", B = "HYhbPTEqHkpYZEidUYbP5jgG69NnphYGqNKXQS4Ndgiz";
const ref = languageReference();
let bad = 0, n = 0;
const sets: string[] = [];
for (const line of ref.split("\n")) {
  const recipe = /^- [^:]+:\s+((?:refuse if|require|timezone|king_of_the_hill).*)$/.exec(line);
  if (recipe) { sets.push(recipe[1].split(/\s{2,}\+\s{2,}/).map((x) => x.trim()).filter((x) => /^(refuse if|require|timezone|king_of_the_hill)/.test(x)).join("\n")); continue; }
  if (/^(refuse if|require) /.test(line)) sets.push(line);
}
for (let src of sets) {
  src = src.replace(/<address>, <address>/g, `${A}, ${B}`).replace(/timezone <zone>/, "timezone Asia/Tokyo").replace(/\(<days and hours>\)/, "(weekday < sat and hour >= 9 and hour < 17)");
  const c = compileRules(src, { decimals: 9 });
  n++;
  if (!c.ok) { bad++; console.log("✕", JSON.stringify(src).slice(0, 150), "→", c.errors[0].message); continue; }
  const d = decompileRules(c.code, c.keys, c.tz, 9, c.king);
  const again = d && compileRules(d.source, { decimals: 9 });
  const rt = !!again && again.ok && Buffer.from(again.code).equals(Buffer.from(c.code)) && again.flags === c.flags;
  const v = validateCode(c.code, c.keys.length, c.flags);
  if (!rt || v === null) { bad++; console.log("✕ round trip / validate", JSON.stringify(src).slice(0, 120), rt, v, d?.source.slice(0, 200)); }
}
console.log(`${n} recipes and examples from the AI reference: ${bad ? bad + " FAILED" : "all compile, validate and round-trip"}`);
process.exit(bad ? 1 : 0);
