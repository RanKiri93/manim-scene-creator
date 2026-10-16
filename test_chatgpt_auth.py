"""Tests for chatgpt_auth (no network: sign-in callback and backend calls are not exercised)."""

import base64
import hashlib
import json
import time
import urllib.parse

import pytest

import chatgpt_auth as ca


def _jwt(claims: dict) -> str:
    def enc(obj: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    return f"{enc({'alg': 'none'})}.{enc(claims)}.sig"


def test_pkce_challenge_is_s256_of_verifier():
    verifier, challenge = ca.make_pkce()
    expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    assert challenge == expected
    assert 43 <= len(verifier) <= 128


def test_authorize_url_has_codex_parameters():
    url = ca.build_authorize_url("chal", "st")
    parsed = urllib.parse.urlparse(url)
    q = dict(urllib.parse.parse_qsl(parsed.query))
    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == "https://auth.openai.com/oauth/authorize"
    assert q["client_id"] == ca.CLIENT_ID
    assert q["redirect_uri"] == "http://localhost:1455/auth/callback"
    assert q["code_challenge"] == "chal" and q["code_challenge_method"] == "S256"
    assert q["state"] == "st"
    assert q["scope"] == "openid profile email offline_access"
    assert q["codex_cli_simplified_flow"] == "true"


def test_tokens_payload_reads_account_from_id_token():
    id_token = _jwt({"email": "a@b.c", ca.JWT_AUTH_CLAIM: {"chatgpt_account_id": "acct_1", "chatgpt_plan_type": "plus"}})
    before = time.time() * 1000
    out = ca.tokens_payload({"access_token": "acc", "refresh_token": "ref", "id_token": id_token, "expires_in": 60})
    assert out["accountId"] == "acct_1" and out["email"] == "a@b.c" and out["plan"] == "plus"
    assert out["refresh"] == "ref"
    assert before + 59_000 <= out["expires"] <= before + 61_000 + 1000


def test_tokens_payload_keeps_previous_refresh_and_requires_account():
    access = _jwt({ca.JWT_AUTH_CLAIM: {"chatgpt_account_id": "acct_2"}})
    assert ca.tokens_payload({"access_token": access}, previous_refresh="old")["refresh"] == "old"
    with pytest.raises(RuntimeError):
        ca.tokens_payload({"access_token": _jwt({})})


def test_prompt_file_candidates():
    assert ca.prompt_file_candidates("gpt-5.1-codex")[:3] == [
        "core/gpt-5.1-codex_prompt.md",
        "core/gpt_5_1_codex_prompt.md",
        "core/gpt_5_codex_prompt.md",
    ]
    assert ca.prompt_file_candidates("gpt-5.2")[-2:] == ["models-manager/prompt.md", "core/prompt.md"]


def test_instructions_come_from_the_bundled_model_list(monkeypatch):
    models = {"models": [{"slug": "gpt-6.1-sol", "model_messages": {"instructions_template": "You are Codex."}}]}
    fetched: list[str] = []

    def fake_get(url, timeout=20):
        fetched.append(url)
        return json.dumps(models) if url.endswith("models-manager/models.json") else None

    monkeypatch.setattr(ca, "_get_text", fake_get)
    monkeypatch.setattr(ca, "latest_codex_tag", lambda: "rust-v0.163.0")
    monkeypatch.setattr(ca, "_instructions_cache", {})
    assert ca.codex_instructions("gpt-6.1-sol") == "You are Codex."
    assert fetched == ["https://raw.githubusercontent.com/openai/codex/rust-v0.163.0/codex-rs/models-manager/models.json"]
    # A model missing from the list falls back to the prompt files, ending at the generic prompt.
    monkeypatch.setattr(ca, "_get_text", lambda url, timeout=20: "generic" if url.endswith("models-manager/prompt.md") else None)
    assert ca.codex_instructions("gpt-unknown") == "generic"


def test_sse_returns_completed_response_and_raises_on_failure():
    ok = [
        b"event: response.created\n",
        b'data: {"type":"response.created"}\n',
        b"\n",
        b'data: {"type":"response.completed","response":{"output":[{"type":"message"}]}}\n',
        b"\n",
    ]
    assert ca.parse_sse_final_response(ok) == {"output": [{"type": "message"}]}
    failed = [b'data: {"type":"response.failed","response":{"error":{"message":"bad instructions"}}}\n', b"\n"]
    with pytest.raises(RuntimeError, match="bad instructions"):
        ca.parse_sse_final_response(failed)
    with pytest.raises(RuntimeError):
        ca.parse_sse_final_response([b"\n"])


def test_codex_request_body(monkeypatch):
    monkeypatch.setattr(ca, "codex_instructions", lambda model: f"INSTR {model}")
    out = ca.codex_request_body({"model": "gpt-5.1", "input": [], "max_output_tokens": 5, "include": ["x"]})
    assert out["instructions"] == "INSTR gpt-5.1"
    assert out["store"] is False and out["stream"] is True
    assert out["include"] == ["x", "reasoning.encrypted_content"]
    assert "max_output_tokens" not in out
    with pytest.raises(ValueError):
        ca.codex_request_body({"input": []})


def test_login_status_lifecycle():
    ca._logins["s1"] = {"verifier": "v", "status": "pending", "started": time.time()}
    assert ca.login_status("s1") == {"status": "pending"}
    ca._logins["s1"].update(status="done", tokens={"access": "a"})
    assert ca.login_status("s1") == {"status": "done", "tokens": {"access": "a"}}
    assert ca.login_status("s1")["status"] == "error"  # handed out once
    ca._logins["s2"] = {"verifier": "v", "status": "pending", "started": time.time() - ca.LOGIN_TIMEOUT_S - 1}
    assert ca.login_status("s2") == {"status": "error", "error": "Sign-in timed out."}


def test_start_login_opens_the_browser_only_when_asked(monkeypatch):
    opened: list[str] = []
    monkeypatch.setattr(ca, "_listener", object())  # pretend the callback listener is running
    monkeypatch.setattr(ca.webbrowser, "open", lambda url: opened.append(url) or True)
    plain = ca.start_login()
    assert plain["browser_opened"] is False and opened == []
    started = ca.start_login(open_browser=True)
    assert started["browser_opened"] is True
    assert opened == [started["authorize_url"]]
    assert started["authorize_url"].startswith(ca.AUTHORIZE_URL)
    for s in (plain["state"], started["state"]):
        ca._logins.pop(s, None)


def test_client_version_from_release_tag():
    assert ca.client_version_from_tag("rust-v0.160.0") == "0.160.0"
    assert ca.client_version_from_tag("0.161.2") == "0.161.2"
    assert ca.client_version_from_tag("nightly") == ca.FALLBACK_CLIENT_VERSION
    assert ca.client_version_from_tag(None) == ca.FALLBACK_CLIENT_VERSION


def test_parse_models_drops_hidden_and_sorts_by_priority():
    data = {
        "models": [
            {"slug": "b", "display_name": "B", "priority": 5, "visibility": "list"},
            {"slug": "hidden", "priority": 0, "visibility": "hide"},
            {"slug": "a", "display_name": "A", "description": "best", "priority": 1},
            {"slug": "c"},
            {"display_name": "no slug"},
        ]
    }
    assert ca.parse_models(data) == [
        {"id": "a", "name": "A", "description": "best"},
        {"id": "b", "name": "B", "description": ""},
        {"id": "c", "name": "c", "description": ""},
    ]
    assert ca.parse_models({"unexpected": True}) == []
