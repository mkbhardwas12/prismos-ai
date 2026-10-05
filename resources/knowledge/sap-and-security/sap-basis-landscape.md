# SAP Basis landscape topics: clean core, RISE, transports and monitoring

As of 2026-10-05. Sources are listed at the end. "Third-party" means no SAP page confirmed the point.

## Clean core levels A to D

In August 2025 SAP replaced its three-tier extensibility model with four "clean core levels" (SAP News, 2025-08-12; third-party: ASUG):

- Level A: only publicly released, stable interfaces. This covers side-by-side extensions on SAP BTP and on-stack ABAP Cloud development.
- Level B: adds SAP's classic APIs and technologies, which are documented and generally stable across upgrades.
- Level C: partly compliant. Code reaches SAP internal objects, usually for legacy reasons.
- Level D: not recommended. Modifications, direct writes to SAP tables and objects SAP explicitly advises against. This is the highest-risk level.

SAP names the ABAP Test Cockpit and the RISE with SAP methodology dashboard as governance tools, and the Cloudification Repository lists objects that are not released as APIs (SAP News, 2025-08-12; third-party: ASUG).

## RISE with SAP, SAP Cloud ERP Private and GROW with SAP

- In SAP's 2021 description, RISE with SAP bundled SAP S/4HANA Cloud (public or private), Business Process Intelligence, SAP BTP credits, a Business Network starter pack, and tools such as the Readiness Check and the Custom Code Migration app (SAP RISE webinar, 2021).
- Division of work in RISE as SAP presented it in 2021: SAP runs technical system operations, technical landscape deployment, technical upgrade installation and RFC connection setup. Application work such as release upgrades and regression testing stays with the partner or the customer. A separate roles-and-responsibilities matrix holds the detailed split. (SAP RISE webinar, 2021)
- In 2024 SAP described S/4HANA Cloud Private Edition in Base, Premium and Premium Plus tiers, deployed on the hyperscaler of the customer's choice and operated by SAP, including application-level SLAs (SAP RISE webinar, 2024-03-07).
- The SAP Cloud ERP Private package (announced 2025-04-22) groups business applications (S/4HANA Cloud Private Edition, Business Network Supplier Portal, Enterprise Service Management, Taulia), transformation tools and services (SAP LeanIX, SAP Signavio, expert support), and optimization and extensibility tools (SAP Build, SAP HANA Cloud, Master Data Governance). (SAP News, 2025-04-22)
- GROW with SAP is SAP's offering for midsize companies, based on SAP S/4HANA Cloud, public edition, with ready-made best practices (SAP News, 2023-09-13).

## Transport management

- CTS moves ABAP Workbench and Customizing changes; CTS+ moves non-ABAP objects. Central CTS (cCTS) groups systems and requests into clusters and collections and is used only through Solution Manager ChaRM and Quality Gate Management. gCTS (Git-enabled CTS) is available from S/4HANA 2020. (SAP Change and Transport System page)
- SAP Cloud ALM can orchestrate transports for on-premise S/4HANA and S/4HANA Cloud Private Edition, and uses SAP Cloud Transport Management (cTMS) for BTP Cloud Foundry, Neo and Integration Suite content (SAP Learning, "Managing the Hybrid Deployment").
- Hybrid change management combines CTS for on-premise ABAP, CTS+ for on-premise non-ABAP and cTMS for cloud content. The Cloud ALM integration has been available since May 2022; the Solution Manager integration needs 7.2 SPS10. (SAP BTP operations webinar, 2023)

## Monitoring: SAP Cloud ALM and SAP Focused Run

- SAP Cloud ALM is SAP's central entry point for implementation and operations. On the operations side it covers business process monitoring and anomaly prediction across cloud and on-premise landscapes, including custom applications. (SAP Cloud ALM page)
- SAP Focused Run is for high-volume system, application, integration and user monitoring. It targets large customers and service providers, supports RISE with SAP and is licensed separately. Its undated page names 5.0 FP03 as the current release. (SAP Focused Run page; SAP ALM FAQ)
- Configuration Validation in Solution Manager, and the Security Baseline Template policies for Focused Run, check systems against a security baseline (SAP Security Optimization Services page).

## Sources

- SAP News, 2025-08-12, "Discover How to Extend SAP S/4HANA Cloud the Right Way": https://news.sap.com/2025/08/extend-sap-s4hana-cloud-right-way-clean-clear/
- Third-party, ASUG, "SAP Updates Clean Core Guidance to Help Customers Clarify Extensibility Criteria": https://www.asug.com/insights/sap-updates-clean-core-guidance-to-help-customers-clarify-extensibility-criteria
- SAP RISE webinar, 2021, "RISE with SAP": https://assets.dm.ux.sap.com/webinars/sap-user-groups-k4u/pdfs/210204_rise_with_sap.pdf
- SAP RISE webinar, 2024-03-07, "RISE with SAP beyond SAP S/4HANA private cloud": https://assets.dm.ux.sap.com/webinars/sap-user-groups-k4u/pdfs/rise_with_sap_beyond_sap_s4hana_private_cloud_240307.pdf
- SAP News, 2025-04-22, "Introducing SAP Cloud ERP Private Package to Accelerate Transformation": https://news.sap.com/2025/04/sap-cloud-erp-private-package-accelerate-transformation
- SAP News, 2023-09-13 (GROW with SAP): https://news.sap.com/?p=211726
- SAP Change and Transport System page: https://support.sap.com/en/tools/software-logistics-tools/change-and-transport-system.html
- SAP Learning, "Managing the Hybrid Deployment": https://learning.sap.com/courses/implementing-with-sap-cloud-alm/managing-the-hybrid-deployment-1
- SAP BTP operations webinar, 2023, "The Open Space of Application Operations within SAP BTP": https://assets.dm.ux.sap.com/sap-user-groups-k4u/pdfs/230427_the_open_space_of_application_operations_integrate_sap_cloud_transport_management.pdf
- SAP Cloud ALM page: https://support.sap.com/en/alm/sap-cloud-alm.html
- SAP Focused Run page: https://support.sap.com/en/alm/sap-focused-run.html
- SAP ALM Questions and Answers: https://support.sap.com/en/alm/faq.html
- SAP Security Optimization Services page: https://support.sap.com/sos
