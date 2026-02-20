-- 27_provider_analytics_indexes.sql
-- Optimizing queue_entry_services for high-performance analytics

-- 1. Index for task status to filter completed tasks
CREATE INDEX IF NOT EXISTS idx_qes_task_status ON public.queue_entry_services(task_status);

-- 2. Index for completed_at for range-based filtering (Daily/Weekly/Monthly)
CREATE INDEX IF NOT EXISTS idx_qes_completed_at ON public.queue_entry_services(completed_at DESC);

-- 3. Composite index for provider-level performance aggregation
CREATE INDEX IF NOT EXISTS idx_qes_provider_completion ON public.queue_entry_services(assigned_provider_id, task_status, completed_at);

-- 4. Index on service_id for breakdown reporting
CREATE INDEX IF NOT EXISTS idx_qes_service_id ON public.queue_entry_services(service_id);

-- 5. Comments
COMMENT ON INDEX idx_qes_task_status IS 'Optimizes status-based filtering for analytics';
COMMENT ON INDEX idx_qes_completed_at IS 'Optimizes date range filtering for provider performance reports';
COMMENT ON INDEX idx_qes_provider_completion IS 'Optimizes aggregation of completed services per provider';
