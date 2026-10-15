import { useState } from 'react';
import { Trash2, WifiOff, XCircle } from 'lucide-react';
import { cancelOrder } from '@/lib/pos-api';
import { SavedOrder } from '@/lib/pos-types';
import { useToast } from '@/lib/toast';
import { useBackspaceToClose } from '@/lib/keyboard-shortcuts';
import { isDesktopApp } from '@/lib/api';
import { useNetworkStatus } from '@/lib/network-status';
import { getAuthUser } from '@/lib/auth';
import { saveOrderCancelOffline } from '@/lib/offline-order-helpers';
import { triggerBackgroundSync } from '@/lib/offline-sync';

// Shared by SalesPage and RecordPage so both places cancel/delete an order
// the same way. Previously also required the shop's Cancel Order Key
// (bcrypt-checked server-side) before this would go through - the shop
// owner asked to drop that step, so this is now a plain confirm-and-cancel
// action with just an optional reason. Access control still exists: only
// staff with the sales.delete permission ever see the Delete/Cancel button
// that opens this modal, and the backend enforces that same permission
// independently on both the live and offline-replay cancel endpoints (see
// backend/routes/orderRoutes.js) - a Cashier/role without that permission
// can't reach this even by calling the API directly.
export default function CancelOrderModal({
  order,
  onClose,
  onCancelled,
}: {
  order: SavedOrder;
  onClose: () => void;
  onCancelled: (updated: SavedOrder) => void;
}) {
  const { toast } = useToast();
  const { isOnline } = useNetworkStatus();
  // Always local-first inside the desktop app, online or not - cancels
  // instantly on this till (see localOrders.js's "Cancelling an ALREADY-
  // SYNCED order while offline" section) right now instead of waiting on a live cloud round trip, then
  // syncs for real moments later via triggerBackgroundSync (or once back
  // online, if genuinely offline right now).
  const localFirst = isDesktopApp();
  const trulyOffline = isDesktopApp() && !isOnline;
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setSubmitting(true);
    setError('');
    try {
      if (localFirst) {
        const actor = { name: getAuthUser()?.name || getAuthUser()?.username };
        const updated = await saveOrderCancelOffline(order, '', reason.trim() || undefined, actor);
        triggerBackgroundSync();
        toast.success(trulyOffline ? 'Appointment cancelled offline - will sync once back online.' : 'Appointment cancelled.');
        onCancelled(updated);
        return;
      }

      // Only ever reached from a plain browser tab now (no Local Hub to
      // queue into).
      const updated = await cancelOrder(order.id, { reason: reason.trim() || undefined });
      if (updated) {
        onCancelled(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel appointment.');
    } finally {
      setSubmitting(false);
    }
  }

  const orderLabel = order.dailyOrderNumber ?? order.id.slice(-4);

  // Universal Popup-Close Hotkey - see useBackspaceToClose's own comment.
  useBackspaceToClose(onClose);

  return (
    <div className="glass-overlay fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div className="glass-strong w-full max-w-md rounded-[28px] p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-gray-900">Cancel Appointment #{orderLabel}</h2>
            <p className="mt-1 text-xs font-bold text-gray-400">
              This restores this appointment's stock and adjusts dues automatically - it is never deleted, just marked Cancelled.
            </p>
          </div>
          <button type="button" onClick={onClose} className="glass-pill rounded-full p-2.5 text-gray-500 transition hover:bg-white/70 hover:text-gray-900">
            <XCircle size={18} />
          </button>
        </div>

        {localFirst ? (
          <div className="mt-3 flex items-center gap-2 rounded-[14px] bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
            <WifiOff size={14} className="shrink-0" />
            {trulyOffline ? 'Offline - will sync once back online.' : 'Cancels instantly - syncing to the cloud now.'}
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">Reason (optional)</label>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="min-h-24 w-full rounded-2xl border border-white/60 bg-white/50 px-4 py-3 shadow-inner outline-none focus:border-black/40"
              autoFocus
            />
          </div>
        </div>

        {error ? <p className="mt-3 text-sm font-bold text-rose-600">{error}</p> : null}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="glass-pill rounded-2xl py-3 text-sm font-black text-gray-600 transition hover:bg-white/70">
            Back
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            className="flex items-center justify-center gap-2 rounded-2xl border-[0.5px] border-white/40 bg-gradient-to-b from-rose-500 to-rose-700 py-3 text-sm font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-4px_10px_rgba(136,19,55,0.45)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Trash2 size={14} />
            {submitting ? 'Cancelling...' : 'Confirm Cancellation'}
          </button>
        </div>
      </div>
    </div>
  );
}
