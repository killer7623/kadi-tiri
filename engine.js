'use strict';
/* Game rules and computer players for Kali Ni Tidi. Pure logic, no networking. */

const SUITS = ['S', 'H', 'D', 'C'];
const ORDER = { S: 0, H: 1, C: 2, D: 3 };

const pts = c => (c.s === 'S' && c.r === 3) ? 30 : (c.r >= 10 ? 10 : (c.r === 5 ? 5 : 0));
const mk = (s, r, d) => { d = d || 'a'; return { s, r, d, f: r + s, id: r + s + d }; };
const fromFace = f => mk(f.slice(-1), parseInt(f, 10));
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const sortHand = h => h.sort((a, b) => ORDER[a.s] - ORDER[b.s] || b.r - a.r);

function buildDeck(n, decks) {
  const d = [];
  for (let k = 0; k < decks; k++)
    SUITS.forEach(s => { for (let r = 2; r <= 14; r++) d.push(mk(s, r, k ? 'b' : 'a')); });
  let drop = [];
  if (decks === 1) drop = n === 4 ? ['2Sa', '2Ha', '2Da', '2Ca'] : ['2Da', '2Ca'];
  else drop = ['2Ca', '2Da'];
  return d.filter(c => drop.indexOf(c.id) < 0);
}
const partnerCount = (n, decks) => decks === 1 ? (n === 4 ? 1 : 2) : 2;
const copiesOf = (g, f) => g.fullDeck.filter(c => c.f === f).length;

function bestSuitT(hand) {
  let best = 0;
  SUITS.forEach(s => {
    const cs = hand.filter(c => c.s === s);
    let t = cs.length;
    cs.forEach(c => { if (c.r === 14) t += 2; else if (c.r === 13) t += 1.5; else if (c.r === 12) t += 1; else if (c.r === 11) t += .5; });
    best = Math.max(best, t);
  });
  return best;
}
function calibrate(g) {
  const per = g.fullDeck.length / g.n;
  let tot = 0, cnt = 0;
  for (let k = 0; k < 120; k++) {
    const d = shuffle(g.fullDeck.slice());
    for (let i = 0; i < g.n; i++) { tot += bestSuitT(d.slice(i * per, (i + 1) * per)); cnt++; }
  }
  return tot / cnt;
}

function newGame(n, decks) {
  const g = {
    n, decks, names: [], scores: Array(n).fill(0), round: 0, dealer: -1,
    pc: partnerCount(n, decks), total: 250 * decks,
    minBid: decks === 1 ? 150 : 250, maxCap: 250 * decks
  };
  g.fullDeck = buildDeck(n, decks);
  g.baseT = calibrate(g);
  g.phase = 'idle';
  return g;
}

function estimate(g, hand) {
  const k = g.decks;
  const m = g.minBid + (sum(hand, pts) - g.total / g.n) * 1.3 * k + (bestSuitT(hand) - g.baseT) * 9 * k
    + (Math.random() * 16 - 8) * k + hand.filter(c => c.f === '3S').length * 8 * k;
  return Math.max(0, Math.min(g.maxCap, Math.round(m / 5) * 5));
}

function startRound(g) {
  const n = g.n;
  g.round++; g.dealer = (g.dealer + 1) % n;
  const d = shuffle(g.fullDeck.slice()), per = d.length / n;
  g.hands = [];
  for (let i = 0; i < n; i++) g.hands.push(sortHand(d.slice(i * per, (i + 1) * per)));
  g.taken = Array(n).fill(0);
  g.bid = { amount: 0, by: null, passed: Array(n).fill(false), last: Array(n).fill(''), turn: (g.dealer + 1) % n };
  g.bidder = null; g.trump = null; g.called = []; g.seen = {};
  g.team = new Set(); g.revealed = new Set();
  g.trick = []; g.turn = null; g.winner = null; g.trickPts = 0; g.result = null;
  g.maxBid = g.hands.map(h => estimate(g, h));
  g.phase = 'bid';
}

