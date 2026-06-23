"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";

export default function AdminSettingsPage() {
  const [exchangeRate, setExchangeRate] = useState<number | "">("");
  const [defaultModel, setDefaultModel] = useState("");
  const [proModel, setProModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.settings?.exchangeRate) {
          setExchangeRate(data.settings.exchangeRate);
        }
        if (data.settings?.defaultModel) {
          setDefaultModel(data.settings.defaultModel);
        }
        if (data.settings?.proModel) {
          setProModel(data.settings.proModel);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!exchangeRate || isNaN(Number(exchangeRate))) {
      setMessage({ type: "error", text: "Please enter a valid number" });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          exchangeRate: Number(exchangeRate),
          defaultModel,
          proModel
        }),
      });
      const data = await res.json();
      
      if (res.ok) {
        setMessage({ type: "success", text: "Settings saved successfully" });
        setExchangeRate(data.settings.exchangeRate);
      } else {
        setMessage({ type: "error", text: data.message || "Failed to save settings" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "An unexpected error occurred" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-white/40 text-sm mt-1">Configure global application settings.</p>
      </div>

      <div className="rounded-xl bg-[#111] border border-white/10 p-6 space-y-6">
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-medium text-white">Billing & Payments</h2>
            <p className="text-xs text-white/40 mt-1">
              Set the exchange rate to convert USD prices (e.g. $9 Starter) into NGN for Paystack checkout.
            </p>
          </div>

          {loading ? (
            <div className="flex py-4">
              <Loader2 className="w-5 h-5 animate-spin text-white/30" />
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/70">
                NGN to USD Exchange Rate
              </label>
              <div className="flex items-center gap-3">
                <div className="relative max-w-[200px]">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-sm">
                    ₦
                  </span>
                  <input
                    type="number"
                    value={exchangeRate}
                    onChange={(e) => setExchangeRate(e.target.value ? Number(e.target.value) : "")}
                    className="w-full bg-black/50 border border-white/10 rounded-lg pl-8 pr-4 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                    placeholder="e.g. 1500"
                    min={1}
                  />
                </div>
                <span className="text-sm text-white/40">per 1 USD</span>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4 pt-6 border-t border-white/10">
          <div>
            <h2 className="text-base font-medium text-white">AI Models</h2>
            <p className="text-xs text-white/40 mt-1">
              Configure which Gemini models power the application. Ensure the models are supported by your API key.
            </p>
          </div>

          {loading ? (
            <div className="flex py-4">
              <Loader2 className="w-5 h-5 animate-spin text-white/30" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-white/70">
                  Default Model (Fast)
                </label>
                <input
                  type="text"
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                  placeholder="e.g. gemini-2.5-flash"
                />
                <p className="text-[11px] text-white/30">Used for initial generation and basic edits.</p>
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium text-white/70">
                  Pro Model (Smart)
                </label>
                <input
                  type="text"
                  value={proModel}
                  onChange={(e) => setProModel(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                  placeholder="e.g. gemini-2.5-pro"
                />
                <p className="text-[11px] text-white/30">Used for complex tasks and Pro users.</p>
              </div>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-white/10 flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save Settings
          </button>

          {message && (
            <span
              className={`text-sm ${
                message.type === "success" ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {message.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
