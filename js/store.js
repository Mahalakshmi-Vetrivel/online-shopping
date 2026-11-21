/* =====================================================================
   store.js - the customer store home page (index.html).
   Phase 0: live hero numbers, category circles, promo links,
            "Trending now" product cards with real photos.
   Phase 4 adds: the full catalogue with search, filters and pagination.
   ===================================================================== */

(function () {
  /* ---------- Small helpers ---------- */

  /** "Only 8 left" label for low stock, nothing otherwise. */
  function stockFlag(qty) {
    if (qty <= 0) return '<span class="product-card__flag">Sold out</span>';
    if (qty < CONFIG.LOW_STOCK) return `<span class="product-card__flag">Only ${qty} left</span>`;
    return '';
  }

  function categoryUrl(category) {
    return `index.html?cat=${encodeURIComponent(category.id)}#products`;
  }

  /* ---------- Product card (reused by the full catalogue in Phase 4) ---------- */
  function productCard(product) {
    const soldOut = product.qty <= 0;
    return `
      <article class="product-card">
        <div class="product-card__media">
          ${Placeholder.image(product)}
          ${stockFlag(product.qty)}
        </div>
        <div class="product-card__body">
          <p class="product-card__cat">${Ui.escapeHtml(product.categoryName)}</p>
          <h3 class="product-card__title">${Ui.escapeHtml(product.title)}</h3>
          <div class="product-card__foot">
            <span class="product-card__price">${Ui.formatMoney(product.price)}</span>
            <button type="button" class="btn btn-primary btn-sm" data-add-to-cart="${Ui.escapeHtml(product.id)}"
                    ${soldOut ? 'disabled' : ''} aria-label="Add ${Ui.escapeHtml(product.title)} to cart">
              ${Icons.svg('plus', 16)} Add
            </button>
          </div>
        </div>
      </article>`;
  }

  /* ---------- Category circles ---------- */
  function categoryCircle(category) {
    const photo = Placeholder.categoryImage(category.name);
    // alt="" because the category name is already written under the picture.
    const picture = photo
      ? `<img src="${Ui.escapeHtml(photo)}" alt="" loading="lazy" width="400" height="400">`
      : Placeholder.categoryIcon(category.name, 40);
    return `
      <a class="cat-circle ${Placeholder.toneClass(category.name)}" href="${categoryUrl(category)}">
        <span class="cat-circle__img">${picture}</span>
        <span class="cat-circle__name">${Ui.escapeHtml(category.name)}</span>
      </a>`;
  }

  async function loadCategories() {
    const $grid = $('#category-grid');
    $grid.attr('aria-busy', 'true').html('<span class="skeleton skeleton-circle"></span>'.repeat(14));

    try {
      const categories = await Api.getCategories();
      $('#stat-categories').text(categories.length);

      // "All products" first, then one circle per category.
      const allCircle = `
        <a class="cat-circle tone-0" href="#products">
          <span class="cat-circle__img">${Icons.svg('grid', 40)}</span>
          <span class="cat-circle__name">All products</span>
        </a>`;
      $grid.html(allCircle + categories.map(categoryCircle).join(''));

      // Point each promo card to its real category.
      $('[data-category-link]').each(function () {
        const wanted = $(this).data('category-link');
        const match = categories.find((category) => category.name === wanted);
        if (match) $(this).attr('href', categoryUrl(match));
      });
    } catch (error) {
      Ui.showError(error, 'Could not load categories');
      $grid.html(Ui.emptyState({
        icon: 'alert',
        title: 'Categories did not load',
        text: error.message,
        action: '<button type="button" class="btn btn-primary" id="retry-categories">Try again</button>'
      }));
    } finally {
      $grid.attr('aria-busy', 'false');
    }
  }

  /* ---------- Trending products ---------- */
  async function loadTrending() {
    const $grid = $('#trending-grid');
    $grid.attr('aria-busy', 'true').html(Ui.skeletonCards(8));
    try {
      const products = await Api.getFeaturedProducts(8);
      if (!products.length) {
        $grid.html(Ui.emptyState({ icon: 'box', title: 'No products yet', text: 'New arrivals are on their way.' }));
        return;
      }
      $grid.html(products.map(productCard).join(''));
    } catch (error) {
      Ui.showError(error, 'Could not load products');
      $grid.html(Ui.emptyState({ icon: 'alert', title: 'Products did not load', text: error.message }));
    } finally {
      $grid.attr('aria-busy', 'false');
    }
  }

  /** Real numbers for the hero: how many ACTIVE products are for sale. */
  async function loadHeroStats() {
    const credit = Ui.formatMoney(CONFIG.DEFAULT_CREDIT_LIMIT);
    $('#stat-credit, #banner-credit').text(credit);
    $('#hero-credit-text').text(`${credit} credit on sign-up`);
    $('#card-credit').text(new Intl.NumberFormat(CONFIG.LOCALE, {
      style: 'currency', currency: CONFIG.CURRENCY, minimumFractionDigits: 2
    }).format(CONFIG.DEFAULT_CREDIT_LIMIT));
    try {
      const activeCount = await Api.count('inventory', Api.Query.where('isActive', '==', true));
      $('#stat-products').text(activeCount);
    } catch (error) {
      // Not important enough for an error toast: keep the default text.
    }
  }

  function renderCatalogueTeaser() {
    $('#product-area').html(Ui.emptyState({
      icon: 'search',
      title: 'The full catalogue opens in Phase 4',
      text: 'Search, category filters and pagination across all products are coming next.',
      action: '<a class="btn btn-secondary" href="#trending">See trending products</a>'
    }));
  }

  $(function () {
    renderCatalogueTeaser();
    loadHeroStats();
    loadCategories();
    loadTrending();

    $(document).on('click', '#retry-categories', loadCategories);

    // The cart arrives in Phase 5; until then the button explains itself.
    $(document).on('click', '[data-add-to-cart]', () => {
      Ui.toast('The cart opens in Phase 5. This product will be ready for you!', 'info', { title: 'Coming soon' });
    });

    if (Ui.getQueryParam('q')) {
      Ui.toast('Full search arrives in Phase 4. Showing trending products for now.', 'info', { title: 'Search' });
    }
  });
})();
