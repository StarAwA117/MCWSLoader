# Development

## Requirements

- Node.js **22+**
- npm (the repo ships `package-lock.json`)

## Commands

```bash
npm install          # backend dependencies
npm run typecheck    # tsc --noEmit (strict)
npm test             # node:test via tsx
npm start            # tsx main.ts
```

Frontend:

```bash
cd web/frontend
npm install
npm run typecheck    # vue-tsc --noEmit
npm run build        # vue-tsc + vite build -> dist/
```

CI runs both jobs on pushes to `main` / `dev/**` / `feat/**` and on PRs to
`main` (`.github/workflows/ci.yml`).

## Repository layout

```
main.ts              bootstrap: dependency check, config init, start ws.ts
ws.ts                WebSocket server, connection approval, shutdown
lib/
  mods.ts            Mod registry, managers, command dispatcher
  command.ts         command framework and parameter parsers
  utils.ts           Bedrock WebSocket helpers (commands, events, tell)
  sapi.ts            SAPI message bridge
  logger.ts          rotating file/console logger
  permission.ts      permission.json (owner/op/user/blocker)
  ...

web/
  server.ts          HTTP API + static WebUI
  frontend/          Vue 3 + TypeScript (Vite)
mod/                 bundled Mods (plain JS, hot-loaded)
mobile/flutter/      Flutter WebView shell (Android / Windows)
types/               shared TypeScript types (config, client, ModContext)
test/                node:test suite
wiki/                source for the GitHub Wiki
```

## TypeScript and Mods

The core is strict TypeScript. Bundled Mods remain plain JavaScript so they can
be imported at runtime without a build step. For editor support, use the global
`ModContext` type:

```js
/** @this {ModContext} */
export default class MyMod {
	onCommand() {
		return { normal: [this.Command.create("x", "demo").setFunc(() => {})] };
	}
}
```

## Wiki sync

Wiki pages live in `wiki/` in this repository and are published to the GitHub
Wiki with:

```bash
bash scripts/publish-wiki.sh
```

GitHub creates the wiki git repository only after the first page exists, so the
first time you may need to create a placeholder page at
<https://github.com/StarAwA117/MCWSLoader/wiki/_new>, then re-run the script.
