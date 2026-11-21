/* =====================================================================
   auth.js - who is signed in, and who may open which page.

   ROUTE GUARDS: every page declares a rule on <body data-guard="...">:
     (none)     public page, anyone may open it (store home, reset password)
     "guest"    only for signed-OUT visitors (sign in, sign up)
     "customer" must be signed in as a customer (orders, checkout, bill)
     "admin"    must be signed in as ADMIN_EMAIL (everything in /admin)
   Guarded pages stay invisible (see base.css) until the guard says OK,
   so a visitor never sees a flash of a page they may not open.

   IMPORTANT: this protects the SCREENS. The DATA is protected by
   Firestore security rules (Phase 7), because anyone can edit
   localStorage or call the API directly.

   FLASH MESSAGES: a message saved in sessionStorage just before a
   redirect, and shown as a toast on the next page
   (e.g. "Welcome back!" after signing in).
   ===================================================================== */

const Auth = (function () {
  const FLASH_KEY = 'shopnest.flash';

  /** Path prefix to the site root: "" or "../" (from <body data-root>). */
  function root() {
    return document.body.dataset.root || '';
  }

  /* ------------------------------------------------------------------
     Current user
     ------------------------------------------------------------------ */

  /** The signed-in user from localStorage, or null. */
  function currentUser() {
    const session = Api.session.get();
    return session && session.idToken && session.email ? session : null;
  }

  /** E-mail addresses are compared in lower case: "A@x.com" equals "a@x.com". */
  function isAdmin(user = currentUser()) {
    return Boolean(user) && user.email.toLowerCase() === CONFIG.ADMIN_EMAIL.toLowerCase();
  }

  /** Where a user lands after signing in. */
  function homeFor(user) {
    return isAdmin(user) ? 'admin/dashboard.html' : 'index.html';
  }

  /* ------------------------------------------------------------------
     Navigation helpers
     ------------------------------------------------------------------ */

  /** Go to a page given relative to the site root. replace() keeps guarded pages out of the Back history. */
  function go(path) {
    window.location.replace(root() + path);
  }

  /** This page's path relative to the site root, e.g. "admin/dashboard.html" or "orders.html?x=1". */
  function currentPath() {
    const parts = window.location.pathname.split('/');
    const file = parts.pop() || 'index.html';
    const folder = root() ? parts.pop() + '/' : '';
    return folder + file + window.location.search;
  }

  /**
   * Only allow redirects to our OWN pages, like "orders.html" or "admin/inventory.html".
   * Anything else (e.g. "https://evil.example") is ignored. This prevents an
   * "open redirect", where a link sends people from our login page to a fake site.
   */
  function safeRedirect(target) {
    if (!target) return null;
    return /^[a-z0-9_-]+(\/[a-z0-9_-]+)?\.html([?#][^:]*)?$/i.test(target) ? target : null;
  }

  /* ------------------------------------------------------------------
     Flash messages
     ------------------------------------------------------------------ */

  function setFlash(message, type = 'success', title) {
    sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message, type, title }));
  }

  function showFlash() {
    const raw = sessionStorage.getItem(FLASH_KEY);
    if (!raw) return;
    sessionStorage.removeItem(FLASH_KEY);
    try {
      const flash = JSON.parse(raw);
      Ui.toast(flash.message, flash.type, { title: flash.title });
    } catch (error) {
      // A broken flash message is simply skipped.
    }
  }

  /* ------------------------------------------------------------------
     Sign in / sign out
     ------------------------------------------------------------------ */

  /**
   * Runs after a successful sign-in. For customers it makes sure the
   * customers/{uid} profile exists ("self-healing": if sign-up created the
   * Auth user but the profile failed, we create the profile now).
   * The customer's name is stored in the session for the header.
   */
  async function finishSignIn(user) {
    if (isAdmin(user)) {
      return Api.session.save({ name: 'Admin' });
    }
    try {
      const profile = await Api.getCustomer(user.uid);
      return Api.session.save({ name: profile.name });
    } catch (error) {
      if (error.code !== 'NOT_FOUND') throw error;
      const name = user.email.split('@')[0];
      await Api.createCustomerProfile({ uid: user.uid, name, email: user.email, mobile: '' });
      return Api.session.save({ name });
    }
  }

  function signOut(message = 'You have been signed out. See you soon!') {
    Api.session.clear();
    setFlash(message, 'info', 'Signed out');
    go('index.html');
  }

  /* ------------------------------------------------------------------
     Guards
     ------------------------------------------------------------------ */

  function sendToLogin(message) {
    setFlash(message, 'info', 'Please sign in');
    go('login.html?redirect=' + encodeURIComponent(currentPath()));
  }

  /**
   * Asks Firebase (not localStorage) who this token belongs to.
   * If the token was revoked (e.g. the password was reset) or belongs
   * to someone else, the session is cleared and the admin must sign in again.
   */
  async function verifyAdminWithServer() {
    try {
      const account = await Api.lookupAccount();
      if (!account || !isAdmin({ email: account.email })) {
        throw new Api.ApiError('Not the admin', { code: 'NOT_ADMIN' });
      }
    } catch (error) {
      if (error.code === 'NETWORK' || error.code === 'TIMEOUT') {
        Ui.showError(error, 'Could not confirm your session');
        return;
      }
      Api.session.clear();
      sendToLogin('Your admin session has expired. Please sign in again.');
    }
  }

  /** Applies the page's data-guard rule. Returns false if we are redirecting. */
  function runGuard() {
    const rule = document.body.dataset.guard;
    const user = currentUser();

    if (rule === 'guest' && user) {
      go(homeFor(user));
      return false;
    }

    if (rule === 'customer') {
      if (!user) {
        sendToLogin('Sign in to see this page.');
        return false;
      }
      if (isAdmin(user)) {
        setFlash('The admin account cannot shop. Sign in with a customer account to place orders.', 'info', 'Admin account');
        go('admin/dashboard.html');
        return false;
      }
    }

    if (rule === 'admin') {
      if (!user) {
        sendToLogin('The admin area needs you to sign in first.');
        return false;
      }
      if (!isAdmin(user)) {
        setFlash('That page is only for the store admin.', 'warning', 'Access denied');
        go('index.html');
        return false;
      }
      verifyAdminWithServer(); // runs in the background
    }

    document.body.classList.add('auth-ok'); // reveal the page
    return true;
  }

  /**
   * If a signed-in user's idToken has expired, refresh it now. If the
   * refresh token was rejected (e.g. after a password reset), api.js
   * clears the session; we then tell the user and reload as a guest.
   */
  function refreshSessionIfNeeded() {
    if (!currentUser()) return;
    Api.getIdToken().catch(() => {
      if (!Api.session.get()) {
        setFlash('Your session has expired. Please sign in again.', 'info', 'Signed out');
        window.location.reload();
      }
    });
  }

  // The guard runs IMMEDIATELY (this script is at the end of <body>, so
  // document.body already exists), before the page is shown.
  const allowed = runGuard();

  $(function () {
    if (!allowed) return;
    showFlash();
    refreshSessionIfNeeded();
  });

  // Every "Sign out" button on any page.
  $(document).on('click', '[data-action="sign-out"]', (event) => {
    event.preventDefault();
    signOut();
  });

  return {
    currentUser,
    isAdmin,
    homeFor,
    safeRedirect,
    setFlash,
    finishSignIn,
    signOut,
    go
  };
})();
