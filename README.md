# CountryMaxxing

A geography trivia game covering all 197 commonly-quizzed countries, capitals,
and borders. No backend — everything runs client-side, with progress tracked
in `localStorage`.

Four modes, picked from the setup screen:

- **One Stop** — country ↔ capital, one at a time
- **Manifest** — name every country (or capital) in your selected regions
- **Terra Incognita** — identify the highlighted country on the map
- **Frontiers** — name a country's neighbors, work backward from a set of
  neighbors, or compare border lengths

## Developing

```
npm install
npm run dev              # dev server
npx tsc -b --noEmit       # typecheck
npx oxlint                # lint
npm run build             # production build
```

Requires Node `^20.19.0 || >=22.12.0` (pinned via `.nvmrc`) — rolldown-vite's
native binding fails to resolve outside that range.

## Deploying

Pushing to `main` builds and deploys to GitHub Pages automatically via
`.github/workflows/deploy.yml`.
