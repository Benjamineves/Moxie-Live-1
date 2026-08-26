import { useState, useEffect, useRef } from "react";

// ─── MOXIE iOS APP PROTOTYPE ─────────────────────────────────────
// Native-feel mobile app for boat owners.
// Tabs: Profile · Docs · Scan · Fleet · Account
// Brand: navy #0d1f35, gold #c9a84c, aqua #17C3B2, cream #f5f2ec

const COLORS = {
  navy: "#0d1f35", navy2: "#132943", navy3: "#1a3a5c", navyDeep: "#071020",
  gold: "#c9a84c", goldLt: "#dfc06a", goldDim: "rgba(201,168,76,.15)", goldLine: "rgba(201,168,76,.35)",
  cream: "#f5f2ec", cream2: "#ede9e0", white: "#fff",
  text: "#0d1f35", text2: "#3a5068", text3: "#6b8299",
  aqua: "#17C3B2", aquaVapor: "#13F1D1", aquaLagoon: "#1FA394",
  greenBg: "#E1F5EE", greenFg: "#085041",
  blueBg: "#E6F1FB", blueFg: "#0C447C",
  amberBg: "#FAEEDA", amberFg: "#633806",
  redBg: "#FAECE7", redFg: "#712B13",
  divider: "rgba(13,31,53,.1)",
};

// ─── PIXEL M LOGO ────────────────────────────────────────────────
function PixelM({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="22" height="9" rx="1" fill={COLORS.gold} opacity=".55"/>
      <rect x="0" y="0" width="9" height="22" rx="1" fill={COLORS.gold} opacity=".55"/>
      <rect x="78" y="0" width="22" height="9" rx="1" fill={COLORS.gold} opacity=".55"/>
      <rect x="91" y="0" width="9" height="22" rx="1" fill={COLORS.gold} opacity=".55"/>
      <rect x="0" y="91" width="22" height="9" rx="1" fill={COLORS.gold} opacity=".55"/>
      <rect x="0" y="78" width="9" height="22" rx="1" fill={COLORS.gold} opacity=".55"/>
      {[[15,25],[15,35],[15,45],[15,55],[15,65],[15,75],[25,35],[35,45],[45,35],[55,45],[65,35],[75,25],[75,35],[75,45],[75,55],[75,65],[75,75]].map(([x,y],i) => (
        <rect key={i} x={x} y={y} width="10" height="10" fill={COLORS.gold}/>
      ))}
      <rect x="85" y="85" width="8" height="8" fill={COLORS.aqua}/>
    </svg>
  );
}

// ─── ICONS ───────────────────────────────────────────────────────
const icons = {
  profile: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  docs: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  scan: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
  fleet: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor"/><circle cx="3" cy="12" r="1.5" fill="currentColor"/><circle cx="3" cy="18" r="1.5" fill="currentColor"/></svg>,
  account: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  phone: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8a16 16 0 0 0 8.09 8.09l.95-.95a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>,
  edit: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  upload: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  camera: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>,
  shield: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  anchor: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="3"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/></svg>,
  bell: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  chevRight: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>,
  download: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  x: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  apple: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>,
  qrCode: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="2" width="8" height="8" rx="1"/><rect x="2" y="14" width="8" height="8" rx="1"/><rect x="14" y="14" width="4" height="4"/><line x1="22" y1="14" x2="22" y2="18"/><line x1="18" y1="22" x2="22" y2="22"/></svg>,
  share: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
};

// ─── VESSEL DATA ─────────────────────────────────────────────────
const vessels = [
  {
    id: "nimbus", mxe: "MXE-00001", name: "Discovery One",
    make: "Nimbus", model: "T8", year: "2023", length: "26'", type: "Power",
    hin: "NIM·····234", marina: "Portobello Marina", marinaDetail: "Oakland, CA · Slip 38",
    color: COLORS.gold,
    docs: [
      { name: "USCG Documentation", status: "ok", detail: "Renewed annually · Current", file: "USCG_Documentation_2025.pdf", size: "142 KB" },
      { name: "Marine Insurance", status: "ok", detail: "Markel American · Expires Dec 2025", file: "Markel_Insurance_Card_2025.pdf", size: "203 KB" },
      { name: "CA Boater Card", status: "ok", detail: "Permanent · Ben Eves", file: "CA_Boater_Card_BenEves.jpg", size: "78 KB" },
      { name: "Engine Service Record", status: "warn", detail: "No file uploaded", file: null },
    ],
    notes: "2023 Nimbus T8 day cruiser, single Yamaha F150 outboard. Regularly maintained. House battery system upgraded 2024. Life jackets for 6 aboard.",
  },
  {
    id: "beneteau", mxe: "MXE-00002", name: "Polaris",
    make: "Beneteau", model: "Oceanis 30.1", year: "2021", length: "30'", type: "Sail",
    hin: "BEN·····121", marina: "Clipper Yacht Harbor", marinaDetail: "Sausalito, CA · Modern Sailing Charter Fleet",
    color: COLORS.aqua,
    docs: [
      { name: "USCG Documentation", status: "ok", detail: "Current · Renewed 2025", file: "USCG_Documentation_Polaris_2025.pdf", size: "118 KB" },
      { name: "Marine Insurance", status: "ok", detail: "Markel American via Novamar · Expires Dec 2025", file: "Novamar_Markel_Policy_2025.pdf", size: "287 KB" },
      { name: "Charter Program Agreement", status: "ok", detail: "Modern Sailing · 55% commission 2026", file: "ModernSailing_Charter_Agreement_2026.pdf", size: "412 KB" },
      { name: "ASA Yacht Club Cert.", status: "warn", detail: "No file uploaded", file: null },
    ],
    notes: "2021 Beneteau Oceanis 30.1 sloop. In Modern Sailing charter program at Clipper Yacht Harbor, Sausalito. Available for ASA instruction and private charter.",
  },
];

