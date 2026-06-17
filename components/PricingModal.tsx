"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { BlueTitle, GrayTitle } from "./reusables";
import { PRICING_PLANS as FALLBACK_PLANS } from "@/lib/constants";
import { useAuthContext } from "@/components/AuthProvider";
import Link from "next/link";

interface PricingModalProps {
  children: React.ReactNode;
  reason?: "credits" | "upgrade";
}

export function PricingModal({
  children,
  reason = "upgrade",
}: PricingModalProps) {
  const { isSignedIn, user } = useAuthContext();
  const router = useRouter();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [plans, setPlans] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/plans")
      .then(res => res.json())
      .then(data => {
        if (data.plans) setPlans(data.plans);
      })
      .catch(err => console.error("Failed to fetch plans", err));
  }, []);

  const title =
    reason === "credits" ? "You're out of credits" : "Upgrade your plan";
  const description =
    reason === "credits"
      ? "You've used all your credits. Upgrade to keep building."
      : "Choose a plan that fits how much you build.";

  const planOrder: Record<string, number> = {
    free: 0,
    starter: 1,
    pro: 2,
  };

  const activePlanKey = user?.plan ?? (isSignedIn ? "free" : null);

  const handleUpgrade = async (planKey: string) => {
    if (!isSignedIn) {
      router.push("/sign-in");
      return;
    }
    setLoadingPlan(planKey);
    try {
      const res = await fetch("/api/billing/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      // Redirect to Paystack hosted checkout
      window.location.href = data.authorizationUrl;
    } catch (err) {
      console.error(err);
      setLoadingPlan(null);
    }
  };

  return (
    <Dialog>
      <DialogTrigger className={"cursor-pointer"}>{children}</DialogTrigger>
      <DialogContent className="border-white/20 bg-[#0f0f0f] p-0 text-white sm:max-w-5xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="font-serif text-xl tracking-tight text-white/90">
            <BlueTitle className="text-4xl">{title}</BlueTitle>
          </DialogTitle>
          <DialogDescription className="text-base text-white/35">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 px-6 pb-6 sm:grid-cols-3">
          {(plans.length > 0 ? plans : FALLBACK_PLANS).map((plan) => {
            const isActive = isSignedIn && activePlanKey === plan.key;
            const isDowngrade =
              isSignedIn &&
              activePlanKey !== null &&
              !isActive &&
              planOrder[plan.key] < planOrder[activePlanKey];
            const isLoading = loadingPlan === plan.key;

            return (
              <div
                key={plan.key}
                className={cn(
                  "relative flex flex-col rounded-2xl border p-5 transition-colors",
                  plan.featured
                    ? "border-blue-500/50 bg-blue-500/4"
                    : "border-white/12 bg-[#0a0a0a]"
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
                <p className="mb-6 text-sm leading-relaxed text-white/35">
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
                          <span className="text-xl font-medium text-white/30 line-through">
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
                    <span className="text-base text-white/60">/mo</span>
                  )}
                </div>
                <p className="mb-6 text-sm text-white/25">
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
                      <span className="text-sm text-white/55">{f}</span>
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
                  ) : (
                    <Button
                      onClick={() => handleUpgrade(plan.key)}
                      disabled={isLoading || !!loadingPlan}
                      className={cn(
                        "w-full rounded-full text-base font-semibold transition-all",
                        plan.featured
                          ? "bg-blue-500 text-white hover:bg-blue-400 active:scale-95"
                          : "border border-white/25 bg-transparent text-white/90 hover:bg-white/6 hover:text-white/90"
                      )}
                      variant="ghost"
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          {isDowngrade ? "Downgrade" : "Upgrade"}
                          <ArrowRight className="h-3.5 w-3.5" />
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
