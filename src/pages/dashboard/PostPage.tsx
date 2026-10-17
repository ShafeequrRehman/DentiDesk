// Post page: pick a picture (an offer, a holiday notice, a health tip),
// write a caption, and send it on WhatsApp to every patient at once.
// Sending runs on the server a few seconds apart (backend whatsappRoutes.js
// /broadcast) - numbers that are wrong or not on WhatsApp are skipped
// quietly and only counted.
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ImagePlus, Megaphone, RefreshCcw, Send, X } from 'lucide-react';
import { fetchBroadcast, fetchWhatsappStatus, startBroadcast, type BroadcastJob } from '@/lib/pos-api';
import { useToast } from '@/lib/toast';

const MAX_SIDE = 1600;

// Shrinks a big photo to at most 1600px and re-encodes it as JPEG, so the
// upload stays small (phone photos are often 5-10 MB).
function readAndShrink(file: File): Promise<{ dataUrl: string; mimetype: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the picture.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('This file is not a picture.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Could not prepare the picture.'));
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.85), mimetype: 'image/jpeg' });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export default function PostPage() {
  const { toast, confirm } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [image, setImage] = useState<{ dataUrl: string; mimetype: string } | null>(null);
  const [caption, setCaption] = useState('');
  const [connected, setConnected] = useState<boolean | null>(null);
  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<BroadcastJob | null>(null);

  useEffect(() => {
    fetchWhatsappStatus()
      .then((status) => setConnected(Boolean(status?.isConnected)))
      .catch(() => setConnected(false));
  }, []);

  // Follow the sending progress until it's done.
  useEffect(() => {
    if (!job || job.done) return;
    const id = setInterval(() => {
      fetchBroadcast(job.id)
        .then((next) => {
          if (next) setJob(next);
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(id);
  }, [job]);

  async function pickFile(file: File | undefined) {
    if (!file) return;
    try {
      setImage(await readAndShrink(file));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read the picture.');
    }
  }

  async function handleSend() {
    if (!image) {
      toast.error('Pick a picture first.');
      return;
    }
    const ok = await confirm('Send this post on WhatsApp to every patient with a phone number? It can take a few minutes - you can keep using the app.', {
      title: 'Send post to all patients',
      confirmText: 'Send to all',
    });
    if (!ok) return;
    setStarting(true);
    try {
      const started = await startBroadcast({ imageBase64: image.dataUrl, mimetype: image.mimetype, caption: caption.trim() });
      if (started) {
        setJob(started);
        toast.success(`Sending to ${started.total} patient${started.total === 1 ? '' : 's'}...`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start sending.');
    } finally {
      setStarting(false);
    }
  }

  const processed = job ? job.sent + job.notOnWhatsApp + job.failed : 0;
  const percent = job && job.total > 0 ? Math.round((processed / job.total) * 100) : job?.done ? 100 : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight text-gray-900">
          Post <Megaphone className="text-[#00B0C7]" size={30} />
        </h1>
        <p className="font-bold text-gray-500">Send one picture with a message to all your patients on WhatsApp.</p>
      </div>

      {connected === false ? (
        <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
          WhatsApp is not connected. Link it on the WhatsApp page first, then come back to post.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
        <div className="space-y-4 rounded-[28px] bg-white p-5 shadow-sm sm:p-6">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void pickFile(e.target.files?.[0])} />
          {image ? (
            <div className="relative overflow-hidden rounded-[20px] bg-gray-50">
              <img src={image.dataUrl} alt="Post" className="mx-auto max-h-[420px] w-auto object-contain" />
              <button
                type="button"
                onClick={() => {
                  setImage(null);
                  if (fileRef.current) fileRef.current.value = '';
                }}
                title="Remove picture"
                className="absolute right-3 top-3 rounded-full bg-white/90 p-2 text-gray-600 shadow hover:bg-white"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-64 w-full flex-col items-center justify-center gap-3 rounded-[20px] border-2 border-dashed border-gray-200 bg-gray-50 text-gray-400 transition hover:border-[#00B0C7] hover:text-[#009AAE]"
            >
              <ImagePlus size={42} strokeWidth={1.5} />
              <span className="text-sm font-black">Pick a picture to post</span>
              <span className="text-xs font-semibold">JPG / PNG - big photos are made smaller automatically</span>
            </button>
          )}

          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={4}
            maxLength={1000}
            placeholder="Message (optional) - e.g. 20% off teeth whitening this week. Book: ..."
            className="w-full resize-y rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-[#00B0C7]/40"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-bold text-gray-400">{caption.length}/1000</p>
            <button
              type="button"
              disabled={!image || starting || connected === false || (!!job && !job.done)}
              onClick={() => void handleSend()}
              className="flex items-center gap-2 rounded-full bg-[#00B0C7] px-6 py-3 text-sm font-black text-gray-900 shadow-sm transition hover:bg-[#009AAE] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {starting ? <RefreshCcw size={16} className="animate-spin" /> : <Send size={16} />}
              {starting ? 'Starting...' : 'Send to all patients'}
            </button>
          </div>
        </div>

        <aside className="space-y-4 rounded-[28px] bg-white p-5 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-[0.16em] text-gray-400">Sending</h2>
          {!job ? (
            <p className="text-sm text-gray-400">Nothing sent yet. Your post goes to every patient with a correct WhatsApp number, a few seconds apart.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-black text-gray-900">
                {job.done ? <CheckCircle2 size={18} className="text-emerald-600" /> : <RefreshCcw size={16} className="animate-spin text-[#009AAE]" />}
                {job.done ? 'Done' : `Sending... ${processed} of ${job.total}`}
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-[#00B0C7] transition-all" style={{ width: `${percent}%` }} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-2xl bg-emerald-50 p-3">
                  <p className="text-xl font-black text-emerald-700">{job.sent}</p>
                  <p className="text-[10px] font-black uppercase text-emerald-600">Sent</p>
                </div>
                <div className="rounded-2xl bg-gray-50 p-3">
                  <p className="text-xl font-black text-gray-700">{job.notOnWhatsApp}</p>
                  <p className="text-[10px] font-black uppercase text-gray-500">Not on WhatsApp</p>
                </div>
                <div className="rounded-2xl bg-gray-50 p-3">
                  <p className="text-xl font-black text-gray-700">{job.invalid}</p>
                  <p className="text-[10px] font-black uppercase text-gray-500">No / wrong number</p>
                </div>
                <div className="rounded-2xl bg-rose-50 p-3">
                  <p className="text-xl font-black text-rose-700">{job.failed}</p>
                  <p className="text-[10px] font-black uppercase text-rose-600">Failed</p>
                </div>
              </div>
              <p className="text-[11px] font-semibold text-gray-400">Patients with no number, a wrong number or no WhatsApp are skipped - nothing to fix here.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
