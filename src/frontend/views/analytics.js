/**
 * Analytics view module.
 */
import { api } from '../state.js';
import { bridge } from '../utils/window-bridge.js';

let analyticsPeriod='30d';

async function loadAnalytics(period){
  if(period)analyticsPeriod=period;
  const c=document.getElementById('contentArea');
  c.innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  try{
    const r=await fetch(`/api/dashboard/analytics?period=${analyticsPeriod}`,{headers:{'Authorization':'Bearer '+api.getToken()}});
    const d=await r.json();
    renderAnalytics(d);
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${e.message}</div>`;}
}

function renderAnalytics(d){
  const c=document.getElementById('contentArea');
  const t=d.totals;
  let h=`<div class="an-period">
    <button class="${analyticsPeriod==='7d'?'active':''}" onclick="loadAnalytics('7d')">7 jours</button>
    <button class="${analyticsPeriod==='30d'?'active':''}" onclick="loadAnalytics('30d')">30 jours</button>
    <button class="${analyticsPeriod==='90d'?'active':''}" onclick="loadAnalytics('90d')">90 jours</button>
  </div>`;

  // KPIs
  h+=`<div class="an-kpi">
    <div class="kpi"><div class="kv">${t.bookings}</div><div class="kl">RDV confirmés</div></div>
    <div class="kpi"><div class="kv">${(t.revenue/100).toFixed(0)} €</div><div class="kl">Chiffre d'affaires</div></div>
    <div class="kpi"><div class="kv">${(t.avg_booking_value/100).toFixed(0)} €</div><div class="kl">Panier moyen</div></div>
    <div class="kpi"><div class="kv">${t.no_show_rate}%</div><div class="kl">Taux no-show</div></div>
    <div class="kpi"><div class="kv">${d.new_clients}</div><div class="kl">Nouveaux clients</div></div>
  </div>`;

  // Charts row 1: Revenue + Bookings trend
  h+=`<div class="chart-card"><h4>Évolution du chiffre d'affaires</h4><canvas id="chartRevenue" height="200"></canvas></div>`;
  h+=`<div class="chart-card"><h4>Rendez-vous par jour</h4><canvas id="chartBookings" height="160"></canvas></div>`;

  // Charts row 2: Top services + Status breakdown
  h+=`<div class="chart-row">`;

  // Top services
  h+=`<div class="chart-card"><h4>Top prestations</h4>`;
  if(d.top_services.length===0){h+=`<div class="empty" style="padding:20px">Pas encore de données</div>`;}
  else{
    const maxCount=Math.max(...d.top_services.map(s=>s.count),1);
    h+=`<div class="top-svc-list">`;
    d.top_services.forEach(s=>{
      const pct=Math.round(s.count/maxCount*100);
      h+=`<div class="top-svc-row"><span class="sname">${s.name}</span><div class="bar-wrap"><div class="bar" style="width:${pct}%;background:${s.color||'var(--primary)'}">${s.count}</div></div><span class="scount">${(s.revenue/100).toFixed(0)}€</span></div>`;
    });
    h+=`</div>`;
  }
  h+=`</div>`;

  // Status breakdown
  h+=`<div class="chart-card"><h4>Répartition des statuts</h4><canvas id="chartStatus" height="200"></canvas>`;
  const stColors={confirmed:'#0D7377',completed:'#6B6560',pending:'#A68B3C',no_show:'#DC8C00',cancelled:'#DC2626'};
  const stLabels={confirmed:'Confirmé',completed:'Terminé',pending:'En attente',no_show:'No-show',cancelled:'Annulé'};
  h+=`<div class="status-legend">`;
  d.status_breakdown.forEach(s=>{h+=`<span class="sl"><span class="dot" style="background:${stColors[s.status]||'#999'}"></span>${stLabels[s.status]||s.status}: ${s.count}</span>`;});
  h+=`</div></div>`;

  h+=`</div>`; // end chart-row

  // Peak hours heatmap
  h+=`<div class="chart-card"><h4>Heures de pointe</h4><div class="heatmap" id="heatmap"></div></div>`;

  // Monthly revenue
  if(d.monthly.length>1){
    h+=`<div class="chart-card"><h4>Revenus mensuels</h4><canvas id="chartMonthly" height="180"></canvas></div>`;
  }

  c.innerHTML=h;

  // Draw charts after DOM is ready
  setTimeout(()=>{
    drawLineChart('chartRevenue',d.daily.map(r=>r.day?.slice(5)||''),d.daily.map(r=>r.revenue/100),'€','#0D7377');
    drawBarChart('chartBookings',d.daily.map(r=>r.day?.slice(5)||''),d.daily.map(r=>r.bookings),'#0D7377');
    drawDonutChart('chartStatus',d.status_breakdown.map(s=>s.count),d.status_breakdown.map(s=>stColors[s.status]||'#999'));
    drawHeatmap('heatmap',d.peak_hours);
    if(d.monthly.length>1){
      const mLabels=d.monthly.map(m=>{const[y,mo]=m.month.split('-');return['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'][parseInt(mo)-1];});
      drawBarChart('chartMonthly',mLabels,d.monthly.map(m=>m.revenue/100),'#0D7377',true);
    }
  },50);
}

// ===== CHART HELPERS (Canvas) =====
function drawLineChart(id,labels,data,suffix,color){
  const canvas=document.getElementById(id);if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const dpr=window.devicePixelRatio||1;
  const w=canvas.parentElement.clientWidth-36;
  canvas.width=w*dpr;canvas.height=200*dpr;canvas.style.width=w+'px';canvas.style.height='200px';
  ctx.scale(dpr,dpr);
  const pad={t:20,r:20,b:30,l:50};
  const cw=w-pad.l-pad.r,ch=200-pad.t-pad.b;
  const max=Math.max(...data,1)*1.15;
  const step=cw/(data.length-1||1);

  // Grid
  ctx.strokeStyle='#ECEAE6';ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
    const y=pad.t+ch-ch*(i/4);
    ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();
    ctx.fillStyle='#9C958E';ctx.font='10px sans-serif';ctx.textAlign='right';
    ctx.fillText(Math.round(max*i/4)+(suffix||''),pad.l-6,y+3);
  }

  // Line
  ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.lineJoin='round';ctx.beginPath();
  data.forEach((v,i)=>{
    const x=pad.l+i*step,y=pad.t+ch-ch*(v/max);
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  });
  ctx.stroke();

  // Fill
  ctx.lineTo(pad.l+(data.length-1)*step,pad.t+ch);ctx.lineTo(pad.l,pad.t+ch);ctx.closePath();
  ctx.fillStyle=color+'18';ctx.fill();

  // Dots
  data.forEach((v,i)=>{
    const x=pad.l+i*step,y=pad.t+ch-ch*(v/max);
    ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
  });

  // X labels (show subset)
  ctx.fillStyle='#9C958E';ctx.font='9px sans-serif';ctx.textAlign='center';
  const labelStep=Math.max(1,Math.floor(labels.length/8));
  labels.forEach((l,i)=>{if(i%labelStep===0)ctx.fillText(l,pad.l+i*step,200-6);});
}

