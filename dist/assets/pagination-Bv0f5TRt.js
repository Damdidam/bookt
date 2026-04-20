function x({total:e,limit:a,offset:n,onPage:t,label:o}){if(e=parseInt(e)||0,a=parseInt(a)||50,n=parseInt(n)||0,e<=a&&n===0)return"";const l=Math.floor(n/a)+1,i=Math.max(1,Math.ceil(e/a)),p=Math.max(0,n-a),s=n+a,r=n>0,c=s<e,b=`${n+1}–${Math.min(n+a,e)}`;return`<div class="paginate-bar" role="navigation" aria-label="Pagination" style="display:flex;align-items:center;justify-content:center;gap:10px;padding:14px 12px;font-size:.82rem;color:var(--text-3)">
    <button class="btn-outline btn-sm" onclick="${t}(${p})" ${r?"":"disabled"} aria-label="Page précédente" style="${r?"":"opacity:.4;cursor:not-allowed"}">‹</button>
    <span style="min-width:140px;text-align:center">Page <strong>${l}</strong> / ${i} <span style="color:var(--text-4);font-size:.72rem">(${b} sur ${e} ${o||"éléments"})</span></span>
    <button class="btn-outline btn-sm" onclick="${t}(${s})" ${c?"":"disabled"} aria-label="Page suivante" style="${c?"":"opacity:.4;cursor:not-allowed"}">›</button>
  </div>`}export{x as r};
