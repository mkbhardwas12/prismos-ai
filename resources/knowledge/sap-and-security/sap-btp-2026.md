# SAP BTP in 2026: platform, services and dates

As of 2026-10-05. Sources are listed at the end. "Third-party" means no SAP page confirmed the point. Identity, connectivity, audit logging and vulnerabilities are in sap-btp-security.md.

## Environments

- SAP BTP, Neo environment reaches end of life on 31 December 2028, subject to contract terms. New features go only to the multi-cloud foundation; Neo gets security and compliance support until the sunset. SAP repeated the date in a 22 July 2026 webinar on moving Integration Suite content from Neo. (SAP Community, 2023-06-14; SAP Events, 2026-07-22)
- SAP describes Neo as its oldest environment, launched in 2012 on an SAP-proprietary stack; the multi-cloud foundation has been the default for new customers since 2020. SAP offers migration documentation, migration packs, services and experts. (SAP Neo migration page)
- The open-source Kyma project no longer cuts global Kyma releases; each module is released on its own (kyma-project on GitHub).

## SAP Business AI Platform (May 2026)

- Announced on 12 May 2026 at Sapphire, the SAP Business AI Platform joins SAP BTP, SAP Business Data Cloud and SAP Business AI into one governed environment with the SAP Knowledge Graph underneath (SAP News, 2026-05-12). The keynote write-up describes three layers: context, build (Joule Studio) and governance (the new SAP AI Agent Hub, built on SAP LeanIX). AI Agent Hub general availability is planned for Q3 2026 at no extra cost. (SAP News, 2026-05-13)
- BTP keeps its name. SAP Learning describes BTP as one component of the Business AI Platform, next to AI Foundation, Business Data Cloud, SAP HANA Cloud and Business Transformation Management. (SAP Learning)
- SAP published a new SAP API Access Policy on 27 April 2026, covering allowed and prohibited API use, including by third-party AI systems. Review automation and outside AI access against it. (SAP Learning)
- SAP plans Anthropic's Claude as a primary reasoning capability across the Business AI Platform and Joule agents; no dates were given. (SAP News, 2026-05-12)
- A third party reports platform general availability in Q3 2026 and a free Agent Runtime until 31 December 2026 (third-party: SAPinsider, 2026-05-29). SAP's own Q3 2026 date is for AI Agent Hub.

## SAP Build and Joule Studio

- SAP Build Code was announced on 2 November 2023 for Java and JavaScript development with Joule-generated data models, logic and tests (SAP News, 2023-11-02).
- From 22 April 2025 all SAP Build capabilities plus SAP HANA Cloud are included in SAP S/4HANA Cloud packages (SAP News, 2025-04-22).
- Joule Studio, for building Joule skills and agents inside SAP Build, became generally available in June 2025, and SAP Build pricing and packaging were simplified (SAP News, 2025-05-22). The Joule Studio custom agent builder followed in December 2025 with A2A and MCP support, and local MCP servers for SAP Build development work with tools such as Cursor, Windsurf, Claude Code, Cline and OpenAI Codex (SAP News, 2025-11-05).
- On 13 May 2026 SAP announced a "new Joule Studio": a fully managed offering for agents, apps and workflows, with LangChain, Pydantic AI and LlamaIndex, VS Code and Cursor, embedded n8n for multi-agent orchestration, and a runtime with sandboxing and persistent memory on SAP HANA Cloud. Design time is free, with fair-use AI assistance, until the end of 2026. (SAP News, 2026-05-13)
- SAP's Q2 2026 highlights list Joule Studio in SAP Early Adopter Care, which most likely refers to the new Joule Studio; this was not confirmed (SAP News, 2026-07-20).
- SAP Build Work Zone combines the SAP Launchpad service and SAP Work Zone into one site product (SAP Build Work Zone page).

## SAP Integration Suite

