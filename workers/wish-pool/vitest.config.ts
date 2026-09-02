import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const communityMigrations = await readD1Migrations("./migrations");

export default defineConfig({
  define: { __COMMUNITY_MIGRATIONS__: JSON.stringify(communityMigrations) },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          WISH_ADMIN_PASSWORD: "test-admin-password",
          WISH_SIGNING_SECRET: "test-signing-secret-with-sufficient-length",
        },
      },
    }),
  ],
  test: { testTimeout: 20_000 },
});
