"""Prints your top 10 artists and tracks.

Usage:
    python top.py          # last ~6 months (default)
    python top.py short    # last ~4 weeks
    python top.py long     # last ~year
    python top.py demo     # fake data, no Spotify login needed
"""
import sys

import requests

from auth import get_access_token

API = "https://api.spotify.com/v1"
RANGES = {"short": "short_term", "medium": "medium_term", "long": "long_term"}

# Fake data in the same shape Spotify returns, so demo mode runs the same printing code
DEMO_ARTISTS = [
    {"name": "The Placeholders", "genres": ["indie rock", "dream pop"]},
    {"name": "Null Pointer", "genres": ["synthwave", "electronic"]},
    {"name": "Lorem Ipsum Orchestra", "genres": ["classical", "soundtrack"]},
    {"name": "404 Not Found", "genres": ["hip hop"]},
    {"name": "Dev Mode", "genres": []},
]
DEMO_TRACKS = [
    {"name": "Hello World", "artists": [{"name": "The Placeholders"}]},
    {"name": "Segmentation Fault", "artists": [{"name": "Null Pointer"}]},
    {"name": "Works on My Machine", "artists": [{"name": "404 Not Found"}, {"name": "Dev Mode"}]},
    {"name": "Merge Conflict", "artists": [{"name": "Lorem Ipsum Orchestra"}]},
    {"name": "It Compiles", "artists": [{"name": "Null Pointer"}]},
]


def get_top(kind, time_range, token, limit=10):
    resp = requests.get(
        f"{API}/me/top/{kind}",
        headers={"Authorization": f"Bearer {token}"},
        params={"limit": limit, "time_range": time_range},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["items"]


def main():
    args = sys.argv[1:]
    demo = "demo" in args
    args = [a for a in args if a != "demo"]

    choice = args[0] if args else "medium"
    time_range = RANGES.get(choice)
    if not time_range:
        raise SystemExit(f"Unknown range '{choice}'. Use: short, medium, long or demo.")

    if demo:
        print("DEMO MODE: fake data, not your real Spotify stats")
        artists, tracks = DEMO_ARTISTS, DEMO_TRACKS
    else:
        token = get_access_token()
        artists = get_top("artists", time_range, token)
        tracks = get_top("tracks", time_range, token)

    print(f"\nTop artists ({choice} term)")
    for i, artist in enumerate(artists, 1):
        genres = ", ".join(artist.get("genres", [])[:3]) or "no genres listed"
        print(f"{i:>2}. {artist['name']}  ({genres})")

    print(f"\nTop tracks ({choice} term)")
    for i, track in enumerate(tracks, 1):
        artist_names = ", ".join(a["name"] for a in track["artists"])
        print(f"{i:>2}. {track['name']} - {artist_names}")


if __name__ == "__main__":
    main()
