# Arc Tip Jar — Vercel-ready standalone app

Cross-chain tip jar for creators on **Arc Testnet only**, using Circle
Gateway (USDC, Gateway domain 26). A donor signs a Gateway **burn intent**
(EIP-712) with their wallet; Circle mints the tip to the creator on Arc.
No manual bridging, no Arc gas for the donor.

This is a standalone Next.js (App Router, TypeScript) project. It mirrors
the verified Muse artifact behaviour, including the fixes landed there
(webhook token discoverability, fee warning, 15-minute expiry countdown,
PIN-guarded Test Lab cleanup, Arc → Arc intents). It does **not** touch
that artifact or its data.

## Hard limits

- **Arc Testnet only**: chain 5042002 (RPC https://rpc.testnet.arc.io,
  explorer https://explorer.testnet.arc.io, ChainList
  https://chainlist.org/chain/5042002), Gateway domain **26** for source
  AND destination. No Sepolia anywhere in the flow, no mainnet.
- **USDC only**, 6 decimals. All amounts are stored as integer base units,
  never floats.
- Contract addresses (Gateway Wallet, Minter) are read live from
  `GET https://gateway-api-testnet.circle.com/v1/info` at runtime.
- Webhooks with `env != testnet` are rejected.
- No private keys are created or stored anywhere in this project.

## Honest sourcing note: token addresses vs symbols

Live `GET /v1/info` publishes only token **symbols** (USDC / cirBTC /
EURC) per domain — it does **not** publish token addresses. That is why:

- The webhook validator expects the token **symbol** `"USDC"`, and the
  simulator UI states this explicitly (a contract address there fails with
  `TOKEN_MISMATCH` — the exact gap that failed three test donations in the
  earlier artifact test).
- The Arc Testnet USDC token address used inside burn intents
  (`0x3600000000000000000000000000000000000000`) is Circle's documented
  Arc USDC address (see
  https://developers.circle.com/stablecoins/usdc-contract-addresses.md),
  while the Gateway Wallet / Minter addresses come live from `/v1/info`.

## How it works

1. Creator sets up a profile (`/creator`): name, description, avatar,
   thank-you message, Arc Testnet recipient address, dashboard PIN.
2. Donor picks a preset (1 / 5 / 10 USDC) or a custom amount (0.01–1,000),
   sees a **live** Gateway fee estimate (`POST /v1/estimate`) before
   signing, and gets a warning when the fee is as large as the tip.
3. The server creates a donation (`awaiting_payment`, 15-minute expiry
   with a live countdown) and builds a burn intent: sourceDomain 26 →
   destinationDomain 26, recipient from the server creator DB (never the
   client), unique salt, maxFee from the estimate, maxBlockHeight from
   `/v1/info` + buffer.
4. The donor's wallet signs the EIP-712 intent (`GatewayWallet` v1) via
   `eth_signTypedData_v4`. The server recovers the signer and rejects a
   mismatched signature. Wrong network blocks signing; a wallet rejection
   leaves the donation untouched. A clearly-labelled simulated-signing
   fallback exists for browsers with no wallet.
5. **Only when `CIRCLE_API_KEY` is set** does the server submit
   `POST /v1/transfer?enableForwarder=true` and store the real
   `transferId`. Without a key the app says so honestly: the donation
   stays `processing` with a local `local-pending-…` id (never faked as a
   real transfer) until a webhook finalizes it.
6. `POST /api/webhooks/circle` finalizes donations. `mint.finalized` is
   validated (env=testnet, domain=26, token symbol `USDC`,
   `attestations[].to` = creator, exact amount) and is idempotent via
   `notificationId` + per-`transferId` dedupe. `deposit.finalized` means
   "balance ready" only — never a received tip. `mint.forwarded` is
   informational. Unknown `transferId` → orphan, nothing changes.
   `received` / `failed` are final. Mismatch failures are flagged
   "needs manual review".
7. Reconcile: donations in `processing` older than 60s are polled via
   `GET /v1/transfer/{id}` (needs a Circle API key); failed/expired
   transfers become `failed`. Gateway has no "failed" webhook.

## River AI (thank-you messages + copy polishing)

Thank-you messages and the "Polish my bio / thank-you message" buttons in
creator setup use **River** — not a built-in fallback:

- Endpoint: `POST https://api.river.ai/v1/chat/completions`
  (OpenAI-compatible), auth `Bearer RIVER_API_KEY`, temperature 0.7,
  max_tokens 800.
- Model: `RIVER_MODEL`, default `deepseek-ai/DeepSeek-V4.1-Flash`
  (verified live). Do **not** use `Qwen/Qwen3.5-9B` here: on this endpoint
  it spends its whole token budget on `reasoning_content` and returns
  empty content (verified twice, even at max_tokens 2500).
- Route: `POST /api/ai/thank-you` (`mode: "thank-you"` or `"polish"`).
- When `RIVER_API_KEY` is absent, the route falls back to saved defaults
  that River itself generated earlier (`lib/river-copy.json` — 5
  thank-you variants with `{amount}` / `{creator}` placeholders, 3
  tip-page subtitles, 1 dashboard empty-state sentence) and labels the
  response `source: "river-saved-default"` with a note saying live River
  is not configured. A live call is never faked.
- River usage bills the account owner's River account.

## Storage

Upstash Redis (`@upstash/redis`) is primary, configured from `KV_REST_API_URL` /
`KV_REST_API_TOKEN`. Without them the app falls back to ephemeral
in-memory storage and shows a **visible warning banner** — donations do
not survive a redeploy or cold start. It never silently loses data.

> Note: Vercel KV is now served through Upstash Redis (Vercel
> Marketplace → Redis). The same `KV_REST_API_URL` / `KV_REST_API_TOKEN`
> variables apply when you attach it.

## Environment variables

Copy `.env.example` to `.env.local` for local dev. In Vercel, set them
in the project dashboard (Settings → Environment Variables). Never commit
a real `.env.local`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DASHBOARD_PIN` | Yes | Dashboard PIN (takes precedence over the in-app PIN). |
| `KV_REST_API_URL` | Recommended | Upstash Redis REST URL. |
| `KV_REST_API_TOKEN` | Recommended | Upstash Redis REST token. |
| `CIRCLE_API_KEY` | Optional | Testnet Circle API key — only for real `POST /v1/transfer` submission. Without it, donations stay `processing` until a webhook finalizes them. |
| `CIRCLE_WEBHOOK_SIGNING_KEY` | Optional override | PEM EC public key to verify `X-Circle-Signature`. Normally not needed: with `CIRCLE_API_KEY` set, the app fetches Circle's public key itself (GET `/v2/notifications/publicKey/{keyId}`, cached). Without either, verification is skipped (development mode) and the webhook logs a warning. |
| `RIVER_API_KEY` | For live AI | River API key for live thank-you / polish calls. Without it, saved River defaults are used (labelled). |
| `RIVER_MODEL` | Optional | Default `deepseek-ai/DeepSeek-V4.1-Flash`. |

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in DASHBOARD_PIN at minimum
npm run dev                  # http://localhost:3000
npm test                     # unit tests (vitest)
npm run build                # production build
npm start                    # serve the production build
```

## Deploy manually on Vercel (step by step)

1. Push this folder to a Git repository (GitHub / GitLab / Bitbucket),
   or use `vercel` CLI from this directory.
2. In the Vercel dashboard: **Add New → Project → Import** the
   repository, and select this folder as the project root if it is not
   the repo root. Framework preset: **Next.js**. No build-command changes
   are needed (`npm run build`).
3. **Storage → Create → Upstash Redis** and attach it to the
   project. Vercel fills `KV_REST_API_URL` / `KV_REST_API_TOKEN`
   automatically.
4. **Settings → Environment Variables**: set `DASHBOARD_PIN` (required).
   Optionally set `CIRCLE_API_KEY` (testnet key, for real transfer
   submission and automatic webhook signature verification),
   `CIRCLE_WEBHOOK_SIGNING_KEY` (PEM public key — only as an override;
   normally the app fetches Circle's key itself), `RIVER_API_KEY` and
   `RIVER_MODEL` (for live AI copy).
5. **Deploy.** Open the deployment URL and check the home page loads.
6. **Custom domain** (optional): **Settings → Domains → Add** your
   domain and follow Vercel's DNS instructions.
7. **Circle webhook subscription**: in the Circle dashboard, subscribe
   to Gateway notifications with environment `TEST`, domains `["26"]`,
   addresses = your creator recipient address, notification types
   `gateway.deposit.finalized` and `gateway.mint.finalized`, pointing at:
   `https://<your-domain>/api/webhooks/circle`
   (You can also create the subscription via
   `POST api.circle.com/v2/notifications/subscriptions/permissionless`.)
8. Open `/creator`, fill in your profile (name, Arc Testnet recipient
   address, thank-you message, dashboard PIN), then open `/dashboard`
   with your PIN.

## Pre-publish checklist

- [ ] `DASHBOARD_PIN` is set (env var or in-app setup).
- [ ] Upstash Redis is attached (no "ephemeral storage" warning banner).
- [ ] Creator profile is **yours** (name, your Arc Testnet recipient
      address, thank-you message) — not the test profile.
- [ ] Test data is cleaned: Dashboard → "Remove Test Lab data" (PIN),
      and confirm totals are zero before sharing the link.
- [ ] Test Lab passes **12/12** (Dashboard → "Run Test Lab").
- [ ] A real wallet signature is verified in the browser: connect a
      wallet on Arc Testnet, sign a small test tip, confirm the donation
      reaches `processing` and finalizes via webhook/simulator.
- [ ] If you want real Gateway transfers (not just webhook simulation),
      `CIRCLE_API_KEY` (testnet) is set; otherwise the app honestly
      reports submission as disabled.
- [ ] If you subscribed the Circle webhook, signatures are verified:
      with `CIRCLE_API_KEY` set the app fetches Circle's public key
      itself (a `CIRCLE_WEBHOOK_SIGNING_KEY` PEM is only an override).
      Without either, verification is skipped and logged.
- [ ] `RIVER_API_KEY` is set if you want live AI thank-you messages;
      otherwise the saved River defaults are used and labelled as such.
- [ ] No `.env.local` or secret was committed (`git status` is clean of
      `.env*` except `.env.example`).

## Tests

- `npm test` — 20 unit tests (vitest): TransferSpec hash verified
  against a **live** Gateway estimate response (ground truth
  `transferSpecHash 0x7f8b…c29` for the probe spec), amount parsing /
  formatting, webhook validation (success, wrong env/domain/token/
  amount/recipient), River fallback behaviour without an API key.
- Dashboard → Test Lab — 12 end-to-end cases against the real store
  and webhook logic (success, expired transfer, duplicate webhook,
  amount under/over, wrong token/recipient/env/domain, deposit does NOT
  finalize, unknown transferId → orphan, invalid signature → 401).

## Project structure

```
app/
  page.tsx                    Tip page (creator card + tip flow)
  creator/page.tsx            Creator setup (+ River polish buttons)
  dashboard/page.tsx          PIN dashboard, simulator, Test Lab, cleanup
  donation/[id]/page.tsx      Donation status / thank-you page
  components/
    WalletBar.tsx             EIP-1193 connect + Arc Testnet switch
    TipFlow.tsx               Presets, live fee estimate, sign, polling
  api/
    info/                     Live Gateway info + app config
    estimate/                 Live POST /v1/estimate
    creator/                  Creator profile (GET public / POST setup)
    donations/                Create, status, prepare, sign, reconcile
    webhooks/circle/          Circle Gateway webhook endpoint
    dashboard/                PIN-protected totals/history/log
    test-lab/run| cleanup/    12-case Test Lab + test-data cleanup
    simulate-webhook/         Dashboard webhook simulator
    ai/thank-you/             River thank-you / polish route
lib/
  constants.ts  gateway.ts    Arc/Gateway constants, live API client,
  money.ts      store.ts      amounts, KV-or-memory store
  auth.ts       webhook.ts    PIN + rate limit, webhook processing
  river.ts      river-copy.json  River client + saved River copy
tests/                        vitest unit tests
```

## Still unverified (from the blueprint)

- Whether the minted amount exactly equals the intent `value`, with the
  fee deducted separately from the balance.
- Forwarder behaviour when a mint fails.

Both need a real testnet run with a funded Gateway balance and a Circle
API key before being treated as final. This project does not claim them.

## What this project deliberately does NOT do

- No mainnet, no Sepolia, no real funds, no user wallets, no private
  keys.
- No deployment to Vercel from here — you deploy it yourself, manually,
  following the steps above.
- No fake transferIds: without `CIRCLE_API_KEY`, transfer ids are
  labelled `local-pending-…` / `sim-…` and `transferSubmitted: false`.
- No real MetaMask signature was tested in this environment (no wallet
  exists here) — verify one in the browser before publishing (see the
  checklist).
