# Phase 4 UAT Workbook & Thai User Manual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the two missing TOR งวดที่ 4 artifacts — a Thai UAT acceptance workbook (`docs/uat/UAT-cafe-pos.xlsx`) and a Thai role-based user manual (`docs/manual/user-manual-th.md` + `.docx`).

**Architecture:** UAT test-case content lives in a pure-data module (`tools/uat_cases.py`); a separate generator script (`tools/generate_uat_workbook.py`) renders it to a styled Excel workbook with openpyxl (Pass/Fail dropdowns, COUNTIF summary rollup, sign-off block). The manual is hand-written Markdown organized by role with screenshot placeholder boxes, converted to .docx via pandoc at the end.

**Tech Stack:** Python + openpyxl (via `uv run --with openpyxl`), Markdown, pandoc (docx conversion), optional docx2pdf.

**Spec:** `docs/superpowers/specs/2026-06-11-phase4-uat-and-manual-design.md`

**Reference for behavior facts:** TOR at `docs/TOR-cafe-pos-proposal-TH.md`; routers in `api/app/api/v1/*.py` (role gates are declared as `require_role(...)` dependencies); enums in `api/app/enums.py`.

---

### Task 1: UAT case data — modules §3.1–§3.4

**Files:**
- Create: `tools/uat_cases.py`

- [ ] **Step 1: Create `tools/uat_cases.py` with the data shape and the first four modules**

Each module is a dict: `sheet` (Excel sheet name, ≤31 chars), `prefix` (test-ID prefix), `tor` (TOR clause), `cases` (list of dicts with `scenario`, `steps` (list of Thai strings), `expected`). IDs are generated as `UAT-{prefix}-{NN}`.

```python
"""UAT test-case data for the cafe POS Phase 4 acceptance workbook.

Pure data — no logic. Rendered by generate_uat_workbook.py.
"""

MODULES: list[dict] = [
    {
        "sheet": "3.1 ผู้ใช้และสิทธิ์",
        "prefix": "AUTH",
        "tor": "TOR ข้อ 3.1",
        "cases": [
            {
                "scenario": "เข้าสู่ระบบด้วย PIN ที่ถูกต้อง",
                "steps": ["เปิดแอป", "กรอก PIN ของพนักงานที่มีอยู่", "กดเข้าสู่ระบบ"],
                "expected": "เข้าสู่ระบบสำเร็จ แสดงชื่อและบทบาทของพนักงาน",
            },
            {
                "scenario": "เข้าสู่ระบบด้วย PIN ผิด",
                "steps": ["กรอก PIN ที่ไม่ถูกต้อง", "กดเข้าสู่ระบบ"],
                "expected": "ระบบปฏิเสธ แสดงข้อความแจ้งเตือน ไม่เข้าสู่ระบบ",
            },
            {
                "scenario": "อายุเซสชัน 8 ชั่วโมง (1 กะ)",
                "steps": ["เข้าสู่ระบบ", "ตรวจสอบอายุของเซสชัน/โทเคนที่ได้รับ"],
                "expected": "เซสชันมีอายุ 8 ชั่วโมง เมื่อหมดอายุต้องเข้าสู่ระบบใหม่",
            },
            {
                "scenario": "เจ้าของ (Owner) เข้าถึงรายงานได้",
                "steps": ["เข้าสู่ระบบด้วยบัญชี Owner", "เปิดเมนูรายงานยอดขาย"],
                "expected": "เปิดรายงานได้ครบทุกรายงาน",
            },
            {
                "scenario": "บาริสต้าไม่สามารถยกเลิกออเดอร์ได้",
                "steps": ["เข้าสู่ระบบด้วยบัญชี Barista", "พยายามยกเลิก (Void) ออเดอร์"],
                "expected": "ระบบปฏิเสธ (เฉพาะผู้จัดการ/เจ้าของเท่านั้น)",
            },
            {
                "scenario": "บาริสต้าไม่สามารถจัดการบัญชีพนักงานได้",
                "steps": ["เข้าสู่ระบบด้วยบัญชี Barista", "พยายามเปิดหน้าจัดการพนักงาน"],
                "expected": "ระบบปฏิเสธการเข้าถึง",
            },
            {
                "scenario": "เบเกอร์มีสิทธิ์เทียบเท่าบาริสต้า",
                "steps": ["เข้าสู่ระบบด้วยบัญชี Baker", "รับออเดอร์ 1 รายการ", "เปิดหน้าการผลิต"],
                "expected": "ทำรายการได้เช่นเดียวกับบาริสต้า และเข้าถึงงานผลิตได้",
            },
            {
                "scenario": "พนักงานที่ถูกปิดการใช้งานเข้าสู่ระบบไม่ได้",
                "steps": ["ผู้จัดการปิดการใช้งานบัญชีพนักงาน", "พนักงานคนดังกล่าวพยายามเข้าสู่ระบบ"],
                "expected": "เข้าสู่ระบบไม่ได้",
            },
        ],
    },
    {
        "sheet": "3.2 บุคลากรและการลา",
        "prefix": "HR",
        "tor": "TOR ข้อ 3.2",
        "cases": [
            {
                "scenario": "สร้างบัญชีพนักงานพร้อมข้อมูลครบถ้วน",
                "steps": ["เข้าสู่ระบบเป็นผู้จัดการ", "สร้างพนักงานใหม่: ชื่อ, PIN, บทบาท, ตำแหน่ง, เบอร์โทร, อีเมล, ที่อยู่", "บันทึก"],
                "expected": "สร้างสำเร็จ ข้อมูลแสดงครบทุกช่อง",
            },
            {
                "scenario": "แก้ไขข้อมูลพนักงาน",
                "steps": ["เปิดข้อมูลพนักงานที่มีอยู่", "แก้ไขเบอร์โทรและตำแหน่ง", "บันทึก"],
                "expected": "ข้อมูลอัปเดตถูกต้อง",
            },
            {
                "scenario": "ปิดการใช้งานบัญชีพนักงาน",
                "steps": ["เลือกพนักงาน", "ปิดการใช้งานบัญชี"],
                "expected": "บัญชีถูกปิด พนักงานเข้าสู่ระบบไม่ได้ ข้อมูลเดิมยังคงอยู่",
            },
            {
                "scenario": "ป้องกันเบอร์โทรซ้ำในสาขาเดียวกัน",
                "steps": ["สร้างพนักงานใหม่ด้วยเบอร์โทรที่มีอยู่แล้วในสาขา"],
                "expected": "ระบบปฏิเสธ แจ้งว่าเบอร์โทรซ้ำ",
            },
            {
                "scenario": "ป้องกันอีเมลซ้ำในสาขาเดียวกัน",
                "steps": ["สร้างพนักงานใหม่ด้วยอีเมลที่มีอยู่แล้วในสาขา"],
                "expected": "ระบบปฏิเสธ แจ้งว่าอีเมลซ้ำ",
            },
            {
                "scenario": "พนักงานยื่นคำขอลา",
                "steps": ["เข้าสู่ระบบเป็นพนักงาน", "ยื่นคำขอลา ระบุประเภท (พักร้อน/ป่วย/กิจ/อื่นๆ) และช่วงวันที่"],
                "expected": "คำขอถูกบันทึก สถานะ 'รออนุมัติ'",
            },
            {
                "scenario": "ผู้จัดการอนุมัติคำขอลา",
                "steps": ["เข้าสู่ระบบเป็นผู้จัดการ", "เปิดคำขอลาที่รออนุมัติ", "กดอนุมัติ"],
                "expected": "สถานะเปลี่ยนเป็น 'อนุมัติ' และบันทึกประวัติ",
            },
            {
                "scenario": "ผู้จัดการปฏิเสธคำขอลา",
                "steps": ["เปิดคำขอลาที่รออนุมัติ", "กดปฏิเสธ"],
                "expected": "สถานะเปลี่ยนเป็น 'ปฏิเสธ' และบันทึกประวัติ",
            },
            {
                "scenario": "ดูประวัติการลาย้อนหลัง",
                "steps": ["เปิดหน้าประวัติการลาของพนักงาน"],
                "expected": "เห็นรายการลาทั้งหมดพร้อมสถานะ",
            },
        ],
    },
    {
        "sheet": "3.3 กะงานและงานพนักงาน",
        "prefix": "SHF",
        "tor": "TOR ข้อ 3.3",
        "cases": [
            {
                "scenario": "กำหนดกะทำงานให้พนักงาน",
                "steps": ["เข้าสู่ระบบเป็นผู้จัดการ", "สร้างกะ: เลือกพนักงาน วันเวลาเริ่ม-เลิกงาน", "บันทึก"],
                "expected": "กะถูกบันทึกและแสดงในตาราง",
            },
            {
                "scenario": "กรองดูตารางกะเป็นรายสัปดาห์",
                "steps": ["เปิดตารางกะ", "เลือกช่วงสัปดาห์"],
                "expected": "แสดงเฉพาะกะในสัปดาห์ที่เลือก",
            },
            {
                "scenario": "แก้ไข/ลบกะทำงาน",
                "steps": ["เลือกกะที่มีอยู่", "เปลี่ยนเวลา แล้วบันทึก", "ลบกะอีกรายการหนึ่ง"],
                "expected": "การแก้ไขและการลบมีผลถูกต้อง",
            },
            {
                "scenario": "ผู้จัดการสร้างและมอบหมายงาน",
                "steps": ["สร้างงานใหม่ ระบุรายละเอียดและผู้รับผิดชอบ"],
                "expected": "งานแสดงในรายการของพนักงาน สถานะ 'รอดำเนินการ'",
            },
            {
                "scenario": "สถานะงานครบวงจร",
                "steps": ["พนักงานเปลี่ยนสถานะงาน: รอดำเนินการ → กำลังดำเนินการ → รอการตรวจสอบ", "ผู้จัดการตรวจและปิดงานเป็น 'เสร็จสิ้น'"],
                "expected": "สถานะเปลี่ยนตามลำดับและบันทึกถูกต้อง",
            },
        ],
    },
    {
        "sheet": "3.4 การจัดการเงินสด",
        "prefix": "CSH",
        "tor": "TOR ข้อ 3.4",
        "cases": [
            {
                "scenario": "ผู้จัดการเปิดเซสชันเงินสด (เปิดลิ้นชัก)",
                "steps": ["เข้าสู่ระบบเป็นผู้จัดการ", "เปิดเซสชันเงินสด กรอกยอดเงินเปิด"],
                "expected": "เซสชันเปิดสำเร็จ บันทึกยอดเงินเปิดและเวลา",
            },
            {
                "scenario": "ปิดเซสชันเงินสด (ปิดลิ้นชัก)",
                "steps": ["เปิดเซสชันที่ค้างอยู่", "กรอกยอดเงินปิด แล้วปิดเซสชัน"],
                "expected": "เซสชันปิดสำเร็จ บันทึกยอดเงินปิดและเวลา",
            },
            {
                "scenario": "บาริสต้าไม่สามารถเปิด/ปิดลิ้นชักได้",
                "steps": ["เข้าสู่ระบบเป็นบาริสต้า", "พยายามเปิดเซสชันเงินสด"],
                "expected": "ระบบปฏิเสธ",
            },
            {
                "scenario": "ดูประวัติเซสชันเงินสดย้อนหลัง",
                "steps": ["เปิดรายการเซสชันเงินสด"],
                "expected": "เห็นยอดเงินเปิด-ปิดของแต่ละวัน/กะ",
            },
        ],
    },
]
```

