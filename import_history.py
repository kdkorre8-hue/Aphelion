"""Imports your Spotify extended streaming history into heavy_rotation.db.

Request it from Spotify (Account > Privacy settings > Extended streaming history).
When the email arrives, download the zip and put it in this folder, then run:
    python import_history.py
or point to the zip or the unzipped folder:
    python import_history.py "C:\\Users\\you\\Downloads\\my_spotify_data.zip"

Only music is imported (no podcasts). Running it again, for example with a newer
export, only adds plays that aren't already saved.
"""
import json
import sqlite3
import sys
import zipfile
from pathlib import Path

FOLDER = Path(__file__).parent
DB_FILE = FOLDER / "heavy_rotation.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS history (
    ended_at     TEXT NOT NULL,  -- UTC time the play ended
    track_uri    TEXT NOT NULL,  -- spotify:track:...
    track_name   TEXT,
    artist_name  TEXT,
    album_name   TEXT,
    ms_played    INTEGER,        -- how long you listened
    platform     TEXT,
    country      TEXT,
    reason_start TEXT,
    reason_end   TEXT,
    shuffle      INTEGER,
    skipped      INTEGER,
    offline      INTEGER,
    incognito    INTEGER,
    PRIMARY KEY (ended_at, track_uri)
);
"""


def find_export():
    """Looks for the export in this folder when no path is given."""
    candidates = sorted(FOLDER.glob("my_spotify_data*.zip")) + sorted(FOLDER.glob("*Extended Streaming History*"))
    if not candidates:
        raise SystemExit(
            "Couldn't find your export. Put my_spotify_data.zip in this folder, "
            "or run: python import_history.py <path to the zip or folder>"
        )
    return candidates[-1]


def read_json_files(path):
    """Yields (file name, parsed JSON) for every .json file in the zip or folder."""
    if path.is_file() and path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as z:
            for name in z.namelist():
                if name.lower().endswith(".json"):
                    yield name, json.loads(z.read(name).decode("utf-8"))
    elif path.is_dir():
        for file in sorted(path.rglob("*.json")):
            yield file.name, json.loads(file.read_text(encoding="utf-8"))
    else:
        raise SystemExit(f"{path} is not a zip file or a folder.")


def is_extended_history(data):
    return isinstance(data, list) and data and isinstance(data[0], dict) and "ts" in data[0] and "ms_played" in data[0]


def to_row(entry):
    """One play from the export -> one database row, or None for podcasts and audiobooks."""
    uri = entry.get("spotify_track_uri")
    if not uri:
        return None
    flag = lambda key: None if entry.get(key) is None else int(bool(entry[key]))
    return (
        entry["ts"],
        uri,
        entry.get("master_metadata_track_name"),
        entry.get("master_metadata_album_artist_name"),
        entry.get("master_metadata_album_album_name"),
        entry.get("ms_played"),
        entry.get("platform"),
        entry.get("conn_country"),
        entry.get("reason_start"),
        entry.get("reason_end"),
        flag("shuffle"),
        flag("skipped"),
        flag("offline"),
        flag("incognito_mode"),
    )


def main():
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else find_export()
    print(f"Reading {path.name}...")

    rows, files, basic_files = [], 0, 0
    for name, data in read_json_files(path):
        if is_extended_history(data):
            files += 1
            rows.extend(r for r in map(to_row, data) if r)
        elif isinstance(data, list) and data and isinstance(data[0], dict) and "endTime" in data[0]:
            basic_files += 1  # the short one-year history, which has no song IDs

    if not files:
        if basic_files:
            raise SystemExit(
                "This is Spotify's basic one-year history. Request the *extended* streaming history "
                "instead (Account > Privacy settings), which covers your whole account."
            )
        raise SystemExit("No streaming history files found in the export.")

    db = sqlite3.connect(DB_FILE)
    try:
        with db:
            db.executescript(SCHEMA)
            before = db.total_changes
            db.executemany("INSERT OR IGNORE INTO history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
            added = db.total_changes - before
            total, first, last = db.execute("SELECT COUNT(*), MIN(ended_at), MAX(ended_at) FROM history").fetchone()
    finally:
        db.close()

    print(f"Read {len(rows):,} music plays from {files} files. Added {added:,} new ones.")
    print(f"Your history now has {total:,} plays, from {first[:10]} to {last[:10]}.")
    print("Run python galaxy.py to see them.")


if __name__ == "__main__":
    main()
