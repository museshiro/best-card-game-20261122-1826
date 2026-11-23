// EMBER DUEL — an original turn-based card battler.
// You are Asha, Ember Mage. Beat Rook, the Frost Warden, to 0 HP.
// Four elements: Fire burns, Frost shields, Leaf heals, Storm strikes and draws.
// No network, no libraries: plain DOM + CSS + WebAudio blips. Fully offline.
'use strict';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : (Math.floor(Math.random() * 4294967296) >>> 0);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- cards
const ELEMENTS = { fire: '🔥', frost: '❄️', leaf: '🍃', storm: '⚡' };
// effect: { dmg, heal, shield, draw, mana } — all original cards, all our own names.
const CARDS = [
  { id: 'cinder',   name: 'Cinder Lash',  elem: 'fire',  cost: 1, power: 2, text: 'Deal 2 damage.',                 effect: { dmg: 2 } },
  { id: 'bolt',     name: 'Ember Bolt',   elem: 'fire',  cost: 2, power: 4, text: 'Deal 4 damage.',                 effect: { dmg: 4 } },
  { id: 'nova',     name: 'Ember Nova',   elem: 'fire',  cost: 4, power: 8, text: 'Deal 8 damage.',                 effect: { dmg: 8 } },
  { id: 'shard',    name: 'Frost Shard',  elem: 'frost', cost: 2, power: 3, text: 'Deal 3 damage. Gain 2 shield.',  effect: { dmg: 3, shield: 2 } },
  { id: 'bite',     name: 'Frostbite',    elem: 'frost', cost: 3, power: 5, text: 'Deal 5 damage.',                 effect: { dmg: 5 } },
  { id: 'wall',     name: 'Glacial Wall', elem: 'frost', cost: 2, power: 6, text: 'Gain 6 shield.',                 effect: { shield: 6 } },
  { id: 'mend',     name: 'Bloom Mend',   elem: 'leaf',  cost: 1, power: 5, text: 'Restore 5 HP.',                  effect: { heal: 5 } },
  { id: 'vine',     name: 'Thorn Vine',   elem: 'leaf',  cost: 2, power: 3, text: 'Deal 3 damage. Restore 2 HP.',    effect: { dmg: 3, heal: 2 } },
  { id: 'growth',   name: 'Wild Growth',  elem: 'leaf',  cost: 3, power: 6, text: 'Restore 6 HP. Draw a card.',      effect: { heal: 6, draw: 1 } },
  { id: 'siphon',   name: 'Spark Siphon', elem: 'storm', cost: 2, power: 2, text: 'Deal 2 damage. Gain 2 mana.',     effect: { dmg: 2, mana: 2 } },
  { id: 'storm',    name: 'Storm Call',   elem: 'storm', cost: 3, power: 6, text: 'Deal 6 damage.',                 effect: { dmg: 6 } },
  { id: 'tempest',  name: 'Tempest',      elem: 'storm', cost: 4, power: 5, text: 'Deal 5 damage. Draw a card.',     effect: { dmg: 5, draw: 1 } },
];
const BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));

