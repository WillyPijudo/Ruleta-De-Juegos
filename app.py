import hashlib
import json
import mimetypes
import os
import re
import socket
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
from flask import Flask, jsonify, render_template, request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
STATIC_DIR = os.path.join(BASE_DIR, "static")
COVERS_DIR = os.path.join(STATIC_DIR, "covers")
GAMES_FILE = os.path.join(DATA_DIR, "games.json")
HISTORY_FILE = os.path.join(DATA_DIR, "history.json")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(COVERS_DIR, exist_ok=True)

app = Flask(__name__)

# Steam (and most CDNs) sometimes treat the default python-requests
# User-Agent as a bot and behave differently, so we look like a normal
# browser for every outgoing request.
HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
}

MAX_COVER_BYTES = 15 * 1024 * 1024  # 15 MB safety cap per image
STEAM_APP_URL_RE = re.compile(r"steampowered\.com/app/(\d+)")


def _load(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return default


def _save(path, data):
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def _local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except OSError:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


def _safe_ext(content_type, url):
    ext = mimetypes.guess_extension((content_type or "").split(";")[0].strip())
    if ext in (None, ".jpe", ".bin"):
        path_ext = os.path.splitext(urlparse(url).path)[1].lower()
        ext = path_ext if path_ext in (".jpg", ".jpeg", ".png", ".webp", ".gif") else ".jpg"
    return ext


def _steam_candidates_from_url(url):
    """If someone pasted a normal Steam *store page* link (instead of a
    direct image link), pull the appid out of it and build the real
    image URLs ourselves. This is a common reason covers 'don't load' -
    a store page URL isn't an image at all."""
    match = STEAM_APP_URL_RE.search(url or "")
    if not match:
        return None
    appid = match.group(1)
    return [
        f"https://cdn.akamai.steamstatic.com/steam/apps/{appid}/library_600x900.jpg",
        f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_600x900.jpg",
        f"https://cdn.akamai.steamstatic.com/steam/apps/{appid}/header.jpg",
        f"https://cdn.akamai.steamstatic.com/steam/apps/{appid}/capsule_616x353.jpg",
    ]


def download_cover(*candidate_urls):
    """
    Try each candidate URL in order and actually download the first one
    that responds with real image bytes, caching it to disk under
    static/covers/. Returns a local '/static/covers/xxxx.jpg' path to
    use in <img src>, or None if every candidate failed (e.g. no
    internet right now). Caching locally means the wheel keeps working
    even if the wifi drops mid-party, and sidesteps any hotlink/CORS
    quirks some CDNs have with third-party pages loading their images
    directly.
    """
    for raw_url in candidate_urls:
        url = (raw_url or "").strip()
        if not url:
            continue
        expanded = _steam_candidates_from_url(url)
        urls_to_try = expanded if expanded else [url]

        for u in urls_to_try:
            try:
                resp = requests.get(u, headers=HTTP_HEADERS, timeout=6, stream=True)
                if resp.status_code != 200:
                    continue
                content_type = resp.headers.get("Content-Type", "")
                if not content_type.startswith("image/"):
                    continue
                content_length = resp.headers.get("Content-Length")
                if content_length and int(content_length) > MAX_COVER_BYTES:
                    continue

                digest = hashlib.sha1(u.encode("utf-8")).hexdigest()[:16]
                ext = _safe_ext(content_type, u)
                filename = f"{digest}{ext}"
                filepath = os.path.join(COVERS_DIR, filename)

                if not os.path.exists(filepath):
                    tmp_path = filepath + f".{uuid.uuid4().hex[:6]}.tmp"
                    written = 0
                    too_big = False
                    with open(tmp_path, "wb") as f:
                        for chunk in resp.iter_content(8192):
                            written += len(chunk)
                            if written > MAX_COVER_BYTES:
                                too_big = True
                                break
                            f.write(chunk)
                    if too_big:
                        os.remove(tmp_path)
                        continue
                    os.replace(tmp_path, filepath)

                return f"/static/covers/{filename}"
            except (requests.RequestException, OSError, ValueError):
                continue
    return None


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/server-info")
def server_info():
    return jsonify({"ip": _local_ip(), "port": int(os.environ.get("PORT", 5000))})


@app.route("/api/games", methods=["GET"])
def get_games():
    return jsonify(_load(GAMES_FILE, []))


@app.route("/api/games", methods=["POST"])
def add_game():
    payload = request.get_json(force=True, silent=True) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"error": "El juego necesita un nombre."}), 400

    games = _load(GAMES_FILE, [])
    if any(g["name"].lower() == name.lower() for g in games):
        return jsonify({"error": "Ese juego ya está en la ruleta."}), 409

    raw_candidates = [
        (payload.get("cover") or "").strip(),
        (payload.get("cover_fallback") or "").strip(),
        (payload.get("cover_extra") or "").strip(),
    ]
    local_cover = download_cover(*raw_candidates)

    game = {
        "id": uuid.uuid4().hex[:10],
        "name": name[:120],
        "added_by": (payload.get("added_by") or "Anónimo").strip()[:40] or "Anónimo",
        # If we managed to download it, we always point at our own local
        # copy. If not (no internet right now), we keep the original
        # remote link(s) so the browser can still try loading them.
        "cover": (local_cover or raw_candidates[0])[:500],
        "cover_fallback": "" if local_cover else raw_candidates[1][:500],
        "steam_appid": payload.get("steam_appid"),
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }

    games.append(game)
    _save(GAMES_FILE, games)
    return jsonify(game), 201


