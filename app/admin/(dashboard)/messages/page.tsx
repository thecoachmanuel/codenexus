"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Mail, Check, Inbox, MessageSquare, Trash2, Expand } from "lucide-react";
import { toast } from "sonner";

interface ContactMessage {
  _id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: "unread" | "read";
  createdAt: string;
}

export default function AdminMessagesPage() {
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<ContactMessage | null>(null);

  useEffect(() => {
    fetchMessages();
  }, []);

  const fetchMessages = async () => {
    try {
      const res = await fetch("/api/admin/messages");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessages(data.messages);
    } catch (error) {
      toast.error("Failed to load messages");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleStatus = async (id: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === "read" ? "unread" : "read";
      const res = await fetch(`/api/admin/messages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      
      if (!res.ok) throw new Error();
      
      setMessages(messages.map(m => m._id === id ? { ...m, status: newStatus } : m));
      toast.success(`Marked as ${newStatus}`);
    } catch (error) {
      toast.error("Failed to update status");
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Messages</h1>
        <div className="flex items-center gap-2 bg-[#111] px-4 py-2 rounded-lg border border-white/10">
          <Inbox className="w-4 h-4 text-white/60" />
          <span className="text-sm font-medium">
            {messages.filter(m => m.status === "unread").length} Unread
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#111] overflow-hidden">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-white/40">
            <MessageSquare className="w-12 h-12 mb-4 opacity-20" />
            <p>No messages found</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {messages.map((msg) => (
              <div 
                key={msg._id} 
                className={`p-6 transition-colors hover:bg-white/[0.02] flex flex-col gap-4 ${
                  msg.status === "unread" ? "bg-white/[0.03]" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className={`w-2 h-2 rounded-full ${msg.status === "unread" ? "bg-indigo-500" : "bg-transparent"}`} />
                    <div>
                      <h3 className={`text-base flex items-center gap-2 ${msg.status === "unread" ? "font-semibold text-white" : "font-medium text-white/80"}`}>
                        {msg.subject}
                      </h3>
                      <div className="flex items-center gap-3 mt-1 text-sm text-white/50">
                        <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> {msg.name} ({msg.email})</span>
                        <span>•</span>
                        <span>{formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedMessage(selectedMessage?._id === msg._id ? null : msg)}
                      className="p-2 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-colors"
                      title="Read Message"
                    >
                      <Expand className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => toggleStatus(msg._id, msg.status)}
                      className="p-2 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-colors"
                      title={`Mark as ${msg.status === "read" ? "unread" : "read"}`}
                    >
                      <Check className={`w-4 h-4 ${msg.status === "read" ? "text-green-500" : ""}`} />
                    </button>
                  </div>
                </div>

                {selectedMessage?._id === msg._id && (
                  <div className="ml-6 pl-4 border-l-2 border-indigo-500/30 text-white/80 text-sm whitespace-pre-wrap">
                    {msg.message}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
