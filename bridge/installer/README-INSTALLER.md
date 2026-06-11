# CafePOS-Printer-Setup.exe — ตัวติดตั้งระบบพิมพ์ "ไฟล์เดียวจบ"

ติดตั้งทุกอย่างที่คอมเครื่องใหม่ต้องใช้เพื่อสั่งพิมพ์ใบเสร็จจากเว็บ ในไฟล์เดียว:
ไดรเวอร์เครื่องพิมพ์ + ตัวเชื่อมเครื่องพิมพ์ (Print Bridge) + ตั้งเป็น Windows service เปิดอัตโนมัติ

> ทำไมต้องลง? หน้าเว็บคุยกับเครื่องพิมพ์ผ่าน `http://127.0.0.1:8080` ซึ่งคือ **เครื่องตัวเอง** เสมอ
> คอมไหนจะพิมพ์ได้ คอมนั้นต้องมี bridge รันอยู่ — เบราว์เซอร์แตะ USB ตรง ๆ ไม่ได้ (กฎความปลอดภัย)

---

## สำหรับลูกค้า / หน้างาน — วิธีติดตั้ง (ทำครั้งเดียวต่อเครื่อง)

1. ต่อสาย USB เครื่องพิมพ์เข้ากับคอม แล้วเปิดเครื่องพิมพ์
2. โหลด **`CafePOS-Printer-Setup.exe`** แล้วดับเบิลคลิก
3. กด **Yes** เมื่อ Windows ถาม (UAC) — ครั้งเดียว
4. หน้าต่างไดรเวอร์จะเด้งขึ้น → กด **Next / ถัดไป / Finish** ในหน้าต่างนั้นจนจบ
   *(ถ้าเครื่องนี้เคยลงไดรเวอร์แล้ว ตอนเริ่มติดตั้งให้เอาเครื่องหมายถูก "ติดตั้งไดรเวอร์" ออก จะข้ามขั้นนี้)*
5. ที่เหลือระบบติดตั้งให้เอง → ขึ้น "ติดตั้งเสร็จเรียบร้อย"
6. เปิดเว็บ POS แล้วลองสั่งพิมพ์ได้เลย

**ถ้าเว็บแจ้งหาเครื่องพิมพ์ไม่เจอ:** เข้าหน้า **ฮาร์ดแวร์** ในเว็บ → เลือกชื่อเครื่องพิมพ์ของเครื่องนี้ (โหมด USB)

**ตรวจว่าพร้อมใช้:** เปิด PowerShell แล้วรัน
```powershell
Invoke-RestMethod http://127.0.0.1:8080/status
```
ต้องได้ `printer: True` (และ `mode: usb`)

---

## สำหรับ dev — วิธี build ใหม่

```powershell
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" "d:\POS-dev\bridge\installer\installer.iss"
# ผลลัพธ์: d:\POS-dev\bridge\dist\CafePOS-Printer-Setup.exe
```

ต้องมี Inno Setup 6 ติดตั้งก่อน (เครื่อง dev นี้ติดตั้งไว้แล้วที่ path ด้านบน)
ถ้าเครื่องใหม่ยังไม่มี: โหลดจาก https://jrsoftware.org/isdl.php แล้วติดตั้ง

### ตัว installer มัดอะไรเข้าไปบ้าง (กำหนดใน `installer.iss`)
| payload | ที่มา (source ปัจจุบัน) |
|---|---|
| ไดรเวอร์ | `d:\POS-dev\BeeprtEx_Printer_Driver_3.3.6.583.exe` |
| Node runtime (`bridge.exe`) | `C:\ProgramData\cafe-pos-bridge\bridge.exe` |
| `server.mjs` (ตัวจริง source of truth) | `d:\POS-dev\bridge\server.mjs` |
| `nssm.exe` | `C:\ProgramData\cafe-pos-bridge\nssm.exe` |
| ตั้ง service | `bridge-service.bat` (NSSM install/start) |
| config เริ่มต้น | `printer-config.default.json` (ลงเฉพาะตอนยังไม่มี — ไม่ทับของเดิม) |

> แก้ `server.mjs` แล้วอยากให้ installer ใหม่ได้ของล่าสุด: build ใหม่ได้เลย (มันอ่านจาก `d:\POS-dev\bridge\server.mjs` โดยตรง)
> เปลี่ยนเวอร์ชัน: แก้ `#define AppVersion` ใน `installer.iss`

### ติดตั้งแบบเงียบ (สำหรับ deploy หลายเครื่อง / สคริปต์)
```powershell
# ลงครบ (ไดรเวอร์จะยังเด้ง GUI เพราะ SFX ไม่รับ flag เงียบ)
CafePOS-Printer-Setup.exe /VERYSILENT
# ลงเฉพาะ bridge (ข้ามไดรเวอร์ — เครื่องที่ลงไดรเวอร์แล้ว)
CafePOS-Printer-Setup.exe /VERYSILENT /TASKS="!installdriver"
```

### แจกจ่าย
ไฟล์ `.exe` ถูก gitignore (ไม่ขึ้น repo) — แจกผ่าน GitHub Release / Google Drive / LINE
```powershell
gh release create bridge-v1.0 "d:\POS-dev\bridge\dist\CafePOS-Printer-Setup.exe"
```

---

## ถอนการติดตั้ง
Settings → Apps → "Cafe POS Print Bridge" → Uninstall (จะหยุด+ลบ service ให้เอง)

## หมายเหตุ
- ไดรเวอร์เป็น 7-Zip SFX ที่ไม่รับ flag ติดตั้งเงียบ → ตั้งใจให้โชว์ wizard ครั้งเดียวเพื่อความชัวร์ทุกเครื่อง
- service ชื่อ `CafePosBridge` พอร์ต `8080` ล็อก log ที่ `C:\ProgramData\cafe-pos-bridge\bridge.log`
- ตัวติดตั้งเดิมแบบ zip (`install.bat`) ยังอยู่ ใช้ได้เหมือนเดิม — ตัวนี้แค่รวบให้เหลือไฟล์เดียว + พ่วงไดรเวอร์
