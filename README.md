# Hackathon — Parallel Tracks Monorepo

Three teammates ship independent codebases in parallel. We merge the best of each into one product via PRs into `main`.

**Primary track:** [`apps/atlas`](apps/atlas) — ATLAS CAPITAL (agent-run hedge fund demo). Final merge will likely keep Atlas as the base and absorb ideas/UI/infra from tracks B and C.

## Repo layout

```
/
  README.md                 # you are here
  CONTRIBUTING.md           # branch + PR workflow
  apps/
    atlas         Existing Atlas track (unchanged)
    teammate-b    Teammate B track
    chain-alpha   ChainAlpha track
  packages/
    shared/                 # optional shared types/utils (later)
```

> Note: the former `apps/teammate-c` track has been removed/replaced by `apps/chain-alpha` (**ChainAlpha — supply-chain world model and trading simulation**).

## Clone

```bash
git clone https://github.com/porterheigis/Hackathon.git
cd Hackathon
```

## Where each teammate works

| Track | Directory | Branch prefix | Notes |
| --- | --- | --- | --- |
| A — Atlas | `apps/atlas/` | `atlas/*` or `feat/atlas/...` | Existing product; run from this folder |
| B | `apps/teammate-b/` | `teammate-b/*` or `feat/<name>/...` | Scaffold your own stack here |
| ChainAlpha | `apps/chain-alpha/` | `chain-alpha/*` or `feat/<name>/...` | ChainAlpha — supply-chain world model and trading simulation |

Each app should be **independently buildable** (own `package.json` / lockfile / README). Do not break another track’s install to ship yours.

### Run Atlas (Track A)

```bash
cd apps/atlas
npm install
npm run dev
```

Open [http://localhost:3000?replay=1](http://localhost:3000?replay=1). See [`apps/atlas/README.md`](apps/atlas/README.md).

## How we open PRs

1. Branch from latest `main`.
2. Work only under your `apps/<track>/` (plus `packages/shared` if coordinating).
3. Open a PR into `main` with a short summary and how to run your app.
4. Prefer small, reviewable PRs over huge dumps.

Details: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Final merge (one best product)

After demos / review:

1. Keep **`apps/atlas`** as the primary product shell unless the team explicitly chooses otherwise.
2. Cherry-pick or PR the winning pieces from B/C (UI, adapters, infra, copy) into Atlas or into `packages/shared`.
3. Deprecate or archive unused track folders once absorbed.
4. Ship from `main` with one clear run path (documented in root + Atlas README).

## Collaborators

Repo owner: [porterheigis](https://github.com/porterheigis). Teammates need **write** access (or fork + PR). Ask the owner to invite you under repo **Settings → Collaborators**.

## Secrets

Never commit `.env` or credentials. Use `.env.example` per app. Root and app `.gitignore` already exclude env files.
