/**
 * opsledger — Markdown, HTML and JSON engagement reports.
 * @module opsledger/report
 */

/**
 * Escape a value for inclusion in HTML.
 * @param {*} value The value to escape.
 * @returns {string} The escaped text.
 */
export function escapeHtml(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape a value for inclusion in a Markdown table cell.
 * @param {*} value The value to escape.
 * @returns {string} The escaped text.
 */
export function escapeCell(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Summarize the chain verification result.
 * @param {object} verification The verification result.
 * @returns {string} The summary text.
 */
function chainSummary(verification) {
  if (!verification) {
    return 'not verified';
  }
  if (verification.ok) {
    return `**INTACT** — ${verification.checked} event(s) verified`;
  }
  return `**BROKEN** at event ${verification.brokenIndex} — ${verification.reason}`;
}

/**
 * Summarize the signature verification result.
 * @param {object} verification The verification result.
 * @returns {string} The summary text.
 */
function signatureSummary(verification) {
  const signature = verification && verification.signature;
  if (!signature || !signature.present) {
    return 'unsigned';
  }
  if (signature.valid === true) {
    return 'signed and verified with the supplied key';
  }
  if (signature.valid === false) {
    return 'signed, but the supplied key does **not** match';
  }
  return 'signed, but not checked because no key was supplied';
}

/**
 * Render the engagement report as Markdown.
 * @param {object} ledger The ledger.
 * @param {object} manifest The artifact manifest.
 * @param {object} verification The verification result.
 * @param {object} [options] The rendering options.
 * @param {string} [options.generatedAt] The report timestamp.
 * @returns {string} The Markdown report.
 */
export function toMarkdown(ledger, manifest, verification, options = {}) {
  const artifacts = (manifest && manifest.artifacts) || [];
  const events = ledger.events || [];
  const generatedAt = options.generatedAt || new Date().toISOString();

  const lines = [];
  lines.push(`# Engagement Evidence Ledger — ${escapeCell(ledger.engagement)}`);
  lines.push('');
  lines.push(`Generated: ${escapeCell(generatedAt)}`);
  lines.push('');
  lines.push('| | |');
  lines.push('| --- | --- |');
  lines.push(`| Engagement | ${escapeCell(ledger.engagement)} |`);
  lines.push(`| Created | ${escapeCell(ledger.createdAt)} |`);
  lines.push(`| Events | ${events.length} |`);
  lines.push(`| Artifacts | ${artifacts.length} |`);
  lines.push(`| Chain | ${chainSummary(verification)} |`);
  lines.push(`| Signature | ${signatureSummary(verification)} |`);
  lines.push('');

  lines.push('## Timeline');
  lines.push('');
  if (events.length === 0) {
    lines.push('_No events have been recorded._');
  } else {
    lines.push('| # | Time | Type | Actor | Summary | Reference |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const event of events) {
      lines.push(
        `| ${escapeCell(event.index)} | ${escapeCell(event.timestamp)} | ${escapeCell(event.type)} | `
          + `${escapeCell(event.actor || '—')} | ${escapeCell(event.summary)} | ${escapeCell(event.ref || '—')} |`,
      );
    }
  }
  lines.push('');

  lines.push('## Artifact manifest');
  lines.push('');
  if (artifacts.length === 0) {
    lines.push('_No artifacts have been registered._');
  } else {
    lines.push('| ID | File | Size | SHA-256 | Classification | Collected | Note |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const artifact of artifacts) {
      lines.push(
        `| ${escapeCell(artifact.id)} | ${escapeCell(artifact.path)} | ${escapeCell(artifact.size)} | `
          + `${escapeCell(artifact.sha256)} | ${escapeCell(artifact.classification)} | `
          + `${escapeCell(artifact.collectedAt)} | ${escapeCell(artifact.note || '—')} |`,
      );
    }
  }
  lines.push('');

  if (verification && !verification.ok) {
    lines.push('## Verification failure');
    lines.push('');
    lines.push(`- Broken event index: ${verification.brokenIndex}`);
    lines.push(`- Expected hash: \`${verification.expectedHash || '—'}\``);
    lines.push(`- Recorded hash: \`${verification.actualHash || '—'}\``);
    lines.push(`- Reason: ${verification.reason}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Render the engagement report as a self-contained HTML page.
 * @param {object} ledger The ledger.
 * @param {object} manifest The artifact manifest.
 * @param {object} verification The verification result.
 * @param {object} [options] The rendering options.
 * @param {string} [options.generatedAt] The report timestamp.
 * @returns {string} The HTML document.
 */
export function toHtml(ledger, manifest, verification, options = {}) {
  const artifacts = (manifest && manifest.artifacts) || [];
  const events = ledger.events || [];
  const generatedAt = options.generatedAt || new Date().toISOString();
  const chain = verification && verification.ok ? 'intact' : 'broken';

  const eventRows = events.length
    ? events
      .map(
        (event) => `<tr><td>${escapeHtml(event.index)}</td><td>${escapeHtml(event.timestamp)}</td>`
          + `<td>${escapeHtml(event.type)}</td><td>${escapeHtml(event.actor || '—')}</td>`
          + `<td>${escapeHtml(event.summary)}</td><td>${escapeHtml(event.ref || '—')}</td></tr>`,
      )
      .join('\n        ')
    : '<tr><td colspan="6">No events have been recorded.</td></tr>';

  const artifactRows = artifacts.length
    ? artifacts
      .map(
        (artifact) => `<tr><td>${escapeHtml(artifact.id)}</td><td>${escapeHtml(artifact.path)}</td>`
          + `<td>${escapeHtml(artifact.size)}</td><td><code>${escapeHtml(artifact.sha256)}</code></td>`
          + `<td>${escapeHtml(artifact.classification)}</td><td>${escapeHtml(artifact.collectedAt)}</td>`
          + `<td>${escapeHtml(artifact.note || '—')}</td></tr>`,
      )
      .join('\n        ')
    : '<tr><td colspan="7">No artifacts have been registered.</td></tr>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Engagement Evidence Ledger — ${escapeHtml(ledger.engagement)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.55 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         margin: 0 auto; max-width: 60rem; padding: 2rem 1.25rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.15rem; margin-top: 2.25rem; border-bottom: 1px solid #8884; padding-bottom: 0.3rem; }
  .meta { color: #6b7280; font-size: 0.9rem; margin-top: 0; }
  .badge { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 999px;
           font-size: 0.8rem; font-weight: 600; letter-spacing: 0.02em; }
  .badge.intact { background: #16a34a22; color: #15803d; }
  .badge.broken { background: #dc262622; color: #b91c1c; }
  table { border-collapse: collapse; width: 100%; margin-top: 0.75rem; font-size: 0.9rem; }
  th, td { border: 1px solid #8883; padding: 0.4rem 0.55rem; text-align: left; vertical-align: top; }
  th { background: #8881; font-weight: 600; }
  code { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: 0.82rem; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 1rem; margin: 0; }
  dt { font-weight: 600; } dd { margin: 0; }
</style>
</head>
<body>
<h1>Engagement Evidence Ledger — ${escapeHtml(ledger.engagement)}</h1>
<p class="meta">Generated ${escapeHtml(generatedAt)}</p>

<h2>Engagement</h2>
<dl>
  <dt>Engagement</dt><dd>${escapeHtml(ledger.engagement)}</dd>
  <dt>Created</dt><dd>${escapeHtml(ledger.createdAt)}</dd>
  <dt>Events</dt><dd>${events.length}</dd>
  <dt>Artifacts</dt><dd>${artifacts.length}</dd>
  <dt>Chain</dt><dd><span class="badge ${chain}">${escapeHtml(chain)}</span> ${escapeHtml(chainSummary(verification))}</dd>
  <dt>Signature</dt><dd>${escapeHtml(signatureSummary(verification))}</dd>
</dl>

<h2>Timeline</h2>
<table>
  <thead><tr><th>#</th><th>Time</th><th>Type</th><th>Actor</th><th>Summary</th><th>Reference</th></tr></thead>
  <tbody>
        ${eventRows}
  </tbody>
</table>

<h2>Artifact manifest</h2>
<table>
  <thead><tr><th>ID</th><th>File</th><th>Size</th><th>SHA-256</th><th>Classification</th><th>Collected</th><th>Note</th></tr></thead>
  <tbody>
        ${artifactRows}
  </tbody>
</table>
${verification && !verification.ok
    ? `<h2>Verification failure</h2>
<dl>
  <dt>Broken event index</dt><dd>${escapeHtml(verification.brokenIndex)}</dd>
  <dt>Expected hash</dt><dd><code>${escapeHtml(verification.expectedHash || '—')}</code></dd>
  <dt>Recorded hash</dt><dd><code>${escapeHtml(verification.actualHash || '—')}</code></dd>
  <dt>Reason</dt><dd>${escapeHtml(verification.reason)}</dd>
</dl>`
    : ''}
</body>
</html>
`;
}

/**
 * Render the engagement report as JSON.
 * @param {object} ledger The ledger.
 * @param {object} manifest The artifact manifest.
 * @param {object} verification The verification result.
 * @param {object} [options] The rendering options.
 * @param {string} [options.generatedAt] The report timestamp.
 * @returns {string} The JSON document.
 */
export function toJson(ledger, manifest, verification, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const document = {
    tool: 'opsledger',
    engagement: {
      name: ledger.engagement,
      createdAt: ledger.createdAt,
      generatedAt,
    },
    verification: verification || null,
    events: ledger.events || [],
    artifacts: (manifest && manifest.artifacts) || [],
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}