- [ ] **Step 2: Verify the file imports cleanly**

Run from repo root: `uv run --directory api python -c "import sys; sys.path.insert(0, '../tools'); import uat_cases; print(len(uat_cases.MODULES), 'modules')"`
Expected: `4 modules`

- [ ] **Step 3: Commit**

```bash
git add tools/uat_cases.py
git commit -m "docs: UAT case data for TOR modules 3.1-3.4"
```

---

### Task 2: UAT case data — modules §3.5–§3.8

**Files:**
- Modify: `tools/uat_cases.py` (append to `MODULES`)

- [ ] **Step 1: Append the next four module dicts to `MODULES`**

```python
    {
        "sheet": "3.5 เมนูและสูตรวัตถุดิบ",
        "prefix": "MNU",
        "tor": "TOR ข้อ 3.5",
        "cases": [
            {
                "scenario": "สร้างหมวดหมู่สินค้า",
                "steps": ["เข้าสู่ระบบเป็นผู้จัดการ", "สร้างหมวดหมู่ใหม่", "บันทึก"],
                "expected": "หมวดหมู่แสดงในรายการ",
            },
            {
                "scenario": "สร้างสินค้าพร้อมรายละเอียดครบ",
                "steps": ["สร้างสินค้า: ชื่อ, คำอธิบาย, ราคา, หมวดหมู่, สถานะจำหน่าย"],
                "expected": "สินค้าแสดงในเมนูพร้อมราคาถูกต้อง",
            },
            {
                "scenario": "ปิดการจำหน่ายสินค้า",
                "steps": ["แก้ไขสินค้า เปลี่ยนสถานะเป็นไม่จำหน่าย"],
                "expected": "สินค้าไม่ปรากฏ/สั่งไม่ได้ในหน้ารับออเดอร์",
            },
            {
                "scenario": "ผูกสูตรวัตถุดิบเข้ากับสินค้า",
                "steps": ["เปิดสินค้า", "เพิ่มรายการวัตถุดิบและปริมาณที่ใช้ต่อ 1 หน่วยขาย", "บันทึก"],
                "expected": "สูตรถูกบันทึกครบทุกรายการ",
            },
            {
                "scenario": "ขายแล้วตัดสต็อกตามสูตร",
                "steps": ["จดยอดสต็อกวัตถุดิบก่อนขาย", "ขายสินค้าที่มีสูตร 1 รายการ", "ตรวจสอบสต็อกหลังขาย"],
                "expected": "สต็อกวัตถุดิบลดลงตามปริมาณในสูตรพอดี",
            },
            {
                "scenario": "สร้างกลุ่มตัวเลือก (Modifiers) พร้อมราคาเพิ่ม",
                "steps": ["สร้างกลุ่มตัวเลือก เช่น ขนาด/ความหวาน/ท็อปปิ้ง", "เพิ่มตัวเลือกพร้อมราคาบวกเพิ่ม", "ผูกกลุ่มกับสินค้า"],
                "expected": "ตัวเลือกแสดงตอนสั่งสินค้าและบวกราคาถูกต้อง",
            },
            {
                "scenario": "บังคับเลือกตัวเลือกที่จำเป็น",
                "steps": ["ตั้งค่ากลุ่มตัวเลือกเป็น 'บังคับเลือก'", "สั่งสินค้าโดยไม่เลือกตัวเลือก"],
                "expected": "ระบบไม่ให้ยืนยันออเดอร์จนกว่าจะเลือก",
            },
            {
                "scenario": "แก้ไขราคาสินค้า",
                "steps": ["แก้ไขราคาสินค้า", "สั่งสินค้านั้นใหม่"],
                "expected": "ออเดอร์ใหม่ใช้ราคาที่แก้ไขแล้ว ออเดอร์เก่าไม่เปลี่ยน",
            },
        ],
    },
    {
        "sheet": "3.6 คลังสินค้าและรับสินค้า",
        "prefix": "INV",
        "tor": "TOR ข้อ 3.6",
        "cases": [
            {
                "scenario": "ดูสต็อกคงเหลือปัจจุบัน",
                "steps": ["เปิดหน้าคลังสินค้า"],
                "expected": "เห็นรายการวัตถุดิบพร้อมจำนวนคงเหลือและหน่วย",
            },
            {
                "scenario": "ตั้งระดับขั้นต่ำ (Par Level) และแจ้งเตือนสต็อกต่ำ",
                "steps": ["ตั้ง Par Level ของวัตถุดิบให้สูงกว่ายอดคงเหลือ", "เปิดรายงาน/หน้าแจ้งเตือนสต็อกต่ำ"],
                "expected": "วัตถุดิบรายการนั้นปรากฏในรายการสต็อกต่ำ",
            },
            {
                "scenario": "ยืนยันใบรับสินค้าแล้วสต็อกเพิ่ม",
                "steps": ["สร้างใบรับสินค้า (Goods Receipt) ระบุรายการและจำนวน", "ยืนยันใบรับ"],
                "expected": "สต็อกเพิ่มขึ้นตามจำนวนที่รับ",
            },
            {
                "scenario": "บันทึกการรับสินค้าเป็นล็อต พร้อมวันหมดอายุและซัพพลายเออร์",
                "steps": ["สร้างใบรับสินค้า ระบุวันหมดอายุและชื่อซัพพลายเออร์", "ยืนยัน", "เปิดดูรายละเอียดล็อต"],
                "expected": "ล็อตแสดงวันหมดอายุและซัพพลายเออร์ถูกต้อง",
            },
            {
                "scenario": "บันทึกของเสีย (Waste) พร้อมเหตุผล",
                "steps": ["บันทึกของเสีย เลือกวัตถุดิบ จำนวน และเหตุผล (หมดอายุ/หก/ทดลอง/เสียหาย/อื่นๆ)"],
                "expected": "สต็อกลดลงและบันทึกเหตุผลไว้",
            },
            {
                "scenario": "ปรับปรุงยอดสต็อก (Adjustment) พร้อมเหตุผล",
                "steps": ["ทำรายการปรับยอด ระบุจำนวนใหม่และเหตุผล"],
                "expected": "ยอดคงเหลือเปลี่ยนตาม และมีประวัติการปรับยอด",
            },
            {
                "scenario": "ประวัติการเคลื่อนไหวสต็อกแก้ไขย้อนหลังไม่ได้",
                "steps": ["เปิดประวัติการเคลื่อนไหวของวัตถุดิบ", "ตรวจว่าการแก้ยอดทำได้ทางรายการปรับปรุงใหม่เท่านั้น"],
                "expected": "รายการเดิมไม่ถูกลบ/แก้ การแก้ไขปรากฏเป็นรายการปรับยอดใหม่",
            },
        ],
    },
    {
        "sheet": "3.7 คำสั่งซื้อและ KDS",
        "prefix": "ORD",
        "tor": "TOR ข้อ 3.7",
        "cases": [
            {
                "scenario": "รับออเดอร์ทานที่ร้านพร้อมตัวเลือก",
                "steps": ["สร้างออเดอร์ Dine-in", "เพิ่มสินค้าพร้อมตัวเลือก (เช่น ขนาด/ความหวาน)", "ยืนยัน"],
                "expected": "ออเดอร์ถูกสร้าง ราคารวมถูกต้อง (รวมราคาตัวเลือก)",
            },
            {
                "scenario": "รับออเดอร์สั่งกลับ (Takeaway)",
                "steps": ["สร้างออเดอร์ Takeaway", "ยืนยัน"],
                "expected": "ออเดอร์บันทึกประเภทช่องทางถูกต้อง",
            },
            {
                "scenario": "ชำระด้วยเงินสด",
                "steps": ["เปิดออเดอร์สถานะรอดำเนินการ", "เลือกชำระเงินสด"],
                "expected": "สถานะเปลี่ยนเป็น 'ชำระแล้ว' บันทึกวิธีชำระ",
            },
            {
                "scenario": "ชำระด้วยบัตร",
                "steps": ["ชำระออเดอร์ด้วยวิธี 'บัตร'"],
                "expected": "สถานะเปลี่ยนเป็น 'ชำระแล้ว' บันทึกวิธีชำระ",
            },
            {
                "scenario": "ชำระด้วย QR",
                "steps": ["ชำระออเดอร์ด้วยวิธี 'QR'"],
                "expected": "สถานะเปลี่ยนเป็น 'ชำระแล้ว' บันทึกวิธีชำระ",
            },
            {
                "scenario": "สถานะออเดอร์ครบวงจร",
                "steps": ["ไล่สถานะ: รอดำเนินการ → ชำระแล้ว → กำลังทำ → พร้อมส่ง → เสร็จสิ้น"],
                "expected": "เปลี่ยนสถานะได้ตามลำดับ ย้อนกลับ/ข้ามลำดับไม่ได้",
            },
            {
                "scenario": "ออเดอร์ใหม่ขึ้นจอครัว (KDS) ทันทีโดยไม่รีเฟรช",
                "steps": ["เปิดจอ KDS ค้างไว้", "สร้างออเดอร์ใหม่จากเครื่องอื่น"],
                "expected": "ออเดอร์ปรากฏบน KDS ทันทีโดยไม่ต้องรีเฟรชหน้าจอ",
            },
            {
                "scenario": "การเปลี่ยนสถานะสะท้อนบน KDS แบบเรียลไทม์",
                "steps": ["เปลี่ยนสถานะออเดอร์จากเครื่องหนึ่ง", "ดูจอ KDS อีกเครื่อง"],
                "expected": "สถานะบน KDS อัปเดตทันที",
            },
            {
                "scenario": "ผู้จัดการยกเลิกออเดอร์แล้วสต็อกคืนอัตโนมัติ",
                "steps": ["จดสต็อกวัตถุดิบ", "ผู้จัดการ Void ออเดอร์ที่ชำระแล้ว พร้อมเหตุผล", "ตรวจสต็อกอีกครั้ง"],
                "expected": "สถานะเป็น 'ยกเลิก' สต็อกคืนเท่าที่ตัดไป และมีบันทึกการยกเลิก",
            },
        ],
    },
    {
        "sheet": "3.8 สั่งซื้อล่วงหน้า",
        "prefix": "PRE",
        "tor": "TOR ข้อ 3.8",
        "cases": [
            {
                "scenario": "สร้างพรีออเดอร์พร้อมชื่อลูกค้าและวันครบกำหนด",
                "steps": ["สร้างพรีออเดอร์ ระบุลูกค้า วันครบกำหนด และรายการสินค้า"],
                "expected": "พรีออเดอร์ถูกบันทึก สถานะ 'รอดำเนินการ'",
            },
            {
                "scenario": "เพิ่ม/ลบรายการในพรีออเดอร์",
                "steps": ["เปิดพรีออเดอร์", "เพิ่มสินค้า 1 รายการ", "ลบสินค้า 1 รายการ"],
                "expected": "รายการและยอดรวมอัปเดตถูกต้อง",
            },
            {
                "scenario": "ดูสรุปวัตถุดิบที่ต้องใช้",
                "steps": ["เปิดหน้าสรุปวัตถุดิบ (Ingredients) ของพรีออเดอร์"],
                "expected": "แสดงรายการวัตถุดิบรวมตามสูตรของสินค้าทั้งหมดในพรีออเดอร์",
            },
            {
                "scenario": "เริ่มผลิตแล้วตัดสต็อก",
                "steps": ["จดสต็อกวัตถุดิบ", "กด 'เริ่มผลิต'", "ตรวจสต็อก"],
                "expected": "สถานะเป็น 'กำลังดำเนินการ' และสต็อกถูกตัดตามสูตร",
            },
            {
                "scenario": "ปิดงานพรีออเดอร์",
                "steps": ["กด 'เสร็จสิ้น' บนพรีออเดอร์ที่กำลังดำเนินการ"],
                "expected": "สถานะเป็น 'เสร็จสิ้น'",
            },
            {
                "scenario": "ยกเลิกก่อนเริ่มผลิต ไม่กระทบสต็อก",
                "steps": ["สร้างพรีออเดอร์ใหม่", "ยกเลิกทันทีก่อนเริ่มผลิต", "ตรวจสต็อก"],
                "expected": "สถานะเป็น 'ยกเลิก' สต็อกไม่เปลี่ยนแปลง",
            },
        ],
    },
```

