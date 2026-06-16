# CodeNexus: Agentic App Builder 🔥🔥

A full-stack AI-powered React app generator where users describe what they want to build, and the AI writes production-ready React code that renders live in the browser — just like Bolt.new or v0.

Users get a live Sandpack preview, a persistent chat history, image upload support, and a credit-based subscription system via Paystack. Pro users can trigger a Cline AI agent that autonomously improves the generated app file by file.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Features](#features)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) |
| Auth | Custom JWT (httpOnly cookies) + bcryptjs |
| Billing | Paystack |
| Database | MongoDB (via Mongoose) |
| Image Storage | Inline Base64 Data URLs |
| AI Model | Gemini 2.5 Flash (with Multi-Key Rotation) |
| AI Agent (Improve) | Cline SDK (`@cline/sdk`) |
| Code Editor + Preview | Sandpack (`@codesandbox/sandpack-react`) |
| Styling | Tailwind CSS v4 + Shadcn UI |

---

## Features

### Authentication (JWT)
- Custom Email & Password authentication
- Secure `httpOnly` cookies for 7-day session persistence
- Protected `/workspace` and `/projects` routes via Next.js middleware (`proxy.ts`)

### Billing (Paystack)
- Fully integrated Paystack payment flow
- Users can upgrade to "Starter" or "Pro" plans
- Credits top-up automatically upon successful webhook verification or client-side verify

### AI Code Generation (`/api/gen-ai-code`)
- Powered by Gemini 2.5 Flash
- **Multi-Key Rotation**: Automatically cycles through multiple API keys (`GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, etc.) to bypass free-tier rate limits and 429 errors.
- Returns strict JSON: `{ assistantMessage, title, files, dependencies }`
- Image uploads are instantly converted to Base64 and attached to prompts, avoiding the need for external cloud storage buckets.

### Improve with AI — Cline SDK (`/api/improve`)
- Cline `Agent` with two tools: `update_file` + `done_improving`
- Agent streams reasoning live into the chat panel as it works
- Files patched one at a time via SSE — Sandpack updates without remounting
- Gated to Starter and Pro plans

### Code Panel (Sandpack)
- Preview and Code tabs — auto-switches to Preview after each generation
- Export to ZIP — downloads a ready-to-run CRA project with `package.json`

---

## Getting Started

### Prerequisites

- Node.js 22+
- A MongoDB cluster (e.g., MongoDB Atlas)
- Paystack API keys
- One or more Google AI Studio API keys (Gemini)

### Installation

```bash
git clone https://github.com/thecoachmanuel/codenexus.git
cd codenexus
npm install
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

Create a `.env.local` file in the root based on `.env.local.example`:

```env
# MongoDB
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@cluster...

# JWT
JWT_SECRET=replace_me_with_64_char_secret

# Gemini API Keys (auto-rotates to avoid rate limits)
GEMINI_API_KEY_1=AIza...
GEMINI_API_KEY_2=AIza...
# Add more as needed

# Paystack
PAYSTACK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=pk_test_...

# App URL (for Paystack callback)
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Arcjet (Optional)
# ARCJET_KEY=
```

---

## Database Setup

The MongoDB database uses Mongoose with two core collections:

**Users** (`lib/models/User.ts`)
- Stores email, hashed password, credits, plan type, and timestamps.

**Workspaces** (`lib/models/Workspace.ts`)
- Stores the project title, AI chat history, and the generated files/dependencies blob. Associated with a User ID.

---

## 🌟 Show your support

Give a ⭐ if this project helped you learn something new!
