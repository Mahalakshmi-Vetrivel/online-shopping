/* =====================================================================
   cart.js - the shopping cart and its slide-in drawer.

   WHAT IS STORED: only { id, qty } per line, in localStorage under
   "shopnest.cart.<uid>" (or "shopnest.cart.guest" before sign-in).
   Titles, prices and photos are NOT stored: they are looked up from the
   live product list every time, so a price change in the admin page shows
   up in the cart at once, and old prices can never be charged.

   GUEST CARTS: a visitor can fill a cart before signing in. When they
   sign in, the guest cart is merged into their own cart.

   Other files talk to the cart through Cart.xxx(); whenever the cart
   changes, it triggers a "cart:changed" event on document (the header
   badge, the drawer and the checkout page listen to it).
   ===================================================================== */

const Cart = (function () {
  const KEY_PREFIX = 'shopnest.cart.';
  const MAX_LINE_QTY = 99;
  const esc = Ui.escapeHtml;

  let drawerBuilt = false;
  let drawerOpen = false;
  let lastFocused = null;
  let renderCounter = 0;
  let linesOnScreen = {}; // id -> product, for the lines currently in the drawer

  /* ------------------------------------------------------------------
     Storage
     ------------------------------------------------------------------ */
  function keyFor(uid) {
    return KEY_PREFIX + (uid || 'guest');
  }

  function ownKey() {
    const user = Auth.currentUser();
    return keyFor(user && user.uid);
  }

  /** Reads a stored cart. Anything that looks wrong is dropped (localStorage can be edited by anyone). */
  function readKey(key) {
    try {
      const list = JSON.parse(localStorage.getItem(key));
      if (!Array.isArray(list)) return [];
      return list
        .filter((line) => line && typeof line.id === 'string' && Number.isInteger(line.qty) && line.qty >= 1)
        .map((line) => ({ id: line.id, qty: Math.min(line.qty, MAX_LINE_QTY) }));
    } catch (error) {
      return [];
    }
  }

  function items() {
    return readKey(ownKey());
  }

  function save(list) {
    localStorage.setItem(ownKey(), JSON.stringify(list));
    $(document).trigger('cart:changed');
  }

  /** Total number of units (3 pens + 1 bag = 4), shown on the header badge. */
  function count() {
    return items().reduce((sum, line) => sum + line.qty, 0);
  }

  /** After signing in, the guest cart joins the customer's own cart. */
  function mergeGuestCart() {
    const user = Auth.currentUser();
    if (!user || Auth.isAdmin(user)) return;
    const guestKey = keyFor(null);
    const guest = readKey(guestKey);
    if (!guest.length) return;
    const merged = items();
    guest.forEach((line) => {
      const same = merged.find((other) => other.id === line.id);
      if (same) same.qty = Math.min(same.qty + line.qty, MAX_LINE_QTY);
      else merged.push(line);
    });
    localStorage.removeItem(guestKey);
    save(merged);
  }

  /* ------------------------------------------------------------------
     Changing the cart
     ------------------------------------------------------------------ */

  /**
   * Adds a product (a quantity of it). Never lets the cart hold more than
   * the stock. Returns true if something was added.
   */
  async function add(productId, quantity = 1) {
    if (Auth.isAdmin()) {
      Ui.toast('The admin account cannot shop. Sign in with a customer account to place orders.', 'info', { title: 'Admin account' });
      return false;
    }

    let product;
    try {
      const active = await Api.getActiveProducts();
      product = active.find((candidate) => candidate.id === productId);
    } catch (error) {
      Ui.showError(error, 'Could not add to cart');
      return false;
    }
    if (!product) {
      Ui.toast('This product is not available any more.', 'warning', { title: 'Not available' });
      return false;
    }
    if (product.qty <= 0) {
      Ui.toast(`${product.title} is sold out.`, 'warning', { title: 'Sold out' });
      return false;
    }

    const list = items();
    const line = list.find((other) => other.id === productId);
    const have = line ? line.qty : 0;
    const wanted = have + quantity;
    const allowed = Math.min(wanted, product.qty, MAX_LINE_QTY);

    if (allowed <= have) {
      Ui.toast(`Your cart already holds all ${product.qty} we have of ${product.title}.`, 'warning', { title: 'Maximum reached' });
      open();
      return false;
    }

    if (line) line.qty = allowed;
    else list.push({ id: productId, qty: allowed });
    save(list);

    // No "success" toast: the drawer sliding open (and the badge bumping) is the feedback,
    // and a toast would cover the drawer. Warnings are still shown.
    if (allowed < wanted) {
      Ui.toast(`Only ${product.qty} of ${product.title} in stock, so the cart now holds ${allowed}.`, 'warning', { title: 'Limited stock' });
    }
    open();
    return true;
  }

  function setQty(productId, quantity) {
    if (quantity < 1) {
      remove(productId);
      return;
    }
    const list = items().map((line) => (line.id === productId ? { id: line.id, qty: Math.min(quantity, MAX_LINE_QTY) } : line));
    save(list);
  }

  function remove(productId) {
    save(items().filter((line) => line.id !== productId));
  }

  function clear() {
    save([]);
  }

  /* ------------------------------------------------------------------
     The drawer
     ------------------------------------------------------------------ */
  function buildDrawer() {
    if (drawerBuilt) return;
    drawerBuilt = true;
    $('body').append(`
      <div class="drawer-overlay" id="cart-overlay" hidden></div>
      <aside class="drawer" id="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title" tabindex="-1" hidden>
        <header class="drawer__head">
          <h2 class="drawer__title" id="cart-title">Your cart <span class="drawer__count" id="cart-title-count"></span></h2>
          <button type="button" class="btn btn-ghost btn-icon" id="cart-close" aria-label="Close cart">${Icons.svg('close', 20)}</button>
        </header>
        <div class="drawer__body" id="cart-body" aria-live="polite"></div>
        <footer class="drawer__foot" id="cart-foot"></footer>
      </aside>`);

    $('#cart-overlay, #cart-close').on('click', close);

    // Esc closes; Tab stays inside the drawer (focus trap).
    $('#cart-drawer').on('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key === 'Tab') {
        const $focusable = $('#cart-drawer').find('a[href], button:not([disabled])').filter(':visible');
        if (!$focusable.length) return;
        const first = $focusable.get(0);
        const last = $focusable.get($focusable.length - 1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    // Buttons inside the lines (event delegation: the lines are redrawn often).
    $('#cart-body').on('click', '[data-cart-step]', function () {
      const id = $(this).data('id');
      const product = linesOnScreen[id];
      const current = items().find((line) => line.id === id);
      if (!current) return;
      const next = current.qty + Number($(this).data('cart-step'));
      if (product && next > product.qty) return;
      setQty(id, next);
    });
    $('#cart-body').on('click', '[data-cart-remove]', function () {
      remove($(this).data('id'));
    });
  }

  function open() {
    buildDrawer();
    if (drawerOpen) {
      renderDrawer();
      return;
    }
    drawerOpen = true;
    lastFocused = document.activeElement;
    $('#cart-overlay, #cart-drawer').prop('hidden', false);
    $('body').addClass('no-scroll');
    // Two frames later the browser has drawn the hidden state, so the slide-in animation plays.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $('#cart-overlay, #cart-drawer').addClass('is-open');
      $('#cart-drawer').trigger('focus');
    }));
    renderDrawer({ refreshStock: true });
  }

  function close() {
    if (!drawerOpen) return;
    drawerOpen = false;
    $('#cart-overlay, #cart-drawer').removeClass('is-open');
    $('body').removeClass('no-scroll');
    setTimeout(() => {
      if (!drawerOpen) $('#cart-overlay, #cart-drawer').prop('hidden', true);
    }, 300);
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function lineHtml(line, product) {
    if (!product) {
      return `
        <li class="cart-line cart-line--gone" data-id="${esc(line.id)}">
          <div class="cart-line__body">
            <p class="cart-line__title">This item is no longer available</p>
            <p class="cart-line__price">It was removed from the store.</p>
            <div class="cart-line__controls">
              <button type="button" class="btn btn-ghost btn-sm" data-cart-remove data-id="${esc(line.id)}">${Icons.svg('trash', 16)} Remove</button>
            </div>
          </div>
        </li>`;
    }
    const url = ProductCard.productUrl(product);
    const lineTotal = Math.round(product.price * line.qty * 100) / 100;
    return `
      <li class="cart-line" data-id="${esc(line.id)}">
        <a class="cart-line__img" href="${url}" tabindex="-1" aria-hidden="true">${Placeholder.image(product, { size: 'sm' })}</a>
        <div class="cart-line__body">
          <a class="cart-line__title" href="${url}">${esc(product.title)}</a>
          <p class="cart-line__price">${Ui.formatMoney(product.price)} each</p>
          <div class="cart-line__controls">
            <div class="qty-stepper qty-stepper--sm" role="group" aria-label="Quantity of ${esc(product.title)}">
              <button type="button" class="qty-stepper__btn" data-cart-step="-1" data-id="${esc(line.id)}" aria-label="Decrease quantity of ${esc(product.title)}">${Icons.svg('minus', 14)}</button>
              <span class="qty-stepper__value" aria-live="polite">${line.qty}</span>
              <button type="button" class="qty-stepper__btn" data-cart-step="1" data-id="${esc(line.id)}" aria-label="Increase quantity of ${esc(product.title)}"
                      ${line.qty >= product.qty ? 'disabled' : ''}>${Icons.svg('plus', 14)}</button>
            </div>
            <button type="button" class="btn btn-ghost btn-icon btn-icon-danger" data-cart-remove data-id="${esc(line.id)}"
                    aria-label="Remove ${esc(product.title)} from the cart">${Icons.svg('trash', 18)}</button>
          </div>
          ${line.qty >= product.qty ? `<p class="cart-line__note">That is all we have in stock.</p>` : ''}
        </div>
        <p class="cart-line__total">${Ui.formatMoney(lineTotal)}</p>
      </li>`;
  }

  /** Draws the drawer from the stored cart + live product data. */
  async function renderDrawer({ refreshStock = false } = {}) {
    if (!drawerBuilt) return;
    const myRender = ++renderCounter;
    const list = items();
    $('#cart-title-count').text(list.length ? `(${count()})` : '');

    if (!list.length) {
      $('#cart-body').html(Ui.emptyState({
        icon: 'cart',
        title: 'Your cart is empty',
        text: 'Looks like you have not added anything yet. Let us fix that!',
        action: '<a class="btn btn-primary" href="index.html#products" data-cart-continue>Start shopping</a>'
      }));
      $('#cart-foot').empty();
      return;
    }

    let products;
    try {
      // Opening the drawer reads fresh stock; later redraws reuse the cached list.
      products = await Api.getActiveProducts(refreshStock);
    } catch (error) {
      Ui.showError(error, 'Could not load your cart');
      return;
    }
    if (myRender !== renderCounter) return; // a newer redraw has started

    const byId = new Map(products.map((product) => [product.id, product]));
    // Never keep more in the cart than the stock allows.
    let adjusted = false;
    const fixed = list.map((line) => {
      const product = byId.get(line.id);
      if (product && product.qty > 0 && line.qty > product.qty) {
        adjusted = true;
        return { id: line.id, qty: product.qty };
      }
      return line;
    });
    if (adjusted) {
      save(fixed);
      return; // save() triggers a redraw
    }

    linesOnScreen = {};
    let subtotal = 0;
    let payable = 0;
    const html = list.map((line) => {
      const product = byId.get(line.id) || null;
      if (product && product.qty > 0) {
        linesOnScreen[line.id] = product;
        subtotal += product.price * line.qty;
        payable++;
        return lineHtml(line, product);
      }
      return lineHtml(line, null);
    }).join('');

    $('#cart-body').html(`<ul class="cart-lines">${html}</ul>`);
    $('#cart-foot').html(`
      <div class="drawer__total">
        <span>Subtotal</span>
        <strong>${Ui.formatMoney(Math.round(subtotal * 100) / 100)}</strong>
      </div>
      <p class="drawer__hint">Taxes included. Choose cash or ShopNest credit at checkout.</p>
      <a class="btn btn-primary btn-lg btn-block" href="checkout.html" ${payable ? '' : 'aria-disabled="true" tabindex="-1"'}>
        Checkout ${Icons.svg('arrowRight', 18)}
      </a>
      <button type="button" class="btn btn-ghost btn-block" id="cart-keep-shopping">Continue shopping</button>`);
    $('#cart-keep-shopping').on('click', close);
  }

  /* ------------------------------------------------------------------
     Wiring
     ------------------------------------------------------------------ */
  function updateBadge() {
    Layout.setCartCount(count());
  }

  $(document).on('cart:changed', () => {
    updateBadge();
    if (drawerOpen) renderDrawer();
  });

  // The cart changed in ANOTHER tab: the "storage" event tells us.
  window.addEventListener('storage', (event) => {
    if (event.key && event.key.startsWith(KEY_PREFIX)) $(document).trigger('cart:changed');
  });

  // "Add to cart" buttons everywhere (cards and the product page).
  $(document).on('click', '[data-add-to-cart]', function () {
    const productId = String($(this).data('add-to-cart'));
    // On the product page the quantity box sits next to the button.
    const $qty = $(this).closest('.buy-box').find('#qty');
    const quantity = $qty.length ? parseInt($qty.val(), 10) || 1 : 1;
    add(productId, quantity);
  });

  // The cart button in the header.
  $(document).on('click', '#cart-button', open);

  // Links to the shop inside the drawer close it first (same-page anchors).
  $(document).on('click', '[data-cart-continue]', close);

  $(function () {
    mergeGuestCart();
    updateBadge();
  });

  return { add, setQty, remove, clear, items, count, open, close };
})();
