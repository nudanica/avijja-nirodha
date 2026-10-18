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
  var curRoom = -1, curNote = -1, curSec = -1, curPerson = null, CTX = { kind: 'room' };

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
  var SAVING = 0, LAST_SAVE = 0;
  function saveData(message) {
    status('กำลังบันทึก…', 'busy');
    SAVING++;
    var done = function () { SAVING--; LAST_SAVE = Date.now(); };
    return call('saveData', { adminCode: ADMIN_CODE, data: DATA, message: message })
      .then(function () { done(); status('บันทึกแล้ว เว็บจะอัปเดตภายใน ๑–๒ นาที', 'ok'); })
      .catch(function (e) {
        done();
        status(e.message === 'not_admin' ? 'รหัสแอดมินใช้ไม่ได้แล้ว กรุณาเข้าใหม่' : 'บันทึกไม่สำเร็จ ลองกดอีกครั้ง', 'err');
        throw e;
      });
  }

  // photo: resize on the phone, upload, then point the record at it
  // a just-uploaded photo takes a minute or two to appear on the site; show the local copy everywhere meanwhile
  var PREVIEW = {};
  function pickPhoto(onDone, maxSize) {
    var p = $('picker');
    p.value = '';
    p.onchange = function () {
      var f = p.files[0];
      if (!f) return;
      var img = new Image();
      img.onload = function () {
        var max = maxSize || 600, w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var url = c.toDataURL('image/jpeg', 0.85);
        status('กำลังอัปโหลดรูป…', 'busy');
        call('uploadImage', { adminCode: ADMIN_CODE, b64: url.split(',')[1] }).then(function (j) {
          PREVIEW[j.path] = url;
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
  function ask(title, fields, onOk, okLabel, delLabel) {
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
        if (f.multiline) inp.rows = f.rows || 12;
        if (f.pin) { inp.type = 'hidden'; }
        if (f.type) inp.type = f.type;
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
    if (pinMode && DATA && DATA.placeholderPhoto) {
      ban = el('div', 'pinbanner'); ban.id = 'pinBanner';
      ban.style.backgroundImage = 'url("' + DATA.placeholderPhoto + '")';
      $('dlgForm').insertBefore(ban, $('dlgForm').firstChild);
    }
    $('dlgForm').onsubmit = function (e) {
      e.preventDefault();
      var vals = fields.map(function (f, i) { return $('fld' + i).value; });
      var keep = onOk(vals, function (msg) { $('dlgErr').textContent = msg; });
      if (keep !== true) d.close();
    };
    $('dlgCancel').onclick = function () { d.close(); };
    var del = $('dlgDel');
    del.hidden = !delLabel;
    del.textContent = delLabel || '';
    del.onclick = function () {
      if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'แตะอีกครั้งเพื่อยืนยันการลบ'; return; }
      del.dataset.sure = ''; d.close();
      var v = fields.map(function () { return ''; }); v.del = true; onOk(v, function () {});
    };
    del.dataset.sure = '';
    d.showModal();
  }

  // ---------- photos ----------
  function photo(src, alt, onChange) {
    var ph = el('div', 'ph');
    if (src) {
      ph.classList.add('has');
      ph.style.backgroundImage = 'url("' + (PREVIEW[src] || src) + '")';
      ph.setAttribute('role', 'img');
      if (alt) ph.setAttribute('aria-label', alt);
    }
    if (ADMIN && onChange) {
      ph.classList.add('editable');
      ph.tabIndex = 0;
      ph.setAttribute('role', 'button');
      ph.setAttribute('aria-label', (src ? 'เปลี่ยนรูป ' : 'ใส่รูป ') + (alt || ''));
      ph.appendChild(camBadge());
      ph.onclick = function () {
        pickPhoto(function (path, preview) {
          ph.classList.add('has');
          ph.style.backgroundImage = 'url("' + preview + '")';
          onChange(path);
          saveData('ใส่รูป ' + (alt || ''));
        });
      };
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
        if (v.del) {
          DATA.ratana.forEach(function (r) { if (r.people) { var i = r.people.indexOf(p); if (i > -1) r.people.splice(i, 1); } });
          renderRatana();
          saveData('ลบรายชื่อ ' + (p.name || ''));
          return;
        }
        p.name = v[0];
        if (label === 'list') { p.status = v[1]; p.order = v[2]; p.teacher = v[3].trim(); } else { p.role = v[1]; }
        renderRatana();
        saveData('แก้รายชื่อ');
      }, 'บันทึก', 'ลบรายชื่อนี้');
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
  // tap a teacher (name area, or the whole row for readers) to open their attainment records
  function personLink(node, p, badgeIn) {
    var at = personAt(p);
    if (!at) return;
    node.classList.add('tap');
    node.appendChild(el('span', 'tapgo', '›'));
    node.addEventListener('click', function (e) {
      if (ADMIN && e.target.closest('.ph, .editlink')) return;
      location.hash = 'p' + at;
    });
  }
  function personAt(p) {
    var out = null;
    DATA.ratana.forEach(function (r, ri) { (r.people || []).forEach(function (q, pi) { if (q === p) out = (ri + 1) + '-' + (pi + 1); }); });
    return out;
  }
  function acNode(p, num) {
    var row = el('div', 'ac');
    row.appendChild(photo(p.photo, p.name, function (path) { p.photo = path; }));
    var x = el('div', 'acx');
    x.appendChild(words('b', p.name));
    if (p.status) x.appendChild(el('span', null, p.status));
    if (p.order) x.appendChild(el('span', 'ordnote', p.order));
    var ed = nameEdit(p, 'list'); if (ed) x.appendChild(ed);
    row.appendChild(x);
    if (p.name) personLink(row, p, x);
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
      var lvl = el('div', 'lvl' + (r.style === 'feature' ? ' top' : '') + ' rq');
      lvl.appendChild(el('span', 'rn', r.label));
      if (r.style === 'feature') {
        var wrap = el('div', 'person big');
        var img = el('img', 'buddha');
        img.src = r.image; img.alt = r.imageAlt || r.title;
        wrap.appendChild(img);
        if (ADMIN) {
          wrap.classList.add('editable');
          wrap.appendChild(camBadge());
          wrap.onclick = function () {
            pickPhoto(function (path, preview) { img.src = preview; r.image = path; saveData('เปลี่ยนรูป ' + r.label); });
          };
        }
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
          if (p.name) personLink(per, p);
          tier.appendChild(per);
        });
        lvl.appendChild(tier);
        if (ADMIN) lvl.appendChild(addPersonBtn(r));
      }
      box.appendChild(lvl);
    });
  }

  // คลังสัญลักษณ์บนการ์ดหมวด (ชื่อไทยคือชื่อที่แอดมินเห็น)
  var ICONS = {"ธรรมจักร": "<svg viewBox=\"0 0 100 100\"><circle cx=\"50\" cy=\"50\" r=\"36.5\" fill=\"none\" stroke=\"url(#gg)\" stroke-width=\"7\"/><circle cx=\"86.5\" cy=\"50.0\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"85.3\" cy=\"59.4\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"81.6\" cy=\"68.2\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"75.8\" cy=\"75.8\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"68.2\" cy=\"81.6\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"59.4\" cy=\"85.3\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"50.0\" cy=\"86.5\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"40.6\" cy=\"85.3\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"31.8\" cy=\"81.6\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"24.2\" cy=\"75.8\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"18.4\" cy=\"68.2\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"14.7\" cy=\"59.4\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"13.5\" cy=\"50.0\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"14.7\" cy=\"40.6\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"18.4\" cy=\"31.8\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"24.2\" cy=\"24.2\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"31.7\" cy=\"18.4\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"40.6\" cy=\"14.7\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"50.0\" cy=\"13.5\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"59.4\" cy=\"14.7\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"68.2\" cy=\"18.4\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"75.8\" cy=\"24.2\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"81.6\" cy=\"31.7\" r=\"1.3\" fill=\"#fff8e6\"/><circle cx=\"85.3\" cy=\"40.6\" r=\"1.3\" fill=\"#fff8e6\"/><line x1=\"61.1\" y1=\"54.6\" x2=\"80.5\" y2=\"62.6\" stroke=\"url(#gg)\" stroke-width=\"4.5\" stroke-linecap=\"round\"/><circle cx=\"90.7\" cy=\"66.8\" r=\"4.2\" fill=\"url(#gg)\"/><line x1=\"54.6\" y1=\"61.1\" x2=\"62.6\" y2=\"80.5\" stroke=\"url(#gg)\" stroke-width=\"4.5\" stroke-linecap=\"round\"/><circle cx=\"66.8\" cy=\"90.7\" r=\"4.2\" fill=\"url(#gg)\"/><line x1=\"45.4\" y1=\"61.1\" x2=\"37.4\" y2=\"80.5\" stroke=\"url(#gg)\" stroke-width=\"4.5\" stroke-linecap=\"round\"/><circle cx=\"33.2\" cy=\"90.7\" r=\"4.2\" fill=\"url(#gg)\"/><line x1=\"38.9\" y1=\"54.6\" x2=\"19.5\" y2=\"62.6\" stroke=\"url(#gg)\" stroke-width=\"4.5\" stroke-linecap=\"round\"/><circle cx=\"9.3\" cy=\"66.8\" r=\"4.2\" fill=\"url(#gg)\"/><line x1=\"38.9\" y1=\"45.4\" x2=\"19.5\" y2=\"37.4\" stroke=\"url(#gg)\" stroke-width=\"4.5\" stroke-linecap=\"round\"/><circle cx=\"9.3\" cy=\"33.2\" r=\"4.2\" fill=\"url(#gg)\"/><line x1=\"45.4\" y1=\"38.9\" x2=\"37.4\" y2=\"19.5\" stroke=\"url(#gg)\" stroke-width=\"4.5\" stroke-linecap=\"round\"/><circle cx=\"33.2\" cy=\"9.3\" r=\"4.2\" fill=\"url(#gg)\"/><line x1=\"54.6\" y1=\"38.9\" x2=\"62.6\" y2=\"19.5\" stroke=\"url(#gg)\" stroke-width=\"4.5\" stroke-linecap=\"round\"/><circle cx=\"66.8\" cy=\"9.3\" r=\"4.2\" fill=\"url(#gg)\"/><line x1=\"61.1\" y1=\"45.4\" x2=\"80.5\" y2=\"37.4\" stroke=\"url(#gg)\" stroke-width=\"4.5\" stroke-linecap=\"round\"/><circle cx=\"90.7\" cy=\"33.2\" r=\"4.2\" fill=\"url(#gg)\"/><circle cx=\"50\" cy=\"50\" r=\"12\" fill=\"url(#gg)\"/><circle cx=\"50\" cy=\"50\" r=\"6\" fill=\"none\" stroke=\"#fff8e6\" stroke-width=\"1.5\"/></svg>", "บันไดสู่ดอกบัว": "<svg viewBox=\"0 0 100 100\"><path d=\"M10 86h80v-8H72V64H56V50H40V36H26v42H10z\" fill=\"url(#gg)\"/><path d=\"M26 78V36h14v14h16v14h16v14\" fill=\"none\" stroke=\"#fff8e6\" stroke-width=\"1.2\" opacity=\".6\"/><path d=\"M33 30c-6-2-10-8-10-14 4 0 8 2 10 6 2-4 6-6 10-6 0 6-4 12-10 14z\" fill=\"url(#gp)\"/><path d=\"M33 30c-2-6-2-12 0-18 2 6 2 12 0 18z\" fill=\"#ffe1ea\"/></svg>", "ดอกบัวบาน": "<svg viewBox=\"0 0 100 100\"><path d=\"M50 80C30 78 14 66 10 48c14 2 28 10 36 24z\" fill=\"url(#gg)\" opacity=\".85\"/><path d=\"M50 80c20-2 36-14 40-32-14 2-28 10-36 24z\" fill=\"url(#gg)\" opacity=\".85\"/><path d=\"M50 80C36 70 30 52 34 34c10 8 16 24 16 46z\" fill=\"url(#gp)\"/><path d=\"M50 80c14-10 20-28 16-46-10 8-16 24-16 46z\" fill=\"url(#gp)\"/><path d=\"M50 80c-9-14-9-38 0-58 9 20 9 44 0 58z\" fill=\"url(#gp)\" stroke=\"#fff\" stroke-width=\"1.2\"/><path d=\"M22 86c16 4 40 4 56 0\" stroke=\"url(#gg)\" stroke-width=\"3\" stroke-linecap=\"round\" fill=\"none\"/></svg>", "ใบโพธิ์": "<svg viewBox=\"0 0 100 100\"><path d=\"M50 84C26 76 12 56 16 36c3-14 18-20 30-12 2 1 3 3 4 4 1-1 2-3 4-4 12-8 27-2 30 12 4 20-10 40-34 48z\" fill=\"url(#gg)\"/><path d=\"M50 84c0 4 1 8 3 11\" stroke=\"url(#gg)\" stroke-width=\"3\" fill=\"none\" stroke-linecap=\"round\"/><path d=\"M50 30v52M50 44l-18-10M50 44l18-10M50 58l-24-10M50 58l24-10M50 70l-16-7M50 70l16-7\" stroke=\"#24502f\" stroke-width=\"1.8\" fill=\"none\" stroke-linecap=\"round\" opacity=\".55\"/></svg>", "พระเจดีย์": "<svg viewBox=\"0 0 100 100\"><path d=\"M50 6l2 22h-4z\" fill=\"url(#gg)\"/><circle cx=\"50\" cy=\"8\" r=\"2.4\" fill=\"url(#gg)\"/><path d=\"M44 28h12l-1 6H45z\" fill=\"url(#gg)\"/><path d=\"M47 34h6v4h-6z\" fill=\"url(#gg)\"/><path d=\"M50 38c-14 2-22 14-22 28h44c0-14-8-26-22-28z\" fill=\"url(#gg)\"/><path d=\"M24 66h52v6H24zM20 72h60v6H20zM16 78h68v8H16z\" fill=\"url(#gg)\"/><path d=\"M28 75h44M22 82h56\" stroke=\"#fff8e6\" stroke-width=\"1\" stroke-dasharray=\"2 3\"/></svg>", "ประทีป": "<svg viewBox=\"0 0 100 100\"><path d=\"M50 14c8 10 10 18 6 26-2 4-10 4-12 0-4-8-2-16 6-26z\" fill=\"url(#gp)\"/><path d=\"M50 26c3 5 3 9 1 12-1 1-3 1-4 0-1-3-1-7 3-12z\" fill=\"#fff4c8\"/><path d=\"M18 50c4 10 16 16 32 16s28-6 32-16z\" fill=\"url(#gg)\"/><path d=\"M74 50c6-4 12-4 14 0-4 0-8 2-10 4z\" fill=\"url(#gg)\"/><path d=\"M44 66h12l4 10H40z\" fill=\"url(#gg)\"/><path d=\"M30 76h40v6H30z\" fill=\"url(#gg)\"/><path d=\"M24 54c8 6 44 6 52 0\" stroke=\"#fff8e6\" stroke-width=\"1\" fill=\"none\" opacity=\".7\"/></svg>", "คัมภีร์ใบลาน": "<svg viewBox=\"0 0 100 100\"><rect x=\"10\" y=\"30\" width=\"80\" height=\"9\" rx=\"4.5\" fill=\"url(#gr)\" stroke=\"url(#gg)\" stroke-width=\"2\"/><rect x=\"12\" y=\"40\" width=\"76\" height=\"5\" rx=\"2.5\" fill=\"#f3e6c4\"/><rect x=\"12\" y=\"46\" width=\"76\" height=\"5\" rx=\"2.5\" fill=\"#eadbb4\"/><rect x=\"12\" y=\"52\" width=\"76\" height=\"5\" rx=\"2.5\" fill=\"#f3e6c4\"/><rect x=\"10\" y=\"58\" width=\"80\" height=\"9\" rx=\"4.5\" fill=\"url(#gr)\" stroke=\"url(#gg)\" stroke-width=\"2\"/><path d=\"M18 33h64M18 64h64\" stroke=\"url(#gg)\" stroke-width=\"1\" stroke-dasharray=\"3 3\"/><path d=\"M30 26v46M70 26v46\" stroke=\"url(#gg)\" stroke-width=\"2.5\"/><path d=\"M70 72c4 6 10 8 14 6M70 72c-2 7 0 12 4 14\" fill=\"none\" stroke=\"url(#gg)\" stroke-width=\"2.5\" stroke-linecap=\"round\"/><circle cx=\"84\" cy=\"78\" r=\"3\" fill=\"url(#gg)\"/></svg>", "ตู้พระธรรม": "<svg viewBox=\"0 0 100 100\"><path d=\"M22 14h56l4 8H18z\" fill=\"url(#gg)\"/><rect x=\"22\" y=\"22\" width=\"56\" height=\"58\" rx=\"2\" fill=\"url(#gr)\" stroke=\"url(#gg)\" stroke-width=\"3\"/><path d=\"M50 22v58\" stroke=\"url(#gg)\" stroke-width=\"2.5\"/><path d=\"M36 34c4 6 4 12 0 18-4-6-4-12 0-18zM64 34c4 6 4 12 0 18-4-6-4-12 0-18z\" fill=\"url(#gg)\"/><path d=\"M30 60h12M58 60h12M30 66h12M58 66h12\" stroke=\"url(#gg)\" stroke-width=\"1.5\"/><circle cx=\"46\" cy=\"50\" r=\"2\" fill=\"url(#gg)\"/><circle cx=\"54\" cy=\"50\" r=\"2\" fill=\"url(#gg)\"/><path d=\"M24 80l-4 8h8zM76 80l4 8h-8z\" fill=\"url(#gg)\"/></svg>", "คัมภีร์เปิด": "<svg viewBox=\"0 0 100 100\"><path d=\"M50 30C38 22 22 22 10 26v48c12-4 28-4 40 4z\" fill=\"#f3e6c4\" stroke=\"url(#gg)\" stroke-width=\"3\" stroke-linejoin=\"round\"/><path d=\"M50 30c12-8 28-8 40-4v48c-12-4-28-4-40 4z\" fill=\"#f3e6c4\" stroke=\"url(#gg)\" stroke-width=\"3\" stroke-linejoin=\"round\"/><path d=\"M50 30v48\" stroke=\"url(#gg)\" stroke-width=\"3\"/><path d=\"M18 38c8-2 18-2 26 2M18 48c8-2 18-2 26 2M18 58c8-2 18-2 26 2M56 40c8-4 18-4 26-2M56 50c8-4 18-4 26-2M56 60c8-4 18-4 26-2\" stroke=\"#b8914a\" stroke-width=\"1.6\" fill=\"none\" opacity=\".7\"/><path d=\"M48 78l2 12 2-12\" fill=\"url(#gp)\"/></svg>", "สมุดข่อย": "<svg viewBox=\"0 0 100 100\"><path d=\"M14 30l18-8v52l-18 8zM32 22l18 8v52l-18-8zM50 30l18-8v52l-18 8zM68 22l18 8v52l-18-8z\" fill=\"#f3e6c4\" stroke=\"url(#gg)\" stroke-width=\"2.6\" stroke-linejoin=\"round\"/><path d=\"M18 42l10-4M18 50l10-4M18 58l10-4M36 38l10 4M36 46l10 4M36 54l10 4M54 42l10-4M54 50l10-4M54 58l10-4M72 38l10 4M72 46l10 4M72 54l10 4\" stroke=\"#b8914a\" stroke-width=\"1.5\" opacity=\".8\"/></svg>", "ระฆัง": "<svg viewBox=\"0 0 100 100\"><path d=\"M50 10v8\" stroke=\"url(#gg)\" stroke-width=\"4\" stroke-linecap=\"round\"/><circle cx=\"50\" cy=\"12\" r=\"4\" fill=\"none\" stroke=\"url(#gg)\" stroke-width=\"3\"/><path d=\"M50 18c-14 0-22 12-22 28v14l-8 10h60l-8-10V46c0-16-8-28-22-28z\" fill=\"url(#gg)\"/><path d=\"M30 62h40\" stroke=\"#fff8e6\" stroke-width=\"1.5\" opacity=\".7\"/><circle cx=\"50\" cy=\"78\" r=\"6\" fill=\"url(#gg)\"/><path d=\"M38 34c2-6 6-9 12-10\" stroke=\"#fff8e6\" stroke-width=\"2\" fill=\"none\" stroke-linecap=\"round\" opacity=\".6\"/></svg>", "ฉัตร": "<svg viewBox=\"0 0 100 100\"><path d=\"M50 6v80\" stroke=\"url(#gg)\" stroke-width=\"3\"/><circle cx=\"50\" cy=\"8\" r=\"3\" fill=\"url(#gg)\"/><path d=\"M20 62h60l-4 7h-52z\" fill=\"url(#gg)\"/><path d=\"M25 51h50l-4 7h-42z\" fill=\"url(#gg)\"/><path d=\"M30 40h40l-4 7h-32z\" fill=\"url(#gg)\"/><path d=\"M35 29h30l-4 7h-22z\" fill=\"url(#gg)\"/><path d=\"M40 18h20l-4 7h-12z\" fill=\"url(#gg)\"/><path d=\"M40 88h20\" stroke=\"url(#gg)\" stroke-width=\"4\" stroke-linecap=\"round\"/></svg>", "บาตร": "<svg viewBox=\"0 0 100 100\"><path d=\"M50 22c-4 0-6 3-6 6h12c0-3-2-6-6-6z\" fill=\"url(#gg)\"/><path d=\"M26 34h48l-2 6H28z\" fill=\"url(#gg)\"/><path d=\"M22 44c0 20 12 34 28 34s28-14 28-34z\" fill=\"url(#gg)\"/><path d=\"M28 50c3 12 11 20 22 22\" stroke=\"#fff8e6\" stroke-width=\"2\" fill=\"none\" opacity=\".55\" stroke-linecap=\"round\"/><path d=\"M34 82h32l-4 6H38z\" fill=\"url(#gg)\"/></svg>", "ตาลปัตร": "<svg viewBox=\"0 0 100 100\"><path d=\"M50 8C28 8 16 22 16 38c0 14 14 24 34 26 20-2 34-12 34-26C84 22 72 8 50 8z\" fill=\"url(#gg)\"/><path d=\"M50 14c-16 0-26 10-26 24 0 10 10 18 26 20 16-2 26-10 26-20 0-14-10-24-26-24z\" fill=\"none\" stroke=\"#fff8e6\" stroke-width=\"1.5\" opacity=\".7\"/><path d=\"M50 36c1.6-1.6 1.6-3.6 0-5-1.6 1.4-1.6 3.4 0 5z\" fill=\"#fff8e6\" transform=\"rotate(0 50 36) scale(1)\"/><path d=\"M50 36c1.6-1.6 1.6-3.6 0-5-1.6 1.4-1.6 3.4 0 5z\" fill=\"#fff8e6\" transform=\"rotate(90 50 36) scale(1)\"/><path d=\"M50 36c1.6-1.6 1.6-3.6 0-5-1.6 1.4-1.6 3.4 0 5z\" fill=\"#fff8e6\" transform=\"rotate(180 50 36) scale(1)\"/><path d=\"M50 36c1.6-1.6 1.6-3.6 0-5-1.6 1.4-1.6 3.4 0 5z\" fill=\"#fff8e6\" transform=\"rotate(270 50 36) scale(1)\"/><path d=\"M50 34c4 4 4 9 0 13-4-4-4-9 0-13z\" fill=\"url(#gp)\"/><path d=\"M47 64h6v26h-6z\" fill=\"url(#gg)\"/><circle cx=\"50\" cy=\"92\" r=\"3\" fill=\"url(#gg)\"/></svg>", "รอยพระพุทธบาท": "<svg viewBox=\"0 0 100 100\"><ellipse cx=\"36\" cy=\"18\" rx=\"4\" ry=\"5\" fill=\"url(#gg)\"/><ellipse cx=\"44\" cy=\"14\" rx=\"4\" ry=\"5\" fill=\"url(#gg)\"/><ellipse cx=\"52\" cy=\"13\" rx=\"4\" ry=\"5\" fill=\"url(#gg)\"/><ellipse cx=\"60\" cy=\"15\" rx=\"4\" ry=\"5\" fill=\"url(#gg)\"/><ellipse cx=\"66\" cy=\"20\" rx=\"4\" ry=\"5\" fill=\"url(#gg)\"/><path d=\"M30 30c0-4 6-6 20-6s22 3 22 8c0 18-4 30-6 42-1 8-8 14-16 14s-15-6-16-14c-2-12-4-26-4-44z\" fill=\"url(#gg)\"/><circle cx=\"51\" cy=\"56\" r=\"11\" fill=\"none\" stroke=\"#fff8e6\" stroke-width=\"2\"/><line x1=\"51\" y1=\"56\" x2=\"62.0\" y2=\"56.0\" stroke=\"#fff8e6\" stroke-width=\"1.4\"/><line x1=\"51\" y1=\"56\" x2=\"58.8\" y2=\"63.8\" stroke=\"#fff8e6\" stroke-width=\"1.4\"/><line x1=\"51\" y1=\"56\" x2=\"51.0\" y2=\"67.0\" stroke=\"#fff8e6\" stroke-width=\"1.4\"/><line x1=\"51\" y1=\"56\" x2=\"43.2\" y2=\"63.8\" stroke=\"#fff8e6\" stroke-width=\"1.4\"/><line x1=\"51\" y1=\"56\" x2=\"40.0\" y2=\"56.0\" stroke=\"#fff8e6\" stroke-width=\"1.4\"/><line x1=\"51\" y1=\"56\" x2=\"43.2\" y2=\"48.2\" stroke=\"#fff8e6\" stroke-width=\"1.4\"/><line x1=\"51\" y1=\"56\" x2=\"51.0\" y2=\"45.0\" stroke=\"#fff8e6\" stroke-width=\"1.4\"/><line x1=\"51\" y1=\"56\" x2=\"58.8\" y2=\"48.2\" stroke=\"#fff8e6\" stroke-width=\"1.4\"/><circle cx=\"51\" cy=\"56\" r=\"3\" fill=\"#fff8e6\"/></svg>", "ดอกประจำยาม": "<svg viewBox=\"0 0 100 100\"><path d=\"M50 50C56 42 56 30 50 20 44 30 44 42 50 50Z\" fill=\"url(#gg)\" transform=\"rotate(0 50 50)\"/><path d=\"M50 50C56 42 56 30 50 20 44 30 44 42 50 50Z\" fill=\"url(#gg)\" transform=\"rotate(90 50 50)\"/><path d=\"M50 50C56 42 56 30 50 20 44 30 44 42 50 50Z\" fill=\"url(#gg)\" transform=\"rotate(180 50 50)\"/><path d=\"M50 50C56 42 56 30 50 20 44 30 44 42 50 50Z\" fill=\"url(#gg)\" transform=\"rotate(270 50 50)\"/><path d=\"M50 50C53 44 58 41 64 40 63 46 58 50 50 50Z\" fill=\"url(#gp)\" transform=\"rotate(0 50 50)\"/><path d=\"M50 50C53 44 58 41 64 40 63 46 58 50 50 50Z\" fill=\"url(#gp)\" transform=\"rotate(90 50 50)\"/><path d=\"M50 50C53 44 58 41 64 40 63 46 58 50 50 50Z\" fill=\"url(#gp)\" transform=\"rotate(180 50 50)\"/><path d=\"M50 50C53 44 58 41 64 40 63 46 58 50 50 50Z\" fill=\"url(#gp)\" transform=\"rotate(270 50 50)\"/><circle cx=\"50\" cy=\"50\" r=\"7\" fill=\"url(#gg)\" stroke=\"#fff8e6\" stroke-width=\"1.5\"/></svg>", "ดอกบัวตูม": "<svg viewBox=\"0 0 100 100\"><path d=\"M50 14c14 14 16 34 0 52-16-18-14-38 0-52z\" fill=\"url(#gp)\"/><path d=\"M50 66c-12-6-18-18-16-30 8 6 14 16 16 30z\" fill=\"url(#gp)\" opacity=\".8\"/><path d=\"M50 66c12-6 18-18 16-30-8 6-14 16-16 30z\" fill=\"url(#gp)\" opacity=\".8\"/><path d=\"M50 20v42\" stroke=\"#fff\" stroke-width=\"1.2\" opacity=\".6\"/><path d=\"M50 66c0 10-2 18-6 24\" stroke=\"url(#gg)\" stroke-width=\"3.5\" fill=\"none\" stroke-linecap=\"round\"/><path d=\"M48 80c-8-4-16-2-20 4 8 2 14 0 20-4z\" fill=\"url(#gg)\"/></svg>", "ปทุมแปดกลีบ": "<svg viewBox=\"0 0 100 100\"><path d=\"M50 50C57 38 57 24 50 12 43 24 43 38 50 50Z\" fill=\"url(#gg)\" transform=\"rotate(0 50 50)\"/><path d=\"M50 50C57 38 57 24 50 12 43 24 43 38 50 50Z\" fill=\"url(#gg)\" transform=\"rotate(45 50 50)\"/><path d=\"M50 50C57 38 57 24 50 12 43 24 43 38 50 50Z\" fill=\"url(#gg)\" transform=\"rotate(90 50 50)\"/><path d=\"M50 50C57 38 57 24 50 12 43 24 43 38 50 50Z\" fill=\"url(#gg)\" transform=\"rotate(135 50 50)\"/><path d=\"M50 50C57 38 57 24 50 12 43 24 43 38 50 50Z\" fill=\"url(#gg)\" transform=\"rotate(180 50 50)\"/><path d=\"M50 50C57 38 57 24 50 12 43 24 43 38 50 50Z\" fill=\"url(#gg)\" transform=\"rotate(225 50 50)\"/><path d=\"M50 50C57 38 57 24 50 12 43 24 43 38 50 50Z\" fill=\"url(#gg)\" transform=\"rotate(270 50 50)\"/><path d=\"M50 50C57 38 57 24 50 12 43 24 43 38 50 50Z\" fill=\"url(#gg)\" transform=\"rotate(315 50 50)\"/><path d=\"M50 50C54 42 54 34 50 26 46 34 46 42 50 50Z\" fill=\"url(#gp)\" transform=\"rotate(22.5 50 50)\"/><path d=\"M50 50C54 42 54 34 50 26 46 34 46 42 50 50Z\" fill=\"url(#gp)\" transform=\"rotate(67.5 50 50)\"/><path d=\"M50 50C54 42 54 34 50 26 46 34 46 42 50 50Z\" fill=\"url(#gp)\" transform=\"rotate(112.5 50 50)\"/><path d=\"M50 50C54 42 54 34 50 26 46 34 46 42 50 50Z\" fill=\"url(#gp)\" transform=\"rotate(157.5 50 50)\"/><path d=\"M50 50C54 42 54 34 50 26 46 34 46 42 50 50Z\" fill=\"url(#gp)\" transform=\"rotate(202.5 50 50)\"/><path d=\"M50 50C54 42 54 34 50 26 46 34 46 42 50 50Z\" fill=\"url(#gp)\" transform=\"rotate(247.5 50 50)\"/><path d=\"M50 50C54 42 54 34 50 26 46 34 46 42 50 50Z\" fill=\"url(#gp)\" transform=\"rotate(292.5 50 50)\"/><path d=\"M50 50C54 42 54 34 50 26 46 34 46 42 50 50Z\" fill=\"url(#gp)\" transform=\"rotate(337.5 50 50)\"/><circle cx=\"50\" cy=\"50\" r=\"8\" fill=\"url(#gg)\"/><circle cx=\"50\" cy=\"50\" r=\"4\" fill=\"#fff8e6\"/></svg>", "หม้อปูรณฆฏะ": "<svg viewBox=\"0 0 100 100\"><path d=\"M50 30c-8-8-18-10-24-6 6 4 14 8 24 6z\" fill=\"url(#gg)\"/><path d=\"M50 30c8-8 18-10 24-6-6 4-14 8-24 6z\" fill=\"url(#gg)\"/><path d=\"M50 30c-3-8-1-16 0-20 1 4 3 12 0 20z\" fill=\"url(#gp)\"/><path d=\"M38 34h24l-2 6H40z\" fill=\"url(#gg)\"/><path d=\"M40 40c-14 6-18 18-14 30 3 10 12 16 24 16s21-6 24-16c4-12 0-24-14-30z\" fill=\"url(#gg)\"/><path d=\"M28 62h44\" stroke=\"#fff8e6\" stroke-width=\"1.5\" stroke-dasharray=\"3 3\" opacity=\".8\"/><path d=\"M40 88h20\" stroke=\"url(#gg)\" stroke-width=\"4\" stroke-linecap=\"round\"/></svg>", "ธงธรรมจักร": "<svg viewBox=\"0 0 100 100\"><path d=\"M24 10v82\" stroke=\"url(#gg)\" stroke-width=\"4\" stroke-linecap=\"round\"/><path d=\"M26 14h50l-8 14 8 14H26z\" fill=\"url(#gg)\"/><circle cx=\"50\" cy=\"28\" r=\"8\" fill=\"none\" stroke=\"#fff8e6\" stroke-width=\"1.8\"/><line x1=\"50\" y1=\"28\" x2=\"58.0\" y2=\"28.0\" stroke=\"#fff8e6\" stroke-width=\"1.2\"/><line x1=\"50\" y1=\"28\" x2=\"55.7\" y2=\"33.7\" stroke=\"#fff8e6\" stroke-width=\"1.2\"/><line x1=\"50\" y1=\"28\" x2=\"50.0\" y2=\"36.0\" stroke=\"#fff8e6\" stroke-width=\"1.2\"/><line x1=\"50\" y1=\"28\" x2=\"44.3\" y2=\"33.7\" stroke=\"#fff8e6\" stroke-width=\"1.2\"/><line x1=\"50\" y1=\"28\" x2=\"42.0\" y2=\"28.0\" stroke=\"#fff8e6\" stroke-width=\"1.2\"/><line x1=\"50\" y1=\"28\" x2=\"44.3\" y2=\"22.3\" stroke=\"#fff8e6\" stroke-width=\"1.2\"/><line x1=\"50\" y1=\"28\" x2=\"50.0\" y2=\"20.0\" stroke=\"#fff8e6\" stroke-width=\"1.2\"/><line x1=\"50\" y1=\"28\" x2=\"55.7\" y2=\"22.3\" stroke=\"#fff8e6\" stroke-width=\"1.2\"/></svg>", "ประทีปดอกบัว": "<svg viewBox=\"0 0 100 100\"><path d=\"M50 12c6 8 7 14 4 20-2 3-6 3-8 0-3-6-2-12 4-20z\" fill=\"url(#gp)\"/><path d=\"M50 22c2 4 2 7 1 9h-2c-1-2-1-5 1-9z\" fill=\"#fff4c8\"/><path d=\"M50 40c-10 2-16 10-16 20 8-2 14-8 16-20zM50 40c10 2 16 10 16 20-8-2-14-8-16-20z\" fill=\"url(#gg)\"/><path d=\"M50 40c-6 6-6 16 0 26 6-10 6-20 0-26z\" fill=\"url(#gg)\"/><path d=\"M22 62c6 12 16 18 28 18s22-6 28-18\" fill=\"none\" stroke=\"url(#gg)\" stroke-width=\"5\" stroke-linecap=\"round\"/><path d=\"M36 84h28\" stroke=\"url(#gg)\" stroke-width=\"4\" stroke-linecap=\"round\"/></svg>", "ต้นโพธิ์": "<svg viewBox=\"0 0 100 100\"><path d=\"M47 86V58l-10-10M53 86V58l10-10M50 60V40\" stroke=\"url(#gg)\" stroke-width=\"5\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M0 6C-7 0-8-7-3-10c2-1 3 0 3 1 0-1 1-2 3-1 5 3 4 10-3 16z\" fill=\"url(#gg)\" transform=\"translate(22.0 42.0) rotate(-60) scale(1.0)\"/><path d=\"M0 6C-7 0-8-7-3-10c2-1 3 0 3 1 0-1 1-2 3-1 5 3 4 10-3 16z\" fill=\"url(#gg)\" transform=\"translate(27.347524157501468 29.068724449565593) rotate(-30) scale(1.0)\"/><path d=\"M0 6C-7 0-8-7-3-10c2-1 3 0 3 1 0-1 1-2 3-1 5 3 4 10-3 16z\" fill=\"url(#gg)\" transform=\"translate(41.34752415750147 21.076756641506623) rotate(0) scale(1.0)\"/><path d=\"M0 6C-7 0-8-7-3-10c2-1 3 0 3 1 0-1 1-2 3-1 5 3 4 10-3 16z\" fill=\"url(#gg)\" transform=\"translate(58.65247584249852 21.07675664150662) rotate(30) scale(1.0)\"/><path d=\"M0 6C-7 0-8-7-3-10c2-1 3 0 3 1 0-1 1-2 3-1 5 3 4 10-3 16z\" fill=\"url(#gg)\" transform=\"translate(72.65247584249852 29.068724449565586) rotate(60) scale(1.0)\"/><path d=\"M0 6C-7 0-8-7-3-10c2-1 3 0 3 1 0-1 1-2 3-1 5 3 4 10-3 16z\" fill=\"url(#gg)\" transform=\"translate(78.0 41.99999999999999) rotate(90) scale(1.0)\"/><path d=\"M0 6C-7 0-8-7-3-10c2-1 3 0 3 1 0-1 1-2 3-1 5 3 4 10-3 16z\" fill=\"url(#gg)\" transform=\"translate(34.599999999999994 42.0) rotate(-40) scale(1.0)\"/><path d=\"M0 6C-7 0-8-7-3-10c2-1 3 0 3 1 0-1 1-2 3-1 5 3 4 10-3 16z\" fill=\"url(#gg)\" transform=\"translate(42.29999999999999 31.521092614208293) rotate(0) scale(1.0)\"/><path d=\"M0 6C-7 0-8-7-3-10c2-1 3 0 3 1 0-1 1-2 3-1 5 3 4 10-3 16z\" fill=\"url(#gg)\" transform=\"translate(57.69999999999999 31.521092614208285) rotate(40) scale(1.0)\"/><path d=\"M0 6C-7 0-8-7-3-10c2-1 3 0 3 1 0-1 1-2 3-1 5 3 4 10-3 16z\" fill=\"url(#gg)\" transform=\"translate(65.4 42.0) rotate(80) scale(1.0)\"/><path d=\"M34 88h32\" stroke=\"url(#gg)\" stroke-width=\"4\" stroke-linecap=\"round\"/></svg>", "โพธิบัลลังก์": "<svg viewBox=\"0 0 100 100\"><path d=\"M0 6C-7 0-8-7-3-10c2-1 3 0 3 1 0-1 1-2 3-1 5 3 4 10-3 16z\" fill=\"url(#gg)\" transform=\"translate(32 26) rotate(-30) scale(1.1)\"/><path d=\"M0 6C-7 0-8-7-3-10c2-1 3 0 3 1 0-1 1-2 3-1 5 3 4 10-3 16z\" fill=\"url(#gg)\" transform=\"translate(50 18) rotate(0) scale(1.2)\"/><path d=\"M0 6C-7 0-8-7-3-10c2-1 3 0 3 1 0-1 1-2 3-1 5 3 4 10-3 16z\" fill=\"url(#gg)\" transform=\"translate(68 26) rotate(30) scale(1.1)\"/><path d=\"M0 6C-7 0-8-7-3-10c2-1 3 0 3 1 0-1 1-2 3-1 5 3 4 10-3 16z\" fill=\"url(#gg)\" transform=\"translate(40 32) rotate(-15) scale(0.9)\"/><path d=\"M0 6C-7 0-8-7-3-10c2-1 3 0 3 1 0-1 1-2 3-1 5 3 4 10-3 16z\" fill=\"url(#gg)\" transform=\"translate(60 32) rotate(15) scale(0.9)\"/><path d=\"M22 54h56v8H22z\" fill=\"url(#gg)\"/><path d=\"M28 62h44v16H28z\" fill=\"url(#gg)\"/><path d=\"M34 66h32v8H34z\" fill=\"none\" stroke=\"#fff8e6\" stroke-width=\"1.4\"/><path d=\"M20 78h60v6H20z\" fill=\"url(#gg)\"/><path d=\"M30 50c6-6 34-6 40 0\" stroke=\"url(#gp)\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/></svg>", "บัวเจ็ดดอก": "<svg viewBox=\"0 0 100 100\"><g transform=\"translate(50 20) scale(1.05)\"><path d=\"M0-12C5-6 6 0 0 6-6 0-5-6 0-12z\" fill=\"url(#gp)\"/><path d=\"M0 6C-6 3-9-2-8-7-4-4-1 0 0 6zM0 6C6 3 9-2 8-7 4-4 1 0 0 6z\" fill=\"url(#gg)\"/></g><g transform=\"translate(30 30) scale(1.05)\"><path d=\"M0-12C5-6 6 0 0 6-6 0-5-6 0-12z\" fill=\"url(#gp)\"/><path d=\"M0 6C-6 3-9-2-8-7-4-4-1 0 0 6zM0 6C6 3 9-2 8-7 4-4 1 0 0 6z\" fill=\"url(#gg)\"/></g><g transform=\"translate(70 30) scale(1.05)\"><path d=\"M0-12C5-6 6 0 0 6-6 0-5-6 0-12z\" fill=\"url(#gp)\"/><path d=\"M0 6C-6 3-9-2-8-7-4-4-1 0 0 6zM0 6C6 3 9-2 8-7 4-4 1 0 0 6z\" fill=\"url(#gg)\"/></g><g transform=\"translate(22 52) scale(1.05)\"><path d=\"M0-12C5-6 6 0 0 6-6 0-5-6 0-12z\" fill=\"url(#gp)\"/><path d=\"M0 6C-6 3-9-2-8-7-4-4-1 0 0 6zM0 6C6 3 9-2 8-7 4-4 1 0 0 6z\" fill=\"url(#gg)\"/></g><g transform=\"translate(78 52) scale(1.05)\"><path d=\"M0-12C5-6 6 0 0 6-6 0-5-6 0-12z\" fill=\"url(#gp)\"/><path d=\"M0 6C-6 3-9-2-8-7-4-4-1 0 0 6zM0 6C6 3 9-2 8-7 4-4 1 0 0 6z\" fill=\"url(#gg)\"/></g><g transform=\"translate(34 72) scale(1.05)\"><path d=\"M0-12C5-6 6 0 0 6-6 0-5-6 0-12z\" fill=\"url(#gp)\"/><path d=\"M0 6C-6 3-9-2-8-7-4-4-1 0 0 6zM0 6C6 3 9-2 8-7 4-4 1 0 0 6z\" fill=\"url(#gg)\"/></g><g transform=\"translate(66 72) scale(1.05)\"><path d=\"M0-12C5-6 6 0 0 6-6 0-5-6 0-12z\" fill=\"url(#gp)\"/><path d=\"M0 6C-6 3-9-2-8-7-4-4-1 0 0 6zM0 6C6 3 9-2 8-7 4-4 1 0 0 6z\" fill=\"url(#gg)\"/></g><circle cx=\"50\" cy=\"50\" r=\"4\" fill=\"url(#gg)\"/></svg>", "ต้นสาละคู่": "<svg viewBox=\"0 0 100 100\"><path d=\"M28 90V46M28 60l-7-9M28 66l6-8\" stroke=\"#c9a45a\" stroke-width=\"4\" stroke-linecap=\"round\" fill=\"none\"/><ellipse cx=\"28\" cy=\"20\" rx=\"12\" ry=\"10\" fill=\"url(#gg)\"/><ellipse cx=\"19\" cy=\"30\" rx=\"11\" ry=\"9\" fill=\"url(#gg)\"/><ellipse cx=\"36\" cy=\"30\" rx=\"11\" ry=\"9\" fill=\"url(#gg)\"/><ellipse cx=\"24\" cy=\"40\" rx=\"12\" ry=\"8\" fill=\"url(#gg)\"/><ellipse cx=\"34\" cy=\"40\" rx=\"10\" ry=\"7\" fill=\"url(#gg)\"/><path d=\"M28 16v8\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".5\"/><path d=\"M19 26v8\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".5\"/><path d=\"M36 26v8\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".5\"/><path d=\"M24 36v8\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".5\"/><g transform=\"translate(23 16) scale(0.9)\"><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(288)\"/><circle r=\"1.2\" fill=\"url(#gg)\"/></g><g transform=\"translate(34 24) scale(0.9)\"><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(288)\"/><circle r=\"1.2\" fill=\"url(#gg)\"/></g><g transform=\"translate(16 32) scale(0.9)\"><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(288)\"/><circle r=\"1.2\" fill=\"url(#gg)\"/></g><g transform=\"translate(38 36) scale(0.9)\"><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(288)\"/><circle r=\"1.2\" fill=\"url(#gg)\"/></g><g transform=\"translate(28 42) scale(0.9)\"><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(288)\"/><circle r=\"1.2\" fill=\"url(#gg)\"/></g><path d=\"M72 90V46M72 60l7-9M72 66l-6-8\" stroke=\"#c9a45a\" stroke-width=\"4\" stroke-linecap=\"round\" fill=\"none\"/><ellipse cx=\"72\" cy=\"20\" rx=\"12\" ry=\"10\" fill=\"url(#gg)\"/><ellipse cx=\"81\" cy=\"30\" rx=\"11\" ry=\"9\" fill=\"url(#gg)\"/><ellipse cx=\"64\" cy=\"30\" rx=\"11\" ry=\"9\" fill=\"url(#gg)\"/><ellipse cx=\"76\" cy=\"40\" rx=\"12\" ry=\"8\" fill=\"url(#gg)\"/><ellipse cx=\"66\" cy=\"40\" rx=\"10\" ry=\"7\" fill=\"url(#gg)\"/><path d=\"M72 16v8\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".5\"/><path d=\"M81 26v8\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".5\"/><path d=\"M64 26v8\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".5\"/><path d=\"M76 36v8\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".5\"/><g transform=\"translate(77 16) scale(0.9)\"><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(288)\"/><circle r=\"1.2\" fill=\"url(#gg)\"/></g><g transform=\"translate(66 24) scale(0.9)\"><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(288)\"/><circle r=\"1.2\" fill=\"url(#gg)\"/></g><g transform=\"translate(84 32) scale(0.9)\"><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(288)\"/><circle r=\"1.2\" fill=\"url(#gg)\"/></g><g transform=\"translate(62 36) scale(0.9)\"><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(288)\"/><circle r=\"1.2\" fill=\"url(#gg)\"/></g><g transform=\"translate(72 42) scale(0.9)\"><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(288)\"/><circle r=\"1.2\" fill=\"url(#gg)\"/></g><g transform=\"translate(48 50) scale(0.8)\"><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(288)\"/><circle r=\"1.2\" fill=\"url(#gg)\"/></g><g transform=\"translate(53 62) scale(0.8)\"><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(288)\"/><circle r=\"1.2\" fill=\"url(#gg)\"/></g><g transform=\"translate(47 74) scale(0.8)\"><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-2.6\" rx=\"1.7\" ry=\"2.6\" fill=\"#ffe6ee\" transform=\"rotate(288)\"/><circle r=\"1.2\" fill=\"url(#gg)\"/></g><path d=\"M14 90h72\" stroke=\"#c9a45a\" stroke-width=\"3\" stroke-linecap=\"round\"/></svg>", "กวางหมอบคู่ธรรมจักร": "<svg viewBox=\"0 0 100 100\"><circle cx=\"50\" cy=\"30\" r=\"15\" fill=\"none\" stroke=\"#c9a45a\" stroke-width=\"4\"/><line x1=\"50\" y1=\"30\" x2=\"65.0\" y2=\"30.0\" stroke=\"#c9a45a\" stroke-width=\"2.6\"/><line x1=\"50\" y1=\"30\" x2=\"60.6\" y2=\"40.6\" stroke=\"#c9a45a\" stroke-width=\"2.6\"/><line x1=\"50\" y1=\"30\" x2=\"50.0\" y2=\"45.0\" stroke=\"#c9a45a\" stroke-width=\"2.6\"/><line x1=\"50\" y1=\"30\" x2=\"39.4\" y2=\"40.6\" stroke=\"#c9a45a\" stroke-width=\"2.6\"/><line x1=\"50\" y1=\"30\" x2=\"35.0\" y2=\"30.0\" stroke=\"#c9a45a\" stroke-width=\"2.6\"/><line x1=\"50\" y1=\"30\" x2=\"39.4\" y2=\"19.4\" stroke=\"#c9a45a\" stroke-width=\"2.6\"/><line x1=\"50\" y1=\"30\" x2=\"50.0\" y2=\"15.0\" stroke=\"#c9a45a\" stroke-width=\"2.6\"/><line x1=\"50\" y1=\"30\" x2=\"60.6\" y2=\"19.4\" stroke=\"#c9a45a\" stroke-width=\"2.6\"/><circle cx=\"68.5\" cy=\"30.0\" r=\"2.3\" fill=\"url(#gg)\"/><circle cx=\"63.1\" cy=\"43.1\" r=\"2.3\" fill=\"url(#gg)\"/><circle cx=\"50.0\" cy=\"48.5\" r=\"2.3\" fill=\"url(#gg)\"/><circle cx=\"36.9\" cy=\"43.1\" r=\"2.3\" fill=\"url(#gg)\"/><circle cx=\"31.5\" cy=\"30.0\" r=\"2.3\" fill=\"url(#gg)\"/><circle cx=\"36.9\" cy=\"16.9\" r=\"2.3\" fill=\"url(#gg)\"/><circle cx=\"50.0\" cy=\"11.5\" r=\"2.3\" fill=\"url(#gg)\"/><circle cx=\"63.1\" cy=\"16.9\" r=\"2.3\" fill=\"url(#gg)\"/><circle cx=\"50\" cy=\"30\" r=\"4.5\" fill=\"url(#gg)\"/><circle cx=\"50\" cy=\"30\" r=\"2.1\" fill=\"#fff8e6\"/><rect x=\"48\" y=\"49\" width=\"4\" height=\"21\" fill=\"#c9a45a\"/><path d=\"M40 70h20l3 6H37z\" fill=\"url(#gg)\"/><g transform=\"translate(19 74) scale(1 1)\"><path d=\"M-14 2C-15-5-8-9 0-9c5 0 8 1 10-2l3-7c1-2 3-3 5-2l4 2c1 1 0 3-2 3l-3 0-3 8c3 2 4 6 2 9H-12c-2 0-2-1-2-2z\" fill=\"url(#gg)\"/><path d=\"M13-17l-1-6M13-21l-3-2M15-17l2-6M16-21l3-1\" stroke=\"#c9a45a\" stroke-width=\"1.4\" stroke-linecap=\"round\" fill=\"none\"/><path d=\"M-6 2h14\" stroke=\"#8a6526\" stroke-width=\"1.4\" opacity=\".6\"/><circle cx=\"17\" cy=\"-14\" r=\"0.9\" fill=\"#fff8e6\"/></g><g transform=\"translate(81 74) scale(-1 1)\"><path d=\"M-14 2C-15-5-8-9 0-9c5 0 8 1 10-2l3-7c1-2 3-3 5-2l4 2c1 1 0 3-2 3l-3 0-3 8c3 2 4 6 2 9H-12c-2 0-2-1-2-2z\" fill=\"url(#gg)\"/><path d=\"M13-17l-1-6M13-21l-3-2M15-17l2-6M16-21l3-1\" stroke=\"#c9a45a\" stroke-width=\"1.4\" stroke-linecap=\"round\" fill=\"none\"/><path d=\"M-6 2h14\" stroke=\"#8a6526\" stroke-width=\"1.4\" opacity=\".6\"/><circle cx=\"17\" cy=\"-14\" r=\"0.9\" fill=\"#fff8e6\"/></g><path d=\"M8 84h84\" stroke=\"#c9a45a\" stroke-width=\"3\" stroke-linecap=\"round\"/></svg>", "ไตรรัตน์": "<svg viewBox=\"0 0 100 100\"><path d=\"M24 74c8-8 44-8 52 0z\" fill=\"url(#gp)\"/><path d=\"M20 76c10 6 50 6 60 0\" stroke=\"#c9a45a\" stroke-width=\"4\" fill=\"none\" stroke-linecap=\"round\"/><path d=\"M30 74c-3-6-1-12 4-14 3 5 2 10-4 14z\" fill=\"url(#gp)\" opacity=\".8\"/><path d=\"M42 74c-3-6-1-12 4-14 3 5 2 10-4 14z\" fill=\"url(#gp)\" opacity=\".8\"/><path d=\"M56 74c-3-6-1-12 4-14 3 5 2 10-4 14z\" fill=\"url(#gp)\" opacity=\".8\"/><path d=\"M66 74c-3-6-1-12 4-14 3 5 2 10-4 14z\" fill=\"url(#gp)\" opacity=\".8\"/><path d=\"M36 84h28\" stroke=\"#c9a45a\" stroke-width=\"4\" stroke-linecap=\"round\"/><g transform=\"translate(50 40) scale(1.35)\"><path d=\"M0-15C3-11 4-8 2-5H-2c-2-3-1-6 2-10z\" fill=\"url(#gp)\"/><path d=\"M-8-4h16l-8 15z\" fill=\"url(#gg)\"/><path d=\"M-8-4l4-4h8l4 4z\" fill=\"#f7e3a8\"/><path d=\"M-4-8l4 4 4-4M0-4v15\" stroke=\"#8a6526\" stroke-width=\".9\" fill=\"none\" opacity=\".7\"/></g><g transform=\"translate(33 58) scale(1.15)\"><path d=\"M0-15C3-11 4-8 2-5H-2c-2-3-1-6 2-10z\" fill=\"url(#gp)\"/><path d=\"M-8-4h16l-8 15z\" fill=\"url(#gg)\"/><path d=\"M-8-4l4-4h8l4 4z\" fill=\"#f7e3a8\"/><path d=\"M-4-8l4 4 4-4M0-4v15\" stroke=\"#8a6526\" stroke-width=\".9\" fill=\"none\" opacity=\".7\"/></g><g transform=\"translate(67 58) scale(1.15)\"><path d=\"M0-15C3-11 4-8 2-5H-2c-2-3-1-6 2-10z\" fill=\"url(#gp)\"/><path d=\"M-8-4h16l-8 15z\" fill=\"url(#gg)\"/><path d=\"M-8-4l4-4h8l4 4z\" fill=\"#f7e3a8\"/><path d=\"M-4-8l4 4 4-4M0-4v15\" stroke=\"#8a6526\" stroke-width=\".9\" fill=\"none\" opacity=\".7\"/></g></svg>", "ไตรจีวร": "<svg viewBox=\"0 0 100 100\"><rect x=\"18.0\" y=\"64\" width=\"64\" height=\"16\" rx=\"2\" fill=\"url(#gg)\" opacity=\"1\"/><rect x=\"20.0\" y=\"66\" width=\"60\" height=\"12\" rx=\"1\" fill=\"none\" stroke=\"#fff8e6\" stroke-width=\"1\" opacity=\".5\"/><path d=\"M30.8 64v16\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".55\"/><path d=\"M43.6 64v16\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".55\"/><path d=\"M56.4 64v16\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".55\"/><path d=\"M69.2 64v16\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".55\"/><path d=\"M18.0 72.0h64\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".55\"/><rect x=\"22.0\" y=\"46\" width=\"56\" height=\"16\" rx=\"2\" fill=\"url(#gg)\" opacity=\"1\"/><rect x=\"24.0\" y=\"48\" width=\"52\" height=\"12\" rx=\"1\" fill=\"none\" stroke=\"#fff8e6\" stroke-width=\"1\" opacity=\".5\"/><path d=\"M33.2 46v16\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".55\"/><path d=\"M44.4 46v16\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".55\"/><path d=\"M55.6 46v16\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".55\"/><path d=\"M66.8 46v16\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".55\"/><path d=\"M22.0 54.0h56\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".55\"/><rect x=\"26.0\" y=\"28\" width=\"48\" height=\"16\" rx=\"2\" fill=\"url(#gg)\" opacity=\"1\"/><rect x=\"28.0\" y=\"30\" width=\"44\" height=\"12\" rx=\"1\" fill=\"none\" stroke=\"#fff8e6\" stroke-width=\"1\" opacity=\".5\"/><path d=\"M35.6 28v16\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".55\"/><path d=\"M45.2 28v16\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".55\"/><path d=\"M54.8 28v16\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".55\"/><path d=\"M64.4 28v16\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".55\"/><path d=\"M26.0 36.0h48\" stroke=\"#8a6526\" stroke-width=\"1\" opacity=\".55\"/><path d=\"M14 84h72\" stroke=\"#c9a45a\" stroke-width=\"3\" stroke-linecap=\"round\"/></svg>", "ถาดทองลอยทวนน้ำ": "<svg viewBox=\"0 0 100 100\"><path d=\"M22 50h56c-2 10-14 16-28 16S24 60 22 50z\" fill=\"url(#gg)\"/><path d=\"M22 50h56\" stroke=\"#fff8e6\" stroke-width=\"1.6\"/><path d=\"M50 50c-6-10-4-20 0-26 4 6 6 16 0 26z\" fill=\"url(#gp)\"/><path d=\"M64 40l10 4-10 4\" stroke=\"url(#gg)\" stroke-width=\"2.4\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M14 70q6-5 12 0t12 0\" stroke=\"#cfe3f0\" stroke-width=\"2.4\" fill=\"none\" stroke-linecap=\"round\"/><path d=\"M38 70q6-5 12 0t12 0\" stroke=\"#cfe3f0\" stroke-width=\"2.4\" fill=\"none\" stroke-linecap=\"round\"/><path d=\"M62 70q6-5 12 0t12 0\" stroke=\"#cfe3f0\" stroke-width=\"2.4\" fill=\"none\" stroke-linecap=\"round\"/><path d=\"M26 80q6-5 12 0t12 0\" stroke=\"#cfe3f0\" stroke-width=\"2.4\" fill=\"none\" stroke-linecap=\"round\"/><path d=\"M50 80q6-5 12 0t12 0\" stroke=\"#cfe3f0\" stroke-width=\"2.4\" fill=\"none\" stroke-linecap=\"round\"/></svg>", "บัวสามเหล่า": "<svg viewBox=\"0 0 100 100\"><path d=\"M8 60h84v28H8z\" fill=\"#bfe0f0\" opacity=\".16\"/><path d=\"M10 60q4-3 8 0t8 0\" stroke=\"#bfe0f0\" stroke-width=\"1.8\" fill=\"none\" stroke-linecap=\"round\" opacity=\".9\"/><path d=\"M42 60q4-3 8 0t8 0\" stroke=\"#bfe0f0\" stroke-width=\"1.8\" fill=\"none\" stroke-linecap=\"round\" opacity=\".9\"/><path d=\"M74 60q4-3 8 0t8 0\" stroke=\"#bfe0f0\" stroke-width=\"1.8\" fill=\"none\" stroke-linecap=\"round\" opacity=\".9\"/><g transform=\"translate(24 74)\"><path d=\"M0-12C5-7 5 0 0 4-5 0-5-7 0-12z\" fill=\"url(#gp)\" opacity=\".75\"/><path d=\"M0 4V18\" stroke=\"#c9a45a\" stroke-width=\"2.4\"/></g><g transform=\"translate(50 56)\"><path d=\"M0-16C6-10 7-2 0 4-7-2-6-10 0-16z\" fill=\"url(#gp)\"/><path d=\"M0 4C-7 2-11-4-11-10-6-8-2-4 0 4zM0 4C7 2 11-4 11-10 6-8 2-4 0 4z\" fill=\"url(#gp)\" opacity=\".85\"/><path d=\"M0 4V32\" stroke=\"#c9a45a\" stroke-width=\"2.6\"/></g><g transform=\"translate(76 34)\"><path d=\"M0 6C-12 4-18-4-18-10-10-9-4-4 0 6zM0 6C12 4 18-4 18-10 10-9 4-4 0 6z\" fill=\"url(#gp)\"/><path d=\"M0 6C-7 0-9-9-6-16-2-11 0-5 0 6zM0 6C7 0 9-9 6-16 2-11 0-5 0 6z\" fill=\"url(#gp)\"/><path d=\"M0 6C-3-3-3-12 0-20 3-12 3-3 0 6z\" fill=\"#ffd3e2\"/><circle cx=\"0\" cy=\"2\" r=\"2.4\" fill=\"url(#gg)\"/><path d=\"M0 8V54\" stroke=\"#c9a45a\" stroke-width=\"2.8\"/></g><path d=\"M8 90h84\" stroke=\"#c9a45a\" stroke-width=\"3\" stroke-linecap=\"round\"/></svg>"};
  var ICON_ALIAS = {"wheel": "ธรรมจักร", "book": "คัมภีร์เปิด", "palm": "คัมภีร์ใบลาน", "bodhi": "ใบโพธิ์", "lotus": "ดอกบัวบาน", "stairs": "บันไดสู่ดอกบัว", "chedi": "พระเจดีย์", "lamp": "ประทีป", "cabinet": "ตู้พระธรรม", "khoi": "สมุดข่อย"};
  function iconSvg(k) { return ICONS[k] || ICONS[ICON_ALIAS[k]] || ICONS['ธรรมจักร']; }
  var CAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.3" r="3.4"/></svg>';
  function camBadge() { var s = el('span', 'cam'); s.innerHTML = CAM; return s; }

  // home sections as swipeable cards; site.json "sections" overrides the default list
  // home sections: stored in site.json "sections"; defaults until an admin saves
  function defaultSections() {
    return [
      { id: 'rooms', href: '#rooms', title: DATA.roomsHeading, sub: DATA.roomsSub || 'เลือกห้องตามระดับวิชชา', icon: 'บัวสามเหล่า' },
      { id: 'buddhavacana', title: 'พุทธวจน', icon: 'คัมภีร์เปิด', items: [] },
      { id: 'bodhipakkhiya', title: 'โพธิปักขยิกธรรม', icon: 'ธรรมจักร', items: [] },
      { id: 'explain', title: 'อธิบายตามธรรม', icon: 'ดอกบัวบาน', items: [] }
    ];
  }
  function sections() {
    if (!DATA.sections) DATA.sections = defaultSections();
    return DATA.sections;
  }
  function medal(s) {
    var m = el('span', 'med');
    if (s.image) { var im = el('img'); im.src = s.image; im.alt = ''; m.appendChild(im); m.classList.add('pic'); }
    else m.innerHTML = iconSvg(s.icon);
    return m;
  }
  function renderSections() {
    var list = sections();
    var box = $('secs'), dots = $('secdots');
    box.innerHTML = ''; dots.innerHTML = '';
    list.forEach(function (s, i) {
      var a = el('a', 'sec4');
      a.href = s.href || ('#s' + (i + 1));
      a.appendChild(medal(s));
      a.appendChild(el('b', null, s.title));
      if (s.sub) a.appendChild(el('small', null, s.sub));
      box.appendChild(a);
      dots.appendChild(el('i', i ? null : 'on'));
    });
    if (ADMIN) {
      var add = el('button', 'sec4 addsec', '+ เพิ่มหมวด');
      add.type = 'button';
      add.onclick = function () { sectionForm(null); };
      box.appendChild(add);
    } else if (API) {
      // members: suggest a new องค์ธรรม from the last card of the row
      var sg = el('button', 'sec4 addsec suggestcard', '+ เสนอเพิ่มองค์ธรรม');
      sg.type = 'button';
      sg.onclick = function () { curRoom = -1; suggestAdd({ kind: 'room' }); };
      box.appendChild(sg);
    }
    dots.hidden = list.length < 2;
    box.onscroll = function () {
      var w = box.firstChild ? box.firstChild.offsetWidth + 12 : 1;
      var k = Math.round(box.scrollLeft / w);
      if (box.scrollLeft + box.clientWidth >= box.scrollWidth - 4) k = list.length - 1;
      Array.prototype.forEach.call(dots.children, function (d, x) { d.className = x === k ? 'on' : ''; });
    };
  }
  function sectionForm(s) {
    var opts = Object.keys(ICONS).map(function (k) { return { value: k, label: k }; });
    if (s && s.image) opts.unshift({ value: '__img', label: 'รูปที่อัปโหลดไว้' });
    var cur = s ? (s.image ? '__img' : (ICONS[s.icon] ? s.icon : ICON_ALIAS[s.icon] || s.icon)) : 'ดอกบัวบาน';
    var f = [
      { label: 'ชื่อหมวด', value: s ? s.title : '' },
      { label: 'คำอธิบายใต้ชื่อ (ไม่ใส่ก็ได้)', value: s ? s.sub || '' : '' },
      { label: 'สัญลักษณ์บนการ์ด', options: opts, value: cur }
    ];
    // ตำแหน่งของการ์ดในแถวหน้าแรก (ลำดับที่ ๑ = ซ้ายสุด)
    var all = sections(), nPos = all.length + (s ? 0 : 1), pos = [];
    for (var q = 0; q < nPos; q++) pos.push({ value: String(q), label: 'ลำดับที่ ' + th(q + 1) + (q === 0 ? ' (ซ้ายสุด)' : q === nPos - 1 ? ' (ขวาสุด)' : '') });
    f.push({ label: 'ตำแหน่งการ์ด', options: pos, value: String(s ? all.indexOf(s) : nPos - 1) });
    var canDel = s && s.id !== 'rooms';
    ask(s ? 'แก้ไขหมวด' : 'เพิ่มหมวดใหม่', f, function (v) {
      var list = sections();
      if (v.del && canDel) {
        list.splice(list.indexOf(s), 1);
        location.hash = '';
        renderSections();
        saveData('ลบหมวด ' + s.title);
        return;
      }
      if (!v[0].trim()) return;
      var o = s || { id: 'sec' + Date.now(), items: [] };
      o.title = v[0].trim();
      if (v[1].trim()) o.sub = v[1].trim(); else delete o.sub;
      if (v[2] !== '__img') { o.icon = v[2]; delete o.image; }
      if (s) list.splice(list.indexOf(s), 1);
      list.splice(Math.min(+v[3] || 0, list.length), 0, o);
      if (o.id === 'rooms') { DATA.roomsHeading = o.title; DATA.roomsSub = o.sub || ''; $('roomsHeading').textContent = o.title; $('roomsSub').textContent = o.sub || ''; }
      renderSections();
      route();
      saveData((s ? 'แก้หมวด ' : 'เพิ่มหมวด ') + o.title);
    }, 'บันทึก', canDel ? 'ลบหมวดนี้ทั้งหมวด' : null);
  }
  function sectionPhoto(s) {
    pickPhoto(function (path, preview) {
      s.image = path;
      renderSections();
      route();
      saveData('เปลี่ยนรูปการ์ด ' + s.title);
    });
  }
  // รูปพื้นหลังด้านบนของหน้าการ์ด (แอดมินตั้งได้ แบบเดียวกับหัวห้องเรียน)
  function applyCover(node, s) {
    var on = !!(s && s.cover);
    node.classList.toggle('hascover', on);
    node.style.backgroundImage = on ? 'linear-gradient(180deg,rgba(0,0,0,.18),rgba(0,0,0,.58)),url("' + String(s.cover).replace(/"/g, '%22') + '")' : '';
  }
  function coverButtons(s, setId, delId) {
    $(setId).hidden = !ADMIN;
    $(delId).hidden = !ADMIN || !s.cover;
    $(setId).onclick = function () {
      pickPhoto(function (path, preview) { s.cover = path; route(); var hd = $(setId).closest('.sechead'); applyCover(hd, { cover: preview }); saveData('เปลี่ยนรูปพื้นหลังด้านบน ' + s.title); }, 1200);
    };
    $(delId).onclick = function () { delete s.cover; route(); saveData('เอารูปพื้นหลังด้านบนออก ' + s.title); };
  }
  // ภาพรวมของหมวด: plain text the admin pastes in
  //   = หัวเรื่องใหญ่      # หัวข้อกลุ่ม      > หมายเหตุใต้หัวข้อ      ## กลุ่มย่อย
  //   รายการ | คำอธิบาย   (ต่อท้ายด้วย  -> #ลิงก์  เพื่อให้กดไปยังองค์ธรรมนั้นได้)
  // "๑. ข้อความ" → gold number + text
  function numbered(node, t) {
    var m = /^([๐-๙0-9]+\.)\s*(.*)$/.exec(t);
    if (m) { node.appendChild(el('span', 'ovn', m[1])); node.appendChild(document.createTextNode(m[2])); }
    else node.textContent = t;
    return node;
  }
  function overviewText(t) {
    return String(t || '').split('\n').map(function (l) {
      return l.replace(/^(===|==|=|##|#|>)\s?/, '').replace(/\s*->\s*#\S+\s*$/, '').replace(/\s*\|\s*/, ' – ');
    }).join('\n');
  }
  function renderOverview(box, text, onSave) {
    box.innerHTML = '';
    box.classList.add('v');
    var card = null, list = null, L = String(text || '').split('\n'), cards = [], blank = false;
    L.forEach(function (raw, li) {
      var t = raw.trim();
      if (card && t && t.indexOf('# ') !== 0 && t.indexOf('=== ') !== 0) card._last = li;
      if (!t) { blank = true; return; }
      var gap = blank; blank = false;
      if (t.indexOf('=== ') === 0) { box.appendChild(el('div', 'ovtotal', t.slice(4))); card = null; return; }
      if (t.indexOf('== ') === 0) { box.appendChild(el('p', 'ovlead' + (t.length > 45 ? ' long' : ''), t.slice(3))); return; }
      if (t.indexOf('= ') === 0) { box.appendChild(el('h2', 'ovtitle', t.slice(2))); return; }
      if (t.indexOf('# ') === 0) {
        var gm = /^([๐-๙0-9]+)\.\s*(.*)$/.exec(t.slice(2));
        card = el('div', 'ovcard'); card._head = li; card._last = li; cards.push(card); card.appendChild(el('span', 'ovmed', gm ? gm[1] : ''));
        var hd = el('h3'); if (gm) hd.appendChild(el('span', 'ovgn', gm[1] + '.')); hd.appendChild(document.createTextNode(gm ? gm[2] : t.slice(2))); card.appendChild(hd); box.appendChild(card); list = null;
        hd.onclick = (function (c) { return function () { c.classList.toggle('open'); }; })(card);
        return;
      }
      if (!card) { card = el('div', 'ovcard'); box.appendChild(card); }
      if (t === '❖') { var dv = el('div', 'ovdiv', '❖'); dv._line = li; card.appendChild(dv); return; }
      // a note after the ข้อ of a card is its summary line: centred, with a mark at each end
      if (t.indexOf('> ') === 0) { var nt = el('p', 'ovnote' + (list ? ' sum' : '') + (gap ? ' gap' : ''), t.slice(2)); nt._line = li; card.appendChild(nt); return; }
      if (t.indexOf('## ') === 0) { var sb = el('div', 'ovsub', t.slice(3)); sb._line = li; card.appendChild(sb); list = null; return; }
      // a plain line (no เลขข้อ, no "|", no link) is just text: shown as written, one line under another
      if (!/^[๐-๙0-9]+\./.test(t) && t.indexOf('|') < 0 && !/->\s*#\S+\s*$/.test(t)) {
        var pl = el('p', 'ovnote ovline' + (gap ? ' gap' : ''), t); pl._line = li; card.appendChild(pl); return;
      }
      var link = '', m = /\s*->\s*(#\S+)\s*$/.exec(t);
      if (m) { link = m[1]; t = t.slice(0, m.index); }
      var parts = t.split('|'), row = el(link ? 'a' : 'div', 'ovitem');
      if (link) row.href = link;
      var tx = el('span', 'ovtx');
      tx.appendChild(numbered(el('b'), parts[0].trim()));
      if (parts[1]) tx.appendChild(el('small', null, parts.slice(1).join('|').trim()));
      row.appendChild(tx);
      if (link) row.appendChild(el('span', 'arrow', '›'));
      if (!list) { list = el('div', 'ovlist'); card.appendChild(list); }
      row._line = li;
      list.appendChild(row);
    });
    // a card of plain lines only (a พระสูตร written line by line) reads centred, like a chant;
    // a line with only ❖ divides it, and a short last line closes it
    box.querySelectorAll('.ovcard').forEach(function (c) {
      if (c.querySelector('.ovlist') || c.querySelectorAll('.ovline').length < 2) return;
      c.classList.add('verse');
      var last = c.lastElementChild;
      if (last && last.classList.contains('ovline') && last.textContent.trim().length <= 15) last.classList.add('end');
    });
    if (onSave && ADMIN) ovAdmin(box, L, cards, onSave);
    // groups with short items sit two-by-two; long ones take the full width
    box.querySelectorAll('.ovcard').forEach(function (c) {
      var longest = 0;
      c.querySelectorAll('.ovtx b').forEach(function (x) { longest = Math.max(longest, x.textContent.length); });
      var desc = 0; c.querySelectorAll('.ovtx small, .ovnote').forEach(function (x) { desc = Math.max(desc, x.textContent.length); });
      if (longest > 13 || desc > 20) c.classList.add('full');
    });
    // a half-width card left without a partner beside it takes the full width too
    var waiting = null;
    Array.prototype.forEach.call(box.children, function (c) {
      var half = c.classList.contains('ovcard') && !c.classList.contains('full');
      if (half) { if (waiting) waiting = null; else waiting = c; }
      else if (waiting) { waiting.classList.add('full'); waiting = null; }
    });
    if (waiting) waiting.classList.add('full');
    // short lists without descriptions show as compact chips
    box.querySelectorAll('.ovlist').forEach(function (l) { if (!l.querySelector('small') && !l.querySelector('.ovn') && l.textContent.length / l.children.length < 22) l.classList.add('chips'); });
  }
  // admin: tap a ข้อ in the แผนผัง to edit its คำอธิบาย only (the ข้อ and หมวด themselves are fixed)
  function ovAdmin(box, L, cards, onSave) {
    function save(msg) { onSave(L.filter(function (x) { return x !== null; }).join('\n'), msg); }
    function splitLine(t) {
      var link = '', m = /\s*->\s*(#\S+)\s*$/.exec(t); if (m) { link = m[1]; t = t.slice(0, m.index); }
      var parts = t.split('|'), head = parts[0].trim(), n = /^([๐-๙0-9]+\.)\s*(.*)$/.exec(head);
      return { num: n ? n[1] : '', name: n ? n[2] : head, desc: parts.slice(1).join('|').trim(), link: link };
    }
    function joinLine(o) { return (o.num ? o.num + ' ' : '') + o.name + (o.desc ? ' | ' + o.desc : '') + (o.link ? ' -> ' + o.link : ''); }
    cards.forEach(function (c) {
      c.classList.add('ovedit');
      // the small line under a หมวด name (e.g. หรือสัมมาวายามะ) and the กลุ่มย่อย labels
      c.querySelectorAll('.ovnote, .ovsub').forEach(function (n) {
        n.onclick = function () {
          // a plain line (บรรทัดข้อความธรรมดา) has no mark in front: keep it that way
          var line = n.classList.contains('ovline'), note = n.classList.contains('ovnote'), mark = line ? '' : note ? '> ' : '## ';
          ask(line ? 'แก้ไขบรรทัดนี้' : note ? 'แก้ไขข้อความใต้ชื่อหมวด' : 'แก้ไขชื่อกลุ่มย่อย', [{ label: 'ข้อความ', value: L[n._line].trim().slice(mark.length) }], function (v) {
            if (!v[0].trim()) return;
            L[n._line] = mark + v[0].trim(); save('แก้ข้อความในแผนผัง');
          });
        };
      });
      c.querySelectorAll('.ovitem').forEach(function (row) {
        row.onclick = function (e) {
          e.preventDefault();
          var o = splitLine(L[row._line].trim());
          ask((o.num ? o.num + ' ' : '') + o.name, [{ label: 'คำอธิบาย', multiline: true, rows: 4, value: o.desc }], function (v) {
            o.desc = v[0].trim().replace(/\n+/g, ' ');
            L[row._line] = joinLine(o); save('แก้คำอธิบาย ' + o.name);
          });
        };
      });
    });
  }
  function openSection(si) {
    var s = sections()[si];
    if (!s || s.href) return openHome();
    $('brand').textContent = '';
    $('secTitle').textContent = s.title;
    $('secSub').textContent = s.sub || '';
    $('secSub').hidden = !s.sub;
    var m = $('secMed'); m.innerHTML = ''; m.appendChild(medal(s));
    var l = $('slist2');
    l.innerHTML = '';
    var items = s.items || [];
    $('secCount').textContent = 'หัวข้อในหมวดนี้ (' + th(items.length) + ')';
    if (!items.length) l.appendChild(el('div', 'empty', 'ยังไม่มีเนื้อหาในหมวดนี้'));
    // each topic is a card like the classroom list; tap to open its detail
    items.forEach(function (it, k) {
      var a = el('a', 'step');
      a.href = '#s' + (si + 1) + 'n' + (k + 1);
      var n = el('span', 'sno');
      n.appendChild(el('span', null, th(k + 1)));
      a.appendChild(n);
      var st = el('span', 'st');
      st.appendChild(el('b', null, it.title || firstLine(it.text || '')));
      if (it.sub) st.appendChild(el('small', null, it.sub));
      a.appendChild(st);
      a.appendChild(el('span', 'arrow', '›'));
      l.appendChild(a);
    });
    $('secAdmin').hidden = !ADMIN;
    $('addItem').hidden = !ADMIN;
    $('addItem').onclick = function () { itemForm(s, null); };
    curSec = si;
    $('suggestItem').hidden = ADMIN || !API;
    $('editSec').onclick = function () { sectionForm(s); };
    $('secPhoto').onclick = function () { sectionPhoto(s); };
    applyCover($('secHead'), s);
    $('secOv').hidden = !s.overview;
    renderOverview($('secOv'), s.overview);
    $('editOv').hidden = !ADMIN;
    $('editOv').textContent = s.overview ? 'แก้ไขภาพรวม' : '+ เพิ่มภาพรวม';
    $('editOv').onclick = function () {
      ask('ภาพรวมของหมวด', [{ label: 'วางข้อความภาพรวม (= หัวเรื่อง, # หัวข้อ, ## กลุ่มย่อย, รายการ | คำอธิบาย)', multiline: true, value: s.overview || '' }], function (v) {
        if (v[0].trim()) s.overview = v[0]; else delete s.overview;
        route();
        saveData('แก้ภาพรวม ' + s.title);
      });
    };
    coverButtons(s, 'secCover', 'secCoverDel');
    show('sectionv');
  }
  // the line under a แผนผัง title ("== …") and the topic's คำอธิบายใต้ชื่อ (sub) show the same words
  function ovLead(t) { var m = /^== (.*)$/m.exec(t || ''); return m ? m[1].trim() : ''; }
  function setOvLead(t, lead) {
    var L = String(t).split('\n'), i = L.findIndex(function (x) { return /^== /.test(x); });
    if (i >= 0) L[i] = '== ' + lead;
    else { var j = L.findIndex(function (x) { return /^= /.test(x); }); L.splice(j + 1, 0, '== ' + lead); }
    return L.join('\n');
  }
  function ovShown(it) { return it.sub ? setOvLead(it.overview, it.sub) : it.overview; }
  function itemForm(s, it) {
    if (it && it.overview) {
      // a แผนผัง topic: title, short line under it, and the diagram text
      return ask('แก้ไขแผนผัง', [
        { label: 'ชื่อหัวข้อ', value: it.title || '' },
        { label: 'คำอธิบายสั้นใต้ชื่อ', value: it.sub || '' },
        { label: 'ข้อความแผนผัง', multiline: true, value: it.overview }
      ], function (v) {
        if (v.del) { s.items.splice(s.items.indexOf(it), 1); history.back(); saveData('ลบหัวข้อใน ' + s.title); return; }
        if (!v[2].trim()) return;
        var oldSub = it.sub || '', oldLead = ovLead(it.overview), newLead = ovLead(v[2]);
        it.title = v[0].trim() || it.title; if (v[1].trim()) it.sub = v[1].trim(); else delete it.sub; it.overview = v[2];
        // คำอธิบายใต้ชื่อ กับบรรทัด == ในแผนผัง เป็นข้อความเดียวกัน: ช่องไหนถูกแก้ ใช้ช่องนั้น
        if ((it.sub || '') !== oldSub && it.sub) it.overview = setOvLead(it.overview, it.sub);
        else if (newLead !== oldLead && newLead) it.sub = newLead;
        route();
        saveData('แก้แผนผังใน ' + s.title);
      }, 'บันทึก', 'ลบหัวข้อนี้');
    }
    ask(it ? 'แก้ไขเนื้อหา' : 'เพิ่มเนื้อหาใน ' + s.title, [{ label: 'วางข้อความจากโน้ต LINE ทั้งหมด', multiline: true, value: it ? it.text : '' }], function (v) {
      if (v.del && it) {
        s.items.splice(s.items.indexOf(it), 1);
        history.back();
        saveData('ลบเนื้อหาใน ' + s.title);
        return;
      }
      if (!v[0].trim()) return;
      if (it) { it.text = v[0]; it.title = firstLine(v[0]); }
      else (s.items = s.items || []).push({ title: firstLine(v[0]), text: v[0] });
      route();
      saveData((it ? 'แก้' : 'เพิ่ม') + 'เนื้อหาใน ' + s.title);
    }, 'บันทึก', it ? 'ลบเนื้อหานี้' : null);
  }
  var curItem = null;
  function openItem(si, k) {
    var s = sections()[si], it = s && s.items && s.items[k];
    if (!it) return openSection(si);
    curItem = { s: s, it: it }; CTX = { kind: 'sec', s: s, k: k, it: it };
    $('brand').textContent = '';
    $('crumb').textContent = s.title;
    if (it.overview) {
      // a diagram topic: draw the แผนผัง; copy / LINE get it as plain lines
      current = { text: overviewText(ovShown(it)) };
      var tb = $('text'); tb.innerHTML = ''; tb.classList.add('hasov'); var ov = el('section', 'ov'); tb.appendChild(ov);
      renderOverview(ov, ovShown(it), function (nt, msg) { it.overview = nt; var y = window.scrollY; route(); window.scrollTo(0, y); saveData(msg + ' · ' + (it.title || s.title)); });
      $('editNote').textContent = 'แก้ไขข้อความทั้งแผนผัง';
    } else {
      current = it;
      $('editNote').textContent = 'แก้ไขหัวข้อนี้';
      $('text').classList.remove('hasov');
      showText($('text'), it.text);
    }
    $('share').href = 'https://line.me/R/share?text=' + encodeURIComponent(current.text);
    $('toast').textContent = '';
    show('readv');
    document.documentElement.classList.add('on-rec', 'on-sec');
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
    a.appendChild(el('span', 'nn', th(ni + 1) + '.'));
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
    ['home', 'loginv', 'roomsv', 'roomv', 'readv', 'pendingv', 'settingsv', 'personv', 'sectionv'].forEach(function (x) { $(x).hidden = x !== v; });
    $('back').hidden = v === 'home';
    document.documentElement.classList.toggle('on-read', v === 'readv');
    document.documentElement.classList.toggle('on-home', v === 'home');
    document.documentElement.classList.toggle('on-rooms', v === 'roomsv' || v === 'roomv');
    document.documentElement.classList.toggle('on-person', v === 'personv');
    document.documentElement.classList.toggle('on-section', v === 'sectionv');
    $('amenu').hidden = true;
    window.scrollTo(0, 0);
  }

  // ---------- attainment records of one teacher ----------
  var MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  var DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  function thDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return { day: th(+m[3]), month: MONTHS[+m[2] - 1], year: th(+m[1] + 543), wd: 'วัน' + DAYS[d.getDay()] };
  }
  function getPerson(ri, pi) { var r = DATA.ratana[ri]; return r && r.people && r.people[pi]; }
  function sortedRecords(p) {
    return (p.records || []).map(function (x, k) { return { x: x, k: k }; }).sort(function (a, b) { return (a.x.date || '') > (b.x.date || '') ? -1 : (a.x.date || '') < (b.x.date || '') ? 1 : b.k - a.k; });
  }
  function bioOnly(p) { return p.bioOnly != null ? !!p.bioOnly : !!p.role; }
  function openPerson(ri, pi) {
    var p = getPerson(ri, pi);
    if (!p) return openHome();
    $('brand').textContent = '';
    var head = $('pphead');
    head.innerHTML = '';
    head.appendChild(photo(p.photo, p.name, null));
    head.appendChild(words('pname', p.name));
    var sub = [DATA.ratana[ri].label, p.status || p.role].filter(Boolean).join(' · ');
    if (sub || p.order) {
      var ps = sub ? words('psub', sub) : el('div', 'psub');
      if (p.order) { ps.appendChild(document.createTextNode(' ')); ps.appendChild(el('span', 'nw', p.order)); }
      head.appendChild(ps);
    }
    // ชีวประวัติย่อ: ทุกท่านมีส่วนนี้ แอดมินเพิ่ม/แก้ได้
    var bio = $('pbio');
    bio.hidden = false;
    $('pbioText').textContent = p.bio || '';
    $('pbioText').hidden = !p.bio;
    $('pbioEmpty').hidden = !!p.bio;
    $('editBio').hidden = !ADMIN;
    $('editBio').textContent = p.bio ? 'แก้ไขชีวประวัติย่อ' : '+ เพิ่มชีวประวัติย่อ';
    $('editBio').onclick = function () {
      ask('ชีวประวัติย่อ', [{ label: 'ข้อความ (วัน เดือน ปีเกิด และประวัติ)', multiline: true, value: p.bio || '' }], function (v) {
        if (v[0].trim()) p.bio = v[0]; else delete p.bio;
        route();
        saveData('แก้ชีวประวัติย่อ ' + p.name);
      });
    };
    // ผู้แสดงธรรม (ท่านที่มีตำแหน่ง role) มีเฉพาะชีวประวัติ เว้นแต่แอดมินเปิดส่วนบันทึกไว้
    var only = bioOnly(p);
    $('precs').hidden = only;
    var tg = $('bioOnlyBtn');
    tg.hidden = !ADMIN;
    tg.textContent = only ? 'แสดงส่วนบันทึกการบรรลุธรรมของท่านนี้' : 'ท่านนี้มีเฉพาะชีวประวัติ (ซ่อนบันทึกการบรรลุธรรม)';
    tg.onclick = function () {
      p.bioOnly = !only;
      route();
      saveData((p.bioOnly ? 'ตั้งให้มีเฉพาะชีวประวัติ ' : 'แสดงบันทึกการบรรลุธรรม ') + p.name);
    };
    var list = $('plist2');
    list.innerHTML = '';
    var recs = sortedRecords(p);
    $('ptitle').textContent = 'บันทึกการบรรลุธรรม (' + th(recs.length) + ')';
    if (!recs.length) list.appendChild(el('div', 'empty', 'ยังไม่มีบันทึกการบรรลุธรรม'));
    recs.forEach(function (o, i) {
      var a = el('a', 'rec');
      a.href = '#p' + (ri + 1) + '-' + (pi + 1) + 'r' + (o.k + 1);
      var dt = thDate(o.x.date), box = el('span', 'rdate');
      if (dt) { box.appendChild(el('b', null, dt.day)); box.appendChild(el('span', null, dt.month)); box.appendChild(el('span', 'ry', dt.year)); }
      else box.appendChild(el('b', null, th(i + 1)));
      a.appendChild(box);
      var tx = el('span', 'rtx');
      if (dt) tx.appendChild(el('small', null, dt.wd));
      tx.appendChild(el('span', 'rt' + (o.x.title ? ' full' : ''), o.x.title || firstLine(o.x.text)));
      a.appendChild(tx);
      a.appendChild(el('span', 'arrow', '›'));
      list.appendChild(a);
    });
    $('addRec').hidden = !ADMIN;
    curPerson = p;
    $('suggestRec').hidden = ADMIN || !API;
    $('addRec').onclick = function () { recordForm(p, null); };
    show('personv');
  }
  function recordForm(p, rec) {
    ask(rec ? 'แก้ไขบันทึกการบรรลุธรรม' : 'เพิ่มบันทึกการบรรลุธรรม', [
      { label: 'วันที่บรรลุธรรม', type: 'date', value: rec ? rec.date : '' },
      { label: 'วิชชาที่บรรลุ (แสดงในรายการ)', multiline: true, rows: 3, value: rec ? rec.title || '' : '' },
      { label: 'ข้อความเต็ม (วางจากโน้ต LINE ทั้งหมด)', multiline: true, value: rec ? rec.text : '' }
    ], function (v) {
      if (v.del && rec) {
        p.records.splice(p.records.indexOf(rec), 1);
        history.back();
        saveData('ลบบันทึกการบรรลุธรรม ' + p.name);
        return;
      }
      if (!v[2].trim()) return;
      var o = rec || {};
      o.date = v[0]; o.text = v[2];
      if (v[1].trim()) o.title = v[1]; else delete o.title;
      if (!rec) (p.records = p.records || []).push(o);
      route();
      saveData((rec ? 'แก้' : 'เพิ่ม') + 'บันทึกการบรรลุธรรม ' + p.name);
    }, 'บันทึก', rec ? 'ลบบันทึกนี้' : null);
  }
  function openRecord(ri, pi, k) {
    var p = getPerson(ri, pi), rec = p && p.records && p.records[k];
    if (!rec) return openPerson(ri, pi);
    current = rec; curRecord = { p: p, rec: rec }; CTX = { kind: 'rec', p: p, k: k }; $('editNote').textContent = 'แก้ไขบันทึกนี้';
    $('brand').textContent = '';
    var dt = thDate(rec.date);
    $('crumb').textContent = p.name + (dt ? ' · ' + dt.wd + 'ที่ ' + dt.day + ' ' + dt.month + ' ' + dt.year : '');
    showText($('text'), rec.text);
    $('share').href = 'https://line.me/R/share?text=' + encodeURIComponent(rec.text);
    $('toast').textContent = '';
    show('readv');
    document.documentElement.classList.add('on-rec');
  }
  var curRecord = null;

  function openHome() {
    $('brand').textContent = DATA.siteTitle;
    show('home');
  }

  function openRooms() {
    $('brand').textContent = '';
    $('editRoomsCard').hidden = !ADMIN;
    $('editRoomsCard').onclick = function () { var s = sections().filter(function (x) { return x.id === 'rooms'; })[0]; if (s) sectionForm(s); };
    $('roomsCardPhoto').hidden = !ADMIN;
    $('roomsCardPhoto').onclick = function () { var s = sections().filter(function (x) { return x.id === 'rooms'; })[0]; if (s) sectionPhoto(s); };
    var rs = sections().filter(function (x) { return x.id === 'rooms'; })[0];
    var rm = $('roomsMed'); rm.innerHTML = ''; if (rs) rm.appendChild(medal(rs));
    applyCover($('roomsHead'), rs);
    if (rs) coverButtons(rs, 'roomsCover', 'roomsCoverDel');
    renderRooms();
    $('suggestRooms').hidden = ADMIN || !API;
    show('roomsv');
  }

  function openRoom(ri) {
    var r = DATA.rooms[ri];
    if (!r) return openRooms();
    curRoom = ri;
    $('suggestNote').hidden = ADMIN || !API;
    $('brand').textContent = '';
    $('rk').textContent = 'ห้องที่ ' + r.no;
    $('rh').textContent = r.title;
    $('rdesc').hidden = !r.desc;
    var dt = $('rdescText');
    dt.innerHTML = '';
    // each line exactly as typed; blank lines become a small gap instead of a full empty line
    (r.desc || '').split('\n').forEach(function (ln) {
      dt.appendChild(ln.trim() ? el('span', null, ln) : el('span', 'gap'));
    });
    roomPhoto(r);
    $('rc').textContent = 'องค์ธรรมในห้องนี้ (' + th(r.notes.length) + ')';
    var l = $('nlist');
    l.innerHTML = '';
    if (!r.notes.length) l.appendChild(el('div', 'empty', 'ยังไม่มีองค์ธรรมในห้องนี้'));
    r.notes.forEach(function (n, ni) { l.appendChild(noteLink(ri, ni, n.title)); });
    show('roomv');
  }

  // room header photo: the room's own image, or the lotus photo until an admin picks one
  function roomPhoto(r) {
    var h = $('roomhead');
    h.style.backgroundImage = 'linear-gradient(rgba(23,54,33,.72),rgba(23,54,33,.08) 35%,rgba(23,54,33,.08) 50%,rgba(23,54,33,.95)),url("' + (r.image || DATA.roomImage || 'images/room.jpg') + '")';
    h.classList.remove('deflt');
    var b = $('roomPhotoBtn');
    b.hidden = !ADMIN;
    b.onclick = function () {
      pickPhoto(function (path, preview) {
        r.image = path;
        roomPhoto(r);
        h.style.backgroundImage = h.style.backgroundImage.replace(/url\("[^"]*"\)$/, 'url("' + preview + '")');
        saveData('เปลี่ยนรูปห้อง ' + r.no);
      }, 1200);
    };
  }

  function openNote(ri, ni) {
    var r = DATA.rooms[ri];
    var n = r && r.notes[ni];
    if (!n) return openRoom(ri);
    current = n; curRoom = ri; curNote = ni; CTX = { kind: 'room' }; $('editNote').textContent = 'แก้ไของค์ธรรมนี้';
    $('brand').textContent = '';
    $('crumb').textContent = 'ห้องที่ ' + r.no + ' · ' + r.title;
    showText($('text'), n.text);
    $('share').href = 'https://line.me/R/share?text=' + encodeURIComponent(n.text);
    $('toast').textContent = '';
    show('readv');
  }

  // remember where each page was scrolled to, so going back returns to the same spot
  var SCROLLS = {}, STACK = [location.hash];
  function onHash() {
    var h = location.hash, top = STACK[STACK.length - 1];
    if (h === top) return route();
    SCROLLS[top] = window.scrollY;
    var back = STACK.length > 1 && STACK[STACK.length - 2] === h;
    if (back) STACK.pop(); else STACK.push(h);
    route();
    if (back && SCROLLS[h] != null) {
      var y = SCROLLS[h];
      window.scrollTo(0, y);
      requestAnimationFrame(function () { window.scrollTo(0, y); });
      setTimeout(function () { window.scrollTo(0, y); }, 150);
    }
  }
  function saved(h) { return SCROLLS[h] != null && STACK.length > 1 && STACK[STACK.length - 2] === h; }

  function route() {
    var h = location.hash.replace('#', '');
    if (h === 'rooms') return openRooms();
    if (h === 'admin' || h === 'login') return openLogin(h === 'admin' ? 'admin' : 'member');
    if (h === 'pending' && ADMIN) return openPending();
    if (h === 'settings' && ADMIN) return openSettings();
    var pm = /^p(\d+)-(\d+)(?:r(\d+))?$/.exec(h);
    document.documentElement.classList.remove('on-rec', 'on-sec');
    var sm = /^s(\d+)(?:n(\d+))?$/.exec(h);
    if (sm) return sm[2] ? openItem(+sm[1] - 1, +sm[2] - 1) : openSection(+sm[1] - 1);
    if (pm) return pm[3] ? openRecord(+pm[1] - 1, +pm[2] - 1, +pm[3] - 1) : openPerson(+pm[1] - 1, +pm[2] - 1);
    var m = /^r(\d+)(?:n(\d+))?$/.exec(h);
    if (!m) return openHome();
    var ri = +m[1] - 1;
    if (m[2]) openNote(ri, +m[2] - 1); else openRoom(ri);
  }

  // ---------- reader actions ----------
  $('back').addEventListener('click', function () {
    var h = location.hash;
    var m = /^#r(\d+)n\d+$/.exec(h);
    var sr = /^#(s\d+)n\d+$/.exec(h);
    if (sr) { location.hash = sr[1]; return; }
    if (/^#s\d+$/.test(h)) { if (saved('')) { location.hash = ''; return; } location.hash = ''; setTimeout(function () { var t = $('secs'); if (t) t.scrollIntoView({ block: 'center' }); }, 50); return; }
    var pr = /^#(p\d+-\d+)r\d+$/.exec(h);
    if (pr) location.hash = pr[1];
    else if (/^#p\d+-\d+$/.test(h)) { if (saved('')) { location.hash = ''; return; } location.hash = ''; setTimeout(function () { var t = document.querySelector('.ratana'); if (t) t.scrollIntoView(); }, 50); }
    else if (m) location.hash = 'r' + m[1];
    else if (/^#r\d+$/.test(h)) location.hash = 'rooms';
    else if (h === '#settings') location.hash = 'pending';
    else { history.replaceState(null, '', location.pathname); onHash(); }
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

  // ---------- members: propose (shared 4-digit member code) ----------
  var MEMBER = !!store('team_code') && !!store('member_name');
  function roomOptions() {
    return DATA.rooms.map(function (r, i) { return { value: String(i + 1), label: 'ห้องที่ ' + r.no + ' · ' + r.title }; });
  }
  // proposal target: a room (number), a หมวด ("s:<id>") or a teacher's records ("p:<name>")
  // where a new องค์ธรรม can go: any room or any หมวด (value "r:N" or "s:<id>")
  function placeOptions() {
    var o = DATA.rooms.map(function (r, i) { return { value: 'r:' + (i + 1), label: 'ห้องที่ ' + r.no + ' · ' + r.title }; });
    sections().forEach(function (x) { if (!x.href) o.push({ value: 's:' + x.id, label: 'หมวด ' + x.title }); });
    return o;
  }
  function proposeForm(kind) {
    var f = [], pick = kind === 'add' && CTX.kind !== 'rec';
    if (pick) {
      var def = CTX.kind === 'sec' ? 's:' + CTX.s.id : 'r:' + ((curRoom >= 0 ? curRoom : 0) + 1);
      f.push({ label: 'เสนอเพิ่มใน', options: placeOptions(), value: def });
    }
    var editText = kind !== 'edit' ? '' : (CTX.kind === 'sec' && CTX.it && CTX.it.overview ? CTX.it.overview : (current && current.text) || '');
    f.push({ label: kind === 'add' ? 'วางข้อความจากโน้ต LINE ทั้งหมด' : 'ข้อความที่เสนอแก้ (แก้ในช่องนี้ได้เลย)', multiline: true, value: editText });
    var what = CTX.kind === 'rec' ? 'บันทึก' : CTX.kind === 'sec' && kind === 'edit' ? 'หัวข้อ' : 'องค์ธรรม';
    ask(kind === 'add' ? 'เสนอเพิ่ม' + what + 'ใหม่' : 'เสนอแก้ไข' + what + 'นี้', f, function (v, err) {
      var text = pick ? v[1] : v[0], room;
      if (pick) room = v[0].indexOf('r:') === 0 ? +v[0].slice(2) : v[0];
      else room = CTX.kind === 'sec' ? 's:' + CTX.s.id : CTX.kind === 'rec' ? 'p:' + CTX.p.name : curRoom + 1;
      var noteNo = kind === 'add' ? 0 : CTX.kind === 'sec' || CTX.kind === 'rec' ? CTX.k + 1 : curNote + 1;
      if (!text.trim()) { err('กรุณาวางข้อความ'); return true; }
      err('กำลังส่ง…');
      // Google Sheets reads a cell that starts with = + - @ as a formula (#ERROR!); a leading ' keeps it as plain text and is not stored
      var sendText = /^[=+\-@']/.test(text) ? "'" + text : text;
      call('propose', { teamCode: store('team_code'), type: kind, room: room, note: noteNo, text: sendText, name: store('member_name') })
        .then(function () { $('dlg').close(); $('toast').textContent = 'ส่งข้อเสนอแล้ว รอแอดมินอนุมัติก่อนขึ้นเว็บ'; status('ส่งข้อเสนอแล้ว รอแอดมินอนุมัติก่อนขึ้นเว็บ', 'ok'); })
        .catch(function (e) {
          if (e.message === 'bad_team_code') { memberLogout(); err('รหัสสมาชิกเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่'); }
          else err('ส่งไม่สำเร็จ ลองกดอีกครั้ง');
        });
      return true;
    }, 'ส่งข้อเสนอ');
  }
  // members suggest a new องค์ธรรม / หัวข้อ straight from a room or หมวด page
  function suggestAdd(ctx) {
    if (!MEMBER) { store('after_login', location.hash); location.hash = 'login'; return; }
    CTX = ctx;
    proposeForm('add');
  }
  $('suggestNote').addEventListener('click', function () { suggestAdd({ kind: 'room' }); });
  // members suggest a whole new ห้อง from the ห้องเรียน page (goes to the backend as "n:<เลขห้อง>")
  $('suggestRooms').addEventListener('click', function () {
    if (!MEMBER) { store('after_login', location.hash); location.hash = 'login'; return; }
    ask('เสนอเพิ่มห้องใหม่', [
      { label: 'เลขห้อง', value: th(String(DATA.rooms.length + 1).padStart(2, '0')) },
      { label: 'ชื่อห้อง', placeholder: 'เช่น ผู้ใหม่ในระดับ วิชชาพระโสดาบันบุคคล' },
      { label: 'รายละเอียดห้อง (ถ้ามี)', multiline: true }
    ], function (v, err) {
      if (!v[1].trim()) { err('กรุณาใส่ชื่อห้อง'); return true; }
      var text = v[1].trim() + (v[2].trim() ? '\n\n' + v[2] : '');
      var sendText = /^[=+\-@']/.test(text) ? "'" + text : text;
      err('กำลังส่ง…');
      call('propose', { teamCode: store('team_code'), type: 'add', room: 'n:' + v[0].trim(), note: 0, text: sendText, name: store('member_name') })
        .then(function () { $('dlg').close(); status('ส่งข้อเสนอแล้ว รอแอดมินอนุมัติก่อนขึ้นเว็บ', 'ok'); })
        .catch(function (e) {
          if (e.message === 'bad_team_code') { memberLogout(); err('รหัสสมาชิกเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่'); }
          else err('ส่งไม่สำเร็จ ลองกดอีกครั้ง');
        });
      return true;
    }, 'ส่งข้อเสนอ');
  });
  $('suggestRec').addEventListener('click', function () { if (curPerson) suggestAdd({ kind: 'rec', p: curPerson, k: -1 }); });
  $('suggestItem').addEventListener('click', function () { var s = sections()[curSec]; if (s) suggestAdd({ kind: 'sec', s: s, k: -1 }); });
  $('propose').addEventListener('click', function () {
    if (!MEMBER) { store('after_login', location.hash); location.hash = 'login'; return; }
    var what = CTX.kind === 'sec' ? 'หัวข้อ' : CTX.kind === 'rec' ? 'บันทึก' : 'องค์ธรรม';
    ask('ต้องการเสนออะไร', [{ label: 'เลือก', options: [{ value: 'add', label: 'เพิ่ม' + what + 'ใหม่' }, { value: 'edit', label: 'แก้ไข' + what + 'นี้' }] }], function (v) {
      setTimeout(function () { proposeForm(v[0]); }, 50);
    }, 'ถัดไป');
  });
  function memberLogout() { ['team_code', 'member_name'].forEach(function (k) { store(k, null); }); MEMBER = false; }

  // ---------- sign-in page ----------
  var loginRole = 'member';
  function setRole(role) {
    loginRole = role;
    $('tabMember').classList.toggle('on', role === 'member');
    $('tabAdmin').classList.toggle('on', role === 'admin');
    $('fName').hidden = role !== 'member';
    $('fAdminName').hidden = role !== 'admin' || !$('lgAdminName').options.length;
    $('lgCode').maxLength = role === 'member' ? 4 : 6;
    $('lgCode').placeholder = role === 'member' ? 'รหัส ๔ หลัก' : 'รหัส ๖ หลัก';
    $('lgNote').textContent = role === 'member' ? 'ส่งข้อเสนอเพิ่ม / แก้ไของค์ธรรม รอแอดมินอนุมัติ' : 'ตรวจ อนุมัติ และแก้ไขเว็บ';
    $('lgErr').textContent = '';
    $('lgCode').value = '';
  }
  function openLogin(role) {
    $('brand').textContent = 'เข้าสู่ระบบ';
    $('lgLogo').src = DATA.placeholderPhoto || '';
    $('lgName').value = store('member_name') || '';
    show('loginv');
    setRole(role || 'member');
    if (!$('lgAdminName').options.length) {
      call('adminNames', {}).then(function (j) {
        j.names.forEach(function (n) { var o = el('option', null, n); o.value = n; $('lgAdminName').appendChild(o); });
        if (loginRole === 'admin') $('fAdminName').hidden = false;
      }).catch(function () {});
    }
  }
  $('tabMember').onclick = function () { setRole('member'); };
  $('tabAdmin').onclick = function () { setRole('admin'); };
  $('lgForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var code = $('lgCode').value.trim(), err = $('lgErr');
    if (loginRole === 'member') {
      var name = $('lgName').value.trim();
      if (!name) { err.textContent = 'กรุณากรอกชื่อ'; return; }
      if (!/^\d{4}$/.test(code)) { err.textContent = 'รหัสสมาชิกมี ๔ หลัก'; return; }
      err.textContent = 'กำลังตรวจรหัส…';
      call('checkTeam', { teamCode: code }).then(function () {
        store('team_code', code); store('member_name', name); MEMBER = true;
        drawAccount();
        var back = store('after_login'); store('after_login', null);
        location.hash = back || '';
        if (!back) { history.replaceState(null, '', location.pathname); route(); }
      }).catch(function () { err.textContent = 'รหัสไม่ถูกต้อง'; });
    } else {
      if (!/^\d{6}$/.test(code)) { err.textContent = 'รหัสแอดมินมี ๖ หลัก'; return; }
      err.textContent = 'กำลังตรวจรหัส…';
      var nm = $('fAdminName').hidden ? '' : $('lgAdminName').value;
      call('checkAdmin', { adminCode: code, name: nm }).then(function (j) {
        store('admin_code', code); store('admin_main', j.isMain ? '1' : null); store('admin_name', j.name);
        location.href = location.pathname;
      }).catch(function () { err.textContent = 'ชื่อหรือรหัสไม่ถูกต้อง'; });
    }
  });

  // ---------- account button (top right) ----------
  function drawAccount() {
    var who = ADMIN ? ADMIN_NAME : (MEMBER ? store('member_name') : '');
    $('acct').textContent = who ? who + ' ▾' : 'เข้าสู่ระบบ';
    $('adminWho').textContent = ADMIN ? 'แอดมิน' : 'สมาชิก';
  }
  $('acct').onclick = function () {
    if (!ADMIN && !MEMBER) { location.hash = 'login'; return; }
    $('amenu').hidden = !$('amenu').hidden;
  };
  document.addEventListener('click', function (e) { if (!$('acctwrap').contains(e.target)) $('amenu').hidden = true; });
  $('logout').onclick = function () {
    ['admin_code', 'admin_main', 'admin_name'].forEach(function (k) { store(k, null); });
    memberLogout();
    location.href = location.pathname;
  };
  ['pendingBtn', 'settingsBtn'].forEach(function (id) { $(id).addEventListener('click', function () { $('amenu').hidden = true; }); });

  // ---------- admin actions ----------
  function setupAdmin() {
    document.documentElement.classList.add('is-admin');
    $('pendingBtn').hidden = false;
    $('settingsBtn').hidden = !IS_MAIN;
    ['addRoom', 'addNote', 'editRoom', 'noteAdmin'].forEach(function (id) { $(id).hidden = false; });
    $('propose').hidden = true;
    $('pendingBtn').onclick = function () { location.hash = 'pending'; };
    $('settingsBtn').onclick = function () { location.hash = 'settings'; };
    refreshPendingCount();

    $('addRoom').onclick = function () {
      ask('เพิ่มห้องใหม่', [
        { label: 'เลขห้อง', value: th(String(DATA.rooms.length + 1).padStart(2, '0')) },
        { label: 'ชื่อห้อง', placeholder: 'เช่น ผู้ใหม่ในระดับ วิชชาพระโสดาบันบุคคล' },
        { label: 'รายละเอียดห้อง (ถ้ามี)', multiline: true }
      ], function (v) {
        if (!v[1].trim()) return;
        var nr = { no: v[0].trim(), title: v[1].trim(), notes: [] };
        if (v[2].trim()) nr.desc = v[2];
        DATA.rooms.push(nr);
        renderRooms();
        saveData('เพิ่มห้อง ' + v[0]);
      });
    };
    $('editRoom').onclick = function () {
      var r = DATA.rooms[curRoom];
      ask('แก้ไขห้อง', [{ label: 'เลขห้อง', value: r.no }, { label: 'ชื่อห้อง', value: r.title }, { label: 'รายละเอียดห้อง', value: r.desc || '', multiline: true }], function (v) {
        if (v.del) {
          DATA.rooms.splice(curRoom, 1);
          location.hash = 'rooms';
          saveData('ลบห้อง ' + r.no);
          return;
        }
        r.no = v[0].trim(); r.title = v[1].trim();
        if (v[2].trim()) r.desc = v[2]; else delete r.desc;
        openRoom(curRoom);
        saveData('แก้ชื่อห้อง ' + r.no);
      }, 'บันทึก', 'ลบห้องนี้ทั้งห้อง');
    };
    $('addNote').onclick = function () {
      ask('เพิ่มองค์ธรรมในห้องนี้', [
        { label: 'ชื่อหัวข้อบนการ์ด (ไม่ใส่ก็ได้ จะใช้บรรทัดแรกของข้อความ)' },
        { label: 'วางข้อความจากโน้ต LINE ทั้งหมด', multiline: true }
      ], function (v) {
        var t = v[1];
        if (!t.trim()) return;
        DATA.rooms[curRoom].notes.push({ title: v[0].trim() || firstLine(t), text: t });
        openRoom(curRoom);
        saveData('เพิ่มองค์ธรรมในห้อง ' + DATA.rooms[curRoom].no);
      });
    };
    $('editNote').onclick = function () {
      if (curItem && document.documentElement.classList.contains('on-sec')) return itemForm(curItem.s, curItem.it);
      if (curRecord && document.documentElement.classList.contains('on-rec')) return recordForm(curRecord.p, curRecord.rec);
      var n = DATA.rooms[curRoom].notes[curNote];
      // ชื่อหัวข้อบนการ์ดแก้เองได้; ถ้ายังเป็นบรรทัดแรกของข้อความอยู่ จะเปลี่ยนตามข้อความใหม่
      var autoTitle = !n.title || n.title === firstLine(n.text);
      ask('แก้ไของค์ธรรม', [
        { label: 'ชื่อหัวข้อบนการ์ด', value: n.title || '' },
        { label: 'ข้อความ', value: n.text, multiline: true }
      ], function (v) {
        var newTitle = v[0].trim();
        if (!newTitle || (autoTitle && newTitle === n.title)) newTitle = firstLine(v[1]);
        n.text = v[1]; n.title = newTitle;
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

  // ---- highlight what an edit proposal changes ----
  // the text the proposal would replace (same rules as applyProposal in Code.gs)
  function proposalOriginal(it) {
    var k = (Number(it.note) || 0) - 1;
    if (/^s:/.test(it.room)) {
      var sx = sections().filter(function (x) { return x.id === it.room.slice(2); })[0];
      var si = sx && sx.items && sx.items[k];
      return si ? (si.overview || si.text || '') : null;
    }
    if (/^p:/.test(it.room)) {
      var nm = it.room.slice(2), pr = null;
      (DATA.ratana || []).forEach(function (g) { (g.people || []).forEach(function (x) { if (!pr && x.name === nm) pr = x; }); });
      var rc = pr && pr.records && pr.records[k];
      return rc ? rc.text || '' : null;
    }
    var r = DATA.rooms[it.room - 1], n = r && r.notes[k];
    return n ? n.text || '' : null;
  }
  // split into letters, keeping Thai vowels / tone marks with the letter they sit on
  function clusters(t) { return String(t).match(/[\s\S][\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]*/g) || []; }
  function diffParts(a, b) {
    var A = clusters(a), B = clusters(b), p = 0, q = 0;
    while (p < A.length && p < B.length && A[p] === B[p]) p++;
    while (q < A.length - p && q < B.length - p && A[A.length - 1 - q] === B[B.length - 1 - q]) q++;
    var out = [], am = A.slice(p, A.length - q), bm = B.slice(p, B.length - q);
    function push(kind, txt) { if (!txt) return; var l = out[out.length - 1]; if (l && l.k === kind) l.t += txt; else out.push({ k: kind, t: txt }); }
    push('=', A.slice(0, p).join(''));
    if (am.length * bm.length > 2500000) { push('-', am.join('')); push('+', bm.join('')); }
    else {
      var n = am.length, m = bm.length, L = [];
      for (var i = 0; i <= n; i++) L.push(new Uint16Array(m + 1));
      for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) L[i][j] = am[i] === bm[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      i = 0; j = 0;
      while (i < n && j < m) {
        if (am[i] === bm[j]) { push('=', am[i]); i++; j++; }
        else if (L[i + 1][j] >= L[i][j + 1]) { push('-', am[i]); i++; }
        else { push('+', bm[j]); j++; }
      }
      push('-', am.slice(i).join('')); push('+', bm.slice(j).join(''));
    }
    push('=', A.slice(A.length - q).join(''));
    return out;
  }
  function diffBox(orig, text) {
    var box = el('div', 'ptext pdiff');
    diffParts(orig, text).forEach(function (d) {
      box.appendChild(d.k === '=' ? document.createTextNode(d.t) : el(d.k === '+' ? 'ins' : 'del', null, d.t));
    });
    // the text box scrolls; start it at the first change
    setTimeout(function () { var f = box.querySelector('ins,del'); if (f) box.scrollTop = Math.max(0, f.offsetTop - box.offsetTop - 40); }, 0);
    return box;
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
        var r = typeof it.room === 'number' ? DATA.rooms[it.room - 1] : null;
        var where = r ? 'ห้องที่ ' + r.no : 'ห้องที่ ' + th(it.room);
        if (/^s:/.test(it.room)) { var sx = sections().filter(function (x) { return x.id === it.room.slice(2); })[0]; where = 'หมวด ' + (sx ? sx.title : it.room.slice(2)); }
        if (/^p:/.test(it.room)) where = 'บันทึกการบรรลุธรรม ' + it.room.slice(2);
        if (/^n:/.test(it.room)) where = 'ห้องใหม่ · ห้องที่ ' + it.room.slice(2);
        var c = el('div', 'pend');
        var h = el('div', 'phd');
        h.appendChild(el('span', 'chip' + (it.type === 'edit' ? ' y' : ''), it.type === 'edit' ? 'แก้ไข' : 'เพิ่มใหม่'));
        h.appendChild(el('span', 'who', 'จาก ' + it.name + ' · ' + timeAgo(it.time)));
        c.appendChild(h);
        c.appendChild(el('b', null, where + (it.type === 'edit' ? ' · ' + (/^s:/.test(it.room) ? 'หัวข้อ ' : /^p:/.test(it.room) ? 'บันทึก ' : 'องค์ธรรม ') + th(it.note) : '')));
        var orig = it.type === 'edit' ? proposalOriginal(it) : null;
        if (orig != null && orig !== it.text) {
          var key = el('div', 'pkey');
          key.appendChild(el('ins', null, 'ข้อความที่เพิ่ม')); key.appendChild(el('del', null, 'ข้อความที่ลบออก'));
          c.appendChild(key);
          c.appendChild(diffBox(orig, it.text));
        } else {
          if (orig != null) c.appendChild(el('div', 'pkey', 'ข้อความเหมือนเดิมทุกตัวอักษร'));
          c.appendChild(el('div', 'ptext', it.text));
        }
        var btns = el('div', 'pbtns');
        var no = el('button', 'pbtn no', 'ไม่อนุมัติ'); no.type = 'button';
        var yes = el('button', 'pbtn yes', 'อนุมัติ'); yes.type = 'button';
        function decide(ok) {
          yes.disabled = no.disabled = true;
          status(ok ? 'กำลังอนุมัติ…' : 'กำลังบันทึก…', 'busy');
          call('decide', { adminCode: ADMIN_CODE, id: it.id, approve: ok }).then(function () {
            status(ok ? 'อนุมัติแล้ว เว็บจะอัปเดตภายใน ๑–๒ นาที' : 'ไม่อนุมัติแล้ว', 'ok');
            if (ok) return call('getData', { adminCode: ADMIN_CODE }).then(function (g) { DATA = g.data; renderSections(); renderRatana(); renderRooms(); });
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
    box.appendChild(el('h3', 'sh3', 'รหัสสมาชิก (ใช้ร่วมกันทุกท่าน)'));
    var row = el('div', 'arow');
    row.appendChild(el('span', 'acode big2', j.teamCode.split('').join(' ')));
    var ch = el('button', 'pbtn yes small', 'เปลี่ยนรหัส'); ch.type = 'button';
    ch.onclick = function () {
      ask('ตั้งรหัสสมาชิกใหม่', [{ label: 'รหัสใหม่ ๔ หลัก', placeholder: 'เช่น 2580' }], function (v, err) {
        if (!/^\d{4}$/.test(v[0].trim())) { err('รหัสมี ๔ หลัก'); return true; }
        call('setTeamCode', { adminCode: ADMIN_CODE, newCode: v[0].trim() }).then(function () { $('dlg').close(); openSettings(); })
          .catch(function () { err('เปลี่ยนไม่สำเร็จ'); });
        return true;
      });
    };
    row.appendChild(ch);
    box.appendChild(row);
    box.appendChild(el('p', 'note', 'ส่งรหัสนี้ให้สมาชิกทาง LINE ถ้ารหัสหลุดไปถึงคนนอก กดเปลี่ยนรหัสแล้วส่งรหัสใหม่'));
    box.appendChild(el('h3', 'sh3', 'แอดมิน (รหัส ๖ หลักแยกของแต่ละท่าน)'));
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


  // ---------- keep the page fresh without a refresh button (LINE's browser has none) ----------
  var LAST_DATA = '';
  // the version is in the file names (assets/app-<ver>.js), so GitHub's servers can never hand out an old copy
  var VER_RE = /name="app-version" content="([^"]+)"/;
  var MY_VER = (document.querySelector('meta[name="app-version"]') || {}).content || '';
  function busy() { return $('dlg').open || document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName); }
  function checkUpdates() {
    if (document.hidden || busy()) return;
    // new look (index.html / css / js uploaded): reload once with a fresh address so no cached copy is used
    fetch('index.html?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (h) {
      var m = h.match(VER_RE);
      if (m && MY_VER && m[1] !== MY_VER && !busy()) location.replace(location.pathname + '?v=' + m[1] + location.hash);
    }).catch(function () {});
    // new content: admins read the backend copy (so edits made on another device show here too)
    if (ADMIN) {
      if (!API || SAVING || Date.now() - LAST_SAVE < 20000) return;
      call('getData', { adminCode: ADMIN_CODE }).then(function (g) {
        if (!g || !g.data || SAVING || busy() || Date.now() - LAST_SAVE < 20000) return;
        if (JSON.stringify(g.data) === JSON.stringify(DATA)) return;
        DATA = g.data;
        var y = window.scrollY;
        renderSections(); renderRatana(); renderRooms(); route();
        window.scrollTo(0, y);
      }).catch(function () {});
      return;
    }
    fetch(DATA_PATH + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) {
      if (!t || t === LAST_DATA || busy()) return;
      var d = JSON.parse(t);
      LAST_DATA = t; DATA = d;
      var y = window.scrollY;
      renderSections(); renderRatana(); renderRooms(); route();
      window.scrollTo(0, y);
    }).catch(function () {});
  }
  function startAutoUpdate() {
    document.addEventListener('visibilitychange', function () { if (!document.hidden) checkUpdates(); });
    window.addEventListener('pageshow', function (e) { if (e.persisted) checkUpdates(); });
    setInterval(checkUpdates, 60000);
  }

  // ---------- load ----------
  // config.json holds the backend address; it is kept apart from the content so saving content never touches it
  fetch('config.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (cfg) {
    API = cfg.apiUrl || '';
    return fetch(DATA_PATH + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) { LAST_DATA = t; return JSON.parse(t); });
  }).then(function (d) {
    if (!API) { $('propose').hidden = true; $('acctwrap').hidden = true; }
    // show the published copy straight away; admins get the backend copy in the background
    if (ADMIN && API) {
      call('getData', { adminCode: ADMIN_CODE }).then(function (g) {
        if (!g || !g.data || busy()) return;
        DATA = g.data;
        var y = window.scrollY;
        renderSections(); renderRatana(); renderRooms(); route();
        window.scrollTo(0, y);
      }).catch(function () {});
    }
    return d;
  }).then(function (d) {
    DATA = d;
    if (!store('admin_code')) { ADMIN = false; }
    $('heroImg').src = d.heroImage;
    $('heroImg').alt = d.heroAlt || '';
    if (d.heroLink) { $('heroLink').href = d.heroLink; $('heroLink').setAttribute('aria-label', 'ช่อง YouTube เพราะอวิชชาดับ'); } else { $('heroLink').removeAttribute('href'); }
    $('ratanaHeading').textContent = d.ratanaHeading;
    $('roomsHeading').textContent = d.roomsHeading;
    $('roomsSub').textContent = d.roomsSub || 'เลือกห้องตามระดับวิชชา';
    renderSections();
    if (ADMIN) setupAdmin();
    drawAccount();
    renderRatana();
    renderRooms();
    window.addEventListener('hashchange', onHash);
    route();
    startAutoUpdate();
    // check once right after opening too (the phone may have shown a stored copy of the page)
    setTimeout(checkUpdates, 1500);
    // ปุ่มอัปเดต: always fetch the newest page, look and content
    $('reloadBtn').onclick = function () {
      $('reloadBtn').classList.add('spin');
      fetch('index.html?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (h) {
        var m = h.match(VER_RE);
        location.replace(location.pathname + '?v=' + (m ? m[1] : '') + '&t=' + Date.now() + location.hash);
      }).catch(function () { location.reload(); });
    };
  }).catch(function () {
    document.body.insertAdjacentHTML('beforeend', '<p style="padding:24px;text-align:center">โหลดข้อมูลไม่สำเร็จ กรุณาลองเปิดใหม่อีกครั้ง</p>');
  });
})();
