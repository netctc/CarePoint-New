"use client";
import { supportedLocales, useI18n, type Locale } from "@/lib/i18n";
export function LanguageSwitcher() { const { locale, localeLabels, setLocale } = useI18n(); return <label className="language-switcher" aria-label="Application language"><span>🌐</span><select value={locale} onChange={(e)=>setLocale(e.target.value as Locale)}>{supportedLocales.map(item=><option key={item} value={item}>{localeLabels[item]}</option>)}</select></label>; }
