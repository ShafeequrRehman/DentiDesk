// WhatsApp prescription PDF - A4 portrait, laid out to match the printed
// prescription (prescription-a4.ts) as closely as the PDF engine allows:
// same sizes (CSS px x 0.75 = PDF pt), same order, always ONE page.
import { Document, Image, Page, Path, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import type { SavedOrder } from '@/lib/pos-types';
import { getStoreSettings } from '@/lib/pos-settings';
import { PRINT_LOGO_STORAGE_KEY } from '@/lib/print-logo';
import { poweredByLine } from '@/lib/currency';
import { attachColumns, prescriptionData } from '@/lib/prescription-a4';
import { BOOKING_QR_CAPTION, CALL_CAPTION, callNumbers, socialLinks } from '@/lib/slip-extras';

const PHONE_PATH = 'M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z';

const TEAL = '#0e7490';
const PAD_TOP = 34; // 12mm
const PAD_SIDE = 37; // 13mm
const PAD_BOTTOM = 23; // 8mm
const styles = StyleSheet.create({
  page: { paddingTop: PAD_TOP, paddingBottom: PAD_BOTTOM, paddingHorizontal: PAD_SIDE, fontFamily: 'Helvetica', fontSize: 9.75, color: '#111827', flexDirection: 'column' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 9, borderBottomWidth: 2.25, borderColor: TEAL },
  brand: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 22 },
  logo: { maxHeight: 60, maxWidth: 105, objectFit: 'contain', marginRight: 10.5 },
  clinic: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: TEAL, letterSpacing: 0.4 },
  sub: { fontSize: 9, color: '#4b5563', marginTop: 1.5 },
  doc: { width: '40%', alignSelf: 'stretch', borderLeftWidth: 1.5, borderColor: TEAL, paddingLeft: 10.5 },
  docLabel: { fontSize: 7.5, color: '#6b7280', letterSpacing: 1.5 },
  docName: { fontSize: 13.5, fontFamily: 'Helvetica-Bold', color: '#0f172a' },
  docWork: { fontSize: 8.6, color: '#374151', lineHeight: 1.45 },
  docNo: { fontSize: 8.25, color: '#6b7280', marginTop: 4.5 },
  patient: { flexDirection: 'row', marginTop: 10.5, marginBottom: 10.5, paddingVertical: 7.5, paddingHorizontal: 9, backgroundColor: '#f0fdff', borderWidth: 0.75, borderColor: '#cffafe', borderRadius: 7.5 },
  infoBox: { flex: 1, paddingRight: 7.5 },
  infoLabel: { fontSize: 6.75, color: '#6b7280', letterSpacing: 1.1 },
  infoValue: { fontSize: 9.75, fontFamily: 'Helvetica-Bold', marginTop: 1 },
  sectionTitle: { fontSize: 8.25, color: TEAL, letterSpacing: 1.5, fontFamily: 'Helvetica-Bold', marginTop: 7.5, marginBottom: 3 },
  sign: { alignSelf: 'flex-end', width: 165, borderTopWidth: 0.75, borderColor: '#111827', paddingTop: 3 },
  foot: { marginTop: 13.5, paddingTop: 7.5, borderTopWidth: 0.75, borderStyle: 'dashed', borderColor: '#9ca3af', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
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

// "Work As" line with **bold** parts.
function WorkLine({ line, first }: { line: string; first: boolean }) {
  const parts = line.split(/(\*\*.+?\*\*)/g).filter(Boolean);
  return (
    <Text style={[styles.docWork, { marginTop: first ? 3 : 0 }]}>
      {parts.map((part, i) =>
        /^\*\*.+\*\*$/.test(part) ? (
          <Text key={i} style={{ fontFamily: 'Helvetica-Bold', color: TEAL }}>{part.slice(2, -2)}</Text>
        ) : (
          <Text key={i}>{part}</Text>
        ),
      )}
    </Text>
  );
}

export function PrescriptionPdf({ order, qr, images = [], workAs = '' }: { order: SavedOrder; qr?: string | null; images?: string[]; workAs?: string }) {
  const settings = getStoreSettings();
  const data = prescriptionData(order);
  const links = socialLinks(settings);
  const call = callNumbers(settings);
  let logo: string | null = null;
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(PRINT_LOGO_STORAGE_KEY);
    if (raw && /^data:image\/(png|jpe?g);/i.test(raw)) logo = raw;
  } catch {
    logo = null;
  }
  const contact = [settings.receiptAddress, settings.receiptContact].filter(Boolean).join(' · ');
  const workLines = workAs.trim() ? workAs.trim().split('\n') : [];

  // ONE page only (same as the print): estimate how tall the text is,
  // shrink it if needed, and give the attachments the space that is left.
  const USABLE_H = 842 - PAD_TOP - PAD_BOTTOM;
  const USABLE_W = 595 - PAD_SIDE * 2;
  const wrapLines = (text: string, perLine: number) => Math.max(1, Math.ceil(text.length / perLine));
  const hasFoot = Boolean(links.length || qr || call);
  const fixed =
    Math.max(66, 34 + workLines.length * 12.5) + 10 + // header
    52 + // patient box
    (data.services.length ? 15 + wrapLines(data.services.join(', '), 100) * 12 : 0) +
    (data.diagnosis ? 15 + wrapLines(data.diagnosis, 100) * 12 : 0) +
    (hasFoot ? 22 + Math.max(links.length * 11 + 14, (qr ? 96 : 0) + (call ? 22 : 0)) : 0) +
    30; // footer text
  const rxHeight = (k: number) =>
    10.5 * k + 32 * k + 6 * k + data.rxLines.reduce((sum, line) => sum + wrapLines(line, Math.floor(82 / k)) * 20 * k, 0) + 20 * k + 14; // + signature
  const minImages = images.length ? 110 : 0;
  let k = 1;
  while (k > 0.6 && fixed + rxHeight(k) + minImages > USABLE_H) k = Math.round((k - 0.05) * 100) / 100;
  const imageArea = Math.max(minImages, USABLE_H - fixed - rxHeight(k) - 6);
  const cols = attachColumns(images.length);
  const rows = Math.max(1, Math.ceil(images.length / cols));
  const GAP = 4.5;
  const cellW = (USABLE_W - GAP * (cols - 1)) / cols;
  const cellH = Math.max(40, (imageArea - 22 - GAP * (rows - 1)) / rows);

  return (
    <Document title={`Prescription ${data.appointmentNo}`}>
      <Page size="A4" style={styles.page} wrap={false}>
        <View style={styles.head}>
          <View style={styles.brand}>
            {logo ? <Image src={logo} style={styles.logo} /> : null}
            <View style={{ flex: 1 }}>
              <Text style={styles.clinic}>{(settings.receiptHeader || 'Clinic').toUpperCase()}</Text>
              {settings.receiptSubHeader ? <Text style={styles.sub}>{settings.receiptSubHeader}</Text> : null}
              {contact ? <Text style={styles.sub}>{contact}</Text> : null}
            </View>
          </View>
          <View style={styles.doc}>
            {data.withLabel === 'Dr' ? null : <Text style={styles.docLabel}>{data.withLabel.toUpperCase()}</Text>}
            <Text style={styles.docName}>{data.withName || '-'}</Text>
            {workLines.map((line, i) => <WorkLine key={i} line={line} first={i === 0} />)}
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
          <View>
            <Text style={styles.sectionTitle}>SERVICES</Text>
            <Text style={{ fontSize: 9.75 * k }}>{data.services.join(', ')}</Text>
          </View>
        ) : null}
        {data.diagnosis ? (
          <View>
            <Text style={styles.sectionTitle}>DIAGNOSIS / DISEASE</Text>
            <Text style={{ fontSize: 9.75 * k }}>{data.diagnosis}</Text>
          </View>
        ) : null}

        <View style={{ marginTop: 10.5 * k }}>
          <Text style={{ fontSize: 30 * k, fontFamily: 'Times-Bold', color: TEAL }}>
            R<Text style={{ fontSize: 17 * k }}>x</Text>
          </Text>
          {data.rxLines.length ? (
            <View style={{ marginTop: 6 * k, paddingLeft: 6 }}>
              {data.rxLines.map((line, i) => (
                <View key={i} style={{ flexDirection: 'row', fontSize: 11.25 * k, lineHeight: 1.8 }}>
                  <Text style={{ width: 15 * k }}>{i + 1}.</Text>
                  <Text style={{ flex: 1 }}>{line}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={{ fontSize: 10.5, color: '#6b7280', marginTop: 6 }}>-</Text>
          )}
        </View>

        {images.length ? (
          <View style={{ marginTop: 7.5 }}>
            <Text style={styles.sectionTitle}>ATTACHMENTS</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {images.map((src, i) => (
                <View
                  key={i}
                  style={{ width: cellW, height: cellH, marginRight: (i + 1) % cols === 0 ? 0 : GAP, marginBottom: GAP, borderWidth: 0.75, borderColor: '#e5e7eb', borderRadius: 4.5, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Image src={src} style={{ maxWidth: cellW - 4, maxHeight: cellH - 4, objectFit: 'contain' }} />
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Pushes signature + footer to the bottom of the page, like the print */}
        <View style={{ flexGrow: 1 }} />

        <View style={[styles.sign, { marginTop: 19.5 * k }]}>
          <Text style={{ fontSize: 9, textAlign: 'center', color: '#374151' }}>Doctor&apos;s Signature</Text>
        </View>

        {hasFoot ? (
          <View style={styles.foot}>
            <View style={{ flex: 1 }}>
              {links.length ? <Text style={{ fontSize: 8.25, fontFamily: 'Helvetica-Bold', letterSpacing: 1.1, marginBottom: 2 }}>FOLLOW US</Text> : null}
              {links.map((l) => (
                <Text key={l.label} style={{ fontSize: 8.25, color: '#374151', marginTop: 0.75 }}>{l.label}: {l.value}</Text>
              ))}
            </View>
            {qr || call ? (
              <View style={{ alignItems: 'center', width: 170 }}>
                {qr ? <Image src={qr} style={{ width: 82, height: 82 }} /> : null}
                {qr ? <Text style={{ fontSize: 7.5, fontFamily: 'Helvetica-Bold', marginTop: 1.5, textAlign: 'center' }}>{BOOKING_QR_CAPTION}</Text> : null}
                {call ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4.5 }}>
                    <Svg width={8} height={8} viewBox="0 0 24 24"><Path d={PHONE_PATH} fill="#000" /></Svg>
                    <Text style={{ fontSize: 7.5, fontFamily: 'Helvetica-Bold', marginLeft: 3 }}>{CALL_CAPTION}</Text>
                  </View>
                ) : null}
                {call ? <Text style={{ fontSize: 7.5, textAlign: 'center', marginTop: 1.5 }}>{call}</Text> : null}
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={{ marginTop: 6, alignItems: 'center' }}>
          {settings.receiptFooterMessage ? <Text style={{ fontSize: 8.25, fontFamily: 'Helvetica-Bold' }}>{settings.receiptFooterMessage}</Text> : null}
          {poweredByLine() ? <Text style={{ fontSize: 8.25, color: '#6b7280' }}>{poweredByLine()}</Text> : null}
        </View>
      </Page>
    </Document>
  );
}
