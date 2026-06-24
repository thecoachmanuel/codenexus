import { Sparkles, Zap, Code2, Eye, Package, ImageIcon, GitBranch } from "lucide-react";

export const SUGGESTIONS_SETS = [
  [
    "A Spotify-style music streaming interface",
    "An AI prompt engineering playground",
    "A sleek social media analytics dashboard",
    "A minimalist e-commerce shoe store",
    "A visual bug tracking board for developers",
    "A real-time multiplayer whiteboard app",
  ],
  [
    "A Netflix clone with movie carousels",
    "A meditation app with breathing animations",
    "A modern job board with salary filters",
    "An interactive periodic table of elements",
    "A vintage 90s-style personal blog",
    "A smart home IoT control panel",
  ],
  [
    "A dark-mode developer portfolio website",
    "A local coffee shop ordering system",
    "A 3D interactive product configurator",
    "A dynamic markdown blog generator",
    "A personal CRM for networking",
    "A sleek pomodoro timer with lofi music",
  ]
];

export const FEATURES = [
  {
    icon: Zap,
    label: "Instant generation",
    desc: "Describe your app in plain English. Gemini 3.5 Flash returns production-ready React + Tailwind code in seconds.",
  },
  {
    icon: Eye,
    label: "Live preview",
    desc: "Your app renders instantly in the browser via Sandpack. No install, no build step — just a working preview.",
  },
  {
    icon: Code2,
    label: "Full source code",
    desc: "Browse every generated file. Edit directly in the built-in editor and watch the preview update in real time.",
  },
  {
    icon: Package,
    label: "Smart packages",
    desc: "AI picks the right npm packages. We validate them against the npm registry and filter hallucinated ones silently.",
  },
  {
    icon: Sparkles,
    label: "AI error recovery",
    desc: "When your preview throws an error, a banner appears. One click sends the error to AI and auto-fixes the code.",
  },
  {
    icon: ImageIcon,
    label: "Image-aware prompts",
    desc: "Attach screenshots or mockups to your prompt. The AI reads them and generates code that matches your design.",
  },
  {
    icon: GitBranch,
    label: "GitHub repo import",
    desc: "Pro users can import any public GitHub repository directly into their workspace. Paste a URL and continue building with AI.",
  },
];

export const STEPS = [
  {
    number: "01",
    label: "Describe your app",
    desc: "Type a prompt or pick a suggestion. Add screenshots for extra context.",
  },
  {
    number: "02",
    label: "AI generates code",
    desc: "Gemini writes React + Tailwind components, picks dependencies, and structures your files.",
  },
  {
    number: "03",
    label: "Preview & refine",
    desc: "See your app live instantly. Keep chatting to iterate — AI remembers the full conversation.",
  },
  {
    number: "04",
    label: "Export and deploy",
    desc: "Open in CodeSandbox, copy the source, and deploy to a live URL.",
  },
];

export const PLACEHOLDERS = [
  "A modern real estate platform with map search…",
  "A Notion-style document editor with slash commands…",
  "An interactive SaaS pricing page with toggles…",
  "A minimalist weather dashboard with animated gradients…",
  "A GitHub-style repository browser with file trees…",
];
