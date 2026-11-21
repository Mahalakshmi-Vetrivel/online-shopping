/* =====================================================================
   admin-dashboard.js - the admin home page.

   Four key numbers (Phase 6 brief):
     Total products  : runAggregationQuery count of the inventory
     Low-stock items : the same count with qty < LOW_STOCK
     Customers       : count of the customers collection
     Total sales     : the sum of every order's totalAmount
   plus: sales of the last 7 days, cash vs credit, the 5 newest orders,
   and the 5 products that most need restocking.

   Every request starts at the same time (Promise.all), so the page
   waits for the slowest one instead of for all of them one after another.
   ===================================================================== */

(function () {
  const C = ReportCalc;
  const esc = Ui.escapeHtml;
  const money = Ui.formatMoney;
  const int = (value) => Number(value).toLocaleString(CONFIG.LOCALE);
  const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

  function showStats(data) {
    const summary = C.summarise(data.orders);
    $('#stat-products').text(int(data.products));
    $('#stat-products-sub').text(`${int(data.active)} active in the store`);
    $('#stat-low').text(int(data.low));
    $('#stat-low-sub').text(`fewer than ${CONFIG.LOW_STOCK} units left`);
    $('#stat-customers').text(int(data.customers));
    $('#stat-customers-sub').text('registered accounts');
    $('#stat-sales').text(money(summary.revenue));
    $('#stat-sales-sub').text(`${int(summary.orders)} order${summary.orders === 1 ? '' : 's'}`);
  }

  /** One bar for each of the last 7 days (days without sales show an empty bar). */
  function showWeek(orders) {
    const byDay = new Map(C.byDay(orders).map((row) => [row.day, row]));
    const items = C.lastDays(7).map((day) => {
      const row = byDay.get(day);
      const revenue = row ? row.revenue : 0;
      const orderText = row ? ` (${row.orders} order${row.orders === 1 ? '' : 's'})` : '';
      return { label: Ui.formatDate(C.startOfDay(day), false), value: revenue, text: money(revenue) + orderText };
    });
    $('#dash-week').attr('aria-busy', 'false').html(Ui.barChart({ title: 'Revenue per day', items }));
  }

  function showPayments(orders) {
    const summary = C.summarise(orders);
    if (!orders.length) {
      $('#dash-pay').attr('aria-busy', 'false').html(Ui.emptyState({ icon: 'wallet', title: 'No orders yet', text: 'Cash and credit totals appear after the first order.' }));
      return;
    }
    $('#dash-pay').attr('aria-busy', 'false').html(Ui.barChart({
      title: 'Revenue by payment type',
      items: [
        { label: 'Cash', value: summary.cash, text: `${money(summary.cash)} (${percent(summary.cash, summary.revenue)}%)`, tone: 'a' },
        { label: 'Credit', value: summary.credit, text: `${money(summary.credit)} (${percent(summary.credit, summary.revenue)}%)`, tone: 'b' }
      ],
      note: `${int(summary.cashOrders)} cash order${summary.cashOrders === 1 ? '' : 's'} and ${int(summary.creditOrders)} credit order${summary.creditOrders === 1 ? '' : 's'}.`
    }));
  }

  function showRecent(orders) {
    if (!orders.length) {
      $('#dash-recent').attr('aria-busy', 'false').html(Ui.emptyState({ icon: 'receipt', title: 'No orders yet', text: 'New orders will appear here.' }));
      return;
    }
    const rows = orders.slice(0, 5).map((order) => `
      <tr>
        <td><code>${esc(order.id)}</code></td>
        <td>${esc(order.customerName)}</td>
        <td><span class="badge ${order.paymentType === 'credit' ? 'badge-info' : 'badge-muted'}">${order.paymentType === 'credit' ? 'Credit' : 'Cash'}</span></td>
        <td class="num">${money(order.totalAmount)}</td>
        <td class="text-muted">${order.createdAt ? Ui.formatDate(order.createdAt) : '-'}</td>
      </tr>`).join('');
    $('#dash-recent').attr('aria-busy', 'false').html(`
      <table class="data-table">
        <caption class="visually-hidden">The five newest orders</caption>
        <thead><tr><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Payment</th><th scope="col" class="num">Amount</th><th scope="col">Date</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
  }

  function showRestock(products) {
    if (!products.length) {
      $('#dash-restock').attr('aria-busy', 'false').html(Ui.emptyState({ icon: 'checkCircle', title: 'Stock looks healthy', text: `Nothing has fewer than ${CONFIG.LOW_STOCK} units.` }));
      return;
    }
    $('#dash-restock').attr('aria-busy', 'false').html(`<ul class="restock-list">${products.map((product) => `
      <li>
        <span class="restock-list__name">${esc(product.title)}<span class="restock-list__cat">${esc(product.categoryName)}</span></span>
        ${Ui.stockBadge(product.qty)}
      </li>`).join('')}</ul>`);
  }

  async function load() {
    $('#stat-products, #stat-low, #stat-customers, #stat-sales').html('<span class="skeleton"></span>');
    $('#dash-week, #dash-pay').attr('aria-busy', 'true').html('<div class="skeleton skeleton-tile"></div>');
    $('#dash-recent, #dash-restock').attr('aria-busy', 'true').html('<div class="skeleton skeleton-tile"></div>');

    try {
      const [products, active, low, customers, orders, restock] = await Promise.all([
        Api.countProducts(),
        Api.countProducts(Api.Query.where('isActive', '==', true)),
        Api.countProducts(Api.Query.where('qty', '<', CONFIG.LOW_STOCK)),
        Api.countCustomers(),
        Api.getAllOrders(),
        Api.lowStockProducts(5)
      ]);
      showStats({ products, active, low, customers, orders });
      showWeek(orders);
      showPayments(orders);
      showRecent(orders);
      showRestock(restock);
    } catch (error) {
      Ui.showError(error, 'Could not load the dashboard');
      $('#stat-products, #stat-low, #stat-customers, #stat-sales').text('?');
      const retry = '<button type="button" class="btn btn-primary" data-action="retry">Try again</button>';
      $('#dash-week').attr('aria-busy', 'false').html(Ui.emptyState({ icon: 'alert', title: 'Numbers did not load', text: error.message, action: retry }));
      $('#dash-pay, #dash-recent, #dash-restock').attr('aria-busy', 'false').empty();
    }
  }

  $(function () {
    load();
    $('#refresh-dashboard').on('click', load);
    $(document).on('click', '[data-action="retry"]', load);
  });
})();
