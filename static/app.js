"use strict";

let games = [];
let spinning = false;
let addingGame = false;
let currentRotationDeg = 0;
let currentWinnerGame = null;
let manualModeOn = false;
let searchTimer = null;
let toastTimer = null;
let audioCtx = null;
let soundEnabled = localStorage.getItem("wheelSoundEnabled") !== "off";
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let spinBtn, playerNameInput, gameSearchInput, manualNameInput, manualCoverInput,
    manualAddBtn, manualToggleBtn, shareBtn, soundToggleBtn, closeModalBtn, removeWinnerBtn,
    wheelEl, wheelWrapEl, clearHistoryBtn, clearGamesBtn, duelChallengeBtn;

/* ---------------- helpers ---------------- */

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (s) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[s]));
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function toast(msg, ms = 3200) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), ms);
}

/**
 * Los 3 nombres con cara/logo propios. Las imágenes van en
 * static/img/players/<archivo>. Si el archivo todavía no existe (o el
 * usuario no lo subió), el <img> tira onerror y queda el emoji de
 * respaldo - así nunca se rompe el diseño mientras se van agregando
 * las fotos reales.
 */
const PLAYER_PRESETS = {
  Mateo: { img: "/static/img/players/mateo.png", emoji: "⚽" },
  Lauty: { img: "/static/img/players/lauty.png", emoji: "🩺" },
  Roman: { img: "/static/img/players/roman.png", emoji: "🛡️" },
};

function tinyAvatar(name) {
  const span = document.createElement("span");
  span.className = "tiny-avatar";
  const preset = PLAYER_PRESETS[name];
  if (preset) {
    const img = document.createElement("img");
    img.src = preset.img;
    img.alt = "";
    img.onerror = () => {
      img.remove();
      span.textContent = preset.emoji;
    };
    span.appendChild(img);
  } else {
    span.textContent = "🎮";
  }
  return span;
}

const FALLBACK_PALETTES = [
  ["#3b0f1d", "#7a1f3d"],
  ["#0f2b3b", "#1f5c7a"],
  ["#2a1c2b", "#6b2d63"],
  ["#3a2405", "#8a5a1f"],
  ["#1a1017", "#4a1030"],
];
const FALLBACK_ICONS = ["🎮", "🕹️", "👾", "🎲", "🃏", "🏆", "⭐"];

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

function buildFallback(name) {
  const fb = document.createElement("div");
  fb.className = "fallback";
  const h = hashStr(name || "?");
  const [c1, c2] = FALLBACK_PALETTES[h % FALLBACK_PALETTES.length];
  fb.style.background = `linear-gradient(150deg, ${c1}, ${c2})`;

  const icon = document.createElement("span");
  icon.className = "fallback-icon";
  icon.textContent = FALLBACK_ICONS[h % FALLBACK_ICONS.length];

  const label = document.createElement("span");
  label.className = "fallback-label";
  label.textContent = name;

  fb.appendChild(icon);
  fb.appendChild(label);
  return fb;
}

/**
 * Every cover in the app (wheel wedge, sidebar list, search results,
 * winner modal, history) goes through this so they all share the same
 * "poster-frame" wrapper: a fixed box that crops via object-fit:cover.
 * That's what keeps landscape Steam headers from looking squashed or
 * floating off-center next to the portrait library covers - the
 * frame's aspect ratio is fixed by CSS, not by whatever the source
 * image happens to be.
 */
function posterInner(game) {
  const frame = document.createElement("div");
  frame.className = "poster-frame";

  const urls = [game.cover, game.cover_fallback].filter(Boolean);
  if (urls.length === 0) {
    frame.appendChild(buildFallback(game.name));
    return frame;
  }

  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = game.name;
  img.classList.add("img-loading");
  img.addEventListener("load", () => img.classList.remove("img-loading"), { once: true });
  let idx = 0;
  img.src = urls[0];
  img.onerror = () => {
    idx += 1;
    if (idx < urls.length) {
      img.src = urls[idx];
    } else {
      img.remove();
      frame.appendChild(buildFallback(game.name));
    }
  };
  frame.appendChild(img);
  return frame;
}

/* ---------------- lights (marquee bulbs) ---------------- */

function buildLights() {
  const lights = document.getElementById("lights");
  const wrap = document.getElementById("wheelWrap");
  const rect = wrap.getBoundingClientRect();
  const R = rect.width / 2;
  if (!R) {
    requestAnimationFrame(buildLights);
    return;
  }
  lights.innerHTML = "";
  const count = 28;
  const bulbR = R * 0.965;
  for (let i = 0; i < count; i++) {
    const angle = (360 / count) * i;
    const rad = (angle * Math.PI) / 180;
    const x = R + bulbR * Math.sin(rad);
    const y = R - bulbR * Math.cos(rad);
    const b = document.createElement("div");
    b.className = "light-bulb";
    b.style.left = x + "px";
    b.style.top = y + "px";
    b.style.animationDelay = (i * 0.08).toFixed(2) + "s";
    lights.appendChild(b);
  }
}

function setLightsMode(mode) {
  document.querySelectorAll(".light-bulb").forEach((b) => {
    b.classList.remove("spinning", "won");
    if (mode) b.classList.add(mode);
  });
}

/* ---------------- wheel rendering ---------------- */

function posterSize(n) {
  if (n <= 5) return 108;
  if (n <= 8) return 88;
  if (n <= 12) return 70;
  if (n <= 18) return 56;
  return 44;
}

function renderWheel() {
  if (!wheelEl) return;
  const n = games.length;
  wheelEl.innerHTML = "";

  if (n === 0) {
    wheelEl.style.background = "var(--surface)";
    return;
  }

  const wedgeAngle = 360 / n;
  const colors = ["#3b0f1d", "#0f2b3b", "#2a1c2b", "#20321f"];
  const stops = [];
  for (let i = 0; i < n; i++) {
    stops.push(`${colors[i % colors.length]} ${i * wedgeAngle}deg ${(i + 1) * wedgeAngle}deg`);
  }
  wheelEl.style.background = `conic-gradient(${stops.join(",")})`;

  const R = wheelEl.offsetWidth / 2;
  if (!R) {
    // Layout isn't settled yet (e.g. fonts still loading on first
    // paint) - retry next frame instead of dropping every poster at
    // (0,0), which is what used to make covers look "bugged" off to
    // one side on first load.
    requestAnimationFrame(renderWheel);
    return;
  }
  const placeR = R * 0.66;
  const size = posterSize(n);

  games.forEach((game, i) => {
    const centerAngle = i * wedgeAngle + wedgeAngle / 2;
    const rad = (centerAngle * Math.PI) / 180;
    const x = R + placeR * Math.sin(rad);
    const y = R - placeR * Math.cos(rad);

    const el = document.createElement("div");
    el.className = "wedge-poster";
    el.style.width = size + "px";
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.transform = `translate(-50%, -50%) rotate(${centerAngle}deg)`;
    el.title = `${game.name} — agregado por ${game.added_by || "Anónimo"}`;
    el.appendChild(posterInner(game));
    wheelEl.appendChild(el);
  });

  wheelEl.style.transform = `rotate(${currentRotationDeg}deg)`;
}

/* ---------------- data fetch / render lists ---------------- */

async function fetchGames() {
  try {
    const res = await fetch("/api/games");
    const data = await res.json();
    games = Array.isArray(data) ? data : [];
    renderGameList();
    if (!spinning) renderWheel();
    spinBtn.disabled = games.length < 2 || spinning;
    document.getElementById("wheelHint").textContent =
      games.length < 2
        ? "Agregá al menos 2 juegos para poder girar la ruleta."
        : `${games.length} juegos listos. ¡A ver quién zafa!`;
  } catch (err) {
    toast("No se pudo conectar con el servidor.");
  }
}

async function fetchHistory() {
  try {
    const res = await fetch("/api/history");
    const data = await res.json();
    const list = Array.isArray(data) ? data : [];
    renderHistoryList(list);
    renderLeaderboard(list);
  } catch (err) {
    /* silent */
  }
}

function renderGameList() {
  const el = document.getElementById("gameList");
  document.getElementById("gameCount").textContent = games.length;
  if (games.length === 0) {
    el.innerHTML = '<p class="empty-hint">Todavía no hay juegos. ¡Agregá el primero!</p>';
    return;
  }
  el.innerHTML = "";
  games.forEach((game) => {
    const row = document.createElement("div");
    row.className = "game-row";
    row.appendChild(posterInner(game));

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `<div class="name">${escapeHtml(game.name)}</div><div class="who">agregado por ${escapeHtml(game.added_by || "Anónimo")}</div>`;
    row.appendChild(tinyAvatar(game.added_by || "Anónimo"));
    row.appendChild(meta);

    const rm = document.createElement("button");
    rm.className = "remove-btn";
    rm.textContent = "✕";
    rm.title = "Quitar de la ruleta";
    rm.addEventListener("click", () => deleteGame(game.id));
    row.appendChild(rm);

    el.appendChild(row);
  });
}

function renderHistoryList(history) {
  const el = document.getElementById("historyList");
  if (!history || history.length === 0) {
    el.innerHTML = '<p class="empty-hint">Sin partidas elegidas todavía.</p>';
    return;
  }
  el.innerHTML = "";
  history.forEach((h) => {
    const row = document.createElement("div");
    row.className = "history-row";
    row.appendChild(posterInner({ name: h.name, cover: h.cover }));

    const info = document.createElement("div");
    info.className = "h-info";
    const name = document.createElement("div");
    name.className = "h-name";
    name.textContent = h.name;
    const who = document.createElement("div");
    who.className = "h-who";
    who.textContent = `elegido por ${h.added_by || "Anónimo"}`;
    info.appendChild(name);
    info.appendChild(who);
    row.appendChild(info);

    const date = document.createElement("div");
    date.className = "h-date";
    const d = new Date(h.date);
    date.textContent = isNaN(d) ? "" : d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
    row.appendChild(date);

    el.appendChild(row);
  });
}

function renderLeaderboard(history) {
  const el = document.getElementById("leaderboardList");
  if (!el) return;
  if (!history || history.length === 0) {
    el.innerHTML = '<p class="empty-hint">Todavía nadie se colgó una victoria. Sean valientes.</p>';
    return;
  }
  const counts = {};
  history.forEach((h) => {
    const who = (h.added_by || "Anónimo").trim() || "Anónimo";
    counts[who] = (counts[who] || 0) + 1;
  });
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const medals = ["🥇", "🥈", "🥉"];
  el.innerHTML = "";
  ranked.forEach(([name, count], i) => {
    const row = document.createElement("div");
    row.className = "rank-row";

    const medal = document.createElement("span");
    medal.className = "rank-medal";
    medal.textContent = medals[i] || "🎖️";
    row.appendChild(medal);

    row.appendChild(tinyAvatar(name));

    const nameEl = document.createElement("span");
    nameEl.className = "rank-name";
    nameEl.textContent = name;
    row.appendChild(nameEl);

    const countEl = document.createElement("span");
    countEl.className = "rank-count";
    countEl.textContent = `${count} ${count === 1 ? "victoria" : "victorias"}`;
    row.appendChild(countEl);

    el.appendChild(row);
  });
}

/* ---------------- add / remove games ---------------- */

async function addGame(payload) {
  if (addingGame) return;
  addingGame = true;
  manualAddBtn.disabled = true;
  toast("Agregando y descargando la portada…", 6000);
  try {
    const res = await fetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || "No se pudo agregar el juego.");
      return;
    }
    toast(`"${data.name}" se sumó a la ruleta.`);
    await fetchGames();
  } catch (err) {
    toast("Error de conexión con el servidor.");
  } finally {
    addingGame = false;
    manualAddBtn.disabled = false;
  }
}

async function deleteGame(id) {
  try {
    await fetch("/api/games/" + id, { method: "DELETE" });
    await fetchGames();
  } catch (err) {
    toast("No se pudo quitar el juego.");
  }
}

/* ---------------- player picker ----------------
   Mateo / Lauty / Roman set playerName's value directly (so every
   existing playerNameInput.value.trim() call keeps working untouched).
   "Otro" just reveals the free-text input like before. */

function setupPlayerSelect() {
  const pills = document.querySelectorAll(".player-pill");
  pills.forEach((pill) => {
    pill.addEventListener("click", () => {
      pills.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      const key = pill.dataset.player;
      if (key === "__other__") {
        playerNameInput.classList.remove("hidden");
        playerNameInput.value = "";
        playerNameInput.focus();
      } else {
        playerNameInput.classList.add("hidden");
        playerNameInput.value = key;
      }
    });
  });
}

/* ---------------- steam search ---------------- */

function setupSearch() {
  gameSearchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = gameSearchInput.value.trim();
    const resultsEl = document.getElementById("searchResults");
    if (q.length < 2) {
      resultsEl.innerHTML = "";
      return;
    }
    resultsEl.innerHTML = '<p class="search-status">Buscando…</p>';
    searchTimer = setTimeout(async () => {
      try {
        const res = await fetch("/api/steam-search?q=" + encodeURIComponent(q));
        const data = await res.json();
        if (!Array.isArray(data)) {
          resultsEl.innerHTML = `<p class="search-status">${escapeHtml(data.error || "Sin resultados.")}</p>`;
          return;
        }
        if (data.length === 0) {
          resultsEl.innerHTML = '<p class="search-status">No se encontraron juegos. Probá "Cargar manual".</p>';
          return;
        }
        resultsEl.innerHTML = "";
        data.forEach((item) => {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "search-result-item";

          const previewUrls = [item.cover, item.cover_fallback, item.cover_extra].filter(Boolean);
          const frame = document.createElement("div");
          frame.className = "poster-frame";
          const img = document.createElement("img");
          img.alt = item.name;
          let previewIdx = 0;
          img.src = previewUrls[0];
          img.onerror = () => {
            previewIdx += 1;
            if (previewIdx < previewUrls.length) {
              img.src = previewUrls[previewIdx];
            } else {
              img.remove();
              frame.appendChild(buildFallback(item.name));
            }
          };
          frame.appendChild(img);
          row.appendChild(frame);

          const span = document.createElement("span");
          span.textContent = item.name;
          row.appendChild(span);

          row.addEventListener("click", () => {
            addGame({
              name: item.name,
              cover: item.cover,
              cover_fallback: item.cover_fallback,
              cover_extra: item.cover_extra,
              steam_appid: item.steam_appid,
              added_by: playerNameInput.value.trim(),
            });
            gameSearchInput.value = "";
            resultsEl.innerHTML = "";
          });

          resultsEl.appendChild(row);
        });
      } catch (err) {
        resultsEl.innerHTML = '<p class="search-status">Error de conexión.</p>';
      }
    }, 420);
  });
}

/* ---------------- sound (Web Audio API, no external files) ---------------- */

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playTick() {
  if (!soundEnabled) return;
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = 720;
  gain.gain.setValueAtTime(0.16, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.045);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.05);
}

function playWhoosh(duration) {
  if (!soundEnabled) return;
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const seconds = duration / 1000;
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(280, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + seconds);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.4);
  gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + seconds);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + seconds + 0.05);
}

function playFanfare() {
  if (!soundEnabled) return;
  const ctx = getAudioCtx();
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, idx) => {
    setTimeout(() => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.55);
    }, idx * 130);
  });
}

function playBuzz() {
  if (!soundEnabled) return;
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = 110;
  gain.gain.setValueAtTime(0.12, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.35);
}

/* ---------------- confetti ---------------- */

function launchConfetti() {
  const layer = document.getElementById("confettiLayer");
  const colors = ["#d9a94e", "#f3c86b", "#ff3e7f", "#f3ecec", "#0f2b3b"];
  const count = 90;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    const size = 6 + Math.random() * 7;
    piece.style.width = size + "px";
    piece.style.height = size * 0.4 + "px";
    piece.style.left = Math.random() * 100 + "vw";
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    const duration = 2.6 + Math.random() * 1.6;
    piece.style.animationDuration = duration + "s";
    piece.style.animationDelay = Math.random() * 0.4 + "s";
    layer.appendChild(piece);
    setTimeout(() => piece.remove(), (duration + 0.6) * 1000);
  }
}

function launchMoneyRain() {
  const layer = document.getElementById("confettiLayer");
  const count = 40;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("img");
    piece.src = "/static/img/cards/money.png";
    piece.className = "confetti-piece money-piece";
    const size = 34 + Math.random() * 22;
    piece.style.width = size + "px";
    piece.style.left = Math.random() * 100 + "vw";
    const duration = 2.4 + Math.random() * 1.8;
    piece.style.animationDuration = duration + "s";
    piece.style.animationDelay = Math.random() * 0.5 + "s";
    layer.appendChild(piece);
    setTimeout(() => piece.remove(), (duration + 0.6) * 1000);
  }
}

/* ---------------- spin logic ----------------
   Instead of handing a CSS transition a start/end angle and walking
   away, we drive the rotation ourselves frame by frame. That lets us:
   - measure the wheel's actual instantaneous speed and turn that into
     a motion-blur amount (fast at the start, clean by the time it
     matters for reading the result), and
   - pile on a little suspense "camera zoom" as it approaches landing.
*/

function spin() {
  if (spinning || games.length < 2) return;
  spinning = true;
  spinBtn.disabled = true;
  spinBtn.classList.add("charging");
  setTimeout(() => spinBtn.classList.remove("charging"), 520);
  setLightsMode("spinning");
  wheelWrapEl.classList.add("is-spinning");

  const n = games.length;
  const wedgeAngle = 360 / n;
  const winnerIndex = Math.floor(Math.random() * n);
  const winner = games[winnerIndex];

  const centerAngle = winnerIndex * wedgeAngle + wedgeAngle / 2;
  const jitter = (Math.random() - 0.5) * wedgeAngle * 0.7;
  const desiredMod = (((-(centerAngle + jitter)) % 360) + 360) % 360;
  const currentMod = ((currentRotationDeg % 360) + 360) % 360;
  const deltaToDesired = ((desiredMod - currentMod) % 360 + 360) % 360;
  const extraTurns = 7 + Math.floor(Math.random() * 3);
  const totalDelta = extraTurns * 360 + deltaToDesired;
  const startRotation = currentRotationDeg;
  const endRotation = currentRotationDeg + totalDelta;
  const duration = prefersReducedMotion ? 1600 : 5400;

  playWhoosh(duration);

  // Fast start, long slow tail - this is what makes the last couple of
  // seconds feel like the wheel is "deciding" instead of just stopping.
  function ease(t) {
    return 1 - Math.pow(1 - t, 4);
  }

  const startTime = performance.now();
  let lastRotation = startRotation;
  let lastFrameTime = startTime;
  let lastTickBoundary = Math.floor(startRotation / wedgeAngle);

  function frame(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    const eased = ease(t);
    const rotation = startRotation + totalDelta * eased;

    if (!prefersReducedMotion) {
      const dt = Math.max(now - lastFrameTime, 1);
      const dRot = Math.abs(rotation - lastRotation);
      const speed = dRot / dt; // degrees per ms
      const blur = t < 0.85 ? Math.min(speed * 2.6, 16) : 0;
      wheelWrapEl.style.filter = blur > 0.4 ? `blur(${blur.toFixed(2)}px)` : "";

      // Suspense zoom: creeps in during the last quarter, then eases
      // back to normal exactly as the wheel lands.
      let zoom = 1;
      if (t > 0.75) {
        const zt = (t - 0.75) / 0.25;
        zoom = 1 + 0.09 * Math.sin(zt * Math.PI);
      }
      wheelWrapEl.style.transform = `scale(${zoom.toFixed(3)})`;
    }

    wheelEl.style.transform = `rotate(${rotation}deg)`;

    const boundary = Math.floor(rotation / wedgeAngle);
    if (boundary !== lastTickBoundary) {
      playTick();
      lastTickBoundary = boundary;
    }

    lastRotation = rotation;
    lastFrameTime = now;

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      wheelWrapEl.style.filter = "";
      wheelWrapEl.style.transform = "";
      currentRotationDeg = endRotation;
      finishSpin(winner);
    }
  }
  requestAnimationFrame(frame);
}

function finishSpin(winner) {
  spinning = false;
  spinBtn.disabled = games.length < 2;
  wheelWrapEl.classList.remove("is-spinning");
  setLightsMode("won");
  setTimeout(() => setLightsMode(null), 1400);
  showWinnerModal(winner);
  launchConfetti();
  playFanfare();
  fetch("/api/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: winner.name,
      cover: winner.cover || winner.cover_fallback,
      added_by: winner.added_by,
    }),
  }).then(() => fetchHistory());
}

function showWinnerModal(winner) {
  currentWinnerGame = winner;
  document.getElementById("winnerName").textContent = winner.name;
  const who = winner.added_by || "Anónimo";
  document.getElementById("winnerMessage").innerHTML =
    `<span class="winner-who">${escapeHtml(who)}</span> ganó, los demás se la tienen que bancar <span class="laugh-emoji">😂</span>`;
  const wrap = document.getElementById("winnerCoverWrap");
  wrap.innerHTML = "";
  wrap.appendChild(posterInner(winner));
  document.getElementById("winnerModal").classList.remove("hidden");
}

/* ---------------- shared duel outcome messaging ----------------
   Both minigames below (RPS and Penales) resolve to the Challenger
   winning, the Champion winning, or - RPS only - a tie. Whichever
   side wins, the "consequence" message is picked from these pools so
   a rematch doesn't always show the exact same line. The Challenger
   pool carries the joke: nothing *officially* changes if they win,
   but everyone in the room knows what it really means. */

const DUEL_MSG_CHAMPION = [
  "El Campeón defiende su corona 👑. A partir de ahora el Retador le hace caso en todo, sin quejarse.",
  "Gana el Campeón, como corresponde 👑. El Retador queda a sus órdenes por el resto de la noche.",
  "El Campeón no afloja 👑. El Retador se banca lo que el Campeón diga — ese era el trato.",
];
const DUEL_MSG_CHALLENGER = [
  "Ganó el Retador 😏. Tranquilos, la ruleta siempre se puede volver a girar cuando quieran... ya sabemos lo que eso significa entre nosotros.",
  "Se lo llevó el Retador 😏. Oficialmente no cambia nada, pero la ruleta sigue ahí, lista para girar de nuevo 👀",
  "Triunfo del Retador 😏. Como siempre decimos: la ruleta se puede volver a girar cuando quieran. Nosotros sabemos por qué.",
];
const DUEL_MSG_TIE = ["Empate. Quedate con las ganas, no hay revancha en el momento 🤝"];

function duelOutcomeMessage(side) {
  const pool = side === "champion" ? DUEL_MSG_CHAMPION : side === "challenger" ? DUEL_MSG_CHALLENGER : DUEL_MSG_TIE;
  return pool[Math.floor(Math.random() * pool.length)];
}

function resolveDuelResult(resultEl, side, flavorPrefix) {
  const msg = duelOutcomeMessage(side);
  resultEl.textContent = flavorPrefix ? `${flavorPrefix} ${msg}` : msg;
  resultEl.classList.add("show");
  if (side === "tie") {
    playBuzz();
  } else {
    playFanfare();
    launchConfetti();
  }
}