- [ ] **Step 2: Verify import**

Run: `uv run --directory api python -c "import sys; sys.path.insert(0, '../tools'); import uat_cases; print(len(uat_cases.MODULES))"`
Expected: `8`

- [ ] **Step 3: Commit**

```bash
git add tools/uat_cases.py
git commit -m "docs: UAT case data for TOR modules 3.5-3.8"
```

---

### Task 3: UAT case data — §3.9–§3.11, technical (§4), and extras

**Files:**
- Modify: `tools/uat_cases.py` (append last three modules to `MODULES`; add `TECH_MODULE` and `EXTRA_MODULE` constants at the end)

- [ ] **Step 1: Append the final three TOR modules to `MODULES`**

```python
    {
        "sheet": "3.9 รายการของที่ต้องซื้อ",
        "prefix": "SHP",
        "tor": "TOR ข้อ 3.9",
        "cases": [
            {
                "scenario": "เพิ่มวัตถุดิบในรายการที่ต้องซื้อ",
                "steps": ["เปิด Shopping List", "เพิ่มรายการพร้อมจำนวน"],
                "expected": "รายการปรากฏใน Shopping List",
            },
            {
                "scenario": "ลบรายการออกจากรายการที่ต้องซื้อ",
                "steps": ["ลบรายการที่มีอยู่"],
                "expected": "รายการหายไปจาก Shopping List",
            },
            {
                "scenario": "ส่งออกข้อความเพื่อนำไปจัดซื้อ",
                "steps": ["กดส่งออก/พิมพ์รายการ"],
                "expected": "ได้ข้อความรายการของที่ต้องซื้อ พร้อมคัดลอก/ส่งต่อได้",
            },
        ],
    },
    {
        "sheet": "3.10 ข้อมูลลูกค้า (CRM)",
        "prefix": "CRM",
        "tor": "TOR ข้อ 3.10",
        "cases": [
            {
                "scenario": "สร้างข้อมูลลูกค้าใหม่",
                "steps": ["สร้างลูกค้า: ชื่อ, เบอร์โทร, อีเมล"],
                "expected": "ลูกค้าถูกบันทึกและค้นหาเจอ",
            },
            {
                "scenario": "ค้นหาลูกค้าด้วยชื่อหรือเบอร์โทร",
                "steps": ["ค้นหาด้วยบางส่วนของชื่อ", "ค้นหาด้วยเบอร์โทร"],
                "expected": "พบลูกค้าที่ตรงเงื่อนไข",
            },
            {
                "scenario": "ดูประวัติการสั่งซื้อย้อนหลังของลูกค้า",
                "steps": ["สร้างออเดอร์ผูกกับลูกค้า", "เปิดหน้าโปรไฟล์ลูกค้า"],
                "expected": "เห็นรายการออเดอร์ล่าสุดของลูกค้า",
            },
            {
                "scenario": "แก้ไขข้อมูลลูกค้า",
                "steps": ["แก้ไขเบอร์โทร/อีเมลของลูกค้า", "บันทึก"],
                "expected": "ข้อมูลอัปเดตถูกต้อง",
            },
        ],
    },
    {
        "sheet": "3.11 รายงานและแดชบอร์ด",
        "prefix": "RPT",
        "tor": "TOR ข้อ 3.11",
        "cases": [
            {
                "scenario": "แดชบอร์ดประจำวันแสดงยอดออเดอร์และรายได้รวม",
                "steps": ["สร้างและชำระออเดอร์อย่างน้อย 1 รายการวันนี้", "เปิดแดชบอร์ดประจำวัน"],
                "expected": "จำนวนออเดอร์และรายได้รวมตรงกับที่ขายจริง",
            },
            {
                "scenario": "รายงานยอดขายแบบรายวัน",
                "steps": ["เปิดรายงานยอดขาย เลือกช่วงวันที่ มุมมองรายวัน"],
                "expected": "ยอดขายแยกตามวันถูกต้อง",
            },
            {
                "scenario": "รายงานยอดขายแบบรายชั่วโมง",
                "steps": ["เลือกมุมมองรายชั่วโมง"],
                "expected": "ยอดขายแยกตามชั่วโมงถูกต้อง",
            },
            {
                "scenario": "รายงานยอดขายแยกตามสินค้า",
                "steps": ["เลือกมุมมองตามสินค้า"],
                "expected": "ยอดขายต่อสินค้าถูกต้อง",
            },
            {
                "scenario": "รายงานยอดขายแยกตามหมวดหมู่",
                "steps": ["เลือกมุมมองตามหมวดหมู่"],
                "expected": "ยอดขายต่อหมวดหมู่ถูกต้อง",
            },
            {
                "scenario": "รายงานยอดขายแยกตามวิธีชำระเงิน",
                "steps": ["เลือกมุมมองตามวิธีชำระเงิน"],
                "expected": "ยอดแยกเงินสด/บัตร/QR ถูกต้อง",
            },
            {
                "scenario": "รายงานต้นทุนสินค้าขาย (COGS)",
                "steps": ["เปิดรายงาน COGS เลือกช่วงวันที่"],
                "expected": "แสดงปริมาณและต้นทุนวัตถุดิบที่ใช้ไป",
            },
            {
                "scenario": "รายงานของเสีย",
                "steps": ["เปิดรายงานของเสีย เลือกช่วงวันที่"],
                "expected": "แสดงของเสียพร้อมเหตุผลและมูลค่า",
            },
            {
                "scenario": "รายงานสต็อกต่ำ",
                "steps": ["เปิดรายงานสต็อกต่ำ"],
                "expected": "แสดงวัตถุดิบที่ต่ำกว่า Par Level",
            },
            {
                "scenario": "รายงานกะแคชเชียร์",
                "steps": ["เปิดรายงานกะแคชเชียร์ เลือกช่วงวันที่"],
                "expected": "แสดงเซสชันเงินสดพร้อมยอดเปิด-ปิด",
            },
        ],
    },
]

TECH_MODULE: dict = {
    "sheet": "ข้อ 4 ข้อกำหนดทางเทคนิค",
    "prefix": "TEC",
    "tor": "TOR ข้อ 4",
    "cases": [
        {
            "scenario": "การแยกข้อมูลระหว่างสาขา (Multi-tenant)",
            "steps": ["เข้าสู่ระบบด้วยพนักงานสาขา A", "ตรวจว่าเห็นเฉพาะออเดอร์/สต็อก/ลูกค้าของสาขา A", "ทำซ้ำกับสาขา B"],
            "expected": "พนักงานแต่ละสาขาเห็นเฉพาะข้อมูลสาขาตนเอง",
        },
        {
            "scenario": "ความแม่นยำของตัวเลขเงินและปริมาณ",
            "steps": ["สร้างออเดอร์ที่มีตัวเลือกราคาบวกเพิ่มหลายรายการ", "ตรวจยอดรวมเทียบการคำนวณด้วยมือ"],
            "expected": "ยอดรวมตรงเป๊ะ ไม่มีเศษทศนิยมคลาดเคลื่อน",
        },
        {
            "scenario": "ประวัติสต็อกแบบ Append-only",
            "steps": ["ทำรายการขาย/รับ/ปรับยอด", "ตรวจประวัติการเคลื่อนไหว"],
            "expected": "ทุกการเปลี่ยนแปลงมีบันทึกถาวร ไม่มีการลบ/แก้รายการเดิม",
        },
        {
            "scenario": "ใช้งานผ่านคลาวด์ (Railway) ได้จากหลายอุปกรณ์",
            "steps": ["เปิดระบบจาก URL จริงบนอุปกรณ์ 2 เครื่องพร้อมกัน"],
            "expected": "ใช้งานได้ปกติทั้งสองเครื่อง ข้อมูลตรงกัน",
        },
    ],
}

# ฟังก์ชันเพิ่มเติมนอกเหนือ TOR — ไม่อยู่ในเกณฑ์การตรวจรับ
EXTRA_MODULE: dict = {
    "sheet": "ฟังก์ชันเพิ่มเติม (นอก TOR)",
    "prefix": "EXT",
    "tor": "นอกเหนือ TOR — ไม่อยู่ในเกณฑ์การตรวจรับ",
    "cases": [
        {
            "scenario": "สมัครสมาชิกลูกค้า (Membership)",
            "steps": ["สมัครสมาชิกด้วยเบอร์โทรลูกค้า"],
            "expected": "ลูกค้ามีบัญชีสมาชิกและแต้มเริ่มต้น",
        },
        {
            "scenario": "สะสมแต้มจากการซื้อ",
            "steps": ["ชำระออเดอร์โดยระบุสมาชิก", "ตรวจแต้ม"],
            "expected": "แต้มเพิ่มตามกติกาโปรแกรม (ต่อบิล/ต่อบาท/ต่อชิ้น)",
        },
        {
            "scenario": "แลกแต้มรับส่วนลด/ของฟรี",
            "steps": ["แลกรางวัลที่ตั้งค่าไว้ในออเดอร์"],
            "expected": "ส่วนลด/ของฟรีถูกใช้และแต้มถูกหัก",
        },
        {
            "scenario": "โปรโมชันส่วนลดเปอร์เซ็นต์",
            "steps": ["ตั้งโปรโมชันลด % แล้วสร้างออเดอร์ที่เข้าเงื่อนไข"],
            "expected": "ส่วนลดคำนวณอัตโนมัติถูกต้อง",
        },
        {
            "scenario": "โปรโมชัน Happy Hour",
            "steps": ["ตั้งช่วงเวลา Happy Hour แล้วสั่งสินค้าในช่วงเวลานั้น"],
            "expected": "ราคา/ส่วนลดมีผลเฉพาะช่วงเวลาที่กำหนด",
        },
        {
            "scenario": "ใบสั่งผลิต (Production Order) เพิ่มสต็อกสินค้าสำเร็จ",
            "steps": ["สร้างใบสั่งผลิตสินค้าประเภท Produced", "ยืนยันการผลิต", "ตรวจสต็อก"],
            "expected": "วัตถุดิบถูกตัด สินค้าสำเร็จเพิ่มเข้าสต็อกพร้อมต้นทุนต่อหน่วย",
        },
        {
            "scenario": "ตรวจนับสต็อก (Stock Take)",
            "steps": ["เปิดรอบตรวจนับ", "กรอกจำนวนที่นับได้จริง", "ปิดรอบ"],
            "expected": "ระบบสร้างรายการปรับยอดตามผลต่างให้อัตโนมัติ",
        },
        {
            "scenario": "QR PromptPay พร้อมยอดเงิน",
            "steps": ["เปิด QR ชำระเงินของออเดอร์"],
            "expected": "QR สแกนได้และยอดเงินตรงกับออเดอร์",
        },
        {
            "scenario": "เลขที่ใบเสร็จและเลขออเดอร์รายวัน",
            "steps": ["สร้างออเดอร์ 2 รายการในวันเดียวกัน", "ตรวจเลขออเดอร์และเลขใบเสร็จ"],
            "expected": "เลขออเดอร์รันต่อเนื่องและรีเซ็ตทุกวัน เลขใบเสร็จรูปแบบ IVppppMMDD-NNNN (พ.ศ.)",
        },
    ],
}
```

