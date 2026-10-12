import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "**/*.d.ts",
    ],
  },
  // Presets de TypeScript e React/Next (eslint-config-next agrega
  // @next/eslint-plugin-next, eslint-plugin-react e eslint-plugin-react-hooks).
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
