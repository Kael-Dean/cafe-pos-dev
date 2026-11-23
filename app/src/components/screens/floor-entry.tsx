'use client';

import Floor from './floor';
import SelfOrderFloor from './self-order-floor';
import { useSelfOrderingEnabled } from '@/hooks/use-features';

type FloorProps = React.ComponentProps<typeof Floor>;

/**
 * One "floor" screen id, two stores: a self-ordering bar gets the live guest/bill overview
 * (no clocks, no time charge); a board-game café keeps the timed floor plan untouched.
 * The feature query is cached app-wide, so this adds no request.
 */
export default function FloorEntry(props: FloorProps) {
  const { enabled } = useSelfOrderingEnabled();
  return enabled ? <SelfOrderFloor {...props} /> : <Floor {...props} />;
}
