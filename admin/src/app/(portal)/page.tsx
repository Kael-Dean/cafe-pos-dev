import { redirect } from 'next/navigation';

/** The portal has no dashboard — the client list is the home screen. */
export default function PortalIndex() {
  redirect('/tenants');
}
