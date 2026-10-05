# SAP BTP security: identity, connectivity, audit logging and vulnerabilities

As of 2026-10-05. Sources are listed at the end. "Third-party" means no SAP page confirmed the point. SAP's BTP documentation on the Help Portal could not be read, and facts found only in GitHub copies of it are left out, so details such as security descriptor syntax, token lifetimes, audit log retention and destination property names are not covered here; check them in SAP's documentation.

## Identity and trust

- The default identity provider, SAP ID service, needs no setup, but SAP strongly recommends a custom SAP Cloud Identity Services tenant instead. Connect that tenant before you add more platform users from the default identity provider. (SAP Learning, users and identity providers; SAP Learning, managing users and authorizations)
- Trust for platform users is set at global account level and inherited by directories, subaccounts and Cloud Foundry. Trust for business users is set per subaccount over OpenID Connect. Shadow users are created for authorization assignment and are not deleted automatically, so clean them up. The Kyma environment accepts only one identity provider: adding a custom one replaces the default trust. (SAP Learning, users and identity providers)
- Emergency access: global account administrators can use "Add Me as Admin" to give themselves subaccount access. If no administrator is left on a contract account, SAP Note 2669325 applies. (SAP Learning, managing users and authorizations)
- SAP Cloud Identity Services, Identity Authentication (IAS) offers form, SPNEGO, social and two-factor logon, SAML 2.0 single sign-on, risk-based authentication by IP range, group, user type or method, conditional delegation to a corporate identity provider, and a SCIM REST API. SAP recommends IAS as the hub between BTP and corporate identity providers. Identity Provisioning (IPS) automates the user life cycle between source, target and proxy systems. (SAP Learning, Cloud Identity Services lessons)

## SAP's BTP security recommendations

- SAP keeps a growing list of BTP security recommendations. Each entry has a component, a priority, a Secure Operations Map area, the default setting, the recommendation, a last-update date and an index ID. SAP Cloud ALM Configuration and Security Analysis refers to these IDs. (SAP Learning, BTP security recommendations; SAP Learning, CSA)
- IDs on SAP's own 2025 slides: BTP-IAS-0001, BTP-IAS-0002, BTP-IAS-0003, BTP-IAS-0005 and BTP-IAS-0006 sit in one column next to these titles: admin console access only via multi-factor authentication (enforced); no authentication with Google, Facebook and similar; no self-registration of users; expected password policy is configured; only passwordless authentication is allowed. The slide's text does not show reliably which ID belongs to which title, so check the slides or SAP's recommendation list before quoting one. BTP-IAS-0017 appears with "grant of critical authorizations should stay under control". BTP-IPS-0005 and BTP-IPS-0007 appear under a "Trust, Protocols, Certificates" heading with "https is used as protocol for URLs" and "trust is deliberately established". No other IDs are given here, to avoid guessing. (SAP BTP secure configuration slides, 2025)
- A third party reports that SAP added BTP checks to its Security Baseline Template (third-party: Onapsis, 2025-03-28).

What SAP's secure-configuration slides recommend (SAP BTP secure configuration slides, 2025):

- Identity: enforce multi-factor authentication for admin console access, use passwordless authentication where possible (certificates, FIDO), integrate with the existing corporate identity provider, and make sure the expected identity provider is the default.
- Audit log: download and archive the logs regularly, integrate them with a central audit log or SIEM system, use the Audit Log APIs for automation, and watch the retention settings. The default retention period and the plan for longer retention are described in SAP's Audit Log service documentation, which this pack does not cite.
- Destinations: TLS 1.2 or higher with certificate auto-renewal; OAuth or SAML instead of password-based authentication; avoid the deprecated SAP Assertion SSO; mutual TLS in production; single sign-on through principal propagation; validate server certificates.
- Cloud Connector: enforce HTTPS and monitor exceptions, avoid broad sub-paths in exposed URLs, use LDAPS and SNC in production, limit trusted root CAs and cipher suites, replace the default administrator with LDAP users, and turn on audit logging with controlled tracing.

SAP's June 2026 BTP security webinar describes BTP audit logs as digitally signed and tamper-proof (SAP BTP security webinar, June 2026).

## SAP Cloud Connector

- The latest version on SAP Development Tools is 2.19.1, for Linux (x86_64, aarch64, ppc64le), macOS and Windows. Version 2.16.2 is still offered for legacy upgrades only and is marked unsupported. (SAP Development Tools)
- SAP KBA 3781068 covers the embedded Apache Tomcat in release 2.19.1; its preview names Tomcat 9.0.118 (SAP KBA preview). SAP's March 2026 slides list 2.19.0.2 with RHEL 10, SLES 16, macOS 26 and Linux aarch64 support, WebSocket RFC and simpler trust management (SAP Integration Suite slides, 2026-03-31).
- SAP supports the two latest feature versions in parallel, per SAP Note 3302250 as quoted by a third party (third-party: Avantra, 2026-08-05).
- The Cloud Connector opens only outbound connections, so no inbound firewall port is needed (SAP Learning, secure connectivity).
- A Terraform provider, SAP/scc, can manage Cloud Connector configuration as code (GitHub SAP/terraform-provider-scc).

