import type { SmartBrowserView } from "./smart-browser.service";

export function smartLoginPage(view: SmartBrowserView, message?: string): string {
  return page(
    "Authorize SMART application",
    `<h1>Connect ${escapeHtml(view.clientName)}</h1>
     <p class="lead">Sign in to CarePoint to review the access requested by this application.</p>
     ${notice(message)}
     <form method="post" action="/api/v1/smart/browser/login" autocomplete="on">
       ${hidden("transaction", view.transactionId)}
       <label>Email<input name="email" type="email" autocomplete="username" maxlength="320" required></label>
       <label>Password<input name="password" type="password" autocomplete="current-password" maxlength="500" required></label>
       <button type="submit">Continue securely</button>
     </form>
     ${scopeSummary(view)}`,
  );
}

export function smartMfaPage(view: SmartBrowserView, message?: string): string {
  return page(
    "Verify identity",
    `<h1>Verify your identity</h1>
     <p class="lead">Multi-factor authentication is required before ${escapeHtml(view.clientName)} can request access.</p>
     ${notice(message)}
     <form method="post" action="/api/v1/smart/browser/mfa" autocomplete="off">
       ${hidden("transaction", view.transactionId)}
       <label>Authenticator code<input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="20" required></label>
       <button type="submit">Verify</button>
     </form>`,
  );
}

export function smartConsentPage(view: SmartBrowserView): string {
  return page(
    "Review SMART access",
    `<h1>Review access request</h1>
     <p class="lead"><strong>${escapeHtml(view.clientName)}</strong> is requesting access to your CarePoint health information.</p>
     <div class="panel">
       <h2>Requested permissions</h2>
       <ul>${view.scopes.map((scope) => `<li><code>${escapeHtml(scope)}</code><span>${escapeHtml(scopeDescription(scope))}</span></li>`).join("")}</ul>
     </div>
     <p class="privacy">CarePoint will continue to enforce your patient boundary, consent rules and clinical release controls. The application receives only the permissions listed above.</p>
     <form method="post" action="/api/v1/smart/browser/consent" class="actions">
       ${hidden("transaction", view.transactionId)}
       <button type="submit" name="decision" value="approve">Approve access</button>
       <button type="submit" name="decision" value="deny" class="secondary">Deny</button>
     </form>`,
  );
}

export function smartErrorPage(title: string, message: string): string {
  return page(
    title,
    `<h1>${escapeHtml(title)}</h1><p class="lead">${escapeHtml(message)}</p><p class="privacy">You may close this window and return to the application.</p>`,
  );
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · CarePoint</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light;background:#f5f7fa;color:#152033}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.shell{width:min(100%,620px);background:#fff;border:1px solid #dce2ea;border-radius:16px;padding:32px;box-shadow:0 16px 45px rgba(31,45,61,.08)}
h1{margin:0 0 12px;font-size:1.8rem}h2{font-size:1.05rem;margin:0 0 12px}.lead{line-height:1.55;color:#40516b;margin:0 0 24px}.brand{font-size:.82rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#53657e;margin-bottom:18px}
label{display:grid;gap:7px;font-weight:650;margin:16px 0}input{width:100%;padding:12px 13px;border:1px solid #aeb9c7;border-radius:9px;font:inherit;background:#fff;color:#152033}input:focus{outline:3px solid rgba(54,105,214,.18);border-color:#3669d6}
button{border:0;border-radius:9px;padding:12px 18px;font:inherit;font-weight:700;background:#2457c5;color:#fff;cursor:pointer}button.secondary{background:#eef2f7;color:#28394f}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}.panel{border:1px solid #dce2ea;border-radius:12px;padding:18px;background:#fafbfd}.panel ul{list-style:none;margin:0;padding:0}.panel li{padding:10px 0;border-top:1px solid #e8ecf1;display:grid;gap:4px}.panel li:first-child{border-top:0}.panel code{font-weight:700;color:#253a5a}.panel span{font-size:.9rem;color:#586b83}.privacy{font-size:.9rem;line-height:1.55;color:#586b83;margin-top:20px}.notice{padding:12px 14px;border-radius:9px;background:#fff4df;border:1px solid #efcf92;color:#674b19;margin-bottom:18px}.scopes{font-size:.82rem;color:#687991;margin-top:22px;line-height:1.5;word-break:break-word}
</style>
</head>
<body><main class="shell"><div class="brand">CarePoint SMART authorization</div>${body}</main></body>
</html>`;
}

function scopeSummary(view: SmartBrowserView): string {
  return `<p class="scopes">Requested scopes: ${view.scopes.map(escapeHtml).join(" · ")}</p>`;
}

function scopeDescription(scope: string): string {
  if (scope === "launch/patient") return "Use your patient launch context for this authorization.";
  if (scope === "openid") return "Receive an OpenID Connect identity token for this sign-in.";
  if (scope === "fhirUser") return "Receive your FHIR Patient identity in the ID Token.";
  const match = /^patient\/([^.]*)\.([a-z]+)$/.exec(scope);
  if (!match) return "SMART permission requested by the application.";
  const actions = match[2].split("").map((action) => action === "r" ? "read" : action === "s" ? "search" : action).join(", ");
  return `${actions} ${match[1]} resources within your patient context.`;
}

function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
}

function notice(message?: string): string {
  return message ? `<div class="notice" role="alert">${escapeHtml(message)}</div>` : "";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}
