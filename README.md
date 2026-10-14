# LuaMoon VM — Security Update

LuaMoon is an experimental Lua-subset source-to-bytecode obfuscator. This project is **not** a drop-in replacement for a complete Lua 5.1 or Luau compiler, and obfuscation cannot make client-side code impossible to reverse engineer.

## Current implemented subset

- Numeric, boolean, string, and nil constants
- Arithmetic, comparison, concatenation, unary `-`, `not`, and `#`
- Short-circuit `and` / `or`
- Single-name assignments and local variables
- Basic table constructors, dot/bracket indexing, and indexed assignment
- `if` / `elseif` / `else`, `while`, `repeat` / `until`, `do`, and `break`
- Named function calls with positional arguments
- `local function f(...) ... end`, `function f(...) ... end`, and anonymous `function(...) ... end`
- Single-value returns and closures that capture outer locals

## Obfuscation / hardening layers

- Per-build randomized opcode IDs
- String and numeric constant encoding with XOR and byte rotation
- Per-build randomized 64-character printable alphabet for packed payload strings instead of visible giant numeric `_KW`, `_CT`, and `_BC` tables
- Per-build XOR masking for the packed program-data blob
- Encoded VM source
- Per-program arithmetic operand masking for bytecode operands and jump targets
- Random no-op padding before instructions, with jump targets remapped to preserve control flow
- Cryptographically sourced randomness for normal builds (`crypto.getRandomValues`); deterministic seeds are accepted for tests only
- VM stack-underflow and invalid-opcode checks

These are obfuscation layers, not cryptographic secrecy. Random-alphabet packed blobs make the generated text look like dense symbol-heavy encoded strings rather than ordinary Base64 or numeric tables, but the runtime decoder and data can still be recovered. The decoder, masks, and runtime logic must be present client-side and can be recovered by a determined analyst. No anti-debugging or environment-tampering behavior is included.

## Known limitations

This remains a limited language subset. It does **not** yet implement full Lua/Luau semantics, including:

- Multiple assignment, multiple return values, varargs, and tail calls
- Numeric/generic `for`, method calls (`:`), metatables, coroutines, `goto`, and labels
- Full lexical block scoping and same-name local shadowing
- Full Lua/Luau string escape and long-bracket string rules
- Luau type annotations, interpolation, and Roblox-specific syntax
- Exact Lua truthiness/metamethod/numeric semantics in every edge case

Function closures are supported for ordinary captured locals, but should be tested carefully if the source depends on complex shadowing or mutation patterns. Dynamic code loading (`loadstring` or `load`) is required by the generated wrapper and may be unavailable in the target environment.

## Test

Requires Node.js 20+.

```sh
npm test
```

The Node tests validate parsing and generated structure. For runtime compatibility, execute generated output in the exact target Lua/Luau runtime. A local Luau CLI smoke test was also performed for arithmetic, tables, loops, local functions, closures, and global function declarations.

## Cloudflare

```sh
npm install
npm run dev
```

Deploy only after testing in your target environment:

```sh
npm run deploy
```
