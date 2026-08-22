/**
 * PreShoot Studio — deterministic script / shot-list copy + PDF.
 * No AI. No network. Client-side only.
 */
(function (global) {
  'use strict';

  var RULE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  var DASH = '────────────────────────────────────────';

  function studio() {
    return global.PreShootStudio;
  }

  function pad2(n) {
    return String(n).length < 2 ? '0' + n : String(n);
  }

  function todayLabel() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function creatorName() {
    var s = global.S || {};
    var p = s.profile || {};
    var u = s.authUser || {};
    return p.name || u.name || u.email || 'Creator';
  }

  function findBundle(productionId) {
    var St = studio();
    if (!St || !productionId) return null;
    var found = St.findProduction(productionId);
    if (!found) return null;
    var prod = St.ensureWorkspace ? St.ensureWorkspace(found.production) : found.production;
    return { project: found.project, production: prod, workspace: prod.workspace || {} };
  }

  function scriptLines(ws) {
    var lines = (ws.script && ws.script.lines) || [];
    if (lines.length) return lines;
    var body = (ws.script && ws.script.body) || '';
    if (!body) return [];
    return body.split(/\n\n+/).map(function (t, i) {
      return { id: 'body-' + i, text: t.trim(), shotOrder: i + 1 };
    }).filter(function (l) { return l.text; });
  }

  function shotForLine(ws, line) {
    var shots = ws.shotList || [];
    if (line.shotId) {
      for (var i = 0; i < shots.length; i++) {
        if (shots[i].id === line.shotId) return shots[i];
      }
    }
    for (var j = 0; j < shots.length; j++) {
      if (shots[j].scriptLineId && line.id && shots[j].scriptLineId === line.id) return shots[j];
    }
    return null;
  }

  function lineForShot(ws, shot) {
    var lines = scriptLines(ws);
    if (shot.scriptLineId) {
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].id === shot.scriptLineId) return { line: lines[i], index: i };
      }
    }
    if (shot.id) {
      for (var j = 0; j < lines.length; j++) {
        if (lines[j].shotId === shot.id) return { line: lines[j], index: j };
      }
    }
    return null;
  }

  function formatScriptText(bundle) {
    var project = bundle.project;
    var prod = bundle.production;
    var ws = bundle.workspace;
    var idea = prod.ideaSnapshot || {};
    var lines = scriptLines(ws);
    var out = [];
    out.push(RULE);
    out.push('PROJECT: ' + (project.name || ''));
    out.push('PRODUCTION: ' + (prod.name || ''));
    out.push('TITLE: ' + (idea.title || prod.name || ''));
    out.push('DATE: ' + todayLabel());
    out.push('CREATOR: ' + creatorName());
    out.push(RULE);
    out.push('');
    if (!lines.length) {
      out.push('(No script yet.)');
      out.push('');
      out.push(RULE);
      out.push('END');
      return out.join('\n');
    }
    lines.forEach(function (line, i) {
      var n = pad2(i + 1);
      var shot = shotForLine(ws, line);
      out.push('SCENE ' + n + (shot && shot.purpose ? ' — ' + shot.purpose.toUpperCase() : ''));
      out.push('[DIALOGUE]\n' + (line.text || '').trim());
      out.push('');
    });
    out.push(RULE);
    out.push('END');
    return out.join('\n');
  }

  function formatShotListText(bundle) {
    var project = bundle.project;
    var prod = bundle.production;
    var ws = bundle.workspace;
    var shots = (ws.shotList || []).slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    });
    var out = [];
    out.push('SHOT LIST');
    out.push('PROJECT: ' + (project.name || ''));
    out.push('PRODUCTION: ' + (prod.name || ''));
    out.push('DATE: ' + todayLabel());
    out.push(DASH);
    if (!shots.length) {
      out.push('(No shots yet.)');
      out.push(DASH);
      return out.join('\n');
    }
    shots.forEach(function (shot, i) {
      var n = pad2(shot.order || i + 1);
      var linked = lineForShot(ws, shot);
      out.push('SHOT ' + n);
      if (linked) {
        out.push('SCRIPT: Scene ' + pad2(linked.index + 1) + (shot.purpose ? ' / ' + shot.purpose : ''));
        if (linked.line && linked.line.text) {
          out.push('SCRIPT REFERENCE:\n' + String(linked.line.text).trim());
        }
      } else if (shot.scriptLineId) {
        out.push('SCRIPT: ' + shot.scriptLineId);
      }
      if (shot.framing) out.push('TYPE: ' + shot.framing);
      if (shot.cameraAngle) out.push('ANGLE: ' + shot.cameraAngle);
      if (shot.cameraMovement) out.push('MOVEMENT: ' + shot.cameraMovement);
      if (shot.gear) out.push('CAMERA: ' + shot.gear);
      if (shot.lens) out.push('LENS: ' + shot.lens);
      if (shot.notes) out.push('VISUAL:\n' + shot.notes);
      if (shot.audio) out.push('DIALOGUE:\n' + shot.audio);
      if (shot.lighting) out.push('LIGHTING: ' + shot.lighting);
      if (shot.beginnerTip) out.push('NOTES:\n' + shot.beginnerTip);
      if (shot.advancedDetail) out.push(shot.advancedDetail);
      out.push(DASH);
    });
    return out.join('\n');
  }

  function formatPackageText(bundle) {
    var project = bundle.project;
    var prod = bundle.production;
    var ws = bundle.workspace;
    var ov = ws.overview || {};
    var idea = prod.ideaSnapshot || {};
    var scan = prod.scanRef || {};
    var parts = [];
    parts.push(RULE);
    parts.push('PRESHOOT PRODUCTION PACKAGE');
    parts.push(RULE);
    parts.push('PROJECT: ' + (project.name || ''));
    parts.push('PRODUCTION: ' + (prod.name || ''));
    parts.push('TITLE: ' + (idea.title || prod.name || ''));
    parts.push('DATE: ' + todayLabel());
    parts.push('CREATOR: ' + creatorName());
    parts.push('PLATFORM: ' + (ov.platform || '—'));
    parts.push('FORMAT: ' + (ov.format || idea.category || '—'));
    parts.push('GOAL: ' + (ov.goal || '—'));
    if (scan.sceneLabel || scan.mainSubject) {
      parts.push('SCAN: ' + (scan.mainSubject || scan.sceneLabel));
    }
    if (idea.hook) parts.push('IDEA HOOK (concept, not script): ' + idea.hook);
    parts.push('');
    parts.push(formatScriptText(bundle));
    parts.push('');
    parts.push(formatShotListText(bundle));
    return parts.join('\n');
  }

  function copyText(text) {
    text = String(text || '');
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      return global.navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = global.document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        global.document.body.appendChild(ta);
        ta.select();
        global.document.execCommand('copy');
        global.document.body.removeChild(ta);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  /* ── Minimal PDF 1.4 writer (WinAnsi Helvetica) ── */
  var HELV_W = [
    278,278,278,278,278,278,278,278,278,278,278,278,278,278,278,278,278,278,278,278,278,278,278,278,278,278,278,278,278,278,278,278,
    278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
    1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
    222,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,278
  ];

  function pdfEscape(s) {
    return String(s || '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/\r/g, '')
      .replace(/[^\x20-\x7E]/g, function (ch) {
        var code = ch.charCodeAt(0);
        if (code === 8216 || code === 8217) return "'";
        if (code === 8220 || code === 8221) return '"';
        if (code === 8211 || code === 8212) return '-';
        if (code === 8230) return '...';
        return ch === '—' ? '-' : '?';
      });
  }

  function textWidth(str, size) {
    var w = 0;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      w += HELV_W[c] || 556;
    }
    return (w * size) / 1000;
  }

  function wrapLine(str, size, maxW) {
    var words = String(str || '').split(/\s+/);
    var lines = [];
    var cur = '';
    words.forEach(function (word) {
      var trial = cur ? cur + ' ' + word : word;
      if (textWidth(trial, size) <= maxW) cur = trial;
      else {
        if (cur) lines.push(cur);
        cur = word;
      }
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  function PdfDoc(title) {
    this.title = title || 'PreShoot Production';
    this.w = 612;
    this.h = 792;
    this.margin = 50;
    this.pages = [];
    this.newPage();
  }

  PdfDoc.prototype.newPage = function () {
    this.ops = [];
    this.y = this.h - 56;
    this.pages.push(this.ops);
  };

  PdfDoc.prototype.ensure = function (need) {
    if (this.y - need < 56) this.newPage();
  };

  PdfDoc.prototype.addLine = function (text, size, opts) {
    opts = opts || {};
    size = size || 11;
    var maxW = this.w - this.margin * 2;
    var lines = wrapLine(text, size, maxW);
    var leading = size + 4;
    var self = this;
    lines.forEach(function (ln) {
      self.ensure(leading);
      var x = self.margin;
      if (opts.center) x = (self.w - textWidth(ln, size)) / 2;
      self.ops.push(
        'BT /F1 ' +
          size +
          ' Tf ' +
          x.toFixed(1) +
          ' ' +
          self.y.toFixed(1) +
          ' Td (' +
          pdfEscape(ln) +
          ') Tj ET'
      );
      self.y -= leading;
    });
  };

  PdfDoc.prototype.gap = function (n) {
    this.y -= n || 8;
  };

  PdfDoc.prototype.rule = function () {
    this.ensure(10);
    var y = this.y + 2;
    this.ops.push(
      '0.6 w ' +
        this.margin +
        ' ' +
        y.toFixed(1) +
        ' m ' +
        (this.w - this.margin) +
        ' ' +
        y.toFixed(1) +
        ' l S'
    );
    this.y -= 10;
  };

  PdfDoc.prototype.fromPlainText = function (text) {
    var self = this;
    String(text || '').split('\n').forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      if (!line) {
        self.gap(8);
        return;
      }
      if (/^[━─\-═]+$/.test(line) || line.indexOf('━━') === 0 || line.indexOf('──') === 0) {
        self.rule();
        return;
      }
      var size = 11;
      if (/^SHOT LIST$|^PRESHOOT PRODUCTION PACKAGE$|^END$/.test(line)) size = 14;
      if (/^SCENE |^SHOT |^PROJECT:|^PRODUCTION:|^TITLE:/.test(line)) size = 12;
      self.addLine(line, size);
    });
  };

  PdfDoc.prototype.build = function () {
    var self = this;
    var objs = [];
    function add(body) {
      objs.push(body);
      return objs.length;
    }
    add('<< /Type /Catalog /Pages 2 0 R >>');
    var pageIds = [];
    var contentIds = [];
    this.pages.forEach(function (ops, i) {
      var stream = ops.join('\n');
      var cid = 3 + i * 2;
      var pid = 4 + i * 2;
      contentIds.push(cid);
      pageIds.push(pid);
      /* placeholders; rewritten below */
    });
    var fontId = 3 + this.pages.length * 2;
    var infoId = fontId + 1;

    objs = [];
    add('<< /Type /Catalog /Pages 2 0 R >>');
    var kids = pageIds
      .map(function (id) {
        return id + ' 0 R';
      })
      .join(' ');
    /* page object numbers: 4,6,8... after we insert contents as 3,5,7 */
    var pageObjNums = [];
    var contentObjNums = [];
    var firstPage = 4;
    this.pages.forEach(function (_, i) {
      contentObjNums.push(3 + i * 2);
      pageObjNums.push(4 + i * 2);
    });
    fontId = 3 + this.pages.length * 2;
    infoId = fontId + 1;
    add(
      '<< /Type /Pages /Kids [' +
        pageObjNums
          .map(function (n) {
            return n + ' 0 R';
          })
          .join(' ') +
        '] /Count ' +
        self.pages.length +
        ' >>'
    );

    this.pages.forEach(function (ops, i) {
      var header =
        '0.45 g BT /F1 8 Tf ' +
        self.margin +
        ' ' +
        (self.h - 28) +
        ' Td (' +
        pdfEscape(self.title) +
        ') Tj ET 0 g';
      var footer =
        '0.45 g BT /F1 8 Tf ' +
        self.margin +
        ' 28 Td (' +
        pdfEscape('PreShoot  ·  ' + todayLabel() + '  ·  ' + (i + 1) + '/' + self.pages.length) +
        ') Tj ET 0 g';
      var stream = header + '\n' + ops.join('\n') + '\n' + footer;
      add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
      add(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ' +
          fontId +
          ' 0 R >> >> /Contents ' +
          contentObjNums[i] +
          ' 0 R >>'
      );
    });
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    add(
      '<< /Title (' +
        pdfEscape(self.title) +
        ') /Creator (PreShoot Studio) /Producer (PreShoot) /CreationDate (D:' +
        todayLabel().replace(/-/g, '') +
        ') >>'
    );

    var pdf = '%PDF-1.4\n';
    var offsets = [0];
    objs.forEach(function (body, idx) {
      offsets.push(pdf.length);
      pdf += idx + 1 + ' 0 obj\n' + body + '\nendobj\n';
    });
    var xrefAt = pdf.length;
    pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    for (var i = 1; i <= objs.length; i++) {
      pdf += ('0000000000' + offsets[i]).slice(-10) + ' 00000 n \n';
    }
    pdf +=
      'trailer\n<< /Size ' +
      (objs.length + 1) +
      ' /Root 1 0 R /Info ' +
      infoId +
      ' 0 R >>\nstartxref\n' +
      xrefAt +
      '\n%%EOF\n';
    return pdf;
  };

  function downloadPdf(filename, text, title) {
    var doc = new PdfDoc(title || filename);
    doc.fromPlainText(text);
    var pdf = doc.build();
    var blob = new Blob([pdf], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = global.document.createElement('a');
    a.href = url;
    a.download = filename || 'preshoot.pdf';
    global.document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      global.document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 400);
    return true;
  }

  function copyScript(productionId) {
    var b = findBundle(productionId);
    if (!b) return Promise.reject(new Error('not_found'));
    return copyText(formatScriptText(b));
  }
  function copyShotList(productionId) {
    var b = findBundle(productionId);
    if (!b) return Promise.reject(new Error('not_found'));
    return copyText(formatShotListText(b));
  }
  function exportScriptPdf(productionId) {
    var b = findBundle(productionId);
    if (!b) return false;
    return downloadPdf(
      slug(b.production.name) + '-script.pdf',
      formatScriptText(b),
      (b.production.name || 'Production') + ' — Script'
    );
  }
  function exportShotListPdf(productionId) {
    var b = findBundle(productionId);
    if (!b) return false;
    return downloadPdf(
      slug(b.production.name) + '-shotlist.pdf',
      formatShotListText(b),
      (b.production.name || 'Production') + ' — Shot List'
    );
  }
  function exportPackagePdf(productionId) {
    var b = findBundle(productionId);
    if (!b) return false;
    return downloadPdf(
      slug(b.production.name) + '-production-package.pdf',
      formatPackageText(b),
      (b.production.name || 'Production') + ' — Package'
    );
  }

  function slug(name) {
    return String(name || 'preshoot')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'preshoot';
  }

  global.PreShootStudioExport = {
    formatScriptText: formatScriptText,
    formatShotListText: formatShotListText,
    formatPackageText: formatPackageText,
    findBundle: findBundle,
    copyScript: copyScript,
    copyShotList: copyShotList,
    exportScriptPdf: exportScriptPdf,
    exportShotListPdf: exportShotListPdf,
    exportPackagePdf: exportPackagePdf,
    downloadPdf: downloadPdf,
    PdfDoc: PdfDoc
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
