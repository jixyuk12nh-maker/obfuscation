import {
  mulberry32,
  shuffleArray,
  encodeXorRotateBytes,
  base64Encode,
  longBracketOpen,
  decodeLuaStringBytes,
  hasLuauTypeSyntax,
  secureRandom
} from "./shared.js";

export { compileLuaVm } from "./vm.js";

const KEYWORDS = new Set(["local", "function", "return", "if", "then", "elseif", "else", "end", "while", "repeat", "until", "do", "break", "true", "false", "nil", "and", "or", "not", "for"]);

function luaStringExpression(bytes, rng, decoderName, alphabet) {
  const key = 1 + Math.floor(rng() * 255);
  const stride = 1 + Math.floor(rng() * 255);
  const cipher = bytes.map((byte, index) => byte ^ ((key + index * stride) & 0xff));
  const payload = base64Encode(cipher, alphabet);
  return `${decoderName}(${JSON.stringify(payload)},${key},${stride})`;
}

function makeDecoderName(source, rng) {
  const first = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_";
  const rest = first + "0123456789";
  for (let attempt = 0; attempt < 100; attempt++) {
    let name = "_";
    for (let i = 0; i < 13; i++) name += (i === 0 ? first : rest)[Math.floor(rng() * (i === 0 ? first : rest).length)];
    if (!source.includes(name)) return name;
  }
  throw new Error("Unable to generate a collision-free string decoder name.");
}

function makeStringDecoder(name, alphabet) {
  // One chunk-local helper decodes a per-build alphabet and per-string rolling XOR mask.
  // This raises the cost of casual string extraction but is not cryptographic protection.
  return `local ${name}=(function(A)local M={} for i=1,#A do M[string.sub(A,i,i)]=i-1 end;return function(S,K,R)local O={} local V=0 local B=0 for i=1,#S do local N=M[string.sub(S,i,i)] if N then V=V*64+N B=B+6 if B>=8 then B=B-8 O[#O+1]=math.floor(V/2^B)%256 V=V%2^B end end end;local function X(a,b)local q,p=0,1 for _=1,8 do local c,d=a%2,b%2 if c~=d then q=q+p end a=math.floor(a/2) b=math.floor(b/2) p=p*2 end return q end;for i=1,#O do O[i]=string.char(X(O[i],(K+(i-1)*R)%256)) end;return table.concat(O) end end)(${JSON.stringify(alphabet)});`;
}

function preludeOffset(source) {
  let pos = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  if (source.startsWith("#!", pos)) {
    const end = source.indexOf("\n", pos);
    pos = end < 0 ? source.length : end + 1;
  }
  while (pos < source.length) {
    const end = source.indexOf("\n", pos);
    const lineEnd = end < 0 ? source.length : end;
    const line = source.slice(pos, lineEnd);
    if (/^\s*$/.test(line) || /^\s*--!/.test(line)) {
      pos = end < 0 ? source.length : end + 1;
      continue;
    }
    break;
  }
  return pos;
}

