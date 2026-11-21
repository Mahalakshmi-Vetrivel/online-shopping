/* =====================================================================
   product.js - the product details page (product.html?id=...).

   Reads ONE product fresh from Firestore (so stock is up to date) and,
   at the same time, all active products (for the "More in this category"
   row). Customers can only see ACTIVE products: a hidden or deleted
   product shows a friendly "not available" page instead.
   ===================================================================== */

(function () {
  const esc = Ui.escapeHtml;
  const RELATED_COUNT = 4;

  function stateMessage(icon, title, text) {
    return Ui.emptyState({
      icon,
      title,
      text,
      action: '<a class="btn btn-primary" href="index.html#products">Browse all products</a>'
    });
  }

  function showState(icon, title, text) {
    document.title = `${title} | ShopNest`;
    $('#product-root').attr('aria-busy', 'false').html(`<div class="product-page__state">${stateMessage(icon, title, text)}</div>`);
  }

  /* ------------------------------------------------------------------
     Quantity stepper (the chosen quantity is used by the cart in Phase 5)
     ------------------------------------------------------------------ */
  function initStepper(max) {
    const $input = $('#qty');
    const $minus = $('[data-qty="-1"]');
    const $plus = $('[data-qty="1"]');

    /** Keeps the value a whole number between 1 and the stock. */
    function clamp() {
      let value = parseInt($input.val(), 10);
      if (Number.isNaN(value) || value < 1) value = 1;
      if (value > max) value = max;
      $input.val(value);
      $minus.prop('disabled', value <= 1);
      $plus.prop('disabled', value >= max);
      $('#qty-note').text(value >= max ? `That's all we have: ${max} in stock.` : '');
    }

    $('[data-qty]').on('click', function () {
      $input.val((parseInt($input.val(), 10) || 1) + Number($(this).data('qty')));
      clamp();
    });
    $input.on('change blur', clamp);
    $input.on('input', function () {
      // Allow digits only while typing.
      $(this).val($(this).val().replace(/\D/g, ''));
    });
    clamp();
  }

  /* ------------------------------------------------------------------
     Page
     ------------------------------------------------------------------ */
  function detailHtml(product) {
    const stock = ProductCard.availability(product.qty);
    const soldOut = stock.level === 'out';
    const catUrl = `index.html?cat=${encodeURIComponent(product.catId)}#products`;
    return `
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <ol>
          <li><a href="index.html">Home</a></li>
          <li><a href="${catUrl}">${esc(product.categoryName)}</a></li>
          <li aria-current="page">${esc(product.title)}</li>
        </ol>
      </nav>

      <article class="product-detail">
        <div class="product-detail__media">
          ${Placeholder.image(product, { size: 'lg', eager: true })}
        </div>

        <div class="product-detail__info">
          <a class="badge badge-info" href="${catUrl}">${esc(product.categoryName)}</a>
          <h1 class="product-detail__title">${esc(product.title)}</h1>

          <div class="product-detail__price-row">
            <p class="detail-price">${Ui.formatMoney(product.price)}</p>
            <p class="availability availability--${stock.level}">
              <span class="availability__dot" aria-hidden="true"></span>${esc(stock.text)}
            </p>
          </div>

          <p class="product-detail__description">${esc(product.description)}</p>

          <div class="buy-box">
            <div class="field">
              <label class="field-label" for="qty">Quantity</label>
              <div class="qty-stepper">
                <button type="button" class="qty-stepper__btn" data-qty="-1" aria-label="Decrease quantity" ${soldOut ? 'disabled' : ''}>${Icons.svg('minus', 16)}</button>
                <input class="qty-stepper__input" id="qty" type="text" inputmode="numeric" value="1" autocomplete="off" ${soldOut ? 'disabled' : ''}
                       aria-describedby="qty-note">
                <button type="button" class="qty-stepper__btn" data-qty="1" aria-label="Increase quantity" ${soldOut ? 'disabled' : ''}>${Icons.svg('plus', 16)}</button>
              </div>
              <p class="field-hint" id="qty-note" aria-live="polite"></p>
            </div>
            <button type="button" class="btn btn-primary btn-lg" data-add-to-cart="${esc(product.id)}" ${soldOut ? 'disabled' : ''}>
              ${Icons.svg('cart', 20)} ${soldOut ? 'Sold out' : 'Add to cart'}
            </button>
          </div>

          <ul class="detail-perks">
            <li>${Icons.svg('wallet', 18)} Pay by cash or ShopNest credit</li>
            <li>${Icons.svg('bolt', 18)} Stock is checked again before you pay</li>
            <li>${Icons.svg('receipt', 18)} Instant, printable bill</li>
          </ul>

          <p class="product-detail__id">Product ID: <code>${esc(product.id)}</code></p>
        </div>
      </article>

      <section class="related" id="related" aria-labelledby="related-title" hidden>
        <h2 class="section-title" id="related-title">More in ${esc(product.categoryName)}</h2>
        <div class="product-grid" id="related-grid"></div>
      </section>`;
  }

  function showRelated(product, activeProducts) {
    const related = activeProducts
      .filter((other) => other.catId === product.catId && other.id !== product.id)
      .slice(0, RELATED_COUNT);
    if (!related.length) return;
    $('#related-grid').html(related.map(ProductCard.html).join(''));
    $('#related').prop('hidden', false);
  }

  async function load() {
    const id = Ui.getQueryParam('id');
    if (!id) {
      showState('search', 'No product chosen', 'Pick a product from the store to see its details.');
      return;
    }
    $('#product-root').attr('aria-busy', 'true');

    let product;
    let activeProducts = [];
    try {
      [product, activeProducts] = await Promise.all([Api.getProduct(id), Api.getActiveProducts()]);
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        showState('search', 'Product not found', 'This product does not exist, or it was removed from the store.');
        return;
      }
      Ui.showError(error, 'Could not load the product');
      $('#product-root').attr('aria-busy', 'false').html(`<div class="product-page__state">${Ui.emptyState({
        icon: 'alert',
        title: 'The product did not load',
        text: error.message,
        action: '<button type="button" class="btn btn-primary" data-action="retry">Try again</button>'
      })}</div>`);
      return;
    }

    // Hidden (deactivated) products are not for sale.
    if (!product.isActive) {
      showState('eyeOff', 'This product is not available', 'It has been taken off the store for now. Please look at similar products.');
      return;
    }

    document.title = `${product.title} | ShopNest`;
    $('meta[name="description"]').attr('content', `${product.title} - ${product.description}`.slice(0, 155));
    $('#product-root').attr('aria-busy', 'false').html(detailHtml(product));
    Layout.renderIcons($('#product-root'));
    if (product.qty > 0) initStepper(product.qty);
    showRelated(product, activeProducts);
  }

  $(function () {
    load();
    $(document).on('click', '[data-action="retry"]', load);
  });
})();
