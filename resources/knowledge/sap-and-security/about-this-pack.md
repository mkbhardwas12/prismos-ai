# About the SAP and security reference pack

Pack id: sap-and-security. Compiled: 2026-10-05. Classification: public reference notes written for PrismOS. This is not SAP documentation, and it is not licensing, legal or security advice for any specific system.

## What it covers

- SAP Basis on the ABAP and Java stacks: release lines, maintenance dates, kernel, SAP GUI and Software Logistics tool versions, the Security Audit Log, profile-parameter hardening, the RFC gateway, the message server, SNC and TLS, SAP Web Dispatcher and SAProuter.
- SAP HANA 2.0 and SAP HANA Cloud: support package stacks and revisions, operations, password policy, users and privileges, auditing, encryption and backups.
- SAP Business Technology Platform (BTP): environments, the 2025 and 2026 product changes, identity, connectivity, audit logging and known vulnerabilities.
- Threats: SAP vulnerabilities that were exploited or rated critical in 2025 and 2026, the indicators defenders published, and the wider picture (MITRE ATT&CK v19, the OWASP lists, exploitation statistics).
- What the PrismOS security lane checks in SAP instance profiles, SAP HANA .ini files and SAP logs.

## How it was written

- Every fact comes from a public page read on 2026-10-05, and the page is named next to the fact and listed under Sources at the end of each document. The exception is prismos-sap-checks.md, which describes PrismOS's own code and names the files it describes.
- SAP's own pages are preferred: support.sap.com, news.sap.com, learning.sap.com and SAP user-group webinar slides. A fact that only a non-SAP source states is marked "third-party".
- Several SAP Help Portal and SAP Community pages refuse automated reading. Some of that documentation also exists as copies on GitHub; facts that only those copies support were left out of this pack. Where that left a gap, the gap is written down as an open question instead of being filled from memory.
- Values credited to the SAP Security Baseline Template (SBT) come from a third-party transcription of an older template version. They are marked "SBT value as published by a third party". The current template is described in SAP KBA 2253549 and needs an S-user login; check it before treating any of those values as SAP's requirement.
- Versions, patch levels, dates and counts change every month. Each document says what it knew on 2026-10-05 and nothing later.

## How to use it

- Use it for planning, reviews and first-pass triage. Before changing a production system, read the SAP Note named next to the fact and test the change in a non-production system.
- SAP Notes and KBAs are cited by number. Their full text needs an SAP for Me (S-user) login.
- Exploitation details, indicators of compromise and IP addresses are historical. Network indicators are written with [.] so they cannot be clicked, and most of them are stale.
- When PrismOS answers from this pack, it should name the document it used and say when a point is marked third-party or open.

## Updating

- Edit a document, review it, then put its new SHA-256 digest in manifest.json. The importer rejects a file whose digest does not match, and any Markdown file the manifest does not list.
- Import with the prismos-knowledge tool (dry run first, then --apply). Importing adds searchable text to the local knowledge graph. It does not train or change the model.
