// Medicine expiry: days left and whether it is inside the alert window
// (Medicine Stock page + Dashboard Stock Alerts use the same rule).
export function expiryStatus(ingredient: { expiryDate?: string; expiryAlertDays?: number }) {
  if (!ingredient.expiryDate || !/^\d{4}-\d{2}-\d{2}$/.test(ingredient.expiryDate)) return null;
  const [y, m, d] = ingredient.expiryDate.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysLeft = Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86400000);
  const alertDays = Number(ingredient.expiryAlertDays || 0);
  const dateText = new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const label = daysLeft < 0
    ? `Expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago`
    : daysLeft === 0
      ? 'Expires today'
      : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left · Exp ${dateText}`;
  return { daysLeft, alert: daysLeft < 0 || (alertDays > 0 && daysLeft <= alertDays), label, dateText };
}
