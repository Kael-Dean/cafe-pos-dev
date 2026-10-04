// Design-system primitives used by the login screen. Usage: ./README.md.
// Each primitive imports its own styles (./tokens.css + ./ui.css); app/globals.css
// does not import them, so they cannot affect the legacy screens.
//
// ./skeleton.tsx is a legacy (pre-redesign) helper that the old screens import by
// path ('@/components/ui/skeleton'); it is intentionally not part of this barrel.

export { cn } from './cn';

export { Button } from './button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './button';
export { Spinner } from './spinner';
export type { SpinnerProps } from './spinner';

export { Field, fieldIds } from './field';
export type { FieldProps, FieldIds } from './field';
export { Input } from './input';
export type { InputProps } from './input';
export { Keypad } from './keypad';
export type { KeypadProps, KeypadKey } from './keypad';

export { Banner } from './banner';
export type { BannerProps, BannerTone } from './banner';
