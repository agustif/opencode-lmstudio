import js from "@eslint/js"
import tsPlugin from "@typescript-eslint/eslint-plugin"
import tsParser from "@typescript-eslint/parser"

export default [
  {
    ignores: ["dist/**", "node_modules/**", "*.js"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.ts", "tui-test.config.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        AbortSignal: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "no-console": "warn",
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-var": "error",
      "prefer-const": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
]
