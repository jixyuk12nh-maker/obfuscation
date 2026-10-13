import test from "node:test";
import assert from "node:assert/strict";
import { compileLuaSubset } from "../src/compiler.js";

test("compiles the documented supported example", () => {
  const source = [
    'local name = "LuaMoon"',
    "local count = 2",
    "if count > 1 then",
    '  print(name .. " VM ready")',
    "else",
    '  warn("not ready")',
    "end"
  ].join("\n");
  const output = compileLuaSubset(source, { seed: 1234 });
  assert.match(output, /Luamoon Obfuscator v2\.0/);
  assert.match(output, /local _KW=/);
  assert.match(output, /local _BC=/);
});

test("supports numeric and escaped string constants", () => {
  const output = compileLuaSubset('local n = -12.5\nprint("hello\\nworld", n)', { seed: 1 });
  assert.match(output, /local _CT=/);
  assert.match(output, /local _KW=\{/);
});

test("reports unsupported syntax instead of silently compiling it", () => {
  assert.throws(() => compileLuaSubset("local t = {}"), /Unsupported|Expected|character/i);
});
