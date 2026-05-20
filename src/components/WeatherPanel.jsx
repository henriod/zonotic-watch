import { riskBg } from "../lib/risk.js";
import { countyWeather } from "../lib/weather.js";

/**
 * "Weather Risk" tab — current conditions for the higher-risk counties,
 * flagging weather patterns linked to elevated zoonotic transmission.
 *
 * @param {{ counties: object[], weather: Record<string, object> }} props
 */
export default function WeatherPanel({ counties, weather }) {
  const hasLive = Object.keys(weather).length > 0;

  return (
    <div style={{ padding:"1rem" }}>
      <p style={{ margin:"0 0 10px", fontSize:12, color:"var(--color-text-secondary)", display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
        Weather conditions correlated with elevated zoonotic transmission risk
        <span style={{ fontSize:12, fontFamily:"var(--font-mono)", padding:"1px 6px", borderRadius:3, background: hasLive ? "var(--color-background-success)" : "var(--color-background-secondary)", color: hasLive ? "var(--color-text-success)" : "var(--color-text-tertiary)" }}>
          {hasLive ? "live · Open-Meteo" : "sample data"}
        </span>
      </p>
      {[...counties].sort((a,b) => (b.risk ?? 0) - (a.risk ?? 0)).map(c => {
        const wx = countyWeather(c, weather);
        return (
          <div key={c.id} style={{ padding:"0.7rem", background:"var(--color-background-secondary)", borderRadius:"var(--border-radius-md)", marginBottom:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
              <p style={{ margin:0, fontWeight:500, fontSize:12 }}>{c.name}</p>
              <span style={{ fontSize:12, padding:"2px 6px", borderRadius:3, background:riskBg(c.risk), color: c.risk>=0.85?"var(--color-text-danger)":c.risk>=0.45?"var(--color-text-warning)":"var(--color-text-success)" }}>
                {Math.round(c.risk*100)}%
              </span>
            </div>
            <div style={{ display:"flex", gap:14, marginBottom:4 }}>
              {[["ti-temperature",`${wx.temp}°C`],["ti-droplet",`${wx.hum}% RH`],["ti-cloud-rain",`${wx.rain}mm`]].map(([ic,val]) => (
                <span key={ic} style={{ fontSize:12, color:"var(--color-text-secondary)", display:"flex", alignItems:"center", gap:3 }}>
                  <i className={`ti ${ic}`} style={{ fontSize:12 }} aria-hidden="true" />{val}
                </span>
              ))}
            </div>
            {wx.hum > 75 && wx.rain > 40 && (
              <p style={{ margin:0, fontSize:12, color:"var(--color-text-warning)" }}>
                <i className="ti ti-alert-triangle" style={{ fontSize:12, marginRight:3 }} aria-hidden="true" />
                High humidity + rainfall — elevated Culex mosquito breeding (RVF vector)
              </p>
            )}
            {wx.temp > 35 && wx.hum < 40 && (
              <p style={{ margin:0, fontSize:12, color:"var(--color-text-warning)" }}>
                <i className="ti ti-alert-triangle" style={{ fontSize:12, marginRight:3 }} aria-hidden="true" />
                Arid heat — anthrax spore exposure risk from drought-stressed soil
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
