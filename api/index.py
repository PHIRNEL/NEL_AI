"""Moteur de prédiction NEL_AI : Poisson + Elo. Aucune donnée n'est inventée ici."""
import numpy as np
MAXG = 10

def _pmf(lam):
    return np.array([exp(-lam) * lam ** k / factorial(k) for k in range(MAXG + 1)])
from math import exp, factorial

MARKETS = {
    "1": lambda h, a: h > a, "X": lambda h, a: h == a, "2": lambda h, a: h < a,
    "1X": lambda h, a: h >= a, "X2": lambda h, a: h <= a, "12": lambda h, a: h != a,
    "O1.5": lambda h, a: h + a > 1.5, "U1.5": lambda h, a: h + a < 1.5,
    "O2.5": lambda h, a: h + a > 2.5, "U2.5": lambda h, a: h + a < 2.5,
    "O3.5": lambda h, a: h + a > 3.5, "U3.5": lambda h, a: h + a < 3.5,
    "BTTS_Y": lambda h, a: h > 0 and a > 0, "BTTS_N": lambda h, a: h == 0 or a == 0,
}

def elo_expected(elo_h, elo_a, home_adv=65):
    return 1 / (1 + 10 ** (-(elo_h + home_adv - elo_a) / 400))

def expected_goals(s):
    """s: dict avec moyennes buts marqués/encaissés (dom. pour home, ext. pour away),
    moyennes de la ligue, et Elo optionnel."""
    lh = s["league_home_goals"] * (s["home_scored"] / s["league_home_goals"]) * (s["away_conceded"] / s["league_home_goals"])
    la = s["league_away_goals"] * (s["away_scored"] / s["league_away_goals"]) * (s["home_conceded"] / s["league_away_goals"])
    if s.get("elo_home") and s.get("elo_away"):
        e = elo_expected(s["elo_home"], s["elo_away"]) - 0.5
        lh *= 1 + 0.5 * e; la *= 1 - 0.5 * e
    return max(lh, 0.05), max(la, 0.05)

def score_matrix(lh, la, rho=-0.08):
    """Poisson bivarié avec correction Dixon-Coles sur les petits scores."""
    m = np.outer(_pmf(lh), _pmf(la))
    m[0, 0] *= 1 - lh * la * rho; m[0, 1] *= 1 + lh * rho
    m[1, 0] *= 1 + la * rho; m[1, 1] *= 1 - rho
    return m / m.sum()

def prob(m, market):
    f = MARKETS[market]
    return float(sum(m[h, a] for h in range(MAXG + 1) for a in range(MAXG + 1) if f(h, a)))

def predict(s):
    lh, la = expected_goals(s)
    m = score_matrix(lh, la)
    scores = sorted(((f"{h}-{a}", float(m[h, a])) for h in range(6) for a in range(6)), key=lambda x: -x[1])
    p = {k: prob(m, k) for k in MARKETS}
    top = scores[0][1]
    conf = "faible" if top < 0.11 else "moyenne" if top < 0.16 else "élevée"
    return {
        "xg_home": round(lh, 2), "xg_away": round(la, 2),
        "result": {"home": p["1"], "draw": p["X"], "away": p["2"]},
        "exact_scores": [{"score": k, "probability": v} for k, v in scores[:6]],
        "markets": p, "confidence": conf,
        "explanation": [
            f"Buts attendus : {lh:.2f} (domicile) contre {la:.2f} (extérieur).",
            "Le score le plus probable ne dépasse rarement 20 % : aucun score n'est certain.",
        ],
    }

def ticket(selections, stake):
    """selections: [{match_id, market, odds, xg_home, xg_away}]. Dépendances gérées
    pour les marchés d'un même match via la matrice de scores commune."""
    by_match = {}
    for s in selections:
        by_match.setdefault(s["match_id"], []).append(s)
    total_p, total_odds = 1.0, 1.0
    for sels in by_match.values():
        m = score_matrix(sels[0]["xg_home"], sels[0]["xg_away"])
        total_p *= float(sum(m[h, a] for h in range(MAXG + 1) for a in range(MAXG + 1)
                             if all(MARKETS[x["market"]](h, a) for x in sels)))
    for s in selections:
        total_odds *= s["odds"]
    return {"combined_odds": round(total_odds, 2), "gross_return": round(total_odds * stake),
            "profit": round(total_odds * stake - stake), "success_probability": total_p,
            "implied_probability": 1 / total_odds, "value_edge": total_p - 1 / total_odds}

# ---- API ----
import os, httpx
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="NEL_AI")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
API_KEY = os.getenv("API_FOOTBALL_KEY")  # https://www.api-football.com
BASE = "https://v3.football.api-sports.io"

class Stats(BaseModel):
    home_scored: float; home_conceded: float
    away_scored: float; away_conceded: float
    league_home_goals: float = 1.5; league_away_goals: float = 1.2
    elo_home: float | None = None; elo_away: float | None = None

class Sel(BaseModel):
    match_id: str; market: str; odds: float; xg_home: float; xg_away: float

class TicketIn(BaseModel):
    selections: list[Sel]; stake: float

@app.get("/api/fixtures")
async def fixtures(date: str | None = None):
    now = datetime.now(timezone.utc)
    if not API_KEY:
        return {"available": False, "updated": now.isoformat(), "source": None,
                "message": "Clé API_FOOTBALL_KEY absente : matchs indisponibles. Utilisez la saisie manuelle."}
    date = date or now.strftime("%Y-%m-%d")
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(f"{BASE}/fixtures", params={"date": date}, headers={"x-apisports-key": API_KEY})
    if r.status_code != 200:
        raise HTTPException(502, "API sportive indisponible")
    return {"available": True, "updated": now.isoformat(), "source": "API-Football", "data": r.json()["response"]}

@app.post("/api/predict")
def api_predict(s: Stats):
    return predict(s.model_dump())

@app.post("/api/ticket")
def api_ticket(t: TicketIn):
    if not t.selections or any(x.market not in MARKETS for x in t.selections):
        raise HTTPException(400, "Sélection invalide")
    return ticket([x.model_dump() for x in t.selections], t.stake)
