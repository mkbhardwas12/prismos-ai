// Domain Detector — tracks a coarse mix of query topics
//
// Keyword classification counts which broad topics appear in queries. The
// resulting mix can select topic-aware response guidance, but it is not evidence
// of the user's profession, credentials, expertise, identity, or intent.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Coarse query-topic categories. The legacy type name is retained for API compatibility.
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
    #[allow(dead_code)] // Exposed for UI/domain-routing compatibility.
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

    #[allow(dead_code)]
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

    /// Stable key used by the existing SQLite and frontend wire format.
    pub fn storage_key(&self) -> &'static str {
        match self {
            Self::Medical => "Medical",
            Self::Engineering => "Engineering",
            Self::Science => "Science",
            Self::Legal => "Legal",
            Self::Finance => "Finance",
            Self::Education => "Education",
            Self::Creative => "Creative",
            Self::Business => "Business",
            Self::General => "General",
        }
    }

    fn from_storage_key(value: &str) -> Self {
        match value {
            "Medical" => Self::Medical,
            "Engineering" => Self::Engineering,
            "Science" => Self::Science,
            "Legal" => Self::Legal,
            "Finance" => Self::Finance,
            "Education" => Self::Education,
            "Creative" => Self::Creative,
            "Business" => Self::Business,
            _ => Self::General,
        }
    }

    /// Domain-specific keywords for classification
    fn keywords(&self) -> &[&str] {
        match self {
            Self::Medical => &[
                "patient",
                "symptoms",
                "diagnosis",
                "treatment",
                "drug",
                "medication",
                "clinical",
                "prescription",
                "dosage",
                "therapy",
                "disease",
                "condition",
                "medical",
                "health",
                "doctor",
                "nurse",
                "hospital",
                "surgery",
                "lab results",
                "vitals",
                "blood pressure",
                "heart rate",
                "bmi",
                "x-ray",
                "mri",
                "ct scan",
                "ultrasound",
                "pathology",
                "oncology",
                "cardiology",
                "neurology",
                "pediatric",
                "geriatric",
                "differential",
                "prognosis",
                "comorbidity",
                "contraindication",
                "side effect",
            ],
            Self::Engineering => &[
                "code",
                "function",
                "bug",
                "debug",
                "compile",
                "deploy",
                "api",
                "database",
                "server",
                "frontend",
                "backend",
                "algorithm",
                "data structure",
                "git",
                "repository",
                "docker",
                "kubernetes",
                "ci/cd",
                "test",
                "refactor",
                "architecture",
                "microservice",
                "endpoint",
                "query",
                "rust",
                "python",
                "javascript",
                "typescript",
                "react",
                "sql",
                "html",
                "css",
                "framework",
                "library",
                "stack trace",
                "exception",
                "runtime",
                "memory leak",
            ],
            Self::Science => &[
                "equation",
                "formula",
                "calculate",
                "solve",
                "proof",
                "theorem",
                "hypothesis",
                "experiment",
                "variable",
                "derivative",
                "integral",
                "matrix",
                "vector",
                "probability",
                "statistics",
                "physics",
                "chemistry",
                "biology",
                "quantum",
                "relativity",
                "molecule",
                "atom",
                "energy",
                "force",
                "velocity",
                "acceleration",
                "wavelength",
                "genome",
                "protein",
                "cell",
                "evolution",
                "ecosystem",
                "logarithm",
            ],
            Self::Legal => &[
                "contract",
                "clause",
                "liability",
                "plaintiff",
                "defendant",
                "statute",
                "regulation",
                "compliance",
                "litigation",
                "arbitration",
                "deposition",
                "precedent",
                "jurisdiction",
                "intellectual property",
                "trademark",
                "copyright",
                "due diligence",
                "tort",
                "negligence",
                "brief",
            ],
            Self::Finance => &[
                "stock",
                "portfolio",
                "investment",
                "dividend",
                "roi",
                "revenue",
                "profit",
                "loss",
                "balance sheet",
                "cash flow",
                "valuation",
                "market cap",
                "p/e ratio",
                "hedge",
                "bond",
                "equity",
                "derivative",
                "futures",
                "option",
                "tax",
                "audit",
                "ledger",
                "depreciation",
                "amortization",
            ],
            Self::Education => &[
                "lesson",
                "curriculum",
                "student",
                "teacher",
                "grade",
                "exam",
                "quiz",
                "homework",
                "assignment",
                "lecture",
                "syllabus",
                "semester",
                "course",
                "study",
                "flashcard",
                "tutoring",
                "learning objective",
                "rubric",
                "pedagogy",
            ],
            Self::Creative => &[
                "story",
                "character",
                "plot",
                "dialogue",
                "narrative",
                "poem",
                "lyric",
                "script",
                "screenplay",
                "novel",
                "essay",
                "blog",
                "article",
                "draft",
                "edit",
                "tone",
                "voice",
                "genre",
                "metaphor",
                "imagery",
                "design",
                "aesthetic",
                "color palette",
                "typography",
            ],
            Self::Business => &[
                "strategy",
                "marketing",
                "brand",
                "customer",
                "sales",
                "proposal",
                "pitch",
                "stakeholder",
                "kpi",
                "okr",
                "roadmap",
                "milestone",
                "budget",
                "forecast",
                "market",
                "competitor",
                "swot",
                "roi",
                "acquisition",
                "retention",
            ],
            Self::General => &[],
        }
    }

    /// Static model suggestion for this query-topic category (Ollama model name).
    #[allow(dead_code)]
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

    /// Topic-aware response guidance. It explicitly avoids inferring credentials.
    pub fn system_prompt_prefix(&self) -> &'static str {
        match self {
            Self::Medical => "The stored query-topic mix currently leans medical. Treat this only as topic context, not evidence of the user's profession or credentials. Use clear clinical terminology when useful, distinguish general information from medical judgment, and do not provide definitive diagnoses.",
            Self::Engineering => "The stored query-topic mix currently leans software and engineering. Treat this only as topic context, not evidence of the user's profession or credentials. Include code examples when relevant, state assumptions, and format code blocks with language tags.",
            Self::Science => "The stored query-topic mix currently leans science and math. Treat this only as topic context, not evidence of the user's profession or credentials. Use appropriate notation and provide concise, verifiable derivations, units, and results where applicable.",
            Self::Legal => "The stored query-topic mix currently leans legal. Treat this only as topic context, not evidence of the user's profession or credentials. Note jurisdiction-specific uncertainty and clearly state that general information is not legal advice.",
            Self::Finance => "The stored query-topic mix currently leans finance. Treat this only as topic context, not evidence of the user's profession or credentials. Include relevant metrics, assumptions, time sensitivity, and risk factors; do not present personalized investment advice.",
            Self::Education => "The stored query-topic mix currently leans education. Treat this only as topic context, not evidence of the user's role or credentials. Explain concepts clearly, use examples, and adapt complexity to the question itself.",
            Self::Creative => "The stored query-topic mix currently leans creative work. Treat this only as topic context, not evidence of the user's profession or credentials. Focus on craft, technique, and specific actionable feedback while respecting the stated goals.",
            Self::Business => "The stored query-topic mix currently leans business. Treat this only as topic context, not evidence of the user's profession or credentials. Focus on actionable options, assumptions, tradeoffs, feasibility, and measurable outcomes.",
            Self::General => "",
        }
    }
}

