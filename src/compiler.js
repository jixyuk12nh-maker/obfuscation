const KEYWORDS = new Set(["local", "return", "if", "then", "else", "end", "while", "do", "true", "false", "nil", "and", "or", "not"]);

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
    if ("+-*/%^#=<>(),;".includes(c)) {
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
      if (["end", "else", "<eof>", ";"].includes(this.peek().value)) return { type: "return", value: null };
      return { type: "return", value: this.expression() };
    }
    if (this.is("if")) {
      this.take();
      const test = this.expression();
      this.expect("then");
      const yes = this.block(new Set(["else", "end"]));
      let no = [];
      if (this.is("else")) { this.take(); no = this.block(new Set(["end"])); }
      this.expect("end");
      return { type: "if", test, yes, no };
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
      const name = this.take().value;
      if (this.is("=")) {
        this.take();
        return { type: "assign", name, local: false, value: this.expression() };
      }
      if (this.is("(")) {
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
        return { type: "call", name, args };
      }
      throw new Error(`Only assignment or a simple named call is supported after '${name}'.`);
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
    if (t.value === "(") {
      this.take();
      const value = this.expression();
      this.expect(")");
      return value;
    }
    if (t.type === "number" || t.type === "string") {
      this.take();
      return { type: "constant", value: t.value };
    }
    if (t.value === "true" || t.value === "false" || t.value === "nil") {
      this.take();
      return { type: "constant", value: t.value === "nil" ? null : t.value === "true" };
    }
    if (t.type === "identifier") {
      this.take();
      return { type: "variable", name: t.value };
    }
    throw new Error(`Expected expression at character ${t.pos + 1}, got '${t.value}'.`);
  }
}

function compileAst(ast) {
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
  function expr(n) {
    switch (n.type) {
      case "constant": emit("PUSH", constant(n.value)); break;
      case "variable": emit("LOAD", constant(n.name)); break;
      case "unary": expr(n.value); emit(n.op === "-" ? "NEG" : n.op === "not" ? "NOT" : "LEN"); break;
      case "binary":
        expr(n.left); expr(n.right);
        emit(({"+":"ADD","-":"SUB","*":"MUL","/":"DIV","%":"MOD","^":"POW","..":"CONCAT","==":"EQ","~=":"NE","<":"LT","<=":"LE",">":"GT",">=":"GE","and":"AND","or":"OR"})[n.op]);
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
        for (const arg of s.args) expr(arg);
        emit("CALL", constant(s.name), s.args.length);
      } else if (s.type === "return") {
        if (s.value) expr(s.value); else emit("PUSH", constant(null));
        emit("RETURN");
      } else if (s.type === "if") {
        expr(s.test);
        const jf = emit("JMPF", 0);
        block(s.yes);
        const je = emit("JMP", 0);
        patch(jf, code.length + 1);
        block(s.no);
        patch(je, code.length + 1);
      } else if (s.type === "while") {
        const start = code.length + 1;
        expr(s.test);
        const jf = emit("JMPF", 0);
        block(s.body);
        emit("JMP", start);
        patch(jf, code.length + 1);
      }
    }
  }
  block(ast);
  emit("PUSH", constant(null));
  emit("RETURN");
  return { code, constants };
}

function luaString(value) {
  let out = '"';
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 32 || code === 127) out += `\\${String(code).padStart(3, "0")}`;
    else out += ch;
  }
  return out + '"';
}

function luaValue(value) {
  if (value === null) return "nil";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot emit a non-finite number.");
    return String(value);
  }
  return luaString(String(value));
}

function emitLua(program) {
  const constants = `{${program.constants.map(luaValue).join(",")}}`;
  const code = `{${program.code.map(row => `{${row.map(v => typeof v === "string" ? `"${v}"` : v).join(",")}}`).join(",")}}`;
  return `-- This file was protected using Luamoon Obfuscator v1.0 [https://obfuscation.jixyuk12nh.workers.dev/]
return (function()
local C=${constants}
local B=${code}
local S={}
local V={}
local L={}
local LD={}
local pc=1
local function truth(v) return v~=nil and v~=false end
local function pop()
 local n=#S
 local v=S[n]
 S[n]=nil
 return v
end
local function run()
 while true do
  local I=B[pc]
  if not I then return nil end
  pc=pc+1
  local op,a,b=I[1],I[2],I[3]
  if op=="PUSH" then
   S[#S+1]=C[a]
  elseif op=="LOAD" then
   local name=C[a]
   if LD[name] then
    S[#S+1]=L[name]
   else
    local value=V[name]
    if value==nil then value=_G[name] end
    S[#S+1]=value
   end
  elseif op=="STORE" then
   local name=C[a]
   local value=pop()
   if b==1 then
    LD[name]=true
    L[name]=value
   else
    V[name]=value
   end
  elseif op=="NEG" then S[#S+1]=-(tonumber(pop()) or 0)
  elseif op=="NOT" then S[#S+1]=not truth(pop())
  elseif op=="LEN" then local value=pop() S[#S+1]=#value
  elseif op=="ADD" then local y,x=pop(),pop() S[#S+1]=x+y
  elseif op=="SUB" then local y,x=pop(),pop() S[#S+1]=x-y
  elseif op=="MUL" then local y,x=pop(),pop() S[#S+1]=x*y
  elseif op=="DIV" then local y,x=pop(),pop() S[#S+1]=x/y
  elseif op=="MOD" then local y,x=pop(),pop() S[#S+1]=x%y
  elseif op=="POW" then local y,x=pop(),pop() S[#S+1]=x^y
  elseif op=="CONCAT" then local y,x=pop(),pop() S[#S+1]=tostring(x)..tostring(y)
  elseif op=="EQ" then local y,x=pop(),pop() S[#S+1]=x==y
  elseif op=="NE" then local y,x=pop(),pop() S[#S+1]=x~=y
  elseif op=="LT" then local y,x=pop(),pop() S[#S+1]=x<y
  elseif op=="LE" then local y,x=pop(),pop() S[#S+1]=x<=y
  elseif op=="GT" then local y,x=pop(),pop() S[#S+1]=x>y
  elseif op=="GE" then local y,x=pop(),pop() S[#S+1]=x>=y
  elseif op=="AND" then
   local y,x=pop(),pop()
   if truth(x) then S[#S+1]=y else S[#S+1]=x end
  elseif op=="OR" then
   local y,x=pop(),pop()
   if truth(x) then S[#S+1]=x else S[#S+1]=y end
  elseif op=="CALL" then
   local args={}
   for j=b,1,-1 do args[j]=pop() end
   local name=C[a]
   local f=V[name]
   if type(f)~="function" then f=_G[name] end
   if type(f)~="function" then error("LuaMoon VM: function not found: "..tostring(name),0) end
   f((table.unpack or unpack)(args))
  elseif op=="JMP" then pc=a
  elseif op=="JMPF" then if not truth(pop()) then pc=a end
  elseif op=="RETURN" then return pop()
  else error("LuaMoon VM: invalid opcode "..tostring(op),0) end
 end
end
return run()
end)()
`;

}

export function compileLuaSubset(source) {
  if (source.length > 1_000_000) throw new Error("Input too large (limit 1 MB).");
  const ast = new Parser(lex(source)).parse();
  const program = compileAst(ast);
  return emitLua(program);
}
