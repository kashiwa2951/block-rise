/* ===== BLOCK RISE : game =====
 * ゲームループと状態機械。
 *
 * ロック後の解決フロー（このゲームの独自ルール）：
 *   LOCK → CLEARING（そろった行を消す）→ FALLING（最後のピースの残りが
 *   形を崩してバラバラに落ちる）→ そろっていれば CLEARING へ戻る（連鎖）→ SPAWN
 */
(function (global) {
  'use strict';

  var BB = global.BB = global.BB || {};
  var C = BB.Config;
  var P = BB.Pieces;

  var MAX_CHAIN = 20;   // 無限ループ防止

  var G = {
    board: null,
    bag: null,
    piece: null,
    holdType: null,
    canHold: true,

    phase: 'TITLE',     // TITLE / PLAYING / CLEARING / FALLING / SPAWN / PAUSED / OVER
    prevPhase: null,
    time: 0,

    score: 0, best: 0, level: 1, lines: 0, combo: 0, chain: 0,
    clearedThisLock: false,

    gravityTimer: 0, lockTimer: 0, lockResets: 0, softActive: false,

    riseTimer: 0, riseInterval: 0, pendingRiseRow: null,
    riseOverride: 0, warnPlayed: false,

    clearingRows: [], clearT: 0,
    fallAnims: [], fallT: 0, fallDur: 0,
    lastCells: [],
    spawnT: 0,

    ghostY: 0
  };

  var el = {};

  /* ---------- 便利関数 ---------- */

  function loadBest() {
    try { return parseInt(global.localStorage.getItem(C.LS_HIGHSCORE) || '0', 10) || 0; }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { global.localStorage.setItem(C.LS_HIGHSCORE, String(v)); } catch (e) {}
  }

  function toast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.classList.remove('show');
    void el.toast.offsetWidth;   // アニメーション再生のためリフロー
    el.toast.classList.add('show');
  }

  function pulse(node) {
    if (!node) return;
    var box = node.closest ? node.closest('.stat') : null;
    if (!box) return;
    box.classList.remove('pulse');
    void box.offsetWidth;
    box.classList.add('pulse');
  }

  /* ---------- HUD ---------- */

  function updateHud() {
    el.score.textContent = G.score.toLocaleString('en-US');
    el.best.textContent = G.best.toLocaleString('en-US');
    el.level.textContent = G.level;
    el.lines.textContent = G.lines;
    el.combo.textContent = G.combo > 1 ? G.combo : 0;
    el.chain.textContent = G.chain > 1 ? G.chain : 0;
  }

  function updateRiseMeter() {
    var interval = currentRiseInterval();
    var ratio = Math.max(0, Math.min(1, G.riseTimer / interval));
    el.riseFill.style.transform = 'scaleX(' + ratio + ')';
    var warn = G.riseTimer <= C.RISE_WARN && G.phase !== 'TITLE' && G.phase !== 'OVER';
    el.riseMeter.classList.toggle('warn', warn);
    el.riseLabel.textContent = (G.phase === 'TITLE' || G.phase === 'OVER')
      ? 'RISE'
      : 'RISE ' + G.riseTimer.toFixed(1) + 's';
  }

  function showOverlay(kind) {
    if (kind === null) { el.overlay.classList.remove('show'); return; }
    el.overlay.dataset.screen = kind;
    el.overlay.classList.add('show');

    if (kind === 'title') {
      el.ovTitle.textContent = 'BLOCK RISE';
      el.ovText.innerHTML = '土台がせり上がる落ちものパズル。<br>列をそろえて消し、崩れ落ちるブロックで連鎖を狙え。';
      el.ovScore.textContent = G.best > 0 ? 'BEST  ' + G.best.toLocaleString('en-US') : '';
      el.ovButton.textContent = 'ゲーム開始';
      el.ovHelpBtn.hidden = false;
    } else if (kind === 'pause') {
      el.ovTitle.textContent = 'PAUSE';
      el.ovText.innerHTML = '一時停止中です。<br><kbd>P</kbd> でも再開できます。';
      el.ovScore.textContent = 'SCORE  ' + G.score.toLocaleString('en-US');
      el.ovButton.textContent = '再開する';
      el.ovHelpBtn.hidden = false;
    } else if (kind === 'over') {
      el.ovTitle.textContent = 'GAME OVER';
      el.ovText.innerHTML = 'ブロックが天井に届きました。<br>LEVEL ' + G.level + ' / ' + G.lines + ' LINES';
      el.ovScore.textContent = 'SCORE  ' + G.score.toLocaleString('en-US') +
        (G.score >= G.best ? '　🏆 NEW BEST!' : '　BEST ' + G.best.toLocaleString('en-US'));
      el.ovButton.textContent = 'もう一度あそぶ';
      el.ovHelpBtn.hidden = true;
    }
  }

  /* ---------- せり上がり ---------- */

  function currentRiseInterval() {
    return G.riseOverride > 0 ? G.riseOverride : C.riseIntervalFor(G.level);
  }

  function resetRiseTimer() {
    G.riseInterval = currentRiseInterval();
    G.riseTimer = G.riseInterval;
    G.warnPlayed = false;
  }

  function doRise() {
    if (!G.board.canRise()) { gameOver(); return; }

    G.board.rise(G.pendingRiseRow);
    G.pendingRiseRow = G.board.makeRiseRow();

    // せり上がりで押し出されたブロックと操作中のピースが重なったら押し上げる
    if (G.piece) {
      var guard = 0;
      while (G.board.collides(G.piece.cells()) && guard++ < C.TOTAL_ROWS) G.piece.y--;
      if (G.board.collides(G.piece.cells())) { gameOver(); return; }
      G.lockTimer = 0;
    }

    BB.Audio.play('rise');
    BB.Render.addShake(7);
    resetRiseTimer();
  }

  /* ---------- ピース操作 ---------- */

  function canPlace(rot, x, y) {
    return !G.board.collides(G.piece.cells(rot, x, y));
  }

  function grounded() {
    return G.piece ? !canPlace(G.piece.rot, G.piece.x, G.piece.y + 1) : false;
  }

  function noteLockReset() {
    if (grounded() && G.lockResets < C.LOCK_RESET_MAX) {
      G.lockResets++;
      G.lockTimer = 0;
    }
  }

  function tryMove(dx, dy) {
    if (!G.piece || G.phase !== 'PLAYING') return false;
    if (!canPlace(G.piece.rot, G.piece.x + dx, G.piece.y + dy)) return false;
    G.piece.x += dx;
    G.piece.y += dy;
    return true;
  }

  function moveSide(dx) {
    if (tryMove(dx, 0)) {
      BB.Audio.play('move');
      noteLockReset();
    }
  }

  function rotate(dir) {
    if (!G.piece || G.phase !== 'PLAYING') return;
    var from = G.piece.rot;
    var to = (from + dir + 4) % 4;
    var kicks = P.kicksFor(G.piece.type);
    for (var i = 0; i < kicks.length; i++) {
      var nx = G.piece.x + kicks[i][0];
      var ny = G.piece.y + kicks[i][1];
      if (canPlace(to, nx, ny)) {
        G.piece.rot = to;
        G.piece.x = nx;
        G.piece.y = ny;
        BB.Audio.play('rotate');
        noteLockReset();
        return;
      }
    }
  }

  /* ソフトドロップを押した瞬間に 1 マスだけ落とす。
   * 押しっぱなしの連続落下は自然落下の処理側でやるので、ここは「押した手応え」担当。
   * これがないと、短いタップでは連続落下が 1 回も回らず、無反応に見えてしまう。 */
  function softStep() {
    if (!G.piece || G.phase !== 'PLAYING') return;
    if (tryMove(0, 1)) {
      G.score += C.SCORE_SOFT;
      G.gravityTimer = 0;   // 直後にもう 1 マス落ちないよう、間隔を測り直す
    }
  }

  function hardDrop() {
    if (!G.piece || G.phase !== 'PLAYING') return;
    var y = G.board.dropY(G.piece);
    var dist = y - G.piece.y;
    G.piece.y = y;
    if (dist > 0) G.score += dist * C.SCORE_HARD;
    BB.Audio.play('hardDrop');
    BB.Render.addShake(3 + Math.min(6, dist * 0.35));
    lockPiece();
  }

  function holdPiece() {
    if (!G.piece || G.phase !== 'PLAYING' || !G.canHold) return;
    var current = G.piece.type;
    var next = G.holdType;
    G.holdType = current;
    G.canHold = false;

    G.piece = new P.Piece(next || G.bag.next());
    G.gravityTimer = 0;
    G.lockTimer = 0;
    G.lockResets = 0;

    BB.Audio.play('hold');
    if (G.board.collides(G.piece.cells())) { gameOver(); return; }
    refreshPreviews();
  }

  function refreshPreviews() {
    BB.Render.drawNext(G.bag.peek(3));
    BB.Render.drawHold(G.holdType, G.canHold);
  }

  /* ---------- ロック後の解決 ---------- */

  function lockPiece() {
    if (!G.piece) return;
    var cells = G.board.lockPiece(G.piece);
    G.lastCells = cells;

    BB.Audio.play('lock');
    BB.Render.addShake(2);

    // ロックアウト：ピース全体が天井より上で固定されたら終了
    var allAbove = cells.every(function (p) { return p.r < C.BUFFER_ROWS; });
    G.piece = null;
    if (allAbove) { gameOver(); return; }

    G.chain = 0;
    G.clearedThisLock = false;
    checkClears();
  }

  function checkClears() {
    var full = G.board.fullRows();
    if (full.length > 0 && G.chain < MAX_CHAIN) {
      startClear(full);
    } else {
      endResolve();
    }
  }

  function startClear(rows) {
    G.phase = 'CLEARING';
    G.clearingRows = rows;
    G.clearT = 0;
    G.chain++;
    G.clearedThisLock = true;

    rows.forEach(function (r) { BB.Render.burstRow(r); });
    BB.Audio.play('clear', rows.length);
    BB.Render.addShake(3 + rows.length * 2);

    if (G.chain >= 2) {
      BB.Audio.play('chain', G.chain);
      toast(G.chain + ' CHAIN!');
    } else if (rows.length === 4) {
      toast('QUAD!');
    }
  }

  function finishClear() {
    var rows = G.clearingRows;
    var doomed = {};
    rows.forEach(function (r) { doomed[r] = true; });

    /* --- スコア --- */
    var n = rows.length;
    var base = C.SCORE_LINES[Math.min(4, n)] || (800 + (n - 4) * 250);
    var gained = Math.round(base * G.level * C.chainMultiplier(G.chain));
    G.score += gained;
    G.lines += n;

    var newLevel = Math.floor(G.lines / C.LINES_PER_LEVEL) + 1;
    if (newLevel > G.level) {
      G.level = newLevel;
      BB.Audio.play('levelUp');
      toast('LEVEL ' + G.level);
      G.riseInterval = currentRiseInterval();
      if (G.riseTimer > G.riseInterval) G.riseTimer = G.riseInterval;
    }

    /* --- 消去して詰める --- */
    var survivors = [];
    G.lastCells.forEach(function (p) {
      if (doomed[p.r]) return;                                  // 消えた行のセルは消滅
      survivors.push({ r: G.board.mapRowAfterClear(p.r, rows), c: p.c });
    });
    G.board.clearRows(rows);
    G.clearingRows = [];

    /* --- ★ 最後のピースの残りを、形を崩してバラバラに落とす --- */
    if (survivors.length === 0) {
      G.lastCells = [];
      checkClears();
      return;
    }

    var moves = G.board.dropCellsApart(survivors);
    G.lastCells = moves.map(function (m) { return { r: m.toR, c: m.c }; });

    var moving = moves.filter(function (m) { return m.dist > 0; });
    if (moving.length === 0) { checkClears(); return; }

    var maxDist = 0;
    moving.forEach(function (m) { if (m.dist > maxDist) maxDist = m.dist; });

    G.fallAnims = moving;
    G.fallT = 0;
    G.fallDur = Math.max(C.FALL_MIN_ANIM, maxDist * C.FALL_PER_CELL);
    G.phase = 'FALLING';
  }

  function finishFall() {
    G.fallAnims.forEach(function (m) { BB.Render.landPuff(m.c, m.toR); });
    G.fallAnims = [];
    BB.Render.addShake(2);
    checkClears();
  }

  function endResolve() {
    if (G.clearedThisLock) {
      G.combo++;
      if (G.combo > 1) {
        G.score += C.SCORE_COMBO * (G.combo - 1) * G.level;
        toast('COMBO x' + G.combo);
      }
    } else {
      G.combo = 0;
    }
    G.phase = 'SPAWN';
    G.spawnT = 0;
    updateHud();
  }

  function spawnPiece() {
    G.piece = new P.Piece(G.bag.next());
    G.canHold = true;
    G.gravityTimer = 0;
    G.lockTimer = 0;
    G.lockResets = 0;
    refreshPreviews();

    if (G.board.collides(G.piece.cells())) { gameOver(); return; }
    G.phase = 'PLAYING';
  }

  /* ---------- 進行 ---------- */

  function updatePlaying(dt) {
    BB.Input.update(dt);

    // せり上がり
    G.riseTimer -= dt;
    if (!G.warnPlayed && G.riseTimer <= C.RISE_WARN) {
      G.warnPlayed = true;
      BB.Audio.play('warn');
    }
    if (G.riseTimer <= 0) {
      doRise();
      if (G.phase !== 'PLAYING') return;
    }

    if (!G.piece) return;

    // 自然落下 ＋ ソフトドロップ
    var soft = BB.Input.state.softDrop;
    var interval = C.gravityFor(G.level);
    if (soft) interval = Math.min(interval, C.SOFT_DROP_INTERVAL);

    // ソフトドロップの入り／切りでは、たまっていた落下タイマーを捨てる。
    // 持ち越すと、間隔が一気に短くなった瞬間に貯金ぶんがまとめて消費され、
    // 1 フレームで何マスも落ちてしまう。
    if (soft !== G.softActive) {
      G.softActive = soft;
      G.gravityTimer = 0;
    }

    G.gravityTimer += dt;
    var guard = 0;
    var maxSteps = soft ? C.SOFT_DROP_MAX_STEPS : 24;
    while (G.gravityTimer >= interval && guard++ < maxSteps) {
      G.gravityTimer -= interval;
      if (tryMove(0, 1)) {
        if (soft) G.score += C.SCORE_SOFT;
      } else {
        G.gravityTimer = 0;
        break;
      }
    }

    // 接地からの固定猶予
    if (grounded()) {
      G.lockTimer += dt;
      if (G.lockTimer >= C.LOCK_DELAY) lockPiece();
    } else {
      G.lockTimer = 0;
    }

    if (G.piece) G.ghostY = G.board.dropY(G.piece);
  }

  function update(dt) {
    G.time += dt;

    switch (G.phase) {
      case 'PLAYING':
        updatePlaying(dt);
        break;
      case 'CLEARING':
        G.clearT += dt;
        if (G.clearT >= C.CLEAR_ANIM) finishClear();
        break;
      case 'FALLING':
        G.fallT += dt;
        if (G.fallT >= G.fallDur) finishFall();
        break;
      case 'SPAWN':
        G.spawnT += dt;
        if (G.spawnT >= C.SPAWN_DELAY) spawnPiece();
        break;
    }
  }

  /* ---------- ループ ---------- */

  var lastTs = 0, rafId = 0;

  function frame(ts) {
    rafId = global.requestAnimationFrame(frame);
    if (!lastTs) lastTs = ts;
    var dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    var active = G.phase !== 'TITLE' && G.phase !== 'OVER' && G.phase !== 'PAUSED';
    if (active) update(dt);

    BB.Render.drawBoard({
      board: G.board,
      piece: G.piece,
      ghostY: G.ghostY,
      phase: (G.phase === 'SPAWN') ? 'PLAYING' : G.phase,
      clearingRows: G.clearingRows,
      clearT: G.clearT,
      fallAnims: G.fallAnims,
      fallT: G.fallT,
      showGhost: true,
      risePreview: G.pendingRiseRow,
      riseWarn: active && G.riseTimer <= C.RISE_WARN,
      time: G.time
    }, dt);

    if (active) { updateHud(); updateRiseMeter(); }
  }

  /* ---------- ゲーム開始 / 終了 ---------- */

  function reset() {
    G.board = new BB.Board();
    G.bag = new P.Bag();
    G.piece = null;
    G.holdType = null;
    G.canHold = true;
    G.score = 0; G.level = 1; G.lines = 0; G.combo = 0; G.chain = 0;
    G.clearedThisLock = false;
    G.gravityTimer = 0; G.lockTimer = 0; G.lockResets = 0; G.softActive = false;
    G.clearingRows = []; G.clearT = 0;
    G.fallAnims = []; G.fallT = 0; G.fallDur = 0;
    G.lastCells = []; G.spawnT = 0; G.time = 0;
    G.pendingRiseRow = G.board.makeRiseRow();
    resetRiseTimer();
    BB.Render.clearParticles();
    BB.Input.releaseAll();
    updateHud();
    updateRiseMeter();
    refreshPreviews();
  }

  function start() {
    reset();
    showOverlay(null);
    BB.Audio.unlock();
    BB.Audio.play('start');
    spawnPiece();
  }

  function gameOver() {
    G.phase = 'OVER';
    G.piece = null;
    if (G.score > G.best) { G.best = G.score; saveBest(G.best); }
    BB.Audio.play('gameOver');
    BB.Render.addShake(10);
    updateHud();
    showOverlay('over');
  }

  function togglePause() {
    if (G.phase === 'PAUSED') {
      G.phase = G.prevPhase || 'PLAYING';
      G.prevPhase = null;
      showOverlay(null);
    } else if (G.phase !== 'TITLE' && G.phase !== 'OVER') {
      G.prevPhase = G.phase;
      G.phase = 'PAUSED';
      BB.Input.releaseAll();
      showOverlay('pause');
    }
  }

  /* アイコンの絵は CSS が off クラスを見て切り替えるので、ここでは状態だけ伝える */
  function applySoundIcon(muted) {
    el.btnSound.classList.toggle('off', muted);
    el.btnSound.setAttribute('aria-label', muted ? 'サウンドを出す' : 'サウンドを消す');
  }

  function toggleSound() {
    var muted = BB.Audio.toggle();
    applySoundIcon(muted);
    if (!muted) BB.Audio.play('rotate');
  }

  function showHelp(on) {
    if (on) {
      el.help.hidden = false;
      el.help.classList.add('show');
      if (G.phase === 'PLAYING' || G.phase === 'CLEARING' || G.phase === 'FALLING' || G.phase === 'SPAWN') {
        togglePause();
      }
    } else {
      el.help.classList.remove('show');
      el.help.hidden = true;
    }
  }

  /* ---------- 入力アクション ---------- */

  var actions = {
    moveLeft:  function () { moveSide(-1); },
    moveRight: function () { moveSide(1); },
    rotateCW:  function () { rotate(1); },
    rotateCCW: function () { rotate(-1); },
    softStep:  softStep,
    hardDrop:  hardDrop,
    hold:      holdPiece,
    pause:     function () { if (!el.help.hidden) { showHelp(false); return; } togglePause(); },
    restart:   function () { if (G.phase !== 'TITLE') start(); },
    toggleSound: toggleSound,
    confirm:   function () {
      if (!el.help.hidden) { showHelp(false); return; }
      if (G.phase === 'TITLE' || G.phase === 'OVER') start();
      else if (G.phase === 'PAUSED') togglePause();
    }
  };

  /* ---------- 起動 ---------- */

  function init() {
    el.overlay   = document.getElementById('overlay');
    el.ovTitle   = document.getElementById('ov-title');
    el.ovText    = document.getElementById('ov-text');
    el.ovScore   = document.getElementById('ov-score');
    el.ovButton  = document.getElementById('ov-button');
    el.ovHelpBtn = document.getElementById('ov-help-btn');
    el.toast     = document.getElementById('toast');
    el.help      = document.getElementById('help');
    el.riseMeter = document.getElementById('rise-meter');
    el.riseFill  = document.getElementById('rise-fill');
    el.riseLabel = document.getElementById('rise-label');
    el.btnSound  = document.getElementById('btn-sound');
    el.btnPause  = document.getElementById('btn-pause');
    el.btnHelp   = document.getElementById('btn-help');
    el.score = document.getElementById('st-score');
    el.best  = document.getElementById('st-best');
    el.level = document.getElementById('st-level');
    el.lines = document.getElementById('st-lines');
    el.combo = document.getElementById('st-combo');
    el.chain = document.getElementById('st-chain');

    BB.Render.init();
    BB.Input.init(actions);

    G.best = loadBest();
    reset();
    G.phase = 'TITLE';
    showOverlay('title');

    applySoundIcon(BB.Audio.isMuted());

    el.ovButton.addEventListener('click', function () {
      if (G.phase === 'PAUSED') togglePause();
      else start();
    });
    el.ovHelpBtn.addEventListener('click', function () { showHelp(true); });
    el.btnHelp.addEventListener('click', function () { showHelp(true); });
    document.getElementById('help-close').addEventListener('click', function () { showHelp(false); });
    el.btnPause.addEventListener('click', function () { togglePause(); });
    el.btnSound.addEventListener('click', toggleSound);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && (G.phase === 'PLAYING' || G.phase === 'SPAWN')) togglePause();
    });

    global.addEventListener('resize', function () { refreshPreviews(); });

    lastTs = 0;
    rafId = global.requestAnimationFrame(frame);
  }

  /* ---------- デバッグ用フック（動作検証に使用） ---------- */

  BB.debug = {
    G: G,
    /* 文字列配列から盤面を作る。'.' は空、それ以外は色キー
       （4マス: I O T S Z J L / 3マス: D V / '#'=G）。
       配列は下端そろえで配置される。 */
    setBoard: function (rows) {
      G.board.reset();
      var start = C.TOTAL_ROWS - rows.length;
      rows.forEach(function (str, i) {
        for (var c = 0; c < C.COLS; c++) {
          var ch = str.charAt(c) || '.';
          if (ch === '.' || ch === ' ') continue;
          G.board.set(start + i, c, ch === '#' ? 'G' : ch.toUpperCase());
        }
      });
      return BB.debug.dump();
    },
    dump: function () {
      var out = [];
      for (var r = C.BUFFER_ROWS; r < C.TOTAL_ROWS; r++) {
        var s = '';
        for (var c = 0; c < C.COLS; c++) s += (G.board.grid[r][c] || '.');
        out.push(s);
      }
      return out;
    },
    spawn: function (type, x, rot) {
      G.piece = new P.Piece(type);
      if (rot) G.piece.rot = rot % 4;
      if (x !== undefined && x !== null) G.piece.x = x;
      G.phase = 'PLAYING';
      G.lockTimer = 0;
      G.gravityTimer = 0;
      return { x: G.piece.x, y: G.piece.y, rot: G.piece.rot };
    },
    drop: function () { hardDrop(); return G.phase; },
    /* ゲームループを手動で進める。requestAnimationFrame に頼らず、
     * 決まった時間ぶんだけ進めて挙動を確かめたいときに使う。
     *   BB.debug.step(1.0)        → 1 秒ぶん進める（1/60 秒刻み）
     *   BB.debug.step(1.0, 1/120) → 刻み幅を指定 */
    step: function (seconds, slice) {
      var dt = slice || (1 / 60);
      var n = Math.max(1, Math.round((seconds || dt) / dt));
      for (var i = 0; i < n; i++) update(dt);
      return BB.debug.state();
    },
    forceRise: function () { doRise(); return BB.debug.dump(); },
    setRiseInterval: function (sec) { G.riseOverride = sec || 0; resetRiseTimer(); return currentRiseInterval(); },
    pauseTimers: function () { G.riseOverride = 99999; resetRiseTimer(); },
    start: start,
    state: function () {
      return {
        phase: G.phase, score: G.score, level: G.level, lines: G.lines,
        combo: G.combo, chain: G.chain, riseTimer: G.riseTimer,
        piece: G.piece ? { type: G.piece.type, x: G.piece.x, y: G.piece.y, rot: G.piece.rot } : null,
        hold: G.holdType, next: G.bag ? G.bag.peek(3) : []
      };
    }
  };

  BB.Game = { init: init, start: start, actions: actions };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(typeof window !== 'undefined' ? window : this);
