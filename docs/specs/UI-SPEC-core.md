# UI-SPEC — Core Flow (POS · Payment · Receipt · Floor · KDS · Login)

> Branch `ux-upgrade` · Mode **Operate** (impeccable v4) · Owner: product-ux-designer → handoff to `dashboard-app-dev` + `design-system-engineer`
> Status: design spec only, no app code changed. Date 2026-10-04.
> Product truth: `POS_DESIGN_BRIEF.md` (espresso / caramel / cream, "10-second order"), `DECISIONS.md` (D2 tablet 1024, 44/64 px targets; D4 card = manual EDC + slip ref; D5 PromptPay personal QR + manual confirm + `paymentVerifiedBy`).
> Method note: the critique ran in degraded single-context mode because no sub-agent tool was available. The detector was run (5 findings, all `layout-transition` in `app-common.tsx:261,271,305,354,362`). There is no PRODUCT.md. The lead's brief and the two docs above are treated as product truth, and assumptions are marked **[A]**.

---

## 0. Direction (refinement, not redesign)

Keep the incumbent world: warm espresso/caramel on cream, Thai-first, tabular numbers. Do not restyle the brand. Fix structure, hierarchy, speed and states.

**Thesis — "the counter is an instrument."** The cart column is the fixed anchor. The **Total + one dominant Charge action** is the single loudest thing on screen. Everything else (members, promos, park) is quieter and one level down. The cashier should never wait for, read, or hunt for anything during a rush.

Anti-goals: no decorative motion during a sale, no toasts for routine success (a cart line appearing *is* the feedback), no simulated or fake data in production UI, no dead buttons.

Design-health baseline (Nielsen, core flow): Visibility 2 · Match 3 · Control 2 · Consistency 2 · Error-prevention 2 · Recognition 3 · Flexibility **1** · Aesthetic 3 · Recovery 2 · Help **1** = **21/40** (works, needs a structural pass). Target after this spec: ≥30/40.

---

## 1. Pain points per screen (ranked, with evidence)

Severity: **P0** = loses money/data or blocks a sale · **P1** = slows every sale · **P2** = polish/consistency.

### POS terminal (`src/components/screens/pos.tsx`)
| # | Sev | Pain | Evidence |
|---|---|---|---|
| 1 | P0 | **The cart is lost on navigation.** It lives in component `useState`, and `page.tsx` remounts screens with `key={screen}`. Going POS → Floor → POS empties the order. | `pos.tsx:58`, `app/page.tsx:73,163` |
| 2 | P0 | **The bill number is fake.** It is hard-coded to `useState(48)` and incremented locally, so it does not match the receipt or the KDS. | `pos.tsx:59,699,957` |
| 3 | P0 | **The menu grid gets 2 columns on the primary device.** At 1024px with the 240px sidebar, the menu is 60% of 784 = 470px, which fits only 2 columns at `minmax(160px)`. The cart takes 40%, which is too wide at 1440 (576px). | `pos.tsx:580,693,1038`, `app-common.tsx:257` |
| 4 | P1 | **There is no hotkey layer at all.** Desktop cashiers must mouse everything. The design brief promised "hotkey numbers on each card". | grep: no `keydown` in pos.tsx; brief §4 Screen 1 |
| 5 | P1 | **Each menu tap waits on a network round-trip** (`useProductDetail`) before deciding whether to add or open modifiers, and the tapped card shows no pending state. | `pos.tsx:101-119` |
| 6 | P1 | **Four pay buttons look the same** (all solid espresso). "primary" only changes font weight, so there is no visual hierarchy and Cash, the most common method, is not dominant. | `pos.tsx:817-822,1179-1195` |
| 7 | P1 | **Discount is unreachable** unless an automatic promotion happens to be eligible (the button is disabled otherwise). There is no manual or line discount. | `pos.tsx:790,835` |
| 8 | P1 | **Cart lines can't be edited.** Modifiers and notes cannot be changed after adding, so the cashier must remove and re-add. The qty stepper visual is 34px. Remove is an 11px text link. | `pos.tsx:1119-1148`, `qtyBtnStyle:1144` |
| 9 | P1 | **"Added to cart" toasts fire on every tap**, which is noise during a rush. The toast covers the cart area at bottom-right. | `pos.tsx:117,860` |
| 10 | P2 | **The Park bill button has no handler** (dead control). | `pos.tsx:733` |
| 11 | P2 | **The menu error state has no retry.** The category chip visual is 38px. Card name is 13px and the tag is 10px. | `pos.tsx:622-626,1046,1100` |
| 12 | P2 | **Text contrast fails AA**: `--color-accent-600` as text (3.1:1), and `text-secondary` 13px on `surface-2` (4.29:1). | `pos.tsx:806,892,897,931` |