## Shared responsibility

- SAP delivers and operates the platform's core services, keeps them secure and compliant, updates them, provisions global accounts and entitlements, and manages runtimes and services. The customer organizes the account structure, manages its applications, integrations and data, assigns user authorizations, and handles change management and operations. Observability, security and compliance, and high availability and disaster recovery are shared between SAP and the customer. (SAP Learning, responsibilities and guidance resources)

## BTP-related vulnerabilities and incidents, 2024 to 2026

What was found, not a complete audit; several 2025 monthly Patch Day pages could not be read.

| When | Component | IDs | Severity | What to do |
|---|---|---|---|---|
| Dec 2023, listed again Jan 2024 | BTP security libraries (@sap/xssec, Java cloud-security-services-integration-library, Python sap-xssec, Go cloud-security-client-go) | CVE-2023-49583, CVE-2023-50422, CVE-2023-50423, CVE-2023-50424; Notes 3411067, 3412456 | 9.1 | Privilege escalation. Java library fixed in 2.17.0 and 3.3.0; @sap/xssec fixed from 3.6.0 |
| 13 Feb 2024 | SAP Cloud Connector 2.0 | CVE-2024-25642; Note 3424610 | 7.4 | Improper certificate validation could let an attacker impersonate servers. Apply the note |
| Jan to May 2024, published Jul 2024 | SAP AI Core ("SAPwned", found by Wiz) | no CVE reported | n/a | Weak tenant isolation exposed other customers' artifacts and cloud credentials; SAP fixed it by 15 May 2024 (third-party: The Hacker News) |
| Jul 2024 | SAP Edge Integration Cell images | Note 3442741 | 6.8 | Stack overflow in component images older than 8.13.5 |
| Aug 2024 | SAP Build Apps | CVE-2024-29415; Note 3477196 | 9.1 | Server-side request forgery through a vulnerable dependency (third-party: SecurityBridge) |
| 11 Feb 2025 | SAP Approuter 2.6.1 to 16.7.1 | CVE-2025-24876; Note 3567974 | 8.1 | Authentication bypass by authorization-code injection (session theft) |
| 12 Aug 2025 | SAP Cloud Connector 2.0 | CVE-2025-42955; Note 3611345 | 3.5 | Missing authorization check on the LDAP connection-test endpoint |
| 29 to 30 Apr 2026 | npm supply chain "Mini Shai-Hulud": @cap-js/db-service 2.10.1, @cap-js/postgres 2.2.2, @cap-js/sqlite 2.2.2, mbt 1.2.48 | Note 3747787; no CVE verified | Critical | A preinstall hook stole GitHub, npm, cloud and BTP service-key secrets. Remove those versions and rotate every credential the build could reach (SAP Patch Day, Apr 2026; third-party: Onapsis, Pathlock) |
| 14 Jul 2026 | SAP Approuter below 20.10.0 | CVE-2026-27690; Note 3720138 | 9.1 | HTTP request smuggling |
| 14 Jul 2026 | SAP Approuter below 21.2.0 | CVE-2026-44745; Note 3741519 | 8.1 | Open redirect in the OAuth2 login flow |
| Jul 2026 | Apache Camel in SAP Integration Suite | Note 3758101 (SAP CVSS 8.8), includes CVE-2026-40860 (Apache CVSS 9.8) | High | JMS ObjectMessage deserialization leading to remote code execution; Apache fixed it in 4.14.7, 4.18.2 and 4.20.0 |
| 11 Aug 2026 | SAP Approuter below 23.0.0, listed as "SAP Business AI Platform (Approuter)" | CVE-2026-58230; Note 3786038 | 7.0 | Weak token validation can send credentials to an attacker |
| 8 Sep 2026 | CAP multitenancy @sap/cds-mtxs | CVE-2026-76969; Note 3798315 | 9.4 | Unauthenticated credential disclosure and tenant-data tampering in extensible multitenant CAP apps; check the note for fixed versions |

Practical consequences:

- Keep @sap/approuter at 23.0.0 or later; it had four CVEs between February 2025 and August 2026.
- Pin and audit CAP and MTA npm dependencies, and rotate BTP service keys if a build ran a compromised package.
- No BTP-specific notes were found on the January, February, March, May and June 2026 Patch Day pages.

