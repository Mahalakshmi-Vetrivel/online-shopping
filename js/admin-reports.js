/* =====================================================================
   admin-reports.js - Admin > Reports.

   Three groups (tabs), each with several reports (chips):
     Customers : All customers | Top 10 | Cash purchases | Credit purchases
     Inventory : Current stock | Category-wise | High stock | Low stock
     Sales     : All | Category-wise | Cash | Credit | Top 10 items | Bottom 10 items

   HOW A REPORT IS BUILT
     1. read the data (orders of the date range, products, customers)
     2. do the maths with ReportCalc (js/reports-calc.js)
     3. return ONE plain "result" object:
          { subtitle, summary, charts, columns, rows, totals }
     4. one renderer draws any result: summary cards, bar charts, a table
        with paging, and the same rows become the CSV download.
   Adding a new report = writing one more function that returns a result.
   ===================================================================== */

(function () {
  const C = ReportCalc;
  const esc = Ui.escapeHtml;
  const ROWS_PER_PAGE = 10;
  const TOP_N = 10;
  const ALL_TIME_FROM = '2020-01-01';

  /* ------------------------------------------------------------------
     The menu of reports
     ------------------------------------------------------------------ */
  const GROUPS = {
    customers: {
      label: 'Customers',
      types: {
        all: { label: 'All customers', dates: false },
        top10: { label: 'Top 10 customers', dates: true },
        cash: { label: 'Cash purchases', dates: true },
        credit: { label: 'Credit purchases', dates: true }
      }
    },
    inventory: {
      label: 'Inventory',
      types: {
        stock: { label: 'Current stock', dates: false, category: true },
        category: { label: 'Category-wise stock', dates: false },
        high: { label: `High stock (over ${CONFIG.HIGH_STOCK})`, dates: false, category: true },
        low: { label: `Low stock (under ${CONFIG.LOW_STOCK})`, dates: false, category: true }
      }
    },
    sales: {
      label: 'Sales',
      types: {
        all: { label: 'All sales', dates: true },
        category: { label: 'Category-wise', dates: true },
        cash: { label: 'Cash sales', dates: true },
        credit: { label: 'Credit sales', dates: true },
        top10: { label: 'Top 10 selling items', dates: true },
        bottom10: { label: 'Bottom 10 selling items', dates: true }
      }
    }
  };

  const state = { group: 'customers', type: 'all', from: '', to: '', cat: '' };
  let categories = [];
  let current = null;       // { result, page, key } the report on screen
  let requestCounter = 0;   // ignores answers that arrive after a newer request

  /* ------------------------------------------------------------------
     Small helpers
     ------------------------------------------------------------------ */
  const today = () => C.dayKey(new Date());
  const daysAgo = (n) => C.dayKey(new Date(Date.now() - n * 24 * 60 * 60 * 1000));
  const fmtDay = (day) => Ui.formatDate(C.startOfDay(day), false);
  const money = Ui.formatMoney;
  const int = (value) => Number(value).toLocaleString(CONFIG.LOCALE);
  const percent = (part, whole) => (whole ? (part / whole) * 100 : 0);

  const col = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });

  const paymentBadge = {
    html: (row) => `<span class="badge ${row.payment === 'credit' ? 'badge-info' : 'badge-muted'}">${row.payment === 'credit' ? 'Credit' : 'Cash'}</span>`,
    csv: (row) => (row.payment === 'credit' ? 'Credit' : 'Cash')
  };

  /** Low / High / In stock badge for a row that has `level` and `qty`. */
  const levelBadge = {
    html: (row) => {
      if (row.qty <= 0) return '<span class="badge badge-danger badge-dot">Out of stock</span>';
      if (row.level === 'low') return '<span class="badge badge-warning badge-dot">Low</span>';
      if (row.level === 'high') return '<span class="badge badge-accent badge-dot">High</span>';
      return '<span class="badge badge-success badge-dot">In stock</span>';
    },
    csv: (row) => (row.qty <= 0 ? 'Out of stock' : row.level === 'low' ? 'Low' : row.level === 'high' ? 'High' : 'In stock')
  };

  const statusBadge = {
    html: (row) => `<span class="badge ${row.active ? 'badge-success' : 'badge-muted'}">${row.active ? 'Active' : 'Hidden'}</span>`,
    csv: (row) => (row.active ? 'Active' : 'Hidden')
  };

  /** Orders between the From and To dates (inclusive, whole days, India time). */
  function ordersInRange() {
    return Api.getOrdersBetween(C.startOfDay(state.from), C.endOfDay(state.to));
  }

  const periodNote = () => `${fmtDay(state.from)} to ${fmtDay(state.to)}`;

  /** Result for "there is nothing to show". */
  function nothing(title, text) {
    return { empty: { title, text } };
  }
  const noOrders = () => nothing('No orders in this period', 'Try a wider range, for example "Last 30 days" or "All time".');

  /* ------------------------------------------------------------------
     CUSTOMER reports
     ------------------------------------------------------------------ */
  async function customersAll() {
    const customers = await Api.listAllCustomers();
    if (!customers.length) return nothing('No customers yet', 'Customers appear here when they sign up.');
    const rows = customers.map((customer) => ({
      name: customer.name || '(no name)',
      email: customer.email,
      mobile: customer.mobile || '',
      creditLimit: customer.creditLimit || 0,
      creditUsed: customer.creditUsed || 0,
      available: Math.max(0, C.round2((customer.creditLimit || 0) - (customer.creditUsed || 0))),
      createdAt: customer.createdAt
    }));
    const sum = (key) => C.round2(rows.reduce((total, row) => total + row[key], 0));
    return {
      subtitle: 'Every registered customer with all their details. This report always shows the current data.',
      summary: [
        { label: 'Customers', value: int(rows.length) },
        { label: 'Credit given', value: money(sum('creditLimit')) },
        { label: 'Credit used', value: money(sum('creditUsed')) },
        { label: 'Credit available', value: money(sum('available')) }
      ],
      columns: [
        col('name', 'Name'), col('email', 'E-mail'), col('mobile', 'Mobile'),
        col('creditLimit', 'Credit limit', 'money'), col('creditUsed', 'Credit used', 'money'),
        col('available', 'Available', 'money'), col('createdAt', 'Joined', 'date')
      ],
      rows,
      totals: { creditLimit: sum('creditLimit'), creditUsed: sum('creditUsed'), available: sum('available') }
    };
  }

  async function customersTop10() {
    const orders = await ordersInRange();
    if (!orders.length) return noOrders();
    const summary = C.summarise(orders);
    const groups = C.byCustomer(orders);
    const top = groups.slice(0, TOP_N).map((group, index) => ({ rank: index + 1, ...group, share: percent(group.total, summary.revenue) }));
    const topShare = percent(top.reduce((total, row) => total + row.total, 0), summary.revenue);
    return {
      subtitle: `The customers who spent the most, ${periodNote()}.`,
      summary: [
        { label: 'Customers who bought', value: int(groups.length) },
        { label: 'Orders', value: int(summary.orders) },
        { label: 'Revenue', value: money(summary.revenue) },
        { label: `Top ${top.length} share`, value: `${topShare.toFixed(1)}%` }
      ],
      charts: [{ title: 'Purchase amount by customer', items: top.map((row) => ({ label: row.name, value: row.total, text: money(row.total) })) }],
      columns: [
        col('rank', '#', 'int'), col('name', 'Customer'), col('email', 'E-mail'), col('orders', 'Orders', 'int'),
        col('units', 'Units', 'int'), col('total', 'Total spent', 'money'), col('cash', 'Cash', 'money'),
        col('credit', 'Credit', 'money'), col('share', 'Share of revenue', 'percent')
      ],
      rows: top
    };
  }

  /** "Cash purchases" and "Credit purchases": one row per customer who paid that way. */
  async function customersByPayment() {
    const orders = C.onlyPayment(await ordersInRange(), state.type);
    const label = state.type === 'credit' ? 'credit' : 'cash';
    if (!orders.length) return nothing(`No ${label} purchases in this period`, 'Try a wider range, for example "All time".');
    const groups = C.byCustomer(orders);
    const rows = groups.map((group) => ({ name: group.name, email: group.email, orders: group.orders, units: group.units, amount: group.total }));
    const summary = C.summarise(orders);
    return {
      subtitle: `Customers who paid by ${label}, ${periodNote()}.`,
      summary: [
        { label: 'Customers', value: int(rows.length) },
        { label: 'Orders', value: int(summary.orders) },
        { label: `${label === 'cash' ? 'Cash' : 'Credit'} amount`, value: money(summary.revenue) },
        { label: 'Average order', value: money(summary.average) }
      ],
      charts: [{
        title: `${label === 'cash' ? 'Cash' : 'Credit'} purchases by customer${rows.length > TOP_N ? ` (top ${TOP_N})` : ''}`,
        items: rows.slice(0, TOP_N).map((row) => ({ label: row.name, value: row.amount, text: money(row.amount), tone: label === 'credit' ? 'b' : 'a' }))
      }],
      columns: [col('name', 'Customer'), col('email', 'E-mail'), col('orders', 'Orders', 'int'), col('units', 'Units', 'int'), col('amount', 'Amount', 'money')],
      rows,
      totals: { orders: summary.orders, units: summary.units, amount: summary.revenue }
    };
  }

  /* ------------------------------------------------------------------
     INVENTORY reports (always the current stock)
     ------------------------------------------------------------------ */
  function stockRows(products) {
    return products.map((product) => ({
      title: product.title,
      category: product.categoryName,
      price: product.price,
      qty: product.qty,
      value: C.round2(product.price * product.qty),
      level: C.stockLevel(product.qty),
      active: product.isActive
    }));
  }

  const STOCK_COLUMNS = [
    col('title', 'Product'), col('category', 'Category'), col('price', 'Price', 'money'), col('qty', 'In stock', 'int'),
    col('value', 'Stock value', 'money'), col('level', 'Level', 'html', levelBadge), col('active', 'Status', 'html', statusBadge)
  ];

  async function inventoryList() {
    let products = await Api.listAllProducts();
    if (state.cat) products = products.filter((product) => product.catId === state.cat);
    const kind = state.type;
    if (kind === 'high') products = products.filter((product) => product.qty > CONFIG.HIGH_STOCK).sort((a, b) => b.qty - a.qty);
    if (kind === 'low') products = products.filter((product) => product.qty < CONFIG.LOW_STOCK).sort((a, b) => a.qty - b.qty);
    if (!products.length) {
      return nothing(kind === 'stock' ? 'No products' : 'No products match', kind === 'stock' ? 'Nothing is in this category yet.' : 'No product is in this stock range.');
    }
    const rows = stockRows(products);
    const units = rows.reduce((total, row) => total + row.qty, 0);
    const value = C.round2(rows.reduce((total, row) => total + row.value, 0));
    const where = state.cat ? ` in ${categories.find((category) => category.id === state.cat)?.name || 'this category'}` : '';
    const subtitle = {
      stock: `Every product${where} with its quantity and stock value. Hidden products are included.`,
      high: `Products${where} with more than ${CONFIG.HIGH_STOCK} units: plenty in stock, highest first.`,
      low: `Products${where} with fewer than ${CONFIG.LOW_STOCK} units: time to restock, lowest first.`
    }[kind];
    return {
      subtitle,
      summary: [
        { label: 'Products', value: int(rows.length) },
        { label: 'Units in stock', value: int(units) },
        { label: 'Stock value', value: money(value) },
        { label: 'Out of stock', value: int(rows.filter((row) => row.qty <= 0).length) }
      ],
      charts: kind === 'stock' ? [] : [{
        title: kind === 'high' ? 'Units in stock (highest)' : 'Units left (lowest)',
        items: rows.slice(0, TOP_N).map((row) => ({ label: row.title, value: row.qty, text: `${int(row.qty)} units`, tone: kind === 'low' ? 'a' : 'b' }))
      }],
      columns: STOCK_COLUMNS,
      rows,
      totals: { qty: units, value }
    };
  }

  async function inventoryByCategory() {
    const products = await Api.listAllProducts();
    const rows = C.stockByCategory(products, categories);
    const units = rows.reduce((total, row) => total + row.units, 0);
    const value = C.round2(rows.reduce((total, row) => total + row.value, 0));
    return {
      subtitle: 'Stock added up per category. Categories with no products are listed with zeros.',
      summary: [
        { label: 'Categories', value: int(rows.length) },
        { label: 'Products', value: int(products.length) },
        { label: 'Units in stock', value: int(units) },
        { label: 'Stock value', value: money(value) }
      ],
      charts: [{ title: 'Units in stock by category', items: rows.map((row) => ({ label: row.category, value: row.units, text: `${int(row.units)} units` })) }],
      columns: [
        col('category', 'Category'), col('products', 'Products', 'int'), col('units', 'Units', 'int'),
        col('value', 'Stock value', 'money'), col('low', `Low (<${CONFIG.LOW_STOCK})`, 'int'), col('high', `High (>${CONFIG.HIGH_STOCK})`, 'int')
      ],
      rows,
      totals: {
        products: products.length, units, value,
        low: rows.reduce((total, row) => total + row.low, 0), high: rows.reduce((total, row) => total + row.high, 0)
      }
    };
  }

  /* ------------------------------------------------------------------
     SALES reports
     ------------------------------------------------------------------ */
  function orderRows(orders) {
    return orders.map((order) => ({
      id: order.id, date: order.createdAt, customer: order.customerName, payment: order.paymentType,
      items: order.items.length, units: C.unitsOf(order), amount: order.totalAmount
    }));
  }

  /** "All sales", "Cash sales", "Credit sales": a list of orders with totals and charts. */
  async function salesOrders() {
    let orders = await ordersInRange();
    if (state.type !== 'all') orders = C.onlyPayment(orders, state.type);
    if (!orders.length) {
      return state.type === 'all' ? noOrders() : nothing(`No ${state.type} sales in this period`, 'Try a wider range, for example "All time".');
    }
    const summary = C.summarise(orders);
    const rows = orderRows(orders);
    const days = C.byDay(orders);
    const tone = state.type === 'credit' ? 'b' : 'a';
    const cards = [
      { label: 'Orders', value: int(summary.orders) },
      { label: 'Units sold', value: int(summary.units) },
      { label: 'Revenue', value: money(summary.revenue) },
      { label: 'Average order', value: money(summary.average) }
    ];
    const charts = [{
      title: 'Revenue by day',
      items: days.map((day) => ({ label: fmtDay(day.day), value: day.revenue, text: money(day.revenue), tone: state.type === 'all' ? 'a' : tone }))
    }];
    if (state.type === 'all') {
      cards.push({ label: 'Cash', value: `${money(summary.cash)} (${summary.cashOrders})` }, { label: 'Credit', value: `${money(summary.credit)} (${summary.creditOrders})` });
      charts.push({
        title: 'Cash vs credit',
        items: [
          { label: 'Cash', value: summary.cash, text: `${money(summary.cash)} (${percent(summary.cash, summary.revenue).toFixed(0)}%)`, tone: 'a' },
          { label: 'Credit', value: summary.credit, text: `${money(summary.credit)} (${percent(summary.credit, summary.revenue).toFixed(0)}%)`, tone: 'b' }
        ]
      });
    }
    const names = { all: 'All sales', cash: 'Cash sales', credit: 'Credit sales' };
    return {
      subtitle: `${names[state.type]}, ${periodNote()}. Newest first.`,
      summary: cards,
      charts,
      columns: [
        col('id', 'Order', 'code'), col('date', 'Date', 'date'), col('customer', 'Customer'),
        col('payment', 'Payment', 'html', paymentBadge), col('items', 'Lines', 'int'), col('units', 'Units', 'int'), col('amount', 'Amount', 'money')
      ],
      rows,
      totals: { items: rows.reduce((t, r) => t + r.items, 0), units: summary.units, amount: summary.revenue }
    };
  }

  async function salesByCategory() {
    const orders = await ordersInRange();
    if (!orders.length) return noOrders();
    const summary = C.summarise(orders);
    const rows = C.byCategory(orders).map((row) => ({ ...row, share: percent(row.revenue, summary.revenue) }));
    return {
      subtitle: `Sales split by product category, ${periodNote()}.`,
      summary: [
        { label: 'Categories with sales', value: int(rows.length) },
        { label: 'Units sold', value: int(summary.units) },
        { label: 'Revenue', value: money(summary.revenue) },
        { label: 'Best category', value: rows[0].category }
      ],
      charts: [{ title: 'Revenue by category', items: rows.map((row) => ({ label: row.category, value: row.revenue, text: money(row.revenue) })) }],
      columns: [
        col('category', 'Category'), col('orders', 'Orders', 'int'), col('units', 'Units', 'int'),
        col('revenue', 'Revenue', 'money'), col('share', 'Share', 'percent')
      ],
      rows,
      totals: { units: summary.units, revenue: summary.revenue }
    };
  }

  async function salesTop10() {
    const orders = await ordersInRange();
    if (!orders.length) return noOrders();
    const products = C.byProduct(orders);
    const rows = products.slice(0, TOP_N).map((row, index) => ({ rank: index + 1, ...row }));
    const summary = C.summarise(orders);
    return {
      subtitle: `The best-selling items by units sold, ${periodNote()}.`,
      summary: [
        { label: 'Different items sold', value: int(products.length) },
        { label: 'Units sold', value: int(summary.units) },
        { label: 'Revenue', value: money(summary.revenue) },
        { label: 'Best seller', value: rows[0].title }
      ],
      charts: [{ title: 'Units sold', items: rows.map((row) => ({ label: row.title, value: row.units, text: `${int(row.units)} units` })) }],
      columns: [
        col('rank', '#', 'int'), col('title', 'Item'), col('category', 'Category'),
        col('units', 'Units sold', 'int'), col('revenue', 'Revenue', 'money'), col('orders', 'Orders', 'int')
      ],
      rows
    };
  }

  /** Bottom 10 counts ALL active products, so items that did not sell at all (0 units) come first. */
  async function salesBottom10() {
    const [orders, products] = await Promise.all([ordersInRange(), Api.listAllProducts()]);
    const sold = new Map(C.byProduct(orders).map((row) => [row.productId, row]));
    const active = products.filter((product) => product.isActive);
    const ranked = active.map((product) => {
      const row = sold.get(product.id);
      return { title: product.title, category: product.categoryName, units: row ? row.units : 0, revenue: row ? row.revenue : 0, stock: product.qty };
    }).sort((a, b) => a.units - b.units || a.revenue - b.revenue || a.title.localeCompare(b.title));
    const rows = ranked.slice(0, TOP_N).map((row, index) => ({ rank: index + 1, ...row }));
    const unsold = ranked.filter((row) => row.units === 0).length;
    return {
      subtitle: `The slowest-selling items, ${periodNote()}. Items that did not sell at all are included, so they appear first.`,
      summary: [
        { label: 'Active products', value: int(active.length) },
        { label: 'Sold nothing', value: int(unsold) },
        { label: 'Orders in period', value: int(orders.length) },
        { label: 'Slowest item', value: rows[0] ? rows[0].title : '-' }
      ],
      charts: [{ title: 'Units sold (lowest first)', items: rows.map((row) => ({ label: row.title, value: row.units, text: `${int(row.units)} units`, tone: 'b' })), note: unsold > TOP_N ? `${unsold - TOP_N} more items also sold nothing.` : '' }],
      columns: [
        col('rank', '#', 'int'), col('title', 'Item'), col('category', 'Category'),
        col('units', 'Units sold', 'int'), col('revenue', 'Revenue', 'money'), col('stock', 'In stock now', 'int')
      ],
      rows
    };
  }

  const BUILDERS = {
    'customers/all': customersAll,
    'customers/top10': customersTop10,
    'customers/cash': customersByPayment,
    'customers/credit': customersByPayment,
    'inventory/stock': inventoryList,
    'inventory/category': inventoryByCategory,
    'inventory/high': inventoryList,
    'inventory/low': inventoryList,
    'sales/all': salesOrders,
    'sales/category': salesByCategory,
    'sales/cash': salesOrders,
    'sales/credit': salesOrders,
    'sales/top10': salesTop10,
    'sales/bottom10': salesBottom10
  };

  /* ------------------------------------------------------------------
     Drawing one result (the same for every report)
     ------------------------------------------------------------------ */
  const NUMERIC = ['int', 'money', 'percent'];

  /** The text shown in a table cell. */
  function cellHtml(column, row) {
    const value = row[column.key];
    switch (column.type) {
      case 'money': return money(value);
      case 'int': return int(value);
      case 'percent': return `${Number(value).toFixed(1)}%`;
      case 'date': return value ? Ui.formatDate(value) : '-';
      case 'html': return column.html(row);
      case 'code': return `<code>${esc(value)}</code>`;
      default: return esc(value === '' || value === null || value === undefined ? '-' : value);
    }
  }

  /** The value written to the CSV file (numbers stay numbers, so Excel can add them up). */
  function csvValue(column, row) {
    const value = row[column.key];
    switch (column.type) {
      case 'money': return C.round2(value);
      case 'int': return value;
      case 'percent': return Number(value).toFixed(1);
      case 'date': return value ? Ui.formatDate(value) : '';
      case 'html': return column.csv(row);
      default: return value;
    }
  }

  function summaryHtml(cards) {
    return `<dl class="report-summary">${cards.map((card) => `
      <div class="report-stat"><dt>${esc(card.label)}</dt><dd>${esc(card.value)}</dd></div>`).join('')}</dl>`;
  }

  function tableHtml(result, page) {
    const from = (page - 1) * ROWS_PER_PAGE;
    const pageRows = result.rows.slice(from, from + ROWS_PER_PAGE);
    const head = result.columns.map((column) => `<th scope="col" class="${NUMERIC.includes(column.type) ? 'num' : ''}">${esc(column.label)}</th>`).join('');
    const body = pageRows.map((row) => `<tr>${result.columns.map((column) =>
      `<td class="${NUMERIC.includes(column.type) ? 'num' : ''}">${cellHtml(column, row)}</td>`).join('')}</tr>`).join('');
    let foot = '';
    if (result.totals) {
      foot = `<tfoot><tr>${result.columns.map((column, index) => {
        if (index === 0) return '<th scope="row">Total</th>';
        const has = Object.prototype.hasOwnProperty.call(result.totals, column.key);
        return `<td class="${NUMERIC.includes(column.type) ? 'num' : ''}">${has ? cellHtml(column, result.totals) : ''}</td>`;
      }).join('')}</tr></tfoot>`;
    }
    return `
      <div class="table-wrap">
        <table class="data-table report-table">
          <caption class="visually-hidden">${esc(result.title)}</caption>
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
          ${foot}
        </table>
      </div>`;
  }

  function renderTable() {
    const { result, page } = current;
    $('#report-table').html(tableHtml(result, page));
    const totalPages = Math.max(1, Math.ceil(result.rows.length / ROWS_PER_PAGE));
    Ui.renderPagination($('#report-pager'), {
      page, totalPages, hasPrev: page > 1, hasNext: page < totalPages, label: 'Report pages',
      onChange(direction) {
        current.page += direction === 'next' ? 1 : -1;
        renderTable();
      }
    });
    const from = (page - 1) * ROWS_PER_PAGE;
    $('#report-rowcount').text(`Showing ${from + 1}-${Math.min(from + ROWS_PER_PAGE, result.rows.length)} of ${result.rows.length} row${result.rows.length === 1 ? '' : 's'}`);
  }

  function renderResult(result) {
    if (result.empty) {
      current = null;
      $('#download-csv').prop('disabled', true);
      $('#report-output').attr('aria-busy', 'false').html(Ui.emptyState({ icon: 'chart', title: result.empty.title, text: result.empty.text }));
      return;
    }
    result.title = `${GROUPS[state.group].label}: ${GROUPS[state.group].types[state.type].label}`;
    current = { result, page: 1 };
    const charts = (result.charts || []).filter((chart) => chart.items.length)
      .map((chart) => `<div class="report-chart">${Ui.barChart(chart)}</div>`).join('');
    $('#report-output').attr('aria-busy', 'false').html(`
      <header class="report-head">
        <h3 class="report-head__title">${esc(result.title)}</h3>
        <p class="report-head__sub">${esc(result.subtitle)}</p>
      </header>
      ${summaryHtml(result.summary)}
      ${charts ? `<div class="report-charts">${charts}</div>` : ''}
      <p class="result-line report-rowcount" id="report-rowcount" aria-live="polite"></p>
      <div id="report-table"></div>
      <div id="report-pager"></div>
      <p class="report-foot">Generated ${Ui.formatDate(new Date())} (India time).</p>`);
    renderTable();
    $('#download-csv').prop('disabled', false);
  }

  /* ------------------------------------------------------------------
     Controls
     ------------------------------------------------------------------ */
  function currentType() {
    return GROUPS[state.group].types[state.type];
  }

  function renderControls() {
    // tabs
    $('.report-tab').each(function () {
      const selected = $(this).data('group') === state.group;
      $(this).attr('aria-selected', String(selected)).attr('tabindex', selected ? '0' : '-1');
    });
    $('#report-panel').attr('aria-labelledby', `tab-${state.group}`);

    // report chips of the group
    $('#report-types').html(Object.keys(GROUPS[state.group].types).map((type) => `
      <button type="button" class="chip" data-type="${type}" aria-pressed="${type === state.type}">${esc(GROUPS[state.group].types[type].label)}</button>`).join(''));

    // filters this report needs
    const type = currentType();
    $('#date-filters').prop('hidden', !type.dates);
    $('#category-filter').prop('hidden', !type.category);
    if (!type.category) state.cat = '';
    $('#rf-category').val(state.cat);
    $('#rf-from').val(state.from);
    $('#rf-to').val(state.to);
    window.history.replaceState(null, '', `#${state.group}/${state.type}`);
  }

  /** From and To must be filled in, and From may not be after To. */
  function datesValid() {
    if (!currentType().dates) return true;
    Validate.clearError($('#rf-from'));
    Validate.clearError($('#rf-to'));
    if (!state.from) { Validate.showError($('#rf-from'), 'Choose a From date.'); return false; }
    if (!state.to) { Validate.showError($('#rf-to'), 'Choose a To date.'); return false; }
    if (state.from > state.to) { Validate.showError($('#rf-to'), 'The To date must not be before the From date.'); return false; }
    return true;
  }

  async function run() {
    renderControls();
    if (!datesValid()) {
      current = null;
      $('#download-csv').prop('disabled', true);
      $('#report-output').attr('aria-busy', 'false').html(Ui.emptyState({ icon: 'alert', title: 'Check the dates', text: 'Choose a valid From and To date to see this report.' }));
      return;
    }
    const myRequest = ++requestCounter;
    $('#download-csv').prop('disabled', true);
    $('#report-output').attr('aria-busy', 'true').html(`
      <div class="report-loading" aria-hidden="true">
        <div class="report-summary">${'<div class="skeleton skeleton-tile"></div>'.repeat(4)}</div>
        <table class="data-table"><tbody>${Ui.skeletonRows(5, 5)}</tbody></table>
      </div>
      <p class="visually-hidden" role="status">Loading the report</p>`);
    try {
      const result = await BUILDERS[`${state.group}/${state.type}`]();
      if (myRequest !== requestCounter) return;
      renderResult(result);
    } catch (error) {
      if (myRequest !== requestCounter) return;
      Ui.showError(error, 'Could not build the report');
      $('#report-output').attr('aria-busy', 'false').html(Ui.emptyState({
        icon: 'alert', title: 'The report did not load', text: error.message,
        action: '<button type="button" class="btn btn-primary" data-action="retry">Try again</button>'
      }));
    }
  }

  function applyPreset(preset) {
    state.to = today();
    state.from = { today: today(), '7d': daysAgo(6), '30d': daysAgo(29), month: `${today().slice(0, 8)}01`, all: ALL_TIME_FROM }[preset];
    run();
  }

  function downloadCsv() {
    if (!current) return;
    const { result } = current;
    const headers = result.columns.map((column) => column.label);
    const rows = result.rows.map((row) => result.columns.map((column) => csvValue(column, row)));
    if (result.totals) {
      rows.push(result.columns.map((column, index) => (index === 0 ? 'Total' : Object.prototype.hasOwnProperty.call(result.totals, column.key) ? csvValue(column, result.totals) : '')));
    }
    const period = currentType().dates ? `-${state.from}_to_${state.to}` : '';
    Ui.downloadCsv(`shopnest-${state.group}-${state.type}${period}.csv`, headers, rows);
  }

  /** Reads "#sales/top10" from the address, so a report can be bookmarked. */
  function readHash() {
    const [group, type] = window.location.hash.replace('#', '').split('/');
    if (GROUPS[group]) {
      state.group = group;
      state.type = GROUPS[group].types[type] ? type : Object.keys(GROUPS[group].types)[0];
    }
  }

  $(async function () {
    state.to = today();
    state.from = daysAgo(29); // default: the last 30 days
    readHash();

    try {
      categories = await Api.getCategories();
      $('#rf-category').append(categories.map((category) => `<option value="${esc(category.id)}">${esc(category.name)}</option>`).join(''));
    } catch (error) {
      Ui.showError(error, 'Could not load categories');
    }

    // Tabs: click, and arrow keys / Home / End (the keyboard pattern for tabs)
    $('#report-tabs').on('click', '.report-tab', function () {
      state.group = $(this).data('group');
      state.type = Object.keys(GROUPS[state.group].types)[0];
      state.cat = '';
      run();
    });
    $('#report-tabs').on('keydown', '.report-tab', function (event) {
      const keys = Object.keys(GROUPS);
      let index = keys.indexOf($(this).data('group'));
      if (event.key === 'ArrowRight') index = (index + 1) % keys.length;
      else if (event.key === 'ArrowLeft') index = (index - 1 + keys.length) % keys.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = keys.length - 1;
      else return;
      event.preventDefault();
      $(`#tab-${keys[index]}`).trigger('click').trigger('focus');
    });

    $('#report-types').on('click', '[data-type]', function () {
      state.type = $(this).data('type');
      run();
    });
    $('#rf-from, #rf-to').on('change', function () {
      state.from = $('#rf-from').val();
      state.to = $('#rf-to').val();
      run();
    });
    $('#report-filters').on('click', '[data-preset]', function () { applyPreset($(this).data('preset')); });
    $('#rf-category').on('change', function () { state.cat = $(this).val(); run(); });
    $('#report-filters').on('submit', (event) => event.preventDefault());
    $('#download-csv').on('click', downloadCsv);

    // Back / Forward buttons and links like reports.html#sales/top10 change only the "#..." part.
    // (replaceState in renderControls does not fire this event, so there is no loop.)
    window.addEventListener('hashchange', () => {
      readHash();
      state.cat = '';
      run();
    });
    $('#report-output').on('click', '[data-action="retry"]', run);

    run();
  });
})();
