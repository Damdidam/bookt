/**
 * Calendar Sync view — connect Google / Outlook / iCal calendars.
 */
import { api, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';

const gToast = GendaUI.toast.bind(GendaUI);
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

const PROVIDER_INFO = {
  google:  { label: 'Google Calendar',  color: '#4285F4', icon: 'M21.35 11.1h-9.18v2.73h5.51c-.54 2.56-2.73 3.97-5.51 3.97a6.13 6.13 0 1 1 0-12.26c1.51 0 2.89.55 3.96 1.45l2.04-2.04A9.27 9.27 0 0 0 12.17 2 10 10 0 1 0 22 12.17c0-.57-.07-1.13-.18-1.66l-.47.59Z' },
  outlook: { label: 'Outlook Calendar', color: '#0078D4', icon: 'M21 5H3v14h18V5Zm-2 2v3h-3V7h3ZM5 7h3v3H5V7Zm0 5h3v3H5v-3Zm5 5v-3h4v3h-4Zm4-5h-4v-3h4v3Zm2 5v-3h3v3h-3Zm3-5h-3v-3h3v3Z' },
  ical:    { label: 'Lien iCal',         color: '#6B6560', icon: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z' }
};

const DIR_LABELS = { push: 'Genda → Calendrier', pull: 'Calendrier → Genda', both: 'Bidirectionnel' };

async function loadCalSync() {
  const c = document.getElementById('contentArea');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    // Fetch connections + practitioners in parallel
    const [connRes, pracRes] = await Promise.all([
      fetch('/api/calendar/connections', { headers: { 'Authorization': 'Bearer ' + api.getToken() } }),
      fetch('/api/practitioners', { headers: { 'Authorization': 'Bearer ' + api.getToken() } })
    ]);
    const connections = (await connRes.json()).connections || [];
    const practitioners = (await pracRes.json()).practitioners || [];

    let h = `<div style="max-width:640px;margin:0 auto">`;

    // Header
    h += `<div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <div style="width:40px;height:40px;border-radius:10px;background:var(--primary-light);display:flex;align-items:center;justify-content:center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M16 14l-4 4-4-4"/></svg>
        </div>
        <div>
          <h3 style="font-size:.95rem;font-weight:700">Synchronisation calendrier</h3>
          <p style="font-size:.78rem;color:var(--text-4)">Connectez Google Calendar, Outlook ou un flux iCal</p>
        </div>
      </div>`;

    // Connect buttons
    h += `<div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn-outline" style="display:flex;align-items:center;gap:8px" onclick="calSyncConnect('google')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#4285F4"><path d="${PROVIDER_INFO.google.icon}"/></svg> Google
      </button>
      <button class="btn-outline" style="display:flex;align-items:center;gap:8px" onclick="calSyncConnect('outlook')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#0078D4"><path d="${PROVIDER_INFO.outlook.icon}"/></svg> Outlook
      </button>
      <button class="btn-outline" style="display:flex;align-items:center;gap:8px" onclick="calSyncGenIcal()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B6560" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${PROVIDER_INFO.ical.icon}"/></svg> iCal
      </button>
    </div>`;

    // Practitioner selector for connect (if multi-practitioner)
    if (practitioners.length > 1) {
      h += `<div style="margin-top:12px;font-size:.78rem;color:var(--text-3)">
        <label>Praticien : </label>
        <select id="calSyncPracId" style="font-size:.78rem;padding:4px 8px;border-radius:6px;border:1px solid var(--border)">
          ${practitioners.map(p => `<option value="${p.id}">${esc(p.display_name)}</option>`).join('')}
        </select>
      </div>`;
    }
    h += `</div>`;

    // Active connections
    if (connections.length === 0) {
      h += `<div class="card" style="text-align:center;padding:32px">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-4)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg>
        <h4 style="font-size:.88rem;font-weight:600;margin-top:12px;color:var(--text-3)">Aucun calendrier connecté</h4>
        <p style="font-size:.78rem;color:var(--text-4);margin-top:4px">Connectez un calendrier externe pour synchroniser vos rendez-vous.</p>
      </div>`;
    } else {
      h += `<div class="card"><h3 style="font-size:.88rem;font-weight:700;margin-bottom:12px">Calendriers connectés</h3>`;
      for (const conn of connections) {
        const info = PROVIDER_INFO[conn.provider] || PROVIDER_INFO.ical;
        const pracName = practitioners.find(p => p.id === conn.practitioner_id)?.display_name || 'Tous';
        const statusColor = conn.status === 'active' ? 'var(--green)' : 'var(--red)';
        const statusLabel = conn.status === 'active' ? 'Connecté' : conn.status;
        const lastSync = conn.last_sync_at ? new Date(conn.last_sync_at).toLocaleString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Jamais';

        h += `<div style="padding:14px;border:1px solid var(--border-light);border-radius:12px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div style="width:32px;height:32px;border-radius:8px;background:${info.color}15;display:flex;align-items:center;justify-content:center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="${conn.provider === 'ical' ? 'none' : info.color}" stroke="${conn.provider === 'ical' ? info.color : 'none'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${info.icon}"/></svg>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:.85rem;font-weight:600">${info.label}</div>
              <div style="font-size:.72rem;color:var(--text-4)">${esc(conn.email || pracName)}</div>
            </div>
            <span style="font-size:.68rem;font-weight:600;color:${statusColor};background:${statusColor}15;padding:2px 8px;border-radius:6px">${statusLabel}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:.75rem">
            <span style="color:var(--text-4)">Praticien: <strong>${esc(pracName)}</strong></span>
            <span style="color:var(--text-4)">Direction: <strong>${DIR_LABELS[conn.sync_direction] || conn.sync_direction || 'push'}</strong></span>
            <span style="color:var(--text-4)">Sync: <strong>${lastSync}</strong></span>
          </div>`;

        if (conn.error_message) {
          h += `<div style="margin-top:8px;padding:8px 10px;background:var(--red)08;border:1px solid #fecaca;border-radius:8px;font-size:.72rem;color:var(--red)">${esc(conn.error_message)}</div>`;
        }

        // iCal URL display
        if (conn.provider === 'ical') {
          h += `<div style="margin-top:10px">
            <button class="btn-outline" style="font-size:.75rem;padding:6px 12px" onclick="calSyncGenIcal()">Régénérer le lien iCal</button>
          </div>`;
        }

        // Actions
        h += `<div style="display:flex;gap:8px;margin-top:10px;border-top:1px solid var(--border-light);padding-top:10px">
          <select style="font-size:.75rem;padding:4px 8px;border-radius:6px;border:1px solid var(--border)" onchange="calSyncUpdateDir('${conn.id}',this.value)">
            <option value="push" ${conn.sync_direction === 'push' ? 'selected' : ''}>Genda → Calendrier</option>
            <option value="pull" ${conn.sync_direction === 'pull' ? 'selected' : ''}>Calendrier → Genda</option>
            <option value="both" ${conn.sync_direction === 'both' ? 'selected' : ''}>Bidirectionnel</option>
          </select>
          <button class="btn-outline" style="font-size:.75rem;padding:6px 12px" onclick="calSyncNow('${conn.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg> Sync
          </button>
          <button class="btn-outline" style="font-size:.75rem;padding:6px 12px;color:var(--red);border-color:#fecaca" onclick="calSyncDisconnect('${conn.id}','${info.label}')">Déconnecter</button>
        </div></div>`;
      }
      h += `</div>`;
    }

    // iCal URL display area
    h += `<div id="icalUrlBox" style="display:none"></div>`;

    h += `</div>`;
    c.innerHTML = h;
  } catch (e) {
    c.innerHTML = `<div class="empty" style="color:var(--red)">Erreur: ${e.message}</div>`;
  }
}

function getSelectedPracId() {
  const sel = document.getElementById('calSyncPracId');
  return sel ? sel.value : null;
}

async function calSyncConnect(provider) {
  try {
    const pracId = getSelectedPracId();
    const url = `/api/calendar/${provider}/connect` + (pracId ? `?practitioner_id=${pracId}` : '');
    const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + api.getToken() } });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    if (d.url) window.location.href = d.url;
  } catch (e) { gToast(e.message, 'error'); }
}

