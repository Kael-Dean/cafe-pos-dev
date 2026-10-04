// @vitest-environment jsdom
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHotkeys, isTypingTarget, DIGIT_CODES, type HotkeyBinding, type UseHotkeysOptions } from './use-hotkeys';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

function Harness({ bindings, options }: { bindings: HotkeyBinding[]; options: UseHotkeysOptions }) {
  useHotkeys(bindings, options);
  return null;
}

function mount(bindings: HotkeyBinding[], options: UseHotkeysOptions = { scope: 'pos' }) {
  act(() => { root.render(createElement(Harness, { bindings, options })); });
}

/** Dispatch a keydown the way a browser does: `code` is the physical key, `key` is layout-dependent. */
function press(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(e); });
  return e;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('isTypingTarget', () => {
  const el = (html: string) => {
    host.innerHTML = html;
    return host.firstElementChild as HTMLElement;
  };
  it.each([
    ['<input type="text">', true],
    ['<input>', true],
    ['<input type="search">', true],
    ['<input type="number">', true],
    ['<textarea></textarea>', true],
    ['<select></select>', true],
    ['<div role="textbox"></div>', true],
    ['<div role="searchbox"></div>', true],
    ['<div role="combobox"></div>', true],
    ['<input type="checkbox">', false],
    ['<input type="radio">', false],
    ['<input type="button">', false],
    ['<button>x</button>', false],
    ['<div></div>', false],
  ])('%s -> %s', (html, typing) => expect(isTypingTarget(el(html))).toBe(typing));

  it('null / non-element targets are not typing', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
  });
});

