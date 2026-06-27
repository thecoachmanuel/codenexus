"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthContext } from "@/components/AuthProvider";
import { ArrowRight, Zap, ChevronRight, Check, Monitor, Sparkles, Paperclip, X, ImageIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { HoleBackground } from "@/components/animate-ui/components/backgrounds/hole";
import { Badge } from "@/components/ui/badge";
import { FEATURES, PLACEHOLDERS, STEPS, SUGGESTIONS_SETS } from "@/lib/data";
import { PRICING_PLANS as FALLBACK_PLANS } from "@/lib/constants";
import {
  BlueTitle,
  GrayTitle,
  SectionHeading,
  SectionLabel,
} from "@/components/reusables";
import { PricingModal } from "@/components/PricingModal";

// Image upload limits per plan
const IMAGE_LIMITS: Record<string, number> = {
  free: 0,
  starter: 3,
  pro: 10,
};

export default function LandingPage() {
  const { isSignedIn, user } = useAuthContext();
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [prompt, setPrompt] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [suggestionSets, setSuggestionSets] = useState(SUGGESTIONS_SETS);
  const [placeholders, setPlaceholders] = useState(PLACEHOLDERS);
  const [suggestions, setSuggestions] = useState(SUGGESTIONS_SETS[0]);
  const [plans, setPlans] = useState<any[]>([]);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isGeneratingIdeas, setIsGeneratingIdeas] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const userPlan = (user?.plan ?? "free") as string;
  const imageLimit = IMAGE_LIMITS[userPlan] ?? 0;
  const canUploadImage = isSignedIn && imageLimit > 0 && uploadCount < imageLimit;

  useEffect(() => {
    import("@/actions/admin").then(m => m.checkIsAdmin().then(setIsAdmin).catch(() => {}));

    fetch("/api/settings/public")
      .then(res => res.json())
      .then(data => {
        if (data.suggestions && data.placeholders) {
          setSuggestionSets(data.suggestions);
          setPlaceholders(data.placeholders);
          setSuggestions(data.suggestions[Math.floor(Math.random() * data.suggestions.length)]);
        } else {
          setSuggestions(SUGGESTIONS_SETS[Math.floor(Math.random() * SUGGESTIONS_SETS.length)]);
        }
      })
      .catch(() => {
        setSuggestions(SUGGESTIONS_SETS[Math.floor(Math.random() * SUGGESTIONS_SETS.length)]);
      });

    // Fetch dynamic plans
    fetch("/api/plans")
      .then(res => res.json())
      .then(data => {
        if (data.plans) setPlans(data.plans);
      })
      .catch(err => console.error("Failed to fetch plans", err));
  }, []);

  useEffect(() => {
    if (isFocused || prompt) return;
    const t = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % placeholders.length);
    }, 3000);
    return () => clearInterval(t);
  }, [isFocused, prompt, placeholders]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [prompt]);

  const handleSubmit = () => {
    if (!prompt.trim() || !isSignedIn) return;
    const params = new URLSearchParams({ prompt: prompt.trim() });
    if (pendingImageUrl) {
      // Store image in sessionStorage to avoid enormous query params
      sessionStorage.setItem("initial_image", pendingImageUrl);
      params.set("hasImage", "1");
    }
    router.push(`/workspace?${params.toString()}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSuggestion = (s: string) => {
    setPrompt(s);
    textareaRef.current?.focus();
  };

  const handleGenerateIdeas = async () => {
    if (isGeneratingIdeas) return;
    try {
      setIsGeneratingIdeas(true);
      const { generateNewPromptSuggestions } = await import("@/actions/admin");
      await generateNewPromptSuggestions();
      window.location.reload();
    } catch (e) {
      alert("Failed to generate new ideas.");
    } finally {
      setIsGeneratingIdeas(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    if (!canUploadImage) return;

    // Limit file size to 4MB for sessionStorage safety
    if (file.size > 4 * 1024 * 1024) {
      alert("Image must be under 4 MB");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setPendingImageUrl(dataUrl);
      setUploadCount((c) => c + 1);
      setIsUploading(false);
    };
    reader.onerror = () => {
      setIsUploading(false);
    };
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleEnhancePrompt = async () => {
    if (!prompt.trim() || isEnhancing) return;
    if (!isSignedIn) {
      router.push("/sign-up");
      return;
    }
    try {
      setIsEnhancing(true);
      const res = await fetch("/api/enhance-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (data.enhancedPrompt) {
        setPrompt(data.enhancedPrompt);
      }
    } catch (error) {
      console.error("Failed to enhance prompt:", error);
    } finally {
      setIsEnhancing(false);
    }
  };

  const displayPlans = plans.length > 0 ? plans : FALLBACK_PLANS;

  return (
    <main className="min-h-screen bg-[#000000] selection:bg-white/20">
      {/* ── HERO ──────────────────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center overflow-hidden bg-[#000000] px-4 pb-24 pt-40 text-center">
        {/* Light flecks animation — stroke is transparent to prevent any white/gray grid, leaving only the pure black background and the light particles */}
        <HoleBackground
          strokeColor="transparent"
          particleRGBColor={[147, 197, 253]}
          className="absolute inset-0 h-full w-full"
          style={{
            maskImage:
              "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.5) 50%, transparent 100%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(0,0,0,1) 0%, rgba(0,0,0,0.5) 50%, transparent 100%)",
          }}
        />

        {/* Colorful radial glow — using screen blend mode to eliminate muddy gray fade */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 50% 40% at 50% -10%, rgba(99,102,241,0.2) 0%, rgba(59,130,246,0.15) 40%, rgba(0,0,0,0) 80%)",
            mixBlendMode: "screen",
          }}
        />
        {/* Subtle warm accent glow bottom-left */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 35% 30% at 10% 100%, rgba(168,85,247,0.1) 0%, rgba(0,0,0,0) 80%)",
            mixBlendMode: "screen",
          }}
        />

        <Badge variant="outline" className="gap-2 p-4 backdrop-blur-sm text-white border-white/20">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Build with Crevo AI
        </Badge>

        <h1 className="mx-auto max-w-3xl text-balance font-serif text-5xl leading-tight tracking-tight sm:text-6xl lg:text-7xl z-10">
          <GrayTitle>Turn ideas into working</GrayTitle>
          <br />
          <BlueTitle>apps and websites in seconds.</BlueTitle>
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-balance text-base leading-relaxed text-white/70 z-10">
          Describe what you want to build. AI writes the code, picks the
          packages, and renders a live preview all inside your browser.
        </p>

        <div className="relative mx-auto mt-12 w-full max-w-2xl">
          <div
            className={cn(
              "rounded-2xl border bg-[#111111] duration-200",
              isFocused
                ? "border-white/20 ring-1 ring-white/8"
                : "border-white/20"
            )}
          >
            {/* Image preview strip */}
            {pendingImageUrl && (
              <div className="relative mx-4 mt-3 w-fit">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pendingImageUrl}
                  alt="Design reference"
                  className="h-20 w-20 rounded-xl object-cover ring-1 ring-white/20"
                />
                <button
                  onClick={() => setPendingImageUrl(null)}
                  className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/90 text-white/90 ring-1 ring-white/20 hover:text-white transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
                <span className="absolute -bottom-1.5 left-1 rounded-sm bg-emerald-500/20 px-1 py-0.5 text-[9px] font-bold text-emerald-400 leading-none">
                  DESIGN REF
                </span>
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder={placeholders[placeholderIndex] || "Describe what you want to build..."}
              rows={1}
              className="w-full resize-none bg-transparent px-5 pb-4 pt-5 text-base placeholder:text-white/20 focus:outline-none sm:text-base"
              style={{ minHeight: 56, maxHeight: 200 }}
            />

            <div className="flex items-center justify-between border-t border-white/6 px-4 py-2.5">
              {/* Left side — image upload */}
              <div className="flex items-center gap-2">
                {isSignedIn && imageLimit > 0 ? (
                  // Paid plan — show upload button
                  <>
                    <button
                      onClick={() => fileRef.current?.click()}
                      disabled={isUploading || uploadCount >= imageLimit}
                      title={uploadCount >= imageLimit ? `Limit of ${imageLimit} image${imageLimit !== 1 ? "s" : ""} reached` : `Upload design reference (${uploadCount}/${imageLimit} used)`}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-medium transition-all",
                        uploadCount >= imageLimit
                          ? "cursor-not-allowed text-white/20"
                          : pendingImageUrl
                          ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/20"
                          : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70"
                      )}
                    >
                      {isUploading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ImageIcon className="h-3.5 w-3.5" />
                      )}
                      <span className="hidden sm:inline">
                        {isUploading
                          ? "Uploading…"
                          : pendingImageUrl
                          ? "Image attached"
                          : "Add image"}
                      </span>
                      <span className="text-[10px] opacity-60">
                        {uploadCount}/{imageLimit}
                      </span>
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                  </>
                ) : isSignedIn ? (
                  // Free plan — show locked state with upgrade prompt
                  <PricingModal reason="upgrade">
                    <button
                      title="Upgrade to Starter or Pro to upload design images"
                      className="flex items-center gap-1.5 rounded-full bg-white/4 px-2.5 py-1.5 text-[12px] text-white/25 transition-all hover:bg-white/8 hover:text-white/40 cursor-pointer"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Add image</span>
                      <span className="rounded-sm bg-white/10 px-1 py-0.5 text-[9px] font-bold">STARTER+</span>
                    </button>
                  </PricingModal>
                ) : (
                  <span className="text-sm text-white/30 hidden sm:inline">
                    Press ⏎ to generate
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {isSignedIn ? (
                  <Button
                    onClick={handleEnhancePrompt}
                    disabled={!prompt.trim() || isEnhancing}
                    className={cn(
                      "h-8 rounded-full px-4 font-semibold transition-all",
                      prompt.trim()
                        ? "bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
                        : "bg-white/5 text-white/30"
                    )}
                    variant="ghost"
                  >
                    <Sparkles className={cn("h-3.5 w-3.5 mr-1.5", isEnhancing && "animate-pulse text-blue-300")} />
                    <span className="hidden sm:inline">{isEnhancing ? "Improving..." : "Improve with AI"}</span>
                    <span className="sm:hidden">{isEnhancing ? "..." : "Improve"}</span>
                  </Button>
                ) : (
                  <Link href="/sign-up">
                    <Button
                      className={cn(
                        "h-8 rounded-full px-4 font-semibold transition-all",
                        prompt.trim()
                          ? "bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
                          : "bg-white/5 text-white/30"
                      )}
                      variant="ghost"
                    >
                      <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                      <span className="hidden sm:inline">Improve with AI</span>
                      <span className="sm:hidden">Improve</span>
                    </Button>
                  </Link>
                )}

                {isSignedIn ? (
                  <Button
                    onClick={handleSubmit}
                    disabled={!prompt.trim()}
                    className={cn(
                      "h-8 rounded-full px-5 font-semibold transition-all",
                      prompt.trim()
                        ? "bg-white text-black hover:bg-white/90"
                        : "bg-white/10 text-white/40"
                    )}
                    variant="ghost"
                  >
                    Generate
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Link href="/sign-up">
                    <Button className="h-8 rounded-full bg-white text-black px-5 font-semibold hover:bg-white/90">
                      Generate
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-col items-center gap-4">
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSuggestion(s)}
                  className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white/80 hover:border-white/30 hover:bg-white/10 hover:text-white"
                >
                  {s}
                </button>
              ))}
            </div>
            
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateIdeas}
                disabled={isGeneratingIdeas}
                className="mt-2 h-7 rounded-full border-white/10 bg-white/5 text-[11px] text-white/50 hover:bg-white/10 hover:text-white"
              >
                {isGeneratingIdeas ? (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-3 w-3" />
                )}
                {isGeneratingIdeas ? "Generating Ideas..." : "Generate New AI Suggestions"}
              </Button>
            )}
          </div>


        </div>

        <p className="mt-10 text-sm text-white/40">
          No credit card required · 10 free generations on sign up
        </p>
      </section>

      {/* BROWSER MOCKUP */}
      <section className="px-4 pb-32">
        <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-white/20 bg-[#0a0a0a] shadow-2xl shadow-black/80">
          <div className="flex items-center gap-2 border-b border-white/6 px-4 py-3">
            <div className="flex gap-1.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-3 w-3 rounded-full bg-white/10" />
              ))}
            </div>

            <div className="mx-auto flex h-6 w-64 items-center justify-center rounded-md bg-white/5 px-3">
              <span className="text-sm text-white/25">crevoai.website/workspace</span>
            </div>
          </div>

          <div className="flex h-105">
            {/* Chat panel */}
            <div className="flex w-80 flex-col border-r border-white/6 bg-[#0d0d0d]">
              <div className="border-b border-white/6 px-4 py-3">
                <p className="text-sm uppercase tracking-wider text-white/60">
                  Chat
                </p>
              </div>

              <div className="flex-1 space-y-4 px-4 py-4">
                <div className="flex justify-end">
                  <div className="max-w-55 rounded-2xl rounded-br-sm bg-white/10 px-3.5 py-2.5">
                    <p className="text-sm text-white">
                      Build a kanban board with 3 columns and drag-and-drop
                    </p>
                  </div>
                </div>

                <div className="flex gap-2.5">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white">
                    <Zap className="h-3 w-3 fill-black text-black" />
                  </div>

                  <div className="rounded-2xl rounded-tl-sm bg-white/5 px-3.5 py-2.5">
                    <p className="text-sm text-white/90">
                      I&apos;ll build a Kanban board with Todo, In Progress, and
                      Done columns. I&apos;ll use{" "}
                      <code className="text-blue-400/80">@dnd-kit/core</code>{" "}
                      for smooth drag-and-drop…
                    </p>
                  </div>
                </div>

                <div className="flex gap-2.5">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white">
                    <Zap className="h-3 w-3 fill-black text-black" />
                  </div>
                  <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-white/5 px-3.5 py-3">
                    {[0, 0.15, 0.3].map((delay) => (
                      <span
                        key={delay}
                        className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40"
                        style={{ animationDelay: `${delay}s` }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="border-t border-white/6 px-3 py-3">
                <div className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                  <span className="flex-1 text-sm text-white/40">
                    Ask AI to modify…
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-white/40" />
                </div>
              </div>
            </div>

            <div className="flex flex-1 flex-col">
              <div className="flex items-center gap-1 border-b border-white/6 px-4">
                <button className="border-b-2 border-blue-400 px-3 py-2.5 text-sm text-white">
                  Preview
                </button>
                <button className="px-3 py-2.5 text-sm text-white/60">
                  Code
                </button>
              </div>

              <div className="flex flex-1 gap-3 overflow-hidden bg-[#141414] p-5">
                {["Todo", "In Progress", "Done"].map((col, ci) => (
                  <div key={col} className="flex w-1/3 flex-col gap-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-sm uppercase tracking-wider text-white/70">
                        {col}
                      </span>

                      <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-sm text-white/60">
                        {[3, 2, 1][ci]}
                      </span>
                    </div>

                    {Array.from({ length: [3, 2, 1][ci] }).map((_, i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-white/20 bg-[#1a1a1a] p-2.5"
                      >
                        <div
                          className="mb-1.5 h-2 rounded-full bg-white/15"
                          style={{ width: `${60 + i * 15}%` }}
                        />
                        <div className="h-1.5 w-3/4 rounded-full bg-white/8" />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ──────────────────────────────────────────────────────── */}
      <section className="px-4 pb-32">
        <div className="mx-auto mb-14 max-w-5xl text-center">
          <SectionLabel>Everything you need</SectionLabel>
          <SectionHeading gray="From prompt" blue="to production." />
        </div>

        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-px overflow-hidden rounded-2xl border border-white/6 bg-white/6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, label, desc }) => (
            <div
              key={label}
              className="group bg-[#000000] p-7 hover:bg-[#0a0a0a]"
            >
              <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg border border-white/20 bg-white/4 group-hover:border-white/15 group-hover:bg-white/8">
                <Icon className="h-4 w-4 text-white/90 group-hover:text-blue-400/70" />
              </div>
              <p className="mb-2 text-base font-semibold">{label}</p>
              <p className="text-base leading-relaxed text-white/70">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="px-4 pb-32">
        <div className="mx-auto mb-14 max-w-3xl text-center">
          <SectionLabel>How it works</SectionLabel>
          <SectionHeading gray="Four steps" blue="to a working app." />
        </div>

        <div className="mx-auto max-w-3xl">
          {STEPS.map((step, i) => (
            <div key={step.number} className="flex gap-6">
              <div className="flex flex-col items-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-white/4">
                  <span className="font-mono text-sm font-semibold text-white/80">
                    {step.number}
                  </span>
                </div>

                {i < STEPS.length - 1 && (
                  <div className="mt-2 h-full w-px bg-white/6" />
                )}
              </div>

              <div className="pb-10 pt-1.5">
                <p className="mb-1.5 text-base font-semibold sm:text-base">
                  {step.label}
                </p>

                <p className="text-base leading-relaxed text-white/70">
                  {step.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section className="px-4 pb-32">
        <div className="mx-auto mb-14 max-w-5xl text-center">
          <SectionLabel>Simple pricing</SectionLabel>
          <SectionHeading gray="Start free," blue="scale when ready." />

          <p className="mx-auto mt-4 max-w-sm text-base text-white/70">
            No credit card required. Upgrade or downgrade anytime.
          </p>
        </div>

        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 sm:grid-cols-3">
          {displayPlans.map((plan) => {
            const planOrder: Record<string, number> = {
              free: 0,
              starter: 1,
              pro: 2,
            };
            const activePlanKey = isSignedIn
              ? user?.plan ?? "free"
              : null;

            const isActive = isSignedIn && activePlanKey === plan.key;
            const isDowngrade =
              isSignedIn &&
              activePlanKey !== null &&
              !isActive &&
              planOrder[plan.key] < planOrder[activePlanKey];

            return (
              <div
                key={plan.key}
                className={cn(
                  "relative flex flex-col rounded-2xl border p-7 transition-colors",
                  plan.featured
                    ? "border-blue-500/25 bg-blue-500/4"
                    : "border-white/20 bg-[#0a0a0a]"
                )}
              >
                {/* Most popular pill and Discount pill */}
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex gap-2">
                  {plan.featured && (
                    <span className="rounded-full border border-blue-500/20 bg-[#0a0a0a] px-3 py-1 text-[11px] font-medium text-blue-400 whitespace-nowrap">
                      Most popular
                    </span>
                  )}
                  {plan.discountPercent > 0 && (!plan.discountOneTimePerUser || !user?.usedDiscountPlans?.includes(plan.key)) && (
                    <span className="rounded-full border border-emerald-500/20 bg-[#0a0a0a] px-3 py-1 text-[11px] font-bold text-emerald-400 whitespace-nowrap">
                      {plan.discountPercent}% OFF
                    </span>
                  )}
                </div>

                {/* Plan name + active badge */}
                <div className="mb-1 flex items-center gap-2">
                  <p className="text-base font-semibold text-white/90">
                    {plan.label}
                  </p>
                  {isActive && (
                    <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                      Active
                    </span>
                  )}
                </div>

                {/* Description */}
                <p className="mb-6 text-sm leading-relaxed text-white/70">
                  {plan.description}
                </p>

                {/* Price */}
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="font-serif text-4xl flex items-center gap-2">
                    {plan.price === 0 ? (
                      <GrayTitle>$0</GrayTitle>
                    ) : (
                      <>
                        {plan.discountPercent > 0 && 
                         (!plan.discountOneTimePerUser || !user?.usedDiscountPlans?.includes(plan.key)) && (
                          <span className="text-xl font-medium text-white/60 line-through">
                            ${plan.price}
                          </span>
                        )}
                        <BlueTitle>
                          ${plan.discountPercent > 0 && (!plan.discountOneTimePerUser || !user?.usedDiscountPlans?.includes(plan.key))
                              ? (plan.price * (1 - plan.discountPercent / 100)).toFixed(2).replace(/\.00$/, '')
                              : plan.price}
                        </BlueTitle>
                      </>
                    )}
                  </span>
                  {plan.price > 0 && (
                    <span className="text-base text-white/80">/mo</span>
                  )}
                </div>
                <p className="mb-6 text-sm text-white/60">
                  {plan.price === 0 ? "Always free" : "Only billed monthly"}
                </p>

                {/* Feature list */}
                <div className="mb-8 space-y-3 border-t border-white/6 pt-6">
                  {plan.features.map((f: string) => (
                    <div key={f} className="flex items-center gap-2.5">
                      <div
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                          plan.featured ? "bg-blue-500/15" : "bg-white/8"
                        )}
                      >
                        <Check
                          className={cn(
                            "h-2.5 w-2.5",
                            plan.featured ? "text-blue-400" : "text-white/80"
                          )}
                        />
                      </div>
                      <span className="text-sm text-white/90">{f}</span>
                    </div>
                  ))}
                </div>

                {/* CTA button */}
                <div className="mt-auto">
                  {isActive ? (
                    <Button
                      disabled
                      className="w-full rounded-full text-base font-semibold opacity-50 cursor-not-allowed border border-white/25 bg-transparent text-white/90"
                      variant="ghost"
                    >
                      ✓ Current plan
                    </Button>
                  ) : plan.price === 0 ? (
                    isSignedIn ? (
                      <Button
                        disabled
                        className="w-full rounded-full text-base font-semibold opacity-50 cursor-not-allowed border border-white/25 bg-transparent text-white/90"
                        variant="ghost"
                      >
                        Default plan
                      </Button>
                    ) : (
                      <Link href="/sign-up">
                        <Button
                          className="w-full rounded-full text-base font-semibold border border-white/25 bg-transparent text-white/90 hover:bg-white/6 hover:text-white/90"
                          variant="ghost"
                        >
                          Get started free
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    )
                  ) : isSignedIn ? (
                    <PricingModal>
                      <Button
                        className={cn(
                          "w-full rounded-full text-base font-semibold transition-all",
                          plan.featured
                            ? "bg-blue-500 text-white hover:bg-blue-400 active:scale-95"
                            : "border border-white/25 bg-transparent text-white/90 hover:bg-white/6 hover:text-white/90"
                        )}
                        variant="ghost"
                      >
                        {isDowngrade ? "Downgrade" : "Get started"}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </PricingModal>
                  ) : (
                    <Link href="/sign-up">
                      <Button
                        className={cn(
                          "w-full rounded-full text-base font-semibold transition-all",
                          plan.featured
                            ? "bg-blue-500 text-white hover:bg-blue-400 active:scale-95"
                            : "border border-white/25 bg-transparent text-white/90 hover:bg-white/6 hover:text-white/90"
                        )}
                        variant="ghost"
                      >
                        Get started
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <section className="relative mx-auto mb-32 max-w-5xl overflow-hidden rounded-2xl border border-white/20 px-10 py-24 text-center">
        <HoleBackground
          strokeColor="rgba(255,255,255,0.05)" // blur
          numberOfLines={36}
          numberOfDiscs={36}
          particleRGBColor={[147, 197, 253]}
          className="absolute inset-0 h-full w-full"
          style={{
            maskImage:
              "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)",
          }}
        />

        <SectionHeading gray="Start building," blue="for free." />

        <p className="mb-8 text-base leading-relaxed text-white/90">
          Get 10 free generations on sign up. No credit card required.
          <br />
          Upgrade when you&apos;re ready.
        </p>

        <Link href="/sign-up">
          <Button
            size="lg"
            className="relative h-11 rounded-full bg-white px-8"
          >
            Get started free
            <ChevronRight className="h-4 w-4" />
          </Button>
        </Link>
      </section>

      <footer className="relative z-10 border-t border-white/7 py-12 mx-auto px-6 flex flex-wrap items-center justify-center text-white/70">
        Developed by Coach Manuel
      </footer>
    </main>
  );
}
