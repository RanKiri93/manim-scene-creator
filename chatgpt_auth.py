"""ChatGPT-subscription access for the in-app Copilot (the "OpenAI via ChatGPT" provider).

Same approach as OpenCode / the Codex CLI: sign in with the Codex public OAuth client (PKCE, local
callback on ``localhost:1455``), then call the ChatGPT Codex Responses backend with the access token
and the ChatGPT account id. The browser cannot reach those hosts (CORS), so the measure server does
the sign-in and forwards requests.

Tokens are handed to the browser, which keeps them in localStorage like API keys. This module only
holds them in memory while a sign-in is in progress and never writes them to disk.

The client id and backend are what the Codex CLI uses; they are not a documented public API and may
change.
"""

from __future__ import annotations

import base64
import hashlib
import http.server
import json
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from typing import Any

CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
ISSUER = "https://auth.openai.com"
AUTHORIZE_URL = f"{ISSUER}/oauth/authorize"
TOKEN_URL = f"{ISSUER}/oauth/token"
CALLBACK_PORT = 1455
REDIRECT_URI = f"http://localhost:{CALLBACK_PORT}/auth/callback"
SCOPE = "openid profile email offline_access"
CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses"
JWT_AUTH_CLAIM = "https://api.openai.com/auth"
LOGIN_TIMEOUT_S = 300


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def make_pkce() -> tuple[str, str]:
    """(verifier, S256 challenge)."""
    verifier = _b64url(secrets.token_bytes(32))
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


def build_authorize_url(challenge: str, state: str) -> str:
    params = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPE,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
        "id_token_add_organizations": "true",
        "codex_cli_simplified_flow": "true",
        "originator": "codex_cli_rs",
    }
    return f"{AUTHORIZE_URL}?{urllib.parse.urlencode(params)}"


def decode_jwt_claims(token: str) -> dict[str, Any]:
    """Payload of a JWT without verifying it (only used to read our own account id)."""
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload.encode("ascii")))
    except (IndexError, ValueError):
        return {}


def account_from_tokens(id_token: str | None, access_token: str) -> dict[str, str | None]:
    for token in (id_token, access_token):
        if not token:
            continue
        claims = decode_jwt_claims(token)
        auth = claims.get(JWT_AUTH_CLAIM) or {}
        account_id = auth.get("chatgpt_account_id")
        if account_id:
            return {"account_id": account_id, "email": claims.get("email"), "plan": auth.get("chatgpt_plan_type")}
    return {"account_id": None, "email": None, "plan": None}


def _post_form(url: str, fields: dict[str, str], timeout: int = 30) -> dict[str, Any]:
    data = urllib.parse.urlencode(fields).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:1000]
        raise RuntimeError(f"Token request failed ({e.code}): {detail}") from None


def tokens_payload(raw: dict[str, Any], previous_refresh: str | None = None) -> dict[str, Any]:
    """Tokens in the shape the browser stores."""
    access = raw.get("access_token")
    if not access:
        raise RuntimeError("The token response has no access_token.")
    account = account_from_tokens(raw.get("id_token"), access)
    if not account["account_id"]:
        raise RuntimeError("Could not read the ChatGPT account id from the token.")
    return {
        "access": access,
        "refresh": raw.get("refresh_token") or previous_refresh,
        "expires": int((time.time() + float(raw.get("expires_in") or 3600)) * 1000),
        "accountId": account["account_id"],
        "email": account["email"],
        "plan": account["plan"],
    }


def exchange_code(code: str, verifier: str) -> dict[str, Any]:
    raw = _post_form(
        TOKEN_URL,
        {
            "grant_type": "authorization_code",
            "client_id": CLIENT_ID,
            "code": code,
            "code_verifier": verifier,
            "redirect_uri": REDIRECT_URI,
        },
    )
    return tokens_payload(raw)


def refresh_tokens(refresh_token: str) -> dict[str, Any]:
    raw = _post_form(
        TOKEN_URL,
        {"grant_type": "refresh_token", "refresh_token": refresh_token, "client_id": CLIENT_ID},
    )
    return tokens_payload(raw, previous_refresh=refresh_token)