function drawBarChart(id,labels,data,color,showValues){
  const canvas=document.getElementById(id);if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const dpr=window.devicePixelRatio||1;
  const w=canvas.parentElement.clientWidth-36;
  const h=parseInt(canvas.getAttribute('height'))||160;
  canvas.width=w*dpr;canvas.height=h*dpr;canvas.style.width=w+'px';canvas.style.height=h+'px';
  ctx.scale(dpr,dpr);
  const pad={t:20,r:20,b:30,l:50};
  const cw=w-pad.l-pad.r,ch=h-pad.t-pad.b;
  const max=Math.max(...data,1)*1.15;
  const barW=Math.min(cw/data.length*0.7,40);
  const gap=cw/data.length;

  // Grid
  ctx.strokeStyle='#ECEAE6';ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
    const y=pad.t+ch-ch*(i/4);
    ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();
    ctx.fillStyle='#9C958E';ctx.font='10px sans-serif';ctx.textAlign='right';
    ctx.fillText(Math.round(max*i/4),pad.l-6,y+3);
  }

  // Bars
  data.forEach((v,i)=>{
    const x=pad.l+i*gap+(gap-barW)/2;
    const bh=ch*(v/max);
    const y=pad.t+ch-bh;
    ctx.fillStyle=color;
    ctx.beginPath();
    // Rounded top corners
    const r=Math.min(3,barW/2);
    ctx.moveTo(x,pad.t+ch);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);
    ctx.lineTo(x+barW-r,y);ctx.quadraticCurveTo(x+barW,y,x+barW,y+r);
    ctx.lineTo(x+barW,pad.t+ch);ctx.fill();

    if(showValues&&v>0){ctx.fillStyle='#FFF';ctx.font='bold 10px sans-serif';ctx.textAlign='center';ctx.fillText(Math.round(v),x+barW/2,y+14);}
  });

  // X labels
  ctx.fillStyle='#9C958E';ctx.font='9px sans-serif';ctx.textAlign='center';
  const labelStep=Math.max(1,Math.floor(labels.length/10));
  labels.forEach((l,i)=>{if(i%labelStep===0)ctx.fillText(l,pad.l+i*gap+gap/2,h-6);});
}

