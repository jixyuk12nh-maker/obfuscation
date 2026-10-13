import test from "node:test";
import assert from "node:assert/strict";
import { compileLuaSubset } from "../src/compiler.js";

test("emits custom VM for basic supported code", () => {
  const output = compileLuaSubset('local x = 2 + 3\nprint(x)');
  assert.match(output, /local B=/);
  assert.match(output, /op=="ADD"/);
  assert.match(output, /op=="CALL"/);
});

test("rejects unsupported syntax with an error", () => {
  assert.throws(() => compileLuaSubset("local t = {}"), /Unsupported|Expected|character/i);
});

test("rejects invalid source with an error", () => {
  assert.throws(() => compileLuaSubset("local ="), /Expected identifier/i);
});
