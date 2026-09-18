/* Salesforce Lab - Supabase data adapter
 * Public reads + anonymous contribution inserts + authenticated admin writes.
 */
(function () {
  "use strict";

  const CONFIG = window.SF_LAB_CONFIG || {};
  const SUPABASE_URL = String(CONFIG.supabaseUrl || "").trim();
  const SUPABASE_KEY = String(CONFIG.supabasePublishableKey || "").trim();
  const STORAGE_BUCKET = String(CONFIG.storageBucket || "blog-assets").trim();
  const ADMIN_LOGIN_PAGE = "login.html";

  let client = null;

  function getClient() {
    if (client) return client;

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase library is not loaded. Check the Supabase CDN script.");
    }

    if (
      !SUPABASE_URL ||
      SUPABASE_URL.includes("YOUR_PROJECT_REF") ||
      !SUPABASE_KEY ||
      SUPABASE_KEY.includes("YOUR_SUPABASE_PUBLISHABLE_KEY")
    ) {
      throw new Error("Supabase is not configured. Update assets/js/config.js with your Project URL and Publishable Key.");
    }

    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage
      }
    });

    return client;
  }

  function localSlugify(s) {
    return (s || "")
      .toString()
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function errorMessage(error, fallback) {
    if (!error) return fallback || "Request failed.";
    return String(error.message || error.error_description || error.error || fallback || "Request failed.");
  }

  function normalizeDate(value) {
    if (value === null || value === undefined || value === "") return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.getTime();
  }

  function normalizePost(row) {
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt || "",
      content: row.content || "",
      image: row.image_url || "",
      category: row.category || "",
      tags: Array.isArray(row.tags) ? row.tags : [],
      difficulty: row.difficulty || "Beginner",
      readTime: Number(row.read_time) || 5,
      author: row.author || "Owner",
      status: row.status || "draft",
      views: Number(row.views) || 0,
      publishedDate: normalizeDate(row.published_at),
      updatedDate: normalizeDate(row.updated_at),
      createdDate: normalizeDate(row.created_at)
    };
  }

  function normalizeSubmission(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name || "",
      email: row.email || "",
      title: row.title || "",
      excerpt: row.excerpt || "",
      content: row.content || "",
      image: row.image_url || "",
      category: row.category || "",
      tags: Array.isArray(row.tags) ? row.tags : [],
      difficulty: row.difficulty || "Beginner",
      readTime: Number(row.read_time) || 5,
      status: row.status || "pending",
      submittedDate: normalizeDate(row.submitted_at),
      reviewedDate: normalizeDate(row.reviewed_at),
      reviewedBy: row.reviewed_by || "",
      notes: row.notes || ""
    };
  }

  function ensureFileName(name) {
    const original = String(name || "file").trim();
    const safe = original
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 160);
    return safe || "file";
  }

  function extensionOf(name) {
    const parts = String(name || "").toLowerCase().split(".");
    return parts.length > 1 ? parts.pop() : "";
  }

  function isAllowedImage(file) {
    const allowedTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
    const ext = extensionOf(file && file.name);
    return allowedTypes.has(String(file && file.type || "").toLowerCase()) &&
      ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
  }

  function isAllowedAsset(file) {
    const ext = extensionOf(file && file.name);
    if (ext === "pdf") return String(file && file.type || "").toLowerCase() === "application/pdf" || !file.type;
    if (ext === "md") return ["text/markdown", "text/plain", "application/octet-stream", ""].includes(String(file && file.type || "").toLowerCase());
    return false;
  }

  async function uploadFile(file, folder, validator, label) {
    getClient();

    if (!(file instanceof File)) {
      throw new Error("No file was selected.");
    }

    if (!validator(file)) {
      throw new Error(label);
    }

    // Supabase recommends standard uploads for smaller files; keep the editor cap comfortably below that guidance.
    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error("Keep uploads under 5 MB.");
    }

    const safeName = ensureFileName(file.name);
    const uniqueName = `${crypto.randomUUID()}-${safeName}`;
    const path = `${folder}/${uniqueName}`;

    const { error } = await client.storage
      .from(STORAGE_BUCKET)
      .upload(path, file, {
        cacheControl: "31536000",
        contentType: file.type || undefined,
        upsert: false
      });

    if (error) throw new Error(errorMessage(error, "File upload failed."));

    const { data } = client.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(path);

    if (!data || !data.publicUrl) {
      throw new Error("Upload succeeded, but Supabase did not return a public file URL.");
    }

    return data.publicUrl;
  }

  async function requireAdmin() {
    const sb = getClient();
    const { data: { user }, error: userError } = await sb.auth.getUser();

    if (userError || !user) {
      window.location.href = ADMIN_LOGIN_PAGE;
      return false;
    }

    const { data, error } = await sb
      .from("admin_users")
      .select("role, display_name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !data) {
      await sb.auth.signOut();
      window.location.href = ADMIN_LOGIN_PAGE;
      return false;
    }

    return true;
  }

  async function getPublishedPosts() {
    const sb = getClient();
    const { data, error } = await sb
      .from("posts")
      .select("*")
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(1000);

    if (error) throw new Error(errorMessage(error, "Unable to load posts."));
    return (data || []).map(normalizePost);
  }

  const Store = {
    async getPosts(opts = {}) {
      let posts = await getPublishedPosts();

      if (opts.category) {
        const category = String(opts.category).toLowerCase();
        posts = posts.filter(p => String(p.category || "").toLowerCase() === category);
      }

      if (opts.tag) {
        const tag = String(opts.tag).toLowerCase();
        posts = posts.filter(p => (p.tags || []).some(t => String(t).toLowerCase() === tag));
      }

      if (opts.q) {
        const q = String(opts.q).trim().toLowerCase();
        posts = posts.filter(p => {
          const haystack = [p.title, p.excerpt, p.content, p.category, ...(p.tags || [])]
            .join(" ")
            .toLowerCase();
          return haystack.includes(q);
        });
      }

      const limit = Number(opts.limit) || 0;
      return limit > 0 ? posts.slice(0, limit) : posts;
    },

    async getPostBySlug(slug) {
      const sb = getClient();
      const { data, error } = await sb
        .from("posts")
        .select("*")
        .eq("slug", String(slug || ""))
        .eq("status", "published")
        .maybeSingle();

      if (error) throw new Error(errorMessage(error, "Unable to load article."));
      return normalizePost(data);
    },

    async getPostById(id) {
      await requireAdmin();
      const sb = getClient();
      const { data, error } = await sb
        .from("posts")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) throw new Error(errorMessage(error, "Unable to load post."));
      return normalizePost(data);
    },

    async getCategories() {
      const posts = await getPublishedPosts();
      const counts = {};
      posts.forEach(p => {
        if (p.category) counts[p.category] = (counts[p.category] || 0) + 1;
      });
      return Object.keys(counts)
        .sort((a, b) => a.localeCompare(b))
        .map(name => ({ name, count: counts[name] }));
    },

    async getTags() {
      const posts = await getPublishedPosts();
      const set = new Set();
      posts.forEach(p => (p.tags || []).forEach(t => set.add(t)));
      return [...set].sort((a, b) => a.localeCompare(b));
    },

    async getArchive() {
      const posts = await getPublishedPosts();
      const map = {};
      posts.forEach(p => {
        if (!p.publishedDate) return;
        const d = new Date(Number(p.publishedDate));
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        map[key] = (map[key] || 0) + 1;
      });
      return Object.keys(map).sort().reverse().map(k => [k, map[k]]);
    },

    async getAllPosts() {
      await requireAdmin();
      const sb = getClient();
      const { data, error } = await sb
        .from("posts")
        .select("*")
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(1000);

      if (error) throw new Error(errorMessage(error, "Unable to load posts."));
      return (data || []).map(normalizePost);
    },

    async getSubmissions() {
      await requireAdmin();
      const sb = getClient();
      const { data, error } = await sb
        .from("submissions")
        .select("*")
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .limit(1000);

      if (error) throw new Error(errorMessage(error, "Unable to load submissions."));
      return (data || []).map(normalizeSubmission);
    },

    async savePost(post) {
      await requireAdmin();
      const sb = getClient();
      const now = new Date().toISOString();
      const id = post.id || crypto.randomUUID();

      const { data: existing, error: existingError } = await sb
        .from("posts")
        .select("id, views, published_at, status")
        .eq("id", id)
        .maybeSingle();

      if (existingError) throw new Error(errorMessage(existingError, "Unable to read existing post."));

      let slug = localSlugify(post.slug || post.title || "post") || "post";
      const { data: slugMatches, error: slugError } = await sb
        .from("posts")
        .select("id, slug")
        .ilike("slug", `${slug}%`)
        .limit(1000);

      if (slugError) throw new Error(errorMessage(slugError, "Unable to validate the post slug."));

      const taken = new Set((slugMatches || []).filter(r => r.id !== id).map(r => String(r.slug).toLowerCase()));
      const base = slug;
      let suffix = 2;
      while (taken.has(slug.toLowerCase())) slug = `${base}-${suffix++}`;

      let publishedAt = existing ? existing.published_at : null;
      if (post.status === "published" && !publishedAt) publishedAt = now;

      const payload = {
        id,
        slug,
        title: String(post.title || "").trim(),
        excerpt: String(post.excerpt || "").trim(),
        content: String(post.content || ""),
        image_url: String(post.image || "").trim(),
        category: String(post.category || "Other"),
        tags: Array.isArray(post.tags) ? post.tags.slice(0, 30).map(v => String(v).trim()).filter(Boolean) : [],
        difficulty: ["Beginner", "Intermediate", "Advanced"].includes(post.difficulty) ? post.difficulty : "Beginner",
        read_time: Math.max(1, Number.parseInt(post.readTime, 10) || 5),
        author: String(post.author || "Owner").trim() || "Owner",
        status: post.status === "published" ? "published" : "draft",
        views: existing ? Number(existing.views) || 0 : 0,
        published_at: publishedAt,
        updated_at: now
      };

      if (!payload.title) throw new Error("Post title is required.");

      const { data, error } = await sb
        .from("posts")
        .upsert(payload, { onConflict: "id" })
        .select("*")
        .single();

      if (error) throw new Error(errorMessage(error, "Could not save the post."));
      return normalizePost(data);
    },

    async deletePost(id) {
      await requireAdmin();
      const sb = getClient();
      const { error } = await sb.from("posts").delete().eq("id", id);
      if (error) throw new Error(errorMessage(error, "Could not delete the post."));
      return { id };
    },

    async incrementViews(slug) {
      const sb = getClient();
      const { data, error } = await sb.rpc("increment_post_views", {
        p_slug: String(slug || "")
      });
      if (error) throw new Error(errorMessage(error, "Could not update views."));
      return data || { views: 0 };
    },

    async uploadImage(file) {
      return uploadFile(
        file,
        "images",
        isAllowedImage,
        "Only PNG, JPG, GIF and WebP images are supported."
      );
    },

    async uploadAsset(file) {
      return uploadFile(
        file,
        "attachments",
        isAllowedAsset,
        "Only PDF and Markdown (.md) files are supported."
      );
    },

    async submitContribution(submission) {
      const sb = getClient();
      const name = String(submission.name || "").trim();
      const email = String(submission.email || "").trim();
      const title = String(submission.title || "").trim();
      const content = String(submission.content || "").trim();

      if (!name || !title || !content) {
        throw new Error("Name, title and article content are required.");
      }
      if (name.length > 100 || title.length > 220 || email.length > 180) {
        throw new Error("Submission is too long.");
      }
      if (content.length > 800000) {
        throw new Error("Article is too large.");
      }

      const payload = {
        name,
        email,
        title,
        excerpt: String(submission.excerpt || "").slice(0, 500),
        content,
        image_url: String(submission.image || "").slice(0, 2000),
        category: String(submission.category || "Other"),
        tags: Array.isArray(submission.tags) ? submission.tags.slice(0, 30).map(String) : [],
        difficulty: ["Beginner", "Intermediate", "Advanced"].includes(submission.difficulty) ? submission.difficulty : "Beginner",
        read_time: Math.max(1, Number.parseInt(submission.readTime, 10) || 5),
        status: "pending"
      };

      const { error } = await sb
        .from("submissions")
        .insert(payload);

      if (error) throw new Error(errorMessage(error, "Could not submit the article."));
      return { status: "pending" };
    },

    async reviewSubmission(id, decision, notes) {
      await requireAdmin();
      const sb = getClient();
      const { data, error } = await sb.rpc("review_submission", {
        p_submission_id: id,
        p_decision: String(decision || ""),
        p_notes: String(notes || "")
      });

      if (error) throw new Error(errorMessage(error, "Could not review the submission."));
      return data || {};
    },

    slugify: localSlugify,

    auth: {
      async status() {
        const sb = getClient();
        const { data: { user } } = await sb.auth.getUser();

        if (!user) {
          return { configured: true, loggedIn: false, isAdmin: false };
        }

        const { data, error } = await sb
          .from("admin_users")
          .select("role, display_name")
          .eq("user_id", user.id)
          .maybeSingle();

        return {
          configured: true,
          loggedIn: true,
          isAdmin: !error && !!data,
          role: data ? data.role : null,
          displayName: data ? data.display_name : (user.email || "Owner"),
          email: user.email || ""
        };
      },

      async login(email, password) {
        const sb = getClient();
        const { data, error } = await sb.auth.signInWithPassword({
          email: String(email || "").trim(),
          password: String(password || "")
        });

        if (error) throw new Error(errorMessage(error, "Sign in failed."));
        if (!data.user) throw new Error("Sign in succeeded but no user session was returned.");

        const { data: admin, error: adminError } = await sb
          .from("admin_users")
          .select("role, display_name")
          .eq("user_id", data.user.id)
          .maybeSingle();

        if (adminError || !admin) {
          await sb.auth.signOut();
          throw new Error("This account is not approved for the Salesforce Lab admin panel.");
        }

        return true;
      },

      isLoggedIn() {
        return !!localStorage.getItem("sb-" + this._projectRef() + "-auth-token");
      },

      async ensure() {
        return requireAdmin();
      },

      async logout() {
        const sb = getClient();
        await sb.auth.signOut();
      },

      _projectRef() {
        try {
          return new URL(SUPABASE_URL).hostname.split(".")[0];
        } catch (e) {
          return "project";
        }
      }
    }
  };

  window.Store = Store;
})();
