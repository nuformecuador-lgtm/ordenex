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

// El CLI de Prisma (`migrate deploy`, `studio`) necesita una conexión en modo
// SESIÓN: `migrate deploy` toma un advisory lock, que vive en la sesión y no
// sobrevive al pooler transaccional. El runtime necesita lo contrario — el
// pooler transaccional (`:6543`), porque en modo sesión cada instancia de
// Vercel retiene sus conexiones y agota el pool del proyecto (ver
// `lib/db/prisma-client.ts`). Son dos necesidades incompatibles, así que van en
// dos variables:
//   - DIRECT_URL   → pooler en modo sesión (`:5432`). Solo el CLI.
//   - DATABASE_URL → pooler transaccional (`:6543`). Solo el runtime.
// Sin DIRECT_URL se cae a DATABASE_URL: en local no hay pooler y una sola URL
// sirve para ambas cosas.
const URL_MIGRACIONES = process.env.DIRECT_URL ? "DIRECT_URL" : "DATABASE_URL";

export default defineConfig({
  schema: "db/schema.prisma",
  datasource: {
    url: env(URL_MIGRACIONES),
  },
});
