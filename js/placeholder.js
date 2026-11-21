/* =====================================================================
   placeholder.js - product and category pictures.

   Products: each product document has an "imageUrl" field, e.g.
     "assets/images/products/wireless-earbuds-pro.jpg"  (a file in this project)
     or "https://..."                                     (a photo on the web)
   Placeholder.image(product) returns an <img> for that photo.

   If a product has NO imageUrl, or the photo fails to load, we show a
   generated picture instead (Placeholder.art):
     - a gradient in the category's colours (tone classes, see theme.css)
     - a large faded category icon as a watermark
     - the product's initials on a frosted-glass tile
   So the store never shows a broken-image icon.
   ===================================================================== */

const Placeholder = (function () {
  // Category name (lower case) -> colour tone, icon, and a photo for category tiles.
  const CATEGORY_STYLES = {
    'electronics':             { tone: 1,  icon: 'headphones', image: 'assets/images/categories/electronics.jpg' },
    'mobiles & tablets':       { tone: 2,  icon: 'phone',      image: 'assets/images/products/galaxy-nova-5g-phone.jpg' },
    'computers & accessories': { tone: 3,  icon: 'laptop',     image: 'assets/images/products/ultrabook-14-laptop.jpg' },
    'clothing':                { tone: 4,  icon: 'shirt',      image: 'assets/images/products/cotton-kurti-floral.jpg' },
    'footwear':                { tone: 5,  icon: 'shoe',       image: 'assets/images/products/running-shoes-air.jpg' },
    'groceries':               { tone: 6,  icon: 'basket',     image: 'assets/images/categories/groceries.jpg' },
    'home & kitchen':          { tone: 7,  icon: 'pot',        image: 'assets/images/products/non-stick-cookware-set.jpg' },
    'beauty & personal care':  { tone: 8,  icon: 'sparkles',   image: 'assets/images/categories/beauty.jpg' },
    'sports & fitness':        { tone: 9,  icon: 'dumbbell',   image: 'assets/images/products/adjustable-dumbbells-10kg.jpg' },
    'books & stationery':      { tone: 10, icon: 'book',       image: 'assets/images/categories/books.jpg' },
    'toys & baby':             { tone: 11, icon: 'blocks',     image: 'assets/images/categories/toys.jpg' },
    'watches & accessories':   { tone: 12, icon: 'watch',      image: 'assets/images/products/analog-watch-classic.jpg' },
    'pet supplies':            { tone: 13, icon: 'paw',        image: 'assets/images/categories/pets.jpg' }
  };

  /** Path prefix back to the site root ("" or "../"), read from <body data-root>. */
  function root() {
    return document.body.dataset.root || '';
  }

  /** Local paths get the root prefix; full web addresses are used as they are. */
  function resolveUrl(url) {
    if (!url) return '';
    return /^https?:\/\//i.test(url) ? url : root() + url;
  }

  /**
   * Style for any category name. A category we don't know (e.g. one
   * the admin adds later) still gets a stable colour: we add up the
   * character codes of its name, so the same name always gives the
   * same tone. It has no photo, so its tile shows the icon instead.
   */
  function styleFor(categoryName) {
    const key = String(categoryName || '').trim().toLowerCase();
    if (CATEGORY_STYLES[key]) {
      return CATEGORY_STYLES[key];
    }
    let sum = 0;
    for (const ch of key) sum += ch.charCodeAt(0);
    return { tone: (sum % 13) + 1, icon: 'tag', image: '' };
  }

  /** "Wireless Earbuds Pro" -> "WE",  "Yoga Mat 6mm" -> "YM",  "Toor" -> "TO" */
  function initials(title) {
    const words = String(title || '').trim().split(/\s+/).filter(Boolean);
    const letterWords = words.filter((word) => /^[a-z]/i.test(word));
    const source = letterWords.length ? letterWords : words;
    if (!source.length) return '?';
    if (source.length === 1) return source[0].slice(0, 2).toUpperCase();
    return (source[0][0] + source[1][0]).toUpperCase();
  }

  /** CSS class with the category colours, e.g. "tone-4". */
  function toneClass(categoryName) {
    return 'tone-' + styleFor(categoryName).tone;
  }

  /** The category's icon as SVG markup. */
  function categoryIcon(categoryName, size = 20) {
    return Icons.svg(styleFor(categoryName).icon, size);
  }

  /** Photo URL for a category tile ('' if we have none). */
  function categoryImage(categoryName) {
    return resolveUrl(styleFor(categoryName).image);
  }

  /**
   * The generated picture (used when there is no photo).
   * role="img" + aria-label = the alt text for screen readers.
   * @param {{title: string, categoryName: string}} product
   * @param {{size?: 'md'|'lg'|'thumb'}} options
   */
  function art(product, { size = 'md' } = {}) {
    const style = styleFor(product.categoryName);
    const label = `${product.title} (${product.categoryName || 'Product'})`;
    return `
      <div class="product-art tone-${style.tone} product-art--${size}" role="img" aria-label="${Ui.escapeHtml(label)}">
        <span class="product-art__badge">${Icons.svg(style.icon, 16)}</span>
        <span class="product-art__watermark">${Icons.svg(style.icon, 200)}</span>
        <span class="product-art__initials">${Ui.escapeHtml(initials(product.title))}</span>
      </div>`;
  }

  /**
   * The product picture: the real photo if there is one, otherwise art().
   * loading="lazy" tells the browser to download photos only when they
   * scroll into view, so long product lists stay fast.
   */
  function image(product, { size = 'md', eager = false } = {}) {
    const src = resolveUrl(product.imageUrl);
    if (!src) {
      return art(product, { size });
    }
    // The main photo on a product page is at the top of the screen: load it
    // at once. Photos further down are lazy (loaded when they scroll into view).
    const loading = eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
    return `
      <div class="product-photo product-photo--${size}" data-title="${Ui.escapeHtml(product.title)}" data-category="${Ui.escapeHtml(product.categoryName || '')}" data-size="${size}">
        <img src="${Ui.escapeHtml(src)}" alt="${Ui.escapeHtml(product.title)}" ${loading} decoding="async" width="600" height="600">
      </div>`;
  }

  /**
   * If a product photo fails to load (deleted file, wrong URL, offline),
   * swap it for the generated picture. "error" events do not bubble, so
   * we listen in the CAPTURE phase (the `true` at the end).
   */
  document.addEventListener('error', (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const frame = img.closest('.product-photo');
    if (!frame) return;
    frame.outerHTML = art(
      { title: frame.dataset.title, categoryName: frame.dataset.category },
      { size: frame.dataset.size }
    );
  }, true);

  return { styleFor, initials, toneClass, categoryIcon, categoryImage, art, image, resolveUrl };
})();