@app.route("/api/games/<game_id>", methods=["DELETE"])
def delete_game(game_id):
    games = _load(GAMES_FILE, [])
    new_games = [g for g in games if g["id"] != game_id]
    if len(new_games) == len(games):
        return jsonify({"error": "No se encontró ese juego."}), 404
    _save(GAMES_FILE, new_games)
    return jsonify({"ok": True})


@app.route("/api/history", methods=["GET"])
def get_history():
    return jsonify(_load(HISTORY_FILE, []))


@app.route("/api/history", methods=["POST"])
def add_history():
    payload = request.get_json(force=True, silent=True) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Falta el nombre del juego ganador."}), 400

    cover = (payload.get("cover") or "").strip()
    # At this point cover is normally already a local /static/covers/...
    # path (cached when the game was added). If it's still a remote URL
    # for some reason, try to grab it now too.
    if cover and not cover.startswith("/static/"):
        cover = download_cover(cover) or cover

    entry = {
        "id": uuid.uuid4().hex[:10],
        "name": name[:120],
        "cover": cover[:500],
        # Who added the winning game, so the history/leaderboard can
        # show off (or shame) whoever's pick keeps getting picked.
        "added_by": (payload.get("added_by") or "Anónimo").strip()[:40] or "Anónimo",
        "date": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    history = _load(HISTORY_FILE, [])
    history.insert(0, entry)
    history = history[:50]
    _save(HISTORY_FILE, history)
    return jsonify(entry), 201


@app.route("/api/history/<entry_id>", methods=["DELETE"])
def delete_history(entry_id):
    history = _load(HISTORY_FILE, [])
    new_history = [h for h in history if h["id"] != entry_id]
    _save(HISTORY_FILE, new_history)
    return jsonify({"ok": True})


@app.route("/api/history", methods=["DELETE"])
def clear_history():
    """Wipe the whole history in one go (the 'borrar todo' button)."""
    _save(HISTORY_FILE, [])
    return jsonify({"ok": True})


@app.route("/api/steam-search", methods=["GET"])
def steam_search():
    term = (request.args.get("q") or "").strip()
    if len(term) < 2:
        return jsonify([])

    data = None
    # Try Argentina/Spanish first (closer to what the user will see on
    # steampowered.com), then fall back to the US/English catalog, since
    # a handful of titles are only listed for certain store regions.
    for cc, lang in (("ar", "spanish"), ("us", "english")):
        try:
            resp = requests.get(
                "https://store.steampowered.com/api/storesearch/",
                params={"term": term, "l": lang, "cc": cc},
                headers=HTTP_HEADERS,
                timeout=6,
            )
            resp.raise_for_status()
            candidate = resp.json()
        except (requests.RequestException, ValueError):
            continue
        data = candidate
        if data.get("items"):
            break

    if data is None:
        return jsonify({"error": "No se pudo contactar a Steam. Revisá tu conexión a internet."}), 502

    results = []
    for item in data.get("items", [])[:8]:
        appid = item.get("id")
        if not appid:
            continue
        results.append(
            {
                "steam_appid": appid,
                "name": item.get("name"),
                # Ordered best -> worst. Not every game has a portrait
                # "library" capsule (older titles often don't), so we
                # give the frontend/backend a full chain to fall back
                # through instead of assuming one URL always works.
                "cover": f"https://cdn.akamai.steamstatic.com/steam/apps/{appid}/library_600x900.jpg",
                "cover_fallback": f"https://cdn.akamai.steamstatic.com/steam/apps/{appid}/header.jpg",
                # tiny_image comes straight from Steam's own search
                # response, so it's guaranteed to exist for this appid.
                "cover_extra": item.get("tiny_image") or "",
            }
        )
    return jsonify(results)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    ip = _local_ip()
    print("\n" + "=" * 60)
    print("  Ruleta de Juegos lista")
    print("=" * 60)
    print(f"  En esta compu:    http://localhost:{port}")
    print(f"  Para tus amigos:  http://{ip}:{port}  (misma wifi/red)")
    print("=" * 60 + "\n")
    app.run(host="0.0.0.0", port=port, debug=False)
