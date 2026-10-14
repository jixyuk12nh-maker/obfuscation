const KEYWORDS = new Set(["local", "function", "return", "if", "then", "elseif", "else", "end", "while", "repeat", "until", "do", "break", "true", "false", "nil", "and", "or", "not"]);

function lex(source) {
  const tokens = [];
  let i = 0;
  const push = (type, value, pos) => tokens.push({ type, value, pos });
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (source.startsWith("--", i)) {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    const start = i;
    if (c === "'" || c === '"') {
      const quote = c;
      i++;
      let value = "";
      let closed = false;
      while (i < source.length) {
        const ch = source[i++];
        if (ch === quote) { closed = true; break; }
        if (ch === "\\") {
          if (i >= source.length) break;
          const esc = source[i++];
          const map = { n: "\n", r: "\r", t: "\t", "\\": "\\", "'": "'", '"': '"', "0": "\0" };
          value += Object.hasOwn(map, esc) ? map[esc] : esc;
        } else value += ch;
      }
      if (!closed) throw new Error(`Unclosed string at character ${start + 1}.`);
      push("string", value, start);
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(source[i + 1] || ""))) {
      const m = source.slice(i).match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
      if (!m) throw new Error(`Invalid number at character ${i + 1}.`);
      i += m[0].length;
      push("number", Number(m[0]), start);
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = source.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)[0];
      i += m.length;
      push(KEYWORDS.has(m) ? "keyword" : "identifier", m, start);
      continue;
    }
    const op = ["...", "==", "~=", "<=", ">=", ".."].find(x => source.startsWith(x, i));
    if (op) {
      if (op === "...") throw new Error(`Varargs are not supported (character ${i + 1}).`);
      i += op.length;
      push("symbol", op, start);
      continue;
    }
    if ("+-*/%^#=<>(),;{}[]:.".includes(c)) {
      i++;
      push("symbol", c, start);
      continue;
    }
    throw new Error(`Unsupported character ${JSON.stringify(c)} at character ${i + 1}.`);
  }
  tokens.push({ type: "eof", value: "<eof>", pos: source.length });
  return tokens;
}

const PRECEDENCE = {
  or: 1, and: 2,
  "==": 3, "~=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3,
  "..": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6, "%": 6,
  "^": 8
};

