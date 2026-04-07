/**
 * Whether a leave row should block availability / assignments.
 * - APPROVED: blocks
 * - PENDING / REJECTED: does not block
 * - Missing status (legacy DB): treat as approved so old rows still behave.
 */
export function isBlockingApprovedLeave(row: { status?: string | null }): boolean {
    const raw = row?.status;
    if (raw == null || String(raw).trim() === '') return true;
    const s = String(raw).toUpperCase();
    if (s === 'REJECTED' || s === 'PENDING') return false;
    return s === 'APPROVED';
}
