/* =====================================================================
   reports-calc.js - the MATHS behind the reports and the dashboard.
   Only plain functions: they take orders / products as arrays of plain
   objects and return totals and groups. No screen code, no server calls,
   so every number can be checked by hand.

   Firestore cannot GROUP BY, so we read the orders of a date range and
   group them here with plain loops and Maps.
   ===================================================================== */

const ReportCalc = (function () {
  const IST = 'Asia/Kolkata'; // all days and dates in the shop are Indian time

  const round2 = (value) => Math.round(value * 100) / 100;

  /* ------------------------------------------------------------------
     Days (India time)
     ------------------------------------------------------------------ */
  // The 'en-CA' locale writes dates as yyyy-mm-dd, which is exactly what <input type="date"> uses.
  const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' });

  /** A moment -> its Indian calendar day, "2026-08-31". */
  function dayKey(date) {
    return dayFormatter.format(date);
  }

  /** "2026-08-31" -> 00:00:00 that day in India (a real moment in time). */
  function startOfDay(day) {
    return new Date(`${day}T00:00:00+05:30`);
  }

  /** "2026-08-31" -> 23:59:59.999 that day, so a "To date" includes the WHOLE day. */
  function endOfDay(day) {
    return new Date(`${day}T23:59:59.999+05:30`);
  }

  /** The last `count` days ending today, oldest first: ["2026-11-15", ..., "2026-11-21"]. */
  function lastDays(count, now = new Date()) {
    const days = [];
    for (let back = count - 1; back >= 0; back--) {
      days.push(dayKey(new Date(now.getTime() - back * 24 * 60 * 60 * 1000)));
    }
    return days;
  }

  /* ------------------------------------------------------------------
     Order totals
     ------------------------------------------------------------------ */
  const unitsOf = (order) => order.items.reduce((sum, item) => sum + item.qty, 0);

  /** Whole-period numbers: how many orders, units, revenue, cash vs credit. */
  function summarise(orders) {
    const result = { orders: orders.length, units: 0, revenue: 0, cash: 0, credit: 0, cashOrders: 0, creditOrders: 0 };
    orders.forEach((order) => {
      result.units += unitsOf(order);
      result.revenue += order.totalAmount;
      if (order.paymentType === 'credit') {
        result.credit += order.totalAmount;
        result.creditOrders++;
      } else {
        result.cash += order.totalAmount;
        result.cashOrders++;
      }
    });
    result.revenue = round2(result.revenue);
    result.cash = round2(result.cash);
    result.credit = round2(result.credit);
    result.average = orders.length ? round2(result.revenue / orders.length) : 0;
    return result;
  }

  /** Orders of one payment type ('cash' | 'credit'). */
  function onlyPayment(orders, type) {
    return orders.filter((order) => (order.paymentType === 'credit') === (type === 'credit'));
  }

  /* ------------------------------------------------------------------
     Grouping (each returns rows sorted from biggest to smallest)
     ------------------------------------------------------------------ */

  /** One row per customer: orders, units, total, and how much was cash / credit. */
  function byCustomer(orders) {
    const groups = new Map();
    orders.forEach((order) => {
      if (!groups.has(order.customerId)) {
        groups.set(order.customerId, {
          customerId: order.customerId, name: order.customerName, email: order.customerEmail,
          orders: 0, units: 0, total: 0, cash: 0, credit: 0
        });
      }
      const row = groups.get(order.customerId);
      row.orders++;
      row.units += unitsOf(order);
      row.total += order.totalAmount;
      if (order.paymentType === 'credit') row.credit += order.totalAmount;
      else row.cash += order.totalAmount;
    });
    return [...groups.values()]
      .map((row) => ({ ...row, total: round2(row.total), cash: round2(row.cash), credit: round2(row.credit) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }

  /** One row per category: units and revenue of the items sold, and in how many orders it appeared. */
  function byCategory(orders) {
    const groups = new Map();
    orders.forEach((order) => {
      order.items.forEach((item) => {
        if (!groups.has(item.categoryName)) groups.set(item.categoryName, { category: item.categoryName, units: 0, revenue: 0, orderIds: new Set() });
        const row = groups.get(item.categoryName);
        row.units += item.qty;
        row.revenue += item.lineTotal;
        row.orderIds.add(order.id);
      });
    });
    return [...groups.values()]
      .map((row) => ({ category: row.category, units: row.units, revenue: round2(row.revenue), orders: row.orderIds.size }))
      .sort((a, b) => b.revenue - a.revenue || a.category.localeCompare(b.category));
  }

  /** One row per product that was sold: units (the "selling" measure), revenue, orders. */
  function byProduct(orders) {
    const groups = new Map();
    orders.forEach((order) => {
      order.items.forEach((item) => {
        if (!groups.has(item.productId)) groups.set(item.productId, { productId: item.productId, title: item.title, category: item.categoryName, units: 0, revenue: 0, orderIds: new Set() });
        const row = groups.get(item.productId);
        row.units += item.qty;
        row.revenue += item.lineTotal;
        row.orderIds.add(order.id);
      });
    });
    return [...groups.values()]
      .map((row) => ({ productId: row.productId, title: row.title, category: row.category, units: row.units, revenue: round2(row.revenue), orders: row.orderIds.size }))
      .sort((a, b) => b.units - a.units || b.revenue - a.revenue || a.title.localeCompare(b.title));
  }

  /** One row per day that had sales, oldest first. */
  function byDay(orders) {
    const groups = new Map();
    orders.forEach((order) => {
      if (!order.createdAt) return;
      const day = dayKey(order.createdAt);
      if (!groups.has(day)) groups.set(day, { day, orders: 0, revenue: 0 });
      const row = groups.get(day);
      row.orders++;
      row.revenue += order.totalAmount;
    });
    return [...groups.values()]
      .map((row) => ({ ...row, revenue: round2(row.revenue) }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }

  /* ------------------------------------------------------------------
     Stock
     ------------------------------------------------------------------ */

  /** 'low' below LOW_STOCK, 'high' above HIGH_STOCK, otherwise 'normal' (the rules from config.js). */
  function stockLevel(qty) {
    if (qty < CONFIG.LOW_STOCK) return 'low';
    if (qty > CONFIG.HIGH_STOCK) return 'high';
    return 'normal';
  }

  /** One row per category (even empty ones): products, units, value, low / high counts. */
  function stockByCategory(products, categories) {
    const groups = new Map(categories.map((category) => [category.id, { category: category.name, products: 0, units: 0, value: 0, low: 0, high: 0 }]));
    products.forEach((product) => {
      if (!groups.has(product.catId)) groups.set(product.catId, { category: product.categoryName, products: 0, units: 0, value: 0, low: 0, high: 0 });
      const row = groups.get(product.catId);
      row.products++;
      row.units += product.qty;
      row.value += product.qty * product.price;
      if (stockLevel(product.qty) === 'low') row.low++;
      if (stockLevel(product.qty) === 'high') row.high++;
    });
    return [...groups.values()]
      .map((row) => ({ ...row, value: round2(row.value) }))
      .sort((a, b) => b.units - a.units || a.category.localeCompare(b.category));
  }

  return {
    IST, round2, dayKey, startOfDay, endOfDay, lastDays,
    unitsOf, summarise, onlyPayment,
    byCustomer, byCategory, byProduct, byDay,
    stockLevel, stockByCategory
  };
})();
