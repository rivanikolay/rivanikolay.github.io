/* Renders the CV from content.json and drives the motion. */
(() => {
  'use strict';

  /* ---------- pure helpers ----------
     Everything up to the "browser only" line works without a page, so tests can load this file in Node
     (tests/app-helpers.test.js). Nothing here may touch document, window or the current language. */

  const LANGS = ['en', 'de'];
  // Each language is named in itself, so a visitor always finds their own.
  const LANG_NAMES = { en: 'English', de: 'Deutsch' };

  // Words the page itself needs, beside the texts from content.json.
  const UI = {
    en: {
      menu: 'Menu',
      toDark: 'Switch to dark mode',
      toLight: 'Switch to light mode',
      scrollDown: 'Scroll down',
      mapCredit: 'Map data © swisstopo',
      language: 'Language',
      fluency: 'Fluency',
      fluencyOf: (name) => `${name} fluency`,
      levels: ['A little', 'Basic', 'Medium', 'Good', 'Very good', 'Perfect'],
      email: 'Email',
      phone: 'Phone',
      moreAbout: (title) => `More about ${title}`,
      image: (title, n) => `${title} — image ${n}`,
      portrait: 'Portrait',
      close: 'Close',
      viewer: 'Image viewer',
      previous: 'Previous image',
      next: 'Next image',
    },
    de: {
      menu: 'Menü',
      toDark: 'Zum dunklen Modus wechseln',
      toLight: 'Zum hellen Modus wechseln',
      scrollDown: 'Nach unten scrollen',
      mapCredit: 'Kartendaten © swisstopo',
      language: 'Sprache',
      fluency: 'Niveau',
      fluencyOf: (name) => `Niveau ${name}`,
      levels: ['Wenig', 'Grundlagen', 'Mittel', 'Gut', 'Sehr gut', 'Perfekt'],
      email: 'E-Mail',
      phone: 'Telefon',
      moreAbout: (title) => `Mehr über ${title}`,
      image: (title, n) => `${title} – Bild ${n}`,
      portrait: 'Porträt',
      close: 'Schliessen',
      viewer: 'Bildansicht',
      previous: 'Vorheriges Bild',
      next: 'Nächstes Bild',
    },
  };

  // Texts are stored as { en, de }; an empty German text falls back to the English one.
  const isText = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && 'en' in v;
  function localizeIn(v, lang) {
    if (isText(v)) return String(v[lang] ?? '').trim() ? v[lang] : (v.en ?? '');
    if (Array.isArray(v)) return v.map((x) => localizeIn(x, lang));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, localizeIn(x, lang)]));
    return v;
  }

  // Makes text safe to put into HTML: <, >, &, " and ' can no longer start a tag or end an attribute.
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const delay = (i) => `style="--d:${i * 80}ms"`;
  const when = (value, html) => (String(value ?? '').trim() ? html : '');
  const list = (items) => (Array.isArray(items) ? items : []);
  const pad = (n) => String(n).padStart(2, '0');
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  const telHref = (v) => `tel:${String(v).replace(/[^\d+]/g, '')}`;

  // Web addresses inside longer text become links, shown without "https://" and query strings.
  // The text is escaped first, so only plain http(s) addresses can ever become a link.
  // "*" ends an address, so **https://…** stays bold around the link instead of breaking it.
  const linkUrls = (text) => esc(text).replace(/https?:\/\/[^\s<*]+[^\s<*.,;:!?)]/g, (url) => {
    const label = url.replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/$/, '');
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // **double asterisks** make text bold; web addresses become links.
  const rich = (text) => linkUrls(text).replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');

  const initials = (name) => String(name ?? '')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0].toUpperCase()).join('');

  // Images may only come from this site's assets folder or a secure web address,
  // so a changed content.json cannot point an image at "javascript:" or a local file.
  const safeSrc = (src) => {
    const s = String(src ?? '').trim();
    if (/^assets\/[\w@%./-]+$/.test(s) && !s.split('/').includes('..')) return s;
    if (/^https:\/\/[^\s"'<>]+$/.test(s)) return s;
    return '';
  };

  // An empty line in the text starts a new paragraph.
  const paragraphs = (text) => String(text ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const images = (item) => list(item?.images).map(safeSrc).filter(Boolean);

  // Turns a 0–100 level into words, so the bars read as a scale.
  function fluencyWord(level, levels) {
    const v = Number(level) || 0;
    const [little, basic, medium, good, veryGood, perfect] = levels;
    if (v >= 95) return perfect;
    if (v >= 80) return veryGood;
    if (v >= 60) return good;
    if (v >= 40) return medium;
    if (v >= 20) return basic;
    return little;
  }

  // How an image sits in its frame, set per image in content.json under "media":
  // a focus point that stays visible, an optional zoom, or the whole image without cropping.
  // Every number is clamped, so nothing but these few CSS rules can end up in the style attribute.
  function frameStyleFor(f) {
    if (!f || typeof f !== 'object') return '';
    const x = clamp(Number(f.x ?? 50) || 0, 0, 100);
    const y = clamp(Number(f.y ?? 50) || 0, 0, 100);
    const zoom = clamp(Number(f.zoom) || 1, 1, 3);
    const rules = [`object-position:${x}% ${y}%`];
    if (f.fit === 'contain') rules.push('object-fit:contain');
    else if (zoom > 1) rules.push(`transform-origin:${x}% ${y}%`, `scale:${zoom}`);
    return ` style="${rules.join(';')}"`;
  }

  // Photos are named "<name>@<width>.webp" and come with a 900px copy "<name>@<width>-900.webp",
  // so phones can load the small one. `zoom` makes the image open full size in the viewer when clicked.
  function imgTag(src, alt, { sizes = '100vw', eager = false, className = '', zoom = false, frame = null } = {}) {
    const safe = safeSrc(src);
    if (!safe) return '';
    const m = /@(\d+)\.(webp|jpe?g|png)$/.exec(safe);
    const srcset = m && Number(m[1]) > 900
      ? ` srcset="${esc(safe.replace(/\.(\w+)$/, '-900.$1'))} 900w, ${esc(safe)} ${m[1]}w" sizes="${esc(sizes)}"`
      : '';
    const loading = eager ? 'fetchpriority="high"' : 'loading="lazy"';
    const zoomAttr = zoom ? ` data-zoom="${esc(safe)}"` : '';
    return `<img${className ? ` class="${esc(className)}"` : ''} src="${esc(safe)}"${srcset} alt="${esc(alt)}"${frameStyleFor(frame)}${zoomAttr} ${loading} decoding="async">`;
  }

  const splitLetters = (text, start = 0) => [...String(text)]
    .map((ch, i) => (ch === ' ' ? ' ' : `<span class="ch" style="--i:${start + i}">${esc(ch)}</span>`))
    .join('');

  // Bold can span several words, so each "**" flips it on or off as the words are walked.
  const splitWords = (text, className, start = 0) => {
    let bold = false;
    return String(text).split(/\s+/).filter(Boolean).map((w, i) => {
      const html = w.split('**').map((part, j) => {
        if (j) bold = !bold;
        return part && bold ? `<strong>${esc(part)}</strong>` : esc(part);
      }).join('');
      return `<span class="${className}" style="--i:${start + i}">${html}</span>`;
    }).join(' ');
  };

  // In Node (the tests) there is no page: hand the helpers over and stop here.
  if (typeof document === 'undefined') {
    module.exports = {
      LANGS, LANG_NAMES, UI, isText, localizeIn, esc, delay, when, list, pad, clamp,
      telHref, linkUrls, rich, initials, safeSrc, paragraphs, images,
      fluencyWord, frameStyleFor, imgTag, splitLetters, splitWords,
    };
    return;
  }

  /* ---------- browser only ---------- */

  const nav = document.getElementById('nav');
  const app = document.getElementById('app');
  const footer = document.getElementById('footer');

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NAV_SECTIONS = ['about', 'education', 'languages', 'hobbies', 'reference'];

  // The address (?lang=de) wins, then the visitor's last choice, then their browser's language.
  function initialLang() {
    const fromUrl = new URLSearchParams(location.search).get('lang');
    if (LANGS.includes(fromUrl)) return fromUrl;
    try {
      const saved = localStorage.getItem('lang');
      if (LANGS.includes(saved)) return saved;
    } catch { /* private mode */ }
    const preferred = (navigator.languages || [navigator.language]).map((l) => String(l).slice(0, 2).toLowerCase());
    return preferred.find((l) => LANGS.includes(l)) || 'en';
  }

  let lang = initialLang();
  const t = () => UI[lang];
  const localize = (v) => localizeIn(v, lang);
  const fluency = (level) => fluencyWord(level, t().levels);

  let content = null; // as stored, with both languages
  let view = null;    // the same content in the current language
  // With "reduce motion" switched on, everything is shown at once instead of animating in.
  const showInstantly = reducedMotion;
  let revealAllOnce = false;
  let revealObserver = null;

  const img = (src, alt, options = {}) => imgTag(src, alt, { ...options, frame: content?.media?.[src] });

  const icon = {
    check: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevronDown: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 4l4.5 4.5L10.5 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevronRight: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevronLeft: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 2l-4 4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4 7l8 6 8-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5h2.6l1.4 4.2-2 1.4a12 12 0 0 0 6.3 6.3l1.4-2 4.2 1.4v2.6A2.1 2.1 0 0 1 18.3 19.5 15.8 15.8 0 0 1 4.5 5.7 2.1 2.1 0 0 1 6.6 3.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  };

  const sectionHead = (s) => `
    ${when(s.eyebrow, `<p class="eyebrow reveal">${esc(s.eyebrow)}</p>`)}
    ${when(s.headline, `<h2 class="headline reveal" ${delay(1)}>${esc(s.headline)}</h2>`)}`;

  /* ---------- theme ---------- */

  // Light unless the visitor picked dark.
  const currentTheme = () => document.documentElement.dataset.theme || 'light';

  function themeButton() {
    const dark = currentTheme() === 'dark';
    return `<button class="theme-toggle" type="button" aria-label="${dark ? t().toLight : t().toDark}">${dark ? icon.sun : icon.moon}</button>`;
  }

  // Grows the new theme out of the button in a circle, where the browser supports it.
  function toggleTheme(button) {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    const apply = () => {
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch { /* private mode */ }
      button.outerHTML = themeButton();
    };

    if (!document.startViewTransition || reducedMotion) return apply();

    const r = button.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(apply).ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 650, easing: 'cubic-bezier(.16, 1, .3, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    });
  }

  // Switches language in place and keeps it in the address, so a shared link opens in the same language.
  function setLang(next) {
    if (!LANGS.includes(next) || next === lang) return;
    lang = next;
    try { localStorage.setItem('lang', lang); } catch { /* private mode */ }
    const url = new URL(location.href);
    if (lang === 'en') url.searchParams.delete('lang');
    else url.searchParams.set('lang', lang);
    history.replaceState(null, '', url);
    revealAllOnce = true;
    closeSheet();
    sheet?.remove(); // rebuilt in the new language on next open
    sheet = null;
    closeViewer();
    viewer?.remove();
    viewer = null;
    render();
  }

  /* ---------- sections ---------- */

  function renderNav(c) {
    const ids = NAV_SECTIONS.filter((id) => c[id]);
    const links = ids.map((id, i) => `
      <li style="--i:${i}"><a href="#${id}" data-section="${id}">${esc(c[id].navLabel)}</a></li>`).join('');

    return `
      <div class="nav-inner">
        <a class="nav-brand" href="#top">${esc(c.site.brand)}</a>
        <ul class="nav-links">
          ${links}
          <li class="nav-links-cta" style="--i:${ids.length}"><a href="#contact">${esc(c.site.contactButton)}</a></li>
        </ul>
        <div class="nav-end">
          <div class="lang-menu">
            <button class="lang-toggle" type="button" aria-haspopup="true" aria-expanded="false">${LANG_NAMES[lang]}${icon.chevronDown}</button>
            <ul class="lang-options">
              ${LANGS.map((code) => `
                <li><button class="lang-option" type="button" lang="${code}" data-lang="${code}" ${code === lang ? 'aria-current="true"' : ''}>${LANG_NAMES[code]}${code === lang ? icon.check : ''}</button></li>`).join('')}
            </ul>
          </div>
          ${themeButton()}
          <a class="nav-cta" href="#contact">${esc(c.site.contactButton)}</a>
          <button class="nav-toggle" type="button" aria-label="${t().menu}" aria-expanded="false"><span></span><span></span></button>
        </div>
      </div>`;
  }

  // The name fills the screen, then shrinks into place while the tagline and buttons fade in.
  function renderHero(h) {
    const fullName = [h.firstName, h.middleName, h.lastName].filter(Boolean).join(' ');
    const lastStart = [...String(h.firstName ?? '')].length + 2;

    return `
      <section class="hero" id="top">
        <div class="hero-sticky">
          <div class="hero-map" aria-hidden="true"><div class="hero-map-plane"><canvas></canvas><canvas class="hero-map-final"></canvas></div></div>
          <div class="hero-head">
            ${when(h.eyebrow, `<p class="hero-eyebrow hero-anim" style="--d:0ms">${esc(h.eyebrow)}</p>`)}
            <h1 class="hero-name">
              <span class="sr-only">${esc(fullName)}</span>
              ${when(h.firstName, `<span class="first split" aria-hidden="true">${splitLetters(h.firstName)}</span>`)}
              ${when(h.middleName, `<span class="middle" aria-hidden="true">${esc(h.middleName)}</span>`)}
              ${when(h.lastName, `<span class="last split" aria-hidden="true">${splitLetters(h.lastName, lastStart)}</span>`)}
            </h1>
          </div>
          <div class="hero-rest">
            ${when(h.tagline, `<p class="hero-tagline">${rich(h.tagline)}</p>`)}
            <div class="cta-row">
              ${when(h.primaryButton, `<a class="btn btn-primary" href="#contact">${esc(h.primaryButton)}</a>`)}
              ${when(h.secondaryButton, `<a class="btn-link" href="#about">${esc(h.secondaryButton)} ${icon.chevronRight}</a>`)}
            </div>
          </div>
          <a class="scroll-hint" href="#about" aria-label="${t().scrollDown}">${icon.chevronDown}</a>
          <p class="hero-credit">${t().mapCredit}</p>
        </div>
      </section>`;
  }

  function renderAbout(a, c) {
    const story = paragraphs(a.story);
    const name = [c.hero?.firstName, c.hero?.lastName].filter(Boolean).join(' ');
    const main = (a.photo || story.length) ? `
      <div class="about-main ${a.photo ? 'has-photo' : ''}">
        ${when(a.photo, `
          <div class="about-photo-wrap">
            <figure class="about-photo reveal">
              ${img(a.photo, name || t().portrait, { sizes: '(max-width: 833px) 90vw, 400px', zoom: true })}
            </figure>
          </div>`)}
        ${story.length ? `
          <div class="story reveal" ${delay(1)}>
            ${story.map((p) => `<p>${splitWords(p, 'sw')}</p>`).join('')}
          </div>` : ''}
      </div>` : '';

    return `
      <section class="section section-alt" id="about">
        <div class="container">
          ${sectionHead(a)}
          ${when(a.intro, `<p class="lead reveal" ${delay(2)}>${rich(a.intro)}</p>`)}
          ${main}
        </div>
      </section>`;
  }

  // A side branch, like in Git: it leaves the main line at its school and lists what happened alongside.
  const renderBranch = (branches) => {
    const items = list(branches).filter((b) => String(b.title ?? '').trim());
    if (!items.length) return '';
    return `
      <ol class="tl-branch">
        ${items.map((b) => `
          <li class="tl-branch-item">
            ${when(b.period, `<p class="tl-branch-period">${esc(b.period)}</p>`)}
            <h4 class="tl-branch-title">${esc(b.title)}</h4>
            ${when(b.text, `<p class="tl-branch-text">${rich(b.text)}</p>`)}
          </li>`).join('')}
      </ol>`;
  };

  const renderEducation = (e) => `
    <section class="section section-base" id="education">
      <div class="container">
        ${sectionHead(e)}
        <ol class="timeline">
          ${list(e.items).map((item, i) => `
            <li class="tl-item reveal" ${delay(i)}>
              <p class="tl-period">${esc(item.period)}</p>
              <h3 class="tl-title">${esc(item.title)}</h3>
              ${when(item.place, `<p class="tl-place">${esc(item.place)}</p>`)}
              ${renderBranch(item.branches)}
            </li>`).join('')}
        </ol>
      </div>
    </section>`;

  // Compact: headline on the left, one card with a row per language on the right.
  const renderLanguages = (l) => `
    <section class="section section-base section-compact" id="languages">
      <div class="container split-layout">
        <div>${sectionHead(l)}</div>
        <div class="lang-card reveal" ${delay(1)}>
          <div class="lang-head" aria-hidden="true"><span>${t().language}</span><span>${t().fluency}</span></div>
          <ul class="lang-list">
            ${list(l.items).map((item, i) => {
              const value = clamp(Number(item.level) || 0, 0, 100);
              const word = fluency(value);
              return `
                <li class="lang-row" style="--d:${i * 90}ms">
                  <div class="lang-text">
                    <h3 class="lang-name">${esc(item.name)}</h3>
                    <p class="lang-note">${esc(item.note)}</p>
                  </div>
                  <div class="lang-level">
                    <span class="lang-word">${word}</span>
                    <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}" aria-valuetext="${word}" aria-label="${esc(t().fluencyOf(item.name))}"><span style="--level:${value / 100}"></span></div>
                  </div>
                </li>`;
            }).join('')}
          </ul>
        </div>
      </div>
    </section>`;

  const renderHobbies = (h) => `
    <section class="section section-alt" id="hobbies">
      <div class="container-wide">
        <div class="container">${sectionHead(h)}</div>
        <div class="grid bento">
          ${list(h.items).map((item, i) => {
            const cover = images(item)[0];
            return `
              <article class="card tile reveal ${cover ? 'has-media' : ''}" ${delay(i % 2)}>
                <span class="tile-index gradient-text">${pad(i + 1)}</span>
                ${when(cover, `<figure class="tile-media">${img(cover, '', { sizes: '(max-width: 833px) 70vw, 560px' })}</figure>`)}
                <div class="tile-bottom">
                  <div>
                    <h3 class="tile-title">${esc(item.title)}</h3>
                    ${when(item.text, `<p class="tile-text">${rich(item.text)}</p>`)}
                  </div>
                  <button class="tile-open" type="button" data-hobby="${i}" aria-haspopup="dialog" aria-label="${esc(t().moreAbout(item.title))}">${icon.plus}</button>
                </div>
              </article>`;
          }).join('')}
        </div>
      </div>
    </section>`;

  // A contact card, like the one in the Contacts app.
  const renderReference = (r) => `
    <section class="section section-base section-compact" id="reference">
      <div class="container split-layout">
        <div>${sectionHead(r)}</div>
        <div class="ref-card reveal" ${delay(1)}>
          <div class="ref-person">
            ${r.photo
              ? img(r.photo, '', { sizes: '72px', className: 'ref-avatar' })
              : when(initials(r.name), `<div class="ref-avatar" aria-hidden="true">${esc(initials(r.name))}</div>`)}
            <div>
              <h3 class="ref-name">${esc(r.name)}</h3>
              ${when(r.role, `<p class="ref-role">${esc(r.role)}</p>`)}
            </div>
          </div>
          ${when(r.email || r.phone, `<div class="ref-rows">
            ${when(r.email, `
              <a class="ref-row" href="mailto:${esc(r.email)}">
                <span class="ref-icon">${icon.mail}</span>
                <span class="ref-value"><span class="ref-label">${t().email}</span>${esc(r.email).replace('@', '@<wbr>')}</span>
                ${icon.chevronRight}
              </a>`)}
            ${when(r.phone, `
              <a class="ref-row" href="${esc(telHref(r.phone))}">
                <span class="ref-icon">${icon.phone}</span>
                <span class="ref-value"><span class="ref-label">${t().phone}</span>${esc(r.phone)}</span>
                ${icon.chevronRight}
              </a>`)}
          </div>`)}
          ${when(r.note, `<p class="ref-note"><span class="ref-icon">${icon.lock}</span>${esc(r.note)}</p>`)}
        </div>
      </div>
    </section>`;

  const renderContact = (c) => `
    <section class="section section-dark contact" id="contact">
      <div class="container center">
        ${when(c.eyebrow, `<p class="eyebrow reveal">${esc(c.eyebrow)}</p>`)}
        ${when(c.headline, `<h2 class="headline headline-xl reveal" ${delay(1)}><span class="gradient-text">${esc(c.headline)}</span></h2>`)}
        ${when(c.text, `<p class="lead reveal" ${delay(2)}>${rich(c.text)}</p>`)}
        <div class="cta-row reveal" ${delay(3)}>
          ${when(c.email, `<a class="btn btn-primary" href="mailto:${esc(c.email)}">${esc(c.emailButton || c.email)}</a>`)}
          ${when(c.phone, `<a class="btn btn-ghost" href="${esc(telHref(c.phone))}">${esc(c.phoneButton || c.phone)}</a>`)}
        </div>
        <p class="contact-meta reveal" ${delay(4)}>${[c.email, c.phone].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ')}</p>
      </div>
    </section>`;

  const renderFooter = (f) => `
    <div class="container footer-inner">
      <p>${esc(f.text)}</p>
      ${when(f.note, `<p class="footer-right">${esc(f.note)}</p>`)}
    </div>`;

  /* ---------- render ---------- */

  function render() {
    const c = (view = localize(content));
    document.title = c.site?.title || 'CV';
    document.documentElement.lang = lang;

    nav.innerHTML = renderNav(c);
    app.innerHTML = [
      c.hero && renderHero(c.hero),
      c.about && renderAbout(c.about, c),
      c.education && renderEducation(c.education),
      c.languages && renderLanguages(c.languages),
      c.hobbies && renderHobbies(c.hobbies),
      c.reference && renderReference(c.reference),
      c.contact && renderContact(c.contact),
    ].filter(Boolean).join('');
    footer.innerHTML = c.footer ? renderFooter(c.footer) : '';

    setupReveal();
    measureGradientName();
    measureTimeline();
    onScroll();
    document.dispatchEvent(new CustomEvent('cv:render')); // hero-map.js moves its map into the new hero
  }

  function setupReveal() {
    revealObserver?.disconnect();
    const els = document.querySelectorAll('.reveal');

    // After a language switch the visitor has already seen the page, so nothing animates in again.
    if (showInstantly || revealAllOnce || !('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('shown'));
      revealAllOnce = false;
      return;
    }

    revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        revealObserver.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.01 });

    els.forEach((el) => revealObserver.observe(el));
  }

  // Each letter carries its own slice of one shared gradient, so the word still reads as one sweep.
  function measureGradientName() {
    const last = app.querySelector('.hero-name .last');
    if (!last) return;
    last.style.setProperty('--w', `${last.offsetWidth}px`);
    last.querySelectorAll('.ch').forEach((ch) => ch.style.setProperty('--x', `${ch.offsetLeft}px`));
  }

  // The main timeline line turns blue just before the newest school. Entries differ in height
  // (branches make them taller), so we measure where the last one starts and hand that to the CSS.
  function measureTimeline() {
    const timeline = app.querySelector('.timeline');
    const newest = timeline?.querySelector('.tl-item:last-child');
    if (!newest) return;
    // The line itself starts 10px below the top of the list, the dot 6px into its entry.
    timeline.style.setProperty('--tl-current', `${newest.offsetTop + 6 - 10}px`);
  }

  /* ---------- scroll ---------- */

  let scrollQueued = false;
  let litCount = -1;

  function onScroll() {
    const vh = window.innerHeight;

    // Hero: progress through the tall section drives the shrink and the reveal.
    const hero = app.querySelector('.hero');
    if (hero) {
      const r = hero.getBoundingClientRect();
      const p = reducedMotion ? 1 : clamp(-r.top / Math.max(r.height - vh, 1), 0, 1);
      hero.style.setProperty('--p', p.toFixed(3));
    }

    // Story words light up as the reading line passes over them.
    const story = app.querySelector('.story');
    if (story) {
      const words = story.querySelectorAll('.sw');
      let count = words.length;
      if (!showInstantly) {
        const r = story.getBoundingClientRect();
        const progress = clamp((vh * 0.78 - r.top) / Math.max(r.height, 1), 0, 1);
        count = Math.round(progress * words.length * 1.08);
      }
      if (count !== litCount || !story.dataset.lit) {
        words.forEach((wd, i) => wd.classList.toggle('on', i < count));
        litCount = count;
        story.dataset.lit = '1';
      }
    }

    const probe = vh * 0.4;
    let current = null;
    for (const id of NAV_SECTIONS) {
      const section = document.getElementById(id);
      if (section && section.getBoundingClientRect().top <= probe) current = id;
    }
    nav.querySelectorAll('[data-section]').forEach((a) => {
      a.classList.toggle('active', a.dataset.section === current);
    });
  }

  window.addEventListener('scroll', () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      onScroll();
    });
  }, { passive: true });

  window.addEventListener('resize', () => {
    measureGradientName();
    measureTimeline();
    onScroll();
    fitSheetCover();
    updateSheetHint();
  }, { passive: true });

  /* ---------- interest sheet ---------- */

  let sheet = null;
  let sheetTrigger = null;
  let sheetTimer = 0;
  let sheetObserver = null;

  function buildSheet() {
    const root = document.createElement('div');
    root.className = 'sheet-root';
    root.hidden = true;
    root.innerHTML = `
      <div class="sheet-backdrop" data-sheet-close></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <button class="sheet-close" type="button" aria-label="${t().close}" data-sheet-close>${icon.close}</button>
        <div class="sheet-scroll" data-zoom-group></div>
        <button class="sheet-more" type="button" tabindex="-1" aria-hidden="true">${icon.chevronDown}</button>
      </div>`;
    const scroll = root.querySelector('.sheet-scroll');
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-sheet-close]')) closeSheet();
      else if (e.target.closest('.sheet-more')) scroll.scrollBy({ top: scroll.clientHeight * 0.7, behavior: reducedMotion ? 'auto' : 'smooth' });
    });
    scroll.addEventListener('scroll', () => updateSheetHint(root), { passive: true });
    document.body.append(root);
    return root;
  }

  // The fade stays while more is below; the pill only until the visitor starts scrolling.
  function updateSheetHint(root = sheet) {
    const scroll = root?.querySelector('.sheet-scroll');
    if (!scroll) return;
    const below = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
    const dialog = root.querySelector('.sheet');
    dialog.classList.toggle('has-more', below > 24);
    dialog.classList.toggle('hint', below > 24 && scroll.scrollTop < 24);
  }

  // The cover gets shorter when needed, so the next image already peeks in at the bottom:
  // a visible sign that the sheet goes on below.
  const PEEK = 140;
  function fitSheetCover(root = sheet) {
    const scroll = root?.querySelector('.sheet-scroll');
    const cover = scroll?.querySelector('.sheet-cover');
    const first = scroll?.querySelector('.zz-flow > *');
    if (!cover || !first || root.hidden) return;
    const dialog = root.querySelector('.sheet');
    const next = first.querySelector('.zz-media') || first;
    // offsetTop ignores the opening zoom and the slide-in transforms, unlike getBoundingClientRect.
    const top = (el) => {
      let y = 0;
      for (; el && el !== dialog; el = el.offsetParent) y += el.offsetTop;
      return y;
    };
    cover.style.height = '';
    const tooLow = top(next) - (scroll.clientHeight - PEEK);
    if (tooLow > 0) cover.style.height = `${Math.max(cover.offsetHeight - tooLow, 200)}px`;
  }

  const figure = (src, alt, className, sizes) => `
    <figure class="${className}">${img(src, alt, { sizes, zoom: true })}</figure>`;

  // The cover image leads; after it, each further image sits beside a paragraph, switching sides.
  function renderSheetBody(item) {
    const [cover, ...rest] = images(item);
    const paras = paragraphs(item.details);
    const rows = [];
    const rowCount = Math.min(paras.length, rest.length);

    for (let k = 0; k < rowCount; k++) {
      rows.push(`
        <div class="zz ${k % 2 ? 'flip' : ''} sheet-reveal">
          ${figure(rest[k], t().image(item.title, k + 2), 'zz-media', '(max-width: 640px) 90vw, 430px')}
          <p class="zz-text">${rich(paras[k])}</p>
        </div>`);
    }
    paras.slice(rowCount).forEach((p) => rows.push(`<p class="zz-solo sheet-reveal">${rich(p)}</p>`));

    const leftover = rest.slice(rowCount);
    if (leftover.length) {
      rows.push(`
        <div class="zz-grid ${leftover.length === 1 ? 'one' : ''}">
          ${leftover.map((src, i) => figure(src, t().image(item.title, rowCount + i + 2), 'zz-media sheet-reveal', '(max-width: 640px) 90vw, 430px')).join('')}
        </div>`);
    }

    return `
      ${cover ? figure(cover, item.title, 'sheet-cover', '(max-width: 640px) 100vw, 860px') : ''}
      ${rows.length ? `<div class="zz-flow">${rows.join('')}</div>` : ''}`;
  }

  function openSheet(index, trigger) {
    const item = list(view.hobbies?.items)[index];
    if (!item) return;
    sheet ||= buildSheet();
    clearTimeout(sheetTimer);

    const scroll = sheet.querySelector('.sheet-scroll');
    scroll.innerHTML = `
      <header class="sheet-head">
        <p class="sheet-index gradient-text">${pad(index + 1)}</p>
        <h3 class="sheet-title" id="sheet-title">${esc(item.title)}</h3>
        ${when(item.text, `<p class="sheet-lead">${rich(item.text)}</p>`)}
      </header>
      ${renderSheetBody(item)}`;
    // Visible first: a hidden element cannot be scrolled, so scrollTop = 0 would be ignored.
    sheet.hidden = false;
    fitSheetCover();
    scroll.scrollTop = 0;

    // Rows slide in from their side as you scroll through the sheet.
    sheetObserver?.disconnect();
    sheetObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        sheetObserver.unobserve(entry.target);
      }
    }, { root: scroll, rootMargin: '0px 0px -8% 0px' });
    scroll.querySelectorAll('.sheet-reveal').forEach((el) => sheetObserver.observe(el));

    const dialog = sheet.querySelector('.sheet');

    // Grow the sheet out of the card that was clicked.
    const tile = trigger?.closest('.tile');
    if (tile) {
      const t = tile.getBoundingClientRect();
      dialog.style.transformOrigin = `${t.left + t.width / 2 - dialog.offsetLeft}px ${t.top + t.height / 2 - dialog.offsetTop}px`;
    }

    void dialog.offsetWidth;
    updateSheetHint();
    sheet.classList.add('open');
    document.documentElement.classList.add('sheet-lock');
    sheetTrigger = trigger;
    dialog.querySelector('.sheet-close').focus({ preventScroll: true });
  }

  function closeSheet() {
    if (!sheet?.classList.contains('open')) return false;
    sheet.classList.remove('open');
    document.documentElement.classList.remove('sheet-lock');
    const root = sheet;
    sheetTimer = setTimeout(() => { root.hidden = true; }, 500);
    sheetTrigger?.focus({ preventScroll: true });
    return true;
  }

  // The whole card opens the sheet; the "+" button is there for keyboards and screen readers.
  app.addEventListener('click', (e) => {
    const button = e.target.closest('.tile')?.querySelector('[data-hobby]');
    if (button) openSheet(Number(button.dataset.hobby), button);
  });

  /* ---------- image viewer ---------- */

  let viewer = null;
  let viewerItems = [];
  let viewerIndex = 0;
  let viewerTrigger = null;
  let viewerTimer = 0;

  function buildViewer() {
    const root = document.createElement('div');
    root.className = 'viewer';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', t().viewer);
    root.innerHTML = `
      <div class="viewer-backdrop" data-viewer-close></div>
      <figure class="viewer-stage" data-viewer-close>
        <img class="viewer-img" alt="">
        <figcaption class="viewer-info">
          <p class="viewer-caption"></p>
          <p class="viewer-count" aria-live="polite"></p>
        </figcaption>
      </figure>
      <button class="viewer-btn viewer-close" type="button" aria-label="${t().close}" data-viewer-close>${icon.close}</button>
      <button class="viewer-btn viewer-prev" type="button" aria-label="${t().previous}" data-viewer-step="-1">${icon.chevronLeft}</button>
      <button class="viewer-btn viewer-next" type="button" aria-label="${t().next}" data-viewer-step="1">${icon.chevronRight}</button>`;

    // Swipe left or right on touch screens; a swipe must not also count as a click that closes.
    let startX = null;
    let swiped = false;
    root.addEventListener('pointerdown', (e) => { startX = e.clientX; swiped = false; });
    root.addEventListener('pointerup', (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 50 && viewerItems.length > 1) {
        swiped = true;
        showViewerImage(viewerIndex + (dx < 0 ? 1 : -1));
      }
    });

    root.addEventListener('click', (e) => {
      if (swiped) return;
      const step = e.target.closest('[data-viewer-step]');
      if (step) showViewerImage(viewerIndex + Number(step.dataset.viewerStep));
      else if (e.target.closest('[data-viewer-close]') && !e.target.closest('.viewer-img')) closeViewer();
    });

    document.body.append(root);
    return root;
  }

  function showViewerImage(index, from = null) {
    const count = viewerItems.length;
    viewerIndex = (index + count) % count;
    const { src, alt, caption } = viewerItems[viewerIndex];
    const image = viewer.querySelector('.viewer-img');
    image.src = src;
    image.alt = alt;
    viewer.querySelector('.viewer-caption').textContent = caption;
    viewer.classList.toggle('has-caption', Boolean(caption));
    viewer.querySelector('.viewer-count').textContent = count > 1 ? `${viewerIndex + 1} / ${count}` : '';

    if (reducedMotion) return;
    // Zoom out of the clicked photo the first time, fade between photos after that.
    const animate = () => {
      const b = image.getBoundingClientRect();
      if (from && b.width) {
        const a = from.getBoundingClientRect();
        const dx = a.left + a.width / 2 - (b.left + b.width / 2);
        const dy = a.top + a.height / 2 - (b.top + b.height / 2);
        const scale = Math.max(a.width / b.width, a.height / b.height);
        image.animate(
          [{ transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.6 }, { transform: 'none', opacity: 1 }],
          { duration: 550, easing: 'cubic-bezier(.16, 1, .3, 1)' },
        );
      } else {
        image.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'ease-out' });
      }
    };
    if (image.complete) animate();
    else image.addEventListener('load', animate, { once: true });
  }

  function openViewer(target) {
    const group = target.closest('[data-zoom-group]');
    const imgs = group ? [...group.querySelectorAll('img[data-zoom]')] : [target];
    // The caption is only shown here, in the enlarged view; it comes from content.media in the current language.
    viewerItems = imgs.map((i) => ({ src: i.dataset.zoom, alt: i.alt, caption: String(view.media?.[i.dataset.zoom]?.caption ?? '').trim() }));
    viewer ||= buildViewer();
    clearTimeout(viewerTimer);
    viewer.hidden = false;
    viewer.classList.toggle('single', viewerItems.length < 2);
    showViewerImage(imgs.indexOf(target), target);
    void viewer.offsetWidth;
    viewer.classList.add('open');
    document.documentElement.classList.add('viewer-lock');
    viewerTrigger = target;
    viewer.querySelector('.viewer-close').focus({ preventScroll: true });
  }

  function closeViewer() {
    if (!viewer?.classList.contains('open')) return false;
    viewer.classList.remove('open');
    document.documentElement.classList.remove('viewer-lock');
    const root = viewer;
    viewerTimer = setTimeout(() => { root.hidden = true; }, 400);
    viewerTrigger?.focus?.({ preventScroll: true });
    return true;
  }

  document.addEventListener('click', (e) => {
    const target = e.target.closest('img[data-zoom]');
    if (target && !target.closest('.viewer')) openViewer(target);
  });

  // In-page links scroll without putting "#section" in the address,
  // so a reload always starts at the top.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const id = link.getAttribute('href').slice(1);
    const target = id === 'top' ? document.documentElement : document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    if (id === 'top') window.scrollTo({ top: 0 });
    else target.scrollIntoView();
  });

  /* ---------- nav: menu + theme ---------- */

  function setMenu(open) {
    nav.classList.toggle('open', open);
    document.body.classList.toggle('menu-open', open);
    nav.querySelector('.nav-toggle')?.setAttribute('aria-expanded', String(open));
  }

  // The language menu: the button opens a small list with every language, the current one ticked.
  function setLangMenu(open) {
    const menu = nav.querySelector('.lang-menu');
    if (!menu) return false;
    const wasOpen = menu.classList.contains('open');
    menu.classList.toggle('open', open);
    menu.querySelector('.lang-toggle').setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('.lang-option[aria-current]')?.focus();
    return wasOpen && !open;
  }

  nav.addEventListener('click', (e) => {
    const theme = e.target.closest('.theme-toggle');
    const option = e.target.closest('.lang-option');
    if (theme) toggleTheme(theme);
    else if (e.target.closest('.lang-toggle')) setLangMenu(!nav.querySelector('.lang-menu').classList.contains('open'));
    else if (option) {
      setLangMenu(false);
      setLang(option.dataset.lang);
    }
    else if (e.target.closest('.nav-toggle')) setMenu(!nav.classList.contains('open'));
    else if (e.target.closest('a')) setMenu(false);
  });

  // A click anywhere outside the language menu closes it, as does moving focus out of it.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.lang-menu')) setLangMenu(false);
  });
  nav.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !e.relatedTarget.closest('.lang-menu')) setLangMenu(false);
  });

  document.addEventListener('keydown', (e) => {
    if (viewer?.classList.contains('open') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      showViewerImage(viewerIndex + (e.key === 'ArrowRight' ? 1 : -1));
      return;
    }
    if (e.key !== 'Escape') return;
    if (setLangMenu(false)) {
      nav.querySelector('.lang-toggle')?.focus();
      e.preventDefault();
    }
    else if (closeViewer() || closeSheet()) e.preventDefault();
    else if (nav.classList.contains('open')) {
      setMenu(false);
      e.preventDefault();
    }
  });

  /* ---------- boot ---------- */

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  async function load() {
    try {
      // The local server puts the content into the page; static hosting falls back to fetching it.
      const inline = document.getElementById('cv-data');
      if (inline) {
        content = JSON.parse(inline.textContent);
      } else {
        const res = await fetch('content.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        content = await res.json();
      }
      render();
      document.fonts?.ready.then(measureGradientName);

      // Always open at the top, even after a reload or with an old "#section" link.
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch (err) {
      app.innerHTML = `
        <section class="load-error">
          <h1>Content could not be loaded.</h1>
          <p>Please reload the page. · Bitte lade die Seite neu.</p>
        </section>`;
      throw err;
    }
  }

  load();
})();
