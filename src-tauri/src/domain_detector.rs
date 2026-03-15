// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// Domain Detector — Learns what kind of professional the user is
//
// Tracks query domains over time to build a user profile that goes
// beyond HOW they think (Cognitive Profile) to WHAT they work on.
// This enables domain-specific model routing, prompt templates,
// and specialized QueryType classification.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Recognized professional domains
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum UserDomain {
    Medical,
    Engineering,
    Science,
    Legal,
    Finance,
    Education,
    Creative,
    Business,
    General,
}

impl UserDomain {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Medical => "Medical",
            Self::Engineering => "Software & Engineering",
            Self::Science => "Science & Math",
            Self::Legal => "Legal",
            Self::Finance => "Finance",
            Self::Education => "Education",
            Self::Creative => "Creative & Writing",
            Self::Business => "Business",
            Self::General => "General",
        }
    }

    pub fn emoji(&self) -> &'static str {
        match self {
            Self::Medical => "🩺",
            Self::Engineering => "⚙️",
            Self::Science => "🔬",
            Self::Legal => "⚖️",
            Self::Finance => "📊",
            Self::Education => "🎓",
            Self::Creative => "🎨",
            Self::Business => "💼",
            Self::General => "🌐",
        }
    }

    /// Domain-specific keywords for classification
    fn keywords(&self) -> &[&str] {
        match self {
            Self::Medical => &[
                "patient", "symptoms", "diagnosis", "treatment", "drug",
                "medication", "clinical", "prescription", "dosage", "therapy",
                "disease", "condition", "medical", "health", "doctor",
                "nurse", "hospital", "surgery", "lab results", "vitals",
                "blood pressure", "heart rate", "bmi", "x-ray", "mri",
                "ct scan", "ultrasound", "pathology", "oncology", "cardiology",
                "neurology", "pediatric", "geriatric", "differential",
                "prognosis", "comorbidity", "contraindication", "side effect",
            ],
            Self::Engineering => &[
                "code", "function", "bug", "debug", "compile", "deploy",
                "api", "database", "server", "frontend", "backend",
                "algorithm", "data structure", "git", "repository",
                "docker", "kubernetes", "ci/cd", "test", "refactor",
                "architecture", "microservice", "endpoint", "query",
                "rust", "python", "javascript", "typescript", "react",
                "sql", "html", "css", "framework", "library",
                "stack trace", "exception", "runtime", "memory leak",
            ],
            Self::Science => &[
                "equation", "formula", "calculate", "solve", "proof",
                "theorem", "hypothesis", "experiment", "variable",
                "derivative", "integral", "matrix", "vector", "probability",
                "statistics", "physics", "chemistry", "biology",
                "quantum", "relativity", "molecule", "atom", "energy",
                "force", "velocity", "acceleration", "wavelength",
                "genome", "protein", "cell", "evolution", "ecosystem",
                "logarithm",
            ],
            Self::Legal => &[
                "contract", "clause", "liability", "plaintiff", "defendant",
                "statute", "regulation", "compliance", "litigation",
                "arbitration", "deposition", "precedent", "jurisdiction",
                "intellectual property", "trademark", "copyright",
                "due diligence", "tort", "negligence", "brief",
            ],
            Self::Finance => &[
                "stock", "portfolio", "investment", "dividend", "roi",
                "revenue", "profit", "loss", "balance sheet", "cash flow",
                "valuation", "market cap", "p/e ratio", "hedge",
                "bond", "equity", "derivative", "futures", "option",
                "tax", "audit", "ledger", "depreciation", "amortization",
            ],
            Self::Education => &[
                "lesson", "curriculum", "student", "teacher", "grade",
                "exam", "quiz", "homework", "assignment", "lecture",
                "syllabus", "semester", "course", "study", "flashcard",
                "tutoring", "learning objective", "rubric", "pedagogy",
            ],
            Self::Creative => &[
                "story", "character", "plot", "dialogue", "narrative",
                "poem", "lyric", "script", "screenplay", "novel",
                "essay", "blog", "article", "draft", "edit",
                "tone", "voice", "genre", "metaphor", "imagery",
                "design", "aesthetic", "color palette", "typography",
            ],
            Self::Business => &[
                "strategy", "marketing", "brand", "customer", "sales",
                "proposal", "pitch", "stakeholder", "kpi", "okr",
                "roadmap", "milestone", "budget", "forecast", "market",
                "competitor", "swot", "roi", "acquisition", "retention",
            ],
            Self::General => &[],
        }
    }

    /// Recommended model for this domain (Ollama model name)
    pub fn recommended_model(&self) -> &'static str {
        match self {
            Self::Medical => "qwen3:14b",
            Self::Engineering => "qwen2.5-coder:7b",
            Self::Science => "qwen3:14b",
            Self::Legal => "qwen3:14b",
            Self::Finance => "qwen3:8b",
            Self::Education => "qwen3:4b",
            Self::Creative => "qwen3:8b",
            Self::Business => "qwen3:8b",
            Self::General => "qwen3:4b",
        }
    }

    /// System prompt prefix for domain-aware responses
    pub fn system_prompt_prefix(&self) -> &'static str {
        match self {
            Self::Medical => "You are assisting a medical professional. Use precise clinical terminology. Structure responses using SOAP format when appropriate. Always note when information requires professional medical judgment. Never provide definitive diagnoses — frame as differentials.",
            Self::Engineering => "You are assisting a software engineer. Include code examples when relevant. Use precise technical terminology. Reference best practices and design patterns. Format code blocks with language tags.",
            Self::Science => "You are assisting a scientist/mathematician. Show step-by-step derivations. Use proper notation. Distinguish between theoretical and empirical results. Include units and significant figures where applicable.",
            Self::Legal => "You are assisting a legal professional. Reference relevant legal principles. Use precise legal terminology. Note jurisdiction-specific variations. Always caveat that this is not legal advice.",
            Self::Finance => "You are assisting a finance professional. Include relevant metrics and ratios. Use proper financial terminology. Note market conditions and risk factors. Never provide specific investment advice.",
            Self::Education => "You are assisting an educator or student. Explain concepts clearly with examples. Build from fundamentals to advanced topics. Suggest practice exercises. Adapt complexity to the learner's level.",
            Self::Creative => "You are assisting a creative professional. Focus on craft and technique. Provide specific, actionable feedback. Respect the creator's vision while suggesting improvements. Use vivid, engaging language.",
            Self::Business => "You are assisting a business professional. Focus on actionable insights. Use frameworks (SWOT, OKR, etc.) when appropriate. Consider ROI and feasibility. Be concise and data-driven.",
            Self::General => "",
        }
    }
}

