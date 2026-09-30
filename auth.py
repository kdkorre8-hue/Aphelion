"""Spotify login using Authorization Code with PKCE.

get_access_token() returns a valid access token. It reuses the saved token,
refreshes it when it has expired, or opens the browser so you can log in.
"""
import base64
import hashlib
import json
import os
import secrets
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")  # works even when run from another folder

CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID")
REDIRECT_URI = "http://127.0.0.1:8888/callback"
# user-read-recently-played is included now so the same token works for the history logger later
SCOPES = "user-top-read user-read-recently-played"
AUTH_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
TOKEN_FILE = Path(__file__).parent / "token.json"
LOGIN_TIMEOUT = 300  # seconds to wait for you to approve in the browser


def _make_pkce_pair():
    """Creates the secret verifier and the hashed challenge that PKCE uses instead of a client secret."""
    verifier = secrets.token_urlsafe(64)  # 86 characters, within Spotify's 43-128 limit
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


def _login_in_browser(auth_url, expected_state):
    """Starts a small local server, opens Spotify's login page and returns the ?code= it sends back."""
    result = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            url = urllib.parse.urlparse(self.path)
            if url.path != "/callback":  # e.g. the browser asking for favicon.ico
                self.send_response(404)
                self.end_headers()
                return
            params = urllib.parse.parse_qs(url.query)
            for key in ("code", "state", "error"):
                result[key] = params.get(key, [None])[0]
            ok = result["code"] and result["state"] == expected_state
            message = "Got it! You can close this tab." if ok else "Login failed. Check the terminal."
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(f"<h2>{message}</h2>".encode())

        def log_message(self, *args):  # keep the terminal quiet
            pass

    class Server(HTTPServer):
        # On Windows, address reuse lets two runs listen on the same port at once, so the
        # login can land in an old, stuck run. Mac/Linux need it for quick reruns.
        allow_reuse_address = os.name != "nt"

    try:
        server = Server(("127.0.0.1", 8888), Handler)
    except OSError:
        raise SystemExit(
            "Port 8888 is busy, probably an earlier run that is still waiting. "
            "Close your other terminal windows and try again."
        )
    server.timeout = 1  # wake up every second so Ctrl+C works on Windows

    print("Opening Spotify in your browser. Approve there (Ctrl+C here to cancel)...")
    webbrowser.open(auth_url)
    deadline = time.time() + LOGIN_TIMEOUT
    try:
        while not result and time.time() < deadline:
            server.handle_request()
    finally:
        server.server_close()

    if not result:
        raise SystemExit("Login timed out. Run the script again.")
    if result["error"]:
        raise SystemExit(f"Login failed: {result['error']}")
    if result["state"] != expected_state:
        raise SystemExit("Login failed: state mismatch (possible tampering). Try again.")
    return result["code"]


def _save(token):
    token["expires_at"] = time.time() + token["expires_in"] - 60  # refresh a minute early
    TOKEN_FILE.write_text(json.dumps(token, indent=2))
    return token


def _login():
    verifier, challenge = _make_pkce_pair()
    state = secrets.token_urlsafe(16)
    params = {
        "client_id": CLIENT_ID,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "code_challenge_method": "S256",
        "code_challenge": challenge,
        "state": state,
    }
    code = _login_in_browser(f"{AUTH_URL}?{urllib.parse.urlencode(params)}", state)

    resp = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "code_verifier": verifier,
        },
        timeout=10,
    )
    if resp.status_code != 200:
        raise SystemExit(f"Spotify rejected the login ({resp.status_code}): {resp.text}")
    token = _save(resp.json())
    print("Logged in and saved to token.json, so next time no browser is needed.")
    return token


def _refresh(token):
    resp = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": token["refresh_token"],
            "client_id": CLIENT_ID,
        },
        timeout=10,
    )
    if resp.status_code != 200:
        return None  # refresh token no longer valid, so log in again
    new = resp.json()
    new.setdefault("refresh_token", token["refresh_token"])  # Spotify doesn't always send a new one
    return _save(new)


def get_access_token():
    if not CLIENT_ID or "paste_your" in CLIENT_ID:
        raise SystemExit("No real Client ID in .env yet. Add yours, or test with: python top.py demo")

    token = json.loads(TOKEN_FILE.read_text()) if TOKEN_FILE.exists() else None

    # If SCOPES has changed since the token was saved, a new login is needed
    if token and set(SCOPES.split()) - set(token.get("scope", "").split()):
        token = None

    if token and time.time() < token["expires_at"]:
        return token["access_token"]
    if token:
        token = _refresh(token)
    if not token:
        token = _login()
    return token["access_token"]
