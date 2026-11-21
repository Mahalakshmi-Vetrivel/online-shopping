/* =====================================================================
   admin-inventory.js - Admin > Inventory page (CRUD on products).

   READ (with pagination), three modes:
     "all"      GET /inventory?orderBy=title&pageSize=10&pageToken=...   (token pager)
     "category" runQuery catId == X, limit + offset                      (page numbers)
     "search"   runQuery title starts with "Wire", limit + offset        (page numbers)
   CREATE  : "Add product" opens a form in a modal -> POST (Firestore makes the ID)
   UPDATE  : "Edit" opens the same form filled in -> PATCH with updateMask
             (only the fields that really changed are sent; the ID can't change)
   ACTIVATE / DEACTIVATE : the switch in the Status column (soft delete)
   DELETE  : bin button -> "Confirm? Yes / No" -> DELETE (permanent)
   ===================================================================== */

(function () {
  const PAGE_SIZE = CONFIG.ADMIN_PAGE_SIZE;
  // A path inside this project, or a full web address.
  const IMAGE_URL_PATTERN = /^(https?:\/\/\S+|assets\/[\w\-./]+\.(jpe?g|png|webp|gif|svg))$/i;
  const R = Validate.rules;

  // Everything about "what is on screen now" lives in one object.
  const state = {
    mode: 'all',                    // 'all' | 'category' | 'search'
    catId: '',
    term: '',
    page: 1,                        // used by 'category' and 'search'
    total: 0,                       // how many products match the filter
    pager: Ui.createTokenPager()    // used by 'all'
  };

  let categories = [];
  let productsOnPage = {};          // id -> product, for the rows currently shown
  let requestCounter = 0;           // ignores old answers if the admin clicks quickly

  /* ------------------------------------------------------------------
     Small helpers
     ------------------------------------------------------------------ */
  const esc = Ui.escapeHtml;

  function categoryName(catId) {
    const found = categories.find((category) => category.id === catId);
    return found ? found.name : '';
  }

  /** Firestore search is case-sensitive and titles start with a capital: "wire" -> "Wire". */
  function normaliseSearch(text) {
    const trimmed = text.trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : '';
  }

  /** The Firestore filter that matches the current mode (undefined = no filter). */
  function currentFilter() {
    if (state.mode === 'search') return Api.titlePrefixFilter(state.term);
    if (state.mode === 'category') return Api.Query.where('catId', '==', state.catId);
    return undefined;
  }

  function currentPageNumber() {
    return state.mode === 'all' ? state.pager.page() : state.page;
  }

  /* ------------------------------------------------------------------
     Summary numbers at the top (4 counts at the same time)
     ------------------------------------------------------------------ */
  async function loadCounts() {
    const Q = Api.Query;
    try {
      const [all, active, inactive, low] = await Promise.all([
        Api.countProducts(),
        Api.countProducts(Q.where('isActive', '==', true)),
        Api.countProducts(Q.where('isActive', '==', false)),
        Api.countProducts(Q.where('qty', '<', CONFIG.LOW_STOCK))
      ]);
      $('#count-all').text(all);
      $('#count-active').text(active);
      $('#count-inactive').text(inactive);
      $('#count-low').text(low);
    } catch (error) {
      $('#count-all, #count-active, #count-inactive, #count-low').text('?');
    }
  }

  /* ------------------------------------------------------------------
     Table rows
     ------------------------------------------------------------------ */
  function statusSwitch(product) {
    return `
      <button type="button" class="switch" role="switch" aria-checked="${product.isActive}"
              data-action="toggle" aria-label="Show ${esc(product.title)} in the store">
        <span class="switch__track"><span class="switch__thumb"></span></span>
        <span class="switch__text">${product.isActive ? 'Active' : 'Hidden'}</span>
      </button>`;
  }

  function rowHtml(product) {
    return `
      <tr data-id="${esc(product.id)}" class="${product.isActive ? '' : 'is-inactive'}">
        <td>
          <div class="cell-product">
            ${Placeholder.image(product, { size: 'thumb' })}
            <div class="min-w-0">
              <p class="cell-product__title">${esc(product.title)}</p>
              <p class="cell-product__id">ID: ${esc(product.id)}</p>
            </div>
          </div>
        </td>
        <td class="cell-wrap">${esc(product.categoryName)}</td>
        <td class="num">${Ui.formatMoney(product.price)}</td>
        <td>${Ui.stockBadge(product.qty)}</td>
        <td>${statusSwitch(product)}</td>
        <td class="text-muted hide-lg">${Ui.formatDate(product.updatedAt || product.createdAt, false)}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn btn-ghost btn-icon" data-action="edit"
                    aria-label="Edit ${esc(product.title)}" title="Edit">${Icons.svg('edit', 18)}</button>
            <button type="button" class="btn btn-ghost btn-icon btn-icon-danger" data-action="delete"
                    aria-label="Delete ${esc(product.title)}" title="Delete">${Icons.svg('trash', 18)}</button>
          </div>
        </td>
      </tr>`;
  }

  function emptyRow() {
    const filtered = state.mode !== 'all';
    return `
      <tr><td colspan="7">
        ${Ui.emptyState({
          icon: filtered ? 'search' : 'box',
          title: filtered ? 'No products match' : 'No products yet',
          text: filtered ? 'Try another search, or clear the filters.' : 'Add your first product to get started.',
          action: filtered
            ? '<button type="button" class="btn btn-secondary" data-action="clear-filters">Clear filters</button>'
            : ''
        })}
      </td></tr>`;
  }

  function updateResultLine(itemCount) {
    let text;
    if (!state.total) {
      text = '';
    } else if (state.mode === 'search') {
      text = `${state.total} product${state.total === 1 ? '' : 's'} starting with "${state.term}"`;
    } else if (state.mode === 'category') {
      text = `${state.total} product${state.total === 1 ? '' : 's'} in ${categoryName(state.catId)}`;
    } else {
      const from = (currentPageNumber() - 1) * PAGE_SIZE + 1;
      text = `Showing ${from}-${from + itemCount - 1} of ${state.total} products`;
    }
    $('#result-line').text(text);
    $('#inventory-title').text(
      state.mode === 'category' ? categoryName(state.catId) : state.mode === 'search' ? 'Search results' : 'All products'
    );
  }

  /* ------------------------------------------------------------------
     Load one page
     ------------------------------------------------------------------ */
  async function loadPage() {
    const myRequest = ++requestCounter;
    const $rows = $('#inventory-rows');
    $rows.html(Ui.skeletonRows(5, 7));
    $('#inventory-pager').empty();

    try {
      let items;
      let hasNext;

      if (state.mode === 'all') {
        const result = await Api.listProducts({ pageSize: PAGE_SIZE, pageToken: state.pager.currentToken() });
        items = result.items;
        state.pager.setNextToken(result.nextPageToken);
        hasNext = state.pager.hasNext();
      } else {
        const offset = (state.page - 1) * PAGE_SIZE;
        const options = { limit: PAGE_SIZE, offset };
        items = state.mode === 'category'
          ? await Api.productsByCategory(state.catId, options)
          : await Api.searchProducts(state.term, options);
        hasNext = offset + items.length < state.total;
      }

      if (myRequest !== requestCounter) return; // a newer request has started

      // After deleting the last item of a page, step back one page.
      if (!items.length && currentPageNumber() > 1) {
        if (state.mode === 'all') state.pager.goPrev();
        else state.page--;
        loadPage();
        return;
      }

      productsOnPage = {};
      items.forEach((product) => { productsOnPage[product.id] = product; });
      $rows.html(items.length ? items.map(rowHtml).join('') : emptyRow());
      updateResultLine(items.length);

      Ui.renderPagination($('#inventory-pager'), {
        page: currentPageNumber(),
        totalPages: Math.max(1, Math.ceil(state.total / PAGE_SIZE)),
        hasPrev: currentPageNumber() > 1,
        hasNext,
        label: 'Product pages',
        onChange(direction) {
          if (state.mode === 'all') {
            if (direction === 'next') state.pager.goNext();
            else state.pager.goPrev();
          } else {
            state.page += direction === 'next' ? 1 : -1;
          }
          loadPage();
          document.getElementById('inventory-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    } catch (error) {
      if (myRequest !== requestCounter) return;
      Ui.showError(error, 'Could not load products');
      $rows.html(`<tr><td colspan="7">${Ui.emptyState({
        icon: 'alert',
        title: 'Products did not load',
        text: error.message,
        action: '<button type="button" class="btn btn-primary" data-action="retry">Try again</button>'
      })}</td></tr>`);
    }
  }

  /** Re-counts the matching products, then shows page 1. Used whenever a filter changes. */
  async function applyFilter() {
    state.page = 1;
    state.pager.reset();
    try {
      state.total = await Api.countProducts(currentFilter());
    } catch (error) {
      state.total = 0;
    }
    await loadPage();
  }

  /** After create / delete: counts changed, stay on the same page if possible. */
  async function refreshAfterChange() {
    loadCounts();
    try {
      state.total = await Api.countProducts(currentFilter());
    } catch (error) {
      // keep the old total
    }
    await loadPage();
  }

  /* ------------------------------------------------------------------
     Activate / Deactivate (soft delete)
     ------------------------------------------------------------------ */
  async function toggleActive(id, $switch) {
    const product = productsOnPage[id];
    const makeActive = !product.isActive;
    $switch.prop('disabled', true).addClass('is-busy');
    try {
      await Api.setProductActive(id, makeActive);
      product.isActive = makeActive;
      product.updatedAt = new Date();
      $(`#inventory-rows tr[data-id="${id}"]`).replaceWith(rowHtml(product));
      $(`#inventory-rows tr[data-id="${id}"] [data-action="toggle"]`).trigger('focus'); // keep keyboard focus
      Ui.toast(
        makeActive ? `"${product.title}" is back in the store.` : `"${product.title}" is now hidden from customers.`,
        'success',
        { title: makeActive ? 'Activated' : 'Deactivated' }
      );
      loadCounts();
    } catch (error) {
      Ui.showError(error, 'Could not change the status');
      $switch.prop('disabled', false).removeClass('is-busy');
    }
  }

  /* ------------------------------------------------------------------
     Delete (permanent, after Yes / No)
     ------------------------------------------------------------------ */
  async function deleteProduct(id, $button) {
    const product = productsOnPage[id];
    const yes = await Ui.confirm({
      title: 'Delete this product?',
      message: `"${product.title}" will be removed permanently. Past orders keep their own copy. ` +
        'If you only want to hide it, use the Status switch instead.',
      confirmText: 'Yes, delete',
      cancelText: 'No, keep it',
      danger: true
    });
    if (!yes) return;

    Ui.setBusy($button, true, '');
    try {
      await Api.deleteProduct(id);
      Ui.toast(`"${product.title}" was deleted.`, 'success', { title: 'Deleted' });
      await refreshAfterChange();
    } catch (error) {
      Ui.setBusy($button, false);
      Ui.showError(error, 'Could not delete the product');
    }
  }

  /* ------------------------------------------------------------------
     Create / Edit form (one modal for both)
     ------------------------------------------------------------------ */
  function categoryOptions() {
    return '<option value="">Choose a category</option>' +
      categories.map((category) => `<option value="${esc(category.id)}">${esc(category.name)}</option>`).join('');
  }

  function formHtml(product) {
    const idField = product ? `
      <div class="field">
        <span class="field-label">Product ID</span>
        <p class="readonly-id"><code>${esc(product.id)}</code><span class="field-hint">Created by Firestore. It can't be changed.</span></p>
      </div>` : '';

    return `
      <form class="product-form" id="product-form" novalidate>
        <div class="form-grid">
          ${idField}
          <div class="field">
            <label class="field-label" for="pf-title">Title</label>
            <input class="input" id="pf-title" type="text" maxlength="80" required aria-describedby="pf-title-error">
            <p class="field-error" id="pf-title-error"></p>
          </div>

          <div class="field-pair">
            <div class="field">
              <label class="field-label" for="pf-category">Category</label>
              <select class="input" id="pf-category" required aria-describedby="pf-category-error">${categoryOptions()}</select>
              <p class="field-error" id="pf-category-error"></p>
            </div>
            <div class="field">
              <label class="field-label" for="pf-price">Price</label>
              <div class="input-prefix">
                <span class="input-prefix__text" aria-hidden="true">₹</span>
                <input class="input" id="pf-price" type="text" inputmode="decimal" required aria-describedby="pf-price-error">
              </div>
              <p class="field-error" id="pf-price-error"></p>
            </div>
          </div>

          <div class="field-pair">
            <div class="field">
              <label class="field-label" for="pf-qty">Quantity in stock</label>
              <input class="input" id="pf-qty" type="text" inputmode="numeric" required aria-describedby="pf-qty-hint pf-qty-error">
              <p class="field-hint" id="pf-qty-hint">Low stock below ${CONFIG.LOW_STOCK}, high above ${CONFIG.HIGH_STOCK}.</p>
              <p class="field-error" id="pf-qty-error"></p>
            </div>
            <div class="field">
              <span class="field-label" id="pf-active-label">Visible in store</span>
              <label class="switch switch--field">
                <input type="checkbox" class="switch__input" id="pf-active" aria-labelledby="pf-active-label">
                <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
                <span class="switch__text" id="pf-active-text">Active</span>
              </label>
            </div>
          </div>

          <div class="field">
            <div class="field-row">
              <label class="field-label" for="pf-description">Description</label>
              <span class="char-count" id="pf-description-count" aria-hidden="true">0 / 500</span>
            </div>
            <textarea class="input" id="pf-description" maxlength="500" rows="3" required aria-describedby="pf-description-error"></textarea>
            <p class="field-error" id="pf-description-error"></p>
          </div>

          <div class="field">
            <label class="field-label" for="pf-image">Image URL <span class="text-muted">(optional)</span></label>
            <input class="input" id="pf-image" type="text" autocomplete="off" spellcheck="false"
                   placeholder="assets/images/products/yoga-mat-6mm.jpg" aria-describedby="pf-image-hint pf-image-error">
            <p class="field-hint" id="pf-image-hint">A photo in this project, or a link starting with https://. Empty = a generated picture.</p>
            <p class="field-error" id="pf-image-error"></p>
          </div>
        </div>

        <aside class="product-form__preview" aria-label="Live preview">
          <p class="field-label">Live preview</p>
          <div id="pf-preview"></div>
          <p class="field-hint">This is how customers will see the card.</p>
        </aside>
      </form>`;
  }

  /** Reads the form into a plain product object. */
  function readForm() {
    const catId = $('#pf-category').val();
    return {
      title: $('#pf-title').val().trim().replace(/\s+/g, ' '),
      catId,
      categoryName: categoryName(catId),
      description: $('#pf-description').val().trim(),
      price: Number($('#pf-price').val().trim()),
      qty: parseInt($('#pf-qty').val().trim(), 10),
      imageUrl: $('#pf-image').val().trim(),
      isActive: $('#pf-active').is(':checked')
    };
  }

  /** The card on the right side of the form, updated while the admin types. */
  function renderPreview() {
    const draft = readForm();
    const product = {
      title: draft.title || 'Product title',
      categoryName: draft.categoryName || 'Category',
      imageUrl: IMAGE_URL_PATTERN.test(draft.imageUrl) ? draft.imageUrl : '',
      price: Number.isFinite(draft.price) ? draft.price : 0
    };
    $('#pf-preview').html(`
      <article class="product-card product-card--preview ${draft.isActive ? '' : 'is-hidden-product'}">
        <div class="product-card__media">${Placeholder.image(product)}</div>
        <div class="product-card__body">
          <p class="product-card__cat">${esc(product.categoryName)}</p>
          <h3 class="product-card__title">${esc(product.title)}</h3>
          <div class="product-card__foot">
            <span class="product-card__price">${Ui.formatMoney(product.price)}</span>
            ${draft.isActive ? '' : '<span class="badge badge-muted">Hidden</span>'}
          </div>
        </div>
      </article>`);
    $('#pf-description-count').text(`${$('#pf-description').val().length} / 500`);
    $('#pf-active-text').text(draft.isActive ? 'Active' : 'Hidden');
  }

  const formSchema = {
    'pf-title': [R.required('Please enter a title.'), R.length(2, 80, 'Use 2 to 80 characters.')],
    'pf-category': [R.required('Please choose a category.')],
    'pf-price': [
      R.required('Please enter a price.'),
      R.number({ min: 1, max: 1000000, decimals: 2, message: 'Enter a price from ₹1 to ₹10,00,000 (up to 2 decimals).' })
    ],
    'pf-qty': [
      R.required('Please enter the quantity.'),
      R.number({ min: 0, max: 100000, integer: true, message: 'Enter a whole number from 0 to 1,00,000.' })
    ],
    'pf-description': [R.required('Please add a short description.'), R.length(10, 500, 'Use 10 to 500 characters.')],
    'pf-image': [R.pattern(IMAGE_URL_PATTERN, 'Use a path like assets/images/products/name.jpg, or a link starting with https://')]
  };

  /** Only the fields whose value is different from the saved product. */
  function changedFields(original, edited) {
    const changes = {};
    Object.keys(edited).forEach((key) => {
      const before = original[key] === undefined ? '' : original[key];
      if (before !== edited[key]) changes[key] = edited[key];
    });
    return changes;
  }

  function openProductForm(product = null) {
    const isEdit = Boolean(product);
    const dialog = Ui.modal({
      title: isEdit ? 'Edit product' : 'Add a new product',
      size: 'modal--xl',
      body: formHtml(product),
      footer: `
        <button type="button" class="btn btn-secondary" data-close-form>Cancel</button>
        <button type="submit" class="btn btn-primary" form="product-form" id="pf-save">
          ${Icons.svg('check', 18)} ${isEdit ? 'Save changes' : 'Add product'}
        </button>`
    });
    const $form = $('#product-form');

    // Fill in the values (with .val(), so quotes in titles are safe).
    if (isEdit) {
      $('#pf-title').val(product.title);
      $('#pf-category').val(product.catId);
      $('#pf-price').val(product.price);
      $('#pf-qty').val(product.qty);
      $('#pf-description').val(product.description);
      $('#pf-image').val(product.imageUrl || '');
      $('#pf-active').prop('checked', product.isActive);
    } else {
      if (state.mode === 'category') $('#pf-category').val(state.catId); // handy default
      $('#pf-active').prop('checked', true);
    }
    renderPreview();

    Validate.live($form, formSchema);
    $form.on('input change', Ui.debounce(renderPreview, 200));
    dialog.$modal.on('click', '[data-close-form]', () => dialog.close(null));

    $form.on('submit', async (event) => {
      event.preventDefault();
      if (!Validate.form($form, formSchema)) return;

      const data = readForm();
      const $save = $('#pf-save');

      if (isEdit) {
        const changes = changedFields(product, data);
        if (!Object.keys(changes).length) {
          Ui.toast('Nothing was changed.', 'info', { title: 'No changes' });
          dialog.close(null);
          return;
        }
        Ui.setBusy($save, true, 'Saving...');
        try {
          await Api.updateProduct(product.id, changes);
          dialog.close(true);
          Ui.toast(`"${data.title}" was updated (${Object.keys(changes).join(', ')}).`, 'success', { title: 'Saved' });
          refreshAfterChange();
        } catch (error) {
          Ui.setBusy($save, false);
          Ui.showError(error, 'Could not save the product');
        }
      } else {
        Ui.setBusy($save, true, 'Adding...');
        try {
          const created = await Api.createProduct(data);
          dialog.close(true);
          Ui.toast(`"${created.title}" was added with ID ${created.id}.`, 'success', { title: 'Product added' });
          refreshAfterChange();
        } catch (error) {
          Ui.setBusy($save, false);
          Ui.showError(error, 'Could not add the product');
        }
      }
    });
  }

  /* ------------------------------------------------------------------
     Wiring
     ------------------------------------------------------------------ */
  async function init() {
    loadCounts();
    try {
      categories = await Api.getCategories();
      $('#filter-category').append(
        categories.map((category) => `<option value="${esc(category.id)}">${esc(category.name)}</option>`).join('')
      );
    } catch (error) {
      Ui.showError(error, 'Could not load categories');
    }
    await applyFilter();

    // Search (debounced). Typing a search clears the category filter.
    $('#filter-search').on('input', Ui.debounce(function () {
      const term = normaliseSearch($(this).val());
      $('#filter-category').val('');
      state.catId = '';
      state.term = term;
      state.mode = term ? 'search' : 'all';
      applyFilter();
    }, 400));

    // Category filter. Choosing a category clears the search box.
    $('#filter-category').on('change', function () {
      $('#filter-search').val('');
      state.term = '';
      state.catId = $(this).val();
      state.mode = state.catId ? 'category' : 'all';
      applyFilter();
    });

    // Pressing Enter in the search box must not reload the page.
    $('#inventory-filters').on('submit', (event) => event.preventDefault());

    $('#add-product').on('click', () => {
      if (!categories.length) {
        Ui.toast('Categories are still loading. Please try again in a moment.', 'warning');
        return;
      }
      openProductForm();
    });

    // One click handler for every button in the table ("event delegation").
    $('#inventory-rows').on('click', '[data-action]', function () {
      const $button = $(this);
      const action = $button.data('action');
      const id = $button.closest('tr').attr('data-id');

      if (action === 'retry') loadPage();
      if (action === 'clear-filters') {
        $('#filter-search').val('');
        $('#filter-category').val('').trigger('change');
      }
      if (!id || !productsOnPage[id]) return;
      if (action === 'edit') openProductForm(productsOnPage[id]);
      if (action === 'toggle') toggleActive(id, $button);
      if (action === 'delete') deleteProduct(id, $button);
    });
  }

  $(init);
})();
