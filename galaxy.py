"""Builds your galaxy and opens it in the browser.

Uses every play it knows about: your imported streaming history (see import_history.py)
plus the plays logger.py saved after it. Until you've imported your history, it shows a
preview estimated from your top songs. Writes web/galaxy.json and serves the web folder
at http://127.0.0.1:8000. Run it again whenever you want fresh data. Stop it with Ctrl+C.

Usage:
    python galaxy.py
"""
import json
import os
import random
import sqlite3
import webbrowser
from collections import Counter
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import NamedTuple

import requests

from auth import get_access_token

API = "https://api.spotify.com/v1"
FOLDER = Path(__file__).parent
DB_FILE = FOLDER / "heavy_rotation.db"
WEB_DIR = FOLDER / "web"
PORT = 8000
MIN_SECONDS = 30       # shorter plays don't count
MAX_STARS = 100        # the artists you've listened to most become stars, the rest is dust
MIN_STAR_PLAYS = 3
SONGS_PER_STAR = 100   # songs sent along for each star: planets plus asteroid belt
PREVIEW_DAYS = {"short_term": 28, "medium_term": 182, "long_term": 365}  # what each top list covers


class Play(NamedTuple):
    time: float      # when it was played, in seconds since 1970 (UTC)
    artist: str
    song: str
    album: str
    track_id: str
    ms: int          # how long it played


def to_timestamp(text):
    """'2021-03-14T18:22:05Z' or '2021-03-14T18:22:05.123Z' -> seconds since 1970."""
    return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()


def table_exists(db, name):
    return db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None


# ---------- where the plays come from ----------

def history_plays(db):
    """Plays from your imported streaming history."""
    if not table_exists(db, "history"):
        return []
    rows = db.execute("""
        SELECT ended_at, artist_name, track_name, album_name, track_uri, ms_played FROM history
        WHERE ms_played >= ? AND artist_name IS NOT NULL
    """, (MIN_SECONDS * 1000,))
    return [
        Play(to_timestamp(ended_at), artist, song or "Unknown song", album or "", uri.rsplit(":", 1)[-1], ms)
        for ended_at, artist, song, album, uri, ms in rows
    ]


def logger_plays(db, after):
    """Plays saved by logger.py, only the ones newer than the imported history."""
    if not table_exists(db, "plays"):
        return []
    rows = db.execute("""
        SELECT p.played_at, t.id, t.name, al.name, t.duration_ms,
               (SELECT a.name FROM track_artists ta JOIN artists a ON a.id = ta.artist_id
                WHERE ta.track_id = t.id ORDER BY ta.position LIMIT 1)
        FROM plays p
        JOIN tracks t ON t.id = p.track_id
        LEFT JOIN albums al ON al.id = t.album_id
    """)
    plays = []
    for played_at, track_id, song, album, duration, artist in rows:
        time = to_timestamp(played_at)
        if time > after and artist:
            plays.append(Play(time, artist, song, album or "", track_id, duration or 180_000))
    return plays


def top_tracks(token):
    """Your top 50 songs for each time range: used for the preview and for album pictures."""
    top = {}
    for time_range in PREVIEW_DAYS:
        resp = requests.get(
            f"{API}/me/top/tracks",
            headers={"Authorization": f"Bearer {token}"},
            params={"limit": 50, "time_range": time_range},
            timeout=10,
        )
        resp.raise_for_status()
        top[time_range] = [t for t in resp.json()["items"] if t.get("id") and t.get("artists")]
    return top


def preview_plays(top, now):
    """Rough plays estimated from your top lists, used until your streaming history is imported."""
    plays = []
    for time_range, tracks in top.items():
        window = PREVIEW_DAYS[time_range] * 86400
        for rank, track in enumerate(tracks, 1):
            rand = random.Random(f"{track['id']}-{time_range}")  # same estimate every time
            for _ in range(max(1, round((51 - rank) / 8))):     # higher rank, more plays
                plays.append(Play(
                    now - rand.random() * window, track["artists"][0]["name"], track["name"],
                    track["album"]["name"], track["id"], track.get("duration_ms") or 180_000,
                ))
    return plays


def album_images(db, top):
    images = {}
    if table_exists(db, "tracks") and table_exists(db, "albums"):
        rows = db.execute("SELECT t.id, al.image_url FROM tracks t JOIN albums al ON al.id = t.album_id")
        images.update((track_id, url) for track_id, url in rows if url)
    for tracks in top.values():
        for t in tracks:
            pictures = t["album"].get("images") or []
            if pictures:
                images[t["id"]] = pictures[min(1, len(pictures) - 1)]["url"]  # medium size
    return images


# ---------- plays -> artists ----------

def month_number(time):
    d = datetime.fromtimestamp(time, timezone.utc)
    return d.year * 12 + d.month - 1