function isLuauTypeStringLiteral(source, start) {
  const lineStart = Math.max(source.lastIndexOf("\n", start - 1), source.lastIndexOf(";", start - 1)) + 1;
  const prefix = source.slice(lineStart, start);
  // String literal types in aliases, variable annotations, parameter types,
  // and return types must remain literal syntax instead of becoming expressions.
  if (/^\s*(?:export\s+)?type\s+[A-Za-z_]\w*\s*=/.test(prefix)) return true;
  if (/^\s*(?:local\s+)?[A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*\s*:\s*[^=]*$/.test(prefix)) return true;
  if (/\bfunction\b[^\n]*\([^)]*:\s*[^=]*$/.test(prefix)) return true;
  if (/\bfunction\b[^\n]*\)\s*:\s*[^=]*$/.test(prefix)) return true;

  // Multiline type aliases are conservatively kept as source syntax. This is
  // a compatibility guard; it avoids turning a type literal into a value expr.
  const before = source.slice(0, start);
  const typeMatches = [...before.matchAll(/(?:^|\n)\s*(?:export\s+)?type\s+[A-Za-z_]\w*\s*=/g)];
  const lastTypeMatch = typeMatches.at(-1);
  if (lastTypeMatch) {
    const tail = before.slice(lastTypeMatch.index + lastTypeMatch[0].length);
    const lines = tail.split(/\r?\n/);
    const interrupted = lines.slice(1).some(line =>
      /^\s*(?:local\b|function\b|return\b|if\b|for\b|while\b|repeat\b|do\b|print\s*\(|warn\s*\(|[A-Za-z_]\w*\s*=)/.test(line)
    );
    const currentLine = source.slice(Math.max(source.lastIndexOf("\n", start - 1) + 1, 0), source.indexOf("\n", start) < 0 ? source.length : source.indexOf("\n", start));
    if (!interrupted && /^\s*["']/.test(currentLine)) return true;
  }
  return false;
}

function identifierTokens(source) {
  const out = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (source.startsWith("--", i)) {
      const open = longBracketOpen(source, i + 2);
      if (open) {
        const close = "]" + "=".repeat(open.equals) + "]";
        const end = source.indexOf(close, open.contentStart);
        if (end < 0) return null;
        i = end + close.length;
      } else {
        const end = source.indexOf("\n", i);
        i = end < 0 ? source.length : end + 1;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i++] === quote) break;
      }
      continue;
    }
    if (c === "[") {
      const open = longBracketOpen(source, i);
      if (open) {
        const close = "]" + "=".repeat(open.equals) + "]";
        const end = source.indexOf(close, open.contentStart);
        if (end < 0) return null;
        i = end + close.length;
        continue;
      }
    }
    if (c === "`") {
      i++;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i++] === "`") break;
      }
      continue;
    }
    const start = i;
    if (/[A-Za-z_]/.test(c)) {
      const m = source.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)[0];
      i += m.length;
      out.push({ value: m, start, end: i, type: KEYWORDS.has(m) ? "keyword" : "identifier" });
      continue;
    }
    const op = ["...", "::", "==", "~=", "<=", ">=", "..", "+=", "-=", "*=", "/=", "%=", "^=", "//"].find(x => source.startsWith(x, i));
    if (op) { i += op.length; out.push({ value: op, start, end: i, type: "symbol" }); continue; }
    i++;
    out.push({ value: c, start, end: i, type: "symbol" });
  }
  return out;
}

function makeIdentifier(rng, used) {
  const first = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_";
  const rest = first + "0123456789";
  for (let tries = 0; tries < 200; tries++) {
    let name = "_";
    const length = 7 + Math.floor(rng() * 5);
    for (let i = 0; i < length; i++) name += (i === 0 ? first : rest)[Math.floor(rng() * (i === 0 ? first : rest).length)];
    if (!used.has(name)) { used.add(name); return name; }
  }
  throw new Error("Unable to generate a unique local identifier.");
}

