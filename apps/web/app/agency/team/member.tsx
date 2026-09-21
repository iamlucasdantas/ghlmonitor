'use client';

import { useState, useTransition } from 'react';
import { setPermission, setLocationAccess } from './actions';

export interface MemberRow {
  id: string;
  name: string | null;
  email: string;
  role: 'owner' | 'admin' | 'manager';
  acceptedAt: string | null;
  permissions: Record<string, boolean>;
  locationIds: string[];
}

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', manager: 'Gerente' } as const;

export function TeamMember({
  member, locations, resources, canManagePermissions, canManageAccess,
}: {
  member: MemberRow;
  locations: { id: string; name: string }[];
  resources: { key: string; label: string }[];
  canManagePermissions: boolean;
  canManageAccess: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [permissions, setPermissions] = useState(member.permissions);
  const [assigned, setAssigned] = useState<string[]>(member.locationIds);
  const [pending, startTransition] = useTransition();

  function togglePermission(resource: string, allowed: boolean) {
    setPermissions((p) => ({ ...p, [resource]: allowed }));
    startTransition(() => { void setPermission(member.id, resource, allowed); });
  }

  function toggleLocation(locationId: string, allowed: boolean) {
    setAssigned((a) => (allowed ? [...a, locationId] : a.filter((x) => x !== locationId)));
    startTransition(() => { void setLocationAccess(member.id, locationId, allowed); });
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <div className="text-sm font-medium">{member.name ?? member.email}</div>
          <div className="text-xs text-ink-dim">
            {member.email} · {ROLE_LABEL[member.role]}
            {!member.acceptedAt && ' · convite pendente'}
          </div>
        </div>
        {member.role === 'manager' && (
          <span className="text-xs text-ink-dim">{assigned.length} subconta(s)</span>
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-lg border border-edge bg-panel-2 px-3 py-1 text-xs hover:bg-edge"
        >
          {open ? 'Fechar' : 'Permissões'}
        </button>
      </div>

      {open && (
        <div className="mt-3 grid gap-4 rounded-lg border border-edge bg-panel-2 p-3 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-ink-dim">Recursos</h3>
            {/* Owners always see everything; there is no toggle that can lock them out. */}
            {member.role === 'owner' ? (
              <p className="text-xs text-ink-dim">O owner tem acesso a tudo.</p>
            ) : (
              <ul className="space-y-1.5">
                {resources.map((r) => (
                  <li key={r.key} className="flex items-center justify-between gap-2 text-sm">
                    <span>{r.label}</span>
                    <input
                      type="checkbox"
                      disabled={!canManagePermissions || pending}
                      checked={permissions[r.key] !== false}
                      onChange={(e) => togglePermission(r.key, e.target.checked)}
                      className="h-4 w-4 accent-blue-500"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-ink-dim">Subcontas</h3>
            {member.role !== 'manager' ? (
              <p className="text-xs text-ink-dim">
                {ROLE_LABEL[member.role]} enxerga todas as subcontas da agência.
              </p>
            ) : (
              <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {locations.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{l.name}</span>
                    <input
                      type="checkbox"
                      disabled={!canManageAccess || pending}
                      checked={assigned.includes(l.id)}
                      onChange={(e) => toggleLocation(l.id, e.target.checked)}
                      className="h-4 w-4 accent-blue-500"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
