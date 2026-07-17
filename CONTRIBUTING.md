# Contributing

## Default branch

`main` is the integration branch. Protect it mentally: land work via pull requests.

## Branch naming

Use one of:

- Track-prefixed: `atlas/<short-desc>`, `teammate-b/<short-desc>`, `teammate-c/<short-desc>`
- Feature form: `feat/<name>/<short-desc>` (e.g. `feat/atlas/globe-arcs`)

Examples:

```bash
git checkout main
git pull origin main
git checkout -b atlas/risk-banner-copy
# or
git checkout -b feat/teammate-b/landing-prototype
```

## Workflow

1. **Sync** — `git pull origin main` before starting.
2. **Scope** — Change files under your track (`apps/atlas`, `apps/teammate-b`, or `apps/teammate-c`). Coordinate before editing `packages/shared`.
3. **Commit** — Clear messages; no secrets (`.env`, keys, tokens).
4. **Push** — `git push -u origin HEAD`
5. **PR** — Open against `main`. Include:
   - What you built
   - How to run it (`cd apps/... && …`)
   - Screenshots / demo notes if UI
6. **Review** — Address feedback; squash/rebase only if the author agrees (no force-push to `main`).

## Independence rule

Each app must install and run on its own. Do not require a sibling app’s `node_modules` or hard-code paths into another teammate’s tree.

## Merging tracks later

When picking a “winning” product:

- Prefer PRs that **move** reusable pieces into `apps/atlas` or `packages/shared` over deleting whole tracks blindly.
- Document any path/script changes in the root README and the surviving app README.
- After absorption, leave a short note in the retired track’s README pointing to the new location.

## What not to do

- Do not force-push `main`.
- Do not commit `node_modules`, `.next`, or `.env`.
- Do not rewrite another teammate’s app without a coordinated PR.