- Edge Integration Cell (EIC) runs integration and API scenarios in the customer's own environment while design and monitoring stay in the cloud. SAP's November 2023 blog announced it generally available, with one EIC entitlement per licensed Integration Suite tenant, EIC messages metered at 50 percent, and support for Azure AKS, Amazon EKS and SUSE Rancher. (SAP Community, 2023-11-16)
- SAP's March 2026 slides list EIC database options (SAP HANA 2.0, Valkey 8.0 to 8.2, PostgreSQL, Redis), OpenShift and RKE2 support, external Cloud Connector configuration, an OFTP2 adapter, and alerting in SAP Cloud ALM and SAP Focused Run. Planned for Q3 2026: several EIC instances per cluster and a 48-hour offline mode. (SAP Integration Suite slides, 2026-03-31)
- The enhanced edition (2026) includes one EIC node, an Advanced Event Mesh "100" tenant (one per global account) and Document AI for up to 100 documents a month. AI features such as API anomaly detection and traffic prediction move from fair use to metering from Q2 2026. Roadmap items: MCP for agentic AI (Q2 2026), integration-flow generation and Process Orchestration mass-migration support (Q3 2026), a B2B error interpreter (Q4 2026), and more regions through 2026. (SAP Integration Suite slides, 2026-03-31)
- May 2025 added AI-assisted development, an AI adapter for custom large language models and new adapters (IBM MQ, Google Cloud Storage, Salesforce PubSub, Anaplan, Snowflake) (SAP News, 2025-05-22). November 2025 added API anomaly recommendations and an MCP gateway for custom APIs and integration flows (SAP News, 2025-11-05).

## SAP AI Core and the generative AI hub

- The generative AI hub needs the SAP AI Core "extended" service plan; it is not in the free or standard plans. Orchestration Service V2 offers templating, model configuration, data masking, content filtering, translation and grounding. (SAP Developers tutorial, 2026-03-05)
- Q4 2025 brought SAP-RPT-1, a relational foundation model (with an open-source SAP-RPT-1-OSS), and SAP-ABAP-1 was planned (SAP News, 2025-11-17). Models added in Q1 2026 include GPT 5.2, Gemini 3.0 Pro, Claude Opus 4.6 and Claude Sonnet 4.6 (SAP News, 2026-04-14); Q2 2026 added among others Claude Opus 4.7, GPT 5.4 and Mistral Small, plus a Batch API, inference observability and speech-to-speech (SAP News, 2026-07-20).

## Joule and Joule agents

- Joule agents for finance, service and sales were announced on 13 February 2025 with an agent builder (SAP News, 2025-02-13); role-based Joule Assistants followed on 6 October 2025 (SAP News, 2025-10-06).
- Q1 2026: more than 30 agents, more than 2,500 skills, Joule live in 35 solutions, and A2A for cross-system agents (SAP News, 2026-04-14).
- Sapphire 2026: "Joule Work", a new interface with MCP and A2A support, and more than 50 Joule Assistants and more than 200 Joule Agents "in the coming months"; RISE customers get three assistants in year one (SAP News, 2026-05-12 and 2026-05-13).

## SAP Business Data Cloud, Datasphere and Analytics Cloud

- Business Data Cloud (BDC) was announced on 13 February 2025 with native Databricks integration, SAP-managed data products and insight apps, and launched in February 2025 as fully managed SaaS (SAP News, 2025-02-13 and 2025-04-30).
- BDC Connect, zero-copy two-way sharing, launched on 6 October 2025 with Databricks and Google Cloud as the first partners (SAP News, 2025-10-06). In May 2026 SAP HANA Cloud became a native BDC component, and BDC Connect for Amazon Athena was planned for the second half of 2026 (SAP News, 2026-05-13).
- BDC components on SAP's product page: SAP Analytics Cloud, SAP Datasphere, SAP Business Warehouse, SAP Databricks and intelligent applications. Existing standalone Datasphere and Analytics Cloud customers continue without interruption and can move to BDC over time. (SAP product pages)

## SAP Cloud ALM for BTP

- SAP Cloud ALM is included with SAP cloud subscriptions (Enterprise Support, cloud editions), SAP Enterprise Support and Product Support for Large Enterprises, and monitors custom apps and extensions on BTP too (SAP Cloud ALM page).
- Configuration and Security Analysis (CSA) collects configuration through APIs into a daily-snapshot database. Covered BTP services include Credential Store, Destination, Identity Services and Mobile Services, and findings carry a Security Recommendation Index ID. SAP aims to let customers move from Solution Manager Configuration Validation to CSA by the end of 2026. (SAP Learning, CSA; SAP Cloud ALM security slides, 2025-03-20)
- The Application Vulnerability Report is available through an API; BTP cockpit integration was planned for Q2 2026 and Cloud ALM integration for Q4 2026 (SAP BTP security webinar, June 2026).