def summarize(plays):
    """Totals per artist, and per song within each artist."""
    artists = {}
    for p in plays:
        name = p.artist.strip()
        a = artists.get(name.lower())
        if a is None:
            a = artists[name.lower()] = {
                "name": name, "plays": 0, "ms": 0, "first": p.time, "last": p.time, "months": Counter(), "songs": {},
            }
        a["plays"] += 1
        a["ms"] += p.ms
        a["first"], a["last"] = min(a["first"], p.time), max(a["last"], p.time)
        a["months"][month_number(p.time)] += 1

        key = p.song.strip().lower()  # the single and the album version count as one song
        s = a["songs"].get(key)
        if s is None:
            s = a["songs"][key] = {"name": p.song, "id": p.track_id, "album": p.album, "plays": 0, "ms": 0,
                                   "first": p.time, "last": p.time}
        s["plays"] += 1
        s["ms"] += p.ms
        s["first"], s["last"] = min(s["first"], p.time), max(s["last"], p.time)
    return artists


def peak_time(months):
    """Middle of the month you played the artist the most (the latest one if there's a tie)."""
    month = max(months.items(), key=lambda item: (item[1], item[0]))[0]
    return datetime(month // 12, month % 12 + 1, 15, tzinfo=timezone.utc).timestamp()


def artist_json(a, images, with_songs):
    songs = sorted(a["songs"].values(), key=lambda s: (s["plays"], s["last"]), reverse=True)
    data = {
        "name": a["name"],
        "plays": a["plays"],
        "hours": round(a["ms"] / 3_600_000, 1),
        "first": int(a["first"]),
        "last": int(a["last"]),
        "peak": int(peak_time(a["months"])),
        "song_count": len(songs),
    }
    if with_songs:
        data["months"] = sorted([m, n] for m, n in a["months"].items())
        data["songs"] = [
            {"name": s["name"], "id": s["id"], "album": s["album"], "plays": s["plays"],
             "minutes": round(s["ms"] / 60_000), "first": int(s["first"]), "last": int(s["last"]),
             "image": images.get(s["id"])}
            for s in songs[:SONGS_PER_STAR]
        ]
    else:
        data["top_song"] = {"name": songs[0]["name"], "id": songs[0]["id"]}
    return data


def build():
    now = datetime.now(timezone.utc).timestamp()
    top = top_tracks(get_access_token())
    db = sqlite3.connect(DB_FILE)
    try:
        history = history_plays(db)
        plays = history + logger_plays(db, after=max((p.time for p in history), default=0))
        images = album_images(db, top)
    finally:
        db.close()
    if not history:
        plays += preview_plays(top, now)
    if not plays:
        raise SystemExit("No plays yet. Listen to some music and try again.")

    ranked = sorted(summarize(plays).values(), key=lambda a: a["ms"], reverse=True)
    stars = [a for a in ranked if a["plays"] >= MIN_STAR_PLAYS][:MAX_STARS]
    if len(stars) < 10:  # very little data: still give the galaxy something to show
        stars = ranked[:10]
    star_names = {a["name"] for a in stars}
    dust = [a for a in ranked if a["name"] not in star_names]

    data = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "mode": "history" if history else "preview",
        "start": int(min(p.time for p in plays)),
        "end": int(now),
        "plays": len(plays),
        "hours": round(sum(p.ms for p in plays) / 3_600_000),
        "months": sorted([m, n] for m, n in Counter(month_number(p.time) for p in plays).items()),  # plays per month
        "stars": [artist_json(a, images, with_songs=True) for a in stars],
        "dust": [artist_json(a, images, with_songs=False) for a in dust],
    }
    WEB_DIR.mkdir(exist_ok=True)
    (WEB_DIR / "galaxy.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"Galaxy built from {len(plays):,} plays: {len(stars)} stars and {len(dust):,} dust specks.")
    if not history:
        print("This is a preview estimated from your top songs. When your streaming history arrives, "
              "run python import_history.py and then python galaxy.py again.")


class QuietHandler(SimpleHTTPRequestHandler):
    # Windows sometimes reports .js as text/plain, and browsers then refuse to run it
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".json": "application/json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # always load the newest galaxy.json
        super().end_headers()

    def log_message(self, *args):  # keep the terminal quiet
        pass


def _galaxy_already_running(url):
    try:
        return requests.get(f"{url}/galaxy.json", timeout=2).ok
    except requests.RequestException:
        return False


def serve():
    class Server(ThreadingHTTPServer):
        allow_reuse_address = os.name != "nt"  # same reason as in auth.py

    url = f"http://127.0.0.1:{PORT}"
    try:
        server = Server(("127.0.0.1", PORT), partial(QuietHandler, directory=str(WEB_DIR)))
    except OSError:
        if _galaxy_already_running(url):  # an earlier run is still going, and it serves the new data too
            print(f"The galaxy is already running from another terminal. Opening {url}")
            webbrowser.open(url)
            return
        raise SystemExit(f"Port {PORT} is used by another program, so the galaxy can't start.")

    print(f"Galaxy running at {url} (Ctrl+C to stop)")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    build()
    serve()