class Parser {
  constructor(tokens) { this.t = tokens; this.i = 0; }
  peek() { return this.t[this.i]; }
  is(v) { return this.peek().value === v; }
  take() { return this.t[this.i++]; }
  expect(v) {
    if (!this.is(v)) throw new Error(`Expected '${v}' at character ${this.peek().pos + 1}, got '${this.peek().value}'.`);
    return this.take();
  }
  identifier() {
    const t = this.peek();
    if (t.type !== "identifier") throw new Error(`Expected identifier at character ${t.pos + 1}.`);
    return this.take().value;
  }
  parse() {
    const body = this.block(new Set(["<eof>"]));
    this.expect("<eof>");
    return body;
  }
  block(stops) {
    const out = [];
    while (!stops.has(this.peek().value) && this.peek().type !== "eof") {
      if (this.is(";")) { this.take(); continue; }
      out.push(this.statement());
      if (this.is(";")) this.take();
    }
    return out;
  }
  statement() {
    if (this.is("local")) {
      this.take();
      if (this.is("function")) {
        this.take();
        const name = this.identifier();
        return { type: "localFunction", name, func: this.functionBody() };
      }
      const name = this.identifier();
      this.expect("=");
      return { type: "assign", name, local: true, value: this.expression() };
    }
    if (this.is("function")) {
      this.take();
      const name = this.identifier();
      return { type: "functionDecl", name, func: this.functionBody() };
    }
    if (this.is("return")) {
      this.take();
      if (["end", "else", "elseif", "until", "<eof>", ";"].includes(this.peek().value)) return { type: "return", value: null };
      return { type: "return", value: this.expression() };
    }
    if (this.is("if")) {
      this.take();
      const branches = [];
      let test = this.expression();
      this.expect("then");
      branches.push({ test, body: this.block(new Set(["elseif", "else", "end"])) });
      while (this.is("elseif")) {
        this.take();
        test = this.expression();
        this.expect("then");
        branches.push({ test, body: this.block(new Set(["elseif", "else", "end"])) });
      }
      let no = [];
      if (this.is("else")) { this.take(); no = this.block(new Set(["end"])); }
      this.expect("end");
      return { type: "if", branches, no };
    }
    if (this.is("repeat")) {
      this.take();
      const body = this.block(new Set(["until"]));
      this.expect("until");
      return { type: "repeat", body, test: this.expression() };
    }
    if (this.is("do")) {
      this.take();
      const body = this.block(new Set(["end"]));
      this.expect("end");
      return { type: "do", body };
    }
    if (this.is("break")) {
      this.take();
      return { type: "break" };
    }
    if (this.is("while")) {
      this.take();
      const test = this.expression();
      this.expect("do");
      const body = this.block(new Set(["end"]));
      this.expect("end");
      return { type: "while", test, body };
    }
    if (this.peek().type === "identifier") {
      const target = this.suffixedPrimary();
      if (this.is("=")) {
        this.take();
        const value = this.expression();
        if (target.type === "variable") return { type: "assign", name: target.name, local: false, value };
        if (target.type === "index") return { type: "setindex", target: target.target, key: target.key, value };
        throw new Error(`Invalid assignment target at character ${this.peek().pos + 1}.`);
      }
      if (target.type === "call") return { type: "callExpr", expression: target };
      throw new Error(`Expected assignment or function call at character ${this.peek().pos + 1}.`);
    }
    throw new Error(`Unsupported statement '${this.peek().value}' at character ${this.peek().pos + 1}.`);
  }
  functionBody() {
    this.expect("(");
    const params = [];
    if (!this.is(")")) {
      do {
        params.push(this.identifier());
        if (!this.is(",")) break;
        this.take();
      } while (!this.is(")"));
    }
    this.expect(")");
    const body = this.block(new Set(["end"]));
    this.expect("end");
    return { type: "function", params, body };
  }
  expression(min = 1) {
    let left = this.prefix();
    while (true) {
      const op = this.peek().value;
      const prec = PRECEDENCE[op];
      if (!prec || prec < min) break;
      this.take();
      const right = this.expression(prec + (op === "^" || op === ".." ? 0 : 1));
      left = { type: "binary", op, left, right };
    }
    return left;
  }
  prefix() {
    const t = this.peek();
    if (["-", "not", "#"].includes(t.value)) {
      this.take();
      return { type: "unary", op: t.value, value: this.expression(7) };
    }
    let node;
    if (t.value === "(") {
      this.take();
      node = this.expression();
      this.expect(")");
    } else if (t.type === "number" || t.type === "string") {
      this.take();
      node = { type: "constant", value: t.value };
    } else if (["true", "false", "nil"].includes(t.value)) {
      this.take();
      node = { type: "constant", value: t.value === "nil" ? null : t.value === "true" };
    } else if (t.type === "identifier") {
      node = { type: "variable", name: this.take().value };
    } else if (t.value === "function") {
      this.take();
      node = this.functionBody();
    } else if (t.value === "{") {
      node = this.tableConstructor();
    } else {
      throw new Error(`Expected expression at character ${t.pos + 1}, got '${t.value}'.`);
    }
    return this.suffixes(node);
  }
  suffixedPrimary() {
    const t = this.peek();
    if (t.type !== "identifier") throw new Error(`Expected identifier at character ${t.pos + 1}.`);
    return this.suffixes({ type: "variable", name: this.take().value });
  }
  suffixes(node) {
    while (true) {
      if (this.is("[")) {
        this.take();
        const key = this.expression();
        this.expect("]");
        node = { type: "index", target: node, key };
      } else if (this.is(".")) {
        this.take();
        const name = this.identifier();
        node = { type: "index", target: node, key: { type: "constant", value: name } };
      } else if (this.is("(")) {
        this.take();
        const args = [];
        if (!this.is(")")) {
          do {
            args.push(this.expression());
            if (!this.is(",")) break;
            this.take();
          } while (!this.is(")"));
        }
        this.expect(")");
        node = { type: "call", callee: node, args };
      } else break;
    }
    return node;
  }
  tableConstructor() {
    this.expect("{");
    const fields = [];
    let arrayIndex = 1;
    while (!this.is("}")) {
      if (this.is("[")) {
        this.take();
        const key = this.expression();
        this.expect("]");
        this.expect("=");
        fields.push({ key, value: this.expression() });
      } else if (this.peek().type === "identifier" && this.t[this.i + 1]?.value === "=") {
        const key = { type: "constant", value: this.take().value };
        this.expect("=");
        fields.push({ key, value: this.expression() });
      } else {
        fields.push({ key: { type: "constant", value: arrayIndex++ }, value: this.expression() });
      }
      if (this.is(",") || this.is(";")) this.take();
      else if (!this.is("}")) throw new Error(`Expected ',' or '}' at character ${this.peek().pos + 1}.`);
    }
    this.expect("}");
    return { type: "table", fields };
  }

}

