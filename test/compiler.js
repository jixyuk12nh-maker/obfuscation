import test from "node:test";
import assert from "node:assert/strict";
import { compileLuaSubset } from "../src/compiler.js";

test("compiles the documented VM example", () => {
  const source = [
    'local name = "LuaMoon"',
    "local count = 2",
    "if count > 1 then",
    '  print(name .. " VM ready")',
    "elseif count == 1 then",
    '  print("one")',
    "else",
    '  warn("not ready")',
    "end"
  ].join("\n");
  const output = compileLuaSubset(source, { seed: 1234 });
  assert.match(output, /local _KW=/);
  assert.match(output, /local _BC=/);
  assert.match(output, /local _src=_dk\(_KW\)/);
});

test("encodes numeric and escaped string constants", () => {
  const output = compileLuaSubset('local n = -12.5\nprint("hello\\nworld", n)', { seed: 1 });
  assert.match(output, /local _CT=/);
  assert.match(output, /local _KW=\{/);
});

test("supports nested table constructors and index assignment", () => {
  const output = compileLuaSubset("local t = {child={value=3}} t.child.value=4 print(t.child.value)", { seed: 23 });
  assert.match(output, /local _BC=\{/);
});
