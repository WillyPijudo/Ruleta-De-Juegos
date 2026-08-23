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
let shootout = null;
let penaltyRoundTimeout = null;

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
    penaltyState = "flight";
    document.getElementById("penaltyKeeper").classList.remove("idle-shimmy");

    if (capturedPower > 95) {
        document.getElementById("penaltyStatus").textContent = "¡Se pasó de potencia!";
    } else if (capturedPower >= 85) {
        document.getElementById("penaltyStatus").textContent = "¡Fierrazo inatajable! Arquero rezá...";
    } else {
        document.getElementById("penaltyStatus").textContent = "¡Va la pelota! Arquero, reaccioná…";
    }

    launchPenaltyBall(zone, capturedPower);
  };

  penaltyKeyHandler = (e) => {
    if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
    const zone = PENALTY_ZONES[e.key.toLowerCase()];
    if (!zone) return;

    if (penaltyState === "aiming") {
      doKick(zone);
    } else if (penaltyState === "flight" && !penaltyKeeperZone) {
      penaltyKeeperZone = zone;
      penaltyKeeperTooSlow = performance.now() - penaltyFlightStartTime > penaltyReactionCutoffMs;
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

  const { duration, cutoff, revealFrac } = penaltyShotTiming(power);
  penaltyReactionCutoffMs = cutoff;

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

  if (power > 95) {
    document.getElementById("penaltyStatus").textContent = "¡Afuera!";
    showPenaltyStamp("¡A LA TRIBUNA!", "stamp-out");
    scored = false;
    flavor = "¡Se llenó de pelota y la mandó a la calle!";
  } else if (power >= 85) {
    document.getElementById("penaltyStatus").textContent = "¡GOLAZO!";
    goal.classList.add("net-ripple");
    setTimeout(() => goal.classList.remove("net-ripple"), 450);
    showPenaltyStamp("¡GOLAZO!", "stamp-goal");
    scored = true;
    flavor = "¡Le rompió el arco! Imposible para el arquero.";
  } else {
    const saved = !penaltyKeeperTooSlow && penaltyKeeperZone === kickZone;
    if (saved) {
      document.getElementById("penaltyStatus").textContent = "¡Atajada!";
      showPenaltyStamp("¡ATAJADA!", "stamp-save");
      scored = false;
      flavor = PENALTY_SAVE_FLAVORS[Math.floor(Math.random() * PENALTY_SAVE_FLAVORS.length)];
    } else {
      document.getElementById("penaltyStatus").textContent = "¡GOL!";
      goal.classList.add("net-ripple");
      setTimeout(() => goal.classList.remove("net-ripple"), 450);
      showPenaltyStamp("¡GOL!", "stamp-goal");
      scored = true;
      flavor = PENALTY_GOAL_FLAVORS[Math.floor(Math.random() * PENALTY_GOAL_FLAVORS.length)];
    }
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
  // FASE 2: acá se va a chequear si el oponente pegó casi al mismo tiempo
  // (otherFighter(fighter).isAttacking reciente) para disparar el choque
  // en vez de resolver el golpe normal.

  fighter.energy -= FIGHT_PUNCH_COST;
  fighter.isAttacking = true;
  renderFightBars();
  playPunchAnim(fighter, height);

  const opponent = otherFighter(fighter);
  opponent.incomingAttack = { height };

  fightSetTimeout(() => resolvePunch(fighter, opponent, height), FIGHT_RESOLVE_WINDOW_MS);
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
