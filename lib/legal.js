const OP = 'ONIGIRI BENTO (hackathon team). Legal name, address and grievance contact: [TO BE CONFIRMED BY PROJECT OWNER]. Contact: [AUTHORISED CONTACT METHOD — NOT YET SUPPLIED].';
const L = {
  privacy: ['Privacy Policy', [
    ['Status', 'Monozukuri is a free, non-commercial hackathon prototype. This page is a draft in plain language; it is not legal advice and does not claim legal compliance. It needs review by the project owner and qualified counsel before any real deployment.'],
    ['Who is responsible', OP],
    ['What we collect and why', 'Master: a passphrase (checked server-side only), video and audio of your work, your typed answers and edits. Apprentice: periodic camera snapshots during practice, questions and help requests. Everyone: a random invitation token, connection times and an event log. We do not collect location, contacts or device identifiers, and no name or email is required to join.'],
    ['How it is processed', 'Recordings and snapshots are stored on the operator\'s own computer in a private folder and shown only through short-lived signed links. AI analysis runs only if the operator configured a local model (Ollama) on the same machine or private network. This build has no cloud AI provider and sends nothing to third parties. An operator who later enables one must tell participants first.'],
    ['Consent', 'Before any camera or microphone use you must tick an unticked consent box on your own device. Consent covers recording and analysis for the session only. No use for model training or research is offered or assumed.'],
    ['Retention and deletion', 'Data is deleted automatically after the operator\'s retention period (default 30 days). The master can delete a session, with all its recordings, snapshots, knowledge records and help requests, at any time from the dashboard. Only the latest snapshot per practice, plus snapshots attached to help requests, are kept.'],
    ['Security', 'Private storage, role-scoped time-limited invitations, signed expiring media links, input limits and no analytics. No system is perfectly secure; operators must handle incidents and notify affected people where the law requires.'],
    ['Cross-border processing', 'None by default: data stays on the operator\'s machine. A tunnel service used for remote demos carries encrypted traffic through its servers (see the Cookie Policy inventory).'],
    ['Your rights', 'Ask the operator to access, correct or delete your data or to withdraw consent. Withdrawing consent stops further recording; it does not undo lawful processing already done. Use the contact above.'],
    ['AI limitations', 'AI observations and coaching come from sampled still images and approved expert notes. They can be wrong, cannot see hidden defects, and are not a certification or safety inspection. Expert explanations are always shown separately from AI text.'],
  ]],
  terms: ['Terms and Conditions', [
    ['Prototype', 'Monozukuri is an unfinished hackathon prototype provided free of charge and as is, without warranties. Do not rely on it for safety-critical or certification decisions.'],
    ['Operator', OP + ' This project is not endorsed by Thapar Institute, JETRO or any other organisation.'],
    ['Your responsibilities', 'Only record people who have consented and content you have the right to record. Do not upload unlawful material. Follow workshop safety rules; qualified human supervision always outranks AI feedback.'],
    ['Expert knowledge', 'Records are the master\'s own explanations. The master decides what is approved. Approval does not make advice correct for every situation.'],
    ['Payments', 'There are no payments, purchases or subscriptions, so no refund policy applies to this version. If paid features are ever added, refund terms, tax and consumer-law disclosures and legal review will be needed first.'],
    ['Liability and governing law', '[TO BE CONFIRMED BY COUNSEL: limitation of liability, governing law and jurisdiction.]'],
  ]],
  cookies: ['Cookie Policy', [
    ['Summary', 'We set one strictly necessary cookie, only on the master\'s laptop after sign-in. We use no analytics, advertising or tracking and load no third-party scripts, fonts or embeds. On that basis we show no cookie banner; if optional tracking is ever added it must stay off until the person opts in.'],
    ['Inventory', '<div class="scroll"><table><thead><tr><th>Name</th><th>Purpose</th><th>Provider</th><th>Category</th><th>Lifetime</th><th>Strictly necessary</th></tr></thead><tbody><tr><td><code>mz</code> cookie</td><td>Keeps the master signed in (signed, HttpOnly, SameSite=Strict)</td><td>This application</td><td>Authentication</td><td>12 hours</td><td>Yes</td></tr><tr><td>Invitation token (URL fragment, not a cookie)</td><td>Identifies a phone and its role</td><td>This application</td><td>Authentication</td><td>Until invite expires (default 24 h)</td><td>Yes</td></tr><tr><td>Camera/microphone permission</td><td>Managed by your browser</td><td>Your browser</td><td>Device permission</td><td>Browser setting</td><td>Yes</td></tr></tbody></table></div>'],
    ['Third-party requests', 'None from the application itself. If a tunnel is used for remote demos, that provider sees encrypted traffic metadata.'],
  ]],
};
export function renderLegal(key) {
  const [title, secs] = L[key];
  const body = secs.map(([h, t]) => `<section><h2>${h}</h2>${t.startsWith('<') ? t : `<p>${t}</p>`}</section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Monozukuri</title><link rel="stylesheet" href="/style.css"></head><body><a class="skip" href="#main">Skip to content</a><header class="top"><a href="/" class="brand">物作り Monozukuri <span class="badge">Prototype</span></a><nav aria-label="Legal"><a href="/privacy">Privacy</a> <a href="/terms">Terms</a> <a href="/cookies">Cookies</a></nav></header><main id="main" class="wrap prose"><h1>${title}</h1><p class="hint">Draft prototype text — requires legal review.</p>${body}</main></body></html>`;
}
