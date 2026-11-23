# kylenowski.com

Personal site. Everything is code:

| Piece | Where | Path |
|---|---|---|
| Site | [Astro](https://astro.build) (static) + React for interactive parts | `src/`, `public/`, `astro.config.mjs` |
| Hosting | Firebase Hosting (GCP project `kylenowski-com`) | `firebase.json` |
| Data | Firestore (`us-central1`); security rules | `firestore.rules` |
| DNS | Cloudflare, **DNS only** (nothing proxied) | `infra/dns.tf` |
| GCP resources | Terraform (state in `gs://kylenowski-com-tfstate`) | `infra/` |
| Pipeline | GitHub Actions | `.github/workflows/deploy.yml` |
| Thanksgiving picks | Page + React app; Cloud Functions for sign-in and the pre-game refresh. Spec: `docs/thanksgiving-spec.md` | `src/pages/thanksgiving.astro`, `src/components/thanksgiving/`, `src/lib/thanksgiving/`, `functions/`, `infra/thanksgiving.tf` |
| One-time GCP setup | Already run; safe to re-run | `scripts/bootstrap-gcp.sh` |

## How changes ship
1. Open a PR against `main`. CI:
   - builds the site (`astro check` + `astro build`)
   - runs `terraform plan` as the **read-only** `ci-reader` account. The plan is in the run's **Summary** tab.
   - deploys a **preview** to a Firebase Hosting channel (`pr-<number>`, expires after 7 days). The URL is in
     the Summary tab.
2. Merge. CI applies the plan as `ci-deployer` and deploys `dist/` to the live site.

Nothing in GCP or Cloudflare should be changed by hand.

### How CI logs in
- **GCP:** keyless, through Workload Identity Federation. Only this repo (matched by numeric ID) can use the
  identities, and only runs on `main` can use `ci-deployer`. PRs from forks get no GCP access.
- **Cloudflare:** the repo secret `CLOUDFLARE_API_TOKEN`. It's a Cloudflare API token with
  **Zone → Zone → Read** and **Zone → DNS → Edit**, limited to the kylenowski.com zone.

| Identity | Can do | Used by |
|---|---|---|
| `ci-deployer` | manage the project (Terraform apply, live deploys) | pushes to `main` |
| `ci-reader` | read everything, change nothing | PR plans, `inspect-gcp` workflow |
| `ci-preview` | deploy Firebase Hosting preview channels | PR previews (created by Terraform) |

### Debugging GCP
The `inspect-gcp` workflow (Actions tab → *inspect-gcp* → *Run workflow*) runs a read-only `gcloud` command
or a GET against a Google API as `ci-reader`, for example:
```sh
gh workflow run inspect-gcp -f kind=gcloud -f args="services list --enabled"
```

## Local development
```sh
npm install
npm run dev            # http://localhost:4321
npm run build          # type-check + static build to dist/
npm test               # unit tests, then the emulator tests (needs Java 21)
npm run test:e2e       # end-to-end in Chromium against the local emulators
```
The CSP that Astro generates only applies to `build` output. Use `npm run build && npm run preview` (or
`npx firebase-tools emulators:start --only hosting --project demo-kylenowski`) to test with it.

Terraform locally (optional; needs your own `gcloud auth application-default login` and a Cloudflare token):
```sh
cd infra && terraform init && terraform plan
```

## Notes
- **Security headers:** `firebase.json` sets HSTS and the other security headers. Astro adds a per-page
  Content-Security-Policy `<meta>` tag with hashes of its own scripts, configured in `astro.config.mjs`. When a
  page needs to talk to an outside service (e.g. Firestore), add it to `connect-src` there.
- **Email:** the domain publishes "sends no mail / accepts no mail" records (SPF `-all`, DMARC reject,
  null MX) to block spoofing. Replace them in `infra/dns.tf` if you set up email.
- **DNSSEC:** because the domain is registered with Cloudflare, Cloudflare adds the DS record at the registry
  for you.
- **Budget:** a $10/month budget alert is set on the billing account (from the bootstrap script).
