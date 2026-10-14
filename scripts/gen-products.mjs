import fs from "fs";

const src = fs.readFileSync("C:/Users/varun/ohho/console/lib/products.tsx", "utf8");
const start = src.indexOf("export const PRODUCTS");
const end = src.indexOf("];", start) + 2;
let block = src.slice(start, end);
block = block.replace(/icon:\s*<[\s\S]*?>,\s*/g, "");

const types = `export type Accent = "cyan" | "violet";
export type PlanName = "Spark" | "Builder" | "Fleet" | "Forge";
export type Category =
  | "Design"
  | "Foundation"
  | "Intelligence"
  | "Operations"
  | "Trust";
export type ProductStatus = "shipped" | "prototype" | "roadmap";

export interface Feature {
  title: string;
  body: string;
}

export interface Step {
  title: string;
  body: string;
}

export interface Spec {
  label: string;
  value: string;
}

export interface PlanAccess {
  plan: PlanName;
  level: string;
  included: boolean;
}

export interface Faq {
  q: string;
  a: string;
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
  overview: string[];
  features: Feature[];
  how: Step[];
  specs: Spec[];
  plans: PlanAccess[];
  recommendedPlan: PlanName;
  planRationale: string;
  faq: Faq[];
  related: string[];
  dashboardCaption: string;
  status: ProductStatus;
  vr?: boolean;
  app?: { href: string; label: string };
}

`;

const out =
  types +
  "\n" +
  block.replace("export const PRODUCTS", "export const PRODUCTS") +
  "\n";

fs.writeFileSync(
  "C:/Users/varun/ohho/sdk-ohh-172/packages/schemas/src/products.ts",
  out,
);
console.log("products.ts bytes:", out.length);
