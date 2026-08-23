import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      // Unit tests exercise the print transport + fixtures only.
      AGY_TRANSPORT: "print",
    },
  },
});
