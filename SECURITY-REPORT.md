# LuaMoon Security Hardening — Validation Notes

## Implemented in this update

- Replaced obvious decimal-escaped string literals with runtime-decoded payloads.
- Shuffled a printable 64-character alphabet for each build.
- Encoded each eligible string with a distinct key and rolling XOR mask.
- Generated a randomized local decoder identifier that avoids names already present in the source.
- Kept the decoder in the same source chunk and inserted it after leading Luau `--!` directives and a possible shebang.
- Retained lexical comment removal while preserving line breaks and left surrounding Lua/Luau syntax unchanged.
- Fixed Unicode handling for supplementary-plane characters (for example emoji) so UTF-8 source characters are encoded as their actual UTF-8 bytes.

## Validation performed

- Node unit suite: 19/19 tests passing.
- Luau CLI runtime smoke test: ordinary strings, escaped strings, long-bracket strings, Unicode emoji, and byte values restored correctly.
- Mocked Obsidian-style `game:HttpGet()` + `loadstring()` + `Library:CreateWindow({...})` sample ran and printed the expected `Obsidian`, `true`, `true` values.
- ZIP integrity check performed after packaging.

## Security limitations

This is a stronger static-inspection barrier than plain decimal escapes, but it is **not Luraph-level protection** and not cryptographic secrecy. The decoder and per-string keys/strides are delivered with the protected source; a determined analyst can reverse the decoder or capture strings at runtime. Local identifiers remain visible, and this update does not add full AST-level variable renaming, control-flow flattening, bytecode virtualization, or anti-tamper logic. Do not store secrets or API keys in client-side scripts.

## Language and compatibility limitations

The transformation remains lexical rather than a complete parser/AST pass. It deliberately avoids rewriting most Lua/Luau syntax, which improves compatibility, but does not prove every grammar production or runtime behavior is supported. Luau type-level string literals and backtick interpolated strings are preserved conservatively. Validate the result with the exact Lua version or Luau runtime used in production.

## Independence note

The design uses independently written string packing/decoding and does not copy Luraph implementation code. It is not compatible with or equivalent to Luraph internals.
