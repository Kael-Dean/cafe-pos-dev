# Architecture Decisions Record (ADR)

> **Last updated:** 2026-04-29
> **Status:** Pre-build decisions — locked unless explicitly changed

This document records architectural decisions for the Cafe POS system before implementation begins. Each decision affects the build prompt, schema, and feature scope.

---

## D1. Hosting & Infrastructure

**Decision:** Vercel (Next.js app) + Railway (PostgreSQL + Redis)

| Component | Provider | Tier | Cost |
|---|---|---|---|
| Web app + API | Vercel | Hobby | $0 |
| Database (Postgres) | Railway | Starter | $5 (free $5 credit) |
| Cache / Queue (Redis) | Railway | Starter | included |
| Domain | Namecheap / Cloudflare | — | ~25฿/mo amortized |
| **Total** | | | **~200฿/mo** |

### ⚠️ Risks & Mitigations

1. **Vercel Hobby TOS prohibits commercial use.** For a real cafe, technically need Pro ($20/mo).
   - **Mitigation A (recommended):** Migrate everything to Railway when going live. Railway hosts Next.js + DB + Redis on one platform. ~$10-15/mo total.
   - **Mitigation B:** Upgrade Vercel to Pro ($20/mo) — safest legally.
   - **Mitigation C:** Use Cloudflare Pages (free commercial) + Workers — more complex setup.

2. **Railway free credit ($5/mo)** runs out fast under load. Plan to budget $5-10/mo for production.

### Stack consequences (different from default Master Prompt)

- ❌ Drop Supabase Auth → use **Auth.js (NextAuth v5)** with credentials provider (PIN-based)
- ❌ Drop Supabase Realtime → use **Pusher Channels** (free tier: 100 connections, 200k msg/day) for KDS
- ❌ Drop Supabase Storage → use **Cloudflare R2** (10GB free) for menu images
- ❌ Drop Supabase RLS → enforce tenant/store isolation in **app layer** via tRPC middleware

---

## D2. Hardware: Tablet (deferred)

**Decision:** Design browser-agnostic. Lean toward **Windows tablet** (not finalized).

### Reasoning
- Windows tablet pros: USB-direct ESC/POS printers, cheaper hardware, full Chrome/Edge
- Windows tablet cons: heavier, battery shorter than iPad, fewer touch optimizations

### Constraints for design
- Min viewport: **1024×768** (iPad portrait floor)
- Touch target: **44×44 px minimum**, primary buttons 64×64 px
- No iOS-only APIs (no Apple Pay Web, no PassKit)
- Test on Chrome + Edge + Safari

### Suggested mid-range Windows tablets (under 15,000฿)
- Lenovo Tab M11 Wi-Fi
- ALLDOCUBE iWork series
- CHUWI MiniBook X
- Ben Q / Asus 10" tablets with kickstand

**Action:** Decide hardware before Phase 3 (after MVP demo works on browser).

---

## D3. Receipt Printer

**Decision:** Generic ESC/POS over USB or LAN. No vendor lock-in.

