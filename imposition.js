/**
 * imposition.js —— 骑马钉拼版核心逻辑（前后端共享，零依赖 UMD 模块）
 *
 * 约定：
 *  - 一张纸对折后成为 4 个页码版位：正面左、正面右、反面左、反面右。
 *  - 配帖方式：整本书最外层纸张为第 1 张，依次向内嵌套；预览即按此顺序。
 *  - 第 s 张（s 从 1 开始）标准页码，N = 补齐后的总页数：
 *        正面：  N-2(s-1) | 2s-1
 *        反面：  2s       | N-2s+1
 *    正面两码之和恒为 N+1，反面两码之和也恒为 N+1。
 *  - 成品不足 4 的倍数时，在文档末尾补空白页（页码 P+1..N），版位值记为 null。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Imposition = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_PRODUCT_PAGES = 120;

  // 每张纸 4 个版位的固定顺序（同时也是 CSV 的导出顺序）
  var POSITION_KEYS = ['frontLeft', 'frontRight', 'backLeft', 'backRight'];

  var POSITION_META = {
    frontLeft: { side: 'front', sideLabel: '正面', slot: 'left', slotLabel: '左' },
    frontRight: { side: 'front', sideLabel: '正面', slot: 'right', slotLabel: '右' },
    backLeft: { side: 'back', sideLabel: '反面', slot: 'left', slotLabel: '左' },
    backRight: { side: 'back', sideLabel: '反面', slot: 'right', slotLabel: '右' }
  };

  function normalizePages(pages) {
    var n = Number(pages);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PRODUCT_PAGES) {
      throw new Error('成品页数必须是 1～' + MAX_PRODUCT_PAGES + ' 之间的整数');
    }
    return n;
  }

  function realOrBlank(x, productPages) {
    return Number.isInteger(x) && x >= 1 && x <= productPages ? x : null;
  }

  /**
   * 生成标准骑马钉拼版方案。
   * 返回产品页数、补齐页数、空白页数、纸张数，以及按嵌套顺序排列的每张纸。
   */
  function buildSignature(pages) {
    var productPages = normalizePages(pages);
    var paddedPages = Math.ceil(productPages / 4) * 4;
    var blankCount = paddedPages - productPages;
    var sheetCount = paddedPages / 4;
    var sheets = [];

    for (var i = 0; i < sheetCount; i++) {
      // 公式里的页码（可能落在补白区间 P+1..N）
      var fl = paddedPages - 2 * i;
      var fr = 2 * i + 1;
      var bl = 2 * i + 2;
      var br = paddedPages - 2 * i - 1;

      sheets.push({
        sheetNumber: i + 1,
        nestingIndex: i + 1, // 由外向内的嵌套序号
        front: {
          side: 'front',
          label: '正面',
          left: realOrBlank(fl, productPages),
          right: realOrBlank(fr, productPages)
        },
        back: {
          side: 'back',
          label: '反面',
          left: realOrBlank(bl, productPages),
          right: realOrBlank(br, productPages)
        }
      });
    }

    return {
      productPages: productPages,
      paddedPages: paddedPages,
      blankCount: blankCount,
      sheetCount: sheetCount,
      sheets: sheets
    };
  }

  /**
   * 把拼版方案展开为一维版位列表（每张纸按 POSITION_KEYS 顺序）。
   * 每个元素：{ index, sheetIndex, sheetNumber, position, side, sideLabel, slot, slotLabel, value }
   */
  function flatten(signature) {
    var out = [];
    signature.sheets.forEach(function (sheet) {
      POSITION_KEYS.forEach(function (key) {
        var meta = POSITION_META[key];
        var face = meta.side === 'front' ? sheet.front : sheet.back;
        out.push({
          index: out.length,
          sheetIndex: sheet.sheetNumber - 1,
          sheetNumber: sheet.sheetNumber,
          position: key,
          side: meta.side,
          sideLabel: meta.sideLabel,
          slot: meta.slot,
          slotLabel: meta.slotLabel,
          value: face[meta.slot]
        });
      });
    });
    return out;
  }

  /** 标准方案的一维版位赋值（页码或 null），顺序与 flatten 一致。 */
  function initialAssignments(signature) {
    return flatten(signature).map(function (p) { return p.value; });
  }

  function positionLabel(sheetNumber, position) {
    var meta = POSITION_META[position];
    return '纸张' + sheetNumber + ' ' + meta.sideLabel + meta.slotLabel;
  }

  function formatPages(pages) {
    if (!pages.length) return '';
    var ranges = [];
    var start = pages[0];
    var prev = pages[0];
    for (var i = 1; i <= pages.length; i++) {
      var cur = pages[i];
      if (cur === prev + 1) {
        prev = cur;
        continue;
      }
      ranges.push(start === prev ? String(start) : start + '-' + prev);
      start = cur;
      prev = cur;
    }
    return ranges.join('、');
  }

  function fmt(v) {
    return v === null || v === undefined ? '空白' : String(v);
  }

  /**
   * 校验当前赋值。
   * assignments 为一维数组：每张纸按 [正面左, 正面右, 反面左, 反面右] 排列，
   * 元素为正整数页码或 null（空白）。
   */
  function validate(productPages, assignments) {
    var P;
    try {
      P = normalizePages(productPages);
    } catch (e) {
      return {
        valid: false,
        inputError: e.message,
        productPages: null,
        paddedPages: null,
        sheetCount: 0,
        expectedBlanks: 0,
        actualBlanks: 0,
        blankMismatch: false,
        invalidValues: [],
        duplicates: [],
        missing: [],
        pairing: [],
        badSlots: {}
      };
    }

    var N = Math.ceil(P / 4) * 4;
    var S = N / 4;
    var expectedBlanks = N - P;

    var invalidValues = [];
    if (!Array.isArray(assignments) || assignments.length !== S * 4) {
      return {
        valid: false,
        inputError: '版位数量与页数不符（应有 ' + (S * 4) + ' 个版位）',
        productPages: P,
        paddedPages: N,
        sheetCount: S,
        expectedBlanks: expectedBlanks,
        actualBlanks: Array.isArray(assignments)
          ? assignments.filter(function (a) { return a === null; }).length
          : 0,
        blankMismatch: true,
        invalidValues: [],
        duplicates: [],
        missing: [],
        pairing: [],
        badSlots: {}
      };
    }

    // 1) 重复页
    var seen = new Map();
    assignments.forEach(function (a, idx) {
      if (a === null) return;
      if (!Number.isInteger(a) || a < 1 || a > P) {
        invalidValues.push({ index: idx, value: a });
        return;
      }
      if (!seen.has(a)) seen.set(a, []);
      seen.get(a).push(idx);
    });

    var duplicates = [];
    seen.forEach(function (indexes, page) {
      if (indexes.length > 1) {
        duplicates.push({ page: page, indexes: indexes.slice() });
      }
    });

    // 2) 缺页（含空白版位数量是否正确）
    var missing = [];
    for (var p = 1; p <= P; p++) {
      if (!seen.has(p)) missing.push(p);
    }
    var actualBlanks = assignments.filter(function (a) { return a === null; }).length;
    var blankMismatch = actualBlanks !== expectedBlanks;

    // 3) 同张正反配对异常：逐版位与标准方案比对
    var signature = buildSignature(P);
    var expected = initialAssignments(signature);
    var pairing = [];
    var badSlots = {};

    for (var s = 0; s < S; s++) {
      var badPositions = [];
      for (var j = 0; j < 4; j++) {
        var idx = s * 4 + j;
        var e = expected[idx];
        var a = assignments[idx];
        var sameBlank = (e === null) === (a === null);
        if (!sameBlank || (e !== null && e !== a)) {
          var key = POSITION_KEYS[j];
          badPositions.push(key);
          badSlots[s + ':' + key] = true;
        }
      }
      if (badPositions.length) {
        pairing.push({
          sheetIndex: s,
          sheetNumber: s + 1,
          expected: expected.slice(s * 4, s * 4 + 4),
          actual: assignments.slice(s * 4, s * 4 + 4),
          positions: badPositions
        });
      }
    }

    return {
      valid:
        invalidValues.length === 0 &&
        duplicates.length === 0 &&
        missing.length === 0 &&
        pairing.length === 0,
      inputError: null,
      productPages: P,
      paddedPages: N,
      sheetCount: S,
      expectedBlanks: expectedBlanks,
      actualBlanks: actualBlanks,
      blankMismatch: blankMismatch,
      invalidValues: invalidValues,
      duplicates: duplicates,
      missing: missing,
      pairing: pairing,
      badSlots: badSlots
    };
  }

  /** 把校验结果转成中文消息列表（服务端 400 与客户端面板共用）。 */
  function summarize(issues) {
    var msgs = [];
    if (issues.inputError) msgs.push(issues.inputError);

    issues.invalidValues.forEach(function (v) {
      var sheetNumber = Math.floor(v.index / 4) + 1;
      var pos = POSITION_KEYS[v.index % 4];
      msgs.push(positionLabel(sheetNumber, pos) + ' 的版位值无效：' + fmt(v.value));
    });

    issues.duplicates.forEach(function (d) {
      var where = d.indexes.map(function (idx) {
        return positionLabel(Math.floor(idx / 4) + 1, POSITION_KEYS[idx % 4]);
      }).join('、');
      msgs.push('重复页：第 ' + d.page + ' 页同时出现在 ' + where);
    });

    if (issues.missing.length) {
      msgs.push('缺页：缺少第 ' + formatPages(issues.missing) + ' 页');
    }
    if (issues.blankMismatch) {
      msgs.push(
        '空白版位数量异常：应为 ' + issues.expectedBlanks +
        ' 个，实际为 ' + issues.actualBlanks + ' 个'
      );
    }

    issues.pairing.forEach(function (pa) {
      msgs.push(
        '纸张' + pa.sheetNumber + ' 正反配对异常：标准应为 正面 ' +
        fmt(pa.expected[0]) + '/' + fmt(pa.expected[1]) + '，反面 ' +
        fmt(pa.expected[2]) + '/' + fmt(pa.expected[3]) +
        '；当前为 正面 ' +
        fmt(pa.actual[0]) + '/' + fmt(pa.actual[1]) + '，反面 ' +
        fmt(pa.actual[2]) + '/' + fmt(pa.actual[3])
      );
    });

    return msgs;
  }

  function csvCell(v) {
    var s = fmt(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** 校验通过后生成 CSV（不含 BOM，BOM 由服务端添加）。 */
  function toCSV(productPages, assignments) {
    var issues = validate(productPages, assignments);
    if (!issues.valid) {
      throw new Error('校验未通过，禁止导出：' + summarize(issues).join('；'));
    }
    var rows = ['纸张序号,面别,左页码,右页码'];
    for (var s = 0; s < issues.sheetCount; s++) {
      rows.push([
        s + 1, '正面',
        csvCell(assignments[s * 4 + 0]),
        csvCell(assignments[s * 4 + 1])
      ].join(','));
      rows.push([
        s + 1, '反面',
        csvCell(assignments[s * 4 + 2]),
        csvCell(assignments[s * 4 + 3])
      ].join(','));
    }
    return rows.join('\r\n') + '\r\n';
  }

  return {
    MAX_PRODUCT_PAGES: MAX_PRODUCT_PAGES,
    POSITION_KEYS: POSITION_KEYS,
    POSITION_META: POSITION_META,
    normalizePages: normalizePages,
    buildSignature: buildSignature,
    flatten: flatten,
    initialAssignments: initialAssignments,
    validate: validate,
    summarize: summarize,
    toCSV: toCSV,
    positionLabel: positionLabel,
    formatPages: formatPages
  };
});
