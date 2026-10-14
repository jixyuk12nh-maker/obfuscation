const KEYWORDS = new Set(["local", "return", "if", "then", "elseif", "else", "end", "while", "repeat", "until", "do", "break", "true", "false", "nil", "and", "or", "not"]);

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
      const name = this.identifier();
      this.expect("=");
      return { type: "assign", name, local: true, value: this.expression() };
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
  "CALL", "JMP", "JMPF", "JMPT", "DUP", "POP", "RETURN", "NEWTABLE", "GETTABLE", "SETTABLE"
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

function compileAst(ast, rng) {
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
  function emit(op, a = 0, b = 0) {
    code.push([op, a, b]);
    return code.length;
  }
  function patch(index, target) { code[index - 1][1] = target; }
  const loopBreaks = [];
  function expr(n) {
    switch (n.type) {
      case "constant": emit("PUSH", constant(n.value)); break;
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
  return { code, constants, rng };
}

function emitLua(program) {
  const rng = program.rng;
  const shuffledIds = shuffleArray(Array.from({ length: 256 }, (_, i) => i), rng);
  const opIds = new Map(OPCODES.map((op, i) => [op, shuffledIds[i]]));
  const encodedConstants = program.constants.map(value => encodeConstant(value, rng));
  const constLua = `{${encodedConstants.map(entry => {
    if (entry.tag === "z" || entry.tag === "t" || entry.tag === "f") return `{${JSON.stringify(entry.tag)}}`;
    return `{${JSON.stringify(entry.tag)},${bytesToLuaArray(entry.bytes)}}`;
  }).join(",")}}`;
  const codeLua = `{${program.code.map(row => `{${opIds.get(row[0])},${row[1]},${row[2]}}`).join(",")}}`;
  const decoder = OPCODES.map((name, i) => `${i === 0 ? "if" : "elseif"} id==${opIds.get(name)} then return ${JSON.stringify(name)}`).join("\n") + "\nend";

  const innerVmSource = `local function _vm(BC,CT)
local S,L,LD,V,sp,pc={},{},{},{},0,1
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
local function op(id)
${decoder}
return nil
end
local function step(ins)
local o=op(ins[1])
if not o then error("LuaMoon VM: invalid opcode",0) end
local a,b=ins[2],ins[3]
if o=="PUSH" then push(gc(a))
elseif o=="LOAD" then
local name=gc(a)
if LD[name] then push(L[name]) else local v=V[name] if v==nil then v=_G[name] end push(v) end
elseif o=="STORE" then
local name=gc(a) local v=pop()
if b==1 then LD[name]=true L[name]=v else V[name]=v _G[name]=v end
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
if type(f)~="function" then error("LuaMoon VM: function not found",0) end
push(f((table.unpack or unpack)(args)))
elseif o=="JMP" then pc=a
elseif o=="JMPF" then if not truth(pop()) then pc=a end
elseif o=="JMPT" then if truth(pop()) then pc=a end
elseif o=="RETURN" then return true,pop()
end
return false,nil
end
while true do
local ins=BC[pc]
if not ins then return nil end
pc=pc+1
local done,value=step(ins)
if done then return value end
end
end
return _vm`;

  const encryptedVm = encodeXorRotate(innerVmSource, rng);
  return `return (function()
local _KW=${bytesToLuaArray(encryptedVm)}
local _CT=${constLua}
local _BC=${codeLua}
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
local _src=_dk(_KW)
local _loader=loadstring or load
if type(_loader)~="function" then error("LuaMoon VM: dynamic code loading is unavailable",0) end
local _chunk,_err=_loader(_src)
if not _chunk then error(_err or "LuaMoon VM: failed to initialize",0) end
return _chunk()(_BC,_CT)
end)()
`;
}

export function compileLuaSubset(source, options = {}) {
  if (typeof source !== "string") throw new Error("Source must be a string.");
  const byteLength = new TextEncoder().encode(source).byteLength;
  const maxBytes = 50 * 1024 * 1024;
  if (byteLength > maxBytes) {
    throw new Error(`Input too large (limit 50MB, got ${(byteLength / (1024 * 1024)).toFixed(2)}MB).`);
  }
  const seed = Number.isInteger(options.seed) ? options.seed : ((Math.random() * 0x7fffffff) | 0);
  const rng = mulberry32(seed);
  const ast = new Parser(lex(source)).parse();
  return emitLua(compileAst(ast, rng));
}
