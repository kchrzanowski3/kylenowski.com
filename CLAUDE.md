# Working in this repo

- **Everything is IaC.** GCP resources and Cloudflare DNS live in `infra/` (Terraform); hosting config in
  `firebase.json`; Firestore rules in `firestore.rules`. Don't change GCP or Cloudflare by hand or with ad-hoc
  write calls.
- **Cloudflare is DNS only.** All records are `proxied = false`. Everything else (hosting, data, compute) goes
  on GCP project `kylenowski-com` (region `us-central1`).
- **PRs are the deploy path.** Branch, open a PR against `main`, let CI plan + preview, merge to apply.
  Never push directly to `main`.
- **Debug access is read-only:**
  - Cloudflare: a read-only token is injected by the session's network proxy for `api.cloudflare.com`.
  - GCP: dispatch the `inspect-gcp` workflow (runs as `ci-reader`) and read its logs with `gh run view --log`.
  Fixes still go through a PR.
- **Site:** Astro, fully static (`dist/`), with React islands for interactive parts. Astro's CSP is on
  (`astro.config.mjs`), so `<ClientRouter />` can't be used; page transitions use native CSS view
  transitions. Add the hosts a page calls to the CSP `directives`.
- **Tests come with changes.** Any change to scoring, stat derivation, Firestore rules or auth includes tests
  in the same PR. Every rule in a spec (`docs/*-spec.md`) has a matching test, and a spec change means a test
  change. Fix a bug by first adding a test that reproduces it. Don't weaken or delete a test to make CI pass
  unless the spec changed. Run the test suite before committing.
- Run `terraform fmt -recursive` in `infra/`, `npm run build` and `npm test` before committing; CI fails otherwise.
