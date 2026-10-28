import { useMemo, useRef, useState } from 'react';
import { fold, normTag, type Tag } from '../api';

interface Props {
  id: string;
  value: string[];
  onChange: (tags: string[]) => void;
  known: Tag[];
  placeholder?: string;
  onSubmitEmpty?: () => void;
}

/** Champ de tags avec autocomplétion : Entrée, Tab ou virgule pour ajouter, Retour arrière pour retirer */
export function TagInput({ id, value, onChange, known, placeholder = '#…', onSubmitEmpty }: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);

  const options = useMemo(() => {
    const q = fold(text.trim().replace(/^#/, ''));
    const list: { t: string; n?: number; create?: boolean }[] = known
      .filter(k => !value.includes(k.name) && (!q || fold(k.name).includes(q)))
      .sort((a, b) => (fold(a.name).startsWith(q) ? 0 : 1) - (fold(b.name).startsWith(q) ? 0 : 1) || b.count - a.count)
      .slice(0, 8)
      .map(k => ({ t: k.name, n: k.count }));
    const exact = normTag(text);
    if (exact && !known.some(k => k.name === exact) && !value.includes(exact)) list.push({ t: exact, create: true });
    return list;
  }, [text, known, value]);

  function add(raw: string) {
    const next = [...value];
    raw.split(',').forEach(p => {
      const t = normTag(p);
      if (t && !next.includes(t) && next.length < 20) next.push(t);
    });
    onChange(next);
    setText('');
    setActive(-1);
  }

  const show = open && options.length > 0;

  return (
    <div className="ti" onClick={e => { if (e.target === e.currentTarget) input.current?.focus(); }}>
      {value.map((t, i) => (
        <span className="chip" key={t}>
          #{t}
          <button type="button" aria-label={`Retirer ${t}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <svg width="9" height="9" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" /></svg>
          </button>
        </span>
      ))}
      <input
        id={id}
        ref={input}
        value={text}
        autoComplete="off"
        placeholder={value.length ? '' : placeholder}
        aria-label="Tags"
        role="combobox"
        aria-expanded={show}
        aria-autocomplete="list"
        onChange={e => {
          const v = e.target.value;
          if (v.includes(',')) add(v);
          else { setText(v); setActive(v.trim() ? 0 : -1); setOpen(true); }
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => { setOpen(false); if (input.current && input.current.value.trim()) add(input.current.value); }, 120)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' && show) { e.preventDefault(); setActive(a => (a + 1) % options.length); }
          else if (e.key === 'ArrowUp' && show) { e.preventDefault(); setActive(a => (a - 1 + options.length) % options.length); }
          else if (e.key === 'Enter' || e.key === 'Tab') {
            if (show && active >= 0 && options[active]) { e.preventDefault(); add(options[active].t); }
            else if (text.trim()) { e.preventDefault(); add(text); }
            else if (e.key === 'Enter' && onSubmitEmpty) { e.preventDefault(); onSubmitEmpty(); }
          } else if (e.key === 'Escape') setOpen(false);
          else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
      />
      {show && (
        <ul className="sugg" role="listbox">
          {options.map((o, i) => (
            <li
              key={o.t}
              role="option"
              aria-selected={i === active}
              onMouseDown={e => { e.preventDefault(); add(o.t); }}
            >
              {o.create ? <span className="create">Créer #{o.t}</span> : <><span>#{o.t}</span><span className="n">{o.n}</span></>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
