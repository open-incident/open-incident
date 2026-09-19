-- The catalog was removed from the product in 0029, and it was still in the
-- data: `services.seen_in` is the list a service page prints under "SEEN IN",
-- and on an instance that had filled a catalog by hand it prints the word.
--
-- Dropping the element is all there is to do. The list is a set of place names
-- with no meaning of its own, and a service that was only ever seen there ends
-- up with an empty list — which is the truth: nothing observes it any more.
UPDATE "app"."services"
SET "seen_in" = COALESCE(
  (SELECT jsonb_agg(v) FROM jsonb_array_elements_text("seen_in") AS v WHERE v <> 'catalog'),
  '[]'::jsonb
)
WHERE "seen_in" @> '["catalog"]'::jsonb;