- [ ] **Step 2: Verify totals**

Run: `uv run --directory api python -c "import sys; sys.path.insert(0, '../tools'); import uat_cases as u; n=sum(len(m['cases']) for m in u.MODULES); print(len(u.MODULES), n, len(u.TECH_MODULE['cases']), len(u.EXTRA_MODULE['cases']))"`
Expected: `11 73 4 9` (11 TOR modules, 73 contractual cases + 4 technical, 9 extras)

- [ ] **Step 3: Commit**

```bash
git add tools/uat_cases.py
git commit -m "docs: UAT case data for TOR 3.9-3.11, technical reqs, and extras"
```

---

### Task 4: Workbook generator script

**Files:**
- Create: `tools/generate_uat_workbook.py`
- Output: `docs/uat/UAT-cafe-pos.xlsx`

- [ ] **Step 1: Write the generator**

```python
"""Render docs/uat/UAT-cafe-pos.xlsx from uat_cases data.

Usage (repo root): uv run --with openpyxl python tools/generate_uat_workbook.py
"""

from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

from uat_cases import EXTRA_MODULE, MODULES, TECH_MODULE

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = REPO_ROOT / "docs" / "uat" / "UAT-cafe-pos.xlsx"

HEADERS = ["รหัส", "สถานการณ์ทดสอบ", "ขั้นตอน", "ผลที่คาดหวัง", "ผล", "หมายเหตุ", "ผู้ทดสอบ", "วันที่"]
COL_WIDTHS = [14, 38, 48, 42, 10, 24, 16, 12]

HEADER_FILL = PatternFill("solid", fgColor="305496")
HEADER_FONT = Font(bold=True, color="FFFFFF")
TITLE_FONT = Font(bold=True, size=14)
THIN = Side(style="thin", color="999999")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(wrap_text=True, vertical="top")


def build_module_sheet(wb: Workbook, module: dict) -> str:
    ws = wb.create_sheet(module["sheet"][:31])
    ws["A1"] = f"การทดสอบ: {module['sheet']}"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = f"อ้างอิง: {module['tor']}"

    header_row = 4
    for col, (title, width) in enumerate(zip(HEADERS, COL_WIDTHS), start=1):
        cell = ws.cell(row=header_row, column=col, value=title)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.border = BORDER
        ws.column_dimensions[get_column_letter(col)].width = width

    dv = DataValidation(type="list", formula1='"ผ่าน,ไม่ผ่าน"', allow_blank=True)
    ws.add_data_validation(dv)

    for idx, case in enumerate(module["cases"], start=1):
        row = header_row + idx
        steps = "\n".join(f"{i}. {s}" for i, s in enumerate(case["steps"], start=1))
        values = [
            f"UAT-{module['prefix']}-{idx:02d}",
            case["scenario"],
            steps,
            case["expected"],
            "",
            "",
            "",
            "",
        ]
        for col, value in enumerate(values, start=1):
            cell = ws.cell(row=row, column=col, value=value)
            cell.border = BORDER
            cell.alignment = WRAP
        dv.add(ws.cell(row=row, column=5))

    ws.freeze_panes = ws.cell(row=header_row + 1, column=1)
    return ws.title


def build_summary_sheet(wb: Workbook, module_sheets: list[tuple[str, int]]) -> None:
    ws = wb["สรุปผลและลงนาม"]
    ws["A1"] = "สรุปผลการทดสอบระบบ (UAT) — ระบบ POS คาเฟ่ตะวันอ้อมข้าว"
    ws["A1"].font = TITLE_FONT
    ws["A3"] = (
        "เกณฑ์การตรวจรับ: รายการทดสอบในขอบเขต TOR (ข้อ 3.1–3.11 และข้อ 4) "
        "ต้องมีผล 'ผ่าน' ครบทุกรายการ รายการในชีต 'ฟังก์ชันเพิ่มเติม (นอก TOR)' "
        "ไม่อยู่ในเกณฑ์การตรวจรับ"
    )
    ws["A3"].alignment = WRAP
    ws.merge_cells("A3:E3")
    ws.row_dimensions[3].height = 45

    headers = ["โมดูล", "จำนวนข้อทดสอบ", "ผ่าน", "ไม่ผ่าน", "ยังไม่ทดสอบ"]
    header_row = 5
    for col, title in enumerate(headers, start=1):
        cell = ws.cell(row=header_row, column=col, value=title)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.border = BORDER
    widths = [38, 16, 10, 10, 14]
    for col, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(col)].width = width

    for idx, (sheet_name, case_count) in enumerate(module_sheets, start=1):
        row = header_row + idx
        passed = f"COUNTIF('{sheet_name}'!E:E,\"ผ่าน\")"
        failed = f"COUNTIF('{sheet_name}'!E:E,\"ไม่ผ่าน\")"
        ws.cell(row=row, column=1, value=sheet_name).border = BORDER
        ws.cell(row=row, column=2, value=case_count).border = BORDER
        ws.cell(row=row, column=3, value=f"={passed}").border = BORDER
        ws.cell(row=row, column=4, value=f"={failed}").border = BORDER
        ws.cell(row=row, column=5, value=f"={case_count}-{passed}-{failed}").border = BORDER

    sign_row = header_row + len(module_sheets) + 3
    ws.cell(row=sign_row, column=1, value="ผลการตรวจรับ:  [  ] ผ่านการตรวจรับ    [  ] ไม่ผ่านการตรวจรับ")
    for label, col in ((("ผู้ว่าจ้าง"), 1), (("ผู้รับจ้าง"), 4)):
        base = sign_row + 3
        ws.cell(row=base, column=col, value=f"ลงชื่อ ____________________ ({label})")
        ws.cell(row=base + 2, column=col, value="ชื่อ-สกุล ____________________")
        ws.cell(row=base + 4, column=col, value="วันที่ ____________________")


def main() -> None:
    wb = Workbook()
    wb.active.title = "สรุปผลและลงนาม"

    module_sheets: list[tuple[str, int]] = []
    for module in [*MODULES, TECH_MODULE, EXTRA_MODULE]:
        title = build_module_sheet(wb, module)
        if module is not EXTRA_MODULE:
            module_sheets.append((title, len(module["cases"])))

    build_summary_sheet(wb, module_sheets)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT_PATH)
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the generator**

Run from repo root: `uv run --with openpyxl python tools/generate_uat_workbook.py`
Expected: `Wrote ...docs\uat\UAT-cafe-pos.xlsx`

- [ ] **Step 3: Verify the workbook by reading it back**

Run:
```bash
uv run --with openpyxl python -c "from openpyxl import load_workbook; wb = load_workbook('docs/uat/UAT-cafe-pos.xlsx'); print(len(wb.sheetnames)); print(wb.sheetnames[0]); ws = wb['3.7 คำสั่งซื้อและ KDS']; print(ws['A5'].value, '|', ws['E4'].value)"
```
Expected: `14` sheets (summary + 11 TOR + technical + extras), first sheet `สรุปผลและลงนาม`, and `UAT-ORD-01 | ผล`.

- [ ] **Step 4: Open the file manually (spot check)**

Open `docs/uat/UAT-cafe-pos.xlsx` in Excel: check Thai renders, dropdowns work in column ผล, summary formulas show counts, sign-off block present.

- [ ] **Step 5: Commit**

```bash
git add tools/generate_uat_workbook.py docs/uat/UAT-cafe-pos.xlsx
git commit -m "docs: generate Phase 4 UAT acceptance workbook"
```

---

### Task 5: Manual — front matter, บทนำ, and Owner chapter

**Files:**
- Create: `docs/manual/user-manual-th.md`

- [ ] **Step 1: Verify permission facts before writing**

Read the `require_role(...)` declarations in `api/app/api/v1/orders.py`, `reports.py`, `hr.py`, `customers.py`, `inventory.py`, `receipts.py` and note which roles can do what. Known anchors: void = Manager/Owner; sales/COGS/wastage/low-stock/cashier-shift reports = Manager/Owner; dashboard today = any store user; order create/pay/status = all four roles; customer delete = Manager/Owner.

- [ ] **Step 2: Write the document header and Chapter 1 (บทนำ)**

Title page block: `# คู่มือการใช้งานระบบ POS — คาเฟ่ตะวันอ้อมข้าว`, version/date table, document scope note (อ้างอิง TOR + หมายเหตุว่าภาคผนวกเป็นฟังก์ชันเพิ่มเติม).

