# LuaMoon VM Security Update — Validation Notes

## Implemented in this update

- Build-time cryptographic random source for default builds, deterministic seed only for tests.
- Randomized opcode identifiers per build.
- Per-program operand masks for bytecode operands and jump targets.
- Random NOP padding and remapping of branch destinations.
- Encoded constant pool and embedded VM source.
- Packed bytecode, constants, function metadata, and VM payload into base64-style text blobs, with a per-build XOR mask on the program-data blob, reducing the obvious numeric-table appearance.
- Function prototypes, positional parameters, single-value returns, and closure environments.
- Captured-local reads and writes through parent closure frames.
- Runtime checks for invalid opcodes, missing closures, and stack underflow.

## Validation performed

- Node unit suite: 18 tests passing.
- Local Luau CLI execution checks:
  - arithmetic and while-loop behavior: `RESULT 3`
  - local function call: `SUM 7`
  - captured closure: `CLOSURE 17`
  - global function declaration: `GLOBAL 8`
  - recursive factorial: `FACT 120`
  - captured-local mutation: `MUT 1 2 3`
- Distinctive source literal is not present as plain text in the generated wrapper.

## Security limitations

This is still source-level VM obfuscation, not cryptographic secrecy. The string-packed representation is a readability/static-inspection barrier, not encryption that can safely protect secrets. The decoder and VM are delivered to the same runtime as the protected code and can be extracted. NOP padding and operand masks raise static-analysis effort but are not proof against dynamic tracing or devirtualization. Client-side Roblox scripts can be inspected by a determined user.

## Language limitations

The parser and VM implement a documented subset, not all Lua or Luau. Multiple assignment, multiple returns, varargs, numeric/generic `for`, method calls, metatables, coroutines, Luau type syntax, exact block-local shadowing, and several language corner cases remain unsupported. Always test real scripts in the target runtime; reject unsupported syntax rather than assuming equivalence.

## Third-party code note

The Luraph archive was treated as a separate analysis-tool reference. No Luraph deobfuscator source was copied into this project. This implementation is an independent prototype and does not claim compatibility with Luraph internals.
