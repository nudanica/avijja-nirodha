(function () {
  'use strict';
  var TH = '๐๑๒๓๔๕๖๗๘๙';
  function th(n) { return String(n).replace(/\d/g, function (d) { return TH[d]; }); }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var DATA = null;
  var current = null;

  // ---------- photos ----------
  function photo(src, alt) {
    var ph = el('div', 'ph');
    if (src) {
      ph.classList.add('has');
      ph.style.backgroundImage = 'url("' + src + '")';
      ph.setAttribute('role', 'img');
      if (alt) ph.setAttribute('aria-label', alt);
    }
    return ph;
  }

  // ---------- home ----------
  function renderRatana() {
    var box = $('ratana');
    box.innerHTML = '';
    DATA.ratana.forEach(function (r, i) {
      if (i > 0) box.appendChild(el('div', 'link'));
      var lvl = el('div', 'lvl' + (r.style === 'feature' ? ' top' : ''));
      lvl.appendChild(el('span', 'rn', r.label));
      if (r.style === 'feature') {
        var wrap = el('div', 'person big');
        var img = el('img', 'buddha');
        img.src = r.image; img.alt = r.imageAlt || r.title;
        wrap.appendChild(img);
        lvl.appendChild(wrap);
        lvl.appendChild(el('h3', null, r.title));
      } else if (r.style === 'list') {
        lvl.appendChild(el('h3', null, r.title));
        var ol = el('ol', 'aclist');
        (r.people || []).forEach(function (p) {
          var li = el('li', 'ac');
          li.appendChild(photo(p.photo, p.name));
          var x = el('div', 'acx');
          if (p.order) x.appendChild(el('span', 'ord', p.order));
          x.appendChild(el('b', null, p.name));
          if (p.status) x.appendChild(el('span', null, p.status));
          li.appendChild(x);
          ol.appendChild(li);
        });
        lvl.appendChild(ol);
      } else {
        lvl.appendChild(el('h3', null, r.title));
        var tier = el('div', 'tier');
        (r.people || []).forEach(function (p) {
          var per = el('div', 'person');
          per.appendChild(photo(p.photo, p.name));
          if (p.name) per.appendChild(el('div', 'nm', p.name));
          tier.appendChild(per);
        });
        lvl.appendChild(tier);
      }
      box.appendChild(lvl);
    });
  }

  function renderRooms() {
    var box = $('rooms');
    box.innerHTML = '';
    DATA.rooms.forEach(function (r, i) {
      var a = el('a', 'room');
      a.href = '#r' + (i + 1);
      a.appendChild(el('span', 'badge', r.no));
      var rt = el('span', 'rt');
      rt.appendChild(el('b', null, r.title));
      rt.appendChild(el('span', null, th(r.notes.length) + ' เรื่อง'));
      a.appendChild(rt);
      a.appendChild(el('span', 'arrow', '›'));
      box.appendChild(a);
    });
  }

  function noteLink(ri, ni, label) {
    var a = el('a', 'note');
    a.href = '#r' + (ri + 1) + 'n' + (ni + 1);
    a.appendChild(el('span', 'nn', th(ni + 1)));
    a.appendChild(el('b', null, label));
    return a;
  }

  // ---------- views ----------
  function show(v) {
    ['home', 'roomv', 'readv'].forEach(function (x) { $(x).hidden = x !== v; });
    $('back').hidden = v === 'home';
    window.scrollTo(0, 0);
  }

  function openHome() {
    $('brand').textContent = DATA.siteTitle;
    show('home');
  }

  function openRoom(ri) {
    var r = DATA.rooms[ri];
    if (!r) return openHome();
    $('brand').textContent = 'ห้องที่ ' + r.no;
    $('rk').textContent = 'ห้องที่ ' + r.no;
    $('rh').textContent = '[' + r.no + '.] ' + r.title;
    $('rc').textContent = 'เรื่องในห้องนี้ (' + th(r.notes.length) + ')';
    var l = $('nlist');
    l.innerHTML = '';
    if (!r.notes.length) l.appendChild(el('div', 'empty', 'ยังไม่มีเรื่องในห้องนี้'));
    r.notes.forEach(function (n, ni) { l.appendChild(noteLink(ri, ni, n.title)); });
    show('roomv');
  }

  function openNote(ri, ni) {
    var r = DATA.rooms[ri];
    var n = r && r.notes[ni];
    if (!n) return openRoom(ri);
    current = n;
    $('brand').textContent = 'ห้องที่ ' + r.no;
    $('crumb').textContent = 'ห้องที่ ' + r.no + ' · ' + r.title;
    $('text').textContent = n.text;
    $('share').href = 'https://line.me/R/share?text=' + encodeURIComponent(n.text);
    $('toast').textContent = '';
    show('readv');
  }

  function route() {
    var h = location.hash.replace('#', '');
    var m = /^r(\d+)(?:n(\d+))?$/.exec(h);
    if (!m) return openHome();
    var ri = +m[1] - 1;
    if (m[2]) openNote(ri, +m[2] - 1); else openRoom(ri);
  }

  // ---------- actions ----------
  $('back').addEventListener('click', function () {
    var m = /^#r(\d+)n\d+$/.exec(location.hash);
    location.hash = m ? 'r' + m[1] : '';
    if (!m) { history.replaceState(null, '', location.pathname); route(); }
  });

  $('copy').addEventListener('click', function () {
    if (!current) return;
    var done = function () { $('toast').textContent = 'คัดลอกแล้ว นำไปวางใน LINE ได้เลย'; };
    var fallback = function () {
      var r = document.createRange();
      r.selectNodeContents($('text'));
      var s = window.getSelection();
      s.removeAllRanges(); s.addRange(r);
      $('toast').textContent = 'เลือกข้อความแล้ว กดค้างเพื่อคัดลอก';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(current.text).then(done, fallback);
    else fallback();
  });

  $('sform').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('q').value.trim();
    var box = $('rlist');
    box.innerHTML = '';
    $('results').hidden = !q;
    if (!q) return;
    var c = 0;
    DATA.rooms.forEach(function (r, ri) {
      r.notes.forEach(function (n, ni) {
        if (n.text.indexOf(q) > -1 || n.title.indexOf(q) > -1) { c++; box.appendChild(noteLink(ri, ni, '[' + r.no + '.] ' + n.title)); }
      });
    });
    if (!c) box.appendChild(el('div', 'empty', 'ไม่พบคำว่า "' + q + '"'));
    $('results').scrollIntoView({ behavior: 'smooth' });
  });

  var fs = 19;
  try { fs = +localStorage.getItem('fs') || 19; } catch (e) {}
  function applySize() {
    document.documentElement.style.setProperty('--fs', fs + 'px');
    try { localStorage.setItem('fs', fs); } catch (e) {}
  }
  applySize();
  $('bigger').addEventListener('click', function () { fs = Math.min(30, fs + 2); applySize(); });
  $('smaller').addEventListener('click', function () { fs = Math.max(15, fs - 2); applySize(); });

  // ---------- load ----------
  fetch('data/site.json', { cache: 'no-cache' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      DATA = d;
      $('heroImg').src = d.heroImage;
      $('heroImg').alt = d.heroAlt || '';
      $('h1').textContent = d.siteTitle;
      $('ratanaHeading').textContent = d.ratanaHeading;
      $('roomsHeading').textContent = d.roomsHeading;
      renderRatana();
      renderRooms();
      window.addEventListener('hashchange', route);
      route();
    })
    .catch(function () {
      document.body.insertAdjacentHTML('beforeend', '<p style="padding:24px;text-align:center">โหลดข้อมูลไม่สำเร็จ กรุณาลองเปิดใหม่อีกครั้ง</p>');
    });
})();