## Tools: btp CLI and Terraform

- btp CLI: version 2.116.3 is the latest download on SAP Development Tools, for Linux, macOS and Windows (SAP Development Tools; Homebrew also lists 2.116.3). Log in with btp login --sso against https://cli.btp.cloud.sap, navigate with btp target --hierarchy, and turn on shell completion with btp enable autocomplete (SAP Developers tutorial).
- Terraform provider SAP/btp: v1.26.0 of 19 August 2026 was the latest release, after v1.25.0 (20 July 2026) and v1.24.0 (1 July 2026). It needs the global account subdomain, defaults to https://cli.btp.cloud.sap, and supports username and password, X.509 configured in SAP Cloud Identity Services, a JWT bearer assertion or an existing btp CLI session. Two-factor authentication is not supported in the username and password flow. It is Apache-2.0 licensed and works with OpenTofu. A separate provider, SAP/scc, manages the SAP Cloud Connector. (GitHub SAP/terraform-provider-btp, SAP/terraform-provider-scc)

## Commercial models

- SAP BTP Enterprise Agreement (BTPEA) is consumption-based: cloud credits are bought for the term and drawn down, and use beyond the credits is billed monthly at list price. Pay-As-You-Go is signed up through BTPEA and billed monthly in arrears. The older Cloud Platform Enterprise Agreement (CPEA) can be kept and renewed. (SAP BTP pricing page)
- The free tier has no time limit and covers more than 90 services with free plans, under BTPEA or Pay-As-You-Go. A trial lasts 90 days, and trial accounts idle for more than 30 days can be deleted. (SAP BTP pricing page)

## Dates to track

| Date | Item |
|---|---|
| Q3 2026 | SAP AI Agent Hub general availability; several EIC instances per cluster and a 48-hour offline mode; integration-flow generation; PO mass-migration support |
| Q4 2026 | Application Vulnerability Report in Cloud ALM; B2B error interpreter |
| Second half of 2026 | BDC Connect for Amazon Athena |
| 31 December 2026 | Free Joule Studio design time ends; free Agent Runtime ends (third-party) |
| End of 2026 | Cloud ALM CSA ready to replace Solution Manager Configuration Validation |
| 31 December 2028 | Neo end of life |

## Sources