### Payment (`payment-modal.tsx`, `payment-cash.tsx`)
| # | Sev | Pain | Evidence |
|---|---|---|---|
| 1 | P0 | **The QR is a fake, seeded pixel pattern**, not an EMVCo PromptPay payload. The confirm buttons say "จำลอง: …". | `payment-modal.tsx:164-207,197,257,289` |
| 2 | P0 | **Card payment has no slip/approval ref field** (D4), and QR has no `verifiedBy` (D5). | `payment-modal.tsx:229-262` |
| 3 | P1 | **There is about 1.1s of artificial delay** before `onPaid`, then a separate "preparing receipt" overlay. | `payment-modal.tsx:38-39`, `pos.tsx:961-978` |
| 4 | P1 | **There is no method switch inside the modal.** A wrong pick means cancel and re-open. | `payment-modal.tsx:67-121` |
| 5 | P2 | **Strings are hard-coded Thai**, bypassing i18n. The EDC name "SCB-A1" is fake. The card icon wiggles forever (infinite animation). | `payment-modal.tsx:67,175,254,248` |
| 6 | P2 | **Cash presets are static** (100/200/500/1000) rather than "next note up" from the total. The keypad itself is good. Keep it. | `payment-cash.tsx:19` |

### Receipt (`receipt-modal.tsx`)
| # | Sev | Pain | Evidence |
|---|---|---|---|
| 1 | P1 | **A backdrop click closes it.** A mis-tap loses the print and reprint path. | `receipt-modal.tsx:198` |
| 2 | P1 | **"Next order" is not the primary action.** The cashier must find Close among 4–5 foot buttons. | `receipt-modal.tsx:301-340` |
| 3 | P1 | **Backdating the receipt date is offered to every cashier on every sale** (fraud and accident risk). | `receipt-modal.tsx:85,123-134`, `pos.tsx:983-1003` |

### Floor + table session (`floor.tsx`, `table-session-modal.tsx`, `settle-modal.tsx`)
| # | Sev | Pain | Evidence |
|---|---|---|---|
| 1 | P0 | **Opening Settle immediately calls `closeSession`**, a side effect on open with no preview and no confirm. | `settle-modal.tsx:60-64` |
| 2 | P1 | **Each unpaid bill is paid one by one** through a `<Select>` that defaults to CASH. There is no tender, no change, no QR and no receipt. | `settle-modal.tsx:66-80,165-172` |
| 3 | P1 | **Opening a table takes 3 taps to start ordering.** The open → toast → back to floor path means re-tapping the card, then "order", to reach POS. | `table-session-modal.tsx:229-230`, `floor.tsx:154-178` |
| 4 | P2 | **No error state** (`isError` is never read). Overtime is only a small badge. | `floor.tsx:100,266` |
| 5 | P2 | **There are 4 different `ModalShell` implementations.** | `layout.tsx:127`, `table-session-modal.tsx:23`, `inventory.tsx:577`, `stock-take.tsx:108` |

### KDS (`kds.tsx`)
| # | Sev | Pain | Evidence |
|---|---|---|---|
| 1 | P1 | **No undo or recall after "done".** A mis-bump makes the ticket vanish. | `kds.tsx:125-133` |
| 2 | P1 | **Status "new" and urgency "yellow" both use `--color-warning`**, so the colour carries two meanings. | `kds.tsx:335,338` |
| 3 | P1 | **No error or stale-data state.** If polling fails, the board silently freezes. | `kds.tsx:21,205` |
| 4 | P2 | **Hard-coded "Sukhumvit 49"** and raw `rgba(255,255,255,.55)` text. The steps chip is 22px. Timers tick every 30s. | `kds.tsx:192,199,374,86` |

### Login (`login.tsx`)
| # | Sev | Pain | Evidence |
|---|---|---|---|
| 1 | P1 | **Store ID is retyped at every login**, and the PIN field raises the OS keyboard on a tablet. There is no on-screen PIN pad. | `login.tsx:153-178` |
| 2 | P1 | **No fast cashier switch or lock.** Logout means a full re-login and the cart is lost. | `app/page.tsx:71` |

### Shell (`app/page.tsx`, `app-common.tsx`, `mobile-nav.tsx`)
| # | Sev | Pain | Evidence |
|---|---|---|---|
| 1 | P1 | **The screen is not in the URL**, so Back leaves the app and refresh resets to POS. | `app/page.tsx:73` |
| 2 | P2 | **The sidebar animates `width`/`padding`** (layout thrash). It has a hard-coded default `branchName`. | `app-common.tsx:192,261,271,305,354,362` |
| 3 | P2 | **Toasts announce twice**: the region is `aria-live` and each toast has `role=status`. | `app-common.tsx:37-39` |

---

## 2. Target flows

