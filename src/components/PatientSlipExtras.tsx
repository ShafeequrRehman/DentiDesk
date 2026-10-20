// Social links + online-booking QR at the bottom of a patient slip (React
// receipts: ThermalReceipt / ItemizedBillReceipt). Same content as
// patientSlipExtrasHtml() in lib/slip-extras.ts.
import { BOOKING_QR_CAPTION, bookingUrl, qrSvg, showBookingQr, socialLinks } from '@/lib/slip-extras';
import type { StoreSettings } from '@/lib/pos-settings';

export default function PatientSlipExtras({ settings }: { settings: StoreSettings }) {
  const links = socialLinks(settings);
  const qr = showBookingQr(settings) ? qrSvg(bookingUrl(), 120) : '';
  if (!links.length && !qr) return null;
  return (
    <div className="mt-3 border-t border-dashed border-black pt-2 text-center">
      {links.length ? (
        <>
          <p className="font-bold">FOLLOW US</p>
          {links.map((link) => (
            <p key={link.label} className="break-all text-[11px]">
              {link.label}: {link.value}
            </p>
          ))}
        </>
      ) : null}
      {qr ? (
        <>
          <div className="mx-auto mt-2 h-[120px] w-[120px]" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="font-bold">{BOOKING_QR_CAPTION}</p>
        </>
      ) : null}
    </div>
  );
}
