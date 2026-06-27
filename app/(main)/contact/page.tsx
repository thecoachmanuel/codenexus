"use client";

import { useState } from "react";
import { Mail, MessageSquare, Send, User } from "lucide-react";
import { toast } from "sonner";

export default function ContactPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to send message");

      toast.success("Message sent successfully! We'll get back to you soon.");
      setFormData({ name: "", email: "", subject: "", message: "" });
    } catch (error: any) {
      toast.error(error.message || "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] pt-32 pb-20 relative overflow-hidden">
      {/* Background Gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-indigo-500/10 blur-[120px] rounded-full pointer-events-none" />
      
      <div className="container max-w-4xl mx-auto px-6 relative z-10">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-serif text-white mb-4">Get in Touch</h1>
          <p className="text-lg text-white/60 max-w-2xl mx-auto">
            Have questions about Crevo AI, need help with a custom enterprise plan, or just want to say hi? Send us a message!
          </p>
        </div>

        <div className="bg-[#111] border border-white/10 rounded-2xl p-8 md:p-12 shadow-2xl backdrop-blur-sm max-w-3xl mx-auto">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-white/80 flex items-center gap-2">
                  <User className="w-4 h-4" /> Name
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                  placeholder="John Doe"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-white/80 flex items-center gap-2">
                  <Mail className="w-4 h-4" /> Email Address
                </label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                  placeholder="john@example.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" /> Subject
              </label>
              <input
                type="text"
                required
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                placeholder="How can we help?"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">Message</label>
              <textarea
                required
                rows={6}
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all resize-none"
                placeholder="Tell us everything..."
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-4 bg-white text-black rounded-xl font-medium text-lg flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  Send Message <Send className="w-5 h-5" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
