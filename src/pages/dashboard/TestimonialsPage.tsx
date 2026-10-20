// Testimonials: patient pictures and videos the clinic adds here are shown
// on the online appointment page, under the Drs & Services. Upload a
// picture/video from this device, or paste a YouTube / direct link.
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Link2, Loader2, MessageSquareQuote, RefreshCcw, Trash2, Upload } from 'lucide-react';
import { addTestimonialLink, deleteTestimonial, fetchTestimonials, uploadTestimonial, type Testimonial } from '@/lib/pos-api';
import { useToast } from '@/lib/toast';
import TestimonialMedia from '@/components/TestimonialMedia';

const MAX_SIDE = 1600;

// Phone photos are often 5-10 MB - shrink to at most 1600px JPEG first so
// the server stores a small file (GIFs stay as they are, to keep motion).
function shrinkPicture(file: File): Promise<File> {
  if (file.type === 'image/gif') return Promise.resolve(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This file is not a picture.'));
    };
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Could not prepare the picture.'));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => (blob ? resolve(new File([blob], 'testimonial.jpg', { type: 'image/jpeg' })) : reject(new Error('Could not prepare the picture.'))), 'image/jpeg', 0.85);
    };
    img.src = url;
  });
}

export default function TestimonialsPage() {
  const { toast, confirm } = useToast();
  const [items, setItems] = useState<Testimonial[] | null>(null);
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      setItems((await fetchTestimonials()) || []);
    } catch (error) {
      setItems([]);
      toast.error(error instanceof Error ? error.message : 'Could not load testimonials.');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      toast.error('Pick a picture. For a video, paste its YouTube link instead.');
      return;
    }
    setBusy(true);
    try {
      const picture = await shrinkPicture(file);
      if (picture.size > 7.5 * 1024 * 1024) throw new Error('This picture is too large - pick a smaller one.');
      const created = await uploadTestimonial(picture, title.trim());
      if (created) {
        setItems((prev) => [created, ...(prev || [])]);
        setTitle('');
        toast.success('Testimonial added - it now shows on the online appointment page.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleLink() {
    if (!link.trim()) return;
    setBusy(true);
    try {
      const created = await addTestimonialLink(link.trim(), title.trim());
      if (created) {
        setItems((prev) => [created, ...(prev || [])]);
        setLink('');
        setTitle('');
        toast.success('Testimonial added.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add this link.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(item: Testimonial) {
    const ok = await confirm(`Delete this testimonial${item.title ? ` (${item.title})` : ''}? It will be removed from the online page.`, { title: 'Delete testimonial', confirmText: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      await deleteTestimonial(item.id);
      setItems((prev) => (prev || []).filter((t) => t.id !== item.id));
      toast.success('Testimonial deleted.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-black text-gray-900">
            Testimonials <MessageSquareQuote className="text-[#00B0C7]" />
          </h1>
          <p className="text-sm font-bold text-gray-500">Patient pictures and YouTube videos - shown on the online appointment page, under the Drs &amp; Services.</p>
        </div>
        <button type="button" onClick={() => void load()} className="flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-black text-gray-700 shadow-sm ring-1 ring-gray-100 hover:bg-gray-50">
          <RefreshCcw size={15} /> Refresh
        </button>
      </div>

      <div className="space-y-4 rounded-[28px] bg-white p-5 shadow-sm">
        <div className="space-y-1.5">
          <label className="text-xs font-black uppercase tracking-widest text-gray-400">Title (optional)</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="e.g. Ali - braces treatment, 5 stars"
            className="w-full rounded-2xl bg-gray-50 p-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-[#00B0C7]"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-2xl border-2 border-dashed border-gray-200 p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-black text-gray-800"><ImagePlus size={16} /> Upload a picture</p>
            <p className="mb-3 text-[11px] font-bold text-gray-400">JPG, PNG, WEBP or GIF - big photos are made smaller automatically.</p>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
            <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} {busy ? 'Uploading...' : 'Choose file'}
            </button>
          </div>
          <div className="rounded-2xl border-2 border-dashed border-gray-200 p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-black text-gray-800"><Link2 size={16} /> Video - paste a YouTube link</p>
            <p className="mb-3 text-[11px] font-bold text-gray-400">Upload the video on YouTube, then paste its link here (youtube.com, youtu.be or Shorts). A direct picture link also works.</p>
            <div className="flex gap-2">
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://youtu.be/..."
                className="min-w-0 flex-1 rounded-xl bg-gray-50 p-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-[#00B0C7]"
              />
              <button type="button" disabled={busy || !link.trim()} onClick={() => void handleLink()} className="rounded-xl bg-[#00B0C7] px-4 text-sm font-black text-white disabled:opacity-50">
                Add
              </button>
            </div>
          </div>
        </div>
      </div>

      {items === null ? (
        <p className="py-10 text-center text-sm font-bold text-gray-400">Loading...</p>
      ) : items.length === 0 ? (
        <p className="rounded-[28px] bg-white py-12 text-center text-sm font-bold text-gray-400 shadow-sm">No testimonials yet - add a picture or a YouTube video above.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div key={item.id} className="overflow-hidden rounded-[24px] bg-white shadow-sm ring-1 ring-gray-100">
              <div className="aspect-video bg-gray-100">
                <TestimonialMedia kind={item.kind} url={item.url} title={item.title} />
              </div>
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-gray-800">{item.title || (item.kind === 'image' ? 'Picture' : 'Video')}</p>
                  <p className="text-[11px] font-bold text-gray-400">{new Date(item.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                </div>
                <button type="button" onClick={() => void handleDelete(item)} title="Delete" className="rounded-xl bg-rose-50 p-2 text-rose-500 hover:bg-rose-100">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
