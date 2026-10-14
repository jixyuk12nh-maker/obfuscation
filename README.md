# LuaMoon VM Prototype

LuaMoon is an experimental source-to-bytecode obfuscator project for Lua-like scripts. This version emits a custom bytecode program, shuffles opcode IDs per build, encodes constants, and embeds an encoded VM interpreter. It is a prototype and does not support the complete Lua 5.1 or Luau language.

## Implemented in this prototype

- Numeric, boolean, string, and nil constants
- Unary `-`, `not`, and `#` expressions
- Arithmetic, comparison, concatenation, and short-circuit `and` / `or` expressions
- Local and global single-name assignments
- Named function calls with arguments
- `return` with a single expression or no value
- `if` / `elseif` / `else`, `while`, `repeat` / `until`, `do` blocks, and `break` in loops
- Per-build randomized opcode IDs
- Encoded constant pool and encoded VM source
- Explicit VM stack pointer so nil values do not break stack indexing
- Arithmetic XOR and rotate decoding without requiring `bit32`

## Not implemented

This prototype does not implement the complete Lua or Luau grammar. In particular, table constructors and indexing, function declarations and closures, multiple assignment, multiple return values, numeric and generic `for`, method calls, metatables, coroutines, goto/labels, Luau type syntax, Luau interpolation, and many other language features are not supported. The parser should reject unsupported syntax rather than treating it as valid output.

## Runtime requirements

The generated wrapper decrypts and loads its embedded VM code using `loadstring` or `load`. A target runtime that disables dynamic code loading will not run this output. Standard Lua 5.1 and Roblox Luau also differ in runtime behavior; compatibility has not been established for every environment.

## Development

Requires Node.js 20 or later.

```sh
npm test
```

Run locally with Wrangler: `npm run dev`. Deploy with `npm run deploy` after configuring the Cloudflare project.

## Status

This is an incremental VM foundation, not a Luraph equivalent and not a production-ready full-language obfuscator. Tests validate parser behavior and generated wrapper structure; they do not execute generated output in a Lua/Luau runtime.

## VM prototype update

The current prototype additionally parses basic table constructors (`{1, name="x", [key]=value`), dot/bracket indexing, nested indexing, and indexed assignments. This remains a deliberately limited Lua subset, not complete Lua 5.1 or Luau. Function declarations, closures, loops beyond while/repeat, multi-return semantics, method syntax, and Luau-specific syntax are not fully supported. Tests validate parser/output structure; execute generated output in the exact target runtime before relying on it.