/* ---------------- duel mode select ---------------- */
let pendingChallengerName = "";
function openDuelSelect() {
  document.getElementById("duelSelectModal").classList.remove("hidden");
}
function closeDuelSelect() {
  document.getElementById("duelSelectModal").classList.add("hidden");
}

/* ---------------- RPS duel ----------------
   Now opens on an intro screen first (big key legend, no timer) so
   nobody gets ambushed by a countdown before they've even read the
   controls. The countdown only starts once someone hits "¡Arrancar!". */

const RPS_CHOICES = { piedra: "✊", papel: "✋", tijera: "✌️" };
const RPS_BEATS = { piedra: "tijera", papel: "piedra", tijera: "papel" };
let rpsState = "idle";
let rpsChallengerChoice = null;
let rpsChampionChoice = null;
let rpsKeyHandler = null;
let rpsCountdownTimer = null;
let rpsCaptureTimeout = null;

function openRpsModal() {
  document.getElementById("rpsModal").classList.remove("hidden");
  document.getElementById("rpsIntro").classList.remove("hidden");
  document.getElementById("rpsPlay").classList.add("hidden");
  resetRpsUI();
}

function closeRpsModal() {
  document.getElementById("rpsModal").classList.add("hidden");
  teardownRps();
}

function teardownRps() {
  rpsState = "idle";
  if (rpsKeyHandler) {
    window.removeEventListener("keydown", rpsKeyHandler);
    rpsKeyHandler = null;
  }
  clearInterval(rpsCountdownTimer);
  clearTimeout(rpsCaptureTimeout);
}

function resetRpsUI() {
  teardownRps();
  rpsChallengerChoice = null;
  rpsChampionChoice = null;
  document.getElementById("rpsCountdown").textContent = "";
  const cEl = document.getElementById("rpsChallengerChoice");
  const hEl = document.getElementById("rpsChampionChoice");
  cEl.textContent = "❔";
  cEl.classList.remove("picked");
  hEl.textContent = "❔";
  hEl.classList.remove("picked");
  const resultEl = document.getElementById("rpsResult");
  resultEl.textContent = "";
  resultEl.classList.remove("show");
  document.getElementById("rpsRematchBtn").classList.add("hidden");
}

function beginRpsMatch() {
  document.getElementById("rpsIntro").classList.add("hidden");
  document.getElementById("rpsPlay").classList.remove("hidden");
  resetRpsUI();
  startRpsCountdown();
}

function startRpsCountdown() {
  rpsState = "countdown";
  const cd = document.getElementById("rpsCountdown");
  const steps = ["3", "2", "1", "¡YA!"];
  let i = 0;
  const tick = () => {
    cd.textContent = steps[i];
    cd.classList.remove("pulse");
    void cd.offsetWidth;
    cd.classList.add("pulse");
    playTick();
    i += 1;
    if (i >= steps.length) {
      clearInterval(rpsCountdownTimer);
      beginRpsCapture();
    }
  };
  tick();
  rpsCountdownTimer = setInterval(tick, 550);
}

function beginRpsCapture() {
  rpsState = "capture";
  document.getElementById("rpsCountdown").textContent = "¡Elegí ya!";
  rpsKeyHandler = (e) => {
    if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (!rpsChallengerChoice && ["a", "s", "d"].includes(k)) {
      rpsChallengerChoice = k === "a" ? "piedra" : k === "s" ? "papel" : "tijera";
      const el = document.getElementById("rpsChallengerChoice");
      el.textContent = RPS_CHOICES[rpsChallengerChoice];
      el.classList.add("picked");
    }
    if (!rpsChampionChoice && ["j", "k", "l"].includes(k)) {
      rpsChampionChoice = k === "j" ? "piedra" : k === "k" ? "papel" : "tijera";
      const el = document.getElementById("rpsChampionChoice");
      el.textContent = RPS_CHOICES[rpsChampionChoice];
      el.classList.add("picked");
    }
    if (rpsChallengerChoice && rpsChampionChoice) {
      finishRps();
    }
  };
  window.addEventListener("keydown", rpsKeyHandler);
  rpsCaptureTimeout = setTimeout(() => {
    if (rpsState === "capture") finishRps();
  }, 2500);
}

function finishRps() {
  if (rpsState !== "capture") return;
  rpsState = "done";
  if (rpsKeyHandler) {
    window.removeEventListener("keydown", rpsKeyHandler);
    rpsKeyHandler = null;
  }
  clearTimeout(rpsCaptureTimeout);
  document.getElementById("rpsCountdown").textContent = "";
  const resultEl = document.getElementById("rpsResult");

  let side = "tie";
  let flavor = "";
  if (!rpsChallengerChoice && !rpsChampionChoice) {
    flavor = "Nadie apretó nada. Empate por cobardía absoluta 🐔";
  } else if (!rpsChallengerChoice) {
    flavor = "El Retador se quedó paralizado.";
    side = "champion";
  } else if (!rpsChampionChoice) {
    flavor = "El Campeón se durmió.";
    side = "challenger";
  } else if (rpsChallengerChoice === rpsChampionChoice) {
    flavor = "Empate.";
  } else if (RPS_BEATS[rpsChallengerChoice] === rpsChampionChoice) {
    side = "challenger";
  } else {
    side = "champion";
  }

  resolveDuelResult(resultEl, side, flavor);
  document.getElementById("rpsRematchBtn").classList.remove("hidden");
}

/* ---------------- Penalty kicks duel ----------------
   Turn-based on the same shared keyboard: the Retador (kicker) picks
   a corner first with A/S/D (low row) or ←/↑/→ (high row) - nothing
   is shown on screen for that pick, it only shows up once the ball is
   already flying. Only *then*, while the ball is mid-air, does the
   Campeón (keeper) get a shot at diving to one of the same six
   corners with the same keys. Flight time is tuned so a save is
   possible but not trivial. */

const PENALTY_ZONES = {
  a: "bl", s: "bc", d: "br",
  arrowleft: "tl", arrowup: "tc", arrowright: "tr",
};
const PENALTY_ZONE_POS = {
  bl: { x: 0.15, y: 0.86 }, bc: { x: 0.5, y: 0.90 }, br: { x: 0.85, y: 0.86 },
  tl: { x: 0.15, y: 0.28 }, tc: { x: 0.5, y: 0.20 }, tr: { x: 0.85, y: 0.28 },
};
const PENALTY_GOAL_FLAVORS = [
  "¡GOLAZO! El arquero se quedó mirando el pasto.",
  "¡La clavó en el ángulo! Ni con escalera la llegaba.",
  "¡Adentro! El arquero voló para el lado que no era.",
];
const PENALTY_SAVE_FLAVORS = [
  "¡QUÉ ATAJADA! Guante de oro para el arquero.",
  "¡La sacó con la punta de los guantes! Increíble.",
  "¡Leyó el tiro perfecto! Atajada de figura.",
];

let penaltyState = "idle";
let penaltyKeyHandler = null;
let penaltyFlightRAF = null;
let penaltyPowerRAF = null;
let penaltyKickZone = null;
let penaltyKeeperZone = null;
let penaltyKeeperTooSlow = false;
let penaltyFlightStartTime = 0;
let currentPower = 0;
let powerDirection = 1;
let capturedPower = 0;
let penaltyReactionCutoffMs = 300;
let penaltyReactTimer = null;
let penaltyReactRAF = null;
let penaltyRoundTimeout = null;
let shootout = null;

/**
 * REWORK "estilo PES 6": antes el arquero podía mirar el dibujo de la
 * pelota mientras volaba y leer el rincón casi de entrada, más un tiro
 * que tardaba hasta 650ms en llegar - tiempo de sobra para acertar
 * siempre. Ahora:
 *  1) El remate es bastante más rápido (ver duration abajo).
 *  2) revealFrac define hasta qué punto del vuelo la pelota se
 *     disimula (ver revealEase en launchPenaltyBall): recién después
 *     de ese punto "quiebra" visualmente hacia el rincón real, así que
 *     mirar la pantalla no sirve de nada antes de tiempo.
 *  3) La ventana para que la atajada cuente (penaltyReactionCutoffMs)
 *     se cierra justo ahí - el arquero tiene que jugársela de memoria/
 *     lectura del pateador, no de la trayectoria dibujada.
 */
function penaltyShotTiming(power) {
  let duration;
  if (power > 95) duration = 700; // a la tribuna, no hay apuro, total va afuera
  else if (power >= 85) duration = 480; // fierrazo: duro, pero jugable
  else duration = 1450 - power * 11.5; // ~1450ms flojo -> ~520ms al borde del fierrazo

  if (prefersReducedMotion) duration = 320;

  const revealFrac = 0.72;
  return { duration, cutoff: Math.round(duration * revealFrac), revealFrac };
}

function penaltyReactionWindow(power) {
  const minWindow = 550;
  const maxWindow = 900;
  const t = Math.max(0, Math.min(1, power / 84)); // 0 (flojo) -> 1 (al borde del fierrazo)
  let win = maxWindow - t * (maxWindow - minWindow);
  if (prefersReducedMotion) win += 150;
  return Math.round(win);
}

function spawnBallTrail(ball) {
  const pitch = document.querySelector(".penalty-pitch");
  if (!pitch) return;
  const rect = ball.getBoundingClientRect();
  const pitchRect = pitch.getBoundingClientRect();
  const dot = document.createElement("span");
  dot.className = "ball-trail";
  dot.textContent = "⚽";
  dot.style.left = (rect.left - pitchRect.left + rect.width / 2) + "px";
  dot.style.top = (rect.top - pitchRect.top + rect.height / 2) + "px";
  pitch.appendChild(dot);
  setTimeout(() => dot.remove(), 300);
}

function showPenaltyStamp(text, kind) {
  const stamp = document.getElementById("penaltyStamp");
  if (!stamp) return;
  stamp.textContent = text;
  stamp.className = "penalty-stamp" + (kind ? " " + kind : "");
  void stamp.offsetWidth; // reinicia la animación si se dispara dos veces seguidas
  stamp.classList.add("show");
}

function launchTrophyBurst() {
  const el = document.getElementById("trophyBurst");
  if (!el) return;
  el.classList.remove("hidden");
  void el.offsetWidth;
  el.classList.add("burst");
  setTimeout(() => {
    el.classList.remove("burst");
    el.classList.add("hidden");
  }, 1400);
}


function openPenaltyModal() {
  document.getElementById("penaltyModal").classList.remove("hidden");
  document.getElementById("penaltyIntro").classList.remove("hidden");
  document.getElementById("penaltyPlay").classList.add("hidden");
  initShootout();
  resetPenaltyUI();
}

function closePenaltyModal() {
  document.getElementById("penaltyModal").classList.add("hidden");
  teardownPenaltyRound();
}

function teardownPenaltyRound() {
  if (penaltyKeyHandler) {
    window.removeEventListener("keydown", penaltyKeyHandler);
    penaltyKeyHandler = null;
  }
  if (penaltyFlightRAF) {
    cancelAnimationFrame(penaltyFlightRAF);
    penaltyFlightRAF = null;
  }
  if (penaltyPowerRAF) {
    cancelAnimationFrame(penaltyPowerRAF);
    penaltyPowerRAF = null;
  }
  if (penaltyReactRAF) {
    cancelAnimationFrame(penaltyReactRAF);
    penaltyReactRAF = null;
  }
  if (penaltyReactTimer) {
    clearTimeout(penaltyReactTimer);
    penaltyReactTimer = null;
  }    
  if (penaltyRoundTimeout) {
    clearTimeout(penaltyRoundTimeout);
    penaltyRoundTimeout = null;
  }
}

function resetPenaltyUI() {
  teardownPenaltyRound();
  penaltyState = "idle";
  penaltyKickZone = null;
  penaltyKeeperZone = null;
  penaltyKeeperTooSlow = false;
  currentPower = 0;
  capturedPower = 0;
  powerDirection = 1; // <- evita que arranque yendo "para atrás" si el round anterior quedó bajando

  const ball = document.getElementById("penaltyBall");
  ball.style.transform = "";
  ball.classList.remove("spinning-ball");

  document.getElementById("penaltyPowerBar").style.width = "0%";
  document.getElementById("penaltyKeeper").className = "keeper";
  document.getElementById("penaltyGoal").classList.remove("net-ripple");
  document.getElementById("penaltyStamp").className = "penalty-stamp";
  const trophy = document.getElementById("trophyBurst");
  trophy.classList.remove("burst");
  trophy.classList.add("hidden");
  document.querySelectorAll(".ball-trail").forEach((t) => t.remove());

  const resultEl = document.getElementById("penaltyResult");
  resultEl.textContent = "";
  resultEl.classList.remove("show", "result-goal", "result-save");
  document.getElementById("penaltyStatus").textContent = "Pateador: clavá la barra y elegí rincón…";
  document.getElementById("penaltyRematchBtn").classList.add("hidden");
}

function startPenaltyRound() {
  resetPenaltyUI();
  penaltyState = "aiming";
  document.getElementById("penaltyKeeper").classList.add("idle-shimmy");
  updateTurnBanner();  

  // Motor de la barra de potencia
  let lastTime = performance.now();
  function animatePower(now) {
    if (penaltyState !== "aiming") return;
    const dt = now - lastTime;
    lastTime = now;

    // Sube y baja como loco
    currentPower += (powerDirection * 0.15) * dt;
    if (currentPower >= 105) { currentPower = 105; powerDirection = -1; }
    if (currentPower <= 0) { currentPower = 0; powerDirection = 1; }

    document.getElementById("penaltyPowerBar").style.width = Math.min(currentPower, 100) + "%";
    penaltyPowerRAF = requestAnimationFrame(animatePower);
  }
  penaltyPowerRAF = requestAnimationFrame(animatePower); // <- EL FIX: antes decía "performance.now"

  const doKick = (zone) => {
    capturedPower = currentPower;
    penaltyKickZone = zone;
    penaltyState = "reacting";
    document.getElementById("penaltyKeeper").classList.remove("idle-shimmy");
    document.getElementById("penaltyBall").classList.add("ball-waiting");

    const reactStart = performance.now();

    function reactFrame(now) {
      if (penaltyState !== "reacting") return;
      const remaining = Math.max(0, 3000 - (now - reactStart));
      document.getElementById("penaltyStatus").textContent =
        `¡ARQUERO, ELEGÍ UN LADO! ⏱️ ${(remaining / 1000).toFixed(1)}s`;
      document.getElementById("penaltyKeeper").classList.toggle("keeper-urgent", remaining < 800);
      if (remaining > 0) {
        penaltyReactRAF = requestAnimationFrame(reactFrame);
      }
    }
    penaltyReactRAF = requestAnimationFrame(reactFrame);

    // Recién acá, pasados los 3 segundos fijos, se hace la animación de patear
    penaltyReactTimer = setTimeout(() => {
      penaltyReactTimer = null;
      penaltyState = "flight";
      document.getElementById("penaltyBall").classList.remove("ball-waiting");
      document.getElementById("penaltyKeeper").classList.remove("keeper-urgent");

      if (capturedPower > 95) {
        document.getElementById("penaltyStatus").textContent = "¡Se pasó de potencia!";
      } else if (capturedPower >= 85) {
        document.getElementById("penaltyStatus").textContent = "¡Fierrazo inatajable! Arquero rezá...";
      } else {
        document.getElementById("penaltyStatus").textContent = "¡Va la pelota!";
      }

      launchPenaltyBall(zone, capturedPower);
    }, 3000);
  };

  penaltyKeyHandler = (e) => {
    if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
    if (e.repeat) return;
    const zone = PENALTY_ZONES[e.key.toLowerCase()];
    if (!zone) return;

    if (penaltyState === "aiming") {
      doKick(zone);
    } else if ((penaltyState === "reacting" || penaltyState === "flight") && !penaltyKeeperZone) {
      penaltyKeeperZone = zone;
      document.getElementById("penaltyKeeper").className = `keeper diving dive-${zone}`;
    }
  };
  window.addEventListener("keydown", penaltyKeyHandler);
}
function beginPenaltyMatch() {
  document.getElementById("penaltyIntro").classList.add("hidden");
  document.getElementById("penaltyPlay").classList.remove("hidden");
  startPenaltyRound();
}

function penaltyCenterOf(el) {
  const pitchRect = document.querySelector(".penalty-pitch").getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2 - pitchRect.left, y: r.top + r.height / 2 - pitchRect.top };
}

function launchPenaltyBall(zone, power) {
  const ball = document.getElementById("penaltyBall");
  const goal = document.getElementById("penaltyGoal");
  const pitchRect = document.querySelector(".penalty-pitch").getBoundingClientRect();
  const goalRect = goal.getBoundingClientRect();
  const start = penaltyCenterOf(ball);
  
  let pos = { ...PENALTY_ZONE_POS[zone] };
  
  // Si se pasó de 95%, la manda a la tribuna (Y negativo)
  if (power > 95) pos.y = -0.5;

  const target = {
    x: goalRect.left - pitchRect.left + goalRect.width * pos.x,
    y: goalRect.top - pitchRect.top + goalRect.height * pos.y,
  };
  const dx = target.x - start.x;
  const dy = target.y - start.y;

  const { duration, revealFrac } = penaltyShotTiming(power);

  ball.classList.add("spinning-ball");
  const startTime = performance.now();
  penaltyFlightStartTime = startTime;
  let trailTick = 0;

  // Hasta revealFrac la pelota casi no se desvía (no delata el rincón);
  // después "quiebra" fuerte hacia el destino real, como un tiro con
  // comba. Esto es lo que hace que mirar la pantalla no alcance para
  // atajar todo - hay que jugársela antes de ver el quiebre.
  function revealEase(t) {
    if (t <= revealFrac) {
      return 0.16 * (t / revealFrac);
    }
    const local = (t - revealFrac) / (1 - revealFrac);
    return 0.16 + 0.84 * (1 - Math.pow(1 - local, 3));
  }

  function frame(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const prog = revealEase(t);
    const lift = prefersReducedMotion ? 0 : Math.sin(t * Math.PI) * (power > 95 ? -60 : -22);
    const scale = 1 - 0.4 * prog;

    ball.style.transform =
      `translate(calc(-50% + ${(dx * prog).toFixed(1)}px), ${(dy * prog + lift).toFixed(1)}px) scale(${scale.toFixed(2)})`;
    trailTick++;
    if (!prefersReducedMotion && t < 1 && trailTick % 2 === 0) {
      spawnBallTrail(ball);
    }
    if (t < 1) {
      penaltyFlightRAF = requestAnimationFrame(frame);
    } else {
      penaltyFlightRAF = null;
      resolvePenaltyShot(zone, power);
    }
  }
  penaltyFlightRAF = requestAnimationFrame(frame);
}

function resolvePenaltyShot(kickZone, power) {
  penaltyState = "done";
  teardownPenaltyRound();
  document.getElementById("penaltyBall").classList.remove("spinning-ball");
  const goal = document.getElementById("penaltyGoal");
  let scored, flavor;

  const saved = penaltyKeeperZone === kickZone;

  if (power > 95) {
    // 1. Se pasó de rosca: siempre afuera
    document.getElementById("penaltyStatus").textContent = "¡Afuera!";
    showPenaltyStamp("¡A LA TRIBUNA!", "stamp-out");
    scored = false;
    flavor = "¡Se llenó de pelota y la mandó a la calle!";
  } else if (saved) {
    // 2. El arquero adivinó el rincón: ATAJADA (incluso si era fierrazo)
    document.getElementById("penaltyStatus").textContent = "¡Atajada!";
    showPenaltyStamp("¡ATAJADA!", "stamp-save");
    scored = false;
    if (power >= 85) {
      flavor = "¡MANO DE DIOS! Le sacó un fierrazo tremendo del ángulo.";
    } else {
      flavor = PENALTY_SAVE_FLAVORS[Math.floor(Math.random() * PENALTY_SAVE_FLAVORS.length)];
    }
  } else {
    // 3. El arquero no llegó o fue al otro palo: GOL
    goal.classList.add("net-ripple");
    setTimeout(() => goal.classList.remove("net-ripple"), 450);

    if (power >= 85) {
      document.getElementById("penaltyStatus").textContent = "¡GOLAZO!";
      showPenaltyStamp("¡GOLAZO!", "stamp-goal");
      flavor = "¡Le rompió el arco! Fierrazo inatajable.";
    } else {
      document.getElementById("penaltyStatus").textContent = "¡GOL!";
      showPenaltyStamp("¡GOL!", "stamp-goal");
      flavor = PENALTY_GOAL_FLAVORS[Math.floor(Math.random() * PENALTY_GOAL_FLAVORS.length)];
    }
    scored = true;
  }

  recordShootoutKick(scored, flavor);
}

function initShootout() {
  const championName = (currentWinnerGame && currentWinnerGame.added_by) || "Campeón";
  let challengerName = (pendingChallengerName || "").trim() || "Retador";
  if (challengerName.toLowerCase() === championName.toLowerCase()) {
    challengerName = `${challengerName} (Retador)`;
  }
    
    shootout = {
    challengerName: challengerName,
    championName: championName,
    currentKicker: "challenger", // Empieza pateando el retador
    challengerResults: [],
    championResults: []
  };
    
  document.getElementById("pbChallengerName").textContent = challengerName;
  document.getElementById("pbChampionName").textContent = championName;
  document.getElementById("pbChallengerSide").classList.remove("pb-winner");
  document.getElementById("pbChampionSide").classList.remove("pb-winner");
  document.getElementById("penaltyScoreboard").classList.remove("sudden-death");
  document.getElementById("penaltyRoleHint").textContent =
    `${challengerName} patea primero y ${championName} ataja — después se turnan en cada tiro. Mejor de 5, y si siguen empatados, muerte súbita.`;
  renderScoreboard();
}

function restartShootout() {
  initShootout();
  startPenaltyRound();
}

function renderDots(containerId, results) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  const total = Math.max(5, results.length);
  for (let i = 0; i < total; i++) {
    if (i === 5) {
      const sep = document.createElement("span");
      sep.className = "pb-dot-sep";
      el.appendChild(sep);
    }
    const dot = document.createElement("span");
    dot.className = "pb-dot" + (i < results.length ? (results[i] ? " scored" : " missed") : "");
    el.appendChild(dot);
  }
}

function renderScoreboard() {
  renderDots("pbChallengerDots", shootout.challengerResults);
  renderDots("pbChampionDots", shootout.championResults);
  const cScore = shootout.challengerResults.filter(Boolean).length;
  const hScore = shootout.championResults.filter(Boolean).length;
  document.getElementById("pbScore").innerHTML = `${cScore}<span class="pb-score-sep">-</span>${hScore}`;
}