async function calSyncGenIcal() {
  try {
    const pracId = getSelectedPracId();
    const r = await fetch('/api/calendar/ical/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ practitioner_id: pracId })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);

    const box = document.getElementById('icalUrlBox');
    box.style.display = 'block';
    box.innerHTML = `<div class="card" style="margin-top:16px">
      <h4 style="font-size:.85rem;font-weight:700;margin-bottom:8px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        Flux iCal
      </h4>
      <p style="font-size:.75rem;color:var(--text-3);margin-bottom:8px">Copiez ce lien dans Apple Calendar, Thunderbird ou tout client CalDAV.</p>
      <div style="display:flex;gap:8px">
        <input type="text" value="${esc(d.webcal_url)}" readonly style="flex:1;font-size:.72rem;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);font-family:monospace" id="icalUrlInput">
        <button class="btn-primary" style="font-size:.75rem;padding:8px 14px" onclick="navigator.clipboard.writeText(document.getElementById('icalUrlInput').value);GendaUI.toast('Copié !','success')">Copier</button>
      </div>
    </div>`;
    gToast('Lien iCal généré', 'success');
  } catch (e) { gToast(e.message, 'error'); }
}

async function calSyncUpdateDir(connId, direction) {
  try {
    const r = await fetch(`/api/calendar/connections/${connId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ sync_direction: direction })
    });
    if (!r.ok) throw new Error((await r.json()).error);
    gToast('Direction mise à jour', 'success');
  } catch (e) { gToast(e.message, 'error'); }
}

async function calSyncNow(connId) {
  try {
    gToast('Synchronisation...', 'info');
    const r = await fetch(`/api/calendar/connections/${connId}/sync`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    gToast(`Sync OK — ${d.pulled || 0} importé(s), ${d.pushed || 0} exporté(s)`, 'success');
    loadCalSync();
  } catch (e) { gToast(e.message, 'error'); }
}

async function calSyncDisconnect(connId, label) {
  if (!confirm(`Déconnecter ${label} ?`)) return;
  try {
    const r = await fetch(`/api/calendar/connections/${connId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) throw new Error((await r.json()).error);
    gToast('Calendrier déconnecté', 'success');
    loadCalSync();
  } catch (e) { gToast(e.message, 'error'); }
}

bridge({ loadCalSync, calSyncConnect, calSyncGenIcal, calSyncUpdateDir, calSyncNow, calSyncDisconnect });

export { loadCalSync };
