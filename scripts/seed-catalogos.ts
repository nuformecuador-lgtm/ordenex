import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { ROLES_SEED } from "@/lib/types/roles";

const TIPOS_IDENTIFICACION = ["cedula", "ruc", "pasaporte"] as const;

// Siembra idempotente de los tipos de identificacion. Recibe el cliente Prisma
// por parametro para poder testear la logica sin instanciar la conexion real.
export async function seedTiposIdentificacion(
  prisma: Pick<PrismaClient, "tipoIdentificacion">
): Promise<void> {
  for (const value of TIPOS_IDENTIFICACION) {
    await prisma.tipoIdentificacion.upsert({
      where: { value },
      update: {},
      create: { value },
    });
  }
}

// Siembra idempotente de los roles. Itera `ROLES_SEED` (fuente unica de verdad
// derivada del enum `RolValue`), sin lista literal duplicada y sin sembrar
// 'usuario' (R11). El upsert por `value` conserva la fila y su `id` si ya
// existe (R9, R10) y no borra ni toca otras tablas (R12).
export async function seedRoles(
  prisma: Pick<PrismaClient, "rol">
): Promise<void> {
  for (const value of ROLES_SEED) {
    await prisma.rol.upsert({
      where: { value },
      update: {},
      create: { value },
    });
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedTiposIdentificacion(prisma);
    await seedRoles(prisma);
    console.log("Seed de catalogos completado (tipo_identificacion, rol).");
  } finally {
    await prisma.$disconnect();
  }
}

// Solo auto-ejecuta el seed cuando este archivo es el entrypoint del proceso
// (p. ej. `pnpm db:seed` -> `tsx scripts/seed-catalogos.ts`). Cuando un test lo
// importa para ejercitar `seedRoles`, `main()` NO se dispara.
const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error("Fallo el seed de catalogos:", error);
    process.exit(1);
  });
}
