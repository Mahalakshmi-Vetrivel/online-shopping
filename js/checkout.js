/* =====================================================================
   checkout.js - Review the cart, choose Cash or Credit, place the order.

   SAFETY STEPS (the brief's rules):
     1. When the page opens, every cart item and the customer's credit
        are read FRESH from Firestore. Sold-out or hidden items are
        removed and over-large quantities are reduced, with a message.
     2. When "Place order" is pressed they are read AGAIN. If anything
        changed since the page was drawn (stock, price, credit), we do
        not charge: we show what changed and let the customer decide.
     3. Credit is allowed only if creditUsed + order total <= creditLimit.
     4. The order, the stock reduction and the credit change are saved in
        ONE atomic commit (Api.placeOrder). The commit carries the
        versions we checked, so if anything changed in the last
        millisecond, Firestore rejects the whole purchase.
     5. The button is disabled while the request runs (no duplicate orders).
   ===================================================================== */

(function () {
  const esc = Ui.escapeHtml;
  const $root = $('#checkout-root');

  const state = {
    lines: [],          // [{ product, qty, lineTotal }]  (fresh data)
    customer: null,     // fresh customer document
    payment: 'cash',    // 'cash' | 'credit'
    placing: false      // true while the purchase request runs
  };
  let ignoreCartEvents = false;
  let loadCounter = 0;

  /* ------------------------------------------------------------------
     Money helpers
     ------------------------------------------------------------------ */
  const round2 = (value) => Math.round(value * 100) / 100;
  const total = () => round2(state.lines.reduce((sum, line) => sum + line.lineTotal, 0));
  const unitCount = () => state.lines.reduce((sum, line) => sum + line.qty, 0);

  function creditAvailable(customer = state.customer) {
    return Math.max(0, round2((customer.creditLimit || 0) - (customer.creditUsed || 0)));
  }

  /** The rule from the brief: creditUsed + order total <= creditLimit. */
  function creditCovers(customer, orderTotal) {
    return orderTotal > 0 && round2((customer.creditUsed || 0) + orderTotal) <= (customer.creditLimit || 0);
  }

  /* ------------------------------------------------------------------
     Fresh data
     ------------------------------------------------------------------ */
  async function loadCustomer() {
    const user = Auth.currentUser();
    try {
      return await Api.getCustomer(user.uid);
    } catch (error) {
      if (error.code !== 'NOT_FOUND') throw error;
      // Signed up, but the profile was never saved: create it now (see Auth.finishSignIn).
      await Auth.finishSignIn(user);
      return Api.getCustomer(user.uid);
    }
  }

  /** Reads every cart product and the customer, at the same time. */
  async function fetchFresh() {
    const items = Cart.items();
    const [products, customer] = await Promise.all([
      Promise.all(items.map((item) => Api.getProduct(item.id).catch((error) => {
        if (error.code === 'NOT_FOUND') return null; // deleted by the admin
        throw error;
      }))),
      loadCustomer()
    ]);
    return { items, products, customer };
  }

  /**
   * Compares the cart with the fresh product data. Fixes the cart
   * (removes unavailable items, lowers quantities) and returns what it did.
   * `shown` = the lines drawn on screen, to spot price changes.
   */
  function reconcile(items, products, shown) {
    const lines = [];
    const messages = [];
    ignoreCartEvents = true; // our own cart edits must not trigger a reload
    items.forEach((item, index) => {
      const product = products[index];
      if (!product || !product.isActive || product.qty <= 0) {
        Cart.remove(item.id);
        messages.push(product
          ? `${product.title} is no longer available and was removed from your cart.`
          : 'An item in your cart is no longer available and was removed.');
        return;
      }
      let qty = item.qty;
      if (qty > product.qty) {
        qty = product.qty;
        Cart.setQty(item.id, qty);
        messages.push(`Only ${product.qty} of ${product.title} left, so the quantity was changed to ${qty}.`);
      }
      const before = shown && shown.find((line) => line.product.id === item.id);
      if (before && before.product.price !== product.price) {
        messages.push(`The price of ${product.title} changed from ${Ui.formatMoney(before.product.price)} to ${Ui.formatMoney(product.price)}.`);
      }
      lines.push({ product, qty, lineTotal: round2(product.price * qty) });
    });
    ignoreCartEvents = false;
    return { lines, messages };
  }

  /* ------------------------------------------------------------------
     Drawing
     ------------------------------------------------------------------ */
  function lineHtml(line) {
    const product = line.product;
    return `
      <li class="co-line">
        <a class="co-line__img" href="${ProductCard.productUrl(product)}" tabindex="-1" aria-hidden="true">${Placeholder.image(product, { size: 'sm' })}</a>
        <div class="co-line__info">
          <a class="co-line__title" href="${ProductCard.productUrl(product)}">${esc(product.title)}</a>
          <p class="co-line__meta">${Ui.formatMoney(product.price)} &times; ${line.qty}</p>
        </div>
        <p class="co-line__total">${Ui.formatMoney(line.lineTotal)}</p>
      </li>`;
  }

  function payOptionHtml(value, icon, title, text, { disabled = false } = {}) {
    return `
      <label class="pay-option ${disabled ? 'is-disabled' : ''}">
        <input class="pay-option__input" type="radio" name="payment" value="${value}"
               ${state.payment === value ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span class="pay-option__box">
          <span class="pay-option__icon">${Icons.svg(icon, 22)}</span>
          <span class="pay-option__text"><strong>${title}</strong><small>${text}</small></span>
          <span class="pay-option__tick" aria-hidden="true">${Icons.svg('check', 16)}</span>
        </span>
      </label>`;
  }

  function creditPanelHtml() {
    const customer = state.customer;
    const limit = customer.creditLimit || 0;
    const used = Math.min(customer.creditUsed || 0, limit);
    const available = creditAvailable();
    const orderTotal = total();
    const covers = creditCovers(customer, orderTotal);
    const message = covers
      ? `After this order you will have <strong>${Ui.formatMoney(round2(available - orderTotal))}</strong> credit left.`
      : `This order is <strong>${Ui.formatMoney(orderTotal)}</strong> but you have only <strong>${Ui.formatMoney(available)}</strong> credit available. Pay with cash, or ask the store to raise your limit.`;
    return `
      <div class="credit-panel ${covers ? '' : 'credit-panel--short'}">
        <div class="credit-panel__row">
          <span>Credit limit <strong>${Ui.formatMoney(limit)}</strong></span>
          <span>Used <strong>${Ui.formatMoney(customer.creditUsed || 0)}</strong></span>
          <span>Available <strong>${Ui.formatMoney(available)}</strong></span>
        </div>
        <progress class="credit-bar ${covers ? '' : 'credit-bar--full'}" max="${limit || 1}" value="${used}"
                  aria-label="${limit ? Math.round((used / limit) * 100) : 100}% of your credit limit used"></progress>
        <p class="credit-panel__msg">${message}</p>
      </div>`;
  }

  function summaryHtml() {
    const orderTotal = total();
    const credit = state.payment === 'credit';
    return `
      <h2 class="card-title">Order summary</h2>
      <dl class="summary-rows">
        <div><dt>Items (${unitCount()})</dt><dd>${Ui.formatMoney(orderTotal)}</dd></div>
        <div><dt>Delivery</dt><dd>Free</dd></div>
        <div><dt>Payment</dt><dd>${credit ? 'ShopNest credit' : 'Cash'}</dd></div>
      </dl>
      <p class="summary-total"><span>Total</span><strong>${Ui.formatMoney(orderTotal)}</strong></p>
      <button type="button" class="btn btn-primary btn-lg btn-block" id="place-order">
        ${Icons.svg('check', 20)} Place order
      </button>
      <p class="summary-safe">${Icons.svg('shield', 14)} Stock and credit are checked again just before you pay.</p>`;
  }

  /** Redraws only the parts that depend on the chosen payment method. */
  function updateSummary() {
    $('#checkout-summary').html(summaryHtml());
    $('#credit-panel-slot').html(creditPanelHtml());
  }

  function render(notices = []) {
    if (!state.lines.length) {
      $root.attr('aria-busy', 'false').html(
        `${noticesHtml(notices)}${Ui.emptyState({
          icon: 'cart',
          title: 'Your cart is empty',
          text: 'Add something you love, then come back to check out.',
          action: '<a class="btn btn-primary" href="index.html#products">Browse products</a>'
        })}`
      );
      return;
    }

    // Credit is offered only if it covers the whole order.
    const creditOk = creditCovers(state.customer, total());
    if (state.payment === 'credit' && !creditOk) state.payment = 'cash';

    $root.attr('aria-busy', 'false').html(`
      ${noticesHtml(notices)}
      <div class="checkout-grid">
        <div class="checkout-main">
          <section class="card card-pad" aria-labelledby="co-items-title">
            <div class="card-head">
              <h2 class="card-title" id="co-items-title">Review your items</h2>
              <button type="button" class="btn btn-ghost btn-sm" id="edit-cart">${Icons.svg('edit', 16)} Edit cart</button>
            </div>
            <ul class="co-lines">${state.lines.map(lineHtml).join('')}</ul>
          </section>

          <section class="card card-pad" aria-labelledby="co-pay-title">
            <h2 class="card-title" id="co-pay-title">How would you like to pay?</h2>
            <fieldset class="pay-options">
              <legend class="visually-hidden">Choose how to pay</legend>
              ${payOptionHtml('cash', 'wallet', 'Cash', 'Pay with cash. There is no limit.')}
              ${payOptionHtml('credit', 'bolt', 'ShopNest credit',
                creditOk ? `${Ui.formatMoney(creditAvailable())} available` : 'Not enough credit for this order', { disabled: !creditOk })}
            </fieldset>
            <div id="credit-panel-slot">${creditPanelHtml()}</div>
          </section>
        </div>

        <aside class="checkout-summary card card-pad" id="checkout-summary" aria-label="Order summary">${summaryHtml()}</aside>
      </div>`);
  }

  function noticesHtml(messages) {
    if (!messages.length) return '';
    return `
      <div class="notice notice--warning" role="status">
        <span class="notice__icon">${Icons.svg('alert', 20)}</span>
        <div>
          <p class="notice__title">We updated your order</p>
          <ul>${messages.map((message) => `<li>${esc(message)}</li>`).join('')}</ul>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------------
     Loading
     ------------------------------------------------------------------ */
  async function load(extraNotices = []) {
    const myLoad = ++loadCounter;
    $root.attr('aria-busy', 'true');
    if (!Cart.items().length) {
      state.lines = [];
      state.customer = state.customer || { creditLimit: 0, creditUsed: 0 };
      render(extraNotices);
      return;
    }
    $root.html(Ui.loader('Checking stock and your credit...'));

    try {
      const fresh = await fetchFresh();
      if (myLoad !== loadCounter) return;
      const result = reconcile(fresh.items, fresh.products, null);
      state.lines = result.lines;
      state.customer = fresh.customer;
      render([...extraNotices, ...result.messages]);
    } catch (error) {
      if (myLoad !== loadCounter) return;
      Ui.showError(error, 'Could not load checkout');
      $root.attr('aria-busy', 'false').html(Ui.emptyState({
        icon: 'alert',
        title: 'Checkout did not load',
        text: error.message,
        action: '<button type="button" class="btn btn-primary" data-action="retry">Try again</button>'
      }));
    }
  }

  /* ------------------------------------------------------------------
     Placing the order
     ------------------------------------------------------------------ */
  function buildOrder(customer, lines) {
    const user = Auth.currentUser();
    return {
      customerId: user.uid,
      customerName: customer.name || user.email.split('@')[0],
      customerEmail: customer.email || user.email,
      items: lines.map((line) => ({
        productId: line.product.id,
        title: line.product.title,
        catId: line.product.catId,
        categoryName: line.product.categoryName,
        qty: line.qty,
        price: line.product.price,
        lineTotal: line.lineTotal
      })),
      totalAmount: round2(lines.reduce((sum, line) => sum + line.lineTotal, 0)),
      paymentType: state.payment
    };
  }

  async function placeOrder() {
    if (state.placing) return; // a second click while the first is running does nothing
    state.placing = true;
    let leavingPage = false;
    Ui.setBusy($('#place-order'), true, 'Placing your order...');

    try {
      // STEP 2: read everything again, right now.
      const fresh = await fetchFresh();
      const result = reconcile(fresh.items, fresh.products, state.lines);
      if (result.messages.length || !result.lines.length) {
        state.lines = result.lines;
        state.customer = fresh.customer;
        render(result.messages);
        Ui.toast('Something changed before you paid, so nothing was charged. Please review your order.', 'warning', { title: 'Please review' });
        return;
      }

      // STEP 3: the credit rule, with the FRESH credit numbers.
      const order = buildOrder(fresh.customer, result.lines);
      if (order.paymentType === 'credit' && !creditCovers(fresh.customer, order.totalAmount)) {
        state.lines = result.lines;
        state.customer = fresh.customer;
        state.payment = 'cash';
        render([`Your available credit is now ${Ui.formatMoney(creditAvailable(fresh.customer))}, which does not cover ${Ui.formatMoney(order.totalAmount)}. Nothing was charged.`]);
        return;
      }

      // STEP 4: one atomic commit, with the versions we just checked.
      const productVersions = {};
      result.lines.forEach((line) => { productVersions[line.product.id] = line.product._updateTime; });
      const orderId = await Api.placeOrder({
        order,
        productVersions,
        customerVersion: fresh.customer._updateTime
      });

      leavingPage = true; // keep the button busy while the browser changes page
      ignoreCartEvents = true;
      Cart.clear();
      ignoreCartEvents = false;

      // Bill by e-mail (off unless CONFIG.EMAIL.ENABLED). We wait at most 4 seconds,
      // and a failed e-mail never undoes the order.
      const emailed = await Promise.race([
        Api.sendOrderEmail(order, orderId),
        new Promise((resolve) => setTimeout(() => resolve(false), 4000))
      ]);
      Auth.setFlash(
        `Order ${orderId} is placed. Thank you, ${order.customerName}!${emailed ? ` A copy of the bill was sent to ${order.customerEmail}.` : ''}`,
        'success',
        'Order placed'
      );
      window.location.replace(`bill.html?id=${encodeURIComponent(orderId)}&placed=1`);
    } catch (error) {
      if (error.code === 'FAILED_PRECONDITION' || error.code === 'ABORTED') {
        // Someone else bought the same item (or the admin changed something) at this very moment.
        state.placing = false;
        Ui.toast('Stock or credit changed at the very moment you paid, so nothing was charged. We have refreshed your order.', 'warning', { title: 'Please try again' });
        await load();
      } else {
        Ui.showError(error, 'Could not place the order');
      }
    } finally {
      // Always unlock the button again (unless we are leaving the page).
      if (!leavingPage) {
        state.placing = false;
        Ui.setBusy($('#place-order'), false);
      }
    }
  }

  /* ------------------------------------------------------------------
     Wiring
     ------------------------------------------------------------------ */
  $(function () {
    load();

    $root.on('change', 'input[name="payment"]', function () {
      state.payment = $(this).val();
      updateSummary();
    });
    $root.on('click', '#place-order', placeOrder);
    $root.on('click', '#edit-cart', () => Cart.open());
    $root.on('click', '[data-action="retry"]', () => load());

    // The cart was edited in the drawer (or in another tab): read everything again.
    $(document).on('cart:changed', () => {
      if (!state.placing && !ignoreCartEvents) load();
    });
  });
})();
