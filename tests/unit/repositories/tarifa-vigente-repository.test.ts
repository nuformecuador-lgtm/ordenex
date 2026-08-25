import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import type { TarifaTxClient } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import { clavePar } from "@/lib/utils/cascada-tarifa";

// Feature 274 (T3.3, R1-R8) — tests de la CLASE REAL del resolver contra un doble de
// `Pick<PrismaClient,"tarifa">` (patron de cierre-dia-repository.test.ts). Decision (d) de la
// feature 69, que sigue en pie: NO se mockea la interfaz. Cuando la 42/43 mockeaba
// `ITarifaVigente...`, el PR #64 dropeo `tarifas.zona_id` y la suite siguio VERDE; solo
// `pnpm typecheck` lo vio. Estos tests afirman los ARGUMENTOS EXACTOS que el resolver le pasa a
// Prisma y hacen pasar los tres niveles de la cascada POR EL REPO (no solo por el modulo puro
// `lib/utils/cascada-tarifa.ts`, que tiene los suyos en tests/unit/utils/cascada-tarifa.test.ts).
//
// ---------------------------------------------------------------------------------------
// CADUCIDADES: que habia aqui antes y por que se retira. Se declara una por una porque una
// retirada silenciosa de un test de dinero es indistinguible de un descuido (tasks.md §T3).
//
// 1. `describe("R30 — marcador TODO: de la deuda (g) en el resolver")` y sus CUATRO tests
//    estructurales sobre el texto del fuente (exigian que el `TODO:` siguiera presente y
//    mencionara `status`, `PR #64`, `feature 69`, `(g)` y `SELECCION`). LA DEUDA SE PAGA EN
//    ESTA FEATURE: la migracion `drop_tarifa_status` elimina la columna y la cascada
//    (tienda, zona) es la regla de seleccion que faltaba decidir. Un guardia que exige que la
//    deuda siga DOCUMENTADA no puede sobrevivir a su PAGO: mantenerlo obligaria a conservar un
//    `TODO:` que describe un problema inexistente. Lo que sustituye a esos cuatro tests no es
//    un comentario, es el comportamiento: los tests de cascada de este archivo.
//
// 2. Los tests que fijaban la AUSENCIA de `zonaId` en el `where`
//    (`expect(Object.keys(args.where)).not.toContain("zonaId")`). Eran el contrato textual de
//    la regla vieja —«por TIENDA, no por zona», feature 69/R20, tras el PR #64— y esa regla es
//    exactamente la que la 274 deroga. Los sustituye, invertidos, los asserts de este archivo
//    que exigen la PRESENCIA de `zonaId` en las tres ramas del `OR`.
//
// 3. Todo test que afirmara el filtro `status: "activo"` (el `describe` entero de
//    `resolveTarifaCotizablePorTienda`, feature 255/D6, y los tres que afirmaban la ausencia
//    de `status` en el otro camino). La columna YA NO EXISTE: no hay dos caminos que separar
//    (R37) y el typecheck ni siquiera dejaria compilar el `where`.
//
// 4. Los tests de «la MAS RECIENTE» (`orderBy: { createdAt: "desc" }`, R22 de la feature 69).
//    Fijaban el desempate por fecha que el UNIQUE (zona_id, tienda_id) NULLS NOT DISTINCT de
//    la 273 vuelve innecesario (R5): no puede haber dos candidatas del mismo nivel para el
//    mismo par. Los sustituye el test de orden invertido de T1.2, mas el assert de AUSENCIA de
//    `orderBy` que hay mas abajo.
// ---------------------------------------------------------------------------------------

function dec(v: string) {
  return new Prisma.Decimal(v);
}

function tarifaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tar1",
    tiendaId: "t1" as string | null,
    zonaId: "z1" as string | null,
    valorFlete: dec("1000"),
    valorFleteGam: dec("1500"),
    valorFleteDevuelto: dec("400"),
    valorFleteDevueltoGam: dec("600"),
    comisionCod: dec("5"),
    ivaFlete: dec("13"),
    ivaComisionCod: dec("13"),
    fulfillment: dec("300"),
    ...overrides,
  };
}

function buildPrisma() {
  return { tarifa: { findMany: vi.fn() } };
}

function buildRepo(prisma: ReturnType<typeof buildPrisma>) {
  return new TarifaVigenteRepository(prisma as unknown as PrismaClient);
}

