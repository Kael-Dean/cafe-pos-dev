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
