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

/** El cliente que `enTransaccionRevertida` entrega al test: la tx interactiva de Prisma. */
export type TxDeTest = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * FICHA 327 — el cliente de la tx del test, MAS un `$transaction` que no abre nada.
 *
 * POR QUE HACE FALTA. `Prisma.TransactionClient` **no tiene `$transaction`** (esta en la
 * `ITXClientDenyList`). En cuanto un repositorio abre su propia transaccion por dentro —lo que
 * hace `OrdenRepository.corregirDatosCliente` desde la 327, para que el encolado del job comparta
 * transaccion con la escritura (OUTBOX, feature 91/R7)— ejercerlo con el `tx` pelado revienta con
 * «tx.$transaction is not a function», y ese rojo no dice nada del codigo.
 *
 * QUE SE PIERDE Y QUE NO. El pass-through NO abre un savepoint: la «transaccion interna» es la
 * misma del test. Lo que se sigue midiendo intacto es lo que estas suites existen para medir —el
 * SQL REAL contra Postgres: el `WHERE` de la ventana, las columnas que cambian, las filas que
 * aparecen o no en otras tablas—. La atomicidad del outbox NO se afirma con esto: se afirma
 * comprobando que el encolado recibe EL MISMO cliente que la escritura (4.º argumento), que es la
 * propiedad de la que depende el invariante.
 *
 * El `bind` es necesario: las funciones del cliente Prisma (`$queryRaw`, `$executeRawUnsafe`, ...)
 * necesitan su `this`, y devolverlas desatadas del proxy las rompe en silencio.
 */
export function clienteConTransaccionAnidada(tx: TxDeTest): PrismaClient {
  const proxy = new Proxy(tx as object, {
    get(target, prop) {
      if (prop === "$transaction") {
        return async (fn: (t: unknown) => unknown) => fn(proxy);
      }
      const valor = Reflect.get(target, prop) as unknown;
      return typeof valor === "function" ? valor.bind(target) : valor;
    },
  });
  return proxy as unknown as PrismaClient;
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

/**
 * Feature 227 — clave del lock de aviso que SERIALIZA a los tests que escriben en las tablas
 * REALES de `public` (`usuario`, `orden`, y el DDL que las referencia por FK).
 *
 * POR QUE HACE FALTA. Varios archivos de test corren EN PARALELO (vitest usa un worker por
 * archivo) y cada uno abre una transaccion larga que inserta en `public."usuario"` y
 * `public."orden"` y ejecuta DDL cuyas FK apuntan ahi. Cada transaccion toma los mismos locks
 * (los `KEY SHARE` de las FK sobre los catalogos, y el `SHARE ROW EXCLUSIVE` que un
 * `ADD CONSTRAINT ... REFERENCES public."usuario"` toma sobre la tabla referenciada) pero en
 * ORDEN DISTINTO. Eso es la receta exacta de un deadlock, y Postgres mata a una de las dos con
 * `40P01`. Medido: en aislado cada archivo pasa siempre; los tres juntos fallaban 2 de cada 3
 * corridas, y al reventar el `beforeAll` vitest marcaba los tests como SKIPPED —es decir, la
 * evidencia de varios requisitos dejaba de ejecutarse y la suite parecia casi verde.
 *
 * POR QUE ESTE REMEDIO Y NO UN REINTENTO. Reintentar un deadlock lo esconde. Serializar las
 * secciones criticas lo ELIMINA: si nunca hay dos de estas transacciones a la vez, no hay ciclo
 * de espera posible. Y no toca la fidelidad de lo que se mide: las FK siguen apuntando a las
 * tablas REALES, el DDL sigue siendo el REAL y el rollback sigue siendo el mismo.
 *
 * POR QUE `pg_advisory_xact_lock` Y NO UN `LOCK TABLE`. El lock de aviso no bloquea a la
 * aplicacion ni a ningun otro test que no lo pida (los demas siguen corriendo en paralelo), y
 * se suelta SOLO al terminar la transaccion —incluido el rollback y la muerte del proceso—, sin
 * un `finally` que mantener.
 */
export const CLAVE_LOCK_ESCRITURA_REAL = 227_0815_00;

/**
 * Toma el lock de aviso. DEBE ser la PRIMERA sentencia de la transaccion: si se toma despues de
 * haber tocado ya una tabla, la transaccion habra adquirido locks antes de serializarse y el
 * ciclo vuelve a ser posible.
 */
export async function serializarEscriturasReales(tx: {
  $executeRawUnsafe: (sql: string, ...args: unknown[]) => Promise<number>;
}): Promise<void> {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${CLAVE_LOCK_ESCRITURA_REAL})`);
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
