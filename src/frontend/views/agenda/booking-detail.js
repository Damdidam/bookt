/**
 * Booking Detail - renders the booking detail modal (the largest agenda sub-module).
 */
import { api, calState, userRole, user } from '../../state.js';
import { esc, gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcRenderNotes } from './booking-notes.js';
import { fcRenderSession } from './booking-session.js';
import { fcRenderTodos } from './booking-todos.js';
import { fcRenderReminders } from './booking-reminders.js';
import { cswHTML } from './color-swatches.js';
import '../whiteboards.js'; // registers openWhiteboard on window
import '../clients.js'; // registers openClientDetail on window
import { calCheckConflict } from './booking-edit.js';

async function fcOpenDetail(bookingId) {
  calState.fcCurrentEventId = bookingId;
  const modal = document.getElementById('calDetailModal');
  try {
    const r = await fetch(`/api/bookings/${bookingId}/detail`, { headers: { 'Authorization': 'Bearer ' + api.getToken() } });
    if (!r.ok) throw new Error('RDV introuvable');
    const d = await r.json();
    calState.fcDetailData = { notes: d.notes || [], todos: d.todos || [], reminders: d.reminders || [], documents: d.documents || [] };
    const b = d.booking;
    calState.fcCurrentBooking = b;
    const isFreestyle = !b.service_name;
    const s = new Date(b.start_at), e = new Date(b.end_at);

    // -- Color: from service, freestyle custom, or practitioner fallback --
    const accentColor = isFreestyle
      ? (b.booking_color || b.practitioner_color || '#0D7377')
      : (b.service_color || b.practitioner_color || '#0D7377');

    // -- Header gradient --
    const hdrBg = document.getElementById('mHeaderBg');
    hdrBg.style.background = `linear-gradient(135deg,${accentColor} 0%,${accentColor}AA 60%,${accentColor}55 100%)`;

    // -- Client hero --
    const initials = (b.client_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const heroEl = document.getElementById('mClientHero');
    const freeTag = isFreestyle ? `<span class="m-free-tag" style="background:${accentColor}18;color:${accentColor}"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg> LIBRE</span>` : '';
    heroEl.innerHTML = `
      <div class="m-avatar" style="background:linear-gradient(135deg,${accentColor},${accentColor}CC)">${initials}</div>
      <div class="m-client-info">
        <div class="m-client-name">
          <a href="#" onclick="event.preventDefault();closeCalModal('calDetailModal');openClientDetail('${b.client_id}')">${esc(b.client_name || '\u2014')}</a>
          ${freeTag}
        </div>
        <div class="m-client-meta">
          ${b.client_phone ? `<a href="tel:${b.client_phone}">${esc(b.client_phone)}</a>` : ''}
          ${b.client_phone && b.client_email ? '<span>\u00b7</span>' : ''}
          ${b.client_email ? `<a href="mailto:${b.client_email}">${esc(b.client_email)}</a>` : ''}
        </div>
      </div>
      <div class="m-quick-actions">
        ${b.client_phone ? `<a class="m-qbtn" href="tel:${b.client_phone}" title="Appeler"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg></a>` : ''}
        ${b.client_email ? `<a class="m-qbtn" href="mailto:${b.client_email}" title="Email"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg></a>` : ''}
        <button class="m-qbtn" onclick="closeCalModal('calDetailModal');openClientDetail('${b.client_id}')" title="Fiche client"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></button>
        <button class="m-qbtn" onclick="openWhiteboard('${b.id}','${b.client_id}')" title="Whiteboard" style="border-color:var(--primary);background:var(--primary-light)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0D7377" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/></svg></button>
      </div>`;

    // -- Status strip --
    const stMap = {
      pending: { bg: 'var(--gold-bg)', c: 'var(--gold)', l: 'En attente' },
      confirmed: { bg: 'var(--green-bg)', c: 'var(--green)', l: 'Confirm\u00e9' },
      modified_pending: { bg: '#FFF7ED', c: '#D97706', l: 'Modifi\u00e9' },
      completed: { bg: 'var(--surface)', c: 'var(--text-4)', l: 'Termin\u00e9' },
      cancelled: { bg: 'var(--red-bg)', c: 'var(--red)', l: 'Annul\u00e9' },
      no_show: { bg: 'var(--red-bg)', c: 'var(--red)', l: 'No-show' },
      pending_deposit: { bg: '#FEF3E2', c: '#B45309', l: 'Acompte requis' }
    };
    const st = stMap[b.status] || stMap.confirmed;
    const acts = [];
    if (b.status === 'pending') acts.push('<button class="m-st-btn green" onclick="fcSetStatus(\'confirmed\')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Confirmer</button>');
    if (b.status === 'confirmed') acts.push('<button class="m-st-btn green" onclick="fcSetStatus(\'completed\')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Termin\u00e9</button>');
    if (b.status === 'modified_pending') acts.push('<button class="m-st-btn green" onclick="fcSetStatus(\'confirmed\')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Forcer confirmation</button>');
    if (!['cancelled', 'completed'].includes(b.status)) {
      acts.push('<button class="m-st-btn red" onclick="fcSetStatus(\'no_show\')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> No-show</button>');
      acts.push('<button class="m-st-btn red" onclick="fcSetStatus(\'cancelled\')">Annuler</button>');
    }
    if (b.status === 'pending_deposit') acts.push('<button class="m-st-btn green" onclick="fcMarkDepositPaid()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Marquer pay\u00e9</button>');
    if (['completed', 'cancelled', 'no_show'].includes(b.status)) acts.push('<button class="m-st-btn" onclick="fcSetStatus(\'confirmed\')">↩ R\u00e9tablir</button>');
    document.getElementById('mStatusStrip').innerHTML = `
      <span class="m-st-current" style="background:${st.bg};color:${st.c}">
        <span class="m-st-dot" style="background:${st.c}"></span>
        ${st.l}
      </span>
      <div class="m-st-actions">${acts.join('')}</div>`;

    // -- Deposit banner --
    if (b.deposit_required) {
      const depAmt = ((b.deposit_amount_cents || 0) / 100).toFixed(2);
      const depDl = b.deposit_deadline ? new Date(b.deposit_deadline).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      const depPaid = b.deposit_status === 'paid';
      const depRefunded = b.deposit_status === 'refunded';
      const depKept = b.deposit_status === 'cancelled';
      const isFuture = new Date(b.start_at) > new Date();

      let borderCol = '#F59E0B', bgCol = '#FEF3E2', textCol = '#B45309';
      let statusText = 'En attente';
      let extraHtml = '';

      if (depRefunded) {
        borderCol = '#60A5FA'; bgCol = '#EFF6FF'; textCol = '#1D4ED8';
        statusText = 'Rembours\u00e9 \u2705';
      } else if (depKept) {
        borderCol = '#EF4444'; bgCol = '#FEF2F2'; textCol = '#DC2626';
        statusText = 'Conserv\u00e9 (annulation tardive)';
      } else if (depPaid) {
        borderCol = '#86EFAC'; bgCol = '#F0FDF4'; textCol = '#15803D';
        statusText = 'Pay\u00e9 \u2705';
        if (b.deposit_paid_at) extraHtml += `<div style="font-size:.72rem;color:#15803D;margin-top:4px">Pay\u00e9 le ${new Date(b.deposit_paid_at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>`;
        if (isFuture) {
          extraHtml += `<div style="margin-top:8px"><button class="m-st-btn" style="font-size:.72rem;padding:4px 12px;background:#FEF2F2;color:#DC2626;border:1px solid #FECACA;border-radius:6px;cursor:pointer;font-weight:600" onclick="fcRefundDeposit(${b.deposit_amount_cents})">Rembourser l'acompte</button></div>`;
        }
      } else {
        if (depDl) extraHtml += `<div style="font-size:.72rem;color:#92700C;margin-top:4px">Deadline : ${depDl}</div>`;
      }

      const depEl = document.createElement('div');
      depEl.style.cssText = 'padding:12px 16px;margin:0 24px 12px;border-radius:10px;border:1.5px solid ' + borderCol + ';background:' + bgCol;
      depEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:.85rem;font-weight:700;color:${textCol}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        Acompte : ${depAmt} EUR \u2014 ${statusText}
      </div>${extraHtml}`;
      document.getElementById('mStatusStrip').insertAdjacentElement('afterend', depEl);
    }

    // -- Tab counts --
    const cNotes = document.getElementById('mCountNotes');
    const cTodos = document.getElementById('mCountTodos');
    const cDocs = document.getElementById('mCountDocs');
    if (calState.fcDetailData.notes.length > 0) { cNotes.textContent = calState.fcDetailData.notes.length; cNotes.style.display = 'flex'; } else { cNotes.style.display = 'none'; }
    const openTodos = (calState.fcDetailData.todos || []).filter(t => !t.done).length;
    if (openTodos > 0) { cTodos.textContent = openTodos; cTodos.style.display = 'flex'; } else { cTodos.style.display = 'none'; }
    if (cDocs) {
      if (calState.fcDetailData.documents.length > 0) { cDocs.textContent = calState.fcDetailData.documents.length; cDocs.style.display = 'flex'; } else { cDocs.style.display = 'none'; }
    }

    // -- Freestyle vs Normal cards --
    const freeCard = document.getElementById('mFreeCard');
    const svcCard = document.getElementById('mSvcCard');
    const bufSec = document.getElementById('mBufferSec');
    if (isFreestyle) {
      freeCard.style.display = 'block';
      svcCard.style.display = 'none';
      bufSec.style.display = '';
      document.getElementById('uFreeLabel').value = b.custom_label || '';
      const freeColor = b.booking_color || b.practitioner_color || '#0D7377';
      document.getElementById('uFreeColorWrap').innerHTML = cswHTML('uFreeColor', freeColor, false);
      // Live update header + save button on color change
      document.getElementById('uFreeColor').addEventListener('change', function () {
        const c = this.value;
        document.getElementById('mHeaderBg').style.background = `linear-gradient(135deg,${c} 0%,${c}AA 60%,${c}55 100%)`;
        document.querySelector('.m-avatar').style.background = `linear-gradient(135deg,${c},${c}CC)`;
        const sb = document.getElementById('mBtnSave');
        sb.style.background = c; sb.style.boxShadow = `0 2px 8px ${c}40`;
      });
      document.getElementById('uBufBefore').value = 0;
      document.getElementById('uBufAfter').value = 0;
    } else {
      freeCard.style.display = 'none';
      bufSec.style.display = 'none';
      svcCard.style.display = 'flex';
      svcCard.style.borderLeftColor = accentColor;
      const dur = b.duration_min || Math.round((e - s) / 60000);
      const priceStr = b.price_cents ? ' \u00b7 ' + (b.price_cents / 100).toFixed(2) + '\u20ac' : '';
      svcCard.innerHTML = `
        <div>
          <div class="m-svc-name">${esc(b.service_name)}</div>
          <div class="m-svc-meta">${dur} min${b.buffer_after_min ? ' \u00b7 buffer ' + b.buffer_after_min + ' min apr\u00e8s' : ''}${priceStr ? '' : ''}</div>
        </div>
        ${b.price_cents ? '<div class="m-svc-price">' + (b.price_cents / 100).toFixed(2) + '\u20ac</div>' : ''}`;
    }

    // -- Save button color (freestyle = accent color) --
    const saveBtn = document.getElementById('mBtnSave');
    if (isFreestyle) {
      saveBtn.style.background = accentColor;
      saveBtn.style.boxShadow = `0 2px 8px ${accentColor}40`;
    } else {
      saveBtn.style.background = '';
      saveBtn.style.boxShadow = '';
    }

    // -- Group siblings --
    const siblings = d.group_siblings || [];
    const groupEl = document.getElementById('mGroupSiblings');
    if (siblings.length > 1) {
      let gh = `<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Groupe (${siblings.length} prestations)</span><span class="m-sec-line"></span></div><div style="display:flex;flex-direction:column;gap:3px">`;
      siblings.forEach(sib => {
        const isCur = sib.id === bookingId;
        const sT = new Date(sib.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
        const eT = new Date(sib.end_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
        gh += `<div class="m-group-item${isCur ? ' current' : ''}">
          <span class="g-dot" style="background:${sib.service_color || 'var(--primary)'}"></span>
          <span style="font-weight:${isCur ? '700' : '400'}">${sib.service_name || 'RDV libre'}</span>
          <span class="g-time">${sT} \u2013 ${eT}</span>
        </div>`;
      });
      gh += '</div></div>';
      groupEl.innerHTML = gh;
      groupEl.style.display = 'block';
    } else { groupEl.style.display = 'none'; }

    // -- Horaire --
    const ds = s.toISOString().split('T')[0], stm = s.toTimeString().slice(0, 5), etm = e.toTimeString().slice(0, 5);
    document.getElementById('calEditDate').value = ds;
    document.getElementById('calEditStart').value = stm;
    document.getElementById('calEditEnd').value = etm;
    calState.fcEditOriginal = { date: ds, start: stm, end: etm, practitioner_id: b.practitioner_id, comment: b.comment_client || '', internal_note: b.internal_note || '', custom_label: b.custom_label || '', color: b.booking_color || '', client_phone: b.client_phone || '', client_email: b.client_email || '' };
    const dm = Math.round((e - s) / 60000);
    document.querySelectorAll('.m-chip').forEach(c => c.classList.toggle('active', parseInt(c.textContent) === dm || ({ '1h': 60, '1h30': 90, '2h': 120 }[c.textContent.trim()] === dm)));
    document.getElementById('calEditDiff').style.display = 'none';
    document.getElementById('calNotifyPanel').style.display = 'none';
    document.getElementById('calConflictWarn').style.display = 'none';
    calState.fcSelectedNotifyChannel = null;
    // Check conflicts with current time (in case it already overlaps)
    setTimeout(calCheckConflict, 50);

    // -- Praticien dropdown with color dot --
    const pracSel = document.getElementById('uPracSelect');
    pracSel.innerHTML = calState.fcPractitioners.map(p => `<option value="${p.id}"${p.id === b.practitioner_id ? ' selected' : ''}>${p.display_name}</option>`).join('');
    // Practitioners cannot reassign to others
    pracSel.disabled = (userRole === 'practitioner');
    const curPrac = calState.fcPractitioners.find(p => p.id === b.practitioner_id);
    document.getElementById('mPracDot').style.background = curPrac?.color || 'var(--primary)';
    pracSel.onchange = function () {
      const sel = calState.fcPractitioners.find(p => p.id === this.value);
      document.getElementById('mPracDot').style.background = sel?.color || 'var(--primary)';
    };

    // -- Client contact fields --
    document.getElementById('uClientPhone').value = b.client_phone || '';
    document.getElementById('uClientEmail').value = b.client_email || '';

    // -- Comment --
    document.getElementById('uComment').value = b.comment_client || '';

    // -- Internal note --
    document.getElementById('calIntNote').value = b.internal_note || '';

    // -- Render sub-tabs --
    fcRenderNotes(); fcRenderSession(b); fcRenderTodos(); fcRenderReminders(); fcRenderDocs(b);

    // -- Bottom bar: show/hide buttons based on status --
    const isFrozen = ['cancelled', 'no_show'].includes(b.status);
    document.getElementById('mBtnSave').style.display = isFrozen ? 'none' : '';
    document.getElementById('mBtnNotify').style.display = isFrozen ? 'none' : '';
    document.getElementById('mBtnCancel').style.display = isFrozen ? 'none' : '';
    // Only owners/managers can permanently delete
    document.getElementById('mBtnPurge').style.display = (isFrozen && userRole !== 'practitioner') ? '' : 'none';

    // -- Show modal --
    switchCalTab(document.querySelector('.m-tab[data-tab="rdv"]'), 'rdv');
    modal.classList.add('open');
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
}

function closeCalModal(id) {
  const modal = document.getElementById(id);
  modal.classList.remove('open');
  // Auto-save internal note on close
  if (id === 'calDetailModal' && calState.fcCurrentEventId) {
    const note = document.getElementById('calIntNote')?.value;
    if (note !== undefined) {
      fetch(`/api/bookings/${calState.fcCurrentEventId}/note`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ internal_note: note })
      }).catch(() => {});
    }
  }
}

function switchCalTab(el, tab) {
  document.querySelectorAll('.m-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.cal-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  const panelMap = { rdv: 'calPanelRdv', notes: 'calPanelNotes', session: 'calPanelSession', todos: 'calPanelTodos', reminders: 'calPanelReminders', docs: 'calPanelDocs' };
  document.getElementById(panelMap[tab])?.classList.add('active');
}

// ── Docs tab rendering ──
function fcRenderDocs(booking) {
  const listEl = document.getElementById('mDocsList');
  const sendEl = document.getElementById('mDocsSend');
  if (!listEl || !sendEl) return;

  const docs = calState.fcDetailData.documents || [];

  if (docs.length === 0) {
    listEl.innerHTML = '<div class="cal-empty"><div class="cal-empty-icon">📄</div>Aucun document envoyé</div>';
  } else {
    const stColors = { pending: '#9C958E', sent: '#E6A817', viewed: '#3B82F6', completed: '#1B7A42' };
    const stLabels = { pending: 'En attente', sent: 'Envoyé', viewed: 'Consulté', completed: 'Complété' };
    const stBg = { pending: 'var(--surface)', sent: '#FEF3E2', viewed: '#EFF6FF', completed: '#F0FDF4' };
    const typeIco = { info: 'ℹ️', form: '📋', consent: '✍️' };

    listEl.innerHTML = docs.map(doc => {
      const st = doc.status || 'pending';
      const sentDate = doc.sent_at ? new Date(doc.sent_at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:${stBg[st]};margin-bottom:6px;border:1px solid ${stColors[st]}22">
        <span style="font-size:1.2rem">${typeIco[doc.template_type] || '📄'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:.85rem;font-weight:600;color:var(--text)">${esc(doc.template_name)}</div>
          <div style="font-size:.72rem;color:var(--text-4)">${sentDate}</div>
        </div>
        <span style="font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:6px;background:${stColors[st]}18;color:${stColors[st]}">${stLabels[st]}</span>
      </div>`;
    }).join('');
  }

  // Send button (only if client has email)
  const b = booking || calState.fcCurrentBooking;
  if (b?.client_email) {
    sendEl.innerHTML = `
      <div class="m-sec">
        <div class="m-sec-head"><span class="m-sec-title">Envoyer un document</span><span class="m-sec-line"></span></div>
        <div style="display:flex;gap:8px;align-items:center">
          <select id="mDocTemplateSelect" class="m-input" style="flex:1;font-size:.82rem">
            <option value="">Chargement...</option>
          </select>
          <button onclick="fcSendDocument()" class="m-st-btn green" style="white-space:nowrap;padding:8px 16px">Envoyer</button>
        </div>
      </div>`;
    // Load templates
    fetch('/api/documents', { headers: { 'Authorization': 'Bearer ' + api.getToken() } })
      .then(r => r.json())
      .then(data => {
        const templates = (data.templates || []).filter(t => t.is_active);
        const sel = document.getElementById('mDocTemplateSelect');
        if (sel) {
          if (templates.length === 0) {
            sel.innerHTML = '<option value="">Aucun template actif</option>';
          } else {
            const typeLabels = { info: 'Info', form: 'Formulaire', consent: 'Consentement' };
            sel.innerHTML = templates.map(t => `<option value="${t.id}">${t.name} (${typeLabels[t.type] || t.type})</option>`).join('');
          }
        }
      })
      .catch(() => {
        const sel = document.getElementById('mDocTemplateSelect');
        if (sel) sel.innerHTML = '<option value="">Erreur de chargement</option>';
      });
  } else {
    sendEl.innerHTML = '<div style="font-size:.78rem;color:var(--text-4);text-align:center;padding:8px">Le client n\'a pas d\'email — impossible d\'envoyer des documents</div>';
  }
}

async function fcSendDocument() {
  const sel = document.getElementById('mDocTemplateSelect');
  const templateId = sel?.value;
  if (!templateId) { gToast('Choisissez un template', 'error'); return; }

  const bookingId = calState.fcCurrentEventId;
  try {
    const r = await fetch(`/api/bookings/${bookingId}/send-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ template_id: templateId })
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
    const data = await r.json();

    // Add to local state and re-render
    calState.fcDetailData.documents.unshift(data.send);
    const cDocs = document.getElementById('mCountDocs');
    if (cDocs) { cDocs.textContent = calState.fcDetailData.documents.length; cDocs.style.display = 'flex'; }
    fcRenderDocs(calState.fcCurrentBooking);
    gToast('Document envoyé !', 'success');
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
}

// Expose to global scope for onclick handlers
bridge({ fcOpenDetail, closeCalModal, switchCalTab, fcSendDocument });

export { fcOpenDetail, closeCalModal, switchCalTab };