// ─── STYLES ──────────────────────────────────────────────────────
const S = {
  app: {
    maxWidth: 430, margin: "0 auto", minHeight: "100vh", position: "relative",
    background: COLORS.white, fontFamily: "'DM Sans', system-ui, sans-serif",
    WebkitFontSmoothing: "antialiased", overflow: "hidden",
  },
  // iOS status bar simulation
  statusBar: {
    height: 48, background: COLORS.navyDeep,
    display: "flex", alignItems: "flex-end", justifyContent: "center",
    paddingBottom: 6, fontSize: 12, fontWeight: 600, color: COLORS.white,
    letterSpacing: ".02em",
  },
  // Tab bar
  tabBar: {
    position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
    width: "100%", maxWidth: 430, zIndex: 100,
    background: "rgba(13,31,53,.97)", backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderTop: `1px solid ${COLORS.goldDim}`,
    display: "flex", paddingBottom: "env(safe-area-inset-bottom, 8px)",
  },
  tabItem: (active) => ({
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
    padding: "10px 4px 8px", cursor: "pointer", transition: "all .2s",
    opacity: active ? 1 : .4, background: "transparent", border: "none",
  }),
  tabIcon: (active) => ({
    width: 22, height: 22, color: active ? COLORS.gold : COLORS.white,
    marginBottom: 3,
  }),
  tabLabel: (active) => ({
    fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase",
    fontWeight: 500, color: active ? COLORS.gold : COLORS.white,
    fontFamily: "'DM Sans', system-ui, sans-serif",
  }),
  scanTabOuter: {
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
    padding: "6px 4px 8px", cursor: "pointer", background: "transparent", border: "none",
  },
  scanBubble: {
    width: 44, height: 44, borderRadius: "50%",
    background: `linear-gradient(135deg, ${COLORS.gold} 0%, ${COLORS.goldLt} 100%)`,
    display: "flex", alignItems: "center", justifyContent: "center",
    marginTop: -18, boxShadow: "0 4px 16px rgba(201,168,76,.4)",
    border: `2px solid ${COLORS.navyDeep}`,
  },
};

// ─── COMPONENTS ──────────────────────────────────────────────────

function Header({ title, subtitle, vessel }) {
  return (
    <div style={{
      background: `linear-gradient(160deg, ${COLORS.navy} 0%, ${COLORS.navy2} 50%, ${COLORS.navy3} 100%)`,
      padding: "0 20px 24px", position: "relative", overflow: "hidden",
    }}>
      {/* Gold circle decoration */}
      <div style={{
        position: "absolute", top: -40, right: -40, width: 180, height: 180,
        borderRadius: "50%", background: vessel?.color || COLORS.gold, opacity: .2,
      }}/>
      {/* Nav bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 0 20px", position: "relative", zIndex: 2,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PixelM size={24}/>
          <span style={{
            fontFamily: "'Cormorant Garamond', serif", fontSize: 17,
            fontStyle: "italic", color: COLORS.white,
          }}><span style={{ color: COLORS.gold }}>M</span>oxie</span>
        </div>
        <div style={{
          fontSize: 8, letterSpacing: ".14em", textTransform: "uppercase",
          padding: "3px 10px", borderRadius: 12,
          background: "rgba(201,168,76,.15)", color: COLORS.gold,
          border: "1px solid rgba(201,168,76,.25)", fontWeight: 500,
        }}>Boat Owner</div>
      </div>
      {/* Title */}
      <div style={{ position: "relative", zIndex: 2 }}>
        {subtitle && (
          <div style={{
            fontSize: 9, letterSpacing: ".18em", textTransform: "uppercase",
            color: "rgba(255,255,255,.4)", marginBottom: 6, fontWeight: 500,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ width: 16, height: 1, background: "rgba(255,255,255,.3)", display: "inline-block" }}/>
            {subtitle}
          </div>
        )}
        <h1 style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: "clamp(28px, 7vw, 40px)", fontWeight: 300, fontStyle: "italic",
          color: COLORS.white, lineHeight: 1, margin: 0,
        }}>{title}</h1>
      </div>
    </div>
  );
}

function SpecStrip({ vessel }) {
  const specs = [
    ["Make", vessel.make], ["Year", vessel.year], ["Length", vessel.length],
    ["Type", vessel.type], ["Model", vessel.model], ["HIN", vessel.hin],
  ];
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
      borderBottom: `1px solid ${COLORS.divider}`,
    }}>
      {specs.map(([k, v], i) => (
        <div key={k} style={{
          padding: "16px 16px", borderRight: (i % 3 !== 2) ? `1px solid ${COLORS.divider}` : "none",
          borderBottom: i < 3 ? `1px solid ${COLORS.divider}` : "none",
        }}>
          <div style={{ fontSize: 8, letterSpacing: ".14em", textTransform: "uppercase", color: COLORS.text3, marginBottom: 3, fontWeight: 500 }}>{k}</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.navy, letterSpacing: k === "HIN" ? ".06em" : 0 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function VerifiedStrip({ vessel }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "14px 20px",
      background: "linear-gradient(135deg, rgba(23,195,178,.08) 0%, rgba(23,195,178,.04) 100%)",
      borderBottom: "1px solid rgba(23,195,178,.15)",
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: "50%", background: "rgba(23,195,178,.15)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        color: COLORS.aquaLagoon,
      }}><div style={{ width: 16, height: 16 }}>{icons.check}</div></div>
      <div style={{ fontSize: 12, color: COLORS.text2, lineHeight: 1.4 }}>
        <strong style={{ color: COLORS.navy, fontWeight: 600 }}>Registered Vessel</strong><br/>
        Profile verified by Moxie · Last updated June 2025
      </div>
      <div style={{ marginLeft: "auto", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: COLORS.text3 }}>{vessel.mxe}</div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 9, letterSpacing: ".2em", textTransform: "uppercase",
      color: COLORS.text3, fontWeight: 500, marginBottom: 14,
      display: "flex", alignItems: "center", gap: 8,
    }}>
      {children}
      <span style={{ flex: 1, height: 1, background: COLORS.divider }}/>
    </div>
  );
}

