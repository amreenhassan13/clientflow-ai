-- Replace PROJECT_ID.DATASET with your project and dataset, then run in the BigQuery console.

-- 1. Deduplicated view. A batch can be loaded twice if marking it exported
--    fails after a successful load; this keeps one row per event_id.
CREATE OR REPLACE VIEW `PROJECT_ID.DATASET.clean_events` AS
SELECT * EXCEPT (rn)
FROM (
  SELECT e.*, ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY occurred_at) AS rn
  FROM `PROJECT_ID.DATASET.events` AS e
)
WHERE rn = 1;

-- 2. Daily activity by source.
SELECT
  DATE(occurred_at) AS day,
  source,
  COUNTIF(event_type = 'lead_created') AS leads_created,
  COUNTIF(event_type = 'hubspot_synced') AS hubspot_syncs,
  COUNTIF(event_type = 'sms_welcome_delivered') AS sms_delivered
FROM `PROJECT_ID.DATASET.clean_events`
WHERE occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY day, source
ORDER BY day DESC, leads_created DESC;

-- 3. Funnel by unique lead (lead_ref is a pseudonymous hash, not the lead id).
SELECT
  COUNT(DISTINCT IF(event_type = 'lead_created', lead_ref, NULL)) AS created,
  COUNT(DISTINCT IF(event_type = 'lead_qualified', lead_ref, NULL)) AS qualified,
  COUNT(DISTINCT IF(event_type = 'lead_won', lead_ref, NULL)) AS won,
  COUNT(DISTINCT IF(event_type = 'survey_completed', lead_ref, NULL)) AS surveyed
FROM `PROJECT_ID.DATASET.clean_events`;