function drawDonutChart(id,data,colors){
  const canvas=document.getElementById(id);if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const dpr=window.devicePixelRatio||1;
  const size=200;
  canvas.width=size*dpr;canvas.height=size*dpr;canvas.style.width=size+'px';canvas.style.height=size+'px';
  ctx.scale(dpr,dpr);
  const cx=size/2,cy=size/2,r=70,inner=42;
  const total=data.reduce((a,b)=>a+b,0)||1;
  let angle=-Math.PI/2;
  data.forEach((v,i)=>{
    const sweep=v/total*Math.PI*2;
    ctx.beginPath();ctx.arc(cx,cy,r,angle,angle+sweep);ctx.arc(cx,cy,inner,angle+sweep,angle,true);ctx.closePath();
    ctx.fillStyle=colors[i]||'#999';ctx.fill();
    angle+=sweep;
  });
  // Center text
  ctx.fillStyle='#1A1816';ctx.font='bold 20px sans-serif';ctx.textAlign='center';ctx.fillText(total,cx,cy+3);
  ctx.fillStyle='#9C958E';ctx.font='10px sans-serif';ctx.fillText('Total',cx,cy+16);
}

function drawHeatmap(id,data){
  const el=document.getElementById(id);if(!el)return;
  const DAYS=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
  // Map to weekday 1-7 (Mon=1, Sun=0→7)
  const grid={};let maxV=1;
  data.forEach(d=>{
    const wd=d.weekday===0?7:d.weekday; // Sun=7
    const key=`${wd}-${d.hour}`;
    grid[key]=(grid[key]||0)+d.count;
    if(grid[key]>maxV)maxV=grid[key];
  });

  let h='<div class="hl"></div>';
  // Show hours 7-20 only
  for(let hr=7;hr<=20;hr++){h+=`<div class="hh">${hr}</div>`;}
  for(let d=1;d<=7;d++){
    h+=`<div class="hl">${DAYS[d-1]}</div>`;
    for(let hr=7;hr<=20;hr++){
      const v=grid[`${d}-${hr}`]||0;
      const intensity=v/maxV;
      const bg=v===0?'var(--surface)':`rgba(13,115,119,${0.15+intensity*0.85})`;
      h+=`<div class="hc" style="background:${bg}" title="${DAYS[d-1]} ${hr}h: ${v} RDV">${v||''}</div>`;
    }
  }
  el.style.gridTemplateColumns=`40px repeat(14,1fr)`;
  el.innerHTML=h;
}

bridge({ loadAnalytics });

export { loadAnalytics };
