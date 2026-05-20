"""AI Signal Analyzer — proxies the browser's request to Ollama Cloud.

The OLLAMA_API_KEY lives in backend settings only, so it never reaches the
browser bundle (the same pattern used for APIFY_TOKEN). The request and
response shapes match what the old browser-direct `src/lib/ollama.js`
sent, so the frontend just swaps the URL.
"""

import json

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.db.models import User
from app.security import require_user

router = APIRouter(tags=["analyze"])

_SYSTEM_PROMPT = (
    "You are a WHO-trained zoonotic disease surveillance expert specializing "
    "in East Africa and Kenya.\n"
    "Analyze the social media or news signal for zoonotic disease indicators.\n"
    "Respond with ONLY a JSON object — no preamble, no markdown — matching "
    "exactly this shape:\n"
    "{\n"
    '  "disease": "most likely disease name",\n'
    '  "confidence": 0.0-1.0,\n'
    '  "severity": "LOW|MEDIUM|HIGH|CRITICAL",\n'
    '  "hosts": ["animal types"],\n'
    '  "transmission_risk": "one sentence on spillover risk",\n'
    '  "recommended_actions": ["action 1","action 2","action 3"],\n'
    '  "weather_correlation": "how weather amplifies this risk",\n'
    '  "kenya_context": "specific Kenya/regional note"\n'
    "}"
)


class AnalyzeIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    loc: str | None = None


@router.get("/analyze/info")
async def analyze_info(settings: Settings = Depends(get_settings)) -> dict:
    """Which model the analyzer will use — surfaced for the UI badge."""
    return {
        "provider": "ollama-cloud",
        "model": settings.ollama_model,
        "configured": bool(settings.ollama_api_key),
    }


@router.post("/analyze")
async def analyze(
    payload: AnalyzeIn,
    _user: User = Depends(require_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    if not settings.ollama_api_key:
        raise HTTPException(
            503,
            "Analyzer not configured: OLLAMA_API_KEY is unset in backend settings.",
        )

    body = {
        "model": settings.ollama_model,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.3},
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f'Location: {payload.loc or "Kenya"}\nSignal: "{payload.text}"',
            },
        ],
    }

    url = f"{settings.ollama_api_url.rstrip('/')}/api/chat"
    headers = {"Authorization": f"Bearer {settings.ollama_api_key}"}
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(url, headers=headers, json=body)
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Cannot reach Ollama Cloud: {exc}") from exc

    if res.status_code == 404:
        raise HTTPException(
            502, f"Model '{settings.ollama_model}' not found on Ollama Cloud."
        )
    if res.status_code == 401:
        raise HTTPException(502, "Ollama Cloud rejected the API key.")
    if not res.is_success:
        raise HTTPException(
            502, f"Ollama Cloud {res.status_code}: {res.text[:200]}"
        )

    raw = (res.json().get("message", {}).get("content") or "").strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    if not raw:
        raise HTTPException(502, "Empty response from the model.")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(502, "Model did not return valid JSON.") from exc
