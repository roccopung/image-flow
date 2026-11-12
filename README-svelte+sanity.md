# Canvas Editor: Sanity Studio tool + public viewer

Custom application for an artist: he places ~600 images (videos possible but rare) on a canvas with fixed, editable dimensions. The public sees a zoomed version of the same canvas and navigates it like a joystick.

This README is the brief for implementation with Claude Code. Sections marked **OPEN** are decisions not taken yet: ask before implementing them.

---

## Working mode

- Before any non-trivial implementation, ask me how I'd approach it and why, then check my proposal. Don't jump straight to the solution.
- When a reusable pattern or concept comes up, name it with its canonical term and one line of context.
- Flag prominently anything that can lose data (document overwrites, asset deletions, migrations).
- Before relying on a Sanity API, hook or config option, check the official docs (sanity.io/docs). Don't rely on memory: the APIs change between versions.

---

## Architecture

| Part | What | Where |
|---|---|---|
| Studio | Sanity Studio with a custom **canvas tool**, `sanity-plugin-media` and the default structure tool | Sanity hosting (`sanity deploy`) |
| Content | Sanity Content Lake, **Free plan** | Sanity |
| Assets | Sanity assets + image pipeline (CDN) | Sanity |
| Viewer | Public frontend, read-only | Hetzner / Coolify |

### Studio
- Tools, in order: **canvas tool first** (the artist must land there), then the media plugin, then structure (my fallback for debugging and manual fixes).
- The canvas tool must be as essential as the prototype the artist approved: minimal UI, no visual overload. Sanity UI is not used inside the canvas.
- **The canvas is written in Svelte** (see the next section), reusing the existing Svelte prototype.

### Canvas tool: Svelte inside a React wrapper

The Studio requires a tool's `component` to be a React component. The tool is therefore a **thin React wrapper** that mounts a **Svelte 5 app** (the "imperative island" pattern: React owns the mount point, Svelte owns everything inside it).

Why: the Svelte prototype is already approved by the artist, and Svelte's fine-grained reactivity (no virtual DOM diffing) suits direct manipulation of ~600 elements better than idiomatic React.

How:
- The React wrapper renders a `<div ref>`. In `useEffect` it calls Svelte's `mount(Canvas, { target, props })`; in the cleanup it calls `unmount(app)`.
- The Svelte Vite plugin is added by extending the Vite config exposed in `sanity.cli.ts`.
- **Do not write the canvas in React.** React code is limited to the wrapper and the Sanity bridge.

Responsibilities (proposal, to be validated):

| React wrapper | Svelte app |
|---|---|
| Reads Studio hooks (client, current user, document operations) | All canvas UI: grid, elements, drag, Alt distances, sidebar |
| Exposes a bridge as plain props: `loadCanvas()`, `listAssets()`, `save(patch)`, `publish()` | Local state for everything transient (drag position, hover, selection) |
| Subscribes to remote changes and pushes them into Svelte (**OPEN:** via props or an exported method) | Decides **when** to save (on drop / resize end / debounced), never on mousemove |
| Nothing visual | Never imports from `sanity` or `@sanity/*` |

⚠️ **Risk check first:** before porting anything, verify that a minimal Svelte component compiles and mounts inside the Studio, both in `sanity dev` and in a `sanity build` + `sanity deploy`. If it fails, stop and discuss (fallback: React with refs for drag, or vanilla JS core).

