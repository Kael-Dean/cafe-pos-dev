# Handoff: POS Print Setup — ติดตั้งที่ร้านใหม่

## สิ่งที่ต้องมี
- PC (Windows) เชื่อม WiFi ร้าน
- เครื่องปริ้น EPSON TM-T82X เสียบสาย LAN เข้า Router
- iPad เชื่อม WiFi เดียวกัน

---

## ขั้นตอนที่ 1 — ติดตั้ง Tools (ทำครั้งเดียว)

### 1.1 ติดตั้ง Node.js
- โหลดจาก https://nodejs.org → เลือก LTS → ติดตั้ง Next Next Finish

### 1.2 ติดตั้ง Git
- โหลดจาก https://git-scm.com → ติดตั้ง Next Next Finish

### 1.3 เปิด CMD แล้วรัน
```
npm install -g pnpm
```

---

## ขั้นตอนที่ 2 — โหลด Project

```
git clone https://github.com/Kael-Dean/cafe-pos.git C:\POS
```

---

## ขั้นตอนที่ 3 — ตั้งค่า Environment

สร้างไฟล์ `C:\POS\app\.env.local` ใส่แค่นี้:

```
NEXT_PUBLIC_API_BASE_URL=
```

> ทิ้งว่างไว้ — สำคัญมาก ถ้าใส่ URL Railway จะเกิด CORS error

---

## ขั้นตอนที่ 4 — แก้ pnpm workspace config

แก้ไฟล์ `C:\POS\app\pnpm-workspace.yaml` ให้เป็น:

```yaml
onlyBuiltDependencies:
  - '@prisma/client'
  - '@prisma/engines'
  - prisma
  - esbuild
  - bcrypt
  - sharp
  - unrs-resolver
```

---

## ขั้นตอนที่ 5 — Build และ Start

เปิด CMD แล้วรัน:

```
cd C:\POS\app
npm run build
npm start
```

> Build ครั้งแรกใช้เวลา ~3 นาที
> ถ้า build ล้มเหลวด้วย EPERM → ดู **Troubleshooting** ด้านล่าง

---

## ขั้นตอนที่ 6 — ตั้งค่าเครื่องปริ้น

1. เปิด EpsonNet Config → จด IP เครื่องปริ้น (เช่น `192.168.1.x`)
2. เปิด `http://localhost:3000` → ไปหน้า **Hardware**
3. ใส่ IP เครื่องปริ้น → กด **บันทึก**
4. กด **รีเฟรชสถานะ** → ต้องขึ้น "ออนไลน์"
5. กด **ทดสอบพิมพ์** → ใบเสร็จออกมา ✅

---

## ขั้นตอนที่ 7 — ตั้ง Static IP ให้ PC (iPad จะได้ใช้ URL เดิมเสมอ)

1. เข้า router admin (ปกติ `192.168.1.1`)
2. ไปที่ **LAN Configuration → DHCP Static IP**
3. หา MAC address ของ PC: เปิด CMD พิมพ์ `ipconfig /all` → ดู WiFi Physical Address
4. เพิ่ม: MAC = `xx:xx:xx:xx:xx:xx` → IP = `192.168.1.100`
5. Restart PC

---

## ขั้นตอนที่ 8 — ตั้ง Auto-start

Double-click `C:\POS\setup-autostart.bat` → กด Enter → Restart PC
หลังจากนี้ POS จะเปิดอัตโนมัติทุกครั้งที่เปิดคอม

---

## iPad ใช้งาน

เปิด Safari/Chrome แล้วพิมพ์:
```
http://192.168.1.100:3000
```
(ถ้าตั้ง Static IP แล้ว URL นี้จะไม่เปลี่ยน)

---

## เปลี่ยน WiFi ใหม่ (ย้ายร้าน)

1. เปิด EpsonNet Config → จด IP ปริ้นใหม่
2. เปิด `http://localhost:3000` → Hardware → แก้ IP → บันทึก
3. ตั้ง Static IP ใหม่บน router ใหม่ (ขั้นตอนที่ 7)

---

## Troubleshooting

### EPERM error ตอน build
Windows Defender บล็อกไฟล์ใน D: drive → ย้าย project ไป C: แทน (ทำแล้วในขั้นตอนที่ 2)

ถ้ายัง EPERM อยู่:
1. เปิด Windows Security → Virus & threat protection settings → Exclusions
2. Add exclusion → Folder → เลือก `C:\POS`
3. ลบ `.next` folder: `rmdir /s /q C:\POS\app\.next`
4. รัน `npm run build` ใหม่

### pnpm ERR_PNPM_IGNORED_BUILDS
ใช้ `npm run build` แทน `pnpm build` — ทำงานได้เหมือนกัน

### Port 3000 already in use
```
taskkill /F /IM node.exe
npm start
```

### เครื่องปริ้นออฟไลน์
- เช็คไฟ LED ที่ port LAN ของ router
- เปิด EpsonNet Config กด Refresh → IP ตรงกับที่ตั้งไว้ในหน้า Hardware ไหม
- กด "ค้นหา" ในหน้า Hardware เพื่อ scan หา IP ใหม่อัตโนมัติ

---

## ไฟล์สำคัญ

| ไฟล์ | หน้าที่ |
|------|---------|
| `C:\POS\start.bat` | เปิด POS server |
| `C:\POS\setup-autostart.bat` | ตั้ง auto-start ตอน Windows บูท |
| `C:\POS\remove-autostart.bat` | ยกเลิก auto-start |
| `C:\POS\app\.env.local` | ค่า environment variables |
| `C:\POS\app\printer-config.json` | IP เครื่องปริ้น (แก้ผ่านหน้าเว็บได้) |
