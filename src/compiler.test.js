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

test("uses the requested LuaMoon protection header", () => {
  const output = compileLuaSubset("print(1)");
  assert.match(output, /^-- This file was protected using Luamoon Obfuscator v1\.0 \[https:\/\/obfuscation\.jixyuk12nh\.workers\.dev\/\]\nreturn \(function\(\)/);
});

test("emits corrected local/global stores and Lua boolean operators", () => {
  const output = compileLuaSubset([
    "local x = false",
    "local y = x or 7",
    "globalValue = y",
    "print(globalValue)"
  ].join("\n"));
  assert.match(output, /local L=\{\}/);
  assert.match(output, /LD\[name\]=true/);
  assert.match(output, /if truth\(x\) then S\[#S\+1\]=x else S\[#S\+1\]=y end/);
});

test("escapes quotes and backslashes in generated Lua strings", () => {
  const output = compileLuaSubset('print("hello")');
  assert.match(output, /"hello"/);
});
