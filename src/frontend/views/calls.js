/**
 * Calls (Appels / Call Filter) view module.
 */
import { api, GendaUI, viewState } from '../state.js';
import { esc } from '../utils/dom.js';
import { bridge } from '../utils/window-bridge.js';

function formatPhoneDisplay(phone){
  if(!phone)return '';
  const p=phone.replace(/\s/g,'');
  if(p.startsWith('+32')&&p.length===12) return `+32 ${p.slice(3,6)} ${p.slice(6,8)} ${p.slice(8,10)} ${p.slice(10)}`;
  if(p.startsWith('+33')&&p.length===12) return `+33 ${p.slice(3,4)} ${p.slice(4,6)} ${p.slice(6,8)} ${p.slice(8,10)} ${p.slice(10)}`;
  return phone;
}

async function loadCalls(){
  const c=document.getElementById('contentArea');
  c.innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  try{
    const[setR,wlR,logR,blR,vmR,usR]=await Promise.all([
      api.get('/api/calls/settings'),
      api.get('/api/calls/whitelist'),
      api.get('/api/calls/logs'),
      api.get('/api/calls/blacklist').catch(()=>({})),
      api.get('/api/calls/voicemails').catch(()=>({})),
      api.get('/api/calls/usage').catch(()=>({}))
    ]);
    const cs=setR.settings||{};
    const wl=wlR.whitelist||[];
    const logs=logR.logs||[];
    const st=logR.stats||{};
    const bl=blR.blacklist||[];
    const vms=vmR.voicemails||[];
    const vmUnread=vmR.unread||0;
    const usage=usR;

    // Usage gauge
    let h='';
    if(usage && usage.quota > 0){
      const pct=Math.min(usage.percent||0,100);
      const callPct=usage.quota>0?Math.round((usage.usage?.calls||0)/usage.quota*100):0;
      const smsPct=usage.quota>0?Math.round((usage.usage?.sms||0)/usage.quota*100):0;
      const isWarn=pct>=80;const isOver=pct>=100;
      const barCol=isOver?'#dc2626':isWarn?'#F59E0B':'var(--primary)';
      h+=`<div class="card" style="margin-bottom:16px;${isOver?'border:2px solid #dc2626;background:#fef2f2':''}">`;
      h+=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">`;
      h+=`<div><span style="font-size:.85rem;font-weight:700"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg> Consommation du mois</span><span style="font-size:.75rem;color:var(--text-4);margin-left:8px">Plan ${(usage.plan||'').toUpperCase()}</span></div>`;
      h+=`<div style="font-size:1.1rem;font-weight:800;color:${barCol}">${usage.usage?.total||0} <span style="font-size:.8rem;font-weight:500;color:var(--text-4)">/ ${usage.quota} unit\u00e9s</span></div>`;
      h+=`</div>`;
      h+=`<div style="height:24px;background:#f1f5f9;border-radius:12px;overflow:hidden;position:relative;margin-bottom:10px">`;
      h+=`<div style="position:absolute;left:0;top:0;height:100%;width:${Math.min(callPct,100)}%;background:var(--primary);transition:width .5s;border-radius:12px 0 0 12px" title="Appels: ${usage.usage?.calls||0}"></div>`;
      h+=`<div style="position:absolute;left:${Math.min(callPct,100)}%;top:0;height:100%;width:${Math.min(smsPct,100-Math.min(callPct,100))}%;background:#15803d;transition:width .5s" title="SMS: ${usage.usage?.sms||0}"></div>`;
      if(pct>=100)h+=`<div style="position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:.7rem;font-weight:700;color:#fff"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> D\u00c9PASS\u00c9</div>`;
      h+=`</div>`;
      h+=`<div style="display:flex;gap:16px;font-size:.78rem;flex-wrap:wrap">`;
      h+=`<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--primary);margin-right:4px"></span>Appels : ${usage.usage?.calls||0}</span>`;
      h+=`<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#15803d;margin-right:4px"></span>SMS : ${usage.usage?.sms||0}</span>`;
      if(usage.usage?.voicemails)h+=`<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#7c3aed;margin-right:4px"></span>Vocaux : ${usage.usage.voicemails}</span>`;
      h+=`</div>`;
      if(usage.billing?.overage>0){
        h+=`<div style="margin-top:10px;padding:10px 14px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;font-size:.82rem;color:#dc2626">`;
        h+=`<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> <strong>${usage.billing.overage} unit\u00e9${usage.billing.overage>1?'s':''} hors forfait</strong> \u2014 Suppl\u00e9ment estim\u00e9 : ${(usage.billing.overage_total_cents/100).toFixed(2)}\u20ac (${(usage.billing.extra_unit_price_cents/100).toFixed(2)}\u20ac/unit\u00e9)`;
        h+=`</div>`;
      }else if(isWarn){
        h+=`<div style="margin-top:10px;padding:10px 14px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;font-size:.82rem;color:#92400e">`;
        h+=`<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ${pct}% utilis\u00e9. ${usage.quota-(usage.usage?.total||0)} unit\u00e9s restantes ce mois.`;
        h+=`</div>`;
      }
      h+=`</div>`;
    }else{
      h='';
    }

    // KPIs
    h+=`<div class="kpis">`;
    h+=`<div class="kpi"><div class="kpi-val">${st.total||0}</div><div class="kpi-label">Appels ce mois</div></div>`;
    h+=`<div class="kpi"><div class="kpi-val" style="color:var(--primary)">${st.filtered||0}</div><div class="kpi-label"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg> SMS envoy\u00e9s</div></div>`;
    h+=`<div class="kpi"><div class="kpi-val" style="color:#15803d">${st.vip||0}</div><div class="kpi-label"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> VIP pass\u00e9s</div></div>`;
    h+=`<div class="kpi"><div class="kpi-val" style="color:var(--primary)">${st.total>0?Math.round((st.converted||0)/st.total*100):0}%</div><div class="kpi-label"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Convertis</div></div>`;
    h+=`</div>`;

    // Tabs
    h+=`<div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">`;
    h+=`<button class="btn-sm ${viewState.callTab==='logs'?'active':''}" onclick="viewState.callTab='logs';loadCalls()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg> Journal</button>`;
    h+=`<button class="btn-sm ${viewState.callTab==='voicemails'?'active':''}" onclick="viewState.callTab='voicemails';loadCalls()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> Vocaux${vmUnread>0?' <span style="background:var(--red);color:#fff;border-radius:10px;padding:1px 6px;font-size:.7rem;margin-left:4px">'+vmUnread+'</span>':''}</button>`;
    h+=`<button class="btn-sm ${viewState.callTab==='config'?'active':''}" onclick="viewState.callTab='config';loadCalls()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Configuration</button>`;
    h+=`<button class="btn-sm ${viewState.callTab==='messages'?'active':''}" onclick="viewState.callTab='messages';loadCalls()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> Messages</button>`;
    h+=`<button class="btn-sm ${viewState.callTab==='whitelist'?'active':''}" onclick="viewState.callTab='whitelist';loadCalls()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> VIP (${wl.length})</button>`;
    h+=`<button class="btn-sm ${viewState.callTab==='blacklist'?'active':''}" onclick="viewState.callTab='blacklist';loadCalls()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Blacklist (${bl.length})</button>`;
    h+=`<button class="btn-sm ${viewState.callTab==='usage'?'active':''}" onclick="viewState.callTab='usage';loadCalls()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg> Conso</button>`;
    h+=`</div>`;

    if(viewState.callTab==='logs') h+=renderCallLogs(logs);
    else if(viewState.callTab==='voicemails') h+=renderCallVoicemails(vms);
    else if(viewState.callTab==='config') h+=renderCallConfig(cs);
    else if(viewState.callTab==='messages') h+=renderCallMessages(cs);
    else if(viewState.callTab==='whitelist') h+=renderCallWhitelist(wl);
    else if(viewState.callTab==='blacklist') h+=renderCallBlacklist(bl);
    else if(viewState.callTab==='usage') h+=renderCallUsage(usage,logs);

    c.innerHTML=h;
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${e.message}</div>`;}
}

function renderCallLogs(logs){
  let h=`<div class="card"><div class="card-h"><h3>Journal d'appels</h3><span class="badge badge-teal">${logs.length}</span></div>`;
  if(logs.length===0){
    h+=`<div class="empty">Aucun appel enregistr\u00e9.<br><span style="font-size:.8rem;color:var(--text-4)">Les appels appara\u00eetront ici une fois le filtre Twilio activ\u00e9.</span></div>`;
  }else{
    const actionLabels={'whitelist_pass':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> VIP','played_message':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg> Message','forwarded':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg> Transf\u00e9r\u00e9','sent_sms':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg> SMS','urgent_key':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18v-6a5 5 0 1 1 10 0v6"/><path d="M5 21a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"/><path d="M12 7V3"/><path d="M5.7 13.7 3 11"/><path d="m18.3 13.7 2.7-2.7"/></svg> Urgent','voicemail':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Messagerie','hung_up':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Raccroch\u00e9','blacklist_reject':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Bloqu\u00e9','vacation_message':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg> Vacances','repeat_transfer':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6"/><path d="M2.5 22v-6h6"/><path d="M22 11.5A10 10 0 0 0 3.2 7.2L2.5 8"/><path d="M2 12.5a10 10 0 0 0 18.8 4.3l.7-.8"/></svg> Rappel insistant','schedule_filter':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Horaires'};
    const resultLabels={'ok':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>','failed':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>','no_answer':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>'};
    h+=`<div style="overflow-x:auto"><table class="table"><thead><tr><th>Date</th><th>Num\u00e9ro</th><th>Action</th><th>R\u00e9sultat</th><th>Dur\u00e9e</th><th>RDV</th></tr></thead><tbody>`;
    logs.forEach(l=>{
      const dt=new Date(l.created_at);
      const dateStr=dt.toLocaleDateString('fr-BE',{day:'numeric',month:'short'})+' '+dt.toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'});
      const durStr=l.duration_sec>0?`${Math.floor(l.duration_sec/60)}:${String(l.duration_sec%60).padStart(2,'0')}`:'\u2014';
      const booking=l.booking_id?'<span style="color:var(--primary)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Oui</span>':'\u2014';
      h+=`<tr><td style="font-size:.78rem;white-space:nowrap">${dateStr}</td><td style="font-family:monospace;font-size:.78rem">${l.from_phone_masked||l.from_phone||'\u2014'}</td><td>${actionLabels[l.action]||l.action}</td><td>${resultLabels[l.result]||l.result}</td><td>${durStr}</td><td>${booking}</td></tr>`;
    });
    h+=`</tbody></table></div>`;
  }
  h+=`</div>`;
  return h;
}

function renderCallVoicemails(vms){
  let h=`<div class="card"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> Messages vocaux</h3><span class="badge badge-teal">${vms.length}</span></div>`;
  h+=`<div style="padding:18px">`;
  if(vms.length===0){
    h+=`<div class="empty">Aucun message vocal.<br><span style="font-size:.8rem;color:var(--text-4)">Les messages vocaux appara\u00eetront ici quand la messagerie est activ\u00e9e (modes Strict et Vacances).</span></div>`;
  }else{
    h+=`<div style="display:flex;flex-direction:column;gap:12px">`;
    vms.forEach(vm=>{
      const dt=new Date(vm.created_at);
      const dateStr=dt.toLocaleDateString('fr-BE',{day:'numeric',month:'short',year:'numeric'})+' \u00e0 '+dt.toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'});
      const durStr=vm.duration_sec>0?`${Math.floor(vm.duration_sec/60)}:${String(vm.duration_sec%60).padStart(2,'0')}`:'\u2014';
      const isUnread=!vm.is_read;
      h+=`<div style="padding:14px 16px;border:1.5px solid ${isUnread?'var(--primary)':'var(--border-light)'};border-radius:10px;background:${isUnread?'var(--primary-light)':'var(--white)'}">`;
      h+=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">`;
      h+=`<div>`;
      if(isUnread) h+=`<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--primary);margin-right:6px"></span>`;
      h+=`<span style="font-family:monospace;font-size:.85rem;font-weight:600">${vm.from_phone||'Inconnu'}</span>`;
      h+=`<span style="font-size:.78rem;color:var(--text-4);margin-left:10px">${dateStr}</span>`;
      h+=`<span style="font-size:.75rem;color:var(--text-4);margin-left:10px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${durStr}</span>`;
      h+=`</div>`;
      h+=`<div style="display:flex;gap:6px">`;
      if(isUnread) h+=`<button class="btn-outline btn-sm" onclick="markVoicemailRead('${vm.id}')" style="font-size:.72rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Lu</button>`;
      h+=`<button class="btn-outline btn-sm btn-danger" onclick="if(confirm('Supprimer ce message vocal ?'))deleteVoicemail('${vm.id}')" style="font-size:.72rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>`;
      h+=`</div></div>`;
      h+=`<audio controls preload="none" style="width:100%;height:36px;border-radius:8px" ${isUnread?`onplay="markVoicemailRead('${vm.id}')"`:''}><source src="${vm.recording_url}" type="audio/mpeg">Votre navigateur ne supporte pas la lecture audio.</audio>`;
      if(vm.transcription) h+=`<div style="margin-top:8px;font-size:.82rem;color:var(--text-3);font-style:italic;padding:8px 12px;background:var(--surface);border-radius:8px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> ${vm.transcription}</div>`;
      h+=`</div>`;
    });
    h+=`</div>`;
  }
  h+=`</div></div>`;
  return h;
}

async function markVoicemailRead(id){
  try{
    await api.patch(`/api/calls/voicemails/${id}/read`);
    loadCalls();
  }catch(e){}
}

async function deleteVoicemail(id){
  try{
    await api.delete(`/api/calls/voicemails/${id}`);
    GendaUI.toast('Message vocal supprim\u00e9','success');
    loadCalls();
  }catch(e){GendaUI.toast('Erreur','error');}
}

function renderCallUsage(usage,logs){
  let h=`<div class="card"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg> D\u00e9tail de consommation</h3><button class="btn-outline btn-sm" onclick="exportUsageCSV()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg> Export CSV</button></div>`;
  h+=`<div style="padding:18px">`;
  if(!usage||!usage.quota){
    h+=`<div class="empty">Le suivi de consommation est disponible pour les plans Pro et Premium.</div></div></div>`;
    return h;
  }
  h+=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px">`;
  h+=`<div style="padding:14px;background:var(--primary-light);border-radius:10px;text-align:center"><div style="font-size:1.4rem;font-weight:800;color:var(--primary)">${usage.usage?.calls||0}</div><div style="font-size:.78rem;color:var(--text-3)">Appels</div></div>`;
  h+=`<div style="padding:14px;background:#f0fdf4;border-radius:10px;text-align:center"><div style="font-size:1.4rem;font-weight:800;color:#15803d">${usage.usage?.sms||0}</div><div style="font-size:.78rem;color:var(--text-3)">SMS</div></div>`;
  h+=`<div style="padding:14px;background:#f5f3ff;border-radius:10px;text-align:center"><div style="font-size:1.4rem;font-weight:800;color:#7c3aed">${usage.usage?.voicemails||0}</div><div style="font-size:.78rem;color:var(--text-3)">Vocaux</div></div>`;
  h+=`<div style="padding:14px;background:${(usage.billing?.overage||0)>0?'#fef2f2':'#f8fafc'};border-radius:10px;text-align:center"><div style="font-size:1.4rem;font-weight:800;color:${(usage.billing?.overage||0)>0?'#dc2626':'var(--text)'}">${usage.usage?.total||0} / ${usage.quota}</div><div style="font-size:.78rem;color:var(--text-3)">Total / Forfait</div></div>`;
  h+=`</div>`;
  h+=`<div style="background:var(--surface);border-radius:10px;padding:16px;margin-bottom:20px">`;
  h+=`<div style="font-weight:700;font-size:.85rem;margin-bottom:8px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Facturation</div>`;
  h+=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.82rem">`;
  h+=`<div>Plan : <strong>${(usage.plan||'').toUpperCase()}</strong></div>`;
  h+=`<div>Forfait : <strong>${usage.quota} unit\u00e9s/mois</strong></div>`;
  h+=`<div>Prix hors forfait : <strong>${((usage.billing?.extra_unit_price_cents||0)/100).toFixed(2)}\u20ac/unit\u00e9</strong></div>`;
  h+=`<div>Hors forfait : <strong style="color:${(usage.billing?.overage||0)>0?'#dc2626':'#15803d'}">${usage.billing?.overage||0} unit\u00e9s (${((usage.billing?.overage_total_cents||0)/100).toFixed(2)}\u20ac)</strong></div>`;
  h+=`</div></div>`;
  h+=`<div style="font-weight:700;font-size:.85rem;margin-bottom:10px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg> Derni\u00e8res interactions</div>`;
  h+=`<div style="overflow-x:auto"><table class="table"><thead><tr><th>Date</th><th>Num\u00e9ro</th><th>Type</th><th>Dur\u00e9e</th></tr></thead><tbody>`;
  const at={'played_message':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg> Appel','forwarded':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg> Transf\u00e9r\u00e9','whitelist_pass':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> VIP','sent_sms':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg> SMS','voicemail':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> Vocal','blacklist_reject':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Bloqu\u00e9','vacation_message':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg> Vacances','repeat_transfer':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6"/><path d="M2.5 22v-6h6"/><path d="M22 11.5A10 10 0 0 0 3.2 7.2L2.5 8"/><path d="M2 12.5a10 10 0 0 0 18.8 4.3l.7-.8"/></svg> Rappel','hung_up':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Raccroch\u00e9'};
  (logs||[]).slice(0,20).forEach(l=>{
    const dt=new Date(l.created_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
    const dur=l.duration_sec>0?Math.floor(l.duration_sec/60)+':'+String(l.duration_sec%60).padStart(2,'0'):'\u2014';
    h+=`<tr><td style="font-size:.78rem">${dt}</td><td style="font-family:monospace;font-size:.82rem">${l.from_phone_masked||l.from_phone||'\u2014'}</td><td>${at[l.action]||l.action}</td><td>${dur}</td></tr>`;
  });
  h+=`</tbody></table></div></div></div>`;
  return h;
}

function exportUsageCSV(){
  api.get('/api/calls/logs?limit=500').then(d=>{
    const logs=d.logs||[];
    let csv='Date,Num\u00e9ro,Action,R\u00e9sultat,Dur\u00e9e (sec)\n';
    logs.forEach(l=>{csv+=`${l.created_at},${l.from_phone||''},${l.action},${l.result},${l.duration_sec||0}\n`;});
    const blob=new Blob([csv],{type:'text/csv'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`genda-appels-${new Date().toISOString().slice(0,7)}.csv`;
    a.click();URL.revokeObjectURL(url);
    GendaUI.toast('Export CSV t\u00e9l\u00e9charg\u00e9','success');
  });
}

function renderCallConfig(cs){
  const mode=cs.filter_mode||'off';
  const hasNumber=!!cs.twilio_number;
  let h='';

  // Activation panel
  if(!hasNumber){
    h+=`<div class="card" style="border:2px dashed var(--primary);background:linear-gradient(135deg,#f0fdfa,#ecfdf5)">`;
    h+=`<div style="text-align:center;padding:24px">`;
    h+=`<div style="font-size:2.5rem;margin-bottom:12px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg></div>`;
    h+=`<h3 style="margin-bottom:8px">Activez le filtre d'appels intelligent</h3>`;
    h+=`<p style="font-size:.85rem;color:var(--text-4);max-width:500px;margin:0 auto 20px">Vos patients re\u00e7oivent un SMS avec votre lien de r\u00e9servation. Les VIP passent directement. Fini les appels qui interrompent vos consultations.</p>`;
    h+=`<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:16px">`;
    h+=`<button class="btn-primary" onclick="activateCallFilter('BE')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="8.67" y1="4" x2="8.67" y2="20"/><line x1="15.33" y1="4" x2="15.33" y2="20"/></svg> Num\u00e9ro belge</button>`;
    h+=`</div>`;
    h+=`<div style="font-size:.72rem;color:var(--text-4)">Un num\u00e9ro virtuel est attribu\u00e9 \u00e0 votre cabinet. Inclus dans l'abonnement Premium.</div>`;
    h+=`</div></div>`;
    return h;
  }

  // Active number banner
  const modeLabels={off:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#EF4444"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg> D\u00e9sactiv\u00e9',soft:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#EAB308"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg> Soft',strict:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#22C55E"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg> Strict',schedule_based:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Horaires',vacation:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg> Vacances'};
  const modeColors={off:'#fef2f2;color:#dc2626',soft:'#fffbeb;color:#B45309',strict:'#f0fdf4;color:#15803d',schedule_based:'#eff6ff;color:#2563eb',vacation:'#fef3c7;color:#92400e'};
  h+=`<div class="card" style="background:linear-gradient(135deg,#f0fdfa,#ecfdf5);margin-bottom:16px">`;
  h+=`<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">`;
  h+=`<div><span style="font-size:.75rem;font-weight:600;color:var(--text-4);text-transform:uppercase;letter-spacing:.5px">Num\u00e9ro actif</span><div style="font-size:1.3rem;font-weight:700;font-family:monospace;color:var(--primary);margin-top:2px">${formatPhoneDisplay(cs.twilio_number)}</div></div>`;
  h+=`<div style="display:flex;gap:8px;align-items:center">`;
  h+=`<span style="font-size:.78rem;padding:4px 10px;border-radius:20px;font-weight:600;background:#${modeColors[mode]||modeColors.off}">${modeLabels[mode]||mode}</span>`;
  h+=`<button class="btn-outline btn-sm btn-danger" onclick="deactivateCallFilter()" style="font-size:.72rem">D\u00e9sactiver</button>`;
  h+=`</div></div></div>`;

  // Mode selector
  h+=`<div class="card"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Mode de filtrage</h3></div><div style="padding:18px">`;

  const modes=[
    {key:'off',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#EF4444"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>',name:'D\u00e9sactiv\u00e9',desc:'Les appels passent directement sur votre t\u00e9l\u00e9phone.'},
    {key:'soft',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#EAB308"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>',name:'Soft',desc:'Message vocal + SMS. L\'appel est ensuite transf\u00e9r\u00e9 sur votre t\u00e9l\u00e9phone.'},
    {key:'strict',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#22C55E"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>',name:'Strict',desc:'Message vocal + SMS + raccroch\u00e9. Vous n\'\u00eates jamais d\u00e9rang\u00e9.'},
    {key:'schedule_based',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',name:'Horaires',desc:'Strict pendant vos consultations, transfert direct en dehors. Se base sur vos disponibilit\u00e9s.'},
    {key:'vacation',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',name:'Vacances',desc:'Message de fermeture avec date de retour. Redirige vers un confr\u00e8re si configur\u00e9.'}
  ];

  h+=`<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">`;
  modes.forEach(m=>{
    const active=m.key===mode;
    h+=`<label style="display:flex;align-items:flex-start;gap:12px;padding:12px 16px;border:2px solid ${active?'var(--primary)':'var(--border-light)'};border-radius:10px;cursor:pointer;background:${active?'var(--primary-light)':'var(--white)'};transition:all .15s" onclick="document.getElementById('call_mode').value='${m.key}';${m.key==='vacation'?"document.getElementById('vacationConfig').style.display='block'":"document.getElementById('vacationConfig').style.display='none'"}">
      <input type="radio" name="call_mode_radio" value="${m.key}" ${active?'checked':''} style="margin-top:3px" onchange="document.getElementById('call_mode').value=this.value;document.getElementById('vacationConfig').style.display=this.value==='vacation'?'block':'none'">
      <div><div style="font-weight:700;font-size:.88rem">${m.icon} ${m.name}</div><div style="font-size:.78rem;color:var(--text-3);margin-top:2px">${m.desc}</div></div>
    </label>`;
  });
  h+=`</div>`;
  h+=`<input type="hidden" id="call_mode" value="${mode}">`;

  // Vacation config
  h+=`<div id="vacationConfig" style="display:${mode==='vacation'?'block':'none'};background:var(--surface);border-radius:10px;padding:16px;margin-bottom:16px">`;
  h+=`<div style="font-weight:700;font-size:.85rem;margin-bottom:12px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg> Configuration vacances</div>`;
  h+=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">`;
  h+=`<div class="fg"><label class="fl">Date de retour</label><input class="fi" type="date" id="call_vac_until" value="${cs.vacation_until||''}"></div>`;
  h+=`<div class="fg"><label class="fl">Nom du rempla\u00e7ant</label><input class="fi" id="call_vac_redirect_name" value="${esc(cs.vacation_redirect_name||'')}" placeholder="Ex: Dr Martin (optionnel)"></div>`;
  h+=`</div>`;
  h+=`<div class="fg"><label class="fl">Num\u00e9ro du rempla\u00e7ant</label><input class="fi" id="call_vac_redirect_phone" value="${esc(cs.vacation_redirect_phone||'')}" placeholder="+32 470 ... (optionnel \u2014 si vide, pas de transfert)"></div>`;
  h+=`<div style="font-size:.72rem;color:var(--text-4);margin-top:4px">Sans num\u00e9ro de rempla\u00e7ant : message + SMS + raccroch\u00e9. Avec : transfert vers le confr\u00e8re apr\u00e8s le message.</div>`;
  h+=`</div>`;

  // Transfer phone
  h+=`<div class="fg"><label class="fl"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg> Num\u00e9ro de transfert principal</label><input class="fi" id="call_forward" value="${esc(cs.forward_default_phone||'')}" placeholder="+32 470 12 34 56"></div>`;
  h+=`<div style="font-size:.72rem;color:var(--text-4);margin-top:-10px;margin-bottom:16px">Votre vrai GSM. O\u00f9 vont les appels VIP et les appels en mode Soft.</div>`;

  // Toggles
  h+=`<div style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px">`;
  h+=`<label style="display:flex;align-items:center;gap:10px;font-size:.85rem;cursor:pointer"><input type="checkbox" id="call_sms" ${cs.sms_after_call!==false?'checked':''}><span><strong>SMS automatique</strong> \u2014 Envoie le lien de r\u00e9servation par SMS</span></label>`;
  h+=`<label style="display:flex;align-items:center;gap:10px;font-size:.85rem;cursor:pointer"><input type="checkbox" id="call_voicemail" ${cs.voicemail_enabled?'checked':''}><span><strong>Messagerie vocale</strong> \u2014 En mode Strict/Vacances, propose au patient de laisser un message ("tapez 1")</span></label>`;
  h+=`</div>`;

  // Repeat caller
  h+=`<div style="background:var(--surface);border-radius:10px;padding:16px;margin-bottom:16px">`;
  h+=`<div style="font-weight:700;font-size:.85rem;margin-bottom:8px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6"/><path d="M2.5 22v-6h6"/><path d="M22 11.5A10 10 0 0 0 3.2 7.2L2.5 8"/><path d="M2 12.5a10 10 0 0 0 18.8 4.3l.7-.8"/></svg> D\u00e9tection rappel insistant</div>`;
  h+=`<div style="font-size:.78rem;color:var(--text-3);margin-bottom:12px">Si quelqu'un rappelle ${cs.repeat_caller_threshold||3}x en ${cs.repeat_caller_window_min||15} minutes, l'appel passe directement.</div>`;
  h+=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">`;
  h+=`<div class="fg"><label class="fl">Seuil (appels)</label><input class="fi" type="number" id="call_repeat_threshold" value="${cs.repeat_caller_threshold||3}" min="2" max="10"></div>`;
  h+=`<div class="fg"><label class="fl">Fen\u00eatre (minutes)</label><input class="fi" type="number" id="call_repeat_window" value="${cs.repeat_caller_window_min||15}" min="5" max="60"></div>`;
  h+=`</div></div>`;

  h+=`<button class="btn-primary" onclick="saveCallSettings()" style="margin-top:4px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Enregistrer</button>`;
  h+=`</div></div>`;

  // Instructions
  h+=`<div class="card" style="margin-top:16px"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg> Comment \u00e7a marche</h3></div>`;
  h+=`<div style="font-size:.82rem;color:var(--text-3);line-height:1.7;padding:4px 0">`;
  h+=`<strong>1.</strong> Communiquez le num\u00e9ro Twilio \u00e0 vos patients (carte de visite, site web, Google).<br>`;
  h+=`<strong>2.</strong> Renseignez votre vrai GSM en "Num\u00e9ro de transfert" ci-dessus.<br>`;
  h+=`<strong>3.</strong> Ajoutez vos contacts importants (labo, pharmacie, confr\u00e8res) dans l'onglet VIP.<br>`;
  h+=`<strong>4.</strong> Les num\u00e9ros blacklist\u00e9s sont rejet\u00e9s silencieusement.<br>`;
  h+=`<strong>5.</strong> En mode Horaires, le filtre suit vos disponibilit\u00e9s automatiquement.`;
  h+=`</div></div>`;

  return h;
}

async function activateCallFilter(country){
  if(!confirm(`Activer le filtre d'appels avec un num\u00e9ro ${country==='BE'?'belge':country==='FR'?'fran\u00e7ais':'n\u00e9erlandais'} ?\n\nUn num\u00e9ro virtuel sera attribu\u00e9 \u00e0 votre cabinet.`))return;
  const c=document.getElementById('contentArea');
  c.innerHTML=`<div class="loading"><div class="spinner"></div><p style="text-align:center;margin-top:12px;color:var(--text-4)">Recherche d'un num\u00e9ro disponible...</p></div>`;
  try{
    const searchD=await api.get(`/api/calls/available-numbers?country=${country}`);
    if(!searchD.numbers||searchD.numbers.length===0)throw new Error('Aucun num\u00e9ro disponible pour ce pays');

    c.innerHTML=`<div class="loading"><div class="spinner"></div><p style="text-align:center;margin-top:12px;color:var(--text-4)">Attribution du num\u00e9ro ${searchD.numbers[0].friendly}...</p></div>`;

    const actD=await api.post('/api/calls/activate',{phone_number:searchD.numbers[0].phone,country});

    GendaUI.toast(`Num\u00e9ro ${actD.number} activ\u00e9 !`,'success');
    viewState.callTab='config';
    loadCalls();
  }catch(e){
    GendaUI.toast('Erreur: '+e.message,'error');
    viewState.callTab='config';
    loadCalls();
  }
}

async function deactivateCallFilter(){
  if(!confirm('D\u00e9sactiver le filtre d\'appels ?\n\nLe num\u00e9ro virtuel sera lib\u00e9r\u00e9 et les appels ne seront plus filtr\u00e9s. Cette action est irr\u00e9versible.'))return;
  try{
    await api.post('/api/calls/deactivate');
    GendaUI.toast('Filtre d\'appels d\u00e9sactiv\u00e9','success');
    viewState.callTab='config';
    loadCalls();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

function renderCallWhitelist(wl){
  let h=`<div class="card"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Num\u00e9ros VIP</h3><button class="btn-primary btn-sm" onclick="addWhitelistEntry()">+ Ajouter</button></div>`;
  h+=`<div style="font-size:.8rem;color:var(--text-4);margin-bottom:12px">Ces num\u00e9ros ne sont jamais filtr\u00e9s \u2014 l'appel passe directement sur votre t\u00e9l\u00e9phone.</div>`;
  if(wl.length===0){
    h+=`<div class="empty">Aucun num\u00e9ro VIP configur\u00e9</div>`;
  }else{
    h+=`<div style="overflow-x:auto"><table class="table"><thead><tr><th>Num\u00e9ro</th><th>Label</th><th>Actif</th><th></th></tr></thead><tbody>`;
    wl.forEach(w=>{
      h+=`<tr><td style="font-family:monospace;font-size:.85rem">${esc(w.phone_e164)}</td><td>${esc(w.label)||'\u2014'}</td><td>${w.is_active?'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'}</td>`;
      h+=`<td style="text-align:right"><button class="btn-outline btn-sm" onclick="editWhitelistEntry('${w.id}','${esc(w.phone_e164)}','${esc((w.label||'').replace(/'/g,"\\\\'"))}',${w.is_active})"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button> <button class="btn-outline btn-sm btn-danger" onclick="if(confirm('Supprimer ce num\u00e9ro VIP ?'))deleteWhitelistEntry('${w.id}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button></td></tr>`;
    });
    h+=`</tbody></table></div>`;
  }
  h+=`</div>`;
  return h;
}

async function saveCallSettings(){
  try{
    const body={
      filter_mode:document.getElementById('call_mode').value,
      forward_default_phone:document.getElementById('call_forward').value||null,
      sms_after_call:document.getElementById('call_sms').checked,
      voicemail_enabled:document.getElementById('call_voicemail').checked,
      vacation_until:document.getElementById('call_vac_until')?.value||null,
      vacation_message_fr:null,
      vacation_redirect_phone:document.getElementById('call_vac_redirect_phone')?.value||null,
      vacation_redirect_name:document.getElementById('call_vac_redirect_name')?.value||null,
      repeat_caller_threshold:parseInt(document.getElementById('call_repeat_threshold')?.value)||3,
      repeat_caller_window_min:parseInt(document.getElementById('call_repeat_window')?.value)||15
    };
    await api.patch('/api/calls/settings',body);
    GendaUI.toast('Configuration sauvegard\u00e9e','success');
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

function renderCallMessages(cs){
  let h=`<div class="card"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> Messages personnalis\u00e9s</h3></div><div style="padding:18px">`;
  h+=`<p style="font-size:.82rem;color:var(--text-3);margin-bottom:16px">Personnalisez ce que vos patients entendent au t\u00e9l\u00e9phone et re\u00e7oivent par SMS. Laissez vide pour utiliser les messages par d\u00e9faut.</p>`;

  // Announcement
  h+=`<div style="background:var(--surface);border-radius:10px;padding:16px;margin-bottom:16px">`;
  h+=`<div style="font-weight:700;font-size:.85rem;margin-bottom:4px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg> Message vocal (modes Soft / Strict)</div>`;
  h+=`<div style="font-size:.72rem;color:var(--text-4);margin-bottom:10px">Ce que le patient entend quand il appelle. Par d\u00e9faut : "Bonjour et bienvenue chez [cabinet]. Pour prendre rendez-vous, nous vous envoyons un SMS..."</div>`;
  h+=`<div class="fg"><label class="fl">Message vocal</label><textarea class="fi" id="msg_custom_fr" rows="3" placeholder="Bonjour, vous avez joint le cabinet du Dr Dupont...">${esc(cs.custom_message_fr||'')}</textarea></div>`;
  h+=`</div>`;

  // Vacation message
  h+=`<div style="background:var(--surface);border-radius:10px;padding:16px;margin-bottom:16px">`;
  h+=`<div style="font-weight:700;font-size:.85rem;margin-bottom:4px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg> Message vacances</div>`;
  h+=`<div style="font-size:.72rem;color:var(--text-4);margin-bottom:10px">Par d\u00e9faut : "Le cabinet [nom] est actuellement ferm\u00e9 jusqu'au [date]. Vous pouvez prendre RDV en ligne..."</div>`;
  h+=`<div class="fg"><label class="fl">Message vacances</label><textarea class="fi" id="msg_vac_fr" rows="3" placeholder="Bonjour, le cabinet est ferm\u00e9 pour cong\u00e9 annuel. Nous reprenons le...">${esc(cs.vacation_message_fr||'')}</textarea></div>`;
  h+=`</div>`;

  // SMS text
  h+=`<div style="background:var(--surface);border-radius:10px;padding:16px;margin-bottom:16px">`;
  h+=`<div style="font-weight:700;font-size:.85rem;margin-bottom:4px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg> Texte du SMS</div>`;
  h+=`<div style="font-size:.72rem;color:var(--text-4);margin-bottom:10px">Le SMS envoy\u00e9 au patient. Par d\u00e9faut : "[Cabinet] : Prenez RDV en ligne sur [lien]"</div>`;
  h+=`<div class="fg"><label class="fl">SMS</label><input class="fi" id="msg_sms_fr" value="${esc(cs.custom_sms_fr||'')}" placeholder="Dr Dupont \u2014 Prenez RDV en ligne : {lien}"></div>`;
  h+=`</div>`;

  h+=`<button class="btn-primary" onclick="saveCallMessages()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Enregistrer les messages</button>`;
  h+=`</div></div>`;
  return h;
}

async function saveCallMessages(){
  try{
    const body={
      custom_message_fr:document.getElementById('msg_custom_fr').value.trim()||null,
      vacation_message_fr:document.getElementById('msg_vac_fr').value.trim()||null,
      custom_sms_fr:document.getElementById('msg_sms_fr').value.trim()||null
    };
    await api.patch('/api/calls/settings',body);
    GendaUI.toast('Messages sauvegard\u00e9s','success');
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

function renderCallBlacklist(bl){
  let h=`<div class="card"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Num\u00e9ros bloqu\u00e9s</h3><button class="btn-primary btn-sm" onclick="addBlacklistEntry()">+ Bloquer</button></div>`;
  h+=`<div style="padding:18px">`;
  h+=`<p style="font-size:.82rem;color:var(--text-3);margin-bottom:14px">Ces num\u00e9ros sont rejet\u00e9s silencieusement \u2014 ils n'entendent m\u00eame pas de message.</p>`;
  if(bl.length===0){
    h+=`<div class="empty">Aucun num\u00e9ro bloqu\u00e9</div>`;
  }else{
    h+=`<div style="overflow-x:auto"><table class="table"><thead><tr><th>Num\u00e9ro</th><th>Label</th><th>Raison</th><th>Date</th><th></th></tr></thead><tbody>`;
    const reasonLabels={manual:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Manuel',spam:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg> Spam',repeat_no_booking:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6"/><path d="M2.5 22v-6h6"/><path d="M22 11.5A10 10 0 0 0 3.2 7.2L2.5 8"/><path d="M2 12.5a10 10 0 0 0 18.8 4.3l.7-.8"/></svg> R\u00e9p\u00e9titif'};
    bl.forEach(b=>{
      const date=new Date(b.created_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short'});
      h+=`<tr><td style="font-family:monospace;font-size:.85rem">${esc(b.phone_e164)}</td><td>${esc(b.label)||'\u2014'}</td><td>${reasonLabels[b.reason]||b.reason}</td><td style="font-size:.78rem">${date}</td>`;
      h+=`<td style="text-align:right"><button class="btn-outline btn-sm btn-danger" onclick="if(confirm('D\u00e9bloquer ce num\u00e9ro ?'))deleteBlacklistEntry('${b.id}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button></td></tr>`;
    });
    h+=`</tbody></table></div>`;
  }
  h+=`</div></div>`;

  // Suggest from logs
  h+=`<div class="card" style="margin-top:16px"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> Suggestions</h3></div>`;
  h+=`<div style="padding:18px;font-size:.82rem;color:var(--text-3)">`;
  h+=`Les num\u00e9ros qui appellent souvent sans jamais prendre RDV appara\u00eetront ici dans une prochaine version.`;
  h+=`</div></div>`;

  return h;
}

function addBlacklistEntry(){
  const ov=document.createElement('div');ov.className='modal-overlay';
  ov.innerHTML=`<div class="modal"><div class="modal-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Bloquer un num\u00e9ro</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div class="modal-body">
      <div class="fg"><label class="fl">Num\u00e9ro *</label><input class="fi" id="bl_phone" placeholder="+32 470 12 34 56"></div>
      <div class="fg"><label class="fl">Label</label><input class="fi" id="bl_label" placeholder="Ex: D\u00e9marcheur, Pub..."></div>
      <div class="fg"><label class="fl">Raison</label><select class="fi" id="bl_reason">
        <option value="manual">Manuel</option>
        <option value="spam">Spam / Pub</option>
      </select></div>
    </div>
    <div class="modal-foot"><button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Annuler</button><button class="btn-primary" onclick="saveBlacklistEntry()">Bloquer</button></div>
  </div>`;
  document.body.appendChild(ov);
  document.getElementById('bl_phone').focus();
}

async function saveBlacklistEntry(){
  const phone=document.getElementById('bl_phone').value.replace(/\s/g,'').trim();
  const label=document.getElementById('bl_label').value.trim();
  const reason=document.getElementById('bl_reason').value;
  if(!phone){GendaUI.toast('Num\u00e9ro requis','error');return;}
  try{
    await api.post('/api/calls/blacklist',{phone_e164:phone,label:label||null,reason});
    document.querySelector('.modal-overlay')?.remove();
    GendaUI.toast('Num\u00e9ro bloqu\u00e9','success');
    loadCalls();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function deleteBlacklistEntry(id){
  try{
    await api.delete(`/api/calls/blacklist/${id}`);
    GendaUI.toast('Num\u00e9ro d\u00e9bloqu\u00e9','success');
    loadCalls();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

function addWhitelistEntry(){
  const phone=prompt('Num\u00e9ro au format international (ex: +32 470 12 34 56):');
  if(!phone)return;
  const label=prompt('Label (ex: Labo, Pharmacie, Urgences):');
  api.post('/api/calls/whitelist',{phone_e164:phone.replace(/\s/g,''),label:label||null})
    .then(()=>{GendaUI.toast('Num\u00e9ro VIP ajout\u00e9','success');loadCalls();})
    .catch(e=>GendaUI.toast('Erreur: '+e.message,'error'));
}

function editWhitelistEntry(id,phone,label,active){
  let m=`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><div class="modal-h"><h3>Modifier num\u00e9ro VIP</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="modal-body">`;
  m+=`<div class="field"><label>Num\u00e9ro</label><input id="wl_phone" value="${esc(phone)}"></div>`;
  m+=`<div class="field"><label>Label</label><input id="wl_label" value="${esc(label)}"></div>`;
  m+=`<label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:.85rem"><input type="checkbox" id="wl_active" ${active?'checked':''}> Actif</label>`;
  m+=`</div><div class="modal-foot"><button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">Annuler</button><button class="btn-primary" onclick="saveWhitelistEntry('${id}')">Enregistrer</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',m);
}

async function saveWhitelistEntry(id){
  try{
    const body={phone_e164:document.getElementById('wl_phone').value.replace(/\s/g,''),label:document.getElementById('wl_label').value||null,is_active:document.getElementById('wl_active').checked};
    await api.patch(`/api/calls/whitelist/${id}`,body);
    document.querySelector('.modal-overlay')?.remove();
    GendaUI.toast('Num\u00e9ro VIP modifi\u00e9','success');loadCalls();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function deleteWhitelistEntry(id){
  try{
    await api.delete(`/api/calls/whitelist/${id}`);
    GendaUI.toast('Num\u00e9ro VIP supprim\u00e9','success');loadCalls();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// Expose viewState for inline onchange handlers in tab buttons
Object.defineProperty(window, 'viewState', { get(){return viewState;}, configurable: true });

bridge({ loadCalls, markVoicemailRead, deleteVoicemail, exportUsageCSV, saveCallSettings, saveCallMessages, activateCallFilter, deactivateCallFilter, addWhitelistEntry, editWhitelistEntry, saveWhitelistEntry, deleteWhitelistEntry, addBlacklistEntry, saveBlacklistEntry, deleteBlacklistEntry });

export { loadCalls };
