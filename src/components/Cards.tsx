import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { shortDate, type Bookmark } from '../api';

const favColor = (d: string) => {
  let h = 0;
  for (const c of d) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360},55%,40%)`;
};

function Favicon({ url, domain }: { url: string | null; domain: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return <img className="fav-img" src={url} alt="" width={14} height={14} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  }
  return <span className="fav" style={{ background: favColor(domain) }} aria-hidden="true">{domain.charAt(0).toUpperCase()}</span>;
}

/** Indicateur de chargement : un anneau qui tourne */
export function Spinner({ label }: { label: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Thumb({ item }: { item: Pick<Bookmark, 'thumbUrl' | 'thumbRatio' | 'status' | 'domain' | 'url'> }) {
  const ratio = item.thumbRatio || 0.75;
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // Nouvelle image : on repart de l'indicateur, sauf si elle est déjà en cache (complète avant que React n'écoute « load »)
  useEffect(() => {
    setFailed(false);
    setLoaded(!!(img.current?.complete && img.current.naturalWidth));
  }, [item.thumbUrl]);

  const box = { aspectRatio: `1 / ${ratio}` };
  if (item.status === 'processing') {
    return <div className="thumb loading" style={box}><Spinner label="Capture en cours" /></div>;
  }
  if (!item.thumbUrl || failed) {
    return <a className="thumb empty" href={item.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true" style={box}><span>{item.domain}</span></a>;
  }
  return (
    <a className={`thumb${loaded ? '' : ' loading'}`} href={item.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true" style={box}>
      {!loaded && <Spinner label="Chargement de la vignette" />}
      <img ref={img} src={item.thumbUrl} alt="" loading="lazy" width={400} height={Math.round(400 * ratio)}
        className={loaded ? 'in' : ''} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
    </a>
  );
}

export type CardMode = 'library' | 'owner' | 'public';

interface CardProps {
  item: Bookmark;
  mode: CardMode;
  activeTags?: Set<string>;
  onTag?: (t: string) => void;
  selecting?: boolean;
  picked?: boolean;
  onPick?: () => void;
  actions?: ReactNode;
  flash?: boolean;
}

export function BookmarkCard({ item, mode, activeTags, onTag, selecting, picked, onPick, actions, flash }: CardProps) {
  const processing = item.status === 'processing';
  return (
    <article
      className={`card${mode === 'public' ? ' static' : ''}${selecting ? ' selecting' : ''}${picked ? ' picked' : ''}${flash ? ' flash' : ''}`}
      onClickCapture={selecting ? e => { e.preventDefault(); e.stopPropagation(); onPick?.(); } : undefined}
    >
      {selecting && (
        <label className="pick" title="Sélectionner">
          <input type="checkbox" checked={!!picked} readOnly aria-label={`Sélectionner ${item.title || item.domain}`} />
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" /></svg>
        </label>
      )}
      <Thumb item={item} />
      <div className="meta">
        <span className="dom"><Favicon url={item.faviconUrl} domain={item.domain} />{item.domain}</span>
        {mode === 'library' && <span>{shortDate(item.createdAt)}</span>}
      </div>
      <h3 className="title">
        {processing && !item.title
          ? <span className="pending">Extraction du titre…</span>
          : <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title || item.domain}</a>}
      </h3>
      {item.status === 'error' && <p className="card-err">{item.error || 'Capture impossible.'}</p>}
      {item.note && mode !== 'public' && <p className="card-note">{item.note}</p>}
      {item.tags.length > 0 && (
        <div className="tags">
          {item.tags.map(t =>
            onTag
              ? <button type="button" key={t} className={`tag${activeTags?.has(t) ? ' on' : ''}`} onClick={() => onTag(t)}>#{t}</button>
              : <span key={t} className="tag">#{t}</span>
          )}
        </div>
      )}
      {actions && !selecting && <div className="acts">{actions}</div>}
    </article>
  );
}

/** Mosaïque : répartit les cartes dans la colonne la moins haute (ordre conservé de gauche à droite) */
export function Masonry<T extends { id: string; thumbRatio?: number; tags?: string[] }>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const w = width || 900;
  const gap = w < 600 ? 16 : 24;
  const n = Math.max(1, Math.min(5, Math.floor((w + gap) / (w < 600 ? 160 : 230))));
  const colW = (w - (n - 1) * gap) / n;
  const cols: { h: number; items: T[] }[] = Array.from({ length: n }, () => ({ h: 0, items: [] }));
  for (const it of items) {
    const c = cols.reduce((a, b) => (b.h < a.h ? b : a));
    c.items.push(it);
    c.h += colW * (it.thumbRatio || 0.75) + 110 + Math.ceil((it.tags?.length || 0) / 3) * 22;
  }
  return (
    <div className="grid" ref={ref}>
      {cols.map((c, i) => <div className="col" key={i}>{c.items.map(render)}</div>)}
    </div>
  );
}

/** Déclenche onVisible quand l'élément approche de l'écran (défilement infini) */
export function Sentinel({ onVisible, disabled }: { onVisible: () => void; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    if (disabled || !ref.current) return;
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) cb.current(); }, { rootMargin: '600px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [disabled]);
  return <div className="sentinel" ref={ref} />;
}
