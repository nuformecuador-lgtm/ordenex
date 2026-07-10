import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { ROLES_SEED } from "@/lib/types/roles";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { VEHICULOS_SEED } from "@/lib/types/vehiculos";
import { getPrismaClient } from "@/lib/db/prisma-client";

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

// Siembra idempotente de los estatus de orden (R2, R3). Itera ORDER_STATUS_SEED
// (fuente unica de verdad en TS) con upsert por `value`: conserva la fila y su
// `id` si ya existe, sin duplicar (patron seedRoles). La geografia NO se siembra
// (R4). Recibe el cliente Prisma por parametro para testear sin conexion real.
export async function seedOrderStatus(
  prisma: Pick<PrismaClient, "orderStatus">
): Promise<void> {
  for (const value of ORDER_STATUS_SEED) {
    await prisma.orderStatus.upsert({
      where: { value },
      update: {},
      create: { value },
    });
  }
}

// Siembra idempotente del catalogo de vehiculos (feature 50, R7/R8). Itera
// VEHICULOS_SEED (fuente unica de verdad derivada del enum VehiculoValue) con
// upsert por `name` (OJO: `name`, NO `value` como los demas catalogos): conserva
// la fila y su `id` si ya existe, sin duplicar ni tocar otras tablas. Recibe el
// cliente Prisma por parametro para testear sin conexion real.
export async function seedVehiculos(
  prisma: Pick<PrismaClient, "vehiculo">
): Promise<void> {
  for (const name of VEHICULOS_SEED) {
    await prisma.vehiculo.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
}

async function main(): Promise<void> {
  // Prisma 7 no auto-carga el .env; ese loadEnvFile solo lo hace el CLI de
  // Prisma via `prisma.config.ts`. Este script corre por `tsx`, no por el CLI,
  // asi que sin esto `process.env.DATABASE_URL` llega undefined a
  // `getPrismaClient()` y `PrismaPg` se construye sin connectionString.
  try {
    process.loadEnvFile();
  } catch {
    // sin .env: se usan las variables ya presentes en process.env
  }

  const prisma = getPrismaClient();
  try {
    await seedTiposIdentificacion(prisma);
    await seedRoles(prisma);
    await seedOrderStatus(prisma);
    await seedVehiculos(prisma);
    console.log(
      "Seed de catalogos completado (tipo_identificacion, rol, order_status, vehiculos)."
    );
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
