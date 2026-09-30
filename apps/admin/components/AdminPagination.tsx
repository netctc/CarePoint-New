"use client";

import { useI18n, type Locale } from "@/lib/i18n";

const copy = {
  en: { items:"Items", perPage:"Per page", page:"Page", of:"of", previous:"Previous", next:"Next", showing:"Showing" },
  es: { items:"Elementos", perPage:"Por página", page:"Página", of:"de", previous:"Anterior", next:"Siguiente", showing:"Mostrando" },
  fr: { items:"Éléments", perPage:"Par page", page:"Page", of:"sur", previous:"Précédent", next:"Suivant", showing:"Affichage" },
  ar: { items:"العناصر", perPage:"لكل صفحة", page:"الصفحة", of:"من", previous:"السابق", next:"التالي", showing:"عرض" },
} satisfies Record<Locale,Record<string,string>>;

export function AdminPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizes = [10,25,50,100],
}: {
  page:number;
  pageSize:number;
  total:number;
  onPageChange:(page:number)=>void;
  onPageSizeChange?:((pageSize:number)=>void) | undefined;
  pageSizes?:readonly number[];
}) {
  const {locale}=useI18n(); const t=copy[locale];
  const totalPages=Math.max(1,Math.ceil(total/Math.max(1,pageSize)));
  const safePage=Math.min(Math.max(1,page),totalPages);
  const from=total===0?0:(safePage-1)*pageSize+1;
  const to=Math.min(total,safePage*pageSize);
  return <div className="admin-pagination" aria-label="Pagination">
    <span className="admin-pagination-summary">{t.showing} {from}-{to} / {total} {t.items.toLowerCase()}</span>
    {onPageSizeChange?<label className="admin-pagination-size"><span>{t.perPage}</span><select value={pageSize} onChange={e=>onPageSizeChange(Number(e.target.value))}>{pageSizes.map(size=><option key={size} value={size}>{size}</option>)}</select></label>:null}
    <div className="admin-pagination-nav">
      <button type="button" disabled={safePage<=1} onClick={()=>onPageChange(safePage-1)}>{t.previous}</button>
      <span>{t.page} {safePage} {t.of} {totalPages}</span>
      <button type="button" disabled={safePage>=totalPages} onClick={()=>onPageChange(safePage+1)}>{t.next}</button>
    </div>
  </div>;
}

export function paginateItems<T>(items:readonly T[], page:number, pageSize:number): T[] {
  const start=(Math.max(1,page)-1)*Math.max(1,pageSize);
  return items.slice(start,start+Math.max(1,pageSize));
}

export function clampPage(page:number,total:number,pageSize:number):number{
  return Math.min(Math.max(1,page),Math.max(1,Math.ceil(total/Math.max(1,pageSize))));
}
