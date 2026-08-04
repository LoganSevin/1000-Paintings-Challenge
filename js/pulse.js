(function () {
  const USERNAME_KEY = "pulse_username";
  const SESSION_KEY = "pulse_session_token";
  const USER_KEY = "pulse_user";
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

  const els = {
    auth: document.getElementById("pulse-auth"),
    authSignedOut: document.getElementById("pulse-auth-signed-out"),
    authSignedIn: document.getElementById("pulse-auth-signed-in"),
    googleSignin: document.getElementById("pulse-google-signin"),
    authAvatar: document.getElementById("pulse-auth-avatar"),
    authName: document.getElementById("pulse-auth-name"),
    authEmail: document.getElementById("pulse-auth-email"),
    signOut: document.getElementById("pulse-sign-out"),
    setupNote: document.getElementById("pulse-setup-note"),
    usernameField: document.getElementById("pulse-username-field"),
    username: document.getElementById("pulse-username"),
    text: document.getElementById("pulse-text"),
    painting: document.getElementById("pulse-painting"),
    file: document.getElementById("pulse-image-file"),
    attach: document.getElementById("pulse-attach-btn"),
    preview: document.getElementById("pulse-image-preview"),
    previewImg: document.getElementById("pulse-preview-img"),
    previewClear: document.getElementById("pulse-preview-clear"),
    postBtn: document.getElementById("pulse-post-btn"),
    status: document.getElementById("pulse-compose-status"),
    feed: document.getElementById("pulse-feed"),
    refresh: document.getElementById("pulse-refresh-btn"),
    compose: document.getElementById("pulse-compose-form"),
  };

  let pendingImageB64 = null;
  let pulseConfig = { google_enabled: false, client_id: "" };
  let googleReady = false;

  function getSessionToken() {
    return (localStorage.getItem(SESSION_KEY) || "").trim();
  }

  function getStoredUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "null");
    } catch (_err) {
      return null;
    }
  }

  function saveSession(sessionToken, user) {
    if (sessionToken) localStorage.setItem(SESSION_KEY, sessionToken);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function getUsername() {
    if (pulseConfig.google_enabled) {
      const user = getStoredUser();
      return user && user.name ? user.name : "";
    }
    return (localStorage.getItem(USERNAME_KEY) || "").trim();
  }

  function getActorKey() {
    if (pulseConfig.google_enabled) {
      const user = getStoredUser();
      if (user && user.sub) return "sub:" + user.sub;
      return "";
    }
    const name = getUsername();
    return name ? "name:" + name : "";
  }

  function saveUsername(name) {
    localStorage.setItem(USERNAME_KEY, name.trim());
  }

  function setStatus(msg, isError) {
    if (!els.status) return;
    els.status.textContent = msg || "";
    els.status.classList.toggle("error", !!isError);
  }

  function relativeTime(iso) {
    if (!iso) return "";
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "";
    const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return min + "m ago";
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + "h ago";
    const day = Math.floor(hr / 24);
    if (day < 7) return day + "d ago";
    return new Date(iso).toLocaleDateString();
  }

  function avatarLetter(name) {
    const ch = (name || "?").trim().charAt(0);
    return ch ? ch.toUpperCase() : "?";
  }

  function clearPreview() {
    pendingImageB64 = null;
    if (els.file) els.file.value = "";
    if (els.preview) els.preview.hidden = true;
    if (els.previewImg) els.previewImg.removeAttribute("src");
  }

  function readFileAsB64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error("Could not read image"));
      };
      reader.readAsDataURL(file);
    });
  }

  function authPayload(extra) {
    const payload = Object.assign({}, extra || {});
    if (pulseConfig.google_enabled) {
      const token = getSessionToken();
      if (token) payload.session_token = token;
    } else if (els.username) {
      payload.username = (els.username.value || getUsername()).trim();
    }
    return payload;
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authPayload(body)),
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || "Request failed");
    }
    return data;
  }

  function updateAuthUI() {
    const googleOn = !!pulseConfig.google_enabled;
    const user = getStoredUser();
    const signedIn = googleOn && !!getSessionToken() && !!user;

    if (els.setupNote) els.setupNote.hidden = googleOn;
    if (els.usernameField) els.usernameField.hidden = googleOn;
    if (els.authSignedOut) els.authSignedOut.hidden = !googleOn || signedIn;
    if (els.authSignedIn) els.authSignedIn.hidden = !signedIn;
    if (els.compose) els.compose.hidden = googleOn && !signedIn;

    if (signedIn && els.authName) els.authName.textContent = user.name || "Signed in";
    if (signedIn && els.authEmail) els.authEmail.textContent = user.email || "";
    if (signedIn && els.authAvatar) {
      if (user.picture) {
        els.authAvatar.innerHTML =
          '<img src="' + escapeAttr(user.picture) + '" alt="" referrerpolicy="no-referrer" />';
      } else {
        els.authAvatar.textContent = avatarLetter(user.name);
      }
    }

    if (googleOn && !googleReady) {
      initGoogleSignIn();
    }
  }

  function renderAvatar(post) {
    if (post.user_picture) {
      return (
        '<div class="pulse-avatar pulse-avatar-img">' +
        '<img src="' +
        escapeAttr(post.user_picture) +
        '" alt="" loading="lazy" referrerpolicy="no-referrer" />' +
        "</div>"
      );
    }
    return (
      '<div class="pulse-avatar" aria-hidden="true">' +
      escapeHtml(avatarLetter(post.username)) +
      "</div>"
    );
  }

  function renderPost(post) {
    const actorKey = getActorKey();
    const liked = actorKey && (post.likes || []).indexOf(actorKey) >= 0;
    const likeCount = (post.likes || []).length;
    const commentCount = (post.comments || []).length;
    const user = getStoredUser();
    const isOwner =
      (user && post.user_sub && post.user_sub === user.sub) ||
      (!post.user_sub && getUsername() && post.username === getUsername());

    const card = document.createElement("article");
    card.className = "pulse-card";
    card.dataset.postId = post.id;

    let imageHtml = "";
    if (post.image_url) {
      imageHtml =
        '<div class="pulse-card-image"><img src="' +
        escapeAttr(post.image_url) +
        '" alt="" loading="lazy" /></div>';
    }

    let paintingHtml = "";
    if (post.painting_number) {
      paintingHtml =
        '<a class="pulse-card-painting-ref" href="paintings/' +
        post.painting_number +
        '.jpg" target="_blank" rel="noopener">Painting #' +
        post.painting_number +
        "</a>";
    }

    const comments = (post.comments || [])
      .map(function (c) {
        return (
          '<div class="pulse-comment"><span class="pulse-comment-user">' +
          escapeHtml(c.username) +
          '</span><span class="pulse-comment-text">' +
          escapeHtml(c.text) +
          "</span></div>"
        );
      })
      .join("");

    card.innerHTML =
      '<div class="pulse-card-header">' +
      renderAvatar(post) +
      '<div class="pulse-card-meta">' +
      '<p class="pulse-card-user">' +
      escapeHtml(post.username) +
      "</p>" +
      '<p class="pulse-card-time">' +
      escapeHtml(relativeTime(post.created_at)) +
      "</p>" +
      "</div>" +
      (isOwner
        ? '<button type="button" class="pulse-card-delete" data-action="delete">Delete</button>'
        : "") +
      "</div>" +
      '<div class="pulse-card-body">' +
      '<p class="pulse-card-text">' +
      escapeHtml(post.text) +
      "</p>" +
      imageHtml +
      paintingHtml +
      "</div>" +
      '<div class="pulse-card-actions">' +
      '<button type="button" class="pulse-action-btn' +
      (liked ? " liked" : "") +
      '" data-action="like" aria-pressed="' +
      liked +
      '">♥ <span data-like-count>' +
      likeCount +
      "</span></button>" +
      '<button type="button" class="pulse-action-btn" data-action="toggle-comments">💬 ' +
      commentCount +
      "</button>" +
      "</div>" +
      '<div class="pulse-comments" hidden>' +
      comments +
      '<form class="pulse-comment-form" data-action="comment">' +
      '<input type="text" placeholder="Add a comment…" maxlength="500" aria-label="Comment" />' +
      "<button type=\"submit\">Reply</button>" +
      "</form>" +
      "</div>";

    return card;
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, "&#39;");
  }

  function renderFeed(posts) {
    if (!els.feed) return;
    els.feed.innerHTML = "";
    if (!posts || !posts.length) {
      els.feed.innerHTML =
        '<div class="pulse-empty">' +
        "<h3>No posts yet</h3>" +
        "<p>Sign in and share a painting, a WIP, or a thought — be the first voice on the feed.</p>" +
        "</div>";
      return;
    }
    posts.forEach(function (post) {
      els.feed.appendChild(renderPost(post));
    });
  }

  async function loadFeed() {
    try {
      const res = await fetch("/api/pulse/feed");
      const data = await res.json();
      renderFeed(data.posts || []);
    } catch (_err) {
      if (els.feed) {
        els.feed.innerHTML =
          '<div class="pulse-empty"><p>Could not load feed. Is the gallery server running?</p></div>';
      }
    }
  }

  function requireSignedIn() {
    if (!pulseConfig.google_enabled) return true;
    if (getSessionToken() && getStoredUser()) return true;
    setStatus("Sign in with Google to continue.", true);
    return false;
  }

  async function submitPost() {
    if (!requireSignedIn()) return;

    const username = (els.username && els.username.value.trim()) || getUsername();
    const text = (els.text && els.text.value.trim()) || "";
    const paintingRaw = els.painting && els.painting.value.trim();
    const paintingNumber = paintingRaw ? parseInt(paintingRaw, 10) : null;

    if (!pulseConfig.google_enabled && !username) {
      setStatus("Pick a display name first.", true);
      els.username && els.username.focus();
      return;
    }
    if (!text && !pendingImageB64 && !paintingNumber) {
      setStatus("Write something, attach an image, or link a painting #.", true);
      return;
    }

    if (!pulseConfig.google_enabled) saveUsername(username);
    els.postBtn.disabled = true;
    setStatus("Posting…");

    try {
      await api("/api/pulse/posts", {
        text: text,
        image_base64: pendingImageB64,
        painting_number: paintingNumber || undefined,
      });
      if (els.text) els.text.value = "";
      if (els.painting) els.painting.value = "";
      clearPreview();
      setStatus("Posted!");
      await loadFeed();
    } catch (err) {
      setStatus(err.message || "Post failed", true);
    } finally {
      els.postBtn.disabled = false;
    }
  }

  async function handleCardClick(ev) {
    const btn = ev.target.closest("[data-action]");
    if (!btn) return;
    const card = ev.target.closest(".pulse-card");
    if (!card) return;
    const postId = card.dataset.postId;
    const action = btn.dataset.action;

    if (action === "toggle-comments") {
      const panel = card.querySelector(".pulse-comments");
      if (panel) panel.hidden = !panel.hidden;
      return;
    }

    if (!requireSignedIn()) return;

    if (action === "like") {
      try {
        const data = await api("/api/pulse/posts/like", { post_id: postId });
        const countEl = card.querySelector("[data-like-count]");
        const likeBtn = card.querySelector('[data-action="like"]');
        if (countEl) countEl.textContent = String(data.like_count || 0);
        if (likeBtn) {
          likeBtn.classList.toggle("liked", !!data.liked);
          likeBtn.setAttribute("aria-pressed", data.liked ? "true" : "false");
        }
      } catch (err) {
        setStatus(err.message, true);
      }
      return;
    }

    if (action === "delete") {
      if (!confirm("Delete this post?")) return;
      try {
        await api("/api/pulse/posts/delete", { post_id: postId });
        card.remove();
        if (!els.feed.querySelector(".pulse-card")) {
          renderFeed([]);
        }
      } catch (err) {
        setStatus(err.message, true);
      }
    }
  }

  async function handleCommentSubmit(ev) {
    ev.preventDefault();
    if (!requireSignedIn()) return;
    const form = ev.target;
    const card = form.closest(".pulse-card");
    if (!card) return;
    const input = form.querySelector("input");
    const text = input && input.value.trim();
    if (!text) return;

    try {
      const data = await api("/api/pulse/posts/comment", {
        post_id: card.dataset.postId,
        text: text,
      });
      const panel = card.querySelector(".pulse-comments");
      const commentEl = document.createElement("div");
      commentEl.className = "pulse-comment";
      commentEl.innerHTML =
        '<span class="pulse-comment-user">' +
        escapeHtml(data.comment.username) +
        '</span><span class="pulse-comment-text">' +
        escapeHtml(data.comment.text) +
        "</span>";
      form.parentNode.insertBefore(commentEl, form);
      input.value = "";
      const commentBtn = card.querySelector('[data-action="toggle-comments"]');
      if (commentBtn) {
        commentBtn.textContent = "💬 " + (data.comment_count || 0);
      }
    } catch (err) {
      setStatus(err.message, true);
    }
  }

  async function handleGoogleCredential(response) {
    setStatus("Signing in…");
    try {
      const res = await fetch("/api/pulse/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: response.credential }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Sign-in failed");
      }
      saveSession(data.session_token, data.user);
      updateAuthUI();
      setStatus("Signed in as " + (data.user.name || "user") + ".");
      await loadFeed();
    } catch (err) {
      setStatus(err.message || "Sign-in failed", true);
    }
  }

  function initGoogleSignIn() {
    if (!pulseConfig.google_enabled || !pulseConfig.client_id || googleReady) return;
    if (!window.google || !google.accounts || !google.accounts.id) return;
    if (!els.googleSignin) return;
    google.accounts.id.initialize({
      client_id: pulseConfig.client_id,
      callback: handleGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    els.googleSignin.innerHTML = "";
    google.accounts.id.renderButton(els.googleSignin, {
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "signin_with",
      width: 280,
    });
    googleReady = true;
  }

  async function signOut() {
    try {
      await api("/api/pulse/auth/logout", {});
    } catch (_err) {
      /* still clear local session */
    }
    clearSession();
    googleReady = false;
    updateAuthUI();
    setStatus("Signed out.");
  }

  async function loadConfig() {
    try {
      const res = await fetch("/api/pulse/config");
      const data = await res.json();
      pulseConfig = {
        google_enabled: !!data.google_enabled,
        client_id: data.client_id || "",
      };
    } catch (_err) {
      pulseConfig = { google_enabled: false, client_id: "" };
    }
    updateAuthUI();
  }

  function initCompose() {
    const saved = getUsername();
    if (saved && els.username) els.username.value = saved;

    if (els.username) {
      els.username.addEventListener("change", function () {
        saveUsername(els.username.value);
      });
    }

    if (els.attach && els.file) {
      els.attach.addEventListener("click", function () {
        els.file.click();
      });
    }

    if (els.file) {
      els.file.addEventListener("change", async function () {
        const file = els.file.files && els.file.files[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) {
          setStatus("Please choose an image file.", true);
          els.file.value = "";
          return;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          setStatus("Image must be under 2 MB.", true);
          els.file.value = "";
          return;
        }
        try {
          pendingImageB64 = await readFileAsB64(file);
          if (els.previewImg) els.previewImg.src = pendingImageB64;
          if (els.preview) els.preview.hidden = false;
          setStatus("");
        } catch (err) {
          setStatus(err.message, true);
          clearPreview();
        }
      });
    }

    if (els.previewClear) {
      els.previewClear.addEventListener("click", clearPreview);
    }

    if (els.postBtn) {
      els.postBtn.addEventListener("click", submitPost);
    }

    if (els.refresh) {
      els.refresh.addEventListener("click", loadFeed);
    }

    if (els.signOut) {
      els.signOut.addEventListener("click", signOut);
    }
  }

  function onShow() {
    if (els.username && !els.username.value) {
      els.username.value = getUsername();
    }
    loadConfig().then(loadFeed);
    initGoogleSignIn();
  }

  if (els.feed) {
    els.feed.addEventListener("click", handleCardClick);
    els.feed.addEventListener("submit", handleCommentSubmit);
  }

  initCompose();
  loadConfig();

  window.Pulse = { onShow: onShow };
  window.addEventListener("pulse-show", onShow);
  window.addEventListener("load", function () {
    initGoogleSignIn();
  });
  window.dispatchEvent(new Event("pulse-ready"));
})();