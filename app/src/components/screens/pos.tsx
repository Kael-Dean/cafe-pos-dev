// Thin entry: the POS sale screen lives in ./pos/ (ProductGrid, Cart, sheets …).
// Kept so `import POSTerminal from '@/components/screens/pos'` keeps resolving.
export { default } from './pos/index';
export type { POSTableSession } from './pos/index';
