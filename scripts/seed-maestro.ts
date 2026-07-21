import { PrismaClient, RolValue } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { hashPassword } from "@/lib/utils/password";
import { getPrismaClient } from "@/lib/db/prisma-client";

// Bootstrap del usuario `maestro`, la cuenta desde la que arranca toda la
// operacion. Reemplaza al usuario que sembraba la migracion
// `20260709120000_seed_maestro_user`, cuyo hash bcrypt vivia HARDCODEADO en el
// repositorio (credencial de privilegio total conocida por cualquiera con
// acceso al codigo). Aqui la credencial llega por entorno y nunca se versiona.
//
// Uso:
//   MAESTRO_EMAIL=admin@ordenex.co MAESTRO_PASSWORD='...' pnpm db:seed:maestro
//
// Es idempotente y sirve tambien para ROTAR la contrasena: si el email ya
// existe, actualiza el hash y reactiva la cuenta.

/** Longitud minima exigida a la contrasena del maestro. */
export const MAESTRO_PASSWORD_MIN_LENGTH = 12;

export interface MaestroInput {
  email: string;
  password: string;
  nombre: string;
  telefono: string;
  cedula: string;
}

/**
 * Lee la configuracion del maestro desde `process.env`. Lanza con un mensaje
 * accionable si falta algo: preferimos fallar ruidosamente a crear una cuenta
 * de privilegio total con valores adivinados.
 */
export function readMaestroInput(env: NodeJS.ProcessEnv): MaestroInput {
  const email = env.MAESTRO_EMAIL?.trim();
  const password = env.MAESTRO_PASSWORD;

  if (!email) {
    throw new Error(
      "Falta MAESTRO_EMAIL. Ej: MAESTRO_EMAIL=admin@ordenex.co pnpm db:seed:maestro"
    );
  }
  if (!email.includes("@")) {
    throw new Error(`MAESTRO_EMAIL no parece un email valido: ${email}`);
  }
  if (!password) {
    throw new Error(
      "Falta MAESTRO_PASSWORD. No se usa un valor por defecto a proposito: " +
        "una contrasena por defecto es exactamente el problema que este script resuelve."
    );
  }
  if (password.length < MAESTRO_PASSWORD_MIN_LENGTH) {
    throw new Error(
      `MAESTRO_PASSWORD debe tener al menos ${MAESTRO_PASSWORD_MIN_LENGTH} caracteres.`
    );
  }

  return {
    email,
    password,
    nombre: env.MAESTRO_NOMBRE?.trim() || "Maestro Ordenex",
    telefono: env.MAESTRO_TELEFONO?.trim() || "0999999999",
    cedula: env.MAESTRO_CEDULA?.trim() || "1700000001",
  };
}

/**
 * Crea o actualiza el usuario maestro. Idempotente por email: si ya existe,
 * rota el hash y reactiva la cuenta sin tocar su `id` ni sus relaciones.
 * Recibe el cliente Prisma por parametro para poder testear sin conexion real
 * (mismo patron que `seed-catalogos.ts`).
 */
export async function seedMaestro(
  prisma: Pick<PrismaClient, "rol" | "tipoIdentificacion" | "usuario">,
  input: MaestroInput
): Promise<void> {
  // Prerequisitos de catalogo: los siembra `pnpm db:seed`. Si faltan, avisamos
  // en vez de estallar con un error de FK ilegible.
  const rolMaestro = await prisma.rol.findUnique({
    where: { value: RolValue.maestro },
  });
  if (!rolMaestro) {
    throw new Error("No existe el rol 'maestro'. Corre primero `pnpm db:seed`.");
  }

  const tipoCedula = await prisma.tipoIdentificacion.findUnique({
    where: { value: "cedula" },
  });
  if (!tipoCedula) {
    throw new Error(
      "No existe el tipo_identificacion 'cedula'. Corre primero `pnpm db:seed`."
    );
  }

  const passwordHash = await hashPassword(input.password);

  await prisma.usuario.upsert({
    where: { email: input.email },
    update: {
      passwordHash,
      estado: "activo",
      rolId: rolMaestro.id,
    },
    create: {
      nombre: input.nombre,
      email: input.email,
      telefono: input.telefono,
      passwordHash,
      estado: "activo",
      cedula: input.cedula,
      tipoIdentificacionId: tipoCedula.id,
      rolId: rolMaestro.id,
    },
  });
}

async function main(): Promise<void> {
  // Prisma 7 no auto-carga el .env y este script corre por `tsx`, no por el CLI
  // de Prisma: sin esto `DATABASE_URL` llega undefined a `getPrismaClient()`.
  try {
    process.loadEnvFile();
  } catch {
    // sin .env: se usan las variables ya presentes en process.env
  }

  const input = readMaestroInput(process.env);
  const prisma = getPrismaClient();
  try {
    await seedMaestro(prisma, input);
    // Nunca se loguea la contrasena, solo el email afectado.
    console.log(`Usuario maestro listo: ${input.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

// Solo auto-ejecuta cuando este archivo es el entrypoint del proceso; si un
// test lo importa para ejercitar `seedMaestro`, `main()` NO se dispara.
const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error(
      "Fallo el bootstrap del maestro:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  });
}
