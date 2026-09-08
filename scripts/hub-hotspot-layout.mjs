import assert from "node:assert/strict";

const hubs = new Set(["/salt-lake-city-ut/", "/st-louis-mo/", "/kansas-city-mo/"]);

// Clamp only the popup, in the existing diagram's coordinate system.
// The six offsets mirror the unchanged global hotspot positions.
export const hubHotspotStyle = `  <style id="hub-hotspot-positioning">
    @media (max-width: 1120px) {
      .attic-map .house-3d { container-type: inline-size; }
      .attic-map .hotspot { --panel-width: 250px; }
      .attic-map .hotspot-card {
        left: clamp(calc(12px - var(--hotspot-offset)), calc(13px - var(--panel-width) / 2), calc(100cqw - 12px - var(--hotspot-offset) - var(--panel-width)));
        right: auto;
        --bubble-x: 0px;
      }
      .attic-map .hotspot--insulation { --hotspot-offset: 51cqw; }
      .attic-map .hotspot--insulation-depth { --hotspot-offset: 57cqw; }
      .attic-map .hotspot--insulation-edge { --hotspot-offset: 31cqw; }
      .attic-map .hotspot--air { --hotspot-offset: 43cqw; }
      .attic-map .hotspot--sanitize { --hotspot-offset: 62cqw; }
      .attic-map .hotspot--ventilation { --hotspot-offset: 76cqw; }
    }
    @media (max-width: 640px) {
      .attic-map .hotspot { --panel-width: min(226px, 74vw); }
      .attic-map .hotspot--insulation { --hotspot-offset: 49cqw; }
      .attic-map .hotspot--insulation-depth { --hotspot-offset: 50cqw; }
      .attic-map .hotspot--insulation-edge { --hotspot-offset: 24cqw; }
      .attic-map .hotspot--air { --hotspot-offset: 31cqw; }
      .attic-map .hotspot--sanitize { --hotspot-offset: 61cqw; }
      .attic-map .hotspot--ventilation { --hotspot-offset: 78cqw; }
    }
  </style>`;

export function applyHubHotspotLayout(html, route) {
  if (!hubs.has(route)) return html;
  if (html.includes('id="hub-hotspot-positioning"')) {
    assert.equal(html.split(hubHotspotStyle).length, 2, "Conflicting hub-only positioning style");
    assert.equal(html.split('id="hub-hotspot-positioning"').length, 2);
    return html;
  }
  assert.equal(html.split("</head>").length, 2);
  return html.replace("</head>", `${hubHotspotStyle}\n</head>`);
}
