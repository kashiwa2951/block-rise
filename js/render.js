/* ===== BLOCK RISE : render =====
 * Canvas 2D 描画。盤面・ゴースト・消去フラッシュ・崩れ落ちアニメ・パーティクル・
 * NEXT / HOLD のミニ表示をまとめて担当します。
 */
(function (global) {
  'use strict';

  var BB = global.BB = global.BB || {};
  var C = BB.Config;
  var P = BB.Pieces;

  var boardCanvas, bctx, nextCanvas, nctx, holdCanvas, hctx, wrapEl;
  var cell = 24, dpr = 1;
  var particles = [];
  var shake = { t: 0, mag: 0 };

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function colorOf(key) {
    return C.COLORS[key] || C.COLORS.G;
  }

  /* 角丸＋グラデーション＋上面ハイライトのブロック */
  function drawBlock(ctx, px, py, s, key, alpha, scale) {
    var col = colorOf(key);
    ctx.save();
    if (alpha !== undefined && alpha !== 1) ctx.globalAlpha = alpha;
    if (scale && scale !== 1) {
      var cx = px + s / 2, cy = py + s / 2;
      ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy);
    }

    var pad = Math.max(0.8, s * 0.05);
    var x = px + pad, y = py + pad, w = s - pad * 2, h = s - pad * 2;
    var r = Math.max(2, s * 0.24);

    var g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, col.light);
    g.addColorStop(0.45, col.base);
    g.addColorStop(1, col.dark);
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = g;
    ctx.fill();

    // 内側の面
    var ip = h * 0.15;
    roundRect(ctx, x + ip, y + ip * 0.8, w - ip * 2, h - ip * 1.85, r * 0.6);
    ctx.fillStyle = col.base;
    ctx.fill();

    // 上面の光沢
    var gl = ctx.createLinearGradient(x, y + ip * 0.8, x, y + h * 0.5);
    gl.addColorStop(0, 'rgba(255,255,255,0.42)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    roundRect(ctx, x + ip, y + ip * 0.8, w - ip * 2, h * 0.42, r * 0.6);
    ctx.fillStyle = gl;
    ctx.fill();

    ctx.restore();
  }

  /* 空マスの薄いガイド */
  function drawCellGuide(ctx, px, py, s) {
    var pad = Math.max(0.8, s * 0.05);
    roundRect(ctx, px + pad, py + pad, s - pad * 2, s - pad * 2, Math.max(2, s * 0.22));
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();
  }

  /* ---------- サイズ調整 ---------- */

  /* 盤面のまわりに描く枠線ぶんの余白（px）。CSS の #board の box-shadow に対応。 */
  var BOARD_FRAME = 6;

  /* 盤面の左右にタッチ操作用の余白を取るレイアウトかどうか */
  function isTouchLayout() {
    return !!(global.matchMedia &&
      global.matchMedia('(max-width: 720px), (pointer: coarse)').matches);
  }

  function fitBoard() {
    if (!wrapEl) return;
    dpr = Math.min(global.devicePixelRatio || 1, 2.5);

    // レイアウト前で測れないときは、ウィンドウサイズから概算する
    var availW = wrapEl.clientWidth || (global.innerWidth * 0.9);
    var availH = wrapEl.clientHeight || (global.innerHeight * 0.6);

    // 盤面のまわりの枠線（CSS の #board の box-shadow）が
    // #board-wrap の overflow:hidden で切れないよう、そのぶんを空けておく
    availW -= BOARD_FRAME * 2;
    availH -= BOARD_FRAME * 2;

    // タッチ操作時は、盤面の左右に指を置くための余白を確保する
    var gutter = isTouchLayout()
      ? Math.max(C.TOUCH_GUTTER_MIN, Math.min(C.TOUCH_GUTTER_MAX, availW * C.TOUCH_GUTTER_RATIO))
      : 0;
    var usableW = Math.max(C.COLS * 6, availW - gutter * 2);

    var s = Math.floor(Math.min(usableW / C.COLS, availH / C.VISIBLE_ROWS));
    s = Math.max(6, s);
    cell = s;

    var cssW = s * C.COLS, cssH = s * C.VISIBLE_ROWS;
    boardCanvas.style.width = cssW + 'px';
    boardCanvas.style.height = cssH + 'px';
    boardCanvas.width = Math.round(cssW * dpr);
    boardCanvas.height = Math.round(cssH * dpr);
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* 大きさは CSS が決める。ここでは実寸に合わせて解像度だけ合わせる。 */
  function fitMini(canvas, ctx) {
    var cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    if (!cssW || !cssH) return;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resize() {
    fitBoard();
    fitMini(holdCanvas, hctx);
    fitMini(nextCanvas, nctx);
  }

  /* ---------- パーティクル ---------- */

  function burstRow(row, boardTop) {
    var y = (row - C.BUFFER_ROWS) * cell + cell / 2;
    for (var i = 0; i < C.COLS * 3; i++) {
      var x = Math.random() * C.COLS * cell;
      particles.push({
        x: x, y: y + (Math.random() - 0.5) * cell,
        vx: (Math.random() - 0.5) * 320,
        vy: (Math.random() - 0.5) * 260 - 40,
        life: 0, max: 0.42 + Math.random() * 0.34,
        size: cell * (0.12 + Math.random() * 0.16),
        hue: ['#ffffff', '#a5f3fc', '#fde68a', '#c084fc'][i % 4]
      });
    }
  }

  function landPuff(col, row) {
    var x = col * cell + cell / 2;
    var y = (row - C.BUFFER_ROWS) * cell + cell / 2;
    for (var i = 0; i < 5; i++) {
      particles.push({
        x: x, y: y,
        vx: (Math.random() - 0.5) * 140,
        vy: -Math.random() * 90,
        life: 0, max: 0.26 + Math.random() * 0.18,
        size: cell * 0.1,
        hue: 'rgba(255,255,255,0.9)'
      });
    }
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life += dt;
      if (p.life >= p.max) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 900 * dt;
      p.vx *= 0.98;
    }
  }

  function drawParticles(ctx) {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var a = 1 - p.life / p.max;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.hue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function addShake(mag) {
    shake.mag = Math.max(shake.mag, mag);
    shake.t = 0.22;
  }

  /* ---------- 盤面描画 ---------- */

  function easeIn(t) { return t * t; }

  function drawBoard(state, dt) {
    if (!bctx) return;
    var ctx = bctx;
    var W = C.COLS * cell, H = C.VISIBLE_ROWS * cell;

    updateParticles(dt);

    ctx.save();
    ctx.clearRect(0, 0, W, H);

    if (shake.t > 0) {
      shake.t -= dt;
      var k = Math.max(0, shake.t / 0.22) * shake.mag;
      ctx.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
      if (shake.t <= 0) shake.mag = 0;
    }

    // 背景グリッド
    for (var gr = 0; gr < C.VISIBLE_ROWS; gr++) {
      for (var gc = 0; gc < C.COLS; gc++) {
        drawCellGuide(ctx, gc * cell, gr * cell, cell);
      }
    }

    var board = state.board;
    var clearing = state.clearingRows || [];
    var clearT = state.clearT || 0;
    var isClearing = state.phase === 'CLEARING' && clearing.length > 0;

    // 落下アニメ中のセルは、盤面側では描かず後でアニメ位置に描く
    var animHidden = {};
    var anims = (state.phase === 'FALLING') ? (state.fallAnims || []) : [];
    for (var ai = 0; ai < anims.length; ai++) {
      animHidden[anims[ai].toR + ':' + anims[ai].c] = true;
    }

    var clearSet = {};
    clearing.forEach(function (r) { clearSet[r] = true; });

    // 固定ブロック
    for (var r = C.BUFFER_ROWS; r < C.TOTAL_ROWS; r++) {
      for (var c = 0; c < C.COLS; c++) {
        var key = board.grid[r][c];
        if (!key) continue;
        if (animHidden[r + ':' + c]) continue;

        var px = c * cell, py = (r - C.BUFFER_ROWS) * cell;

        if (isClearing && clearSet[r]) {
          var t = Math.min(1, clearT / C.CLEAR_ANIM);
          drawBlock(ctx, px, py, cell, key, 1 - t * 0.55, 1 - t * 0.35);
          ctx.save();
          ctx.globalAlpha = 0.85 * (1 - t);
          roundRect(ctx, px + cell * 0.05, py + cell * 0.05, cell * 0.9, cell * 0.9, cell * 0.24);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.restore();
        } else {
          drawBlock(ctx, px, py, cell, key);
        }
      }
    }

    // 崩れ落ちるブロック（★独自ルールの見せ場）
    for (var i = 0; i < anims.length; i++) {
      var a = anims[i];
      var dist = a.toR - a.fromR;
      var dur = Math.max(C.FALL_MIN_ANIM, dist * C.FALL_PER_CELL);
      var tt = Math.min(1, (state.fallT || 0) / dur);
      var rr = a.fromR + dist * easeIn(tt);
      var ax = a.c * cell, ay = (rr - C.BUFFER_ROWS) * cell;

      if (tt < 1) {
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = colorOf(a.type).base;
        roundRect(ctx, ax + cell * 0.28, (a.fromR - C.BUFFER_ROWS) * cell, cell * 0.44, (rr - a.fromR) * cell, cell * 0.2);
        ctx.fill();
        ctx.restore();
      }
      drawBlock(ctx, ax, ay, cell, a.type);
    }

    // ゴースト
    if (state.piece && state.showGhost && state.phase === 'PLAYING') {
      var gcells = state.piece.cells(state.piece.rot, state.piece.x, state.ghostY);
      for (var gi = 0; gi < gcells.length; gi++) {
        var gp = gcells[gi];
        if (gp.r < C.BUFFER_ROWS) continue;
        var gx = gp.c * cell, gy = (gp.r - C.BUFFER_ROWS) * cell;
        var gcol = colorOf(state.piece.type);
        ctx.save();
        ctx.globalAlpha = 0.30;
        roundRect(ctx, gx + cell * 0.09, gy + cell * 0.09, cell * 0.82, cell * 0.82, cell * 0.2);
        ctx.lineWidth = Math.max(1.5, cell * 0.075);
        ctx.strokeStyle = gcol.light;
        ctx.stroke();
        ctx.fillStyle = gcol.base;
        ctx.globalAlpha = 0.12;
        ctx.fill();
        ctx.restore();
      }
    }

    // 操作中のピース
    if (state.piece && (state.phase === 'PLAYING')) {
      var pc = state.piece.cells();
      for (var pi = 0; pi < pc.length; pi++) {
        var p = pc[pi];
        if (p.r < C.BUFFER_ROWS) continue;
        drawBlock(ctx, p.c * cell, (p.r - C.BUFFER_ROWS) * cell, cell, state.piece.type);
      }
    }

    drawParticles(ctx);

    // せり上がり予告（下端の帯。塞がる列＝実線、穴＝すき間）
    if (state.risePreview && state.riseWarn) {
      var pulse = 0.45 + 0.45 * Math.abs(Math.sin(state.time * 7));
      var bh = Math.max(3, cell * 0.17);
      ctx.save();
      ctx.globalAlpha = pulse;
      for (var rc = 0; rc < C.COLS; rc++) {
        if (!state.risePreview[rc]) continue;
        roundRect(ctx, rc * cell + cell * 0.08, H - bh, cell * 0.84, bh, bh * 0.4);
        ctx.fillStyle = '#ff5b7a';
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.restore();
  }

  /* ---------- NEXT / HOLD ---------- */

  function drawPieceInBox(ctx, type, x, y, w, h, alpha) {
    if (!type) return;
    var b = P.boundsOf(type, 0);
    var s = Math.min(w / (b.w + 0.7), h / (b.h + 0.7));
    var ox = x + (w - b.w * s) / 2 - b.minC * s;
    var oy = y + (h - b.h * s) / 2 - b.minR * s;
    var cells = P.SHAPES[type][0];
    for (var i = 0; i < cells.length; i++) {
      drawBlock(ctx, ox + cells[i].c * s, oy + cells[i].r * s, s, type, alpha);
    }
  }

  /* 縦長なら 3 つを縦積み、横長なら横並びで描く（スマホ用の帯レイアウト対応） */
  function drawNext(types) {
    if (!nctx) return;
    var w = nextCanvas.width / dpr, h = nextCanvas.height / dpr;
    if (!w || !h) return;
    nctx.clearRect(0, 0, w, h);
    var horizontal = w > h;
    for (var i = 0; i < 3; i++) {
      var alpha = (i === 0) ? 1 : 0.62;
      if (horizontal) drawPieceInBox(nctx, types[i], i * (w / 3), 0, w / 3, h, alpha);
      else drawPieceInBox(nctx, types[i], 0, i * (h / 3), w, h / 3, alpha);
    }
  }

  function drawHold(type, usable) {
    if (!hctx) return;
    var w = holdCanvas.width / dpr, h = holdCanvas.height / dpr;
    hctx.clearRect(0, 0, w, h);
    drawPieceInBox(hctx, type, 0, 0, w, h, usable ? 1 : 0.3);
  }

  /* ---------- 初期化 ---------- */

  function init() {
    boardCanvas = document.getElementById('board');
    nextCanvas = document.getElementById('next-canvas');
    holdCanvas = document.getElementById('hold-canvas');
    wrapEl = document.getElementById('board-wrap');
    bctx = boardCanvas.getContext('2d');
    nctx = nextCanvas.getContext('2d');
    hctx = holdCanvas.getContext('2d');
    resize();
    global.addEventListener('resize', resize);
    if (global.visualViewport) global.visualViewport.addEventListener('resize', resize);
  }

  BB.Render = {
    init: init,
    resize: resize,
    drawBoard: drawBoard,
    drawNext: drawNext,
    drawHold: drawHold,
    burstRow: burstRow,
    landPuff: landPuff,
    addShake: addShake,
    clearParticles: function () { particles.length = 0; },
    metrics: function () {
      return { cell: cell, canvas: boardCanvas, rect: boardCanvas.getBoundingClientRect() };
    }
  };

})(typeof window !== 'undefined' ? window : this);
