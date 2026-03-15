// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// Model Tracker — Per-model performance tracking and recommendations
//
// Tracks which model was used for each query domain, latency,
// token output, and user feedback. After enough data, provides
// per-domain model recommendations.

use serde::{Deserialize, Serialize};

/// A single model performance measurement
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPerformance {
    pub model: String,
    pub domain: String,
    pub query_type: String,
    pub latency_ms: u64,
    pub tokens_generated: Option<u32>,
    pub user_feedback: Option<bool>,
    pub timestamp: String,
}

/// Aggregated recommendation for a domain
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRecommendation {
    pub domain: String,
    pub recommended_model: String,
    pub avg_latency_ms: f64,
    pub satisfaction_rate: f64,
    pub sample_count: u32,
    pub comparison: Option<String>,
}

/// Generate recommendations from performance entries.
///
/// Groups by (model, domain), computes average latency and satisfaction,
/// then picks the best model per domain.
pub fn generate_recommendations(entries: &[ModelPerformance]) -> Vec<ModelRecommendation> {
    use std::collections::HashMap;

    // Group by (model, domain) → (latency_sum, feedback_pos, feedback_total, count)
    let mut groups: HashMap<(String, String), (f64, u32, u32, u32)> = HashMap::new();

    for entry in entries {
        let key = (entry.model.clone(), entry.domain.clone());
        let g = groups.entry(key).or_insert((0.0, 0, 0, 0));
        g.0 += entry.latency_ms as f64;
        if let Some(fb) = entry.user_feedback {
            if fb {
                g.1 += 1;
            }
            g.2 += 1;
        }
        g.3 += 1;
    }

    // For each domain, find best model (highest satisfaction, then lowest latency)
    let mut domain_best: HashMap<String, ModelRecommendation> = HashMap::new();

    for ((model, domain), (lat_sum, pos, total, count)) in &groups {
        if *count < 5 {
            continue; // Need minimum samples
        }

        let avg_latency = lat_sum / *count as f64;
        let satisfaction = if *total > 0 {
            *pos as f64 / *total as f64
        } else {
            0.5 // Unknown
        };

        let rec = ModelRecommendation {
            domain: domain.clone(),
            recommended_model: model.clone(),
            avg_latency_ms: avg_latency,
            satisfaction_rate: satisfaction,
            sample_count: *count,
            comparison: None,
        };

        let is_better = domain_best.get(domain).map_or(true, |existing| {
            // Prefer higher satisfaction, then lower latency
            if (satisfaction - existing.satisfaction_rate).abs() > 0.05 {
                satisfaction > existing.satisfaction_rate
            } else {
                avg_latency < existing.avg_latency_ms
            }
        });

        if is_better {
            // Build comparison string if replacing
            let comparison = domain_best.get(domain).map(|old| {
                format!(
                    "For {} queries, {} has {:.0}% satisfaction vs {} at {:.0}%. Consider switching.",
                    domain,
                    model,
                    satisfaction * 100.0,
                    old.recommended_model,
                    old.satisfaction_rate * 100.0,
                )
            });

            let mut rec = rec;
            rec.comparison = comparison;
            domain_best.insert(domain.clone(), rec);
        }
    }

    let mut results: Vec<ModelRecommendation> = domain_best.into_values().collect();
    results.sort_by(|a, b| a.domain.cmp(&b.domain));
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_entries() {
        let result = generate_recommendations(&[]);
        assert!(result.is_empty());
    }

    #[test]
    fn test_too_few_entries() {
        let entries = vec![ModelPerformance {
            model: "test".to_string(),
            domain: "General".to_string(),
            query_type: "General".to_string(),
            latency_ms: 100,
            tokens_generated: None,
            user_feedback: Some(true),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
        }];
        let result = generate_recommendations(&entries);
        assert!(result.is_empty()); // Need at least 5
    }

    #[test]
    fn test_recommendation_with_enough_data() {
        let mut entries = Vec::new();
        for i in 0..10 {
            entries.push(ModelPerformance {
                model: "qwen3:4b".to_string(),
                domain: "Engineering".to_string(),
                query_type: "Troubleshooting".to_string(),
                latency_ms: 200 + i * 10,
                tokens_generated: Some(100),
                user_feedback: Some(i % 3 != 0),
                timestamp: format!("2026-01-{:02}T10:00:00Z", i + 1),
            });
        }
        let result = generate_recommendations(&entries);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].domain, "Engineering");
        assert_eq!(result[0].recommended_model, "qwen3:4b");
    }
}