function updateTurnBanner() {
  const kickerName = shootout.currentKicker === "challenger" ? shootout.challengerName : shootout.championName;
  const keeperName = shootout.currentKicker === "challenger" ? shootout.championName : shootout.challengerName;
  const banner = document.getElementById("penaltyTurnBanner");
  banner.textContent = `⚽ Patea ${kickerName} — ataja ${keeperName}`;
  banner.classList.remove("pop");
  void banner.offsetWidth;
  banner.classList.add("pop");
}

function recordShootoutKick(scored, flavor) {
  const kicker = shootout.currentKicker;
  const arr = kicker === "challenger" ? shootout.challengerResults : shootout.championResults;
  arr.push(scored);
  renderScoreboard();

  const cScore = shootout.challengerResults.filter(Boolean).length;
  const hScore = shootout.championResults.filter(Boolean).length;
  const cTaken = shootout.challengerResults.length;
  const hTaken = shootout.championResults.length;

  let decided = null;
  if (cTaken <= 5 && hTaken <= 5) {
    if (cScore > hScore + (5 - hTaken)) decided = "challenger";
    else if (hScore > cScore + (5 - cTaken)) decided = "champion";
  }
  if (!decided && cTaken === hTaken && cTaken >= 5 && cScore !== hScore) {
    decided = cScore > hScore ? "challenger" : "champion";
  }

  const inSuddenDeath = cTaken > 5 || hTaken > 5;
  document.getElementById("penaltyScoreboard").classList.toggle("sudden-death", inSuddenDeath && !decided);

  if (decided) {
    penaltyRoundTimeout = setTimeout(() => finishShootout(decided, flavor), 1300);
    return;
  }

  shootout.currentKicker = (cTaken + hTaken) % 2 === 0 ? "challenger" : "champion";
  penaltyRoundTimeout = setTimeout(() => startPenaltyRound(), 1600);
}

function finishShootout(side, flavor) {
  const resultEl = document.getElementById("penaltyResult");
  resultEl.classList.add(side === "challenger" ? "result-goal" : "result-save");
  document
    .getElementById(side === "challenger" ? "pbChallengerSide" : "pbChampionSide")
    .classList.add("pb-winner");
  document.getElementById("penaltyTurnBanner").textContent = "🏆 ¡Se definió la tanda!";
  resolveDuelResult(resultEl, side, flavor);
  launchTrophyBurst();
  document.getElementById("penaltyRematchBtn").classList.remove("hidden");
}

/* ---------------- init ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  spinBtn = document.getElementById("spinBtn");
  playerNameInput = document.getElementById("playerName");
  gameSearchInput = document.getElementById("gameSearch");
  manualNameInput = document.getElementById("manualName");
  manualCoverInput = document.getElementById("manualCover");
  manualAddBtn = document.getElementById("manualAddBtn");
  manualToggleBtn = document.getElementById("manualToggle");
  shareBtn = document.getElementById("shareBtn");
  soundToggleBtn = document.getElementById("soundToggle");
  closeModalBtn = document.getElementById("closeModal");
  removeWinnerBtn = document.getElementById("removeWinnerBtn");
  wheelEl = document.getElementById("wheel");
  wheelWrapEl = document.getElementById("wheelWrap");
  clearHistoryBtn = document.getElementById("clearHistoryBtn");
  clearGamesBtn = document.getElementById("clearGamesBtn");
  duelChallengeBtn = document.getElementById("duelChallengeBtn");

  soundToggleBtn.textContent = soundEnabled ? "🔊 Sonido" : "🔇 Sonido";
  soundToggleBtn.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem("wheelSoundEnabled", soundEnabled ? "on" : "off");
    soundToggleBtn.textContent = soundEnabled ? "🔊 Sonido" : "🔇 Sonido";
    if (soundEnabled) getAudioCtx();
  });

  buildLights();
  fetchGames();
  fetchHistory();
  setInterval(() => { if (!spinning) fetchGames(); }, 4000);

  setupSearch();
  setupPlayerSelect();

  spinBtn.addEventListener("click", spin);

  manualToggleBtn.addEventListener("click", () => {
    manualModeOn = !manualModeOn;
    document.getElementById("steamMode").classList.toggle("hidden", manualModeOn);
    document.getElementById("manualMode").classList.toggle("hidden", !manualModeOn);
    manualToggleBtn.textContent = manualModeOn ? "🔍 Buscar en Steam" : "✍️ Cargar manual";
  });

  manualAddBtn.addEventListener("click", () => {
    const name = manualNameInput.value.trim();
    if (!name) {
      toast("Ponele un nombre al juego.");
      return;
    }
    addGame({
      name,
      cover: manualCoverInput.value.trim(),
      added_by: playerNameInput.value.trim(),
    });
    manualNameInput.value = "";
    manualCoverInput.value = "";
  });

  closeModalBtn.addEventListener("click", () => {
    document.getElementById("winnerModal").classList.add("hidden");
  });

  removeWinnerBtn.addEventListener("click", () => {
    if (currentWinnerGame) deleteGame(currentWinnerGame.id);
    document.getElementById("winnerModal").classList.add("hidden");
  });

  duelChallengeBtn.addEventListener("click", () => {
    const championName = (currentWinnerGame && currentWinnerGame.added_by) || "Campeón";
    let challenger = (playerNameInput.value || "").trim();
    if (!challenger || challenger.toLowerCase() === championName.toLowerCase()) {
      challenger = (prompt(`¿Quién desafía a ${championName}?`, "") || "").trim();
    }
    pendingChallengerName = challenger || "Retador";
    openDuelSelect();
  });
  document.getElementById("closeDuelSelectModal").addEventListener("click", closeDuelSelect);
  document.getElementById("pickRpsBtn").addEventListener("click", () => {
    closeDuelSelect();
    openRpsModal();
  });
  document.getElementById("pickPenaltyBtn").addEventListener("click", () => {
    closeDuelSelect();
    openPenaltyModal();
  });

  document.getElementById("pickGambetaBtn").addEventListener("click", () => {
    closeDuelSelect();
    openGambetaModal();
  });

  document.querySelectorAll(".gambeta-duration-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".gambeta-duration-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      gmbSelectedDuration = parseInt(pill.dataset.duration, 10) * 1000;
    });
  });
  document.getElementById("gambetaStartBtn").addEventListener("click", () => {
    gmbInitTanda();
    startGambetaMatch();
  });
  document.getElementById("backFromGambetaIntro").addEventListener("click", () => {
    document.getElementById("gambetaModal").classList.add("hidden");
  });
  document.getElementById("gambetaExitBtn").addEventListener("click", () => {
    teardownGambeta();
    document.getElementById("gambetaModal").classList.add("hidden");
  });
  document.getElementById("gambetaRematchBtn").addEventListener("click", () => {
    gmbInitTanda(); // revancha = tanda nueva de cero, campeón arranca atacando otra vez
    startGambetaMatch();
  });
  document.getElementById("gambetaBackBtn").addEventListener("click", () => {
    teardownGambeta();
    document.getElementById("gambetaModal").classList.add("hidden");
  });
  document.getElementById("gambetaControlsBtn").addEventListener("click", () => {
    gmbBuildRemapUI();
    document.getElementById("gambetaIntro").classList.add("hidden");
    document.getElementById("gambetaControlsScreen").classList.remove("hidden");
  });
  document.getElementById("gambetaRemapBackBtn").addEventListener("click", () => {
    document.getElementById("gambetaControlsScreen").classList.add("hidden");
    document.getElementById("gambetaIntro").classList.remove("hidden");
  });
  document.getElementById("gambetaRemapResetBtn").addEventListener("click", gmbResetControls);
  gmbSetupTouchZone("gambetaTouchLeft", "gambetaJoyLeft", "gambetaDashBtnLeft", "gambetaKickBtnLeft", "left");
  gmbSetupTouchZone("gambetaTouchRight", "gambetaJoyRight", "gambetaDashBtnRight", "gambetaKickBtnRight", "right");

  document.getElementById("rpsStartBtn").addEventListener("click", beginRpsMatch);
  document.getElementById("backFromRpsIntro").addEventListener("click", () => {
    document.getElementById("rpsModal").classList.add("hidden");
    teardownRps();
    openDuelSelect();
  });
  document.getElementById("closeRpsModal").addEventListener("click", closeRpsModal);
  document.getElementById("rpsRematchBtn").addEventListener("click", beginRpsMatch);

  document.getElementById("penaltyStartBtn").addEventListener("click", beginPenaltyMatch);
  document.getElementById("backFromPenaltyIntro").addEventListener("click", () => {
    document.getElementById("penaltyModal").classList.add("hidden");
    teardownPenaltyRound();
    openDuelSelect();
  });
  document.getElementById("closePenaltyModal").addEventListener("click", closePenaltyModal);
  document.getElementById("penaltyRematchBtn").addEventListener("click", restartShootout);

  clearGamesBtn.addEventListener("click", async () => {
    if (games.length === 0) return;
    if (!confirm("¿Seguro que querés vaciar todos los juegos de la ruleta? No se puede deshacer.")) return;
    try {
      await fetch("/api/games", { method: "DELETE" });
      await fetchGames();
      toast("Juegos vaciados. Ruleta en blanco. 🧹");
    } catch (err) {
      toast("No se pudo vaciar la lista de juegos.");
    }
  });

  clearHistoryBtn.addEventListener("click", async () => {
    if (!confirm("¿Seguro que querés borrar todo el historial y el ranking? No se puede deshacer.")) return;
    try {
      await fetch("/api/history", { method: "DELETE" });
      await fetchHistory();
      toast("Historial y ranking borrados. Tabula rasa. 🧹");
    } catch (err) {
      toast("No se pudo borrar el historial.");
    }
  });

  shareBtn.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/server-info");
      const info = await res.json();
      const url = `http://${info.ip}:${info.port}`;
      document.getElementById("shareLinkBox").textContent = url;
      document.getElementById("shareModal").classList.remove("hidden");
    } catch (err) {
      toast("No se pudo obtener el link para compartir.");
    }
  });

  document.getElementById("copyShareLinkBtn").addEventListener("click", async () => {
    const url = document.getElementById("shareLinkBox").textContent;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copiado al portapapeles.");
    } catch (e) {
      toast("No se pudo copiar automáticamente, copialo a mano.");
    }
  });

  document.getElementById("closeShareModal").addEventListener("click", () => {
    document.getElementById("shareModal").classList.add("hidden");
  });

  window.addEventListener("resize", debounce(() => {
    buildLights();
    if (!spinning) renderWheel();
  }, 200));
});

/* ===================== La Velada (boxeo) — FASE 1 ===================== */

const FIGHT_MAX_HEALTH = 100;
const FIGHT_MAX_ENERGY = 100;
const FIGHT_PUNCH_COST = 25;
const FIGHT_PUNCH_DAMAGE = 12;
const FIGHT_ENERGY_REGEN_PER_SEC = 18;
const FIGHT_REGEN_TICK_MS = 150;
const FIGHT_RESOLVE_WINDOW_MS = 600;
const FIGHT_ROUND_SECONDS = 60;
const FIGHT_MAX_ROUNDS = 3;

// Fácil de remapear más adelante (Fase 4) — por ahora, fijo.
let fightControls = {
  left:  { golpe_arriba: "q", golpe_medio: "w", golpe_abajo: "e", esquiva_arriba: "a", esquiva_medio: "s", esquiva_abajo: "d" },
  right: { golpe_arriba: "u", golpe_medio: "i", golpe_abajo: "o", esquiva_arriba: "j", esquiva_medio: "k", esquiva_abajo: "l" },
};

let fight = null;
let fightKeyHandler = null;
let fightPendingTimeouts = [];

function fightSetTimeout(fn, ms) {
  const id = setTimeout(() => {
    fightPendingTimeouts = fightPendingTimeouts.filter((t) => t !== id);
    fn();
  }, ms);
  fightPendingTimeouts.push(id);
  return id;
}

function showFightScreen(id) {
  ["fightIntro1", "fightIntro2", "fightPick", "fightPlay"].forEach((s) => {
    document.getElementById(s).classList.toggle("hidden", s !== id);
  });
}

function initFightNames() {
  const championName = (currentWinnerGame && currentWinnerGame.added_by) || "Campeón";
  let challengerName = (pendingChallengerName || "").trim() || "Retador";
  if (challengerName.toLowerCase() === championName.toLowerCase()) {
    challengerName = `${challengerName} (Retador)`;
  }
  document.getElementById("fightP1ControlsLabel").textContent = championName;
  document.getElementById("fightP2ControlsLabel").textContent = challengerName;
  document.getElementById("fightPickerName").textContent = championName;
}

function openFightModal() {
  document.getElementById("fightModal").classList.remove("hidden");
  document.getElementById("fightResultOverlay").classList.add("hidden");
  showFightScreen("fightIntro1");
  initFightNames();
}

function makeFighterState(side, fighterId, name) {
  return {
    side, fighterId, name,
    health: FIGHT_MAX_HEALTH,
    energy: FIGHT_MAX_ENERGY,
    isAttacking: false,
    incomingAttack: null,
    dodgeHeight: null,
    dodgeResetTimeout: null,
    lastPunchAt: 0,
    pendingResolveId: null,
  };
}

function otherFighter(fighter) {
  return fighter.side === "left" ? fight.right : fight.left;
}

function fighterElId(fighter) { return fighter.side === "left" ? "fightFighterLeft" : "fightFighterRight"; }
function fighterImgId(fighter) { return fighter.side === "left" ? "fightLeftImg" : "fightRightImg"; }

// De qué lado mira "de fábrica" cada PNG. Si algún día algún personaje
// aparece mirando para el lado que no es, tocás esto, no el CSS.
const FIGHTER_NATIVE_FACING = { momo: "right", viruzz: "left" };

function requiredFacing(side) {
  return side === "left" ? "right" : "left"; // siempre mirando al centro
}

function setFighterPose(fighter, pose) {
  const img = document.getElementById(fighterImgId(fighter));
  img.src = `/static/img/fighters/${fighter.fighterId}_${pose}.png`;
  img.alt = fighter.fighterId;
  img.dataset.fighterId = fighter.fighterId;

  const native = FIGHTER_NATIVE_FACING[fighter.fighterId] || "right";
  const needed = requiredFacing(fighter.side);
  img.style.setProperty("--facing", native === needed ? "1" : "-1");
}

function playPunchAnim(fighter, height) {
  setFighterPose(fighter, `golpe_${height}`);
  const el = document.getElementById(fighterElId(fighter));
  el.classList.remove("fight-anim-punch");
  void el.offsetWidth;
  el.classList.add("fight-anim-punch");
}

function playDodgeAnim(fighter, height) {
  setFighterPose(fighter, `esquiva_${height}`);
  const el = document.getElementById(fighterElId(fighter));
  el.classList.remove("fight-anim-dodge");
  void el.offsetWidth;
  el.classList.add("fight-anim-dodge");
}

function playHitAnim(fighter) {
  const el = document.getElementById(fighterElId(fighter));
  el.classList.remove("fight-anim-hit");
  void el.offsetWidth;
  el.classList.add("fight-anim-hit");
  const arena = document.querySelector(".fight-arena");
  arena.classList.remove("fight-shake");
  void arena.offsetWidth;
  arena.classList.add("fight-shake");
}

function resetFighterPose(fighter) {
  const el = document.getElementById(fighterElId(fighter));
  el.classList.remove("fight-anim-punch", "fight-anim-dodge", "fight-anim-hit");
  setFighterPose(fighter, "neutral");
}

function renderFightBars() {
  setBarWidths("fightLeftHealthFill", "fightLeftHealthGhost", fight.left.health);
  setBarWidths("fightRightHealthFill", "fightRightHealthGhost", fight.right.health);

  document.getElementById("fightLeftEnergyFill").style.width = fight.left.energy + "%";
  document.getElementById("fightRightEnergyFill").style.width = fight.right.energy + "%";
  document.getElementById("fightLeftEnergyBar").classList.toggle("energy-low", fight.left.energy < 25);
  document.getElementById("fightRightEnergyBar").classList.toggle("energy-low", fight.right.energy < 25);
}

function setBarWidths(mainId, ghostId, value) {
  document.getElementById(mainId).style.width = value + "%";
  document.getElementById(ghostId).style.width = value + "%";
}

function updateFightRoundLabel() {
  document.getElementById("fightRoundLabel").textContent = `Round ${fight.round}/${FIGHT_MAX_ROUNDS}`;
  document.getElementById("fightTimerLabel").textContent = fight.roundTimeLeft;
}

function flashFightStatus(text) {
  const el = document.getElementById("fightStatus");
  el.textContent = text;
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
}

function fightEnergyTick() {
  if (!fight || fight.over) return;
  const gain = FIGHT_ENERGY_REGEN_PER_SEC * (FIGHT_REGEN_TICK_MS / 1000);
  fight.left.energy = Math.min(FIGHT_MAX_ENERGY, fight.left.energy + gain);
  fight.right.energy = Math.min(FIGHT_MAX_ENERGY, fight.right.energy + gain);
  renderFightBars();
}

function startRoundTimer() {
  clearInterval(fight.roundTimerInterval);
  fight.roundTimerInterval = setInterval(() => {
    if (!fight || fight.over) return;
    fight.roundTimeLeft -= 1;
    document.getElementById("fightTimerLabel").textContent = fight.roundTimeLeft;
    if (fight.roundTimeLeft <= 0) endRound();
  }, 1000);
}

function endRound() {
  clearInterval(fight.roundTimerInterval);
  if (fight.round >= FIGHT_MAX_ROUNDS) {
    const winnerSide = fight.left.health === fight.right.health
      ? null
      : (fight.left.health > fight.right.health ? "left" : "right");
    endFight(winnerSide, "decision");
    return;
  }
  flashFightStatus(`Fin del round ${fight.round}. Descansando unos segundos…`);
  fight.round += 1;
  fight.roundTimeLeft = FIGHT_ROUND_SECONDS;
  updateFightRoundLabel();
  // FASE 3: acá va a entrar la ventana de evento aleatorio entre rounds,
  // antes de llamar a startRoundTimer() de nuevo.
  fightSetTimeout(() => {
    if (fight && !fight.over) startRoundTimer();
  }, 2500);
}

const FIGHT_CLASH_WINDOW_MS = 220;   // qué tan "al mismo tiempo" cuenta como choque
const FIGHT_CLASH_DURATION_MS = 1600;
const FIGHT_CLASH_BONUS_DAMAGE = 22;
const FIGHT_CLASH_STAGGER_ENERGY = 20;

let clash = null;

function tryPunch(fighter, height) {
  if (!fight || fight.over || fighter.isAttacking || clash) return;
  if (fighter.energy < FIGHT_PUNCH_COST) {
    flashFightStatus(`${fighter.name} no tiene energía para pegar ⚡`);
    return;
  }

  fighter.energy -= FIGHT_PUNCH_COST;
  fighter.isAttacking = true;
  fighter.lastPunchAt = performance.now();
  renderFightBars();

  const opponent = otherFighter(fighter);

  // ¿El rival tiró un golpe hace un instante y todavía está "en el aire"?
  // Ahí es choque, no dos golpes resueltos por separado.
  if (opponent.isAttacking && performance.now() - opponent.lastPunchAt < FIGHT_CLASH_WINDOW_MS) {
    if (opponent.pendingResolveId) clearTimeout(opponent.pendingResolveId);
    startClash(fighter, opponent);
    return;
  }

  playPunchAnim(fighter, height);
  opponent.incomingAttack = { height };
  fighter.pendingResolveId = fightSetTimeout(() => resolvePunch(fighter, opponent, height), FIGHT_RESOLVE_WINDOW_MS);
}

function startClash(fighterA, fighterB) {
  clash = { left: 0, right: 0, timeoutId: null };
  flashFightStatus("¡CHOQUE DE PUÑOS! 💥");
  document.getElementById("fightClashOverlay").classList.remove("hidden");
  const fill = document.getElementById("fightClashFill");
  fill.style.left = "50%";
  fill.style.width = "0%";
  document.querySelector(".fight-arena").classList.add("fight-shake");
  clash.timeoutId = fightSetTimeout(resolveClash, FIGHT_CLASH_DURATION_MS);
}

function registerClashMash(side) {
  if (!clash) return;
  clash[side] += 1;
  const diff = clash.left - clash.right; // >0 va ganando la izquierda
  const pct = Math.max(-50, Math.min(50, diff * 4));
  const fill = document.getElementById("fightClashFill");
  if (pct >= 0) { fill.style.left = "50%"; fill.style.width = pct + "%"; }
  else { fill.style.left = (50 + pct) + "%"; fill.style.width = Math.abs(pct) + "%"; }
}

function resolveClash() {
  const { left, right } = clash;
  document.getElementById("fightClashOverlay").classList.add("hidden");
  clash = null;

  fight.left.isAttacking = false;
  fight.right.isAttacking = false;
  resetFighterPose(fight.left);
  resetFighterPose(fight.right);

  if (left === right) {
    flashFightStatus("¡Empate en el choque! Los dos retroceden.");
    return;
  }

  const winnerSide = left > right ? "left" : "right";
  const winner = fight[winnerSide];
  const loser = winnerSide === "left" ? fight.right : fight.left;

  loser.health = Math.max(0, loser.health - FIGHT_CLASH_BONUS_DAMAGE);
  loser.energy = Math.max(0, loser.energy - FIGHT_CLASH_STAGGER_ENERGY);
  renderFightBars();
  playHitAnim(loser);
  document.getElementById(fighterElId(loser)).classList.add("fight-anim-knockback");
  fightSetTimeout(() => document.getElementById(fighterElId(loser)).classList.remove("fight-anim-knockback"), 500);
  flashFightStatus(`¡${winner.name} ganó el choque y la sacudió a ${loser.name}! 💥`);

  if (loser.health <= 0) fightSetTimeout(() => endFight(winnerSide, "ko"), 450);
  else fightSetTimeout(() => resetFighterPose(loser), 450);
}

function resolvePunch(attacker, defender, height) {
  if (!fight || fight.over) return;
  const dodged = defender.dodgeHeight === height;

  attacker.isAttacking = false;
  resetFighterPose(attacker);

  if (dodged) {
    flashFightStatus(`${defender.name} esquivó el golpe de ${attacker.name}! 🛡️`);
    defender.incomingAttack = null;
    defender.dodgeHeight = null;
    resetFighterPose(defender);
    return;
  }

  defender.health = Math.max(0, defender.health - FIGHT_PUNCH_DAMAGE);
  renderFightBars();
  playHitAnim(defender);
  flashFightStatus(`${attacker.name} conecta contra ${defender.name}! 🥊`);
  defender.incomingAttack = null;
  defender.dodgeHeight = null;

  if (defender.health <= 0) {
    fightSetTimeout(() => endFight(attacker.side, "ko"), 380);
  } else {
    fightSetTimeout(() => resetFighterPose(defender), 380);
  }
}

function tryDodge(fighter, height) {
  if (!fight || fight.over) return;
  fighter.dodgeHeight = height;
  playDodgeAnim(fighter, height);
  clearTimeout(fighter.dodgeResetTimeout);
  fighter.dodgeResetTimeout = fightSetTimeout(() => {
    if (!fighter.incomingAttack) {
      fighter.dodgeHeight = null;
      resetFighterPose(fighter);
    }
  }, 400);
}

