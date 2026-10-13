import test from "node:test";
import assert from "node:assert/strict";
import { compileLuaSubset } from "../src/compiler.js";

test("handles the supported example and produces the protected wrapper", () => {
  const source = [
    'local name = "LuaMoon"',
    "local count = 2",
    "if count > 1 then",
    '  print(name .. " VM ready")',
    "else",
    '  warn("not ready")',
    "end"
  ].join("\n");
  const output = compileLuaSubset(source);
  assert.match(output, /Luamoon Obfuscator v1\.0/);
  assert.match(output, /op=="CONCAT"/);
  assert.match(output, /op=="JMPF"/);
});

test("preserves numbers and escapes string constants in generated Lua", () => {
  const output = compileLuaSubset('local n = -12.5\nprint("hello", n)');
  assert.match(output, /12\.5/);
  assert.match(output, /op=="NEG"/);
  assert.match(output, /"hello"/);
});

test("reports unsupported syntax instead of silently compiling it", () => {
  assert.throws(() => compileLuaSubset("local t = {}"), /Unsupported|Expected|character/i);
});
