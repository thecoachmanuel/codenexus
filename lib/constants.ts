export const PLANS = {
  free: {
    label: "Free",
    credits: 10,
    price: 0,
  },
  starter: {
    label: "Starter",
    credits: 50,
    price: 9,
  },
  pro: {
    label: "Pro",
    credits: 150,
    price: 29,
  },
} as const;

export const MIN_CREDITS_TO_GENERATE = 1;

export const PRICING_PLANS = [
  {
    key: "free",
    label: "Free",
    description: "Start building. No credit card required.",
    price: 0,
    featured: false,
    planId: null,
    active: true,
    features: ["10 generations / month", "Live preview", "Export to zip"],
  },
  {
    key: "starter",
    label: "Starter",
    description: "For developers who build regularly.",
    price: 9,
    featured: true,
    planId: "cplan_3DvxGsOeYA5bpJzGWPi8o7wScRD",
    active: false,
    features: ["50 generations / month", "Image uploads", "Live preview", "Export to zip"],
  },
  {
    key: "pro",
    label: "Pro",
    description: "For power users who ship fast.",
    price: 29,
    featured: false,
    planId: "cplan_3DvxTfywwB0NyQ1iqANclgNqlq8",
    active: false,
    features: ["150 generations / month", "Priority AI", "Live preview", "Export to zip", "Image uploads", "GitHub repo import"],
  },
] as const;

export const VITE_REACT_BOILERPLATE = {
  "/index.html": {
    code: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>React App</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/index.jsx"></script>
  </body>
</html>`
  },
  "/src/index.jsx": {
    code: `import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

import App from "./App";

const root = createRoot(document.getElementById("root"));
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);`
  },
  "/src/styles.css": {
    code: `body {
  font-family: sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* {
  box-sizing: border-box;
}`
  },
  "/src/App.jsx": {
    code: `export default function App() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-400">
      <div className="text-center">
        <div className="text-4xl mb-4">⚡</div>
        <p className="text-sm font-medium">Your React app will appear here</p>
      </div>
    </div>
  );
}`
  },
  "/vite.config.js": {
    code: `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});`
  }
};

export const BASE_DEPENDENCIES: Record<string, string> = {
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "lucide-react": "^0.263.1",
  "recharts": "^2.10.3",
  "framer-motion": "^10.16.16",
  "@emotion/is-prop-valid": "^1.2.2",
  "clsx": "^2.1.0",
  "tailwind-merge": "^2.2.0",
  "@swc/helpers": "^0.5.11",
};