### 2.1 Login (PIN) → POS
```
[Device remembers store] -> Lock screen: store chip "suk49 · เปลี่ยนสาขา" + staff avatars (optional [A]) + PIN pad
  PIN 4–6 digits -> dots fill -> auto-submit at 6 digits OR on ✓/Enter (4–5 digit PINs)
    ok   -> POS (restores the persisted cart if one exists for this device+store)
    fail -> dots shake 1x (reduced-motion: none) + clear + "PIN ไม่ถูกต้อง · เหลือ N ครั้ง"
    429  -> pad disabled + countdown (existing cooldown logic, login.tsx:51)
    offline -> banner "ไม่มีอินเทอร์เน็ต — เข้าสู่ระบบไม่ได้" + pad disabled
Lock (sidebar "ล็อก/สลับพนักงาน", hotkey Ctrl+L) -> same PIN pad; the cart is KEPT (belongs to device session) [A]
```
- The Store ID field only appears on first run or after "เปลี่ยนสาขา". Store it in `localStorage` (non-secret).
- The PIN pad keys are 72×72 at ≥768px and 64×64 on phones. The physical keyboard digits work (use `e.code` `Digit0-9`/`Numpad0-9`).

### 2.2 POS sale → payment → receipt → next sale
```
POS (cart empty, search focused on desktop)
 ├─ find: category chip | search (/, F2) | hotkey 1–9 on visible cards
 ├─ tap card
 │    no modifiers  -> line appears/increments in cart instantly (optimistic, ≤100 ms)
 │    has modifiers -> Modifier sheet (required groups preselected to default; Add = Enter)
 ├─ modify: tap a cart line -> Line sheet: qty NumberField, edit modifiers, note, line discount, remove
 │          or inline −/+ (44 px), swipe-left -> remove (with 5 s undo snackbar)
 ├─ discount: "ส่วนลด" (F4) -> Discount sheet: [eligible promos] + [manual ฿/% on bill] (+ manager PIN above threshold [A])
 ├─ member: "ลูกค้า" (F8) -> existing MembershipModal
 └─ Charge: primary "รับเงินสด ฿X" (F12 / Ctrl+Enter)  |  secondary: QR PromptPay · บัตร · อื่นๆ
        -> Payment sheet (method tabs in header, switchable without closing)
           Cash : keypad + smart presets [พอดี] [next 20/50/100/500/1000 above total] -> change shown live -> Enter
           QR   : real EMVCo PromptPay QR (promptpay-qr, D5) + amount + "รอลูกค้าโอน" -> cashier taps "ได้รับเงินแล้ว" (records verifiedBy)
           Card : "ใส่ยอด ฿X ที่เครื่อง EDC" + optional slip/approval ref field (D4) -> "ชำระสำเร็จ"
           Other: LINE Pay / bank transfer / voucher — each = manual confirm + optional ref
        -> confirm: button -> spinner in-button (no artificial delay) -> server order+payment
             ok    -> Receipt sheet immediately (success tick 240 ms)
             fail  -> stay in Payment sheet, inline error + "ลองอีกครั้ง"; cart untouched
Receipt sheet: order no. (server) · change due (cash, large) · actions: [ออเดอร์ถัดไป] primary (Enter/N) · พิมพ์ (P) · more (⋯: พิมพ์ผ่านเบราว์เซอร์, ยกเลิกบิล*, แก้วันที่*)  *manager role only
   auto-print if the printer is configured (setting) [A]; backdrop click does NOT close
-> "ออเดอร์ถัดไป" -> cart cleared, focus to search, cart shows "บิลใหม่" until the first item
```
Rules:
- The bill header shows `บิลใหม่` until an order exists. After that it shows the server `daily_number`. Never fabricate a number.
- Park bill (F9): save the cart to the parked list (persisted). A "พักบิล (n)" chip appears in the cart header and opens the list to resume. If parking is out of scope for this phase, **hide the button**. Do not ship it dead.
- The cart lives in a Zustand store with `persist` (`sessionStorage`, keyed `store:{slug}:device`). It survives screen switches and refresh. It is cleared only by successful payment, void, or "ออเดอร์ถัดไป".

### 2.3 Floor → table session → POS → settle
```
Floor grid (tables by zone; free / busy / overtime / needs-attention)
 ├─ tap FREE table -> Open sheet: party size (stepper), rate plan (default preselected), member (optional), note
 │     primary "เปิดโต๊ะและสั่งอาหาร" -> session opens -> POS in table mode (banner "โต๊ะ T3 · 2 คน · 00:04")
 │     secondary "เปิดโต๊ะอย่างเดียว" -> back to floor
 ├─ tap BUSY table -> Session sheet: elapsed, running time charge, orders list
 │     primary "สั่งเพิ่ม" -> POS table mode · secondary "ย้ายโต๊ะ", "เช็คบิล"
 └─ "เช็คบิล" -> Settle sheet (PREVIEW, no side effect on open):
        time charge (computed preview) + unpaid orders + grand total
        primary "รับเงิน ฿X" -> same Payment sheet as 2.2 (one tender for the whole tab)
           -> backend closes the session + pays all unpaid orders atomically  ⚠ needs API: POST /sessions/{id}/settle {method, tendered, ref}
           -> Receipt sheet (combined) -> back to Floor (table turns free)
        secondary "ชำระแยกบิล" (advanced, keeps today's per-order behaviour)
POS table mode: Charge is replaced by "เพิ่มเข้าบิลโต๊ะ" (existing addToTab), plus "ออกจากโหมดโต๊ะ" in the banner.
```

