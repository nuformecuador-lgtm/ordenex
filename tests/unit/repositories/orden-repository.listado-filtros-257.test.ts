import { describe, it, expect, vi } from "vitest";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 257 (T7) — la FORMA del `where` con que `listByOwner` resuelve el listado del canal
// por API key. Hermano de `cierres-filtros-where.test.ts` y existe por la misma leccion: los
// tests de SERVICE prueban el acotamiento contra un repositorio DOBLE, asi que no ven la
// traduccion a Prisma. Un filtro mal colocado —o un owner pisado por un spread— pasaria verde
// toda la suite de servicios y, en produccion, devolveria ordenes de OTRA tienda sin fallar.
//
// Los tres errores concretos que este archivo congela:
//
//   1. EL OWNER PISADO. `tiendaId` y `deletedAt` se escriben PRIMERO y de forma INCONDICIONAL en
//      el object literal. No es estilo: en un object literal gana el ULTIMO valor escrito, asi
//      que un spread posterior que repitiera `tiendaId` lo sustituiria en silencio y el listado
//      devolveria ordenes ajenas sin ningun error ruidoso. Por eso hay un caso que intenta
//      colar un `tiendaId` ajeno POR LOS PARAMETROS y exige que el `where` no se inmute.
//   2. `lte` EN LUGAR DE `lt`. La cota superior YA viene movida por el service al comienzo del
//      dia siguiente en CR (para que `hasta` sea inclusivo). Aplicarla con `lte` colaria las
//      ordenes creadas exactamente a las 00:00 CR del dia siguiente, es decir un dia de mas.
//   3. UN `not: null` DE CORTESIA sobre `num_guia`. La igualdad estricta ya excluye los nulos en
//      SQL; anadir la condicion sugiere que hace falta y abre la puerta a "y si mejor un `in`".
//
// Y una cuarta afirmacion que protege a quien NO filtra (R1): sin ningun parametro nuevo el
// `where` tiene que ser EXACTAMENTE el de antes de esta feature, sin claves sobrantes.

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTRA_TIENDA = "22222222-2222-4222-8222-222222222222";
const ESTATUS = "33333333-3333-4333-8333-333333333333";

const DESDE = new Date("2026-08-01T06:00:00.000Z"); // 00:00 hora de CR del 1
const HASTA = new Date("2026-08-22T06:00:00.000Z"); // 00:00 hora de CR del 22 (cota EXCLUSIVA)

function delegado() {
  return {
    findMany: vi.fn(async (_args?: { where?: unknown }) => [] as unknown[]),
    count: vi.fn(async (_args?: { where?: unknown }) => 0),
  };
}

function repo(orden: ReturnType<typeof delegado>) {
  return new OrdenRepository(
    { orden } as unknown as ConstructorParameters<typeof OrdenRepository>[0],
    {} as never,
  );
}

/** Los argumentos con que se pidio la PAGINA (el conteo se afirma aparte: es el mismo objeto). */
function argsDe(d: ReturnType<typeof delegado>): Record<string, unknown> {
  return d.findMany.mock.calls[0]![0]! as unknown as Record<string, unknown>;
}

/** El `where` de la pagina. */
function whereDe(d: ReturnType<typeof delegado>): Record<string, unknown> {
  return argsDe(d).where as Record<string, unknown>;
}

