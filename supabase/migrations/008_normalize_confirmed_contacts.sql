-- Backfill only the two previously verified mybiz-line contacts.
-- The row IDs, user ownership, and old phone values are guarded. No rows are merged/deleted.
DO $$
DECLARE
  v_user_id uuid;
  v_target_count integer;
  v_tenant_count integer;
  v_owned_count integer;
  v_collision_count integer;
  v_expected_updates integer;
  v_updated_count integer;
BEGIN
  SELECT count(*), count(DISTINCT user_id), count(user_id), min(user_id::text)::uuid
    INTO v_target_count, v_tenant_count, v_owned_count, v_user_id
  FROM public.biz_contacts
  WHERE (id = 'fb76abc5-90fd-4240-885f-c06bb10cf6b3'::uuid
         AND phone IN ('8165357923', '+18165357923'))
     OR (id = 'f163daf3-c2f5-4519-9a24-de0989fbd610'::uuid
         AND phone IN ('8168488287', '+18168488287'));

  IF v_target_count <> 2 OR v_tenant_count <> 1 OR v_owned_count <> 2 OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'Expected exactly the two previously verified contacts under one owner; no rows updated';
  END IF;

  -- Recheck same-owner canonical collisions immediately before the update.
  WITH targets(id, canonical_phone) AS (
    VALUES
      ('fb76abc5-90fd-4240-885f-c06bb10cf6b3'::uuid, '+18165357923'::text),
      ('f163daf3-c2f5-4519-9a24-de0989fbd610'::uuid, '+18168488287'::text)
  ), existing AS (
    SELECT id, user_id,
      CASE
        WHEN length(digits) = 10 AND substring(digits from 1 for 1) BETWEEN '2' AND '9'
          AND substring(digits from 4 for 1) BETWEEN '2' AND '9' THEN '+1' || digits
        WHEN length(digits) = 11 AND left(digits, 1) = '1'
          AND substring(digits from 2 for 1) BETWEEN '2' AND '9'
          AND substring(digits from 5 for 1) BETWEEN '2' AND '9' THEN '+' || digits
        WHEN left(phone, 1) = '+' AND length(digits) BETWEEN 8 AND 15 THEN '+' || digits
        ELSE NULL
      END AS canonical_phone
    FROM (
      SELECT id, user_id, phone,
        regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') AS digits
      FROM public.biz_contacts
      WHERE user_id = v_user_id
    ) numbers
  )
  SELECT count(*) INTO v_collision_count
  FROM targets t
  JOIN existing e ON e.canonical_phone = t.canonical_phone
                 AND e.id <> t.id
  WHERE e.id NOT IN (
    'fb76abc5-90fd-4240-885f-c06bb10cf6b3'::uuid,
    'f163daf3-c2f5-4519-9a24-de0989fbd610'::uuid
  );

  IF v_collision_count <> 0 THEN
    RAISE EXCEPTION 'Canonical phone collision found in the existing owner scope; no rows updated';
  END IF;

  SELECT count(*) INTO v_expected_updates
  FROM public.biz_contacts
  WHERE user_id = v_user_id
    AND ((id = 'fb76abc5-90fd-4240-885f-c06bb10cf6b3'::uuid AND phone = '8165357923')
      OR (id = 'f163daf3-c2f5-4519-9a24-de0989fbd610'::uuid AND phone = '8168488287'));

  UPDATE public.biz_contacts
  SET phone = CASE id
    WHEN 'fb76abc5-90fd-4240-885f-c06bb10cf6b3'::uuid THEN '+18165357923'
    WHEN 'f163daf3-c2f5-4519-9a24-de0989fbd610'::uuid THEN '+18168488287'
  END
  WHERE user_id = v_user_id
    AND ((id = 'fb76abc5-90fd-4240-885f-c06bb10cf6b3'::uuid AND phone = '8165357923')
      OR (id = 'f163daf3-c2f5-4519-9a24-de0989fbd610'::uuid AND phone = '8168488287'));
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> v_expected_updates THEN
    RAISE EXCEPTION 'Target contacts changed during migration; rolling back';
  END IF;
END $$;
