(function(){
  function headerHTML(active){
    const link = (href,label,key)=>`<a href="${href}" class="${active===key?'active':''}">${label}</a>`;
    return `
    <div class="wrap">
      <a href="index.html" class="brand">
        <span class="mark">SF</span>
        <span>Salesforce Lab<span class="tag">Agentforce · Apex · Flow</span></span>
      </a>
      <nav class="main-nav">
        ${link('index.html','Home','home')}
        ${link('archive.html','Archive','archive')}
        ${link('submit.html','Contribute','submit')}
        ${link('about.html','About','about')}
      </nav>
      <a href="search.html" class="search-btn">🔍 <span>Search</span></a>
    </div>`;
  }
  function footerHTML(){
    return `
    <div class="wrap">
      <span>© ${new Date().getFullYear()} Salesforce Lab. Built with HTML, CSS, JS &amp; Supabase.</span>
      <span><a href="submit.html" style="color:inherit;margin-right:14px;">Submit an article</a><a href="admin/login.html" style="color:inherit;">Owner sign in</a></span>
    </div>`;
  }
  window.Layout = {
    mount(active){
      const h = document.getElementById('site-header');
      const f = document.getElementById('site-footer');
      if (h){ h.className='site-header'; h.innerHTML = headerHTML(active); }
      if (f){ f.className='site-footer'; f.innerHTML = footerHTML(); }
    },
    escape(str){
      return String(str||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    },
    timeAgo(ts){
      if(!ts) return "";
      const d = new Date(Number(ts) || ts);
      return d.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'});
    },
    sanitizeHTML(html){
      const template = document.createElement('template');
      template.innerHTML = html || '';
      template.content.querySelectorAll('script,style,iframe,object,embed').forEach(n=>n.remove());
      template.content.querySelectorAll('*').forEach(el=>{
        [...el.attributes].forEach(attr=>{
          if (/^on/i.test(attr.name) || /javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
        });
        if (el.tagName === 'A') {
          el.setAttribute('target','_blank');
          el.setAttribute('rel','noopener noreferrer');
        }
      });
      return template.innerHTML;
    }
  };
})();
