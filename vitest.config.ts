import { defineConfig } from "vitest/config";

// Integration tests spin up real Miniflare D1 instances and drive the Worker
// handler end-to-end. Those are heavier than unit tests, so we run files
// serially and give generous timeouts for workerd startup / push retries.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    // keep integration output readable
    reporters: ["dot"],
  },
});
