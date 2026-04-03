function n(){return window._businessPlan&&window._businessPlan!=="free"}function i(e,t){e.innerHTML=`
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 24px;text-align:center">
      <div style="width:64px;height:64px;border-radius:50%;background:var(--surface);display:flex;align-items:center;justify-content:center;margin-bottom:20px">
        <svg style="width:28px;height:28px;color:var(--text-4)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>
      <h3 style="font-size:1.1rem;font-weight:600;margin-bottom:8px">${t}</h3>
      <p style="font-size:.88rem;color:var(--text-3);max-width:360px;margin-bottom:20px">Cette fonctionnalité est disponible avec le plan Pro. Débloquez l'accès pour faire passer votre salon au niveau supérieur.</p>
      <button class="btn-primary" onclick="window.location.hash='settings'" style="padding:10px 24px;font-size:.88rem">Passer au Pro</button>
    </div>`}function r(){return'<span style="font-size:.72rem;color:var(--primary);font-weight:500;margin-left:8px">Plan Pro requis</span>'}export{n as i,r as p,i as s};
