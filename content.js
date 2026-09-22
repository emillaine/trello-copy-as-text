(() => {
  'use strict';

  const ROW_ATTR = 'data-tre-copy-row';
  const ROW_LABEL = 'Copy list as text';
  const MENU_STALE_MS = 3000;

  const extractShortLink = (href) => {
    const m = typeof href === 'string' && href.match(/\/c\/([A-Za-z0-9]+)/);
    return m ? m[1] : null;
  };

  const boardShortLink = () => {
    const m = location.pathname.match(/^\/b\/([A-Za-z0-9]+)/);
    return m ? m[1] : null;
  };

  // Exactly '##' + title + '\n' + description per card, blank line between cards.
  // Trailing whitespace is stripped per block (descriptions often end with
  // stray newlines) and empty descriptions emit no extra newline, so cards
  // are always separated by exactly one blank line.
  const formatCards = (cards) =>
    cards
      .map((c) => {
        const title = c.title.trim();
        const desc = (c.desc || '').replace(/\s+$/, '');
        return desc ? `## ${title}\n${desc}` : `## ${title}`;
      })
      .join('\n\n') + (cards.length ? '\n' : '');

  // Cards in visible top-to-bottom order.
  const readDomCards = (list) => {
    const seen = new Set();
    const out = [];
    for (const a of list.querySelectorAll('a[href*="/c/"]')) {
      const shortLink = extractShortLink(a.getAttribute('href'));
      if (!shortLink || seen.has(shortLink)) continue;
      seen.add(shortLink);
      const nameEl = a.querySelector('[data-testid="card-name"]');
      const title = ((nameEl ? nameEl.innerText : a.innerText) || '').trim();
      if (title) out.push({ title, shortLink });
    }
    return out;
  };

  const fetchJson = async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  // One small request for just this list's cards (names + descriptions only).
  // Works without an API token: public boards need no auth, private boards
  // authenticate via the login session cookie (same-origin fetch).
  const fetchDescsViaList = async (listId) => {
    const cards = await fetchJson(
      `https://trello.com/1/lists/${listId}/cards?fields=name,desc,shortLink&filter=open`
    );
    const byShortLink = new Map();
    for (const c of cards) byShortLink.set(c.shortLink, { name: c.name, desc: c.desc || '' });
    return byShortLink;
  };

  // Fallback: whole-board JSON (much larger, but needs no auth at all).
  const fetchDescsViaBoard = async (boardId) => {
    const board = await fetchJson(`https://trello.com/b/${boardId}.json`);
    const byShortLink = new Map();
    for (const c of board.cards || []) {
      if (!c.closed) byShortLink.set(c.shortLink, { name: c.name, desc: c.desc || '' });
    }
    return byShortLink;
  };

  const fetchDescViaCard = async (shortLink) => {
    const card = await fetchJson(`https://trello.com/c/${shortLink}.json`);
    return { name: card.name, desc: card.desc || '' };
  };

  const writeClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fallback for pages where the async clipboard API is unavailable.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        if (!document.execCommand('copy')) throw new Error('execCommand failed');
      } finally {
        ta.remove();
      }
    }
  };

  const collectListText = async (list) => {
    const domCards = readDomCards(list);
    if (!domCards.length) return '';
    let byShortLink = null;
    try {
      const listId = list.getAttribute('data-list-id');
      if (!listId) throw new Error('no list id');
      byShortLink = await fetchDescsViaList(listId);
    } catch {
      const boardId = boardShortLink();
      if (boardId) {
        try {
          byShortLink = await fetchDescsViaBoard(boardId);
        } catch {
          byShortLink = null;
        }
      }
    }
    const cards = await Promise.all(
      domCards.map(async ({ title, shortLink }) => {
        const hit = byShortLink && byShortLink.get(shortLink);
        if (hit) return { title: title || hit.name, desc: hit.desc };
        try {
          const c = await fetchDescViaCard(shortLink);
          return { title: title || c.name, desc: c.desc };
        } catch {
          return { title, desc: '' }; // title-only fallback
        }
      })
    );
    return formatCards(cards);
  };

  // --- List actions menu integration ---
  // The ... menu is rendered on demand, so remember which list opened it
  // (capture phase, before Trello's own handler) and inject our row when
  // the popover appears.
  let menuList = null;
  let menuListAt = 0;
  let rowForList = null; // list the currently injected row was built for
  let selfUpdate = false; // our own DOM write is already queued; skip it

  document.addEventListener(
    'click',
    (e) => {
      const t = e.target instanceof Element ? e.target : null;
      const menuBtn =
        t &&
        t.closest &&
        t.closest(
          '[data-testid="list-edit-menu-button"], button[aria-label*="List actions" i], ' +
            '.js-list-menu, [data-testid*="list-menu" i]'
        );
      if (!menuBtn) return;
      const list = menuBtn.closest('[data-list-id]');
      if (list) {
        menuList = list;
        menuListAt = Date.now();
      }
    },
    true
  );

  const MENU_POPOVER = '[data-testid="list-actions-popover"]';
  const COPY_LIST_BTN = '[data-testid="list-actions-copy-list-button"]';

  const findMenuPopover = () => {
    const pop = document.querySelector(MENU_POPOVER);
    if (!pop) return null;
    try {
      const cs = getComputedStyle(pop);
      if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    } catch {
      // Assume visible.
    }
    return pop;
  };

  // Clone the native "Copy list" row (inserted right after it) so ours
  // matches Trello's menu styling exactly.
  const buildRow = (pop) => {
    const anchor = pop.querySelector(COPY_LIST_BTN);
    const anchorLi = anchor && anchor.closest('li');
    if (!anchorLi || !anchorLi.parentElement) return null; // not the main view
    const row = anchorLi.cloneNode(true);
    row.removeAttribute('id');
    row.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    row.querySelectorAll('[data-testid]').forEach((n) => n.removeAttribute('data-testid'));
    row.setAttribute(ROW_ATTR, '1');
    const clickable = row.querySelector('button, a') || row;
    // Keep Trello's typography classes: write into the innermost span.
    const spans = clickable.querySelectorAll('span');
    const labelEl = spans.length ? spans[spans.length - 1] : clickable;
    labelEl.textContent = ROW_LABEL;
    return { parent: anchorLi.parentElement, after: anchorLi.nextSibling, row, clickable, labelEl };
  };

  const closePopover = () => {
    const closeBtn = document.querySelector(`${MENU_POPOVER} button[aria-label="Close popover"]`);
    if (closeBtn) closeBtn.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  };

  const onRowClick = (e, list, built) => {
    e.preventDefault();
    e.stopPropagation();
    (async () => {
      built.labelEl.textContent = 'Copying...';
      try {
        const text = await collectListText(list);
        if (!text) {
          built.labelEl.textContent = 'No cards to copy';
        } else {
          await writeClipboard(text);
          built.labelEl.textContent = 'Copied ✓';
        }
      } catch {
        built.labelEl.textContent = 'Copy failed ⚠';
      }
      setTimeout(() => {
        built.labelEl.textContent = ROW_LABEL;
        closePopover();
      }, 900);
    })();
  };

  const maybeInjectRow = () => {
    // Skip callbacks caused by our own row insert/remove, and never touch
    // the DOM when the right row is already in place. Without this the
    // observer re-triggers itself in a hot loop (jank + row churn).
    if (selfUpdate) {
      selfUpdate = false;
      return;
    }
    const pop = findMenuPopover();
    if (!pop) {
      menuList = null;
      rowForList = null;
      return;
    }
    if (
      rowForList === menuList &&
      menuList &&
      Date.now() - menuListAt <= MENU_STALE_MS &&
      pop.querySelector(`[${ROW_ATTR}]`)
    ) {
      return;
    }
    if (!menuList || Date.now() - menuListAt > MENU_STALE_MS) return;
    const built = buildRow(pop);
    if (!built) return;
    selfUpdate = true;
    // Rebuilt from scratch each time so a cached popover never stays
    // bound to a previously opened list.
    pop.querySelectorAll(`[${ROW_ATTR}]`).forEach((n) => n.remove());
    const list = menuList;
    built.clickable.addEventListener('click', (e) => onRowClick(e, list, built));
    built.parent.insertBefore(built.row, built.after);
    rowForList = list;
  };

  new MutationObserver(maybeInjectRow).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
