import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';

interface Props {
  title: string;
  sub?: ReactNode;
  onClose: () => void;
  onSubmit?: (e: FormEvent) => void;
  children: ReactNode;
}

/** Fenêtre modale : Échap ou clic à l'extérieur pour fermer, focus rendu à l'élément d'origine */
export function Modal({ title, sub, onClose, onSubmit, children }: Props) {
  const opener = useRef<Element | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    opener.current = document.activeElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal .sugg')) onClose();
    };
    document.addEventListener('keydown', onKey);
    const first = formRef.current?.querySelector<HTMLElement>('[data-autofocus]') || formRef.current?.querySelector<HTMLElement>('input, textarea, button');
    first?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener.current instanceof HTMLElement && document.contains(opener.current)) opener.current.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="modal-wrap" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form
        ref={formRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        noValidate
        onSubmit={e => { e.preventDefault(); onSubmit?.(e); }}
      >
        <h3>{title}</h3>
        {sub && <p className="sub">{sub}</p>}
        {children}
      </form>
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" className="switch" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="track" />{label}
    </button>
  );
}
