// Maple Lane Bakery — application logic
// Loaded AFTER js/data.js (plain <script>, no modules).
// References the globals defined in data.js (MENU, REVIEWS, GALLERY, HOURS, BAKERY_INFO)
// and NEVER redeclares them. All user input is rendered via textContent/createElement.

(function () {
  'use strict';

  // ---- small helpers -------------------------------------------------------
  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  function el(tag, opts) {
    var node = document.createElement(tag);
    if (!opts) return node;
    if (opts.text != null) node.textContent = opts.text;
    if (opts.html != null) node.innerHTML = opts.html; // trusted strings only
    if (opts.cls) node.className = opts.cls;
    if (opts.attrs) for (var k in opts.attrs) node.setAttribute(k, opts.attrs[k]);
    if (opts.children) opts.children.forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function money(n) { return '$' + Number(n).toFixed(2); }

  var TAG_LABELS = { v: 'Vegetarian', vg: 'Vegan', gf: 'Gluten-free' };

  function escDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }

  function prettyDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    if (p.length !== 3) return iso;
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function prettyTime(t) {
    if (!t) return '';
    var p = t.split(':');
    var h = Number(p[0]);
    var m = p[1] || '00';
    var ap = h >= 12 ? 'PM' : 'AM';
    var hh = h % 12; if (hh === 0) hh = 12;
    return hh + ':' + m + ' ' + ap;
  }

  function stars(rating) {
    var full = Math.round(rating);
    var out = '';
    for (var i = 0; i < 5; i++) out += i < full ? '★' : '☆';
    return out;
  }

  // ---- menu ----------------------------------------------------------------
  var state = { cat: 'all', diet: 'all' };

  function itemCard(item) {
    var card = el('article', { cls: 'menu-card' });
    card.setAttribute('data-id', item.id);
    card.setAttribute('data-cat', item.category);
    if (item.tags.length) item.tags.forEach(function (t) { card.setAttribute('data-tag', t); });

    var top = el('div', { cls: 'card-top' });
    top.appendChild(el('span', { cls: 'card-emoji', text: item.emoji, attrs: { 'aria-hidden': 'true' } }));
    if (item.tags.length) {
      var pills = el('div', { cls: 'tags' });
      item.tags.forEach(function (t) {
        pills.appendChild(el('span', { cls: 'tag tag-' + t, text: TAG_LABELS[t] || t }));
      });
      top.appendChild(pills);
    } else {
      top.appendChild(el('span', { cls: 'tags tags-empty' }));
    }
    card.appendChild(top);

    var body = el('div', { cls: 'card-body' });
    body.appendChild(el('h3', { cls: 'card-name', text: item.name }));
    card.appendChild(body);

    var foot = el('div', { cls: 'card-foot' });
    foot.appendChild(el('span', { cls: 'cat-label', text: item.category }));
    foot.appendChild(el('span', { cls: 'price', text: money(item.price) }));
    card.appendChild(foot);

    return card;
  }

  function renderMenu(category, dietaryFilter) {
    state.cat = category || 'all';
    state.diet = dietaryFilter || 'all';

    var grid = $('#menu-grid');
    if (!grid) return;
    grid.innerHTML = '';

    var list = MENU.filter(function (item) {
      var catOk = state.cat === 'all' || item.category === state.cat;
      var dietOk = state.diet === 'all' || item.tags.indexOf(state.diet) !== -1;
      return catOk && dietOk;
    });

    if (!list.length) {
      grid.appendChild(emptyState('Nothing on the board here',
        'No ' + (state.cat === 'all' ? '' : state.cat.toLowerCase() + ' ') +
        (state.diet === 'all' ? '' : TAG_LABELS[state.diet].toLowerCase() + ' ') +
        'matches right now — try another filter.'));
    } else {
      list.forEach(function (item) { grid.appendChild(itemCard(item)); });
    }

    var count = $('#menu-count');
    if (count) {
      count.textContent = list.length + (list.length === 1 ? ' item' : ' items') +
        (state.cat !== 'all' ? ' in ' + state.cat : '') +
        (state.diet !== 'all' ? ' · ' + TAG_LABELS[state.diet] : '');
    }
  }

  function filterByDiet(tag) {
    state.diet = tag || 'all';
    $$('.diet-btn').forEach(function (b) {
      var on = b.getAttribute('data-diet') === state.diet;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    renderMenu(state.cat, state.diet);
  }

  function selectCat(cat) {
    state.cat = cat || 'all';
    $$('.cat-tab').forEach(function (b) {
      var on = b.getAttribute('data-cat') === state.cat;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    renderMenu(state.cat, state.diet);
  }

  function emptyState(title, sub) {
    var box = el('div', { cls: 'empty-state' });
    box.appendChild(el('span', { cls: 'empty-emoji', text: '🧺', attrs: { 'aria-hidden': 'true' } }));
    box.appendChild(el('h3', { cls: 'empty-title', text: title }));
    if (sub) box.appendChild(el('p', { cls: 'empty-sub', text: sub }));
    return box;
  }

  // ---- hours + map ---------------------------------------------------------
  function renderHours() {
    var list = $('#hours-list');
    if (!list) return;
    list.innerHTML = '';

    var today = new Date().getDay(); // 0 = Sunday

    HOURS.forEach(function (h, i) {
      var li = el('li', { cls: 'hours-row' + (i === today ? ' active-day' : '') });
      var name = el('span', { cls: 'hours-day', text: h.day });
      if (i === today) name.appendChild(el('span', { cls: 'today-badge', text: 'Today' }));
      li.appendChild(name);
      li.appendChild(el('span', { cls: 'hours-time', text: h.open + ' – ' + h.close }));
      list.appendChild(li);
    });

    // address + contact links (from BAKERY_INFO)
    var addr = $('#address-lines');
    if (addr && BAKERY_INFO && BAKERY_INFO.addressLines) {
      addr.textContent = BAKERY_INFO.addressLines.join(' · ');
    }
    setLink('#contact-phone', 'tel:', stripArea(BAKERY_INFO.phone), BAKERY_INFO.phone);
    setLink('#contact-email', 'mailto:', BAKERY_INFO.email, BAKERY_INFO.email);
    setLink('#call-link', 'tel:', stripArea(BAKERY_INFO.phone), BAKERY_INFO.phone);

    // footer contact + year
    var faddr = $('#footer-address');
    if (faddr && BAKERY_INFO) faddr.textContent = BAKERY_INFO.addressLines.join(', ');
    setLink('#footer-phone', 'tel:', stripArea(BAKERY_INFO.phone), BAKERY_INFO.phone);
    setLink('#footer-email', 'mailto:', BAKERY_INFO.email, BAKERY_INFO.email);
    var year = $('#year');
    if (year) year.textContent = String(new Date().getFullYear());
  }

  function stripArea(phone) {
    // "(503) 555-0142" -> "5035550142" for a tel: link
    return String(phone || '').replace(/\D/g, '');
  }

  function setLink(sel, scheme, value, label) {
    var a = $(sel);
    if (!a || !value) return;
    a.setAttribute('href', scheme + value);
    a.textContent = label;
  }

  // ---- reviews -------------------------------------------------------------
  function renderReviews() {
    var grid = $('#reviews-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!REVIEWS.length) {
      grid.appendChild(emptyState('No reviews yet', 'Be the first to leave a note at the counter.'));
      return;
    }

    REVIEWS.forEach(function (r) {
      var card = el('article', { cls: 'review-card' });
      var head = el('div', { cls: 'review-head' });
      head.appendChild(el('span', { cls: 'stars', text: stars(r.rating), attrs: { 'aria-label': r.rating + ' out of 5 stars' } }));
      head.appendChild(el('time', { cls: 'review-date', text: prettyDate(r.date), attrs: { datetime: r.date } }));
      card.appendChild(head);

      card.appendChild(el('blockquote', { cls: 'review-text', text: r.text }));
      card.appendChild(el('cite', { cls: 'review-name', text: r.name }));
      grid.appendChild(card);
    });
  }

  // ---- gallery -------------------------------------------------------------
  function renderGallery() {
    var grid = $('#gallery-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!GALLERY.length) {
      grid.appendChild(emptyState('The case is empty', 'Check back after the morning bake.'));
      return;
    }

    GALLERY.forEach(function (g) {
      var fig = el('figure', { cls: 'gallery-tile' });
      fig.appendChild(el('span', { cls: 'tile-emoji', text: g.emoji, attrs: { 'aria-hidden': 'true' } }));
      fig.appendChild(el('figcaption', { cls: 'tile-alt', text: g.alt }));
      grid.appendChild(fig);
    });
  }

  // ---- mobile menu ---------------------------------------------------------
  function toggleMobileMenu(force) {
    var menu = $('#mobile-menu');
    var btn = $('#hamburger-btn');
    if (!menu || !btn) return;

    var open = typeof force === 'boolean' ? force : !(menu.classList.contains('open'));
    menu.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }

  // ---- pickup form ---------------------------------------------------------
  function setError(id, msg) {
    var p = $('#' + id);
    if (!p) return;
    p.textContent = msg || '';
    var field = document.getElementById(id.replace('pickup-err-', 'pickup-'));
    if (field) field.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function clearErrors() {
    ['date', 'time', 'party', 'name', 'items'].forEach(function (k) { setError('pickup-err-' + k, ''); });
  }

  function submitPickup(event) {
    event.preventDefault();

    var dateEl = $('#pickup-date');
    var timeEl = $('#pickup-time');
    var partyEl = $('#pickup-party');
    var nameEl = $('#pickup-name');
    var itemsEl = $('#pickup-items');
    if (!dateEl || !timeEl || !partyEl || !nameEl) return;

    clearErrors();
    var ok = true;

    // date: required, not in the past
    var dv = (dateEl.value || '').trim();
    if (!dv) { setError('pickup-err-date', 'Please choose a pickup date.'); ok = false; }
    else {
      var picked = new Date(dv + 'T00:00:00');
      var today = new Date(); today.setHours(0, 0, 0, 0);
      if (isNaN(picked.getTime()) || picked < today) {
        setError('pickup-err-date', 'That date has already passed — pick today or later.'); ok = false;
      }
    }

    // time: required, within the pickup window
    var tv = (timeEl.value || '').trim();
    if (!tv) { setError('pickup-err-time', 'Please choose a pickup time.'); ok = false; }
    else {
      var parts = tv.split(':');
      var mins = Number(parts[0]) * 60 + Number(parts[1] || 0);
      if (isNaN(mins) || mins < 9 * 60 || mins > 15 * 60 + 30) {
        setError('pickup-err-time', 'Pickup window is 9:00 AM – 3:30 PM.'); ok = false;
      }
    }

    // party: required, >= 1 (and <= 20)
    var pv = parseInt(partyEl.value, 10);
    if (isNaN(pv) || pv < 1) { setError('pickup-err-party', 'Party size must be at least 1.'); ok = false; }
    else if (pv > 20) { setError('pickup-err-party', 'For parties over 20, call the counter.'); ok = false; }

    // name: required, trimmed, length-limited
    var nv = (nameEl.value || '').trim();
    if (!nv) { setError('pickup-err-name', 'Please add a name for the order.'); ok = false; }
    else if (nv.length > 60) { setError('pickup-err-name', 'Keep the name under 60 characters.'); ok = false; }

    // items: optional, length-limited
    var iv = itemsEl ? (itemsEl.value || '').trim() : '';
    if (iv.length > 500) { setError('pickup-err-items', 'Please keep your note under 500 characters.'); ok = false; }

    if (!ok) {
      var firstErr = $('.field-error:not(:empty)');
      if (firstErr) {
        var target = firstErr.previousElementSibling || firstErr;
        if (target && target.focus) target.focus();
      }
      return;
    }

    // success — build a reference and show the confirmation
    var ref = 'MLB-' + new Date().getFullYear() + '-' + String(Math.floor(1000 + Math.random() * 9000));
    var confirmEl = $('#pickup-confirmation');
    if (confirmEl) {
      confirmEl.innerHTML = '';
      confirmEl.hidden = false;
      confirmEl.classList.add('is-success');

      confirmEl.appendChild(el('span', { cls: 'conf-emoji', text: '📦', attrs: { 'aria-hidden': 'true' } }));
      confirmEl.appendChild(el('h3', { cls: 'conf-title', text: 'Order received!' }));
      confirmEl.appendChild(el('p', { cls: 'conf-ref', text: 'Reference ' + ref }));

      var detail = el('ul', { cls: 'conf-list' });
      detail.appendChild(li('📅', prettyDate(dv)));
      detail.appendChild(li('🕰️', prettyTime(tv)));
      detail.appendChild(li('👥', pv + (pv === 1 ? ' person' : ' people')));
      detail.appendChild(li('🏷️', nv));
      if (iv) detail.appendChild(li('🧾', iv));
      confirmEl.appendChild(detail);

      confirmEl.appendChild(el('p', { cls: 'conf-note', text: "We'll have it boxed and waiting at the counter. Show this reference when you arrive." }));
      confirmEl.appendChild(el('button', {
        cls: 'btn btn-ghost conf-reset', type: 'button', text: 'Place another order'
      }));

      // remember the last successful reference (no sensitive data)
      try { localStorage.setItem('mlb-last-ref', ref); } catch (e) { /* storage unavailable */ }

      confirmEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // reset the form for the next order
    var form = $('#pickup-form');
    if (form) form.reset();
    updateItemsCount(itemsEl);
  }

  function li(icon, text) {
    var item = el('li', { cls: 'conf-item' });
    item.appendChild(el('span', { cls: 'conf-ico', text: icon, attrs: { 'aria-hidden': 'true' } }));
    item.appendChild(el('span', { cls: 'conf-val', text: text }));
    return item;
  }

  function updateItemsCount(textarea) {
    var count = $('#pickup-items-count');
    if (!count || !textarea) return;
    var len = (textarea.value || '').length;
    count.textContent = len + ' / 500';
    count.classList.toggle('is-warn', len > 460);
  }

  // ---- init ----------------------------------------------------------------
  function bind() {
    // category tabs
    $$('.cat-tab').forEach(function (b) {
      b.addEventListener('click', function () { selectCat(b.getAttribute('data-cat')); });
    });

    // diet filters
    $$('.diet-btn').forEach(function (b) {
      b.addEventListener('click', function () { filterByDiet(b.getAttribute('data-diet')); });
    });

    // mobile menu
    var hamburger = $('#hamburger-btn');
    if (hamburger) hamburger.addEventListener('click', function () { toggleMobileMenu(); });

    // close the mobile menu after choosing a link (only when it's actually open)
    $$('#mobile-menu a').forEach(function (a) {
      a.addEventListener('click', function () {
        var menu = $('#mobile-menu');
        if (menu && menu.classList.contains('open')) toggleMobileMenu(false);
      });
    });

    // close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var menu = $('#mobile-menu');
        if (menu && menu.classList.contains('open')) {
          toggleMobileMenu(false);
          if (hamburger) hamburger.focus();
        }
      }
    });

    // pickup form
    var form = $('#pickup-form');
    if (form) form.addEventListener('submit', submitPickup);

    // live character counter
    var itemsEl = $('#pickup-items');
    if (itemsEl) {
      itemsEl.addEventListener('input', function () { updateItemsCount(itemsEl); });
    }

    // confirmation "place another order"
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.classList && t.classList.contains('conf-reset')) {
        var confirmEl = $('#pickup-confirmation');
        if (confirmEl) { confirmEl.hidden = true; confirmEl.innerHTML = ''; }
        if (form) form.reset();
        if (itemsEl) updateItemsCount(itemsEl);
        var nameEl = $('#pickup-name');
        if (nameEl) nameEl.focus();
      }
    });

    // bound the date picker to today..+7 days
    var dateEl = $('#pickup-date');
    if (dateEl) {
      var min = new Date();
      var max = new Date(); max.setDate(max.getDate() + 7);
      dateEl.min = escDate(min);
      dateEl.max = escDate(max);
    }
  }

  function init() {
    renderMenu('all', 'all');
    renderHours();
    renderReviews();
    renderGallery();
    bind();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();