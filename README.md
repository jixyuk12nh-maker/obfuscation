# LuaMoon — GitHub + Cloudflare Worker

This repository is a deployable starter for the LuaMoon web UI and API. Connect the repository to Cloudflare Workers Builds, or deploy with Wrangler. A push to the connected Git branch can trigger a new deployment.

## Important scope and limitations

- This is an original, small Lua-subset-to-custom-VM prototype, **not** a Luraph source-code recovery or clone.
- It does **not** support all Lua 5.1 or Luau syntax. Unsupported syntax should return an error instead of being silently accepted.
- The current compiler does not implement functions/closures, tables, indexing, method calls, numeric/generic `for`, repeat/until, varargs, Luau type syntax, and many standard-language edge cases.
- Obfuscation is not encryption and does not guarantee that source code cannot be recovered.
- The output must be tested in the exact Lua/Luau runtime where it will run. The generated wrapper uses Lua features such as `table.unpack or unpack`, and runtime globals can differ between environments.
- The web API accepts source files up to 50 MiB, but the parser and compiler are synchronous and large inputs can consume substantial CPU and memory. Consider lowering this limit before public launch and add rate limiting.

## Deploy from Android / GitHub

1. Create a GitHub repository named `luamoon` (private or public).
2. Upload **all files and folders** from this project, preserving paths: `src/`, `public/`, `test/`, `package.json`, and `wrangler.jsonc`.
3. In Cloudflare, open **Workers & Pages** and create a Worker using Git integration / connect the GitHub repository.
4. Configure the build command as `npm install` if requested. The deployment command is `npm run deploy` for a CLI deployment; for Git-connected builds, follow the current Cloudflare Workers Builds prompts and use the configured build/deploy settings shown by the dashboard.
5. For the simplest mobile workflow, use Cloudflare's Git integration so pushing changes to the connected branch deploys them automatically.

Official docs: https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/

## Deploy from Termux (alternative)

Requires Node.js 20+ and a Cloudflare account. From the repository root:

```sh
npm install
npm test
npx wrangler login
npm run deploy
```

## Local development

```sh
npm install
npm run dev
```

Wrangler prints a local URL. Open it in your phone browser.

## API

- `GET /api/health` — health check.
- `POST /api/obfuscate` — JSON body: `{"source":"local x = 1\\nprint(x)"}`.

## Project layout

- `src/index.js` — Cloudflare Worker routes and static asset fallback.
- `src/compiler.js` — lexer, parser, bytecode generator, and Lua VM emitter.
- `public/` — website UI.
- `test/` — basic compiler tests.
- `wrangler.jsonc` — Workers Static Assets configuration.

## Before public launch

Add rate limiting, abuse monitoring, and a clear privacy policy. Do not log submitted source code. If the site will be used by others, test the API with real traffic and the generated output in every intended runtime. Do not put private tokens or secrets in the GitHub repository.