// Conservative top-level local renaming. If the source contains constructs that
// make scope analysis ambiguous for this lexical pass, renaming is skipped rather
// than risking a semantic change. String encoding still runs in that case.
function renameSafeTopLevelLocals(source, rng, language) {
  if (source.includes("`") || (language === "luau" && hasLuauTypeSyntax(source))) return source;
  const tokens = identifierTokens(source);
  if (!tokens || !tokens.length) return source;
  const depths = [];
  const stack = [];
  let pendingIf = 0;
  for (let i = 0; i < tokens.length; i++) {
    const v = tokens[i].value;
    if (v === "end" || v === "until") {
      if (stack.length) stack.pop();
    } else if (v === "elseif") {
      if (stack.length && stack.at(-1) === "if") stack.pop();
      pendingIf++;
    } else if (v === "else") {
      if (stack.length && stack.at(-1) === "if") stack.pop();
      stack.push("if");
    }
    depths[i] = stack.length;
    if (v === "function") stack.push("function");
    else if (v === "then") stack.push("if");
    else if (v === "do") stack.push("do");
    else if (v === "repeat") stack.push("repeat");
    if (v === "elseif") pendingIf = 1;
    if (pendingIf && v === "then") pendingIf = 0;
  }
  const used = new Set(tokens.filter(t => t.type === "identifier").map(t => t.value));
  const candidates = [];
  const declarations = new Map();
  const functionParams = new Set();
  const loopVars = new Set();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].value === "function") {
      let j = i + 1;
      while (j < tokens.length && tokens[j].value !== "(" && tokens[j].value !== "end") j++;
      if (tokens[j]?.value === "(") {
        for (j++; j < tokens.length && tokens[j].value !== ")"; j++) {
          if (tokens[j].type === "identifier" && (j === i + 2 || tokens[j - 1]?.value === ",")) functionParams.add(tokens[j].value);
        }
      }
    }
    if (tokens[i].value === "for") {
      for (let j = i + 1; j < tokens.length && tokens[j].value !== "do"; j++) {
        if (tokens[j].type === "identifier" && (j === i + 1 || tokens[j - 1]?.value === ",")) loopVars.add(tokens[j].value);
      }
    }
    if (tokens[i].value !== "local" || depths[i] !== 0) continue;
    let nameIndex = i + 1;
    let isFunction = false;
    if (tokens[nameIndex]?.value === "function") { isFunction = true; nameIndex++; }
    const nameToken = tokens[nameIndex];
    if (!nameToken || nameToken.type !== "identifier") continue;
    // Only initialized, single-name locals are handled by this conservative pass.
    if (!isFunction && tokens[nameIndex + 1]?.value !== "=") continue;
    const name = nameToken.value;
    const entries = declarations.get(name) || [];
    entries.push({ index: nameIndex, isFunction });
    declarations.set(name, entries);
    candidates.push({ name, index: nameIndex, isFunction });
  }
  const replacements = [];
  for (const candidate of candidates) {
    const { name, index, isFunction } = candidate;
    if ((declarations.get(name) || []).length !== 1 || functionParams.has(name) || loopVars.has(name)) continue;
    // Any earlier same-name token could be a global/reference whose meaning must not change.
    if (tokens.slice(0, index).some(t => t.type === "identifier" && t.value === name)) continue;
    // Avoid ambiguous type declarations and redeclarations in nested scopes.
    let unsafe = false;
    for (let j = index + 1; j < tokens.length; j++) {
      if (tokens[j].value === "local" && tokens[j + 1]?.value === name) { unsafe = true; break; }
    }
    if (unsafe) continue;
    const renamed = makeIdentifier(rng, used);
    for (let j = index; j < tokens.length; j++) {
      const token = tokens[j];
      if (token.type !== "identifier" || token.value !== name) continue;
      if (j !== index && (tokens[j - 1]?.value === "." || tokens[j - 1]?.value === ":" || tokens[j - 1]?.value === "::" || tokens[j + 1]?.value === "=" || tokens[j + 1]?.value === "::")) continue;
      replacements.push({ start: token.start, end: token.end, text: renamed });
    }
  }
  replacements.sort((a, b) => a.start - b.start);
  let output = source;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    output = output.slice(0, r.start) + r.text + output.slice(r.end);
  }
  return output;
}

