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

export const FULLSTACK_BOILERPLATE = {
  "/package.json": {
    code: `{
  "name": "ai-app",
  "version": "1.0.0",
  "scripts": {
    "start": "node index.js"
  }
}`
  },
  "/index.js": {
    code: `const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;background:#f9fafb;color:#9ca3af;font-family:sans-serif;"><div><div style="font-size:2rem;text-align:center;margin-bottom:1rem;">⚡</div><div style="font-size:0.875rem;font-weight:500;">Your fullstack app will appear here</div></div></body></html>');
});

server.listen(3000, () => {
  console.log('Server running at http://localhost:3000/');
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