function DocRow({ doc }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 14px", borderRadius: 8, background: COLORS.cream,
      cursor: "pointer", marginBottom: 8, transition: "background .2s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: doc.status === "ok" ? COLORS.aquaLagoon : "#E8A838",
        }}/>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.navy }}>{doc.name}</div>
          <div style={{ fontSize: 11, color: COLORS.text3 }}>{doc.detail}</div>
        </div>
      </div>
      <div style={{
        fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase",
        color: doc.file ? COLORS.aquaLagoon : COLORS.text3, fontWeight: 500,
      }}>{doc.file ? "View" : "Add"}</div>
    </div>
  );
}

// ─── TAB: PROFILE ────────────────────────────────────────────────
function ProfileTab({ vessel }) {
  return (
    <div>
      <Header title={vessel.name} subtitle={vessel.mxe} vessel={vessel}/>
      <div style={{ background: COLORS.white }}>
        <SpecStrip vessel={vessel}/>
        <VerifiedStrip vessel={vessel}/>
        
        {/* Marina */}
        <div style={{ padding: "22px 20px", borderBottom: `1px solid ${COLORS.divider}` }}>
          <SectionLabel>Home Marina</SectionLabel>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 40, height: 40, borderRadius: "50%", background: COLORS.goldDim,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, color: COLORS.gold,
            }}><div style={{ width: 18, height: 18 }}>{icons.anchor}</div></div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.navy, marginBottom: 2 }}>{vessel.marina}</div>
              <div style={{ fontSize: 12, color: COLORS.text3 }}>{vessel.marinaDetail}</div>
            </div>
          </div>
        </div>

        {/* Docs quick view */}
        <div style={{ padding: "22px 20px", borderBottom: `1px solid ${COLORS.divider}` }}>
          <SectionLabel>Documents on File</SectionLabel>
          {vessel.docs.map((d, i) => <DocRow key={i} doc={d}/>)}
        </div>

        {/* Emergency Contact */}
        <div style={{ padding: "22px 20px", borderBottom: `1px solid ${COLORS.divider}` }}>
          <SectionLabel>Emergency Contact</SectionLabel>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 40, height: 40, borderRadius: "50%", background: COLORS.navy,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "'Cormorant Garamond', serif", fontSize: 16,
              fontStyle: "italic", color: COLORS.gold, flexShrink: 0,
            }}>BE</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: COLORS.navy, marginBottom: 2 }}>Ben Eves</div>
              <div style={{ fontSize: 11, color: COLORS.text3 }}>Owner · Primary contact</div>
            </div>
            <div style={{
              marginLeft: "auto", display: "flex", alignItems: "center", gap: 6,
              background: COLORS.greenBg, color: COLORS.greenFg,
              padding: "8px 14px", borderRadius: 20, fontSize: 12, fontWeight: 500,
              cursor: "pointer",
            }}>
              <div style={{ width: 13, height: 13 }}>{icons.phone}</div>
              Call
            </div>
          </div>
        </div>

        {/* QR Code section */}
        <div style={{ padding: "22px 20px", borderBottom: `1px solid ${COLORS.divider}` }}>
          <SectionLabel>Your QR Code</SectionLabel>
          <div style={{
            background: COLORS.cream, borderRadius: 12, padding: 20,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
          }}>
            {/* QR placeholder */}
            <div style={{
              width: 140, height: 140, borderRadius: 8,
              background: COLORS.white, border: `2px solid ${COLORS.divider}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              position: "relative",
            }}>
              <div style={{ width: 100, height: 100, display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
                {Array.from({ length: 49 }).map((_, i) => {
                  const isCorner = (i < 3 || (i >= 4 && i < 7) || (i >= 7 && i < 10) || i === 13 || (i >= 14 && i < 17) || (i >= 21 && i < 24) || (i >= 42 && i < 45) || (i >= 46 && i < 49) || i === 35 || i === 41);
                  return <div key={i} style={{
                    borderRadius: 1,
                    background: isCorner ? COLORS.navy : (Math.random() > 0.45 ? COLORS.navy : "transparent"),
                  }}/>;
                })}
              </div>
              <div style={{
                position: "absolute", width: 28, height: 28, borderRadius: 4,
                background: COLORS.white, display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <PixelM size={20}/>
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 16, fontStyle: "italic", color: COLORS.navy, marginBottom: 4 }}>{vessel.name}</div>
              <div style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: COLORS.text3 }}>{vessel.mxe}</div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button style={{
                display: "flex", alignItems: "center", gap: 6,
                background: COLORS.navy, color: COLORS.gold,
                border: "none", borderRadius: 20, padding: "9px 18px",
                fontSize: 11, fontWeight: 500, letterSpacing: ".06em",
                textTransform: "uppercase", cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif",
              }}>
                <div style={{ width: 14, height: 14 }}>{icons.download}</div>
                Save QR
              </button>
              <button style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "transparent", color: COLORS.text2,
                border: `1px solid ${COLORS.divider}`, borderRadius: 20, padding: "9px 18px",
                fontSize: 11, fontWeight: 500, letterSpacing: ".06em",
                textTransform: "uppercase", cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif",
              }}>
                <div style={{ width: 14, height: 14 }}>{icons.share}</div>
                Share
              </button>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div style={{ padding: "22px 20px" }}>
          <SectionLabel>Notes</SectionLabel>
          <p style={{ fontSize: 14, color: COLORS.text2, lineHeight: 1.75, fontWeight: 300, margin: 0 }}>{vessel.notes}</p>
        </div>
      </div>
    </div>
  );
}

// ─── TAB: DOCUMENTS ──────────────────────────────────────────────
function DocsTab({ vessel }) {
  const okDocs = vessel.docs.filter(d => d.file);
  const missingDocs = vessel.docs.filter(d => !d.file);
  return (
    <div>
      <Header title="Documents" subtitle={`${vessel.name} · ${vessel.mxe}`} vessel={vessel}/>
      <div style={{ background: COLORS.white, padding: "20px 20px 120px" }}>
        {/* Completion badge */}
        <div style={{
          display: "flex", alignItems: "center", gap: 14, padding: "16px 18px",
          background: COLORS.cream, borderRadius: 12, marginBottom: 24,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%", position: "relative",
            background: `conic-gradient(${COLORS.aquaLagoon} ${(okDocs.length / vessel.docs.length) * 360}deg, ${COLORS.cream2} 0deg)`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: "50%", background: COLORS.cream,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 700, color: COLORS.navy,
            }}>{okDocs.length}/{vessel.docs.length}</div>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.navy, marginBottom: 2 }}>Profile {Math.round((okDocs.length / vessel.docs.length) * 100)}% complete</div>
            <div style={{ fontSize: 12, color: COLORS.text3 }}>{missingDocs.length > 0 ? `${missingDocs.length} document${missingDocs.length > 1 ? "s" : ""} needed` : "All documents current"}</div>
          </div>
        </div>

        {/* Active docs */}
        <SectionLabel>Active Documents</SectionLabel>
        {okDocs.map((d, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
            background: COLORS.white, borderRadius: 8, marginBottom: 8,
            border: `1px solid ${COLORS.divider}`,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 6, background: COLORS.redBg,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9, fontWeight: 800, color: COLORS.redFg, flexShrink: 0,
            }}>PDF</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.navy, marginBottom: 2 }}>{d.name}</div>
              <div style={{ fontSize: 11, color: COLORS.text3 }}>{d.detail}</div>
            </div>
            <div style={{ width: 16, height: 16, color: COLORS.text3 }}>{icons.chevRight}</div>
          </div>
        ))}

        {/* Missing docs */}
        {missingDocs.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <SectionLabel>Needs Attention</SectionLabel>
            {missingDocs.map((d, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
                background: COLORS.amberBg, borderRadius: 8, marginBottom: 8,
                border: "1px solid rgba(232,168,56,.2)",
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 6, background: "rgba(232,168,56,.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, color: COLORS.amberFg,
                }}><div style={{ width: 16, height: 16 }}>{icons.upload}</div></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.amberFg }}>{d.name}</div>
                  <div style={{ fontSize: 11, color: "rgba(99,56,6,.6)" }}>Tap to upload</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Upload button */}
        <div style={{
          marginTop: 28, padding: "16px", borderRadius: 12,
          border: `2px dashed ${COLORS.divider}`, textAlign: "center", cursor: "pointer",
        }}>
          <div style={{ width: 24, height: 24, margin: "0 auto 8px", color: COLORS.text3 }}>{icons.upload}</div>
          <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.text2, marginBottom: 4 }}>Upload a Document</div>
          <div style={{ fontSize: 11, color: COLORS.text3 }}>PDF, JPG, or PNG · Max 10 MB</div>
        </div>
      </div>
    </div>
  );
}

// ─── TAB: SCAN ───────────────────────────────────────────────────
function ScanTab() {
  const [scanning, setScanning] = useState(false);
  return (
    <div>
      <Header title="Scan QR" subtitle="Moxie Scanner"/>
      <div style={{ background: COLORS.white, padding: "20px 20px 120px" }}>
        {!scanning ? (
          <div style={{ textAlign: "center", paddingTop: 40 }}>
            <div style={{
              width: 120, height: 120, borderRadius: 24, margin: "0 auto 28px",
              background: `linear-gradient(135deg, ${COLORS.navy} 0%, ${COLORS.navy2} 100%)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 8px 32px rgba(13,31,53,.25)",
              position: "relative",
            }}>
              <div style={{ width: 48, height: 48, color: COLORS.gold }}>{icons.scan}</div>
              {/* Scanning corners */}
              {[{ top: 10, left: 10 }, { top: 10, right: 10 }, { bottom: 10, left: 10 }, { bottom: 10, right: 10 }].map((pos, i) => (
                <div key={i} style={{
                  position: "absolute", ...pos, width: 20, height: 20,
                  borderColor: COLORS.gold, borderStyle: "solid", borderWidth: 0,
                  ...(i === 0 && { borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 6 }),
                  ...(i === 1 && { borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 6 }),
                  ...(i === 2 && { borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: 6 }),
                  ...(i === 3 && { borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 6 }),
                }}/>
              ))}
            </div>
            <h2 style={{
              fontFamily: "'Cormorant Garamond', serif", fontSize: 24,
              fontStyle: "italic", fontWeight: 300, color: COLORS.navy,
              margin: "0 0 8px",
            }}>Ready to scan</h2>
            <p style={{ fontSize: 14, color: COLORS.text3, margin: "0 0 28px", lineHeight: 1.6 }}>
              Point your camera at any Moxie QR sticker to view a vessel's digital dry bag profile.
            </p>
            <button onClick={() => setScanning(true)} style={{
              background: `linear-gradient(135deg, ${COLORS.gold} 0%, ${COLORS.goldLt} 100%)`,
              color: COLORS.navy, border: "none", borderRadius: 24, padding: "14px 36px",
              fontSize: 13, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase",
              cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              boxShadow: "0 4px 16px rgba(201,168,76,.3)",
            }}>Open Camera</button>
          </div>
        ) : (
          <div style={{ textAlign: "center", paddingTop: 20 }}>
            {/* Simulated camera view */}
            <div style={{
              width: "100%", aspectRatio: "1", maxWidth: 300, margin: "0 auto 20px",
              borderRadius: 16, background: COLORS.navyDeep, position: "relative",
              overflow: "hidden",
            }}>
              {/* Scan animation line */}
              <div style={{
                position: "absolute", left: 20, right: 20, height: 2,
                background: `linear-gradient(90deg, transparent, ${COLORS.aqua}, transparent)`,
                animation: "scanLine 2s ease-in-out infinite",
                top: "50%",
              }}/>
              {/* Corner brackets */}
              {[{ top: 30, left: 30 }, { top: 30, right: 30 }, { bottom: 30, left: 30 }, { bottom: 30, right: 30 }].map((pos, i) => (
                <div key={i} style={{
                  position: "absolute", ...pos, width: 40, height: 40,
                  borderColor: COLORS.aqua, borderStyle: "solid", borderWidth: 0,
                  ...(i === 0 && { borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 }),
                  ...(i === 1 && { borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 }),
                  ...(i === 2 && { borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 }),
                  ...(i === 3 && { borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 }),
                }}/>
              ))}
              <div style={{
                position: "absolute", bottom: 20, left: 0, right: 0,
                fontSize: 11, color: "rgba(255,255,255,.5)", textAlign: "center",
                letterSpacing: ".1em", textTransform: "uppercase",
              }}>Scanning...</div>
            </div>
            <button onClick={() => setScanning(false)} style={{
              background: "transparent", color: COLORS.text3,
              border: `1px solid ${COLORS.divider}`, borderRadius: 20, padding: "10px 24px",
              fontSize: 12, fontWeight: 500, cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
            }}>Cancel</button>
          </div>
        )}
        <style>{`@keyframes scanLine { 0%,100% { top: 20%; opacity: 0; } 50% { top: 75%; opacity: 1; } }`}</style>
      </div>
    </div>
  );
}

