/** Product catalog types (no React icons — SDK subset for VR manifest). */

export type Accent = "cyan" | "violet";
export type Category =
  | "Design"
  | "Foundation"
  | "Intelligence"
  | "Operations"
  | "Trust";

export interface Spec {
  label: string;
  value: string;
}

export interface Product {
  slug: string;
  name: string;
  tag: string;
  desc: string;
  accent: Accent;
  category: Category;
  hero: string;
  highlights: string[];
  specs: Spec[];
  vr?: boolean;
  app?: { href: string; label: string };
}

/** Products that require a VR headset (Pilot teleoperation today). */
export const PRODUCTS: Product[] = [
  {
    slug: "pilot",
    name: "OhhO Pilot",
    tag: "Teleoperation cockpit for any robot",
    desc: "Stream joint targets and base velocity from a browser or VR headset to any OhhO-connected robot.",
    accent: "violet",
    category: "Operations",
    hero:
      "Pilot is the teleoperation console: map your controllers to the robot profile, stream commands over OhhO Connect, and emergency-stop on connection loss.",
    highlights: [
      "VR and desktop teleoperation",
      "Robot-profile joint limits and velocity clamps",
      "Works with simulated and live transports",
    ],
    specs: [
      { label: "Transports", value: "ROSBridge, Web Serial, BLE, Simulated" },
      { label: "VR", value: "OpenXR via OhhO VR app" },
    ],
    vr: true,
    app: { href: "/pilot", label: "Open the cockpit" },
  },
];
