# POS Project — Claude Instructions

## Auto-commit & push after every task

After completing any task (code change, fix, feature, refactor), **always** commit and push to GitHub automatically — do not wait for the user to ask.

### Commit message format
```
<type>(<scope>): <short description>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```
Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `style`

### Git workaround (REQUIRED on this machine)

Normal `git add` / `git commit` fail on this Windows machine due to Windows Defender holding `.git/index`. Use the plumbing workaround below every time.

**⚠️ CRITICAL:** `git write-tree` MUST run while `index2` still exists — delete it only after. Running `write-tree` after `Remove-Item index2` writes an empty tree and wipes all files from GitHub.

**Full commit + push (single block — do not split):**
```powershell
$env:GIT_INDEX_FILE = ".git/index2"
Set-Location d:\POS
git read-tree HEAD
git add <files>
$TREE = git write-tree                         # BEFORE removing index2
$PARENT = git rev-parse HEAD
$COMMIT = git commit-tree $TREE -p $PARENT -m "commit message here"
"$COMMIT" | Out-File .git/refs/heads/main -Encoding ascii -NoNewline
Remove-Item .git/index2 -ErrorAction SilentlyContinue
Remove-Item env:GIT_INDEX_FILE -ErrorAction SilentlyContinue
git push origin main
"$COMMIT" | Out-File .git/refs/remotes/origin/main -Encoding ascii -NoNewline
```

### Workflow
1. Finish task
2. Stage only the changed files (not `.git/`, not `node_modules/`)
3. Commit with a meaningful message
4. Push to `origin main`
5. Report the commit hash to the user

> **⚠️ Repo paths (อ่านก่อน commit):**
> - **dev** = `d:\POS-dev` → origin `cafe-pos-dev` (ที่ทำงาน/ทดลอง)
> - **main** = `d:\POS` → origin `cafe-pos` (เว็บจริง, Vercel deploy)
>
> งานปกติในที่นี้ให้ commit เข้า **dev** (`Set-Location d:\POS-dev`). อย่า commit dev เข้า `d:\POS`.

---

## Sync dev → เว็บหลัก (ทริกเกอร์: "ขึ้นเว็บหลัก")

เมื่อผู้ใช้ทดสอบใน dev แล้วไม่ error และพิมพ์ **"ขึ้นเว็บหลัก"** (หรือ "sync to main" / "ขึ้นเว็บจริง"):

**Claude ต้องทำ:**
1. หาไฟล์ที่แก้ในงานล่าสุด — จากไฟล์ที่เพิ่ง edit ในเซสชันนี้ หรือ `git -C d:\POS-dev show --name-only --pretty=format: HEAD`
2. **ไม่เอา**ไฟล์เหล่านี้ขึ้นเว็บหลัก: `*-handoff*.md`, `*.md` ที่เป็น handoff/notes, `package-lock.json`, ไฟล์ทดลอง/planning, อะไรที่อยู่นอก `app/` ที่ไม่เกี่ยวกับฟีเจอร์
3. ยืนยันรายการไฟล์กับผู้ใช้สั้นๆ ก่อนรัน
4. รันสคริปต์ (copy → typecheck ใน `d:\POS\app` → commit → push):
   ```powershell
   d:\POS-dev\sync-to-main.ps1 -Files "app/src/components/screens/pos.tsx","<ไฟล์อื่น>" -Message "feat(pos): ..."
   ```
5. ถ้า typecheck ไม่ผ่าน สคริปต์จะหยุดเอง (ยังไม่ push) — รายงานผู้ใช้แล้วแก้ก่อน
6. รายงาน commit hash ของ `cafe-pos` ให้ผู้ใช้ (Vercel จะ deploy เอง)

**กฎ:** sync เฉพาะไฟล์ที่แก้ (ไม่ mirror ทั้ง repo) และต้องผ่าน typecheck ก่อน push เสมอ
(เอกสารแบบ handoff อย่างเดียวที่ตั้งใจขึ้นเว็บหลักด้วย ใช้ `-SkipBuild` ได้)