// ─── TAB: FLEET ──────────────────────────────────────────────────
function FleetTab({ activeVessel, onSwitch }) {
  return (
    <div>
      <Header title="My Fleet" subtitle="2 vessels registered"/>
      <div style={{ background: COLORS.white, padding: "20px 20px 120px" }}>
        {vessels.map((v) => (
          <div key={v.id} onClick={() => onSwitch(v.id)} style={{
            display: "flex", alignItems: "center", gap: 14,
            padding: "16px 18px", marginBottom: 10, borderRadius: 12,
            background: activeVessel === v.id ? "rgba(201,168,76,.06)" : COLORS.cream,
            border: activeVessel === v.id ? `1px solid ${COLORS.goldLine}` : `1px solid transparent`,
            cursor: "pointer", transition: "all .2s",
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: 10,
              background: activeVessel === v.id ? COLORS.goldDim : "rgba(13,31,53,.05)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <div style={{ width: 22, height: 22, color: activeVessel === v.id ? COLORS.gold : COLORS.text3 }}>
                {icons.anchor}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{
                fontFamily: "'Cormorant Garamond', serif", fontSize: 20,
                fontStyle: "italic", color: COLORS.navy, marginBottom: 2,
              }}>{v.name}</div>
              <div style={{ fontSize: 11, color: COLORS.text3 }}>
                {v.year} {v.make} {v.model} · {v.type} · {v.mxe}
              </div>
            </div>
            {activeVessel === v.id && (
              <div style={{
                width: 24, height: 24, borderRadius: "50%", background: COLORS.aqua,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={COLORS.navy} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
            )}
          </div>
        ))}

        {/* Add vessel */}
        <div style={{
          display: "flex", alignItems: "center", gap: 14,
          padding: "16px 18px", marginTop: 4, borderRadius: 12,
          border: `2px dashed ${COLORS.divider}`, cursor: "pointer",
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 10,
            border: `1.5px dashed ${COLORS.divider}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, color: COLORS.text3,
          }}>+</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: COLORS.text2, marginBottom: 2 }}>Register a New Vessel</div>
            <div style={{ fontSize: 11, color: COLORS.text3 }}>Add another boat to your fleet</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TAB: ACCOUNT ────────────────────────────────────────────────
function AccountTab() {
  const menuItems = [
    { icon: icons.edit, label: "Edit Profile", desc: "Name, email, phone" },
    { icon: icons.bell, label: "Notifications", desc: "Expiry alerts, scan activity" },
    { icon: icons.shield, label: "Privacy & Sharing", desc: "Control who sees what" },
    { icon: icons.qrCode, label: "QR Sticker Orders", desc: "Reorder or track stickers" },
    { icon: icons.share, label: "Share Moxie", desc: "Invite other boat owners" },
  ];
  return (
    <div>
      <Header title="Account" subtitle="Ben Eves"/>
      <div style={{ background: COLORS.white, padding: "20px 20px 120px" }}>
        {/* User card */}
        <div style={{
          display: "flex", alignItems: "center", gap: 16,
          padding: "20px 18px", borderRadius: 12,
          background: COLORS.cream, marginBottom: 24,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%", background: COLORS.navy,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Cormorant Garamond', serif", fontSize: 22,
            fontStyle: "italic", color: COLORS.gold, flexShrink: 0,
          }}>BE</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: COLORS.navy, marginBottom: 2 }}>Ben Eves</div>
            <div style={{ fontSize: 12, color: COLORS.text3 }}>ben@moxieyachting.com</div>
            <div style={{ fontSize: 10, color: COLORS.aquaLagoon, fontWeight: 500, marginTop: 4, letterSpacing: ".06em", textTransform: "uppercase" }}>2 Vessels Registered</div>
          </div>
        </div>

        {/* Menu */}
        {menuItems.map((item, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 14,
            padding: "16px 0", borderBottom: i < menuItems.length - 1 ? `1px solid ${COLORS.divider}` : "none",
            cursor: "pointer",
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: COLORS.cream, display: "flex", alignItems: "center", justifyContent: "center",
              color: COLORS.navy, flexShrink: 0,
            }}><div style={{ width: 18, height: 18 }}>{item.icon}</div></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: COLORS.navy }}>{item.label}</div>
              <div style={{ fontSize: 11, color: COLORS.text3 }}>{item.desc}</div>
            </div>
            <div style={{ width: 16, height: 16, color: COLORS.text3 }}>{icons.chevRight}</div>
          </div>
        ))}

        {/* App info */}
        <div style={{ marginTop: 40, textAlign: "center" }}>
          <PixelM size={32}/>
          <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: COLORS.text3, marginTop: 8 }}>Moxie v1.0.0</div>
          <div style={{ fontSize: 11, color: COLORS.text3, marginTop: 4 }}>Your boat's digital home</div>
        </div>
      </div>
    </div>
  );
}

// ─── APP DOWNLOAD BANNER (shown during onboarding) ───────────────
function AppDownloadSheet({ onClose, onDismiss }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 500,
      background: "rgba(7,16,32,.85)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }} onClick={onDismiss}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 430, background: COLORS.white,
        borderRadius: "24px 24px 0 0", padding: "8px 24px 36px",
        animation: "slideUp .4s cubic-bezier(.32,.72,.24,1)",
      }}>
        {/* Handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: COLORS.divider, margin: "0 auto 20px" }}/>
        
        {/* App icon */}
        <div style={{
          width: 72, height: 72, borderRadius: 16, margin: "0 auto 16px",
          background: `linear-gradient(135deg, ${COLORS.navy} 0%, ${COLORS.navy2} 100%)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 8px 24px rgba(13,31,53,.3)",
        }}>
          <PixelM size={40}/>
        </div>

        <h2 style={{
          fontFamily: "'Cormorant Garamond', serif", fontSize: 26,
          fontWeight: 300, fontStyle: "italic", color: COLORS.navy,
          textAlign: "center", margin: "0 0 6px", lineHeight: 1.1,
        }}>Get the Moxie App</h2>
        <p style={{
          fontSize: 14, color: COLORS.text2, textAlign: "center",
          margin: "0 0 20px", lineHeight: 1.6,
        }}>
          Your vessel profile, documents, and QR codes — always in your pocket.
        </p>

        {/* Feature pills */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 24 }}>
          {["Instant QR scan", "Document alerts", "Offline access", "Share with crew"].map((f) => (
            <div key={f} style={{
              padding: "6px 14px", borderRadius: 20,
              background: COLORS.cream, fontSize: 11, fontWeight: 500,
              color: COLORS.text2, letterSpacing: ".02em",
            }}>{f}</div>
          ))}
        </div>

        {/* Download button */}
        <button onClick={onClose} style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          background: COLORS.navy, color: COLORS.white, border: "none",
          borderRadius: 14, padding: "16px 24px", cursor: "pointer",
          fontFamily: "'DM Sans', sans-serif", fontSize: 15, fontWeight: 600,
          letterSpacing: ".02em",
        }}>
          <div style={{ width: 20, height: 20 }}>{icons.apple}</div>
          Download on the App Store
        </button>

        <button onClick={onDismiss} style={{
          width: "100%", background: "transparent", border: "none",
          color: COLORS.text3, fontSize: 13, padding: "14px",
          cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
        }}>Continue in browser</button>

        <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
      </div>
    </div>
  );
}

