/* ===== BLOCK RISE : config =====
 * ゲーム全体のチューニング値。数値をいじるだけで難易度や見た目を調整できます。
 * ES module ではなくクラシックスクリプトなので、file:// から直接開いても動きます。
 */
(function (global) {
  'use strict';

  var BB = global.BB = global.BB || {};

  var COLS = 9;             // 盤面の横マス数
  var VISIBLE_ROWS = 22;    // 画面に見える縦マス数（せり上がりぶん縦に長めに取る）
  var BUFFER_ROWS = 2;      // 天井の上に隠してある予備行（ピース出現用）

  BB.Config = {
    /* ---- 盤面 ---- */
    COLS: COLS,
    VISIBLE_ROWS: VISIBLE_ROWS,
    BUFFER_ROWS: BUFFER_ROWS,
    TOTAL_ROWS: VISIBLE_ROWS + BUFFER_ROWS,

    /* ---- 落下速度（秒／1マス） ---- */
    GRAVITY_BASE: 0.90,     // レベル1のとき
    GRAVITY_FACTOR: 0.86,   // レベルが1上がるごとに掛ける係数
    GRAVITY_MIN: 0.05,      // 最速でもこれ以上は速くしない
    SOFT_DROP_INTERVAL: 0.09, // ソフトドロップ中の落下間隔（秒／1マス）。
                              // 倍率ではなく固定の速さにして、レベルによらず
                              // 同じ操作感になるようにしています。小さいほど速い。
    SOFT_DROP_MAX_STEPS: 3, // 1 フレームで落とせる最大マス数（暴走防止）
    LOCK_DELAY: 0.5,        // 接地してから固定されるまでの猶予（秒）
    LOCK_RESET_MAX: 15,     // 猶予をリセットできる回数の上限

    /* ---- 入力 ---- */
    DAS: 0.13,              // 長押ししてから連続移動が始まるまで（秒）
    ARR: 0.03,              // 連続移動の間隔（秒）
    /* 盤面の左右に確保する余白（スマホ等のタッチ操作時のみ）。
     * ここもタップ・ドラッグ・フリックの受付範囲なので、
     * 盤面の外を触って操作でき、指でブロックが隠れません。 */
    TOUCH_GUTTER_MIN: 46,   // 最小幅（px）
    TOUCH_GUTTER_MAX: 96,   // 最大幅（px）
    TOUCH_GUTTER_RATIO: 0.14, // 盤面エリア幅に対する割合

    /* 横ドラッグの感度。指の移動量とピースの移動を対応づけます。
     * DRAG_STEP を大きくするほど、たくさん動かさないと 1 マス動かない＝鈍くなります。
     * DRAG_DEADZONE は「置く直前の指のブレでピースが動いてしまう」のを防ぐ遊びです。 */
    DRAG_STEP_RATIO: 1.1,     // 1 マス動かすのに必要な指の移動距離（セル何個ぶん）
    DRAG_STEP_MIN: 20,        // 同（px の下限）
    DRAG_DEADZONE_RATIO: 0.8, // 動き始めるまでの遊び（セル何個ぶん）
    DRAG_DEADZONE_MIN: 14,    // 同（px の下限）

    /* ---- 演出タイミング（秒） ---- */
    CLEAR_ANIM: 0.28,       // ライン消去のフラッシュ時間
    FALL_PER_CELL: 0.045,   // 崩れ落ちるブロックの 1マスあたりの落下時間
    FALL_MIN_ANIM: 0.10,    // 落下アニメの最短時間
    SPAWN_DELAY: 0.06,      // 次のピースが出るまでの間

    /* ---- せり上がり ---- */
    RISE_BASE: 32.0,        // レベル1でのせり上がり間隔（秒）
    RISE_STEP: 0.9,         // レベルが1上がるごとに短縮する秒数
    RISE_MIN: 11.0,         // 最短間隔
    RISE_WARN: 4.0,         // 残りこの秒数から警告表示
    RISE_HOLE_MIN: 1,       // せり上がる行に空ける穴の数（最小）
    RISE_HOLE_MAX: 2,       // 同（最大）
    RISE_SAME_HOLE_MIN: 2,  // 同じ穴の位置を続ける行数（最小）※2 以上でまとめて消せる
    RISE_SAME_HOLE_MAX: 3,  // 同（最大）

    /* ---- レベル ---- */
    LINES_PER_LEVEL: 12,

    /* ---- スコア ----
     * まとめ消しを強めに優遇する配点。1→4 ラインで伸び方が加速します。 */
    SCORE_LINES: { 1: 120, 2: 340, 3: 700, 4: 1400 },
    SCORE_COMBO: 60,        // × コンボ数 × レベル
    SCORE_SOFT: 2,          // ソフトドロップ 1マスあたり
    SCORE_HARD: 4,          // ハードドロップ 1マスあたり
    CHAIN_MULT_BASE: 1.0,   // 1連鎖目の倍率
    CHAIN_MULT_STEP: 0.5,   // 連鎖が1増えるごとの加算（2連鎖=1.5, 3連鎖=2.0 ...）

    /* ---- 配色（BLOCK RISE 独自パレット） ----
     * 9 色を色相環にほぼ均等に散らし、隣り合う形どうしが見分けやすいようにしています。
     * せり上がりブロック（G）だけは彩度を落とした暖色グレーで、
     * 自分で積んだブロックとひと目で区別できます。 */
    COLORS: {
      I: { base: '#e879f9', light: '#f8ccff', dark: '#86198f' },
      O: { base: '#38bdf8', light: '#bae6fd', dark: '#075985' },
      T: { base: '#f43f5e', light: '#fecdd3', dark: '#9f1239' },
      S: { base: '#f59e0b', light: '#fde3a7', dark: '#92400e' },
      Z: { base: '#818cf8', light: '#cdd3fe', dark: '#3730a3' },
      J: { base: '#a3e635', light: '#e0f7a8', dark: '#4d7c0f' },
      L: { base: '#10b981', light: '#8fecd0', dark: '#065f46' },
      D: { base: '#a855f7', light: '#e9d5ff', dark: '#6b21a8' },  // 3マス：まっすぐ
      V: { base: '#3fd44f', light: '#b6f2bd', dark: '#166f22' },  // 3マス：かぎ形
      G: { base: '#8b8178', light: '#b8afa5', dark: '#463f38' }   // せり上がりブロック
    },

    /* ---- localStorage キー ---- */
    LS_HIGHSCORE: 'blockrise.highscore',
    LS_MUTED: 'blockrise.muted'
  };

  /* レベルに応じた自然落下間隔（秒／1マス） */
  BB.Config.gravityFor = function (level) {
    var c = BB.Config;
    return Math.max(c.GRAVITY_MIN, c.GRAVITY_BASE * Math.pow(c.GRAVITY_FACTOR, level - 1));
  };

  /* レベルに応じたせり上がり間隔（秒） */
  BB.Config.riseIntervalFor = function (level) {
    var c = BB.Config;
    return Math.max(c.RISE_MIN, c.RISE_BASE - (level - 1) * c.RISE_STEP);
  };

  /* 連鎖数に応じたスコア倍率（1連鎖=1.0, 2連鎖=1.5, 3連鎖=2.0 ...） */
  BB.Config.chainMultiplier = function (chain) {
    var c = BB.Config;
    return c.CHAIN_MULT_BASE + Math.max(0, chain - 1) * c.CHAIN_MULT_STEP;
  };

})(typeof window !== 'undefined' ? window : this);