function endFight(winnerSide, reason) {
  fight.over = true;
  clearInterval(fight.roundTimerInterval);
  clearInterval(fight.energyRegenInterval);
  removeFightKeyHandler();

  const overlay = document.getElementById("fightResultOverlay");
  const title = document.getElementById("fightResultTitle");
  const sub = document.getElementById("fightResultSub");

  if (!winnerSide) {
    title.textContent = "¡EMPATE!";
    sub.textContent = "Terminaron con la misma vida. Nadie se lleva el cinturón.";
  } else {
    const winner = winnerSide === "left" ? fight.left : fight.right;
    title.textContent = reason === "ko" ? `¡K.O.! Gana ${winner.name}` : `¡Gana ${winner.name} por puntos!`;
    sub.textContent = reason === "ko"
      ? "Lo mandó a dormir."
      : `Le quedó más vida al final de los ${FIGHT_MAX_ROUNDS} rounds.`;
  }
  overlay.classList.remove("hidden");
  launchConfetti();
  playFanfare();
}

function startFight(leftFighterId, rightFighterId) {
  teardownFight();
  const championName = (currentWinnerGame && currentWinnerGame.added_by) || "Campeón";
  let challengerName = (pendingChallengerName || "").trim() || "Retador";
  if (challengerName.toLowerCase() === championName.toLowerCase()) {
    challengerName = `${challengerName} (Retador)`;
  }
  fight = {
    left: makeFighterState("left", leftFighterId, championName),
    right: makeFighterState("right", rightFighterId, challengerName),
    round: 1,
    roundTimeLeft: FIGHT_ROUND_SECONDS,
    roundTimerInterval: null,
    energyRegenInterval: null,
    over: false,
  };
  document.getElementById("fightLeftName").textContent = championName;
  document.getElementById("fightRightName").textContent = challengerName;
  document.getElementById("fightResultOverlay").classList.add("hidden");
  showFightScreen("fightPlay");
  renderFightBars();
  resetFighterPose(fight.left);
  resetFighterPose(fight.right);
  updateFightRoundLabel();
  fight.energyRegenInterval = setInterval(fightEnergyTick, FIGHT_REGEN_TICK_MS);
  startRoundTimer();
  attachFightKeyHandler();
}

function pickFighter(fighterId) {
  const otherId = fighterId === "momo" ? "viruzz" : "momo";
  startFight(fighterId, otherId);
}

function attachFightKeyHandler() {
  removeFightKeyHandler();
  fightKeyHandler = (e) => {
    if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
    if (!fight || fight.over) return;
    const key = e.key.toLowerCase();

    if (clash) {
      if (Object.values(fightControls.left).includes(key)) registerClashMash("left");
      else if (Object.values(fightControls.right).includes(key)) registerClashMash("right");
      return;
    }

    ["left", "right"].forEach((side) => {
      const map = fightControls[side];
      const fighter = fight[side];
      Object.keys(map).forEach((action) => {
        if (map[action] !== key) return;
        const [kind, height] = action.split("_");
        if (kind === "golpe") tryPunch(fighter, height);
        else if (kind === "esquiva") tryDodge(fighter, height);
      });
    });
  };
  window.addEventListener("keydown", fightKeyHandler);
}

function removeFightKeyHandler() {
  if (fightKeyHandler) {
    window.removeEventListener("keydown", fightKeyHandler);
    fightKeyHandler = null;
  }
}

function teardownFight() {
  fightPendingTimeouts.forEach(clearTimeout);
  fightPendingTimeouts = [];
  if (fight) {
    clearInterval(fight.roundTimerInterval);
    clearInterval(fight.energyRegenInterval);
  }
  if (clash) {
    clearTimeout(clash.timeoutId);
    clash = null;
    document.getElementById("fightClashOverlay").classList.add("hidden");
  }
  removeFightKeyHandler();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("pickFightBtn").addEventListener("click", () => {
    closeDuelSelect();
    openFightModal();
  });
  document.getElementById("closeFightModal").addEventListener("click", () => {
    teardownFight();
    fight = null;
    document.getElementById("fightModal").classList.add("hidden");
  });
  document.getElementById("fightIntro1NextBtn").addEventListener("click", () => showFightScreen("fightIntro2"));
  document.getElementById("fightIntro2BackBtn").addEventListener("click", () => showFightScreen("fightIntro1"));
  document.getElementById("fightIntro2NextBtn").addEventListener("click", () => showFightScreen("fightPick"));
  document.getElementById("fightPickBackBtn").addEventListener("click", () => showFightScreen("fightIntro2"));
  document.querySelectorAll(".fight-pick-card").forEach((card) => {
    card.addEventListener("click", () => pickFighter(card.dataset.fighter));
  });
  document.getElementById("fightRematchBtn").addEventListener("click", () => {
    if (fight) startFight(fight.left.fighterId, fight.right.fighterId);
  });
  document.getElementById("fightBackToPickBtn").addEventListener("click", () => {
    teardownFight();
    fight = null;
    document.getElementById("fightResultOverlay").classList.add("hidden");
    showFightScreen("fightPick");
  });
});


/* ===================== Ride the Bus — FASE 1 ===================== */

let busSelectedRounds = null;
let busState = null;
let busBetState = { leftHetero: false, rightHetero: false };
let busPendingTimeouts = [];

function busSetTimeout(fn, ms) {
  const id = setTimeout(() => {
    busPendingTimeouts = busPendingTimeouts.filter((t) => t !== id);
    fn();
  }, ms);
  busPendingTimeouts.push(id);
  return id;
}

function showBusScreen(id) {
  ["busRoundsPick", "busBankroll", "busBetScreen", "busGameTable", "busFinalScreen"].forEach((s) => {
    document.getElementById(s).classList.toggle("hidden", s !== id);
  });
}

// Ficha sheet: 8 columnas x 4 filas, celda 46x48 (mostrada a 2x = 92x96).
// Fila 3 (col 4-7) = naranja/dorado -> campeón. Fila 0 (col 4-7) = celeste -> retador.
const BUS_CHIP_CELL = { w: 46, h: 48, scale: 2 };
const BUS_CHIP_COLOR = { left: { row: 3, colOffset: 4 }, right: { row: 0, colOffset: 4 } };

function chipTierForAmount(amount) {
  if (amount < 325) return 0;
  if (amount < 550) return 1;
  if (amount < 775) return 2;
  return 3;
}

function setChipVisual(side, amount) {
  const tier = chipTierForAmount(amount);
  const { row, colOffset } = BUS_CHIP_COLOR[side];
  const col = colOffset + tier;
  const el = document.getElementById(side === "left" ? "busChipImgLeft" : "busChipImgRight");
  el.style.backgroundPosition = `-${col * BUS_CHIP_CELL.w * BUS_CHIP_CELL.scale}px -${row * BUS_CHIP_CELL.h * BUS_CHIP_CELL.scale}px`;
}

// ===== Pilas de fichas apiladas (para mesa, apuestas y billetera) =====
// Usa el mismo sheet fichas.png, pero a la mitad de tamaño para poder amontonar varias.
const BUS_PILE_CELL = { w: 23, h: 24 };
const BUS_CHIP_DENOMS = [
  { value: 500, rc: 3 },
  { value: 100, rc: 2 },
  { value: 50, rc: 1 },
  { value: 10, rc: 0 },
];
const BUS_PILE_STACK_MAX = 8;        // fichas apiladas antes de abrir una pila nueva
const BUS_PILE_STACKS_PER_DENOM = 2; // como mucho 2 pilas por denominación (después solo sube el contador ×N)

function busChipBreakdown(amount) {
  let remaining = Math.max(0, Math.round(amount / 10) * 10);
  return BUS_CHIP_DENOMS.map((d) => {
    const n = Math.floor(remaining / d.value);
    remaining -= n * d.value;
    return n;
  });
}

function buildChipStackEl(row, col, count, badgeExtra) {
  const stack = document.createElement("div");
  stack.className = "bus-chip-pile-stack";
  stack.style.height = `${BUS_PILE_CELL.h + (count - 1) * 6}px`;
  for (let i = 0; i < count; i++) {
    const chip = document.createElement("div");
    chip.className = "bus-chip-pile-piece";
    chip.style.bottom = `${i * 6}px`;
    chip.style.zIndex = String(i);
    chip.style.backgroundPosition = `-${col * BUS_PILE_CELL.w}px -${row * BUS_PILE_CELL.h}px`;
    stack.appendChild(chip);
  }
  if (badgeExtra) {
    const badge = document.createElement("span");
    badge.className = "bus-chip-pile-badge";
    badge.textContent = badgeExtra;
    stack.appendChild(badge);
  }
  return stack;
}

// side: "left" | "right" -> usa el mismo color que ya tenías definido en BUS_CHIP_COLOR
function renderChipPile(containerId, side, amount) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const prevAmount = parseFloat(container.dataset.prevAmount || "0");
  const grew = amount > prevAmount;
  const changed = amount !== prevAmount;
  container.dataset.prevAmount = String(amount);
  container.innerHTML = "";
  const { row, colOffset } = BUS_CHIP_COLOR[side];
  const counts = busChipBreakdown(amount);
  let anyChip = false;

  BUS_CHIP_DENOMS.forEach((denom, i) => {
    const n = counts[i];
    if (n <= 0) return;
    anyChip = true;
    const maxVisible = BUS_PILE_STACK_MAX * BUS_PILE_STACKS_PER_DENOM;
    const overflow = n > maxVisible;
    let remaining = overflow ? maxVisible : n;
    while (remaining > 0) {
      const stackCount = Math.min(remaining, BUS_PILE_STACK_MAX);
      remaining -= stackCount;
      const isLastStack = remaining <= 0;
      container.appendChild(
        buildChipStackEl(row, colOffset + denom.rc, stackCount, overflow && isLastStack ? `×${n}` : null)
      );
    }
  });

  // Escalonamos la caída de todas las fichas del contenedor
  container.querySelectorAll(".bus-chip-pile-piece").forEach((piece, idx) => {
    piece.style.animationDelay = `${idx * 30}ms`;
  });

  container.classList.toggle("bus-chip-pile-empty", !anyChip);

  if (changed && anyChip) {
    container.classList.remove("bus-chip-pile-pulse");
    void container.offsetWidth;
    container.classList.add("bus-chip-pile-pulse");
  }
  if (grew) {
    busPlaySound("/static/audio/Poker_chips5.wav", 0.45);
  }
}
function randomBankroll() {
  return Math.round((100 + Math.random() * 900) / 10) * 10;
}

function playCashRegister() {
  if (!soundEnabled) return;
  const ctx = getAudioCtx();
  [880, 1318.5].forEach((freq, idx) => {
    setTimeout(() => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.32);
    }, idx * 90);
  });
}

function spinBankroll(side) {
  if (!busState) return;
  const rolledKey = side === "left" ? "leftRolled" : "rightRolled";
  if (busState[rolledKey]) return;

  const btn = document.getElementById(side === "left" ? "busRollBtnLeft" : "busRollBtnRight");
  const amountEl = document.getElementById(side === "left" ? "busWalletAmountLeft" : "busWalletAmountRight");
  const stackEl = document.getElementById(side === "left" ? "busChipStackLeft" : "busChipStackRight");
  btn.disabled = true;
  amountEl.classList.add("spinning");

  const finalAmount = randomBankroll();
  const totalTicks = 22;
  let delay = 40;
  let tick = 0;

  function step() {
    tick += 1;
    if (tick >= totalTicks) {
      amountEl.textContent = "$" + finalAmount;
      amountEl.classList.remove("spinning");
      stackEl.classList.remove("bus-chip-not-rolled");
      setChipVisual(side, finalAmount);
      renderChipPile(side === "left" ? "busPileLeft" : "busPileRight", side, finalAmount);  
      playCashRegister();
      if (side === "left") {
        busState.leftAmount = finalAmount;
        busState.leftRolled = true;
      } else {
        busState.rightAmount = finalAmount;
        busState.rightRolled = true;
      }
      checkBusBankrollReady();
      return;
    }
    amountEl.textContent = "$" + randomBankroll();
    playTick();
    delay = Math.min(delay * 1.16, 260);
    busSetTimeout(step, delay);
  }

  busSetTimeout(step, delay);
}

function checkBusBankrollReady() {
  const ready = busState.leftRolled && busState.rightRolled;
  document.getElementById("busBankrollNextBtn").disabled = !ready;
  document.getElementById("busBankrollStatus").textContent = ready
    ? "¡Los dos tienen billetera! Podés seguir."
    : "Los dos tienen que girar antes de seguir.";
}

function initBusBankroll() {
  const championName = (currentWinnerGame && currentWinnerGame.added_by) || "Campeón";
  let challengerName = (pendingChallengerName || "").trim() || "Retador";
  if (challengerName.toLowerCase() === championName.toLowerCase()) {
    challengerName = `${challengerName} (Retador)`;
  }
  busState = {
    rounds: busSelectedRounds,
    championName,
    challengerName,
    leftAmount: 0,
    rightAmount: 0,
    leftRolled: false,
    rightRolled: false,
    ticketUsed: false,
    ticketAvailableFor: null,
    leftStreak: 0,   
    rightStreak: 0,  
  };
  busBetState = { leftHetero: false, rightHetero: false }; // NUEVO
  document.getElementById("busWalletLeftName").textContent = championName;
  document.getElementById("busWalletRightName").textContent = challengerName;
  document.getElementById("busRoundsLabel").textContent = busSelectedRounds;

  ["left", "right"].forEach((side) => {
    const amountEl = document.getElementById(side === "left" ? "busWalletAmountLeft" : "busWalletAmountRight");
    const btn = document.getElementById(side === "left" ? "busRollBtnLeft" : "busRollBtnRight");
    const stackEl = document.getElementById(side === "left" ? "busChipStackLeft" : "busChipStackRight");
    amountEl.textContent = "$?";
    amountEl.classList.remove("spinning");
    btn.disabled = false;
    setChipVisual(side, 100);
    renderChipPile(side === "left" ? "busPileLeft" : "busPileRight", side, 0);  
    stackEl.classList.add("bus-chip-not-rolled");
  });
  checkBusBankrollReady();
}

function openBusModal() {
  teardownBus();
  document.getElementById("busModal").classList.remove("hidden");
  busSelectedRounds = null;
  document.querySelectorAll(".bus-rounds-pill").forEach((p) => p.classList.remove("active"));
  document.getElementById("busRoundsNextBtn").disabled = true;
  showBusScreen("busRoundsPick");
}

function teardownBus() {
  busPendingTimeouts.forEach(clearTimeout);
  busPendingTimeouts = [];
  busState = null;
  busGame = null;
}

/* ===================== Ride the Bus — FASE 2A: motor de rondas ===================== */

let busGame = null;

const BUS_SUITS = ["hearts", "diamonds", "spades", "clubs"];
const BUS_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const BUS_DECK_CELL = { w: 48, h: 64, scale: 2 };

function busRankValue(rank) {
  if (rank === "A") return 14;
  if (rank === "K") return 13;
  if (rank === "Q") return 12;
  if (rank === "J") return 11;
  return parseInt(rank, 10);
}
function busRankLabel(value) {
  if (value === 14) return "A";
  if (value === 13) return "K";
  if (value === 12) return "Q";
  if (value === 11) return "J";
  return String(value);
}

function busBuildShuffledDeck() {
  const deck = [];
  BUS_SUITS.forEach((suit, suitIdx) => {
    BUS_RANKS.forEach((rank, rankIdx) => {
      deck.push({
        suit, suitIdx, rank, rankIdx,
        value: busRankValue(rank),
        color: (suit === "hearts" || suit === "diamonds") ? "red" : "black",
      });
    });
  });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function busCardBgPosition(card) {
  return `-${card.rankIdx * BUS_DECK_CELL.w * BUS_DECK_CELL.scale}px -${card.suitIdx * BUS_DECK_CELL.h * BUS_DECK_CELL.scale}px`;
}

function busPlaySound(path, volume) {
  try {
    const a = new Audio(path);
    a.volume = volume != null ? volume : 0.55;
    a.play().catch(() => {});
  } catch (e) {
    /* no rompe el juego si el navegador bloquea el audio */
  }
}

function busPlaySoundThen(path, volume, callback) {
  try {
    const a = new Audio(path);
    a.volume = volume != null ? volume : 0.55;
    a.addEventListener("ended", () => callback && callback());
    a.play().catch(() => { callback && callback(); });
  } catch (e) {
    callback && callback();
  }
}

const BUS_ROUND_QUESTIONS = {
  1: "¿La carta es roja o negra?",
  2: "¿La próxima es mayor-o-igual o menor?",
  4: "¿De qué palo exacto es?",
};

function busRoundQuestionText(round) {
  if (round === 3) {
    const a = busGame.revealed[0].value;
    const b = busGame.revealed[1].value;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (lo === hi) return `¡Empate en ${busRankLabel(lo)}! "Adentro" es imposible — solo sirve afuera.`;
    return `¿La carta 3 cae ADENTRO o AFUERA de ${busRankLabel(lo)}–${busRankLabel(hi)}?`;
  }
  return BUS_ROUND_QUESTIONS[round];
}

function busGuessOptionsFor(round) {
  if (round === 1) return [{ id: "red", label: "🔴 Roja" }, { id: "black", label: "⚫ Negra" }];
  if (round === 2) return [{ id: "ge", label: "⬆️ Mayor o igual" }, { id: "lt", label: "⬇️ Menor" }];
  if (round === 3) return [{ id: "in", label: "↔️ Adentro" }, { id: "out", label: "↕️ Afuera" }];
  return [
    { id: "hearts", label: "♥️ Corazones" },
    { id: "diamonds", label: "♦️ Diamantes" },
    { id: "spades", label: "♠️ Picas" },
    { id: "clubs", label: "♣️ Tréboles" },
  ];
}

function renderBusGuessOptions() {
  const wrap = document.getElementById("busGuessOptions");
  wrap.innerHTML = "";
  busGuessOptionsFor(busGame.round).forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bus-guess-btn";
    btn.dataset.guess = opt.id;
    btn.textContent = opt.label;
    btn.addEventListener("click", () => onBusGuessClick(opt.id));
    wrap.appendChild(btn);
  });

  if (busGame.round >= 2) {
    const mult = BUS_CUMULATIVE_MULT[busGame.round - 1];
    const bet = busGame.currentTurn === "left" ? busGame.betLeft : busGame.betRight;
    const payout = Math.round(bet * mult);
    const cashBtn = document.createElement("button");
    cashBtn.type = "button";
    cashBtn.className = "bus-guess-btn bus-cashout-btn";
    cashBtn.textContent = `💰 Plantarse y cobrar $${payout} (x${mult})`;
    cashBtn.addEventListener("click", onBusCashout);
    wrap.appendChild(cashBtn);
  }
}

const BUS_ROUND_MULT = { 1: 2, 2: 3, 3: 4, 4: 10 };
const BUS_CUMULATIVE_MULT = (() => {
  const out = {};
  let running = 1;
  [1, 2, 3, 4].forEach((r) => {
    running *= BUS_ROUND_MULT[r];
    out[r] = running;
  });
  return out;
})();

function busHudTagInfo(side) {
  const playing = side === "left" ? busGame.leftPlaying : busGame.rightPlaying;
  const done = side === "left" ? busGame.leftDone : busGame.rightDone;
  const outcome = side === "left" ? busGame.leftOutcome : busGame.rightOutcome;
  const alive = side === "left" ? busGame.leftAlive : busGame.rightAlive;
  if (!playing) return { text: "Sin fondos", cls: "bus-hud-tag-out" };
  if (done) {
    if (outcome === "won") return { text: "¡Ganó! 🏆", cls: "bus-hud-tag-won" };
    if (outcome === "cashout") return { text: "Se plantó 💰", cls: "bus-hud-tag-won" };
    return { text: "Perdió 💸", cls: "bus-hud-tag-out" };
  }
  return alive ? { text: "En juego", cls: "" } : { text: "Afuera (este intento)", cls: "bus-hud-tag-out" };
}

function animateBusPotentialCounter(el, fromVal, toVal, prefix, isLoss) {
  el.classList.remove("bus-hud-potential-win", "bus-hud-potential-loss");
  let ticks = 0;
  const totalTicks = 14;
  clearInterval(el._busCounterTimer);
  el._busCounterTimer = setInterval(() => {
    ticks++;
    if (ticks >= totalTicks) {
      clearInterval(el._busCounterTimer);
      el.textContent = `${prefix}$${Math.abs(toVal)} ${isLoss ? "💸" : "🎉"}`;
      el.classList.add(isLoss ? "bus-hud-potential-loss" : "bus-hud-potential-win");
      return;
    }
    const fake = Math.round((fromVal + (toVal - fromVal) * (ticks / totalTicks)) / 10) * 10;
    el.textContent = `${prefix}$${Math.abs(fake)}`;
    playTick();
  }, 55);
}

function updateBusHudTags() {
  ["left", "right"].forEach((side) => {
    const el = document.getElementById(side === "left" ? "busHudLeftTag" : "busHudRightTag");
    const info = busHudTagInfo(side);
    el.textContent = info.text;
    el.classList.remove("bus-hud-tag-out", "bus-hud-tag-won");
    if (info.cls) el.classList.add(info.cls);

    // NUEVO: pila de fichas del banco de cada jugador
    const amount = side === "left" ? busState.leftAmount : busState.rightAmount;
    renderChipPile(side === "left" ? "busHudChipPileLeft" : "busHudChipPileRight", side, amount);

    // NUEVO: contador de "cuánto sumás/multiplicás" en vivo
    const potentialEl = document.getElementById(side === "left" ? "busHudPotentialLeft" : "busHudPotentialRight");
    const playing = side === "left" ? busGame.leftPlaying : busGame.rightPlaying;
    const done = side === "left" ? busGame.leftDone : busGame.rightDone;
    const alive = side === "left" ? busGame.leftAlive : busGame.rightAlive;
    const bet = side === "left" ? busGame.betLeft : busGame.betRight;

    if (!playing) {
      potentialEl.textContent = "";
    } else if (done) {
      const outcome = side === "left" ? busGame.leftOutcome : busGame.rightOutcome;
      const payout = side === "left" ? busGame.leftPayout : busGame.rightPayout;
      if (outcome === "lost") {
        animateBusPotentialCounter(potentialEl, 0, bet, "-", true);
      } else {
        animateBusPotentialCounter(potentialEl, 0, payout, "+", false);
      }
    } else if (alive) {
      const mult = busGame.round >= 2 ? BUS_CUMULATIVE_MULT[busGame.round - 1] : 1;
      potentialEl.textContent =
        busGame.round >= 2
          ? `Si se planta: $${Math.round(bet * mult)} (x${mult})`
          : `En juego: $${bet}`;
    } else {
      potentialEl.textContent = "";
    }
    potentialEl.classList.remove("bus-hud-potential-pop");
    void potentialEl.offsetWidth;
    potentialEl.classList.add("bus-hud-potential-pop");
  });
  updateBusLeaderCrown();    
}