- SAP Community, 2023-06-14, "Farewell Neo: SAP BTP multi-cloud environment": https://blogs.sap.com/2023/06/14/farewell-neo-sap-btp-multi-cloud-environment-the-deployment-environment-of-choice/
- SAP Events, 2026-07-22, "Neo to Multi-Cloud": https://www.sap.com/germany/events/2026-07-22-online-neo-to-multi-cloud-migrate-smarter-scale-faster-with-integration-suite.html
- SAP Neo migration page: https://www.sap.com/products/technology-platform/neo-migration.html
- kyma-project/kyma on GitHub: https://github.com/kyma-project/kyma
- SAP News, 2026-05-12, "SAP Unveils the Autonomous Enterprise": https://news.sap.com/2026/05/sap-sapphire-sap-unveils-autonomous-enterprise/
- SAP News, 2026-05-13, Sapphire keynote: https://news.sap.com/2026/05/sap-sapphire-keynote-business-ai-platform-power-autonomous-enterprise/
- SAP News, 2026-05-13, "Announcing New Joule Studio": https://news.sap.com/2026/05/new-joule-studio-enterprise-scale-agentic-development/
- SAP News, 2026-05-12, "SAP and Anthropic": https://news.sap.com/2026/05/sap-anthropic-to-bring-claude-sap-business-ai-platform/
- SAP News, 2026-05-13, BDC and the autonomous enterprise: https://news.sap.com/2026/05/sap-bdc-accelerate-autonomous-enterprise/
- Third-party, SAPinsider, 2026-05-29: https://sapinsider.org/articles/the-cio-imperative-sap-sapphire-2026-and-the-five-decisions-that-cannot-wait/
- SAP Learning, "Introducing SAP Business AI Platform": https://learning.sap.com/courses/introducing-sap-cloud-identity-services/introducing-sap-business-ai-platform_d49a5781-4eca-4f55-bfd5-a219129a3eeb
- SAP News, 2025-05-22, "SAP BTP Innovations Across SAP Business Suite": https://news.sap.com/2025/05/sap-btp-innovations-powerful-ai-capabilities-developers-business-users-sap-business-suite/
- SAP News, 2025-11-05, "New Agentic Capabilities on SAP BTP": https://news.sap.com/2025/11/new-agentic-capabilities-sap-btp-supercharge-developers/
- SAP News, 2025-11-17, "Business AI Innovation Unveiled at SAP TechEd": https://news.sap.com/2025/11/business-ai-innovation-unveiled-at-sap-teched/
- SAP News, 2026-04-14, "SAP Business AI: Release Highlights Q1 2026": https://news.sap.com/2026/04/sap-business-ai-release-highlights-q1-2026/
- SAP News, 2026-07-20, "SAP Business AI: Release Highlights Q2 2026": https://news.sap.com/2026/07/sap-business-ai-release-highlights-q2-2026/
- SAP News, 2025-04-22, SAP Build and SAP S/4HANA Cloud: https://news.sap.com/2025/04/sap-build-sap-s4hana-cloud-simplify-development/
- SAP News, 2023-11-02, "SAP Build Code": https://news.sap.com/2023/11/sap-teched-2023-sap-build-code-supercharge-developer-productivity/
- SAP Build Work Zone page: https://www.sap.com/products/technology-platform/workzone.html
- SAP Integration Suite slides, 2026-03-31: https://assets.dm.ux.sap.com/sap-user-groups/pdfs/260331_sap_integration_suite_monthly_update.pdf
- SAP Community, 2023-11-16, Edge Integration Cell introduction: https://blogs.sap.com/2023/11/16/next-gen-hybrid-integration-with-sap-integration-suite-edge-integration-cell-introduction-setup
- SAP Developers tutorial, AI Core orchestration (v2): https://developers.sap.com/tutorials/ai-core-orchestration-consumption-v2.html
- SAP News, 2025-02-13, SAP and Databricks: https://news.sap.com/2025/02/sap-business-data-cloud-databricks-turbocharge-business-ai/
- SAP News, 2025-04-30, BDC customer and partner updates: https://news.sap.com/2025/04/sap-business-data-cloud-picks-up-steam-customer-partner-updates/
- SAP News, 2025-10-06, SAP Business Suite: https://news.sap.com/2025/10/sap-connect-business-suite-unites-ai-data-applications/
- SAP product pages: https://www.sap.com/products/data-cloud.html , https://www.sap.com/products/data-cloud/datasphere.html , https://www.sap.com/products/data-cloud/cloud-analytics.html
- SAP Cloud ALM page: https://support.sap.com/en/alm/sap-cloud-alm.html
- SAP Learning, "Configuration and Security Analysis": https://learning.sap.com/courses/operating-with-sap-cloud-alm/configuration-and-security-analysis
- SAP Cloud ALM security slides, 2025-03-20: https://assets.dm.ux.sap.com/sap-user-groups/pdfs/250320_future_next_steps_sap_cloud_alm_security.pdf
- SAP BTP security webinar, June 2026: https://assets.dm.ux.sap.com/sap-user-groups/pdfs/260702_sap_btp_security_overview_best_practices_for_secure_development.pdf
- SAP Development Tools: https://tools.hana.ondemand.com/#cloud-btpcli
- Third-party, Homebrew cask btp: https://formulae.brew.sh/cask/btp
- SAP Developers tutorial, btp CLI: https://developers.sap.com/tutorials/cp-sapcp-getstarted.html
- GitHub SAP/terraform-provider-btp (releases, docs, README): https://github.com/SAP/terraform-provider-btp
- GitHub SAP/terraform-provider-scc: https://github.com/SAP/terraform-provider-scc
- SAP BTP pricing page: https://www.sap.com/products/technology-platform/pricing.html
