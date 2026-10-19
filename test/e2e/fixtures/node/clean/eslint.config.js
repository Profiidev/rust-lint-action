import js from "@eslint/js";

export default [
  { ignores: ["**/*.ts", "**/*.svelte"] },
  js.configs.recommended,
  { rules: { "prefer-const": "error" } },
];
