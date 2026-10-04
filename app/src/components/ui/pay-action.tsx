'use client';

import { Button, type ButtonProps } from './button';

export interface PayActionProps
  extends Omit<ButtonProps, 'variant' | 'size' | 'trailing' | 'loading' | 'disabled'> {
  /**
   * `charge` = the one dominant action (primary, 64px, full width) ·
   * `method` = a secondary pay method (outline, 56px).
   */
  kind?: 'charge' | 'method';
  /** Pre-formatted amount shown on the right in tabular figures, e.g. baht(total). */
  amount?: string;
  /** A tap is being processed (spinner, width locked, clicks ignored). */
  pending?: boolean;
  /** When set, the action is unavailable and the reason is announced + shown as a tooltip. */
  disabledReason?: string;
  /** Plain disable without a reason (prefer `disabledReason`). */
  disabled?: boolean;
}

/**
 * POS pay block button. The amount is part of the accessible name, so a screen
 * reader hears "รับเงินสด ฿245".
 *
 *   <PayAction kind="charge" amount={baht(total)} kbd="F12" onClick={charge}>รับเงินสด</PayAction>
 *   <PayAction kind="method" icon={<Icon name="qr" />} onClick={qr}>QR PromptPay</PayAction>
 */
export function PayAction({
  kind = 'charge',
  amount,
  pending = false,
  disabledReason,
  disabled,
  fullWidth,
  ...rest
}: PayActionProps) {
  const isCharge = kind === 'charge';
  return (
    <Button
      {...rest}
      variant={isCharge ? 'primary' : 'secondary'}
      size={isCharge ? 'xl' : 'lg'}
      fullWidth={fullWidth ?? isCharge}
      loading={pending}
      disabled={disabled || !!disabledReason}
      disabledReason={disabledReason}
      trailing={amount ? <span className="ui-btn__amount">{amount}</span> : undefined}
    />
  );
}
