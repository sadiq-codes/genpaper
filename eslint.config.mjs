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