function updateBusRoundPips() {
  document.querySelectorAll(".bus-round-pip").forEach((pip) => {
    const r = parseInt(pip.dataset.round, 10);
    pip.classList.toggle("done", r < busGame.round);
    pip.classList.toggle("active", r === busGame.round);
  });
  // NUEVO: escalera de multiplicadores acumulados
  document.querySelectorAll(".bus-mult-step").forEach((step) => {
    const r = parseInt(step.dataset.round, 10);
    step.classList.toggle("done", r < busGame.round);
    step.classList.toggle("active", r === busGame.round);
  });
}

function startBusAttempt() {
  busGame.deck = busBuildShuffledDeck();
  busGame.revealed = [];
  busGame.round = 1;
  busGame.leftAlive = busGame.leftPlaying && !busGame.leftDone;
  busGame.rightAlive = busGame.rightPlaying && !busGame.rightDone;
  busGame.leftGuess = null;
  busGame.rightGuess = null;
  busGame.resolving = false;

  [1, 2, 3, 4].forEach((n) => {
    document.getElementById("busCard" + n).classList.remove("flipped", "dealt");
    document.getElementById("busCard" + n + "Face").style.backgroundPosition = "";
  });
  updateBusHudTags();
  updateBusRoundPips();
  startBusRoundTurn();
}

function startBusRoundTurn() {
  const leftPending = busGame.leftPlaying && !busGame.leftDone && busGame.leftAlive;
  const rightPending = busGame.rightPlaying && !busGame.rightDone && busGame.rightAlive;

  if (!leftPending && !rightPending) {
    settleBusPartida();
    return;
  }

  document.getElementById("busRoundQuestion").textContent = busRoundQuestionText(busGame.round);
  document.getElementById("busRestartBanner").classList.add("hidden");
  updateBusRoundPips();

  let turn;
  if (busGame.leftAlive && !busGame.leftDone && busGame.leftGuess === null) turn = "left";
  else if (busGame.rightAlive && !busGame.rightDone && busGame.rightGuess === null) turn = "right";
  else {
    revealBusCard();
    return;
  }
  busGame.currentTurn = turn;

  const name = turn === "left" ? busState.championName : busState.challengerName;
  
  // FIX CRÍTICO: Se inyecta el HTML directo en busGameStatus para que no tire error de null
  const statusEl = document.getElementById("busGameStatus");
  statusEl.innerHTML = `Elige <b>${escapeHtml(name)}</b>…`;
  statusEl.classList.remove("pop");
  void statusEl.offsetWidth;
  statusEl.classList.add("pop");

  renderBusGuessOptions();
}

function onBusCashout() {
  if (!busGame || busGame.resolving) return;
  const side = busGame.currentTurn;
  const mult = BUS_CUMULATIVE_MULT[busGame.round - 1];
  const bet = side === "left" ? busGame.betLeft : busGame.betRight;
  const payout = Math.round(bet * mult);
  document.querySelectorAll(".bus-guess-btn").forEach((b) => (b.disabled = true));
  playCashRegister();

  if (side === "left") {
    busGame.leftDone = true;
    busGame.leftOutcome = "cashout";
    busGame.leftPayout = payout;
    busGame.leftAlive = false;
  } else {
    busGame.rightDone = true;
    busGame.rightOutcome = "cashout";
    busGame.rightPayout = payout;
    busGame.rightAlive = false;
  }
  const name = side === "left" ? busState.championName : busState.challengerName;
  document.getElementById("busGameStatus").textContent = `${name} se plantó y se llevó $${payout} 💰 (x${mult})`;
  updateBusHudTags();
  busSetTimeout(startBusRoundTurn, 900);
}

function onBusGuessClick(guessId) {
  if (!busGame || busGame.resolving) return;
  document.querySelectorAll(".bus-guess-btn").forEach((b) => (b.disabled = true));
  playTick();
  if (busGame.currentTurn === "left") busGame.leftGuess = guessId;
  else busGame.rightGuess = guessId;
  busSetTimeout(startBusRoundTurn, 260);
}

function revealBusCard() {
  busGame.resolving = true;
  document.getElementById("busGameStatus").textContent = "Dando vuelta la carta…";
  const card = busGame.deck.pop();
  busGame.revealed.push(card);

  const cardEl = document.getElementById("busCard" + busGame.round);
  const faceEl = document.getElementById("busCard" + busGame.round + "Face");
  faceEl.style.backgroundPosition = busCardBgPosition(card);

  busPlaySound("/static/audio/card-slide.wav", 0.5);
  cardEl.classList.add("dealt");

  busSetTimeout(() => {
    busPlaySound("/static/audio/card-pickup.wav", 0.6);
    cardEl.classList.add("flipped");
    busSetTimeout(() => resolveBusRound(card), 500);
  }, 320);
}

function busEvaluateGuess(round, guess, card) {
  if (round === 1) return guess === card.color;
  if (round === 2) {
    const prev = busGame.revealed[0];
    return guess === "ge" ? card.value >= prev.value : card.value < prev.value;
  }
  if (round === 3) {
    const a = busGame.revealed[0].value, b = busGame.revealed[1].value;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (card.value === lo || card.value === hi) return false; // cae justo en el borde: pierde sí o sí
    if (lo === hi) return guess === "out"; // par: adentro es imposible
    const inside = card.value > lo && card.value < hi;
    return guess === (inside ? "in" : "out");
  }
  return guess === card.suit;
}

function resolveBusRound(card) {
  const leftGuessed = busGame.leftAlive && !busGame.leftDone && busGame.leftGuess !== null;
  const rightGuessed = busGame.rightAlive && !busGame.rightDone && busGame.rightGuess !== null;
  const leftCorrect = leftGuessed ? busEvaluateGuess(busGame.round, busGame.leftGuess, card) : null;
  const rightCorrect = rightGuessed ? busEvaluateGuess(busGame.round, busGame.rightGuess, card) : null;

  const bothPlayedThisRound = leftGuessed && rightGuessed;
  const bothMissedThisRound = bothPlayedThisRound && !leftCorrect && !rightCorrect;

  document.getElementById("busGuessOptions").innerHTML = "";

  // Si los dos jugaban esta ronda y los dos erraron -> Mazo nuevo y reinicio de intento
if (bothMissedThisRound) {
  busGame.leftAlive = false; busGame.leftDone = true; busGame.leftOutcome = "lost"; busGame.leftPayout = 0;
  busGame.rightAlive = false; busGame.rightDone = true; busGame.rightOutcome = "lost"; busGame.rightPayout = 0;
  document.getElementById("busGameStatus").textContent = "¡Le erraron todos a esta ronda!";
  playBuzz();
  updateBusHudTags();
  const banner = document.getElementById("busRestartBanner");
  banner.textContent = "💥 ¡Fallaron los dos pelotudos! Pierden la apuesta — arranca la próxima partida…";
  banner.classList.remove("hidden");
  busSetTimeout(settleBusPartida, 1400);
  return;
}

  // Si erró solo uno -> Queda eliminado definitivamente y el otro continúa
  if (leftGuessed && !leftCorrect) {
    busGame.leftAlive = false;
    busGame.leftDone = true;
    busGame.leftOutcome = "lost";
    busGame.leftPayout = 0;
  }
  if (rightGuessed && !rightCorrect) {
    busGame.rightAlive = false;
    busGame.rightDone = true;
    busGame.rightOutcome = "lost";
    busGame.rightPayout = 0;
  }

  updateBusHudTags();

  const leftStillIn = busGame.leftPlaying && !busGame.leftDone && busGame.leftAlive;
  const rightStillIn = busGame.rightPlaying && !busGame.rightDone && busGame.rightAlive;

  if (!leftStillIn && !rightStillIn) {
    settleBusPartida();
    return;
  }

  if (busGame.round >= 4) {
    if (leftStillIn) {
      busGame.leftDone = true;
      busGame.leftOutcome = "won";
      busGame.leftPayout = Math.round(busGame.betLeft * BUS_CUMULATIVE_MULT[4]);
    }
    if (rightStillIn) {
      busGame.rightDone = true;
      busGame.rightOutcome = "won";
      busGame.rightPayout = Math.round(busGame.betRight * BUS_CUMULATIVE_MULT[4]);
    }
    launchMoneyRain();      
    settleBusPartida();
    return;
  }

  if (leftGuessed && !leftCorrect) {
    document.getElementById("busGameStatus").textContent = `${busState.championName} se bajó del bondi 🚌 — ¡${busState.challengerName} sigue solo!`;
  } else if (rightGuessed && !rightCorrect) {
    document.getElementById("busGameStatus").textContent = `${busState.challengerName} se bajó del bondi 🚌 — ¡${busState.championName} sigue solo!`;
  } else {
    document.getElementById("busGameStatus").textContent = "¡Bien! Siguiente ronda…";
  }

  busGame.round += 1;
  busGame.leftGuess = null;
  busGame.rightGuess = null;
  busGame.resolving = false;
  busSetTimeout(startBusRoundTurn, 900);
}

function busOutcomeLabel(outcome, payout) {
  if (outcome === "won") return `ganó $${payout} 🏆`;
  if (outcome === "cashout") return `se plantó con $${payout} 💰`;
  if (outcome === "lost") return "perdió su apuesta 💸";
  return "no jugó esta partida";
}

function updateBusStreakBadges() {
  const leftEl = document.getElementById("busHudLeftStreak");
  const rightEl = document.getElementById("busHudRightStreak");
  if (!leftEl || !rightEl) return;
  leftEl.textContent = (busState.leftStreak || 0) >= 2 ? `🔥 x${busState.leftStreak}` : "";
  rightEl.textContent = (busState.rightStreak || 0) >= 2 ? `🔥 x${busState.rightStreak}` : "";
}

function updateBusLeaderCrown() {
  const crown = document.getElementById("busHudCrownFloat");
  if (!crown) return;
  if (!busState || busState.leftAmount === busState.rightAmount) {
    crown.classList.add("hidden");
    return;
  }
  const leaderSide = busState.leftAmount > busState.rightAmount ? "left" : "right";
  const nameEl = document.getElementById(leaderSide === "left" ? "busHudLeftName" : "busHudRightName");
  if (!nameEl) return;
  const rect = nameEl.getBoundingClientRect();
  crown.classList.remove("hidden");
  crown.style.left = `${rect.left + rect.width / 2 - 14}px`;
  crown.style.top = `${rect.top - 26}px`;
}

function settleBusPartida() {
  if (busGame.leftPlaying && !busGame.leftDone) {
    busGame.leftDone = true;
    busGame.leftOutcome = "lost";
    busGame.leftPayout = 0;
  }
  if (busGame.rightPlaying && !busGame.rightDone) {
    busGame.rightDone = true;
    busGame.rightOutcome = "lost";
    busGame.rightPayout = 0;
  }

  if (busGame.leftPlaying) busState.leftAmount = busState.leftAmount - busGame.betLeft + busGame.leftPayout;
  if (busGame.rightPlaying) busState.rightAmount = busState.rightAmount - busGame.betRight + busGame.rightPayout;
  // NUEVO: racha de victorias consecutivas (compara quién ganó más plata neta esta partida)
  const leftNet = busGame.leftPlaying ? busGame.leftPayout - busGame.betLeft : 0;
  const rightNet = busGame.rightPlaying ? busGame.rightPayout - busGame.betRight : 0;
  if (leftNet > rightNet) {
    busState.leftStreak = (busState.leftStreak || 0) + 1;
    busState.rightStreak = 0;
  } else if (rightNet > leftNet) {
    busState.rightStreak = (busState.rightStreak || 0) + 1;
    busState.leftStreak = 0;
  } else {
    busState.leftStreak = 0;
    busState.rightStreak = 0;
  }
  updateBusStreakBadges();
  updateBusLeaderCrown();    
  updateBusHudTags();  

  busState.history.push({
    game: busState.currentGameNum,
    leftTotal: busState.leftAmount,
    rightTotal: busState.rightAmount,
    leftOutcome: busGame.leftPlaying ? busGame.leftOutcome : "sin-fondos",
    rightOutcome: busGame.rightPlaying ? busGame.rightOutcome : "sin-fondos",
    leftBet: busGame.leftPlaying ? busGame.betLeft : 0,
    rightBet: busGame.rightPlaying ? busGame.betRight : 0,
    leftNet: leftNet,
    rightNet: rightNet,
  });

  const leftLine = busGame.leftPlaying
    ? `${busState.championName} ${busOutcomeLabel(busGame.leftOutcome, busGame.leftPayout)}`
    : `${busState.championName} se quedó sin fondos`;
  const rightLine = busGame.rightPlaying
    ? `${busState.challengerName} ${busOutcomeLabel(busGame.rightOutcome, busGame.rightPayout)}`
    : `${busState.challengerName} se quedó sin fondos`;
  document.getElementById("busGameStatus").textContent = `${leftLine} — ${rightLine}`;

  const anyWin = busGame.leftOutcome === "won" || busGame.leftOutcome === "cashout" ||
                 busGame.rightOutcome === "won" || busGame.rightOutcome === "cashout";
  if (anyWin) {
    playFanfare();
    launchConfetti();
  } else {
    playBuzz();
  }

  setChipVisual("left", Math.max(busState.leftAmount, 0));
  setChipVisual("right", Math.max(busState.rightAmount, 0));

  busSetTimeout(advanceBusFlow, 2200);
}

function advanceBusFlow() {
  const bothBroke = busState.leftAmount <= 0 && busState.rightAmount <= 0;
  if (busState.currentGameNum >= busState.rounds || bothBroke) {
    showBusFinalScreen();
    return;
  }
  busState.currentGameNum += 1;
  openBusBetScreen();
}

/* ===================== Ride the Bus — FASE 2C: pantalla final ===================== */

function busFinalWinnerSide() {
  if (busState.leftAmount > busState.rightAmount) return "champion";
  if (busState.rightAmount > busState.leftAmount) return "challenger";
  return "tie";
}

function showBusFinalScreen() {
  showBusScreen("busFinalScreen");

  document.getElementById("busFinalRoundsPlayed").textContent = busState.rounds;
  document.getElementById("busFinalLeftName").textContent = busState.championName;
  document.getElementById("busFinalRightName").textContent = busState.challengerName;
  document.getElementById("busFinalLegendLeftName").textContent = busState.championName;
  document.getElementById("busFinalLegendRightName").textContent = busState.challengerName;
  document.getElementById("busFinalLeftAmount").textContent = "$" + Math.max(busState.leftAmount, 0);
  document.getElementById("busFinalRightAmount").textContent = "$" + Math.max(busState.rightAmount, 0);

  const side = busFinalWinnerSide();
  const leftSideEl = document.getElementById("busFinalLeftSide");
  const rightSideEl = document.getElementById("busFinalRightSide");
  leftSideEl.classList.toggle("bus-final-side-winner", side === "champion");
  rightSideEl.classList.toggle("bus-final-side-winner", side === "challenger");
  document.getElementById("busFinalLeftCrown").textContent = side === "champion" ? "👑" : "";
  document.getElementById("busFinalRightCrown").textContent = side === "challenger" ? "👑" : "";

  const resultEl = document.getElementById("busFinalResult");
  resultEl.classList.remove("show");
  const topAmount = Math.max(busState.leftAmount, busState.rightAmount);
  const flavor =
    side === "tie"
      ? "Los dos terminaron con la misma plata en el bolsillo 💵."
      : `Se llevó $${topAmount} en total después de las ${busState.rounds} partida(s) 💰.`;
  resolveDuelResult(resultEl, side, flavor);
    
  renderChipPile("busFinalPileLeft", "left", Math.max(busState.leftAmount, 0));
  renderChipPile("busFinalPileRight", "right", Math.max(busState.rightAmount, 0));
  renderBusFinalChart();
}

