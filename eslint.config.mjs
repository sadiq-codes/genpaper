import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Module boundary enforcement
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            // R0.2: CI check to prevent zombie flag usage
            {
              group: [
                // Removed/merged flags. Any reference should fail lint.
                "**/GENPIPE_UNIFIED_CITATIONS**",
                "**/Genpipe_Unified_Citations**",
                "**/genpipe_unified_citations**"
              ],
              message: "GENPIPE_UNIFIED_CITATIONS has been removed. Use CITATIONS_UNIFIED (now default path)"
            },
            {
              group: ["@/lib/db/*"],
              message: "Direct database imports are not allowed. Use @/services/* instead."
            },
            {
              group: ["@/lib/supabase/client", "@/lib/supabase/server"],
              message: "Direct Supabase client imports are not allowed outside services. Use @/services/* instead."
            }
          ],
          paths: [
            {
              name: "@/lib/supabase/client",
              message: "Use @/services/* instead of direct database access"
            },
            {
              name: "@/lib/supabase/server", 
              message: "Use @/services/* instead of direct database access"
            }
          ]
        }
      ]
    }
  },
  {
    // Specific rules for app directory (UI components)
    files: ["app/**/*"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            // R0.2 in app directory, too
            {
              group: [
                "**/GENPIPE_UNIFIED_CITATIONS**",
                "**/Genpipe_Unified_Citations**",
                "**/genpipe_unified_citations**"
              ],
              message: "GENPIPE_UNIFIED_CITATIONS has been removed. Use CITATIONS_UNIFIED (now default path)"
            },
            {
              group: ["@/lib/db/*", "@/lib/supabase/*"],
              message: "App components should only import from @/services/* for data access"
            }
          ]
        }
      ]
    }
  },
  {
    // Specific rules for components directory  
    files: ["components/**/*"],
    rules: {
      "no-restricted-imports": [
        "error", 
        {
          patterns: [
            // R0.2 in components, too
            {
              group: [
                "**/GENPIPE_UNIFIED_CITATIONS**",
                "**/Genpipe_Unified_Citations**",
                "**/genpipe_unified_citations**"
              ],
              message: "GENPIPE_UNIFIED_CITATIONS has been removed. Use CITATIONS_UNIFIED (now default path)"
            },
            {
              group: ["@/lib/db/*", "@/lib/supabase/*"],
              message: "Components should only import from @/services/* for data access"
            }
          ]
        }
      ]
    }
  }
];

export default eslintConfig;