const OPCODES = [
  "PUSH", "LOAD", "STORE", "NEG", "NOT", "LEN", "ADD", "SUB", "MUL", "DIV",
  "MOD", "POW", "CONCAT", "EQ", "NE", "LT", "LE", "GT", "GE", "AND", "OR",
  "CALL", "JMP", "JMPF", "JMPT", "DUP", "POP", "RETURN", "NEWTABLE", "GETTABLE", "SETTABLE", "NOP", "CLOSURE"
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleArray(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function encodeXorRotate(value, rng) {
  const bytes = new TextEncoder().encode(value);
  const key = Array.from({ length: 4 }, () => 1 + Math.floor(rng() * 254));
  const rot = 1 + Math.floor(rng() * 7);
  const out = new Uint8Array(bytes.length + 5);
  out[0] = rot;
  out.set(key, 1);
  for (let i = 0; i < bytes.length; i++) {
    const x = bytes[i] ^ key[i % 4];
    out[i + 5] = ((x << rot) | (x >>> (8 - rot))) & 0xff;
  }
  return out;
}

function encodeConstant(value, rng) {
  if (value === null) return { tag: "z", bytes: new Uint8Array(0) };
  if (typeof value === "boolean") return { tag: value ? "t" : "f", bytes: new Uint8Array(0) };
  if (typeof value === "number") return { tag: "n", bytes: encodeXorRotate(String(value), rng) };
  return { tag: "s", bytes: encodeXorRotate(String(value), rng) };
}

function bytesToLuaArray(bytes) {
  return bytes.length ? `{${Array.from(bytes).join(",")}}` : "{}";
}

function base64Encode(bytes, alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/") {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const hasB = i + 1 < bytes.length;
    const hasC = i + 2 < bytes.length;
    const b = hasB ? bytes[i + 1] : 0;
    const c = hasC ? bytes[i + 2] : 0;
    out += alphabet[a >> 2];
    out += alphabet[((a & 3) << 4) | (b >> 4)];
    out += hasB ? alphabet[((b & 15) << 2) | (c >> 6)] : "=";
    out += hasC ? alphabet[c & 63] : "=";
  }
  return out;
}

function encodeMaskedText(value, rng, alphabet) {
  const key = 1 + Math.floor(rng() * 255);
  const bytes = new TextEncoder().encode(value);
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= key;
  return { text: base64Encode(bytes, alphabet), key };
}

function compileAst(ast, rng, functions = [], params = []) {
  const code = [];
  const constants = [];
  const constantMap = new Map();

  function constant(value) {
    const key = `${typeof value}:${JSON.stringify(value)}`;
    if (!constantMap.has(key)) {
      constantMap.set(key, constants.length + 1);
      constants.push(value);
    }
    return constantMap.get(key);
  }
  const paramConstants = params.map(name => constant(name));
  function registerFunction(fn) {
    const id = functions.length + 1;
    functions.push(null);
    const child = compileAst(fn.body, rng, functions, fn.params);
    functions[id - 1] = child;
    return id;
  }
  function emit(op, a = 0, b = 0) {
    code.push([op, a, b]);
    return code.length;
  }
  function patch(index, target) { code[index - 1][1] = target; }
  const loopBreaks = [];
  function expr(n) {
    switch (n.type) {
      case "constant": emit("PUSH", constant(n.value)); break;
      case "function": emit("CLOSURE", registerFunction(n)); break;
      case "variable": emit("LOAD", constant(n.name)); break;
      case "index": expr(n.target); expr(n.key); emit("GETTABLE"); break;
      case "table":
        emit("NEWTABLE");
        for (const field of n.fields) {
          emit("DUP");
          expr(field.key);
          expr(field.value);
          emit("SETTABLE");
        }
        break;
      case "call":
        expr(n.callee);
        for (const arg of n.args) expr(arg);
        emit("CALL", 0, n.args.length);
        break;
      case "unary":
        expr(n.value);
        emit(n.op === "-" ? "NEG" : n.op === "not" ? "NOT" : "LEN");
        break;
      case "binary":
        if (n.op === "and" || n.op === "or") {
          expr(n.left);
          emit("DUP");
          const jump = emit(n.op === "and" ? "JMPF" : "JMPT", 0);
          emit("POP");
          expr(n.right);
          patch(jump, code.length + 1);
        } else {
          expr(n.left);
          expr(n.right);
          emit(({ "+": "ADD", "-": "SUB", "*": "MUL", "/": "DIV", "%": "MOD", "^": "POW", "..": "CONCAT", "==": "EQ", "~=": "NE", "<": "LT", "<=": "LE", ">": "GT", ">=": "GE" })[n.op]);
        }
        break;
      default: throw new Error("Internal compiler error: unknown expression.");
    }
  }
  function block(stmts) {
    for (const s of stmts) {
      if (s.type === "assign") {
        expr(s.value);
        emit("STORE", constant(s.name), s.local ? 1 : 0);
      } else if (s.type === "localFunction" || s.type === "functionDecl") {
        expr(s.func);
        emit("STORE", constant(s.name), s.type === "localFunction" ? 1 : 0);
      } else if (s.type === "call") {
        expr({ type: "variable", name: s.name });
        for (const arg of s.args) expr(arg);
        emit("CALL", 0, s.args.length);
        emit("POP");
      } else if (s.type === "callExpr") {
        expr(s.expression);
        emit("POP");
      } else if (s.type === "setindex") {
        expr(s.target);
        expr(s.key);
        expr(s.value);
        emit("SETTABLE");
      } else if (s.type === "return") {
        if (s.value) expr(s.value); else emit("PUSH", constant(null));
        emit("RETURN");
      } else if (s.type === "if") {
        const exits = [];
        for (const branch of s.branches) {
          expr(branch.test);
          const jf = emit("JMPF", 0);
          block(branch.body);
          exits.push(emit("JMP", 0));
          patch(jf, code.length + 1);
        }
        block(s.no);
        for (const jump of exits) patch(jump, code.length + 1);
      } else if (s.type === "while") {
        const start = code.length + 1;
        expr(s.test);
        const jf = emit("JMPF", 0);
        const breaks = [];
        loopBreaks.push(breaks);
        block(s.body);
        loopBreaks.pop();
        emit("JMP", start);
        const end = code.length + 1;
        patch(jf, end);
        for (const jump of breaks) patch(jump, end);
      } else if (s.type === "repeat") {
        const start = code.length + 1;
        const breaks = [];
        loopBreaks.push(breaks);
        block(s.body);
        loopBreaks.pop();
        expr(s.test);
        emit("JMPF", start);
        const end = code.length + 1;
        for (const jump of breaks) patch(jump, end);
      } else if (s.type === "do") {
        block(s.body);
      } else if (s.type === "break") {
        if (!loopBreaks.length) throw new Error("'break' outside loop.");
        loopBreaks[loopBreaks.length - 1].push(emit("JMP", 0));
      }
    }
  }
  block(ast);
  emit("PUSH", constant(null));
  emit("RETURN");
  return { code, constants, functions, params: paramConstants, rng };
}

function secureRandom() {
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0] / 4294967296;
  }
  throw new Error("Secure randomness is unavailable; provide an explicit seed only for testing.");
}