function buildDeck(rng) {
  const deck = [];
  for (const c of CARDS) { deck.push(c.id); deck.push(c.id); }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ---------------------------------------------------------------- state
function freshSide(rng) {
  return { hp: 30, maxHp: 30, shield: 0, mana: 0, maxMana: 0, deck: buildDeck(rng), hand: [], discard: [] };
}

const S = {
  rng: mulberry32(seed),
  you: null, foe: null,
  turn: 'you', turnCount: 1,
  phase: 'title', // title | play | ai | over
  winner: null,
  damageDealt: 0, damageTaken: 0,
  score: 0, wins: 0, losses: 0,
  log: [],
  lastPlayed: null,
  muted: false,
  duel: 1,
};

function loadRecord() {
  try {
    const r = JSON.parse(window.localStorage.getItem('ember-duel-record') || '{}');
    S.wins = r.wins | 0; S.losses = r.losses | 0; S.score = r.score | 0;
  } catch { /* storage off: record lasts this visit only */ }
}
function saveRecord() {
  try { window.localStorage.setItem('ember-duel-record', JSON.stringify({ wins: S.wins, losses: S.losses, score: S.score })); } catch { /* ignore */ }
}

function drawCards(side, n) {
  for (let i = 0; i < n; i += 1) {
    if (side.hand.length >= 7) return;
    if (side.deck.length === 0) {
      side.deck = side.discard.splice(0).sort(() => S.rng() - 0.5);
      if (side.deck.length === 0) return;
    }
    side.hand.push(side.deck.pop());
  }
}

function dealDamage(target, amount) {
  const absorbed = Math.min(target.shield, amount);
  target.shield -= absorbed;
  target.hp = Math.max(0, target.hp - (amount - absorbed));
  return { absorbed, dealt: amount - absorbed };
}

function applyEffect(card, me, foe, isYou) {
  const e = card.effect;
  const parts = [];
  if (e.dmg) {
    const r = dealDamage(foe, e.dmg);
    if (isYou) S.damageDealt += r.dealt; else S.damageTaken += r.dealt;
    parts.push(`deals ${e.dmg} damage${r.absorbed ? ` (${r.absorbed} blocked)` : ''}`);
  }
  if (e.heal) { me.hp = Math.min(me.maxHp, me.hp + e.heal); parts.push(`restores ${e.heal} HP`); }
  if (e.shield) { me.shield += e.shield; parts.push(`gains ${e.shield} shield`); }
  if (e.mana) { me.mana += e.mana; parts.push(`gains ${e.mana} mana`); }
  if (e.draw) { drawCards(me, e.draw); parts.push('draws a card'); }
  return parts.join(', ');
}

function startTurn(side, n) {
  side.maxMana = Math.min(10, n);
  side.mana = side.maxMana;
  drawCards(side, 1);
}

// returns true if the card was played
function playCard(sideName, handIndex) {
  const me = sideName === 'you' ? S.you : S.foe;
  const foe = sideName === 'you' ? S.foe : S.you;
  if (handIndex < 0 || handIndex >= me.hand.length) return false;
  const card = BY_ID[me.hand[handIndex]];
  if (me.mana < card.cost) return false;
  me.mana -= card.cost;
  me.hand.splice(handIndex, 1);
  me.discard.push(card.id);
  const desc = applyEffect(card, me, foe, sideName === 'you');
  const who = sideName === 'you' ? 'You' : 'Rook';
  S.lastPlayed = { who, card, desc };
  addLog(`${who} played ${ELEMENTS[card.elem]} ${card.name} — ${desc}.`, sideName === 'you' ? 'you-log' : 'foe-log');
  if (foe.hp <= 0) endDuel(sideName === 'you' ? 'you' : 'foe');
  return true;
}

function endDuel(winner) {
  if (S.phase === 'over') return;
  S.phase = 'over';
  S.winner = winner;
  if (winner === 'you') {
    S.wins += 1;
    S.score += 100 + S.you.hp * 2 + S.damageDealt;
    addLog(`🏆 You win the duel! +${100 + S.you.hp * 2 + S.damageDealt} score.`, 'you-log');
  } else {
    S.losses += 1;
    S.score += S.damageDealt;
    addLog('💀 Rook wins the duel.', 'foe-log');
  }
  saveRecord();
}

// AI: kill if possible, heal when hurt, shield when bare, else biggest affordable damage.
function aiChooseCard() {
  const hand = S.foe.hand;
  let best = -1; let bestVal = -1;
  for (let i = 0; i < hand.length; i += 1) {
    const c = BY_ID[hand[i]];
    if (c.cost > S.foe.mana) continue;
    let v = (c.effect.dmg || 0) * 10 + (c.effect.heal || 0) * 2 + (c.effect.shield || 0) * 2 + (c.effect.draw || 0) * 5;
    if ((c.effect.dmg || 0) >= S.you.hp) v += 1000; // lethal
    if (S.foe.hp <= 12 && c.effect.heal) v += 120;
    if (S.foe.shield === 0 && c.effect.shield) v += 25;
    if (v > bestVal) { bestVal = v; best = i; }
  }
  return best;
}

function aiTurnInstant() {
  S.phase = 'ai';
  startTurn(S.foe, S.turnCount);
  let guard = 0;
  while (guard++ < 12) {
    const i = aiChooseCard();
    if (i < 0 || S.phase === 'over') break;
    playCard('foe', i);
  }
  if (S.phase !== 'over') {
    S.turnCount += 1;
    S.turn = 'you';
    S.phase = 'play';
    startTurn(S.you, S.turnCount);
    addLog(`— Turn ${S.turnCount}: your move, ${S.you.mana} mana. —`, '');
  }
}

// ---------------------------------------------------------------- sound
let audioCtx = null;
function beep(freq, dur, type) {
  if (S.muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.12, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch { /* audio unavailable */ }
}

// ---------------------------------------------------------------- render
const $ = (id) => document.getElementById(id);
const els = {};
['youHpFill', 'youHpText', 'youShield', 'youMana', 'youDeck', 'foeHpFill', 'foeHpText', 'foeShield', 'foeMana', 'foeDeck',
 'yourHand', 'foeHand', 'lastPlayed', 'log', 'turnLabel', 'scoreLabel', 'endTurnBtn', 'titleScreen', 'endScreen',
 'endEmoji', 'endTitle', 'endText', 'endScore', 'status', 'soundBtn'].forEach((id) => { els[id] = $(id); });

function addLog(text, cls) {
  S.log.unshift(text);
  if (S.log.length > 40) S.log.pop();
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.textContent = text;
  els.log.prepend(div);
  while (els.log.children.length > 40) els.log.lastChild.remove();
}

function cardEl(cardId, index, playable) {
  const c = BY_ID[cardId];
  const el = document.createElement('div');
  el.className = `card el-${c.elem}${playable === true ? ' playable' : playable === false ? ' unplayable' : ''}`;
  el.innerHTML = `<div class="cost">${c.cost}</div><div class="elem">${ELEMENTS[c.elem]}</div>` +
    `<div class="cname">${c.name}</div><div class="ctext">${c.text}</div>` +
    `<div class="cpower">${c.power}</div>` +
    (index >= 0 ? `<div class="ckey">${index + 1}</div>` : '');
  return el;
}

function render() {
  const you = S.you; const foe = S.foe;
  els.youHpFill.style.width = `${(you.hp / you.maxHp) * 100}%`;
  els.youHpText.textContent = `${you.hp} / ${you.maxHp}`;
  els.foeHpFill.style.width = `${(foe.hp / foe.maxHp) * 100}%`;
  els.foeHpText.textContent = `${foe.hp} / ${foe.maxHp}`;
  els.youShield.textContent = `🛡 ${you.shield}`;
  els.foeShield.textContent = `🛡 ${foe.shield}`;
  els.youMana.textContent = `◆ ${you.mana}/${you.maxMana}`;
  els.foeMana.textContent = `◆ ${foe.mana}/${foe.maxMana}`;
  els.youDeck.textContent = `Deck ${you.deck.length}`;
  els.foeDeck.textContent = `Deck ${foe.deck.length}`;
  els.turnLabel.textContent = `Duel ${S.duel} · Turn ${S.turnCount}`;
  els.scoreLabel.textContent = `Score ${S.score} · Wins ${S.wins} · Losses ${S.losses}`;
  els.endTurnBtn.disabled = S.phase !== 'play';
  els.soundBtn.textContent = S.muted ? '🔇' : '🔊';

  // foe hand: face-down backs
  els.foeHand.innerHTML = '';
  for (let i = 0; i < foe.hand.length; i += 1) {
    const b = document.createElement('div');
    b.className = 'card-back'; b.textContent = '❄️';
    els.foeHand.appendChild(b);
  }

  // your hand (compact layout once it holds 6+ cards, so END TURN stays visible)
  els.yourHand.innerHTML = '';
  els.yourHand.classList.toggle('compact', you.hand.length >= 6);
  you.hand.forEach((cardId, i) => {
    const c = BY_ID[cardId];
    const playable = S.phase === 'play' ? you.mana >= c.cost : null;
    const el = cardEl(cardId, i, playable);
    el.addEventListener('click', () => tryPlay(i));
    els.yourHand.appendChild(el);
  });

  // last played
  if (S.lastPlayed) {
    const lp = S.lastPlayed;
    els.lastPlayed.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'played-card';
    d.innerHTML = `<b>${lp.who}</b> played ${ELEMENTS[lp.card.elem]} <b>${lp.card.name}</b> — ${lp.desc}`;
    els.lastPlayed.appendChild(d);
  } else {
    els.lastPlayed.innerHTML = '<span class="played-hint">No card played yet — play a card to strike!</span>';
  }

  // overlays
  els.titleScreen.classList.toggle('hidden', S.phase !== 'title');
  els.endScreen.classList.toggle('hidden', S.phase !== 'over');
  if (S.phase === 'over') {
    const won = S.winner === 'you';
    els.endEmoji.textContent = won ? '🏆' : '💀';
    els.endTitle.textContent = won ? 'VICTORY!' : 'DEFEAT';
    els.endText.textContent = won
      ? `Rook's frost shatters — your embers burn brighter. Rook falls with ${you.hp} HP to spare.`
      : `Rook's blizzard swallows your last ember. You fall with Rook at ${foe.hp} HP.`;
    els.endScore.textContent = `Duel score: ${S.damageDealt} damage dealt · Total score ${S.score} · Wins ${S.wins} – Losses ${S.losses}`;
  }
  els.status.textContent = S.phase === 'title' ? 'Ember Duel. Press Enter or click Start Duel.'
    : S.phase === 'over' ? (S.winner === 'you' ? `Victory. Score ${S.score}.` : 'Defeat.')
    : `Turn ${S.turnCount}. Your HP ${you.hp}, Rook ${foe.hp}. Mana ${you.mana}.`;
}

// ---------------------------------------------------------------- flow
function newDuel() {
  S.rng = mulberry32(seed + S.duel * 7919);
  S.you = freshSide(S.rng);
  S.foe = freshSide(S.rng);
  S.turnCount = 1; S.turn = 'you'; S.phase = 'play'; S.winner = null;
  S.damageDealt = 0; S.damageTaken = 0; S.lastPlayed = null;
  S.log = []; els.log.innerHTML = '';
  drawCards(S.you, 3); drawCards(S.foe, 3);
  startTurn(S.you, 1);
  addLog(`🔥 Duel ${S.duel} begins — Asha vs Rook. Your move, ${S.you.mana} mana.`, 'you-log');
  render();
}

function tryPlay(i) {
  if (S.phase !== 'play') return;
  const before = S.foe.hp;
  if (playCard('you', i)) {
    beep(520, 0.12, 'triangle');
    if (S.foe.hp < before) beep(220, 0.18, 'sawtooth');
    render();
    if (S.phase === 'over') { beep(880, 0.4, 'sine'); render(); }
  }
}

function endTurn() {
  if (S.phase !== 'play') return;
  S.phase = 'ai';
  render();
  addLog('— Rook takes his turn… —', '');
  // staged AI plays so the player can watch each card land
  const step = () => {
    if (S.phase !== 'ai') { render(); return; }
    const i = aiChooseCard();
    if (i >= 0) {
      playCard('foe', i);
      beep(300, 0.1, 'triangle');
      render();
      if (S.phase === 'over') { beep(160, 0.5, 'sawtooth'); render(); return; }
      setTimeout(step, 650);
    } else {
      S.turnCount += 1; S.turn = 'you'; S.phase = 'play';
      startTurn(S.you, S.turnCount);
      addLog(`— Turn ${S.turnCount}: your move, ${S.you.mana} mana. —`, '');
      render();
    }
  };
  // AI draws + mana at the start of its turn (once)
  startTurn(S.foe, S.turnCount);
  setTimeout(step, 500);
}

function toTitle() { S.phase = 'title'; render(); }

// ---------------------------------------------------------------- input
$('startBtn').addEventListener('click', () => { beep(660, 0.15, 'triangle'); newDuel(); });
$('againBtn').addEventListener('click', () => { S.duel += 1; newDuel(); });
$('menuBtn').addEventListener('click', toTitle);
$('endTurnBtn').addEventListener('click', endTurn);
$('soundBtn').addEventListener('click', () => { S.muted = !S.muted; render(); });
$('helpBtn').addEventListener('click', () => { toTitle(); });
document.addEventListener('keydown', (e) => {
  if (S.phase === 'title' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); newDuel(); return; }
  if (S.phase === 'over' && (e.key === 'r' || e.key === 'R' || e.key === 'Enter')) { S.duel += 1; newDuel(); return; }
  if (S.phase !== 'play') return;
  if (e.key >= '1' && e.key <= '7') tryPlay(Number(e.key) - 1);
  else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); endTurn(); }
  else if (e.key === 'm' || e.key === 'M') { S.muted = !S.muted; render(); }
});