Chapter 1 sections (each workflow step gets a placeholder box in this exact style):

```markdown
> 🖼 **[ ภาพหน้าจอ: หน้าเข้าสู่ระบบด้วย PIN ]**
```

- **1.1 ภาพรวมระบบ** — server-side POS + staff app, multi-branch, ข้อมูลแยกตามสาขา
- **1.2 การเข้าสู่ระบบ** — PIN ส่วนตัว, เซสชัน 8 ชั่วโมง (1 กะ), การออกจากระบบ, ทำอย่างไรเมื่อลืม PIN (ติดต่อผู้จัดการ)
- **1.3 บทบาทและสิทธิ์** — ตารางสรุป 4 บทบาท × งานหลัก (จากข้อเท็จจริงใน Step 1)
- **1.4 สถานะออเดอร์** — แผนภาพ/ตาราง: รอดำเนินการ → ชำระแล้ว → กำลังทำ → พร้อมส่ง → เสร็จสิ้น (+ ยกเลิก)

- [ ] **Step 3: Write Chapter 2 (เจ้าของร้าน — Owner)**

Sections, each with steps + placeholder boxes:
- **2.1 แดชบอร์ดประจำวัน** — ยอดออเดอร์และรายได้รวมวันนี้
- **2.2 รายงานยอดขาย** — เลือกช่วงวันที่ + 5 มุมมอง (รายวัน / รายชั่วโมง / ตามสินค้า / ตามหมวดหมู่ / ตามวิธีชำระเงิน)
- **2.3 รายงานต้นทุนสินค้าขาย (COGS)** — ปริมาณและต้นทุนวัตถุดิบที่ใช้ เรียงตามจำนวน/ต้นทุน
- **2.4 รายงานของเสีย** — ช่วงวันที่ เหตุผล มูลค่า
- **2.5 รายงานสต็อกต่ำ** — เทียบ Par Level
- **2.6 รายงานกะแคชเชียร์** — เซสชันเงินสด ยอดเปิด-ปิด
- **2.7 การปรับยอดสต็อก** — เมื่อไรควรใช้ ADJUST + บันทึกเหตุผล
- **2.8 หมายเหตุ** — Owner ทำได้ทุกอย่างที่ Manager ทำได้

