import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import raycastPlugin from "@raycast/eslint-plugin";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "raycast-env.d.ts"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "@raycast": raycastPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@raycast/prefer-title-case": "warn",
    },
  },
];

