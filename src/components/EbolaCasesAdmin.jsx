import { useState } from "react";

import { apiDelete, apiPost } from "../lib/api.js";
import { panel } from "../lib/ui.js";

const input = { padding:"0.45rem", fontSize:13, fontFamily:"var(--font-mono)" };

/**
 * Admin-only "Ebola (MoH)" tab. Records Ministry of Health confirmed Ebola
 * figures; the backend rejects any source that is not an @MOH_Kenya post or
 * a health.go.ke page. The metric card shows the newest entry.
 *
 * @param {{ cases: object[], onChange: () => void }} props
 */
export default function EbolaCasesAdmin({ cases, onChange }) {
  const [form, setForm] = useState({ reported_on: new Date().toISOString().slice(0, 10), confirmed: "", deaths: "0", source_url: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await apiPost("/ebola", { ...form, confirmed: Number(form.confirmed), deaths: Number(form.deaths), note: form.note || null });
      setForm(f => ({ ...f, confirmed: "", deaths: "0", source_url: "", note: "" }));
      onChange();
    } catch (err) {
      setError(err.message || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!confirm("Delete this MoH entry?")) return;
    try { await apiDelete(`/ebola/${id}`); onChange(); }
    catch (err) { setError(err.message || "Could not delete"); }
  };

  return (
    <div style={{ padding:"1rem" }}>
      <p style={{ margin:"0 0 4px", fontWeight:500, fontSize:13 }}>Record a MoH-confirmed Ebola figure</p>
      <p style={{ margin:"0 0 10px", fontSize:12, color:"var(--color-text-secondary)" }}>
        Cumulative confirmed cases as stated by the Ministry of Health. Source must be an @MOH_Kenya post or a health.go.ke page. Media reports are never counted here.
      </p>
      <form onSubmit={submit} style={{ ...panel, padding:"0.75rem", marginBottom:14 }}>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:8 }}>
          <input type="date" value={form.reported_on} onChange={set("reported_on")} required style={{ ...input, flex:"1 1 140px" }} />
          <input type="number" min={0} value={form.confirmed} onChange={set("confirmed")} placeholder="confirmed cases" required style={{ ...input, flex:"1 1 120px" }} />
          <input type="number" min={0} value={form.deaths} onChange={set("deaths")} placeholder="deaths" required style={{ ...input, flex:"1 1 90px" }} />
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:8 }}>
          <input type="url" value={form.source_url} onChange={set("source_url")} placeholder="https://x.com/MOH_Kenya/status/…" required style={{ ...input, flex:"2 1 240px" }} />
          <input value={form.note} onChange={set("note")} placeholder="note (optional)" maxLength={500} style={{ ...input, flex:"1 1 160px" }} />
        </div>
        {error && <p style={{ margin:"0 0 8px", fontSize:12, color:"var(--color-text-danger)" }}>{error}</p>}
        <button type="submit" disabled={saving || form.confirmed === "" || !form.source_url}
          style={{ width:"100%", padding:"0.5rem", borderRadius:"var(--border-radius-md)", border:"0.5px solid var(--color-border-secondary)", background:"var(--color-background-info)", color:"var(--color-text-info)", cursor: saving ? "not-allowed" : "pointer", fontWeight:500, fontSize:13 }}>
          {saving ? "Saving…" : "Save MoH figure"}
        </button>
      </form>

      <p style={{ margin:"0 0 8px", fontWeight:500, fontSize:13 }}>Recorded figures (newest first)</p>
      {cases.length === 0 && <p style={{ margin:0, fontSize:12, color:"var(--color-text-secondary)" }}>None recorded. The card shows "—" until the MoH confirms a figure.</p>}
      {cases.map(c => (
        <div key={c.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"0.6rem 0.7rem", background:"var(--color-background-secondary)", borderRadius:"var(--border-radius-md)", marginBottom:6 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ margin:0, fontSize:13, fontWeight:500, fontFamily:"var(--font-mono)" }}>
              {c.reported_on} · {c.confirmed} confirmed · {c.deaths} deaths
            </p>
            <p style={{ margin:0, fontSize:12, color:"var(--color-text-tertiary)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              <a href={c.source_url} target="_blank" rel="noreferrer" style={{ color:"var(--color-text-info)" }}>{c.source_url}</a>
              {c.note && ` · ${c.note}`}
            </p>
          </div>
          <button onClick={() => remove(c.id)}
            style={{ fontSize:12, padding:"0.3rem 0.6rem", borderRadius:4, border:"0.5px solid var(--color-border-secondary)", background:"transparent", color:"var(--color-text-danger)", cursor:"pointer" }}>
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
