"use client";

import { useState } from "react";
import { Book, Code, Rocket, Zap, CreditCard, LayoutTemplate } from "lucide-react";

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("introduction");

  const navItems = [
    { id: "introduction", label: "Introduction", icon: Book },
    { id: "getting-started", label: "Getting Started", icon: Rocket },
    { id: "writing-prompts", label: "Writing Good Prompts", icon: Code },
    { id: "previews", label: "Live Previews", icon: LayoutTemplate },
    { id: "deployments", label: "Deploying to Vercel", icon: Zap },
    { id: "billing", label: "Credits & Billing", icon: CreditCard },
  ];

  const scrollTo = (id: string) => {
    setActiveSection(id);
    const element = document.getElementById(id);
    if (element) {
      const y = element.getBoundingClientRect().top + window.scrollY - 100;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] pt-24 pb-20">
      <div className="container max-w-7xl mx-auto px-6 flex flex-col md:flex-row gap-12 relative">
        
        {/* Sticky Sidebar */}
        <aside className="w-full md:w-64 shrink-0">
          <div className="sticky top-24 space-y-2">
            <h3 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-4 px-3">
              Documentation
            </h3>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => scrollTo(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
                    isActive 
                      ? "bg-white text-black font-medium" 
                      : "text-white/60 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 max-w-3xl prose prose-invert prose-p:text-white/70 prose-headings:text-white prose-a:text-indigo-400">
          <section id="introduction" className="mb-16 pt-4">
            <h1 className="text-4xl font-serif mb-6">Welcome to Crevo AI</h1>
            <p className="text-lg leading-relaxed">
              Crevo AI is a revolutionary agentic AI builder that allows anyone, regardless of technical background, 
              to instantly build, preview, and deploy full-stack web applications by simply describing them in plain English.
            </p>
            <p className="leading-relaxed mt-4">
              Behind the scenes, we use an advanced ensemble of AI agents that architect the application, write the React code, 
              wire up TailwindCSS, and bundle it all in a virtual Sandbox environment instantly.
            </p>
          </section>

          <hr className="border-white/10 my-12" />

          <section id="getting-started" className="mb-16 pt-4">
            <h2 className="text-3xl font-serif mb-6">Getting Started</h2>
            <p>
              To start building, simply navigate to the workspace and type your idea into the prompt box.
            </p>
            <ul className="space-y-3 mt-6">
              <li className="flex items-start gap-2">
                <div className="mt-1 w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                <span><strong>Create an account:</strong> Sign up with GitHub or Google for a seamless experience.</span>
              </li>
              <li className="flex items-start gap-2">
                <div className="mt-1 w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                <span><strong>Enter a prompt:</strong> Be as descriptive as possible. The more details you provide, the better the result.</span>
              </li>
              <li className="flex items-start gap-2">
                <div className="mt-1 w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                <span><strong>Watch it build:</strong> The AI will instantly generate the code and spin up a live preview on your screen.</span>
              </li>
            </ul>
          </section>

          <hr className="border-white/10 my-12" />

          <section id="writing-prompts" className="mb-16 pt-4">
            <h2 className="text-3xl font-serif mb-6">Writing Good Prompts</h2>
            <p>
              The secret to getting an amazing app lies in how you write your prompt. Think of the AI as a junior developer 
              who needs clear instructions.
            </p>
            <div className="bg-[#111] border border-white/10 rounded-xl p-6 mt-6">
              <h4 className="text-green-400 font-medium mb-2">Good Prompt Example:</h4>
              <p className="text-sm italic text-white/80">
                "Build a sleek, dark-mode crypto portfolio tracker. I need a sidebar on the left for navigation, a main dashboard area that shows a line chart of my portfolio value over time using rechart, and a data table below it showing fake holdings of Bitcoin, Ethereum, and Solana."
              </p>
            </div>
            <div className="bg-[#111] border border-white/10 rounded-xl p-6 mt-4">
              <h4 className="text-red-400 font-medium mb-2">Bad Prompt Example:</h4>
              <p className="text-sm italic text-white/80">
                "Make a crypto website."
              </p>
            </div>
          </section>

          <hr className="border-white/10 my-12" />

          <section id="previews" className="mb-16 pt-4">
            <h2 className="text-3xl font-serif mb-6">Live Previews (Wildcard Subdomains)</h2>
            <p>
              When your app is generated, Crevo AI automatically assigns it a unique wildcard subdomain 
              (e.g., <code>app-xxxxx.crevoai.website</code>).
            </p>
            <p className="mt-4">
              This link is completely public! You can copy the URL and share it with friends, clients, or investors. 
              The preview runs directly from our server using a virtualized Sandpack environment.
            </p>
          </section>

          <hr className="border-white/10 my-12" />

          <section id="deployments" className="mb-16 pt-4">
            <h2 className="text-3xl font-serif mb-6">Deploying to Vercel</h2>
            <p>
              If you want to take your app out of the Sandpack environment and deploy it for production, 
              we offer one-click Vercel integration.
            </p>
            <ol className="list-decimal pl-5 space-y-2 mt-4 text-white/80">
              <li>Go to your account settings and link your Vercel API token.</li>
              <li>Click the "Deploy to Vercel" button in the workspace.</li>
              <li>Crevo AI will instantly push your code to Vercel and return a production URL.</li>
            </ol>
          </section>

          <hr className="border-white/10 my-12" />

          <section id="billing" className="mb-16 pt-4">
            <h2 className="text-3xl font-serif mb-6">Credits & Billing</h2>
            <p>
              Generating complex applications requires massive computational power. To keep the platform sustainable, 
              we use a credit system.
            </p>
            <ul className="space-y-3 mt-6">
              <li className="flex items-start gap-2">
                <div className="mt-1 w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                <span><strong>Free Tier:</strong> New users receive 10 free credits to test the platform.</span>
              </li>
              <li className="flex items-start gap-2">
                <div className="mt-1 w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                <span><strong>Pro Tier ($20/mo):</strong> Grants you 500 credits per month, priority queueing, and Vercel deployments.</span>
              </li>
            </ul>
            <p className="mt-6 text-sm text-white/50">
              Note: 1 Credit = 1 AI Generation. Undo actions or simple text chats do not consume credits.
            </p>
          </section>

        </main>
      </div>
    </div>
  );
}
