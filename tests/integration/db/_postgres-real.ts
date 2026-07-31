import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PRISMA_OMIT } from "@/lib/db/prisma-client";

/**
 * Feature 169 — utilidades para los pocos tests que NECESITAN un Postgres de verdad.
 *
 * Por que hacen falta: casi toda `tests/integration/db/**` verifica migraciones por REGEX
 * sobre el SQL, y para lo de esta feature eso no alcanza. Que `num_guia::text` sea
 * admisible en una columna generada, que `extensions.gin_trgm_ops` resuelva, y sobre todo
 * que la normalizacion de Postgres y la de Node produzcan EL MISMO texto, son hechos del
 * motor: una regex no puede demostrarlos y una aserción de código todavía menos.
 *
 * NO es un archivo de test (no acaba en `.test.ts`): vitest no lo recoge.
 *
 * Si no hay base alcanzable, los tests que dependen de esto se SALTAN (no fallan): la
 * suite tiene que seguir siendo verde en una maquina sin Postgres levantado.
 */

/** `DATABASE_URL`, cargando `.env` si el proceso no la trae (vitest no lo lee solo). */
export function urlDeBaseDeDatos(): string | undefined {
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile();
    } catch {
      // sin .env: se usa lo que ya haya en process.env
    }
  }
  return process.env.DATABASE_URL;
}

export const HAY_BASE_DE_DATOS = urlDeBaseDeDatos() !== undefined;

/**
 * Cliente propio del test, con el MISMO `omit` global que produccion: los tests de R28 no
 * valdrian nada si el cliente del test estuviera configurado distinto al real.
 */
export function crearPrismaDeTest(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: urlDeBaseDeDatos(), max: 2 }),
    omit: PRISMA_OMIT,
  }) as unknown as PrismaClient;
}

/** Portador del valor: se lanza para forzar el ROLLBACK sin perder lo que se calculo. */
class Revertir extends Error {
  constructor(readonly valor: unknown) {
    super("rollback deliberado del test");
    this.name = "Revertir";
  }
}

/**
 * Ejecuta `fn` dentro de una transaccion que SIEMPRE se revierte, y devuelve lo que `fn`
 * calculo. Es la unica forma honesta de insertar ordenes de prueba en la base de
 * desarrollo: si el test pasa, si falla o si el proceso muere a mitad, no queda ni una
 * fila. Un `afterAll` que borre lo insertado no da esa garantia (no corre si el runner se
 * cae, y borra por un criterio que hay que mantener a mano).
 */
export async function enTransaccionRevertida<T>(
  prisma: PrismaClient,
  fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  try {
    await prisma.$transaction(
      async (tx) => {
        throw new Revertir(await fn(tx));
      },
      { timeout: 30_000, maxWait: 15_000 },
    );
  } catch (error) {
    if (error instanceof Revertir) return error.valor as T;
    throw error;
  }
  throw new Error("la transaccion termino sin revertirse: imposible");
}

/** FKs obligatorias de `orden`, tomadas de una fila existente. `null` si la tabla esta vacia. */
export interface FksDeOrden {
  estatusId: string;
  tiendaId: string;
  zonaId: string;
  provinciaId: string;
  cantonId: string;
}

export async function fksDeOrden(prisma: PrismaClient): Promise<FksDeOrden | null> {
  const fila = await prisma.orden.findFirst({
    select: {
      estatusId: true,
      tiendaId: true,
      zonaId: true,
      provinciaId: true,
      cantonId: true,
    },
  });
  return fila ?? null;
}