### 2.4 KDS ticket lifecycle
```
NEW ──[เริ่มทำ]──> IN_PROGRESS ──[พร้อมเสิร์ฟ]──> READY ──[ส่งแล้ว]──> COMPLETED (leaves board)
  │                                                                  └─ undo snackbar 5 s; "เรียกคืน" drawer (last 10)
  └─ CANCELLED (from POS/manager) -> card shows a strike + "ยกเลิก" for 10 s, then leaves
Urgency is independent of status: timer chip neutral <5 min · warning 5–10 · danger >10 (store-configurable)
New ticket: card enters at the end (FIFO), 1 s highlight ring + optional chime (setting, off by default) [A]
```
- Status is shown by **column/label + icon**. Urgency is shown by **the timer chip + left border**. Never use the same hue for both: status NEW uses `info`, urgency uses `warning`/`danger`.
- Stale data: if the last successful poll is more than 15s old, show a top bar "ข้อมูลอาจไม่ล่าสุด · อัปเดต 14:02" + retry. Bump buttons stay enabled and changes queue optimistically (existing `recentActions` logic).

### 2.5 Navigation + history (keep the single-page switcher)
- `navigate(s)` does `history.pushState({screen:s}, '', '?screen='+s)`. On mount, read `?screen=` (validate against `Screen` and the user's role; fall back to `pos`). `popstate` → `setScreen` without pushing.
- Back with an open sheet/modal: close the topmost overlay first (push a `{overlay:true}` entry on open, pop on close).
- Back during Payment `processing` or `paid`: blocked (re-push state), consistent with `safeClose` in `payment-modal.tsx:45`.
- Existing veto (`page.tsx:101`, nav-guard) must also run on `popstate`.

---

## 3. Layout per breakpoint

The cart is a **fixed-width** column, not a percentage. The sidebar auto-collapses to a 64px rail on POS, Floor and KDS at <1280px. The user's toggle is remembered per breakpoint class.

| Viewport | Nav | POS menu grid | Cart | Pay area | Notes |
|---|---|---|---|---|---|
| **375** phone | bottom tabbar (existing `mobile-nav`) | 2 cols, image cards; compact mode 2 cols text tiles 72px | separate tab "ตะกร้า" + sticky cart bar under menu (existing `pos-cartbar`) | Charge 56px full width; secondary methods as a 3-up row 48px | Sheets = full-screen bottom sheets. Totals collapse behind the total row (existing). |
| **768** portrait tablet | rail 64 | `minmax(140px,1fr)`, 2–3 cols; compact 3 cols | 320px right column | Charge 64px; methods 3-up 56px | Category chips scroll horizontally. Search full width. |
| **1024** landscape (**primary**) | rail 64 (auto) | 608px area → **4 cols** `minmax(132px,1fr)`; compact 4 cols × ~7 rows visible | **352px** | Charge 64px; methods 3-up 56px; promos/void 44px row | Hotkey badges visible. Modals are centered at 560px max. Payment sheet is 640px wide, keypad left and summary right. |
| **1440** desktop | sidebar 240 (expanded) | 752px → 5 cols `minmax(140px,1fr)` | **400px** | same as 1024 | Hotkey badges and `Kbd` hints on all actions. Optional "recent orders" strip in the cart header. |

Density setting (per device, `localStorage`): **รูป** (4:3 image card, default on phones) / **กะทัดรัด** (text tile: name 15px/600, price 16px tabular, color stripe from `item.color`, 72px tall; default on 1024+ [A]).

Cart column, top to bottom:
1. Header 64px: bill label + member chip/actions
2. Lines (scroll)
3. Totals: subtotal/discounts 14px, Total 32px tabular, `--color-primary`
4. Pay block pinned to the bottom

Floor:
- `minmax(184px,1fr)`: 2 cols at 375, 3 at 768, 4 at 1024, 6 at 1440.
- Card min-height 120px. Zone headers are sticky.

KDS:
- 1 col at 375, 2 at 768, 3 at 1024, 4 at 1440.
- Ticket items 16px. The modifier line is 14px bold when it is "special" (existing intent from the brief).

---

## 4. Input: hotkeys, gestures, targets

### 4.1 Hotkeys (desktop and hardware keyboard)
Match on `KeyboardEvent.code`, not `key`. Thai Kedmanee maps the number row to Thai characters, so `key` breaks. Hotkeys are disabled while an `<input>`/`<textarea>` has focus, **except** Esc, Enter, F-keys and Ctrl-combos. One registry hook, `useHotkeys(scope)`: scopes are `pos` | `payment` | `receipt` | `kds` | `floor`. The top-most modal owns input.

| Scope | Key | Action |
|---|---|---|
| global | `?` (Shift+/) | Hotkey cheat-sheet sheet |
| global | `Ctrl+L` | Lock / switch cashier |
| global | `Esc` | Close topmost sheet (blocked during payment processing) |
| pos | `/` or `F2` | Focus search (select all) |
| pos | `1`–`9` | Add the Nth visible menu card (badge shown top-right of the card) |
| pos | `[` / `]` | Previous / next category |
| pos | `Enter` in search | Add the single result, or the highlighted result (`↑`/`↓` moves the highlight) |
| pos | `Alt+↑` / `Alt+↓` | Select cart line |
| pos | `+` / `-` | Qty of the selected line (default: last added line) |
| pos | `Delete` | Remove the selected line (undo snackbar) |
| pos | `E` | Edit the selected line (Line sheet) |
| pos | `F4` | Discount sheet |
| pos | `F8` | Customer / member |
| pos | `F9` | Park bill / parked list |
| pos | `F12` or `Ctrl+Enter` | Charge (cash default) |
| pos | `Ctrl+Backspace` | Void cart (opens confirm) |
| payment | `1` `2` `3` `4` with Alt | Switch method Cash / QR / Card / Other |
| payment | digits, `.`, `Backspace`, `Delete` | Cash keypad (existing, `payment-cash.tsx:116-125`) |
| payment | `=` | Exact amount ("พอดี") |
| payment | `Enter` | Confirm (when valid) |
| receipt | `Enter` or `N` | Next order |
| receipt | `P` | Print |
| kds | `↑↓←→` | Move focus across tickets |
| kds | `Space` | Advance the focused ticket |
| kds | `U` | Undo last bump |
| floor | type a table name | Jump focus to that table; `Enter` opens it |

### 4.2 Touch gestures (each one also has a visible button)
- Cart line **swipe left** → reveals "ลบ" (danger, 72px). A full swipe removes the line with an undo snackbar. A tap on the line opens the Line sheet.
- Menu card **long-press 450ms** → Line sheet preset (modifiers + qty) before adding. Short tap = default add.
- Bottom sheets: **drag down** to dismiss (not during payment processing). The handle is a 44px hit area.
- KDS: **no swipe-to-bump** (accidental risk in a kitchen). Use buttons only.
- No pull-to-refresh. Floor and KDS poll and show "อัปเดต hh:mm" + a refresh IconButton.

### 4.3 Targets
- Minimum **44×44** for every interactive element. Use the `hit-44` pseudo-element only when the visual must be smaller, e.g. chip close.
- **56px** for primary POS actions: secondary pay methods, the Modifier "Add", the cart qty steppers on touch (visual 44, row 56), category chips (visual 44).
- **64px**: Charge, the Payment confirm, the PIN keys (72 at ≥768), and "ออเดอร์ถัดไป".
- Keep 8px minimum spacing between adjacent destructive and primary targets. Void is never adjacent to Charge.

---

## 5. Required states per screen

| Screen | Loading | Empty | Error | Offline | Success feedback |
|---|---|---|---|---|---|
| Login | button spinner, pad disabled | n/a | inline under the dots, `role=alert`, shake 1x | banner + pad disabled | instant route to POS (no toast) |
| POS menu | skeleton grid matching the density mode (existing `pos.tsx:628`) + chip skeletons | per-category / no-search-result EmptyState (existing copy) + "ล้างคำค้น" action | EmptyState danger + **"ลองอีกครั้ง"** (refetch) | persistent top banner (existing offline-indicator). Charge disabled with reason "ออฟไลน์ — รับเงินไม่ได้"; the cart stays editable and persisted | the cart line appears with a 160ms highlight; the qty pill bumps; **no toast** |
| POS card tap pending | card pressed state + 2px progress bar at the card bottom if >150ms | — | toast danger "เพิ่มเมนูไม่สำเร็จ" + card shake-free | blocked if detail is not cached | — |
| Cart | — | EmptyState "ยังไม่มีรายการ" + hint "แตะเมนู หรือกด 1–9" (desktop) | add-to-tab failure: cart restored + warning toast (existing `pos.tsx:316-345`) | see above | removal → undo snackbar 5s |
| Payment | QR: skeleton square ≤ actual generation time (no fixed 420ms); confirm button spinner | — | inline error in the sheet + retry; never close the sheet on error | all methods disabled with reason "ออฟไลน์"; the sheet stays open; auto re-enables on reconnect | 240ms tick → Receipt |
| Receipt | print button spinner | — | print fail: inline "พิมพ์ไม่สำเร็จ" + "ลองใหม่" / "พิมพ์ผ่านเบราว์เซอร์" | print-only works; "ส่ง e-receipt" hidden | "พิมพ์แล้ว" inline check on the button (not a toast) |
| Floor | skeleton cards (existing `floor.tsx:124`) | EmptyState + admin action "ไปตั้งค่าโต๊ะ" (existing) | **new**: EmptyState danger + retry | stale bar "อัปเดตล่าสุด hh:mm" | table card state change (free ↔ busy) cross-fades 180ms |
| Open session | plans: Select skeleton | no plans → inline warning + setup link (existing) | inline error (existing 409/422) | submit disabled | lands in POS table mode, banner confirms |
| Settle | preview skeleton (total rows) | "ไม่มีบิลค้าง" → only the time charge | inline error + retry; **no session change happened** | disabled | Receipt sheet, then Floor with the table free |
| KDS | skeleton tickets (existing `kds.tsx:206`) | "ยังไม่มีออเดอร์" (existing) | **new**: stale bar + retry; tickets stay | stale bar | bump: button → next status label + undo snackbar |

The single source of copy is `lib/i18n/th.ts` + `en.ts`. All hard-coded strings in the files above must move there (payment-modal, settle-modal, table-session-modal, kds header).

---

## 6. Component inventory (design system)

All components consume component-layer tokens (§7). There are no inline `style={{}}` colours in screens. Every interactive component has these states: default, hover (pointer only), pressed (`scale(.97)` 80ms), focus-visible (2px ring `--color-focus-ring` + 2px offset), disabled (aria-disabled + reason tooltip where relevant), loading (spinner replaces icon; width locked).

| Component | Variants | Sizes (height) | Notes / states |
|---|---|---|---|
| **Button** | primary, secondary (outline), ghost, danger, accent (caramel, `--color-on-accent` ink) | sm 36 (desktop admin only), md 44, lg 56, xl 64 | `loading`, `kbd` slot (renders Kbd at ≥1024), `fullWidth`, icon-leading. Replaces `.btn` + `PayButton` |
| **IconButton** | ghost, outline, danger, onInverse | 44 (visual 36 allowed with hit-44), 56 | requires `aria-label`; optional badge |
| **PayAction** | charge (primary xl), method (secondary lg) | 64 / 56 | shows amount in the label; `pending`; `disabledReason` |
| **Input** | default, search (leading icon + clear), inverse | 44, 56 | invalid, with message slot; 16px text on phones (no iOS zoom) |
| **NumberField** | stepper (− value +), plain | 44, 56 | min/max/step, integer; long-press repeat; uses `lib/number-input.ts` |
| **Keypad** | cash, pin | key 64 / 72 | shared by login + payment-cash; physical-key mirroring; `aria-label` per key |
| **Select** | default | 44 | existing `app-common.tsx:507`; listbox a11y |
| **SegmentedControl** | default, onInverse | 44, 56 | payment method tabs, density toggle, KDS filter |
| **Chip** | filter (category), status, removable (member) | 44 visual on POS, 32 + hit-44 elsewhere | `aria-pressed` |
| **Modal** | dialog (centered), alert (confirm) | width 400 / 560 / 640 | one implementation; consolidates the 4 `ModalShell`s; uses `use-modal-a11y`; `dismissible` flag (false during payment processing) |
| **Sheet** | bottom (phone), side (≥1024 optional) | auto / full | drag-to-dismiss, history-aware (§2.5) |
| **Toast** | info, success, warning, danger | — | errors and async results only; max 2 visible; position bottom-**left** on POS ≥768 (clear of the cart), top on phones; fix double live region |
| **Snackbar (Undo)** | default | 48 | 5s, single action "เลิกทำ"; `role=status` |
| **Badge** | count, status (neutral/info/success/warning/danger), hotkey | 20 / 24 | text uses `*-fg` tokens on `*-50` tints |
| **Kbd** | default, onInverse | 20 | renders `F12`, `⌘/Ctrl`; hidden on touch-only (`pointer: coarse`) |
| **Card** | menu (image / compact), table, ticket, surface | — | menu card: hotkey badge, bestseller badge, pressed/pending; table card: free/busy/overtime/attention |
| **CartLine** | default, selected, editing, removing | row ≥56 | swipe actions; modifiers line clamps to 2 |
| **TotalBlock** | default, compact (phone) | — | tabular nums; discount rows; aria-live polite on the total |
| **EmptyState** | neutral, search, danger | — | icon 56, title, body, optional action. Replaces the 3 ad-hoc versions (`pos.tsx:641`, `floor.tsx:326`, `kds.tsx:215`) |
| **Skeleton** | block, text, card presets | — | existing `components/ui/skeleton.tsx`; shimmer off under reduced-motion |
| **Banner** | offline, stale, table-mode, info | 40–48 | persistent, not dismissible when it is a state |
| **Timer** | neutral, warning, danger | — | KDS and floor elapsed; tabular; ticks every 15s |
| **QRPanel** | promptpay | 240 / 200 phone | real payload, amount, store name, verification button |
| **ReceiptPaper** | — | 58/80mm preview | existing paper styles stay theme-invariant |

---

## 7. Token revisions

### 7.1 Layering
```
primitive  (raw, never used in components)   --brown-900 … --brown-50, --caramel-*, --cream-*, --ink-*, --green-*, --honey-*, --berry-*, --blue-*
semantic   (theme-aware; EXISTING NAMES KEPT) --color-primary, --color-surface, --color-text-secondary, … (+ new *-fg / *-strong)
component  (per component, reference semantic) --btn-primary-bg, --pay-charge-h, --cart-w, --tap-min, --kds-ticket-border-urgent …
```
- Existing `--color-*`, `--fs-*`, `--space-*`, `--radius-*`, `--dur-*`, `--sb-*` names stay as-is (semantic layer or alias). New primitives sit under them. Dark mode only re-points the semantic layer.
- Tailwind v4: expose the semantic layer in `@theme inline { --color-primary: var(--color-primary); … }` so utilities and inline vars agree.

### 7.2 Value changes (AA verified, ratios computed this session)
| Token | Light now → proposed | Ratio (light) | Dark now → proposed | Ratio (dark) | Why |
|---|---|---|---|---|---|
| `--color-text-secondary` | #6B7280 → **#575C66** | 4.29 → **5.96** on surface-2 | keep #B8AC9C | 6.81 | Fails AA at 12–13px on `surface-2` (cart totals `pos.tsx:806`) |
| `--color-text-muted` | #6C7079 → **#60646D** | 4.41 → **5.26** on surface-2 | #968A78 → **#A39682** | 4.48 → **5.23** | Both fail on surface-2 |
| `--color-success-fg` (new) | **#3E6B3C** | 5.46 on success-50, 6.23 on white | #7FB07D | 6.77 | `--color-success` as text = 4.01 / 3.52 on its tint |
| `--color-success-strong` (new fill w/ white) | **#4A7548** | 5.34 | **#3F6B3D** | 6.21 | White on #5C8A5A = 4.01 |
| `--color-accent-fg` (new, text) | **#8A5A2B** | 5.87 on white, 5.33 on accent-50 | #E2BC8E | 9.52 | Replaces `--color-accent-600`-as-text (3.10 / 2.82) at `pos.tsx:892,897,931` |
| `--color-border-input` (new) | **#958B7A** | 3.36 on surface, 3.04 on bg | **#7A6A56** | 3.24 | WCAG 1.4.11. Input/stepper boundaries; `--color-border` (1.32) stays for dividers only |
| `--color-focus-ring` | (amber) → keep, verify ≥3:1 | — | #D4A574 keep | ≥7 | — |
| `--color-status-new` (new, KDS) | alias `--color-info` | white 5.11 | alias `--color-info` | 6.29 | Splits status from urgency |

Unchanged and verified: white on `--color-primary` 13.87; `--color-on-accent` on warning 8.85; `--color-danger-fg` on danger-50 5.46; `--color-warning-fg` on warning-50 6.41 (L) / 7.89 (D); dark text on surface 14.81.

### 7.3 New component/scale tokens
```
--tap-min: 44px;  --tap-pos: 56px;  --tap-pay: 64px;  --tap-pin: 72px;
--cart-w: 352px;  (@1440: 400px; 768–1023: 320px)
--menu-card-min: 132px; (@1440: 140px)   --menu-tile-h: 72px;
--fs-13: 13px (min for secondary text on POS); --fs-15: 15px; --fs-28: 28px (change due); --fs-40: 40px (payment total)
--z-snackbar: 2050;
--dur-instant: 80ms;  --dur-fast: 120ms; --dur-base: 180ms; --dur-slow: 240ms (was 280)
--ease-out: cubic-bezier(0.2, 0.8, 0.2, 1) (keep); --ease-in: cubic-bezier(0.4, 0, 1, 1); --ease-standard: cubic-bezier(0.2, 0, 0, 1)
```
Floor: no text below 12px anywhere. On POS/KDS, secondary text is ≥13px and item names are ≥15px.

---

## 8. Motion

The principle is that motion confirms; it never delays. No interaction waits on an animation to finish before the next input is accepted.

| Event | Duration | Easing | Property |
|---|---|---|---|
| Press feedback (buttons, cards, keys) | 80ms in / 120ms out | standard | `transform: scale(.97)` |
| Cart line added | 160ms | ease-out | background highlight fade (accent-50 → transparent) + height via grid-rows, never `height` |
| Qty / count pill change | 120ms | ease-out | scale 1 → 1.12 → 1 |
| Sheet / modal enter | 180ms (phone sheet 220ms) | ease-out | opacity + translateY(8px) / translateY(100%) |
| Sheet / modal exit | 120ms | ease-in | opacity |
| Payment success tick | 240ms | ease-out | stroke-dashoffset; Receipt mounts **at** 240ms, not 1100ms |
| Screen switch | 120ms | standard | opacity only (existing `.screen-enter`) |
| KDS new ticket | 1000ms | linear | ring pulse ×1 (not infinite) |
| KDS done → leave | 180ms | ease-in | opacity, then remove (keep the grid slot 180ms) |
| Menu grid stagger on category change | total ≤120ms (each 0.01s, max 12 items) | ease-out | opacity + 4px y; skip entirely when the switch came from a hotkey |

Rules:
- Only animate `transform` and `opacity`. Fix the detector findings: the sidebar `width`/`padding` transitions (`app-common.tsx:261,271,305,354,362`) become a `transform: translateX` on an inner panel + an instant grid-column change, or no transition.
- Remove infinite decorative loops (`wiggle` `payment-modal.tsx:248`). The QR "waiting" dot pulse may stay but must be ≤1 property.
- `prefers-reduced-motion: reduce`: keep opacity fades ≤120ms, drop all translate/scale/shake, and stop the KDS pulse. A global rule exists (`globals.css:1174`); components must not override it with inline `animation`.
- GSAP (`lib/motion`) only for count-up (change due) and stagger. Everything else uses CSS.

---

## 9. Acceptance criteria (QA, test with `playwright-cli` at 375 / 768 / 1024×768 / 1440×900, light + dark)

**Flow and data integrity**
- [ ] Add 3 items, go to Floor, then back to POS: the cart is intact. Refreshing the page also keeps the cart.
- [ ] The bill header shows `บิลใหม่` before payment. After payment, the receipt, the KDS ticket and the order list all show the same server order number.
- [ ] No fake or simulated UI in a production build: no "จำลอง" strings, and the QR decodes (any QR reader) to a valid EMVCo PromptPay payload with the exact amount.
- [ ] Card payment saves `paymentRef` when entered. QR/other confirm saves `paymentVerifiedBy` = the current user.
- [ ] Double-tapping confirm creates exactly one order (existing guard holds).
- [ ] Opening Settle does **not** change the session until "รับเงิน" is confirmed (network log shows no close call on open).
- [ ] Settling a table with 3 unpaid orders + a time charge takes one tender, prints one combined receipt, and frees the table.
- [ ] Open table → "เปิดโต๊ะและสั่งอาหาร" lands in POS table mode within 1 tap.

**Speed**
- [ ] Tapping a cached no-modifier item renders the cart line in ≤100ms (Performance panel, 4× CPU throttle ≤200ms).
- [ ] Payment confirm → Receipt visible ≤ server latency + 300ms. There are no fixed timeouts ≥300ms in the path.
- [ ] Cash sale with a hardware keyboard and no mouse: `/` type "lat" `Enter` `F12` `=` `Enter` `Enter` completes a sale and returns to an empty cart with search focused.
- [ ] No toast appears on add-to-cart.

**Layout**
- [ ] At 1024×768 the menu shows ≥4 columns, the cart is 352px, and Charge is visible without scrolling with 12 cart lines.
- [ ] At 1440 the cart is ≤400px wide and the menu shows ≥5 columns.
- [ ] At 375, no horizontal scroll; the cart bar sits above the tabbar; payment sheets are full-screen and the confirm button stays above the keyboard and tabbar.
- [ ] Thai item names with tone marks are not clipped in cards (line-clamp 2, line-height ≥1.35).

**Input and targets**
- [ ] Every interactive element has a hit area ≥44×44 (automated: bounding box + `hit-44` pseudo). Charge, Payment confirm, PIN keys and "ออเดอร์ถัดไป" are ≥64px tall. Category chips, qty steppers on touch, and secondary pay methods are ≥56px rows.
- [ ] Hotkeys work with the Thai keyboard layout active (`e.code`), and do not fire while typing in search except Esc/Enter/F-keys.
- [ ] `?` opens the cheat-sheet listing every binding in §4.1.
- [ ] Every swipe/long-press action has a visible button equivalent.

**States**
- [ ] Throttled/blocked product API: skeleton → error EmptyState with a working "ลองอีกครั้ง".
- [ ] Offline (DevTools): banner visible; Charge disabled with a reason; the cart stays editable; going back online re-enables it without a reload.
- [ ] KDS with the API failing for >15s shows the stale bar with the last update time. Bump → undo within 5s restores the ticket to its prior status on the server.
- [ ] Floor API error shows a retry state (not an infinite skeleton).
- [ ] The receipt is not dismissed by a backdrop click. Backdate/cancel are visible only to the manager role.

**Navigation**
- [ ] Each screen change updates `?screen=`. Browser Back returns to the previous screen. Back with a sheet open closes the sheet only. Back during payment processing does nothing.
- [ ] Deep link `?screen=kds` opens KDS after login. A role without access falls back to POS.

**Accessibility and visual**
- [ ] axe: 0 serious/critical on all core screens in light and dark.
- [ ] Contrast pairs in §7.2 measured in the build. No `--color-accent-600` used as text. Input borders ≥3:1.
- [ ] Focus is visible on every control, is trapped in modals, and returns to the trigger on close. The cart total change is announced politely once (no double live regions).
- [ ] Status vs urgency on KDS is distinguishable in grayscale (icon/label + border, not hue only).
- [ ] `npx impeccable detect src/components` → no `layout-transition` findings. `prefers-reduced-motion` removes all transforms.

---

## 10. Open decisions (builder must not invent)
1. **Manual discount.** Does it need a manager PIN, and above what threshold (฿ / %)? Default proposal: >10% or >฿50 requires a manager PIN.
2. **Lock/switch cashier.** Does the cart stay with the device (proposed), or is it cleared per cashier?
3. **Auto-print on payment success.** Proposed as a per-device setting, on by default when a printer is paired.
4. **Combined settle endpoint** (`POST /sessions/{id}/settle`) needs backend work. Until then, settle uses sequential pay calls behind one tender UI, with rollback messaging.
5. **Offline sales queue** (cash only) is out of scope here. Pair with the `offline-first-pos-sync` work if wanted.
6. **Compact text tiles as the default at ≥1024** is proposed; it needs owner sign-off because of the brand's photo-forward brief.
