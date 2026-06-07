// Lets the active screen veto navigation away from itself (e.g. unsaved edits).
// The screen registers a check via setNavGuard(); the app shell calls canLeave()
// before switching screens. The check returns true to allow leaving, false to stay
// — it may prompt the user (window.confirm) to decide.

type LeaveCheck = () => boolean;

let guard: LeaveCheck | null = null;

export function setNavGuard(check: LeaveCheck | null): void {
  guard = check;
}

export function canLeave(): boolean {
  if (!guard) return true;
  try {
    return guard();
  } catch {
    // A throwing guard must never trap the user on a screen.
    return true;
  }
}
