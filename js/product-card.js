/* =====================================================================
   product-card.js - the product card shown in grids (home page,
   catalogue, related products) and how stock is described to shoppers.

   Each card is ONE link to product.html?id=... The link's ::after covers
   the whole card (see components.css), so the whole card is clickable
   while keyboard users still get a single, clearly named link.
   The "Add" button sits above that link, so it works on its own
   (js/cart.js listens for clicks on [data-add-to-cart]).
   ===================================================================== */

const ProductCard = (function () {
  const esc = Ui.escapeHtml;

  /**
   * How stock is told to a shopper (customers never see raw numbers
   * unless the stock is low).
   *   ok    : plenty in stock
   *   low   : "Only 8 left"
   *   out   : sold out
   */
  function availability(qty) {
    if (qty <= 0) return { level: 'out', text: 'Sold out' };
    if (qty < CONFIG.LOW_STOCK) return { level: 'low', text: `Only ${qty} left` };
    return { level: 'ok', text: 'In stock' };
  }

  function productUrl(product) {
    return `product.html?id=${encodeURIComponent(product.id)}`;
  }

  /** The card for one product. */
  function html(product) {
    const stock = availability(product.qty);
    const flag = stock.level === 'ok' ? '' : `<span class="product-card__flag product-card__flag--${stock.level}">${stock.text}</span>`;
    return `
      <article class="product-card">
        <div class="product-card__media">
          ${Placeholder.image(product)}
          ${flag}
        </div>
        <div class="product-card__body">
          <p class="product-card__cat">${esc(product.categoryName)}</p>
          <h3 class="product-card__title">
            <a class="product-card__link" href="${productUrl(product)}">${esc(product.title)}</a>
          </h3>
          <div class="product-card__foot">
            <span class="product-card__price">${Ui.formatMoney(product.price)}</span>
            <button type="button" class="btn btn-primary btn-sm" data-add-to-cart="${esc(product.id)}"
                    ${stock.level === 'out' ? 'disabled' : ''} aria-label="Add ${esc(product.title)} to cart">
              ${Icons.svg('plus', 16)} Add
            </button>
          </div>
        </div>
      </article>`;
  }

  return { html, availability, productUrl };
})();