/* ---------- bidding ---------- */
function settleBid(g) {
  const b = g.bid, active = [];
  for (let i = 0; i < g.n; i++) if (!b.passed[i]) active.push(i);
  let winner = null;
  if (active.length === 1) winner = active[0];
  else if (b.amount >= g.maxCap) winner = b.by;
  else if (b.amount > 0 && b.turn === b.by) winner = b.by;
  if (winner !== null) {
    if (!b.amount) { b.amount = g.minBid; b.by = winner; b.last[winner] = String(g.minBid); }
    g.bidder = winner; g.phase = 'call'; g.turn = winner;
  }
}
function advanceBid(g) {
  const b = g.bid;
  let t = b.turn;
  do { t = (t + 1) % g.n; } while (b.passed[t]);
  b.turn = t; settleBid(g);
}
function doBid(g, i, a) {
  const b = g.bid;
  if (g.phase !== 'bid' || b.turn !== i) return false;
  const min = b.amount ? b.amount + 5 : g.minBid;
  if (!Number.isInteger(a) || a < min || a > g.maxCap || a % 5 !== 0) return false;
  b.amount = a; b.by = i; b.last[i] = String(a);
  advanceBid(g); return true;
}
function doPass(g, i) {
  const b = g.bid;
  if (g.phase !== 'bid' || b.turn !== i) return false;
  b.passed[i] = true; b.last[i] = 'Pass';
  advanceBid(g); return true;
}
function botBid(g, i) { // returns an amount, or 0 to pass
  const b = g.bid, next = b.amount ? b.amount + 5 : g.minBid, mx = g.maxBid[i];
  if (mx < next) return 0;
  let a = next;
  if (mx >= next + 10 * g.decks && Math.random() < .35) a = next + 5 * (1 + Math.floor(Math.random() * 2));
  return Math.min(a, mx, g.maxCap);
}

/* ---------- trump and partner call ---------- */
function botCall(g) {
  const h = g.hands[g.bidder];
  let bestS = 'S', bestV = -1;
  SUITS.forEach(s => {
    let v = 0;
    h.forEach(c => { if (c.s === s) { v += 2; if (c.r === 14) v += 4; else if (c.r === 13) v += 3; else if (c.r === 12) v += 2; else if (c.r === 11) v += 1; } });
    v += Math.random();
    if (v > bestV) { bestV = v; bestS = s; }
  });
  const faces = {};
  g.fullDeck.forEach(c => { faces[c.f] = 1; });
  const cands = Object.keys(faces)
    .filter(f => h.filter(c => c.f === f).length < copiesOf(g, f))
    .map(f => {
      const c = fromFace(f);
      let w = 0;
      if (h.some(x => x.f === f)) w -= 25;
      if (c.s === bestS) w += 40 + c.r * 5;
      if (c.r === 14) w += 60; else if (c.r === 13) w += 30;
      if (f === '3S') w += 55;
      return { f, w: w + Math.random() * 3 };
    }).sort((a, b) => b.w - a.w);
  return { trump: bestS, called: cands.slice(0, g.pc).map(x => ({ f: x.f, n: g.decks === 2 && Math.random() < .5 ? 2 : 1 })) };
}
function doCall(g, i, trump, called) {
  if (g.phase !== 'call' || g.bidder !== i) return false;
  if (SUITS.indexOf(trump) < 0 || !Array.isArray(called) || called.length !== g.pc) return false;
  const seenKey = {}; // duplicate (face, occurrence) pairs are rejected, but the same face can be called twice as its two occurrences ("both copies")
  for (const c of called) {
    if (!c || typeof c.f !== 'string') return false;
    if (!(c.n === 1 || (c.n === 2 && g.decks === 2))) return false;
    const key = c.f + ':' + c.n;
    if (seenKey[key]) return false;
    seenKey[key] = 1;
    const total = copiesOf(g, c.f);
    if (!total || c.n > total) return false;
    if (g.hands[i].filter(h => h.f === c.f).length >= total) return false;
  }
  g.trump = trump;
  g.called = called.map(c => ({
    f: c.f, n: c.n, pattern: g.hands[i].some(h => h.f === c.f), by: undefined
  }));
  g.team = new Set([i]); g.revealed = new Set();
  g.phase = 'play'; g.trick = []; g.turn = i;
  return true;
}
function holdsCalled(g, i) {
  return g.called.some(c => c.by === undefined && g.hands[i].some(h => h.f === c.f));
}

