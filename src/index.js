import { compileLuaSubset, compileLuaVm } from "./compiler.js";

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_REQUEST_BYTES = 55 * 1024 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "LuaMoon", engine: "LuaMoon compatibility transformer plus experimental bytecode VM mode" });
    }

    if (url.pathname === "/api/obfuscate") {
      if (request.method !== "POST") {
        return json({ error: "Use POST for this endpoint." }, 405);
      }

      const contentType = request.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        return json({ error: "Content-Type must be application/json." }, 415);
      }

      const declaredLength = Number(request.headers.get("content-length") || 0);
      if (declaredLength > MAX_REQUEST_BYTES) {
        return json({ error: "Request too large. Maximum request size is 55 MiB." }, 413);
      }

      let data;
      try {
        const raw = await request.text();
        if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
          return json({ error: "Request too large. Maximum request size is 55 MiB." }, 413);
        }
        data = JSON.parse(raw || "{}");
      } catch {
        return json({ error: "Invalid JSON request." }, 400);
      }

      if (typeof data.source !== "string" || !data.source.trim()) {
        return json({ error: "Enter source code first." }, 400);
      }
      if (data.language !== undefined && !["lua", "luau"].includes(data.language)) {
        return json({ error: "Language must be either lua or luau." }, 400);
      }

      const sourceBytes = new TextEncoder().encode(data.source).byteLength;
      if (sourceBytes > MAX_SOURCE_BYTES) {
        return json({ error: "Source limit is 50 MiB." }, 413);
      }

      try {
        const language = data.language === "luau" ? "luau" : "lua";
        const mode = data.mode === "vm" ? "vm" : "compatibility";
        const output = mode === "vm"
          ? compileLuaVm(data.source, { language })
          : compileLuaSubset(data.source, { language, renameLocals: true });
        return json({
          output,
          language,
          mode,
          note: mode === "vm"
            ? "Experimental bytecode VM mode: source is parsed into a limited AST, compiled to encoded VM instructions, and executed by an embedded interpreter. It supports only a subset of Lua/Luau; validate with the exact target runtime."
            : language === "luau"
              ? "Compatibility mode preserves broad Luau source syntax and applies token-aware string encoding/comment removal plus conservative local renaming. This is not VM virtualization."
              : "Compatibility mode preserves broad Lua source syntax and applies token-aware string encoding/comment removal plus conservative local renaming. This is not VM virtualization."
        });
      } catch (error) {
        return json({ error: error?.message || "Compilation failed." }, 400);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
