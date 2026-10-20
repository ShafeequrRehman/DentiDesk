// One testimonial (picture, video or YouTube) - shared by the
// Testimonials page and the online appointment page.
export default function TestimonialMedia({ kind, url, title }: { kind: 'image' | 'video' | 'youtube'; url: string; title?: string }) {
  if (kind === 'image') {
    return <img src={url} alt={title || 'Testimonial'} loading="lazy" className="h-full w-full object-cover" />;
  }
  if (kind === 'youtube') {
    return (
      <iframe
        src={url}
        title={title || 'Testimonial video'}
        loading="lazy"
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="h-full w-full border-0"
      />
    );
  }
  return <video src={url} controls preload="metadata" playsInline className="h-full w-full bg-black object-contain" />;
}
