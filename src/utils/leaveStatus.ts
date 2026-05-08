/**
 * Whether a leave row should block availability / assignments.
 * - APPROVED: blocks
 * - PENDING / REJECTED: does not block
 * - Missing status (legacy DB): do not block (strict approved-only behavior).
 */
export function isBlockingApprovedLeave(row: { status?: string | null }): boolean {
    const raw = row?.status;
    if (raw == null || String(raw).trim() === '') return false;
    const s = String(raw).toUpperCase();
    if (s === 'REJECTED' || s === 'PENDING' || s === 'CANCELLED' || s === 'CANCELED') return false;
    return s === 'APPROVED';
}