function argsDe(prisma: ReturnType<typeof buildPrisma>, i = 0) {
  return prisma.tarifa.findMany.mock.calls[i]![0] as {
    where: unknown;
    select: Record<string, boolean>;
    orderBy?: unknown;
  };
}

describe("TarifaVigenteRepository.resolveTarifas — la query (R7)", () => {
  it("R7: N pares -> UNA sola llamada a `tarifa.findMany`, con el `OR` de tres ramas LITERAL", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([]);

    await buildRepo(prisma).resolveTarifas([
      { tiendaId: "t1", zonaId: "z1" },
      { tiendaId: "t2", zonaId: "z2" },
      { tiendaId: "t1", zonaId: "z1" }, // duplicado: no anade ni query ni valor al `in`
    ]);

    expect(prisma.tarifa.findMany).toHaveBeenCalledTimes(1); // sin N+1
    // El `where` EXACTO, no un `toMatchObject`: es la traduccion de la cascada a SQL y si una
    // rama cambia (o desaparece) el dinero cambia con ella.
    expect(argsDe(prisma).where).toEqual({
      OR: [
        { tiendaId: { in: ["t1", "t2"] }, zonaId: { in: ["z1", "z2"] } }, // nivel 1
        { tiendaId: { in: ["t1", "t2"] }, zonaId: null }, // nivel 2
        { tiendaId: null, zonaId: { in: ["z1", "z2"] } }, // nivel 3
      ],
    });
  });

  it("R1: las tres ramas del `where` mencionan `zonaId` (lo contrario del contrato viejo)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([]);

    await buildRepo(prisma).resolveTarifas([{ tiendaId: "t1", zonaId: "z1" }]);

    const where = argsDe(prisma).where as { OR: Array<Record<string, unknown>> };
    expect(where.OR).toHaveLength(3);
    for (const rama of where.OR) {
      // PRESENCIA afirmada, no inferida: hasta la 273 este mismo archivo exigia la AUSENCIA
      // de esta clave (caducidad 2 de la cabecera).
      expect(Object.keys(rama)).toContain("zonaId");
    }
  });

  it("el `select` pide `zonaId` (la regla lo necesita para clasificar) + `id` y `fulfillment`", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([]);

    await buildRepo(prisma).resolveTarifas([{ tiendaId: "t1", zonaId: "z1" }]);

    expect(argsDe(prisma).select).toEqual({
      id: true,
      tiendaId: true,
      zonaId: true,
      fulfillment: true,
      valorFlete: true,
      valorFleteGam: true,
      valorFleteDevuelto: true,
      valorFleteDevueltoGam: true,
      comisionCod: true,
      ivaFlete: true,
      ivaComisionCod: true,
    });
    expect(Object.keys(argsDe(prisma).select)).toContain("zonaId");
  });

  it("R5: la llamada NO lleva `orderBy` (el UNIQUE hace innecesario el desempate por fecha)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([]);

    await buildRepo(prisma).resolveTarifas([{ tiendaId: "t1", zonaId: "z1" }]);

    // Ausencia de la CLAVE, no solo de un valor: `orderBy: undefined` explicito tambien
    // contaria como una regla de desempate a medio escribir.
    expect(Object.keys(argsDe(prisma))).not.toContain("orderBy");
    expect(argsDe(prisma).orderBy).toBeUndefined();
  });

  it("R6: par SIN zona -> una sola rama (nivel 2), sin producto cartesiano", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([]);

    await buildRepo(prisma).resolveTarifas([{ tiendaId: "t1", zonaId: null }]);

    expect(argsDe(prisma).where).toEqual({ OR: [{ tiendaId: { in: ["t1"] }, zonaId: null }] });
  });

  it("`pares` vacio -> Map vacio SIN ir a la base", async () => {
    const prisma = buildPrisma();

    const out = await buildRepo(prisma).resolveTarifas([]);

    expect(out.size).toBe(0);
    expect(prisma.tarifa.findMany).not.toHaveBeenCalled();
  });

  it("usa el cliente de `tx` cuando se le pasa (segundo argumento, opcional)", async () => {
    const prisma = buildPrisma();
    const tx = buildPrisma();
    tx.tarifa.findMany.mockResolvedValue([]);

    // El cierre de dia resuelve DENTRO de su `$transaction`; el listado y la carga no tienen.
    await buildRepo(prisma).resolveTarifas(
      [{ tiendaId: "t1", zonaId: "z1" }],
      tx as unknown as TarifaTxClient,
    );

    expect(tx.tarifa.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.tarifa.findMany).not.toHaveBeenCalled();
  });
});

