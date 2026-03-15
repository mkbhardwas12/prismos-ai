// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// DomainInsights — Shows the user's detected professional domain expertise

import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DomainProfile } from "../types";
import "./DomainInsights.css";

const DOMAIN_EMOJIS: Record<string, string> = {
  Medical: "🩺",
  Engineering: "⚙️",
  Science: "🔬",
  Legal: "⚖️",
  Finance: "📊",
  Education: "🎓",
  Creative: "🎨",
  Business: "💼",
  General: "🌐",
};

const DOMAIN_LABELS: Record<string, string> = {
  Medical: "Medical",
  Engineering: "Software & Engineering",
  Science: "Science & Math",
  Legal: "Legal",
  Finance: "Finance",
  Education: "Education",
  Creative: "Creative & Writing",
  Business: "Business",
  General: "General",
};

export default function DomainInsights() {
  const [profile, setProfile] = useState<DomainProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const raw = await invoke<string>("get_domain_profile");
        const parsed = JSON.parse(raw);
        // The backend returns nested JSON
        const data = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
        setProfile(data);
      } catch {
        // No data yet
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return null;

  if (!profile || profile.total_queries < 5) {
    return (
      <div className="domain-insights">
        <h3>🧭 Domain Expertise</h3>
        <div className="domain-empty">
          <p>Keep asking questions — PrismOS will learn your professional domain and tailor responses accordingly.</p>
          {profile && profile.total_queries > 0 && (
            <p style={{ fontSize: "0.75rem", marginTop: "0.5rem" }}>
              {profile.total_queries}/5 queries analyzed
            </p>
          )}
        </div>
      </div>
    );
  }

  const primary = profile.primary_domain || "General";
  const emoji = DOMAIN_EMOJIS[primary] || "🌐";
  const label = DOMAIN_LABELS[primary] || primary;

  // Convert domain_counts to sorted distribution
  const counts = profile.domain_counts || {};
  const total = Object.values(counts).reduce((a: number, b: number) => a + b, 0);
  const distribution = Object.entries(counts)
    .map(([domain, count]) => ({
      domain,
      count: count as number,
      pct: total > 0 ? ((count as number) / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .filter((d) => d.count > 0);

  return (
    <div className="domain-insights">
      <h3>🧭 Domain Expertise</h3>

      <div className="domain-primary">
        <span className="domain-primary-icon">{emoji}</span>
        <div className="domain-primary-info">
          <div className="domain-primary-name">{label}</div>
          <div className="domain-primary-confidence">
            {Math.round(profile.confidence * 100)}% confidence •{" "}
            {profile.total_queries} queries analyzed
          </div>
        </div>
      </div>

      <div className="domain-distribution">
        {distribution.slice(0, 6).map((d) => (
          <div key={d.domain} className="domain-dist-row">
            <span className="domain-dist-emoji">{DOMAIN_EMOJIS[d.domain] || "🌐"}</span>
            <span className="domain-dist-name">{DOMAIN_LABELS[d.domain] || d.domain}</span>
            <div className="domain-dist-bar">
              <div
                className="domain-dist-fill"
                style={{ width: `${d.pct}%` }}
              />
            </div>
            <span className="domain-dist-pct">{Math.round(d.pct)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
