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

function playHonk() {
  if (!soundEnabled) return;
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(220, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(160, ctx.currentTime + 0.09);
  gain.gain.setValueAtTime(0.18, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.13);
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


/* ---------- Challenger name modal (reemplaza al prompt() nativo) ---------- */

function openChallengerNameModal(championName) {
  document.getElementById("challengerChampionName").textContent = championName;
  const input = document.getElementById("challengerNameInput");
  input.value = "";
  updateChallengerPreview();
  document.getElementById("challengerNameModal").classList.remove("hidden");
  setTimeout(() => input.focus(), 60);
}

function updateChallengerPreview() {
  const val = document.getElementById("challengerNameInput").value.trim();
  const preview = document.getElementById("challengerPreview");
  preview.textContent = "🙋 " + (val || "Retador");
  preview.classList.remove("challenger-preview-pop");
  void preview.offsetWidth; // fuerza reflow para poder repetir la animación
  preview.classList.add("challenger-preview-pop");
}

function confirmChallengerName() {
  const val = document.getElementById("challengerNameInput").value.trim();
  pendingChallengerName = val || "Retador";
  document.getElementById("challengerNameModal").classList.add("hidden");
  openDuelSelect();
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

// Controles por combos: 4 teclas lógicas (no 6), funcionan WASD o flechas
// indistintamente. Vertical = fila (obligatoria), horizontal = modificador
// opcional que apunta al palo. Solo vertical = al medio.
// El pateador SOLO usa flechas (elegir rincón + combarla). El arquero
// tiene su propio esquema aparte más abajo (A/D moverse, Espacio tirarse) -
// antes compartían el mismo mapa y por eso no había control independiente.
const PENALTY_KEY_TO_DIR = {
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
};
const PENALTY_COMBO_WINDOW_MS = 70; // margen para que 2 teclas cuenten como un solo combo

// ---------- Arquero: movimiento libre + salto real ----------
// Bajado a pedido (se sentía injustamente rápido: reposicionarse a
// cualquier lado del arco costaba casi nada). Ahora moverse de punta a
// punta lleva su tiempo real - hay que anticipar, no corregir a último
// momento.
const KEEPER_MOVE_ACCEL = 950;       // px/s² al mantener A/D (antes 1500)
const KEEPER_MOVE_MAXSPEED = 215;    // px/s tope caminando (antes 340)
// Alcance parado: apenas por encima del propio radio del cuerpo (33px) -
// cubre el remate al cuerpo sin regalar nada de más.
const KEEPER_STANDING_REACH = 44;    // px (antes 32, que era MENOS que su propio cuerpo)
const KEEPER_DIVE_TRAVEL_SPEED = 740; // px/s "presupuesto" de alcance al tirarse (antes 900)
const KEEPER_DIVE_MAX_MS = 480;      // tope de duración del salto, no es un teletransporte

// Comba por rincón: los tiros a los ángulos se cierran MÁS hacia esa
// esquina (like un tiro real con efecto); al medio casi no comba.
const PENALTY_CURVE_BY_ZONE = {
  bl: { sign: -1, mag: 42 }, tl: { sign: -1, mag: 42 },
  br: { sign: 1, mag: 42 },  tr: { sign: 1, mag: 42 },
  bc: { sign: 0, mag: 8 },   tc: { sign: 0, mag: 8 },
};

function penaltyZoneFromDirs(dirs) {
  const horizontal = dirs.has("left") ? "left" : dirs.has("right") ? "right" : null;
  const vertical = dirs.has("up") ? "up" : dirs.has("down") ? "down" : (horizontal ? "down" : null);
  if (!vertical) return null;
  if (vertical === "up") return horizontal === "left" ? "tl" : horizontal === "right" ? "tr" : "tc";
  return horizontal === "left" ? "bl" : horizontal === "right" ? "br" : "bc";
}
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

// Ya no son vectores fijos: el salto se calcula en vivo en diveKeeper()
// contra el punto real del rincón en el arco, así el arquero siempre
// llega exactamente adonde va la pelota. Solo queda la rotación.
const PENALTY_DIVE_ROT = { bl: -18, bc: 0, br: 18, tl: -14, tc: 0, tr: 14 };
const PENALTY_GRAVITY = 2200; // px/s^2, tuneado a ojo para que el arco se vea bien

// Comba interactiva: solo se puede combar al palo vecino del MISMO lado
// (arriba<->abajo), nunca al lado opuesto — un toque, no un tironeo random.
const PENALTY_CURVE_REDIRECT = { bl: "tl", tl: "bl", bc: "tc", tc: "bc", br: "tr", tr: "br" };

let penaltyState = "idle";
let penaltyKeyHandler = null;
let penaltyKeeperKeyHandler = null;
let penaltyKeeperKeyUpHandler = null;
let penaltyFlightRAF = null;
let penaltyPowerRAF = null;
let penaltyReactRAF = null;
let penaltyKeeperMoveRAF = null;
let penaltyIdleTimer = null;
let penaltyKickZone = null;
let penaltyKeeperZone = null;
let penaltyCurveZone = null;
let penaltyKeeperStretch = false;
let penaltyKeeperTooSlow = false;
let penaltyFlightStartTime = 0;
let currentPower = 0;
let powerDirection = 1;
let capturedPower = 0;
let penaltyCurveApplied = false;  // si ya se usó el toque de "cargar" la comba en este tiro
let penaltyCurveSign = 0;         // hacia dónde comba el tiro actual
let penaltyCurveMag = 0;          // cuánto comba (px de desvío final)
let penaltyFlightDurationMs = 0;  // duración total del vuelo actual (para sincronizar el salto)
let penaltyReactionCutoffMs = 700;
let penaltyAimStartTime = 0;
let penaltyReactTimer = null;
let penaltyRoundTimeout = null;
let penaltyKeeperLateFrac = 0;
let penaltyBallStart = { x: 0, y: 0 }; // FIX: punto de arranque del vuelo, para poder convertir coordenadas absolutas -> relativas al resolver el tiro
let shootout = null;

// ---------- Estado nuevo: arquero con posición y física propias ----------
let penaltyKeeperMoveKeys = { left: false, right: false, up: false };
let penaltyKeeperGuessedWrong = false; // para el flavor text: se tiró para el lado que no era
let penaltyKeeperStandX = 0;       // offset actual del arquero, px desde el centro del arco
let penaltyKeeperVX = 0;
let penaltyKeeperBoundsPx = 150;   // hasta dónde puede caminar - se recalcula por ronda
let penaltyKeeperDiveUsed = false;
let penaltyKeeperSaveResult = false;
let penaltyFinalLanding = null;    // {x, y} relativo al pitch - dónde termina la pelota YA con la comba
let penaltyBallLiveRef = null;     // posición real de la pelota en este instante (para el reflejo)
let penaltyBallIntercepted = false;
let penaltyLastKeeperMoveT = 0;

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
  const minWindow = 700;  // antes 550 — más margen para reflejos normales
  const maxWindow = 1250; // antes 900
  const t = Math.max(0, Math.min(1, power / 84)); // 0 (flojo) -> 1 (al borde del fierrazo)
  let win = maxWindow - t * (maxWindow - minWindow);
  if (prefersReducedMotion) win += 150;
  return Math.round(win);
}

function spawnBallTrail(ball, vx, vy) {
  const pitch = document.querySelector(".penalty-pitch");
  if (!pitch) return;
  const rect = ball.getBoundingClientRect();
  const pitchRect = pitch.getBoundingClientRect();
  const angle = (Math.atan2(vy, vx) * 180) / Math.PI;
  const dot = document.createElement("span");
  dot.className = "ball-trail";
  dot.style.left = (rect.left - pitchRect.left + rect.width / 2) + "px";
  dot.style.top = (rect.top - pitchRect.top + rect.height / 2) + "px";
  dot.style.setProperty("--tr-angle", `${(angle + 180).toFixed(0)}deg`);
  dot.style.transform = `translate(-2px, -50%) rotate(${(angle + 180).toFixed(0)}deg)`;
  pitch.appendChild(dot);
  setTimeout(() => dot.remove(), 260);
}

function spawnImpactBurst(x, y, color) {
  const pitch = document.querySelector(".penalty-pitch");
  if (!pitch || prefersReducedMotion) return;
  for (let i = 0; i < 6; i++) {
    const p = document.createElement("span");
    p.className = "impact-spark";
    const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.4;
    const dist = 18 + Math.random() * 14;
    p.style.left = x + "px";
    p.style.top = y + "px";
    p.style.setProperty("--sx", `${(Math.cos(angle) * dist).toFixed(1)}px`);
    p.style.setProperty("--sy", `${(Math.sin(angle) * dist).toFixed(1)}px`);
    if (color) p.style.background = color;
    pitch.appendChild(p);
    setTimeout(() => p.remove(), 400);
  }
}

function spawnNetBulge(x, y) {
  const pitch = document.querySelector(".penalty-pitch");
  if (!pitch || prefersReducedMotion) return;
  const bulge = document.createElement("span");
  bulge.className = "net-bulge";
  bulge.style.left = x + "px";
  bulge.style.top = y + "px";
  pitch.appendChild(bulge);
  setTimeout(() => bulge.remove(), 420);
}

// La pelota "se frena" y se asienta en la red en vez de atravesarla.
// Ahora con peso: se hunde, la red la frena con un pequeño rebote elástico
// que se va amortiguando (no es un fundido plano) - y la malla (net-ripple,
// ver CSS) queda por encima en z-index, así se ve que entra DETRÁS de ella.
function ballSettleIntoNet(ball, x, y) {
  const start = performance.now();
  const dur = 480;
  ball.style.opacity = "1";
  // FIX: antes se desvanecía a opacity 0 - "desaparecía". Ahora se queda
  // visible, hamacando adentro del arco (la red pasa por encima en
  // z-index mientras dura el net-ripple, así se ve "atrapada" adentro).
  function step(now) {
    const t = Math.min(1, (now - start) / dur);
    const settle = t < 0.5
      ? (t / 0.5)
      : 1 + Math.sin((t - 0.5) / 0.5 * Math.PI) * 0.16 * (1 - (t - 0.5) / 0.5);
    const push = 8 + settle * 10;
    const scale = 0.66 - settle * 0.18;
    ball.style.transform = `translate(calc(-50% + ${x.toFixed(1)}px), ${(y + push).toFixed(1)}px) scale(${Math.max(0.42, scale).toFixed(2)})`;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Tiro a la tribuna: en vez de perderse de cuadro sin ningún efecto, se
// clava arriba del travesaño y cae con gravedad real antes de perderse.
function ballFlyOut(ball, x, y, vx, vy) {
  let px = x, py = Math.min(y, -4);
  let pvx = (vx || 0) * 0.4;
  let pvy = -Math.abs(vy || 260) * 0.5;
  const start = performance.now();
  let last = start;
  const ballCore = ball.querySelector(".ball-core");
  function step(now) {
    const dt = Math.min((now - last) / 1000, 0.032);
    last = now;
    pvy += 1400 * dt;
    px += pvx * dt;
    py += pvy * dt;
    pvx *= (1 - dt * 0.4);
    const t = (now - start) / 1000;
    const scale = Math.max(0.35, 0.85 - t * 0.5);
    ball.style.transform = `translate(calc(-50% + ${px.toFixed(1)}px), ${py.toFixed(1)}px) scale(${scale.toFixed(2)})`;
    ball.style.opacity = `${Math.max(0, 1 - t * 0.85).toFixed(2)}`;
    if (ballCore) ballCore.style.transform = `rotate(${(t * 900).toFixed(0)}deg)`;
    if (t < 0.7) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// En una atajada, el guante la despide con física real: se invierte y
// amortigua la velocidad que traía la pelota (no una curva prearmada fija),
// tiene gravedad y fricción de aire propias, y pica una vez contra el piso
// del área perdiendo energía - se siente un manotazo con peso de verdad.
function ballDeflectOff(ball, x, y, kickZone, vx, vy) {
  const posX = PENALTY_ZONE_POS[kickZone] ? PENALTY_ZONE_POS[kickZone].x : 0.5;
  const side = posX < 0.5 ? 1 : posX > 0.5 ? -1 : (Math.random() < 0.5 ? -1 : 1);
  const restitution = 0.4; // cuánta energía "sobrevive" al golpe del guante

  let px = x, py = y;
  let pvx = side * (80 + Math.abs(vx || 0) * restitution * 0.3);
  let pvy = -Math.min(340, Math.abs(vy || 200) * restitution * 0.5 + 140);
  let spin = (vx || 0) * 0.4;
  let bounceCount = 0; // FIX: peso real - ahora pica VARIAS veces perdiendo energía y termina rodando, no un solo pique y fade
  const groundY = y + 46;

  const start = performance.now();
  let last = start;
  const ballCore = ball.querySelector(".ball-core");
  const minY = -6; // nunca sube más arriba del borde visible del área

  function step(now) {
    const dt = Math.min((now - last) / 1000, 0.032);
    last = now;

    pvy += 1600 * dt; // gravedad (más floja que la del tiro: se ve "liviano" en el aire)
    px += pvx * dt;
    py += pvy * dt;
    pvx *= (1 - dt * 0.6); // fricción de aire mientras está en el aire

    if (py < minY) { py = minY; pvy = Math.abs(pvy) * 0.3; }

    if (py > groundY) {
      py = groundY;
      if (bounceCount < 3 && Math.abs(pvy) > 30) {
        // cada pique pierde más energía que el anterior (fricción real
        // contra el pasto) - dos o tres piques cada vez más chicos y
        // después rueda, no "desaparece" de golpe.
        pvy = -Math.abs(pvy) * (0.34 - bounceCount * 0.08);
        pvx *= 0.55;
        bounceCount++;
      } else {
        // se quedó sin salto: ahora rueda por el piso con fricción hasta frenar
        pvy = 0;
        pvx *= (1 - dt * 3.2);
      }
    }
    spin += pvx * dt * 0.5;

    const t = (now - start) / 1000;
    const scale = Math.max(0.48, 0.95 - t * 0.3);
    ball.style.transform = `translate(calc(-50% + ${px.toFixed(1)}px), ${py.toFixed(1)}px) scale(${scale.toFixed(2)})`;
    if (ballCore) ballCore.style.transform = `rotate(${spin.toFixed(0)}deg)`;

    if (t < 0.95 && (bounceCount < 3 || Math.abs(pvx) > 8)) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}


// Ahora el salto NO se elige por zona: apunta al punto real donde va a
// terminar la pelota (penaltyFinalLanding, ya calculado con la comba
// incluida cuando se pateó). Si le alcanza depende de la distancia real
// desde donde estaba parado y de cuánto tiempo de vuelo le quedaba -
// colisión/física de verdad, no un "adiviná la zona".
function attemptKeeperDive() {
  if (penaltyState !== "flight" || penaltyKeeperDiveUsed || !penaltyFinalLanding) return;
  penaltyKeeperDiveUsed = true;

  const keeper = document.getElementById("penaltyKeeper");
  const shadow = document.getElementById("penaltyKeeperShadow");
  const pitch = document.querySelector(".penalty-pitch");
  const goal = document.getElementById("penaltyGoal");
  const pitchRect = pitch.getBoundingClientRect();
  const goalRect = goal.getBoundingClientRect();
  const keeperRect = keeper.getBoundingClientRect();
  const fromX = keeperRect.left + keeperRect.width / 2 - pitchRect.left;
  const fromY = keeperRect.top + keeperRect.height / 2 - pitchRect.top;

  // Zona a la que el arquero ELIGIÓ tirarse (combo A/D + W sostenidos al
  // apretar Espacio) - mismo vocabulario que usa el pateador con flechas.
  const wantsUp = penaltyKeeperMoveKeys.up;
  const wantsLeft = penaltyKeeperMoveKeys.left;
  const wantsRight = penaltyKeeperMoveKeys.right;
  const chosenZone = wantsUp
    ? (wantsLeft ? "tl" : wantsRight ? "tr" : "tc")
    : (wantsLeft ? "bl" : wantsRight ? "br" : "bc");

  // Zona a la que fue REALMENTE la pelota (con la comba ya adentro).
  let actualZone = "bc", bestD = Infinity;
  Object.keys(PENALTY_ZONE_POS).forEach((z) => {
    const p = PENALTY_ZONE_POS[z];
    const zx = goalRect.left - pitchRect.left + goalRect.width * p.x;
    const zy = goalRect.top - pitchRect.top + goalRect.height * p.y;
    const d = Math.hypot(penaltyFinalLanding.x - zx, penaltyFinalLanding.y - zy);
    if (d < bestD) { bestD = d; actualZone = z; }
  });

  const guessedRight = chosenZone === actualZone;
  const guessedAdjacent = !guessedRight &&
    (chosenZone[0] === actualZone[0] || chosenZone.slice(1) === actualZone.slice(1));
  penaltyKeeperGuessedWrong = !guessedRight && !guessedAdjacent;

  // Si adivinó (bien o a medias) salta contra el punto real - el guante
  // llega exacto. Si se tiró para el lado que no era, salta contra SU
  // propia zona elegida: se tira para el lado incorrecto, como en la vida real.
  const jumpTarget = (guessedRight || guessedAdjacent)
    ? penaltyFinalLanding
    : {
        x: goalRect.left - pitchRect.left + goalRect.width * PENALTY_ZONE_POS[chosenZone].x,
        y: goalRect.top - pitchRect.top + goalRect.height * PENALTY_ZONE_POS[chosenZone].y,
      };

  const elapsedS = (performance.now() - penaltyFlightStartTime) / 1000;
  const timeLeftS = Math.max(0.03, penaltyFlightDurationMs / 1000 - elapsedS);
  const lateFrac = 1 - Math.min(1, timeLeftS / (penaltyFlightDurationMs / 1000 || 1));

  const dist = Math.hypot(jumpTarget.x - fromX, jumpTarget.y - fromY);
  const travelBudget = KEEPER_DIVE_TRAVEL_SPEED * Math.min(timeLeftS, KEEPER_DIVE_MAX_MS / 1000);
  const reach = KEEPER_STANDING_REACH + travelBudget;
  const stretch = dist > reach * 0.55;


  const madeIt = dist <= reach && (guessedRight || guessedAdjacent);

  penaltyKeeperSaveResult = madeIt;
  // Llegó, pero sobre la hora, o leyó solo a medias -> se ve como una
  // atajada sufrida (estirada) en vez de una limpia.
  penaltyKeeperStretch = madeIt && (stretch || lateFrac > 0.68 || !guessedRight);
  penaltyKeeperLateFrac = lateFrac;

  const dx = jumpTarget.x - fromX;
  const dy = jumpTarget.y - fromY;
  keeper.style.setProperty("--dive-x", `${dx.toFixed(1)}px`);
  keeper.style.setProperty("--dive-y", `${dy.toFixed(1)}px`);
  keeper.style.setProperty("--dive-rot", `${Math.max(-18, Math.min(18, dx * 0.12)).toFixed(1)}deg`);
  shadow.style.setProperty("--dive-x", `${dx.toFixed(1)}px`);
  shadow.style.setProperty("--dive-y", `${dy.toFixed(1)}px`);

  const dur = Math.max(160, Math.min(KEEPER_DIVE_MAX_MS, timeLeftS * 1000));
  keeper.style.animationDuration = `${Math.round(dur)}ms`;
  shadow.style.animationDuration = `${Math.round(dur)}ms`;

  keeper.classList.remove("keeper-urgent", "keeper-tic");
  keeper.classList.add("diving", stretch ? "diving-stretch" : "diving-clean");
  shadow.classList.add("diving");
}

// Reflejo sin tirarse: si la pelota real pasa muy cerca del cuerpo del
// arquero (remate seco al medio de su radio de alcance), la ataja sola -
// un arquero no necesita volar para un tiro que le sale directo.
function checkPassiveKeeperSave() {
  if (penaltyState !== "flight" || penaltyKeeperDiveUsed || !penaltyBallLiveRef) return;
  const elapsedFrac = (performance.now() - penaltyFlightStartTime) / (penaltyFlightDurationMs || 1);
  if (elapsedFrac < 0.78) return;
  const keeper = document.getElementById("penaltyKeeper");
  const pitch = document.querySelector(".penalty-pitch");
  const pitchRect = pitch.getBoundingClientRect();
  const keeperRect = keeper.getBoundingClientRect();
  const kx = keeperRect.left + keeperRect.width / 2 - pitchRect.left;
  const ky = keeperRect.top + keeperRect.height / 2 - pitchRect.top;
  const dist = Math.hypot(penaltyBallLiveRef.x - kx, penaltyBallLiveRef.y - ky);
  if (dist > KEEPER_STANDING_REACH) return;

  penaltyKeeperDiveUsed = true;
  penaltyKeeperSaveResult = true;
  penaltyKeeperStretch = false;
  penaltyKeeperLateFrac = 0.05;
  penaltyBallIntercepted = true;
  keeper.classList.add("keeper-reflex");
  busPlaySound("/static/audio/card-pickup.wav", 0.45);
  resolvePenaltyShot(penaltyKickZone, capturedPower, { x: penaltyBallLiveRef.x, y: penaltyBallLiveRef.y, vx: 0, vy: 0 });
}

// Loop de física del arquero: corre solo mientras hay una ronda viva y
// no se está tirando (la animación de dive maneja el transform sola en
// ese momento - así nunca compiten por la misma propiedad).
function keeperMovementTick(now) {
  const keeper = document.getElementById("penaltyKeeper");
  if (!keeper || !["aiming", "kicking", "flight"].includes(penaltyState)) {
    penaltyKeeperMoveRAF = null;
    return;
  }
  if (keeper.classList.contains("diving")) {
    penaltyLastKeeperMoveT = now;
    penaltyKeeperMoveRAF = requestAnimationFrame(keeperMovementTick);
    return;
  }
  const dt = Math.min((now - (penaltyLastKeeperMoveT || now)) / 1000, 0.032);
  penaltyLastKeeperMoveT = now;

  const dir = (penaltyKeeperMoveKeys.right ? 1 : 0) - (penaltyKeeperMoveKeys.left ? 1 : 0);
  if (dir !== 0) {
    penaltyKeeperVX += dir * KEEPER_MOVE_ACCEL * dt;
    penaltyKeeperVX = Math.max(-KEEPER_MOVE_MAXSPEED, Math.min(KEEPER_MOVE_MAXSPEED, penaltyKeeperVX));
  } else {
    penaltyKeeperVX *= Math.max(0, 1 - dt * 9);
  }
  penaltyKeeperStandX += penaltyKeeperVX * dt;
  penaltyKeeperStandX = Math.max(-penaltyKeeperBoundsPx, Math.min(penaltyKeeperBoundsPx, penaltyKeeperStandX));
  if (Math.abs(penaltyKeeperStandX) === penaltyKeeperBoundsPx) penaltyKeeperVX = 0;

  keeper.style.setProperty("--stand-x", `${penaltyKeeperStandX.toFixed(1)}px`);
  document.getElementById("penaltyKeeperShadow").style.setProperty("--stand-x", `${penaltyKeeperStandX.toFixed(1)}px`);
  keeper.classList.toggle("keeper-walking", Math.abs(penaltyKeeperVX) > 20);

  if (penaltyState === "flight") checkPassiveKeeperSave();

  penaltyKeeperMoveRAF = requestAnimationFrame(keeperMovementTick);
}

function scheduleKeeperIdleTic() {
  clearTimeout(penaltyIdleTimer);
  penaltyIdleTimer = setTimeout(() => {
    if (penaltyState !== "aiming") return;
    const keeper = document.getElementById("penaltyKeeper");
    // FIX: el tic ahora respeta --stand-x en el CSS, así no vuelve a
    // "teletransportarse" al centro si el arquero ya se movió con A/D.
    keeper.classList.remove("keeper-tic");
    void keeper.offsetWidth;
    keeper.classList.add("keeper-tic");
    scheduleKeeperIdleTic();
  }, 500 + Math.random() * 1400);
}

function showPenaltyStamp(text, kind) {
  const stamp = document.getElementById("penaltyStamp");
  if (!stamp) return;
  stamp.textContent = text;
  stamp.className = "penalty-stamp" + (kind ? " " + kind : "");
  void stamp.offsetWidth; // reinicia la animación si se dispara dos veces seguidas
  stamp.classList.add("show");
}

function flashCurveTouch() {
  const ball = document.getElementById("penaltyBall");
  if (!ball) return;
  ball.classList.remove("curve-touch");
  void ball.offsetWidth;
  ball.classList.add("curve-touch");
  busPlaySound("/static/audio/dash.wav", 0.25);
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
  if (penaltyKeeperKeyHandler) {
    window.removeEventListener("keydown", penaltyKeeperKeyHandler);
    penaltyKeeperKeyHandler = null;
  }
  if (penaltyKeeperKeyUpHandler) {
    window.removeEventListener("keyup", penaltyKeeperKeyUpHandler);
    penaltyKeeperKeyUpHandler = null;
  }
  if (penaltyFlightRAF) {
    cancelAnimationFrame(penaltyFlightRAF);
    penaltyFlightRAF = null;
  }
  if (penaltyKeeperMoveRAF) {
    cancelAnimationFrame(penaltyKeeperMoveRAF);
    penaltyKeeperMoveRAF = null;
  }
  if (penaltyIdleTimer) {
    clearTimeout(penaltyIdleTimer);
    penaltyIdleTimer = null;
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
  penaltyKeeperMoveKeys.left = false;
  penaltyKeeperMoveKeys.right = false;
  penaltyKeeperMoveKeys.up = false;
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
  ball.style.opacity = "";
  ball.classList.remove("spinning-ball", "curve-touch");

  penaltyCurveZone = null;
  penaltyCurveApplied = false;

  document.getElementById("penaltyPowerBar").style.width = "0%";
  const keeperEl = document.getElementById("penaltyKeeper");
  keeperEl.className = "keeper";
  keeperEl.style.animationDuration = "";
  const shadowEl = document.getElementById("penaltyKeeperShadow");
  shadowEl.className = "keeper-shadow"; // FIX: sin esto, desde la ronda 2 la sombra no reinicia su animación
  shadowEl.style.animationDuration = "";
  // FIX: --stand-x/--dive-x/y quedaban pegados de la ronda anterior porque
  // className solo resetea clases, no custom properties seteadas por JS.
  penaltyKeeperStandX = 0;
  penaltyKeeperVX = 0;
  penaltyKeeperDiveUsed = false;
  penaltyKeeperSaveResult = false;
  penaltyKeeperGuessedWrong = false;
  penaltyBallIntercepted = false;
  penaltyFinalLanding = null;
  penaltyBallLiveRef = null;
  ["--stand-x", "--dive-x", "--dive-y", "--dive-rot"].forEach((prop) => {
    keeperEl.style.setProperty(prop, prop === "--dive-rot" ? "0deg" : "0px");
    shadowEl.style.setProperty(prop, prop === "--dive-rot" ? "0deg" : "0px");
  });
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
  penaltyAimStartTime = performance.now();
  scheduleKeeperIdleTic();
  updateTurnBanner();

  // Cuánto puede caminar el arquero: hasta casi los palos, calculado
  // contra el ancho real del arco (responsive, no un número fijo).
  const goalRectNow = document.getElementById("penaltyGoal").getBoundingClientRect();
  const keeperRectNow = document.getElementById("penaltyKeeper").getBoundingClientRect();
  penaltyKeeperBoundsPx = Math.max(40, goalRectNow.width / 2 - keeperRectNow.width / 2 - 6);
  penaltyLastKeeperMoveT = performance.now();
  penaltyKeeperMoveRAF = requestAnimationFrame(keeperMovementTick);

  // Motor de la barra de potencia: se acelera cuanto más tiempo pasa
  // sin patear, para que clavar el punto justo sea un desafío de timing.
  let lastTime = performance.now();
  function animatePower(now) {
    if (penaltyState !== "aiming") return;
    const dt = now - lastTime;
    lastTime = now;
    const heldMs = now - penaltyAimStartTime;
    const speedFactor = 1 + Math.min(1.6, heldMs / 2600);

    currentPower += (powerDirection * 0.15 * speedFactor) * dt;
    if (currentPower >= 105) { currentPower = 105; powerDirection = -1; }
    if (currentPower <= 0) { currentPower = 0; powerDirection = 1; }

    document.getElementById("penaltyPowerBar").style.width = Math.min(currentPower, 100) + "%";
    penaltyPowerRAF = requestAnimationFrame(animatePower);
  }
  penaltyPowerRAF = requestAnimationFrame(animatePower);

  const doKick = (zone) => {
    capturedPower = currentPower;
    penaltyKickZone = zone;
    penaltyCurveApplied = false;
    const curveInfo = PENALTY_CURVE_BY_ZONE[zone] || { sign: 0, mag: 8 };
    penaltyCurveSign = curveInfo.sign;
    penaltyCurveMag = curveInfo.mag * (0.75 + Math.random() * 0.5); // variación entre tiros
    penaltyState = "kicking";
    clearTimeout(penaltyIdleTimer);
    document.getElementById("penaltyBall").classList.add("ball-waiting");
    document.getElementById("penaltyStatus").textContent = "¡Tocala de nuevo para cargarle más comba!";

    // Ventana de contacto: además del gesto de pateo, sirve como ventana
    // corta tipo parry para cargar más comba al mismo lado del tiro.
    penaltyReactTimer = setTimeout(() => {
      penaltyReactTimer = null;
      penaltyState = "flight";
      document.getElementById("penaltyBall").classList.remove("ball-waiting");
      busPlaySound("/static/audio/kickball.wav", 0.6);

      if (capturedPower > 95) {
        document.getElementById("penaltyStatus").textContent = "¡Se pasó de potencia!";
      } else if (capturedPower >= 85) {
        document.getElementById("penaltyStatus").textContent = "¡Fierrazo! Arquero, reaccioná...";
      } else {
        document.getElementById("penaltyStatus").textContent = "¡Va la pelota!";
      }

      launchPenaltyBall(penaltyKickZone, capturedPower);
      watchKeeperReaction();
    }, 260);
  };

  const penaltyHeldDirs = new Set();
  let penaltyComboTimer = null;

  const resolvePenaltyCombo = () => {
    penaltyComboTimer = null;
    const zone = penaltyZoneFromDirs(penaltyHeldDirs);
    penaltyHeldDirs.clear();
    if (!zone) return;

    if (penaltyState === "aiming") {
      doKick(zone);
    } else if (penaltyState === "kicking" && !penaltyCurveApplied) {
      // Toque de "cargar": mismo palo vecino de siempre, pero ahora suma
      // magnitud a la comba real en vez de teletransportar el rincón.
      if (zone === PENALTY_CURVE_REDIRECT[penaltyKickZone]) {
        penaltyCurveApplied = true;
        penaltyCurveMag *= 1.6;
        flashCurveTouch();
      }
    }
  };

  // Pateador: SOLO flechas.
  penaltyKeyHandler = (e) => {
    if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
    if (e.repeat) return;
    const dir = PENALTY_KEY_TO_DIR[e.key.toLowerCase()];
    if (!dir) return;
    if (penaltyState !== "aiming" && penaltyState !== "kicking") return;

    penaltyHeldDirs.add(dir);
    clearTimeout(penaltyComboTimer);
    penaltyComboTimer = setTimeout(resolvePenaltyCombo, PENALTY_COMBO_WINDOW_MS);
  };
  window.addEventListener("keydown", penaltyKeyHandler);

  // Arquero: SOLO A/D (moverse, siempre activo) + Espacio (tirarse, solo
  // durante el vuelo) - totalmente independiente del pateador.
  penaltyKeeperKeyHandler = (e) => {
    if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
    const key = e.key.toLowerCase();
    if (key === "a") { penaltyKeeperMoveKeys.left = true; return; }
    if (key === "d") { penaltyKeeperMoveKeys.right = true; return; }
    if (key === "w") { penaltyKeeperMoveKeys.up = true; return; }
    if (key === " ") {
      e.preventDefault();
      if (!e.repeat) attemptKeeperDive();
    }
  };
  penaltyKeeperKeyUpHandler = (e) => {
    const key = e.key.toLowerCase();
    if (key === "a") penaltyKeeperMoveKeys.left = false;
    if (key === "d") penaltyKeeperMoveKeys.right = false;
    if (key === "w") penaltyKeeperMoveKeys.up = false;
  };
  window.addEventListener("keydown", penaltyKeeperKeyHandler);
  window.addEventListener("keyup", penaltyKeeperKeyUpHandler);
}

// Ya no decide si la atajada cuenta (eso ahora es distancia/tiempo real
// en attemptKeeperDive) - queda como el cartel de presión de tiempo:
// cuánto le queda de vuelo a la pelota antes de llegar al arco.
function watchKeeperReaction() {
  function tick(now) {
    if (penaltyState !== "flight" || penaltyKeeperDiveUsed) {
      document.getElementById("penaltyReactionTimer").classList.remove("show");
      document.getElementById("penaltyKeeper").classList.remove("keeper-urgent");
      penaltyReactRAF = null;
      return;
    }
    const elapsed = now - penaltyFlightStartTime;
    const remaining = Math.max(0, penaltyFlightDurationMs - elapsed);
    const frac = remaining / penaltyFlightDurationMs;

    const timer = document.getElementById("penaltyReactionTimer");
    timer.classList.add("show");
    document.getElementById("penaltyReactionFill").style.transform = `scaleX(${Math.max(0, frac).toFixed(3)})`;
    document.getElementById("penaltyKeeper").classList.toggle("keeper-urgent", frac < 0.3 && frac > 0);

    if (remaining > 0) {
      penaltyReactRAF = requestAnimationFrame(tick);
    } else {
      penaltyReactRAF = null;
      document.getElementById("penaltyKeeper").classList.remove("keeper-urgent");
      timer.classList.remove("show");
    }
  }
  penaltyReactRAF = requestAnimationFrame(tick);
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
  const ballCore = ball.querySelector(".ball-core");
  const goal = document.getElementById("penaltyGoal");
  const pitch = document.querySelector(".penalty-pitch");
  const pitchRect = pitch.getBoundingClientRect();
  const goalRect = goal.getBoundingClientRect();
  const start = penaltyCenterOf(ball);
  penaltyBallStart = start; // FIX desaparición: se necesita para des-absolutizar el impacto al resolver

  let pos = { ...PENALTY_ZONE_POS[zone] };
  if (power > 95) pos.y = -0.5; // a la tribuna

  const target = {
    x: goalRect.left - pitchRect.left + goalRect.width * pos.x,
    y: goalRect.top - pitchRect.top + goalRect.height * pos.y,
  };

  const { duration } = penaltyShotTiming(power);
  const durS = duration / 1000;
  penaltyFlightDurationMs = duration;

  // Apunta DERECHO al target real desde el frame 1 - nada de señuelo ni
  // bamboleo falso. Lo que hace difícil leerlo temprano ahora es la comba
  // real de abajo, que recién se nota fuerte sobre el final del vuelo.
  const phys = { x: start.x, y: start.y, vx: 0, vy: 0 };
  function aimAt(dest, timeLeft) {
    phys.vx = (dest.x - phys.x) / timeLeft;
    phys.vy = ((dest.y - phys.y) - 0.5 * PENALTY_GRAVITY * timeLeft * timeLeft) / timeLeft;
  }
  aimAt(target, durS);

  // Comba real: crece en cúbica (casi nada al principio, fuerte al final) -
  // esto SÍ es lo que dificulta leerlo temprano, y es física de verdad,
  // no una trampa visual. penaltyCurveSign/Mag vienen de doKick.
  const curveSign = penaltyCurveSign;
  const curveMag = penaltyCurveMag;
  function curveOffsetAt(elapsedS) {
    const p = Math.min(1, elapsedS / durS);
    return curveSign * curveMag * p * p * p;
  }
  // Punto real donde termina (con la comba ya sumada) - el arquero se
  // tira contra ESTO cuando aprieta Espacio, no contra un rincón "de mentira".
  penaltyFinalLanding = { x: target.x + curveOffsetAt(durS), y: target.y };

  // Knuckleball cosmético: cada tiro vibra distinto (semilla random propia)
  // mientras vuela - hace más difícil leer el palo de entrada. Se
  // amortigua a 0 antes del 70% del vuelo, así el aterrizaje real (y por
  // lo tanto penaltyFinalLanding, lo que usa el arquero para su salto)
  // NUNCA cambia - la dificultad es de lectura, no un tiro trucho.
  const knuckleSeed = Math.random() * Math.PI * 2;
  const knuckleAmp = 9 + Math.random() * 12;
  const knuckleFreq = 7 + Math.random() * 4;

  const startTime = performance.now();
  penaltyFlightStartTime = startTime;
  let lastT = startTime;
  let trailAccum = 0;
  let spin = 0;
  penaltyBallIntercepted = false;

  function frame(now) {
    if (penaltyBallIntercepted) { penaltyFlightRAF = null; return; } // el arquero la atajó de reflejo antes de tiempo

    const dt = Math.min((now - lastT) / 1000, 0.032);
    lastT = now;
    const elapsedS = (now - startTime) / 1000;

    phys.vy += PENALTY_GRAVITY * dt;
    phys.x += phys.vx * dt;
    phys.y += phys.vy * dt;

    const curveNow = curveOffsetAt(elapsedS);
    const knuckleT = elapsedS / durS;
    const knuckleEnvelope = Math.max(0, 1 - knuckleT / 0.7);
    const knuckleNow = Math.sin(knuckleSeed + elapsedS * knuckleFreq) * knuckleAmp * knuckleEnvelope;
    const apparentDx = (phys.x - start.x) + curveNow + knuckleNow;
    const apparentDy = phys.y - start.y;
    penaltyBallLiveRef = { x: start.x + apparentDx, y: start.y + apparentDy };

    // Profundidad 3D: "pop" breve al salir del pie (como si pasara cerca
    // de cámara, primeros 8% del vuelo) y de ahí se achica en curva que
    // ACELERA hacia el final (ease-in: un objeto que se aleja de verdad
    // se ve chico cada vez más rápido, no en línea recta) - se siente
    // mucho más la distancia real que le falta para llegar al arco.
    const depthT = Math.min(1, elapsedS / durS);
    const popT = Math.min(1, elapsedS / (durS * 0.08));
    const pop = popT < 1 ? 1 + Math.sin(popT * Math.PI) * 0.1 : 1;
    const shrink = depthT * depthT;
    const scale = pop * (1 - shrink * 0.55);
      
    ball.style.transform =
      `translate(calc(-50% + ${apparentDx.toFixed(1)}px), ${apparentDy.toFixed(1)}px) scale(${scale.toFixed(2)})`;

    const speed = Math.hypot(phys.vx, phys.vy);
    spin += speed * dt * 0.6;
    ballCore.style.transform = `rotate(${(spin % 360).toFixed(0)}deg)`;

    trailAccum += dt;
    if (!prefersReducedMotion && trailAccum > 0.024) {
      trailAccum = 0;
      spawnBallTrail(ball, phys.vx, phys.vy);
    }

    if (elapsedS < durS) {
      penaltyFlightRAF = requestAnimationFrame(frame);
    } else {
      penaltyFlightRAF = null;
      resolvePenaltyShot(zone, power, { x: penaltyBallLiveRef.x, y: penaltyBallLiveRef.y, vx: phys.vx, vy: phys.vy });
    }
  }
  penaltyFlightRAF = requestAnimationFrame(frame);
}

function resolvePenaltyShot(kickZone, power, phys) {
  penaltyState = "done";
  teardownPenaltyRound();
  const goal = document.getElementById("penaltyGoal");
  const pitch = document.querySelector(".penalty-pitch");
  const ball = document.getElementById("penaltyBall");
  // impactX/Y son ABSOLUTOS (relativos a la cancha) - los usan spawnImpactBurst
  // / spawnNetBulge / el % de impacto en la red, que necesitan esas coordenadas.
  const impactX = phys ? phys.x : 0;
  const impactY = phys ? phys.y : 0;
  // FIX EL BUG DE LA DESAPARICIÓN: ballDeflectOff/ballSettleIntoNet/ballFlyOut
  // dibujan la pelota con un offset RELATIVO a su punto de arranque (así es
  // como la venía dibujando launchPenaltyBall todo el vuelo). Pasarles la
  // posición absoluta directamente hacía que la pelota saltara de golpe a
  // una posición gigante fuera de cuadro justo en el instante del impacto -
  // eso era la "desaparición". Acá se convierte a relativo antes de usarla
  // para DIBUJAR la pelota.
  const localImpactX = impactX - penaltyBallStart.x;
  const localImpactY = impactY - penaltyBallStart.y;
  let scored, flavor;

  const saved = penaltyKeeperSaveResult === true;
  penaltyKeeperTooSlow = !penaltyKeeperDiveUsed; // para el flavor text de abajo, nada más

  if (power > 95) {
    document.getElementById("penaltyStatus").textContent = "¡Afuera!";
    showPenaltyStamp("¡A LA TRIBUNA!", "stamp-out");
    ballFlyOut(ball, localImpactX, localImpactY, phys ? phys.vx : 0, phys ? phys.vy : -300);
    scored = false;
    flavor = "¡Se llenó de pelota y la mandó a la calle!";
  } else if (saved) {
    document.getElementById("penaltyStatus").textContent = "¡Atajada!";
    scored = false;
    if (penaltyKeeperStretch) {
      showPenaltyStamp("¡LA SACÓ COMO PUDO!", "stamp-save stamp-stretch");
      busPlaySound("/static/audio/dash.wav", 0.6);
      pitch.classList.add("shake");
      setTimeout(() => pitch.classList.remove("shake"), 350);
    } else if (penaltyKeeperLateFrac < 0.22) {
      showPenaltyStamp("¡LA LEYÓ ENTERA!", "stamp-save stamp-early");
      busPlaySound("/static/audio/card-pickup.wav", 0.55);
    } else {
      showPenaltyStamp("¡ATAJADA!", "stamp-save");
      busPlaySound("/static/audio/card-pickup.wav", 0.55);
    }
    spawnImpactBurst(impactX, impactY, "#f2efe6");
    ballDeflectOff(ball, localImpactX, localImpactY, kickZone, phys.vx, phys.vy);
    flavor = power >= 85
      ? "¡MANO DE DIOS! Le sacó un fierrazo tremendo del ángulo."
      : PENALTY_SAVE_FLAVORS[Math.floor(Math.random() * PENALTY_SAVE_FLAVORS.length)];
  } else {
    // El punto exacto de impacto, para que la red se hunda AHÍ y no de
    // forma pareja en todo el rectángulo (eso era lo que se veía plano).
    const goalRectNow = goal.getBoundingClientRect();
    const pitchRectNow = pitch.getBoundingClientRect();
    const impactXPct = Math.max(5, Math.min(95, ((impactX - (goalRectNow.left - pitchRectNow.left)) / goalRectNow.width) * 100));
    const impactYPct = Math.max(5, Math.min(95, ((impactY - (goalRectNow.top - pitchRectNow.top)) / goalRectNow.height) * 100));
    goal.style.setProperty("--impact-x", impactXPct.toFixed(1) + "%");
    goal.style.setProperty("--impact-y", impactYPct.toFixed(1) + "%");
    goal.classList.add("net-ripple");
    setTimeout(() => goal.classList.remove("net-ripple"), 450);
    spawnImpactBurst(impactX, impactY, "#f2efe6");
    spawnNetBulge(impactX, impactY);
    ballSettleIntoNet(ball, localImpactX, localImpactY);
    pitch.classList.add("shake");
    setTimeout(() => pitch.classList.remove("shake"), power >= 85 ? 350 : 220);

    if (power >= 85) {
      document.getElementById("penaltyStatus").textContent = "¡GOLAZO!";
      showPenaltyStamp("¡GOLAZO!", "stamp-goal");
      flavor = "¡Le rompió el arco! Fierrazo inatajable.";
    } else {
      document.getElementById("penaltyStatus").textContent = "¡GOL!";
      showPenaltyStamp("¡GOL!", "stamp-goal");
      flavor = penaltyKeeperTooSlow
        ? "¡Se quedó clavado, ni llegó a tirarse!"
        : penaltyKeeperGuessedWrong
          ? "¡Se tiró para el lado que no era!"
          : PENALTY_GOAL_FLAVORS[Math.floor(Math.random() * PENALTY_GOAL_FLAVORS.length)];
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
  banner.textContent = `Patea ${kickerName} — ataja ${keeperName}`;
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
      openChallengerNameModal(championName);
      return;
    }
    pendingChallengerName = challenger || "Retador";
    openDuelSelect();
  });

  document.getElementById("challengerNameInput").addEventListener("input", (e) => {
    updateChallengerPreview();
    e.target.classList.remove("challenger-input-bump");
    void e.target.offsetWidth;
    e.target.classList.add("challenger-input-bump");
    busPlaySound("/static/audio/key_typing.wav", 0.5);
  });
  document.getElementById("challengerNameInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); confirmChallengerName(); }
  });
  document.getElementById("challengerConfirmBtn").addEventListener("click", confirmChallengerName);
  document.getElementById("challengerCancelBtn").addEventListener("click", () => {
    document.getElementById("challengerNameModal").classList.add("hidden");
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
    leftTicketUsed: false,
    rightTicketUsed: false,
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
    const inside = card.value >= lo && card.value <= hi; // empate en el borde cuenta como "adentro"
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
  if (busState.currentGameNum < 2) {
    busState.ticketAvailableFor = null;
    return;
  }
  const leader = Math.max(busState.leftAmount, busState.rightAmount);
  const trailing = Math.min(busState.leftAmount, busState.rightAmount);
  if (leader <= 0) { busState.ticketAvailableFor = null; return; }
  const ratio = trailing / leader;
  if (ratio >= 0.5) { busState.ticketAvailableFor = null; return; } // remontó sin usarlo -> se le esfuma
  const trailingSide = busState.leftAmount < busState.rightAmount ? "left" : "right";
  const alreadyUsed = trailingSide === "left" ? busState.leftTicketUsed : busState.rightTicketUsed;
  busState.ticketAvailableFor = alreadyUsed ? null : trailingSide;
}

function useBusTicket(side) {
  const alreadyUsed = side === "left" ? busState.leftTicketUsed : busState.rightTicketUsed;
  if (alreadyUsed || busState.ticketAvailableFor !== side) return;
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
  if (side === "left") {
    busState.leftAmount = target;
    busState.leftTicketUsed = true;
  } else {
    busState.rightAmount = target;
    busState.rightTicketUsed = true;
  }
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
  if (k === GMB_KEYS_LEFT.kick) gmbReleaseKick("left");
  if (k === GMB_KEYS_RIGHT.kick) gmbReleaseKick("right");
}

/* Patear: tecla propia, sin cooldown - solo sirve si tenés la pelota en
   la Fase 1. Así queda libre para dribblar seguido, y el dash queda
   exclusivamente para el impulso/lunge de siempre. */
function gmbTryKick(side) {
  if (!gmb) return;

  if (gmb.phase === "dribble") {
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
    return;
  }

  if (gmb.phase === "shootout" && side === gmb.attackerSide) {
    const player = gmb[side];
    const ball = gmb.ball;
    if (gmb.shoot.charging) return; // ya está cargando, no reinicia la carga
    const closeEnough = Math.hypot(ball.x - player.x, ball.y - player.y) < player.r + ball.r + 6;
    if (!closeEnough) { playTick(); return; } // la pelota no está a tu alcance, no se re-patea en el aire
    const dir = side === "left" ? 1 : -1;
    const now = performance.now();
    gmb.shoot.charging = true;
    gmb.shoot.chargeStart = now;
    gmb.shoot.aimAngle = 0;
    gmb.shoot.aimX = dir; gmb.shoot.aimY = 0;
    gmb.shoot.aimHistory = [{ t: now, x: dir, y: 0 }];
    player.vx = 0; player.vy = 0;
  }
}

function gmbReleaseKick(side) {
  if (!gmb || gmb.phase !== "shootout" || side !== gmb.attackerSide) return;
  if (gmb.shoot.charging) gmbFireShot();
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

/* El dash es siempre el mismo impulso/lunge, para los dos jugadores, en
   cualquier fase (en Fase 2 el arquero lo usa para el amague lateral). El
   remate ahora vive 100% en la tecla de patear (gmbTryKick/gmbReleaseKick). */
function gmbTryAction(side) {
  if (!gmb || gmb.phase === "done" || gmb.phase === "transition") return;
  const player = gmb[side];
  const now = performance.now();
  if (now < player.dashReadyAt) { playTick(); return; } // sonido "seco" de cooldown
  gmbDash(side);
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
  kickBtn.addEventListener("touchstart", (e) => { e.preventDefault(); gmbTryKick(side); }, { passive: false });
  kickBtn.addEventListener("touchend", (e) => { e.preventDefault(); gmbReleaseKick(side); }, { passive: false });
}




/* ===================== Cabezones (Head Soccer) ===================== */

const HS_CANVAS_W = 900;
const HS_CANVAS_H = 420;
const HS_PITCH_Y = HS_CANVAS_H - 34;
const HS_GRAVITY = 1550;          // (antes 1700) un poco menos: más hangtime, más "arcade"
const HS_HEAD_R = 32;
const HS_HEAD_OFFSET = 50;
const HS_BALL_R = 14;
const HS_MOVE_ACCEL = 2400;
const HS_MAX_SPEED = 330;
const HS_FRICTION = 11;
const HS_JUMP_VY = -680;
const HS_GOAL_W = 44;
const HS_GOAL_H = 150;
const HS_WALL_RESTITUTION = 0.78;   // (antes 0.7) rebote de pared más vivo
const HS_GROUND_RESTITUTION = 0.66; // (antes 0.55) FIX "pelota pesada/aburrida": ahora pica de verdad
const HS_CEIL_RESTITUTION = 0.65;   // (antes 0.6)
const HS_AIR_DRAG = 0.991;          // roce de aire leve, ya no se siente que "rema" en el aire
const HS_BOOT_W = 60;               // (antes 42) FIX pedido: botín bastante más grande
const HS_BOOT_H = 28;               // (antes 20)
const HS_BOOT_VISUAL_SCALE = 1.55;  // escala del dibujo del botín (ver hsDrawPlayer)
const HS_LEG_LEN = 46;              // (antes 52) un poco más corto: con el botín agrandado, si no, queda flotando lejos del cuerpo
// FIX BUG PRINCIPAL: antes el péndulo iba de 1.7rad a -0.55rad, un arco tan
// grande que en el pateo a fondo el botín terminaba ARRIBA de la cabeza, con
// un rango exagerado que no se parece a ningún Head Soccer/Headball real.
// Ahora el arco es mucho más corto y SIEMPRE se queda a la altura de la
// cabeza para abajo: reposo colgando atrás-abajo, pateo a fondo bien
// adelante pero apenas por encima del nivel de la cabeza, nunca por arriba.
const HS_BOOT_REST_ANGLE = 1.98;  // reposo: colgando abajo y atrás (~113°, rad; 0 = derecha, PI/2 = abajo)
const HS_BOOT_MAX_ANGLE = 0.25;   // pateando a fondo: adelante, ~14° (nunca arriba de la cabeza)
const HS_LEG_RADIUS = 22;         // FIX "sin cuello": grosor de la pierna/cuerpo entre cabeza y botín - ver hsResolveCollisions
const HS_KICK_POWER = 760;        // (antes 640) patadas más contundentes
const HS_HEAD_POWER = 600;        // (antes 520) cabezazos más contundentes
const HS_GOALS_TO_WIN = 5;
const HS_TIME_SECONDS = 60;
const HS_MAX_BALL_SPEED = 1150;
const HS_PLAYER_PUSH = 40; // fuerza del empujón cuando dos jugadores chocan de verdad
const HS_BOOT_EXTEND_TIME = 0.3;       // (antes 0.34) un pelín más ágil
const HS_BOOT_RETRACT_TIME = 0.5;      // seg. para volver a reposo al soltar (de a poco, no de golpe)
const HS_BOOT_STRIKE_THRESHOLD = 0.4;  // a partir de acá el botín ya pega con potencia real
const HS_KICK_COOLDOWN = 260;
const HS_KICK_REACH = HS_BOOT_W * 0.9; // ya sale más grande solo porque HS_BOOT_W ahora es 60, no 42
const HS_PASSIVE_BOUNCE = 0.4;

let hsState = null;
let hsRAF = null;
let hsKeys = {};
let hsKeyDownHandler = null;
let hsKeyUpHandler = null;
let hsPendingTimeouts = [];
let hsSelectedMode = "goals";
let hsHeadImages = {};
let hsCanvas = null;
let hsCtx = null;
let hsShakeState = { time: 0, mag: 0 };
let hsPickState = { step: 1, leftHead: null };

const HS_DEFAULT_KEYS_LEFT  = { left: "a", right: "d", jump: "w", kick: "s" };
const HS_DEFAULT_KEYS_RIGHT = { left: "arrowleft", right: "arrowright", jump: "arrowup", kick: "arrowdown" };
const HS_KEYS_LEFT  = { ...HS_DEFAULT_KEYS_LEFT };
const HS_KEYS_RIGHT = { ...HS_DEFAULT_KEYS_RIGHT };

function hsLoadControls() {
  try {
    const saved = JSON.parse(localStorage.getItem("hsControls") || "null");
    if (saved && saved.left && saved.right) {
      Object.assign(HS_KEYS_LEFT, saved.left);
      Object.assign(HS_KEYS_RIGHT, saved.right);
    }
  } catch (e) { /* si falla localStorage, se queda con los defaults */ }
}
function hsSaveControls() {
  try { localStorage.setItem("hsControls", JSON.stringify({ left: HS_KEYS_LEFT, right: HS_KEYS_RIGHT })); }
  catch (e) {}
}
function hsResetControls() {
  Object.assign(HS_KEYS_LEFT, HS_DEFAULT_KEYS_LEFT);
  Object.assign(HS_KEYS_RIGHT, HS_DEFAULT_KEYS_RIGHT);
  hsSaveControls();
  hsBuildRemapUI();
  hsUpdateModeSelectHint();
}
function hsKeyDisplayName(k) {
  const NAMES = { arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→", " ": "Espacio", enter: "Enter", shift: "Shift" };
  return NAMES[k] || (k || "?").toUpperCase();
}

const HS_CONTROL_ACTIONS = [
  { key: "left", label: "Izquierda" },
  { key: "right", label: "Derecha" },
  { key: "jump", label: "Saltar" },
  { key: "kick", label: "Patear (mantener)" },
];

function hsBuildRemapUI() {
  const leftCol = document.getElementById("headRemapLeftCol");
  const rightCol = document.getElementById("headRemapRightCol");
  leftCol.innerHTML = "";
  rightCol.innerHTML = "";
  const { championName, challengerName } = hsNames();

  const buildSide = (col, side, title) => {
    const heading = document.createElement("span");
    heading.className = "controls-who";
    heading.textContent = title;
    col.appendChild(heading);
    HS_CONTROL_ACTIONS.forEach((action) => {
      const row = document.createElement("div");
      row.className = "key-row";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "key-badge gambeta-remap-btn"; // reusa el estilo que ya tenés
      const map = side === "left" ? HS_KEYS_LEFT : HS_KEYS_RIGHT;
      btn.textContent = hsKeyDisplayName(map[action.key]);
      btn.addEventListener("click", () => hsStartRebind(side, action.key, btn));
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

let hsRebindListener = null;
function hsStartRebind(side, actionKey, btn) {
  if (hsRebindListener) return;
  const original = btn.textContent;
  btn.textContent = "…";
  btn.classList.add("gambeta-remap-listening");
  hsRebindListener = (e) => {
    e.preventDefault();
    const k = e.key.toLowerCase();
    if (k !== "escape") {
      const map = side === "left" ? HS_KEYS_LEFT : HS_KEYS_RIGHT;
      map[actionKey] = k;
      hsSaveControls();
      btn.textContent = hsKeyDisplayName(k);
      hsUpdateModeSelectHint();
    } else {
      btn.textContent = original;
    }
    btn.classList.remove("gambeta-remap-listening");
    window.removeEventListener("keydown", hsRebindListener, true);
    hsRebindListener = null;
  };
  window.addEventListener("keydown", hsRebindListener, true);
}

function hsUpdateModeSelectHint() {
  const hint = document.querySelector("#headModeSelect .modal-body-text");
  if (!hint) return;
  hint.textContent =
    `Campeón: ${hsKeyDisplayName(HS_KEYS_LEFT.left)}/${hsKeyDisplayName(HS_KEYS_LEFT.right)} moverse, ` +
    `${hsKeyDisplayName(HS_KEYS_LEFT.jump)} saltar, ${hsKeyDisplayName(HS_KEYS_LEFT.kick)} patear (mantené para estirar el botín). ` +
    `Retador: ${hsKeyDisplayName(HS_KEYS_RIGHT.left)}/${hsKeyDisplayName(HS_KEYS_RIGHT.right)} moverse, ` +
    `${hsKeyDisplayName(HS_KEYS_RIGHT.jump)} saltar, ${hsKeyDisplayName(HS_KEYS_RIGHT.kick)} patear.`;
}

function hsSetTimeout(fn, ms) {
  const id = setTimeout(() => {
    hsPendingTimeouts = hsPendingTimeouts.filter((t) => t !== id);
    fn();
  }, ms);
  hsPendingTimeouts.push(id);
  return id;
}

function hsLoadHeadImages() {
  ["head1", "head2", "head3", "head4"].forEach((key) => {
    if (hsHeadImages[key]) return;
    const img = new Image();
    img.src = `/static/img/heads/${key}.png`;
    hsHeadImages[key] = img;
  });
}

// Resolución real del canvas ajustada a la densidad de píxeles de la pantalla,
// más suavizado de calidad alta al escalar las cabezas (320x320 -> ~74px).
// Esto es lo que realmente arregla la "mala calidad" — no era la imagen.
function hsSetupCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  hsCanvas.width = HS_CANVAS_W * dpr;
  hsCanvas.height = HS_CANVAS_H * dpr;
  hsCtx = hsCanvas.getContext("2d");
  hsCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  hsCtx.imageSmoothingEnabled = true;
  hsCtx.imageSmoothingQuality = "high";
}

function hsShowScreen(id) {
  ["headModeSelect", "headPick", "headPlay"].forEach((s) => {
    document.getElementById(s).classList.toggle("hidden", s !== id);
  });
}

function hsNames() {
  const championName = (currentWinnerGame && currentWinnerGame.added_by) || "Campeón";
  let challengerName = (pendingChallengerName || "").trim() || "Retador";
  if (challengerName.toLowerCase() === championName.toLowerCase()) {
    challengerName = `${challengerName} (Retador)`;
  }
  return { championName, challengerName };
}

function openHeadModal() {
  hsTeardown();
  hsLoadControls();
  document.getElementById("headModal").classList.remove("hidden");
  document.getElementById("headResultOverlay").classList.add("hidden");
  document.getElementById("headControlsScreen").classList.add("hidden");
  hsShowScreen("headModeSelect");
  hsUpdateModeSelectHint();
}

function hsMakePlayer(side, headKey, name) {
  return {
    side,
    name,
    headKey,
    x: side === "left" ? HS_CANVAS_W * 0.25 : HS_CANVAS_W * 0.75,
    y: HS_PITCH_Y,
    vx: 0,
    vy: 0,
    onGround: true,
    facing: side === "left" ? 1 : -1,
    score: 0,
    bootExtend: 0, // 0 = reposo (debajo de la cabeza), 1 = extendido del todo (adelante)
  };
}

/* --------- Selector de cabezón: 2 pasos, uno para cada jugador --------- */
function hsOpenPickScreen() {
  hsPickState = { step: 1, leftHead: null };
  hsRenderPickScreen();
  hsShowScreen("headPick");
}

function hsRenderPickScreen() {
  const { championName, challengerName } = hsNames();
  document.getElementById("headPickerName").textContent =
    hsPickState.step === 1 ? championName : challengerName;
  document.querySelectorAll("#headPick .fight-pick-card").forEach((card) => {
    const taken = hsPickState.step === 2 && card.dataset.head === hsPickState.leftHead;
    card.classList.toggle("hs-head-taken", taken);
    card.disabled = taken;
  });
}

function hsHandlePickClick(headKey) {
  if (hsPickState.step === 1) {
    hsPickState.leftHead = headKey;
    hsPickState.step = 2;
    hsRenderPickScreen();
    return;
  }
  hsStartMatch(hsPickState.leftHead, headKey);
}

function hsFormatTime(s) {
  const m = Math.floor(s / 60);
  const ss = Math.max(0, s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function hsStartMatch(leftHead, rightHead) {
  hsTeardown();
  const { championName, challengerName } = hsNames();
  hsShakeState = { time: 0, mag: 0 };

  hsState = {
    mode: hsSelectedMode,
    timeLeft: HS_TIME_SECONDS,
    suddenDeath: false,
    over: false,
    goalCooldown: false,
    ball: { x: HS_CANVAS_W / 2, y: HS_CANVAS_H / 2, vx: 0, vy: 0, spin: 0, squash: 0 },
    left: hsMakePlayer("left", leftHead, championName),
    right: hsMakePlayer("right", rightHead, challengerName),
    lastTime: performance.now(),
    timerInterval: null,
  };

  document.getElementById("headLeftName").textContent = championName;
  document.getElementById("headRightName").textContent = challengerName;
  document.getElementById("headLeftScore").textContent = "0";
  document.getElementById("headRightScore").textContent = "0";
  document.getElementById("headModeLabel").textContent = hsSelectedMode === "goals" ? "A 5 goles" : "Por tiempo";
  document.getElementById("headTimerLabel").textContent = hsSelectedMode === "goals" ? "🥅 5" : hsFormatTime(HS_TIME_SECONDS);
  document.getElementById("headHudCenter").classList.remove("hs-sudden-death");
  document.getElementById("headResultOverlay").classList.add("hidden");
  document.getElementById("headStatus").textContent = "";

  hsShowScreen("headPlay");
  hsCanvas = document.getElementById("headCanvas");
  hsSetupCanvas();
  hsAttachKeys();

  if (hsState.mode === "time") {
    hsState.timerInterval = setInterval(hsTimerTick, 1000);
  }

  hsState.lastTime = performance.now();
  hsRAF = requestAnimationFrame(hsLoop);
}

function hsAttachKeys() {
  hsKeyDownHandler = (e) => {
    if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    const bound = [
      HS_KEYS_LEFT.left, HS_KEYS_LEFT.right, HS_KEYS_LEFT.jump, HS_KEYS_LEFT.kick,
      HS_KEYS_RIGHT.left, HS_KEYS_RIGHT.right, HS_KEYS_RIGHT.jump, HS_KEYS_RIGHT.kick,
    ];
    if (bound.includes(k)) e.preventDefault();
    hsKeys[k] = true;
  };
  hsKeyUpHandler = (e) => { hsKeys[e.key.toLowerCase()] = false; };
  window.addEventListener("keydown", hsKeyDownHandler);
  window.addEventListener("keyup", hsKeyUpHandler);
}
function hsDetachKeys() {
  if (hsKeyDownHandler) window.removeEventListener("keydown", hsKeyDownHandler);
  if (hsKeyUpHandler) window.removeEventListener("keyup", hsKeyUpHandler);
  hsKeyDownHandler = null;
  hsKeyUpHandler = null;
  hsKeys = {};
}

function hsTimerTick() {
  if (!hsState || hsState.over) return;
  if (hsState.suddenDeath) return;
  hsState.timeLeft -= 1;
  document.getElementById("headTimerLabel").textContent = hsFormatTime(hsState.timeLeft);
  if (hsState.timeLeft <= 0) {
    if (hsState.left.score === hsState.right.score) {
      hsState.suddenDeath = true;
      document.getElementById("headTimerLabel").textContent = "MUERTE SÚBITA";
      document.getElementById("headHudCenter").classList.add("hs-sudden-death");
      document.getElementById("headStatus").textContent = "¡Empate! Ahora el próximo gol gana.";
    } else {
      hsEndMatch(hsState.left.score > hsState.right.score ? "left" : "right", "tiempo");
    }
  }
}

function hsLoop(now) {
  if (!hsState || hsState.over) { hsRAF = null; return; }
  const dt = Math.min((now - hsState.lastTime) / 1000, 0.032);
  hsState.lastTime = now;

  if (hsShakeState.time > 0) hsShakeState.time = Math.max(0, hsShakeState.time - dt);

  hsUpdatePlayer(hsState.left, dt, HS_KEYS_LEFT, now);
  hsUpdatePlayer(hsState.right, dt, HS_KEYS_RIGHT, now);
  hsResolvePlayers();

  // Sub-pasos de física de la pelota: a alta velocidad, un solo dt grande
  // puede mover la pelota más de lo que mide una cabeza/botín en un frame,
  // y el choque nunca se detecta (tunneling). Partimos el frame en pasos
  // más chicos según qué tan rápido va la pelota.
  const speed = Math.hypot(hsState.ball.vx, hsState.ball.vy);
  const steps = Math.min(6, Math.max(1, Math.ceil((speed * dt) / 10)));
  const subDt = dt / steps;
  for (let i = 0; i < steps; i++) {
    hsUpdateBall(subDt);
    hsResolveCollisions(now);
  }

  hsDraw();
  hsRAF = requestAnimationFrame(hsLoop);
}

function hsUpdatePlayer(p, dt, keys, now) {
  const dir = (hsKeys[keys.right] ? 1 : 0) - (hsKeys[keys.left] ? 1 : 0);
  if (dir !== 0) {
    p.vx += dir * HS_MOVE_ACCEL * dt;
    p.vx = Math.max(-HS_MAX_SPEED, Math.min(HS_MAX_SPEED, p.vx));
    p.facing = dir;
  } else {
    p.vx *= Math.max(0, 1 - dt * HS_FRICTION);
  }
  p.x += p.vx * dt;
  p.x = Math.max(HS_HEAD_R + 4, Math.min(HS_CANVAS_W - HS_HEAD_R - 4, p.x));

  if (hsKeys[keys.jump] && p.onGround) {
    p.vy = HS_JUMP_VY;
    p.onGround = false;
  }
  p.vy += HS_GRAVITY * dt;
  p.y += p.vy * dt;
  if (p.y >= HS_PITCH_Y) {
    p.y = HS_PITCH_Y;
    p.vy = 0;
    p.onGround = true;
  }
  // Botín analógico: mientras mantenés la tecla, avanza de a poco desde
  // debajo de la cabeza hasta adelante; al soltar, vuelve solo y también
  // de a poco (nada de swing automático de una sola vez).
  if (hsKeys[keys.kick]) {
    p.bootExtend = Math.min(1, p.bootExtend + dt / HS_BOOT_EXTEND_TIME);
  } else {
    p.bootExtend = Math.max(0, p.bootExtend - dt / HS_BOOT_RETRACT_TIME);
  }
}



// Posición real del botín, ahora analógica según cuánto mantengas la tecla
// (0 = reposo debajo de la cabeza, 1 = extendido bien adelante). La usan
// tanto la colisión como el dibujo, así el hitbox y lo que se ve SIEMPRE coinciden.
// Ángulo local del botín asumiendo que el jugador mira a la derecha (facing=1).
// REST -> MAX según cuánto mantengas la tecla, más un "arrastre" al correr
// (si vas para adelante el botín se atrasa un toque, si vas para atrás se
// adelanta un toque — como una zancada real).
function hsBootLocalAngle(p) {
  const base = HS_BOOT_REST_ANGLE + (HS_BOOT_MAX_ANGLE - HS_BOOT_REST_ANGLE) * p.bootExtend;
  const moveT = Math.max(-1, Math.min(1, (p.vx * p.facing) / HS_MAX_SPEED));
  const drag = moveT * 0.22 * (1 - p.bootExtend); // se apaga solo cuando ya estás pateando a fondo
  return base + drag;
}

// El botín ORBITA la cabeza con radio fijo (péndulo real, no una línea recta).
// Si mira a la izquierda, se espeja el ángulo con (PI - ángulo) — mismo truco
// que espeja x,y sin tener que duplicar la matemática para cada lado.
function hsBootPose(p) {
  const headCX = p.x;
  const headCY = p.y - HS_HEAD_OFFSET;
  const local = hsBootLocalAngle(p);
  const angle = p.facing === 1 ? local : Math.PI - local;
  return {
    x: headCX + Math.cos(angle) * HS_LEG_LEN,
    y: headCY + Math.sin(angle) * HS_LEG_LEN,
    angle,
    isStrike: p.bootExtend > HS_BOOT_STRIKE_THRESHOLD,
    extend: p.bootExtend,
  };
}

function hsClampBallVelocity(b) {
  if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) {
    // FIX crash: si algo dio un valor inválido (NaN/Infinity), reseteamos la pelota al centro en vez de romper el canvas
    b.x = HS_CANVAS_W / 2; b.y = HS_CANVAS_H / 2; b.vx = 0; b.vy = 0; b.squash = 0;
    return;
  }
  const speed = Math.hypot(b.vx, b.vy);
  if (speed > HS_MAX_BALL_SPEED) {
    const k = HS_MAX_BALL_SPEED / speed;
    b.vx *= k; b.vy *= k;
  }
}

function hsUpdateBall(dt) {
  const b = hsState.ball;
  b.vy += HS_GRAVITY * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.vx *= HS_AIR_DRAG;
  b.spin += b.vx * dt * 0.05;

  // NUEVO: "juice" de squash & stretch - cada rebote fuerte deja la pelota
  // marcada con un valor 0-1 que se ve en hsDrawBall como un achatado breve
  // (como una pelota real de verdad al pegar contra algo duro) y decae solo.
  if (b.squash) b.squash = Math.max(0, b.squash - dt * 4.2);

  if (b.y - HS_BALL_R < 0) {
    b.y = HS_BALL_R;
    b.vy = Math.abs(b.vy) * HS_CEIL_RESTITUTION;
    b.squash = Math.min(1, Math.abs(b.vy) / 700);
  }

  const inGoalMouth = b.y > HS_PITCH_Y - HS_GOAL_H;

  // Pica según la velocidad real con la que venía cayendo - restitución
  // de verdad, no una animación fija con un rebote siempre igual. Ahora
  // más viva (HS_GROUND_RESTITUTION subido) para que se sienta dinámica,
  // no "pesada" como reportaste.
  if (b.y + HS_BALL_R > HS_PITCH_Y) {
    b.y = HS_PITCH_Y - HS_BALL_R;
    if (Math.abs(b.vy) > 40) {
      b.squash = Math.min(1, Math.abs(b.vy) / 650);
      b.vy = -Math.abs(b.vy) * HS_GROUND_RESTITUTION;
      b.vx *= 0.85;
    } else {
      b.vy = 0;
      b.vx *= 0.98; // rozamiento leve rodando por el piso
    }
  }

  if (b.x - HS_BALL_R < HS_GOAL_W && !inGoalMouth) {
    b.x = HS_GOAL_W + HS_BALL_R;
    b.vx = Math.abs(b.vx) * HS_WALL_RESTITUTION;
    b.squash = Math.min(1, Math.abs(b.vx) / 700);
  }
  if (b.x + HS_BALL_R > HS_CANVAS_W - HS_GOAL_W && !inGoalMouth) {
    b.x = HS_CANVAS_W - HS_GOAL_W - HS_BALL_R;
    b.vx = -Math.abs(b.vx) * HS_WALL_RESTITUTION;
    b.squash = Math.min(1, Math.abs(b.vx) / 700);
  }

  hsClampBallVelocity(b);
}

// Punto más cercano de un segmento A-B a un punto P. Lo usa la colisión de
// "pierna" de abajo: como los cabezones no tienen cuello, el hueco entre la
// cabeza y el botín necesita su propia colisión (una cápsula), si no la
// pelota se cuela por ahí — ver el comentario en hsResolveCollisions.
function hsClosestPointOnSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const lenSq = abx * abx + aby * aby || 0.0001;
  let t = ((px - ax) * abx + (py - ay) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + abx * t, y: ay + aby * t };
}

function hsResolveCollisions(now) {
  const b = hsState.ball;
  // Acumulamos impulsos en vez de pisarlos: si los DOS jugadores tocan la
  // pelota en el mismo paso (un 50/50 real), se promedian en vez de que
  // el segundo jugador borre lo que hizo el primero (eso era parte del bug).
  let vxSum = 0, vySum = 0, hits = 0;

  [hsState.left, hsState.right].forEach((p) => {
    // Cabeza: círculo contra círculo, con empuje extra hacia arriba (cabezazo real).
    const headCX = p.x;
    const headCY = p.y - HS_HEAD_OFFSET;
    const dx = b.x - headCX;
    const dy = b.y - headCY;
    const dist = Math.hypot(dx, dy) || 0.001;
    const minDist = HS_HEAD_R + HS_BALL_R;
    if (dist < minDist) {
      const nx = dx / dist, ny = dy / dist;
      b.x = headCX + nx * minDist;
      b.y = headCY + ny * minDist;
      const speedIn = Math.hypot(b.vx, b.vy);
      const power = Math.max(HS_HEAD_POWER, Math.min(speedIn * 1.1, HS_HEAD_POWER * 1.6));
      vxSum += nx * power + p.vx * 0.5;
      vySum += ny * power - 60;
      hits++;
      if (!p.headCoolUntil || now > p.headCoolUntil) {
        p.headCoolUntil = now + 180;
      }
    }

    // Botín: ahora es un péndulo, así que el hitbox es un círculo alrededor
    // de su posición actual (bootPose.x/y) — no un rectángulo fijo, porque
    // el botín ya no se mueve en línea recta.
    const bootPose = hsBootPose(p);
    const reach = bootPose.isStrike ? HS_KICK_REACH : HS_BOOT_W * 0.5;
    const bdx = b.x - bootPose.x, bdy = b.y - bootPose.y;
    const bdist = Math.hypot(bdx, bdy) || 0.001;
    const minBootDist = reach + HS_BALL_R * 0.7;
    if (bdist < minBootDist) {
      const nx = bdx / bdist, ny = bdy / bdist;
      b.x = bootPose.x + nx * minBootDist;
      b.y = bootPose.y + ny * minBootDist;
      if (bootPose.isStrike) {
        const kickT = Math.max(0, Math.min(1,
          (bootPose.extend - HS_BOOT_STRIKE_THRESHOLD) / (1 - HS_BOOT_STRIKE_THRESHOLD)));
        const power = HS_KICK_POWER * (0.75 + 0.45 * kickT);
        vxSum += p.facing * power + p.vx * 0.4;
        vySum += -260 - 60 * kickT + ny * 120;
        hits++;
        if (!p.bootCoolUntil || now > p.bootCoolUntil) {
          p.bootCoolUntil = now + HS_KICK_COOLDOWN;
          busPlaySound("/static/audio/kickball.wav", 0.6);
        }
      } else {
        const speedIn = Math.hypot(b.vx, b.vy);
        vxSum += nx * speedIn * HS_PASSIVE_BOUNCE + p.vx * 0.2;
        vySum += ny * Math.abs(b.vy) * HS_PASSIVE_BOUNCE - 40;
        hits++;
      }
    }

    // FIX BUG REPORTADO: "un jugador patea y le pasa por abajo de la cabeza
    // al otro, atravesándolo". Antes SOLO había dos círculos de colisión
    // (cabeza y botín) — el tramo entre ambos (la "pierna", que hace de
    // cuello ya que el cabezón no tiene uno) no frenaba nada. Un tiro raso
    // que pasara entre la cabeza (arriba) y el botín recogido (abajo) se
    // colaba de largo. Ahora la pierna es una cápsula (segmento + radio)
    // que también choca con la pelota, así el cuerpo entero — cabeza,
    // pierna y botín — cubre un área continua, sin huecos.
    const legNear = hsClosestPointOnSegment(b.x, b.y, headCX, headCY, bootPose.x, bootPose.y);
    const ldx = b.x - legNear.x, ldy = b.y - legNear.y;
    const ldist = Math.hypot(ldx, ldy) || 0.001;
    const legMinDist = HS_LEG_RADIUS + HS_BALL_R;
    if (ldist < legMinDist) {
      const nx = ldx / ldist, ny = ldy / ldist;
      b.x = legNear.x + nx * legMinDist;
      b.y = legNear.y + ny * legMinDist;
      const speedIn = Math.hypot(b.vx, b.vy);
      vxSum += nx * speedIn * HS_PASSIVE_BOUNCE + p.vx * 0.2;
      vySum += ny * Math.abs(b.vy) * HS_PASSIVE_BOUNCE - 30;
      hits++;
    }
  });

  if (hits > 0) {
    b.vx = vxSum / hits;
    b.vy = vySum / hits;
    hsClampBallVelocity(b);
  }

  hsCheckGoal();
}


// Los jugadores ahora son sólidos entre sí: si sus cabezas se acercan
// demasiado, se separan a mitad y mitad + un empujoncito de velocidad,
// como un choque de verdad. De paso esto arregla que el botín de uno
// quedara visualmente "encajado" en el cuello del otro cuando se pisaban.
function hsResolvePlayers() {
  const a = hsState.left, b = hsState.right;
  const aCY = a.y - HS_HEAD_OFFSET, bCY = b.y - HS_HEAD_OFFSET;
  const dx = b.x - a.x;
  const dy = bCY - aCY;
  const dist = Math.hypot(dx, dy) || 0.001;
  const minDist = HS_HEAD_R * 2 + 6;
  if (dist < minDist) {
    const nx = dx / dist;
    const overlap = minDist - dist;
    a.x -= nx * overlap * 0.5;
    b.x += nx * overlap * 0.5;
    a.vx -= nx * HS_PLAYER_PUSH;
    b.vx += nx * HS_PLAYER_PUSH;
    a.x = Math.max(HS_HEAD_R + 4, Math.min(HS_CANVAS_W - HS_HEAD_R - 4, a.x));
    b.x = Math.max(HS_HEAD_R + 4, Math.min(HS_CANVAS_W - HS_HEAD_R - 4, b.x));
  }

  // NUEVO: antes solo se chequeaba cabeza-contra-cabeza, así que el botín
  // de uno SÍ podía meterse dentro de la cabeza del otro al disputar la
  // pelota (se veía cómo se "pisaban"). Ahora el botín también empuja si
  // invade el círculo de la cabeza rival.
  [[a, b], [b, a]].forEach(([owner, rival]) => {
    const rivalCY = rival.y - HS_HEAD_OFFSET;
    const bp = hsBootPose(owner);
    const bdx = bp.x - rival.x, bdy = bp.y - rivalCY;
    const bdist = Math.hypot(bdx, bdy) || 0.001;
    const minBd = HS_HEAD_R + HS_LEG_RADIUS;
    if (bdist < minBd) {
      const nx = bdx / bdist;
      const push = (minBd - bdist) * 0.5;
      rival.x -= nx * push;
      owner.x += nx * push;
      rival.x = Math.max(HS_HEAD_R + 4, Math.min(HS_CANVAS_W - HS_HEAD_R - 4, rival.x));
      owner.x = Math.max(HS_HEAD_R + 4, Math.min(HS_CANVAS_W - HS_HEAD_R - 4, owner.x));
    }
  });
}



function hsCheckGoal() {
  const b = hsState.ball;
  if (hsState.goalCooldown) return;
  const inGoalMouth = b.y > HS_PITCH_Y - HS_GOAL_H;
  if (!inGoalMouth) return;
  if (b.x - HS_BALL_R < HS_GOAL_W * 0.4) {
    hsScoreGoal("right");
  } else if (b.x + HS_BALL_R > HS_CANVAS_W - HS_GOAL_W * 0.4) {
    hsScoreGoal("left");
  }
}

function hsTriggerShake(mag) {
  hsShakeState = { time: 0.28, mag };
}

function hsScoreGoal(scorerSide) {
  const scorer = hsState[scorerSide];
  scorer.score += 1;
  document.getElementById(scorerSide === "left" ? "headLeftScore" : "headRightScore").textContent = scorer.score;
  hsState.goalCooldown = true;
  hsState.ball.vx = 0;
  hsState.ball.vy = 0;

  const flash = document.getElementById("headGoalFlash");
  flash.classList.remove("pop");
  void flash.offsetWidth;
  flash.classList.add("pop");
  hsTriggerShake(14);
  playFanfare();

  if (hsState.suddenDeath) {
    hsEndMatch(scorerSide, "muerte súbita");
    return;
  }
  if (hsState.mode === "goals" && scorer.score >= HS_GOALS_TO_WIN) {
    hsEndMatch(scorerSide, "goles");
    return;
  }

  hsSetTimeout(() => {
    hsResetPositions();
    hsState.goalCooldown = false;
  }, 900);
}

function hsResetPositions() {
  hsState.ball.x = HS_CANVAS_W / 2;
  hsState.ball.y = HS_CANVAS_H / 2;
  hsState.ball.vx = 0;
  hsState.ball.vy = 0;
  hsState.ball.squash = 0;
  hsState.left.x = HS_CANVAS_W * 0.25;
  hsState.left.y = HS_PITCH_Y;
  hsState.left.vx = 0; hsState.left.vy = 0; hsState.left.onGround = true;
  hsState.right.x = HS_CANVAS_W * 0.75;
  hsState.right.y = HS_PITCH_Y;
  hsState.right.vx = 0; hsState.right.vy = 0; hsState.right.onGround = true;
}

function hsDrawHeadImage(key, cx, cy, facing) {
  const img = hsHeadImages[key];
  if (!img || !img.complete || !img.naturalWidth) return false;
  const size = HS_HEAD_R * 2.3;
  hsCtx.save();
  hsCtx.translate(cx, cy);
  if (facing < 0) hsCtx.scale(-1, 1); // el sprite mira a la derecha por defecto; si mira a la izquierda, lo espejamos
  hsCtx.drawImage(img, -size / 2, -size / 2, size, size);
  hsCtx.restore();
  return true;
}

function hsDrawField() {
  const ctx = hsCtx;
  ctx.clearRect(0, 0, HS_CANVAS_W, HS_CANVAS_H);

  // Cielo nocturno de estadio
  const sky = ctx.createLinearGradient(0, 0, 0, HS_PITCH_Y);
  sky.addColorStop(0, "#08101a");
  sky.addColorStop(1, "#1a253a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, HS_CANVAS_W, HS_PITCH_Y);

  // Focos de luz 3D (Haces cruzados con modo de fusión screen)
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const light1 = ctx.createLinearGradient(HS_CANVAS_W * 0.2, 0, HS_CANVAS_W * 0.4, HS_PITCH_Y);
  light1.addColorStop(0, "rgba(255, 255, 255, 0.12)"); light1.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = light1; 
  ctx.beginPath(); ctx.moveTo(HS_CANVAS_W * 0.1, 0); ctx.lineTo(HS_CANVAS_W * 0.3, 0); ctx.lineTo(HS_CANVAS_W * 0.6, HS_PITCH_Y); ctx.lineTo(HS_CANVAS_W * 0.1, HS_PITCH_Y); ctx.fill();

  const light2 = ctx.createLinearGradient(HS_CANVAS_W * 0.8, 0, HS_CANVAS_W * 0.6, HS_PITCH_Y);
  light2.addColorStop(0, "rgba(255, 255, 255, 0.12)"); light2.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = light2; 
  ctx.beginPath(); ctx.moveTo(HS_CANVAS_W * 0.7, 0); ctx.lineTo(HS_CANVAS_W * 0.9, 0); ctx.lineTo(HS_CANVAS_W * 0.9, HS_PITCH_Y); ctx.lineTo(HS_CANVAS_W * 0.4, HS_PITCH_Y); ctx.fill();
  ctx.restore();

  // Tribunas (Público de fondo)
  ctx.fillStyle = "#111824";
  ctx.fillRect(0, HS_PITCH_Y - 100, HS_CANVAS_W, 100);
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 2;
  for(let i=0; i<4; i++) {
     let ty = HS_PITCH_Y - 100 + i*25;
     ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(HS_CANVAS_W, ty); ctx.stroke();
  }
  
  // Puntitos simulando flashes de cámaras y público
  ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
  for(let i=0; i<120; i++) { ctx.fillRect(Math.random() * HS_CANVAS_W, HS_PITCH_Y - 100 + Math.random() * 90, 2.5, 2.5); }
  ctx.fillStyle = "rgba(255, 62, 127, 0.3)";
  for(let i=0; i<40; i++) { ctx.fillRect(Math.random() * HS_CANVAS_W, HS_PITCH_Y - 100 + Math.random() * 90, 3, 3); }

  // Carteles LED
  ctx.fillStyle = "#000";
  ctx.fillRect(0, HS_PITCH_Y - 18, HS_CANVAS_W, 18);
  ctx.fillStyle = "#f5cd76";
  ctx.font = "bold 12px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  for(let i=0; i<8; i++) { ctx.fillText("RULETA JUEGOS", i*140 + 70, HS_PITCH_Y - 5); }

  // Pasto 3D vibrante
  const stripeW = 60;
  let stripeI = 0;
  for (let x = 0; x < HS_CANVAS_W; x += stripeW) {
    ctx.fillStyle = stripeI % 2 === 0 ? "#338c3e" : "#2a7833";
    ctx.fillRect(x, HS_PITCH_Y, stripeW, HS_CANVAS_H - HS_PITCH_Y);
    stripeI++;
  }
  const grassShade = ctx.createLinearGradient(0, HS_PITCH_Y, 0, HS_CANVAS_H);
  grassShade.addColorStop(0, "rgba(0,0,0,0.1)");
  grassShade.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.fillStyle = grassShade;
  ctx.fillRect(0, HS_PITCH_Y, HS_CANVAS_W, HS_CANVAS_H - HS_PITCH_Y);

  // Línea y círculo central
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(HS_CANVAS_W / 2, HS_PITCH_Y); ctx.lineTo(HS_CANVAS_W / 2, HS_CANVAS_H); ctx.stroke();
  ctx.beginPath(); ctx.arc(HS_CANVAS_W / 2, HS_CANVAS_H - 4, 60, Math.PI, 0); ctx.stroke();

  // Arcos con interior negro
  const goalDepth = 20;
  [0, HS_CANVAS_W - HS_GOAL_W].forEach((gx, i) => {
    const isLeft = i === 0;
    const topY = HS_PITCH_Y - HS_GOAL_H;
    const innerX = isLeft ? gx + HS_GOAL_W - goalDepth : gx + goalDepth;

    ctx.fillStyle = "rgba(10,12,18,0.7)";
    ctx.beginPath();
    ctx.moveTo(gx + (isLeft ? 0 : HS_GOAL_W), topY);
    ctx.lineTo(innerX, topY + goalDepth * 0.6);
    ctx.lineTo(innerX, HS_PITCH_Y - goalDepth * 0.3);
    ctx.lineTo(gx + (isLeft ? 0 : HS_GOAL_W), HS_PITCH_Y);
    ctx.closePath(); ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    for (let ny = topY + 12; ny < HS_PITCH_Y; ny += 14) { ctx.beginPath(); ctx.moveTo(gx + 2, ny); ctx.lineTo(gx + HS_GOAL_W - 2, ny); ctx.stroke(); }
    for (let nx = gx + 8; nx < gx + HS_GOAL_W; nx += 14) { ctx.beginPath(); ctx.moveTo(nx, topY + 2); ctx.lineTo(nx, HS_PITCH_Y - 2); ctx.stroke(); }

    ctx.strokeStyle = "#fdfdfd";
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.strokeRect(gx + (isLeft ? 3 : 0), topY, HS_GOAL_W - 3, HS_GOAL_H);
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(gx + (isLeft ? 5 : 2), topY + 2); ctx.lineTo(gx + (isLeft ? 5 : 2), HS_PITCH_Y - 2); ctx.stroke();
  });
}

function hsDrawGoalFronts() {
  const ctx = hsCtx;
  [0, HS_CANVAS_W - HS_GOAL_W].forEach((gx) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(gx, HS_PITCH_Y - HS_GOAL_H, HS_GOAL_W, HS_GOAL_H);
    ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1.5;
    for (let ny = HS_PITCH_Y - HS_GOAL_H + 6; ny < HS_PITCH_Y; ny += 18) {
      ctx.beginPath(); ctx.moveTo(gx - 4, ny); ctx.lineTo(gx + HS_GOAL_W + 4, ny); ctx.stroke();
    }
    for (let nx = gx - 4; nx < gx + HS_GOAL_W + 4; nx += 18) {
      ctx.beginPath(); ctx.moveTo(nx, HS_PITCH_Y - HS_GOAL_H); ctx.lineTo(nx, HS_PITCH_Y); ctx.stroke();
    }
    ctx.restore();
  });
}

function hsDrawPlayer(p) {
  const ctx = hsCtx;
  const headCX = p.x;
  const headCY = p.y - HS_HEAD_OFFSET;
  const color = p.side === "left" ? "#f5cd76" : "#2f8fb0";
  const dark = p.side === "left" ? "#b98f3f" : "#1c5f77";
  const jumpT = Math.max(0, Math.min(1, (HS_PITCH_Y - p.y) / 140));

  ctx.save();
  ctx.globalAlpha = 0.35 - jumpT * 0.18;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(p.x, HS_PITCH_Y + 2, 26 - jumpT * 8, 7 - jumpT * 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Pierna: une la cabeza con el botín SIGUIENDO EL MISMO PÉNDULO (mismo
  // ángulo/radio que hsBootPose) — por eso ya no se ve la cabeza flotando,
  // están conectadas de verdad en cada frame, se doble en el mismo arco.
  const bootPose = hsBootPose(p);
  ctx.strokeStyle = dark;
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(headCX, headCY + HS_HEAD_R * 0.7);
  ctx.lineTo(bootPose.x, bootPose.y);
  ctx.stroke();

  ctx.save();
  ctx.translate(bootPose.x, bootPose.y);
  // FIX BUG: acá estaba el "botín mal hecho" que reportaste — antes se
  // armaba con ctx.rotate(p.facing * ángulo) MÁS un puñado de ternarios
  // (p.facing===1 ? 15 : 9, etc.) tratando de espejar el dibujo a mano.
  // Esos números NO eran el espejo matemático real del lado derecho, así
  // que mirando para un lado el botín salía chico y para el otro grande.
  // Ahora se espeja con un solo scale(-1,1): el dibujo de abajo asume
  // SIEMPRE "mirando a la derecha" y el espejo lo hace el canvas — los dos
  // lados quedan geométricamente idénticos, sin importar hacia dónde mires.
  ctx.scale(p.facing, 1);
  ctx.rotate(bootPose.extend * 0.5 - 0.12);
  // Botín agrandado (a pedido) - tapa mucho mejor la parte baja del cabezón.
  ctx.scale(HS_BOOT_VISUAL_SCALE, HS_BOOT_VISUAL_SCALE);

  // Media/cuff — conecta visualmente con la pierna, para que no parezca
  // una forma suelta flotando.
  ctx.fillStyle = dark;
  ctx.fillRect(-6, -9, 12, 8);
  // Botín: cuña con taco redondeado atrás y punta hacia adelante (+x).
  ctx.fillStyle = "#efe9dd";
  ctx.beginPath();
  ctx.moveTo(-9, -2);
  ctx.quadraticCurveTo(-12, 7, -6, 9);
  ctx.lineTo(15, 9);
  ctx.quadraticCurveTo(19, 3, 13, -6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#2a2530";
  ctx.lineWidth = 1.4 / HS_BOOT_VISUAL_SCALE;
  ctx.stroke();
  // Suela + franja con el color del equipo (para diferenciarlos de un vistazo)
  ctx.fillStyle = "#2a2530";
  ctx.fillRect(-9, 6, 24, 3);
  ctx.fillStyle = color;
  ctx.fillRect(-7, -1, 8, 3);
  ctx.restore();

  if (bootPose.isStrike) {
    ctx.save();
    ctx.globalAlpha = 0.35 * bootPose.extend;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bootPose.x + p.facing * 8, bootPose.y, 10 + bootPose.extend * 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(headCX, headCY + HS_HEAD_R * 0.75, HS_HEAD_R * 0.6, HS_HEAD_R * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const drawn = hsDrawHeadImage(p.headKey, headCX, headCY, p.facing);
  if (!drawn) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(headCX, headCY, HS_HEAD_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = dark;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

}

function hsDrawBall() {
  const ctx = hsCtx;
  const b = hsState.ball;

  const heightT = Math.max(0, Math.min(1, (HS_PITCH_Y - b.y) / 220));
  ctx.save();
  ctx.globalAlpha = 0.3 - heightT * 0.18;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(b.x, HS_PITCH_Y + 2, HS_BALL_R * (1 - heightT * 0.35), HS_BALL_R * 0.36 * (1 - heightT * 0.35), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const speed = Math.hypot(b.vx, b.vy);
  if (speed > 220) {
    const trailLen = Math.min(4, Math.floor(speed / 220));
    for (let i = 1; i <= trailLen; i++) {
      ctx.save();
      ctx.globalAlpha = 0.14 * (1 - i / (trailLen + 1));
      ctx.beginPath();
      ctx.arc(b.x - (b.vx / speed) * i * 9, b.y - (b.vy / speed) * i * 9, HS_BALL_R * 0.85, 0, Math.PI * 2);
      ctx.fillStyle = "#f2efe6";
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate((b.spin || 0) % (Math.PI * 2));
  // NUEVO: squash & stretch - un rebote fuerte achata la pelota un instante
  // (más ancha, menos alta) y se recupera sola. Es puro "juice" visual, no
  // toca el hitbox, pero es justo lo que le faltaba para sentirse dinámica
  // en vez de pesada.
  const sq = b.squash || 0;
  if (sq > 0.01) ctx.scale(1 + sq * 0.22, 1 - sq * 0.22);
  const ballShade = ctx.createRadialGradient(-HS_BALL_R * 0.3, -HS_BALL_R * 0.3, 1, 0, 0, HS_BALL_R);
  ballShade.addColorStop(0, "#ffffff");
  ballShade.addColorStop(1, "#d8d2c3");
  ctx.beginPath();
  ctx.arc(0, 0, HS_BALL_R, 0, Math.PI * 2);
  ctx.fillStyle = ballShade;
  ctx.fill();
  ctx.strokeStyle = "#2b2530";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = "#2b2530";
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * HS_BALL_R * 0.55, Math.sin(a) * HS_BALL_R * 0.55, HS_BALL_R * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, HS_BALL_R * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function hsDraw() {
  const ctx = hsCtx;
  ctx.save();
  if (hsShakeState.time > 0) {
    const s = hsShakeState.mag * (hsShakeState.time / 0.28);
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }
  hsDrawField();
  [hsState.left, hsState.right].forEach((p) => hsDrawPlayer(p));
  hsDrawBall();
  hsDrawGoalFronts();
  ctx.restore();
}

function hsEndMatch(winnerSide, reason) {
  hsState.over = true;
  clearInterval(hsState.timerInterval);
  if (hsRAF) { cancelAnimationFrame(hsRAF); hsRAF = null; }
  hsDetachKeys();

  const winner = hsState[winnerSide];
  document.getElementById("headResultTitle").textContent = `¡Gana ${winner.name}!`;
  document.getElementById("headResultSub").textContent =
    reason === "muerte súbita" ? "Lo definió en la muerte súbita." :
    reason === "goles" ? `Llegó primero a ${HS_GOALS_TO_WIN} goles.` :
    "Terminó arriba en el marcador cuando se acabó el tiempo.";
  document.getElementById("headResultOverlay").classList.remove("hidden");
  launchConfetti();
  playFanfare();
}

function hsTeardown() {
  hsPendingTimeouts.forEach(clearTimeout);
  hsPendingTimeouts = [];
  if (hsRAF) { cancelAnimationFrame(hsRAF); hsRAF = null; }
  if (hsState && hsState.timerInterval) clearInterval(hsState.timerInterval);
  hsDetachKeys();
  hsState = null;
  hsShakeState = { time: 0, mag: 0 };
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("pickHeadBtn").addEventListener("click", () => {
    closeDuelSelect();
    hsLoadHeadImages();
    openHeadModal();
  });
  document.getElementById("closeHeadModal").addEventListener("click", () => {
    hsTeardown();
    document.getElementById("headModal").classList.add("hidden");
  });
  document.querySelectorAll("#headModeSelect .duel-mode-card").forEach((card) => {
    card.addEventListener("click", () => {
      hsSelectedMode = card.dataset.hsMode;
      hsOpenPickScreen();
    });
  });
  document.getElementById("headPickBackBtn").addEventListener("click", () => hsShowScreen("headModeSelect"));
  document.querySelectorAll("#headPick .fight-pick-card").forEach((card) => {
    card.addEventListener("click", () => {
      if (card.disabled) return;
      hsHandlePickClick(card.dataset.head);
    });
  });

  document.getElementById("headControlsBtn").addEventListener("click", () => {
    hsBuildRemapUI();
    document.getElementById("headModeSelect").classList.add("hidden");
    document.getElementById("headControlsScreen").classList.remove("hidden");
  });
  document.getElementById("headRemapBackBtn").addEventListener("click", () => {
    document.getElementById("headControlsScreen").classList.add("hidden");
    document.getElementById("headModeSelect").classList.remove("hidden");
  });
  document.getElementById("headRemapResetBtn").addEventListener("click", hsResetControls);
    
    
  document.getElementById("headRematchBtn").addEventListener("click", () => {
    if (hsState) hsStartMatch(hsState.left.headKey, hsState.right.headKey);
  });
  document.getElementById("headBackToPickBtn").addEventListener("click", () => {
    hsTeardown();
    document.getElementById("headResultOverlay").classList.add("hidden");
    hsOpenPickScreen();
  });
});
