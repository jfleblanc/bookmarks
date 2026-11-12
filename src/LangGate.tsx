import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './context';
import { getLang, onLang, setLang } from './i18n';

/** Applique la langue choisie dans le compte, et redessine l'app quand la langue change */
export function LangGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [lang, setState] = useState(getLang);
  useEffect(() => onLang(setState), []);
  const pref = user?.prefs?.lang;
  useEffect(() => { if (pref === 'fr' || pref === 'en') setLang(pref); }, [pref]);
  return <Fragment key={lang}>{children}</Fragment>;
}