describe("TarifaVigenteRepository.resolveTarifas — la cascada, POR EL REPO (R1-R5)", () => {
  const par = { tiendaId: "t1", zonaId: "z1" };

  it("R1/R3: con nivel 1 y nivel 2 presentes gana el NIVEL 1 (tienda+zona)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([
      tarifaRow({ id: "generica", tiendaId: "t1", zonaId: null }),
      tarifaRow({ id: "especifica", tiendaId: "t1", zonaId: "z1" }),
    ]);

    const out = await buildRepo(prisma).resolveTarifas([par]);

    expect(out.get(clavePar(par))?.tarifaId).toBe("especifica");
  });

  it("R1: sin fila de nivel 1, gana el NIVEL 2 (tienda con zona NULL)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([
      tarifaRow({ id: "generica", tiendaId: "t1", zonaId: null }),
      tarifaRow({ id: "otra-zona", tiendaId: "t1", zonaId: "z9" }),
    ]);

    const out = await buildRepo(prisma).resolveTarifas([par]);

    expect(out.get(clavePar(par))?.tarifaId).toBe("generica");
  });

  it("R4: tienda sin fila propia -> gana el NIVEL 3 (zona con tienda NULL)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([
      tarifaRow({ id: "de-zona", tiendaId: null, zonaId: "z1" }),
      tarifaRow({ id: "de-otra-tienda", tiendaId: "t9", zonaId: "z1" }),
    ]);

    const out = await buildRepo(prisma).resolveTarifas([par]);

    expect(out.get(clavePar(par))?.tarifaId).toBe("de-zona");
  });

  it("R2: la fila global (NULL, NULL) NO es un cuarto nivel -> `null`", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([
      tarifaRow({ id: "global", tiendaId: null, zonaId: null }),
    ]);

    const out = await buildRepo(prisma).resolveTarifas([par]);

    expect(out.get(clavePar(par))).toBeNull();
  });

  it("R5: el MISMO conjunto de filas en orden INVERTIDO resuelve la MISMA fila", async () => {
    const filas = [
      tarifaRow({ id: "de-zona", tiendaId: null, zonaId: "z1" }),
      tarifaRow({ id: "generica", tiendaId: "t1", zonaId: null }),
      tarifaRow({ id: "especifica", tiendaId: "t1", zonaId: "z1" }),
    ];

    const directo = buildPrisma();
    directo.tarifa.findMany.mockResolvedValue(filas);
    const inverso = buildPrisma();
    inverso.tarifa.findMany.mockResolvedValue([...filas].reverse());

    const a = await buildRepo(directo).resolveTarifas([par]);
    const b = await buildRepo(inverso).resolveTarifas([par]);

    expect(a.get(clavePar(par))?.tarifaId).toBe("especifica");
    expect(b.get(clavePar(par))?.tarifaId).toBe("especifica");
  });

  it("R6: par con `zonaId: null` solo alcanza el nivel 2 (una fila de zona no le sirve)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([
      tarifaRow({ id: "de-zona", tiendaId: null, zonaId: "z1" }),
      tarifaRow({ id: "de-zona-tienda", tiendaId: "t1", zonaId: "z1" }),
      tarifaRow({ id: "generica", tiendaId: "t1", zonaId: null }),
    ]);

    const sinZona = { tiendaId: "t1", zonaId: null };
    const out = await buildRepo(prisma).resolveTarifas([sinZona]);

    expect(out.get(clavePar(sinZona))?.tarifaId).toBe("generica");
  });
});

