/* Shared data adapter: public reads + authenticated owner writes. */
(function(){
  const BACKEND_URL = "https://script.google.com/macros/s/AKfycbxtFulQfTcqqrq3RhthmppjVXueVjYst_jpAYivBaISrY_oF0RDykjdz6kYnvrEAmGjFQ/exec"; // Paste Apps Script /exec URL here.
  const SESSION_KEY = "sfblog_owner_token_v2";

  function localSlugify(s){
    return (s||"").toLowerCase().trim()
      .replace(/[^a-z0-9\s-]/g,"")
      .replace(/\s+/g,"-")
      .replace(/-+/g,"-")
      .replace(/^-|-$/g,"");
  }

  function ensureBackend(){
    if (!BACKEND_URL) throw new Error("Backend is not configured. Add your Apps Script /exec URL to assets/js/store.js.");
  }

  async function parseResponse(res){
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch(e){ throw new Error("Backend returned invalid JSON."); }
    if (!body.ok) {
      const err = new Error(body.error || "Request failed.");
      err.code = body.code || "ERROR";
      throw err;
    }
    return body.data;
  }

  async function apiGet(action, params={}){
    ensureBackend();
    const url = new URL(BACKEND_URL);
    url.searchParams.set("action", action);
    Object.keys(params).forEach(k=>{
      if (params[k] !== undefined && params[k] !== null && params[k] !== "") url.searchParams.set(k, params[k]);
    });
    return parseResponse(await fetch(url.toString(), {method:"GET", redirect:"follow"}));
  }

  async function apiPost(action, payload={}){
    ensureBackend();
    const res = await fetch(BACKEND_URL, {
      method:"POST",
      headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify({action, ...payload}),
      redirect:"follow"
    });
    return parseResponse(res);
  }

  function token(){ return sessionStorage.getItem(SESSION_KEY) || ""; }

  async function requireLogin(){
    if (!token()) { location.href = "login.html"; return false; }
    try {
      await apiGet("adminList", {token:token()});
      return true;
    } catch(e){
      sessionStorage.removeItem(SESSION_KEY);
      location.href = "login.html";
      return false;
    }
  }

  async function uploadDataUrl(dataUrl, filename){
    return apiPost("uploadImage", {token:token(), dataUrl, filename});
  }

  const Store = {
    async getPosts(opts={}){
      return apiGet("list", {
        category: opts.category,
        tag: opts.tag,
        q: opts.q,
        limit: opts.limit
      });
    },
    async getPostBySlug(slug){ return apiGet("get", {slug}); },
    async getPostById(id){
      const all = await apiGet("adminList", {token:token()});
      return all.find(p=>p.id===id) || null;
    },
    async getCategories(){ return apiGet("categories"); },
    async getTags(){ return apiGet("tags"); },
    async getArchive(){ return apiGet("archive"); },
    async getAllPosts(){ return apiGet("adminList", {token:token()}); },
    async getSubmissions(){ return apiGet("submissions", {token:token()}); },
    async savePost(post){ return apiPost("savePost", {token:token(), post}); },
    async deletePost(id){ return apiPost("deletePost", {token:token(), id}); },
    async incrementViews(slug){ return apiPost("view", {slug}); },
    async uploadImage(dataUrl, filename){ return uploadDataUrl(dataUrl, filename); },
    async submitContribution(submission){ return apiPost("submitContribution", {submission}); },
    async reviewSubmission(id, decision, notes){ return apiPost("reviewSubmission", {token:token(), id, decision, notes}); },
    slugify: localSlugify,
    auth:{
      async status(){ return apiGet("authStatus"); },
      async login(pass){
        const data = await apiPost("login", {password:pass});
        sessionStorage.setItem(SESSION_KEY, data.token);
        return true;
      },
      isLoggedIn(){ return !!token(); },
      async ensure(){ return requireLogin(); },
      logout(){ sessionStorage.removeItem(SESSION_KEY); }
    }
  };

  window.Store = Store;
})();
