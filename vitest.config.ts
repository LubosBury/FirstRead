import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath, URL } from "node:url";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

// A throwaway Sign in with Apple key, so the Worker tests sign real client secrets.
const appleKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" });

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "app",
          include: ["src/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations("./migrations"),
                IMAGE_PROVIDER: "mock",
                APP_URL: "http://localhost",
                BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
                RESEND_API_KEY: "",
                OPENAI_API_KEY: "test-openai",
                GEMINI_API_KEY: "test-gemini",
                APPLE_CLIENT_ID: "com.example.firstread.web",
                APPLE_TEAM_ID: "TEAM123456",
                APPLE_KEY_ID: "KEY1234567",
                APPLE_PRIVATE_KEY: appleKey.toString(),
              },
            },
          })),
        ],
        test: {
          name: "worker",
          include: ["worker/**/*.test.ts"],
          setupFiles: ["./worker/test/apply-migrations.ts"],
        },
      },
    ],
  },
});