### Viewer
- Shows a zoomed version of the canvas. Navigation with 9 directions like a joystick (**OPEN:** 8 directions + center/stop? confirm with the artist).
- Reads **only published content**, via the API CDN (`useCdn: true`).
- Updates on every publish (**OPEN:** reload on demand, polling, or Live Content API; watch the free plan's 1k live connections limit).
- **OPEN:** frontend framework.

---

## Data model (proposal, to be validated)

One singleton document `canvas`:

```
canvas
  title: string
  width: number        // canvas units (px of the canvas, not of the screen)
  height: number
  items: array of canvasItem

canvasItem
  _key: string         // Sanity array key, stable ID of the item
  image: image         // reference to sanity.imageAsset
  x: number            // canvas units, top-left corner of the element
  y: number
  w: number            // stored from the start, even if scaling comes later
  h: number
  // z-order = order in the array (OPEN: or an explicit z field)
```

Rules:
- **All coordinates are in canvas units**, never screen pixels. Editor and viewer each convert to their own zoom level. This is what guarantees the viewer reproduces the exact position.
- The same asset can appear several times on the canvas: each placement is a separate `canvasItem` with its own `_key`.
- At placement time, `w/h` are taken from the asset's native dimensions (`metadata.dimensions`) (**OPEN:** native size or scaled to a max).
- **OPEN:** "attach" between elements. Options: reference between items, or a group with its own coordinates. To be decided before Phase 3.
- **OPEN:** behaviour when the canvas is shrunk and elements end up outside (top-left anchoring + warning? clip?).

---

## Features

### Phase 1: core
1. **Canvas** with `width/height` editable at any time from the tool.
2. **Asset sidebar** grouped by "folder", with text search on filename.
3. **Drag and drop** from sidebar to canvas: the element is created exactly at the drop point (converted to canvas units) and added to `items`.
4. **Free repositioning** of existing elements with drag.
5. **Delete** an element from the canvas (removes the item, never the asset).
6. **Publish**: the tool edits the draft; a publish button makes the state live. Use the Studio's document operations (check in the docs the right hook for publishing from a custom tool).

### Phase 2: placement aids
7. **Dynamic square grid** in the background, adapting to zoom.
8. **Distances Figma-style**: with Alt held and pointer over an element, show distances from the selected element (or from the canvas edges).
9. **Snapping** to edges/centres of other elements (to be confirmed).

### Phase 3: later
10. **Attach** elements to each other (see OPEN in the data model).
11. **Scaling** elements Figma-style (updates `w/h`).

---

## Assets and cataloguing

- Upload in bulk through `sanity-plugin-media` (or drag from desktop onto the canvas: **OPEN**, Phase 1 or later).
- **"Folders" = filename prefix.** Sanity has no folders and the plugin only has tags. Convention: `group__name.jpg` (e.g. `series-a__001.jpg`); the sidebar groups by the prefix before `__`. The artist renames locally in bulk.
- ⚠️ **The name is captured at upload.** Renaming locally after upload changes nothing in Sanity, and re-uploading the same file returns the existing asset (assets are identified by a hash of their content). Renaming must happen **before** upload. **OPEN:** an editable field on the asset (e.g. `title`) as fallback, with the sidebar grouping by that when present.
- **Duplicates:** exact duplicates are already handled by Sanity (same content = same asset). Near-duplicate detection (perceptual hash) is **out of scope** for now.

---

## Constraints (Sanity Free plan)

Verified on sanity.io/pricing on 2026-11-11. Re-check before relying on them.

| Limit | Value | Implication |
|---|---|---|
| API requests | 250k / month | **Never write on mousemove.** Drag state is local in React; write only on drop, on resize end, or debounced. Batch multiple changes into one transaction where possible. |
| API CDN requests | 1M / month | The viewer uses only the CDN. |
| Bandwidth | 100GB / month | The free plan **blocks requests** when a limit is hit, it doesn't bill. Viewer: serve images via the image pipeline at the size needed for the zoom level (`?w=`, `auto=format`), lazy load by viewport. |
| Assets | 100GB | Fine for ~600 images. |
| Documents | 10k | Fine. |
| Datasets | 2, public only | Published content and assets are public. Drafts are not readable without a token. |
| Roles | Administrator, Viewer | The artist will be an Administrator. |
| Live connections | 1k per dataset | Relevant only if the viewer uses the Live Content API. |

---

## Performance

- Editor: 600 elements on the canvas. Render thumbnails from the image pipeline at the size needed for the current zoom, not originals.
- Viewer: load only what's in or near the viewport. Videos (if any) play only when visible.
- **OPEN:** rendering approach inside the Svelte app (DOM + CSS transforms, as in the prototype, vs `<canvas>`). Start from what the prototype does.

---

## Suggested order

1. Studio setup: project, dataset, `sanity-plugin-media`, `canvas` schema, empty tool registered first.
2. **Svelte spike:** React wrapper mounting a "hello" Svelte component; verify in dev, build and deploy.
3. React ↔ Svelte bridge (`loadCanvas`, `listAssets`, `save`, `publish`).
4. Port the prototype; asset sidebar (GROQ query on `sanity.imageAsset`, grouping by prefix).
5. Canvas with dimensions + drop + drag + save on drop.
6. Publish.
7. Minimal viewer on Hetzner that reproduces positions 1:1, then zoom + joystick navigation.
8. Phase 2.
