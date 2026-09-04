"use client";

import { FoglampHUD } from "foglamp/hud";

// Client boundary for the Foglamp HUD overlay. The package ships without a
// "use client" directive, so it cannot be imported directly from the
// server-component root layout. Dev-only: inert unless a local HUD broker
// is running, and does nothing in production.
export function FoglampHUDClient() {
  return <FoglampHUD />;
}
