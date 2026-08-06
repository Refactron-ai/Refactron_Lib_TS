# Deploying the Mintlify docs site

The Refactron docs site at `docs/` is built and hosted by Mintlify. This document
describes the **manual deploy** procedure for the launch.

## Why manual (and not a GitHub Action)?

Mintlify offers a GitHub-app integration that auto-deploys on push to `main`.
That is the long-term path. For the v0.2 launch we are deferring the GH Action
because:

- Auto-deploy from `main` would re-render the live docs every time we land an
  unrelated PR (CI burn, build queue noise).
- The Mintlify GH App requires a one-time install + admin approval on the
  `Refactron-ai` org, which is a separate ticket.
- Manual `npx mintlify deploy` is a single command run from `docs/`. Safer
  for the launch window where we want a human-in-the-loop on the staging→live
  flip.

We will revisit the auto-deploy path post-launch (track in a separate issue).

## Prerequisites

- Node.js 18+ (matches the Refactron CLI requirement).
- `mintlify` CLI invoked via `npx` — no global install needed.
- A Mintlify account with admin access on the `refactron` project.

Run this once on your laptop:

```bash
npx mintlify@latest --version    # caches the CLI
npx mintlify@latest login        # opens a browser; pick the refactron project
```

## Local preview

Always preview before deploying. From the repo root:

```bash
cd docs
npx mintlify@latest dev
# → http://localhost:3000
```

This serves the site exactly as it will render in production. Click through
every page added or modified in your branch. Specifically check:

- `concepts/safety-model` renders the mermaid 3-gate diagram.
- `transforms/index` cards link correctly to the per-transform pages.
- `cli/reference` tables render and CodeGroup tabs switch.
- All anchor links inside `faq.mdx` and `concepts/why-no-llm.mdx` point
  somewhere real.

## Deploy

Once the local preview looks right and your branch is merged to `main`:

```bash
cd docs
npx mintlify@latest deploy
```

Mintlify will:

1. Validate `mint.json` against its schema.
2. Build the site.
3. Push to the live `refactron` project at https://docs.refactron.dev (or
   whatever custom domain is configured in the Mintlify dashboard).

Deploy typically takes 30-60 seconds. The CLI prints the live URL on
success.

## Smoke check after deploy

Open the live URL and click through:

- Homepage / Introduction loads.
- The new nav groups are present: Concepts → Safety Model, Transforms,
  Configuration → .refactronrc.json, FAQ.
- Mermaid diagram on Safety Model renders (not raw markdown).
- One transform page (e.g. `transforms/var-to-const-let`) renders with the
  CodeGroup before/after intact.

## Rollback

If a deploy goes wrong, the Mintlify dashboard exposes a one-click rollback
to the previous build. Use it; do not hot-patch via another deploy unless
you've previewed locally.

## Future work

- Install the Mintlify GitHub App on `Refactron-ai/refactron` and switch
  to auto-deploy on `main`. Open as a separate issue post-launch so the
  configuration change can be reviewed independently.
- Add a docs-only PR check that runs `npx mintlify@latest broken-links` against
  changed pages.