describe('matching on e.code (Thai Kedmanee layout)', () => {
  it('fires for the physical key even when e.key is a Thai character', () => {
    const handler = vi.fn();
    mount([{ code: 'Digit1', handler }]);
    press({ code: 'Digit1', key: 'ๅ' }); // Thai layout: number row yields Thai glyphs
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire when only e.key matches (key "1" produced by another physical key)', () => {
    const handler = vi.fn();
    mount([{ code: 'Digit1', handler }]);
    press({ code: 'KeyQ', key: '1' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('"/" search key works on Thai layout (Slash code, key = "ฝ")', () => {
    const handler = vi.fn();
    mount([{ code: ['Slash', 'F2'], handler }]);
    press({ code: 'Slash', key: 'ฝ' });
    press({ code: 'F2', key: 'F2' });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('accepts an array of codes (digit row + numpad)', () => {
    const handler = vi.fn();
    mount([{ code: DIGIT_CODES[2], handler }]);
    press({ code: 'Digit3' });
    press({ code: 'Numpad3' });
    press({ code: 'Digit4' });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('calls preventDefault by default and skips it with preventDefault:false', () => {
    mount([{ code: 'F12', handler: vi.fn() }, { code: 'F8', preventDefault: false, handler: vi.fn() }]);
    expect(press({ code: 'F12' }).defaultPrevented).toBe(true);
    expect(press({ code: 'F8' }).defaultPrevented).toBe(false);
  });
});

describe('modifiers', () => {
  it('a plain binding does not fire when Ctrl / Alt / Shift is held', () => {
    const handler = vi.fn();
    mount([{ code: 'KeyE', handler }]);
    press({ code: 'KeyE', ctrlKey: true });
    press({ code: 'KeyE', altKey: true });
    press({ code: 'KeyE', shiftKey: true });
    expect(handler).not.toHaveBeenCalled();
    press({ code: 'KeyE' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ctrl:true requires Ctrl or Meta', () => {
    const handler = vi.fn();
    mount([{ code: 'Enter', ctrl: true, handler }]);
    press({ code: 'Enter' });
    expect(handler).not.toHaveBeenCalled();
    press({ code: 'Enter', ctrlKey: true });
    press({ code: 'Enter', metaKey: true });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('shift:true requires Shift (the "?" cheat sheet = Shift+Slash) and plain Slash is distinct', () => {
    const cheat = vi.fn();
    const search = vi.fn();
    mount([{ code: 'Slash', shift: true, handler: cheat }, { code: 'Slash', handler: search }]);
    press({ code: 'Slash', shiftKey: true });
    press({ code: 'Slash' });
    expect(cheat).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("shift:'any' ignores Shift (+ is Shift+Equal on most layouts)", () => {
    const handler = vi.fn();
    mount([{ code: ['Equal', 'NumpadAdd'], shift: 'any', handler }]);
    press({ code: 'Equal' });
    press({ code: 'Equal', shiftKey: true });
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe('typing guard', () => {
  function withInput(type = 'text') {
    const input = document.createElement('input');
    input.type = type;
    document.body.appendChild(input);
    input.focus();
    return input;
  }

  it('plain keys are ignored while typing in a field', () => {
    const handler = vi.fn();
    mount([{ code: 'KeyE', handler }, { code: 'Digit1', handler }, { code: 'Slash', handler }, { code: 'Delete', handler }]);
    const input = withInput();
    for (const code of ['KeyE', 'Digit1', 'Slash', 'Delete']) press({ code }, input);
    expect(handler).not.toHaveBeenCalled();
  });

  it('Escape, Enter, NumpadEnter, F-keys and Ctrl combos DO pass through a text field', () => {
    const handler = vi.fn();
    mount([
      { code: 'Escape', handler }, { code: 'Enter', handler }, { code: 'NumpadEnter', handler },
      { code: 'F12', handler }, { code: 'F2', handler }, { code: 'KeyK', ctrl: true, handler },
    ]);
    const input = withInput();
    press({ code: 'Escape' }, input);
    press({ code: 'Enter' }, input);
    press({ code: 'NumpadEnter' }, input);
    press({ code: 'F12' }, input);
    press({ code: 'F2' }, input);
    press({ code: 'KeyK', ctrlKey: true }, input);
    expect(handler).toHaveBeenCalledTimes(6);
  });

  it('blockInInput beats the Ctrl exception (Ctrl+Backspace deletes a word in a field)', () => {
    const handler = vi.fn();
    mount([{ code: 'Backspace', ctrl: true, blockInInput: true, handler }]);
    const input = withInput();
    press({ code: 'Backspace', ctrlKey: true }, input);
    expect(handler).not.toHaveBeenCalled();
    press({ code: 'Backspace', ctrlKey: true }); // outside a field it fires
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('allowInInput opts a plain key into typing contexts', () => {
    const handler = vi.fn();
    mount([{ code: 'KeyE', allowInInput: true, handler }]);
    press({ code: 'KeyE' }, withInput());
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a focused checkbox / button is not a typing target, plain keys still fire', () => {
    const handler = vi.fn();
    mount([{ code: 'Digit1', handler }]);
    press({ code: 'Digit1' }, withInput('checkbox'));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('guards: modal, IME, repeat, enabled', () => {
  it('stands down while an aria-modal dialog is open (unless allowWithModal)', () => {
    const handler = vi.fn();
    mount([{ code: 'F12', handler }]);
    const dlg = document.createElement('div');
    dlg.setAttribute('aria-modal', 'true');
    document.body.appendChild(dlg);
    press({ code: 'F12' });
    expect(handler).not.toHaveBeenCalled();

    mount([{ code: 'F12', handler }], { scope: 'payment', allowWithModal: true });
    press({ code: 'F12' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignores IME composition and keyCode 229', () => {
    const handler = vi.fn();
    mount([{ code: 'Enter', handler }]);
    press({ code: 'Enter', isComposing: true });
    press({ code: 'Enter', keyCode: 229 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores auto-repeat unless the binding opts in', () => {
    const once = vi.fn();
    const rep = vi.fn();
    mount([{ code: 'Delete', handler: once }, { code: 'Equal', repeat: true, handler: rep }]);
    press({ code: 'Delete', repeat: true });
    press({ code: 'Equal', repeat: true });
    expect(once).not.toHaveBeenCalled();
    expect(rep).toHaveBeenCalledTimes(1);
  });

  it('per-binding enabled:false and the master switch both disable', () => {
    const a = vi.fn();
    mount([{ code: 'F4', enabled: false, handler: a }]);
    press({ code: 'F4' });
    expect(a).not.toHaveBeenCalled();

    mount([{ code: 'F4', handler: a }], { scope: 'pos', enabled: false });
    press({ code: 'F4' });
    expect(a).not.toHaveBeenCalled();
  });

  it('skips an event another handler already prevented', () => {
    const handler = vi.fn();
    mount([{ code: 'F4', handler }]);
    const e = new KeyboardEvent('keydown', { code: 'F4', bubbles: true, cancelable: true });
    e.preventDefault();
    act(() => { document.body.dispatchEvent(e); });
    expect(handler).not.toHaveBeenCalled();
  });

  it('first matching binding wins (no double handling)', () => {
    const first = vi.fn();
    const second = vi.fn();
    mount([{ code: 'F9', handler: first }, { code: 'F9', handler: second }]);
    press({ code: 'F9' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('uses the latest handler after a re-render (no stale closure) and unsubscribes on unmount', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    mount([{ code: 'F9', handler: h1 }]);
    mount([{ code: 'F9', handler: h2 }]);
    press({ code: 'F9' });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    press({ code: 'F9' });
    expect(h2).toHaveBeenCalledTimes(1);
    root = createRoot(host); // so afterEach can unmount cleanly
  });
});
