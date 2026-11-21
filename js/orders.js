/* =====================================================================
   orders.js - "My orders": the customer's order history (orders.html).

   Reads every order of the signed-in customer (runQuery customerId == uid),
   newest first, and shows them 5 per page with a Cash / Credit filter.
   A small credit card at the top shows limit, used and available.
   ===================================================================== */

(function () {
  const PAGE_SIZE = 5;
  const MAX_THUMBS = 4;
  const esc = Ui.escapeHtml;

  const state = { filter: 'all', page: 1 };
  let orders = [];
  let imageByProduct = {}; // productId -> imageUrl, so order rows can show real photos

  /* ------------------------------------------------------------------
     Pieces
     ------------------------------------------------------------------ */
  function thumbHtml(item) {
    return Placeholder.image(
      { title: item.title, categoryName: item.categoryName, imageUrl: imageByProduct[item.productId] || '' },
      { size: 'thumb' }
    );
  }

  function orderCard(order) {
    const credit = order.paymentType === 'credit';
    const units = order.items.reduce((sum, item) => sum + item.qty, 0);
    const shown = order.items.slice(0, MAX_THUMBS);
    const more = order.items.length - shown.length;
    return `
      <article class="order-card">
        <header class="order-card__head">
          <div>
            <p class="order-card__id">Order <code>${esc(order.id)}</code></p>
            <p class="order-card__date">${order.createdAt ? Ui.formatDate(order.createdAt) : '-'}</p>
          </div>
          <div class="order-card__badges">
            <span class="badge ${credit ? 'badge-info' : 'badge-muted'}">${credit ? 'Credit' : 'Cash'}</span>
            <span class="badge badge-accent badge-dot">${order.status === 'PLACED' ? 'Placed' : esc(order.status)}</span>
          </div>
        </header>

        <div class="order-card__body">
          <ul class="order-card__thumbs" aria-label="Items in this order">
            ${shown.map((item) => `<li title="${esc(item.title)}">${thumbHtml(item)}</li>`).join('')}
            ${more > 0 ? `<li class="order-card__more">+${more}</li>` : ''}
          </ul>
          <p class="order-card__items">${esc(order.items.map((item) => `${item.title} × ${item.qty}`).join(', '))}</p>
        </div>

        <footer class="order-card__foot">
          <p class="order-card__total"><span>${units} item${units === 1 ? '' : 's'}</span> <strong>${Ui.formatMoney(order.totalAmount)}</strong></p>
          <a class="btn btn-secondary btn-sm" href="bill.html?id=${encodeURIComponent(order.id)}">${Icons.svg('receipt', 16)} View bill</a>
        </footer>
      </article>`;
  }

  function visibleOrders() {
    return state.filter === 'all' ? orders : orders.filter((order) => order.paymentType === state.filter);
  }

  function renderChips() {
    const count = (type) => (type === 'all' ? orders.length : orders.filter((order) => order.paymentType === type).length);
    const chip = (type, label) => `
      <button type="button" class="chip" data-filter="${type}" aria-pressed="${state.filter === type}">
        ${label} <span class="chip__count">${count(type)}</span>
      </button>`;
    $('#order-filters').html(chip('all', 'All') + chip('cash', 'Cash') + chip('credit', 'Credit'));
  }

  function renderList() {
    const list = visibleOrders();
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages);
    const from = (state.page - 1) * PAGE_SIZE;
    const pageItems = list.slice(from, from + PAGE_SIZE);

    $('#order-list').attr('aria-busy', 'false').html(
      pageItems.length
        ? pageItems.map(orderCard).join('')
        : Ui.emptyState({
          icon: 'receipt',
          title: orders.length ? 'No orders of this kind' : 'No orders yet',
          text: orders.length ? 'Try another filter.' : 'When you place an order, it will appear here with its bill.',
          action: orders.length
            ? '<button type="button" class="btn btn-secondary" data-filter="all">Show all orders</button>'
            : '<a class="btn btn-primary" href="index.html#products">Start shopping</a>'
        })
    );
    $('#order-count-line').text(list.length ? `Showing ${from + 1}-${from + pageItems.length} of ${list.length} order${list.length === 1 ? '' : 's'}` : '');

    Ui.renderPagination($('#order-pager'), {
      page: state.page,
      totalPages,
      hasPrev: state.page > 1,
      hasNext: state.page < totalPages,
      label: 'Order pages',
      onChange(direction) {
        state.page += direction === 'next' ? 1 : -1;
        renderList();
        document.getElementById('order-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  function renderSummary(customer) {
    const spent = orders.reduce((sum, order) => sum + order.totalAmount, 0);
    const limit = customer.creditLimit || 0;
    const used = Math.min(customer.creditUsed || 0, limit);
    const available = Math.max(0, limit - (customer.creditUsed || 0));
    $('#orders-summary').html(`
      <div class="mini-stat">
        <span class="mini-stat__icon tone-1">${Icons.svg('receipt', 18)}</span>
        <div><p class="mini-stat__value">${orders.length}</p><p class="mini-stat__label">Orders</p></div>
      </div>
      <div class="mini-stat">
        <span class="mini-stat__icon tone-6">${Icons.svg('wallet', 18)}</span>
        <div><p class="mini-stat__value">${Ui.formatMoney(spent)}</p><p class="mini-stat__label">Total spent</p></div>
      </div>
      <div class="mini-stat mini-stat--credit">
        <span class="mini-stat__icon tone-7">${Icons.svg('bolt', 18)}</span>
        <div>
          <p class="mini-stat__value">${Ui.formatMoney(available)} <small>available</small></p>
          <progress class="credit-bar ${available <= 0 ? 'credit-bar--full' : ''}" max="${limit || 1}" value="${used}"
                    aria-label="${limit ? Math.round((used / limit) * 100) : 100}% of your credit limit used"></progress>
          <p class="mini-stat__label">${Ui.formatMoney(customer.creditUsed || 0)} used of ${Ui.formatMoney(limit)}</p>
        </div>
      </div>`);
  }

  /* ------------------------------------------------------------------
     Loading
     ------------------------------------------------------------------ */
  async function load() {
    $('#order-list').attr('aria-busy', 'true').html(Ui.skeletonCards(3));
    try {
      const user = Auth.currentUser();
      const [list, customer, products] = await Promise.all([
        Api.getCustomerOrders(user.uid),
        Api.getCustomer(user.uid).catch(() => ({ creditLimit: 0, creditUsed: 0 })),
        Api.getActiveProducts().catch(() => []) // photos are a bonus: never block the page on them
      ]);
      orders = list;
      imageByProduct = {};
      products.forEach((product) => { imageByProduct[product.id] = product.imageUrl; });
      renderSummary(customer);
      renderChips();
      renderList();
    } catch (error) {
      Ui.showError(error, 'Could not load your orders');
      $('#order-list').attr('aria-busy', 'false').html(Ui.emptyState({
        icon: 'alert',
        title: 'Your orders did not load',
        text: error.message,
        action: '<button type="button" class="btn btn-primary" data-action="retry">Try again</button>'
      }));
    }
  }

  $(function () {
    load();
    $(document).on('click', '[data-filter]', function () {
      state.filter = $(this).data('filter');
      state.page = 1;
      renderChips();
      renderList();
    });
    $(document).on('click', '[data-action="retry"]', load);
  });
})();