## Sources

- SAP Learning, "Explaining Users and Identity Providers": https://learning.sap.com/courses/operating-sap-business-technology-platform/explaining-users-and-identity-providers
- SAP Learning, "Managing Users and Authorizations on SAP BTP": https://learning.sap.com/courses/operating-sap-business-technology-platform/managing-users-and-authorizations-on-sap-btp
- SAP Learning, "Exploring the Identity Authentication Service": https://learning.sap.com/courses/introducing-sap-cloud-identity-services/exploring-the-identity-authentication-service
- SAP Learning, "Exploring Identity Provisioning": https://learning.sap.com/courses/introducing-sap-cloud-identity-services/exploring-identity-provisioning_e60da52d-fd3f-4614-a076-df574b105aa9
- SAP Learning, "Analyzing SAP Cloud Identity Services": https://learning.sap.com/learning-journeys/discover-sap-business-technology-platform/analyzing-sap-cloud-identity-services_b3e97772-7473-4634-9529-61a2e2d70338
- SAP Learning, "Leveraging SAP BTP Security Recommendations": https://learning.sap.com/courses/architecting-security-for-sap-business-technology-platform/leveraging-sap-btp-security-recommendations
- SAP Learning, "Configuration and Security Analysis": https://learning.sap.com/courses/operating-with-sap-cloud-alm/configuration-and-security-analysis
- SAP BTP secure configuration slides, 2025, "Day 2 Operations: Secure Configuration for your SAP BTP Services": https://assets.dm.ux.sap.com/sap-user-groups/pdfs/250626_secure_configuration_for_your_sap_btp_services.pdf
- SAP BTP security webinar, June 2026, "SAP BTP Security Overview: Best Practices for Secure Development": https://assets.dm.ux.sap.com/sap-user-groups/pdfs/260702_sap_btp_security_overview_best_practices_for_secure_development.pdf
- SAP Development Tools: https://tools.hana.ondemand.com/#cloud-btpcli
- SAP KBA 3781068 preview: https://userapps.support.sap.com/sap/support/knowledge/en/3781068
- SAP Integration Suite slides, 2026-03-31: https://assets.dm.ux.sap.com/sap-user-groups/pdfs/260331_sap_integration_suite_monthly_update.pdf
- Third-party, Avantra, 2026-08-05, "SAP Cloud Connector": https://www.avantra.com/blog/sap-cloud-connector-essential-for-ground-to-cloud-and-ai-operations/
- SAP Learning, "Exploring Secure Connectivity in SAP BTP": https://learning.sap.com/courses/architecting-security-for-sap-business-technology-platform/exploring-secure-connectivity-in-sap-btp
- GitHub SAP/terraform-provider-scc: https://github.com/SAP/terraform-provider-scc
- SAP Learning, "Analyzing Responsibilities and Guidance Resources": https://learning.sap.com/courses/operating-sap-business-technology-platform/analyzing-responsibilities-and-guidance-resources
- Third-party, Onapsis, 2025-03-28, securing SAP BTP: https://onapsis.com/blog/securing-sap-btp-vulnerability-management-enforcing-best-practices-for-users-configurations/
- CVE.org records: CVE-2023-50422, CVE-2024-25642, CVE-2025-24876, CVE-2025-42955, CVE-2026-27690, CVE-2026-44745, CVE-2026-58230, CVE-2026-76969, CVE-2026-40860: https://cveawg.mitre.org/api/cve/ followed by the id
- SAP Patch Day bulletins 2024 and 2025: https://support.sap.com/en/my-support/knowledge-base/security-notes-news/bulletin-2024.html and https://support.sap.com/en/my-support/knowledge-base/security-notes-news/bulletin-2025.html
- SAP Patch Day pages, January to September 2026 (April, July, August and September for the notes above; the others had no BTP-specific notes): https://support.sap.com/en/my-support/knowledge-base/security-notes-news/january-2026.html and the matching february-2026, march-2026, april-2026, may-2026, june-2026, july-2026, august-2026 and september-2026 pages
- Third-party, SecurityBridge advisories for Notes 3477196, 3567974 and 3611345: https://cloud.securitybridge.com/advisory/detail/3477196
- Third-party, Onapsis, 2026-04-29, "Mini Shai-Hulud": https://onapsis.com/blog/sap-cap-mini-shai-hulud-supply-chain-attack/
- Third-party, Pathlock, 2026-05-01, SAP npm supply chain incident: https://pathlock.com/blog/security-alerts/sap-npm-supply-chain-incident-malicious-packages-impact-cap-mta/
- Third-party, The Hacker News, July 2024, SAP AI Core vulnerabilities: https://thehackernews.com/2024/07/sap-ai-core-vulnerabilities-expose.html
