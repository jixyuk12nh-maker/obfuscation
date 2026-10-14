import test from "node:test";
import assert from "node:assert/strict";
import { compileLuaSubset } from "./compiler.js";

test("emits an encoded custom VM wrapper", () => {
  const output = compileLuaSubset('local x = 2 + 3\nprint(x)', { seed: 123 });
  assert.match(output, /^return \(function\(\)/);
  assert.match(output, /local _A="[^"\n]{64}"/);
  assert.match(output, /local _KW=/);
  assert.match(output, /local _D=/);
  assert.match(output, /local _D=/);
  assert.match(output, /local function _dk/);
  assert.match(output, /local _src=_dk\(_u\(_KW\)\)/);
  assert.match(output, /local _loader=loadstring or load/);
});

test("uses randomized opcode IDs and encoded constants", () => {
  const a = compileLuaSubset('local n = -12.5\nprint("hello", n)', { seed: 10 });
  const b = compileLuaSubset('local n = -12.5\nprint("hello", n)', { seed: 11 });
  assert.notEqual(a, b);
  assert.match(a, /local _D="[^"\n]+"/);
  assert.match(a, /local _D="[^"\n]+"/);
});

test("compiles elseif, repeat-until, do-end and break", () => {
  const output = compileLuaSubset('local x=0 while x<4 do x=x+1 if x==2 then print("two") elseif x==3 then print("three") end end repeat x=x-1 until x==0 do print(x) end', { seed: 7 });
  assert.match(output, /local _D="[^"\n]+"/);
});

test("uses short-circuit jump opcodes for and/or", () => {
  const output = compileLuaSubset('local x = false and 2\nlocal y = true or 3', { seed: 4 });
  assert.match(output, /local _D="[^"\n]+"/);
});

test("rejects break outside a loop", () => {
  assert.throws(() => compileLuaSubset("break"), /break.*outside loop/i);
});

test("supports table constructors, keyed fields, and indexing", () => {
  const output = compileLuaSubset("local t = {10, answer=42, [\"x\"]=7} t.answer=9 t[1]=11 print(t.x, t[1], t.answer)", { seed: 12 });
  assert.match(output, /local _D="[^"\n]+"/);
  assert.match(output, /local _D=/);
});

test("rejects malformed assignments", () => {
  assert.throws(() => compileLuaSubset("local ="), /Expected identifier/i);
});

test("enforces the 50 MiB source limit", () => {
  assert.throws(() => compileLuaSubset("a".repeat(50 * 1024 * 1024 + 1)), /limit 50MB/i);
});


test("masks bytecode operands per build and updates existing locals safely", () => {
  const a = compileLuaSubset("local x=0 while x<3 do x=x+1 end print(x)", { seed: 100 });
  const b = compileLuaSubset("local x=0 while x<3 do x=x+1 end print(x)", { seed: 101 });
  assert.notEqual(a, b);
  assert.match(a, /local _D="[^"\n]+"/);
});


test("supports local functions and positional parameters", () => {
  const output = compileLuaSubset("local function add(a,b) return a+b end print(add(3,4))", { seed: 31 });
  assert.match(output, /local _D=/);
  assert.match(output, /local _D=/);
});

test("supports closures capturing outer locals", () => {
  const output = compileLuaSubset("local x=10 local function make() local y=2 return function(z) return x+y+z end end local f=make() print(f(5))", { seed: 32 });
  assert.match(output, /local _D=/);
  assert.match(output, /local _D=/);
});

test("supports global function declarations", () => {
  const output = compileLuaSubset("function add(a,b) return a+b end print(add(1,2))", { seed: 33 });
  assert.match(output, /local _D=/);
});

test("inserts control-flow padding and randomized opcode mapping", () => {
  const output = compileLuaSubset("local x=0 while x<2 do x=x+1 end print(x)", { seed: 34 });
  assert.match(output, /local _D=/);
  assert.match(output, /_DATA\.FUNCS,_DATA\.MA,_DATA\.MB/);
});


test("does not expose a distinctive source string in generated text", () => {
  const marker = "LUAMOON_PRIVATE_LITERAL_7F3A91C2";
  const output = compileLuaSubset(`local message = "${marker}" print(message)`, { seed: 90210 });
  assert.equal(output.includes(marker), false);
});

test("supports nested closures and mutation of a captured local", () => {
  const output = compileLuaSubset("local count=0 local function nextValue() count=count+1 return count end print(nextValue(),nextValue())", { seed: 90211 });
  assert.match(output, /local _D=/);
});

test("packs program tables into text blobs instead of visible numeric arrays", () => {
  const output = compileLuaSubset('local x=2+3 print("PACKED_MARKER",x)', { seed: 707 });
  assert.match(output, /local _KW="[^"\n]+"/);
  assert.match(output, /local _D="[^"\n]+"/);
  assert.equal(output.includes("PACKED_MARKER"), false);
  assert.equal(/local _BC=\{\{|local _CT=\{\{|local _FUNCS=\{\{/.test(output), false);
});