# ── Sign-in: one pending login at a time, callback served on localhost:1455 ──────────────────

_lock = threading.Lock()
_logins: dict[str, dict[str, Any]] = {}
_listener: http.server.HTTPServer | None = None

_DONE_PAGE = (
    "<!doctype html><meta charset='utf-8'><title>Signed in</title>"
    "<body style='font-family:sans-serif;background:#111;color:#eee;padding:2em'>"
    "<h2>Signed in to ChatGPT</h2><p>You can close this window and go back to Manim Timeline.</p>"
)
_FAIL_PAGE = (
    "<!doctype html><meta charset='utf-8'><title>Sign-in failed</title>"
    "<body style='font-family:sans-serif;background:#111;color:#eee;padding:2em'>"
    "<h2>Sign-in failed</h2><p>Go back to Manim Timeline for details.</p>"
)


class _CallbackHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args: Any) -> None:  # keep the server log quiet
        return

    def do_GET(self) -> None:  # noqa: N802 (http.server API)
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/auth/callback":
            self.send_response(404)
            self.end_headers()
            return
        query = urllib.parse.parse_qs(parsed.query)
        state = (query.get("state") or [""])[0]
        code = (query.get("code") or [""])[0]
        error = (query.get("error_description") or query.get("error") or [""])[0]
        with _lock:
            login = _logins.get(state)
        ok = False
        if login is None:
            error = error or "Unknown or expired sign-in."
        elif error or not code:
            login.update(status="error", error=error or "No authorization code returned.")
        else:
            try:
                login.update(status="done", tokens=exchange_code(code, login["verifier"]))
                ok = True
            except Exception as e:  # noqa: BLE001 — reported to the browser
                login.update(status="error", error=str(e))
        body = (_DONE_PAGE if ok else _FAIL_PAGE).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        if ok:
            threading.Thread(target=_stop_listener, daemon=True).start()


def _stop_listener() -> None:
    global _listener
    with _lock:
        listener, _listener = _listener, None
    if listener is not None:
        listener.shutdown()
        listener.server_close()


def start_login(open_browser: bool = False) -> dict[str, Any]:
    """Begin a sign-in: returns the URL to open and the state to poll with.

    ``open_browser`` opens the URL in this machine's default browser. The desktop app needs that:
    its window cannot open other pages.
    """
    global _listener
    verifier, challenge = make_pkce()
    state = _b64url(secrets.token_bytes(24))
    now = time.time()
    with _lock:
        for key in [k for k, v in _logins.items() if now - v["started"] > LOGIN_TIMEOUT_S]:
            _logins.pop(key, None)
        _logins[state] = {"verifier": verifier, "status": "pending", "started": now}
        need_listener = _listener is None
    if need_listener:
        try:
            listener = http.server.HTTPServer(("127.0.0.1", CALLBACK_PORT), _CallbackHandler)
        except OSError as e:
            with _lock:
                _logins.pop(state, None)
            raise RuntimeError(
                f"Port {CALLBACK_PORT} is busy (another Codex / OpenCode sign-in may be open): {e}"
            ) from None
        with _lock:
            _listener = listener
        threading.Thread(target=listener.serve_forever, daemon=True).start()
        threading.Timer(LOGIN_TIMEOUT_S, _stop_listener).start()
    url = build_authorize_url(challenge, state)
    opened = False
    if open_browser:
        try:
            opened = webbrowser.open(url)
        except Exception:
            opened = False
    return {"authorize_url": url, "state": state, "browser_opened": opened}


def login_status(state: str) -> dict[str, Any]:
    """`pending`, `done` (tokens returned once, then forgotten) or `error`."""
    with _lock:
        login = _logins.get(state)
        if login is None:
            return {"status": "error", "error": "Unknown or expired sign-in."}
        if time.time() - login["started"] > LOGIN_TIMEOUT_S and login["status"] == "pending":
            _logins.pop(state, None)
            return {"status": "error", "error": "Sign-in timed out."}
        if login["status"] == "done":
            _logins.pop(state, None)
            return {"status": "done", "tokens": login["tokens"]}
        if login["status"] == "error":
            _logins.pop(state, None)
            return {"status": "error", "error": login.get("error")}
        return {"status": "pending"}