describe("WHERE del listado por API key con los filtros de la feature 257 (T7)", () => {
  it("R1: sin ningun filtro nuevo el `where` es EXACTAMENTE el de siempre", async () => {
    // La propiedad que protege a quien no filtra. Si cae, la feature cambio el camino de todos
    // los integradores para dar servicio a los que filtran.
    const d = delegado();
    await repo(d).listByOwner({ ownerId: OWNER, skip: 0, take: 50 });

    expect(whereDe(d)).toEqual({ tiendaId: OWNER, deletedAt: null });
    expect(whereDe(d)).not.toHaveProperty("createdAt");
    expect(whereDe(d)).not.toHaveProperty("numGuia");
    expect(whereDe(d)).not.toHaveProperty("numRemision");
  });

  it("R18/R20/R23: los cuatro filtros nuevos + estado conviven en AND y el owner sigue intacto", async () => {
    const d = delegado();
    await repo(d).listByOwner({
      ownerId: OWNER,
      estatusId: ESTATUS,
      createdAtDesde: DESDE,
      createdAtHasta: HASTA,
      numGuia: 10234,
      numRemision: "REM-1",
      skip: 0,
      take: 50,
    });

    const where = whereDe(d);
    // R20: el scope, exactamente el recibido. Ni sustituido ni ampliado por ningun filtro.
    expect(where.tiendaId, "un filtro sustituyó al owner en vez de recortar dentro de él").toBe(
      OWNER,
    );
    // R23: las borradas logicamente siguen fuera aun con los cuatro filtros presentes.
    expect(where.deletedAt).toBeNull();
    // R18: claves HERMANAS del mismo objeto `where` => Prisma las une con AND. Una orden
    // aparece solo si satisface TODAS. (Si alguna viviera en un `OR`, un filtro ampliaria.)
    expect(where).toEqual({
      tiendaId: OWNER,
      deletedAt: null,
      estatusId: ESTATUS,
      numGuia: 10234,
      numRemision: "REM-1",
      createdAt: { gte: DESDE, lt: HASTA },
    });
  });

  it("R20: un `tiendaId` ajeno colado por los parametros NO altera el `where`", async () => {
    // TypeScript rechaza la clave de mas (el objeto literal no la declara), asi que hace falta un
    // cast controlado. El test existe PRECISAMENTE para congelar que el exceso de propiedades no
    // puede tocar el scope: hoy `tiendaId` se escribe primero y de forma incondicional, pero si
    // manana alguien anadiera un `...params` al final del literal, la clave repetida GANARIA (en
    // un object literal se queda el ultimo valor escrito) y el listado empezaria a devolver
    // ordenes de otra tienda sin lanzar ningun error. Esa regresion es silenciosa; esto la hace
    // ruidosa.
    const d = delegado();
    await repo(d).listByOwner({
      ownerId: OWNER,
      tiendaId: OTRA_TIENDA,
      skip: 0,
      take: 50,
    } as unknown as Parameters<OrdenRepository["listByOwner"]>[0]);

    const where = whereDe(d);
    expect(where.tiendaId, "una clave de la peticion pisó el owner").toBe(OWNER);
    expect(where.tiendaId).not.toBe(OTRA_TIENDA);
    expect(where).toEqual({ tiendaId: OWNER, deletedAt: null });
  });

  it("R18: la cota superior de la ventana usa `lt`, NUNCA `lte`", async () => {
    // El service ya empujo `hasta` al comienzo del dia SIGUIENTE en hora de CR para que `hasta`
    // sea inclusivo. Con `lte` esa cota dejaria entrar las ordenes creadas justo a las 00:00 CR
    // del dia siguiente: un dia de mas, y ademas no determinista entre paginas.
    const d = delegado();
    await repo(d).listByOwner({
      ownerId: OWNER,
      createdAtDesde: DESDE,
      createdAtHasta: HASTA,
      skip: 0,
      take: 50,
    });

    const where = whereDe(d);
    expect(where.createdAt).toEqual({ gte: DESDE, lt: HASTA });
    expect(where.createdAt).not.toHaveProperty("lte");
    expect(where.createdAt).not.toHaveProperty("gt");
  });

  it("R18: solo `createdAtDesde` emite `gte` sin cota superior, y solo `createdAtHasta` al reves", async () => {
    const a = delegado();
    await repo(a).listByOwner({ ownerId: OWNER, createdAtDesde: DESDE, skip: 0, take: 50 });
    expect(whereDe(a).createdAt).toEqual({ gte: DESDE });

    const b = delegado();
    await repo(b).listByOwner({ ownerId: OWNER, createdAtHasta: HASTA, skip: 0, take: 50 });
    expect(whereDe(b).createdAt).toEqual({ lt: HASTA });
  });

  it("R15: `numGuia` se emite como igualdad estricta, y eso ya excluye las ordenes sin guia", async () => {
    // `num_guia` es una columna NULLABLE. La igualdad de Prisma se traduce a `num_guia = $1`, y en
    // SQL ninguna comparacion casa con NULL (`NULL = 10234` es NULL, no TRUE), asi que las ordenes
    // todavia sin guia quedan fuera GRATIS. Un `not: null` extra no anade nada y confunde: haria
    // pensar que la igualdad sola no basta, y abriria la puerta a reescribirla como un `in`/`OR`
    // que si podria colar nulos.
    const d = delegado();
    await repo(d).listByOwner({ ownerId: OWNER, numGuia: 10234, skip: 0, take: 50 });

    const where = whereDe(d);
    expect(where.numGuia).toBe(10234); // escalar plano, no `{ equals: ... }` ni `{ in: [...] }`
    expect(where.numGuia).not.toHaveProperty("not");
    expect(where).toEqual({ tiendaId: OWNER, deletedAt: null, numGuia: 10234 });
  });

  it("R24: el orden es `createdAt desc` y `skip`/`take` son los recibidos, sobre el conjunto ya filtrado", async () => {
    const d = delegado();
    await repo(d).listByOwner({
      ownerId: OWNER,
      createdAtDesde: DESDE,
      numRemision: "REM-1",
      skip: 40,
      take: 20,
    });

    const args = argsDe(d);
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.skip).toBe(40);
    expect(args.take).toBe(20);
    // Y la paginacion se aplica sobre el conjunto FILTRADO: el `where` con los filtros viaja en
    // la MISMA consulta que el `skip`/`take`, no en un recorte posterior en memoria.
    expect(args.where).toMatchObject({ numRemision: "REM-1", createdAt: { gte: DESDE } });
  });

  it("R25: el `where` del `count` es el MISMO objeto que el del `findMany` (identidad, no copia)", async () => {
    // Compartir la referencia es la garantia mas fuerte disponible: no hay forma de que las dos
    // consultas diverjan. Un `total` calculado sobre otro conjunto haria que recorrer paginas con
    // filtros activos dejara de ser determinista (paginas que se saltan filas o que no existen).
    const d = delegado();
    await repo(d).listByOwner({
      ownerId: OWNER,
      estatusId: ESTATUS,
      createdAtDesde: DESDE,
      createdAtHasta: HASTA,
      numGuia: 10234,
      numRemision: "REM-1",
      skip: 0,
      take: 50,
    });

    const whereCount = (d.count.mock.calls[0]![0]! as unknown as Record<string, unknown>).where;
    expect(whereCount).toBe(whereDe(d));
  });
});