- [ ] **Step 4: Commit**

```bash
git add docs/manual/user-manual-th.md
git commit -m "docs: user manual intro and Owner chapter (Thai)"
```

---

### Task 6: Manual — Manager chapter

**Files:**
- Modify: `docs/manual/user-manual-th.md` (append Chapter 3)

- [ ] **Step 1: Write Chapter 3 (ผู้จัดการ — Manager)**

Sections with numbered steps + placeholder boxes:
- **3.1 จัดการบัญชีพนักงาน** — สร้าง/แก้ไข/ปิดการใช้งาน; ข้อมูลที่ต้องกรอก (ชื่อ, PIN, บทบาท, ตำแหน่ง, เบอร์โทร, อีเมล, ที่อยู่); กฎเบอร์โทร/อีเมลห้ามซ้ำในสาขา
- **3.2 อนุมัติ/ปฏิเสธการลา** — ประเภทการลา 4 แบบ, ดูประวัติ
- **3.3 ตารางกะทำงาน** — สร้าง/แก้ไข/ลบกะ, มุมมองรายสัปดาห์
- **3.4 มอบหมายงาน (Tasks)** — สร้างงาน, ติดตามสถานะ 4 ขั้น, ตรวจงานที่ 'รอการตรวจสอบ'
- **3.5 เปิด-ปิดลิ้นชักเงินสด** — เปิดเซสชันพร้อมยอดเงินเปิด, ปิดพร้อมยอดเงินปิด, ดูย้อนหลัง
- **3.6 ยกเลิกออเดอร์ (Void)** — เลือกออเดอร์ → ระบุเหตุผล → ยืนยัน; สต็อกคืนอัตโนมัติ; มีบันทึกการยกเลิกเสมอ
- **3.7 รับสินค้าเข้าคลัง (Goods Receipt)** — สร้างใบรับ (DRAFT) → เพิ่มรายการ + วันหมดอายุ + ซัพพลายเออร์ → ยืนยัน (CONFIRMED) → สต็อกเพิ่ม
- **3.8 บันทึกของเสียและปรับยอด** — เหตุผลของเสีย 5 แบบ (หมดอายุ/หก/ทดลอง/เสียหาย/อื่นๆ); การปรับยอดต้องระบุเหตุผล
- **3.9 จัดการเมนู** — หมวดหมู่ → สินค้า (ชื่อ/คำอธิบาย/ราคา/สถานะจำหน่าย) → สูตรวัตถุดิบ (วัตถุดิบ + ปริมาณต่อหน่วยขาย) → กลุ่มตัวเลือก (ราคาเพิ่ม, บังคับเลือก)

