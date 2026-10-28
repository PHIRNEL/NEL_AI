import { useEffect, useState } from "react";
const pct = (x) => (x * 100).toFixed(1) + " %";
const post = (u, b) => fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const FIELDS = [["home_scored", "Buts marqués / match (dom.)"], ["home_conceded", "Buts encaissés / match (dom.)"],
  ["away_scored", "Buts marqués / match (ext.)"], ["away_conceded", "Buts encaissés / match (ext.)"],
  ["elo_home", "Elo domicile (optionnel)"], ["elo_away", "Elo extérieur (optionnel)"]];

export default function App() {
  const [fx, setFx] = useState(null);
  const [v, setV] = useState({ home_scored: 1.6, home_conceded: 1.1, away_scored: 1.2, away_conceded: 1.4 });
  const [pred, setPred] = useState(null);
  const [ticket, setTicket] = useState([]);
  const [stake, setStake] = useState(1000);
  const [tres, setTres] = useState(null);
  const [odds, setOdds] = useState({});
  const [history, setHistory] = useState([]);

  useEffect(() => { fetch("/api/fixtures").then((r) => r.json()).then(setFx).catch(() => setFx({ available: false, message: "Backend injoignable." })); }, []);

  const run = async () => {
    const body = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "" && x != null).map(([k, x]) => [k, +x]));
    const p = await post("/api/predict", body);
    setPred(p); setHistory((h) => [{ t: new Date().toLocaleTimeString("fr-FR"), top: p.exact_scores[0] }, ...h].slice(0, 20));
  };
  const add = (market) => { if (!odds[market]) return alert("Saisissez la cote du bookmaker pour ce marché."); setTicket([...ticket, { match_id: "m1", market, odds: +odds[market], xg_home: pred.xg_home, xg_away: pred.xg_away }]); setTres(null); };
  const calc = async () => setTres(await post("/api/ticket", { selections: ticket, stake: +stake }));

  const Card = ({ title, children }) => <section className="bg-white rounded-lg border border-pitch/15 p-4">{title && <h2 className="font-semibold text-pitch mb-3">{title}</h2>}{children}</section>;

  return (
    <div className="min-h-screen">
      <header className="bg-pitch text-chalk px-6 py-4 flex flex-wrap items-baseline gap-x-4">
        <h1 className="text-2xl font-bold tracking-tight">NEL_AI</h1>
        <p className="text-sm opacity-80">Pronostics football : scores exacts, Poisson et Elo. Les probabilités ne sont jamais des certitudes.</p>
      </header>
      <main className="max-w-6xl mx-auto p-4 grid gap-4 lg:grid-cols-3">
        <Card title="Matchs du jour">
          {!fx ? "Chargement…" : fx.available
            ? <><ul className="text-sm space-y-1 max-h-64 overflow-auto">{fx.data.slice(0, 30).map((m) => <li key={m.fixture.id}>{m.teams.home.name} – {m.teams.away.name}</li>)}</ul>
                <p className="text-xs text-slate-500 mt-2">Source : {fx.source} · mis à jour {new Date(fx.updated).toLocaleString("fr-FR")}</p></>
            : <p className="text-sm text-amber-800">{fx.message}</p>}
        </Card>

        <Card title="Analyse d'un match (saisie manuelle)">
          <div className="grid grid-cols-2 gap-2">
            {FIELDS.map(([k, l]) => <label key={k} className="text-xs text-slate-600">{l}
              <input type="number" step="0.01" value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: e.target.value })} className="mt-1 w-full border rounded px-2 py-1 text-sm" /></label>)}
          </div>
          <button onClick={run} className="mt-3 w-full bg-pitch text-chalk rounded py-2 font-medium">Calculer les probabilités</button>
        </Card>

        <Card title="Historique (session)">
          {history.length === 0 ? <p className="text-sm text-slate-500">Aucune prédiction pour l'instant. Lancez une analyse.</p>
            : <ul className="text-sm space-y-1">{history.map((h, i) => <li key={i}>{h.t} · score le plus probable {h.top.score} ({pct(h.top.probability)})</li>)}</ul>}
          <p className="text-xs text-slate-500 mt-2">La sauvegarde PostgreSQL et le taux de réussite arrivent en V2.</p>
        </Card>

        {pred && <>
          <Card title="Scores exacts, du plus au moins probable">
            <ol className="space-y-2">{pred.exact_scores.map((s) => <li key={s.score} className="flex items-center gap-3">
              <span className="w-12 font-mono font-bold">{s.score}</span>
              <div className="flex-1 bg-pitch/10 rounded h-3"><div className="bg-pitch h-3 rounded" style={{ width: `${Math.min(100, s.probability * 400)}%` }} /></div>
              <span className="w-16 text-right text-sm">{pct(s.probability)}</span></li>)}</ol>
            <p className="text-xs text-slate-500 mt-3">Buts attendus : {pred.xg_home} – {pred.xg_away} · confiance {pred.confidence}</p>
            {pred.explanation.map((e, i) => <p key={i} className="text-sm mt-1">{e}</p>)}
          </Card>
          <Card title="Résultat">
            {[["Victoire domicile", pred.result.home], ["Match nul", pred.result.draw], ["Victoire extérieur", pred.result.away]].map(([l, x]) => <div key={l} className="flex justify-between text-sm py-1"><span>{l}</span><b>{pct(x)}</b></div>)}
          </Card>
          <Card title="Marchés (cliquez pour ajouter au ticket)">
            <div className="grid grid-cols-2 gap-2 text-sm">{Object.entries(pred.markets).map(([m, x]) => <div key={m} className="flex items-center gap-1">
              <button onClick={() => add(m)} className="border border-pitch/30 rounded px-1.5 py-0.5 hover:bg-amber/20 whitespace-nowrap">{m} · {pct(x)}</button>
              <input placeholder="cote" type="number" step="0.01" className="w-14 border rounded px-1 py-0.5" onChange={(e) => setOdds({ ...odds, [m]: e.target.value })} /></div>)}</div>
          </Card>
        </>}

        <div className="lg:col-span-3"><Card title="Générateur de ticket">
          {ticket.length === 0 ? <p className="text-sm text-slate-500">Ajoutez des marchés avec leur cote réelle.</p> :
            <><ul className="text-sm mb-3">{ticket.map((t, i) => <li key={i}>{t.market} @ {t.odds} <button className="text-red-700 ml-2" onClick={() => setTicket(ticket.filter((_, j) => j !== i))}>retirer</button></li>)}</ul>
              <label className="text-sm">Mise (FCFA) <input type="number" value={stake} onChange={(e) => setStake(e.target.value)} className="border rounded px-2 py-1 ml-2 w-32" /></label>
              <button onClick={calc} className="ml-3 bg-amber text-black rounded px-4 py-1.5 font-medium">Calculer</button></>}
          {tres && <div className="mt-3 grid sm:grid-cols-4 gap-3 text-sm">
            <div>Cote combinée<br /><b>{tres.combined_odds}</b></div><div>Gain brut<br /><b>{tres.gross_return.toLocaleString("fr-FR")} FCFA</b></div>
            <div>Bénéfice<br /><b>{tres.profit.toLocaleString("fr-FR")} FCFA</b></div><div>Probabilité estimée<br /><b>{pct(tres.success_probability)}</b></div></div>}
          <p className="text-xs text-slate-500 mt-3">Les sélections d'un même match sont calculées avec leurs dépendances. Jouez avec modération.</p>
        </Card></div>
      </main>
    </div>
  );
}