function universalLexicalObfuscate(source, rng, options = {}) {
  const language = options.language === "luau" ? "luau" : "lua";
  if (options.renameLocals === true) source = renameSafeTopLevelLocals(source, rng, language);
  const replacements = [];
  const alphabetChars = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,-./:;<>?@[]^_`{|}~");
  shuffleArray(alphabetChars, rng);
  const alphabet = alphabetChars.slice(0, 64).join("");
  const decoderName = makeDecoderName(source, rng);
  let encodedStringCount = 0;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "'" || c === '"') {
      const start = i++;
      let closed = false;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === c) { i++; closed = true; break; }
        i++;
      }
      if (!closed) throw new Error(`Unclosed string at character ${start + 1}.`);
      const preserveTypeLiteral = language === "luau" && isLuauTypeStringLiteral(source, start);
      if (!preserveTypeLiteral) {
        const raw = source.slice(start, i);
        replacements.push({ start, end: i, text: luaStringExpression(decodeLuaStringBytes(raw, "quoted"), rng, decoderName, alphabet) });
        encodedStringCount++;
      }
      continue;
    }
    if (c === "[") {
      const open = longBracketOpen(source, i);
      if (open) {
        const start = i;
        const close = "]" + "=".repeat(open.equals) + "]";
        const end = source.indexOf(close, open.contentStart);
        if (end < 0) throw new Error(`Unclosed long-bracket string at character ${start + 1}.`);
        i = end + close.length;
        const preserveTypeLiteral = language === "luau" && isLuauTypeStringLiteral(source, start);
        if (!preserveTypeLiteral) {
          const raw = source.slice(start, i);
          replacements.push({ start, end: i, text: luaStringExpression(decodeLuaStringBytes(raw, "long"), rng, decoderName, alphabet) });
          encodedStringCount++;
        }
        continue;
      }
    }
    if (c === "`") {
      i++;
      let closed = false;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === "`") { i++; closed = true; break; }
        i++;
      }
      if (!closed) throw new Error("Unclosed Luau interpolated string.");
      continue;
    }
    if (source.startsWith("--", i)) {
      const start = i;
      const open = longBracketOpen(source, i + 2);
      if (open) {
        const close = "]" + "=".repeat(open.equals) + "]";
        const end = source.indexOf(close, open.contentStart);
        if (end < 0) throw new Error(`Unclosed long comment at character ${start + 1}.`);
        i = end + close.length;
        const comment = source.slice(start, i);
        if (/^--!/.test(comment)) replacements.push({ start, end: i, text: comment });
        else replacements.push({ start, end: i, text: comment.replace(/[^\r\n]/g, " ") });
      } else {
        const end = source.indexOf("\n", i);
        i = end < 0 ? source.length : end;
        const comment = source.slice(start, i);
        if (/^--!/.test(comment)) replacements.push({ start, end: i, text: comment });
        else replacements.push({ start, end: i, text: comment.replace(/[^\r\n]/g, " ") });
      }
      continue;
    }
    i++;
  }
  let output = source;
  for (let r = replacements.length - 1; r >= 0; r--) {
    const item = replacements[r];
    output = output.slice(0, item.start) + item.text + output.slice(item.end);
  }
  if (encodedStringCount > 0) {
    const originalOffset = preludeOffset(source);
    let adjustedOffset = originalOffset;
    for (const item of replacements) {
      if (item.end <= originalOffset) adjustedOffset += item.text.length - (item.end - item.start);
    }
    output = output.slice(0, adjustedOffset) + makeStringDecoder(decoderName, alphabet) + output.slice(adjustedOffset);
  }
  return output;
}

export function compileLuaSubset(source, options = {}) {
  if (typeof source !== "string") throw new Error("Source must be a string.");
  const byteLength = new TextEncoder().encode(source).byteLength;
  const maxBytes = 50 * 1024 * 1024;
  if (byteLength > maxBytes) {
    throw new Error(`Input too large (limit 50MB, got ${(byteLength / (1024 * 1024)).toFixed(2)}MB).`);
  }
  const language = options.language === "luau" ? "luau" : "lua";
  const rng = Number.isInteger(options.seed) ? mulberry32(options.seed ^ (language === "luau" ? 0x4c554155 : 0x4c554120)) : secureRandom;

  // Intentionally do not compile input through the prototype VM. A lexical
  // transformer leaves the target language's grammar and runtime semantics in
  // place, so constructs outside the old VM subset (method calls, varargs,
  // multiple returns/assignments, goto, Lua 5.3 operators, Luau types, etc.)
  // are not rejected or rewritten by a partial parser.
  return universalLexicalObfuscate(source, rng, { language, renameLocals: options.renameLocals === true });
}