- [ ] **Step 2: Commit**

```bash
git add docs/manual/user-manual-th.md
git commit -m "docs: user manual Manager chapter (Thai)"
```

---

### Task 7: Manual — Barista chapter

**Files:**
- Modify: `docs/manual/user-manual-th.md` (append Chapter 4)

- [ ] **Step 1: Write Chapter 4 (บาริสต้า — Barista)**

- **4.1 รับออเดอร์** — เลือกช่องทาง (ทานที่ร้าน/สั่งกลับ), เพิ่มสินค้า, เลือกตัวเลือก (กลุ่มบังคับต้องเลือกก่อนยืนยัน), ยอดรวมคำนวณอัตโนมัติ
- **4.2 รับชำระเงิน** — เงินสด / บัตร / QR; สถานะเปลี่ยนเป็น 'ชำระแล้ว'; เลขใบเสร็จออกอัตโนมัติเมื่อชำระ
- **4.3 จอครัว (KDS)** — ออเดอร์ใหม่ขึ้นทันทีไม่ต้องรีเฟรช; ไล่สถานะ ชำระแล้ว → กำลังทำ → พร้อมส่ง → เสร็จสิ้น
- **4.4 บันทึกของเสีย** — เลือกวัตถุดิบ + จำนวน + เหตุผล
- **4.5 ข้อมูลลูกค้า** — สร้าง/ค้นหา (ชื่อ/เบอร์), เปิดดูประวัติการสั่งซื้อ, แก้ไขข้อมูล (การลบทำได้เฉพาะผู้จัดการ)
- **4.6 รายการของที่ต้องซื้อ** — เพิ่ม/ลบรายการ, ส่งออกข้อความไปจัดซื้อ
- **4.7 รับพรีออเดอร์** — สร้างพรีออเดอร์ (ลูกค้า + วันครบกำหนด + รายการ), แก้ไขรายการ, ยกเลิกก่อนเริ่มผลิต

