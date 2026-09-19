-- The three choices a source carries become the source's own columns.
--
-- They lived in a route scoped to that source and carrying no condition,
-- created on the first change and slipped in just before the catch-all. It
-- worked and it lied twice: the choices appeared in the list of rules where
-- nobody had written them, and a rule written afterwards got a position after
-- that route, so it lost to the thing the screen calls an exception to it.
--
-- The backfill below moves every such route into its source, then deletes the
-- route — but only when it holds nothing the three columns cannot: a source
-- route that someone has since given its own grouping, priority, urgency or
-- test mode stays a rule, and keeps deciding, because it now says something
-- the source cannot.
ALTER TABLE "app"."alert_sources" ADD COLUMN IF NOT EXISTS "escalations" jsonb;--> statement-breakpoint
ALTER TABLE "app"."alert_sources" ADD COLUMN IF NOT EXISTS "incident_opens" text;--> statement-breakpoint
ALTER TABLE "app"."alert_sources" ADD COLUMN IF NOT EXISTS "auto_resolve" boolean;--> statement-breakpoint

-- Every conditionless route scoped to exactly one source.
CREATE TEMPORARY VIEW source_routes AS
SELECT r.*, r."source_ids" ->> 0 AS only_source
FROM "app"."alert_routes" r
WHERE jsonb_array_length(r."source_ids") = 1
  AND jsonb_array_length(r."filters") = 0
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(r."conditions") g
    WHERE jsonb_array_length(g -> 'all') > 0
  );--> statement-breakpoint

UPDATE "app"."alert_sources" s
SET
  -- `escalations` is the current shape; `escalation_mode` is what a route
  -- written before it meant, and the application still reads it that way.
  "escalations" = CASE
    WHEN jsonb_array_length(r."escalations") > 0 THEN r."escalations"
    WHEN r."escalation_mode" = 'static' AND r."escalation_path_id" IS NOT NULL
      THEN jsonb_build_array(jsonb_build_object('kind', 'path', 'pathId', r."escalation_path_id"))
    WHEN r."escalation_mode" = 'dynamic'
      THEN jsonb_build_array(jsonb_build_object(
        'kind', 'attribute', 'attribute', 'service', 'fallbackPathId', r."escalation_path_id"))
    ELSE '[]'::jsonb
  END,
  "incident_opens" = COALESCE(r."incident" ->> 'mode', r."incident_mode"),
  "auto_resolve" = r."resolve_closes_escalation"
    AND COALESCE((r."incident" ->> 'declineOnResolve')::boolean, true)
FROM source_routes r
WHERE s."id"::text = r.only_source AND s."tenant_id" = r."tenant_id";--> statement-breakpoint

-- The catch-all of each workspace: no source, no condition, first in order.
DELETE FROM "app"."alert_routes" a
USING source_routes r
LEFT JOIN LATERAL (
  SELECT c.* FROM "app"."alert_routes" c
  WHERE c."tenant_id" = r."tenant_id"
    AND jsonb_array_length(c."source_ids") = 0
    AND jsonb_array_length(c."filters") = 0
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(c."conditions") g
      WHERE jsonb_array_length(g -> 'all') > 0
    )
  ORDER BY c."position", c."created_at"
  LIMIT 1
) c ON true
WHERE a."id" = r."id"
  -- A workspace with no catch-all at all compares against the column defaults:
  -- that is what the source route was created with when it had nothing to
  -- clone from.
  AND r."grouping" IS NOT DISTINCT FROM c."grouping"
  AND r."priority_id" IS NOT DISTINCT FROM c."priority_id"
  AND r."urgency_override" IS NOT DISTINCT FROM c."urgency_override"
  AND r."incident_type_id" IS NOT DISTINCT FROM c."incident_type_id"
  AND r."test_mode" = COALESCE(c."test_mode", false)
  AND r."defer_minutes" = COALESCE(c."defer_minutes", 0);--> statement-breakpoint

DROP VIEW source_routes;
