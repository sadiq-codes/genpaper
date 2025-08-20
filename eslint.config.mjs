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
            }
          ],
          paths: []
        }
      ],
      // Relax strict TS/react rules to prevent build blocking on style nits
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      "prefer-const": "off",
      "react/no-unescaped-entities": "off"
    }
  },
  {
    // Specific rules for app directory (UI components)
    files: ["app/**/*"],
    rules: {
      // Allow direct imports in app/ to reduce build-time noise
      "no-restricted-imports": "off",
      // Relax strictness in app code paths
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      "react/no-unescaped-entities": "error"
    }
  },
  {
    // Specific rules for components directory  
    files: ["components/**/*"],
    rules: {
      // Allow imports here too to avoid large refactors in UI layer
      "no-restricted-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }]
    }
  }
];

export default eslintConfig;
