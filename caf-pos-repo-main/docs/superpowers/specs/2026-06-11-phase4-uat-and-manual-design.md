# Phase 4 Documentation Deliverables — UAT Workbook & User Manual (Design)

**Date:** 2026-06-11
**Status:** Approved by user
**Context:** TOR งวดที่ 4 requires UAT, a user manual (คู่มือการใช้งานระบบ), Railway deployment, and source-code handoff. Reports/dashboards are already built and the staff training is completing today. This design covers the two missing artifacts: the UAT checklist and the user manual.

## Decisions (confirmed with user)

| Decision | Choice |
|---|---|
| Manual basis | **Hybrid** — Thai workflow manual written from verified backend behavior, with screenshot placeholder boxes for the frontend team to fill in later |
| Delivery format | **Markdown source in repo + generated .docx/.pdf** for formal client delivery |
| UAT format | **Excel workbook** with per-module test sheets, Pass/Fail dropdowns, and a sign-off summary sheet |
| Scope | **TOR's 11 modules as the acceptance baseline; extra modules documented but clearly separated** and excluded from acceptance criteria |
| Manual organization | **By role** (Owner, Manager, Barista, Baker) with shared basics in an intro chapter |

## Deliverable 1 — UAT Workbook (build first)

**File:** `docs/uat/UAT-cafe-pos.xlsx` (Thai language)

### Sheets

1. **สรุปผลและลงนาม** — acceptance criteria statement, per-module pass/fail rollup (formulas referencing module sheets), sign-off block for ผู้ว่าจ้าง and ผู้รับจ้าง with name/signature/date lines
2. **Sheets 2–12** — one per TOR module §3.1–§3.11:
   - §3.1 User & Authentication, §3.2 HR & Leave, §3.3 Shift & Task, §3.4 Cash Management, §3.5 Menu & Recipe, §3.6 Inventory & Goods Receipt, §3.7 Order Management, §3.8 Pre-order, §3.9 Shopping List, §3.10 CRM, §3.11 Reports & Dashboards
3. **เทคนิค (§4)** — technical requirements: multi-branch data isolation, exact-decimal money/quantity math, append-only audit trail (no hard deletes), Railway cloud availability
4. **ฟังก์ชันเพิ่มเติม** — extras (membership, promotions, production orders, stock takes, PromptPay QR, daily receipt numbers), explicitly labeled "ไม่อยู่ในเกณฑ์การตรวจรับ" so they cannot block sign-off

### Test-case columns (every module sheet)

| Column | Content |
|---|---|
| รหัส | Test ID, e.g. `UAT-ORD-03` (module prefix + running number) |
| สถานการณ์ทดสอบ | Scenario being verified |
| ขั้นตอน | Numbered steps the tester performs |
| ผลที่คาดหวัง | Expected result, traceable to a specific TOR requirement line |
| ผล | ผ่าน / ไม่ผ่าน (data-validation dropdown) |
| หมายเหตุ | Notes / defect reference |
| ผู้ทดสอบ | Tester name |
| วันที่ | Test date |

### Sizing

8–12 cases per module, ~110 contractual cases total plus ~20 supplementary cases for extras. Each case derives from a TOR requirement so the client can trace every test back to the contract.

### Implementation notes

- Build with openpyxl (xlsx skill), include Pass/Fail data validation, frozen header rows, sensible column widths, and print-friendly layout.
- Summary rollup uses COUNTIF formulas against each module sheet's ผล column.

## Deliverable 2 — User Manual (build second)

**Source:** `docs/manual/user-manual-th.md` (Thai) → converted to `.docx`/`.pdf` (pandoc if available, otherwise python-docx fallback).

### Structure (role-based chapters)

1. **บทนำ** — system overview, PIN login, 8-hour session, the 4 roles and permission summary, shared basics
2. **เจ้าของร้าน (Owner)** — daily dashboard; all 6 reports (sales with day/hour/product/category/payment filters, COGS, wastage, low stock, cashier shifts); stock adjustments; full oversight
3. **ผู้จัดการ (Manager)** — staff accounts (create/edit/deactivate, duplicate phone/email rules per store), leave approval, shift scheduling, task assignment & review, cash drawer open/close, voiding orders (stock auto-restored), goods receipts with lots/expiry/supplier, waste recording with reasons, menu/categories/recipes/modifiers management
4. **บาริสต้า (Barista)** — taking orders (dine-in/takeaway, modifiers), payment (cash/card/QR PromptPay), KDS status flow (PENDING → PAID → IN_PROGRESS → READY → COMPLETED), recording waste, customer lookup & order history, shopping list add/remove/export, pre-order intake
5. **เบเกอร์ (Baker)** — pre-order production flow (start → stock deduction → complete), ingredient withdrawal, production basics
6. **ภาคผนวก: ฟังก์ชันเพิ่มเติม** — beyond-TOR features, clearly marked: membership/points/tiers, promotions, production orders & cost-per-unit, stock takes, PromptPay QR generation, daily receipt numbering (`IV{BE-year}{MMDD}-{NNNN}`)

### Conventions

- Screenshot placeholders as visually distinct boxes: `[ ภาพหน้าจอ: หน้าจอรับออเดอร์ ]` at every workflow step, so the frontend team can drop in images without restructuring the document.
- Content written from verified backend behavior (statuses, role permissions, validation rules) so it stays accurate regardless of frontend styling.
- Thai throughout; English technical terms in parentheses on first use.

## Build order & rationale

1. **UAT workbook first** — it gates the Phase 4 payment and is needed to schedule UAT with the client.
2. **Manual second** — larger document; .docx/.pdf conversion happens at the end.

## Out of scope

- Capturing actual frontend screenshots (frontend team / later pass)
- UAT execution itself (done with the client)
- Updating the TOR or contract documents