// ---------------------------------------------------------------- shots
// ?shot=start|play|win|loss stages a real scene by playing the real rules
// forward with a seeded deck and a simple autopilot, then flags __shotReady.
function autopilotPlayAllDamage() {
  let guard = 0;
  while (S.phase === 'play' && guard++ < 20) {
    let best = -1; let bestDmg = -1;
    S.you.hand.forEach((id, i) => {
      const c = BY_ID[id];
      if (c.cost <= S.you.mana && (c.effect.dmg || 0) > bestDmg) { bestDmg = c.effect.dmg || 0; best = i; }
    });
    if (best < 0) break;
    playCard('you', best);
  }
}
function stageShot(name) {
  S.duel = 1;
  newDuel();
  if (name === 'start') { S.phase = 'title'; render(); return; }
  if (name === 'play') {
    for (let t = 0; t < 5 && S.phase !== 'over'; t += 1) {
      autopilotPlayAllDamage();
      if (S.phase !== 'over') aiTurnInstant();
    }
    render();
    return;
  }
  if (name === 'win') {
    for (let t = 0; t < 40 && S.phase !== 'over'; t += 1) {
      autopilotPlayAllDamage();
      if (S.phase !== 'over') aiTurnInstant();
    }
    if (S.phase !== 'over') { // force the finishing blow through the real rules
      S.foe.hp = 4; S.foe.shield = 0;
      S.you.hand.push('nova'); S.you.mana = Math.max(S.you.mana, 4);
      S.phase = 'play';
      playCard('you', S.you.hand.indexOf('nova'));
    }
    render();
    return;
  }
  // loss: the player never plays; Rook grinds them down
  for (let t = 0; t < 40 && S.phase !== 'over'; t += 1) {
    if (S.phase !== 'over') aiTurnInstant();
  }
  if (S.phase !== 'over') {
    S.you.hp = 3; S.you.shield = 0;
    S.foe.hand.push('storm'); S.foe.mana = Math.max(S.foe.mana, 3);
    S.phase = 'ai';
    playCard('foe', S.foe.hand.indexOf('storm'));
  }
  render();
}

loadRecord();
if (shot) {
  S.you = freshSide(S.rng); S.foe = freshSide(S.rng);
  stageShot(shot);
  requestAnimationFrame(() => { requestAnimationFrame(() => { window.__shotReady = true; }); });
} else {
  S.you = freshSide(S.rng); S.foe = freshSide(S.rng);
  drawCards(S.you, 3); drawCards(S.foe, 3);
  render();
}