### Implementation
- Use [`escpos-js`](https://www.npmjs.com/package/@node-escpos/core) or web-serial API
- Print via browser's `window.print()` with CSS `@media print` for HTML fallback
- For thermal printers: WebUSB or local print server (small Node service in store)

### Recommended budget options (Thai market)
- Xprinter XP-58IIH (~1,800฿) — USB, 58mm
- Xprinter XP-T80A (~2,500฿) — USB+LAN, 80mm
- Epson TM-T82 (~5,500฿) — proven, 80mm, has ESC/POS native

**Action:** Buy 1 unit for testing during Phase 2 of build.

---

## D4. EDC (Card Reader)

**Decision:** **Manual entry first**. No EDC API integration in MVP.

### Workflow (MVP)
1. Cashier selects "Card" payment in POS
2. POS shows total → cashier enters total in physical EDC manually
3. EDC processes → cashier confirms in POS
4. POS saves order with `paymentMethod: CARD, paymentRef: <slip_no>`

### Phase 2 integration options (when chosen)
- KBank K PLUS Shop API
- SCB EASY Pay API
- Krungsri / Krungthai POS API

**Action:** Add `paymentRef` field in Order schema for slip number tracking. EDC integration deferred.

---

## D5. PromptPay QR

**Decision:** **Mobile phone PromptPay** (personal account) for v1.

### Format
- Standard EMVCo QR with mobile number (not Tax ID)
- Library: [`promptpay-qr`](https://www.npmjs.com/package/promptpay-qr) or generate manually
- Dynamic amount embedded in QR

### ⚠️ Verification problem
- **Personal PromptPay does NOT have webhook for incoming payment**
- Cashier must visually verify payment via SMS/banking app, then confirm in POS
- Phase 2: switch to **Bill Payment QR** (requires Biller ID from bank, ~3-7 days setup) → can use bank API webhook for auto-confirm

**Action:** Implement Phase 1 with manual confirm. Schema field `paymentVerifiedBy` records which user confirmed.

---

## D6. LINE OA

**Decision:** Open new LINE OA (Free tier) during Phase 2.

### Setup checklist (when ready)
1. Create LINE Official Account at [LINE for Business](https://www.linebiz.com/th/)
2. Get Channel ID + Channel Secret + Access Token
3. Set up LIFF app for membership signup
4. Webhook endpoint: `/api/webhooks/line`

### Free tier limits
- 300 broadcast messages / month
- Unlimited 1-on-1 reply messages
- Beyond limit: Light plan 1,200฿/mo for 15,000 messages

**Action:** Skip in MVP. Build CRM with phone+name only. LINE integration in Phase 2.

---

## D7. Multi-store

**Decision:** **Multi-tenant schema from day 1**, but launch with 1 store.

### Schema implications
- Every domain table has `storeId` foreign key
- tRPC context resolves current `storeId` from logged-in user
- All queries auto-filtered by `storeId` via Prisma middleware
- Inter-store transfer screen built but hidden until 2nd store added

### Why this matters
Adding `storeId` to existing rows after launch = data migration nightmare. Adding it from the start = nearly free.

---

## D8. Offline Mode

**Decision:** **Online-only** for MVP. No offline support.

### Reasoning
- Adds 2-3x dev time (IndexedDB queue, conflict resolution, sync UI)
- Cafe usually has stable wifi
- Phase 3 if user demand emerges

### Mitigation for short outages
- Use TanStack Query with aggressive cache + retry
- Show "Offline — last sync 2 min ago" banner instead of blocking UI
- Allow read of last-loaded menu while offline (no new orders)

---

## D9. Tax / VAT

**Decision:** **Schema supports VAT, but disabled by default.** Receipts are non-VAT.

### Schema design
```prisma
model Store {
  ...
  taxId       String?    // null = not VAT-registered
  vatEnabled  Boolean    @default(false)
  vatRate     Decimal    @default(7.0)
  ...
}
```

### Receipt format
- **Default (non-VAT):** simple receipt — store name, items, total
- **When VAT enabled:** full tax invoice format — Tax ID, VAT breakdown, sequential invoice number

### Future VAT registration checklist
1. Set `Store.vatEnabled = true`
2. Add `Store.taxId` and `Store.taxAddress`
3. Generate sequential invoice numbers per Revenue Department format
4. Build ภ.พ.30 monthly report
5. (Optional) e-Tax Invoice integration with RD API

---

## D10. Budget

**Decision:** **0 - 500฿/month** infrastructure budget.

### Realistic breakdown (target: ~200฿/mo)
| Item | Cost (฿/month) |
|---|---|
| Vercel Hobby | 0 |
| Railway Postgres + Redis | 150-180 |
| Domain (.com) | 25 |
| Pusher free tier | 0 |
| Cloudflare R2 (10GB free) | 0 |
| LINE OA Free | 0 |
| **Total** | **~200฿** |

### Scaling triggers (when to upgrade)
- >50 orders/day → may need Railway $5/mo Pro
- Going commercial (real customers) → Vercel Pro $20/mo or migrate to Railway full-stack
- >300 LINE messages/mo → LINE Light 1,200฿/mo

---

## Summary table

| # | Decision | Choice | Risk |
|---|---|---|---|
| D1 | Hosting | Vercel + Railway | Vercel TOS for commercial |
| D2 | Tablet | Browser-agnostic, lean Windows | Hardware not finalized |
| D3 | Printer | Generic ESC/POS | Need to buy unit for testing |
| D4 | EDC | Manual entry | No auto-reconcile |
| D5 | PromptPay | Personal mobile | Manual payment verify |
| D6 | LINE OA | Defer to Phase 2 | — |
| D7 | Multi-store | Schema-ready, 1 store launch | — |
| D8 | Offline | Online-only | Wifi outage = blocked |
| D9 | VAT | Schema-ready, disabled | Need migration when enabled |
| D10 | Budget | ~200฿/mo target | Free tier limits |

---

## Open questions for later

1. **Hardware purchase order** — when should we buy the test tablet + printer?
2. **EDC bank choice** — depends on which bank has best rate per transaction
3. **Domain name** — what's the brand name?
4. **Backup strategy** — daily DB dumps to where? (Cloudflare R2? Off-platform?)
5. **Monitoring** — Sentry free tier? Better Stack? (defer)
