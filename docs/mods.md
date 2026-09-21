# Mods

MCWSLoader loads Mods from the `mod/` directory. A Mod is a folder containing a
`manifest.json`; it may run on the server side, the client side, or both.

- [Directory layout](#directory-layout)
- [manifest.json](#manifestjson)
- [Dependencies](#dependencies)
- [mods_config.json](#mods_configjson)
- [Per-Mod config](#per-mod-config)
- [Installing Mods](#installing-mods)
- [Import / overwrite / rollback](#import--overwrite--rollback)
- [Deleting Mods](#deleting-mods)

---

## Directory layout

```
mod/
└── MyMod/
    ├── manifest.json         # required
    ├── main.js               # entry script (name is defined by manifest.entry)
    ├── config.example.json   # optional, copied to config.json on first scan
    ├── config.json           # optional, per-Mod settings
    └── README.md             # optional, shown in the WebUI
mod/mods_config.json          # enable/disable state for every Mod
```

Only folders containing a `manifest.json` are treated as Mods. A `manifest.json`
that fails to parse is skipped with an error in the log.

---

## manifest.json

```json
{
  "name": "MyMod",
  "description": "What this Mod does",
  "version": "1.0.0",
  "author": "YourName",
  "uuid": "optional-stable-id",
  "entry": {
    "server": null,
    "client": "main.js"
  },
  "dependencies": []
}
```

| Field | Required | Description |
|-------|:--------:|-------------|
| `name` | ✅ | Display name. Also used as the identity for import conflicts. |
| `description` | — | Shown on the Mod card and in the manifest dialog. |
| `version` | — | Defaults to `0.0.0`. |
| `author` | — | Shown in the manifest dialog. |
| `uuid` | — | Stable identity used as the key in `mods_config.json`. Falls back to the folder name. |
| `entry.server` | — | Server-side entry file, relative to the Mod folder (`null` = no server side). |
| `entry.client` | — | Client-side entry file, relative to the Mod folder (`null` = no client side). |
| `dependencies` | — | npm package names this Mod needs. See [Dependencies](#dependencies). |

A Mod with neither `entry.server` nor `entry.client` is valid but does nothing,
and does not appear in the WebUI list.

Bundled Mods that use npm packages declare them, for example:

| Mod | `dependencies` |
|-----|----------------|
| `ai` | `openai` |
| `fastbuilder` | `@pureeval/voxel-geometry` |
| `image` | `pngjs`, `jpeg-js` |
| `morews` | `ws` |
| `music` | `midi-file` |
| `qq` | `profanity-guard`, `sensitive-word-tool`, `node-napcat-ts` |

The entry file must `export default` a class; see [API Reference](./API.md) for
the Mod lifecycle and the injected APIs (`client`, `Command`, `eventBus`,
`storage`, `permission`, …).

---

## Dependencies

`dependencies` is a list of **npm package names** that the Mod needs — the same
idea as `package.json` dependencies, declared per Mod:

```json
{
  "dependencies": ["openai", "@pureeval/voxel-geometry", "pngjs"]
}
```

- Every entry must be a package name string. Other shapes (for example
  `{ "name": "x", "url": "…" }`) are rejected with `code: "DEPENDENCY_FAILED"`.
- Scoped names (`"@scope/pkg"`) are supported.
- A package that is already present in `node_modules/` is skipped entirely.
- A missing package is installed with `npm install <pkg> --no-save` in the project
  root. `--no-save` is deliberate: the Mod manifest is the source of truth, so the
  project's `package.json` is **not** rewritten.
- Invalid package names fail immediately, without contacting the registry.
- Dependencies are **not** resolved recursively (a Mod listed by a dependency is
  not followed).

Dependencies are checked in two places:

1. **On startup** — if `ws.checkDependenciesOnLoad` is `true` in `config.json`.
   Failures here are logged only; the Mod still loads.
2. **On import** — during `POST /api/mods/import`. Here a failing dependency is a
   hard error (`code: "DEPENDENCY_FAILED"`) and aborts the import (see below).

---

## mods_config.json

Stores the enable/disable state of every discovered Mod:

```json
[
  { "name": "MyMod", "enabled": true },
  { "name": "OtherMod", "enabled": false }
]
```

`name` is the Mod's `uuid` if present, otherwise its folder name. Newly
discovered Mods (including freshly imported ones) are registered as
`enabled: false`; enable them from the WebUI or the API.

---

## Per-Mod config

If a Mod folder contains `config.json` (or `config.example.json`, which is copied
to `config.json` on the first scan), the WebUI shows a settings button. The Mod
receives the merged result of the global `config.json` and its own `config.json`
as `this.config`.

Saving Mod settings from the WebUI writes `config.json` and updates the in-memory
registry so a subsequent reload picks up the new values.

---

## Installing Mods

The WebUI **Mods** tab has an import button (top right). It accepts `.wsmod` or
`.zip` archives whose `manifest.json` is either at the archive root, or inside a
single top-level folder:

```
MyMod.wsmod
├── manifest.json      ✅ supported
└── main.js

MyMod.zip
└── MyMod/
    ├── manifest.json  ✅ supported
    └── main.js
```

Archives without a `manifest.json` are rejected with `code: "INVALID_FORMAT"`.

You can also install manually: drop the folder into `mod/` and reload from the
WebUI (or restart). The Mod is registered on the next scan.

---

## Import / overwrite / rollback

`POST /api/mods/import` (see [API Reference](./API.md)) behaves as follows:

1. The archive is extracted to a temporary directory and its manifest is
   validated.
2. If a Mod with the **same `name`** already exists, the import stops and returns
   `409` with `code: "CONFLICT"` and `{ name, folder }`. The WebUI then asks
   whether to overwrite; confirming re-uploads with `?overwrite=1`.
3. Before overwriting, the existing Mod folder is **backed up**.
4. The archive is merged into the existing folder: files present in the archive
   are overwritten, **files that are not in the archive are kept**.
5. `dependencies` are installed.
6. On success the backup is deleted, the registry is rescanned, and all Mods are
   reloaded.

On failure the previous state is restored:

| Failure | Result |
|---------|--------|
| New install | The partially installed folder is removed and its `mods_config.json` entry is dropped. |
| Overwrite | The half-written folder is replaced by the backup — the previous version is **rolled back** and stays registered. |

Conflicts are matched by Mod **name**, not by folder path, so a Mod installed in
`mod/foo/` is correctly overwritten even when the archive uses a differently
cased top-level folder such as `Foo/`.

---

## Deleting Mods

The trash button on the left of each Mod card (or
`POST /api/mods/:name/delete`) unloads the running instances, deletes the Mod
folder recursively, and removes the entry from `mods_config.json`. Loaded server
and client instances are destroyed first, so no stale instances keep running.
