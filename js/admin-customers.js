/* =====================================================================
   admin-customers.js - Admin > Customers page.

   "CRUD on the customer credit limit":
     Create : every new customer gets DEFAULT_CREDIT_LIMIT at sign-up (Phase 1)
     Read   : this paginated table (GET /customers?orderBy=name&pageToken=...)
              + search by e-mail (runQuery, e-mail starts with ...)
     Update : "Edit credit" -> PATCH customers/{uid}?updateMask.fieldPaths=creditLimit
     Delete : "Block new credit" quick button sets the limit to what is already
              used, so the customer has ₹0 available (a limit can never go
              below the amount already used)

   available = creditLimit - creditUsed
   ===================================================================== */

(function () {
  const PAGE_SIZE = CONFIG.ADMIN_PAGE_SIZE;
  const MAX_LIMIT = 1000000;
  const NEAR_LIMIT_SHARE = 0.8; // "used 80% or more"
  const R = Validate.rules;
  const esc = Ui.escapeHtml;

  const state = {
    mode: 'all',                   // 'all' | 'search'
    term: '',
    page: 1,                       // used by 'search' (offset pages)
    total: 0,
    pager: Ui.createTokenPager()   // used by 'all' (pageToken pages)
  };
  let customersOnPage = {};
  let requestCounter = 0;

  /* ------------------------------------------------------------------
     Credit helpers
     ------------------------------------------------------------------ */
  function available(customer) {
    return Math.max(0, (customer.creditLimit || 0) - (customer.creditUsed || 0));
  }

  /** Share of the limit already used, 0 to 1. */
  function usedShare(customer) {
    if (!customer.creditLimit) return customer.creditUsed > 0 ? 1 : 0;
    return Math.min(1, (customer.creditUsed || 0) / customer.creditLimit);
  }

  /** ok = plenty left, warn = 80%+ used, full = nothing left. */
  function creditLevel(customer) {
    if (available(customer) <= 0) return 'full';
    return usedShare(customer) >= NEAR_LIMIT_SHARE ? 'warn' : 'ok';
  }

  /**
   * <progress> is the HTML element for "how much of something is done".
   * It is accessible out of the box and needs no inline width style.
   */
  function creditBar(customer) {
    const limit = customer.creditLimit || 0;
    const used = Math.min(customer.creditUsed || 0, limit);
    return `
      <div class="credit-cell">
        <span class="credit-cell__amount">${Ui.formatMoney(available(customer))}</span>
        <progress class="credit-bar credit-bar--${creditLevel(customer)}" max="${limit || 1}" value="${used}"
                  aria-label="${Math.round(usedShare(customer) * 100)}% of the credit limit used"></progress>
      </div>`;
  }

  /* ------------------------------------------------------------------
     Summary cards (all customers)
     ------------------------------------------------------------------ */
  async function loadSummary() {
    try {
      const all = await Api.listAllCustomers();
      const totalLimit = all.reduce((sum, c) => sum + (c.creditLimit || 0), 0);
      const totalUsed = all.reduce((sum, c) => sum + (c.creditUsed || 0), 0);
      const near = all.filter((c) => creditLevel(c) !== 'ok').length;
      $('#sum-customers').text(all.length);
      $('#sum-limit').text(Ui.formatMoney(totalLimit));
      $('#sum-used').text(Ui.formatMoney(totalUsed));
      $('#sum-near').text(near);
    } catch (error) {
      $('#sum-customers, #sum-limit, #sum-used, #sum-near').text('?');
    }
  }

  /* ------------------------------------------------------------------
     Table
     ------------------------------------------------------------------ */
  function rowHtml(customer) {
    const letter = (customer.name || customer.email || '?').charAt(0);
    return `
      <tr data-id="${esc(customer.id)}">
        <td>
          <div class="cell-customer">
            <span class="avatar" aria-hidden="true">${esc(letter)}</span>
            <div class="min-w-0">
              <p class="cell-product__title">${esc(customer.name || '(no name)')}</p>
              <p class="cell-customer__email">${esc(customer.email)}</p>
            </div>
          </div>
        </td>
        <td>${customer.mobile ? esc(customer.mobile) : '<span class="text-muted">-</span>'}</td>
        <td class="num">${Ui.formatMoney(customer.creditLimit)}</td>
        <td class="num">${Ui.formatMoney(customer.creditUsed)}</td>
        <td>${creditBar(customer)}</td>
        <td class="text-muted hide-lg">${customer.createdAt ? Ui.formatDate(customer.createdAt, false) : '-'}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-action="edit-credit"
                    aria-label="Edit credit limit for ${esc(customer.name || customer.email)}">
              ${Icons.svg('wallet', 16)} Edit credit
            </button>
          </div>
        </td>
      </tr>`;
  }

  function emptyRow() {
    const searching = state.mode === 'search';
    return `<tr><td colspan="7">${Ui.emptyState({
      icon: searching ? 'search' : 'users',
      title: searching ? 'No customers match' : 'No customers yet',
      text: searching ? 'Try a different e-mail.' : 'Customers appear here as soon as they sign up.',
      action: searching ? '<button type="button" class="btn btn-secondary" data-action="clear-search">Clear search</button>' : ''
    })}</td></tr>`;
  }

  function pageNumber() {
    return state.mode === 'all' ? state.pager.page() : state.page;
  }

  function updateResultLine(itemCount) {
    let text = '';
    if (state.mode === 'search') {
      text = `${state.total} customer${state.total === 1 ? '' : 's'} with an e-mail starting with "${state.term}"`;
    } else if (state.total) {
      const from = (pageNumber() - 1) * PAGE_SIZE + 1;
      text = `Showing ${from}-${from + itemCount - 1} of ${state.total} customers`;
    }
    $('#customer-result-line').text(text);
    $('#customers-title').text(state.mode === 'search' ? 'Search results' : 'All customers');
  }

  async function loadPage() {
    const myRequest = ++requestCounter;
    const $rows = $('#customer-rows');
    $rows.html(Ui.skeletonRows(4, 7));
    $('#customer-pager').empty();

    try {
      let items;
      let hasNext;
      if (state.mode === 'all') {
        const result = await Api.listCustomers({ pageSize: PAGE_SIZE, pageToken: state.pager.currentToken() });
        items = result.items;
        state.pager.setNextToken(result.nextPageToken);
        hasNext = state.pager.hasNext();
      } else {
        const offset = (state.page - 1) * PAGE_SIZE;
        items = await Api.searchCustomersByEmail(state.term, { limit: PAGE_SIZE, offset });
        hasNext = offset + items.length < state.total;
      }
      if (myRequest !== requestCounter) return;

      customersOnPage = {};
      items.forEach((customer) => { customersOnPage[customer.id] = customer; });
      $rows.html(items.length ? items.map(rowHtml).join('') : emptyRow());
      updateResultLine(items.length);

      Ui.renderPagination($('#customer-pager'), {
        page: pageNumber(),
        totalPages: Math.max(1, Math.ceil(state.total / PAGE_SIZE)),
        hasPrev: pageNumber() > 1,
        hasNext,
        label: 'Customer pages',
        onChange(direction) {
          if (state.mode === 'all') {
            if (direction === 'next') state.pager.goNext();
            else state.pager.goPrev();
          } else {
            state.page += direction === 'next' ? 1 : -1;
          }
          loadPage();
        }
      });
    } catch (error) {
      if (myRequest !== requestCounter) return;
      Ui.showError(error, 'Could not load customers');
      $rows.html(`<tr><td colspan="7">${Ui.emptyState({
        icon: 'alert',
        title: 'Customers did not load',
        text: error.message,
        action: '<button type="button" class="btn btn-primary" data-action="retry">Try again</button>'
      })}</td></tr>`);
    }
  }

  async function applyFilter() {
    state.page = 1;
    state.pager.reset();
    try {
      state.total = await Api.countCustomers(state.mode === 'search' ? Api.emailPrefixFilter(state.term) : undefined);
    } catch (error) {
      state.total = 0;
    }
    await loadPage();
  }

  /* ------------------------------------------------------------------
     Edit credit limit (modal)
     ------------------------------------------------------------------ */
  function creditFormHtml(customer) {
    const used = customer.creditUsed || 0;
    return `
      <div class="credit-summary">
        <div class="credit-summary__item">
          <p class="credit-summary__label">Current limit</p>
          <p class="credit-summary__value">${Ui.formatMoney(customer.creditLimit)}</p>
        </div>
        <div class="credit-summary__item">
          <p class="credit-summary__label">Already used</p>
          <p class="credit-summary__value">${Ui.formatMoney(used)}</p>
        </div>
        <div class="credit-summary__item">
          <p class="credit-summary__label">Available now</p>
          <p class="credit-summary__value">${Ui.formatMoney(available(customer))}</p>
        </div>
      </div>

      <form class="form-grid" id="credit-form" novalidate>
        <div class="field">
          <label class="field-label" for="cf-limit">New credit limit</label>
          <div class="input-prefix">
            <span class="input-prefix__text" aria-hidden="true">₹</span>
            <input class="input" id="cf-limit" type="text" inputmode="decimal" required
                   aria-describedby="cf-limit-hint cf-limit-error">
          </div>
          <p class="field-hint" id="cf-limit-hint">
            It can't be lower than ${Ui.formatMoney(used)}, the amount already used.
          </p>
          <p class="field-error" id="cf-limit-error"></p>
        </div>

        <div class="quick-amounts" role="group" aria-label="Quick amounts">
          <button type="button" class="chip" data-quick="default">Default ${Ui.formatMoney(CONFIG.DEFAULT_CREDIT_LIMIT)}</button>
          <button type="button" class="chip" data-quick="500">+ ${Ui.formatMoney(500)}</button>
          <button type="button" class="chip" data-quick="1000">+ ${Ui.formatMoney(1000)}</button>
          <button type="button" class="chip chip--danger" data-quick="block">Block new credit</button>
        </div>

        <p class="credit-after" id="cf-after" aria-live="polite"></p>
      </form>`;
  }

  /** Rounds to 2 decimals so 0.1 + 0.2 style surprises never reach the database. */
  function money(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function openCreditForm(customer) {
    const used = customer.creditUsed || 0;
    const dialog = Ui.modal({
      title: `Credit for ${customer.name || customer.email}`,
      body: creditFormHtml(customer),
      footer: `
        <button type="button" class="btn btn-secondary" data-close-credit>Cancel</button>
        <button type="submit" class="btn btn-primary" form="credit-form" id="cf-save">${Icons.svg('check', 18)} Save limit</button>`
    });
    const $form = $('#credit-form');
    const $input = $('#cf-limit');
    $input.val(customer.creditLimit);

    const schema = {
      'cf-limit': [
        R.required('Please enter a credit limit.'),
        R.number({ decimals: 2, max: MAX_LIMIT, message: `Enter an amount up to ${Ui.formatMoney(MAX_LIMIT)} (at most 2 decimals).` }),
        R.number({ min: used, message: `It can't be lower than ${Ui.formatMoney(used)}, which the customer has already used.` })
      ]
    };
    Validate.live($form, schema);

    // "Available after saving: ..." updates while typing.
    function showAfter() {
      const value = Number($input.val());
      if ($input.val().trim() === '' || Number.isNaN(value)) {
        $('#cf-after').text('');
        return;
      }
      const after = Math.max(0, money(value - used));
      $('#cf-after').html(`Available after saving: <strong>${Ui.formatMoney(after)}</strong>`);
    }
    $input.on('input', showAfter);
    showAfter();

    // Quick amount buttons fill in the box.
    dialog.$modal.on('click', '[data-quick]', function () {
      const quick = $(this).data('quick');
      const current = Number($input.val()) || customer.creditLimit || 0;
      let next;
      if (quick === 'default') next = CONFIG.DEFAULT_CREDIT_LIMIT;
      else if (quick === 'block') next = used;
      else next = current + Number(quick);
      $input.val(money(next)).trigger('input');
      Validate.checkField('cf-limit', schema['cf-limit']);
    });

    dialog.$modal.on('click', '[data-close-credit]', () => dialog.close(null));

    $form.on('submit', async (event) => {
      event.preventDefault();
      if (!Validate.form($form, schema)) return;
      const newLimit = money($input.val());
      if (newLimit === customer.creditLimit) {
        Ui.toast('The credit limit is the same as before.', 'info', { title: 'No changes' });
        dialog.close(null);
        return;
      }

      const $save = $('#cf-save');
      Ui.setBusy($save, true, 'Saving...');
      try {
        // The customer may have bought something on credit since this page loaded.
        // Read the latest creditUsed before saving, so the limit is never below it.
        const fresh = await Api.getCustomer(customer.id);
        if (newLimit < (fresh.creditUsed || 0)) {
          Ui.setBusy($save, false);
          Validate.showError($input, `The customer has now used ${Ui.formatMoney(fresh.creditUsed)}. The limit can't be lower than that.`);
          $input.trigger('focus');
          return;
        }

        await Api.updateCreditLimit(customer.id, newLimit);
        const updated = { ...fresh, creditLimit: newLimit };
        customersOnPage[customer.id] = updated;
        $(`#customer-rows tr[data-id="${customer.id}"]`).replaceWith(rowHtml(updated));
        dialog.close(true);
        Ui.toast(
          `${updated.name || updated.email} now has a limit of ${Ui.formatMoney(newLimit)} (${Ui.formatMoney(available(updated))} available).`,
          'success',
          { title: 'Credit limit saved' }
        );
        loadSummary();
      } catch (error) {
        Ui.setBusy($save, false);
        Ui.showError(error, 'Could not save the credit limit');
      }
    });
  }

  /* ------------------------------------------------------------------
     Wiring
     ------------------------------------------------------------------ */
  $(function () {
    loadSummary();
    applyFilter();

    $('#customer-search').on('input', Ui.debounce(function () {
      // E-mails are saved in lower case, so the search is lower case too.
      state.term = $(this).val().trim().toLowerCase();
      state.mode = state.term ? 'search' : 'all';
      applyFilter();
    }, 400));
    $('#customer-filters').on('submit', (event) => event.preventDefault());

    $('#customer-rows').on('click', '[data-action]', function () {
      const action = $(this).data('action');
      const id = $(this).closest('tr').attr('data-id');
      if (action === 'retry') loadPage();
      if (action === 'clear-search') $('#customer-search').val('').trigger('input');
      if (action === 'edit-credit' && customersOnPage[id]) openCreditForm(customersOnPage[id]);
    });
  });
})();
