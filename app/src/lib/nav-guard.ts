// Lets the active screen veto navigation away from itself (e.g. unsaved edits).
// The screen registers a check via setNavGuard(); the app shell awaits canLeave()
// before switching screens. The check returns true to allow leaving, false to stay
// — it may show a themed confirm dialog (async) to let the user decide.

type LeaveCheck = () => boolean | Promise<boolean>;

let guard: LeaveCheck | null = null;

export function setNavGuard(check: LeaveCheck | null): void {
  guard = check;
}

export async function canLeave(): Promise<boolean> {
  if (!guard) return true;
  try {
    return await guard();
  } catch {
    // A throwing guard must never trap the user on a screen.
    return true;
  }
}
