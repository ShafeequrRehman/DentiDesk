// Slips print from a hidden frame inside this page instead of a pop-up
// window. With a pop-up, clicking back on the app while the pop-up's print
// dialog was open hid that dialog behind the app - and the app froze (no
// button worked) until the hidden pop-up was found and closed. A frame's
// print dialog always sits on top of this page, so that can't happen.
//
// Returns a Window, used exactly like the old window.open('', '_blank')
// result: document.open/write/close, focus(), print().
export function openPrintFrame(): Window | null {
  if (typeof document === 'undefined') return null;
  // Only the latest slip's frame is kept.
  document.querySelectorAll('iframe[data-print-frame]').forEach((frame) => frame.remove());
  const frame = document.createElement('iframe');
  frame.setAttribute('data-print-frame', 'true');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
  document.body.appendChild(frame);
  return frame.contentWindow;
}

// Prints once the slip's pictures (logo, QR) have loaded - printing right
// after document.write() can come out without the logo.
export function printWhenReady(win: Window) {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    try {
      win.focus();
      win.print();
    } catch {
      // frame gone - nothing to print
    }
  };
  const pending = Array.from(win.document?.images || []).filter((img) => !img.complete);
  if (pending.length === 0) {
    setTimeout(go, 60);
    return;
  }
  let left = pending.length;
  const one = () => {
    left -= 1;
    if (left <= 0) setTimeout(go, 60);
  };
  pending.forEach((img) => {
    img.addEventListener('load', one, { once: true });
    img.addEventListener('error', one, { once: true });
  });
  setTimeout(go, 2500);
}
