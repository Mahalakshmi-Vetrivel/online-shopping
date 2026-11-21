/* =====================================================================
   store.js - the customer store home page (index.html).

   Loads (in parallel) the categories and ALL active products, then:
     - hero numbers, category circles, "Trending now" row
     - the CATALOGUE: category chips, live search, sort, pagination
   Customers only ever see products with isActive == true (that is what
   Api.getActiveProducts() asks Firestore for).

   The catalogue state lives in the URL, so a filtered view can be
   bookmarked or shared:   index.html?cat=<id>&q=wire&sort=price-asc&page=2
   ===================================================================== */

(function () {
  const PAGE_SIZE = CONFIG.PAGE_SIZE;
  const esc = Ui.escapeHtml;

  // What the shopper has chosen. render() draws the page from this.
  const state = { cat: '', q: '', sort: 'featured', page: 1 };

  const SORTERS = {
    'price-asc': (a, b) => a.price - b.price,
    'price-desc': (a, b) => b.price - a.price,
    'name': (a, b) => a.title.localeCompare(b.title)
  };

  let allProducts = [];
  let categories = [];
  let scrolledForSearch = false; // scroll to the results only once while typing

  /* ------------------------------------------------------------------
     Helpers
     ------------------------------------------------------------------ */

  function categoryName(catId) {
    const found = categories.find((category) => category.id === catId);
    return found ? found.name : '';
  }

  function categoryUrl(category) {
    return `index.html?cat=${encodeURIComponent(category.id)}#products`;
  }

  function scrollToCatalogue() {
    const heading = document.getElementById('products');
    if (heading) heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Reads ?cat=&q=&sort=&page= from the address bar. */
  function readUrl() {
    const catId = Ui.getQueryParam('cat') || '';
    state.cat = categories.some((category) => category.id === catId) ? catId : '';
    state.q = (Ui.getQueryParam('q') || '').trim();
    const sort = Ui.getQueryParam('sort');
    state.sort = SORTERS[sort] ? sort : 'featured';
    state.page = Math.max(1, parseInt(Ui.getQueryParam('page'), 10) || 1);
  }

  /** Writes the state back to the address bar (no page reload, no new history entry). */
  function writeUrl() {
    const params = new URLSearchParams();
    if (state.cat) params.set('cat', state.cat);
    if (state.q) params.set('q', state.q);
    if (state.sort !== 'featured') params.set('sort', state.sort);
    if (state.page > 1) params.set('page', state.page);
    const query = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (query ? '?' + query : '') + window.location.hash);
  }

  /* ------------------------------------------------------------------
     Filtering, searching, sorting
     ------------------------------------------------------------------ */

  /**
   * "Contains" search: every word typed must appear somewhere in the
   * title, category or description (case ignored). "earbuds pro" finds
   * "Wireless Earbuds Pro"; "coffee" finds "Filter Coffee Powder 500g".
   */
  function visibleProducts() {
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    let list = allProducts.filter((product) => {
      if (state.cat && product.catId !== state.cat) return false;
      const haystack = `${product.title} ${product.categoryName} ${product.description}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
    if (SORTERS[state.sort]) list = [...list].sort(SORTERS[state.sort]);
    // Sold-out products go to the end (Array.sort is stable, so the chosen order is kept).
    return [...list].sort((a, b) => (a.qty <= 0) - (b.qty <= 0));
  }

  /* ------------------------------------------------------------------
     Drawing
     ------------------------------------------------------------------ */

  function categoryCircle(category) {
    const photo = Placeholder.categoryImage(category.name);
    // alt="" because the category name is already written under the picture.
    const picture = photo
      ? `<img src="${esc(photo)}" alt="" loading="lazy" width="400" height="400">`
      : Placeholder.categoryIcon(category.name, 40);
    return `
      <a class="cat-circle ${Placeholder.toneClass(category.name)}" href="${categoryUrl(category)}">
        <span class="cat-circle__img">${picture}</span>
        <span class="cat-circle__name">${esc(category.name)}</span>
      </a>`;
  }

  function renderCategories() {
    const allCircle = `
      <a class="cat-circle tone-0" href="index.html#products">
        <span class="cat-circle__img">${Icons.svg('grid', 40)}</span>
        <span class="cat-circle__name">All products</span>
      </a>`;
    $('#category-grid').attr('aria-busy', 'false').html(allCircle + categories.map(categoryCircle).join(''));

    // Point each promo card to its real category.
    $('[data-category-link]').each(function () {
      const match = categories.find((category) => category.name === $(this).data('category-link'));
      if (match) $(this).attr('href', categoryUrl(match));
    });
  }

  function renderTrending() {
    const featured = allProducts.slice(0, 8);
    $('#trending-grid').attr('aria-busy', 'false').html(
      featured.length
        ? featured.map(ProductCard.html).join('')
        : Ui.emptyState({ icon: 'box', title: 'No products yet', text: 'New arrivals are on their way.' })
    );
  }

  /** One chip per category, each with how many products it holds. */
  function renderChips() {
    const counts = {};
    allProducts.forEach((product) => { counts[product.catId] = (counts[product.catId] || 0) + 1; });

    const chip = (value, label, toneClass, iconSvg, count) => `
      <button type="button" class="chip ${toneClass}" data-cat="${esc(value)}" aria-pressed="false">
        <span class="chip-icon">${iconSvg}</span>
        ${esc(label)} <span class="chip__count">${count}</span>
      </button>`;

    $('#category-chips').html(
      chip('', 'All', 'tone-0', Icons.svg('grid', 16), allProducts.length) +
      categories.map((category) => chip(
        category.id, category.name, Placeholder.toneClass(category.name), Placeholder.categoryIcon(category.name, 16), counts[category.id] || 0
      )).join('')
    );
  }

  function emptyCatalogue() {
    const filtered = Boolean(state.cat || state.q);
    const where = state.cat ? categoryName(state.cat) : '';
    let title = 'No products yet';
    let text = 'New arrivals are on their way.';
    if (filtered && state.q) {
      title = `Nothing found for "${state.q}"`;
      text = where ? `Nothing in ${where} matches. Try another word, or search all categories.` : 'Try another word, or browse the categories above.';
    } else if (filtered) {
      title = `${where} is being stocked`;
      text = 'There are no products in this category yet. Please check back soon.';
    }
    return Ui.emptyState({
      icon: 'search',
      title,
      text,
      action: filtered ? '<button type="button" class="btn btn-primary" data-action="clear-filters">Show all products</button>' : ''
    });
  }

  /** Draws the catalogue for the current state. */
  function render() {
    const list = visibleProducts();
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages);
    const from = (state.page - 1) * PAGE_SIZE;
    const pageItems = list.slice(from, from + PAGE_SIZE);

    $('#product-grid').attr('aria-busy', 'false').html(
      pageItems.length ? pageItems.map(ProductCard.html).join('') : `<div class="product-grid__empty">${emptyCatalogue()}</div>`
    );

    // Heading + "Showing 1-8 of 60" line
    const heading = state.cat ? categoryName(state.cat) : (state.q ? 'Search results' : 'All products');
    $('#products-title').text(heading);
    const filtered = Boolean(state.cat || state.q);
    let meta = list.length
      ? `Showing ${from + 1}-${from + pageItems.length} of ${list.length} product${list.length === 1 ? '' : 's'}`
      : '';
    if (state.q) meta += meta ? ` for "${state.q}"` : '';
    $('#catalogue-meta-text').text(meta);
    $('#clear-filters').prop('hidden', !filtered);

    // Chips and sort box show the current choice
    $('#category-chips .chip').each(function () {
      $(this).attr('aria-pressed', String($(this).data('cat') === state.cat));
    });
    $('#sort-select').val(state.sort);

    // The header category bar highlights the same category
    $('.category-bar__link').removeAttr('aria-current');
    if (state.cat) {
      $(`.category-bar__link[href*="cat=${encodeURIComponent(state.cat)}"]`).attr('aria-current', 'page');
    }

    Ui.renderPagination($('#product-pager'), {
      page: state.page,
      totalPages,
      hasPrev: state.page > 1,
      hasNext: state.page < totalPages,
      label: 'Product pages',
      onChange(direction) {
        state.page += direction === 'next' ? 1 : -1;
        render();
        scrollToCatalogue();
      }
    });

    writeUrl();
  }

  /** Changes the filters and redraws. Any change goes back to page 1. */
  function setFilters(changes, { scroll = false, syncInput = true } = {}) {
    Object.assign(state, changes, changes.page ? {} : { page: 1 });
    // Keep the header search box in step (but never rewrite it while the shopper is typing in it).
    if (syncInput && changes.q !== undefined) $('#header-search-input').val(state.q);
    render();
    if (scroll) scrollToCatalogue();
  }

  /* ------------------------------------------------------------------
     Hero numbers
     ------------------------------------------------------------------ */
  function renderHeroStats() {
    const credit = Ui.formatMoney(CONFIG.DEFAULT_CREDIT_LIMIT);
    $('#stat-products').text(allProducts.length);
    $('#stat-categories').text(categories.length);
    $('#stat-credit, #banner-credit').text(credit);
    $('#hero-credit-text').text(`${credit} credit on sign-up`);
    $('#card-credit').text(new Intl.NumberFormat(CONFIG.LOCALE, {
      style: 'currency', currency: CONFIG.CURRENCY, minimumFractionDigits: 2
    }).format(CONFIG.DEFAULT_CREDIT_LIMIT));
  }

  /* ------------------------------------------------------------------
     Loading
     ------------------------------------------------------------------ */
  function showLoading() {
    $('#category-grid').attr('aria-busy', 'true').html('<span class="skeleton skeleton-circle"></span>'.repeat(14));
    $('#trending-grid').attr('aria-busy', 'true').html(Ui.skeletonCards(8));
    $('#product-grid').attr('aria-busy', 'true').html(Ui.skeletonCards(PAGE_SIZE));
    $('#category-chips').html(Ui.skeletonChips(8));
  }

  async function load() {
    showLoading();
    try {
      // Two requests at the same time; both are cached by api.js.
      [allProducts, categories] = await Promise.all([Api.getActiveProducts(), Api.getCategories()]);
    } catch (error) {
      Ui.showError(error, 'Could not load the store');
      const retry = '<button type="button" class="btn btn-primary" data-action="retry-load">Try again</button>';
      const failed = Ui.emptyState({ icon: 'alert', title: 'The store did not load', text: error.message, action: retry });
      $('#category-grid, #trending-grid, #product-grid').attr('aria-busy', 'false');
      $('#category-grid').html(failed);
      $('#trending-grid').empty();
      $('#product-grid').html(`<div class="product-grid__empty">${failed}</div>`);
      $('#category-chips').empty();
      return;
    }

    renderHeroStats();
    renderCategories();
    renderTrending();
    renderChips();
    readUrl();
    $('#header-search-input').val(state.q);
    render();

    // Arrived from a category link / search with ?cat= or ?q= : show the results.
    if (state.cat || state.q) setTimeout(scrollToCatalogue, 150);
  }

  /* ------------------------------------------------------------------
     Wiring
     ------------------------------------------------------------------ */
  $(function () {
    load();

    $(document).on('click', '[data-action="retry-load"]', load);
    $(document).on('click', '[data-action="clear-filters"], #clear-filters', () => setFilters({ cat: '', q: '' }));

    // Category chips
    $('#category-chips').on('click', '.chip', function () {
      setFilters({ cat: $(this).data('cat') });
    });

    // Sort box
    $('#sort-select').on('change', function () {
      setFilters({ sort: $(this).val() });
    });

    // Category circles, promo cards and the header category bar change the
    // catalogue without reloading the page.
    $(document).on('click', 'a[href^="index.html?cat="]', function (event) {
      if (!categories.length) return; // still loading: let the browser follow the link
      event.preventDefault();
      const catId = new URL(this.href, window.location.href).searchParams.get('cat');
      setFilters({ cat: catId, q: '' }, { scroll: true });
    });
    $(document).on('click', 'a[href="index.html#products"], a[href="#products"]', function () {
      if (state.cat || state.q) setFilters({ cat: '', q: '' });
    });

    // Header search box: live results while typing (after a short pause),
    // and the Search button / Enter key.
    const $headerSearch = $('#header-search-input');
    $headerSearch.on('input', Ui.debounce(() => {
      if (!allProducts.length) return;
      const term = $headerSearch.val().trim();
      setFilters({ q: term }, { syncInput: false });
      if (term && !scrolledForSearch) {
        scrolledForSearch = true;
        scrollToCatalogue();
      }
      if (!term) scrolledForSearch = false;
    }, 350));
    $('.header-search').on('submit', (event) => {
      event.preventDefault();
      if (!allProducts.length) return;
      setFilters({ q: $headerSearch.val().trim() }, { scroll: true });
    });
  });
})();
