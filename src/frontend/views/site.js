/**
 * Site / Mini-site management view module.
 */
import { api, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';
import { cswHTML } from './agenda/color-swatches.js';

const THEMES={
  classique:{name:'Classique',desc:'Épuré et professionnel. Teal + typographie éditoriale.',free:true,
    colors:{bg:'#FAFAF9',nav:'#FAFAF9',navText:'#1A1816',primary:'#0D7377',text:'#1A1816',card:'#FFF',cardBorder:'#ECEAE6',heroBg:'#FAFAF9'},
    heroStyle:'light',layout:'left',
    fontUrl:'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700&family=Instrument+Serif&display=swap',
    serif:"'Instrument Serif',Georgia,serif",sans:"'Plus Jakarta Sans',sans-serif",
    fontLabel:'Jakarta Sans + Instrument Serif'},
  prestige:{name:'Prestige',desc:'Bleu nuit + or. Idéal avocats, notaires, consultants.',free:false,
    colors:{bg:'#F8F7F4',nav:'#1B1B1B',navText:'#FFF',primary:'#1E3A5F',text:'#1B1B1B',card:'#FFF',cardBorder:'#E0DDD8',heroBg:'#1B1B1B'},
    heroStyle:'dark',layout:'left',
    fontUrl:'https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@500;600&display=swap',
    serif:"'DM Serif Display',Georgia,serif",sans:"'Inter',sans-serif",
    fontLabel:'Inter + DM Serif Display'},
  zen:{name:'Zen',desc:'Vert sauge + beige. Parfait bien-être, thérapeutes, coachs.',free:false,
    colors:{bg:'#F7F5F0',nav:'#F7F5F0',navText:'#2C2820',primary:'#6B7F5E',text:'#2C2820',card:'#FFFDF9',cardBorder:'#E5E0D6',heroBg:'#EDE9E0'},
    heroStyle:'light',layout:'center',
    fontUrl:'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Nunito+Sans:wght@500;600&display=swap',
    serif:"'Cormorant Garamond',Georgia,serif",sans:"'Nunito Sans',sans-serif",
    fontLabel:'Nunito Sans + Cormorant Garamond'},
  moderne:{name:'Moderne',desc:'Noir + blanc. Géométrique, tech-forward, minimaliste.',free:false,
    colors:{bg:'#FAFAFA',nav:'#FAFAFA',navText:'#111',primary:'#111',text:'#111',card:'#FFF',cardBorder:'#E8E8E8',heroBg:'#FAFAFA'},
    heroStyle:'light',layout:'left',accentCards:true,
    fontUrl:'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Instrument+Serif&display=swap',
    serif:"'Instrument Serif',Georgia,serif",sans:"'Space Grotesk',sans-serif",
    fontLabel:'Space Grotesk + Instrument Serif'},
  chaleureux:{name:'Chaleureux',desc:'Terracotta + crème. Accueillant, personnel, artisanal.',free:false,
    colors:{bg:'#FAF6F2',nav:'#FAF6F2',navText:'#2E1F14',primary:'#8B4513',text:'#2E1F14',card:'#FFFCF8',cardBorder:'#E8E0D6',heroBg:'#F0EAE2'},
    heroStyle:'light',layout:'center',
    fontUrl:'https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Source+Sans+3:wght@500;600&display=swap',
    serif:"'Libre Baskerville',Georgia,serif",sans:"'Source Sans 3',sans-serif",
    fontLabel:'Source Sans 3 + Libre Baskerville'},
  ocean:{name:'Océan',desc:'Bleu profond + ciel. Frais, ouvert, médical.',free:false,
    colors:{bg:'#F5F8FA',nav:'#0F2440',navText:'#FFF',primary:'#1565C0',text:'#0F2440',card:'#FFF',cardBorder:'#DCE5ED',heroBg:'#0F2440'},
    heroStyle:'dark',layout:'left',
    fontUrl:'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600&family=Lato:wght@400;700&display=swap',
    serif:"'Playfair Display',Georgia,serif",sans:"'Lato',sans-serif",
    fontLabel:'Lato + Playfair Display'}
};

let currentThemePreset='classique';
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
    currentThemePreset=b.theme?.preset||'classique';
    businessPlan=b.plan||'free';
    const slug=b.slug||'';

    let h=`<div class="qlink"><div class="info"><h4>Votre page publique</h4><p>${slug}</p></div><div style="display:flex;gap:8px"><a href="/${slug}?preview" target="_blank">Voir ma page</a><a href="/${slug}/book" target="_blank" style="background:rgba(255,255,255,.08)">Page booking</a></div></div>`;

    // -- HERO CONTENT --
    h+=`<div class="card"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Contenu du site</h3></div>
      <div style="padding:18px">
        <div class="fg"><label class="fl">Slogan / Tagline</label><input class="fi" id="siteTagline" value="${(b.tagline||'').replace(/"/g,'&quot;')}" placeholder="Ex: Votre santé, notre priorité depuis 2018"></div>
        <div class="fg"><label class="fl">Description</label><textarea class="fi" id="siteDescription" style="min-height:80px;resize:vertical" placeholder="Décrivez votre cabinet en quelques phrases...">${b.description||''}</textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="fg"><label class="fl">Logo (URL)</label><input class="fi" id="siteLogo" value="${b.logo_url||''}" placeholder="https://..."></div>
          <div class="fg"><label class="fl">Image de couverture (URL)</label><input class="fi" id="siteCover" value="${b.cover_image_url||''}" placeholder="https://..."></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px">
          ${b.logo_url?'<div style="width:48px;height:48px;border-radius:8px;border:1px solid var(--border-light);overflow:hidden"><img src="'+b.logo_url+'" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.style.display=\'none\'"></div>':''}
          ${b.cover_image_url?'<div style="flex:1;height:48px;border-radius:8px;border:1px solid var(--border-light);overflow:hidden"><img src="'+b.cover_image_url+'" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.style.display=\'none\'"></div>':''}
        </div>
      </div>
      <div style="padding:0 18px 18px;display:flex;justify-content:flex-end"><button class="btn-primary" onclick="saveSiteContent()">Enregistrer</button></div>
    </div>`;

    // -- SOCIAL LINKS --
    const sl=b.social_links||{};
    h+=`<div class="card"><div class="card-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Réseaux sociaux</h3></div>
      <div style="padding:18px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="fg"><label class="fl">Facebook</label><input class="fi" id="socialFb" value="${sl.facebook||''}" placeholder="https://facebook.com/..."></div>
          <div class="fg"><label class="fl">Instagram</label><input class="fi" id="socialIg" value="${sl.instagram||''}" placeholder="https://instagram.com/..."></div>
          <div class="fg"><label class="fl">LinkedIn</label><input class="fi" id="socialLi" value="${sl.linkedin||''}" placeholder="https://linkedin.com/in/..."></div>
          <div class="fg"><label class="fl">Site web</label><input class="fi" id="socialWeb" value="${sl.website||''}" placeholder="https://..."></div>
        </div>
      </div>
      <div style="padding:0 18px 18px;display:flex;justify-content:flex-end"><button class="btn-primary" onclick="saveSocialLinks()">Enregistrer</button></div>
    </div>`;

    h+=`<div class="card"><div class="card-h"><h3>Thème du mini-site</h3><span class="badge ${businessPlan==='free'?'badge-teal':'badge-teal'}">${businessPlan==='free'?'Plan Gratuit — 1 thème':'Plan '+businessPlan.charAt(0).toUpperCase()+businessPlan.slice(1)}</span></div>
    <div style="padding:18px">
      <p style="font-size:.85rem;color:var(--text-3);margin-bottom:4px">Choisissez l'identité visuelle de votre site. Chaque thème inclut typographie, palette et mise en page uniques.</p>
      ${businessPlan==='free'?'<p style="font-size:.78rem;color:var(--gold);margin-bottom:12px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg> Passez au plan Pro pour débloquer les 5 thèmes premium + couleur personnalisée.</p>':''}
      <div class="theme-grid">`;

    Object.entries(THEMES).forEach(([key,t])=>{
      const isActive=key===currentThemePreset;
      const isPro=!t.free;
      const isLocked=isPro&&businessPlan==='free';
      const cls=`theme-card${isActive?' active':''}${isLocked?' locked':''}`;
      const co=t.colors;
      const heroAlign=t.layout==='center'?'center':'left';

      h+=`<div class="${cls}" onclick="${isLocked?'':'selectTheme(\''+key+'\')'}">
        <link rel="stylesheet" href="${t.fontUrl}">
        <div class="check"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
        ${isLocked?'<div class="lock-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>':''}
        <div class="theme-preview" style="background:${co.heroBg}">
          <div class="tp-nav" style="background:${co.nav}">
            <div class="dot" style="background:${co.primary}">G</div>
            <span class="tp-name" style="color:${co.navText};font-family:${t.sans}">Cabinet</span>
            <span class="tp-cta" style="background:${co.primary};font-family:${t.sans}">RDV</span>
          </div>
          <div class="tp-hero" style="color:${t.heroStyle==='dark'?'#fff':co.text};text-align:${heroAlign}">
            <h3 style="font-family:${t.serif}">Cabinet Dupont</h3>
            <p style="font-family:${t.sans}">Votre santé, notre priorité</p>
          </div>
          <div class="tp-cards">
            <div class="tp-card" style="background:${co.card};border-color:${co.cardBorder}${t.accentCards||t.layout==='center'?';border-top:2px solid '+co.primary:''}"></div>
            <div class="tp-card" style="background:${co.card};border-color:${co.cardBorder}${t.accentCards||t.layout==='center'?';border-top:2px solid '+co.primary:''}"></div>
            <div class="tp-card" style="background:${co.card};border-color:${co.cardBorder}${t.accentCards||t.layout==='center'?';border-top:2px solid '+co.primary:''}"></div>
          </div>
        </div>
        <div class="theme-info">
          <h4>${t.name} <span class="th-badge ${t.free?'th-free':'th-pro'}">${t.free?'Gratuit':'Pro'}</span></h4>
          <p>${t.desc}</p>
          <p style="font-size:.6rem;color:var(--text-4);margin-top:3px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg> ${t.fontLabel}${t.layout==='center'?' · <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 11 21 7 17 3"/><line x1="21" y1="7" x2="9" y2="7"/><polyline points="7 21 3 17 7 13"/><line x1="15" y1="17" x2="3" y2="17"/></svg> Centré':''}${t.accentCards?' · <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="10" width="18" height="4" rx="1" fill="currentColor"/></svg> Accents':''}</p>
        </div>
      </div>`;
    });

    h+=`</div></div></div>`;

    // Custom color (Pro only)
    const curColor=b.theme?.primary_color||THEMES[currentThemePreset]?.colors?.primary||'#0D7377';
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
        <p style="font-size:.82rem;color:var(--text-3);margin-bottom:14px">Photos affichées sur votre mini-site. Glissez pour réordonner. URL d'image directe requise (Imgur, Cloudinary, etc.).</p>
        <div id="galleryGrid" class="gallery-admin-grid">`;
    if(galleryItems.length===0){
      h+=`<div class="empty" style="padding:24px;text-align:center;color:var(--text-4)">Aucune photo. Ajoutez votre première image !</div>`;
    }else{
      galleryItems.forEach((img,i)=>{
        h+=`<div class="gal-item${img.is_active?'':' inactive'}" data-id="${img.id}">
          <div class="gal-img"><img src="${img.image_url}" alt="${img.title||''}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22150%22><rect fill=%22%23eee%22 width=%22200%22 height=%22150%22/><text x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2214%22>Erreur</text></svg>'"></div>
          <div class="gal-info">
            <div class="gal-title">${img.title||'<em style="color:var(--text-4)">Sans titre</em>'}</div>
            ${img.caption?'<div class="gal-caption">'+img.caption+'</div>':''}
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
              <span class="news-title">${n.title}</span>
              ${n.tag?'<span class="news-tag" style="background:'+((tagColors[n.tag_type]||'var(--text-4)')+'22')+';color:'+(tagColors[n.tag_type]||'var(--text-4)')+'">'+n.tag+'</span>':''}
            </div>
            <div class="news-excerpt">${(n.content||'').substring(0,120)}${(n.content||'').length>120?'…':''}</div>
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
            <div class="news-title-row"><span class="news-title">${t.author_name||'Anonyme'}</span>${t.author_role?'<span class="news-tag" style="background:var(--primary-light);color:var(--primary)">'+t.author_role+'</span>':''}</div>
            <div class="news-excerpt">${(t.content||'').substring(0,120)}${(t.content||'').length>120?'…':''}</div>
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
          <div class="news-date" style="font-size:1.4rem">${v.icon||'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z"/></svg>'}</div>
          <div class="news-body">
            <div class="news-title-row"><span class="news-title">${v.title||''}</span></div>
            <div class="news-excerpt">${v.description||''}</div>
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
        <div class="fg"><label class="fl">Description SEO</label><textarea class="fi" id="seoDesc" style="min-height:60px;resize:vertical" placeholder="Description qui apparaîtra dans les résultats Google (max 160 caractères)...">${b.seo_description||''}</textarea></div>
      </div>
      <div style="padding:0 18px 18px;display:flex;justify-content:flex-end"><button class="btn-primary" onclick="saveSEO()">Enregistrer</button></div>
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

    c.innerHTML=h;
    // Init branding color swatches
    const cwWrap=document.getElementById('customColor_wrap');
    if(cwWrap){
      cwWrap.innerHTML=cswHTML('customColor',curColor,false);
      if(businessPlan==='free'){cwWrap.style.opacity='.4';cwWrap.style.pointerEvents='none';}
    }
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${e.message}</div>`;}
}

async function selectTheme(preset){
  if(preset===currentThemePreset)return;
  try{
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
      body:JSON.stringify({theme:{preset,primary_color:THEMES[preset]?.colors?.primary}})});
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
function openGalleryModal(item){
  const isEdit=!!item;
  const ov=document.createElement('div');ov.className='modal-overlay';
  ov.innerHTML=`<div class="modal"><div class="modal-h"><h3>${isEdit?'Modifier la photo':'Ajouter une photo'}</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div class="modal-body">
      <div class="fg"><label class="fl">URL de l'image *</label><input class="fi" id="galUrl" value="${item?.image_url||''}" placeholder="https://i.imgur.com/...jpg">
        <p style="font-size:.68rem;color:var(--text-4);margin-top:3px">Hébergez vos images sur <a href="https://imgur.com" target="_blank" style="color:var(--primary)">Imgur</a>, <a href="https://cloudinary.com" target="_blank" style="color:var(--primary)">Cloudinary</a> ou similaire.</p>
      </div>
      <div id="galPreview" style="margin-bottom:12px;border-radius:8px;overflow:hidden;max-height:200px;display:${item?.image_url?'block':'none'}">
        <img id="galPreviewImg" src="${item?.image_url||''}" style="width:100%;height:auto;max-height:200px;object-fit:cover">
      </div>
      <div class="fg"><label class="fl">Titre</label><input class="fi" id="galTitle" value="${item?.title||''}" placeholder="Ex: Notre cabinet"></div>
      <div class="fg"><label class="fl">Légende</label><input class="fi" id="galCaption" value="${item?.caption||''}" placeholder="Ex: Salle d'attente rénovée en 2024"></div>
    </div>
    <div class="modal-foot"><button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Annuler</button><button class="btn-primary" id="galSaveBtn" onclick="saveGalleryItem('${item?.id||''}')">${isEdit?'Enregistrer':'Ajouter'}</button></div>
  </div>`;
  document.body.appendChild(ov);
  // Live preview
  const urlInput=document.getElementById('galUrl');
  urlInput.addEventListener('input',()=>{
    const url=urlInput.value.trim();
    const preview=document.getElementById('galPreview');
    const img=document.getElementById('galPreviewImg');
    if(url&&/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|svg)/i.test(url)){
      img.src=url;preview.style.display='block';
    }else{preview.style.display='none';}
  });
  urlInput.focus();
}

async function saveGalleryItem(id){
  const url=document.getElementById('galUrl').value.trim();
  const title=document.getElementById('galTitle').value.trim();
  const caption=document.getElementById('galCaption').value.trim();
  if(!url){GendaUI.toast('URL de l\'image requise','error');return;}
  const btn=document.getElementById('galSaveBtn');btn.disabled=true;btn.textContent='Enregistrement...';
  try{
    const method=id?'PUT':'POST';
    const endpoint=id?'/api/gallery/'+id:'/api/gallery';
    const r=await fetch(endpoint,{method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
      body:JSON.stringify({image_url:url,title:title||null,caption:caption||null})});
    if(!r.ok){const d=await r.json();throw new Error(d.error);}
    document.querySelector('.modal-overlay')?.remove();
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
  const ov=document.createElement('div');ov.className='modal-overlay';
  ov.innerHTML=`<div class="modal"><div class="modal-h"><h3>${isEdit?'Modifier l\'article':'Publier un article'}</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div class="modal-body">
      <div class="fg"><label class="fl">Titre *</label><input class="fi" id="newsTitle" value="${item?.title||''}" placeholder="Ex: Nouveau service de téléconsultation"></div>
      <div class="fg"><label class="fl">Contenu *</label><textarea class="fi" id="newsContent" style="min-height:120px;resize:vertical" placeholder="Rédigez votre article...">${item?.content||''}</textarea></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="fg"><label class="fl">Tag (optionnel)</label><input class="fi" id="newsTag" value="${item?.tag||''}" placeholder="Ex: Nouveau, Important"></div>
        <div class="fg"><label class="fl">Type de tag</label><select class="fi" id="newsTagType" style="padding:8px 12px">
          ${tagTypes.map(t=>`<option value="${t.val}"${item?.tag_type===t.val?' selected':''}>${t.label}</option>`).join('')}
        </select></div>
      </div>
      <div class="fg"><label class="fl">Image (URL, optionnel)</label><input class="fi" id="newsImage" value="${item?.image_url||''}" placeholder="https://..."></div>
      <div class="fg"><label class="fl">Date de publication</label><input class="fi" type="date" id="newsDate" value="${item?.published_at?.split('T')[0]||new Date().toISOString().split('T')[0]}"></div>
    </div>
    <div class="modal-foot"><button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Annuler</button><button class="btn-primary" id="newsSaveBtn" onclick="saveNewsItem('${item?.id||''}')">${isEdit?'Enregistrer':'Publier'}</button></div>
  </div>`;
  document.body.appendChild(ov);
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
    document.querySelector('.modal-overlay')?.remove();
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
async function saveSiteContent(){
  try{
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
      body:JSON.stringify({
        tagline:document.getElementById('siteTagline').value.trim()||null,
        description:document.getElementById('siteDescription').value.trim()||null,
        logo_url:document.getElementById('siteLogo').value.trim()||null,
        cover_image_url:document.getElementById('siteCover').value.trim()||null
      })});
    if(!r.ok){const d=await r.json();throw new Error(d.error);}
    GendaUI.toast('Contenu mis à jour','success');
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

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
  const ov=document.createElement('div');ov.className='modal-overlay';
  ov.innerHTML=`<div class="modal"><div class="modal-h"><h3>${isEdit?'Modifier le témoignage':'Ajouter un témoignage'}</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div class="modal-body">
      <div class="fg"><label class="fl">Nom du client *</label><input class="fi" id="testAuthor" value="${item?.author_name||''}" placeholder="Ex: Marie D."></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="fg"><label class="fl">Fonction / Contexte</label><input class="fi" id="testRole" value="${item?.author_role||''}" placeholder="Ex: Patiente depuis 2020"></div>
        <div class="fg"><label class="fl">Note (1-5)</label><select class="fi" id="testRating" style="padding:8px 12px">
          ${[5,4,3,2,1].map(n=>'<option value="'+n+'"'+(item?.rating===n?' selected':(!item&&n===5?' selected':''))+'>'+(Array.from({length:n},()=>'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/></svg>').join(''))+' ('+n+')</option>').join('')}
        </select></div>
      </div>
      <div class="fg"><label class="fl">Témoignage *</label><textarea class="fi" id="testContent" style="min-height:100px;resize:vertical" placeholder="Ce que le client dit de votre cabinet...">${item?.content||''}</textarea></div>
    </div>
    <div class="modal-foot"><button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Annuler</button><button class="btn-primary" id="testSaveBtn" onclick="saveTestimonial('${item?.id||''}')">${isEdit?'Enregistrer':'Ajouter'}</button></div>
  </div>`;
  document.body.appendChild(ov);
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
    document.querySelector('.modal-overlay')?.remove();
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
  const ov=document.createElement('div');ov.className='modal-overlay';
  ov.innerHTML=`<div class="modal"><div class="modal-h"><h3>${isEdit?'Modifier la valeur':'Ajouter une valeur'}</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div class="modal-body">
      <div class="fg"><label class="fl">Icône</label>
        <div id="valIconPicker" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
          ${icons.map(ic=>'<button type="button" onclick="document.getElementById(\'valIcon\').value=\''+ic+'\';document.querySelectorAll(\'#valIconPicker button\').forEach(b=>b.style.outline=\'\');this.style.outline=\'2px solid var(--primary)\'" style="width:36px;height:36px;border-radius:8px;border:1px solid var(--border-light);background:var(--white);font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .1s'+(item?.icon===ic?';outline:2px solid var(--primary)':'')+'">'+ic+'</button>').join('')}
        </div>
        <input class="fi" id="valIcon" value="${item?.icon||'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z"/></svg>'}" placeholder="Emoji ou texte" style="max-width:80px">
      </div>
      <div class="fg"><label class="fl">Titre *</label><input class="fi" id="valTitle" value="${item?.title||''}" placeholder="Ex: Écoute, Expertise, Qualité"></div>
      <div class="fg"><label class="fl">Description *</label><input class="fi" id="valDesc" value="${item?.description||''}" placeholder="Ex: Chaque patient est unique, nous prenons le temps"></div>
    </div>
    <div class="modal-foot"><button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Annuler</button><button class="btn-primary" id="valSaveBtn" onclick="saveValue('${item?.id||''}')">${isEdit?'Enregistrer':'Ajouter'}</button></div>
  </div>`;
  document.body.appendChild(ov);
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
    document.querySelector('.modal-overlay')?.remove();
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

bridge({
  loadSiteSection, selectTheme, saveCustomColor,
  openGalleryModal, saveGalleryItem, editGalleryItem, toggleGalleryItem, deleteGalleryItem,
  openNewsModal, saveNewsItem, editNewsItem, toggleNewsItem, deleteNewsItem,
  toggleSiteSection, saveSiteContent, saveSocialLinks, saveSEO,
  openTestimonialModal, saveTestimonial, editTestimonial, deleteTestimonial,
  openValueModal, saveValue, editValue, deleteValue
});

export { loadSiteSection };
