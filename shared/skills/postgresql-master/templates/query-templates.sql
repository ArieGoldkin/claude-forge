-- Common Acme Platform Query Templates
-- Use these as starting points for common operations

-- =============================================================================
-- USER QUERIES
-- =============================================================================

-- Get active users with subscriptions
SELECT u.id, u.email, u.first_name, u.last_name, s.plan_type, s.end_date
FROM acme_models.users u
JOIN acme_models.subscriptions s ON u.id = s.user_id
WHERE u.status = 'active'
  AND s.status = 'active'
  AND s.end_date > CURRENT_DATE
ORDER BY u.created_at DESC;

-- Find users by email pattern
SELECT id, email, first_name, last_name, created_at
FROM acme_models.users
WHERE email ILIKE :email_pattern  -- e.g., '%@example.com'
ORDER BY created_at DESC
LIMIT 100;

-- Get user profile with latest activity
SELECT
    u.id,
    u.email,
    u.first_name,
    u.last_name,
    u.status,
    MAX(e.created_at) AS last_activity_at,
    COUNT(DISTINCT ua.activity_id) AS actions_started
FROM acme_models.users u
LEFT JOIN acme_models.events e ON u.id = e.user_id
LEFT JOIN acme_models.user_activities ua ON u.id = ua.user_id
WHERE u.id = :user_id
GROUP BY u.id, u.email, u.first_name, u.last_name, u.status;

-- =============================================================================
-- SUBSCRIPTION QUERIES
-- =============================================================================

-- Find expiring subscriptions (next 30 days)
SELECT
    u.email,
    u.first_name,
    u.last_name,
    s.plan_type,
    s.end_date,
    s.auto_renew
FROM acme_models.subscriptions s
JOIN acme_models.users u ON s.user_id = u.id
WHERE s.status = 'active'
  AND s.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
ORDER BY s.end_date ASC;

-- Subscription status breakdown
SELECT
    status,
    COUNT(*) AS count,
    COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () AS percentage
FROM acme_models.subscriptions
GROUP BY status
ORDER BY count DESC;

-- =============================================================================
-- ACTIVITY TRACKING
-- =============================================================================

-- User activity by category
SELECT
    c.name AS category,
    COUNT(DISTINCT ua.activity_id) AS actions_started,
    COUNT(ua.first_completion_at) AS actions_completed,
    ROUND(
        COUNT(ua.first_completion_at) * 100.0 / NULLIF(COUNT(DISTINCT ua.activity_id), 0),
        1
    ) AS completion_percentage
FROM acme_models.user_activities ua
JOIN acme_models.actions a ON ua.activity_id = a.id
JOIN acme_models.categories c ON a.category_id = c.id
WHERE ua.user_id = :user_id
GROUP BY c.id, c.name
ORDER BY completion_percentage DESC;

-- Most popular actions
SELECT
    a.title,
    c.name AS category,
    COUNT(DISTINCT ua.user_id) AS unique_users,
    COUNT(ua.first_completion_at) AS completions
FROM acme_models.actions a
JOIN acme_models.categories c ON a.category_id = c.id
LEFT JOIN acme_models.user_activities ua ON a.id = ua.activity_id
GROUP BY a.id, a.title, c.name
ORDER BY unique_users DESC
LIMIT 20;

-- =============================================================================
-- STAFF QUERIES
-- =============================================================================

-- Staff workload and capacity
SELECT
    c.id,
    c.first_name,
    c.last_name,
    c.max_users,
    COUNT(DISTINCT u.id) AS active_users,
    c.max_users - COUNT(DISTINCT u.id) AS available_capacity,
    COUNT(DISTINCT a.id) FILTER (
        WHERE a.status = 'scheduled' AND a.scheduled_at > CURRENT_TIMESTAMP
    ) AS upcoming_appointments
FROM acme_models.staff c
LEFT JOIN acme_models.users u
    ON c.id = u.staff_id AND u.status = 'active'
LEFT JOIN acme_models.appointments a
    ON c.id = a.staff_id
