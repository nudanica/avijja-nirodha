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

  // ---------- backend (Google Apps Script) ----------
  // The address of the backend lives in config.json as "apiUrl".
  var API = '';
  var ADMIN_CODE = store('admin_code') || '';
  var ADMIN = !!ADMIN_CODE;
  var IS_MAIN = store('admin_main') === '1';
  var ADMIN_NAME = store('admin_name') || '';
  var DATA_PATH = 'data/site.json';

  function call(action, body) {
    body = body || {};
    body.action = action;
    if (!API) return Promise.reject(new Error('no_api'));
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.error === 'not_admin') { store('admin_code', null); store('admin_main', null); }
        if (!j.ok) throw new Error(j.error || 'failed');
        return j;
      });
  }
  function status(msg, kind) {
    var s = $('astatus');
    s.textContent = msg;
    s.className = 'astatus ' + (kind || '');
  }
  function saveData(message) {
    status('กำลังบันทึก…', 'busy');
    return call('saveData', { adminCode: ADMIN_CODE, data: DATA, message: message })
      .then(function () { status('บันทึกแล้ว เว็บจะอัปเดตภายใน ๑–๒ นาที', 'ok'); })
      .catch(function (e) {
        status(e.message === 'not_admin' ? 'รหัสแอดมินใช้ไม่ได้แล้ว กรุณาเข้าใหม่' : 'บันทึกไม่สำเร็จ ลองกดอีกครั้ง', 'err');
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
        var url = c.toDataURL('image/jpeg', 0.85);
        status('กำลังอัปโหลดรูป…', 'busy');
        call('uploadImage', { adminCode: ADMIN_CODE, b64: url.split(',')[1] }).then(function (j) {
          onDone(j.path, url);
        }).catch(function () { status('อัปโหลดรูปไม่สำเร็จ ลองอีกครั้ง', 'err'); });
      };
      img.src = URL.createObjectURL(f);
    };
    p.click();
  }

  // number boxes + big keypad, like a phone passcode screen
  function pinPad(inp, n) {
    var wrap = el('div', 'pinpad');
    var boxes = el('div', 'pinboxes');
    for (var i = 0; i < n; i++) boxes.appendChild(el('span', 'pinbox'));
    var keys = el('div', 'pinkeys');
    function draw() {
      var v = inp.value;
      [].forEach.call(boxes.children, function (b, i) { b.classList.toggle('filled', i < v.length); });
      if (v.length === n) setTimeout(function () { $('dlgForm').requestSubmit(); }, 120);
    }
    function press(k) {
      if (k === 'del') inp.value = inp.value.slice(0, -1);
      else if (inp.value.length < n) inp.value += k;
      draw();
    }
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].forEach(function (k) {
      if (!k) { keys.appendChild(el('span')); return; }
      var b = el('button', 'pinkey' + (k === 'del' ? ' del' : ''), k === 'del' ? '⌫' : k);
      if (k === 'del') b.setAttribute('aria-label', 'ลบ');
      b.type = 'button';
      b.onclick = function () { press(k); };
      keys.appendChild(b);
    });
    wrap.onkeydown = function (e) { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); };
    wrap.tabIndex = 0;
    wrap.appendChild(boxes);
    wrap.appendChild(keys);
    setTimeout(function () { wrap.focus(); draw(); }, 30);
    return wrap;
  }

  // simple form dialog. field kinds: text (default), multiline, select (options), pin (n digits)
  function ask(title, fields, onOk, okLabel) {
    $('dlgTitle').textContent = title;
    $('dlgOk').textContent = okLabel || 'บันทึก';
    var box = $('dlgFields');
    box.innerHTML = '';
    fields.forEach(function (f, i) {
      var lab = el('label', 'fld');
      if (f.label) lab.appendChild(el('span', null, f.label));
      var inp;
      if (f.options) {
        inp = el('select');
        f.options.forEach(function (o) { var op = el('option', null, o.label); op.value = o.value; inp.appendChild(op); });
      } else {
        inp = el(f.multiline ? 'textarea' : 'input');
        if (f.multiline) inp.rows = 12;
        if (f.pin) { inp.type = 'hidden'; }
      }
      inp.id = 'fld' + i;
      if (!f.options || f.value) inp.value = f.value || '';
      if (f.placeholder) inp.placeholder = f.placeholder;
      if (f.hint) lab.appendChild(el('small', 'hint', f.hint));
      lab.appendChild(inp);
      if (f.pin) lab.appendChild(pinPad(inp, f.pin));
      box.appendChild(lab);
    });
    var err = el('p', 'dlgerr'); err.id = 'dlgErr'; box.appendChild(err);
    var d = $('dlg');
    var pinMode = fields.some(function (f) { return f.pin; });
    d.classList.toggle('pinmode', pinMode);
    var ban = $('pinBanner');
    if (ban) ban.remove();
    if (pinMode && DATA && DATA.heroImage) {
      ban = el('div', 'pinbanner'); ban.id = 'pinBanner';
      ban.style.backgroundImage = 'url("' + DATA.heroImage + '")';
      $('dlgForm').insertBefore(ban, $('dlgForm').firstChild);
    }
    $('dlgForm').onsubmit = function (e) {
      e.preventDefault();
      var vals = fields.map(function (f, i) { return $('fld' + i).value; });
      var keep = onOk(vals, function (msg) { $('dlgErr').textContent = msg; });
      if (keep !== true) d.close();
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
      rt.appendChild(el('small', null, th(r.notes.length) + ' องค์ธรรม'));
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


  // first line shown larger as the heading; everything else exactly as posted, same colour
  function showText(box, t) {
    box.innerHTML = '';
    var k = t.indexOf('\n');
    var head = k < 0 ? t : t.slice(0, k);
    var rest = k < 0 ? '' : t.slice(k + 1);
    box.appendChild(el('div', 'ttl', head));
    if (rest) box.appendChild(el('div', 'body', rest));
  }

  // ---------- views ----------
  function show(v) {
    ['home', 'roomsv', 'roomv', 'readv', 'pendingv', 'settingsv'].forEach(function (x) { $(x).hidden = x !== v; });
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
    $('rc').textContent = 'องค์ธรรมในห้องนี้ (' + th(r.notes.length) + ')';
    var l = $('nlist');
    l.innerHTML = '';
    if (!r.notes.length) l.appendChild(el('div', 'empty', 'ยังไม่มีองค์ธรรมในห้องนี้'));
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
    showText($('text'), n.text);
    $('share').href = 'https://line.me/R/share?text=' + encodeURIComponent(n.text);
    $('toast').textContent = '';
    show('readv');
  }

  function route() {
    var h = location.hash.replace('#', '');
    if (h === 'rooms') return openRooms();
    if (h === 'admin') { if (ADMIN) { location.hash = 'pending'; return; } openHome(); setTimeout(adminLogin, 50); return; }
    if (h === 'pending' && ADMIN) return openPending();
    if (h === 'settings' && ADMIN) return openSettings();
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
    else if (h === '#settings') location.hash = 'pending';
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

  // ---------- team: propose (shared 4-digit team code) ----------
  function roomOptions() {
    return DATA.rooms.map(function (r, i) { return { value: String(i + 1), label: 'ห้องที่ ' + r.no + ' · ' + r.title }; });
  }
  function proposeForm(kind) {
    var f = [];
    if (kind === 'add') f.push({ label: 'ห้อง', options: roomOptions(), value: String((curRoom >= 0 ? curRoom : 0) + 1) });
    f.push({ label: kind === 'add' ? 'วางข้อความจากโน้ต LINE ทั้งหมด' : 'ข้อความที่เสนอแก้ (แก้ในช่องนี้ได้เลย)', multiline: true, value: kind === 'edit' ? current.text : '' });
    f.push({ label: 'ชื่อผู้เสนอ', value: store('team_name') || '', placeholder: 'ชื่อในกลุ่ม LINE' });
    ask(kind === 'add' ? 'เสนอเพิ่มองค์ธรรมใหม่' : 'เสนอแก้ไของค์ธรรมนี้', f, function (v, err) {
      var room = kind === 'add' ? +v[0] : curRoom + 1;
      var text = kind === 'add' ? v[1] : v[0];
      var name = (kind === 'add' ? v[2] : v[1]).trim();
      if (!text.trim()) { err('กรุณาวางข้อความ'); return true; }
      if (!name) { err('กรุณาใส่ชื่อผู้เสนอ'); return true; }
      store('team_name', name);
      err('กำลังส่ง…');
      call('propose', { teamCode: store('team_code'), type: kind, room: room, note: curNote + 1, text: text, name: name })
        .then(function () { $('dlg').close(); $('toast').textContent = 'ส่งข้อเสนอแล้ว รอแอดมินอนุมัติก่อนขึ้นเว็บ'; })
        .catch(function (e) {
          if (e.message === 'bad_team_code') { store('team_code', null); err('รหัสทีมงานเปลี่ยนแล้ว กรุณาขอรหัสใหม่'); }
          else err('ส่งไม่สำเร็จ ลองกดอีกครั้ง');
        });
      return true;
    }, 'ส่งข้อเสนอ');
  }
  function withTeamCode(next) {
    if (store('team_code')) return next();
    ask('ใส่รหัสทีมงาน', [{ label: '', pin: 4 }], function (v, err) {
      var c = v[0].trim();
      if (!/^\d{4}$/.test(c)) { err('รหัสมี ๔ หลัก'); return true; }
      err('กำลังตรวจรหัส…');
      call('checkTeam', { teamCode: c }).then(function () {
        store('team_code', c);
        $('dlg').close();
        next();
      }).catch(function () { err('รหัสไม่ถูกต้อง'); });
      return true;
    }, 'ตกลง');
  }
  $('propose').addEventListener('click', function () {
    withTeamCode(function () {
      ask('ต้องการเสนออะไร', [{ label: 'เลือก', options: [{ value: 'add', label: 'เพิ่มองค์ธรรมใหม่' }, { value: 'edit', label: 'แก้ไของค์ธรรมนี้' }] }], function (v) {
        setTimeout(function () { proposeForm(v[0]); }, 50);
      }, 'ถัดไป');
    });
  });

  // ---------- admin actions ----------
  function setupAdmin() {
    document.documentElement.classList.add('is-admin');
    $('adminbar').hidden = false;
    $('adminWho').textContent = 'แอดมิน: ' + ADMIN_NAME;
    $('pendingBtn').hidden = false;
    $('settingsBtn').hidden = !IS_MAIN;
    ['addRoom', 'addNote', 'editRoom', 'noteAdmin'].forEach(function (id) { $(id).hidden = false; });
    $('propose').hidden = true;
    $('logout').onclick = function () { ['admin_code', 'admin_main', 'admin_name'].forEach(function (k) { store(k, null); }); location.href = location.pathname; };
    $('pendingBtn').onclick = function () { location.hash = 'pending'; };
    $('settingsBtn').onclick = function () { location.hash = 'settings'; };
    refreshPendingCount();

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
      ask('เพิ่มองค์ธรรมในห้องนี้', [{ label: 'วางข้อความจากโน้ต LINE ทั้งหมด', multiline: true }], function (v) {
        var t = v[0];
        if (!t.trim()) return;
        DATA.rooms[curRoom].notes.push({ title: firstLine(t), text: t });
        openRoom(curRoom);
        saveData('เพิ่มองค์ธรรมในห้อง ' + DATA.rooms[curRoom].no);
      });
    };
    $('editNote').onclick = function () {
      var n = DATA.rooms[curRoom].notes[curNote];
      ask('แก้ไของค์ธรรม', [{ label: 'ข้อความ', value: n.text, multiline: true }], function (v) {
        n.text = v[0]; n.title = firstLine(v[0]);
        openNote(curRoom, curNote);
        saveData('แก้ไของค์ธรรม');
      });
    };
    $('delNote').onclick = function () {
      ask('ลบองค์ธรรมนี้ใช่ไหม', [], function () {
        DATA.rooms[curRoom].notes.splice(curNote, 1);
        location.hash = 'r' + (curRoom + 1);
        saveData('ลบองค์ธรรม');
      }, 'ลบ');
    };
  }

  function refreshPendingCount() {
    call('listPending', { adminCode: ADMIN_CODE }).then(function (j) {
      $('pendingBtn').textContent = 'รอตรวจ ' + th(j.items.length);
    }).catch(function () {});
  }

  function timeAgo(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return th(d.getDate()) + '/' + th(d.getMonth() + 1) + ' ' + th(String(d.getHours()).padStart(2, '0')) + ':' + th(String(d.getMinutes()).padStart(2, '0'));
  }

  function openPending() {
    $('brand').textContent = 'รอตรวจ';
    show('pendingv');
    var box = $('plist');
    box.innerHTML = '';
    box.appendChild(el('div', 'empty', 'กำลังโหลด…'));
    call('listPending', { adminCode: ADMIN_CODE }).then(function (j) {
      box.innerHTML = '';
      $('pendingBtn').textContent = 'รอตรวจ ' + th(j.items.length);
      if (!j.items.length) box.appendChild(el('div', 'empty', 'ไม่มีข้อเสนอที่รอตรวจ'));
      j.items.forEach(function (it) {
        var r = DATA.rooms[it.room - 1];
        var c = el('div', 'pend');
        var h = el('div', 'phd');
        h.appendChild(el('span', 'chip' + (it.type === 'edit' ? ' y' : ''), it.type === 'edit' ? 'แก้ไข' : 'เพิ่มใหม่'));
        h.appendChild(el('span', 'who', 'จาก ' + it.name + ' · ' + timeAgo(it.time)));
        c.appendChild(h);
        c.appendChild(el('b', null, (r ? 'ห้องที่ ' + r.no : 'ห้องที่ ' + th(it.room)) + (it.type === 'edit' ? ' · องค์ธรรม ' + th(it.note) : '')));
        var t = el('div', 'ptext', it.text);
        c.appendChild(t);
        var btns = el('div', 'pbtns');
        var no = el('button', 'pbtn no', 'ไม่อนุมัติ'); no.type = 'button';
        var yes = el('button', 'pbtn yes', 'อนุมัติ'); yes.type = 'button';
        function decide(ok) {
          yes.disabled = no.disabled = true;
          status(ok ? 'กำลังอนุมัติ…' : 'กำลังบันทึก…', 'busy');
          call('decide', { adminCode: ADMIN_CODE, id: it.id, approve: ok }).then(function () {
            status(ok ? 'อนุมัติแล้ว เว็บจะอัปเดตภายใน ๑–๒ นาที' : 'ไม่อนุมัติแล้ว', 'ok');
            if (ok) return call('getData', { adminCode: ADMIN_CODE }).then(function (g) { DATA = g.data; renderRatana(); renderRooms(); });
          }).then(openPending).catch(function () { status('ทำไม่สำเร็จ ลองอีกครั้ง', 'err'); yes.disabled = no.disabled = false; });
        }
        no.onclick = function () { decide(false); };
        yes.onclick = function () { decide(true); };
        btns.appendChild(no); btns.appendChild(yes);
        c.appendChild(btns);
        box.appendChild(c);
      });
    }).catch(function () { box.innerHTML = ''; box.appendChild(el('div', 'empty', 'โหลดไม่สำเร็จ ลองอีกครั้ง')); });
  }

  function openSettings() {
    if (!IS_MAIN) return openHome();
    $('brand').textContent = 'ตั้งค่ารหัส';
    show('settingsv');
    var box = $('slist');
    box.innerHTML = '';
    box.appendChild(el('div', 'empty', 'กำลังโหลด…'));
    call('getSettings', { adminCode: ADMIN_CODE }).then(function (j) { drawSettings(j); })
      .catch(function () { box.innerHTML = ''; box.appendChild(el('div', 'empty', 'โหลดไม่สำเร็จ ลองอีกครั้ง')); });
  }
  function drawSettings(j) {
    var box = $('slist');
    box.innerHTML = '';
    box.appendChild(el('h3', 'sh3', 'รหัสทีมงาน (ใช้ร่วมกันทั้งทีม)'));
    var row = el('div', 'arow');
    row.appendChild(el('span', 'acode big2', j.teamCode.split('').join(' ')));
    var ch = el('button', 'pbtn yes small', 'เปลี่ยนรหัส'); ch.type = 'button';
    ch.onclick = function () {
      ask('ตั้งรหัสทีมงานใหม่', [{ label: '', pin: 4 }], function (v, err) {
        if (!/^\d{4}$/.test(v[0].trim())) { err('รหัสมี ๔ หลัก'); return true; }
        call('setTeamCode', { adminCode: ADMIN_CODE, newCode: v[0].trim() }).then(function () { $('dlg').close(); openSettings(); })
          .catch(function () { err('เปลี่ยนไม่สำเร็จ'); });
        return true;
      });
    };
    row.appendChild(ch);
    box.appendChild(row);
    box.appendChild(el('p', 'note', 'ส่งรหัสนี้ให้ทีมงานทาง LINE ถ้ารหัสหลุดไปถึงคนนอก กดเปลี่ยนรหัสแล้วส่งรหัสใหม่'));
    box.appendChild(el('h3', 'sh3', 'แอดมิน (รหัสแยกของแต่ละท่าน)'));
    if (!j.admins.length) box.appendChild(el('div', 'empty', 'ยังไม่มีแอดมินเพิ่มเติม'));
    j.admins.forEach(function (a, i) {
      var r = el('div', 'arow');
      r.appendChild(el('span', 'an', th(i + 1)));
      r.appendChild(el('span', 'aname', a.name));
      r.appendChild(el('span', 'acode', a.code));
      var del = el('button', 'ax', 'ลบ'); del.type = 'button';
      del.onclick = function () {
        ask('ลบแอดมิน ' + a.name + ' ใช่ไหม', [], function () {
          call('removeAdmin', { adminCode: ADMIN_CODE, code: a.code }).then(openSettings);
        }, 'ลบ');
      };
      r.appendChild(del);
      box.appendChild(r);
    });
    var add = el('button', 'addbtn', '+ เพิ่มแอดมิน'); add.type = 'button';
    add.onclick = function () {
      ask('เพิ่มแอดมิน', [{ label: 'ชื่อแอดมิน', placeholder: 'ชื่อในกลุ่ม LINE' }], function (v, err) {
        if (!v[0].trim()) { err('กรุณาใส่ชื่อ'); return true; }
        call('addAdmin', { adminCode: ADMIN_CODE, name: v[0].trim() }).then(function () { $('dlg').close(); openSettings(); })
          .catch(function () { err('เพิ่มไม่สำเร็จ'); });
        return true;
      }, 'เพิ่ม');
    };
    box.appendChild(add);
    box.appendChild(el('p', 'note', 'ระบบสร้างรหัส ๖ หลักให้แต่ละท่าน คัดลอกรหัสแล้วส่งให้ท่านนั้นทาง LINE'));
  }

  function adminLogin() {
    ask('เข้าสู่ระบบแอดมิน', [{ label: '', pin: 6 }], function (v, err) {
      var c = v[0].trim();
      err('กำลังตรวจรหัส…');
      call('checkAdmin', { adminCode: c }).then(function (j) {
        store('admin_code', c); store('admin_main', j.isMain ? '1' : null); store('admin_name', j.name);
        location.reload();
      }).catch(function () { err('รหัสไม่ถูกต้อง'); });
      return true;
    }, 'เข้าสู่ระบบ');
  }
  $('adminLink').addEventListener('click', function () { if (ADMIN) location.hash = 'pending'; else adminLogin(); });

  // ---------- load ----------
  // config.json holds the backend address; it is kept apart from the content so saving content never touches it
  fetch('config.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (cfg) {
    API = cfg.apiUrl || '';
    return fetch(DATA_PATH, { cache: 'no-cache' }).then(function (r) { return r.json(); });
  }).then(function (d) {
    if (!API) { $('propose').hidden = true; $('adminLink').hidden = true; }
    // admins work on the newest copy straight from the backend
    if (ADMIN && API) return call('getData', { adminCode: ADMIN_CODE }).then(function (g) { return g.data; }, function () { return d; });
    return d;
  }).then(function (d) {
    DATA = d;
    if (!store('admin_code')) { ADMIN = false; }
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
  }).catch(function () {
    document.body.insertAdjacentHTML('beforeend', '<p style="padding:24px;text-align:center">โหลดข้อมูลไม่สำเร็จ กรุณาลองเปิดใหม่อีกครั้ง</p>');
  });
})();
