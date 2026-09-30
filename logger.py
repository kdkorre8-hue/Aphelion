"""Saves your recently played tracks to heavy_rotation.db (SQLite).

Spotify only remembers your last 50 plays, so run this regularly (e.g. every hour)
and your full listening history builds up over time. Each run also looks up genres
for artists it hasn't seen before, and adds a line to logger.log.

Usage:
    python logger.py
"""
import sqlite3
from datetime import datetime
from pathlib import Path

import requests

from auth import get_access_token

API = "https://api.spotify.com/v1"
MAX_ARTIST_LOOKUPS = 50  # per run; Spotify only allows one artist per request, so go easy
FOLDER = Path(__file__).parent
DB_FILE = FOLDER / "heavy_rotation.db"
LOG_FILE = FOLDER / "logger.log"

SCHEMA = """
CREATE TABLE IF NOT EXISTS artists (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    genres_fetched_at TEXT  -- NULL until we've asked Spotify for this artist's genres
);
CREATE TABLE IF NOT EXISTS genres (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS artist_genres (
    artist_id TEXT REFERENCES artists(id),
    genre_id  INTEGER REFERENCES genres(id),
    PRIMARY KEY (artist_id, genre_id)
);
CREATE TABLE IF NOT EXISTS albums (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    release_date TEXT,
    image_url    TEXT
);
CREATE TABLE IF NOT EXISTS tracks (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    album_id    TEXT REFERENCES albums(id),
    duration_ms INTEGER,
    explicit    INTEGER,
    isrc        TEXT
);
CREATE TABLE IF NOT EXISTS track_artists (
    track_id  TEXT REFERENCES tracks(id),
    artist_id TEXT REFERENCES artists(id),
    position  INTEGER,
    PRIMARY KEY (track_id, artist_id)
);
CREATE TABLE IF NOT EXISTS plays (
    played_at    TEXT PRIMARY KEY,  -- UTC time the track was played; you can only play one thing at a time
    track_id     TEXT NOT NULL REFERENCES tracks(id),
    context_type TEXT,              -- playlist, album, artist... or NULL
    context_uri  TEXT
);
"""


def setup_schema(db):
    db.executescript(SCHEMA)
    columns = [row[1] for row in db.execute("PRAGMA table_info(artists)")]
    if "genres_fetched_at" not in columns:  # databases created before genres were added
        db.execute("ALTER TABLE artists ADD COLUMN genres_fetched_at TEXT")


def log(message):
    line = f"{datetime.now():%Y-%m-%d %H:%M}  {message}"
    print(line)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def fetch_recently_played(token):
    resp = requests.get(
        f"{API}/me/player/recently-played",
        headers={"Authorization": f"Bearer {token}"},
        params={"limit": 50},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["items"]


def save_plays(db, items):
    """Inserts plays plus their tracks, albums and artists. Returns how many plays were new."""
    new = 0
    for item in items:
        track = item["track"]
        if not track.get("id"):  # local files have no Spotify ID
            continue
        album = track["album"]
        images = album.get("images") or []

        db.execute(
            "INSERT OR IGNORE INTO albums (id, name, release_date, image_url) VALUES (?, ?, ?, ?)",
            (album["id"], album["name"], album.get("release_date"), images[0]["url"] if images else None),
        )
        db.execute(
            "INSERT OR IGNORE INTO tracks (id, name, album_id, duration_ms, explicit, isrc) VALUES (?, ?, ?, ?, ?, ?)",
            (
                track["id"],
                track["name"],
                album["id"],
                track.get("duration_ms"),
                track.get("explicit"),
                (track.get("external_ids") or {}).get("isrc"),
            ),
        )
        for position, artist in enumerate(track["artists"]):
            if not artist.get("id"):
                continue
            db.execute("INSERT OR IGNORE INTO artists (id, name) VALUES (?, ?)", (artist["id"], artist["name"]))
            db.execute(
                "INSERT OR IGNORE INTO track_artists (track_id, artist_id, position) VALUES (?, ?, ?)",
                (track["id"], artist["id"], position),
            )

        context = item.get("context") or {}
        cur = db.execute(
            "INSERT OR IGNORE INTO plays (played_at, track_id, context_type, context_uri) VALUES (?, ?, ?, ?)",
            (item["played_at"], track["id"], context.get("type"), context.get("uri")),
        )
        new += cur.rowcount  # 1 if inserted, 0 if this play was already saved
    return new


def fill_genres(db, token):
    """Looks up genres for artists not looked up yet. Returns (artists looked up, rate limited?)."""
    todo = db.execute(
        "SELECT id, name FROM artists WHERE genres_fetched_at IS NULL LIMIT ?", (MAX_ARTIST_LOOKUPS,)
    ).fetchall()
    done = 0
    for artist_id, name in todo:
        resp = requests.get(
            f"{API}/artists/{artist_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        if resp.status_code == 429:  # too many requests: the rest waits for the next run
            return done, True
        if resp.status_code == 404:  # artist no longer on Spotify
            genres = []
        else:
            resp.raise_for_status()
            genres = resp.json().get("genres") or []

        for genre in genres:
            db.execute("INSERT OR IGNORE INTO genres (name) VALUES (?)", (genre,))
            db.execute(
                "INSERT OR IGNORE INTO artist_genres (artist_id, genre_id) SELECT ?, id FROM genres WHERE name = ?",
                (artist_id, genre),
            )
        db.execute(
            "UPDATE artists SET genres_fetched_at = ? WHERE id = ?",
            (datetime.now().isoformat(timespec="seconds"), artist_id),
        )
        print(f"  {name}: {', '.join(genres) or 'no genres listed'}")
        done += 1
    return done, False


def main():
    token = get_access_token()
    items = fetch_recently_played(token)

    db = sqlite3.connect(DB_FILE)
    try:
        with db:  # saves all new plays at once, or nothing if something fails
            setup_schema(db)
            before = db.execute("SELECT COUNT(*) FROM plays").fetchone()[0]
            new = save_plays(db, items)
        with db:  # separate step, so a failed genre lookup never loses the plays above
            looked_up, rate_limited = fill_genres(db, token)
    finally:
        db.close()

    message = f"+{new} new plays (total {before + new})"
    if looked_up:
        message += f", genres looked up for {looked_up} artists"
    if rate_limited:
        message += ", rate limited by Spotify (will continue next run)"
    log(message)
    if before and new == len(items) == 50:
        log("  All 50 plays were new, so some older ones may have been missed. Run the logger more often.")


if __name__ == "__main__":
    try:
        main()
    except (Exception, SystemExit) as e:  # written to logger.log so errors in scheduled runs aren't lost
        log(f"ERROR: {e!r}")
        raise
