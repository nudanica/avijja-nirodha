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
  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; }
  }

  var DATA = null;
  var current = null;
  var curRoom = -1, curNote = -1;

  // ---------- GitHub (admin) ----------
  // owner/repo come from the address: <owner>.github.io/<repo>/
  var GH = (function () {
    var owner = location.hostname.split('.')[0];
    var repo = location.pathname.split('/').filter(Boolean)[0] || '';
    return { owner: owner, repo: repo, branch: 'main', token: store('gh_token') || '' };
  })();
  var ADMIN = !!GH.token;
  var DATA_PATH = 'data/site.json';

  function api(path, opts) {
    opts = opts || {};
    opts.headers = {
      'Authorization': 'Bearer ' + GH.token,
      'Accept': 'application/vnd.github+json'
    };
    return fetch('https://api.github.com/repos/' + GH.owner + '/' + GH.repo + path, opts).then(function (r) {
      if (r.status === 401) { throw new Error('auth'); }
      if (!r.ok && r.status !== 404) { return r.text().then(function (t) { throw new Error(r.status + ' ' + t); }); }
      return r.status === 404 ? null : r.json();
    });
  }
  function b64FromText(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function textFromB64(b64) {
    var bin = atob(b64.replace(/\n/g, '')), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function putFile(path, b64, message) {
    return api('/contents/' + path + '?ref=' + GH.branch).then(function (cur) {
      var body = { message: message, content: b64, branch: GH.branch };
      if (cur && cur.sha) body.sha = cur.sha;
      return api('/contents/' + path, { method: 'PUT', body: JSON.stringify(body) });
    });
  }
  function status(msg, kind) {
    var s = $('astatus');
    s.textContent = msg;
    s.className = 'astatus ' + (kind || '');
  }
  function saveData(message) {
    status('กำลังบันทึก…', 'busy');
    return putFile(DATA_PATH, b64FromText(JSON.stringify(DATA, null, 1)), message)
      .then(function () { status('บันทึกแล้ว เว็บจะอัปเดตภายใน ๑–๒ นาที', 'ok'); })
      .catch(function (e) {
        status(e.message === 'auth' ? 'รหัสผู้ดูแลหมดอายุ กรุณาเข้าสู่ระบบใหม่' : 'บันทึกไม่สำเร็จ ลองกดอีกครั้ง', 'err');
        throw e;
      });
  }

  // photo: resize on the phone, upload, then point the record at it
  function pickPhoto(onDone) {
    var p = $('picker');
    p.value = '';
    p.onchange = function () {
      var f = p.files[0];
      if (!f) return;
      var img = new Image();
      img.onload = function () {
        var max = 600, w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var b64 = c.toDataURL('image/jpeg', 0.85).split(',')[1];
        var path = 'images/people/' + Date.now() + '.jpg';
        status('กำลังอัปโหลดรูป…', 'busy');
        putFile(path, b64, 'เพิ่มรูป').then(function () {
          onDone(path, c.toDataURL('image/jpeg', 0.85));
        }).catch(function () { status('อัปโหลดรูปไม่สำเร็จ ลองอีกครั้ง', 'err'); });
      };
      img.src = URL.createObjectURL(f);
    };
    p.click();
  }

  // simple form dialog
  function ask(title, fields, onOk) {
    $('dlgTitle').textContent = title;
    var box = $('dlgFields');
    box.innerHTML = '';
    fields.forEach(function (f, i) {
      var lab = el('label', 'fld');
      lab.appendChild(el('span', null, f.label));
      var inp = el(f.multiline ? 'textarea' : 'input');
      inp.id = 'fld' + i;
      inp.value = f.value || '';
      if (f.multiline) inp.rows = 12;
      if (f.placeholder) inp.placeholder = f.placeholder;
      lab.appendChild(inp);
      box.appendChild(lab);
    });
    var d = $('dlg');
    $('dlgForm').onsubmit = function (e) {
      e.preventDefault();
      var vals = fields.map(function (f, i) { return $('fld' + i).value; });
      d.close();
      onOk(vals);
    };
    $('dlgCancel').onclick = function () { d.close(); };
    d.showModal();
  }

  // ---------- photos ----------
  function photo(src, alt, onChange) {
    var ph = el('div', 'ph');
    if (src) {
      ph.classList.add('has');
      ph.style.backgroundImage = 'url("' + src + '")';
      ph.setAttribute('role', 'img');
      if (alt) ph.setAttribute('aria-label', alt);
    }
    if (ADMIN && onChange) {
      var b = el('button', 'addimg', '+');
      b.type = 'button';
      b.setAttribute('aria-label', src ? 'เปลี่ยนรูป' : 'เพิ่มรูป');
      b.onclick = function () {
        pickPhoto(function (path, preview) {
          ph.classList.add('has');
          ph.style.backgroundImage = 'url("' + preview + '")';
          onChange(path);
          saveData('ใส่รูป ' + (alt || ''));
        });
      };
      ph.appendChild(b);
    }
    return ph;
  }
  function nameEdit(p, label) {
    if (!ADMIN) return null;
    var b = el('button', 'editlink small', 'แก้ไข');
    b.type = 'button';
    b.onclick = function () {
      var f = [{ label: 'ชื่อ', value: p.name }];
      if (label === 'list') f.push({ label: 'ฐานะ', value: p.status }, { label: 'ลำดับ', value: p.order }, { label: 'เป็นลูกศิษย์ของ (ชื่อครูบาอาจารย์)', value: p.teacher || '' });
      else f.push({ label: 'องค์ / ตำแหน่ง', value: p.role || '' });
      ask('แก้ไขรายชื่อ', f, function (v) {
        p.name = v[0];
        if (label === 'list') { p.status = v[1]; p.order = v[2]; p.teacher = v[3].trim(); } else { p.role = v[1]; }
        renderRatana();
        saveData('แก้รายชื่อ');
      });
    };
    return b;
  }
  function addPersonBtn(r) {
    var b = el('button', 'addbtn small', '+ เพิ่มท่าน');
    b.type = 'button';
    b.onclick = function () {
      r.people = r.people || [];
      r.people.push(r.style === 'list' ? { order: '', name: '', status: '', teacher: '', photo: '' } : { name: '', photo: '' });
      renderRatana();
      saveData('เพิ่มช่องรายชื่อ');
    };
    return b;
  }

  // keep each space-separated word on one line (display only; characters unchanged)
  function words(cls, text) {
    var d = el('div', cls);
    text.split(/( )/).forEach(function (part) {
      if (part === ' ') d.appendChild(document.createTextNode(' '));
      else if (part) d.appendChild(el('span', 'w', part));
    });
    return d;
  }


  // ---------- lineage tree: who is whose disciple ----------
  function acNode(p, num) {
    var row = el('div', 'ac');
    row.appendChild(photo(p.photo, p.name, function (path) { p.photo = path; }));
    var x = el('div', 'acx');
    x.appendChild(words('b', p.name));
    if (p.status) x.appendChild(el('span', null, p.status));
    if (p.order) x.appendChild(el('span', 'ordnote', p.order));
    var ed = nameEdit(p, 'list'); if (ed) x.appendChild(ed);
    row.appendChild(x);
    return row;
  }
  function findPerson(name) {
    var hit = null;
    DATA.ratana.forEach(function (r) { (r.people || []).forEach(function (p) { if (!hit && p.name && p.name === name) hit = { p: p, r: r }; }); });
    return hit;
  }
  function lineageTree(r) {
    var people = r.people || [];
    var rno = th(DATA.ratana.indexOf(r) + 1), count = 0;
    var names = {};
    people.forEach(function (p) { if (p.name) names[p.name] = 1; });
    var kids = {};
    var tops = [];
    people.forEach(function (p) {
      if (p.teacher && names[p.teacher]) (kids[p.teacher] = kids[p.teacher] || []).push(p);
      else tops.push(p);
    });
    function branch(list) {
      var ul = el('ul', 'tree');
      list.forEach(function (p) {
        var li = el('li');
        count++;
        li.appendChild(el('span', 'tnum', th(count) + '.'));
        li.appendChild(acNode(p));
        if (kids[p.name]) {
          var sub = branch(kids[p.name]);
          sub.classList.add('sub');
          li.appendChild(sub);
        }
        ul.appendChild(li);
      });
      return ul;
    }
    var wrap = el('div', 'lineage');
    // group top-level people by their teacher from another ratana (e.g. รัตนะที่ ๒)
    var groups = [], seen = {};
    tops.forEach(function (p) {
      var key = p.teacher || '';
      if (!seen[key]) { seen[key] = { teacher: key, list: [] }; groups.push(seen[key]); }
      seen[key].list.push(p);
    });
    groups.forEach(function (g) {
      if (g.teacher) {
        var t = findPerson(g.teacher);
        var root = el('div', 'troot');
        root.appendChild(photo(t && t.p.photo, g.teacher, null));
        var tx = el('div', 'acx');
        if (t) tx.appendChild(el('span', 'ord', (t.p.role ? t.p.role + ' · ' : '') + (t.r.label || '')));
        tx.appendChild(words('b', g.teacher));
        root.appendChild(tx);
        wrap.appendChild(root);
      }
      wrap.appendChild(branch(g.list));
    });
    return wrap;
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
        lvl.appendChild(lineageTree(r));
        if (ADMIN) lvl.appendChild(addPersonBtn(r));
      } else {
        lvl.appendChild(el('h3', null, r.title));
        var tier = el('div', 'tier');
        (r.people || []).forEach(function (p) {
          var per = el('div', 'person');
          per.appendChild(photo(p.photo, p.name || p.role, function (path) { p.photo = path; }));
          if (p.role) per.appendChild(el('div', 'role', p.role));
          if (p.name) per.appendChild(words('nm', p.name));
          var ed = nameEdit(p); if (ed) per.appendChild(ed);
          tier.appendChild(per);
        });
        lvl.appendChild(tier);
        if (ADMIN) lvl.appendChild(addPersonBtn(r));
      }
      box.appendChild(lvl);
    });
  }

  // rooms as a staircase: first room at the bottom, each higher level one step up and in
  function renderRooms() {
    var box = $('rooms');
    box.innerHTML = '';
    if (!DATA.rooms.length) box.appendChild(el('div', 'empty', 'ยังไม่มีห้องเรียน'));
    DATA.rooms.forEach(function (r, i) {
      var a = el('a', 'step');
      a.href = '#r' + (i + 1);
      a.style.setProperty('--i', Math.min(i, 4));
      var n = el('span', 'sno');
      n.appendChild(el('span', null, r.no));
      a.appendChild(n);
      var rt = el('span', 'st');
      rt.appendChild(el('b', null, r.title));
      rt.appendChild(el('small', null, th(r.notes.length) + ' เรื่อง'));
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

  // first non-empty line becomes the title shown in lists; the text itself is kept exactly as pasted
  function firstLine(t) {
    var lines = t.split('\n');
    for (var i = 0; i < lines.length; i++) if (lines[i].trim()) return lines[i].trim();
    return '';
  }


  // Display-only styling. Every line is shown exactly as written; copy/share use the original text.
  function renderText(box, t) {
    box.innerHTML = '';
    var lines = t.split('\n');
    var firstIdx = -1, secondIdx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      if (firstIdx < 0) firstIdx = i; else { secondIdx = i; break; }
    }
    var refRe = /^\s*(พระไตรปิฎก|ที่มา|อ้างอิง)/;
    var numRe = /^(\s*\[[๐-๙0-9]+\])(.*)$/;
    var gap = false;
    lines.forEach(function (line, i) {
      if (!line.trim()) { gap = true; return; }
      var cls = 'ln', node;
      if (i === firstIdx) cls = 'ln title';
      else if (i === secondIdx && line.trim().length <= 60 && !numRe.test(line)) cls = 'ln subtitle';
      else if (refRe.test(line)) cls = 'ln ref';
      node = el('div', cls + (gap ? ' gap' : ''));
      var m = numRe.exec(line);
      if (m) {
        node.appendChild(el('span', 'pno', m[1]));
        node.appendChild(document.createTextNode(m[2]));
      } else {
        node.textContent = line;
      }
      box.appendChild(node);
      gap = false;
    });
  }

  // ---------- views ----------
  function show(v) {
    ['home', 'roomsv', 'roomv', 'readv'].forEach(function (x) { $(x).hidden = x !== v; });
    $('back').hidden = v === 'home';
    window.scrollTo(0, 0);
  }

  function openHome() {
    $('brand').textContent = DATA.siteTitle;
    show('home');
  }

  function openRooms() {
    $('brand').textContent = DATA.siteTitle;
    renderRooms();
    show('roomsv');
  }

  function openRoom(ri) {
    var r = DATA.rooms[ri];
    if (!r) return openRooms();
    curRoom = ri;
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
    current = n; curRoom = ri; curNote = ni;
    $('brand').textContent = 'ห้องที่ ' + r.no;
    $('crumb').textContent = 'ห้องที่ ' + r.no + ' · ' + r.title;
    renderText($('text'), n.text);
    $('share').href = 'https://line.me/R/share?text=' + encodeURIComponent(n.text);
    $('toast').textContent = '';
    show('readv');
  }

  function route() {
    var h = location.hash.replace('#', '');
    if (h === 'rooms') return openRooms();
    var m = /^r(\d+)(?:n(\d+))?$/.exec(h);
    if (!m) return openHome();
    var ri = +m[1] - 1;
    if (m[2]) openNote(ri, +m[2] - 1); else openRoom(ri);
  }

  // ---------- reader actions ----------
  $('back').addEventListener('click', function () {
    var h = location.hash;
    var m = /^#r(\d+)n\d+$/.exec(h);
    if (m) location.hash = 'r' + m[1];
    else if (/^#r\d+$/.test(h)) location.hash = 'rooms';
    else { history.replaceState(null, '', location.pathname); route(); }
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

  function countOf(hay, q) { var c = 0, i = 0; while ((i = hay.indexOf(q, i)) > -1) { c++; i += q.length; } return c; }
  function snippet(text, q) {
    var flat = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).join(' ');
    var i = flat.indexOf(q), box = el('div', 'sn');
    if (i < 0) return box;
    var a = Math.max(0, i - 40), b = Math.min(flat.length, i + q.length + 40);
    box.appendChild(document.createTextNode((a > 0 ? '…' : '') + flat.slice(a, i)));
    box.appendChild(el('mark', null, q));
    box.appendChild(document.createTextNode(flat.slice(i + q.length, b) + (b < flat.length ? '…' : '')));
    return box;
  }
  $('sform').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('q').value.trim();
    var box = $('rlist');
    box.innerHTML = '';
    $('results').hidden = !q;
    if (!q) return;
    var hits = 0, rooms = {};
    DATA.rooms.forEach(function (r, ri) {
      r.notes.forEach(function (n, ni) {
        var c = countOf(n.text, q);
        if (!c && n.title.indexOf(q) < 0) return;
        hits++; rooms[ri] = 1;
        var a = el('a', 'res');
        a.href = '#r' + (ri + 1) + 'n' + (ni + 1);
        var head = el('div', 'rhead');
        head.appendChild(el('span', 'rb', 'ห้องที่ ' + r.no));
        head.appendChild(el('span', 'cnt', 'พบ ' + th(c || 1) + ' ครั้ง'));
        a.appendChild(head);
        a.appendChild(el('div', 'rt', n.title));
        a.appendChild(el('div', 'rroom', '[' + r.no + '.] ' + r.title + ' · เรื่องที่ ' + th(ni + 1)));
        a.appendChild(snippet(n.text, q));
        box.appendChild(a);
      });
    });
    $('rsum').textContent = hits ? 'พบคำว่า "' + q + '" ใน ' + th(hits) + ' เรื่อง จาก ' + th(Object.keys(rooms).length) + ' ห้อง' : '';
    if (!hits) box.appendChild(el('div', 'empty', 'ไม่พบคำว่า "' + q + '"'));
    $('results').scrollIntoView({ behavior: 'smooth' });
  });

  var fs = +store('fs') || 19;
  function applySize() {
    document.documentElement.style.setProperty('--fs', fs + 'px');
    store('fs', String(fs));
  }
  applySize();
  $('bigger').addEventListener('click', function () { fs = Math.min(30, fs + 2); applySize(); });
  $('smaller').addEventListener('click', function () { fs = Math.max(15, fs - 2); applySize(); });

  // ---------- admin actions ----------
  function setupAdmin() {
    document.documentElement.classList.add('is-admin');
    $('adminbar').hidden = false;
    ['addRoom', 'addNote', 'editRoom', 'noteAdmin'].forEach(function (id) { $(id).hidden = false; });
    $('logout').onclick = function () { store('gh_token', null); location.href = location.pathname; };

    $('addRoom').onclick = function () {
      ask('เพิ่มห้องใหม่', [
        { label: 'เลขห้อง', value: th(String(DATA.rooms.length + 1).padStart(2, '0')) },
        { label: 'ชื่อห้อง', placeholder: 'เช่น ผู้ใหม่ในระดับ วิชชาพระโสดาบันบุคคล' }
      ], function (v) {
        if (!v[1].trim()) return;
        DATA.rooms.push({ no: v[0].trim(), title: v[1].trim(), notes: [] });
        renderRooms();
        saveData('เพิ่มห้อง ' + v[0]);
      });
    };
    $('editRoom').onclick = function () {
      var r = DATA.rooms[curRoom];
      ask('แก้ชื่อห้อง', [{ label: 'เลขห้อง', value: r.no }, { label: 'ชื่อห้อง', value: r.title }], function (v) {
        r.no = v[0].trim(); r.title = v[1].trim();
        openRoom(curRoom);
        saveData('แก้ชื่อห้อง ' + r.no);
      });
    };
    $('addNote').onclick = function () {
      ask('เพิ่มเรื่องใหม่', [{ label: 'วางข้อความจากโน้ต LINE ทั้งหมด', multiline: true }], function (v) {
        var t = v[0];
        if (!t.trim()) return;
        DATA.rooms[curRoom].notes.push({ title: firstLine(t), text: t });
        openRoom(curRoom);
        saveData('เพิ่มเรื่องในห้อง ' + DATA.rooms[curRoom].no);
      });
    };
    $('editNote').onclick = function () {
      var n = DATA.rooms[curRoom].notes[curNote];
      ask('แก้ไขเรื่อง', [{ label: 'ข้อความ', value: n.text, multiline: true }], function (v) {
        n.text = v[0]; n.title = firstLine(v[0]);
        openNote(curRoom, curNote);
        saveData('แก้ไขเรื่อง');
      });
    };
    $('delNote').onclick = function () {
      ask('ลบเรื่องนี้ใช่ไหม', [], function () {
        DATA.rooms[curRoom].notes.splice(curNote, 1);
        location.hash = 'r' + (curRoom + 1);
        saveData('ลบเรื่อง');
      });
      $('dlgOk').textContent = 'ลบ';
      $('dlg').addEventListener('close', function () { $('dlgOk').textContent = 'บันทึก'; }, { once: true });
    };
  }

  // ---------- load ----------
  // admins read straight from GitHub so they always edit the newest copy
  var load = ADMIN
    ? api('/contents/' + DATA_PATH + '?ref=' + GH.branch).then(function (f) { return JSON.parse(textFromB64(f.content)); })
    : fetch(DATA_PATH, { cache: 'no-cache' }).then(function (r) { return r.json(); });

  load.then(function (d) {
    DATA = d;
    $('heroImg').src = d.heroImage;
    $('heroImg').alt = d.heroAlt || '';
    if (d.heroLink) { $('heroLink').href = d.heroLink; $('heroLink').setAttribute('aria-label', 'ช่อง YouTube เพราะอวิชชาดับ'); } else { $('heroLink').removeAttribute('href'); }
    $('h1').textContent = d.siteTitle;
    $('ratanaHeading').textContent = d.ratanaHeading;
    $('roomsHeading').textContent = d.roomsHeading;
    $('roomsBtnLabel').textContent = d.roomsHeading;
    if (ADMIN) setupAdmin();
    renderRatana();
    renderRooms();
    window.addEventListener('hashchange', route);
    route();
  }).catch(function (e) {
    if (ADMIN && e.message === 'auth') { store('gh_token', null); location.reload(); return; }
    document.body.insertAdjacentHTML('beforeend', '<p style="padding:24px;text-align:center">โหลดข้อมูลไม่สำเร็จ กรุณาลองเปิดใหม่อีกครั้ง</p>');
  });
})();