function renderBusFinalChart() {
  const svg = document.getElementById("busFinalChart");
  svg.innerHTML = "";
  const history = busState.history || [];
  if (!history.length) return;

  const svgW = 560, svgH = 240;
  const marginLeft = 52, marginRight = 14, marginTop = 16, marginBottom = 28;
  const plotW = svgW - marginLeft - marginRight;
  const plotH = svgH - marginTop - marginBottom;

  const values = [];
  history.forEach((h) => values.push(h.leftTotal, h.rightTotal));
  const minV = Math.min(0, ...values);
  let maxV = Math.max(10, ...values);
  if (maxV === minV) maxV = minV + 10;
  maxV += (maxV - minV) * 0.08;

  const xAt = (i) =>
    history.length > 1 ? marginLeft + (i / (history.length - 1)) * plotW : marginLeft + plotW / 2;
  const yAt = (v) => marginTop + plotH - ((v - minV) / (maxV - minV)) * plotH;

  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  };

  svg.appendChild(svgEl("rect", {
    x: marginLeft - 10, y: marginTop - 6, width: plotW + 20, height: plotH + 14,
    rx: 10, class: "bus-chart-plot-bg",
  }));

  svg.appendChild(svgEl("line", { x1: marginLeft, y1: marginTop, x2: marginLeft, y2: marginTop + plotH, class: "bus-chart-axis" }));
  svg.appendChild(svgEl("line", { x1: marginLeft, y1: marginTop + plotH, x2: marginLeft + plotW, y2: marginTop + plotH, class: "bus-chart-axis" }));

  [minV, maxV].forEach((v) => {
    const t = svgEl("text", {
      x: marginLeft - 8,
      y: yAt(v) + (v === minV ? -3 : 8),
      class: "bus-chart-axis-label",
      "text-anchor": "end",
    });
    t.textContent = "$" + Math.round(v);
    svg.appendChild(t);
  });

  history.forEach((h, i) => {
    const t = svgEl("text", {
      x: xAt(i),
      y: svgH - 8,
      class: "bus-chart-axis-label",
      "text-anchor": "middle",
    });
    t.textContent = "P" + h.game;
    svg.appendChild(t);
  });

  const buildLine = (key, cls) => {
    const d = history
      .map((h, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)},${yAt(h[key]).toFixed(1)}`)
      .join(" ");
    const path = svgEl("path", { d, class: cls, fill: "none" });
    svg.appendChild(path);
    return path;
  };
  const leftPath = buildLine("leftTotal", "bus-chart-line bus-chart-line-left");
  const rightPath = buildLine("rightTotal", "bus-chart-line bus-chart-line-right");

  const buildFace = (h, i, key, betKey, netKey, dodge) => {
    const net = h[netKey] || 0;
    const isWin = net > 0;
    const cx = xAt(i) + (dodge || 0), cy = yAt(h[key]);
    const g = svgEl("g", { class: `bus-chart-face ${isWin ? "is-win" : "is-loss"}` });

    // Detector de hover: NO se mueve nunca, así el bounce/shake de abajo no lo saca de bajo el mouse.
    g.appendChild(svgEl("circle", { cx, cy, r: 18, class: "bus-chart-face-hit" }));

    const visual = svgEl("g", { class: "bus-chart-face-visual" });
    visual.appendChild(svgEl("circle", { cx, cy, r: 9, class: "bus-chart-face-base" }));
    visual.appendChild(svgEl("circle", { cx: cx - 3, cy: cy - 2, r: 1.3, class: "bus-chart-face-eye" }));
    visual.appendChild(svgEl("circle", { cx: cx + 3, cy: cy - 2, r: 1.3, class: "bus-chart-face-eye" }));
    const mouthD = isWin
      ? `M ${(cx - 4).toFixed(1)},${(cy + 2).toFixed(1)} Q ${cx.toFixed(1)},${(cy + 6.5).toFixed(1)} ${(cx + 4).toFixed(1)},${(cy + 2).toFixed(1)}`
      : `M ${(cx - 4).toFixed(1)},${(cy + 4).toFixed(1)} Q ${cx.toFixed(1)},${(cy - 0.5).toFixed(1)} ${(cx + 4).toFixed(1)},${(cy + 4).toFixed(1)}`;
    visual.appendChild(svgEl("path", { d: mouthD, class: "bus-chart-face-mouth" }));
    g.appendChild(visual);

    const bubbleY = Math.max(cy - 36, marginTop + 20);
    const tooltip = svgEl("g", { class: "bus-chart-tooltip" });
    tooltip.appendChild(svgEl("rect", { x: cx - 42, y: bubbleY - 18, width: 84, height: 34, rx: 10, class: "bus-chart-tooltip-bg" }));
    tooltip.appendChild(svgEl("path", {
      d: `M ${(cx - 5).toFixed(1)},${(bubbleY + 16).toFixed(1)} L ${(cx + 5).toFixed(1)},${(bubbleY + 16).toFixed(1)} L ${cx.toFixed(1)},${(bubbleY + 23).toFixed(1)} Z`,
      class: "bus-chart-tooltip-bg",
    }));
    const betText = svgEl("text", { x: cx, y: bubbleY - 5, class: "bus-chart-tooltip-bet", "text-anchor": "middle" });
    betText.textContent = "Apostó $" + (h[betKey] || 0);
    const resultText = svgEl("text", {
      x: cx, y: bubbleY + 11,
      class: `bus-chart-tooltip-result ${isWin ? "win" : "loss"}`,
      "text-anchor": "middle",
    });
    resultText.textContent = isWin ? `+$${net} 🎉` : `-$${Math.abs(net)} 💸`;
    tooltip.appendChild(betText);
    tooltip.appendChild(resultText);
    g.appendChild(tooltip);

    g.addEventListener("mouseenter", () => {
      if (isWin) playCashRegister(); else playTrollLaugh();
    });

    return g;
  };

  const faceGroups = [];
  history.forEach((h, i) => {
    if (i === 0) return;
    // Si campeón y retador quedaron con la misma plata, no los dejo pisarse.
    const overlap = h.leftTotal === h.rightTotal;
    const leftFace = buildFace(h, i, "leftTotal", "leftBet", "leftNet", overlap ? -9 : 0);
    const rightFace = buildFace(h, i, "rightTotal", "rightBet", "rightNet", overlap ? 9 : 0);
    svg.appendChild(leftFace);
    svg.appendChild(rightFace);
    faceGroups.push({ g: leftFace, i }, { g: rightFace, i });
  });

  const drawDuration = 1100;
  [leftPath, rightPath].forEach((path) => {
    const len = path.getTotalLength();
    path.style.strokeDasharray = String(len);
    path.style.strokeDashoffset = String(len);
    void path.getBoundingClientRect();
    requestAnimationFrame(() => {
      path.style.transition = `stroke-dashoffset ${drawDuration}ms ease`;
      path.style.strokeDashoffset = "0";
    });
  });

  const stepCount = history.length - 1;
  let honked = {};
  faceGroups.forEach(({ g, i }) => {
    const delay = stepCount > 0 ? (i / stepCount) * drawDuration : 0;
    busSetTimeout(() => {
      g.classList.add("revealed");
      if (!honked[i]) { honked[i] = true; playHonk(); }
    }, delay);
  });
}

// Tope de apuesta: el menor entre $1000 y el 50% de lo que tiene el que va ganando
function busBaseBetCap() {
  return 1000;
}

// Recalcula si alguien tiene boleto disponible (desde la partida 2, y solo si no se usó ya)
function updateBusTicketEligibility() {
  if (busState.ticketUsed || busState.currentGameNum < 2) {
    busState.ticketAvailableFor = null;
    return;
  }
  const leader = Math.max(busState.leftAmount, busState.rightAmount);
  const trailing = Math.min(busState.leftAmount, busState.rightAmount);
  if (leader <= 0) { busState.ticketAvailableFor = null; return; }
  const ratio = trailing / leader;
  busState.ticketAvailableFor = ratio < 0.5
    ? (busState.leftAmount < busState.rightAmount ? "left" : "right")
    : null; // remontó sin usarlo -> se le esfuma
}

function useBusTicket(side) {
  if (busState.ticketUsed || busState.ticketAvailableFor !== side) return;
  const leader = Math.max(busState.leftAmount, busState.rightAmount);
  const oldAmount = side === "left" ? busState.leftAmount : busState.rightAmount;
  const target = Math.max(oldAmount, Math.round((leader * 0.6) / 10) * 10);
  playBusTicketSequence(side, oldAmount, target);
}

function playBusTicketSequence(side, oldAmount, target) {
  const overlay = document.getElementById("busTicketOverlay");
  const img = document.getElementById("busTicketOverlayImg");
  const rouletteEl = document.getElementById("busTicketRouletteNumber");
  overlay.classList.remove("hidden");
  img.classList.remove("bus-ticket-laugh", "bus-ticket-shrink");
  void img.offsetWidth;
  img.classList.add("bus-ticket-laugh");
  rouletteEl.classList.add("hidden");
  rouletteEl.classList.remove("bus-ticket-final-glow", "bus-ticket-fly-out");

  busPlaySoundThen("/static/audio/troll_laugh.wav", 0.8, () => {
    img.classList.remove("bus-ticket-laugh");
    img.classList.add("bus-ticket-shrink");
    rouletteEl.classList.remove("hidden");
    runBusTicketRoulette(rouletteEl, oldAmount, target, () => {
      rouletteEl.classList.add("bus-ticket-fly-out");
      busSetTimeout(() => {
        overlay.classList.add("hidden");
        img.classList.remove("bus-ticket-shrink");
        rouletteEl.classList.remove("bus-ticket-fly-out");
        finalizeBusTicket(side, target);
      }, 550);
    });
  });
}

function runBusTicketRoulette(el, oldAmount, target, onDone) {
  let ticks = 0;
  const totalTicks = 18;
  const timer = setInterval(() => {
    ticks++;
    if (ticks >= totalTicks) {
      clearInterval(timer);
      el.textContent = "$" + target;
      el.classList.add("bus-ticket-final-glow");
      busPlaySound("/static/audio/card-slide.wav", 0.3);
      busSetTimeout(onDone, 500);
      return;
    }
    const fake = Math.max(0, Math.round((oldAmount + Math.random() * (target - oldAmount + 400)) / 10) * 10);
    el.textContent = "$" + fake;
    playTick();
  }, 90);
}

function finalizeBusTicket(side, target) {
  if (side === "left") busState.leftAmount = target;
  else busState.rightAmount = target;
  busState.ticketUsed = true;
  busState.ticketAvailableFor = null;
  toast("🎫 ¡Boleto usado! La billetera subió de golpe.");
  openBusBetScreen();
}

function openBusBetScreen() {
  updateBusTicketEligibility(); // NUEVO

  document.getElementById("busBetGameNum").textContent = busState.currentGameNum;
  document.getElementById("busBetGameTotal").textContent = busState.rounds;
  document.getElementById("busBetLeftName").textContent = busState.championName;
  document.getElementById("busBetRightName").textContent = busState.challengerName;

  ["left", "right"].forEach((side) => {
    const amount = side === "left" ? busState.leftAmount : busState.rightAmount;
    const panel = document.getElementById(side === "left" ? "busBetLeftPanel" : "busBetRightPanel");
    const slider = document.getElementById(side === "left" ? "busBetLeftSlider" : "busBetRightSlider");
    const label = document.getElementById(side === "left" ? "busBetLeftAmount" : "busBetRightAmount");
    const walletEl = document.getElementById(side === "left" ? "busBetLeftWallet" : "busBetRightWallet");
    const heteroBtn = document.getElementById(side === "left" ? "busHeteroBtnLeft" : "busHeteroBtnRight");
    const ticketBtn = document.getElementById(side === "left" ? "busTicketBtnLeft" : "busTicketBtnRight");
    const heteroActive = side === "left" ? busBetState.leftHetero : busBetState.rightHetero;

    walletEl.textContent = amount;
    renderChipPile(side === "left" ? "busBetPileLeft" : "busBetPileRight", side, amount);

    // Boleto de repechaje
    if (busState.ticketAvailableFor === side) {
      ticketBtn.classList.remove("hidden");
    } else {
      ticketBtn.classList.add("hidden");
    }

    if (amount < 10) {
      panel.classList.add("bus-bet-side-broke");
      slider.disabled = true;
      label.textContent = "Sin fondos 😢";
      heteroBtn.classList.add("hidden");
    } else {
      panel.classList.remove("bus-bet-side-broke");
      slider.disabled = false;

      // Tope de apuesta + Modo Hetero
      const baseCap = busBaseBetCap();
      const effectiveCap = heteroActive ? amount : Math.min(amount, baseCap);
      slider.max = effectiveCap;
      slider.value = heteroActive ? amount : Math.min(parseInt(slider.value, 10) || 10, effectiveCap);
      label.textContent = "$" + slider.value;

      if (amount > 1000 && baseCap < amount) {
        heteroBtn.classList.remove("hidden");
        heteroBtn.classList.toggle("bus-hetero-active", heteroActive);
        heteroBtn.textContent = heteroActive
          ? "🔓 Modo Hetero activado — vas con todo"
          : "🔒 Modo Hetero (apostar todo)";
      } else {
        heteroBtn.classList.add("hidden");
      }
    }
  });
  showBusScreen("busBetScreen");
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("pickBusBtn").addEventListener("click", () => {
    closeDuelSelect();
    openBusModal();
  });
  document.getElementById("closeBusModal").addEventListener("click", () => {
    teardownBus();
    document.getElementById("busModal").classList.add("hidden");
  });

  document.querySelectorAll(".bus-rounds-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".bus-rounds-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      busSelectedRounds = parseInt(pill.dataset.rounds, 10);
      document.getElementById("busRoundsNextBtn").disabled = false;
    });
  });

  ["busHudPotentialLeft", "busHudPotentialRight"].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener("mouseenter", () => {
      if (el.classList.contains("bus-hud-potential-loss")) {
        busPlaySound("/static/audio/troll-laugh.mp3", 0.6);
      }
    });
  });

  document.getElementById("busRoundsNextBtn").addEventListener("click", () => {
    initBusBankroll();
    showBusScreen("busBankroll");
  });
  document.getElementById("busBankrollBackBtn").addEventListener("click", () => showBusScreen("busRoundsPick"));
  document.getElementById("busRollBtnLeft").addEventListener("click", () => spinBankroll("left"));
  document.getElementById("busRollBtnRight").addEventListener("click", () => spinBankroll("right"));

  document.getElementById("busBankrollNextBtn").addEventListener("click", () => {
    busState.currentGameNum = 1;
    busState.history = [{ game: 0, leftTotal: busState.leftAmount, rightTotal: busState.rightAmount }];
    openBusBetScreen();
  });
  document.getElementById("busGameExitBtn").addEventListener("click", () => {
    teardownBus();
    document.getElementById("busModal").classList.add("hidden");
  });
  document.getElementById("busFinalReplayBtn").addEventListener("click", () => {
  busSelectedRounds = null;
  document.querySelectorAll(".bus-rounds-pill").forEach((p) => p.classList.remove("active"));
  document.getElementById("busRoundsNextBtn").disabled = true;
  showBusScreen("busRoundsPick");
});
  document.getElementById("busFinalExitBtn").addEventListener("click", () => {
    teardownBus();
    document.getElementById("busModal").classList.add("hidden");
  });

  ["left", "right"].forEach((side) => {
    const slider = document.getElementById(side === "left" ? "busBetLeftSlider" : "busBetRightSlider");
    const label = document.getElementById(side === "left" ? "busBetLeftAmount" : "busBetRightAmount");
    slider.addEventListener("input", () => {
      label.textContent = "$" + slider.value;
    });
  });
    document.getElementById("busHeteroBtnLeft").addEventListener("click", () => {
    busBetState.leftHetero = !busBetState.leftHetero;
    openBusBetScreen();
  });
    document.getElementById("busHeteroBtnRight").addEventListener("click", () => {
    busBetState.rightHetero = !busBetState.rightHetero;
    openBusBetScreen();
  });
  document.getElementById("busTicketBtnLeft").addEventListener("click", () => useBusTicket("left"));
  document.getElementById("busTicketBtnRight").addEventListener("click", () => useBusTicket("right"));
  document.querySelectorAll(".bus-bet-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const side = btn.dataset.side;
      const pct = parseInt(btn.dataset.pct, 10);
      const amount = side === "left" ? busState.leftAmount : busState.rightAmount;
      if (amount < 10) return;
      const heteroActive = side === "left" ? busBetState.leftHetero : busBetState.rightHetero;
      const cap = heteroActive ? amount : Math.min(amount, busBaseBetCap());
      const slider = document.getElementById(side === "left" ? "busBetLeftSlider" : "busBetRightSlider");
      const label = document.getElementById(side === "left" ? "busBetLeftAmount" : "busBetRightAmount");
      const val = Math.max(10, Math.round((amount * pct) / 100 / 10) * 10);
      slider.value = Math.min(val, cap);
      label.textContent = "$" + slider.value;
    });
  });
  document.getElementById("busBetConfirmBtn").addEventListener("click", () => {
    busGame = {
      deck: [], revealed: [], round: 1,
      leftPlaying: busState.leftAmount > 0,
      rightPlaying: busState.rightAmount > 0,
      leftDone: false, rightDone: false,
      leftOutcome: null, rightOutcome: null,
      leftPayout: 0, rightPayout: 0,
      leftAlive: false, rightAlive: false,
      leftGuess: null, rightGuess: null,
      currentTurn: "left", resolving: false,
      betLeft: busState.leftAmount > 0 ? parseInt(document.getElementById("busBetLeftSlider").value, 10) : 0,
      betRight: busState.rightAmount > 0 ? parseInt(document.getElementById("busBetRightSlider").value, 10) : 0,
    };
    document.getElementById("busHudLeftName").textContent = busState.championName;
    document.getElementById("busHudRightName").textContent = busState.challengerName;
    document.getElementById("busGameNumLabel").textContent = busState.currentGameNum;
    document.getElementById("busGameTotalLabel").textContent = busState.rounds;

          // NUEVO: pozo de fichas apostadas en el centro de la mesa
    renderChipPile("busPotChipsLeft", "left", busGame.betLeft);
    renderChipPile("busPotChipsRight", "right", busGame.betRight);
    document.getElementById("busPotLeftLabel").textContent = busGame.leftPlaying ? "Apuesta" : "Sin apuesta";
    document.getElementById("busPotRightLabel").textContent = busGame.rightPlaying ? "Apuesta" : "Sin apuesta";
    document.getElementById("busPotTotal").textContent = "$" + (busGame.betLeft + busGame.betRight);

    showBusScreen("busGameTable");
    startBusAttempt();
  });
});



/* ===================== Gambeta 1v1 — física, canvas, input ===================== */

const GMB_FIELD_W = 900, GMB_FIELD_H = 380;
const GMB_WALL = 6;                 // grosor visual del borde
const GMB_PLAYER_R = 17;
const GMB_BALL_R = 9;
const GMB_MAX_SPEED = 4.4;
const GMB_KEEPER_SPEED_MULT = 0.82; // el arquero se mueve un poco más lento que el atacante
const GMB_ACCEL = 0.55;
const GMB_FRICTION = 0.90;
const GMB_DASH_COOLDOWN = 3400;     // un poco más rápido para todos
const GMB_DASH_BALLCARRIER_PENALTY = 550; // el que tiene la pelota tarda un toque más en recargar
const GMB_DASH_DURATION = 150;      // ms de impulso
const GMB_DASH_POWER = 8.5;
const GMB_DASH_MAXSPEED = 9.5;      // tope de velocidad SOLO mientras dashea
const GMB_KICK_POWER = 14;         // impulso que recibe la PELOTA cuando el atacante patea (fase 1)
const GMB_KICK_IMMUNITY_MS = 380;  // el que pateó no puede "readueñarse" de la pelota por cercanía durante este ratito
const GMB_PHASE1_TIME = 30000;      // shot clock fase 1 (ms) - default, lo pisa gmbSelectedDuration
let gmbSelectedDuration = GMB_PHASE1_TIME;
const GMB_ATTACK_ZONE_X = GMB_FIELD_W - 70;   // el atacante debe llegar acá con la pelota
const GMB_STEAL_BACK_X = 70;                  // si el defensor se la roba y llega acá, gana él
const GMB_GOAL_HALF = 104;          // medio ancho del arco (mouth) — más grande para compensar el dash del arquero
const GMB_POST_R = 7;               // radio visual y físico de los palos
const GMB_GOAL_LINE_X = GMB_FIELD_W - 34;
const GMB_SHOOT_MAX_CHARGE = 850;   // ms de carga máxima del remate
const GMB_SHOOT_BASE_SPEED = 7.9;
const GMB_SHOOT_BONUS_SPEED = 9.6;
const GMB_KNUCKLE_AMPLITUDE = 0.028;   // fuerza del "baile" errático
const GMB_KNUCKLE_FREQ_MIN = 0.012;    // qué tan rápido oscila, mínimo
const GMB_KNUCKLE_FREQ_MAX = 0.024;    // máximo
const GMB_CURVE_MAX_ACCEL = 0.045; // fuerza lateral por frame a carga y tecla al 100%
const GMB_CURVE_MAX_VY = 3.2;      // tope total de desvío — así el arquero siempre tiene chance
const GMB_SHOOTOUT_TIMEOUT = 30000;  // si la pelota queda pinponeando sin definirse
const GMB_AIM_TURN_SPEED = 0.022; // qué tan rápido gira el ángulo por frame mientras cargás
const GMB_AIM_HISTORY_MS = 140;     // ventana de tiempo para medir el "latigazo" de comba
const GMB_FLICK_CURVE_SCALE = 2.6;  // qué tan sensible es el gesto de comba

let gmb = null;
let gmbRafId = null;
let gmbPendingTimeouts = [];
let gmbTanda = null; // marcador de la tanda completa (mejor de 5 + muerte súbita)

function gmbSetTimeout(fn, ms) {
  const id = setTimeout(() => {
    gmbPendingTimeouts = gmbPendingTimeouts.filter((t) => t !== id);
    fn();
  }, ms);
  gmbPendingTimeouts.push(id);
  return id;
}
function gmbClearTimeouts() {
  gmbPendingTimeouts.forEach((id) => clearTimeout(id));
  gmbPendingTimeouts = [];
}

/* ---------- Setup ---------- */

function openGambetaModal() {
  document.getElementById("gambetaModal").classList.remove("hidden");
  document.getElementById("gambetaResult").classList.add("hidden");
  document.getElementById("gambetaPlay").classList.add("hidden");
  document.getElementById("gambetaControlsScreen").classList.add("hidden");
  document.getElementById("gambetaIntro").classList.remove("hidden");
  gmbLoadControls();
  gmbRenderControlsLegendBadges();
  gmbBuildIntroLegend();
}

function gmbRenderControlsLegendBadges() {
  document.getElementById("gambetaLeftKickBadge").textContent = gmbKeyDisplayName(GMB_KEYS_LEFT.kick);
  document.getElementById("gambetaLeftDashBadge").textContent = gmbKeyDisplayName(GMB_KEYS_LEFT.dash);
  document.getElementById("gambetaRightKickBadge").textContent = gmbKeyDisplayName(GMB_KEYS_RIGHT.kick);
  document.getElementById("gambetaRightDashBadge").textContent = gmbKeyDisplayName(GMB_KEYS_RIGHT.dash);
}

const GMB_CONTROL_ACTIONS = [
  { key: "up", label: "Arriba" },
  { key: "down", label: "Abajo" },
  { key: "left", label: "Izquierda" },
  { key: "right", label: "Derecha" },
  { key: "kick", label: "Patear (fase 1)" },
  { key: "dash", label: "Dash / Cargar remate" },
];

function gmbBuildRemapUI() {
  const leftCol = document.getElementById("gambetaRemapLeftCol");
  const rightCol = document.getElementById("gambetaRemapRightCol");
  leftCol.innerHTML = "";
  rightCol.innerHTML = "";
  const championName = (currentWinnerGame && currentWinnerGame.added_by) || "Campeón";
  const challengerName = pendingChallengerName || "Retador";

  const buildSide = (col, side, title) => {
    const heading = document.createElement("span");
    heading.className = "controls-who";
    heading.textContent = title;
    col.appendChild(heading);
    GMB_CONTROL_ACTIONS.forEach((action) => {
      const row = document.createElement("div");
      row.className = "key-row";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "key-badge gambeta-remap-btn";
      const map = side === "left" ? GMB_KEYS_LEFT : GMB_KEYS_RIGHT;
      btn.textContent = gmbKeyDisplayName(map[action.key]);
      btn.addEventListener("click", () => gmbStartRebind(side, action.key, btn));
      const label = document.createElement("span");
      label.className = "key-mean";
      label.textContent = action.label;
      row.appendChild(btn);
      row.appendChild(label);
      col.appendChild(row);
    });
  };
  buildSide(leftCol, "left", championName);
  buildSide(rightCol, "right", challengerName);
}

let gmbRebindListener = null;
function gmbStartRebind(side, actionKey, btn) {
  if (gmbRebindListener) return;
  const original = btn.textContent;
  btn.textContent = "…";
  btn.classList.add("gambeta-remap-listening");
  gmbRebindListener = (e) => {
    e.preventDefault();
    const k = e.key.toLowerCase();
    if (k !== "escape") {
      const map = side === "left" ? GMB_KEYS_LEFT : GMB_KEYS_RIGHT;
      map[actionKey] = k;
      gmbSaveControls();
      gmbRenderControlsLegendBadges();
      btn.textContent = gmbKeyDisplayName(k);
    } else {
      btn.textContent = original;
    }
    btn.classList.remove("gambeta-remap-listening");
    window.removeEventListener("keydown", gmbRebindListener, true);
    gmbRebindListener = null;
  };
  window.addEventListener("keydown", gmbRebindListener, true);
}

function gmbBuildIntroLegend() {
  const championName = (currentWinnerGame && currentWinnerGame.added_by) || "Campeón";
  const challengerName = pendingChallengerName || "Retador";
  document.getElementById("gambetaIntroAttacker").textContent = championName;
  document.getElementById("gambetaIntroDefender").textContent = challengerName;
  document.getElementById("gambetaLeftKeyName").textContent = championName;
  document.getElementById("gambetaRightKeyName").textContent = challengerName;
}

function gmbInitTanda() {
  const championName = (currentWinnerGame && currentWinnerGame.added_by) || "Campeón";
  let challengerName = (pendingChallengerName || "").trim() || "Retador";
  if (challengerName.toLowerCase() === championName.toLowerCase()) {
    challengerName = `${challengerName} (Retador)`;
  }
  gmbTanda = {
    championName, challengerName,
    currentAttacker: "champion", // el campeón ataca primero, siempre
    championResults: [],
    challengerResults: [],
  };
  document.getElementById("gmbTbChampionName").textContent = championName;
  document.getElementById("gmbTbChallengerName").textContent = challengerName;
  document.getElementById("gmbTbChampionSide").classList.remove("pb-winner");
  document.getElementById("gmbTbChallengerSide").classList.remove("pb-winner");
  document.getElementById("gambetaScoreboard").classList.remove("sudden-death");
  gmbRenderScoreboard();
}

function gmbRenderScoreboard() {
  renderDots("gmbTbChampionDots", gmbTanda.championResults);
  renderDots("gmbTbChallengerDots", gmbTanda.challengerResults);
  const champScore = gmbTanda.championResults.filter(Boolean).length;
  const chalScore = gmbTanda.challengerResults.filter(Boolean).length;
  document.getElementById("gmbTbScore").innerHTML = `${champScore}<span class="pb-score-sep">-</span>${chalScore}`;
}

function gmbTandaDecided() {
  const champTaken = gmbTanda.championResults.length;
  const chalTaken = gmbTanda.challengerResults.length;
  const champScore = gmbTanda.championResults.filter(Boolean).length;
  const chalScore = gmbTanda.challengerResults.filter(Boolean).length;

  let decided = null;
  if (champTaken <= 5 && chalTaken <= 5) {
    if (champScore > chalScore + (5 - chalTaken)) decided = "champion";
    else if (chalScore > champScore + (5 - champTaken)) decided = "challenger";
  }
  if (!decided && champTaken === chalTaken && champTaken >= 5 && champScore !== chalScore) {
    decided = champScore > chalScore ? "champion" : "challenger";
  }
  return decided;
}

function teardownGambeta() {
  gmbClearTimeouts();
  if (gmbRafId) cancelAnimationFrame(gmbRafId);
  gmbRafId = null;
  window.removeEventListener("keydown", gmbOnKeyDown);
  window.removeEventListener("keyup", gmbOnKeyUp);
  gmb = null;
  gmbTanda = null; // NUEVO
}

function startGambetaMatch() {
  const championName = (currentWinnerGame && currentWinnerGame.added_by) || "Campeón";
  const challengerName = pendingChallengerName || "Retador";
  const attackerSide = gmbTanda.currentAttacker === "challenger" ? "right" : "left";
  const defenderSide = attackerSide === "left" ? "right" : "left";

  gmb = {
    championName, challengerName,
    attackerSide, defenderSide,
    phase: "dribble", // dribble | transition | shootout | done
    phaseClock: gmbSelectedDuration,
    lastTs: null,
    keys: {},
    touch: {
      left: { dx: 0, dy: 0 },
      right: { dx: 0, dy: 0 },
    },
    left: gmbMakePlayer("left", 110, GMB_FIELD_H / 2, "var(--gold-bright)"),
    right: gmbMakePlayer("right", GMB_FIELD_W - 110, GMB_FIELD_H / 2, "var(--teal-bright)"),
    ball: { x: 0, y: 0, vx: 0, vy: 0, r: GMB_BALL_R, owner: null, lastTouch: null },
    shoot: { charging: false, chargeStart: 0, aimX: 1, aimY: 0, aimHistory: [] },
    shootoutStartedAt: 0,
  };

  // La pelota arranca a los pies del atacante.
  const attacker = gmb[attackerSide];
  gmb.ball.x = attacker.x + (attackerSide === "left" ? 26 : -26);
  gmb.ball.y = attacker.y;
  gmb.ball.owner = attackerSide;

  document.getElementById("gambetaIntro").classList.add("hidden");
  document.getElementById("gambetaResult").classList.add("hidden");
  document.getElementById("gambetaPlay").classList.remove("hidden");
  document.getElementById("gambetaLeftName").textContent = championName;
  document.getElementById("gambetaRightName").textContent = challengerName;
  const gmbScoreTxt = `${gmbTanda.championResults.filter(Boolean).length}-${gmbTanda.challengerResults.filter(Boolean).length}`;
  gmbShowBanner(attackerSide === "left" ? `¡${championName} arranca gambeteando! (${gmbScoreTxt}) 🔥` : `¡${challengerName} arranca gambeteando! (${gmbScoreTxt}) 🔥`, 1400);
  gmbSetPhaseLabel("Fase 1 · Gambeta");

  window.addEventListener("keydown", gmbOnKeyDown);
  window.addEventListener("keyup", gmbOnKeyUp);

  gmbSetupCanvas();
  gmb.lastTs = performance.now();
  gmbRafId = requestAnimationFrame(gmbLoop);
}

function gmbSetupCanvas() {
  const canvas = document.getElementById("gambetaCanvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = GMB_FIELD_W * dpr;
  canvas.height = GMB_FIELD_H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function gmbMakePlayer(side, x, y, color) {
  return {
    side, x, y, vx: 0, vy: 0, r: GMB_PLAYER_R, color,
    facingX: side === "left" ? 1 : -1, facingY: 0,
    dashReadyAt: 0, dashingUntil: 0,
  };
}

/* ---------- Input ---------- */

const GMB_DEFAULT_KEYS_LEFT  = { up: "w", down: "s", left: "a", right: "d", kick: "j", dash: "k" };
const GMB_DEFAULT_KEYS_RIGHT = { up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright", kick: "z", dash: "x" };
const GMB_KEYS_LEFT  = { ...GMB_DEFAULT_KEYS_LEFT };
const GMB_KEYS_RIGHT = { ...GMB_DEFAULT_KEYS_RIGHT };
const GMB_PREVENT_DEFAULT = new Set(["arrowup", "arrowdown", "arrowleft", "arrowright", "enter", " "]);

function gmbLoadControls() {
  try {
    const saved = JSON.parse(localStorage.getItem("gmbControls") || "null");
    if (saved && saved.left && saved.right) {
      Object.assign(GMB_KEYS_LEFT, saved.left);
      Object.assign(GMB_KEYS_RIGHT, saved.right);
    }
  } catch (e) { /* si el localStorage falla, se queda con los defaults */ }
}
function gmbSaveControls() {
  try { localStorage.setItem("gmbControls", JSON.stringify({ left: GMB_KEYS_LEFT, right: GMB_KEYS_RIGHT })); }
  catch (e) {}
}
function gmbResetControls() {
  Object.assign(GMB_KEYS_LEFT, GMB_DEFAULT_KEYS_LEFT);
  Object.assign(GMB_KEYS_RIGHT, GMB_DEFAULT_KEYS_RIGHT);
  gmbSaveControls();
  gmbRenderControlsLegendBadges();
  gmbBuildRemapUI();
}
function gmbKeyDisplayName(k) {
  const NAMES = { arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→", " ": "Espacio", enter: "Enter", shift: "Shift" };
  return NAMES[k] || (k || "?").toUpperCase();
}

function gmbOnKeyDown(e) {
  if (!gmb) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (GMB_PREVENT_DEFAULT.has(k)) e.preventDefault();
  const already = gmb.keys[k];
  gmb.keys[k] = true;
  if (!already) {
    if (k === GMB_KEYS_LEFT.dash) gmbTryAction("left");
    if (k === GMB_KEYS_RIGHT.dash) gmbTryAction("right");
    if (k === GMB_KEYS_LEFT.kick) gmbTryKick("left");
    if (k === GMB_KEYS_RIGHT.kick) gmbTryKick("right");
  }
}
function gmbOnKeyUp(e) {
  if (!gmb) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  gmb.keys[k] = false;
  if (k === GMB_KEYS_LEFT.dash) gmbReleaseAction("left");
  if (k === GMB_KEYS_RIGHT.dash) gmbReleaseAction("right");
}

/* Patear: tecla propia, sin cooldown - solo sirve si tenés la pelota en
   la Fase 1. Así queda libre para dribblar seguido, y el dash queda
   exclusivamente para el impulso/lunge de siempre. */
function gmbTryKick(side) {
  if (!gmb || gmb.phase !== "dribble") return;
  if (gmb.ball.owner !== side) { playTick(); return; }
  const player = gmb[side];
  const { dx, dy } = gmbInputVector(side);
  let dirX = dx, dirY = dy;
  if (dirX === 0 && dirY === 0) { dirX = player.facingX; dirY = player.facingY; }
  const len = Math.hypot(dirX, dirY) || 1;
  const ball = gmb.ball;
  ball.vx += (dirX / len) * GMB_KICK_POWER;
  ball.vy += (dirY / len) * GMB_KICK_POWER;
  ball.owner = null;
  ball.kickedBy = side;
  ball.kickImmuneUntil = performance.now() + GMB_KICK_IMMUNITY_MS;
  gmb.kickBurst = { x: ball.x, y: ball.y, t: performance.now() };
  busPlaySound("/static/audio/kickball.wav", 0.55);
}

function gmbInputVector(side) {
  const map = side === "left" ? GMB_KEYS_LEFT : GMB_KEYS_RIGHT;
  let dx = 0, dy = 0;
  if (gmb.keys[map.left]) dx -= 1;
  if (gmb.keys[map.right]) dx += 1;
  if (gmb.keys[map.up]) dy -= 1;
  if (gmb.keys[map.down]) dy += 1;
  // Suma el joystick táctil si está activo (dx/dy ya vienen normalizados -1..1)
  const t = gmb.touch[side];
  if (t && (t.dx || t.dy)) { dx += t.dx; dy += t.dy; }
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  return { dx, dy };
}

/* "dash" en fase 1 = impulso. En fase 2, para el que ataca = cargar remate,
   para el arquero = amague/lunge lateral rápido. */
function gmbTryAction(side) {
  if (!gmb || gmb.phase === "done" || gmb.phase === "transition") return;
  const player = gmb[side];
  const now = performance.now();
  if (now < player.dashReadyAt) { playTick(); return; } // sonido "seco" de cooldown

  if (gmb.phase === "dribble") {
    gmbDash(side);
} else if (gmb.phase === "shootout") {
    if (side === gmb.attackerSide) {
      const ball = gmb.ball;
      const closeEnough = Math.hypot(ball.x - player.x, ball.y - player.y) < player.r + ball.r + 6;
      if (!closeEnough) { playTick(); return; } // la pelota no está a tu alcance, no se re-patea en el aire
      const dir = side === "left" ? 1 : -1;
      gmb.shoot.charging = true;
      gmb.shoot.chargeStart = now;
      gmb.shoot.aimAngle = 0;
      gmb.shoot.aimX = dir; gmb.shoot.aimY = 0;
      gmb.shoot.aimHistory = [{ t: now, x: dir, y: 0 }];
      player.vx = 0; player.vy = 0;
    } else {
      gmbDash(side);
    }
}
}

function gmbReleaseAction(side) {
  if (!gmb || gmb.phase !== "shootout" || side !== gmb.attackerSide) return;
  if (gmb.shoot.charging) gmbFireShot();
}

function gmbDash(side) {
  const player = gmb[side];
  const now = performance.now();
  const { dx, dy } = gmbInputVector(side);
  let dirX = dx, dirY = dy;
  if (dirX === 0 && dirY === 0) { dirX = player.facingX; dirY = player.facingY; }
  const len = Math.hypot(dirX, dirY) || 1;
  player.vx += (dirX / len) * GMB_DASH_POWER;
  player.vy += (dirY / len) * GMB_DASH_POWER;
  player.dashingUntil = now + GMB_DASH_DURATION;
  const hasBall = gmb.ball && gmb.ball.owner === side;
  player.dashReadyAt = now + GMB_DASH_COOLDOWN + (hasBall ? GMB_DASH_BALLCARRIER_PENALTY : 0);
  player.dashTrailAt = now;
  busPlaySound("/static/audio/dash.wav", 0.55);
}

/* ---------- Loop principal ---------- */

function gmbLoop(ts) {
  if (!gmb) return;
  const dt = Math.min(ts - gmb.lastTs, 40) / (1000 / 60); // normalizado a "frames de 60fps"
  gmb.lastTs = ts;

  if (gmb.phase === "dribble") gmbUpdateDribble(dt, ts);
  else if (gmb.phase === "shootout") gmbUpdateShootout(dt, ts);

  gmbDraw(ts);
  gmbUpdateHud(ts);

  if (gmb.phase !== "done") gmbRafId = requestAnimationFrame(gmbLoop);
}

function gmbApplyMovement(player, side, dt) {
  const { dx, dy } = gmbInputVector(side);
  const dashing = performance.now() < player.dashingUntil;
  player.vx += dx * GMB_ACCEL * dt;
  player.vy += dy * GMB_ACCEL * dt;
  const fr = Math.pow(GMB_FRICTION, dt);
  player.vx *= fr; player.vy *= fr;
  const isKeeper = gmb.phase === "shootout" && side === gmb.defenderSide;
  const cap = (dashing ? GMB_DASH_MAXSPEED : GMB_MAX_SPEED) * (isKeeper ? GMB_KEEPER_SPEED_MULT : 1);
  const speed = Math.hypot(player.vx, player.vy);
  if (speed > cap) { player.vx = (player.vx / speed) * cap; player.vy = (player.vy / speed) * cap; }
  if (dx || dy) { player.facingX = dx; player.facingY = dy; }
  player.x += player.vx * dt;
  player.y += player.vy * dt;

  const now = performance.now();
  if (!player.trail) player.trail = [];
  if (dashing) player.trail.push({ x: player.x, y: player.y, t: now });
  if (player.trail.length) player.trail = player.trail.filter((pt) => now - pt.t < 280);
}


function gmbUpdateAim(side, dt) {
  const dir = side === "left" ? 1 : -1;
  const { dy } = gmbInputVector(side);
  let angle = (gmb.shoot.aimAngle || 0) + dy * GMB_AIM_TURN_SPEED * dt;
  const maxAngle = Math.PI / 2 - 0.12; // no te deja apuntar derecho arriba/abajo del todo
  angle = Math.max(-maxAngle, Math.min(maxAngle, angle));
  gmb.shoot.aimAngle = angle;
  gmb.shoot.aimX = Math.cos(angle) * dir;
  gmb.shoot.aimY = Math.sin(angle);

  const now = performance.now();
  gmb.shoot.aimHistory.push({ t: now, x: gmb.shoot.aimX, y: gmb.shoot.aimY });
  while (gmb.shoot.aimHistory.length > 1 && now - gmb.shoot.aimHistory[0].t > GMB_AIM_HISTORY_MS) {
    gmb.shoot.aimHistory.shift();
  }
}

function gmbClampToField(player, minX, maxX) {
  player.x = Math.max(minX + player.r, Math.min(maxX - player.r, player.x));
  player.y = Math.max(GMB_WALL + player.r, Math.min(GMB_FIELD_H - GMB_WALL - player.r, player.y));
}

function gmbResolveCircleCollision(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.001;
  const minDist = a.r + b.r;
  if (dist >= minDist) return;
  const overlap = (minDist - dist) / 2;
  const nx = dx / dist, ny = dy / dist;
  a.x -= nx * overlap; a.y -= ny * overlap;
  b.x += nx * overlap; b.y += ny * overlap;
  // un empujoncito de velocidad a lo largo de la normal (arcade, no elástico puro)
  const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
  const rel = rvx * nx + rvy * ny;
  if (rel < 0) {
    const push = -rel * 0.5;
    a.vx -= nx * push; a.vy -= ny * push;
    b.vx += nx * push; b.vy += ny * push;
  }
}

function gmbSeparateBallFromPlayer(ball, p, side) {
  const dx = ball.x - p.x, dy = ball.y - p.y;
  const dist = Math.hypot(dx, dy) || 0.001;
  const minDist = p.r + ball.r;
  if (dist >= minDist) return;
  const nx = dx / dist, ny = dy / dist;
  ball.x = p.x + nx * minDist;
  ball.y = p.y + ny * minDist;
  // Si la pelota es de ESTE jugador no lo empujamos más (ya la sigue el
  // "seguimiento" de arriba). Si es del rival o está suelta, rebota un
  // toque para que el cuerpo se sienta sólido y no un fantasma.
  if (ball.owner !== side) {
    const rel = ball.vx * nx + ball.vy * ny;
    if (rel < 0) { ball.vx -= rel * nx * 1.3; ball.vy -= rel * ny * 1.3; }
  }
}


function gmbBounceBallOffWalls(ball, top, bottom) {
  if (ball.y - ball.r < top) { ball.y = top + ball.r; ball.vy = Math.abs(ball.vy) * 0.6; }
  if (ball.y + ball.r > bottom) { ball.y = bottom - ball.r; ball.vy = -Math.abs(ball.vy) * 0.6; }
}

function gmbTrackBallTrail(ball) {
  const now = performance.now();
  if (!ball.trail) ball.trail = [];
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed > 3) ball.trail.push({ x: ball.x, y: ball.y, t: now });
  if (ball.trail.length) ball.trail = ball.trail.filter((pt) => now - pt.t < 220);
}

function gmbUpdateDribble(dt, ts) {
  gmb.phaseClock -= (dt * 1000) / 60;
  if (gmb.phaseClock <= 0) { gmbFinish("defenderWin", "tiempo"); return; }

  ["left", "right"].forEach((side) => gmbApplyMovement(gmb[side], side, dt));
  gmb.left.x = Math.max(GMB_WALL + gmb.left.r, Math.min(GMB_FIELD_W - GMB_WALL - gmb.left.r, gmb.left.x));
  gmb.left.y = Math.max(GMB_WALL + gmb.left.r, Math.min(GMB_FIELD_H - GMB_WALL - gmb.left.r, gmb.left.y));
  gmb.right.x = Math.max(GMB_WALL + gmb.right.r, Math.min(GMB_FIELD_W - GMB_WALL - gmb.right.r, gmb.right.x));
  gmb.right.y = Math.max(GMB_WALL + gmb.right.r, Math.min(GMB_FIELD_H - GMB_WALL - gmb.right.r, gmb.right.y));

  gmbResolveCircleCollision(gmb.left, gmb.right);

  const ball = gmb.ball;

  // Disputa de pelota: acá SOLO se decide de quién es la posesión.
  // El choque físico bola-cuerpo se resuelve más abajo, una sola vez para
  // los dos jugadores, así nunca queda "adentro" de nadie.
  ["left", "right"].forEach((side) => {
    const p = gmb[side];
    const dx = ball.x - p.x, dy = ball.y - p.y;
    const dist = Math.hypot(dx, dy) || 0.001;
    const pickupDist = p.r + ball.r + 3;
    if (dist >= pickupDist) return;

    if (ball.owner === null) {
      const immune = side === ball.kickedBy && performance.now() < ball.kickImmuneUntil;
      if (immune) return;
      // Si los dos están al alcance a la vez, se la queda el que esté MÁS
      // cerca (antes siempre ganaba "left" por el orden del forEach).
      const otherSide = side === "left" ? "right" : "left";
      const other = gmb[otherSide];
      const otherDist = Math.hypot(ball.x - other.x, ball.y - other.y);
      const otherImmune = otherSide === ball.kickedBy && performance.now() < ball.kickImmuneUntil;
      const otherCloser = !otherImmune && otherDist < other.r + ball.r + 3 && otherDist < dist;
      if (otherCloser) return;
      ball.owner = side;
    } else if (ball.owner !== side) {
      const mySpeed = Math.hypot(p.vx, p.vy);
      const ownerSpeed = Math.hypot(gmb[ball.owner].vx, gmb[ball.owner].vy);
      const tackling = performance.now() < p.dashingUntil;
      if (mySpeed > ownerSpeed + 0.4 || tackling) {
        ball.owner = side;
        ball.vx += p.vx * 0.4; ball.vy += p.vy * 0.4;
        playTick();
      }
    }
  });

  if (ball.owner) {
    const p = gmb[ball.owner];
    const fLen = Math.hypot(p.facingX, p.facingY) || 1;
    const tx = p.x + (p.facingX / fLen) * (p.r + ball.r + 3);
    const ty = p.y + (p.facingY / fLen) * (p.r + ball.r + 3);
    ball.vx += (tx - ball.x) * 0.05;
    ball.vy += (ty - ball.y) * 0.05;
    ball.vx *= 0.94; ball.vy *= 0.94;
  } else {
    // Pelota libre (recién pateada): frena mucho menos que la pegada,
    // así un pique fuerte se siente rápido y no queda "clavada" al toque.
    ball.vx *= 0.985; ball.vy *= 0.985;
  }
  ball.x += ball.vx * dt; ball.y += ball.vy * dt;
  if (ball.x - ball.r < GMB_WALL) { ball.x = GMB_WALL + ball.r; ball.vx = Math.abs(ball.vx) * 0.6; }
  if (ball.x + ball.r > GMB_FIELD_W - GMB_WALL) { ball.x = GMB_FIELD_W - GMB_WALL - ball.r; ball.vx = -Math.abs(ball.vx) * 0.6; }
  gmbBounceBallOffWalls(ball, GMB_WALL, GMB_FIELD_H - GMB_WALL);

  // FIX del bug: separación física pelota-cuerpo en un solo lugar, para los
  // DOS jugadores, después de mover la bola. Esto evita que quede "peleada"
  // entre el seguimiento del dueño y el rebote contra el cuerpo del rival.
  ["left", "right"].forEach((side) => gmbSeparateBallFromPlayer(ball, gmb[side], side));
  gmbTrackBallTrail(ball);

  const attacker = gmb[gmb.attackerSide];
  const defender = gmb[gmb.defenderSide];
  const attackerGoalDir = gmb.attackerSide === "left" ? 1 : -1;
  const attackerTargetX = gmb.attackerSide === "left" ? GMB_ATTACK_ZONE_X : GMB_FIELD_W - GMB_ATTACK_ZONE_X;
  const stealBackX = gmb.attackerSide === "left" ? GMB_STEAL_BACK_X : GMB_FIELD_W - GMB_STEAL_BACK_X;

  const attackerPast = attackerGoalDir * attacker.x >= attackerGoalDir * attackerTargetX;
  const ballPast = attackerGoalDir * ball.x >= attackerGoalDir * attackerTargetX;

  if (attackerPast && ballPast && ball.owner === gmb.attackerSide) {
    gmbStartTransition();
  } else if (ball.owner === gmb.defenderSide && attackerGoalDir * defender.x <= attackerGoalDir * stealBackX) {
    gmbFinish("defenderWin", "robo");
  }
}

function gmbStartTransition() {
  gmb.phase = "transition";
  gmbSetPhaseLabel("¡Rompió la marca! 🔥");
  playFanfare();
  gmbShowBanner("¡Se la llevó! Ahora es mano a mano con el arquero 🧤", 1300);
  gmbSetTimeout(() => gmbStartShootout(), 1300);
}

function gmbStartShootout() {
  const attackerSide = gmb.attackerSide, defenderSide = gmb.defenderSide;
  const dir = attackerSide === "left" ? 1 : -1;
  const goalX = attackerSide === "left" ? GMB_GOAL_LINE_X : GMB_FIELD_W - GMB_GOAL_LINE_X;
  const runupX = attackerSide === "left" ? 130 : GMB_FIELD_W - 130;

  const attacker = gmb[attackerSide];
  const keeper = gmb[defenderSide];
  attacker.x = runupX; attacker.y = GMB_FIELD_H / 2; attacker.vx = 0; attacker.vy = 0;
  attacker.facingX = dir; attacker.facingY = 0;
  keeper.x = goalX; keeper.y = GMB_FIELD_H / 2; keeper.vx = 0; keeper.vy = 0;

  gmb.ball.x = attacker.x + dir * 22; gmb.ball.y = attacker.y;
  gmb.ball.vx = 0; gmb.ball.vy = 0; gmb.ball.owner = attackerSide;
  gmb.shoot = { charging: false, chargeStart: 0, aimAngle: 0, aimX: dir, aimY: 0, aimHistory: [] };

  gmb.phase = "shootout";
  gmb.shootoutStartedAt = performance.now();
  gmbSetPhaseLabel("Fase 2 · ¡Corré y definí!");
  gmbShowBanner("¡Arrancá la carrera y amagalo antes de rematar! 🏃💨", 1600);
}

function gmbFireShot() {
  const now = performance.now();
  const charge = Math.min(now - gmb.shoot.chargeStart, GMB_SHOOT_MAX_CHARGE) / GMB_SHOOT_MAX_CHARGE;
  gmb.shoot.charging = false;
  const attacker = gmb[gmb.attackerSide];
  const dir = gmb.attackerSide === "left" ? 1 : -1;

  const aimX = gmb.shoot.aimX, aimY = gmb.shoot.aimY;
  const speed = GMB_SHOOT_BASE_SPEED + charge * GMB_SHOOT_BONUS_SPEED;
  gmb.ball.owner = null;
  gmb.ball.vx = aimX * speed;
  gmb.ball.vy = aimY * speed;
  gmb.ball.x = attacker.x + dir * (attacker.r + gmb.ball.r + 2);
  gmb.kickBurst = { x: gmb.ball.x, y: gmb.ball.y, t: now };

  // Comba por LATIGAZO: comparamos hacia dónde apuntabas hace ~140ms contra
  // hacia dónde apuntás justo al soltar. Si giraste la puntería en el último
  // instante, ese giro se convierte en rosca — es un gesto, no una tecla que
  // compite con el movimiento.
  const hist = gmb.shoot.aimHistory;
  const past = hist.length ? hist[0] : { x: aimX, y: aimY };
  const cross = past.x * aimY - past.y * aimX; // de qué lado giraste
  const flick = Math.max(-1, Math.min(1, cross * GMB_FLICK_CURVE_SCALE));

  const curveVariance = 0.85 + Math.random() * 0.4;
  gmb.ball.hasCurve = Math.abs(flick) > 0.04;
  gmb.ball.curveAccel = flick * charge * GMB_CURVE_MAX_ACCEL * curveVariance;
  gmb.ball.curveApplied = 0;

  gmb.ball.knuckleSeed = Math.random() * Math.PI * 2;
  gmb.ball.knuckleFreq = GMB_KNUCKLE_FREQ_MIN + Math.random() * (GMB_KNUCKLE_FREQ_MAX - GMB_KNUCKLE_FREQ_MIN);
  gmb.ball.knuckleAmp = GMB_KNUCKLE_AMPLITUDE * (0.6 + charge * 0.8);
  gmb.ball.shotAt = now;

  busPlaySound("/static/audio/kickball.wav", 0.6);
}

function gmbUpdateShootout(dt, ts) {
  const attackerSide = gmb.attackerSide, defenderSide = gmb.defenderSide;
  const attacker = gmb[attackerSide], keeper = gmb[defenderSide];
  const dir = attackerSide === "left" ? 1 : -1;
  const goalX = attackerSide === "left" ? GMB_GOAL_LINE_X : GMB_FIELD_W - GMB_GOAL_LINE_X;

  // El atacante corre casi tan libre como en la Fase 1 (para poder amagar),
  // solo se lo frena a la mitad al cargar el remate, y no puede caminar el
  // gol: hay una distancia mínima obligatoria al arco.
  if (gmb.shoot.charging) gmbUpdateAim(attackerSide, dt);
  else gmbApplyMovement(attacker, attackerSide, dt);
  const approachLimit = 90;
  if (dir === 1) attacker.x = Math.min(attacker.x, goalX - approachLimit);
  else attacker.x = Math.max(attacker.x, goalX + approachLimit);
  attacker.x = Math.max(GMB_WALL + attacker.r, Math.min(GMB_FIELD_W - GMB_WALL - attacker.r, attacker.x));
  attacker.y = Math.max(GMB_WALL + attacker.r, Math.min(GMB_FIELD_H - GMB_WALL - attacker.r, attacker.y));

  // El arquero ahora tiene física real dentro de una cajita frente al arco
  // (ya no está pegado a la línea), para poder tapar mejor.
  gmbApplyMovement(keeper, defenderSide, dt);
  const keeperBoxDepth = 78;
  const kEdgeA = goalX - dir * keeperBoxDepth;
  const kEdgeB = goalX + dir * 8;
  const kMin = Math.min(kEdgeA, kEdgeB), kMax = Math.max(kEdgeA, kEdgeB);
  keeper.x = Math.max(kMin, Math.min(kMax, keeper.x));
  keeper.y = Math.max(GMB_FIELD_H / 2 - GMB_GOAL_HALF - 36, Math.min(GMB_FIELD_H / 2 + GMB_GOAL_HALF + 36, keeper.y));

  gmbResolveCircleCollision(attacker, keeper); // NUEVO: ya no se atraviesan como fantasmas    

  if (gmb.ball.owner === attackerSide) {
    // Misma fórmula de "la pelota sigue hacia donde mirás" que la Fase 1,
    // para que el amague en la corrida se sienta igual de bien.
    const ball = gmb.ball;
    const fLen = Math.hypot(attacker.facingX, attacker.facingY) || 1;
    const tx = attacker.x + (attacker.facingX / fLen) * (attacker.r + ball.r + 3);
    const ty = attacker.y + (attacker.facingY / fLen) * (attacker.r + ball.r + 3);
    ball.vx += (tx - ball.x) * 0.05;
    ball.vy += (ty - ball.y) * 0.05;
    ball.vx *= 0.94; ball.vy *= 0.94;
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;

    // NUEVO: si el arquero llega a tocar la pelota mientras la maneja el atacante, se la quita
    const dSteal = Math.hypot(ball.x - keeper.x, ball.y - keeper.y);
    if (dSteal < keeper.r + ball.r) {
      gmbFinish("keeperWin", "quite");
      return;
    }
  } else {
    const ball = gmb.ball;

    // NUEVO: aplica la comba mientras dura el vuelo, hasta el tope
    if (ball.hasCurve && Math.abs(ball.curveApplied) < GMB_CURVE_MAX_VY) {
      const step = ball.curveAccel * dt;
      ball.vy += step;
      ball.curveApplied += step;
    }
    if (ball.knuckleAmp) {
      const elapsed = ts - ball.shotAt;
      ball.vy += Math.sin(elapsed * ball.knuckleFreq + ball.knuckleSeed) * ball.knuckleAmp * dt;
    }

    ball.vx *= 0.995; ball.vy *= 0.995;
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    gmbBounceBallOffWalls(ball, GMB_WALL, GMB_FIELD_H - GMB_WALL);
    gmbTrackBallTrail(ball);

    // Palos (dos círculos fijos en las puntas del arco)
    [-1, 1].forEach((sgn) => {
      const post = { x: goalX, y: GMB_FIELD_H / 2 + sgn * GMB_GOAL_HALF, r: GMB_POST_R };
      const d = Math.hypot(ball.x - post.x, ball.y - post.y);
      if (d < post.r + ball.r) {
        const nx = (ball.x - post.x) / d, ny = (ball.y - post.y) / d;
        ball.x = post.x + nx * (post.r + ball.r);
        ball.y = post.y + ny * (post.r + ball.r);
        ball.vx *= -0.5; ball.vy *= -0.5;
      }
    });

    // Atajada: además de tocar la pelota, tiene que ser un contacto DE FRENTE
    // (si la pelota ya lo pasó camino al gol, un roce de costado/espalda no cuenta).
    const dK = Math.hypot(ball.x - keeper.x, ball.y - keeper.y);
    const frontContact = (ball.x - keeper.x) * dir < keeper.r * 0.6;
    if (dK < keeper.r + ball.r && frontContact) {
      gmbFinish("keeperWin", "atajada");
      return;
    }

    // Si nadie la tiene, el atacante puede ir a buscarla y patear de nuevo
    // cuantas veces quiera - mientras el arquero no la toque, sigue viva.
    if (ball.owner === null) {
      const dA = Math.hypot(ball.x - attacker.x, ball.y - attacker.y);
      if (dA < attacker.r + ball.r + 2) {
        ball.owner = attackerSide;
        playTick();
      }
    }

    // Gol si entra en el arco. Si se va afuera (ancho o al palo y sigue),
    // YA NO termina la ronda: rebota como si pegara en el cartel de fondo
    // y sigue jugándose.
    const pastLine = dir === 1 ? ball.x - ball.r > goalX : ball.x + ball.r < goalX;
    if (pastLine) {
      const inMouth = Math.abs(ball.y - GMB_FIELD_H / 2) <= GMB_GOAL_HALF;
      if (inMouth) {
        gmbFinish("shooterWin", "gol");
        return;
      }
      ball.x = goalX - dir * (ball.r + 2);
      ball.vx *= -0.45;
      ball.vy *= 0.6;
      if (!gmb.wideMissShown || ts - gmb.wideMissShown > 1500) {
        gmbShowBanner("¡Afuera! Pero sigue viva, andá a buscarla 🏃", 1300);
        gmb.wideMissShown = ts;
      }
    }
    if (performance.now() - gmb.shootoutStartedAt > GMB_SHOOTOUT_TIMEOUT) {
      gmbFinish("keeperWin", "tiempo");
      return;
    }
  }
}

/* ---------- Resolución y resultado ---------- */

function gmbFinish(winnerKind, reason) {
  if (!gmb || gmb.phase === "done") return;
  gmb.phase = "done";
  if (gmbRafId) cancelAnimationFrame(gmbRafId);
  gmbRafId = null;
  window.removeEventListener("keydown", gmbOnKeyDown);
  window.removeEventListener("keyup", gmbOnKeyUp);

  const attackerSide = gmb.attackerSide, defenderSide = gmb.defenderSide;
  const attackerScored = winnerKind === "shooterWin";
  const attackerIdentity = attackerSide === "left" ? "champion" : "challenger";

  // Anotamos el intento en la tanda
  if (attackerIdentity === "champion") gmbTanda.championResults.push(attackerScored);
  else gmbTanda.challengerResults.push(attackerScored);
  gmbRenderScoreboard();

  const champTaken = gmbTanda.championResults.length;
  const chalTaken = gmbTanda.challengerResults.length;
  document.getElementById("gambetaScoreboard").classList.toggle("sudden-death", champTaken > 5 || chalTaken > 5);

  const winnerSide = attackerScored ? attackerSide : defenderSide;
  const side = winnerSide === "left" ? "champion" : "challenger";
  const winnerName = winnerSide === "left" ? gmb.championName : gmb.challengerName;

  const REASON_MSG = {
    tiempo: `Se acabó el tiempo y ${winnerName} nunca lo dejó pasar 🛡️`,
    robo: `¡Le robó la pelota y se la llevó hasta el otro lado! 🦵`,
    atajada: `¡${winnerName} lo tapó de una gran atajada! 🧤`,
    afuera: `El remate se fue lejos del arco. ¡Sigue siendo arquero, ${winnerName}! 🧤`,
    gol: `¡GOLAZO! ${winnerName} la clavó en el ángulo ⚽🔥`,
    quite: `¡${winnerName} le achicó bien el ángulo y se la sacó de los pies! 🧤🦵`,
  };

  const decided = gmbTandaDecided();

  if (decided) {
    gmbSetTimeout(() => gmbFinishTanda(decided, REASON_MSG[reason] || ""), 1300);
    return;
  }

  // La tanda sigue: banner cortito con el resultado del intento + arranca el próximo con roles invertidos
  const scoreTxt = `${gmbTanda.championResults.filter(Boolean).length}-${gmbTanda.challengerResults.filter(Boolean).length}`;
  gmbShowBanner(attackerScored ? `⚽ ¡GOL de ${winnerName}! (${scoreTxt})` : `🧤 ¡Se lo bancó ${winnerName}! (${scoreTxt})`, 1500);

  if (winnerKind === "shooterWin") { launchConfetti(); playFanfare(); }
  else if (winnerKind === "keeperWin") { playFanfare(); }
  else { playBuzz(); }

  gmbTanda.currentAttacker = gmbTanda.currentAttacker === "champion" ? "challenger" : "champion";
  gmbSetTimeout(startGambetaMatch, 1700);
}

function gmbFinishTanda(side, flavor) {
  const winnerName = side === "champion" ? gmbTanda.championName : gmbTanda.challengerName;
  document.getElementById("gambetaPlay").classList.add("hidden");
  document.getElementById("gambetaResult").classList.remove("hidden");
  document.getElementById("gambetaResultTitle").textContent = `🏆 ¡${winnerName} se queda con la tanda!`;
  document
    .getElementById(side === "champion" ? "gmbTbChampionSide" : "gmbTbChallengerSide")
    .classList.add("pb-winner");
  const resultEl = document.getElementById("gambetaResultText");
  resultEl.classList.remove("show");
  resolveDuelResult(resultEl, side, flavor);
  launchTrophyBurst();
  launchConfetti();
  playFanfare();
}

/* ===================== Gambeta 1v1 — dibujo, HUD, táctil ===================== */

function gmbSetPhaseLabel(text) {
  document.getElementById("gambetaPhaseLabel").textContent = text;
}

function gmbShowBanner(text, ms) {
  const el = document.getElementById("gambetaBanner");
  el.textContent = text;
  el.classList.remove("hidden", "gambeta-banner-pop");
  void el.offsetWidth;
  el.classList.add("gambeta-banner-pop");
  gmbSetTimeout(() => el.classList.add("hidden"), ms);
}

function gmbUpdateHud(ts) {
  if (!gmb) return;
  const now = performance.now();
  const leftCd = Math.max(0, gmb.left.dashReadyAt - now) / GMB_DASH_COOLDOWN;
  const rightCd = Math.max(0, gmb.right.dashReadyAt - now) / GMB_DASH_COOLDOWN;
  document.getElementById("gambetaLeftDashFill").style.transform = `scaleX(${1 - leftCd})`;
  document.getElementById("gambetaRightDashFill").style.transform = `scaleX(${1 - rightCd})`;
  document.getElementById("gambetaLeftDashFill").classList.toggle("gambeta-dash-ready", leftCd === 0);
  document.getElementById("gambetaRightDashFill").classList.toggle("gambeta-dash-ready", rightCd === 0);

  const timerEl = document.getElementById("gambetaTimer");
  if (gmb.phase === "dribble") {
    timerEl.textContent = Math.max(0, gmb.phaseClock / 1000).toFixed(1) + "s";
    timerEl.classList.toggle("gambeta-timer-danger", gmb.phaseClock < 3500);
  } else if (gmb.phase === "shootout") {
    const remaining = GMB_SHOOTOUT_TIMEOUT - (now - gmb.shootoutStartedAt);
    timerEl.textContent = Math.max(0, remaining / 1000).toFixed(1) + "s";
    timerEl.classList.toggle("gambeta-timer-danger", remaining < 3500);
  } else {
    timerEl.textContent = "";
    timerEl.classList.remove("gambeta-timer-danger");
  }
}

/* ---------- Render ---------- */

function gmbDraw(ts) {
  const canvas = document.getElementById("gambetaCanvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, GMB_FIELD_W, GMB_FIELD_H);

  gmbDrawPitch(ctx);
  if (gmb.phase === "shootout" || gmb.phase === "transition") gmbDrawGoal(ctx);

  gmbDrawPlayer(ctx, gmb.left, ts);
  gmbDrawPlayer(ctx, gmb.right, ts);
  gmbDrawBall(ctx);
  gmbDrawKickBurst(ctx);
}

function gmbDrawKickBurst(ctx) {
  if (!gmb.kickBurst) return;
  const age = (performance.now() - gmb.kickBurst.t) / 260;
  if (age >= 1) { gmb.kickBurst = null; return; }
  const { x, y } = gmb.kickBurst;
  ctx.save();
  ctx.globalAlpha = 1 - age;
  ctx.strokeStyle = "#f5cd76";
  ctx.lineWidth = 2.5;
  const rays = 8;
  for (let i = 0; i < rays; i++) {
    const ang = (i / rays) * Math.PI * 2;
    const inner = 6 + age * 4;
    const outer = 10 + age * 22;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(ang) * inner, y + Math.sin(ang) * inner);
    ctx.lineTo(x + Math.cos(ang) * outer, y + Math.sin(ang) * outer);
    ctx.stroke();
  }
  ctx.restore();
}

function gmbDrawPitch(ctx) {
  // Césped con franjas diagonales, mismo espíritu que el resto de la web.
  ctx.fillStyle = "#4f7a3d";
  ctx.fillRect(0, 0, GMB_FIELD_W, GMB_FIELD_H);
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 26;
  for (let x = -GMB_FIELD_H; x < GMB_FIELD_W + GMB_FIELD_H; x += 52) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + GMB_FIELD_H, GMB_FIELD_H);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(230,240,225,0.85)";
  ctx.lineWidth = GMB_WALL;
  ctx.strokeRect(GMB_WALL / 2, GMB_WALL / 2, GMB_FIELD_W - GMB_WALL, GMB_FIELD_H - GMB_WALL);

  if (gmb.phase === "dribble") {
    // Línea de meta del atacante (zona a alcanzar) y línea de robo del defensor
    const dir = gmb.attackerSide === "left" ? 1 : -1;
    const targetX = gmb.attackerSide === "left" ? GMB_ATTACK_ZONE_X : GMB_FIELD_W - GMB_ATTACK_ZONE_X;
    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = "rgba(245, 205, 118, 0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(targetX, GMB_WALL); ctx.lineTo(targetX, GMB_FIELD_H - GMB_WALL); ctx.stroke();
    ctx.restore();
  }
}

function gmbDrawGoal(ctx) {
  const attackerSide = gmb.attackerSide;
  const dir = attackerSide === "left" ? 1 : -1;
  const goalX = attackerSide === "left" ? GMB_GOAL_LINE_X : GMB_FIELD_W - GMB_GOAL_LINE_X;
  const topY = GMB_FIELD_H / 2 - GMB_GOAL_HALF, botY = GMB_FIELD_H / 2 + GMB_GOAL_HALF;
  const bulge = 40 * dir; // cuánto se infla el arco hacia afuera, estilo Haxball

  // Red: la "panza" del arco es una sola curva del palo de arriba al de abajo
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(goalX, topY);
  ctx.quadraticCurveTo(goalX + bulge, GMB_FIELD_H / 2, goalX, botY);
  ctx.lineTo(goalX, topY);
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  for (let i = -6; i <= 6; i++) {
    ctx.beginPath(); ctx.moveTo(goalX + i * 8, topY - 20); ctx.lineTo(goalX + i * 8, botY + 20); ctx.stroke();
  }
  for (let j = 0; j <= 16; j++) {
    ctx.beginPath(); ctx.moveTo(goalX - 50, topY + j * 8); ctx.lineTo(goalX + 50, topY + j * 8); ctx.stroke();
  }
  ctx.restore();

  // El arco en sí: una sola curva estilo Haxball, de palo a palo
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(goalX, topY);
  ctx.quadraticCurveTo(goalX + bulge, GMB_FIELD_H / 2, goalX, botY);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();

  // Línea de gol (la que define si entró o no)
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(goalX, topY); ctx.lineTo(goalX, botY); ctx.stroke();

  // Palos
  [topY, botY].forEach((y) => {
    ctx.beginPath();
    ctx.arc(goalX, y, GMB_POST_R, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
}

function gmbDrawChargeArrow(ctx, ts) {
  const now = performance.now();
  const charge = Math.min(now - gmb.shoot.chargeStart, GMB_SHOOT_MAX_CHARGE) / GMB_SHOOT_MAX_CHARGE;
  const attacker = gmb[gmb.attackerSide];
  const aimX = gmb.shoot.aimX, aimY = gmb.shoot.aimY;
  const len = 20 + charge * 46;
  ctx.save();
  ctx.strokeStyle = `rgba(245, 205, 118, ${0.5 + charge * 0.5})`;
  ctx.lineWidth = 4 + charge * 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(attacker.x + aimX * (attacker.r + 6), attacker.y + aimY * (attacker.r + 6));
  ctx.lineTo(attacker.x + aimX * (attacker.r + 6 + len), attacker.y + aimY * (attacker.r + 6 + len));
  ctx.stroke();

  const tipX = attacker.x + aimX * (attacker.r + 6 + len);
  const tipY = attacker.y + aimY * (attacker.r + 6 + len);
  const ang = Math.atan2(aimY, aimX);
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - Math.cos(ang - 0.4) * 10, tipY - Math.sin(ang - 0.4) * 10);
  ctx.lineTo(tipX - Math.cos(ang + 0.4) * 10, tipY - Math.sin(ang + 0.4) * 10);
  ctx.closePath();
  ctx.fillStyle = `rgba(245, 205, 118, ${0.6 + charge * 0.4})`;
  ctx.fill();
  ctx.restore();
}

function gmbDrawPlayer(ctx, p, ts) {
  const dashing = performance.now() < p.dashingUntil;
  // Estela del dash: varios "fantasmas" que se van achicando y desvaneciendo.
  if (p.trail && p.trail.length) {
    const now = performance.now();
    ctx.save();
    p.trail.forEach((pt) => {
      const age = Math.min((now - pt.t) / 280, 1);
      ctx.globalAlpha = (1 - age) * 0.4;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, p.r * (1 - age * 0.35), 0, Math.PI * 2);
      ctx.fillStyle = gmbResolveColor(p.color);
      ctx.fill();
    });
    ctx.restore();
  }

  ctx.save();
  if (dashing) { ctx.shadowColor = gmbResolveColor(p.color); ctx.shadowBlur = 16; }
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
  ctx.fillStyle = gmbResolveColor(p.color);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.stroke();
  ctx.restore();

  // Iniciales, como en el resto de la web (fichas/HUD con 2 letras)
  ctx.fillStyle = "#0e0a11";
  ctx.font = "bold 12px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = p.side === gmb.attackerSide ? "⚽" : "🧤";
  ctx.fillText(label, p.x, p.y + 1);
}

function gmbDrawBall(ctx) {
  const b = gmb.ball;
  if (b.trail && b.trail.length) {
    const now = performance.now();
    ctx.save();
    b.trail.forEach((pt) => {
      const age = Math.min((now - pt.t) / 220, 1);
      ctx.globalAlpha = (1 - age) * 0.5;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, b.r * (1 - age * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = "#f4f1e8";
      ctx.fill();
    });
    ctx.restore();
  }

  // Sombra en el piso, le da volumen
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(b.x, b.y + b.r * 0.75, b.r * 0.9, b.r * 0.35, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  ctx.clip();

  // Esfera con degradé (luz arriba-izq, sombra abajo-der)
  const grad = ctx.createRadialGradient(
    b.x - b.r * 0.4, b.y - b.r * 0.45, b.r * 0.15,
    b.x, b.y, b.r * 1.15
  );
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.55, "#f2efe4");
  grad.addColorStop(1, "#cfc9b8");
  ctx.fillStyle = grad;
  ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);

  // Gajos tipo pelota de fútbol, "rotando" según la posición (efecto de
  // rodar sin trackear spin real, así queda liviano)
  const rot = b.x * 0.05 + b.y * 0.05;
  ctx.translate(b.x, b.y);
  ctx.rotate(rot);
  ctx.fillStyle = "rgba(20,18,14,0.85)";
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, b.r * 0.62, ang - 0.26, ang + 0.26);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, b.r * 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(-rot);
  ctx.translate(-b.x, -b.y);
  ctx.restore();

  // Borde y brillo
  ctx.save();
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(b.x - b.r * 0.32, b.y - b.r * 0.35, b.r * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fill();
  ctx.restore();
}

function gmbResolveColor(varName) {
  if (!varName.startsWith("var(")) return varName;
  const name = varName.slice(4, -1);
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#fff";
}

/* ---------- Controles táctiles (joystick doble para mobile) ---------- */

function gmbSetupTouchZone(zoneId, joyId, dashBtnId, kickBtnId, side) {
  const zone = document.getElementById(zoneId);
  const joy = document.getElementById(joyId);
  const knob = joy.querySelector(".gambeta-joystick-knob");
  const dashBtn = document.getElementById(dashBtnId);
  const kickBtn = document.getElementById(kickBtnId);
  let activeTouchId = null;
  let baseX = 0, baseY = 0;
  const MAX_R = 34;

  const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
  const resetKnob = () => { setKnob(0, 0); if (gmb) { gmb.touch[side].dx = 0; gmb.touch[side].dy = 0; } };

  zone.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    activeTouchId = t.identifier;
    const rect = joy.getBoundingClientRect();
    baseX = rect.left + rect.width / 2;
    baseY = rect.top + rect.height / 2;
    e.preventDefault();
  }, { passive: false });

  zone.addEventListener("touchmove", (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== activeTouchId) continue;
      let dx = t.clientX - baseX, dy = t.clientY - baseY;
      const len = Math.hypot(dx, dy);
      if (len > MAX_R) { dx = (dx / len) * MAX_R; dy = (dy / len) * MAX_R; }
      setKnob(dx, dy);
      if (gmb) { gmb.touch[side].dx = dx / MAX_R; gmb.touch[side].dy = dy / MAX_R; }
      e.preventDefault();
    }
  }, { passive: false });

  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === activeTouchId) { activeTouchId = null; resetKnob(); }
    }
  };
  zone.addEventListener("touchend", endTouch);
  zone.addEventListener("touchcancel", endTouch);

  dashBtn.addEventListener("touchstart", (e) => { e.preventDefault(); gmbTryAction(side); }, { passive: false });
  dashBtn.addEventListener("touchend", (e) => { e.preventDefault(); gmbReleaseAction(side); }, { passive: false });
  kickBtn.addEventListener("touchstart", (e) => { e.preventDefault(); gmbTryKick(side); }, { passive: false });
}