- [ ] **Step 2: Commit**

```bash
git add docs/manual/user-manual-th.md
git commit -m "docs: user manual Barista chapter (Thai)"
```

---

### Task 8: Manual — Baker chapter + extras appendix

**Files:**
- Modify: `docs/manual/user-manual-th.md` (append Chapter 5 + ภาคผนวก)

- [ ] **Step 1: Write Chapter 5 (เบเกอร์ — Baker)**

- **5.1 สิทธิ์ของเบเกอร์** — เทียบเท่าบาริสต้า + งานผลิต
- **5.2 พรีออเดอร์ฝั่งผลิต** — ดูสรุปวัตถุดิบ → เริ่มผลิต (ตัดสต็อกอัตโนมัติ) → เสร็จสิ้น
- **5.3 การเบิกใช้วัตถุดิบ** — การตัดสต็อกประเภท PRODUCTION_USE และการบันทึกของเสียระหว่างผลิต

- [ ] **Step 2: Write the appendix (ภาคผนวก: ฟังก์ชันเพิ่มเติมนอกเหนือ TOR)**

Open with an explicit note: "ฟังก์ชันในภาคผนวกนี้เป็นส่วนที่พัฒนาเพิ่มเติมนอกเหนือขอบเขต TOR" then short how-to sections:
- **ก.1 ระบบสมาชิกและแต้มสะสม** — สมัคร/ค้นหาสมาชิก, โหมดสะสมแต้ม (ต่อบิล/ต่อบาท/ต่อชิ้น), ระดับสมาชิก (Bronze/Silver/Gold), การแลกรางวัล 3 แบบ
- **ก.2 โปรโมชัน** — 4 ประเภท (ลด %, คอมโบจับคู่, คอมโบตามจำนวน, Happy Hour) และขอบเขต (ทั้งบิล/หมวดหมู่/สินค้า)
- **ก.3 ใบสั่งผลิต** — ผลิตสินค้าประเภท Produced เข้าสต็อก พร้อมต้นทุนต่อหน่วย
- **ก.4 ตรวจนับสต็อก (Stock Take)** — เปิดรอบ → นับ → ระบบปรับยอดผลต่างให้
- **ก.5 QR PromptPay** — สร้าง QR พร้อมยอดเงินของออเดอร์
- **ก.6 เลขออเดอร์รายวันและเลขใบเสร็จ** — เลขออเดอร์รีเซ็ตทุกวัน; เลขใบเสร็จรูปแบบ `IV{ปี พ.ศ.}{MMDD}-{ลำดับ 4 หลัก}` เช่น `IV25690611-0001`

- [ ] **Step 3: Full read-through pass**

Read the entire manual top to bottom: consistent terminology (ออเดอร์/สต็อก/พรีออเดอร์ spelled the same everywhere), every workflow has a placeholder box, no English-only sections.

- [ ] **Step 4: Commit**

```bash
git add docs/manual/user-manual-th.md
git commit -m "docs: user manual Baker chapter and extras appendix (Thai)"
```

---

### Task 9: Convert manual to .docx (and PDF if possible)

**Files:**
- Create: `docs/manual/user-manual-th.docx` (+ `docs/manual/user-manual-th.pdf` if Word available)

- [ ] **Step 1: Check pandoc**

Run: `pandoc --version`
If missing: `winget install --id JohnMacFarlane.Pandoc -e` then open a fresh shell (PATH refresh).

- [ ] **Step 2: Convert to .docx**

Run from repo root:
```bash
pandoc docs/manual/user-manual-th.md -o docs/manual/user-manual-th.docx --toc --toc-depth=2 --metadata title="คู่มือการใช้งานระบบ POS — คาเฟ่ตะวันอ้อมข้าว"
```
Open the .docx and check Thai text + tables render correctly.

- [ ] **Step 3: PDF (conditional — requires MS Word installed)**

Run: `uv run --with docx2pdf python -c "from docx2pdf import convert; convert('docs/manual/user-manual-th.docx')"`
If Word is not installed, skip and note in the handoff that the client/owner can export PDF from Word — the .docx is the deliverable.

- [ ] **Step 4: Commit**

```bash
git add docs/manual/user-manual-th.docx docs/manual/user-manual-th.pdf
git commit -m "docs: user manual .docx/.pdf deliverables"
```

---

### Task 10: Final cross-check against TOR

**Files:**
- Read: `docs/TOR-cafe-pos-proposal-TH.md`, `docs/uat/UAT-cafe-pos.xlsx`, `docs/manual/user-manual-th.md`

- [ ] **Step 1: TOR traceability sweep**

For each TOR requirement line in §3.1–§3.11 and §4, confirm (a) at least one UAT case covers it and (b) the manual documents the workflow. Known coverage from this plan: all 11 modules have sheets and chapters. Fix any gap found by adding the missing case/section and regenerating the workbook (`uv run --with openpyxl python tools/generate_uat_workbook.py`).

- [ ] **Step 2: Run lint (project pre-commit habit)**

Run from `api/`: `uv run ruff check .`
Expected: `All checks passed!` (tools/ scripts are outside api's ruff scope, but run anyway per project habit).

- [ ] **Step 3: Final commit if anything changed**

```bash
git add -A docs/uat docs/manual tools/uat_cases.py
git commit -m "docs: Phase 4 UAT and manual final cross-check fixes"
```
