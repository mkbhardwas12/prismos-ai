// DomainInsights — shows a coarse mix of classified query topics

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
        <h3>🧭 Query Topic Mix</h3>
        <div className="domain-empty">
          <p>
            After five classified queries, PrismOS can show a coarse topic mix.
            This does not infer your profession, credentials, or expertise.
          </p>
          {profile && profile.total_queries > 0 && (
            <p style={{ fontSize: "0.75rem", marginTop: "0.5rem" }}>
              {profile.total_queries}/5 queries observed before the topic summary
            </p>
          )}
        </div>
      </div>
    );
  }

  // Static model suggestions keyed by coarse topic. These are not benchmark
  // rankings and do not imply anything about the user's role or credentials.
  const DOMAIN_RECOMMENDED: Record<string, string> = {
    Medical: "qwen3:14b",
    Engineering: "qwen2.5-coder:7b",
    Science: "qwen3:14b",
    Legal: "qwen3:14b",
    Finance: "qwen3:8b",
    Education: "qwen3:4b",
    Creative: "qwen3:8b",
    Business: "qwen3:8b",
    General: "qwen3:4b",
  };
  // Convert the legacy domain_counts field to a deterministic topic-share list.
  const counts = profile.domain_counts || {};
  const total = Object.values(counts).reduce((a: number, b: number) => a + b, 0);
  const distribution = Object.entries(counts)
    .map(([domain, count]) => ({
      domain,
      count: count as number,
      pct: total > 0 ? ((count as number) / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
    .filter((d) => d.count > 0);
  const hasSingleLeadingTopic =
    distribution.length < 2 || distribution[0].count > distribution[1].count;
  const primary = hasSingleLeadingTopic
    ? distribution[0]?.domain || profile.primary_domain || "General"
    : "General";
  const primaryShare = total > 0 ? (distribution[0]?.count || 0) / total : 0;
  const emoji = DOMAIN_EMOJIS[primary] || "🌐";
  const label = DOMAIN_LABELS[primary] || primary;
  const recommendedModel = DOMAIN_RECOMMENDED[primary] || "qwen3:4b";

  return (
    <div className="domain-insights">
      <h3>🧭 Query Topic Mix</h3>

      <div className="domain-primary">
        <span className="domain-primary-icon">{emoji}</span>
        <div className="domain-primary-info">
          <div className="domain-primary-name">
            {hasSingleLeadingTopic ? `Most frequent: ${label}` : "No single leading topic"}
          </div>
          <div className="domain-primary-confidence">
            {Math.round(primaryShare * 100)}% {hasSingleLeadingTopic
              ? "of classified queries"
              : "largest topic share"} •{" "}
            {profile.total_queries} queries analyzed
          </div>
        </div>
      </div>

      {primaryShare >= 0.3 && primary !== "General" && (
        <div className="domain-recommended-model">
          <span className="domain-rec-icon">🎯</span>
          <span className="domain-rec-text">
            Model suggestion for recurring <strong>{label}</strong> prompts:{" "}
            <strong>{recommendedModel}</strong>
          </span>
        </div>
      )}

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
      <p className="domain-primary-confidence">
        Heuristic keyword classification only; it does not infer profession,
        credentials, or expertise.
      </p>
    </div>
  );
}
