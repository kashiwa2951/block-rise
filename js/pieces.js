/* ===== BLOCK RISE : pieces =====
 * ピース9種（4マス7種 + 3マス2種）の形状・回転（独自の壁ぎわ補正つき）・
 * 袋方式のランダマイザ。
 */
(function (global) {
  'use strict';

  var BB = global.BB = global.BB || {};
  var C = BB.Config;

  /* 回転状態0の形。1 がブロック。 */
  var BASE = {
    I: [[0, 0, 0, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0],
        [0, 0, 0, 0]],
    J: [[1, 0, 0],
        [1, 1, 1],
        [0, 0, 0]],
    L: [[0, 0, 1],
        [1, 1, 1],
        [0, 0, 0]],
    O: [[1, 1],
        [1, 1]],
    S: [[0, 1, 1],
        [1, 1, 0],
        [0, 0, 0]],
    T: [[0, 1, 0],
        [1, 1, 1],
        [0, 0, 0]],
    Z: [[1, 1, 0],
        [0, 1, 1],
        [0, 0, 0]],

    /* --- 3マスピース ---
     * せり上がってくる行の穴を埋めやすい小回りのきく形。
     * D = まっすぐ 3 マス、V = かぎ形 3 マス。 */
    D: [[0, 0, 0],
        [1, 1, 1],
        [0, 0, 0]],
    V: [[1, 0],
        [1, 1]]
  };

  var TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z', 'D', 'V'];

  /* 袋に入れる中身。この並びが 1 巡ぶんとしてシャッフルされて配られます。
   * 同じ種類を 2 回書けば、その種類だけ出やすくできます。 */
  var BAG_SET = ['I', 'J', 'L', 'O', 'S', 'T', 'Z', 'D', 'V'];

  function rotateCW(m) {
    var n = m.length, out = [], r, c;
    for (r = 0; r < n; r++) {
      out.push([]);
      for (c = 0; c < n; c++) out[r].push(m[n - 1 - c][r]);
    }
    return out;
  }

  /* 各ピースの回転4状態を、セル座標リストとして事前計算しておく */
  var SHAPES = {};   // SHAPES[type][rot] = [{r, c}, ...]
  var MATRIX = {};   // MATRIX[type][rot] = 行列（描画のガイド用）
  (function build() {
    TYPES.forEach(function (t) {
      var m = BASE[t];
      SHAPES[t] = [];
      MATRIX[t] = [];
      for (var rot = 0; rot < 4; rot++) {
        var cells = [];
        for (var r = 0; r < m.length; r++) {
          for (var c = 0; c < m.length; c++) {
            if (m[r][c]) cells.push({ r: r, c: c });
          }
        }
        SHAPES[t].push(cells);
        MATRIX[t].push(m);
        m = rotateCW(m);
      }
    });
  })();

  /* --- 回転補正（キック）テーブル ---
   * 「回転前→回転後」の組み合わせごとに別々の表を持つ方式は採らず、
   * どの回転でも同じ順番で候補位置を試す、方向に依存しない方式にしています。
   * 表が 2 つだけで済むぶん挙動が読みやすく、壁ぎわでも直感どおりに回ります。
   *
   * 各要素は [dx, dy]。dy が正で下向き（盤面座標）。試す順番は
   *   1. その場  →  2. 左右に 1  →  3. 上に 1  →  4. 斜め上に 1
   */
  var KICKS_NARROW = [
    [0, 0],
    [-1, 0], [1, 0],
    [0, -1],
    [-1, -1], [1, -1]
  ];

  /* I ピースは横に 4 マスあるので、2 マスぶんの横補正まで見る */
  var KICKS_LONG = [
    [0, 0],
    [-1, 0], [1, 0],
    [-2, 0], [2, 0],
    [0, -1],
    [-1, -1], [1, -1]
  ];

  var NO_KICK = [[0, 0]];

  function kicksFor(type) {
    if (type === 'O') return NO_KICK;          // O は回しても形が変わらない
    return (type === 'I') ? KICKS_LONG : KICKS_NARROW;
  }

  /* --- ピース --- */

  function Piece(type) {
    this.type = type;
    this.rot = 0;
    var cells = SHAPES[type][0];
    var size = BASE[type].length;

    // 形の最上段が、天井のすぐ下（最初の可視行）に来るように配置する
    var minR = Infinity, minC = Infinity, maxC = -Infinity;
    cells.forEach(function (p) {
      if (p.r < minR) minR = p.r;
      if (p.c < minC) minC = p.c;
      if (p.c > maxC) maxC = p.c;
    });
    var width = maxC - minC + 1;

    this.y = C.BUFFER_ROWS - minR;
    this.x = Math.floor((C.COLS - width) / 2) - minC;
    this.size = size;
  }

  /* 現在位置での占有セル（盤面座標） */
  Piece.prototype.cells = function (rot, x, y) {
    rot = (rot === undefined) ? this.rot : rot;
    x = (x === undefined) ? this.x : x;
    y = (y === undefined) ? this.y : y;
    var out = [];
    var shape = SHAPES[this.type][rot];
    for (var i = 0; i < shape.length; i++) {
      out.push({ r: y + shape[i].r, c: x + shape[i].c });
    }
    return out;
  };

  Piece.prototype.clone = function () {
    var p = Object.create(Piece.prototype);
    p.type = this.type; p.rot = this.rot; p.x = this.x; p.y = this.y; p.size = this.size;
    return p;
  };

  /* --- 袋方式のランダマイザ（BAG_SET を1巡ぶんずつシャッフルして配る） --- */

  function Bag() {
    this.queue = [];
    this.refill();
    this.refill();
  }

  Bag.prototype.refill = function () {
    var bag = BAG_SET.slice();
    for (var i = bag.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = bag[i]; bag[i] = bag[j]; bag[j] = t;
    }
    this.queue = this.queue.concat(bag);
  };

  Bag.prototype.next = function () {
    if (this.queue.length <= BAG_SET.length) this.refill();
    return this.queue.shift();
  };

  Bag.prototype.peek = function (n) {
    if (this.queue.length < n + 1) this.refill();
    return this.queue.slice(0, n);
  };

  BB.Pieces = {
    TYPES: TYPES,
    SHAPES: SHAPES,
    MATRIX: MATRIX,
    Piece: Piece,
    Bag: Bag,
    kicksFor: kicksFor,
    /* 形状のバウンディングボックス（NEXT/HOLD のセンタリング用） */
    boundsOf: function (type, rot) {
      var cells = SHAPES[type][rot || 0];
      var minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
      cells.forEach(function (p) {
        if (p.r < minR) minR = p.r;
        if (p.r > maxR) maxR = p.r;
        if (p.c < minC) minC = p.c;
        if (p.c > maxC) maxC = p.c;
      });
      return { minR: minR, maxR: maxR, minC: minC, maxC: maxC, w: maxC - minC + 1, h: maxR - minR + 1 };
    }
  };

})(typeof window !== 'undefined' ? window : this);
