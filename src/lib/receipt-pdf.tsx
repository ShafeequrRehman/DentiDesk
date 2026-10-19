// The POS slip as a PDF - same clinic header, "APPOINTMENT NO." block,
// lines and footer as the printed 80mm slip (order-receipt-print.ts), so
// the patient gets on WhatsApp exactly what the clinic prints.
import { Document, Image, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import { createElement } from 'react';
import type { SavedOrder } from '@/lib/pos-types';
import { getStoreSettings } from '@/lib/pos-settings';
import { PRINT_LOGO_STORAGE_KEY } from '@/lib/print-logo';
import { poweredByLine } from '@/lib/currency';
import { buildOrderReceiptLines, type ReceiptLine } from '@/lib/order-receipt-print';

const PAGE_WIDTH = 226; // 80mm
const LINE = 11;
const CHARS_PER_LINE = 40;

const styles = StyleSheet.create({
  page: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 18, fontFamily: 'Courier', fontSize: 8.5, color: '#000' },
  center: { textAlign: 'center' },
  logo: { maxHeight: 60, maxWidth: 140, objectFit: 'contain', marginBottom: 4, alignSelf: 'center' },
  clinic: { fontFamily: 'Courier-Bold', fontSize: 12, textAlign: 'center', marginBottom: 3 },
  small: { textAlign: 'center', fontSize: 8 },
  titleBlock: { borderTopWidth: 3, borderBottomWidth: 3, borderColor: '#000', paddingVertical: 6, marginVertical: 8, alignItems: 'center' },
  title: { fontFamily: 'Courier-Bold', fontSize: 10 },
  titleSub: { fontFamily: 'Courier-Bold', fontSize: 28, marginTop: 2 },
  text: { lineHeight: 1.3 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLeft: { flexShrink: 1, paddingRight: 6 },
  bold: { fontFamily: 'Courier-Bold' },
  dashed: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#000', marginVertical: 5 },
  footer: { marginTop: 12, alignItems: 'center' },
});

function wrapCount(text: string) {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));
}

function estimateHeight(lines: ReceiptLine[], headerLines: number, hasLogo: boolean, footerLines: number) {
  let h = 14 + 18; // padding
  if (hasLogo) h += 66;
  h += 16 + headerLines * LINE; // clinic name + lines
  h += 70; // title block
  for (const line of lines) {
    if (line.kind === 'dashed') h += 11;
    else if (line.kind === 'row') h += LINE * wrapCount(line.left + line.right);
    else h += LINE * wrapCount(line.text) + (line.spaceBefore ? 6 : 0);
  }
  h += 12 + footerLines * LINE + 10;
  return Math.ceil(h);
}

export function OrderReceiptPdf({ order, previousDues }: { order: SavedOrder; previousDues: number }) {
  const settings = getStoreSettings();
  let logo: string | null = null;
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(PRINT_LOGO_STORAGE_KEY);
    // react-pdf draws PNG / JPG only.
    if (raw && /^data:image\/(png|jpe?g);/i.test(raw)) logo = raw;
  } catch {
    logo = null;
  }
  const header = [settings.receiptSubHeader, settings.receiptAddress, settings.receiptContact, settings.receiptPaymentInfo].filter(Boolean) as string[];
  const footer = [settings.receiptFooterMessage, poweredByLine()].filter(Boolean) as string[];
  const lines = buildOrderReceiptLines(order, previousDues);
  const number = String(order.dailyOrderNumber ?? order.id.slice(-3)).padStart(3, '0');
  const height = estimateHeight(lines, header.reduce((n, l) => n + wrapCount(l), 0), !!logo, footer.length);

  return (
    <Document title={`Appointment ${number}`}>
      <Page size={{ width: PAGE_WIDTH, height }} style={styles.page}>
        {logo ? <Image src={logo} style={styles.logo} /> : null}
        <Text style={styles.clinic}>{(settings.receiptHeader || 'Clinic').toUpperCase()}</Text>
        {header.map((l, i) => (
          <Text key={i} style={styles.small}>{l}</Text>
        ))}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>APPOINTMENT NO.</Text>
          <Text style={styles.titleSub}>{number}</Text>
        </View>
        {lines.map((line, i) => {
          if (line.kind === 'dashed') return <View key={i} style={styles.dashed} />;
          if (line.kind === 'row') {
            return (
              <View key={i} style={styles.row}>
                <Text style={[styles.rowLeft, line.bold ? styles.bold : {}]}>{line.left}</Text>
                <Text style={line.bold ? styles.bold : {}}>{line.right}</Text>
              </View>
            );
          }
          return (
            <Text
              key={i}
              style={[
                styles.text,
                line.small ? { fontSize: 7.5, color: '#444' } : {},
                line.indent ? { marginLeft: 10 } : {},
                line.spaceBefore ? { marginTop: 6 } : {},
              ]}
            >
              {line.text}
            </Text>
          );
        })}
        <View style={styles.footer}>
          {footer.map((l, i) => (
            <Text key={i} style={[styles.center, i === 0 && settings.receiptFooterMessage ? styles.bold : {}]}>{l}</Text>
          ))}
        </View>
      </Page>
    </Document>
  );
}

export async function orderReceiptPdfBase64(order: SavedOrder, previousDues: number): Promise<string> {
  const blob = await pdf(createElement(OrderReceiptPdf, { order, previousDues }) as Parameters<typeof pdf>[0]).toBlob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Failed to read PDF'));
    reader.readAsDataURL(blob);
  });
}
