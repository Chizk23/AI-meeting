/**
 * P2 #22 — System-admin "view-as-org" mode.
 *
 * Backend hooks (POST/DELETE /api/admin/view-as-org/{org_id}) are pure
 * audit triggers — the system-admin already passes require_org_admin for
 * any org so no client-side permission upgrade is needed. This module
 * owns the *UI* mode: persisting the active view-as org in sessionStorage
 * so a banner can render on every page, and broadcasting changes so
 * subscribers (AdminLayout banner) re-render without prop drilling.
 */
import api from './api';

const STORAGE_KEY = 'devin_view_as_org';
const EVENT_NAME = 'devin:view-as-org-changed';

export type ViewAsOrgState = {
  organization_id: string;
  organization_name: string;
};

export function getViewAsOrg(): ViewAsOrgState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.organization_id) return parsed as ViewAsOrgState;
  } catch {
    // corrupt entry — clear it
    sessionStorage.removeItem(STORAGE_KEY);
  }
  return null;
}

function setViewAsOrgState(state: ViewAsOrgState | null) {
  if (state) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } else {
    sessionStorage.removeItem(STORAGE_KEY);
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

/**
 * Begin view-as session: posts the audit-log row on the backend, then
 * stores the active org in sessionStorage so the banner renders.
 */
export async function beginViewAsOrg(org: { id: string; name: string }): Promise<void> {
  await api.post(`/api/admin/view-as-org/${org.id}`);
  setViewAsOrgState({ organization_id: org.id, organization_name: org.name });
}

/**
 * End view-as session: posts the audit-log row, then clears the banner.
 *
 * Local UI state is ALWAYS cleared (banner disappears) so the user can
 * never get stuck in a stale view-as mode. If the backend DELETE fails
 * (audit row not written), the error is rethrown so the caller can show
 * an accurate toast — otherwise the success path is misleading.
 */
export async function endViewAsOrg(): Promise<void> {
  const current = getViewAsOrg();
  let backendError: unknown = null;
  if (current) {
    try {
      await api.delete(`/api/admin/view-as-org/${current.organization_id}`);
    } catch (err) {
      backendError = err;
    }
  }
  setViewAsOrgState(null);
  if (backendError) {
    throw backendError;
  }
}

/**
 * Subscribe to view-as state changes. Returns the unsubscribe handle.
 */
export function subscribeViewAsOrg(listener: () => void): () => void {
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
