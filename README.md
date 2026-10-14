# LuaMoon — Lua / Luau Syntax-Preserving Obfuscator

> Research update: implementation strategy was checked against the Prometheus obfuscator and the official Luau repository. See [`docs/GITHUB-RESEARCH.md`](docs/GITHUB-RESEARCH.md) for sources and limits.

LuaMoon transforms Lua and Roblox Luau source without compiling it through a limited custom VM. The transformer scans lexical constructs (quoted strings, long-bracket strings/comments, line comments, directives, and Luau backtick strings), then protects eligible string literals with a per-build shuffled alphabet plus per-string rolling XOR masks. A small randomized-name decoder restores strings at runtime. Ordinary comments are removed while line breaks and surrounding source syntax are preserved.

## Why this architecture

A partial hand-written parser rejects many valid programs (method calls, multiple assignment/returns, varargs, `goto`, version-specific operators, Luau type declarations, compound assignment, and other syntax). LuaMoon's compatibility mode therefore does not parse or recompile the program. It performs lexical transformations only, so unrecognized language constructs are left intact rather than sent through the prototype VM.

## Language modes

- `lua`: syntax-preserving lexical obfuscation for Lua source. Use a matching Lua runtime/version to validate the result.
- `luau`: syntax-preserving lexical obfuscation for Roblox Luau. Type-level string literals and `--!` directives are conservatively preserved; backtick interpolated strings are left intact.

## Transformations

- Ordinary quoted and long-bracket string literals become encoded payload calls; each string gets its own key and rolling mask.
- A per-build shuffled printable alphabet makes payloads differ across builds.
- A local runtime decoder uses only standard Lua string/table/math operations, avoiding a dependency on `bit32` and preserving Lua 5.1 compatibility for the decoder itself.
- Eligible top-level single-name locals are renamed with collision-checked randomized identifiers. The pass is conservative and skips renaming when Luau type syntax, backtick interpolation, shadowing/redeclaration, or ambiguous declaration patterns are detected.
- Ordinary line and long-bracket comments are blanked while retaining line breaks.
- `--!` directives are preserved before the injected helper.
- Source is not wrapped in `loadstring`/`load`; the transformed program remains source code. The decoder only reconstructs individual string values.

## Validation status

The test suite checks representative Lua/Luau syntax and lexical transformations. It is not an exhaustive grammar conformance suite. Run output through the exact target Lua runtime or the official Luau compiler before production use.

## Limitations

This is a compatibility-first lexical obfuscator, not a complete AST-based obfuscator. It performs conservative top-level local renaming, but does not perform full scope-aware renaming for all grammar constructs or control-flow flattening. It does not claim to validate every grammar production. Always test output in the exact target Lua/Luau runtime, especially for byte encodings and language-version-specific syntax. Backtick interpolated strings are preserved as-is to avoid altering Luau interpolation semantics.

## VM engine

The web UI and `POST /api/obfuscate` also support `{ "mode": "vm" }`. This mode parses Lua/Luau source into a stack-machine bytecode, shuffles opcode IDs, masks operands, inserts control-flow NOP padding, encodes constants, and embeds an interpreter. Coverage is nearly all Lua 5.x syntax: varargs, multiple returns and assignment, generic and numeric `for`, `goto`/labels, method and dotted function definitions, long strings and comments, hex floats, integer division and bitwise operators, and per-iteration closure capture. Luau compound assignment (`+=` etc.) and `continue` are supported; Luau type annotations are not.

Limits: the interpreter runs in Lua itself, so it is much slower than native code. Bitwise operators act on 32-bit unsigned values. Lua 5.4 `<close>` variables are parsed but not closed. The generated code calls `loadstring`/`load` at startup, so the target environment must allow dynamic code loading. Test output in the exact target runtime. Use `mode: "compatibility"` for speed and broad syntax preservation. This prototype is not equivalent to Luraph and should not be marketed as Luraph-grade.

The output carries a salted integrity checksum over its encoded blobs. Editing the shipped text by hand makes it refuse to run (`LuaMoon VM: integrity check failed`). To change protected code, edit the source and recompile.

## Run

```sh
npm test
npm run dev
```

The Cloudflare Worker exposes `POST /api/obfuscate` with JSON `{ "source": "...", "language": "lua" }` or `{ "source": "...", "language": "luau" }`.
