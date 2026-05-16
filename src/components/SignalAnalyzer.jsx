import { useState } from "react";

import { analyzeSignal, OLLAMA_MODEL } from "../lib/ollama.js";
import { sevBg, sevTextVar } from "../lib/risk.js";
import { panel } from "../lib/ui.js";

/**
 * AI Signal Analyzer — sends signal text to a local Ollama model and renders
 * the structured assessment it returns. Owns its own request state; `text`
 * is lifted so the parent can populate it when a feed signal is clicked.
 *
 * @param {{ text: string, setText: (v: string) => void,
 *           selectedCounty: string|undefined }} props
 */
export default function SignalAnalyzer({ text, setText, selectedCounty }) {
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const r = await analyzeSignal(text, selectedCounty);
      setAnalysis(r);
    } catch (e) {
      setAnalysis({ _error: e.message });
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div style={{ ...panel, padding:"1rem" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
        <i className="ti ti-sparkles" style={{ fontSize:15 }} aria-hidden="true" />
        <p style={{ margin:0, fontWeight:500, fontSize:13 }}>AI Signal Analyzer</p>
        <span style={{ fontSize:12, fontFamily:"var(--font-mono)", padding:"1px 6px", borderRadius:3, background:"var(--color-background-secondary)", color:"var(--color-text-secondary)" }}>
          local · {OLLAMA_MODEL}
        </span>
      </div>
      <p style={{ margin:"0 0 8px", fontSize:12, color:"var(--color-text-secondary)" }}>
        Click any signal in the feed, or paste text from Twitter/news:
      </p>
      <textarea value={text} onChange={e => setText(e.target.value)}
        placeholder="e.g. 'Several cows dying in Baringo, vet teams dispatched, residents told not to touch carcasses...'"
        rows={3}
        style={{ width:"100%", boxSizing:"border-box", resize:"vertical", fontFamily:"var(--font-mono)", fontSize:12, marginBottom:8 }} />
      <button onClick={handleAnalyze} disabled={analyzing || !text.trim()}
        style={{ width:"100%", padding:"0.5rem", borderRadius:"var(--border-radius-md)", border:"0.5px solid var(--color-border-secondary)", background:"var(--color-background-secondary)", cursor: text.trim() ? "pointer" : "not-allowed", fontWeight:500, fontSize:13, marginBottom:10 }}>
        {analyzing ? "Analyzing…" : "Analyze ↗"}
      </button>

      {analysis && !analysis._error && (
        <div style={{ background:"var(--color-background-secondary)", borderRadius:"var(--border-radius-md)", padding:"0.75rem" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
            <p style={{ margin:0, fontWeight:500, fontSize:13 }}>{analysis.disease}</p>
            <div style={{ display:"flex", gap:6 }}>
              <span style={{ fontSize:12, padding:"2px 7px", borderRadius:3, background:sevBg(analysis.severity), color:sevTextVar(analysis.severity), fontFamily:"var(--font-mono)" }}>{analysis.severity}</span>
              <span style={{ fontSize:12, padding:"2px 7px", borderRadius:3, background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", fontFamily:"var(--font-mono)" }}>
                {Math.round((analysis.confidence||0)*100)}%
              </span>
            </div>
          </div>
          {analysis.transmission_risk && (
            <p style={{ margin:"0 0 6px", fontSize:12, color:"var(--color-text-secondary)" }}>{analysis.transmission_risk}</p>
          )}
          {analysis.kenya_context && (
            <p style={{ margin:"0 0 6px", fontSize:12, color:"var(--color-text-secondary)" }}>
              <strong style={{ color:"var(--color-text-primary)" }}>Kenya context: </strong>{analysis.kenya_context}
            </p>
          )}
          {analysis.weather_correlation && (
            <p style={{ margin:"0 0 8px", fontSize:12, color:"var(--color-text-secondary)" }}>
              <i className="ti ti-cloud" style={{ fontSize:12, marginRight:3 }} aria-hidden="true" />
              {analysis.weather_correlation}
            </p>
          )}
          {analysis.recommended_actions?.length > 0 && (
            <div>
              <p style={{ margin:"0 0 4px", fontSize:12, fontWeight:500 }}>Recommended actions:</p>
              {analysis.recommended_actions.map((a,i) => (
                <p key={i} style={{ margin:"2px 0", fontSize:12, color:"var(--color-text-secondary)", display:"flex", gap:6 }}>
                  <i className="ti ti-arrow-right" style={{ fontSize:12, marginTop:2, flexShrink:0 }} aria-hidden="true" />{a}
                </p>
              ))}
            </div>
          )}
          {analysis.hosts?.length > 0 && (
            <p style={{ margin:"8px 0 0", fontSize:12, color:"var(--color-text-tertiary)" }}>
              Affected hosts: {analysis.hosts.join(", ")}
            </p>
          )}
        </div>
      )}
      {analysis?._error && (
        <p style={{ margin:0, fontSize:12, color:"var(--color-text-danger)" }}>Error: {analysis._error}</p>
      )}
    </div>
  );
}
