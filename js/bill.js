/* =====================================================================
   bill.js - the bill (invoice) page: bill.html?id=ORD...

   Reads one order and shows it as a printable bill. A customer can only
   open their OWN bills: if the order belongs to someone else, we show
   "not available" (this is a screen check; the real data protection is
   the Firestore security rules in Phase 7).
   ===================================================================== */

(function () {
  const esc = Ui.escapeHtml;
  const $root = $('#bill-root');

  function showState(icon, title, text) {
    document.title = `${title} | ShopNest`;
    $root.attr('aria-busy', 'false').html(Ui.emptyState({
      icon,
      title,
      text,
      action: '<a class="btn btn-primary" href="orders.html">Go to my orders</a>'
    }));
  }

  function rowHtml(item) {
    return `
      <tr>
        <td>
          <span class="bill__item">${esc(item.title)}</span>
          <span class="bill__cat">${esc(item.categoryName)}</span>
        </td>
        <td class="num">${item.qty}</td>
        <td class="num">${Ui.formatMoney(item.price)}</td>
        <td class="num">${Ui.formatMoney(item.lineTotal)}</td>
      </tr>`;
  }

  function billHtml(order, justPlaced) {
    const credit = order.paymentType === 'credit';
    const units = order.items.reduce((sum, item) => sum + item.qty, 0);
    return `
      ${justPlaced ? `
        <div class="notice notice--success no-print" role="status">
          <span class="notice__icon">${Icons.svg('checkCircle', 22)}</span>
          <div>
            <p class="notice__title">Thank you! Your order is placed.</p>
            <p>Your bill is below, and it is saved in <a href="orders.html">My orders</a>.</p>
          </div>
        </div>` : ''}

      <article class="bill" aria-labelledby="bill-title">
        <header class="bill__head">
          <div>
            <span class="logo">${Layout.logoSvg()}<span class="logo-text">Shop<span>Nest</span></span></span>
            <p class="bill__tagline">Everything you love, nested in one place.</p>
          </div>
          <div class="bill__meta">
            <h1 class="bill__title" id="bill-title">Bill</h1>
            <dl>
              <div><dt>Bill no.</dt><dd><code>${esc(order.id)}</code></dd></div>
              <div><dt>Date</dt><dd>${order.createdAt ? Ui.formatDate(order.createdAt) : '-'}</dd></div>
              <div><dt>Status</dt><dd><span class="badge badge-accent badge-dot">${esc(order.status === 'PLACED' ? 'Placed' : order.status)}</span></dd></div>
            </dl>
          </div>
        </header>

        <section class="bill__parties" aria-label="Billing details">
          <div>
            <p class="bill__label">Billed to</p>
            <p class="bill__value">${esc(order.customerName)}</p>
            <p class="bill__sub">${esc(order.customerEmail)}</p>
          </div>
          <div>
            <p class="bill__label">Payment</p>
            <p class="bill__value">
              <span class="badge ${credit ? 'badge-info' : 'badge-muted'}">${credit ? 'ShopNest credit' : 'Cash'}</span>
            </p>
            <p class="bill__sub">${credit ? 'Added to your credit used' : 'Paid in cash'}</p>
          </div>
        </section>

        <div class="table-wrap">
          <table class="bill__table">
            <caption class="visually-hidden">Items on this bill</caption>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" class="num">Qty</th>
                <th scope="col" class="num">Price</th>
                <th scope="col" class="num">Amount</th>
              </tr>
            </thead>
            <tbody>${order.items.map(rowHtml).join('')}</tbody>
            <tfoot>
              <tr><th scope="row" colspan="3">Items (${units})</th><td class="num">${Ui.formatMoney(order.totalAmount)}</td></tr>
              <tr><th scope="row" colspan="3">Delivery</th><td class="num">Free</td></tr>
              <tr class="bill__grand"><th scope="row" colspan="3">Total</th><td class="num">${Ui.formatMoney(order.totalAmount)}</td></tr>
            </tfoot>
          </table>
        </div>

        <footer class="bill__foot">
          <p>Thank you for shopping with ShopNest. Prices include all taxes.</p>
        </footer>
      </article>

      <div class="bill-actions no-print">
        <button type="button" class="btn btn-primary" id="print-bill">${Icons.svg('receipt', 18)} Print bill</button>
        <a class="btn btn-secondary" href="orders.html">All my orders</a>
        <a class="btn btn-ghost" href="index.html#products">Continue shopping</a>
      </div>`;
  }

  async function load() {
    const id = Ui.getQueryParam('id');
    if (!id) {
      showState('search', 'No bill chosen', 'Open a bill from your order history.');
      return;
    }
    $root.attr('aria-busy', 'true');

    let order;
    try {
      order = await Api.getOrder(id);
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        showState('search', 'Bill not found', 'We could not find that order.');
        return;
      }
      Ui.showError(error, 'Could not load the bill');
      $root.attr('aria-busy', 'false').html(Ui.emptyState({
        icon: 'alert',
        title: 'The bill did not load',
        text: error.message,
        action: '<button type="button" class="btn btn-primary" data-action="retry">Try again</button>'
      }));
      return;
    }

    if (order.customerId !== Auth.currentUser().uid) {
      showState('shield', 'This bill is not available', 'You can only open bills for your own orders.');
      return;
    }

    document.title = `Bill ${order.id} | ShopNest`;
    $root.attr('aria-busy', 'false').html(billHtml(order, Ui.getQueryParam('placed') === '1'));
    // The page reads fine without ?placed=1, so drop it: a reload will not show the thank-you banner again.
    window.history.replaceState(null, '', `bill.html?id=${encodeURIComponent(order.id)}`);
  }

  $(function () {
    load();
    $root.on('click', '#print-bill', () => window.print());
    $root.on('click', '[data-action="retry"]', load);
  });
})();
