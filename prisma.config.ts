import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "db/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
