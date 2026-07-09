import { defineConfig, env } from "prisma/config";

// Prisma 7 ya no carga el .env automáticamente: lo cargamos aquí con la
// utilidad nativa de Node (v20.12+) para que `env("DATABASE_URL")` se resuelva
// al correr el CLI (migrate, generate, studio). Si el .env no existe, se usan
// las variables ya presentes en process.env.
try {
  process.loadEnvFile();
} catch {
  // sin .env: se usan las variables ya presentes en process.env
}

export default defineConfig({
  schema: "db/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