/* ---------- play ---------- */
function legal(g, i) {
  const h = g.hands[i];
  if (!g.trick.length) return h;
  const led = g.trick[0].card.s, f = h.filter(c => c.s === led);
  return f.length ? f : h;
}
function strength(g, c, led) { return c.s === g.trump ? 100 + c.r : (c.s === led ? c.r : 0); }
function currentBest(g) {
  const led = g.trick[0].card.s;
  let best = g.trick[0];
  g.trick.forEach(e => {
    const a = strength(g, e.card, led), b = strength(g, best.card, led);
    if (a > b || (a === b && a > 0)) best = e; // an identical card played later beats the earlier one
  });
  return best;
}
function doPlay(g, i, id) {
  if (g.phase !== 'play' || g.turn !== i) return false;
  if (!legal(g, i).some(c => c.id === id)) return false;
  const h = g.hands[i], card = h.splice(h.findIndex(c => c.id === id), 1)[0];
  g.trick.push({ p: i, card });
  g.seen[card.f] = (g.seen[card.f] || 0) + 1;
  g.called.forEach(c => {
    if (c.by !== undefined || c.f !== card.f) return;
    if (c.pattern) {
      if (i !== g.bidder) { c.by = i; g.team.add(i); g.revealed.add(i); }
    } else if (c.n === g.seen[card.f]) {
      c.by = i;
      if (i !== g.bidder) { g.team.add(i); g.revealed.add(i); }
    }
  });
  if (g.trick.length < g.n) { g.turn = (i + 1) % g.n; return true; }
  const w = currentBest(g).p, s = sum(g.trick, e => pts(e.card));
  g.taken[w] += s; g.winner = w; g.trickPts = s; g.phase = 'trickEnd'; g.turn = null;
  return true;
}
function clearTrick(g) {
  if (g.phase !== 'trickEnd') return;
  g.trick = [];
  if (!g.hands[0].length) { endRound(g); return; }
  g.phase = 'play'; g.turn = g.winner;
}
const PENALTY_MIN_BID = 345;
const PENALTY_SCORE = -500;

function computeResult(g) {
  const team = Array.from(g.team), tp = sum(team, i => g.taken[i]);
  const ok = tp >= g.bid.amount, delta = Array(g.n).fill(0);
  team.forEach(i => { delta[i] = ok ? (i === g.bidder ? 2 * g.bid.amount : g.bid.amount) : (i === g.bidder ? -g.bid.amount : 0); });
  if (!ok) for (let i = 0; i < g.n; i++) if (!g.team.has(i)) delta[i] = g.bid.amount; // opponents gain the bid
  return { tp, ok, delta, team };
}
function applyResult(g, res) {
  res.delta.forEach((d, i) => { g.scores[i] += d; });
  g.result = res; g.phase = 'end'; g.turn = null; g.penalty = null;
}
function canEndEarly(g) {
  if (!g || (g.phase !== 'play' && g.phase !== 'trickEnd')) return false;
  if (g.bidder === null || !g.called || g.team.size < g.pc + 1) return false;
  const teamTaken = sum(Array.from(g.team), i => g.taken[i]);
  const remaining = sum(g.hands.flat(), pts) + sum(g.trick, e => pts(e.card));
  return teamTaken + remaining < g.bid.amount;
}

function endEarly(g) {
  if (!canEndEarly(g)) return false;
  endRound(g);
  return true;
}

