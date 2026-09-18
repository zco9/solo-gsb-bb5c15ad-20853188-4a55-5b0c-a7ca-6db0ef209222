'use strict';

(function () {
  var $ = function (id) { return document.getElementById(id); };

  var pagesInput = $('pagesInput');
  var regenerateBtn = $('regenerateBtn');
  var swapDemoBtn = $('swapDemoBtn');
  var resetBtn = $('resetBtn');
  var exportBtn = $('exportBtn');
  var summaryEl = $('summary');
  var issuesPanel = $('issuesPanel');
  var sheetsEl = $('sheets');

  var state = {
    productPages: null,
    signature: null,
    assignments: [],
    selected: null
  };

  // 版位 DOM 引用（重新生成后重建），与 state.assignments 等长
  var slotEls = [];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- 生成 / 重建 ---------------- */

  function regenerate() {
    var raw = pagesInput.value.trim();
    var sig;
    try {
      sig = Imposition.buildSignature(raw);
    } catch (err) {
      showInputError(err.message);
      return;
    }

    state.productPages = sig.productPages;
    state.signature = sig;
    state.assignments = Imposition.initialAssignments(sig);
    state.selected = null;
    pagesInput.value = String(sig.productPages);
    buildSheetsDom(sig);
    updateState();
  }

  function showInputError(message) {
    summaryEl.className = 'summary';
    summaryEl.innerHTML = '<span class="err-text">输入有误：</span>' + esc(message);
    issuesPanel.hidden = false;
    issuesPanel.classList.remove('valid');
    issuesPanel.innerHTML = '<h2>无法生成拼版</h2><ul><li>' + esc(message) + '</li></ul>';
    exportBtn.disabled = true;
  }

  function makeSelect(sig, flatIndex, value) {
    var sel = document.createElement('select');
    sel.className = 'slot-select';
    sel.title = '直接指定该版位的页码或空白';
    sel.setAttribute('aria-label', '设置版位页码');

    var blankOpt = document.createElement('option');
    blankOpt.value = '';
    blankOpt.textContent = '空白';
    sel.appendChild(blankOpt);

    for (var p = 1; p <= sig.productPages; p++) {
      var opt = document.createElement('option');
      opt.value = String(p);
      opt.textContent = '第 ' + p + ' 页';
      sel.appendChild(opt);
    }

    sel.value = value === null ? '' : String(value);

    sel.addEventListener('click', function (e) { e.stopPropagation(); });
    sel.addEventListener('change', function () {
      var v = sel.value === '' ? null : Number(sel.value);
      state.assignments[flatIndex] = v;
      state.selected = null;
      updateState();
    });
    return sel;
  }

  function buildSheetsDom(sig) {
    sheetsEl.innerHTML = '';
    slotEls = [];

    sig.sheets.forEach(function (sheet, sheetIndex) {
      var card = document.createElement('article');
      card.className = 'sheet';
      card.dataset.sheetIndex = String(sheetIndex);

      // 头部：纸张序号 + 嵌套位置
      var header = document.createElement('div');
      header.className = 'sheet-header';

      var title = document.createElement('span');
      title.className = 'sheet-title';
      title.textContent = '纸张 ' + sheet.sheetNumber;
      header.appendChild(title);

      var nesting = document.createElement('span');
      var isOuter = sheetIndex === 0;
      var isInner = sheetIndex === sig.sheets.length - 1;
      var nestText = '嵌套：由外向内第 ' + sheet.nestingIndex + ' / ' + sig.sheetCount + ' 张';
      if (isOuter) nestText += '（最外层）';
      if (isInner && !isOuter) nestText += '（中缝最里层）';
      nesting.textContent = nestText;
      nesting.className = 'sheet-nesting' + (isOuter ? ' outermost' : isInner ? ' innermost' : '');
      header.appendChild(nesting);

      var badge = document.createElement('span');
      badge.className = 'sheet-badge';
      badge.hidden = true;
      badge.textContent = '正反配对异常';
      header.appendChild(badge);
      card.appendChild(header);

      var faces = document.createElement('div');
      faces.className = 'faces';

      ['front', 'back'].forEach(function (side) {
        var face = sheet[side];
        var faceEl = document.createElement('div');
        faceEl.className = 'face';

        var label = document.createElement('div');
        label.className = 'face-label';
        label.textContent = face.label + '（对折后朝外的一面）';
        faceEl.appendChild(label);

        var slots = document.createElement('div');
        slots.className = 'slots';

        ['left', 'right'].forEach(function (slotKey) {
          var position = side === 'front'
            ? (slotKey === 'left' ? 'frontLeft' : 'frontRight')
            : (slotKey === 'left' ? 'backLeft' : 'backRight');
          var flatIndex = sheetIndex * 4 + Imposition.POSITION_KEYS.indexOf(position);
          var meta = Imposition.POSITION_META[position];
          var value = state.assignments[flatIndex];

          var slot = document.createElement('div');
          slot.className = 'slot';
          slot.dataset.index = String(flatIndex);
          slot.setAttribute('role', 'button');
          slot.setAttribute('tabindex', '0');
          slot.setAttribute(
            'aria-label',
            '纸张' + sheet.sheetNumber + face.label + meta.slotLabel +
            '，当前为 ' + (value === null ? '空白' : '第' + value + '页')
          );

          var coord = document.createElement('span');
          coord.className = 'slot-coord';
          coord.textContent = face.label + '·' + meta.slotLabel;
          slot.appendChild(coord);

          var flags = document.createElement('span');
          flags.className = 'flags';
          slot.appendChild(flags);

          var valueEl = document.createElement('div');
          valueEl.className = 'slot-value';
          slot.appendChild(valueEl);

          var assignWrap = document.createElement('div');
          assignWrap.className = 'slot-assign';
          var select = makeSelect(sig, flatIndex, value);
          assignWrap.appendChild(select);
          slot.appendChild(assignWrap);

          slot.addEventListener('click', function () { onSlotClick(flatIndex); });
          slot.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSlotClick(flatIndex);
            }
          });

          slots.appendChild(slot);
          slotEls[flatIndex] = {
            el: slot,
            valueEl: valueEl,
            select: select,
            flags: flags,
            sheetIndex: sheetIndex
          };
        });

        faceEl.appendChild(slots);
        faces.appendChild(faceEl);
      });

      card.appendChild(faces);
      sheetsEl.appendChild(card);
    });
  }

  /* ---------------- 交换 ---------------- */

  function onSlotClick(index) {
    if (state.selected === null) {
      state.selected = index;
      updateSelection();
      return;
    }
    if (state.selected === index) {
      state.selected = null;
      updateSelection();
      return;
    }
    var a = state.assignments;
    var tmp = a[state.selected];
    a[state.selected] = a[index];
    a[index] = tmp;
    state.selected = null;
    updateState();
  }

  function updateSelection() {
    slotEls.forEach(function (ref, i) {
      ref.el.classList.toggle('selected', i === state.selected);
      if (i === state.selected) ref.el.focus();
    });
  }

  /* ---------------- 实时校验与渲染 ---------------- */

  function updateState() {
    var sig = state.signature;
    if (!sig) return;

    var issues = Imposition.validate(state.productPages, state.assignments);
    var messages = Imposition.summarize(issues);

    // 重复 / 非法版位索引集合
    var dupIndexes = new Set();
    issues.duplicates.forEach(function (d) {
      d.indexes.forEach(function (i) { dupIndexes.add(i); });
    });
    issues.invalidValues.forEach(function (v) { dupIndexes.add(v.index); });

    // 逐版位更新
    slotEls.forEach(function (ref, i) {
      var value = state.assignments[i];
      ref.valueEl.textContent = value === null ? '空白' : String(value);
      ref.valueEl.classList.toggle('blank', value === null);
      ref.select.value = value === null ? '' : String(value);

      var sheetNumber = Math.floor(i / 4) + 1;
      var position = Imposition.POSITION_KEYS[i % 4];
      ref.el.setAttribute(
        'aria-label',
        Imposition.positionLabel(sheetNumber, position) +
        '，当前为 ' + (value === null ? '空白' : '第' + value + '页')
      );

      var isDup = dupIndexes.has(i);
      var sheetIndex = ref.sheetIndex;
      var isBad = Object.prototype.hasOwnProperty.call(
        issues.badSlots, sheetIndex + ':' + position
      );

      ref.el.classList.toggle('dup', isDup);
      ref.el.classList.toggle('bad', !isDup && isBad);
      ref.el.classList.toggle('selected', i === state.selected);

      ref.flags.innerHTML = '';
      if (isDup) {
        var f1 = document.createElement('span');
        f1.className = 'flag dup-flag';
        f1.textContent = '重复';
        ref.flags.appendChild(f1);
      }
      if (isBad) {
        var f2 = document.createElement('span');
        f2.className = 'flag bad-flag';
        f2.textContent = '配对异常';
        ref.flags.appendChild(f2);
      }
    });

    // 每张纸状态
    var sheetCards = sheetsEl.querySelectorAll('.sheet');
    issues.pairing.forEach(function (pa) {
      var card = sheetCards[pa.sheetIndex];
      if (card) {
        card.classList.add('has-error');
        var badge = card.querySelector('.sheet-badge');
        if (badge) badge.hidden = false;
      }
    });
    for (var s = 0; s < issues.sheetCount; s++) {
      var paired = issues.pairing.some(function (pa) { return pa.sheetIndex === s; });
      var card = sheetCards[s];
      if (card && !paired) {
        card.classList.remove('has-error');
        var b = card.querySelector('.sheet-badge');
        if (b) b.hidden = true;
      }
    }

    renderSummary(issues);
    renderIssues(issues, messages);
    exportBtn.disabled = !issues.valid;
  }

  function renderSummary(issues) {
    var sig = state.signature;
    var blankNote = sig.blankCount > 0
      ? '，末尾补 <strong>' + sig.blankCount + '</strong> 个空白页（页码 ' +
        (sig.productPages + 1) + '–' + sig.paddedPages + '）'
      : '';

    var verdict;
    if (issues.valid) {
      verdict = '<span class="ok-text">✓ 校验通过</span>，可以导出 CSV。';
    } else {
      var n = Imposition.summarize(issues).length;
      verdict = '<span class="err-text">✗ 发现 ' + n + ' 项问题</span>，已禁止导出，修正后自动恢复。';
    }

    summaryEl.className = 'summary';
    summaryEl.innerHTML =
      '成品 <strong>' + issues.productPages + '</strong> 页 → 补齐为 ' +
      '<strong>' + issues.paddedPages + '</strong> 页（4 的倍数）' + blankNote +
      '，共 <strong>' + issues.sheetCount + '</strong> 张纸，按装订嵌套顺序（外→内）预览。<br>' +
      '当前空白版位 <strong>' + issues.actualBlanks + '</strong> / 应 ' +
      issues.expectedBlanks + ' 个。&nbsp;&nbsp;' + verdict;
  }

  function renderIssues(issues, messages) {
    if (issues.valid) {
      issuesPanel.hidden = false;
      issuesPanel.classList.add('valid');
      issuesPanel.innerHTML =
        '<h2>✓ 校验通过</h2><ul><li>无重复页、无缺页，每张纸的正反左右配对均符合骑马钉标准拼版。</li></ul>';
      return;
    }
    issuesPanel.hidden = false;
    issuesPanel.classList.remove('valid');
    issuesPanel.innerHTML =
      '<h2>✗ 校验未通过（' + messages.length + ' 项），禁止导出</h2>' +
      '<ul>' + messages.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>';
  }

  /* ---------------- 功能按钮 ---------------- */

  function resetStandard() {
    state.assignments = Imposition.initialAssignments(state.signature);
    state.selected = null;
    updateState();
  }

  function makeDemoMess() {
    var a = state.assignments;
    var swaps = Math.min(3, Math.floor(a.length / 2));
    var changed = 0;
    var guard = 0;
    while (changed < swaps && guard < 100) {
      guard++;
      var i = Math.floor(Math.random() * a.length);
      var j = Math.floor(Math.random() * a.length);
      if (i === j || a[i] === a[j]) continue;
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
      changed++;
    }
    state.selected = null;
    updateState();
  }

  async function exportCSV() {
    if (exportBtn.disabled) return;
    exportBtn.disabled = true;
    try {
      var res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pages: state.productPages,
          assignments: state.assignments
        })
      });

      if (!res.ok) {
        var data = await res.json().catch(function () { return null; });
        var msg = data && (data.messages ? data.messages.join('\n') : data.error);
        window.alert('导出被拒绝：\n' + (msg || '校验未通过'));
        updateState();
        return;
      }

      var blob = await res.blob();
      var disposition = res.headers.get('Content-Disposition') || '';
      var match = /filename="?([^"]+)"?/.exec(disposition);
      var filename = match ? match[1] : ('booklet_' + state.productPages + 'pages.csv');

      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      window.alert('导出失败：' + err.message);
    } finally {
      updateState();
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  regenerateBtn.addEventListener('click', regenerate);
  pagesInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') regenerate();
  });
  resetBtn.addEventListener('click', resetStandard);
  swapDemoBtn.addEventListener('click', makeDemoMess);
  exportBtn.addEventListener('click', exportCSV);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected !== null) {
      state.selected = null;
      updateSelection();
    }
  });

  // 初始：默认 8 页
  regenerate();
})();
