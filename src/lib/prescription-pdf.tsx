// WhatsApp prescription PDF - A4 portrait, same layout as the printed
// prescription (prescription-a4.ts).
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { SavedOrder } from '@/lib/pos-types';
import { getStoreSettings } from '@/lib/pos-settings';
import { PRINT_LOGO_STORAGE_KEY } from '@/lib/print-logo';
import { poweredByLine } from '@/lib/currency';
import { prescriptionData } from '@/lib/prescription-a4';
import { BOOKING_QR_CAPTION, socialLinks } from '@/lib/slip-extras';

const TEAL = '#0e7490';
const styles = StyleSheet.create({
  page: { padding: 34, fontFamily: 'Helvetica', fontSize: 11, color: '#111827' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottomWidth: 3, borderColor: TEAL },
  brand: { flexDirection: 'row', alignItems: 'center' },
  logo: { maxHeight: 60, maxWidth: 100, objectFit: 'contain', marginRight: 12 },
  clinic: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: TEAL },
  sub: { fontSize: 9, color: '#4b5563', marginTop: 2 },
  docLabel: { fontSize: 8, color: '#6b7280', textAlign: 'right', letterSpacing: 1.5 },
  docName: { fontSize: 15, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  docNo: { fontSize: 9, color: '#374151', textAlign: 'right', marginTop: 2 },
  patient: { flexDirection: 'row', marginTop: 12, padding: 9, backgroundColor: '#f0fdff', borderWidth: 1, borderColor: '#cffafe', borderRadius: 8 },
  infoBox: { flex: 1, paddingRight: 6 },
  infoLabel: { fontSize: 7, color: '#6b7280', letterSpacing: 1.2 },
  infoValue: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', marginTop: 1 },
  sectionTitle: { fontSize: 8.5, color: TEAL, letterSpacing: 1.5, fontFamily: 'Helvetica-Bold', marginTop: 10, marginBottom: 3 },
  rxSym: { fontSize: 34, fontFamily: 'Times-Bold', color: TEAL, marginTop: 14 },
  rxLine: { fontSize: 12, marginTop: 6, flexDirection: 'row' },
  sign: { marginTop: 36, alignSelf: 'flex-end', width: 180, borderTopWidth: 1, borderColor: '#111827', paddingTop: 3 },
  foot: { marginTop: 18, paddingTop: 8, borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#9ca3af', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});

function Info({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <View style={styles.infoBox}>
      <Text style={styles.infoLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export function PrescriptionPdf({ order, qr }: { order: SavedOrder; qr?: string | null }) {
  const settings = getStoreSettings();
  const data = prescriptionData(order);
  const links = socialLinks(settings);
  let logo: string | null = null;
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(PRINT_LOGO_STORAGE_KEY);
    if (raw && /^data:image\/(png|jpe?g);/i.test(raw)) logo = raw;
  } catch {
    logo = null;
  }
  const contact = [settings.receiptAddress, settings.receiptContact].filter(Boolean).join(' · ');
  return (
    <Document title={`Prescription ${data.appointmentNo}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.head}>
          <View style={styles.brand}>
            {logo ? <Image src={logo} style={styles.logo} /> : null}
            <View>
              <Text style={styles.clinic}>{(settings.receiptHeader || 'Clinic').toUpperCase()}</Text>
              {settings.receiptSubHeader ? <Text style={styles.sub}>{settings.receiptSubHeader}</Text> : null}
              {contact ? <Text style={styles.sub}>{contact}</Text> : null}
            </View>
          </View>
          <View>
            <Text style={styles.docLabel}>{data.withLabel.toUpperCase()}</Text>
            <Text style={styles.docName}>{data.withName || '-'}</Text>
            <Text style={styles.docNo}>Appointment #{data.appointmentNo}</Text>
          </View>
        </View>

        <View style={styles.patient}>
          <Info label="Patient" value={data.patient} />
          <Info label="Phone" value={data.phone} />
          <Info label="Date" value={data.date} />
          <Info label="Checked" value={data.checked} />
        </View>

        {data.services.length ? (
          <>
            <Text style={styles.sectionTitle}>SERVICES</Text>
            <Text>{data.services.join(', ')}</Text>
          </>
        ) : null}
        {data.diagnosis ? (
          <>
            <Text style={styles.sectionTitle}>DIAGNOSIS / DISEASE</Text>
            <Text>{data.diagnosis}</Text>
          </>
        ) : null}

        <Text style={styles.rxSym}>Rx</Text>
        {data.rxLines.length ? (
          data.rxLines.map((line, i) => (
            <View key={i} style={styles.rxLine}>
              <Text style={{ width: 18 }}>{i + 1}.</Text>
              <Text style={{ flex: 1 }}>{line}</Text>
            </View>
          ))
        ) : (
          <Text style={{ color: '#6b7280', marginTop: 6 }}>-</Text>
        )}

        <View style={styles.sign}>
          <Text style={{ fontSize: 9, textAlign: 'center', color: '#374151' }}>Doctor&apos;s Signature</Text>
        </View>

        {links.length || qr ? (
          <View style={styles.foot} wrap={false}>
            <View style={{ flex: 1 }}>
              {links.length ? <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 2 }}>FOLLOW US</Text> : null}
              {links.map((l) => (
                <Text key={l.label} style={{ fontSize: 9, color: '#374151' }}>{l.label}: {l.value}</Text>
              ))}
            </View>
            {qr ? (
              <View style={{ alignItems: 'center', width: 130 }}>
                <Image src={qr} style={{ width: 80, height: 80 }} />
                <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', marginTop: 2, textAlign: 'center' }}>{BOOKING_QR_CAPTION}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={{ marginTop: 8, alignItems: 'center' }}>
          {settings.receiptFooterMessage ? <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold' }}>{settings.receiptFooterMessage}</Text> : null}
          {poweredByLine() ? <Text style={{ fontSize: 8, color: '#6b7280' }}>{poweredByLine()}</Text> : null}
        </View>
      </Page>
    </Document>
  );
}