WHERE c.is_active = true
GROUP BY c.id, c.first_name, c.last_name, c.max_users
ORDER BY available_capacity DESC;

-- Staff notes summary for user
SELECT
    n.id,
    n.note_type,
    n.content,
    n.created_at,
    c.first_name AS staff_first_name,
    c.last_name AS staff_last_name
FROM acme_models.notes n
JOIN acme_models.staff c ON n.staff_id = c.id
WHERE n.user_id = :user_id
ORDER BY n.created_at DESC
LIMIT 10;

-- =============================================================================
-- EVENTS AND ANALYTICS
-- =============================================================================

-- User engagement timeline (last 30 days)
SELECT
    DATE_TRUNC('day', created_at) AS date,
    event_type,
    COUNT(*) AS event_count
FROM acme_models.events
WHERE user_id = :user_id
  AND created_at > CURRENT_DATE - INTERVAL '30 days'
GROUP BY date, event_type
ORDER BY date DESC, event_count DESC;

-- Daily active users
SELECT
    DATE(created_at) AS date,
    COUNT(DISTINCT user_id) AS unique_users
FROM acme_models.events
WHERE event_type = 'login'
  AND created_at > CURRENT_DATE - INTERVAL '30 days'
GROUP BY date
ORDER BY date DESC;

-- Event type distribution
SELECT
    event_type,
    COUNT(*) AS count,
    COUNT(DISTINCT user_id) AS unique_users,
    MIN(created_at) AS first_occurrence,
    MAX(created_at) AS last_occurrence
FROM acme_models.events
WHERE created_at > CURRENT_DATE - INTERVAL '7 days'
GROUP BY event_type
ORDER BY count DESC;

-- =============================================================================
-- APPOINTMENTS
-- =============================================================================

-- Upcoming appointments for a staff member
SELECT
    a.id,
    a.scheduled_at,
    a.duration,
    u.first_name AS user_first_name,
    u.last_name AS user_last_name,
    u.email AS user_email,
    a.meeting_link
FROM acme_models.appointments a
JOIN acme_models.users u ON a.user_id = u.id
WHERE a.staff_id = :staff_id
  AND a.status = 'scheduled'
  AND a.scheduled_at > CURRENT_TIMESTAMP
ORDER BY a.scheduled_at ASC;

-- Appointment completion rate by staff member
SELECT
    c.first_name,
    c.last_name,
    COUNT(*) AS total_appointments,
    COUNT(*) FILTER (WHERE a.status = 'completed') AS completed,
    COUNT(*) FILTER (WHERE a.status = 'no-show') AS no_shows,
    ROUND(
        COUNT(*) FILTER (WHERE a.status = 'completed') * 100.0 / COUNT(*),
        1
    ) AS completion_rate
FROM acme_models.appointments a
JOIN acme_models.staff c ON a.staff_id = c.id
WHERE a.scheduled_at > CURRENT_DATE - INTERVAL '90 days'
GROUP BY c.id, c.first_name, c.last_name
ORDER BY completion_rate DESC;

-- =============================================================================
-- DATA QUALITY CHECKS
-- =============================================================================

-- Find users without subscriptions
SELECT u.id, u.email, u.status, u.created_at
FROM acme_models.users u
LEFT JOIN acme_models.subscriptions s ON u.id = s.user_id
WHERE s.id IS NULL;

-- Find orphaned records (user_activities without users)
SELECT ua.id, ua.user_id, ua.activity_id
FROM acme_models.user_activities ua
LEFT JOIN acme_models.users u ON ua.user_id = u.id
WHERE u.id IS NULL;

-- Detect duplicate emails
SELECT email, COUNT(*) AS count
FROM acme_models.users
GROUP BY email
HAVING COUNT(*) > 1;

-- =============================================================================
-- PERFORMANCE QUERIES
-- =============================================================================

-- Table sizes
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS indexes_size
FROM pg_tables
WHERE schemaname = 'acme_models'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Index usage statistics
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'acme_models'
ORDER BY idx_scan DESC;
