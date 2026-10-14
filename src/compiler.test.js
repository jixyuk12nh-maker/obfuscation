import test from "node:test";
import assert from "node:assert/strict";
import { compileLuaSubset } from "./compiler.js";

const obfuscate = (source, language = "lua", seed = 123) => compileLuaSubset(source, { language, seed });

test("obfuscates ordinary Lua strings without wrapping source in loadstring", () => {
  const source = 'local message = "hello"; print(message)';
  const output = obfuscate(source);
  assert.equal(output.includes('"hello"'), false);
  assert.match(output, /\\104\\101\\108\\108\\111/);
  assert.equal(output.includes("loadstring"), false);
});

test("keeps method calls and table constructors syntactically intact", () => {
  const source = `local Library = loadstring(game:HttpGet("https://example.test/Library.lua"))()\nlocal Window = Library:CreateWindow({Title="Obsidian", Footer="", Center=true, AutoShow=true})`;
  const output = obfuscate(source);
  assert.match(output, /game:HttpGet\(/);
  assert.match(output, /Library:CreateWindow\(\{Title=/);
  assert.equal(output.includes("https://example.test/Library.lua"), false);
  assert.equal(output.includes('Title="Obsidian"'), false);
});

test("supports Lua syntax outside the old VM subset without rejecting it", () => {
  const source = `local function f(...) local a,b=... for i=1,3 do print(i,a,b) end return a,b end\n::again::\nlocal n = 1 << 2\nif n ~= 0 then goto again end`;
  const output = obfuscate(source, "lua", 77);
  for (const fragment of ["function f(...) ", "local a,b=...", "for i=1,3 do", "return a,b", "::again::", "1 << 2", "goto again"]) assert.ok(output.includes(fragment), fragment);
});

test("handles quoted and long-bracket strings", () => {
  const source = `local a = 'single\\nline'\nlocal b = [=[long\ntext]=]\nprint(a,b)`;
  const output = obfuscate(source, "lua", 8);
  assert.equal(output.includes("single"), false);
  assert.equal(output.includes("long"), false);
  assert.match(output, /print\(a,b\)/);
});

test("removes ordinary comments but preserves directives and line positions", () => {
  const source = `--!strict\nlocal a = "x" -- remove me\n--[[ block comment ]]\nprint(a)`;
  const output = obfuscate(source, "luau", 10);
  assert.match(output, /^--!strict/);
  assert.equal(output.includes("remove me"), false);
  assert.equal(output.includes("block comment"), false);
  assert.match(output, /print\(a\)/);
  assert.equal(output.split("\n").length, source.split("\n").length);
});

test("preserves Luau type declarations and string literal types while encoding value strings", () => {
  const source = `--!strict\ntype State = "Idle" | "Running"\nlocal state: State = "Idle"\nlocal message = "hello"\nlocal function greet(name: string): string\n return ` + '`hello, {name}`' + `\nend`;
  const output = obfuscate(source, "luau", 11);
  assert.match(output, /^--!strict/);
  assert.match(output, /type State = "Idle" \| "Running"/);
  assert.match(output, /local state: State =/);
  assert.equal(output.includes('local message = "hello"'), false);
  assert.match(output, /name: string/);
  assert.match(output, /`hello, \{name\}`/);
});

test("preserves Luau-specific syntax such as compound assignment, continue, and type functions", () => {
  const source = `type Box<T> = { value: T }\nlocal x: number = 0\nwhile x < 3 do x += 1 if x == 2 then continue end end\nlocal y = x :: number`;
  const output = obfuscate(source, "luau", 12);
  for (const fragment of ["type Box<T>", "value: T", "x += 1", "continue", "x :: number"]) assert.ok(output.includes(fragment), fragment);
});

test("supports randomized string encoding across builds", () => {
  const source = 'print("marker")';
  const a = obfuscate(source, "lua", 100);
  const b = obfuscate(source, "lua", 101);
  assert.notEqual(a, b);
  assert.equal(a.includes("marker"), false);
  assert.equal(b.includes("marker"), false);
});

test("does not transform strings inside Luau type aliases or annotations", () => {
  const source = `type Mode = "A" | "B"\nlocal mode: "A" | "B" = "A"`;
  const output = obfuscate(source, "luau", 99);
  assert.match(output, /type Mode = "A" \| "B"/);
  assert.match(output, /local mode: "A" \| "B" =/);
});

test("enforces the 50 MiB source limit", () => {
  assert.throws(() => compileLuaSubset("a".repeat(50 * 1024 * 1024 + 1)), /limit 50MB/i);
});

test("rejects an unterminated quoted string", () => {
  assert.throws(() => obfuscate('print("broken)'), /Unclosed string/i);
});

test("does not parse or rewrite broad Lua grammar constructs", () => {
  const source = `local a, b = 1, 2
local function f(x, ...)
  local t = {x, key = "value", ["dynamic"] = ...}
  for k, v in pairs(t) do
    if k == "key" then a = a + 1 elseif k == "dynamic" then b = b / 2 end
  end
  repeat a = a - 1 until a <= 0
  return a, b, ...
end
::again::
if a ~= b then goto again end
return f(a, b)`;
  const output = obfuscate(source, "lua", 1234);
  for (const fragment of ["local a, b = 1, 2", "local function f(x, ...)", "for k, v in pairs(t) do", "repeat a = a - 1 until a <= 0", "return a, b, ...", "::again::", "goto again"]) {
    assert.ok(output.includes(fragment), fragment);
  }
  assert.equal(output.includes('"value"'), false);
});

test("preserves complex Luau syntax while obfuscating ordinary value strings", () => {
  const source = `--!strict
export type Node<T> = { value: T, next: Node<T>?, callback: (T) -> string }
local function build<T>(value: T): Node<T>
  local result: Node<T> = {value = value, next = nil, callback = function(x: T): string return tostring(x) end}
  local count = 0
  while count < 2 do
    count += 1
    if count == 1 then continue end
  end
  local text = \`hello, {value}!\`
  local raw = "visible-secret"
  return result
end`;
  const output = obfuscate(source, "luau", 4321);
  for (const fragment of ["--!strict", "export type Node<T>", "callback: (T) -> string", "function build<T>(value: T): Node<T>", "count += 1", "continue", "\`hello, {value}!\`"]) {
    assert.ok(output.includes(fragment), fragment);
  }
  assert.equal(output.includes('"visible-secret"'), false);
});

test("preserves multiline comments and source line count", () => {
  const source = `local x = "safe"
--[=[ first
second
third ]=]
print(x)`;
  const output = obfuscate(source, "lua", 9);
  assert.equal(output.split("\n").length, source.split("\n").length);
  assert.equal(output.includes("second"), false);
  assert.match(output, /print\(x\)/);
});
