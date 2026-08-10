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

/**
 * Feature 196 — cliente cuyas consultas de MODELO (`prisma.x.create()`, `findUnique`, …) se
 * dirigen a `esquema` en vez de a `public`.
 *
 * POR QUE NO BASTA EL `search_path`: Prisma CUALIFICA la tabla en el SQL que genera
 * (`INSERT INTO "public"."ranking_snapshot_dia" …`). Medido, no supuesto: con un
 * `SET LOCAL search_path` a un esquema temporal, la API de modelo sigue yendo a `public` y
 * falla con P2021 «no existe la relacion public.ranking_snapshot_dia». El unico punto donde
 * ese prefijo se puede cambiar es `PrismaPgOptions.schema` del driver adapter, que es lo que
 * hace esta funcion.
 *
 * Para que sirve: probar el DDL REAL de una migracion —y el comportamiento del repositorio
 * que lo usa— por la API publica de Prisma, en un esquema desechable, SIN aplicar la
 * migracion a `public` ni tocar `_prisma_migrations`. Quien la use es responsable de crear
 * el esquema, de aplicar ahi el DDL y de soltarlo (`DROP SCHEMA … CASCADE`) al terminar.
 */
export function crearPrismaDeTestEnEsquema(esquema: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: urlDeBaseDeDatos(), max: 2 }, { schema: esquema }),
    omit: PRISMA_OMIT,
  }) as unknown as PrismaClient;
}

/**
 * Feature 169 / T4.2 — una consulta tal y como Prisma la mando al servidor.
 *
 * `params` viene serializado a JSON por Prisma y con los numericos convertidos a string;
 * `parametrosDe` lo devuelve a la forma que espera `$queryRawUnsafe`.
 */
export interface EventoSqlDeTest {
  query: string;
  params: string;
  duration: number;
}

export function parametrosDe(evento: EventoSqlDeTest): unknown[] {
  return (JSON.parse(evento.params) as unknown[]).map((v) =>
    typeof v === "string" && /^-?\d+$/.test(v) ? Number.parseInt(v, 10) : v,
  );
}

/**
 * Cliente que ADEMAS apunta cada consulta que emite. Es la unica forma de comprobar el PLAN
 * de la consulta REAL: si el test escribiera el SQL a mano, demostraria que un SQL inventado
 * usa el indice, no que lo use el que emite el repositorio (que es lo que corre en produccion
 * y lo que puede cambiar sin avisar al actualizar Prisma).
 *
 * Mismo `omit` que `crearPrismaDeTest`: sin el, el `SELECT` traeria `busqueda_texto` y el SQL
 * medido no seria el de produccion.
 */
export function crearPrismaDeTestConEspia(): {
  prisma: PrismaClient;
  eventos: EventoSqlDeTest[];
} {
  const eventos: EventoSqlDeTest[] = [];
  const cliente = new PrismaClient({
    adapter: new PrismaPg({ connectionString: urlDeBaseDeDatos(), max: 2 }),
    omit: PRISMA_OMIT,
    log: [{ emit: "event", level: "query" }],
  });
  (cliente as unknown as { $on: (e: "query", cb: (v: EventoSqlDeTest) => void) => void }).$on(
    "query",
    (e) => eventos.push(e),
  );
  return { prisma: cliente as unknown as PrismaClient, eventos };
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
