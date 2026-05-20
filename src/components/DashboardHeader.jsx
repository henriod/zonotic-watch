/**
 * Top bar — branding plus at-a-glance status (alert level, signal count,
 * last scan time, and a pulsing LIVE indicator). Renders a user pill on
 * the right with sign in / sign out depending on auth state.
 */
export default function DashboardHeader({
  overallRisk,
  overallRiskColor,
  signalCount,
  scanTime,
  pulse,
  user,
  onLogout,
}) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"1rem 1.5rem", borderBottom:"0.5px solid var(--color-border-tertiary)", marginBottom:"1rem" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ width:38, height:38, borderRadius:"50%", background:overallRiskColor, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <i className="ti ti-virus" style={{ fontSize:18, color:"#fff" }} aria-hidden="true" />
        </div>
        <div>
          <p style={{ margin:0, fontWeight:500, fontSize:16 }}>ZonoticWatch Kenya</p>
          <p style={{ margin:0, fontSize:12, color:"var(--color-text-secondary)", fontFamily:"var(--font-mono)" }}>
            Zoonotic Early Warning · GDELT + Apify + Ollama
          </p>
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:20 }}>
        <div style={{ textAlign:"center" }}>
          <p style={{ margin:0, fontSize:12, color:"var(--color-text-secondary)" }}>Alert Level</p>
          <p style={{ margin:0, fontWeight:500, fontSize:13, color:overallRiskColor, fontFamily:"var(--font-mono)" }}>{overallRisk}</p>
        </div>
        <div style={{ textAlign:"center" }}>
          <p style={{ margin:0, fontSize:12, color:"var(--color-text-secondary)" }}>Signals</p>
          <p style={{ margin:0, fontWeight:500, fontSize:13, fontFamily:"var(--font-mono)" }}>{signalCount}</p>
        </div>
        <div style={{ textAlign:"center" }}>
          <p style={{ margin:0, fontSize:12, color:"var(--color-text-secondary)" }}>Last scan</p>
          <p style={{ margin:0, fontWeight:500, fontSize:12, fontFamily:"var(--font-mono)" }}>{scanTime.toLocaleTimeString()}</p>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <div style={{ width:7, height:7, borderRadius:"50%", background:"#27ae60", opacity: pulse ? 1 : 0.4, transition:"opacity 0.5s" }} />
          <span style={{ fontSize:12, color:"var(--color-text-secondary)" }}>LIVE</span>
        </div>
        {user ? (
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 10px", borderRadius:"var(--border-radius-md)", background:"var(--color-background-secondary)" }}>
            <i className="ti ti-user" style={{ fontSize:13, color:"var(--color-text-secondary)" }} aria-hidden="true" />
            <span style={{ fontSize:12, fontFamily:"var(--font-mono)" }}>{user.username}</span>
            {user.role === "admin" && (
              <span style={{ fontSize:12, padding:"1px 5px", borderRadius:3, background:"var(--color-background-info)", color:"var(--color-text-info)", fontFamily:"var(--font-mono)" }}>admin</span>
            )}
            <button onClick={onLogout}
              style={{ fontSize:12, padding:"2px 6px", borderRadius:3, border:"0.5px solid var(--color-border-tertiary)", background:"transparent", color:"var(--color-text-secondary)", cursor:"pointer" }}>
              Sign out
            </button>
          </div>
        ) : user === null ? (
          <a href="/login" style={{ fontSize:12, padding:"4px 10px", borderRadius:"var(--border-radius-md)", background:"var(--color-background-info)", color:"var(--color-text-info)", textDecoration:"none", fontWeight:500 }}>
            Sign in
          </a>
        ) : null}
      </div>
    </div>
  );
}