function endRound(g) {
  const res = computeResult(g);
  const partners = res.team.filter(i => i !== g.bidder);
  if (!res.ok && g.bid.amount >= PENALTY_MIN_BID && partners.length) {
    g.penalty = { res, partners, votes: {} };
    g.phase = 'penalty'; g.turn = null;
  } else {
    applyResult(g, res);
  }
}
function resolvePenalty(g) {
  const p = g.penalty;
  if (!p) return;
  const votes = p.partners.map(i => p.votes[i]);
  if (votes.some(v => v === false)) { applyResult(g, Object.assign({}, p.res, { penaltyOffered: true, penaltyApplied: false })); return; }
  if (votes.every(v => v === true)) {
    const delta = p.res.delta.slice();
    delta[g.bidder] = PENALTY_SCORE;
    applyResult(g, Object.assign({}, p.res, { delta, penaltyOffered: true, penaltyApplied: true }));
  }
}
function doPenaltyVote(g, i, agree) {
  const p = g.penalty;
  if (g.phase !== 'penalty' || !p || p.partners.indexOf(i) < 0 || p.votes[i] !== undefined) return false;
  p.votes[i] = !!agree;
  resolvePenalty(g);
  return true;
}
function pendingPenaltyVoters(g) {
  if (g.phase !== 'penalty' || !g.penalty) return [];
  return g.penalty.partners.filter(i => g.penalty.votes[i] === undefined);
}
function botPenaltyVote() { return false; } // a computer player protects its teammate and declines

function whoActs(g) {
  if (g.phase === 'bid') return g.bid.turn;
  if (g.phase === 'call') return g.bidder;
  if (g.phase === 'play') return g.turn;
  return null;
}

/* ---------- computer play ---------- */
function botTeam(g, i) { return i === g.bidder || g.team.has(i) || holdsCalled(g, i); }
function isAlly(g, i, j) {
  if (i === j) return true;
  const complete = g.called.every(c => c.by !== undefined);
  const jKnown = j === g.bidder || g.revealed.has(j);
  if (botTeam(g, i)) return jKnown;
  return complete ? !jKnown : false;
}
function chooseCard(g, i) {
  const L = legal(g, i);
  if (L.length === 1) return L[0];
  const trump = g.trump;
  const lowD = arr => arr.slice().sort((a, b) => pts(a) - pts(b) || ((a.s === trump) - (b.s === trump)) || a.r - b.r)[0];
  if (!g.trick.length) {
    const aces = L.filter(c => c.s !== trump && c.r === 14);
    if (aces.length) return aces[0];
    if (botTeam(g, i)) {
      const hi = L.filter(c => c.s === trump && c.r >= 13).sort((a, b) => b.r - a.r)[0];
      if (hi) return hi;
    }
    return lowD(L);
  }
  const led = g.trick[0].card.s, best = currentBest(g);
  const bs = strength(g, best.card, led), last = g.trick.length === g.n - 1;
  const tp = sum(g.trick, e => pts(e.card));
  const winners = L.filter(c => { const x = strength(g, c, led); return x > bs || (x === bs && bs > 0); });
  if (isAlly(g, i, best.p)) {
    const safe = last || (best.card.s === trump && best.card.r >= 13);
    if (safe) return L.slice().sort((a, b) => pts(b) - pts(a) || ((a.s === trump) - (b.s === trump)) || a.r - b.r)[0];
    return lowD(L);
  }
  if (winners.length) {
    const cost = c => strength(g, c, led) + (last ? 0 : pts(c) * 3);
    const w = winners.slice().sort((a, b) => cost(a) - cost(b))[0];
    const wasteful = strength(g, w, led) >= 100 && tp === 0 && !last && Math.random() < .5;
    if (!wasteful) return w;
  }
  return lowD(L);
}

module.exports = {
  pts, newGame, startRound, doBid, doPass, doCall, doPlay, clearTrick, whoActs, legal,
  botBid, botCall, chooseCard, holdsCalled, copiesOf, endRound, canEndEarly, endEarly,
  PENALTY_MIN_BID, PENALTY_SCORE, doPenaltyVote, pendingPenaltyVoters, botPenaltyVote
};
