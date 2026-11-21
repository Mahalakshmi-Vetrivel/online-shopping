/* =====================================================================
   test-api.js - logic for test-api.html (Phase 0 developer page).
   Exercises api.js (real Firestore calls) and every ui.js component.
   This file is deleted together with test-api.html in Phase 7.
   ===================================================================== */

(function () {
  const PAGE_SIZE = 5;
  const pager = Ui.createTokenPager();
  let totalProducts = 0;
  let cartDemoCount = 0;

  /* ---------- 1. Categories ---------- */
  async function loadCategories() {
    const $button = $('#reload-categories');
    Ui.setBusy($button, true, 'Loading...');
    $('#category-status').html('');
    $('#category-chips').html(Ui.skeletonChips(8));
    $('#category-rows').html(Ui.skeletonRows(6, 3));

    const startedAt = performance.now();
    try {
      const categories = await Api.getCategories();
      const ms = Math.round(performance.now() - startedAt);

      $('#category-status').html(
        `<span class="badge badge-success badge-dot">Loaded ${categories.length} categories in ${ms} ms</span>`
      );

      $('#category-chips').html(categories.map((category) => `
        <button type="button" class="chip ${Placeholder.toneClass(category.name)}" aria-pressed="false" data-name="${Ui.escapeHtml(category.name)}">
          <span class="chip-icon">${Placeholder.categoryIcon(category.name, 16)}</span>
          ${Ui.escapeHtml(category.name)}
        </button>`).join(''));

      $('#category-rows').html(categories.map((category, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${Ui.escapeHtml(category.name)}</td>
          <td><code>${Ui.escapeHtml(category.id)}</code></td>
        </tr>`).join(''));
    } catch (error) {
      Ui.showError(error, 'Could not load categories');
      $('#category-status').html(`<span class="badge badge-danger badge-dot">${Ui.escapeHtml(error.message)}</span>`);
      $('#category-chips').empty();
      $('#category-rows').empty();
    } finally {
      Ui.setBusy($button, false);
    }
  }

  /* ---------- 2. Inventory with pageToken ---------- */
  async function loadInventoryPage() {
    $('#inventory-rows').html(Ui.skeletonRows(PAGE_SIZE, 4));
    try {
      const { items, nextPageToken } = await Api.listDocs('inventory', {
        pageSize: PAGE_SIZE,
        orderBy: 'title',
        pageToken: pager.currentToken()
      });
      pager.setNextToken(nextPageToken);

      $('#inventory-rows').html(items.map((product) => `
        <tr>
          <td>
            <span class="cell-product">
              ${Placeholder.image(product, { size: 'thumb' })}
              ${Ui.escapeHtml(product.title)}
            </span>
          </td>
          <td>${Ui.escapeHtml(product.categoryName)}</td>
          <td class="num">${Ui.formatMoney(product.price)}</td>
          <td>${Ui.stockBadge(product.qty)}</td>
        </tr>`).join(''));

      Ui.renderPagination($('#inventory-pager'), {
        page: pager.page(),
        totalPages: totalProducts ? Math.ceil(totalProducts / PAGE_SIZE) : null,
        hasPrev: pager.hasPrev(),
        hasNext: pager.hasNext(),
        label: 'Inventory pages',
        onChange(direction) {
          if (direction === 'next') pager.goNext();
          else pager.goPrev();
          loadInventoryPage();
        }
      });

      $('#token-view').text(pager.currentToken() || '(none: this is page 1)');
    } catch (error) {
      Ui.showError(error, 'Could not load inventory');
      $('#inventory-rows').html(`<tr><td colspan="4">${Ui.escapeHtml(error.message)}</td></tr>`);
    }
  }

  async function loadInventoryTotal() {
    try {
      totalProducts = await Api.count('inventory');
      $('#inventory-total').text(`${totalProducts} products (runAggregationQuery)`);
    } catch (error) {
      $('#inventory-total').text('Count unavailable');
    }
  }

  /* ---------- 3. Converter round-trip ---------- */
  function showConverters() {
    const plain = {
      title: 'Wireless Earbuds Pro',
      price: 1999,
      qty: 85,
      isActive: true,
      createdAt: new Date('2026-11-20T10:00:00Z'),
      tags: ['audio', 'bluetooth']
    };
    const typed = Api.toFirestore(plain);
    // Pretend the server sent it back, with a document name.
    const back = Api.fromFirestore({
      name: `projects/${CONFIG.PROJECT_ID}/databases/(default)/documents/inventory/DEMO123`,
      fields: typed.fields
    });

    $('#converter-plain').text(JSON.stringify(plain, null, 2));
    $('#converter-typed').text(JSON.stringify(typed, null, 2));
    $('#converter-back').text(JSON.stringify(back, null, 2));

    // Everything except the id must be identical to what we started with.
    const { id, _updateTime, ...fields } = back;
    const same = JSON.stringify(fields) === JSON.stringify(plain) && id === 'DEMO123';
    $('#converter-result').html(same
      ? '<span class="badge badge-success badge-dot">Round-trip OK</span>'
      : '<span class="badge badge-danger badge-dot">Mismatch</span>');
  }

  /* ---------- 4. UI components ---------- */
  const TOAST_SAMPLES = {
    success: 'Wireless Earbuds Pro was added to your cart.',
    info: 'Prices include all taxes.',
    warning: 'Only 3 left in stock. Order soon!',
    error: 'Cannot reach the server. Please check your internet connection.'
  };

  function wireComponentDemos() {
    $('[data-toast]').on('click', function () {
      const type = $(this).data('toast');
      Ui.toast(TOAST_SAMPLES[type], type);
    });

    $('#demo-confirm').on('click', async () => {
      const yes = await Ui.confirm({
        title: 'Delete this product?',
        message: '"Wireless Earbuds Pro" will be removed permanently. This cannot be undone.',
        confirmText: 'Yes, delete',
        cancelText: 'No, keep it',
        danger: true
      });
      Ui.toast(yes ? 'You chose YES. (Nothing was deleted, this is a demo.)' : 'You chose NO.', yes ? 'success' : 'info');
    });

    $('#demo-modal').on('click', () => {
      const dialog = Ui.modal({
        title: 'Edit product',
        body: `
          <div class="form-grid">
            <div class="field">
              <label class="field-label" for="demo-title">Title <span class="required" aria-hidden="true">*</span></label>
              <input class="input" id="demo-title" type="text" value="Wireless Earbuds Pro" required>
            </div>
            <div class="field">
              <label class="field-label" for="demo-price">Price (₹)</label>
              <input class="input" id="demo-price" type="number" min="0" step="0.01" value="1999">
              <p class="field-hint">Edit forms in Phase 2 use this same modal.</p>
            </div>
          </div>`,
        footer: `
          <button type="button" class="btn btn-secondary" data-close>Cancel</button>
          <button type="button" class="btn btn-primary" data-save>Save changes</button>`
      });
      dialog.$modal.on('click', '[data-close]', () => dialog.close(null));
      dialog.$modal.on('click', '[data-save]', () => {
        dialog.close(true);
        Ui.toast('Changes saved (demo only).', 'success');
      });
    });

    $('#demo-busy').on('click', function () {
      const $button = $(this);
      Ui.setBusy($button, true, 'Saving...');
      setTimeout(() => {
        Ui.setBusy($button, false);
        Ui.toast('Saved! The button was disabled while busy, so double clicks were ignored.', 'success');
      }, 2000);
    });

    $('#demo-cart').on('click', () => {
      cartDemoCount++;
      Layout.setCartCount(cartDemoCount);
    });

    $('#demo-badges').html([0, 8, 50, 140].map((qty) => Ui.stockBadge(qty)).join(''));

    $('[data-preview]').on('click', function () {
      const type = $(this).data('preview');
      const $preview = $('#demo-preview');
      if (type === 'skeleton') $preview.html(`<div class="bench-skeleton-grid">${Ui.skeletonCards(2)}</div>`);
      if (type === 'loader') $preview.html(Ui.loader('Loading products...'));
      if (type === 'empty') {
        $preview.html(Ui.emptyState({
          icon: 'cart',
          title: 'Your cart is empty',
          text: 'Looks like you have not added anything yet. Let us fix that!',
          action: '<a class="btn btn-primary" href="index.html#products">Start shopping</a>'
        }));
      }
    });

    // Chips toggle their "pressed" state, like the store filters will.
    $('#category-chips').on('click', '.chip', function () {
      $('#category-chips .chip').attr('aria-pressed', 'false');
      $(this).attr('aria-pressed', 'true');
    });
  }

  $(async function () {
    showConverters();
    wireComponentDemos();
    $('#reload-categories').on('click', loadCategories);
    loadCategories();
    await loadInventoryTotal();
    loadInventoryPage();
  });
})();