// ─── ONBOARDING: "Get the App" prompt during profile creation ────
function OnboardingAppPrompt({ onContinue }) {
  const [step, setStep] = useState(0);
  
  // Step 0: welcome / profile created
  // Step 1: app download prompt
  // Step 2: continue to app
  
  if (step === 0) {
    return (
      <div style={{ 
        minHeight: "100vh", background: `linear-gradient(160deg, ${COLORS.navy} 0%, ${COLORS.navy2} 60%, ${COLORS.navy3} 100%)`,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "40px 28px", textAlign: "center", position: "relative", overflow: "hidden",
      }}>
        {/* Decorative circles */}
        <div style={{ position: "absolute", top: -80, right: -80, width: 280, height: 280, borderRadius: "50%", background: COLORS.gold, opacity: .06 }}/>
        <div style={{ position: "absolute", bottom: -60, left: -60, width: 200, height: 200, borderRadius: "50%", background: COLORS.aqua, opacity: .04 }}/>
        
        <div style={{ position: "relative", zIndex: 2 }}>
          {/* Animated check */}
          <div style={{
            width: 80, height: 80, borderRadius: "50%",
            background: "rgba(23,195,178,.15)", margin: "0 auto 24px",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "fadeScale .6s cubic-bezier(.32,.72,.24,1)",
          }}>
            <div style={{ width: 36, height: 36, color: COLORS.aqua }}>{icons.check}</div>
          </div>
          
          <h1 style={{
            fontFamily: "'Cormorant Garamond', serif", fontSize: 32,
            fontWeight: 300, fontStyle: "italic", color: COLORS.white,
            margin: "0 0 8px", lineHeight: 1.1,
          }}>Profile Created</h1>
          <p style={{
            fontSize: 14, color: "rgba(255,255,255,.55)", margin: "0 0 8px", lineHeight: 1.6,
          }}>Your vessel's digital dry bag is live.</p>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "6px 14px", borderRadius: 20,
            background: "rgba(201,168,76,.12)", marginBottom: 36,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.aqua }}/>
            <span style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: COLORS.gold, fontWeight: 500 }}>MXE-00001</span>
          </div>
          
          <div style={{ marginBottom: 32 }}>
            <div style={{
              fontFamily: "'Cormorant Garamond', serif", fontSize: 22,
              fontStyle: "italic", color: COLORS.white, marginBottom: 4,
            }}>Discovery One</div>
            <div style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "rgba(255,255,255,.4)" }}>2023 Nimbus T8 · Power</div>
          </div>
          
          <button onClick={() => setStep(1)} style={{
            background: `linear-gradient(135deg, ${COLORS.gold} 0%, ${COLORS.goldLt} 100%)`,
            color: COLORS.navy, border: "none", borderRadius: 24, padding: "16px 48px",
            fontSize: 14, fontWeight: 600, letterSpacing: ".04em",
            cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
            boxShadow: "0 4px 20px rgba(201,168,76,.35)",
          }}>Continue</button>
        </div>
        <style>{`@keyframes fadeScale { from { transform: scale(.7); opacity: 0; } to { transform: scale(1); opacity: 1; } }`}</style>
      </div>
    );
  }
  
  if (step === 1) {
    return (
      <div style={{
        minHeight: "100vh", background: COLORS.white,
        display: "flex", flexDirection: "column", padding: "0",
      }}>
        {/* Top graphic */}
        <div style={{
          background: `linear-gradient(160deg, ${COLORS.navy} 0%, ${COLORS.navy2} 100%)`,
          padding: "48px 28px 36px", textAlign: "center", position: "relative", overflow: "hidden",
        }}>
          <div style={{ position: "absolute", top: -50, right: -50, width: 200, height: 200, borderRadius: "50%", background: COLORS.gold, opacity: .08 }}/>
          
          {/* Phone mockup with app */}
          <div style={{
            width: 160, height: 280, margin: "0 auto 20px",
            borderRadius: 24, background: COLORS.navyDeep,
            border: "3px solid rgba(255,255,255,.15)",
            overflow: "hidden", position: "relative",
          }}>
            {/* Mini status bar */}
            <div style={{ height: 28, background: COLORS.navyDeep, display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 3 }}>
              <div style={{ fontSize: 8, color: "rgba(255,255,255,.4)", fontWeight: 600 }}>9:41</div>
            </div>
            {/* Mini header */}
            <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 6, background: COLORS.navy }}>
              <PixelM size={12}/>
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 10, fontStyle: "italic", color: COLORS.white }}>
                <span style={{ color: COLORS.gold }}>M</span>oxie
              </span>
            </div>
            {/* Mini vessel hero */}
            <div style={{
              background: `linear-gradient(160deg, ${COLORS.navy} 0%, ${COLORS.navy3} 100%)`,
              padding: "12px 12px 10px", position: "relative",
            }}>
              <div style={{ position: "absolute", top: -10, right: -10, width: 40, height: 40, borderRadius: "50%", background: COLORS.gold, opacity: .15 }}/>
              <div style={{ fontSize: 5, letterSpacing: ".1em", textTransform: "uppercase", color: "rgba(255,255,255,.3)", marginBottom: 3 }}>MXE-00001</div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 14, fontStyle: "italic", color: COLORS.white, lineHeight: 1 }}>Discovery One</div>
              <div style={{ fontSize: 5, color: "rgba(255,255,255,.4)", marginTop: 2 }}>2023 Nimbus T8 · Power</div>
            </div>
            {/* Mini spec strip */}
            <div style={{ display: "flex", background: COLORS.white, borderBottom: `1px solid ${COLORS.divider}` }}>
              {["Make","Year","Len"].map((k, i) => (
                <div key={k} style={{ flex: 1, padding: "6px 6px", borderRight: i < 2 ? `1px solid ${COLORS.divider}` : "none" }}>
                  <div style={{ fontSize: 4, letterSpacing: ".1em", textTransform: "uppercase", color: COLORS.text3, marginBottom: 1 }}>{k}</div>
                  <div style={{ fontSize: 7, fontWeight: 600, color: COLORS.navy }}>{["Nimbus","2023","26'"][i]}</div>
                </div>
              ))}
            </div>
            {/* Mini doc rows */}
            <div style={{ background: COLORS.white, padding: "6px 8px" }}>
              {[COLORS.aquaLagoon, COLORS.aquaLagoon, "#E8A838"].map((c, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "4px 6px", borderRadius: 4, background: COLORS.cream, marginBottom: 3,
                }}>
                  <div style={{ width: 4, height: 4, borderRadius: "50%", background: c }}/>
                  <div style={{ height: 3, flex: 1, borderRadius: 2, background: COLORS.divider }}/>
                </div>
              ))}
            </div>
            {/* Mini tab bar */}
            <div style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              background: "rgba(13,31,53,.95)", padding: "6px 8px 10px",
              display: "flex", justifyContent: "space-around",
            }}>
              {[COLORS.gold, "rgba(255,255,255,.3)", "rgba(255,255,255,.3)", "rgba(255,255,255,.3)"].map((c, i) => (
                <div key={i} style={{ width: 10, height: 10, borderRadius: 2, background: i === 0 ? "none" : "none" }}>
                  <div style={{ width: 10, height: 2, borderRadius: 1, background: c, margin: "0 auto" }}/>
                </div>
              ))}
            </div>
          </div>
          
          <div style={{
            fontFamily: "'Cormorant Garamond', serif", fontSize: 10,
            fontStyle: "italic", color: "rgba(255,255,255,.4)", marginTop: 4,
          }}>Your profile, always in your pocket</div>
        </div>
        
        {/* Content */}
        <div style={{ padding: "28px 28px 36px", flex: 1 }}>
          <h2 style={{
            fontFamily: "'Cormorant Garamond', serif", fontSize: 28,
            fontWeight: 300, fontStyle: "italic", color: COLORS.navy,
            margin: "0 0 8px", lineHeight: 1.1,
          }}>Get the Moxie App</h2>
          <p style={{ fontSize: 14, color: COLORS.text2, margin: "0 0 24px", lineHeight: 1.7 }}>
            Your digital dry bag works in any browser — but the app makes it faster, with offline access and instant notifications.
          </p>
          
          {/* Benefits */}
          {[
            { icon: icons.scan, title: "Instant QR scanning", desc: "Open the app, point, and go — no browser needed" },
            { icon: icons.bell, title: "Expiry alerts", desc: "Get notified before insurance or registration lapses" },
            { icon: icons.shield, title: "Offline access", desc: "Your documents available even without signal" },
            { icon: icons.camera, title: "Quick doc capture", desc: "Snap a photo to upload registration or insurance cards" },
          ].map((b, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 18,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8, background: COLORS.cream,
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, color: COLORS.navy,
              }}><div style={{ width: 18, height: 18 }}>{b.icon}</div></div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.navy, marginBottom: 2 }}>{b.title}</div>
                <div style={{ fontSize: 12, color: COLORS.text3, lineHeight: 1.5 }}>{b.desc}</div>
              </div>
            </div>
          ))}

          {/* CTA buttons */}
          <div style={{ marginTop: 28 }}>
            <button onClick={onContinue} style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              background: COLORS.navy, color: COLORS.white, border: "none",
              borderRadius: 14, padding: "16px 24px", cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif", fontSize: 15, fontWeight: 600,
              marginBottom: 10,
            }}>
              <div style={{ width: 20, height: 20 }}>{icons.apple}</div>
              Download on the App Store
            </button>
            <button onClick={onContinue} style={{
              width: "100%", background: "transparent",
              border: `1px solid ${COLORS.divider}`, color: COLORS.text2,
              borderRadius: 14, padding: "14px 24px", cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 500,
            }}>Continue in browser for now</button>
          </div>
        </div>
      </div>
    );
  }
  
  return null;
}

