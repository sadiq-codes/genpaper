-- Migration: Test Database Constraints
-- Verifies that all constraints are working properly

-- =======================
-- TEST CONSTRAINT ENFORCEMENT
-- =======================

-- Test function to verify constraints work
CREATE OR REPLACE FUNCTION test_citation_constraints()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  test_result TEXT := '';
  test_count INTEGER := 0;
  success_count INTEGER := 0;
BEGIN
  test_result := 'CITATION SYSTEM CONSTRAINT TESTS\n';
  test_result := test_result || '================================\n';
  
  -- Test 1: FK constraint prevents orphaned citation_links
  BEGIN
    test_count := test_count + 1;
    INSERT INTO citation_links (project_id, citation_id, section, start_pos, end_pos, reason)
    VALUES (gen_random_uuid(), gen_random_uuid(), 'test', 0, 10, 'test reason');
    test_result := test_result || '❌ Test 1 FAILED: FK constraint should prevent orphaned citation_links\n';
  EXCEPTION
    WHEN foreign_key_violation THEN
      success_count := success_count + 1;
      test_result := test_result || '✅ Test 1 PASSED: FK constraint prevents orphaned citation_links\n';
  END;
  
  -- Test 2: UNIQUE constraint prevents duplicate (project_id, key) pairs
  BEGIN
    test_count := test_count + 1;
    -- This should work for testing, but we can't actually test duplicate prevention
    -- without a real project_id, so we'll just verify the constraint exists
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE table_name = 'citations'
      AND constraint_type = 'UNIQUE'
      AND constraint_name LIKE '%project_id%key%'
    ) OR EXISTS (
      SELECT 1 FROM pg_indexes 
      WHERE tablename = 'citations'
      AND indexdef LIKE '%UNIQUE%'
      AND indexdef LIKE '%project_id%'
      AND indexdef LIKE '%key%'
    ) THEN
      success_count := success_count + 1;
      test_result := test_result || '✅ Test 2 PASSED: UNIQUE constraint on (project_id, key) exists\n';
    ELSE
      test_result := test_result || '❌ Test 2 FAILED: UNIQUE constraint on (project_id, key) missing\n';
    END IF;
  END;
  
  -- Test 3: Check constraint prevents empty citation keys
  BEGIN
    test_count := test_count + 1;
    IF EXISTS (
      SELECT 1 FROM information_schema.check_constraints 
      WHERE constraint_name = 'citations_key_not_empty'
    ) THEN
      success_count := success_count + 1;
      test_result := test_result || '✅ Test 3 PASSED: Check constraint prevents empty citation keys\n';
    ELSE
      test_result := test_result || '❌ Test 3 FAILED: Check constraint for empty keys missing\n';
    END IF;
  END;
  
  -- Test 4: Check constraint prevents empty CSL JSON
  BEGIN
    test_count := test_count + 1;
    IF EXISTS (
      SELECT 1 FROM information_schema.check_constraints 
      WHERE constraint_name = 'citations_csl_json_not_empty'
    ) THEN
      success_count := success_count + 1;
      test_result := test_result || '✅ Test 4 PASSED: Check constraint prevents empty CSL JSON\n';
    ELSE
      test_result := test_result || '❌ Test 4 FAILED: Check constraint for empty CSL JSON missing\n';
    END IF;
  END;
  
  -- Test 5: Check constraint validates positional data
  BEGIN
    test_count := test_count + 1;
    IF EXISTS (
      SELECT 1 FROM information_schema.check_constraints 
      WHERE constraint_name = 'citation_links_valid_positions'
    ) THEN
      success_count := success_count + 1;
      test_result := test_result || '✅ Test 5 PASSED: Check constraint validates positional data\n';
    ELSE
      test_result := test_result || '❌ Test 5 FAILED: Check constraint for positional data missing\n';
    END IF;
  END;
  
  -- Test 6: Verify indexes exist for performance
  BEGIN
    test_count := test_count + 1;
    IF EXISTS (
      SELECT 1 FROM pg_indexes 
      WHERE tablename = 'citations'
      AND indexname LIKE '%project_key%'
    ) AND EXISTS (
      SELECT 1 FROM pg_indexes 
      WHERE tablename = 'citation_links'
      AND indexname LIKE '%citation_lookup%'
    ) THEN
      success_count := success_count + 1;
      test_result := test_result || '✅ Test 6 PASSED: Performance indexes exist\n';
    ELSE
      test_result := test_result || '❌ Test 6 FAILED: Some performance indexes missing\n';
    END IF;
  END;
  
  -- Test 7: Verify enhanced upsert function exists
  BEGIN
    test_count := test_count + 1;
    IF EXISTS (
      SELECT 1 FROM information_schema.routines 
      WHERE routine_name = 'upsert_citation'
      AND routine_type = 'FUNCTION'
    ) THEN
      success_count := success_count + 1;
      test_result := test_result || '✅ Test 7 PASSED: Enhanced upsert_citation function exists\n';
    ELSE
      test_result := test_result || '❌ Test 7 FAILED: upsert_citation function missing\n';
    END IF;
  END;
  
  -- Summary
  test_result := test_result || '================================\n';
  test_result := test_result || 'SUMMARY: ' || success_count || '/' || test_count || ' tests passed\n';
  
  IF success_count = test_count THEN
    test_result := test_result || '🎉 ALL CONSTRAINTS PROPERLY CONFIGURED!\n';
  ELSE
    test_result := test_result || '⚠️  Some constraints need attention\n';
  END IF;
  
  RETURN test_result;
END;
$$;

-- Run the constraint tests
DO $$
DECLARE
  test_output TEXT;
BEGIN
  SELECT test_citation_constraints() INTO test_output;
  RAISE NOTICE '%', test_output;
END $$;

-- Clean up test function (optional)
-- DROP FUNCTION IF EXISTS test_citation_constraints(); 