describe("TarifaVigenteRepository.resolveTarifas — el Map (R7) y la proyeccion", () => {
  it("R7: hay una entrada por CADA par pedido, con `null` cuando no resuelve", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([
      tarifaRow({ id: "tarA", tiendaId: "t1", zonaId: "z1" }),
    ]);

    const conTarifa = { tiendaId: "t1", zonaId: "z1" };
    const sinTarifa = { tiendaId: "t2", zonaId: "z2" };
    const out = await buildRepo(prisma).resolveTarifas([conTarifa, sinTarifa]);

    expect(out.size).toBe(2);
    expect(out.get(clavePar(conTarifa))?.tarifaId).toBe("tarA");
    // Gap EXPLICITO, no ausencia: el llamador distingue "no resuelve" de "no lo pedi".
    expect(out.has(clavePar(sinTarifa))).toBe(true);
    expect(out.get(clavePar(sinTarifa))).toBeNull();
  });

  it("dos pares de la MISMA tienda en zonas distintas resuelven filas distintas (el porque de la feature)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([
      tarifaRow({ id: "z1", tiendaId: "t1", zonaId: "z1", valorFlete: dec("1000") }),
      tarifaRow({ id: "z2", tiendaId: "t1", zonaId: "z2", valorFlete: dec("2000") }),
    ]);

    const parA = { tiendaId: "t1", zonaId: "z1" };
    const parB = { tiendaId: "t1", zonaId: "z2" };
    const out = await buildRepo(prisma).resolveTarifas([parA, parB]);

    expect(prisma.tarifa.findMany).toHaveBeenCalledTimes(1);
    expect(out.get(clavePar(parA))?.valorFlete).toBe("1000.00");
    expect(out.get(clavePar(parB))?.valorFlete).toBe("2000.00");
  });

  it("congela `tarifaId` y `fulfillment` (auditoria del snapshot) + los 7 STRING escala 2", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([
      tarifaRow({ id: "tar1", tiendaId: "t1", zonaId: "z1" }),
    ]);

    const out = await buildRepo(prisma).resolveTarifas([{ tiendaId: "t1", zonaId: "z1" }]);

    expect(out.get(clavePar({ tiendaId: "t1", zonaId: "z1" }))).toEqual({
      tarifaId: "tar1",
      fulfillment: "300.00",
      valorFlete: "1000.00",
      valorFleteGam: "1500.00",
      valorFleteDevuelto: "400.00",
      valorFleteDevueltoGam: "600.00",
      comisionCod: "5.00",
      ivaFlete: "13.00",
      ivaComisionCod: "13.00",
    });
  });
});

describe("TarifaVigenteRepository.resolveTarifa (singular)", () => {
  it("una sola llamada a la base y los 7 campos como STRING escala 2 (money-safe)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([
      tarifaRow({ id: "tar1", tiendaId: "t1", zonaId: "z1" }),
    ]);

    const t = await buildRepo(prisma).resolveTarifa("t1", "z1");

    expect(prisma.tarifa.findMany).toHaveBeenCalledTimes(1);
    // Los 7 campos de la formula, ni uno mas: el singular NO expone `tarifaId` ni
    // `fulfillment`, que son del camino del snapshot.
    expect(t).toEqual({
      valorFlete: "1000.00",
      valorFleteGam: "1500.00",
      valorFleteDevuelto: "400.00",
      valorFleteDevueltoGam: "600.00",
      comisionCod: "5.00",
      ivaFlete: "13.00",
      ivaComisionCod: "13.00",
    });
  });

  it("recorre EL MISMO camino que el lote: el `where` es el de un par (R8)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([]);

    await buildRepo(prisma).resolveTarifa("t1", "z1");

    expect(argsDe(prisma).where).toEqual({
      OR: [
        { tiendaId: { in: ["t1"] }, zonaId: { in: ["z1"] } },
        { tiendaId: { in: ["t1"] }, zonaId: null },
        { tiendaId: null, zonaId: { in: ["z1"] } },
      ],
    });
    expect(Object.keys(argsDe(prisma))).not.toContain("orderBy");
  });

  it("R1/R3: aplica la cascada tambien en el singular (gana el nivel 1)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([
      tarifaRow({ id: "generica", tiendaId: "t1", zonaId: null, valorFlete: dec("111") }),
      tarifaRow({ id: "especifica", tiendaId: "t1", zonaId: "z1", valorFlete: dec("999") }),
    ]);

    const t = await buildRepo(prisma).resolveTarifa("t1", "z1");

    expect(t?.valorFlete).toBe("999.00");
  });

  it("R6: sin zona resuelve el nivel 2, y el `where` tiene una sola rama", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([
      tarifaRow({ id: "generica", tiendaId: "t1", zonaId: null, valorFlete: dec("111") }),
      tarifaRow({ id: "de-zona", tiendaId: "t1", zonaId: "z1", valorFlete: dec("999") }),
    ]);

    const t = await buildRepo(prisma).resolveTarifa("t1", null);

    expect(argsDe(prisma).where).toEqual({ OR: [{ tiendaId: { in: ["t1"] }, zonaId: null }] });
    expect(t?.valorFlete).toBe("111.00");
  });

  it("R2: ningun nivel resuelve -> `null` (gap de datos, no lanza)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([
      tarifaRow({ id: "global", tiendaId: null, zonaId: null }),
    ]);

    await expect(buildRepo(prisma).resolveTarifa("t1", "z1")).resolves.toBeNull();
  });
});