# ── Codex instructions and Responses requests ───────────────────────────────────────────────

_instructions_cache: dict[str, tuple[float, str]] = {}
_INSTRUCTIONS_TTL_S = 3600


def _get_text(url: str, timeout: int = 20) -> str | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "manim-timeline"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8")
    except (urllib.error.URLError, TimeoutError):
        return None


def prompt_file_candidates(model: str) -> list[str]:
    """Codex prompt files to try for a model, most specific first."""
    m = model.strip().lower()
    names = [f"{m}_prompt.md", f"{m.replace('-', '_').replace('.', '_')}_prompt.md"]
    if "codex" in m:
        names.append("gpt_5_codex_prompt.md")
    names.append("prompt.md")
    seen: list[str] = []
    for n in names:
        if n not in seen:
            seen.append(n)
    return seen


def codex_instructions(model: str) -> str:
    """The Codex CLI's base instructions for *model* from the latest release (cached an hour).

    The backend expects the Codex instructions; the app's own system prompt goes in as a developer
    message instead.
    """
    cached = _instructions_cache.get(model)
    if cached and time.time() - cached[0] < _INSTRUCTIONS_TTL_S:
        return cached[1]
    tag = "main"
    release = _get_text("https://api.github.com/repos/openai/codex/releases/latest")
    if release:
        try:
            tag = json.loads(release).get("tag_name") or "main"
        except ValueError:
            tag = "main"
    for name in prompt_file_candidates(model):
        text = _get_text(f"https://raw.githubusercontent.com/openai/codex/{tag}/codex-rs/core/{name}")
        if text:
            _instructions_cache[model] = (time.time(), text)
            return text
    raise RuntimeError("Could not download the Codex instructions from GitHub.")


def parse_sse_final_response(lines: Any) -> dict[str, Any]:
    """Read an SSE stream of Responses events; return the final `response` object."""
    data_lines: list[str] = []
    for raw in lines:
        line = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else raw
        line = line.rstrip("\r\n")
        if line.startswith("data:"):
            data_lines.append(line[5:].strip())
            continue
        if line or not data_lines:
            continue
        payload = "\n".join(data_lines)
        data_lines = []
        if payload == "[DONE]":
            break
        try:
            event = json.loads(payload)
        except ValueError:
            continue
        kind = event.get("type")
        if kind in ("response.completed", "response.incomplete"):
            return event.get("response") or {}
        if kind in ("response.failed", "error"):
            err = (event.get("response") or {}).get("error") or event.get("error") or event
            raise RuntimeError(f"ChatGPT backend error: {json.dumps(err)[:1500]}")
    raise RuntimeError("The ChatGPT backend stream ended without a completed response.")


def codex_request_body(body: dict[str, Any]) -> dict[str, Any]:
    """Apply the backend's requirements to a Responses request from the browser."""
    model = str(body.get("model") or "").strip()
    if not model:
        raise ValueError("model is required")
    out = {k: v for k, v in body.items() if k not in ("max_output_tokens", "max_completion_tokens", "temperature")}
    out["instructions"] = codex_instructions(model)
    out["store"] = False
    out["stream"] = True
    include = list(out.get("include") or [])
    if "reasoning.encrypted_content" not in include:
        include.append("reasoning.encrypted_content")
    out["include"] = include
    return out


def send_responses(body: dict[str, Any], access_token: str, account_id: str) -> dict[str, Any]:
    payload = json.dumps(codex_request_body(body)).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {access_token}",
        "chatgpt-account-id": account_id,
        "OpenAI-Beta": "responses=experimental",
        "originator": "codex_cli_rs",
    }
    req = urllib.request.Request(CODEX_RESPONSES_URL, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            return parse_sse_final_response(resp)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:2000]
        if e.code in (401, 403):
            raise PermissionError(f"ChatGPT backend refused the request ({e.code}): {detail}") from None
        raise RuntimeError(f"ChatGPT backend request failed ({e.code}): {detail}") from None