/// Persistent domain profile — tracks query domain distribution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainProfile {
    pub domain_counts: HashMap<String, u32>,
    pub total_queries: u32,
    pub primary_domain: UserDomain,
    pub confidence: f64,
    pub domain_depth: HashMap<String, f64>,
    pub last_updated: String,
}

impl Default for DomainProfile {
    fn default() -> Self {
        Self {
            domain_counts: HashMap::new(),
            total_queries: 0,
            primary_domain: UserDomain::General,
            confidence: 0.0,
            domain_depth: HashMap::new(),
            last_updated: String::new(),
        }
    }
}

impl DomainProfile {
    /// Classify a query into a domain
    pub fn classify_domain(query: &str) -> UserDomain {
        let lower = query.to_lowercase();
        let all_domains = [
            UserDomain::Medical,
            UserDomain::Engineering,
            UserDomain::Science,
            UserDomain::Legal,
            UserDomain::Finance,
            UserDomain::Education,
            UserDomain::Creative,
            UserDomain::Business,
        ];

        let mut best_domain = UserDomain::General;
        let mut best_score = 0u32;

        for domain in &all_domains {
            let score: u32 = domain
                .keywords()
                .iter()
                .filter(|kw| lower.contains(*kw))
                .count() as u32;
            if score > best_score {
                best_score = score;
                best_domain = *domain;
            }
        }

        if best_score >= 1 {
            best_domain
        } else {
            UserDomain::General
        }
    }

    /// Record a query and update domain distribution
    pub fn record_query(&mut self, query: &str) {
        let domain = Self::classify_domain(query);
        let key = format!("{:?}", domain);
        *self.domain_counts.entry(key).or_insert(0) += 1;
        self.total_queries += 1;
        self.last_updated = chrono::Utc::now().to_rfc3339();

        if self.total_queries >= 10 {
            let mut max_count = 0u32;
            let mut max_domain = "General".to_string();
            for (d, &count) in &self.domain_counts {
                if count > max_count {
                    max_count = count;
                    max_domain = d.clone();
                }
            }
            self.confidence = max_count as f64 / self.total_queries as f64;
            self.primary_domain = match max_domain.as_str() {
                "Medical" => UserDomain::Medical,
                "Engineering" => UserDomain::Engineering,
                "Science" => UserDomain::Science,
                "Legal" => UserDomain::Legal,
                "Finance" => UserDomain::Finance,
                "Education" => UserDomain::Education,
                "Creative" => UserDomain::Creative,
                "Business" => UserDomain::Business,
                _ => UserDomain::General,
            };
        }
    }