function padControlFlow(code, rng) {
  const jumpOps = new Set(["JMP", "JMPF", "JMPT"]);
  const targetMap = new Map();
  let expandedLength = 0;
  const padding = code.map(() => 1 + Math.floor(rng() * 3));
  for (let i = 0; i < code.length; i++) {
    expandedLength += padding[i];
    targetMap.set(i + 1, expandedLength + 1);
    expandedLength += 1;
  }
  targetMap.set(code.length + 1, expandedLength + 1);
  const expanded = [];
  for (let i = 0; i < code.length; i++) {
    for (let j = 0; j < padding[i]; j++) expanded.push(["NOP", 0, 0]);
    const row = [...code[i]];
    if (jumpOps.has(row[0])) {
      const mapped = targetMap.get(row[1]);
      if (mapped === undefined) throw new Error("Invalid jump target during control-flow encoding.");
      row[1] = mapped;
    }
    expanded.push(row);
  }
  return expanded;
}

function emitLua(program) {
  const rng = program.rng;
  const alphabetChars = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,-./:;<>?@[]^_`{|}~");
  shuffleArray(alphabetChars, rng);
  const packedAlphabet = alphabetChars.slice(0, 64).join("");
  const shuffledIds = shuffleArray(Array.from({ length: 256 }, (_, i) => i), rng);
  const opIds = new Map(OPCODES.map((op, i) => [op, shuffledIds[i]]));
  const MOD32 = 4294967296;
  const encodedOperand = (value, base, index, stride) =>
    (value + ((base + index * stride) % MOD32)) % MOD32;
  function encodeProgramData(prog) {
    const operandMaskA = 1 + Math.floor(rng() * 0x7ffffffe);
    const operandMaskB = 1 + Math.floor(rng() * 0x7ffffffe);
    const encodedConstants = prog.constants.map(value => encodeConstant(value, rng));
    const constLua = `{${encodedConstants.map(entry => {
      if (entry.tag === "z" || entry.tag === "t" || entry.tag === "f") return `{${JSON.stringify(entry.tag)}}`;
      return `{${JSON.stringify(entry.tag)},${bytesToLuaArray(entry.bytes)}}`;
    }).join(",")}}`;
    const code = padControlFlow(prog.code, rng);
    const codeLua = `{${code.map((row, i) => {
      const index = i + 1;
      return `{${opIds.get(row[0])},${encodedOperand(row[1], operandMaskA, index, 65599)},${encodedOperand(row[2], operandMaskB, index, 31337)}}`;
    }).join(",")}}`;
    return { BC: codeLua, CT: constLua, MA: operandMaskA, MB: operandMaskB, P: `{${(prog.params || []).join(",")}}` };
  }
  const encodedPrograms = [program, ...program.functions].map(encodeProgramData);
  const root = encodedPrograms[0];
  const funcsLua = `{${encodedPrograms.slice(1).map(p => `{BC=${p.BC},CT=${p.CT},MA=${p.MA},MB=${p.MB},P=${p.P}}`).join(",")}}`;
  const decoder = OPCODES.map((name, i) => `${i === 0 ? "if" : "elseif"} id==${opIds.get(name)} then return ${JSON.stringify(name)}`).join("\n") + "\nend";

  const innerVmSource = `local _TAG={}
local function _vm(BC,CT,FUNCS,_MA,_MB,V,P,ARGS,PARAMS)
local _MOD=4294967296
local S,L,LD,sp,pc={},{},{},0,1
local function pop() if sp<1 then error("LuaMoon VM: stack underflow",0) end local v=S[sp] S[sp]=nil sp=sp-1 return v end
local function push(v) sp=sp+1 S[sp]=v end
local function truth(v) return v~=nil and v~=false end
local function bx(a,b)
local r,p=0,1
for _=1,8 do
local x,y=a%2,b%2
if x~=y then r=r+p end
a=math.floor(a/2) b=math.floor(b/2) p=p*2
end
return r
end
local function ds(bl)
local rot=bl[1]
local keys={bl[2],bl[3],bl[4],bl[5]}
local out={}
for i=6,#bl do
local b=bl[i]
local m=2^rot
b=math.floor(b/m)+(b%m)*2^(8-rot)
b=bx(b,keys[(i-6)%4+1])
out[#out+1]=string.char(b)
end
return table.concat(out)
end
local function gc(i)
local e=CT[i]
if not e then return nil end
if e[1]=="s" then return ds(e[2]) end
if e[1]=="n" then return tonumber(ds(e[2])) end
if e[1]=="z" then return nil end
if e[1]=="t" then return true end
if e[1]=="f" then return false end
end
local function findParent(name, frame)
while frame do
if frame.LD[name] then return frame.L,name end
frame=frame.P
end
return nil,nil
end
for i,index in ipairs(PARAMS or {}) do
local name=gc(index)
LD[name]=true
L[name]=(ARGS or {})[i]
end
local function op(id)
${decoder}
return nil
end
local function step(ins,index)
local o=op(ins[1])
if not o then error("LuaMoon VM: invalid opcode",0) end
local a=(ins[2]-((_MA+index*65599)%_MOD))%_MOD
local b=(ins[3]-((_MB+index*31337)%_MOD))%_MOD
if o=="NOP" then
elseif o=="CLOSURE" then push({[_TAG]=true,id=a,env={L=L,LD=LD,P=P}})
elseif o=="PUSH" then push(gc(a))
elseif o=="LOAD" then
local name=gc(a)
if LD[name] then push(L[name]) else local pl,pn=findParent(name,P) if pl then push(pl[pn]) else local v=V[name] if v==nil then v=_G[name] end push(v) end end
elseif o=="STORE" then
local name=gc(a) local v=pop()
if b==1 then LD[name]=true L[name]=v elseif LD[name] then L[name]=v else local pl,pn=findParent(name,P) if pl then pl[pn]=v else V[name]=v end end
elseif o=="NEG" then push(-(tonumber(pop()) or 0))
elseif o=="NOT" then push(not truth(pop()))
elseif o=="LEN" then push(#pop())
elseif o=="ADD" then local y,x=pop(),pop() push(x+y)
elseif o=="SUB" then local y,x=pop(),pop() push(x-y)
elseif o=="MUL" then local y,x=pop(),pop() push(x*y)
elseif o=="DIV" then local y,x=pop(),pop() push(x/y)
elseif o=="MOD" then local y,x=pop(),pop() push(x%y)
elseif o=="POW" then local y,x=pop(),pop() push(x^y)
elseif o=="CONCAT" then local y,x=pop(),pop() push(tostring(x)..tostring(y))
elseif o=="EQ" then local y,x=pop(),pop() push(x==y)
elseif o=="NE" then local y,x=pop(),pop() push(x~=y)
elseif o=="LT" then local y,x=pop(),pop() push(x<y)
elseif o=="LE" then local y,x=pop(),pop() push(x<=y)
elseif o=="GT" then local y,x=pop(),pop() push(x>y)
elseif o=="GE" then local y,x=pop(),pop() push(x>=y)
elseif o=="DUP" then push(S[sp])
elseif o=="POP" then pop()
elseif o=="NEWTABLE" then push({})
elseif o=="GETTABLE" then local k,t=pop(),pop() push(t[k])
elseif o=="SETTABLE" then local v,k,t=pop(),pop(),pop() t[k]=v
elseif o=="CALL" then
local args={} for j=b,1,-1 do args[j]=pop() end
local f
if a~=0 then local name=gc(a) if LD[name] then f=L[name] else f=V[name] if type(f)~="function" then f=_G[name] end end else f=pop() end
if type(f)=="table" and f[_TAG] then
local proto=FUNCS[f.id]
if not proto then error("LuaMoon VM: invalid closure",0) end
push(_vm(proto.BC,proto.CT,FUNCS,proto.MA,proto.MB,V,f.env,args,proto.P))
else
if type(f)~="function" then error("LuaMoon VM: function not found",0) end
push(f((table.unpack or unpack)(args)))
end
elseif o=="JMP" then pc=a
elseif o=="JMPF" then if not truth(pop()) then pc=a end
elseif o=="JMPT" then if truth(pop()) then pc=a end
elseif o=="RETURN" then return true,pop()
end
return false,nil
end
while true do
local index=pc
local ins=BC[index]
if not ins then return nil end
pc=index+1
local done,value=step(ins,index)
if done then return value end
end
end
return _vm`;

  const encryptedVm = encodeXorRotate(innerVmSource, rng);
  const payloadSource = `return {CT=${root.CT},BC=${root.BC},FUNCS=${funcsLua},MA=${root.MA},MB=${root.MB}}`;
  const payload = encodeMaskedText(payloadSource, rng, packedAlphabet);
  const encodedVm = base64Encode(encryptedVm, packedAlphabet);
  return `return (function()
local _A=${JSON.stringify(packedAlphabet)}
local _KW=${JSON.stringify(encodedVm)}
local _D=${JSON.stringify(payload.text)}
local _Q=${payload.key}
local function _u(s)
local M={}
for i=1,#_A do M[string.sub(_A,i,i)]=i-1 end
local O={} local V=0 local B=0
for i=1,#s do
local c=string.sub(s,i,i)
if c~="=" then
local n=M[c]
if n then
V=V*64+n B=B+6
if B>=8 then B=B-8 local q=math.floor(V/2^B)%256 O[#O+1]=q V=V%2^B end
end
end
end
return O
end
local function _bx(a,b)
local r,p=0,1
for _=1,8 do
local x,y=a%2,b%2
if x~=y then r=r+p end
a=math.floor(a/2) b=math.floor(b/2) p=p*2
end
return r
end
local function _dk(bl)
local rot=bl[1]
local keys={bl[2],bl[3],bl[4],bl[5]}
local out={}
for i=6,#bl do
local b=bl[i]
local m=2^rot
b=math.floor(b/m)+(b%m)*2^(8-rot)
b=_bx(b,keys[(i-6)%4+1])
out[#out+1]=string.char(b)
end
return table.concat(out)
end
local function _un(s,k)
local b=_u(s) local o={}
for i=1,#b do o[i]=string.char(_bx(b[i],k)) end
return table.concat(o)
end
local _loader=loadstring or load
if type(_loader)~="function" then error("LuaMoon VM: dynamic code loading is unavailable",0) end
local _dataChunk,_dataErr=_loader(_un(_D,_Q))
if not _dataChunk then error(_dataErr or "LuaMoon VM: data initialization failed",0) end
local _DATA=_dataChunk()
local _src=_dk(_u(_KW))
local _chunk,_err=_loader(_src)
if not _chunk then error(_err or "LuaMoon VM: failed to initialize",0) end
return _chunk()(_DATA.BC,_DATA.CT,_DATA.FUNCS,_DATA.MA,_DATA.MB,{},nil,{}, {})
end)()
`;}

function longBracketOpen(source, start) {
  if (source[start] !== "[") return null;
  let i = start + 1;
  while (source[i] === "=") i++;
  if (source[i] !== "[") return null;
  return { equals: i - start - 1, contentStart: i + 1 };
}

function decodeLuaStringBytes(raw, kind) {
  if (kind === "long") {
    const open = longBracketOpen(raw, 0);
    if (!open) throw new Error("Invalid long-bracket string.");
    const close = "]" + "=".repeat(open.equals) + "]";
    let value = raw.slice(open.contentStart, raw.length - close.length).replace(/\r\n?/g, "\n");
    if (value.startsWith("\n")) value = value.slice(1);
    return Array.from(new TextEncoder().encode(value));
  }
  const bytes = [];
  const pushText = value => bytes.push(...new TextEncoder().encode(value));
  for (let i = 1; i < raw.length - 1; i++) {
    let c = raw[i];
    if (c !== "\\") { pushText(c); continue; }
    if (++i >= raw.length - 1) throw new Error("Unfinished escape in string literal.");
    c = raw[i];
    const simple = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, "\"": 34, "'": 39 };
    if (Object.hasOwn(simple, c)) { bytes.push(simple[c]); continue; }
    if (c === "\n") { bytes.push(10); continue; }
    if (c === "\r") { if (raw[i + 1] === "\n") i++; bytes.push(10); continue; }
    if (c === "z") { while (i + 1 < raw.length - 1 && /\s/.test(raw[i + 1])) i++; continue; }
    if (c === "x" && /^[0-9a-fA-F]{2}$/.test(raw.slice(i + 1, i + 3))) {
      bytes.push(parseInt(raw.slice(i + 1, i + 3), 16)); i += 2; continue;
    }
    if (c === "u" && raw[i + 1] === "{") {
      const end = raw.indexOf("}", i + 2);
      if (end < 0) throw new Error("Invalid Unicode escape in string literal.");
      const cp = parseInt(raw.slice(i + 2, end), 16);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) throw new Error("Invalid Unicode escape in string literal.");
      pushText(String.fromCodePoint(cp)); i = end; continue;
    }
    if (/[0-9]/.test(c)) {
      let digits = c;
      while (digits.length < 3 && /[0-9]/.test(raw[i + 1] || "")) digits += raw[++i];
      const n = Number(digits);
      if (n > 255) throw new Error("Decimal escape exceeds 255.");
      bytes.push(n); continue;
    }
    pushText(c);
  }
  return bytes;
}

function luaStringExpression(bytes, rng) {
  if (!bytes.length) return '""';
  const chunks = [];
  let i = 0;
  while (i < bytes.length) {
    const size = 1 + Math.floor(rng() * 8);
    const raw = bytes.slice(i, i + size).map(byte => `\\${String(byte).padStart(3, "0")}`).join("");
    chunks.push(`"${raw}"`);
    i += size;
  }
  return chunks.length === 1 ? chunks[0] : `(${chunks.join(" .. ")})`;
}

function hasLuauTypeSyntax(source) {
  return /\bexport\s+type\s+[A-Za-z_]|\btype\s+[A-Za-z_][\w]*\s*=|\btypeof\s*\(|::|\b(?:local\s+)?function\s+[\w.:]+\s*\([^)]*:[^)]*\)|\bfunction\s*\([^)]*:[^)]*\)|\blocal\s+[A-Za-z_]\w*\s*:\s*[A-Za-z_{(]/.test(source);
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

function universalLexicalObfuscate(source, rng, options = {}) {
  const language = options.language === "luau" ? "luau" : "lua";
  const replacements = [];
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
        replacements.push({ start, end: i, text: luaStringExpression(decodeLuaStringBytes(raw, "quoted"), rng) });
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
          replacements.push({ start, end: i, text: luaStringExpression(decodeLuaStringBytes(raw, "long"), rng) });
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
  return universalLexicalObfuscate(source, rng, { language });
}
