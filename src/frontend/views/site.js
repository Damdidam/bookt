/**
 * Site / Mini-site management view module.
 */
import { api, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';
import { cswHTML } from './agenda/color-swatches.js';
import { guardModal } from '../utils/dirty-guard.js';
import { IC } from '../utils/icons.js';

// XSS-safe HTML escaping for admin views
const esc=s=>s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'):'';
const escAttr=s=>(s||'').replace(/"/g,'&quot;');
const GRIP_SVG='<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>';

// Only 3 template families remain: Funky, Épuré, Bold
const THEMES={
  funky:{name:'Funky',family:'funky'},
  epure_nude:{name:'Épuré Nude',family:'epure'},
  epure_sauge:{name:'Épuré Sauge',family:'epure'},
  epure_blush:{name:'Épuré Blush',family:'epure'},
  epure_charbon:{name:'Épuré Charbon',family:'epure'},
  bold_nuit:{name:'Bold Nuit',family:'bold'},
  bold_foret:{name:'Bold Forêt',family:'bold'},
  bold_bordeaux:{name:'Bold Bordeaux',family:'bold'},
  bold_electrique:{name:'Bold Électrique',family:'bold'}
};

// Map legacy presets to new ones
function resolvePreset(p){
  if(THEMES[p])return p;
  // Legacy presets → default to epure_nude
  return 'epure_nude';
}

const FAMILIES=[
  {key:'funky',label:'Funky',desc:'Corail + gradients. Punchy, fun, salons beauté.',
   fonts:'Sora + Playfair Display',
   presets:[{key:'funky',label:'Corail',color:'#E8694A'}]},
  {key:'epure',label:'Épuré',desc:'Minimaliste, élégant. Typographie raffinée, sections épurées.',
   fonts:'DM Sans + Cormorant Garamond',
   presets:[
     {key:'epure_nude',label:'Nude',color:'#B8977E'},
     {key:'epure_sauge',label:'Sauge',color:'#7D8B75'},
     {key:'epure_blush',label:'Blush',color:'#C4898A'},
     {key:'epure_charbon',label:'Charbon',color:'#555'}
   ]},
  {key:'bold',label:'Bold',desc:'Dark mode, audacieux. Premium, moderne, impact.',
   fonts:'Space Grotesk + Instrument Serif',
   presets:[
     {key:'bold_nuit',label:'Nuit',color:'#D4AF37'},
     {key:'bold_foret',label:'Forêt',color:'#A8C5A0'},
     {key:'bold_bordeaux',label:'Bordeaux',color:'#E8A0BF'},
     {key:'bold_electrique',label:'Électrique',color:'#4ECDC4'}
   ]}
];

let currentThemePreset='epure_nude';
let businessPlan='free';
let _galleryCache=[];
let _testimonialCache=[];

async function loadSiteSection(){
  const c=document.getElementById('contentArea');
  c.innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  try{
    const [r,galR,newsR,testR,valR]=await Promise.all([
      fetch('/api/business',{headers:{'Authorization':'Bearer '+api.getToken()}}),
      fetch('/api/gallery',{headers:{'Authorization':'Bearer '+api.getToken()}}).catch(()=>({ok:false})),
      fetch('/api/news',{headers:{'Authorization':'Bearer '+api.getToken()}}).catch(()=>({ok:false})),
      fetch('/api/site/testimonials',{headers:{'Authorization':'Bearer '+api.getToken()}}).catch(()=>({ok:false})),
      fetch('/api/site/values',{headers:{'Authorization':'Bearer '+api.getToken()}}).catch(()=>({ok:false}))
    ]);
    const d=await r.json();
    const galleryItems=galR.ok?await galR.json():[];
    const newsItems=newsR.ok?await newsR.json():[];
    const testData=testR.ok?await testR.json():{};
    const valData=valR.ok?await valR.json():{};
    const testimonialItems=testData.testimonials||[];
    const valueItems=valData.values||[];
    const b=d.business;
    currentThemePreset=resolvePreset(b.theme?.preset||'epure_nude');
    businessPlan=b.plan||'free';
    const slug=b.slug||'';

    // Inject save button into topbar
    const topbar=document.querySelector('.topbar');
    if(topbar&&!topbar.querySelector('#siteSaveBtn')){
      const btn=document.createElement('button');
      btn.id='siteSaveBtn';btn.className='btn-primary';btn.textContent='Enregistrer';
      btn.onclick=()=>saveAllSite();
      topbar.appendChild(btn);
    }

    let h=`<div class="qlink"><div class="info"><h4>Votre page publique</h4><p>${slug}</p></div><div style="display:flex;gap:8px"><a href="/${slug}?preview" target="_blank">Voir ma page</a><a href="/${slug}/book" target="_blank" style="background:rgba(255,255,255,.08)">Page booking</a></div></div>`;

    // -- TEST MODE --
    h+=`<div class="card" style="margin-bottom:24px">
      <div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Mode test</h3>
        <label class="svc-toggle"><input type="checkbox" id="siteTestMode" ${b.settings?.minisite_test_mode?'checked':''} onchange="toggleTestMode(this.checked)"><span class="svc-toggle-slider"></span></label>
      </div>
      <div style="padding:18px">
        <p style="font-size:.82rem;color:var(--text-3);margin-bottom:14px">Protégez votre site par mot de passe pendant sa configuration.</p>
        <div id="testModeFields" style="${b.settings?.minisite_test_mode?'':'display:none'}">
          <div class="fg"><label class="fl">Mot de passe</label><input class="fi" id="siteTestPassword" value="${esc(b.settings?.minisite_test_password||'')}" placeholder="Ex: test2026"></div>
        </div>
      </div>
    </div>`;

    // -- HERO CONTENT --
    h+=`<div class="card"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Contenu du site</h3></div>
      <div style="padding:18px">
        <div class="fg"><label class="fl">Slogan / Tagline</label><input class="fi" id="siteTagline" value="${(b.tagline||'').replace(/"/g,'&quot;')}" placeholder="Ex: Votre santé, notre priorité depuis 2018"></div>
        <div class="fg"><label class="fl">Description</label><textarea class="fi" id="siteDescription" style="min-height:80px;resize:vertical" placeholder="Décrivez votre cabinet en quelques phrases...">${esc(b.description||'')}</textarea></div>
        <div style="display:grid;grid-template-columns:1fr 2fr;gap:16px;margin-top:8px">
          <div>
            <label class="fl" style="margin-bottom:8px;display:block">Logo</label>
            <div id="logoDropZone" class="img-drop-zone" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="event.preventDefault();this.classList.remove('drag-over');handleBrandingFile(event.dataTransfer.files[0],'logo')" onclick="document.getElementById('logoFileInput').click()" style="width:100%;aspect-ratio:1;border-radius:12px;border:2px dashed var(--border);display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;position:relative;background:var(--bg-2);transition:border-color .15s">
              ${b.logo_url?'<img src="'+esc(b.logo_url)+'" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\'">':'<div style="text-align:center;color:var(--text-4);font-size:.75rem"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><br>Logo</div>'}
              ${b.logo_url?'<button onclick="event.stopPropagation();deleteBrandingImage(\'logo\')" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center" title="Supprimer">'+IC.x+'</button>':''}
            </div>
            <input type="file" id="logoFileInput" accept="image/jpeg,image/png,image/webp,image/svg+xml" style="display:none" onchange="handleBrandingFile(this.files[0],'logo')">
          </div>
          <div>
            <label class="fl" style="margin-bottom:8px;display:block">Bannière / Couverture</label>
            <div id="coverDropZone" class="img-drop-zone" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="event.preventDefault();this.classList.remove('drag-over');handleBrandingFile(event.dataTransfer.files[0],'cover')" onclick="document.getElementById('coverFileInput').click()" style="width:100%;aspect-ratio:16/6;border-radius:12px;border:2px dashed var(--border);display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;position:relative;background:var(--bg-2);transition:border-color .15s">
              ${b.cover_image_url?'<img src="'+esc(b.cover_image_url)+'" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\'">':'<div style="text-align:center;color:var(--text-4);font-size:.75rem"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><br>Bannière (recommandé 1200×400)</div>'}
              ${b.cover_image_url?'<button onclick="event.stopPropagation();deleteBrandingImage(\'cover\')" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center" title="Supprimer">'+IC.x+'</button>':''}
            </div>
            <input type="file" id="coverFileInput" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="handleBrandingFile(this.files[0],'cover')">
          </div>
        </div>
        <div style="margin-top:16px">
          <label class="fl" style="margin-bottom:8px;display:block">Photo "Notre philosophie"</label>
          <div id="aboutDropZone" class="img-drop-zone" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="event.preventDefault();this.classList.remove('drag-over');handleBrandingFile(event.dataTransfer.files[0],'about')" onclick="document.getElementById('aboutFileInput').click()" style="width:100%;aspect-ratio:16/9;max-width:400px;border-radius:12px;border:2px dashed var(--border);display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;position:relative;background:var(--bg-2);transition:border-color .15s">
            ${b.settings?.about_image_url?'<img src="'+esc(b.settings.about_image_url)+'" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\'">':'<div style="text-align:center;color:var(--text-4);font-size:.75rem"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><br>Image à côté de la description (recommandé 1200×800)</div>'}
            ${b.settings?.about_image_url?'<button onclick="event.stopPropagation();deleteBrandingImage(\'about\')" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center" title="Supprimer">'+IC.x+'</button>':''}
          </div>
          <input type="file" id="aboutFileInput" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="handleBrandingFile(this.files[0],'about')">
        </div>
      </div>
    </div>`;

    // -- SOCIAL LINKS --
    const sl=b.social_links||{};
    h+=`<div class="card"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Réseaux sociaux</h3></div>
      <div style="padding:18px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="fg"><label class="fl">Facebook</label><input class="fi" id="socialFb" value="${escAttr(sl.facebook)}" placeholder="https://facebook.com/..."></div>
          <div class="fg"><label class="fl">Instagram</label><input class="fi" id="socialIg" value="${escAttr(sl.instagram)}" placeholder="https://instagram.com/..."></div>
          <div class="fg"><label class="fl">LinkedIn</label><input class="fi" id="socialLi" value="${escAttr(sl.linkedin)}" placeholder="https://linkedin.com/in/..."></div>
          <div class="fg"><label class="fl">Site web</label><input class="fi" id="socialWeb" value="${escAttr(sl.website)}" placeholder="https://..."></div>
        </div>
      </div>
    </div>`;

    // Determine which family is active
    const activeFamily=currentThemePreset==='funky'?'funky':currentThemePreset.startsWith('bold')?'bold':'epure';

    h+=`<div class="card"><div class="card-h"><h3>Template du mini-site</h3><span class="badge badge-teal">3 templates</span></div>
    <div style="padding:18px">
      <p style="font-size:.85rem;color:var(--text-3);margin-bottom:16px">Choisissez le template de votre site. Chaque template a sa propre identité visuelle.</p>
      <div class="theme-grid" style="grid-template-columns:repeat(3,1fr)">`;

    // ── FUNKY miniature ──
    const funkyActive=activeFamily==='funky';
    h+=`<div class="theme-card${funkyActive?' active':''}" onclick="selectTheme('funky')">
      <div class="check"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
      <div class="theme-preview" style="background:#FFFAF7;overflow:hidden;position:relative">
        <div class="tp-nav" style="background:rgba(255,250,247,.95);backdrop-filter:blur(8px)">
          <div class="dot" style="background:linear-gradient(135deg,#E8694A,#F15BB5)">G</div>
          <span class="tp-name" style="color:#1E1210;font-family:'Sora',sans-serif;font-weight:800;font-size:7px">GLOW</span>
          <span class="tp-cta" style="background:#E8694A;font-family:'Sora',sans-serif;border-radius:100px;font-size:6px">Réserver ✨</span>
        </div>
        <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:6px;padding:6px 8px 4px;align-items:center">
          <div style="text-align:left">
            <div style="display:inline-block;padding:1px 6px;border-radius:20px;background:#FFF3ED;font-size:4px;color:#E8694A;font-weight:700;margin-bottom:3px">● Dispo</div>
            <div style="font-family:'Sora',sans-serif;font-size:8px;font-weight:800;color:#1E1210;line-height:1.1;letter-spacing:-.3px">Votre moment<br><span style="font-family:'Playfair Display',serif;font-style:italic;font-weight:400">beauté</span></div>
            <div style="margin-top:3px"><span style="display:inline-block;padding:2px 8px;background:#E8694A;color:#fff;border-radius:20px;font-size:4px;font-weight:700;font-family:'Sora',sans-serif">Réserver</span></div>
          </div>
          <div style="aspect-ratio:1;border-radius:40% 60% 55% 45%/55% 40% 60% 45%;background:linear-gradient(135deg,#FFF3ED,#FFE8DA,#FFEAF5);display:flex;align-items:center;justify-content:center"><span style="font-family:'Playfair Display',serif;font-size:14px;color:#E8694A;opacity:.15;font-style:italic">glow</span></div>
        </div>
        <div style="display:flex;justify-content:center;gap:16px;padding:3px 8px;border-top:1px solid #F5E6DB;border-bottom:1px solid #F5E6DB">
          <div style="text-align:center"><span style="font-size:7px;font-weight:800;background:linear-gradient(135deg,#E8694A,#F15BB5);-webkit-background-clip:text;-webkit-text-fill-color:transparent">500+</span><div style="font-size:3px;color:#B8A49A">Clientes</div></div>
          <div style="text-align:center"><span style="font-size:7px;font-weight:800;background:linear-gradient(135deg,#E8694A,#F15BB5);-webkit-background-clip:text;-webkit-text-fill-color:transparent">4.9★</span><div style="font-size:3px;color:#B8A49A">Avis</div></div>
        </div>
      </div>
      <div class="theme-info">
        <h4>Funky</h4>
        <p>Corail + gradients. Punchy, fun, salons beauté.</p>
        <p style="font-size:.6rem;color:var(--text-4);margin-top:3px">Sora + Playfair Display</p>
      </div>
    </div>`;

    // ── ÉPURÉ miniature ──
    const epureActive=activeFamily==='epure';
    const epurePreset=epureActive?currentThemePreset:'epure_nude';
    const epureColors={epure_nude:{accent:'#B8977E',bg:'#FEFDFB',border:'#E8E0D8',subtle:'#F5F0EB'},epure_sauge:{accent:'#7D8B75',bg:'#FAFCF9',border:'#D8E0D4',subtle:'#F0F4ED'},epure_blush:{accent:'#C4898A',bg:'#FFFBFB',border:'#F0D8D8',subtle:'#FBF0F0'},epure_charbon:{accent:'#555',bg:'#FEFEFE',border:'#E0E0E0',subtle:'#F5F5F5'}};
    const ec=epureColors[epurePreset]||epureColors.epure_nude;

    h+=`<div class="theme-card${epureActive?' active':''}" onclick="selectTheme('${epurePreset}')">
      <div class="check"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
      <div class="theme-preview" style="background:${ec.bg};overflow:hidden">
        <div class="tp-nav" style="background:${ec.bg};border-bottom:1px solid ${ec.border}">
          <span class="tp-name" style="color:#2C2C2C;font-family:'DM Sans',sans-serif;font-weight:600;font-size:7px;letter-spacing:1px;text-transform:uppercase">GLOW studio</span>
          <span class="tp-cta" style="background:transparent;color:${ec.accent};border:1px solid ${ec.accent};font-family:'DM Sans',sans-serif;border-radius:2px;font-size:5px;padding:2px 6px">Réserver</span>
        </div>
        <div style="text-align:center;padding:12px 8px 8px">
          <div style="font-size:3.5px;letter-spacing:2px;text-transform:uppercase;color:#888;margin-bottom:4px;font-family:'DM Sans',sans-serif">INSTITUT — BRUXELLES</div>
          <div style="font-family:'DM Sans',sans-serif;font-size:10px;font-weight:500;color:#2C2C2C;line-height:1.2">L'art du soin,<br><span style="font-family:'Cormorant Garamond',serif;font-style:italic">sublime</span></div>
          <div style="margin-top:5px"><span style="display:inline-block;padding:2px 8px;border:1px solid ${ec.accent};color:${ec.accent};font-family:'DM Sans',sans-serif;font-size:4px;border-radius:1px">Prendre rendez-vous</span></div>
        </div>
        <div style="border-top:1px solid ${ec.border};margin:0 8px"></div>
        <div style="padding:4px 8px">
          <div style="font-size:3px;color:#888;border-bottom:1px solid ${ec.border};padding:2px 0;font-family:'DM Sans',sans-serif">Coiffure</div>
          <div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid ${ec.border}"><span style="font-size:3.5px;font-family:'DM Sans',sans-serif;color:#2C2C2C">Coupe femme</span><span style="font-size:3.5px;color:${ec.accent};font-weight:600">35€</span></div>
          <div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid ${ec.border}"><span style="font-size:3.5px;font-family:'DM Sans',sans-serif;color:#2C2C2C">Brushing</span><span style="font-size:3.5px;color:${ec.accent};font-weight:600">25€</span></div>
        </div>
      </div>
      <div class="theme-info">
        <h4>Épuré</h4>
        <p>Minimaliste, élégant, raffiné.</p>
        <div style="display:flex;gap:6px;margin-top:6px;align-items:center">
          ${FAMILIES[1].presets.map(v=>`<div onclick="event.stopPropagation();selectTheme('${v.key}')" style="width:18px;height:18px;border-radius:50%;background:${v.color};cursor:pointer;border:2px solid ${v.key===currentThemePreset?'var(--text)':'transparent'};transition:all .2s;box-shadow:${v.key===currentThemePreset?'0 0 0 2px var(--bg), 0 0 0 4px var(--text)':'none'}" title="${v.label}"></div>`).join('')}
        </div>
      </div>
    </div>`;

    // ── BOLD miniature ──
    const boldActive=activeFamily==='bold';
    const boldPreset=boldActive?currentThemePreset:'bold_nuit';
    const boldColors={bold_nuit:{bg:'#111827',card:'#1F2937',accent:'#D4AF37',text:'#F9FAFB',muted:'#9CA3AF',border:'#374151'},bold_foret:{bg:'#0F1D1A',card:'#1A2E28',accent:'#A8C5A0',text:'#F0F4ED',muted:'#8A9E85',border:'#2D4A3E'},bold_bordeaux:{bg:'#1A0F18',card:'#2D1B2E',accent:'#E8A0BF',text:'#FBF0F5',muted:'#B08A9E',border:'#4A2D45'},bold_electrique:{bg:'#0F1419',card:'#1A2332',accent:'#4ECDC4',text:'#F0F8F7',muted:'#7BA8A3',border:'#2D4A55'}};
    const bc=boldColors[boldPreset]||boldColors.bold_nuit;

    h+=`<div class="theme-card${boldActive?' active':''}" onclick="selectTheme('${boldPreset}')">
      <div class="check"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
      <div class="theme-preview" style="background:${bc.bg};overflow:hidden;position:relative">
        <div style="position:absolute;width:60px;height:60px;border:1px solid ${bc.accent};border-radius:50%;opacity:.12;right:-15px;top:50%;transform:translateY(-50%)"></div>
        <div class="tp-nav" style="background:${bc.bg};border-bottom:1px solid ${bc.border}">
          <span class="tp-name" style="color:${bc.text};font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:7px;letter-spacing:1px;text-transform:uppercase">GLOW <span style="font-family:'Instrument Serif',serif;font-style:italic;text-transform:none;font-weight:400;font-size:6px">studio</span></span>
          <span class="tp-cta" style="background:${bc.accent};color:${bc.bg};font-family:'Space Grotesk',sans-serif;border-radius:4px;font-size:5px;padding:2px 6px;font-weight:600">Réserver</span>
        </div>
        <div style="padding:10px 8px 6px;position:relative;z-index:1">
          <div style="font-size:3.5px;letter-spacing:2px;text-transform:uppercase;color:${bc.accent};margin-bottom:4px;font-weight:700;font-family:'Space Grotesk',sans-serif">BEAUTY — BRUXELLES</div>
          <div style="font-family:'Space Grotesk',sans-serif;font-size:10px;font-weight:700;color:${bc.text};line-height:1.1">Votre style.<br><span style="font-family:'Instrument Serif',serif;font-style:italic;color:${bc.accent}">Notre obsession.</span></div>
          <div style="display:flex;gap:4px;margin-top:5px">
            <span style="display:inline-block;padding:2px 7px;background:${bc.accent};color:${bc.bg};font-size:4px;font-weight:600;border-radius:3px;font-family:'Space Grotesk',sans-serif">Réserver</span>
            <span style="display:inline-block;padding:2px 7px;border:1px solid ${bc.accent};color:${bc.accent};font-size:4px;border-radius:3px;font-family:'Space Grotesk',sans-serif">Découvrir</span>
          </div>
          <div style="width:20px;height:2px;background:${bc.accent};border-radius:1px;margin-top:5px"></div>
        </div>
      </div>
      <div class="theme-info">
        <h4>Bold</h4>
        <p>Dark mode, audacieux, premium.</p>
        <div style="display:flex;gap:6px;margin-top:6px;align-items:center">
          ${FAMILIES[2].presets.map(v=>`<div onclick="event.stopPropagation();selectTheme('${v.key}')" style="width:18px;height:18px;border-radius:50%;background:${v.color};cursor:pointer;border:2px solid ${v.key===currentThemePreset?'var(--text)':'transparent'};transition:all .2s;box-shadow:${v.key===currentThemePreset?'0 0 0 2px var(--bg), 0 0 0 4px var(--text)':'none'}" title="${v.label}"></div>`).join('')}
        </div>
      </div>
    </div>`;

    h+=`</div></div></div>`;

    // Custom color (Pro only)
    const defaultColor=FAMILIES.flatMap(f=>f.presets).find(p=>p.key===currentThemePreset)?.color||'#0D7377';
    const curColor=b.theme?.primary_color||defaultColor;
    h+=`<div class="card"><div class="card-h"><h3>Couleur personnalisée</h3>${businessPlan==='free'?'<span class="th-badge th-pro">Pro</span>':''}</div>
      <div style="padding:18px">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">
        <div><p style="font-size:.85rem;font-weight:600">Remplacer la couleur primaire du thème</p>
        <p style="font-size:.75rem;color:var(--text-4)">${businessPlan==='free'?'Disponible avec le plan Pro':'Choisissez une couleur qui représente votre marque'}</p></div>
        ${businessPlan!=='free'?'<button onclick="saveCustomColor()" style="padding:8px 16px;background:var(--primary);color:#fff;border:none;border-radius:6px;font-family:var(--sans);font-size:.8rem;font-weight:600;cursor:pointer;margin-left:auto">Appliquer</button>':''}
        </div>
        <div id="customColor_wrap"></div>
      </div>
    </div>`;

    // -- GALLERY MANAGEMENT --
    h+=`<div class="card"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Galerie photos</h3><button class="btn-primary" onclick="openGalleryModal()">+ Ajouter</button></div>
      <div style="padding:18px">
        <div id="storageQuota" style="margin-bottom:14px;padding:10px 14px;background:var(--bg-2);border-radius:8px;font-size:.82rem;color:var(--text-3)">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span>Stockage</span><span id="quotaText">Chargement...</span></div>
          <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div id="quotaBar" style="height:100%;background:var(--primary);border-radius:3px;width:0%;transition:width .3s"></div></div>
        </div>
        <p style="font-size:.82rem;color:var(--text-3);margin-bottom:14px">Photos affichées sur votre mini-site. Glissez pour réordonner.</p>
        <div id="galleryGrid" class="gallery-admin-grid">`;
    if(galleryItems.length===0){
      h+=`<div class="empty" style="padding:24px;text-align:center;color:var(--text-4)">Aucune photo. Ajoutez votre première image !</div>`;
    }else{
      galleryItems.forEach((img,i)=>{
        h+=`<div class="gal-item${img.is_active?'':' inactive'}" data-id="${img.id}" draggable="true" ondragstart="galDragStart(event)" ondragover="galDragOver(event)" ondragleave="galDragLeave(event)" ondrop="galDrop(event)">
          <span class="drag-handle" onclick="event.stopPropagation()">${GRIP_SVG}</span>
          <div class="gal-img"><img src="${esc(img.image_url)}" alt="${esc(img.title||'')}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22150%22><rect fill=%22%23eee%22 width=%22200%22 height=%22150%22/><text x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2214%22>Erreur</text></svg>'"></div>
          <div class="gal-info">
            <div class="gal-title">${esc(img.title)||'<em style="color:var(--text-4)">Sans titre</em>'}</div>
            ${img.caption?'<div class="gal-caption">'+esc(img.caption)+'</div>':''}
          </div>
          <div class="gal-actions">
            <button onclick="editGalleryItem('${img.id}')" title="Modifier"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
            <button onclick="toggleGalleryItem('${img.id}',${img.is_active})" title="${img.is_active?'Masquer':'Afficher'}">${img.is_active?'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'}</button>
            <button onclick="deleteGalleryItem('${img.id}')" title="Supprimer" style="color:var(--red)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
          </div>
        </div>`;
      });
    }
    h+=`</div></div></div>`;

    // -- NEWS MANAGEMENT --
    h+=`<div class="card"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/></svg> Actualités</h3><button class="btn-primary" onclick="openNewsModal()">+ Publier</button></div>
      <div style="padding:18px">
        <p style="font-size:.82rem;color:var(--text-3);margin-bottom:14px">Articles affichés sur votre mini-site. Les plus récents apparaissent en premier.</p>
        <div id="newsList">`;
    if(newsItems.length===0){
      h+=`<div class="empty" style="padding:24px;text-align:center;color:var(--text-4)">Aucune actualité. Publiez votre premier article !</div>`;
    }else{
      newsItems.forEach(n=>{
        const date=new Date(n.published_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short',year:'numeric'});
        const tagColors={info:'var(--primary)',alert:'var(--gold)',new:'var(--green)',promo:'#D946EF'};
        h+=`<div class="news-item${n.is_active?'':' inactive'}" data-id="${n.id}">
          <div class="news-date">${date}</div>
          <div class="news-body">
            <div class="news-title-row">
              <span class="news-title">${esc(n.title)}</span>
              ${n.tag?'<span class="news-tag" style="background:'+((tagColors[n.tag_type]||'var(--text-4)')+'22')+';color:'+(tagColors[n.tag_type]||'var(--text-4)')+'">'+esc(n.tag)+'</span>':''}
            </div>
            <div class="news-excerpt">${esc((n.content||'').substring(0,120))}${(n.content||'').length>120?'…':''}</div>
          </div>
          <div class="news-actions">
            <button onclick="editNewsItem('${n.id}')" title="Modifier"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
            <button onclick="toggleNewsItem('${n.id}',${n.is_active})" title="${n.is_active?'Masquer':'Afficher'}">${n.is_active?'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'}</button>
            <button onclick="deleteNewsItem('${n.id}')" title="Supprimer" style="color:var(--red)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
          </div>
        </div>`;
      });
    }
    h+=`</div></div></div>`;

    // -- TESTIMONIALS MANAGEMENT --
    h+=`<div class="card"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Témoignages</h3><button class="btn-primary" onclick="openTestimonialModal()">+ Ajouter</button></div>
      <div style="padding:18px">
        <p style="font-size:.82rem;color:var(--text-3);margin-bottom:14px">Avis de vos clients affichés sur votre mini-site.</p>
        <div id="testimonialsList">`;
    if(testimonialItems.length===0){
      h+=`<div class="empty" style="padding:24px;text-align:center;color:var(--text-4)">Aucun témoignage. Ajoutez votre premier avis !</div>`;
    }else{
      testimonialItems.forEach(t=>{
        h+=`<div class="news-item${t.is_active!==false?'':' inactive'}" data-id="${t.id}">
          <div class="news-date" style="font-size:1.2rem">${t.rating?Array.from({length:t.rating},()=>'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/></svg>').join(''):'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/></svg> <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/></svg> <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/></svg> <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/></svg> <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/></svg>'}</div>
          <div class="news-body">
            <div class="news-title-row"><span class="news-title">${esc(t.author_name||'Anonyme')}</span>${t.author_role?'<span class="news-tag" style="background:var(--primary-light);color:var(--primary)">'+esc(t.author_role)+'</span>':''}</div>
            <div class="news-excerpt">${esc((t.content||'').substring(0,120))}${(t.content||'').length>120?'…':''}</div>
          </div>
          <div class="news-actions">
            <button onclick="editTestimonial('${t.id}')" title="Modifier"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
            <button onclick="deleteTestimonial('${t.id}')" title="Supprimer" style="color:var(--red)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
          </div>
        </div>`;
      });
    }
    h+=`</div></div></div>`;

    // -- VALUES MANAGEMENT --
    h+=`<div class="card"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z"/></svg> Valeurs</h3><button class="btn-primary" onclick="openValueModal()">+ Ajouter</button></div>
      <div style="padding:18px">
        <p style="font-size:.82rem;color:var(--text-3);margin-bottom:14px">Vos engagements et points forts, affichés dans la section À propos.${valueItems.length===0?' <em>Par défaut, 4 valeurs génériques sont affichées.</em>':''}</p>
        <div id="valuesList">`;
    if(valueItems.length===0){
      h+=`<div class="empty" style="padding:24px;text-align:center;color:var(--text-4)">Aucune valeur personnalisée. Des valeurs par défaut sont affichées.</div>`;
    }else{
      valueItems.forEach(v=>{
        h+=`<div class="news-item" data-id="${v.id}">
          <div class="news-date" style="font-size:1.4rem">${v.icon||(v.icon===''?'':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z"/></svg>')}</div>
          <div class="news-body">
            <div class="news-title-row"><span class="news-title">${esc(v.title||'')}</span></div>
            <div class="news-excerpt">${esc(v.description||'')}</div>
          </div>
          <div class="news-actions">
            <button onclick="editValue('${v.id}')" title="Modifier"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
            <button onclick="deleteValue('${v.id}')" title="Supprimer" style="color:var(--red)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
          </div>
        </div>`;
      });
    }
    h+=`</div></div></div>`;

    // -- SEO --
    h+=`<div class="card"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> SEO</h3></div>
      <div style="padding:18px">
        <p style="font-size:.82rem;color:var(--text-3);margin-bottom:14px">Optimisez votre référencement sur Google.</p>
        <div class="fg"><label class="fl">Titre SEO</label><input class="fi" id="seoTitle" value="${(b.seo_title||'').replace(/"/g,'&quot;')}" placeholder="${b.name||'Mon cabinet'} — ${b.tagline||'Prise de rendez-vous en ligne'}"></div>
        <div class="fg"><label class="fl">Description SEO</label><textarea class="fi" id="seoDesc" style="min-height:60px;resize:vertical" placeholder="Description qui apparaîtra dans les résultats Google (max 160 caractères)...">${esc(b.seo_description||'')}</textarea></div>
      </div>
    </div>`;

    // -- SECTION TOGGLES --
    const sections=b.page_sections||{};
    h+=`<div class="card"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> Sections visibles</h3></div>
      <div style="padding:18px">
        <p style="font-size:.82rem;color:var(--text-3);margin-bottom:14px">Activez ou désactivez les sections de votre mini-site.</p>
        <div class="section-toggles">`;
    const sectionList=[
      {key:'about',label:'À propos',icon:'ℹ'},
      {key:'team',label:'Équipe',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'},
      {key:'services',label:'Prestations',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>'},
      {key:'gallery',label:'Galerie',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>'},
      {key:'specializations',label:'Spécialisations',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>'},
      {key:'testimonials',label:'Témoignages',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'},
      {key:'reviews',label:'Avis clients',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>'},
      {key:'news',label:'Actualités',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/></svg>'},
      {key:'location',label:'Horaires & Contact',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'}
    ];
    sectionList.forEach(s=>{
      const on=sections[s.key]!==false;
      h+=`<label class="section-toggle">
        <input type="checkbox" ${on?'checked':''} onchange="toggleSiteSection('${s.key}',this.checked)">
        <span>${s.icon} ${s.label}</span>
      </label>`;
    });
    h+=`</div></div></div>`;

    // -- AVIS CLIENTS (Reviews) --
    const revOn=!!(b.settings?.reviews_enabled);
    const revDelay=b.settings?.review_delay_hours||24;
    h+=`<div class="card"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Avis clients</h3></div>
      <div style="padding:18px">
        <p style="font-size:.82rem;color:var(--text-3);margin-bottom:16px">Recueillez les avis de vos clients après leur rendez-vous. Les avis sont publiés automatiquement sur votre mini-site.</p>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--surface);border-radius:10px;margin-bottom:16px">
          <div><div style="font-size:.85rem;font-weight:600;color:var(--text)">Activer les avis clients</div><div style="font-size:.75rem;color:var(--text-4)">Un email est envoyé au client après son rendez-vous</div></div>
          <label style="position:relative;width:44px;height:24px;cursor:pointer">
            <input type="checkbox" id="s_reviews_enabled" ${revOn?'checked':''} onchange="document.getElementById('reviewOptions').style.display=this.checked?'block':'none'" style="display:none">
            <span style="position:absolute;inset:0;background:${revOn?'var(--primary)':'var(--border)'};border-radius:12px;transition:all .2s"></span>
            <span style="position:absolute;left:${revOn?'22px':'2px'};top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></span>
          </label>
        </div>
        <div id="reviewOptions" style="display:${revOn?'block':'none'}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><span style="font-size:.82rem;color:var(--text-3)">Envoyer la demande d'avis</span><input type="number" id="s_review_delay" value="${revDelay}" min="1" max="168" style="width:60px;text-align:center;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem"><span style="font-size:.82rem;color:var(--text-3)">heures après le RDV</span></div>
          <div style="font-size:.75rem;color:var(--text-4);margin-bottom:10px">Recommandé : 24h (laisse le temps au client de profiter du service)</div>
          <div style="padding:10px 14px;background:var(--surface);border-radius:8px;font-size:.78rem;color:var(--text-4)">Les avis sont publiés automatiquement. Vous pouvez masquer les avis abusifs depuis la section "Avis clients" du dashboard. 1 seul avis par rendez-vous.</div>
        </div>
      </div>
    </div>`;

    c.innerHTML=h;
    // Load storage quota
    loadStorageQuota();
    // Init branding color swatches
    const cwWrap=document.getElementById('customColor_wrap');
    if(cwWrap){
      cwWrap.innerHTML=cswHTML('customColor',curColor,false);
      if(businessPlan==='free'){cwWrap.style.opacity='.4';cwWrap.style.pointerEvents='none';}
    }
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${esc(e.message)}</div>`;}
}

async function loadStorageQuota(){
  try{
    const r=await fetch('/api/gallery/quota',{headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)return;
    const q=await r.json();
    const el=document.getElementById('quotaText');
    const bar=document.getElementById('quotaBar');
    if(el)el.textContent=q.used_formatted+' / '+q.quota_formatted+' utilisés';
    if(bar){
      bar.style.width=Math.min(q.percent,100)+'%';
      if(q.percent>80)bar.style.background='var(--orange,#e67e22)';
      if(q.percent>95)bar.style.background='var(--red,#e74c3c)';
    }
  }catch(e){console.warn('Quota load error:',e);}
}

async function selectTheme(preset){
  if(preset===currentThemePreset)return;
  try{
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
      body:JSON.stringify({theme:{preset}})});
    if(!r.ok){const d=await r.json();throw new Error(d.error);}
    currentThemePreset=preset;
    GendaUI.toast(`Thème "${THEMES[preset].name}" appliqué !`,'success');
    loadSiteSection();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveCustomColor(){
  const color=document.getElementById('customColor').value;
  try{
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
      body:JSON.stringify({theme:{preset:currentThemePreset,primary_color:color}})});
    if(!r.ok){const d=await r.json();throw new Error(d.error);}
    GendaUI.toast('Couleur appliquée !','success');
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// Gallery CRUD
let galPendingPhoto=null;

function openGalleryModal(item){
  const isEdit=!!item;
  galPendingPhoto=null;
  const ov=document.createElement('div');ov.className='m-overlay open';ov.id='galModal';
  ov.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple"><h3>${isEdit?'Modifier la photo':'Ajouter une photo'}</h3><button class="m-close" onclick="closeModal('galModal')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div class="m-body">
      <div>
        <label class="m-field-label">Image</label>
        <div id="galDropZone" style="border:2px dashed var(--border-light);border-radius:10px;padding:24px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s">
          <input type="file" id="galFileInput" accept="image/jpeg,image/png,image/webp" style="display:none">
          <p style="font-size:.85rem;font-weight:500;color:var(--text-2)">Cliquez ou glissez une image ici</p>
          <p style="font-size:.7rem;color:var(--text-4);margin-top:4px">JPEG, PNG ou WebP — max 2 Mo</p>
        </div>
      </div>
      <div id="galPreview" style="margin-bottom:12px;border-radius:8px;overflow:hidden;max-height:200px;display:${item?.image_url?'block':'none'};position:relative">
        <img id="galPreviewImg" src="${item?.image_url||''}" style="width:100%;height:auto;max-height:200px;object-fit:cover">
        <button id="galClearFile" style="display:none;position:absolute;top:6px;right:6px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;font-size:14px;line-height:1" onclick="clearGalFile()">×</button>
      </div>
      <div style="border-top:1px solid var(--border-light);padding-top:12px;margin-top:4px">
        <label class="m-field-label" style="font-size:.72rem;color:var(--text-4)">Ou collez une URL</label>
        <input class="m-input" id="galUrl" value="${isEdit?item?.image_url||'':''}" placeholder="https://i.imgur.com/...jpg" style="font-size:.82rem">
      </div>
      <div><label class="m-field-label">Titre</label><input class="m-input" id="galTitle" value="${item?.title||''}" placeholder="Ex: Notre cabinet"></div>
      <div><label class="m-field-label">Légende</label><input class="m-input" id="galCaption" value="${item?.caption||''}" placeholder="Ex: Salle d'attente rénovée en 2024"></div>
    </div>
    <div class="m-bottom"><div style="flex:1"></div><button class="m-btn m-btn-ghost" onclick="closeModal('galModal')">Annuler</button><button class="m-btn m-btn-primary" id="galSaveBtn" onclick="saveGalleryItem('${item?.id||''}')">${isEdit?'Enregistrer':'Ajouter'}</button></div>
  </div>`;
  document.body.appendChild(ov);
  guardModal(document.getElementById('galModal'));

  // File input + drop zone
  const dropZone=document.getElementById('galDropZone');
  const fileInput=document.getElementById('galFileInput');
  dropZone.addEventListener('click',()=>fileInput.click());
  dropZone.addEventListener('dragover',e=>{e.preventDefault();dropZone.style.borderColor='var(--primary)';dropZone.style.background='rgba(13,115,119,.04)';});
  dropZone.addEventListener('dragleave',()=>{dropZone.style.borderColor='';dropZone.style.background='';});
  dropZone.addEventListener('drop',e=>{e.preventDefault();dropZone.style.borderColor='';dropZone.style.background='';if(e.dataTransfer.files.length)handleGalFile(e.dataTransfer.files[0]);});
  fileInput.addEventListener('change',()=>{if(fileInput.files.length)handleGalFile(fileInput.files[0]);});

  // URL input live preview (fallback)
  const urlInput=document.getElementById('galUrl');
  urlInput.addEventListener('input',()=>{
    if(galPendingPhoto)return; // file takes priority
    const url=urlInput.value.trim();
    const preview=document.getElementById('galPreview');
    const img=document.getElementById('galPreviewImg');
    if(url&&/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|svg)/i.test(url)){
      img.src=url;preview.style.display='block';
    }else{preview.style.display='none';}
  });
}

function handleGalFile(file){
  if(!file.type.match(/^image\/(jpeg|png|webp)$/)){GendaUI.toast('Format invalide (JPEG, PNG ou WebP)','error');return;}
  if(file.size>2*1024*1024){GendaUI.toast('Image trop lourde (max 2 Mo)','error');return;}
  const reader=new FileReader();
  reader.onload=e=>{
    galPendingPhoto=e.target.result;
    document.getElementById('galPreviewImg').src=galPendingPhoto;
    document.getElementById('galPreview').style.display='block';
    document.getElementById('galClearFile').style.display='block';
    document.getElementById('galDropZone').innerHTML='<p style="font-size:.85rem;font-weight:500;color:var(--primary)">'+IC.check+' Image sélectionnée</p><p style="font-size:.7rem;color:var(--text-4);margin-top:4px">Cliquez pour changer</p>';
    document.getElementById('galUrl').value='';
  };
  reader.readAsDataURL(file);
}

function clearGalFile(){
  galPendingPhoto=null;
  document.getElementById('galPreview').style.display='none';
  document.getElementById('galClearFile').style.display='none';
  document.getElementById('galDropZone').innerHTML='<input type="file" id="galFileInput" accept="image/jpeg,image/png,image/webp" style="display:none"><p style="font-size:.85rem;font-weight:500;color:var(--text-2)">Cliquez ou glissez une image ici</p><p style="font-size:.7rem;color:var(--text-4);margin-top:4px">JPEG, PNG ou WebP — max 2 Mo</p>';
  const fi=document.getElementById('galFileInput');
  const dz=document.getElementById('galDropZone');
  dz.addEventListener('click',()=>fi.click());
  fi.addEventListener('change',()=>{if(fi.files.length)handleGalFile(fi.files[0]);});
}

async function saveGalleryItem(id){
  const url=document.getElementById('galUrl').value.trim();
  const title=document.getElementById('galTitle').value.trim();
  const caption=document.getElementById('galCaption').value.trim();

  if(!galPendingPhoto&&!url){GendaUI.toast('Sélectionnez une image ou collez une URL','error');return;}

  const btn=document.getElementById('galSaveBtn');btn.disabled=true;btn.textContent='Enregistrement...';
  try{
    let r;
    if(galPendingPhoto&&!id){
      // Upload file (new only)
      r=await fetch('/api/gallery/upload',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
        body:JSON.stringify({photo:galPendingPhoto,title:title||null,caption:caption||null})});
    }else{
      // URL-based (create or edit)
      const imgUrl=galPendingPhoto?undefined:url;
      if(!id&&!imgUrl){GendaUI.toast('URL requise','error');btn.disabled=false;btn.textContent='Ajouter';return;}
      const method=id?'PUT':'POST';
      const endpoint=id?'/api/gallery/'+id:'/api/gallery';
      const body=id?{title:title||null,caption:caption||null}:{image_url:imgUrl,title:title||null,caption:caption||null};
      if(id&&url)body.image_url=url;
      r=await fetch(endpoint,{method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(body)});
    }
    if(!r.ok){const d=await r.json();throw new Error(d.error);}
    galPendingPhoto=null;
    document.getElementById('galModal')._dirtyGuard?.markClean();
    closeModal('galModal');
    GendaUI.toast(id?'Photo modifiée':'Photo ajoutée','success');
    loadSiteSection();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');btn.disabled=false;btn.textContent=id?'Enregistrer':'Ajouter';}
}

async function editGalleryItem(id){
  try{
    const r=await fetch('/api/gallery',{headers:{'Authorization':'Bearer '+api.getToken()}});
    const items=await r.json();
    const item=items.find(i=>i.id===id);
    if(item)openGalleryModal(item);
  }catch(e){GendaUI.toast('Erreur','error');}
}

async function toggleGalleryItem(id,currentlyActive){
  try{
    const r=await fetch('/api/gallery/'+id,{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
      body:JSON.stringify({is_active:!currentlyActive})});
    if(!r.ok)throw new Error('Erreur');
    GendaUI.toast(currentlyActive?'Photo masquée':'Photo visible','success');
    loadSiteSection();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function deleteGalleryItem(id){
  if(!confirm('Supprimer cette photo ?'))return;
  try{
    const r=await fetch('/api/gallery/'+id,{method:'DELETE',headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error('Erreur');
    GendaUI.toast('Photo supprimée','success');
    loadSiteSection();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// News CRUD
function openNewsModal(item){
  const isEdit=!!item;
  const tagTypes=[{val:'info',label:'Info',color:'var(--primary)'},{val:'alert',label:'Alerte',color:'var(--gold)'},{val:'new',label:'Nouveau',color:'var(--green)'},{val:'promo',label:'Promo',color:'#D946EF'}];
  const ov=document.createElement('div');ov.className='m-overlay open';ov.id='newsModal';
  ov.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple"><h3>${isEdit?'Modifier l\'article':'Publier un article'}</h3><button class="m-close" onclick="closeModal('newsModal')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div class="m-body">
      <div><label class="m-field-label">Titre *</label><input class="m-input" id="newsTitle" value="${item?.title||''}" placeholder="Ex: Nouveau service de téléconsultation"></div>
      <div><label class="m-field-label">Contenu *</label><textarea class="m-input" id="newsContent" style="min-height:120px;resize:vertical" placeholder="Rédigez votre article...">${item?.content||''}</textarea></div>
      <div class="m-row m-row-2">
        <div><label class="m-field-label">Tag (optionnel)</label><input class="m-input" id="newsTag" value="${item?.tag||''}" placeholder="Ex: Nouveau, Important"></div>
        <div><label class="m-field-label">Type de tag</label><select class="m-input" id="newsTagType">
          ${tagTypes.map(t=>`<option value="${t.val}"${item?.tag_type===t.val?' selected':''}>${t.label}</option>`).join('')}
        </select></div>
      </div>
      <div><label class="m-field-label">Image (URL, optionnel)</label><input class="m-input" id="newsImage" value="${item?.image_url||''}" placeholder="https://..."></div>
      <div><label class="m-field-label">Date de publication</label><input class="m-input" type="date" id="newsDate" value="${item?.published_at?.split('T')[0]||new Date().toLocaleDateString('en-CA')}"></div>
    </div>
    <div class="m-bottom"><div style="flex:1"></div><button class="m-btn m-btn-ghost" onclick="closeModal('newsModal')">Annuler</button><button class="m-btn m-btn-primary" id="newsSaveBtn" onclick="saveNewsItem('${item?.id||''}')">${isEdit?'Enregistrer':'Publier'}</button></div>
  </div>`;
  document.body.appendChild(ov);
  guardModal(document.getElementById('newsModal'));
  document.getElementById('newsTitle').focus();
}

async function saveNewsItem(id){
  const title=document.getElementById('newsTitle').value.trim();
  const content=document.getElementById('newsContent').value.trim();
  const tag=document.getElementById('newsTag').value.trim();
  const tag_type=document.getElementById('newsTagType').value;
  const image_url=document.getElementById('newsImage').value.trim();
  const published_at=document.getElementById('newsDate').value;
  if(!title||!content){GendaUI.toast('Titre et contenu requis','error');return;}
  const btn=document.getElementById('newsSaveBtn');btn.disabled=true;btn.textContent='Enregistrement...';
  try{
    const method=id?'PUT':'POST';
    const endpoint=id?'/api/news/'+id:'/api/news';
    const r=await fetch(endpoint,{method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
      body:JSON.stringify({title,content,tag:tag||null,tag_type,image_url:image_url||null,published_at})});
    if(!r.ok){const d=await r.json();throw new Error(d.error);}
    document.getElementById('newsModal')._dirtyGuard?.markClean();
    closeModal('newsModal');
    GendaUI.toast(id?'Article modifié':'Article publié','success');
    loadSiteSection();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');btn.disabled=false;btn.textContent=id?'Enregistrer':'Publier';}
}

async function editNewsItem(id){
  try{
    const r=await fetch('/api/news',{headers:{'Authorization':'Bearer '+api.getToken()}});
    const items=await r.json();
    const item=items.find(i=>i.id===id);
    if(item)openNewsModal(item);
  }catch(e){GendaUI.toast('Erreur','error');}
}

async function toggleNewsItem(id,currentlyActive){
  try{
    const r=await fetch('/api/news/'+id,{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
      body:JSON.stringify({is_active:!currentlyActive})});
    if(!r.ok)throw new Error('Erreur');
    GendaUI.toast(currentlyActive?'Article masqué':'Article visible','success');
    loadSiteSection();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function deleteNewsItem(id){
  if(!confirm('Supprimer cet article ?'))return;
  try{
    const r=await fetch('/api/news/'+id,{method:'DELETE',headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error('Erreur');
    GendaUI.toast('Article supprimé','success');
    loadSiteSection();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// Section toggles
async function toggleSiteSection(key,enabled){
  try{
    const r=await fetch('/api/business',{headers:{'Authorization':'Bearer '+api.getToken()}});
    const d=await r.json();
    const sections=d.business.page_sections||{};
    sections[key]=enabled;
    const r2=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
      body:JSON.stringify({page_sections:sections})});
    if(!r2.ok)throw new Error('Erreur');
    GendaUI.toast(`Section "${key}" ${enabled?'activée':'masquée'}`,'success');
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// Site content saves
async function saveAllSite(){
  const btn=document.getElementById('siteSaveBtn');
  if(!btn)return;
  btn.disabled=true;btn.textContent='Enregistrement...';
  try{
    const body={};
    // Content
    const tagEl=document.getElementById('siteTagline');
    if(tagEl)Object.assign(body,{tagline:tagEl.value.trim()||null,description:document.getElementById('siteDescription').value.trim()||null});
    // Social links
    const fbEl=document.getElementById('socialFb');
    if(fbEl)body.social_links={facebook:fbEl.value.trim()||null,instagram:document.getElementById('socialIg').value.trim()||null,linkedin:document.getElementById('socialLi').value.trim()||null,website:document.getElementById('socialWeb').value.trim()||null};
    // Test mode
    const tmEl=document.getElementById('siteTestMode');
    if(tmEl)Object.assign(body,{settings_minisite_test_mode:tmEl.checked,settings_minisite_test_password:document.getElementById('siteTestPassword')?.value||''});
    // SEO
    const seoEl=document.getElementById('seoTitle');
    if(seoEl)Object.assign(body,{seo_title:seoEl.value.trim()||null,seo_description:document.getElementById('seoDesc').value.trim()||null});
    // Reviews
    const revEl=document.getElementById('s_reviews_enabled');
    if(revEl)Object.assign(body,{settings_reviews_enabled:revEl.checked,settings_review_delay_hours:parseInt(document.getElementById('s_review_delay')?.value)||24});

    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(body)});
    if(!r.ok)throw new Error((await r.json()).error);
    GendaUI.toast('Site enregistré','success');
    btn.disabled=false;btn.textContent='Enregistrer';
  }catch(e){
    GendaUI.toast('Erreur: '+e.message,'error');
    btn.disabled=false;btn.textContent='Enregistrer';
  }
}

async function saveSiteContent(){
  try{
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
      body:JSON.stringify({
        tagline:document.getElementById('siteTagline').value.trim()||null,
        description:document.getElementById('siteDescription').value.trim()||null
      })});
    if(!r.ok){const d=await r.json();throw new Error(d.error);}
    GendaUI.toast('Contenu mis à jour','success');
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function handleBrandingFile(file,type){
  if(!file)return;
  const validTypes=type==='logo'?['image/jpeg','image/png','image/webp','image/svg+xml']:['image/jpeg','image/png','image/webp'];
  if(!validTypes.includes(file.type)){GendaUI.toast('Format invalide','error');return;}
  const maxSize=type==='logo'?1*1024*1024:2*1024*1024;
  if(file.size>maxSize){GendaUI.toast(`Image trop lourde (max ${type==='logo'?'1':'2'} Mo)`,'error');return;}
  const reader=new FileReader();
  reader.onload=async e=>{
    const zone=document.getElementById(type==='logo'?'logoDropZone':'coverDropZone');
    zone.innerHTML='<div class="spinner" style="width:24px;height:24px"></div>';
    try{
      const r=await fetch('/api/business/upload-image',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({photo:e.target.result,type})});
      if(!r.ok){const d=await r.json();throw new Error(d.error);}
      const d=await r.json();
      GendaUI.toast(type==='logo'?'Logo mis à jour':'Bannière mise à jour','success');
      loadSiteSection();
    }catch(err){GendaUI.toast('Erreur: '+err.message,'error');loadSiteSection();}
  };
  reader.readAsDataURL(file);
}
window.handleBrandingFile=handleBrandingFile;

async function deleteBrandingImage(type){
  if(!confirm('Supprimer cette image ?'))return;
  try{
    const r=await fetch('/api/business/delete-image/'+type,{method:'DELETE',headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error('Erreur');
    GendaUI.toast('Image supprimée','success');
    loadSiteSection();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}
window.deleteBrandingImage=deleteBrandingImage;

async function saveSocialLinks(){
  try{
    const social_links={
      facebook:document.getElementById('socialFb').value.trim()||null,
      instagram:document.getElementById('socialIg').value.trim()||null,
      linkedin:document.getElementById('socialLi').value.trim()||null,
      website:document.getElementById('socialWeb').value.trim()||null
    };
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
      body:JSON.stringify({social_links})});
    if(!r.ok){const d=await r.json();throw new Error(d.error);}
    GendaUI.toast('Réseaux sociaux mis à jour','success');
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

function toggleTestMode(checked){
  document.getElementById('testModeFields').style.display=checked?'':'none';
}

async function saveTestMode(){
  try{
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
      body:JSON.stringify({
        settings_minisite_test_mode:document.getElementById('siteTestMode')?.checked||false,
        settings_minisite_test_password:document.getElementById('siteTestPassword')?.value||''
      })});
    if(!r.ok){const d=await r.json();throw new Error(d.error);}
    GendaUI.toast('Mode test mis à jour','success');
    loadSiteSection();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveSEO(){
  try{
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
      body:JSON.stringify({
        seo_title:document.getElementById('seoTitle').value.trim()||null,
        seo_description:document.getElementById('seoDesc').value.trim()||null
      })});
    if(!r.ok){const d=await r.json();throw new Error(d.error);}
    GendaUI.toast('SEO mis à jour','success');
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// Testimonials CRUD
function openTestimonialModal(item){
  const isEdit=!!item;
  const ov=document.createElement('div');ov.className='m-overlay open';ov.id='testModal';
  ov.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple"><h3>${isEdit?'Modifier le témoignage':'Ajouter un témoignage'}</h3><button class="m-close" onclick="closeModal('testModal')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div class="m-body">
      <div><label class="m-field-label">Nom du client *</label><input class="m-input" id="testAuthor" value="${item?.author_name||''}" placeholder="Ex: Marie D."></div>
      <div class="m-row m-row-2">
        <div><label class="m-field-label">Fonction / Contexte</label><input class="m-input" id="testRole" value="${item?.author_role||''}" placeholder="Ex: Patiente depuis 2020"></div>
        <div><label class="m-field-label">Note (1-5)</label><select class="m-input" id="testRating">
          ${[5,4,3,2,1].map(n=>'<option value="'+n+'"'+(item?.rating===n?' selected':(!item&&n===5?' selected':''))+'>'+(Array.from({length:n},()=>'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/></svg>').join(''))+' ('+n+')</option>').join('')}
        </select></div>
      </div>
      <div><label class="m-field-label">Témoignage *</label><textarea class="m-input" id="testContent" style="min-height:100px;resize:vertical" placeholder="Ce que le client dit de votre cabinet...">${item?.content||''}</textarea></div>
    </div>
    <div class="m-bottom"><div style="flex:1"></div><button class="m-btn m-btn-ghost" onclick="closeModal('testModal')">Annuler</button><button class="m-btn m-btn-primary" id="testSaveBtn" onclick="saveTestimonial('${item?.id||''}')">${isEdit?'Enregistrer':'Ajouter'}</button></div>
  </div>`;
  document.body.appendChild(ov);
  guardModal(document.getElementById('testModal'));
  document.getElementById('testAuthor').focus();
}

async function saveTestimonial(id){
  const author_name=document.getElementById('testAuthor').value.trim();
  const content=document.getElementById('testContent').value.trim();
  const author_role=document.getElementById('testRole').value.trim();
  const rating=parseInt(document.getElementById('testRating').value);
  if(!author_name||!content){GendaUI.toast('Nom et témoignage requis','error');return;}
  const btn=document.getElementById('testSaveBtn');btn.disabled=true;btn.textContent='Enregistrement...';
  const initials=author_name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  try{
    const method=id?'PATCH':'POST';
    const endpoint=id?'/api/site/testimonials/'+id:'/api/site/testimonials';
    const r=await fetch(endpoint,{method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
      body:JSON.stringify({author_name,author_role:author_role||null,author_initials:initials,content,rating})});
    if(!r.ok){const d=await r.json();throw new Error(d.error);}
    document.getElementById('testModal')._dirtyGuard?.markClean();
    closeModal('testModal');
    GendaUI.toast(id?'Témoignage modifié':'Témoignage ajouté','success');
    loadSiteSection();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');btn.disabled=false;btn.textContent=id?'Enregistrer':'Ajouter';}
}

async function editTestimonial(id){
  try{
    const r=await fetch('/api/site/testimonials',{headers:{'Authorization':'Bearer '+api.getToken()}});
    const d=await r.json();
    const item=(d.testimonials||[]).find(t=>t.id===id);
    if(item)openTestimonialModal(item);
  }catch(e){GendaUI.toast('Erreur','error');}
}

async function deleteTestimonial(id){
  if(!confirm('Supprimer ce témoignage ?'))return;
  try{
    const r=await fetch('/api/site/testimonials/'+id,{method:'DELETE',headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error('Erreur');
    GendaUI.toast('Témoignage supprimé','success');
    loadSiteSection();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// Values CRUD
function openValueModal(item){
  const isEdit=!!item;
  const icons=['<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>','<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 6 3 6 3s3 0 6-3v-5"/></svg>','<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>','<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z"/></svg>','<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>','<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>','<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>','<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>','<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>','<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.9C15.5 4.9 17 3.5 19 2c1 2 2 4.5 1 8-1.5 5-4.5 8-9 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>','<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18h8"/><path d="M3 22h18"/><path d="M14 22a7 7 0 1 0 0-14h-1"/><path d="M9 14h2"/><path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z"/><path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3"/></svg>','<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>'];
  const ov=document.createElement('div');ov.className='m-overlay open';ov.id='valModal';
  ov.innerHTML=`<div class="m-dialog m-sm">
    <div class="m-header-simple"><h3>${isEdit?'Modifier la valeur':'Ajouter une valeur'}</h3><button class="m-close" onclick="closeModal('valModal')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div class="m-body">
      <div><label class="m-field-label">Icône</label>
        <div id="valIconPicker" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
          ${icons.map(ic=>'<button type="button" onclick="document.getElementById(\'valIcon\').value=\''+ic+'\';document.querySelectorAll(\'#valIconPicker button\').forEach(b=>b.style.outline=\'\');this.style.outline=\'2px solid var(--primary)\'" style="width:36px;height:36px;border-radius:8px;border:1px solid var(--border-light);background:var(--white);font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .1s'+(item?.icon===ic?';outline:2px solid var(--primary)':'')+'">'+ic+'</button>').join('')}
        </div>
        <input class="m-input" id="valIcon" value="${item?.icon||'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z"/></svg>'}" placeholder="Emoji ou texte" style="max-width:80px">
      </div>
      <div><label class="m-field-label">Titre *</label><input class="m-input" id="valTitle" value="${item?.title||''}" placeholder="Ex: Écoute, Expertise, Qualité"></div>
      <div><label class="m-field-label">Description *</label><input class="m-input" id="valDesc" value="${item?.description||''}" placeholder="Ex: Chaque client est unique, nous prenons le temps"></div>
    </div>
    <div class="m-bottom"><div style="flex:1"></div><button class="m-btn m-btn-ghost" onclick="closeModal('valModal')">Annuler</button><button class="m-btn m-btn-primary" id="valSaveBtn" onclick="saveValue('${item?.id||''}')">${isEdit?'Enregistrer':'Ajouter'}</button></div>
  </div>`;
  document.body.appendChild(ov);
  guardModal(document.getElementById('valModal'));
  document.getElementById('valTitle').focus();
}

async function saveValue(id){
  const icon=document.getElementById('valIcon').value.trim()||'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z"/></svg>';
  const title=document.getElementById('valTitle').value.trim();
  const description=document.getElementById('valDesc').value.trim();
  if(!title||!description){GendaUI.toast('Titre et description requis','error');return;}
  const btn=document.getElementById('valSaveBtn');btn.disabled=true;btn.textContent='Enregistrement...';
  try{
    const method=id?'PATCH':'POST';
    const endpoint=id?'/api/site/values/'+id:'/api/site/values';
    const r=await fetch(endpoint,{method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
      body:JSON.stringify({icon,title,description})});
    if(!r.ok){const d=await r.json();throw new Error(d.error);}
    document.getElementById('valModal')._dirtyGuard?.markClean();
    closeModal('valModal');
    GendaUI.toast(id?'Valeur modifiée':'Valeur ajoutée','success');
    loadSiteSection();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');btn.disabled=false;btn.textContent=id?'Enregistrer':'Ajouter';}
}

async function editValue(id){
  try{
    const r=await fetch('/api/site/values',{headers:{'Authorization':'Bearer '+api.getToken()}});
    const d=await r.json();
    const item=(d.values||[]).find(v=>v.id===id);
    if(item)openValueModal(item);
  }catch(e){GendaUI.toast('Erreur','error');}
}

async function deleteValue(id){
  if(!confirm('Supprimer cette valeur ?'))return;
  try{
    const r=await fetch('/api/site/values/'+id,{method:'DELETE',headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error('Erreur');
    GendaUI.toast('Valeur supprimée','success');
    loadSiteSection();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveReviewSettings(){
  try{
    const data={
      settings_reviews_enabled:document.getElementById('s_reviews_enabled').checked,
      settings_review_delay_hours:parseInt(document.getElementById('s_review_delay')?.value)||24
    };
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(data)});
    if(!r.ok)throw new Error((await r.json()).error);
    GendaUI.toast(data.settings_reviews_enabled?'Avis clients activés':'Avis clients désactivés','success');
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// ── Gallery drag-and-drop ──
let galDragEl=null, galDragFromHandle=false;

document.addEventListener('mousedown',e=>{
  if(e.target.closest('.gal-item .drag-handle'))galDragFromHandle=true;
});
document.addEventListener('mouseup',()=>{galDragFromHandle=false;});

function galDragStart(e){
  if(!galDragFromHandle){e.preventDefault();return;}
  const item=e.target.closest('.gal-item');
  if(!item){e.preventDefault();return;}
  galDragEl=item;
  item.classList.add('dragging');
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain','');
}
function galDragOver(e){
  if(!galDragEl)return;
  e.preventDefault();
  e.dataTransfer.dropEffect='move';
  const target=e.target.closest('.gal-item');
  if(target&&target!==galDragEl)target.classList.add('drag-over');
}
function galDragLeave(e){
  const target=e.target.closest('.gal-item');
  if(target)target.classList.remove('drag-over');
}
function galDrop(e){
  e.preventDefault();
  const target=e.target.closest('.gal-item');
  if(!target||!galDragEl||target===galDragEl){cleanupGalDrag();return;}
  target.classList.remove('drag-over');
  const parent=galDragEl.parentNode;
  const items=[...parent.querySelectorAll('.gal-item')];
  const fromIdx=items.indexOf(galDragEl),toIdx=items.indexOf(target);
  if(fromIdx<toIdx)target.after(galDragEl);else target.before(galDragEl);
  cleanupGalDrag();
  persistGalleryOrder();
}
function cleanupGalDrag(){
  if(galDragEl)galDragEl.classList.remove('dragging');
  document.querySelectorAll('.gal-item.drag-over').forEach(el=>el.classList.remove('drag-over'));
  galDragEl=null;galDragFromHandle=false;
}
document.addEventListener('dragend',()=>{if(galDragEl)cleanupGalDrag();});

async function persistGalleryOrder(){
  const items=[...document.querySelectorAll('#galleryGrid .gal-item')];
  const order=items.map((el,i)=>({id:el.dataset.id,sort_order:i}));
  if(!order.length)return;
  try{
    await fetch('/api/gallery/reorder',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({order})});
  }catch(e){console.warn('Gallery reorder failed:',e);}
}

bridge({
  loadSiteSection, selectTheme, saveCustomColor,
  openGalleryModal, saveGalleryItem, editGalleryItem, toggleGalleryItem, deleteGalleryItem, clearGalFile,
  galDragStart, galDragOver, galDragLeave, galDrop,
  openNewsModal, saveNewsItem, editNewsItem, toggleNewsItem, deleteNewsItem,
  toggleSiteSection, saveAllSite, saveSiteContent, saveSocialLinks, saveSEO, toggleTestMode, saveTestMode,
  openTestimonialModal, saveTestimonial, editTestimonial, deleteTestimonial,
  openValueModal, saveValue, editValue, deleteValue,
  saveReviewSettings
});

export { loadSiteSection };
