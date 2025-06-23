CREATE OR REPLACE FUNCTION is_service_role()
RETURNS BOOLEAN
LANGUAGE sql STABLE AS
$$
  -- Supabase exposes the JWT claim `role` via auth.role().
  -- When the service key is used, auth.role() returns 'service_role'.
  SELECT auth.role() = 'service_role';
$$;

-- Ensure the service_role automatically sets the claim so the function above is deterministic.
ALTER ROLE service_role SET request.jwt.claim.role = 'service_role'; 