/// Persistent query-topic mix. Legacy field names remain wire-compatible.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainProfile {
    pub domain_counts: HashMap<String, u32>,
    pub total_queries: u32,
    pub primary_domain: UserDomain,
    /// Largest classified-topic share after the minimum sample size; not a
    /// credential, expertise, or identity confidence score.
    pub confidence: f64,
    /// Reserved legacy field; it must not be interpreted as expertise depth.
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
    /// Classify a query into a coarse topic category.
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

    /// Record a query and update the topic distribution.
    pub fn record_query(&mut self, query: &str) {
        let domain = Self::classify_domain(query);
        let key = domain.storage_key().to_string();
        *self.domain_counts.entry(key).or_insert(0) += 1;
        self.total_queries += 1;
        self.last_updated = chrono::Utc::now().to_rfc3339();

        if self.total_queries >= 10 {
            let max_count = self.domain_counts.values().copied().max().unwrap_or(0);
            let mut leaders = self
                .domain_counts
                .iter()
                .filter(|(_, count)| **count == max_count)
                .map(|(topic, _)| UserDomain::from_storage_key(topic));
            let first = leaders.next().unwrap_or(UserDomain::General);
            let unique_leader = leaders.next().is_none();
            self.confidence = max_count as f64 / self.total_queries as f64;
            // A tied mix does not justify selecting topic-specific guidance.
            self.primary_domain = if unique_leader {
                first
            } else {
                UserDomain::General
            };
        }
    }

    /// Return the typed topic whose guidance is active for this profile.
    pub fn guidance_topic(&self) -> Option<UserDomain> {
        if self.confidence >= 0.3 && self.primary_domain != UserDomain::General {
            Some(self.primary_domain)
        } else {
            None
        }
    }

    /// Get the topic-specific system prompt prefix.
    pub fn get_domain_prompt(&self) -> &'static str {
        self.guidance_topic()
            .map(|topic| topic.system_prompt_prefix())
            .unwrap_or("")
    }

    /// Get the static model suggestion for the largest recurring query topic.
    #[allow(dead_code)] // Compatibility accessor; current routing uses smart_router.
    pub fn get_recommended_model(&self) -> &'static str {
        if self.confidence >= 0.3 {
            self.primary_domain.recommended_model()
        } else {
            "qwen3:4b"
        }
    }

    /// Get classified query-topic shares as percentages (for UI display).
    #[allow(dead_code)]
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
        assert_eq!(
            DomainProfile::classify_domain("The patient has symptoms of flu"),
            UserDomain::Medical
        );
        assert_eq!(
            DomainProfile::classify_domain("Check the dosage of this medication"),
            UserDomain::Medical
        );
        assert_eq!(
            DomainProfile::classify_domain("Differential diagnosis for chest pain"),
            UserDomain::Medical
        );
        assert_eq!(
            DomainProfile::classify_domain("Review lab results for pathology"),
            UserDomain::Medical
        );
        assert_eq!(
            DomainProfile::classify_domain("What is the treatment for diabetes"),
            UserDomain::Medical
        );
    }

    #[test]
    fn test_classify_engineering() {
        assert_eq!(
            DomainProfile::classify_domain("Fix this bug in my code"),
            UserDomain::Engineering
        );
        assert_eq!(
            DomainProfile::classify_domain("Deploy the docker container to kubernetes"),
            UserDomain::Engineering
        );
        assert_eq!(
            DomainProfile::classify_domain("Debug the api endpoint"),
            UserDomain::Engineering
        );
        assert_eq!(
            DomainProfile::classify_domain("Refactor the database query"),
            UserDomain::Engineering
        );
        assert_eq!(
            DomainProfile::classify_domain("Write a function in rust"),
            UserDomain::Engineering
        );
    }

    #[test]
    fn test_classify_science() {
        assert_eq!(
            DomainProfile::classify_domain("Solve this equation for x"),
            UserDomain::Science
        );
        assert_eq!(
            DomainProfile::classify_domain("Calculate the derivative of sin(x)"),
            UserDomain::Science
        );
        assert_eq!(
            DomainProfile::classify_domain("What is the probability of rolling a 6"),
            UserDomain::Science
        );
        assert_eq!(
            DomainProfile::classify_domain("Explain quantum mechanics"),
            UserDomain::Science
        );
        assert_eq!(
            DomainProfile::classify_domain("Prove the theorem about vector spaces"),
            UserDomain::Science
        );
    }

    #[test]
    fn test_classify_legal() {
        assert_eq!(
            DomainProfile::classify_domain("Review this contract clause"),
            UserDomain::Legal
        );
        assert_eq!(
            DomainProfile::classify_domain("What is the liability exposure"),
            UserDomain::Legal
        );
        assert_eq!(
            DomainProfile::classify_domain("Compliance with statute requirements"),
            UserDomain::Legal
        );
        assert_eq!(
            DomainProfile::classify_domain("Check the intellectual property rights"),
            UserDomain::Legal
        );
        assert_eq!(
            DomainProfile::classify_domain("Prepare a brief for litigation"),
            UserDomain::Legal
        );
    }

    #[test]
    fn test_classify_finance() {
        assert_eq!(
            DomainProfile::classify_domain("Analyze the stock portfolio"),
            UserDomain::Finance
        );
        assert_eq!(
            DomainProfile::classify_domain("Calculate the roi on this investment"),
            UserDomain::Finance
        );
        assert_eq!(
            DomainProfile::classify_domain("Review the balance sheet and cash flow"),
            UserDomain::Finance
        );
        assert_eq!(
            DomainProfile::classify_domain("What is the market cap valuation"),
            UserDomain::Finance
        );
        assert_eq!(
            DomainProfile::classify_domain("Hedge the bond portfolio with futures"),
            UserDomain::Finance
        );
    }

    #[test]
    fn test_classify_education() {
        assert_eq!(
            DomainProfile::classify_domain("Create a lesson plan for students"),
            UserDomain::Education
        );
        assert_eq!(
            DomainProfile::classify_domain("Design a new curriculum for the semester"),
            UserDomain::Education
        );
        assert_eq!(
            DomainProfile::classify_domain("The student needs help with homework"),
            UserDomain::Education
        );
        assert_eq!(
            DomainProfile::classify_domain("Prepare the exam for the teacher"),
            UserDomain::Education
        );
        assert_eq!(
            DomainProfile::classify_domain("Grade the quiz and update the syllabus"),
            UserDomain::Education
        );
    }

    #[test]
    fn test_classify_creative() {
        assert_eq!(
            DomainProfile::classify_domain("Write a short story about space"),
            UserDomain::Creative
        );
        assert_eq!(
            DomainProfile::classify_domain("Develop the main character arc"),
            UserDomain::Creative
        );
        assert_eq!(
            DomainProfile::classify_domain("Outline the plot for my novel"),
            UserDomain::Creative
        );
        assert_eq!(
            DomainProfile::classify_domain("The narrative needs stronger imagery"),
            UserDomain::Creative
        );
        assert_eq!(
            DomainProfile::classify_domain("Compose a poem about autumn"),
            UserDomain::Creative
        );
    }

    #[test]
    fn test_classify_business() {
        assert_eq!(
            DomainProfile::classify_domain("Define the marketing strategy for Q3"),
            UserDomain::Business
        );
        assert_eq!(
            DomainProfile::classify_domain("Prepare a sales proposal for the customer"),
            UserDomain::Business
        );
        assert_eq!(
            DomainProfile::classify_domain("Analyze the competitor landscape and market"),
            UserDomain::Business
        );
        assert_eq!(
            DomainProfile::classify_domain("Build a pitch deck for stakeholder review"),
            UserDomain::Business
        );
        assert_eq!(
            DomainProfile::classify_domain("Set kpi targets and roadmap milestones"),
            UserDomain::Business
        );
    }

    #[test]
    fn test_classify_general() {
        assert_eq!(
            DomainProfile::classify_domain("Tell me a joke"),
            UserDomain::General
        );
        assert_eq!(
            DomainProfile::classify_domain("Hello how are you"),
            UserDomain::General
        );
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
    fn test_tied_topic_mix_does_not_select_guidance() {
        let mut profile = DomainProfile::default();
        for _ in 0..5 {
            profile.record_query("Fix the code bug");
            profile.record_query("Review the patient symptoms");
        }
        assert_eq!(profile.primary_domain, UserDomain::General);
        assert_eq!(profile.guidance_topic(), None);
        assert!((profile.confidence - 0.5).abs() < f64::EPSILON);
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

    #[test]
    fn test_storage_keys_round_trip_without_prompt_parsing() {
        let topics = [
            UserDomain::Medical,
            UserDomain::Engineering,
            UserDomain::Science,
            UserDomain::Legal,
            UserDomain::Finance,
            UserDomain::Education,
            UserDomain::Creative,
            UserDomain::Business,
            UserDomain::General,
        ];
        for topic in topics {
            assert_eq!(UserDomain::from_storage_key(topic.storage_key()), topic);
        }
    }

    #[test]
    fn test_guidance_topic_is_typed_and_does_not_infer_credentials() {
        let mut profile = DomainProfile::default();
        for _ in 0..12 {
            profile.record_query("Review patient symptoms and medication dosage");
        }

        assert_eq!(profile.guidance_topic(), Some(UserDomain::Medical));
        let prompt = profile.get_domain_prompt();
        assert!(prompt.contains("topic context"));
        assert!(prompt.contains("not evidence"));
        assert!(!prompt.contains("medical professional"));
    }
}
