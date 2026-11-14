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
  update.ts          GitHub release checks and SemVer comparison
  ...

web/
  server.ts          HTTP API + static WebUI
  frontend/          Vue 3 + TypeScript (Vite)
mods/                 bundled Mods (TypeScript, hot-loaded via tsx)
flutter/             Flutter WebView shell (Android / Windows)
lib/types/           shared TypeScript types (config, client, ModContext)
lib/__tests__/       node:test suite
wiki/                source for the GitHub Wiki
```

## TypeScript and Mods

The core is strict TypeScript. Bundled Mods are TypeScript as well; `tsx`
strips types at load time, so they still hot-reload without a build step. Mods
extend `lib/modbase.ts` to get typed injected dependencies:

```ts
import ModBase from "../../lib/modbase.js";

export default class MyMod extends ModBase {
	constructor(client) {
		super();
		this.client = client;
	}

	onCommand() {
		return { normal: [this.Command.create("x", "demo").setFunc(() => {})] };
	}
}
```

## WebUI themes

Themes are registered in `web/frontend/src/theme.ts`. To add one:

1. Add a `new Theme(id, labelKey, swatch)` entry.
2. Add a `:root[data-theme="<id>"]` palette block in
   `web/frontend/src/assets/main.css`.
3. Optionally define `--accent-*` and `--tag-*` variables for extra accents.
   Components already fall back to the Star palette when these are absent.

The backend accepts any safe theme id, so new palette-only themes need no
server changes. The active theme is applied only after **Save**.

## WebUI dialogs

Do not use browser-native `alert` / `confirm` / `prompt`. All prompts go through
the themed `useModal()` helper:

| Helper | Result |
|--------|--------|
| `notify(message, title?)` | Informational message |
| `ask(message, title?)` | `boolean` |
| `input(message, defaultValue?, title?)` | `string` |
| `choose(choices, title?, message?)` | Selected value from a dropdown |

`npm run check:dialogs` (also run in CI) rejects native dialog calls.

## Wiki sync

Wiki pages live in `wiki/` in this repository and are published to the GitHub
Wiki with:

```bash
bash scripts/publish-wiki.sh
```

GitHub creates the wiki git repository only after the first page exists, so the
first time you may need to create a placeholder page at
<https://github.com/StarAwA117/MCWSLoader/wiki/_new>, then re-run the script.
