# CarePoint V2 Shared UI Foundations

V2 uses **Adaptive Clinical Future**: Clinical Aurora as the main clinical/patient foundation, Midnight Command for dense operational/telehealth contexts, and restrained Human Future traits for sensitive patient experiences.

Phase 0 defines shared vocabulary only; it does not alter visible screens.

## Baseline-aligned tokens
- Clinical blue: `#0EA5E9`
- Deep clinical blue: `#006591`
- Cyan signal: `#22D3EE`
- Neural violet: `#8B5CF6`
- Midnight: `#0F172A`
- Care green: `#10B981`
- Attention: `#F59E0B`
- Safety: `#FB7185`
- Canvas: `#F8FAFC`
- Clinical ink: `#131B2E`

These values preserve the palette already present at the V2 baseline.

## Layout and geometry
- 8 px base spacing rhythm.
- 12-column web grid where appropriate.
- 4-column mobile grid where appropriate.
- Clinical information stays on solid, high-contrast surfaces.
- Glass/translucency is limited to navigation, overlays and non-critical surfaces.

## Universal modalities
`CLINIC`, `TELEMEDICINE`, `HOME_VISIT`, and `TRANSPORT` where transport-specific.

## Shared component patterns
- modality badges;
- clinical cards and data rows;
- one dominant primary action per context;
- consistent form/validation/required states;
- deterministic loading, empty, error and offline/pending-sync states;
- text + icon/badge status redundancy;
- explicit confirmation for sensitive actions.

## Accessibility
- Never encode state with color alone.
- Preserve keyboard focus order/visible focus on web.
- Meaningful mobile accessible labels.
- Text scaling and reflow.
- Arabic RTL reading order.
- Critical/emergency states never depend on animation.
