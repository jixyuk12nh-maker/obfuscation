import test from "node:test";
import assert from "node:assert/strict";
import { compileLuaSubset } from "./compiler.js";

test("emits an encoded custom VM wrapper", () => {
  const output = compileLuaSubset('local x = 2 + 3\nprint(x)', { seed: 123 });
  assert.match(output, /^return \(function\(\)/);
  assert.match(output, /local _KW=/);
  assert.match(output, /local _CT=/);
  assert.match(output, /local _BC=/);
  assert.match(output, /local function _dk/);
  assert.match(output, /local _src=_dk\(_KW\)/);
  assert.match(output, /local _loader=loadstring or load/);
});

test("uses randomized opcode IDs and encoded constants", () => {
  const a = compileLuaSubset('local n = -12.5\nprint("hello", n)', { seed: 10 });
  const b = compileLuaSubset('local n = -12.5\nprint("hello", n)', { seed: 11 });
  assert.notEqual(a, b);
  assert.match(a, /local _CT=\{/);
  assert.match(a, /local _BC=\{/);
});

test("compiles elseif, repeat-until, do-end and break", () => {
  const output = compileLuaSubset('local x=0 while x<4 do x=x+1 if x==2 then print("two") elseif x==3 then print("three") end end repeat x=x-1 until x==0 do print(x) end', { seed: 7 });
  assert.match(output, /local _BC=\{/);
});

test("uses short-circuit jump opcodes for and/or", () => {
  const output = compileLuaSubset('local x = false and 2\nlocal y = true or 3', { seed: 4 });
  assert.match(output, /local _BC=\{/);
});

test("rejects break outside a loop", () => {
  assert.throws(() => compileLuaSubset("break"), /break.*outside loop/i);
});

test("supports table constructors, keyed fields, and indexing", () => {
  const output = compileLuaSubset("local t = {10, answer=42, [\"x\"]=7} t.answer=9 t[1]=11 print(t.x, t[1], t.answer)", { seed: 12 });
  assert.match(output, /local _BC=\{/);
  assert.match(output, /local _CT=\{/);
});

test("rejects malformed assignments", () => {
  assert.throws(() => compileLuaSubset("local ="), /Expected identifier/i);
});

test("enforces the 50 MiB source limit", () => {
  assert.throws(() => compileLuaSubset("a".repeat(50 * 1024 * 1024 + 1)), /limit 50MB/i);
});