    /// Get the domain-specific system prompt prefix
    pub fn get_domain_prompt(&self) -> &'static str {
        if self.confidence >= 0.3 {
            self.primary_domain.system_prompt_prefix()
        } else {
            ""
        }
    }

    /// Get recommended model for this user's primary domain
    pub fn get_recommended_model(&self) -> &'static str {
        if self.confidence >= 0.3 {
            self.primary_domain.recommended_model()
        } else {
            "qwen3:4b"
        }
    }

    /// Get domain distribution as percentages (for UI display)
    pub fn get_distribution(&self) -> Vec<(String, f64)> {
        if self.total_queries == 0 {
            return vec![];
        }
        let mut dist: Vec<(String, f64)> = self
            .domain_counts
            .iter()
            .map(|(d, &c)| (d.clone(), c as f64 / self.total_queries as f64 * 100.0))
            .collect();
        dist.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        dist
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_medical() {
        assert_eq!(DomainProfile::classify_domain("The patient has symptoms of flu"), UserDomain::Medical);
        assert_eq!(DomainProfile::classify_domain("Check the dosage of this medication"), UserDomain::Medical);
        assert_eq!(DomainProfile::classify_domain("Differential diagnosis for chest pain"), UserDomain::Medical);
        assert_eq!(DomainProfile::classify_domain("Review lab results for pathology"), UserDomain::Medical);
        assert_eq!(DomainProfile::classify_domain("What is the treatment for diabetes"), UserDomain::Medical);
    }

    #[test]
    fn test_classify_engineering() {
        assert_eq!(DomainProfile::classify_domain("Fix this bug in my code"), UserDomain::Engineering);
        assert_eq!(DomainProfile::classify_domain("Deploy the docker container to kubernetes"), UserDomain::Engineering);
        assert_eq!(DomainProfile::classify_domain("Debug the api endpoint"), UserDomain::Engineering);
        assert_eq!(DomainProfile::classify_domain("Refactor the database query"), UserDomain::Engineering);
        assert_eq!(DomainProfile::classify_domain("Write a function in rust"), UserDomain::Engineering);
    }

    #[test]
    fn test_classify_science() {
        assert_eq!(DomainProfile::classify_domain("Solve this equation for x"), UserDomain::Science);
        assert_eq!(DomainProfile::classify_domain("Calculate the derivative of sin(x)"), UserDomain::Science);
        assert_eq!(DomainProfile::classify_domain("What is the probability of rolling a 6"), UserDomain::Science);
        assert_eq!(DomainProfile::classify_domain("Explain quantum mechanics"), UserDomain::Science);
        assert_eq!(DomainProfile::classify_domain("Prove the theorem about vector spaces"), UserDomain::Science);
    }

    #[test]
    fn test_classify_legal() {
        assert_eq!(DomainProfile::classify_domain("Review this contract clause"), UserDomain::Legal);
        assert_eq!(DomainProfile::classify_domain("What is the liability exposure"), UserDomain::Legal);
        assert_eq!(DomainProfile::classify_domain("Compliance with statute requirements"), UserDomain::Legal);
        assert_eq!(DomainProfile::classify_domain("Check the intellectual property rights"), UserDomain::Legal);
        assert_eq!(DomainProfile::classify_domain("Prepare a brief for litigation"), UserDomain::Legal);
    }

    #[test]
    fn test_classify_finance() {
        assert_eq!(DomainProfile::classify_domain("Analyze the stock portfolio"), UserDomain::Finance);
        assert_eq!(DomainProfile::classify_domain("Calculate the roi on this investment"), UserDomain::Finance);
        assert_eq!(DomainProfile::classify_domain("Review the balance sheet and cash flow"), UserDomain::Finance);
        assert_eq!(DomainProfile::classify_domain("What is the market cap valuation"), UserDomain::Finance);
        assert_eq!(DomainProfile::classify_domain("Hedge the bond portfolio with futures"), UserDomain::Finance);
    }

    #[test]
    fn test_classify_general() {
        assert_eq!(DomainProfile::classify_domain("Tell me a joke"), UserDomain::General);
        assert_eq!(DomainProfile::classify_domain("Hello how are you"), UserDomain::General);
    }

    #[test]
    fn test_record_query_updates_counts() {
        let mut profile = DomainProfile::default();
        profile.record_query("Fix this bug in my code");
        assert_eq!(profile.total_queries, 1);
        assert_eq!(*profile.domain_counts.get("Engineering").unwrap_or(&0), 1);
    }

    #[test]
    fn test_primary_domain_after_many_queries() {
        let mut profile = DomainProfile::default();
        for _ in 0..12 {
            profile.record_query("Check the patient symptoms and diagnosis");
        }
        for _ in 0..3 {
            profile.record_query("Tell me a joke");
        }
        assert_eq!(profile.primary_domain, UserDomain::Medical);
        assert!(profile.confidence > 0.5);
    }

    #[test]
    fn test_get_distribution() {
        let mut profile = DomainProfile::default();
        for _ in 0..5 {
            profile.record_query("Fix the code bug");
        }
        for _ in 0..5 {
            profile.record_query("Hello there");
        }
        let dist = profile.get_distribution();
        assert!(!dist.is_empty());
    }
}
