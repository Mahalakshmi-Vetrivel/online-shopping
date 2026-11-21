/* =====================================================================
   ui.js - small reusable UI helpers shared by every page:
     - escapeHtml, formatMoney, formatDate, getQueryParam, debounce
     - toast()        : pop-up messages (success / info / warning / error)
     - showError()    : turns an API error into a friendly toast
     - modal()        : generic dialog with a title, body and footer
     - confirm()      : "Are you sure? Yes / No" dialog -> Promise<boolean>
     - setBusy()      : disables a button and shows a spinner
     - skeleton...()  : grey shimmering placeholders while data loads
     - pagination     : Previous / Page N / Next controls
     - emptyState()   : friendly "nothing here" message
     - stockBadge()   : Low / In stock / High badge for a quantity
   The Module Pattern (an IIFE that returns an object) keeps private
   helpers private and exposes only what pages need, via Ui.xxx().
   ===================================================================== */

const Ui = (function () {
  // How long each toast type stays on screen (ms).
  // Keep in sync with the .toast__timer durations in components.css.
  const TOAST_MS = { success: 4500, info: 4500, warning: 4500, error: 7000 };
  const TOAST_ICONS = { success: 'checkCircle', info: 'info', warning: 'alert', error: 'errorCircle' };
  const TOAST_TITLES = { success: 'Success', info: 'Good to know', warning: 'Heads up', error: 'Something went wrong' };
  const MAX_TOASTS = 4;
  const LEAVE_MS = 260; // matches --dur in theme.css

  /* ------------------------------------------------------------------
     Text and formatting helpers
     ------------------------------------------------------------------ */

  /** Makes text safe to put inside HTML (stops HTML/script injection). */
  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 1999 -> "₹1,999"   99.5 -> "₹99.50" */
  function formatMoney(amount) {
    const value = Number(amount) || 0;
    return new Intl.NumberFormat(CONFIG.LOCALE, {
      style: 'currency',
      currency: CONFIG.CURRENCY,
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  /** Date -> "21 Nov 2026, 2:30 pm" in Indian time. */
  function formatDate(date, withTime = true) {
    if (!date) return '';
    const options = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' };
    if (withTime) {
      options.hour = 'numeric';
      options.minute = '2-digit';
    }
    return new Intl.DateTimeFormat(CONFIG.LOCALE, options).format(new Date(date));
  }

  /** Reads ?name=value from the page URL. */
  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  /**
   * Debounce: waits until the user STOPS calling for `wait` ms, then runs fn once.
   * Used for search boxes so we don't call the server on every key press.
   */
  function debounce(fn, wait = 350) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /* ------------------------------------------------------------------
     Toasts
     ------------------------------------------------------------------ */

  /** Finds the toast container, creating it the first time. */
  function getToastRegion() {
    let $region = $('#toast-region');
    if (!$region.length) {
      // aria-live="polite": screen readers announce new toasts without interrupting.
      $region = $('<div id="toast-region" class="toast-region" aria-live="polite"></div>');
      $('body').append($region);
    }
    return $region;
  }

  /**
   * Shows a toast.
   * @param {string} message  plain text (it is escaped)
   * @param {'success'|'info'|'warning'|'error'} type
   * @param {object} [options] { title, html }  html = extra trusted HTML (e.g. a link)
   */
  function toast(message, type = 'info', options = {}) {
    const kind = TOAST_MS[type] ? type : 'info';
    const title = options.title || TOAST_TITLES[kind];
    // Errors use role="alert" so screen readers announce them immediately.
    const role = kind === 'error' ? 'alert' : 'status';

    const $toast = $(`
      <div class="toast toast--${kind}" role="${role}">
        <span class="toast__icon">${Icons.svg(TOAST_ICONS[kind], 20)}</span>
        <div>
          <p class="toast__title">${escapeHtml(title)}</p>
          <p class="toast__message">${escapeHtml(message)}${options.html || ''}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-icon toast__close" aria-label="Dismiss notification">
          ${Icons.svg('close', 16)}
        </button>
        <span class="toast__timer" aria-hidden="true"></span>
      </div>`);

    const $region = getToastRegion();
    $region.append($toast);

    // Keep at most MAX_TOASTS on screen: remove the oldest.
    const $all = $region.children('.toast');
    if ($all.length > MAX_TOASTS) {
      $all.first().remove();
    }

    // Auto-dismiss timer that pauses while the mouse/keyboard is on the toast.
    let remaining = TOAST_MS[kind];
    let startedAt = Date.now();
    let timer = setTimeout(dismiss, remaining);
    let paused = false;

    function dismiss() {
      clearTimeout(timer);
      $toast.addClass('is-leaving');
      setTimeout(() => $toast.remove(), LEAVE_MS);
    }

    $toast.on('mouseenter focusin', () => {
      if (paused) return;
      paused = true;
      clearTimeout(timer);
      remaining -= Date.now() - startedAt;
    });

    $toast.on('mouseleave focusout', () => {
      if (!paused) return;
      paused = false;
      startedAt = Date.now();
      timer = setTimeout(dismiss, Math.max(remaining, 1000));
    });

    $toast.find('.toast__close').on('click', dismiss);
  }

  /**
   * Shows any error as a friendly toast. api.js already turns server
   * errors into readable messages; if Firestore asks for a new index,
   * we add a link the admin can click to create it.
   */
  function showError(error, title) {
    const message = (error && error.message) || 'Something went wrong. Please try again.';
    let extra = '';
    if (error && error.indexUrl) {
      extra = ` <a href="${escapeHtml(error.indexUrl)}" target="_blank" rel="noopener">Create the index</a>`;
    }
    toast(message, 'error', { title, html: extra });
  }

  /* ------------------------------------------------------------------
     Modals
     ------------------------------------------------------------------ */

  let modalCounter = 0;

  /** All elements inside `container` that can receive keyboard focus. */
  function focusableIn($container) {
    return $container
      .find('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
      .filter(':visible');
  }

  /**
   * Low-level dialog. Handles: backdrop, Esc key, focus trap,
   * restoring focus afterwards and stopping background scroll.
   * @param {object} options
   *   html      : inner HTML of the dialog (must contain an element with id=labelId)
   *   labelId   : id of the dialog's title (for aria-labelledby)
   *   size      : '' | 'modal--sm' | 'modal--lg'
   *   onClose   : function(result) called after the dialog closes
   * @returns {{ $modal, close(result) }}
   */
  function openDialog({ html, labelId, size = '', onClose }) {
    // A dialog that is still fading out is removed at once. Otherwise, for a
    // moment, two forms with the same ids would be on the page.
    $('.modal-backdrop.is-leaving').remove();
    const previouslyFocused = document.activeElement;
    const $backdrop = $(`
      <div class="modal-backdrop">
        <div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="${labelId}" tabindex="-1">
          ${html}
        </div>
      </div>`);
    const $modal = $backdrop.children('.modal');
    let closed = false;

    function close(result) {
      if (closed) return;
      closed = true;
      $(document).off('keydown.modal-' + labelId);
      $backdrop.addClass('is-leaving');
      setTimeout(() => {
        $backdrop.remove();
        // Only tidy up if no other dialog has opened in the meantime.
        if (!$('.modal-backdrop').length) {
          $('body').removeClass('no-scroll');
          if (previouslyFocused && previouslyFocused.focus) {
            previouslyFocused.focus();
          }
        }
        if (onClose) onClose(result);
      }, LEAVE_MS);
    }

    // Esc closes; Tab / Shift+Tab stay inside the dialog (focus trap).
    $(document).on('keydown.modal-' + labelId, (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      }
      if (event.key === 'Tab') {
        const $items = focusableIn($modal);
        if (!$items.length) return;
        const first = $items.get(0);
        const last = $items.get($items.length - 1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    // Clicking the dark area outside the dialog closes it.
    $backdrop.on('mousedown', (event) => {
      if (event.target === $backdrop[0]) close(null);
    });

    $('body').addClass('no-scroll').append($backdrop);

    // Focus the first field (or the dialog itself) so keyboard users start inside.
    const $first = focusableIn($modal).not('.modal-close').first();
    ($first.length ? $first : $modal).trigger('focus');

    return { $modal, close };
  }

  /**
   * Standard dialog with a title bar, a body and an optional footer.
   * Used for edit forms in later phases.
   */
  function modal({ title, body, footer = '', size = '', onClose }) {
    const labelId = 'modal-title-' + (++modalCounter);
    const html = `
      <div class="modal-header">
        <h2 class="modal-title" id="${labelId}">${escapeHtml(title)}</h2>
        <button type="button" class="btn btn-ghost btn-icon modal-close" aria-label="Close dialog">${Icons.svg('close', 18)}</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}`;
    const dialog = openDialog({ html, labelId, size, onClose });
    dialog.$modal.find('.modal-close').on('click', () => dialog.close(null));
    return dialog;
  }

  /**
   * "Confirm? Yes / No" dialog.
   * Returns a Promise that resolves to true (Yes) or false (No / Esc / outside click).
   *   const ok = await Ui.confirm({ title: 'Delete item?', message: '...', danger: true });
   */
  function confirm({ title, message, confirmText = 'Yes', cancelText = 'No', danger = false }) {
    return new Promise((resolve) => {
      const labelId = 'confirm-title-' + (++modalCounter);
      const html = `
        <div class="confirm ${danger ? 'confirm--danger' : ''}">
          <div class="confirm__icon">${Icons.svg(danger ? 'trash' : 'info', 30)}</div>
          <h2 class="modal-title" id="${labelId}">${escapeHtml(title)}</h2>
          <p class="confirm__text">${escapeHtml(message)}</p>
          <div class="confirm__actions">
            <button type="button" class="btn btn-secondary" data-answer="no">${escapeHtml(cancelText)}</button>
            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-answer="yes">${escapeHtml(confirmText)}</button>
          </div>
        </div>`;
      const dialog = openDialog({
        html,
        labelId,
        size: 'modal--sm',
        onClose: (result) => resolve(result === true)
      });
      dialog.$modal.on('click', '[data-answer]', function () {
        dialog.close($(this).data('answer') === 'yes');
      });
      // Safer default: focus "No" first, so pressing Enter by accident does not delete.
      dialog.$modal.find('[data-answer="no"]').trigger('focus');
    });
  }

  /* ------------------------------------------------------------------
     Busy buttons (prevents double submits)
     ------------------------------------------------------------------ */

  /**
   * setBusy($btn, true, 'Saving...') -> disabled + spinner
   * setBusy($btn, false)             -> back to the original label
   */
  function setBusy($button, busy, busyText = 'Please wait...') {
    if (busy) {
      if ($button.data('original-html') === undefined) {
        $button.data('original-html', $button.html());
      }
      $button
        .prop('disabled', true)
        .addClass('is-busy')
        .attr('aria-busy', 'true')
        .html(`<span class="spinner" aria-hidden="true"></span><span>${escapeHtml(busyText)}</span>`);
    } else {
      $button
        .prop('disabled', false)
        .removeClass('is-busy')
        .removeAttr('aria-busy')
        .html($button.data('original-html'));
      $button.removeData('original-html');
    }
  }

  /* ------------------------------------------------------------------
     Skeleton loaders (shown while data is loading)
     ------------------------------------------------------------------ */

  function skeletonCards(count = 4) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += `
        <div class="card skeleton-card" aria-hidden="true">
          <div class="skeleton skeleton-art"></div>
          <div class="skeleton skeleton-line w-80"></div>
          <div class="skeleton skeleton-line w-40"></div>
        </div>`;
    }
    return html;
  }

  function skeletonRows(rows = 5, columns = 4) {
    let html = '';
    for (let r = 0; r < rows; r++) {
      html += '<tr aria-hidden="true">';
      for (let c = 0; c < columns; c++) {
        html += '<td><div class="skeleton skeleton-line w-80"></div></td>';
      }
      html += '</tr>';
    }
    return html;
  }

  function skeletonChips(count = 6) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += '<span class="skeleton skeleton-chip" aria-hidden="true"></span>';
    }
    return html;
  }

  /** Centred spinner with a message, for whole sections. */
  function loader(message = 'Loading...') {
    return `<div class="loader" role="status"><span class="spinner spinner-lg" aria-hidden="true"></span><span>${escapeHtml(message)}</span></div>`;
  }

  /* ------------------------------------------------------------------
     Pagination
     ------------------------------------------------------------------ */

  /**
   * Draws "Previous | Page N | Next" into $container.
   * onChange('prev' | 'next') is called when a button is clicked.
   */
  function renderPagination($container, { page, totalPages, hasPrev, hasNext, onChange, label = 'Pagination' }) {
    if (!hasPrev && !hasNext) {
      $container.empty();
      return;
    }
    const pageText = totalPages ? `Page ${page} of ${totalPages}` : `Page ${page}`;
    $container.html(`
      <nav class="pagination" aria-label="${escapeHtml(label)}">
        <button type="button" class="btn btn-secondary btn-sm" data-page-dir="prev" ${hasPrev ? '' : 'disabled'}>
          ${Icons.svg('chevronLeft', 16)} Previous
        </button>
        <span class="pagination-info" aria-live="polite">${pageText}</span>
        <button type="button" class="btn btn-secondary btn-sm" data-page-dir="next" ${hasNext ? '' : 'disabled'}>
          Next ${Icons.svg('chevronRight', 16)}
        </button>
      </nav>`);
    $container.off('click.pagination').on('click.pagination', '[data-page-dir]', function () {
      onChange($(this).data('page-dir'));
    });
  }

  /**
   * Remembers page tokens for Firestore "pageToken" pagination.
   * Firestore only gives us the token for the NEXT page, so to go back
   * we keep every token we have used in an array (a simple history).
   *   tokens[0] = null (page 1), tokens[1] = token for page 2, ...
   */
  function createTokenPager() {
    let tokens = [null];
    let index = 0;
    let nextToken = null;
    return {
      currentToken: () => tokens[index],
      page: () => index + 1,
      setNextToken: (token) => { nextToken = token || null; },
      hasPrev: () => index > 0,
      hasNext: () => Boolean(nextToken),
      goNext() {
        if (!nextToken) return;
        tokens = tokens.slice(0, index + 1);
        tokens.push(nextToken);
        index++;
      },
      goPrev() {
        if (index > 0) index--;
      },
      reset() {
        tokens = [null];
        index = 0;
        nextToken = null;
      }
    };
  }

  /* ------------------------------------------------------------------
     Bar chart + CSV download (used by the dashboard and the reports)
     ------------------------------------------------------------------ */

  /**
   * A horizontal bar chart: one thin bar per item.
   *   items: [{ label, value, text, tone }]   text = what is written at the end of the bar
   *   tone : 'a' (terracotta, default) or 'b' (blue), see --chart-a / --chart-b in theme.css
   * The bar is a <progress> element, so screen readers announce "label: value" through
   * aria-label, and hovering a row shows the same text as a tooltip (title).
   */
  function barChart({ title, items, note = '' }) {
    if (!items || !items.length) return '';
    const max = Math.max(...items.map((item) => item.value), 0) || 1;
    const rows = items.map((item) => `
      <li class="bar-chart__row" title="${escapeHtml(item.label)}: ${escapeHtml(item.text)}">
        <span class="bar-chart__label">${escapeHtml(item.label)}</span>
        <progress class="bar-chart__bar ${item.tone === 'b' ? 'bar-chart__bar--b' : ''}" max="${max}" value="${Math.max(item.value, 0)}"
                  aria-label="${escapeHtml(item.label)}: ${escapeHtml(item.text)}"></progress>
        <span class="bar-chart__value">${escapeHtml(item.text)}</span>
      </li>`).join('');
    return `
      <figure class="bar-chart">
        <figcaption class="bar-chart__title">${escapeHtml(title)}</figcaption>
        <ul class="bar-chart__list">${rows}</ul>
        ${note ? `<p class="bar-chart__note">${escapeHtml(note)}</p>` : ''}
      </figure>`;
  }

  /**
   * Saves a table as a .csv file the browser downloads (no server involved).
   *   headers: ['Name', 'Qty']      rows: [['Pen', 3], ...]
   * Values with commas or quotes are wrapped in quotes ("" for a quote inside).
   * The file starts with a BOM (\uFEFF) so Excel reads UTF-8 correctly (the rupee sign, names).
   */
  function downloadCsv(filename, headers, rows) {
    const cell = (value) => {
      const text = value === null || value === undefined ? '' : String(value);
      return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    };
    const lines = [headers, ...rows].map((row) => row.map(cell).join(','));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ------------------------------------------------------------------
     Empty state + badges
     ------------------------------------------------------------------ */

  function emptyState({ icon = 'box', title, text = '', action = '' }) {
    return `
      <div class="empty-state">
        <div class="empty-state__art">${Icons.svg(icon, 40)}</div>
        <h3 class="empty-state__title">${escapeHtml(title)}</h3>
        ${text ? `<p class="empty-state__text">${escapeHtml(text)}</p>` : ''}
        ${action}
      </div>`;
  }

  /** Low (< LOW_STOCK) / High (> HIGH_STOCK) / In stock badge. */
  function stockBadge(qty) {
    if (qty <= 0) return '<span class="badge badge-danger badge-dot">Out of stock</span>';
    if (qty < CONFIG.LOW_STOCK) return `<span class="badge badge-warning badge-dot">Low · ${qty}</span>`;
    if (qty > CONFIG.HIGH_STOCK) return `<span class="badge badge-accent badge-dot">High · ${qty}</span>`;
    return `<span class="badge badge-success badge-dot">In stock · ${qty}</span>`;
  }

  // Public API of this module
  return {
    escapeHtml,
    formatMoney,
    formatDate,
    getQueryParam,
    debounce,
    toast,
    showError,
    modal,
    confirm,
    setBusy,
    skeletonCards,
    skeletonRows,
    skeletonChips,
    loader,
    barChart,
    downloadCsv,
    renderPagination,
    createTokenPager,
    emptyState,
    stockBadge
  };
})();
