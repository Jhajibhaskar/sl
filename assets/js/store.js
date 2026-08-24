/* Shared data adapter: public reads + authenticated owner writes. */

(function () {

  const BACKEND_URL =
    "https://script.google.com/macros/s/AKfycbxtFulQfTcqqrq3RhthmppjVXueVjYst_jpAYivBaISrY_oF0RDykjdz6kYnvrEAmGjFQ/exec";

  const SESSION_KEY = "sfblog_owner_token_v2";

  function localSlugify(s) {
    return (s || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function ensureBackend() {
    if (!BACKEND_URL) {
      throw new Error(
        "Backend is not configured. Add your Apps Script /exec URL to assets/js/store.js."
      );
    }
  }

  async function parseResponse(res) {
    const text = await res.text();

    let body;

    try {
      body = JSON.parse(text);
    } catch (e) {
      console.error(
        "Salesforce Lab backend returned non-JSON:",
        text
      );

      const preview = text
        .replace(/\s+/g, " ")
        .slice(0, 500);

      throw new Error(
        "Backend returned invalid JSON (HTTP " +
          res.status +
          "). " +
          "Make sure the Apps Script Web App is deployed as /exec " +
          "with access for Anyone." +
          (preview ? " Response: " + preview : "")
      );
    }

    if (!body.ok) {
      const err = new Error(
        body.error || "Request failed."
      );

      err.code = body.code || "ERROR";

      throw err;
    }

    return body.data;
  }

  async function apiGet(action, params = {}) {
    ensureBackend();

    const url = new URL(BACKEND_URL);

    url.searchParams.set("action", action);

    Object.keys(params).forEach((key) => {
      const value = params[key];

      if (
        value !== undefined &&
        value !== null &&
        value !== ""
      ) {
        url.searchParams.set(key, value);
      }
    });

    const response = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow"
    });

    return parseResponse(response);
  }

  async function apiPost(action, payload = {}) {
    ensureBackend();

    const response = await fetch(BACKEND_URL, {
      method: "POST",

      /*
       * Keep this as text/plain.
       * It avoids the browser sending a CORS preflight
       * request to Google Apps Script.
       */
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },

      body: JSON.stringify({
        action,
        ...payload
      }),

      redirect: "follow"
    });

    return parseResponse(response);
  }

  function token() {
    return sessionStorage.getItem(SESSION_KEY) || "";
  }

  async function requireLogin() {
    if (!token()) {
      location.href = "login.html";
      return false;
    }

    try {
      await apiGet("adminList", {
        token: token()
      });

      return true;

    } catch (e) {

      console.error("Owner session validation failed:", e);

      sessionStorage.removeItem(SESSION_KEY);

      location.href = "login.html";

      return false;
    }
  }

  async function uploadDataUrl(
    dataUrl,
    filename,
    action = "uploadImage"
  ) {

    if (!dataUrl) {
      throw new Error("No file data was provided.");
    }

    if (!filename) {
      throw new Error("No filename was provided.");
    }

    const url = await apiPost(action, {
      token: token(),
      dataUrl: dataUrl,
      filename: filename
    });

    /*
     * Images and assets must come from Google Drive / Googleusercontent.
     */
    if (
      typeof url !== "string" ||
      !/^https?:\/\/(drive\.google\.com|lh3\.googleusercontent\.com)\//i.test(
        url
      )
    ) {
      console.error(
        "Unexpected upload URL returned by backend:",
        url
      );

      throw new Error(
        "Upload succeeded, but Google Drive did not return a valid file URL."
      );
    }

    return url;
  }

  const Store = {

    /* ---------------------------------------------
       PUBLIC
    --------------------------------------------- */

    async getPosts(opts = {}) {
      return apiGet("list", {
        category: opts.category,
        tag: opts.tag,
        q: opts.q,
        limit: opts.limit
      });
    },

    async getPostBySlug(slug) {
      return apiGet("get", {
        slug: slug
      });
    },

    async getCategories() {
      return apiGet("categories");
    },

    async getTags() {
      return apiGet("tags");
    },

    async getArchive() {
      return apiGet("archive");
    },

    async incrementViews(slug) {
      return apiPost("view", {
        slug: slug
      });
    },

    async submitContribution(submission) {
      return apiPost("submitContribution", {
        submission: submission
      });
    },

    /* ---------------------------------------------
       OWNER / ADMIN
    --------------------------------------------- */

    async getPostById(id) {

      const all = await apiGet("adminList", {
        token: token()
      });

      return (
        all.find((post) => post.id === id) ||
        null
      );
    },

    async getAllPosts() {
      return apiGet("adminList", {
        token: token()
      });
    },

    async getSubmissions() {
      return apiGet("submissions", {
        token: token()
      });
    },

    async savePost(post) {
      return apiPost("savePost", {
        token: token(),
        post: post
      });
    },

    async deletePost(id) {
      return apiPost("deletePost", {
        token: token(),
        id: id
      });
    },

    async reviewSubmission(
      id,
      decision,
      notes
    ) {
      return apiPost("reviewSubmission", {
        token: token(),
        id: id,
        decision: decision,
        notes: notes
      });
    },

    /* ---------------------------------------------
       FILE UPLOADS
    --------------------------------------------- */

    async uploadImage(dataUrl, filename) {
      return uploadDataUrl(
        dataUrl,
        filename,
        "uploadImage"
      );
    },

    async uploadAsset(dataUrl, filename) {
      return uploadDataUrl(
        dataUrl,
        filename,
        "uploadAsset"
      );
    },

    /* ---------------------------------------------
       UTILITIES
    --------------------------------------------- */

    slugify: localSlugify,

    /* ---------------------------------------------
       AUTH
    --------------------------------------------- */

    auth: {

      async status() {
        return apiGet("authStatus");
      },

      async login(pass) {

        const data = await apiPost("login", {
          password: pass
        });

        if (!data || !data.token) {
          throw new Error(
            "Login succeeded but no session token was returned."
          );
        }

        sessionStorage.setItem(
          SESSION_KEY,
          data.token
        );

        return true;
      },

      isLoggedIn() {
        return !!token();
      },

      async ensure() {
        return requireLogin();
      },

      logout() {
        sessionStorage.removeItem(
          SESSION_KEY
        );
      }
    }
  };

  window.Store = Store;

})();
