/* ─── Booking Engine Module ─── */
/* Usage: BookingEngine.init({ container, slug, siteData, ... }) */
(function(){
'use strict';

var DAYS_SHORT=['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
var DAYS_FULL=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
var MONTHS=['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];
var MONTHS_FULL=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
var MODE_LABELS={cabinet:'Au cabinet',visio:'Visio',phone:'Téléphone',domicile:'À domicile'};
var MODE_ICONS={cabinet:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>',visio:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',phone:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',domicile:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'};
var UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var WL_DAYS=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

// ── Private state ──
var C=null; // container
var slug='';
var siteData=null;
var selectedService=null,selectedPractitioner=null,selectedMode=null,selectedDate=null,selectedSlot=null;
var slotsData={},weekOffset=0,weekHasFeatured=false;
var noPrefSelected=false;
var stepOrder=[1,2,3,4,5];
var currentStepIdx=0;
var vedetteMode=false,vedetteSlots=[],lockedSet={};
var selectedServices=[];
var selectedVariants={};
var multiServiceMode=false;
var oauthProvider=null,oauthProviderId=null,oauthAuthenticated=false;
var _submitting=false;
var _onBack=null;
var _returnMode='inline';
var _preSelectedServiceId=null;
var _isDark=false;
var _featuredSlots=null;
var _lockedWeeks=null;

// ── Helpers ──
function $(sel){return C.querySelector(sel);}
function $$(sel){return C.querySelectorAll(sel);}
function escH(s){return(s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

function svcDisplayPrice(s){
  if(s.variants&&s.variants.length>0){
    var prices=s.variants.filter(function(v){return v.price_cents!=null;}).map(function(v){return v.price_cents;});
    if(prices.length>0)return 'Dès '+(Math.min.apply(null,prices)/100).toFixed(0)+' \u20ac';
    return s.price_label||'';
  }
  return s.price_cents?(s.price_cents/100).toFixed(0)+' \u20ac':(s.price_label||'Gratuit');
}
function svcDurationLabel(s){
  if(s.variants&&s.variants.length>0){
    var durs=s.variants.map(function(v){return v.duration_min;});
    var mn=Math.min.apply(null,durs),mx=Math.max.apply(null,durs);
    return mn===mx?mn+' min':mn+'\u2013'+mx+' min';
  }
  return (s.duration_min||0)+' min';
}
function getMonday(dateStr){
  var dt=new Date(dateStr+'T12:00:00');
  var day=dt.getDay();
  var diff=day===0?-6:1-day;
  dt.setDate(dt.getDate()+diff);
  return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
}

// ── Generate HTML ──
function buildHTML(opts){
  var showHeader=opts.returnMode==='standalone';
  var h='';
  if(showHeader){
    h+='<div class="header"><div class="header-logo" data-bke="hLogo">?</div><div class="header-info"><h2 data-bke="hName">\u2014</h2><p data-bke="hTagline">\u2014</p></div><a class="header-back" data-bke="hBack" href="#">\u2190 Retour</a></div>';
  }
  h+='<div class="progress" data-bke="progressBar"></div>';
  h+='<div class="err" data-bke="errMsg"></div>';
  h+='<div class="loading" data-bke="loadingState"><div class="spinner"></div><p style="margin-top:8px">Chargement...</p></div>';

  // Step vedette
  h+='<div class="step" data-step="vedette" data-bke="stepVedette"><h2 class="step-title">Choisir un créneau</h2><p class="step-sub">Sélectionnez un horaire disponible.</p>';
  h+='<div class="vedette-banner"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;flex-shrink:0"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg><span data-bke="vedetteBannerLabel">Créneaux disponibles cette semaine</span></div>';
  h+='<div data-bke="vedetteList"></div>';
  h+='<button class="btn-next" data-bke="btnStepVedette" disabled>Continuer \u2192</button>';
  h+='<button class="btn-outline" data-bke="btnVedetteMore" style="margin-top:8px;font-size:.82rem">Voir d\'autres disponibilités \u2192</button></div>';

  // Step 1: service
  h+='<div class="step" data-step="1" data-bke="step1"><h2 class="step-title">Choisir une prestation</h2><p class="step-sub">Quel type de rendez-vous souhaitez-vous ?</p>';
  h+='<div data-bke="catTabs" class="cat-tabs" style="display:none"></div>';
  h+='<div data-bke="svcList"></div>';
  h+='<div class="cart-sticky" data-bke="cartSticky"><div class="cart-chips" data-bke="cartChips"></div><div class="cart-sticky-inner"><div class="cart-info"><div class="cart-count" data-bke="cartCount">0 prestations</div><div class="cart-meta" data-bke="cartMeta">0 min \u00b7 0 \u20ac</div></div><div class="cart-actions"><button class="cart-clear" data-bke="cartClear" title="Vider la sélection"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button><button class="cart-cta" data-bke="cartCta">Continuer \u2192</button></div></div></div>';
  h+='<button class="btn-next" data-bke="btnStep1" disabled>Continuer \u2192</button></div>';

  // Step 2: practitioner
  h+='<div class="step" data-step="2" data-bke="step2"><h2 class="step-title">Choisir un praticien</h2><p class="step-sub" data-bke="pracSub">Avec qui souhaitez-vous prendre rendez-vous ?</p>';
  h+='<div data-bke="pracList"></div>';
  h+='<button class="btn-next" data-bke="btnStep2" disabled>Continuer \u2192</button>';
  h+='<button class="btn-outline" data-bke="backStep2">\u2190 Retour</button></div>';

  // Step 3: date + time
  h+='<div class="step" data-step="3" data-bke="step3"><h2 class="step-title">Choisir un créneau</h2><p class="step-sub" data-bke="slotSub">Sélectionnez une date puis un horaire.</p>';
  h+='<div data-bke="step3Recap" style="display:none"></div>';
  h+='<div class="mode-row" data-bke="modeRow" style="display:none"></div>';
  h+='<div class="date-nav"><button data-bke="prevWeek">\u2039</button><span class="label" data-bke="weekLabel">\u2014</span><button data-bke="nextWeek">\u203a</button></div>';
  h+='<div class="featured-banner" data-bke="featuredBanner" style="display:none"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg><span data-bke="featuredLabel"></span></div>';
  h+='<div class="date-row" data-bke="dateRow"></div>';
  h+='<div data-bke="slotsArea"><div class="no-slots">Chargement...</div></div>';
  h+='<div data-bke="wlArea"></div>';
  h+='<button class="btn-next" data-bke="btnStep3" disabled>Continuer \u2192</button>';
  h+='<button class="btn-outline" data-bke="backStep3">\u2190 Retour</button></div>';

  // Step 4: client info
  h+='<div class="step" data-step="4" data-bke="step4"><h2 class="step-title">Vos coordonnées</h2><p class="step-sub">Pour confirmer votre rendez-vous.</p>';
  h+='<div class="summary" data-bke="bookingSummary"></div>';
  // OAuth badge
  h+='<div class="oauth-badge" data-bke="oauthBadge" style="display:none"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span data-bke="oauthBadgeText">Connecté</span><span class="oauth-email" data-bke="oauthBadgeEmail"></span></div>';
  // OAuth buttons
  h+='<div class="oauth-area" data-bke="oauthArea"><div class="oauth-btns">';
  h+='<button class="oauth-btn google" data-bke="oauthGoogle"><svg viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.93 10.93 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>Continuer avec Google</button>';
  h+='<button class="oauth-btn apple" data-bke="oauthApple"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>Continuer avec Apple</button>';
  h+='<button class="oauth-btn facebook" data-bke="oauthFacebook"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>Continuer avec Facebook</button>';
  h+='</div><div class="oauth-manual" data-bke="oauthManual"><a data-bke="oauthManualLink">Remplir manuellement \u2192</a></div></div>';
  // Form fields
  h+='<div data-bke="clientFormFields" style="display:none">';
  h+='<div class="fg"><label class="fl">Prénom et nom *</label><input class="fi" data-bke="cName" placeholder="Marie Dupont" autocomplete="name" inputmode="text"><div class="field-err" data-bke="errName"></div></div>';
  h+='<div class="fg"><label class="fl">Téléphone mobile *</label><div class="phone-wrap"><span class="phone-prefix"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="8.67" y1="4" x2="8.67" y2="20"/><line x1="15.33" y1="4" x2="15.33" y2="20"/></svg> +32</span><input class="fi" data-bke="cPhone" placeholder="4XX XX XX XX" autocomplete="tel" inputmode="tel" maxlength="12"></div><div class="field-hint">Format : 04XX XX XX XX (mobile belge)</div><div class="field-err" data-bke="errPhone"></div></div>';
  h+='<div class="fg"><label class="fl">Email *</label><input class="fi" data-bke="cEmail" placeholder="marie@example.com" autocomplete="email" inputmode="email"><div class="field-err" data-bke="errEmail"></div></div>';
  h+='<div data-bke="bceArea" style="display:none"><div class="fg"><label class="fl">N° BCE / entreprise</label><input class="fi" data-bke="cBce" placeholder="0XXX.XXX.XXX" inputmode="numeric"></div></div>';
  h+='<span class="bce-toggle" data-bke="bceToggle">+ Ajouter un n° BCE</span>';
  h+='<div class="fg"><label class="fl">Remarque <span class="opt">(optionnel)</span></label><textarea class="fi ft" data-bke="cComment" maxlength="500" placeholder="Informations utiles pour le praticien..."></textarea><div data-bke="cCommentCount" style="text-align:right;font-size:.7rem;color:#9CA3AF;margin-top:2px"></div></div>';
  h+='</div>';
  h+='<label class="checkbox"><input type="checkbox" data-bke="cConsent"> J\'accepte les confirmations et rappels par email et SMS.</label>';
  h+='<div data-bke="bkFlexBox" style="display:none;margin:12px 0;padding:12px 14px;border-radius:8px;background:rgba(13,115,119,.06);border:1px solid rgba(13,115,119,.2)"><label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;font-size:.88rem"><input type="checkbox" data-bke="bkFlexible" style="margin-top:3px"><span><strong>J\'accepte un RDV flexible</strong><span data-bke="bkFlexDiscount" style="color:var(--primary);font-weight:600"></span><br><span style="font-size:.78rem;opacity:.7">Le praticien pourra éventuellement déplacer votre créneau dans la semaine si nécessaire.</span></span></label></div>';
  h+='<button class="btn-next" data-bke="btnStep4">Confirmer le rendez-vous \u2192</button>';
  h+='<button class="btn-outline" data-bke="backStep4">\u2190 Retour</button></div>';

  // Step 5: confirmation
  h+='<div class="step" data-step="5" data-bke="step5"><div class="confirm-box"><div class="icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div><h3>Rendez-vous confirmé !</h3><p>Vous recevrez une confirmation par email et SMS.</p><div class="confirm-details" data-bke="confirmDetails"></div><div class="cal-buttons" data-bke="calButtons"></div></div>';
  h+='<button class="btn-outline" style="margin-top:16px" data-bke="btnBackSite">\u2190 Retour vers le site</button></div>';

  return h;
}

// ── DOM helper: query by data-bke ──
function el(name){return C.querySelector('[data-bke="'+name+'"]');}

// ── Show variant modal ──
function showVariantModal(service,callback){
  var ex=C.querySelector('.var-overlay');if(ex)ex.remove();
  var h='<div class="var-overlay" data-bke="variantModal">';
  h+='<div class="var-modal"><div class="var-modal-h"><h3>'+escH(service.name)+'</h3><button class="var-modal-close">&times;</button></div>';
  if(service.description)h+='<p class="var-modal-desc">'+escH(service.description)+'</p>';
  h+='<div class="var-list">';
  service.variants.forEach(function(v,i){
    var price=v.price_cents?(v.price_cents/100).toFixed(0)+' \u20ac':'';
    h+='<div class="var-card" data-idx="'+i+'">'
      +'<div class="var-info"><div class="var-name">'+escH(v.name)+'</div>'
      +(v.description?'<div class="var-desc" style="font-size:.78rem;color:var(--text-4);margin:2px 0 4px;line-height:1.4">'+escH(v.description)+'</div>':'')
      +'<div class="var-meta">'+v.duration_min+' min</div></div>'
      +'<div class="var-price">'+price+'</div>'
      +'<button class="var-sel-btn">S\u00e9lectionner</button></div>';
  });
  h+='</div></div></div>';
  C.insertAdjacentHTML('beforeend',h);
  var overlay=el('variantModal');
  overlay.addEventListener('click',function(e){if(e.target===overlay)overlay.remove();});
  overlay.querySelector('.var-modal-close').addEventListener('click',function(){overlay.remove();});
  overlay.querySelectorAll('.var-card').forEach(function(card){
    card.querySelector('.var-sel-btn').addEventListener('click',function(e){
      e.stopPropagation();
      var idx=parseInt(card.dataset.idx);
      var variant=service.variants[idx];
      overlay.remove();
      callback(variant);
    });
  });
}

// ── Service selection ──
function selectService(id){
  var svc=siteData.services.find(function(s){return s.id===id;});
  if(!svc||svc.bookable_online===false)return;
  if(multiServiceMode){
    var idx=selectedServices.findIndex(function(s){return s.id===id;});
    if(idx>=0){
      selectedServices.splice(idx,1);delete selectedVariants[id];
      _updateSvcCards();updateCartBar();
      el('btnStep1').disabled=selectedServices.length===0;
      selectedService=selectedServices.length===1?selectedServices[0]:(selectedServices[0]||null);
      selectedPractitioner=null;noPrefSelected=false;selectedMode=null;selectedDate=null;selectedSlot=null;
      computeStepOrder();
    }else if(selectedServices.length<5){
      selectedServices.push(svc);
      _updateSvcCards();updateCartBar();
      el('btnStep1').disabled=false;
      selectedService=selectedServices.length===1?selectedServices[0]:(selectedServices[0]||null);
      selectedPractitioner=null;noPrefSelected=false;selectedMode=null;selectedDate=null;selectedSlot=null;
      computeStepOrder();
    }
  }else{
    selectedService=svc;_updateSvcCards();
    el('btnStep1').disabled=false;
    selectedPractitioner=null;noPrefSelected=false;selectedMode=null;selectedDate=null;selectedSlot=null;
    computeStepOrder();
  }
}
function selectVariant(svcId,varIdx){
  var svc=siteData.services.find(function(s){return s.id===svcId;});
  if(!svc||svc.bookable_online===false||!svc.variants||!svc.variants[varIdx])return;
  var variant=svc.variants[varIdx];
  if(multiServiceMode){
    var idx=selectedServices.findIndex(function(s){return s.id===svcId;});
    if(idx>=0&&selectedVariants[svcId]&&selectedVariants[svcId].id===variant.id){
      selectedServices.splice(idx,1);delete selectedVariants[svcId];
      _updateSvcCards();updateCartBar();
      el('btnStep1').disabled=selectedServices.length===0;
      selectedService=selectedServices.length===1?selectedServices[0]:(selectedServices[0]||null);
      selectedPractitioner=null;noPrefSelected=false;selectedMode=null;selectedDate=null;selectedSlot=null;
      computeStepOrder();
    }else if(idx>=0){
      selectedVariants[svcId]=variant;_updateSvcCards();updateCartBar();
    }else if(selectedServices.length<5){
      selectedVariants[svcId]=variant;selectedServices.push(svc);
      _updateSvcCards();updateCartBar();
      el('btnStep1').disabled=false;
      selectedService=selectedServices.length===1?selectedServices[0]:(selectedServices[0]||null);
      selectedPractitioner=null;noPrefSelected=false;selectedMode=null;selectedDate=null;selectedSlot=null;
      computeStepOrder();
    }
  }else{
    if(selectedService&&selectedService.id===svcId&&selectedVariants[svcId]&&selectedVariants[svcId].id===variant.id){
      selectedService=null;delete selectedVariants[svcId];_updateSvcCards();
      el('btnStep1').disabled=true;return;
    }
    selectedVariants[svcId]=variant;selectedService=svc;_updateSvcCards();
    el('btnStep1').disabled=false;
    selectedPractitioner=null;noPrefSelected=false;selectedMode=null;selectedDate=null;selectedSlot=null;
    computeStepOrder();
  }
}
function _updateSvcCards(){_updateSkButtons();}
function _updateSkButtons(){
  $$('.sk-svc-btn').forEach(function(btn){
    var id=btn.dataset.id;
    var svc=siteData.services.find(function(s){return s.id===id;});
    if(!svc)return;
    var isSelected=multiServiceMode?selectedServices.some(function(s){return s.id===id;}):selectedService&&selectedService.id===id;
    if(isSelected){btn.textContent='Sélectionné \u2713';btn.classList.add('sel');}
    else{btn.textContent='Sélectionner';btn.classList.remove('sel');}
  });
}

// ── Cart bar ──
function updateCartBar(){
  var bar=el('cartSticky');if(!bar)return;
  var n=selectedServices.length;
  bar.classList.toggle('show',n>0);
  if(n===0){el('cartChips').innerHTML='';return;}
  var totalMin=selectedServices.reduce(function(s,svc){var v=selectedVariants[svc.id];return s+(v?v.duration_min:(svc.duration_min||0));},0);
  var totalPrice=selectedServices.reduce(function(s,svc){var v=selectedVariants[svc.id];return s+(v&&v.price_cents!=null?v.price_cents:(svc.price_cents||0));},0);
  var hours=Math.floor(totalMin/60),mins=totalMin%60;
  var durStr=hours>0?hours+'h'+(mins>0?String(mins).padStart(2,'0'):''):totalMin+' min';
  var priceStr=totalPrice>0?(totalPrice/100).toFixed(0)+' \u20ac':'Gratuit';
  el('cartCount').textContent=n+' prestation'+(n>1?'s':'');
  el('cartMeta').textContent=durStr+' \u00b7 '+priceStr;
  el('cartChips').innerHTML=selectedServices.map(function(svc){
    var v=selectedVariants[svc.id];var varLabel=v?(' \u00b7 '+escH(v.name)):'';
    return '<span class="cart-chip"><span class="cart-chip-name">'+escH(svc.name)+'</span>'
      +(varLabel?'<span class="cart-chip-var">'+varLabel+'</span>':'')
      +'<button class="cart-chip-rm" data-rm="'+svc.id+'" title="Retirer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></span>';
  }).join('');
  el('cartChips').querySelectorAll('.cart-chip-rm').forEach(function(btn){
    btn.addEventListener('click',function(e){e.stopPropagation();removeCartService(btn.dataset.rm);});
  });
}
function removeCartService(svcId){
  var idx=selectedServices.findIndex(function(s){return s.id===svcId;});
  if(idx>=0){
    selectedServices.splice(idx,1);delete selectedVariants[svcId];
    _updateSvcCards();updateCartBar();
    el('btnStep1').disabled=selectedServices.length===0;
    selectedService=selectedServices.length>=1?selectedServices[0]:null;
    selectedPractitioner=null;noPrefSelected=false;selectedMode=null;selectedDate=null;selectedSlot=null;
    computeStepOrder();
  }
}
function clearCart(){
  selectedServices=[];selectedVariants={};selectedService=null;
  selectedPractitioner=null;noPrefSelected=false;selectedMode=null;selectedDate=null;selectedSlot=null;
  _updateSvcCards();updateCartBar();
  el('btnStep1').disabled=true;computeStepOrder();
}

// ── Practitioner ──
function buildPractitioners(){
  var pracs;
  if(multiServiceMode&&selectedServices.length>1){
    pracs=siteData.practitioners.filter(function(p){return selectedServices.every(function(svc){return p.service_ids.includes(svc.id);});});
    if(pracs.length===0){
      el('pracList').innerHTML='<div class="no-slots">Aucun praticien ne propose toutes les prestations sélectionnées.</div>';
      el('btnStep2').disabled=true;return true;
    }
  }else{
    pracs=siteData.practitioners.filter(function(p){return p.service_ids.includes(selectedService.id);});
  }
  var displayPracs=pracs.length>0?pracs:siteData.practitioners;
  if(!siteData.business.practitioner_choice_enabled){
    selectedPractitioner=null;noPrefSelected=true;return false;
  }
  if(displayPracs.length<=1){
    selectedPractitioner=displayPracs[0]||siteData.practitioners[0];noPrefSelected=false;return false;
  }
  var list=el('pracList');
  var html='<div class="prac-card" data-id="no-pref"><div class="prac-avatar" style="background:var(--text-4)"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div><div class="prac-info"><h4>Pas de préférence</h4><p>Premier praticien disponible</p></div></div>';
  html+=displayPracs.map(function(p){
    var pi=p.display_name.split(' ').map(function(w){return w[0];}).join('').toUpperCase().slice(0,2);
    var av=p.photo_url?'<div class="prac-avatar" style="background:'+(p.color||'var(--primary)')+'"><img src="'+escH(p.photo_url)+'"></div>'
      :'<div class="prac-avatar" style="background:'+(p.color||'var(--primary)')+'">'+escH(pi)+'</div>';
    return '<div class="prac-card" data-id="'+p.id+'">'+av+'<div class="prac-info"><h4>'+escH(p.display_name)+'</h4><p>'+escH(p.title||'')+(p.years_experience?' \u00b7 '+p.years_experience+' ans':'')+'</p></div></div>';
  }).join('');
  list.innerHTML=html;
  list.querySelectorAll('.prac-card').forEach(function(c){
    c.addEventListener('click',function(){
      if(c.dataset.id==='no-pref'){selectedPractitioner=null;noPrefSelected=true;}
      else{selectedPractitioner=siteData.practitioners.find(function(p){return p.id===c.dataset.id;});noPrefSelected=false;}
      list.querySelectorAll('.prac-card').forEach(function(x){x.classList.toggle('sel',x===c);});
      el('btnStep2').disabled=false;
    });
  });
  el('btnStep2').disabled=true;
  return true;
}

// ── Step order ──
function computeStepOrder(){
  if(vedetteMode){stepOrder=['vedette',4,5];renderProgress();return;}
  var showPrac=false;
  if(siteData.business.practitioner_choice_enabled){
    if(multiServiceMode&&selectedServices.length>1){
      var linked=siteData.practitioners.filter(function(p){return selectedServices.every(function(svc){return p.service_ids.includes(svc.id);});});
      var dp=linked.length>0?linked:siteData.practitioners;
      showPrac=dp.length>1;
    }else if(selectedService){
      var linked2=siteData.practitioners.filter(function(p){return p.service_ids.includes(selectedService.id);});
      var dp2=linked2.length>0?linked2:siteData.practitioners;
      showPrac=dp2.length>1;
    }else{
      showPrac=siteData.practitioners.length>1;
    }
  }
  stepOrder=showPrac?[1,2,3,4,5]:[1,3,4,5];
  renderProgress();
}
function renderProgress(){
  el('progressBar').innerHTML=stepOrder.map(function(_,i){return '<div class="pdot" data-idx="'+i+'"></div>';}).join('');
}
function updateProgress(){
  $$('.pdot').forEach(function(d,i){d.classList.toggle('done',i<currentStepIdx);d.classList.toggle('active',i===currentStepIdx);});
}

// ── Navigation ──
function goToStep(n){
  hideError();
  // Toggle wide for step 1 two-column layout
  if(n===1&&C.querySelector('.sk-cats'))C.classList.add('bke-wide');
  else C.classList.remove('bke-wide');

  if(n===2){var showPrac=buildPractitioners();if(!showPrac){computeStepOrder();n=3;}}
  if(n===3){buildStep3Recap();}
  if(n===3&&!vedetteMode){
    if(!siteData.business.practitioner_choice_enabled){selectedPractitioner=null;noPrefSelected=true;}
    else if(!selectedPractitioner&&!noPrefSelected){
      var pracs;
      if(multiServiceMode&&selectedServices.length>1){pracs=siteData.practitioners.filter(function(p){return selectedServices.every(function(svc){return p.service_ids.includes(svc.id);});});}
      else{pracs=siteData.practitioners.filter(function(p){return p.service_ids.includes(selectedService.id);});}
      selectedPractitioner=pracs[0]||siteData.practitioners[0];
    }
    buildModeSelector();weekOffset=0;selectedDate=null;selectedSlot=null;slotsData={};loadSlots();
  }
  if(n===4){buildSummary();setupFlexibility();}

  $$('.step').forEach(function(s){s.classList.remove('active');});
  var stepEl=C.querySelector('.step[data-step="'+n+'"]');
  if(stepEl)stepEl.classList.add('active');
  currentStepIdx=stepOrder.indexOf(n);
  updateProgress();
  // Scroll: in inline mode scroll to container, in standalone scroll to top
  if(_returnMode==='inline')C.scrollIntoView({behavior:'smooth'});
  else window.scrollTo(0,0);
}
function goNext(){var nextIdx=currentStepIdx+1;if(nextIdx<stepOrder.length)goToStep(stepOrder[nextIdx]);}
function goPrev(){
  var prevIdx=currentStepIdx-1;
  if(prevIdx<0&&_returnMode==='inline'&&_onBack){_onBack();return;}
  if(prevIdx>=0)goToStep(stepOrder[prevIdx]);
}

function buildStep3Recap(){
  var recapEl=el('step3Recap');if(!recapEl)return;
  var rh='';
  if(multiServiceMode&&selectedServices.length>1){
    selectedServices.forEach(function(svc){
      var cv=selectedVariants[svc.id];
      var cn=cv?escH(svc.name)+' \u2014 '+escH(cv.name):escH(svc.name);
      var cd=cv?cv.duration_min:svc.duration_min;
      var cpc=cv&&cv.price_cents!=null?cv.price_cents:svc.price_cents;
      var cpStr=cpc?(cpc/100).toFixed(0)+' \u20ac':(svc.price_label||'Gratuit');
      rh+='<div class="sum-row"><span class="label">\u2022 '+cn+'</span><span class="val">'+cd+' min \u00b7 '+cpStr+'</span></div>';
    });
    var tMin=selectedServices.reduce(function(s,svc){var v=selectedVariants[svc.id];return s+(v?v.duration_min:svc.duration_min);},0);
    var tPrice=selectedServices.reduce(function(s,svc){var v=selectedVariants[svc.id];return s+(v&&v.price_cents!=null?v.price_cents:(svc.price_cents||0));},0);
    var tPriceStr=tPrice>0?(tPrice/100).toFixed(0)+' \u20ac':'Gratuit';
    rh+='<div class="sum-divider"></div><div class="sum-row"><span class="label"><strong>Total</strong></span><span class="val"><strong>'+tMin+' min \u00b7 '+tPriceStr+'</strong></span></div>';
  }else if(selectedService){
    var cv2=selectedVariants[selectedService.id];
    var sn=cv2?escH(selectedService.name)+' \u2014 '+escH(cv2.name):escH(selectedService.name);
    var sd=cv2?cv2.duration_min:selectedService.duration_min;
    var spc=cv2&&cv2.price_cents!=null?cv2.price_cents:selectedService.price_cents;
    var spStr=spc?(spc/100).toFixed(0)+' \u20ac':(selectedService.price_label||'Gratuit');
    rh+='<div class="sum-row"><span class="label">'+sn+'</span><span class="val">'+sd+' min \u00b7 '+spStr+'</span></div>';
  }
  // Restricted availability note
  var restrictedSvcs=(multiServiceMode?selectedServices:[selectedService]).filter(function(s){return s&&s.available_schedule&&s.available_schedule.type==='restricted';});
  if(restrictedSvcs.length>0){
    rh+='<div style="margin-top:10px;padding:8px 12px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;font-size:.75rem;color:#92400E">';
    rh+='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    rh+='<strong>Disponibilité limitée :</strong> '+restrictedSvcs.map(function(s){return escH(s.name);}).join(', ')+' \u2014 les créneaux sont ajustés en conséquence.</div>';
  }
  if(rh){recapEl.className='summary';recapEl.innerHTML=rh;recapEl.style.display='';}
  else{recapEl.style.display='none';}
}

function setupFlexibility(){
  var flexBox=el('bkFlexBox');
  var anyFlex=false,flexPct=0;
  if(multiServiceMode&&selectedServices.length>1){
    anyFlex=selectedServices.some(function(s){return s.flexibility_enabled;});
    flexPct=Math.max.apply(null,selectedServices.filter(function(s){return s.flexibility_enabled;}).map(function(s){return s.flexibility_discount_pct||0;}));
  }else if(selectedService){
    anyFlex=!!selectedService.flexibility_enabled;
    flexPct=selectedService.flexibility_discount_pct||0;
  }
  if(anyFlex){
    flexBox.style.display='';
    el('bkFlexDiscount').textContent=flexPct>0?' (-'+flexPct+'%)':'';
    el('bkFlexible').checked=false;
  }else{flexBox.style.display='none';}
}

// ── Mode selector ──
function buildModeSelector(){
  var modes;
  if(multiServiceMode&&selectedServices.length>1){
    var allModes=selectedServices.map(function(s){return s.mode_options||['cabinet'];});
    modes=allModes[0].filter(function(m){return allModes.every(function(arr){return arr.includes(m);});});
    if(modes.length===0)modes=['cabinet'];
  }else{modes=selectedService.mode_options||['cabinet'];}
  if(modes.length<=1){selectedMode=modes[0]||'cabinet';el('modeRow').style.display='none';return;}
  selectedMode=modes[0];
  var row=el('modeRow');row.style.display='flex';
  row.innerHTML=modes.map(function(m){return '<div class="mode-btn '+(m===selectedMode?'sel':'')+'" data-mode="'+escH(m)+'"><span class="ico">'+(MODE_ICONS[m]||'')+'</span>'+(MODE_LABELS[m]||escH(m))+'</div>';}).join('');
  row.querySelectorAll('.mode-btn').forEach(function(b){
    b.addEventListener('click',function(){
      selectedMode=b.dataset.mode;
      row.querySelectorAll('.mode-btn').forEach(function(x){x.classList.toggle('sel',x.dataset.mode===b.dataset.mode);});
      selectedDate=null;selectedSlot=null;el('btnStep3').disabled=true;loadSlots();
    });
  });
}

// ── Date/Slots ──
function buildDateRow(){
  var today=new Date();today.setDate(today.getDate()+weekOffset*7);
  var row=el('dateRow');var html='';
  for(var i=0;i<7;i++){
    var d=new Date(today);d.setDate(today.getDate()+i);
    var key=d.toISOString().split('T')[0];
    var slots=slotsData[key]||[];
    var slotCount=slots.length;
    if(!selectedPractitioner&&slots.length>0){var seen={};slots.forEach(function(s){seen[s.start_time]=true;});slotCount=Object.keys(seen).length;}
    var has=slotCount>0;
    html+='<div class="date-btn '+(has?'':'empty')+' '+(selectedDate===key?'sel':'')+'" data-date="'+key+'">'
      +'<div class="dow">'+DAYS_SHORT[d.getDay()]+'</div><div class="num">'+d.getDate()+'</div><div class="month">'+MONTHS[d.getMonth()]+'</div>'
      +(has?'<div class="slot-count">'+slotCount+'</div>':'')+'</div>';
  }
  row.innerHTML=html;
  row.querySelectorAll('.date-btn:not(.empty)').forEach(function(b){b.addEventListener('click',function(){selectDate(b.dataset.date);});});
  var endDate=new Date(today);endDate.setDate(today.getDate()+6);
  el('weekLabel').textContent=today.getDate()+' '+MONTHS[today.getMonth()]+' \u2013 '+endDate.getDate()+' '+MONTHS[endDate.getMonth()];
  el('prevWeek').disabled=weekOffset<=0;
  var fb=el('featuredBanner');
  if(weekHasFeatured){fb.style.display='flex';el('featuredLabel').textContent='Derniers créneaux disponibles pour la semaine du '+today.getDate()+' au '+endDate.getDate()+' '+MONTHS[endDate.getMonth()];}
  else{fb.style.display='none';}
}

function loadSlots(){
  el('slotsArea').innerHTML='<div class="slots-loading"><div class="spinner"></div>Chargement des créneaux...</div>';
  var today=new Date();today.setDate(today.getDate()+weekOffset*7);
  var endDate=new Date(today);endDate.setDate(today.getDate()+6);
  var dateFrom=today.toISOString().split('T')[0],dateTo=endDate.toISOString().split('T')[0];
  if(selectedPractitioner&&Object.keys(lockedSet).length>0){
    var weekMonday=getMonday(dateFrom);
    if(lockedSet[selectedPractitioner.id+'_'+weekMonday]){
      buildDateRow();
      el('slotsArea').innerHTML='<div class="no-slots">Cette semaine est verrouillée. Essayez une autre semaine.</div>';
      return;
    }
  }
  var slotsUrl;
  if(multiServiceMode&&selectedServices.length>1){
    selectedServices.sort(function(a,b){
      function rw(s){if(!s.available_schedule||s.available_schedule.type!=='restricted')return 50;var wins=s.available_schedule.windows||[];if(!wins.length)return 50;var avg=wins.reduce(function(sum,w){var p=w.from.split(':');return sum+parseInt(p[0])*60+parseInt(p[1]||0);},0)/wins.length;return avg<720?0:100;}
      return rw(a)-rw(b);
    });
    var params=new URLSearchParams({service_ids:selectedServices.map(function(s){return s.id;}).join(','),date_from:dateFrom,date_to:dateTo});
    if(selectedPractitioner)params.set('practitioner_id',selectedPractitioner.id);
    if(selectedMode)params.set('appointment_mode',selectedMode);
    var vids=selectedServices.map(function(s){return selectedVariants[s.id]?selectedVariants[s.id].id:'';}).join(',');
    if(vids.replace(/,/g,''))params.set('variant_ids',vids);
    slotsUrl='/api/public/'+slug+'/multi-slots?'+params;
  }else{
    var params2=new URLSearchParams({service_id:selectedService.id,date_from:dateFrom,date_to:dateTo});
    if(selectedPractitioner)params2.set('practitioner_id',selectedPractitioner.id);
    if(selectedMode)params2.set('appointment_mode',selectedMode);
    if(selectedVariants[selectedService.id])params2.set('variant_id',selectedVariants[selectedService.id].id);
    slotsUrl='/api/public/'+slug+'/slots?'+params2;
  }
  fetch(slotsUrl).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(function(sData){
    slotsData=sData.by_date||{};
    weekHasFeatured=false;
    buildDateRow();
    var firstDate=Object.keys(slotsData).sort().find(function(k){return slotsData[k]&&slotsData[k].length>0;});
    if(firstDate)selectDate(firstDate);
    else el('slotsArea').innerHTML='<div class="no-slots">Aucun créneau disponible cette semaine.</div>';
    renderWlCTA();
  }).catch(function(){
    slotsData={};
    el('slotsArea').innerHTML='<div class="no-slots" style="color:var(--red)">Erreur de chargement des créneaux. Veuillez réessayer.</div>';
    buildDateRow();
  });
}

function selectDate(key){
  selectedDate=key;selectedSlot=null;el('btnStep3').disabled=true;
  $$('.date-btn').forEach(function(b){b.classList.toggle('sel',b.dataset.date===key);});
  renderSlots();
}
function renderSlots(){
  var slots=slotsData[selectedDate]||[];
  if(!slots.length){el('slotsArea').innerHTML='<div class="no-slots">Aucun créneau ce jour.</div>';return;}
  if(!selectedPractitioner){
    var seen={},deduped=[];
    slots.forEach(function(s){if(!seen[s.start_time]){seen[s.start_time]=true;deduped.push(s);}});
    deduped.sort(function(a,b){return a.start_time<b.start_time?-1:a.start_time>b.start_time?1:0;});
    slots=deduped;
  }
  var grid=document.createElement('div');grid.className='slots-grid';
  var hasLm=slots.some(function(s){return s.is_last_minute;});
  if(hasLm)grid.classList.add('has-lm');
  slots.forEach(function(s){
    var btn=document.createElement('button');
    btn.className='slot-btn'+(s.is_last_minute?' last-minute':'');
    if(s.is_last_minute&&s.original_price_cents&&s.discounted_price_cents){
      btn.innerHTML='<span class="lm-time">'+s.start_time+'</span>'
        +'<span class="lm-badge">-'+s.discount_pct+'%</span>'
        +'<span class="lm-price"><s>'+(s.original_price_cents/100).toFixed(0)+'\u00a0\u20ac</s> '
        +'<strong>'+(s.discounted_price_cents/100).toFixed(0)+'\u00a0\u20ac</strong></span>';
    }else{btn.textContent=s.start_time;}
    btn.addEventListener('click',function(){
      selectedSlot=s;
      grid.querySelectorAll('.slot-btn').forEach(function(b){b.classList.remove('sel');});
      btn.classList.add('sel');
      el('btnStep3').disabled=false;
    });
    grid.appendChild(btn);
  });
  el('slotsArea').innerHTML='';
  el('slotsArea').appendChild(grid);
  if(window.innerWidth<=600)setTimeout(function(){grid.scrollIntoView({behavior:'smooth',block:'nearest'});},100);
}
function shiftWeek(dir){
  weekOffset+=dir;if(weekOffset<0)weekOffset=0;
  selectedDate=null;selectedSlot=null;el('btnStep3').disabled=true;loadSlots();
}

// ── Validation ──
function sanitizePhone(raw){return raw.replace(/[^\d]/g,'');}
function formatPhoneInput(e){
  var input=e?e.target:this;
  var v=sanitizePhone(input.value);
  if(v.startsWith('0'))v=v.slice(1);
  v=v.slice(0,9);
  var formatted='';
  for(var i=0;i<v.length;i++){if(i===3||i===5||i===7)formatted+=' ';formatted+=v[i];}
  input.value=formatted;
  clearFieldErr('Name');// clear phone err
  var errEl=el('errPhone');if(errEl)errEl.classList.remove('show');
  var inp=el('cPhone');if(inp)inp.classList.remove('invalid');
}
function validatePhone(raw){var digits=sanitizePhone(raw);return /^4[5-9]\d{7}$/.test(digits);}
function getFullPhone(raw){return '+32'+sanitizePhone(raw);}
function validatePhoneField(){
  var v=el('cPhone').value;
  if(!v.trim()){showFieldErr('Phone','Numéro de téléphone requis.');return false;}
  if(!validatePhone(v)){showFieldErr('Phone','Format invalide. Mobile belge : 04XX XX XX XX');return false;}
  clearFieldErr('Phone');el('cPhone').classList.add('valid');return true;
}
function validateEmailStrict(email){
  if(/\s/.test(email))return false;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return false;
  var local=email.split('@')[0];
  if(!/^[a-zA-Z0-9._%+\-]+$/.test(local))return false;
  if(local.startsWith('.')||local.endsWith('.')||local.includes('..'))return false;
  var domain=email.split('@')[1];
  if(!/^[a-zA-Z0-9.\-]+$/.test(domain))return false;
  if(domain.startsWith('-')||domain.endsWith('-')||domain.startsWith('.')||domain.endsWith('.'))return false;
  if(domain.includes('..'))return false;
  var tld=domain.split('.').pop();
  if(tld.length<2)return false;
  if(/^(test|fake|invalid|example|localhost)$/i.test(tld))return false;
  if(/^(mailinator|guerrilla|tempmail|throwaway|yopmail|sharklasers|grr\.la)/i.test(domain))return false;
  return true;
}
function validateEmailField(){
  var v=el('cEmail').value.trim();
  if(!v){showFieldErr('Email','Adresse email requise.');return false;}
  if(!validateEmailStrict(v)){showFieldErr('Email','Adresse email invalide. Vérifiez le format (ex: marie@gmail.com).');return false;}
  clearFieldErr('Email');el('cEmail').classList.add('valid');return true;
}
function validateNameField(){
  var v=el('cName').value.trim();
  if(!v){showFieldErr('Name','Votre nom est requis.');return false;}
  if(v.length<2){showFieldErr('Name','Nom trop court.');return false;}
  if(!/^[a-zA-ZÀ-ÿ\s\-'\.]+$/.test(v)){showFieldErr('Name','Caractères non autorisés dans le nom.');return false;}
  clearFieldErr('Name');el('cName').classList.add('valid');return true;
}
function showFieldErr(field,msg){
  var errEl=el('err'+field);if(!errEl)return;
  errEl.textContent=msg;errEl.classList.add('show');
  var input=el('c'+field);if(input){input.classList.add('invalid');input.classList.remove('valid');}
}
function clearFieldErr(field){
  var errEl=el('err'+field);if(errEl)errEl.classList.remove('show');
  var input=el('c'+field);if(input)input.classList.remove('invalid');
}

// ── BCE toggle ──
function toggleBce(){
  var area=el('bceArea');var toggle=el('bceToggle');
  if(area.style.display==='none'){area.style.display='block';toggle.textContent='\u2212 Masquer le n° BCE';}
  else{area.style.display='none';toggle.textContent='+ Ajouter un n° BCE';}
}

// ── Summary ──
function buildSummary(){
  var d=new Date(selectedSlot.start_at);
  var dateStr=DAYS_FULL[d.getDay()]+' '+d.getDate()+' '+MONTHS_FULL[d.getMonth()];
  var html='';
  if(multiServiceMode&&selectedServices.length>1){
    selectedServices.forEach(function(svc){
      var v=selectedVariants[svc.id];var name=v?svc.name+' \u2014 '+v.name:svc.name;
      var dur=v?v.duration_min:svc.duration_min;
      var pc=v&&v.price_cents!=null?v.price_cents:svc.price_cents;
      var p=pc?(pc/100).toFixed(0)+' \u20ac':(svc.price_label||'Gratuit');
      html+='<div class="sum-row"><span class="label">'+name+'</span><span class="val">'+dur+' min \u00b7 '+p+'</span></div>';
    });
    var totalMin=selectedServices.reduce(function(s,svc){var v=selectedVariants[svc.id];return s+(v?v.duration_min:svc.duration_min);},0);
    var totalPrice=selectedServices.reduce(function(s,svc){var v=selectedVariants[svc.id];return s+(v&&v.price_cents!=null?v.price_cents:(svc.price_cents||0));},0);
    var totalPriceStr=totalPrice>0?(totalPrice/100).toFixed(0)+' \u20ac':'Gratuit';
    html+='<div class="sum-divider"></div><div class="sum-row"><span class="label"><strong>Total</strong></span><span class="val"><strong>'+totalMin+' min \u00b7 '+totalPriceStr+'</strong></span></div>';
  }else if(selectedService){
    var sv=selectedVariants[selectedService.id];
    var svcName=sv?selectedService.name+' \u2014 '+sv.name:selectedService.name;
    html+='<div class="sum-row"><span class="label">Prestation</span><span class="val">'+svcName+'</span></div>';
  }
  var sumPracName=selectedPractitioner?selectedPractitioner.display_name:(selectedSlot&&selectedSlot.practitioner_id?(siteData.practitioners.find(function(p){return p.id===selectedSlot.practitioner_id;})||{}).display_name||'Praticien assigné':'Praticien assigné');
  html+='<div class="sum-row"><span class="label">Praticien</span><span class="val">'+sumPracName+'</span></div>'
    +'<div class="sum-divider"></div>'
    +'<div class="sum-row"><span class="label">Date</span><span class="val">'+dateStr+'</span></div>'
    +'<div class="sum-row"><span class="label">Heure</span><span class="val">'+selectedSlot.start_time+' \u2013 '+(function(){if(multiServiceMode&&selectedServices.length>1){var tMin=selectedServices.reduce(function(s,svc){var v=selectedVariants[svc.id];return s+(v?v.duration_min:svc.duration_min);},0);var sD=new Date(selectedSlot.start_at);var eD=new Date(sD.getTime()+tMin*60000);return eD.toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Brussels'});}return selectedSlot.end_time;})()+'</span></div>';
  if(selectedService&&!(multiServiceMode&&selectedServices.length>1)){
    var sv2=selectedVariants[selectedService.id];
    var sumPc=sv2&&sv2.price_cents!=null?sv2.price_cents:selectedService.price_cents;
    var price=sumPc?(sumPc/100).toFixed(0)+' \u20ac':'Gratuit';
    if(selectedSlot&&selectedSlot.is_last_minute&&selectedSlot.discount_pct&&sumPc>0){
      var discPrice=Math.round(sumPc*(100-selectedSlot.discount_pct)/100);
      html+='<div class="sum-divider"></div><div class="sum-row"><span class="label">Prix</span><span class="val"><s style="color:#9ca3af">'+(sumPc/100).toFixed(0)+' \u20ac</s> <strong style="color:#059669">'+(discPrice/100).toFixed(0)+' \u20ac</strong></span></div>'
        +'<div class="sum-row"><span class="label" style="color:#f59e0b;font-weight:600">Dernière minute</span><span class="val" style="color:#f59e0b;font-weight:600">-'+selectedSlot.discount_pct+'%</span></div>';
    }else{
      html+='<div class="sum-divider"></div><div class="sum-row"><span class="label">Prix</span><span class="val" style="color:var(--primary)">'+price+'</span></div>';
    }
  }
  // Payment methods
  var pm=siteData&&siteData.business&&siteData.business.payment_methods;
  if(pm&&pm.length>0){
    var pmLabels={cash:'Espèces',card:'Carte bancaire',bancontact:'Bancontact',apple_pay:'Apple Pay',google_pay:'Google Pay',payconiq:'Payconiq',instant_transfer:'Virement instantané',bank_transfer:'Virement bancaire'};
    html+='<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border-light,#eee)"><div style="font-size:.72rem;font-weight:600;color:var(--text-4,#999);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Paiements acceptés sur place</div><div style="display:flex;flex-wrap:wrap;gap:6px">';
    pm.forEach(function(m){html+='<span style="display:inline-flex;align-items:center;gap:4px;font-size:.72rem;font-weight:500;color:var(--text-3,#666);background:var(--surface-2,#f5f5f5);border:1px solid var(--border-light,#eee);border-radius:100px;padding:4px 10px">'+(pmLabels[m]||m)+'</span>';});
    html+='</div></div>';
  }
  el('bookingSummary').innerHTML=html;
}

// ── OAuth ──
function oauthConnect(provider){
  var oauthState={};
  if(selectedService)oauthState.serviceId=selectedService.id;
  if(selectedServices.length>0)oauthState.serviceIds=selectedServices.map(function(s){return s.id;});
  if(selectedPractitioner)oauthState.practitionerId=selectedPractitioner.id;
  if(selectedSlot)oauthState.slot=selectedSlot;
  if(selectedMode)oauthState.mode=selectedMode;
  if(selectedDate)oauthState.date=selectedDate;
  if(Object.keys(selectedVariants).length>0){
    var sv={};Object.keys(selectedVariants).forEach(function(k){sv[k]=selectedVariants[k].id;});
    oauthState.variantIds=sv;
  }
  oauthState.weekOffset=weekOffset;
  oauthState.noPrefSelected=noPrefSelected;
  oauthState.multiServiceMode=multiServiceMode;
  oauthState.returnTo=_returnMode==='inline'?'site':'book';
  sessionStorage.setItem('genda_oauth_state',JSON.stringify(oauthState));
  window.location.href='/api/public/auth/'+provider+'?slug='+encodeURIComponent(slug)+(_returnMode==='inline'?'&return_to=site':'');
}
function showManualForm(){
  el('oauthArea').style.display='none';
  el('clientFormFields').style.display='block';
}
function handleOauthPickup(pickupKey){
  return fetch('/api/public/auth/pickup/'+pickupKey).then(function(res){
    if(!res.ok){showManualForm();return;}
    return res.json().then(function(data){
      oauthProvider=data.provider;oauthProviderId=data.provider_id;oauthAuthenticated=true;
      if(data.name)el('cName').value=data.name;
      if(data.email){el('cEmail').value=data.email;el('cEmail').readOnly=true;el('cEmail').style.opacity='0.7';}
      if(data.email){
        fetch('/api/public/'+encodeURIComponent(slug)+'/client-phone?email='+encodeURIComponent(data.email))
          .then(function(r){return r.ok?r.json():null;}).then(function(d){
            if(!d||!d.phone)return;
            var ph=el('cPhone');var p=d.phone;
            if(p.startsWith('+32'))p=p.substring(3);
            ph.value=p;formatPhoneInput.call(ph);ph.classList.add('valid');
          }).catch(function(){});
      }
      el('oauthArea').style.display='none';
      el('oauthBadge').style.display='flex';
      var provLabel={google:'Google',apple:'Apple',facebook:'Facebook'}[data.provider]||data.provider;
      el('oauthBadgeText').textContent='Connecté via '+provLabel;
      el('oauthBadgeEmail').textContent=data.email||'';
      el('clientFormFields').style.display='block';
    });
  }).catch(function(){showManualForm();});
}
function restoreOauthState(){
  var raw=sessionStorage.getItem('genda_oauth_state');if(!raw)return;
  sessionStorage.removeItem('genda_oauth_state');
  try{
    var st=JSON.parse(raw);
    if(st.multiServiceMode)multiServiceMode=true;
    if(st.noPrefSelected)noPrefSelected=true;
    if(st.weekOffset)weekOffset=st.weekOffset;
    if(st.mode)selectedMode=st.mode;
    if(st.serviceId&&siteData)selectedService=siteData.services.find(function(s){return s.id===st.serviceId;})||null;
    if(st.serviceIds&&siteData)selectedServices=st.serviceIds.map(function(id){return siteData.services.find(function(s){return s.id===id;});}).filter(Boolean);
    if(st.practitionerId&&siteData)selectedPractitioner=(siteData.practitioners||[]).find(function(p){return p.id===st.practitionerId;})||null;
    if(st.slot)selectedSlot=st.slot;
    if(st.date)selectedDate=st.date;
    if(st.variantIds&&siteData){
      Object.keys(st.variantIds).forEach(function(svcId){
        var svc=siteData.services.find(function(s){return s.id===svcId;});
        if(svc&&svc.variants){var v=svc.variants.find(function(vr){return vr.id===st.variantIds[svcId];});if(v)selectedVariants[svcId]=v;}
      });
    }
    return true;
  }catch(e){return false;}
}
function initOauth(oauthPickup,oauthError){
  var authMode=(siteData&&siteData.business&&siteData.business.booking_auth_mode)||'soft';
  fetch('/api/public/auth/providers').then(function(r){return r.json();}).then(function(data){
    var providers=data.providers||[];
    ['google','apple','facebook'].forEach(function(p){
      var btn=el('oauth'+p.charAt(0).toUpperCase()+p.slice(1));
      if(btn&&providers.indexOf(p)===-1)btn.style.display='none';
    });
    if(providers.length===0)showManualForm();
  }).catch(function(){showManualForm();});

  if(authMode==='optional'){
    el('clientFormFields').style.display='block';
    var sepEl=C.querySelector('.oauth-sep');
    if(!sepEl){var sep=document.createElement('div');sep.className='oauth-sep';sep.innerHTML='<span>ou connectez-vous</span>';var oArea=el('oauthArea');oArea.insertBefore(sep,oArea.firstChild);}
    var oArea2=el('oauthArea');var formFields=el('clientFormFields');
    formFields.parentNode.insertBefore(oArea2,formFields.nextSibling);
    var mLink=el('oauthManual');if(mLink)mLink.style.display='none';
  }else if(authMode==='required'){
    var mLink2=el('oauthManual');if(mLink2)mLink2.style.display='none';
  }

  if(oauthPickup){
    var restored=restoreOauthState();
    handleOauthPickup(oauthPickup).then(function(){
      if(restored&&selectedSlot){computeStepOrder();goToStep(4);}
      else{computeStepOrder();goToStep(1);}
    });
  }else if(oauthError){
    showManualForm();
    setTimeout(function(){showError('Authentification annulée. Remplissez le formulaire manuellement.');},300);
  }
}

// ── Submit booking ──
function submitBooking(){
  if(_submitting)return;
  hideError();
  var okName=validateNameField(),okPhone=validatePhoneField(),okEmail=validateEmailField();
  if(!okName||!okPhone||!okEmail){showError('Veuillez corriger les champs en rouge.');return;}
  _submitting=true;
  var name=el('cName').value.trim();
  var phone=getFullPhone(el('cPhone').value);
  var email=el('cEmail').value.trim().toLowerCase();
  var bce=el('cBce')?el('cBce').value.trim():'';
  var comment=el('cComment').value.trim();
  var consent=el('cConsent').checked;
  var btn=el('btnStep4');
  btn.disabled=true;btn.textContent='Réservation en cours...';

  var bookingPracId=selectedPractitioner?selectedPractitioner.id:selectedSlot.practitioner_id;
  var bookingBody={
    practitioner_id:bookingPracId,start_at:selectedSlot.start_at,
    appointment_mode:selectedMode||'cabinet',
    client_name:name,client_phone:phone,client_email:email,
    client_bce:bce||undefined,client_comment:comment||undefined,
    consent_sms:consent,consent_email:consent,
    flexible:!!(el('bkFlexible')&&el('bkFlexible').checked)
  };
  if(selectedSlot&&selectedSlot.is_last_minute)bookingBody.is_last_minute=true;
  if(multiServiceMode&&selectedServices.length>1){
    bookingBody.service_ids=selectedServices.map(function(s){return s.id;});
    var bvids=selectedServices.map(function(s){return selectedVariants[s.id]?selectedVariants[s.id].id:null;});
    if(bvids.some(function(v){return v;}))bookingBody.variant_ids=bvids;
  }else if(selectedService){
    bookingBody.service_id=selectedService.id;
    if(selectedVariants[selectedService.id])bookingBody.variant_id=selectedVariants[selectedService.id].id;
  }
  if(selectedSlot.end_at)bookingBody.end_at=selectedSlot.end_at;
  if(oauthProvider&&oauthProviderId){bookingBody.oauth_provider=oauthProvider;bookingBody.oauth_provider_id=oauthProviderId;}

  fetch('/api/public/'+slug+'/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(bookingBody)})
    .then(function(res){return res.json().then(function(data){if(!res.ok)throw new Error(data.error||'Erreur lors de la réservation');return data;});})
    .then(function(data){
      showConfirmation(data);
      _submitting=false;
    }).catch(function(err){
      showError(err.message);
      btn.disabled=false;btn.textContent='Confirmer le rendez-vous \u2192';
      _submitting=false;
    });
}

function showConfirmation(data){
  var d=new Date(selectedSlot.start_at);
  var dateStr=DAYS_FULL[d.getDay()]+' '+d.getDate()+' '+MONTHS_FULL[d.getMonth()];
  var email=el('cEmail').value.trim().toLowerCase();
  var confirmHtml='';
  if(multiServiceMode&&selectedServices.length>1){
    confirmHtml+='<div class="row" style="font-weight:600;padding-bottom:2px"><span class="l">Prestations</span><span class="v"></span></div>';
    selectedServices.forEach(function(svc){
      var cv=selectedVariants[svc.id];var cn=cv?escH(svc.name)+' \u2014 '+escH(cv.name):escH(svc.name);
      var cd=cv?cv.duration_min:svc.duration_min;var cpc=cv&&cv.price_cents!=null?cv.price_cents:svc.price_cents;
      var cp=cpc?(cpc/100).toFixed(0)+' \u20ac':(svc.price_label||'Gratuit');
      confirmHtml+='<div class="row"><span class="l" style="padding-left:8px">\u2022 '+cn+'</span><span class="v">'+cd+' min \u00b7 '+cp+'</span></div>';
    });
  }else if(selectedService){
    var cv2=selectedVariants[selectedService.id];
    var confirmName=cv2?escH(selectedService.name)+' \u2014 '+escH(cv2.name):escH(selectedService.name);
    confirmHtml+='<div class="row"><span class="l">Prestation</span><span class="v">'+confirmName+'</span></div>';
  }
  var confPracName=selectedPractitioner?selectedPractitioner.display_name:(selectedSlot&&selectedSlot.practitioner_id?(siteData.practitioners.find(function(p){return p.id===selectedSlot.practitioner_id;})||{}).display_name||'Praticien assigné':'Praticien assigné');
  confirmHtml+='<div class="row"><span class="l">Praticien</span><span class="v">'+escH(confPracName)+'</span></div>';
  confirmHtml+='<div class="row"><span class="l">Date</span><span class="v">'+escH(dateStr)+'</span></div>';
  var confirmStartTime=selectedSlot?selectedSlot.start_time:'';
  var confirmEndTime=selectedSlot?selectedSlot.end_time:'';
  if(multiServiceMode&&selectedServices.length>1&&selectedSlot){
    var totalMin=selectedServices.reduce(function(sum,svc){var cv=selectedVariants[svc.id];return sum+(cv?cv.duration_min:svc.duration_min);},0);
    var startD=new Date(selectedSlot.start_at);var endD=new Date(startD.getTime()+totalMin*60000);
    confirmEndTime=endD.toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Brussels'});
  }
  confirmHtml+='<div class="row"><span class="l">Heure</span><span class="v">'+confirmStartTime+' \u2013 '+confirmEndTime+'</span></div>';
  if(data.booking&&data.booking.discount_pct){
    confirmHtml+='<div class="row"><span class="l" style="color:#f59e0b;font-weight:600">Dernière minute</span><span class="v" style="color:#f59e0b;font-weight:600">-'+data.booking.discount_pct+'%</span></div>';
  }
  confirmHtml+='<div class="row"><span class="l">Email</span><span class="v">'+escH(email)+'</span></div>';
  if(data.booking&&data.booking.token){
    confirmHtml+='<div style="margin-top:12px;padding:10px 14px;background:var(--surface);border-radius:8px;font-size:.78rem;color:var(--text-3)">Besoin d\'annuler ? <a href="/api/public/booking/'+data.booking.token+'/cancel-booking" style="color:#C62828;font-weight:600" data-bke="cancelLink">Annuler le rendez-vous</a></div>';
  }
  var mentions=[];
  if(siteData.business&&siteData.business.deposit_enabled){mentions.push('Selon la politique de l\u2019établissement, un acompte pourrait vous être demandé par email.');}
  mentions.push('Le rendez-vous est réservé pour les prestations sélectionnées. Toute demande supplémentaire sera soumise à la disponibilité et à l\u2019accord du praticien.');
  confirmHtml+='<div style="margin-top:14px;font-size:.72rem;color:var(--text-4);line-height:1.5">'+mentions.join('<br>')+'</div>';
  el('confirmDetails').innerHTML=confirmHtml;
  // Cancel link confirmation
  var cancelLink=el('cancelLink');
  if(cancelLink){cancelLink.addEventListener('click',function(e){if(!confirm('Êtes-vous sûr de vouloir annuler ce rendez-vous ?')){e.preventDefault();}});}

  // Update step 5 heading based on booking status
  var step5=C.querySelector('.step[data-step="5"]');
  if(data.booking&&data.booking.status==='pending_deposit'){
    step5.querySelector('.confirm-box .icon').innerHTML='<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>';
    step5.querySelector('.confirm-box h3').textContent='Acompte requis';
    step5.querySelector('.confirm-box p').innerHTML='Un acompte est nécessaire pour confirmer votre rendez-vous. Consultez l\u2019email que nous venons de vous envoyer.<br><span style="font-size:.78rem;color:var(--text-4);margin-top:6px;display:inline-block">Si vous ne trouvez pas l\u2019email, vérifiez vos courriers indésirables (spam).</span>';
    el('calButtons').style.display='none';
  }else if(data.needs_confirmation){
    step5.querySelector('.confirm-box .icon').innerHTML='<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>';
    step5.querySelector('.confirm-box h3').textContent='Vérifiez vos emails !';
    step5.querySelector('.confirm-box p').innerHTML='Votre créneau est réservé. Confirmez votre RDV en cliquant sur le lien envoyé par email/SMS.<br><span style="font-size:.78rem;color:var(--text-4);margin-top:6px;display:inline-block">Si vous ne trouvez pas l\u2019email, vérifiez vos courriers indésirables (spam).</span>';
    el('calButtons').style.display='none';
  }else{
    step5.querySelector('.confirm-box .icon').innerHTML='<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    step5.querySelector('.confirm-box h3').textContent='Rendez-vous confirmé !';
    step5.querySelector('.confirm-box p').innerHTML='Vous recevrez une confirmation par email et SMS.<br><span style="font-size:.78rem;color:var(--text-4);margin-top:6px;display:inline-block">Si vous ne trouvez pas l\u2019email, vérifiez vos courriers indésirables (spam).</span>';
    el('calButtons').style.display='';
  }
  if(!data.needs_confirmation&&(!data.booking||data.booking.status!=='pending_deposit')){
    buildCalendarButtons(selectedSlot.start_at,selectedSlot.end_at||selectedSlot.start_at,data.booking&&data.booking.token);
  }
  goToStep(5);
}

// ── Calendar buttons ──
function buildCalendarButtons(startAt,endAt,token){
  var start=new Date(startAt);
  var totalDur=multiServiceMode&&selectedServices.length>1?selectedServices.reduce(function(s,svc){var v=selectedVariants[svc.id];return s+(v?v.duration_min:svc.duration_min);},0):(selectedVariants[selectedService?selectedService.id:'']?selectedVariants[selectedService.id].duration_min:(selectedService?selectedService.duration_min:30));
  var end=endAt?new Date(endAt):new Date(start.getTime()+totalDur*60000);
  var calTitle=multiServiceMode&&selectedServices.length>1?selectedServices.map(function(s){var v=selectedVariants[s.id];return v?s.name+' \u2014 '+v.name:s.name;}).join(' + '):(function(){if(!selectedService)return 'RDV';var v=selectedVariants[selectedService.id];return v?selectedService.name+' \u2014 '+v.name:selectedService.name;}());
  var title=calTitle+' \u2014 '+(selectedPractitioner?selectedPractitioner.display_name:'');
  var loc=siteData&&siteData.business?siteData.business.address||'':'';
  var desc=title+' \u2014 '+(siteData&&siteData.business?siteData.business.name:'Genda');
  function gf(d){return d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');}
  var gcal='https://calendar.google.com/calendar/render?action=TEMPLATE&text='+encodeURIComponent(title)+'&dates='+gf(start)+'/'+gf(end)+'&details='+encodeURIComponent(desc)+'&location='+encodeURIComponent(loc)+'&ctz=Europe/Brussels';
  var outlook='https://outlook.live.com/calendar/0/action/compose?subject='+encodeURIComponent(title)+'&startdt='+start.toISOString()+'&enddt='+end.toISOString()+'&body='+encodeURIComponent(desc)+'&location='+encodeURIComponent(loc);
  var html='<div style="font-size:.75rem;color:var(--text-4);margin-bottom:6px;width:100%">Ajouter à votre calendrier :</div>';
  html+='<a class="cal-btn" href="'+gcal+'" target="_blank" rel="noopener"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Google</a>';
  html+='<a class="cal-btn" href="'+outlook+'" target="_blank" rel="noopener"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg> Outlook</a>';
  if(token)html+='<a class="cal-btn" href="/api/public/booking/'+token+'/ics" download="rdv-genda.ics"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-1-1-3.5-1.5-5 0s-2 4 0 7c1.5 2.5 3.5 3 5 5 1.5-2 3.5-2.5 5-5 2-3 1.5-5.5 0-7s-4-1-5 0Z"/><path d="M12 3c0-1 .5-2 2-2"/></svg> Apple / iCal</a>';
  el('calButtons').innerHTML=html;
}

// ── Vedette mode ──
function buildVedetteSlots(featuredSlots){
  var slots=[];
  featuredSlots.forEach(function(f){
    var st=f.start_time.slice(0,5);var parts=st.split(':');var sh=parseInt(parts[0]),sm=parseInt(parts[1]);
    var endT=sh*60+sm+15;var ehh=String(Math.floor(endT/60)).padStart(2,'0');var emm=String(endT%60).padStart(2,'0');
    slots.push({practitioner_id:f.practitioner_id,date:f.date,start_time:st,end_time:ehh+':'+emm,start_at:f.date+'T'+st+':00',end_at:f.date+'T'+ehh+':'+emm+':00'});
  });
  var now=new Date();
  slots=slots.filter(function(s){return new Date(s.start_at)>now;});
  slots.sort(function(a,b){return a.start_at<b.start_at?-1:a.start_at>b.start_at?1:0;});
  return slots;
}
function renderVedetteList(){
  var multiPrac=siteData.practitioners.length>1;
  var pracMap={};if(multiPrac)siteData.practitioners.forEach(function(p){pracMap[p.id]=p;});
  var byDate={};
  vedetteSlots.forEach(function(s){if(!byDate[s.date])byDate[s.date]=[];byDate[s.date].push(s);});
  var dates=Object.keys(byDate).sort();
  var total=vedetteSlots.length;
  if(dates.length>0){
    var first=new Date(dates[0]+'T12:00:00'),last=new Date(dates[dates.length-1]+'T12:00:00');
    el('vedetteBannerLabel').textContent=total+' créneau'+(total>1?'x':'')+' disponible'+(total>1?'s':'')+' du '+first.getDate()+' au '+last.getDate()+' '+MONTHS_FULL[last.getMonth()];
  }
  var html='';
  dates.forEach(function(date){
    var d=new Date(date+'T12:00:00');
    html+='<div class="vedette-day"><div class="vedette-day-title">'+DAYS_FULL[d.getDay()]+' '+d.getDate()+' '+MONTHS_FULL[d.getMonth()]+'</div><div class="vedette-slots">';
    byDate[date].forEach(function(s){
      var pracLabel='';
      if(multiPrac&&pracMap[s.practitioner_id])pracLabel='<span class="prac-label">'+pracMap[s.practitioner_id].display_name+'</span>';
      html+='<div class="vedette-slot" data-idx="'+vedetteSlots.indexOf(s)+'">'+s.start_time+pracLabel+'</div>';
    });
    html+='</div></div>';
  });
  el('vedetteList').innerHTML=html;
  $$('.vedette-slot').forEach(function(slotEl){
    slotEl.addEventListener('click',function(){
      var idx=parseInt(slotEl.dataset.idx);
      selectedSlot=vedetteSlots[idx];
      selectedPractitioner=siteData.practitioners.find(function(p){return p.id===selectedSlot.practitioner_id;})||siteData.practitioners[0];
      selectedService=null;selectedMode='cabinet';
      $$('.vedette-slot').forEach(function(x){x.classList.remove('sel');});
      slotEl.classList.add('sel');
      el('btnStepVedette').disabled=false;
    });
  });
}

// ── Waitlist ──
function renderWlCTA(){
  var area=el('wlArea');if(!area)return;
  if(!selectedPractitioner||!selectedPractitioner.waitlist_mode||selectedPractitioner.waitlist_mode==='off'||noPrefSelected){area.innerHTML='';return;}
  if(area.querySelector('.wl-form')||area.querySelector('.wl-success'))return;
  area.innerHTML='<div class="wl-cta"><div style="font-size:1.5rem;margin-bottom:6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg></div><div class="wl-cta-title">Aucun horaire ne vous convient ?</div><div class="wl-cta-sub">Inscrivez-vous sur la liste d\'attente.</div><button class="wl-cta-btn" data-bke="wlCtaBtn">Rejoindre la liste d\'attente</button></div>';
  var wlBtn=el('wlCtaBtn');if(wlBtn)wlBtn.addEventListener('click',wlShowForm);
}
function wlShowForm(){
  var area=el('wlArea');
  area.innerHTML='<div class="wl-form" data-bke="wlForm"><h3>Liste d\'attente</h3><p class="wl-form-sub">Pour <strong>'+escH(selectedService?selectedService.name:'cette prestation')+'</strong> avec <strong>'+escH(selectedPractitioner?selectedPractitioner.display_name:'')+'</strong></p>'
    +'<div class="fg"><label class="fl">Prénom et nom *</label><input class="fi" data-bke="wlName" placeholder="Marie Dupont"></div>'
    +'<div class="fg"><label class="fl">Email *</label><input class="fi" type="email" data-bke="wlEmail" placeholder="marie@example.com"></div>'
    +'<div class="fg"><label class="fl">Téléphone</label><div class="phone-wrap"><span class="phone-prefix"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="8.67" y1="4" x2="8.67" y2="20"/><line x1="15.33" y1="4" x2="15.33" y2="20"/></svg> +32</span><input class="fi" data-bke="wlPhone" placeholder="4XX XX XX XX" inputmode="tel" maxlength="12"></div></div>'
    +'<div class="fg"><label class="fl">Jours qui vous conviennent</label><div class="wl-days">'+WL_DAYS.map(function(d,i){return '<button type="button" class="wl-day '+(i<5?'on':'')+'" data-day="'+i+'">'+d+'</button>';}).join('')+'</div></div>'
    +'<div class="fg"><label class="fl">Préférence horaire</label><select class="fi" data-bke="wlTime" style="padding:8px 12px"><option value="any">Toute la journée</option><option value="morning">Matin</option><option value="afternoon">Après-midi</option></select></div>'
    +'<button class="wl-submit" data-bke="wlSubmitBtn">S\'inscrire \u2192</button>'
    +'<button class="wl-cancel" data-bke="wlCancelBtn">Annuler</button></div>';
  area.querySelectorAll('.wl-day').forEach(function(b){b.addEventListener('click',function(){b.classList.toggle('on');});});
  el('wlSubmitBtn').addEventListener('click',wlSubmit);
  el('wlCancelBtn').addEventListener('click',renderWlCTA);
}
function wlSubmit(){
  if(!selectedPractitioner){showError('Veuillez choisir un praticien.');return;}
  var name=el('wlName').value.trim(),email=el('wlEmail').value.trim();
  var phoneRaw=el('wlPhone').value.trim();
  if(!name||!email){showError('Nom et email requis.');return;}
  if(!validateEmailStrict(email)){showError('Email invalide.');return;}
  var days=[];C.querySelectorAll('.wl-day.on').forEach(function(b){days.push(parseInt(b.dataset.day));});
  if(!days.length){showError('Sélectionnez au moins un jour.');return;}
  var btn=el('wlSubmitBtn');btn.disabled=true;btn.textContent='Inscription...';hideError();
  fetch('/api/public/'+slug+'/waitlist',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({practitioner_id:selectedPractitioner.id,service_id:selectedService?selectedService.id:null,
      client_name:name,client_email:email,client_phone:phoneRaw?getFullPhone(phoneRaw):null,
      preferred_days:days,preferred_time:el('wlTime').value,note:null})})
    .then(function(res){return res.json().then(function(data){if(!res.ok)throw new Error(data.error||'Erreur');return data;});})
    .then(function(data){
      var form=el('wlForm');if(form)form.outerHTML='<div class="wl-success"><div style="font-size:2rem;margin-bottom:8px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div><h3>Inscrit·e !</h3><p>Nous vous préviendrons à <strong>'+email+'</strong> dès qu\'un créneau se libère.</p><div class="position">#'+data.position+' dans la file</div></div>';
    }).catch(function(err){showError(err.message);btn.disabled=false;btn.textContent='S\'inscrire \u2192';});
}

// ── Error helpers ──
function showError(msg){var e=el('errMsg');e.textContent=msg;e.classList.add('show');e.scrollIntoView({behavior:'smooth',block:'center'});}
function hideError(){el('errMsg').classList.remove('show');}

// ── Build service list ──
function buildServiceList(){
  var list=el('svcList');
  var svcs=siteData.services;
  var cats=new Map();
  svcs.forEach(function(s){var cat=s.category||'Autres';if(!cats.has(cat))cats.set(cat,[]);cats.get(cat).push(s);});
  var catKeys=Array.from(cats.keys());

  function buildSkRow(s){
    var hasVars=s.variants&&s.variants.length>0;
    var noBook=s.bookable_online===false;
    var h='<div class="sk-svc-row'+(noBook?' no-book':'')+'" data-id="'+s.id+'">';
    h+='<div class="sk-svc-head"><div class="sk-svc-info">';
    h+='<div class="sk-svc-name">'+escH(s.name)+'</div>';
    if(hasVars){
      var prices=s.variants.filter(function(v){return v.price_cents!=null;}).map(function(v){return v.price_cents;});
      var durs=s.variants.map(function(v){return v.duration_min;});
      if(prices.length>0){var mn=Math.min.apply(null,prices)/100,mx=Math.max.apply(null,prices)/100;h+='<div class="sk-svc-price">'+(mn===mx?mn.toFixed(0):mn.toFixed(0)+'\u2013'+mx.toFixed(0))+' \u20ac</div>';}
      var mnD=Math.min.apply(null,durs),mxD=Math.max.apply(null,durs);
      h+='<div class="sk-svc-dur">'+(mnD===mxD?mnD:mnD+'\u2013'+mxD)+' min</div>';
    }else{
      h+='<div class="sk-svc-price">'+svcDisplayPrice(s)+'</div>';
      h+='<div class="sk-svc-dur">'+svcDurationLabel(s)+'</div>';
    }
    if(s.available_schedule&&s.available_schedule.type==='restricted'){
      h+='<div class="sk-svc-restrict"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Disponibilité limitée</div>';
    }
    if(s.description)h+='<div class="sk-svc-desc">'+escH(s.description)+'</div>';
    h+='</div>';
    if(!noBook)h+='<button class="sk-svc-btn" data-id="'+s.id+'">Sélectionner</button>';
    h+='</div>';
    if(noBook){
      var phone=siteData.business.phone||'';
      h+='<div class="sk-no-book-msg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>'
        +'Non réservable en ligne.'+(phone?' Contactez-nous au <a href="tel:'+escH(phone)+'">'+escH(phone)+'</a>':' Veuillez nous contacter par téléphone.')+'</div>';
    }
    h+='</div>';
    return h;
  }

  function wireSkButtons(container){
    container.querySelectorAll('.sk-svc-btn').forEach(function(btn){
      btn.addEventListener('click',function(e){
        e.stopPropagation();
        var svc=siteData.services.find(function(x){return x.id===btn.dataset.id;});
        if(!svc)return;
        if(svc.variants&&svc.variants.length>0){
          showVariantModal(svc,function(variant){
            var vi=svc.variants.findIndex(function(v){return v.id===variant.id;});
            selectVariant(svc.id,vi>=0?vi:0);
            if(!multiServiceMode)goNext();
          });
        }else{
          selectService(svc.id);
          if(!multiServiceMode)goNext();
        }
      });
    });
  }

  function renderServicesForCat(catName){
    var items=cats.get(catName)||[];
    var panel=C.querySelector('[data-bke="skServices"]');if(!panel)return;
    var h='<div style="font-size:.72rem;font-weight:700;color:var(--text-4);text-transform:uppercase;letter-spacing:.04em;margin-bottom:10px">'+catName+'</div>';
    items.forEach(function(s){h+=buildSkRow(s);});
    panel.innerHTML=h;
    wireSkButtons(panel);
    _updateSkButtons();
  }

  if(catKeys.length>1){
    C.classList.add('bke-wide');
    var lh='<div class="sk-layout"><div class="sk-cats" data-bke="skCats">';
    catKeys.forEach(function(cat,i){
      lh+='<div class="sk-cat-item'+(i===0?' active':'')+'" data-cat="'+cat.replace(/"/g,'&quot;')+'">';
      lh+='<span>'+cat+'</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></div>';
    });
    lh+='</div><div class="sk-services" data-bke="skServices"></div></div>';
    list.innerHTML=lh;
    renderServicesForCat(catKeys[0]);
    C.querySelector('[data-bke="skCats"]').addEventListener('click',function(e){
      var item=e.target.closest('.sk-cat-item');if(!item)return;
      C.querySelectorAll('.sk-cat-item').forEach(function(c){c.classList.remove('active');});
      item.classList.add('active');
      renderServicesForCat(item.dataset.cat);
    });
  }else{
    var h='';svcs.forEach(function(s){h+=buildSkRow(s);});
    list.innerHTML=h;wireSkButtons(list);
  }
}

// ══════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════
function init(opts){
  C=opts.container;
  slug=opts.slug;
  siteData=opts.siteData;
  _onBack=opts.onBack||null;
  _returnMode=opts.returnMode||'inline';
  _isDark=opts.isDark||false;
  _preSelectedServiceId=opts.preSelectedServiceId||null;
  _featuredSlots=opts.featuredSlots||null;
  _lockedWeeks=opts.lockedWeeks||null;

  // Reset state
  selectedService=null;selectedPractitioner=null;selectedMode=null;selectedDate=null;selectedSlot=null;
  slotsData={};weekOffset=0;weekHasFeatured=false;noPrefSelected=false;
  stepOrder=[1,2,3,4,5];currentStepIdx=0;
  vedetteMode=false;vedetteSlots=[];lockedSet={};
  selectedServices=[];selectedVariants={};multiServiceMode=false;
  oauthProvider=null;oauthProviderId=null;oauthAuthenticated=false;
  _submitting=false;

  // Add bke class
  C.classList.add('bke');
  if(_isDark)C.classList.add('bke-dark');

  // Generate HTML
  C.innerHTML=buildHTML(opts);

  // Vedette mode setup
  if(_featuredSlots&&_lockedWeeks){
    var allFeatured=(_featuredSlots||[]).map(function(f){return Object.assign({},f,{date:(f.date||'').slice(0,10)});});
    var lockedWeeks=(_lockedWeeks||[]).map(function(lw){return Object.assign({},lw,{week_start:(lw.week_start||'').slice(0,10)});});
    if(lockedWeeks.length>0&&allFeatured.length>0){
      lockedSet={};
      lockedWeeks.forEach(function(lw){lockedSet[lw.practitioner_id+'_'+lw.week_start]=true;});
      var lockedFeatured=allFeatured.filter(function(f){var monday=getMonday(f.date);return lockedSet[f.practitioner_id+'_'+monday];});
      if(lockedFeatured.length>0){vedetteMode=true;vedetteSlots=buildVedetteSlots(lockedFeatured);}
    }
  }

  // Header (standalone mode)
  if(_returnMode==='standalone'){
    var b=siteData.business;
    var init2=b.name.split(' ').map(function(w){return w[0];}).filter(Boolean).join('').toUpperCase().slice(0,2);
    var hLogo=el('hLogo');
    if(b.logo_url){var img=document.createElement('img');img.src=b.logo_url;img.alt='';hLogo.innerHTML='';hLogo.appendChild(img);}
    else hLogo.textContent=init2;
    el('hName').textContent=b.name;
    el('hTagline').textContent=b.tagline||'';
    el('hBack').href='#';
    el('hBack').addEventListener('click',function(e){e.preventDefault();if(currentStepIdx<=0||stepOrder[currentStepIdx]===1)window.location.href='/'+slug;else goToStep(1);});
  }

  // Multi-service mode
  if(siteData.business.multi_service_enabled){
    multiServiceMode=true;
    C.querySelector('#step1 .step-title,#step1 [data-step="1"] .step-title,.step[data-step="1"] .step-title').textContent='Choisissez vos prestations';
    C.querySelector('.step[data-step="1"] .step-sub').textContent='Sélectionnez jusqu\u2019à 5 prestations (max).';
    el('btnStep1').style.display='none';
  }else{
    el('cartSticky').style.display='none';
    el('btnStep1').style.display='none';
  }

  // Build service list
  buildServiceList();

  // Pre-select service if specified
  if(_preSelectedServiceId){
    var psvc=siteData.services.find(function(s){return s.id===_preSelectedServiceId;});
    if(psvc){
      if(psvc.variants&&psvc.variants.length>0){
        // For variant services, show the modal
        showVariantModal(psvc,function(variant){
          var vi=psvc.variants.findIndex(function(v){return v.id===variant.id;});
          selectVariant(psvc.id,vi>=0?vi:0);
          computeStepOrder();goToStep(stepOrder[1]||2);
        });
      }else{
        selectService(_preSelectedServiceId);
        computeStepOrder();goToStep(stepOrder[1]||2);
      }
      el('loadingState').style.display='none';
      return; // Don't show step 1
    }
  }

  // Update cart bar if pre-selected services
  if(multiServiceMode&&selectedServices.length>0){
    updateCartBar();
    el('btnStep1').disabled=selectedServices.length===0;
    selectedService=selectedServices.length===1?selectedServices[0]:(selectedServices[0]||null);
  }

  // Wire up buttons
  el('btnStep1').addEventListener('click',goNext);
  el('cartCta').addEventListener('click',goNext);
  el('cartClear').addEventListener('click',clearCart);
  el('btnStep2').addEventListener('click',goNext);
  el('btnStep3').addEventListener('click',goNext);
  el('btnStep4').addEventListener('click',submitBooking);
  el('backStep2').addEventListener('click',goPrev);
  el('backStep3').addEventListener('click',goPrev);
  el('backStep4').addEventListener('click',goPrev);
  el('prevWeek').addEventListener('click',function(){shiftWeek(-1);});
  el('nextWeek').addEventListener('click',function(){shiftWeek(1);});
  el('btnBackSite').addEventListener('click',function(){
    if(_returnMode==='inline'&&_onBack)_onBack();
    else window.location.href='/'+slug;
  });

  // Phone formatting
  el('cPhone').addEventListener('input',formatPhoneInput);
  el('cPhone').addEventListener('blur',validatePhoneField);
  el('cEmail').addEventListener('blur',function(){
    validateEmailField();
    var em=this.value.trim();
    if(!em||!validateEmailStrict(em))return;
    var ph=el('cPhone');if(ph.value.trim())return;
    fetch('/api/public/'+encodeURIComponent(slug)+'/client-phone?email='+encodeURIComponent(em))
      .then(function(r){return r.ok?r.json():null;}).then(function(d){
        if(!d||!d.phone)return;var p=d.phone;
        if(p.startsWith('+32'))p=p.substring(3);
        ph.value=p;formatPhoneInput.call(ph);ph.classList.add('valid');
        var nm=el('cName');if(!nm.value.trim()&&d.name){nm.value=d.name;nm.classList.add('valid');}
      }).catch(function(){});
  });
  el('cName').addEventListener('blur',validateNameField);
  el('cComment').addEventListener('input',function(){
    var c=this.value.length,ce=el('cCommentCount');
    ce.textContent=c>0?(c+' / 500'):'';
    ce.style.color=c>=480?'#DC2626':c>=400?'#F59E0B':'#9CA3AF';
  });
  el('bceToggle').addEventListener('click',toggleBce);
  el('oauthManualLink').addEventListener('click',showManualForm);
  el('oauthGoogle').addEventListener('click',function(){oauthConnect('google');});
  el('oauthApple').addEventListener('click',function(){oauthConnect('apple');});
  el('oauthFacebook').addEventListener('click',function(){oauthConnect('facebook');});

  el('loadingState').style.display='none';

  // Vedette mode
  if(vedetteMode){
    el('btnStepVedette').addEventListener('click',goNext);
    el('btnVedetteMore').addEventListener('click',function(){
      vedetteMode=false;computeStepOrder();goToStep(1);
    });
    renderVedetteList();
    stepOrder=['vedette',4,5];
    currentStepIdx=0;
    renderProgress();
    goToStep('vedette');
    return;
  }

  // OAuth pickup from URL
  var urlParams=new URLSearchParams(window.location.search);
  var oauthPickup=urlParams.get('oauth_pickup');
  var oauthError=urlParams.get('oauth_error');
  if(oauthPickup||oauthError){
    var cleanUrl=window.location.pathname;
    window.history.replaceState(null,'',cleanUrl);
  }

  // Init OAuth
  initOauth(oauthPickup,oauthError);

  // Normal start
  if(!oauthPickup){
    computeStepOrder();
    goToStep(1);
  }
}

function destroy(){
  if(C){
    C.innerHTML='';
    C.classList.remove('bke','bke-wide','bke-dark');
  }
  // Reset state
  C=null;slug='';siteData=null;
  selectedService=null;selectedPractitioner=null;selectedMode=null;selectedDate=null;selectedSlot=null;
  slotsData={};weekOffset=0;weekHasFeatured=false;noPrefSelected=false;
  stepOrder=[1,2,3,4,5];currentStepIdx=0;
  vedetteMode=false;vedetteSlots=[];lockedSet={};
  selectedServices=[];selectedVariants={};multiServiceMode=false;
  oauthProvider=null;oauthProviderId=null;oauthAuthenticated=false;
  _submitting=false;_onBack=null;_returnMode='inline';
  _preSelectedServiceId=null;_isDark=false;_featuredSlots=null;_lockedWeeks=null;
}

window.BookingEngine={init:init,destroy:destroy};
})();
