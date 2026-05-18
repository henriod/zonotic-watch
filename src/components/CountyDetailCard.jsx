import { riskColor, riskBg } from "../lib/risk.js";

/**
 * Detail card for the county selected on the map — case counts, current
 * weather, headline disease, and a risk bar.
 *
 * @param {{ county: object, wx: { temp: number, hum: number, rain: number } }} props
 */
export default function CountyDetailCard({ county, wx }) {
  return (
    <div style={{ marginTop:10, padding:"0.75rem", background:"var(--color-background-secondary)", borderRadius:"var(--border-radius-md)", width:"100%", boxSizing:"border-box" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <p style={{ margin:0, fontWeight:500, fontSize:13 }}>{county.name} County</p>
        <span style={{ fontSize:12, padding:"2px 8px", borderRadius:4, background:riskBg(county.risk), color: county.risk>=0.65?"var(--color-text-danger)":"var(--color-text-warning)", fontFamily:"var(--font-mono)" }}>
          Risk {Math.round(county.risk*100)}%
        </span>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
        {[
          ["Human",     county.human ?? 0],
          ["Livestock", county.animal ?? 0],
          ["Temp",      `${wx.temp}°C`],
          ["Disease",   county.disease ?? "—"],
        ].map(([l,v]) => (
          <div key={l}>
            <p style={{ margin:0, fontSize:12, color:"var(--color-text-secondary)" }}>{l}</p>
            <p style={{ margin:0, fontWeight:500, fontFamily:"var(--font-mono)", fontSize:12 }}>{v}</p>
          </div>
        ))}
      </div>
      <div style={{ marginTop:8 }}>
        <div style={{ height:4, background:"var(--color-background-primary)", borderRadius:2 }}>
          <div style={{ height:4, width:`${county.risk*100}%`, background:riskColor(county.risk), borderRadius:2 }} />
        </div>
        <p style={{ margin:"3px 0 0", fontSize:12, color:"var(--color-text-tertiary)" }}>
          Humidity {wx.hum}% · Rainfall {wx.rain}mm
        </p>
      </div>
    </div>
  );
}
