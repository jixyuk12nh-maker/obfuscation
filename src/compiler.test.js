import test from "node:test";
import assert from "node:assert/strict";
import { compileLuaSubset } from "./compiler.js";

test("emits the v2 protected wrapper and encrypted VM source", () => {
  const output = compileLuaSubset('local x = 2 + 3\nprint(x)', { seed: 123 });
  assert.match(output, /^-- This file was protected using Luamoon Obfuscator v2\.0 \[https:\/\/obfuscation\.jixyuk12nh\.workers\.dev\/\]\nreturn \(function\(\)/);
  assert.match(output, /local _KW=/);
  assert.match(output, /local _CT=/);
  assert.match(output, /local _BC=/);
  assert.match(output, /local _loader=loadstring or load/);
});

test("uses randomized opcode IDs and encoded constants", () => {
  const a = compileLuaSubset('local n = -12.5\nprint("hello", n)', { seed: 10 });
  const b = compileLuaSubset('local n = -12.5\nprint("hello", n)', { seed: 11 });
  assert.notEqual(a, b);
  assert.match(a, /local _CT=\{\{"n",/);
  assert.match(a, /local _BC=\{/);
});

test("rejects unsupported syntax with a useful error", () => {
  assert.throws(() => compileLuaSubset("local t = {}"), /Unsupported|Expected|character/i);
});

test("rejects malformed assignments", () => {
  assert.throws(() => compileLuaSubset("local ="), /Expected identifier/i);
});

test("enforces the 50 MiB source limit", () => {
  assert.throws(() => compileLuaSubset("a".repeat(50 * 1024 * 1024 + 1)), /limit 50MB/i);
});
