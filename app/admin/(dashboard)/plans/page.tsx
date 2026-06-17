"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Plan = {
  _id: string;
  key: string;
  label: string;
  description: string;
  price: number;
  credits: number;
  features: string[];
  featured: boolean;
};

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchPlans = async () => {
    try {
      const res = await fetch("/api/admin/plans");
      const data = await res.json();
      if (res.ok) setPlans(data.plans);
    } catch (err) {
      toast.error("Failed to fetch plans");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlan) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingPlan),
      });
      if (!res.ok) throw new Error("Failed to save plan");
      toast.success("Plan updated successfully");
      setEditingPlan(null);
      fetchPlans();
    } catch (err) {
      toast.error("Failed to save plan");
    } finally {
      setSaving(false);
    }
  };

  const handleFeatureChange = (index: number, value: string) => {
    if (!editingPlan) return;
    const newFeatures = [...editingPlan.features];
    newFeatures[index] = value;
    setEditingPlan({ ...editingPlan, features: newFeatures });
  };

  const removeFeature = (index: number) => {
    if (!editingPlan) return;
    const newFeatures = editingPlan.features.filter((_, i) => i !== index);
    setEditingPlan({ ...editingPlan, features: newFeatures });
  };

  const addFeature = () => {
    if (!editingPlan) return;
    setEditingPlan({
      ...editingPlan,
      features: [...editingPlan.features, ""],
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-white/30" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Pricing Plans</h1>
        <p className="text-white/40 text-sm mt-1">Manage subscription plans and credits.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <div
            key={plan.key}
            className={cn(
              "flex flex-col bg-[#111] rounded-xl border p-6 transition-colors",
              plan.featured ? "border-blue-500/30" : "border-white/10"
            )}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">{plan.label}</h2>
              {plan.featured && (
                <span className="px-2 py-1 text-[10px] font-medium text-blue-400 bg-blue-500/10 rounded-full border border-blue-500/20">
                  Featured
                </span>
              )}
            </div>
            <p className="text-sm text-white/40 mb-6 flex-1">{plan.description}</p>
            <div className="space-y-1 mb-6">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-white">${plan.price}</span>
                <span className="text-white/40 text-sm">/mo</span>
              </div>
              <div className="text-sm text-blue-400 font-medium">
                {plan.credits} Credits included
              </div>
            </div>
            <button
              onClick={() => setEditingPlan(plan)}
              className="w-full py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-sm font-medium transition-colors border border-white/10"
            >
              Edit Plan
            </button>
          </div>
        ))}
      </div>

      {editingPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-[#111] border border-white/10 rounded-xl w-full max-w-2xl my-8">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <h2 className="text-xl font-semibold text-white">Edit {editingPlan.label} Plan</h2>
              <button
                onClick={() => setEditingPlan(null)}
                className="text-white/40 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSave} className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-white/70">Label</label>
                  <input
                    type="text"
                    value={editingPlan.label}
                    onChange={(e) => setEditingPlan({ ...editingPlan, label: e.target.value })}
                    className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-white/70">Description</label>
                  <input
                    type="text"
                    value={editingPlan.description}
                    onChange={(e) => setEditingPlan({ ...editingPlan, description: e.target.value })}
                    className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-white/70">Price (USD)</label>
                  <input
                    type="number"
                    value={editingPlan.price}
                    onChange={(e) => setEditingPlan({ ...editingPlan, price: Number(e.target.value) })}
                    className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
                    min="0"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-white/70">Credits Provided</label>
                  <input
                    type="number"
                    value={editingPlan.credits}
                    onChange={(e) => setEditingPlan({ ...editingPlan, credits: Number(e.target.value) })}
                    className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
                    min="0"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4">
                <input
                  type="checkbox"
                  id="featured"
                  checked={editingPlan.featured}
                  onChange={(e) => setEditingPlan({ ...editingPlan, featured: e.target.checked })}
                  className="rounded border-white/20 bg-black/50"
                />
                <label htmlFor="featured" className="text-sm text-white/70">Mark as Featured (Highlights plan)</label>
              </div>

              <div className="space-y-3 pt-4 border-t border-white/10">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-white/70">Features</label>
                  <button
                    type="button"
                    onClick={addFeature}
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add Feature
                  </button>
                </div>
                {editingPlan.features.map((feature, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={feature}
                      onChange={(e) => handleFeatureChange(idx, e.target.value)}
                      className="flex-1 bg-black/50 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
                      placeholder="e.g. Priority Support"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => removeFeature(idx)}
                      className="p-2 text-white/40 hover:text-red-400"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-3 pt-6 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setEditingPlan(null)}
                  className="px-4 py-2 text-sm font-medium text-white/70 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
