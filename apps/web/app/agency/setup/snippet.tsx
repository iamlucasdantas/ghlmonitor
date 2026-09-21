'use client';

import { useState } from 'react';

export function Snippet({
  agencyId, token, collectorUrl,
}: { agencyId: string; token: string; collectorUrl: string }) {
  const [copied, setCopied] = useState(false);

  const code = `<script>
  window.__PULSE__ = {
    key: '${agencyId}',
    token: '${token}',
    endpoint: '${collectorUrl}/collect'
  };
</script>
<script src="${collectorUrl}/pulse.min.js" async></script>`;

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <pre className="overflow-x-auto rounded-lg border border-edge bg-panel-2 p-3 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <button
        onClick={copy}
        className="mt-2 rounded-lg border border-edge bg-panel-2 px-3 py-1.5 text-sm hover:bg-edge"
      >
        {copied ? 'Copiado' : 'Copiar snippet'}
      </button>
    </div>
  );
}
