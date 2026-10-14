import { compileLuaSubset, compileLuaVm } from "./compiler.js";

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_REQUEST_BYTES = 55 * 1024 * 1024;

// Best-effort, single-isolate rate limit. Cloudflare reuses an isolate across
// many requests, so this meaningfully throttles a single abusive source even
// though it resets on cold start and isn't shared across edge locations. It
// is a backstop, not a substitute for a dashboard Rate Limiting rule or a
// Durable Object / KV-backed limiter if stronger guarantees are needed.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const rateBuckets = new Map();

function isRateLimited(key) {
  const now = Date.now();
  if (rateBuckets.size > 10_000) {
    for (const [k, bucket] of rateBuckets) {
      if (now - bucket.start > RATE_LIMIT_WINDOW_MS) rateBuckets.delete(k);
    }
  }
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count++;
  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

// Reads the body as UTF-8 text while bailing out as soon as more than
// maxBytes has arrived, instead of buffering an unbounded/declared-false
// body in full (request.text()) before the size is checked. The declared
// Content-Length header is advisory only -- a client can omit or lie about
// it -- so this is the actual enforcement point.
async function readBoundedText(request, maxBytes) {
  if (!request.body) return await request.text();
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        const error = new Error("Request too large.");
        error.tooLarge = true;
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released/cancelled */ }
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
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

      const clientKey = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
      if (isRateLimited(clientKey)) {
        return json({ error: "Too many requests. Please slow down and try again shortly." }, 429, { "Retry-After": "30" });
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
        const raw = await readBoundedText(request, MAX_REQUEST_BYTES);
        data = JSON.parse(raw || "{}");
      } catch (error) {
        if (error?.tooLarge) return json({ error: "Request too large. Maximum request size is 55 MiB." }, 413);
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