// ─── MAIN APP ────────────────────────────────────────────────────
export default function MoxieApp() {
  const [tab, setTab] = useState("profile");
  const [activeVessel, setActiveVessel] = useState("nimbus");
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [showDownloadSheet, setShowDownloadSheet] = useState(false);
  const scrollRef = useRef(null);
  
  const vessel = vessels.find(v => v.id === activeVessel);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [tab, activeVessel]);

  const handleVesselSwitch = (id) => {
    setActiveVessel(id);
    setTab("profile");
  };

  if (showOnboarding) {
    return (
      <div style={S.app}>
        <OnboardingAppPrompt onContinue={() => setShowOnboarding(false)}/>
      </div>
    );
  }

  const tabs = [
    { id: "profile", label: "Profile", icon: icons.profile },
    { id: "docs", label: "Docs", icon: icons.docs },
    { id: "scan", label: "Scan", icon: icons.scan },
    { id: "fleet", label: "Fleet", icon: icons.fleet },
    { id: "account", label: "Account", icon: icons.account },
  ];

  return (
    <div style={S.app}>
      {/* iOS status bar */}
      <div style={S.statusBar}>
        <span>9:41</span>
      </div>

      {/* Scrollable content */}
      <div ref={scrollRef} style={{ height: "calc(100vh - 48px - 72px)", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        {tab === "profile" && <ProfileTab vessel={vessel}/>}
        {tab === "docs" && <DocsTab vessel={vessel}/>}
        {tab === "scan" && <ScanTab/>}
        {tab === "fleet" && <FleetTab activeVessel={activeVessel} onSwitch={handleVesselSwitch}/>}
        {tab === "account" && <AccountTab/>}
      </div>

      {/* Tab bar */}
      <div style={S.tabBar}>
        {tabs.map((t) => (
          t.id === "scan" ? (
            <button key={t.id} onClick={() => setTab(t.id)} style={S.scanTabOuter}>
              <div style={S.scanBubble}>
                <div style={{ width: 20, height: 20, color: COLORS.navy }}>{t.icon}</div>
              </div>
              <div style={{ ...S.tabLabel(tab === t.id), marginTop: 4 }}>{t.label}</div>
            </button>
          ) : (
            <button key={t.id} onClick={() => setTab(t.id)} style={S.tabItem(tab === t.id)}>
              <div style={S.tabIcon(tab === t.id)}>{t.icon}</div>
              <div style={S.tabLabel(tab === t.id)}>{t.label}</div>
            </button>
          )
        ))}
      </div>

      {/* Download sheet (can be triggered from in-app) */}
      {showDownloadSheet && (
        <AppDownloadSheet
          onClose={() => setShowDownloadSheet(false)}
          onDismiss={() => setShowDownloadSheet(false)}
        />
      )}
      
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #071020; }
        ::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
