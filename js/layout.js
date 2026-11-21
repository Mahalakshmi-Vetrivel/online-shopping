/* =====================================================================
   layout.js - builds the parts that repeat on every page, so they are
   written ONCE instead of being copied into every HTML file:
     - store pages : announcement bar, header (logo, search, account,
                     orders, cart), category bar, mobile menu, footer
     - admin pages : sidebar + top bar
   Each page tells us what it needs through data- attributes on <body>:
     data-layout="store" | "admin" | "auth"
     data-page="home"            -> which link is highlighted
     data-root="../"             -> path back to the site root (admin pages live in /admin)
     data-title="Dashboard"      -> admin top bar title
   ===================================================================== */

const Layout = (function () {
  let logoCounter = 0;

  /** Path prefix to the site root: "" for root pages, "../" for /admin pages. */
  function root() {
    return document.body.dataset.root || '';
  }

  /** The ShopNest logo: a shopping bag holding a little nest and an egg. */
  function logoSvg() {
    // Each logo needs its own gradient id, because ids must be unique on a page.
    const gradientId = 'logo-gradient-' + (++logoCounter);
    return `
      <svg class="logo-mark" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1">
            <stop class="logo-stop-a" offset="0"></stop>
            <stop class="logo-stop-b" offset="0.55"></stop>
            <stop class="logo-stop-c" offset="1"></stop>
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="12" fill="url(#${gradientId})"></rect>
        <path class="logo-handle" d="M14.5 15.5v-1.5a5.5 5.5 0 0 1 11 0v1.5" fill="none" stroke-width="2.4" stroke-linecap="round"></path>
        <path class="logo-bag" d="M9.5 16h21l-1.9 13.1a3 3 0 0 1-3 2.6H14.4a3 3 0 0 1-3-2.6z"></path>
        <ellipse class="logo-egg" cx="20" cy="21.6" rx="2.1" ry="2.5"></ellipse>
        <path class="logo-weave" d="M13.5 23c4.2 2.6 8.8 2.6 13 0M14.8 27c3.4 2 7 2 10.4 0" fill="none" stroke-width="1.8" stroke-linecap="round"></path>
      </svg>`;
  }

  function logo(extraClass = '') {
    return `
      <a class="logo ${extraClass}" href="${root()}index.html" aria-label="${CONFIG.SHOP_NAME} home">
        ${logoSvg()}
        <span class="logo-text" aria-hidden="true">Shop<span>Nest</span></span>
      </a>`;
  }

  /** aria-current="page" for the link of the current page. */
  function current(page) {
    return document.body.dataset.page === page ? 'aria-current="page"' : '';
  }

  /** First letter of the e-mail, for the round avatar. */
  function avatarLetter(email) {
    return Ui.escapeHtml((email || '?').charAt(0));
  }

  /** Friendly first name from the session (name, or the part of the e-mail before @). */
  function displayName(user) {
    return user.name || user.email.split('@')[0];
  }

  /* ------------------------------------------------------------------
     Store: announcement bar, header, category bar, footer
     ------------------------------------------------------------------ */

  function announcementHtml() {
    return `
      <div class="announcement">
        <div class="container announcement__inner">
          <p>${Icons.svg('sparkles', 16)} New here? Get <strong>${Ui.formatMoney(CONFIG.DEFAULT_CREDIT_LIMIT)} ShopNest credit</strong> the moment you sign up.</p>
          <a class="announcement__link" href="${root()}signup.html">Join free ${Icons.svg('arrowRight', 14)}</a>
        </div>
      </div>`;
  }

  function accountActionHtml(user) {
    const r = root();
    if (!user) {
      return `
        <a class="header-action" href="${r}login.html">
          ${Icons.svg('user', 22)}
          <span class="header-action__text"><small>Hello, sign in</small><strong>Account</strong></span>
        </a>`;
    }
    const isAdmin = Auth.isAdmin(user);
    return `
      ${isAdmin ? `
        <a class="header-action" href="${r}admin/dashboard.html">
          ${Icons.svg('dashboard', 22)}
          <span class="header-action__text"><small>Manage</small><strong>Admin</strong></span>
        </a>` : ''}
      <span class="header-action header-action--static" title="${Ui.escapeHtml(user.email)}">
        <span class="avatar" aria-hidden="true">${avatarLetter(user.email)}</span>
        <span class="header-action__text"><small>Hello,</small><strong class="account-name">${Ui.escapeHtml(displayName(user))}</strong></span>
      </span>
      <button type="button" class="btn btn-ghost btn-icon" data-action="sign-out" aria-label="Sign out">${Icons.svg('logout', 20)}</button>`;
  }

  function storeHeaderHtml() {
    const r = root();
    const user = Auth.currentUser();
    const query = Ui.getQueryParam('q') || '';
    return `
      <div class="container header-main">
        <button type="button" class="btn btn-ghost btn-icon menu-toggle" id="menu-toggle"
                aria-controls="site-nav" aria-expanded="false" aria-label="Open menu">
          ${Icons.svg('menu', 22)}
        </button>

        ${logo()}

        <form class="header-search" role="search" action="${r}index.html" method="get">
          <label class="visually-hidden" for="header-search-input">Search products</label>
          ${Icons.svg('search', 20)}
          <input class="header-search__input" id="header-search-input" type="search" name="q"
                 value="${Ui.escapeHtml(query)}" placeholder="Search earbuds, kurtis, filter coffee..." autocomplete="off">
          <button class="btn btn-primary btn-sm header-search__button" type="submit">Search</button>
        </form>

        <div class="header-actions">
          ${accountActionHtml(user)}
          <a class="header-action hide-md" href="${r}orders.html" ${current('orders')}>
            ${Icons.svg('receipt', 22)}
            <span class="header-action__text"><small>Track your</small><strong>Orders</strong></span>
          </a>
          <button type="button" class="header-action cart-btn" id="cart-button" aria-label="Open cart (0 items)">
            <span class="cart-icon">
              ${Icons.svg('cart', 24)}
              <span class="cart-count" id="cart-count" data-count="0" aria-hidden="true">0</span>
            </span>
            <span class="header-action__text"><small>Your</small><strong>Cart</strong></span>
          </button>
        </div>
      </div>

      <nav class="category-bar" aria-label="Shop by category">
        <div class="container">
          <ul class="category-bar__list" id="category-bar-list">
            <li><a class="category-bar__link" href="${r}index.html#products">${Icons.svg('grid', 16)} All products</a></li>
          </ul>
        </div>
      </nav>

      <nav class="site-nav" id="site-nav" aria-label="Main">
        <ul class="site-nav__list">
          <li><a class="site-nav__link" href="${r}index.html" ${current('home')}>${Icons.svg('store', 20)} Home</a></li>
          <li><a class="site-nav__link" href="${r}index.html#products">${Icons.svg('grid', 20)} All products</a></li>
          <li><a class="site-nav__link" href="${r}index.html#categories">${Icons.svg('layers', 20)} Categories</a></li>
          <li><a class="site-nav__link" href="${r}orders.html" ${current('orders')}>${Icons.svg('receipt', 20)} My orders</a></li>
          ${user
            ? `<li><button type="button" class="site-nav__link btn-reset" data-action="sign-out">${Icons.svg('logout', 20)} Sign out</button></li>`
            : `<li><a class="site-nav__link" href="${r}login.html">${Icons.svg('login', 20)} Sign in</a></li>
               <li><a class="site-nav__link" href="${r}signup.html">${Icons.svg('user', 20)} Create account</a></li>`}
        </ul>
      </nav>`;
  }

  /** Fills the category bar under the header with live categories. */
  async function loadCategoryBar() {
    try {
      const categories = await Api.getCategories();
      const activeId = Ui.getQueryParam('cat');
      const links = categories.map((category) => `
        <li>
          <a class="category-bar__link" href="${root()}index.html?cat=${encodeURIComponent(category.id)}#products"
             ${category.id === activeId ? 'aria-current="page"' : ''}>
            ${Ui.escapeHtml(category.name)}
          </a>
        </li>`).join('');
      $('#category-bar-list').append(links);
    } catch (error) {
      // The bar is a shortcut only; the page still works without it.
    }
  }

  function storeFooterHtml() {
    const r = root();
    const year = new Date().getFullYear();
    return `
      <div class="container">
        <div class="footer-grid">
          <div>
            ${logo('logo--light')}
            <p class="footer-tagline">Everything you love, nested in one place. Thirteen aisles of hand-picked products, honest prices, and the freedom to pay by cash or ShopNest credit.</p>
          </div>
          <div>
            <h2 class="footer-heading">Shop</h2>
            <ul class="footer-links">
              <li><a href="${r}index.html#products">All products</a></li>
              <li><a href="${r}index.html#categories">Categories</a></li>
              <li><a href="${r}index.html#trending">Trending now</a></li>
            </ul>
          </div>
          <div>
            <h2 class="footer-heading">Account</h2>
            <ul class="footer-links">
              <li><a href="${r}login.html">Sign in</a></li>
              <li><a href="${r}signup.html">Create account</a></li>
              <li><a href="${r}orders.html">My orders</a></li>
            </ul>
          </div>
          <div>
            <h2 class="footer-heading">Help</h2>
            <ul class="footer-links">
              <li><a href="${r}reset-password.html">Reset password</a></li>
              <li><a href="${r}docs/IMAGE-CREDITS.md">Photo credits</a></li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <span>&copy; ${year} ${CONFIG.SHOP_NAME}. All rights reserved.</span>
          <span class="footer-pay">
            <span class="footer-pay__chip">${Icons.svg('wallet', 14)} Cash</span>
            <span class="footer-pay__chip">${Icons.svg('bolt', 14)} ShopNest Credit</span>
          </span>
        </div>
      </div>`;
  }

  /** Updates the cart badge and makes it "bump". */
  function setCartCount(count) {
    const $badge = $('#cart-count');
    if (!$badge.length) return;
    const previous = Number($badge.attr('data-count'));
    $badge.text(count > 99 ? '99+' : count).attr('data-count', count);
    $('#cart-button').attr('aria-label', `Open cart (${count} ${count === 1 ? 'item' : 'items'})`);
    if (count !== previous) {
      // Remove and re-add the class so the animation can replay.
      $badge.removeClass('is-bumping');
      void $badge[0].offsetWidth; // forces the browser to notice the removal
      $badge.addClass('is-bumping');
    }
  }

  function initStore() {
    const $header = $('#site-header');
    $header.before(announcementHtml());
    $header.html(storeHeaderHtml());
    $('#site-footer').html(storeFooterHtml());
    loadCategoryBar();

    // Mobile menu open / close
    const $toggle = $('#menu-toggle');
    const $nav = $('#site-nav');
    $toggle.on('click', () => {
      const open = !$nav.hasClass('is-open');
      $nav.toggleClass('is-open', open);
      $toggle
        .attr('aria-expanded', String(open))
        .attr('aria-label', open ? 'Close menu' : 'Open menu')
        .html(Icons.svg(open ? 'close' : 'menu', 22));
    });
    // Close the menu after choosing a link (useful for #anchors on the same page).
    $nav.on('click', 'a', () => {
      if ($nav.hasClass('is-open')) $toggle.trigger('click');
    });

    // The cart drawer arrives in Phase 5. Until then the button explains itself.
    $('#cart-button').on('click', () => {
      Ui.toast('Your cart is empty. Start adding products you love!', 'info', { title: 'Your cart' });
    });
  }

  /* ------------------------------------------------------------------
     Admin sidebar + top bar
     ------------------------------------------------------------------ */

  function adminSidebarHtml() {
    const r = root();
    const user = Auth.currentUser();
    const email = user ? user.email : CONFIG.ADMIN_EMAIL;
    return `
      <div class="sidebar-brand">
        ${logo('logo--light')}
        <span class="sidebar-tag">Admin</span>
      </div>
      <div>
        <p class="sidebar-section-label">Manage</p>
        <nav class="sidebar-nav" aria-label="Admin">
          <a class="sidebar-link" href="${r}admin/dashboard.html" ${current('dashboard')}>${Icons.svg('dashboard')} Dashboard</a>
          <a class="sidebar-link" href="${r}admin/inventory.html" ${current('inventory')}>${Icons.svg('box')} Inventory</a>
          <a class="sidebar-link" href="${r}admin/customers.html" ${current('customers')}>${Icons.svg('users')} Customers</a>
          <a class="sidebar-link" href="${r}admin/reports.html" ${current('reports')}>${Icons.svg('chart')} Reports</a>
        </nav>
      </div>
      <div class="sidebar-footer">
        <a class="sidebar-link" href="${r}index.html">${Icons.svg('store')} View store</a>
        <button type="button" class="sidebar-link btn-reset" data-action="sign-out">${Icons.svg('logout')} Sign out</button>
        <div class="sidebar-user">
          <span class="avatar" aria-hidden="true">${avatarLetter(email)}</span>
          <div class="min-w-0">
            <p class="sidebar-user__role">Administrator</p>
            <p class="sidebar-user__email">${Ui.escapeHtml(email)}</p>
          </div>
        </div>
      </div>`;
  }

  function adminTopbarHtml() {
    const title = document.body.dataset.title || 'Admin';
    return `
      <button type="button" class="btn btn-ghost btn-icon admin-menu-toggle" id="admin-menu-toggle"
              aria-controls="admin-sidebar" aria-expanded="false" aria-label="Open navigation">
        ${Icons.svg('menu', 22)}
      </button>
      <h1 class="admin-topbar__title">${Ui.escapeHtml(title)}</h1>
      <div class="admin-topbar__actions">
        <a class="btn btn-secondary btn-sm" href="${root()}index.html">${Icons.svg('store', 16)} <span class="hide-sm">Open store</span></a>
      </div>`;
  }

  function initAdmin() {
    $('#admin-sidebar').html(adminSidebarHtml());
    $('#admin-topbar').html(adminTopbarHtml());

    // Small screens: the sidebar slides in over the page.
    const $sidebar = $('#admin-sidebar');
    const $overlay = $('#sidebar-overlay');
    const $toggle = $('#admin-menu-toggle');

    function setSidebar(open) {
      $sidebar.toggleClass('is-open', open);
      $overlay.toggleClass('is-open', open);
      $toggle.attr('aria-expanded', String(open));
    }

    $toggle.on('click', () => setSidebar(!$sidebar.hasClass('is-open')));
    $overlay.on('click', () => setSidebar(false));
    $(document).on('keydown', (event) => {
      if (event.key === 'Escape' && $sidebar.hasClass('is-open')) setSidebar(false);
    });
  }

  /* ------------------------------------------------------------------
     Auth pages (sign in, sign up, reset): just the logo; the page has its own layout.
     Sign-out buttons everywhere are handled by auth.js.
     ------------------------------------------------------------------ */
  function initAuthPage() {
    $('#auth-logo').html(logo());
  }

  /**
   * Static HTML can ask for an icon with <span data-icon="cart" data-size="18"></span>.
   * We swap each placeholder for the real SVG, so HTML files stay short.
   */
  function renderIcons($scope = $(document)) {
    $scope.find('[data-icon]').each(function () {
      const $el = $(this);
      $el.replaceWith(Icons.svg($el.data('icon'), Number($el.data('size')) || 20));
    });
  }

  // Build the layout as soon as the page's HTML is ready.
  $(function () {
    const type = document.body.dataset.layout;
    if (type === 'store') initStore();
    if (type === 'admin') initAdmin();
    if (type === 'auth') initAuthPage();
    renderIcons();
  });

  return { setCartCount, logoSvg, renderIcons };
})();
