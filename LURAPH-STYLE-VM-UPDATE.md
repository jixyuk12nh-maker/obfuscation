# LuaMoon VM engine update

This update adds an opt-in experimental bytecode VM engine. It is inspired by common virtualization techniques used by obfuscators; it is not a copy of Luraph internals and is not equivalent to Luraph.

## What the VM path does
- Parses a limited Lua subset into an AST.
- Compiles expressions, calls, locals, tables, branches, while/repeat loops, and returns into custom VM instructions.
- Randomizes opcode IDs per build.
- Masks instruction operands and inserts randomized NOP padding to alter the instruction layout.
- Encodes constants and embeds an interpreter whose source is itself encoded.
- Handles colon method calls by explicitly passing the receiver as the first argument.

## Limits
The VM parser is intentionally not a full Lua/Luau parser. It does not support many common constructs including varargs, multiple assignments/returns, numeric/generic `for`, `continue`, compound assignment, typed Luau declarations, and backtick interpolation. VM execution uses `loadstring` or `load` to initialize its embedded interpreter and data. Some Roblox executor environments may differ. The generated program was checked with unit tests but was not executed in a Roblox runtime here.

Use the Compatibility engine for broad Lua/Luau syntax preservation. Do not assume VM mode is compatible with arbitrary Roblox scripts.
