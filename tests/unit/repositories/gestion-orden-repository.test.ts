import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";
// Feature 239 (2026-08-19): el destino de una gestion sale del MAPA, no del nombre del
// resultado. Estas suites pasan `nuevoEstatusId` a mano, asi que lo derivan de la misma fuente
// que el servicio real: si el mapa cambia, cambian con el en vez de fijar un destino caducado.
import { estatusDestinoDeResultado } from "@/lib/types/gestion-destino";

// Feature 36 — repositorio con Prisma mockeado (sin DB). Cubre el filtrado por
// mensajero (R9/R13), la guardia origen+propiedad de recogerLote (R15) y la
// transaccion INSERT+UPDATE+limpiar puntero de crearGestionYTransicionar
// (R23/R26/R28/R30).

function fakeAsignacionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "o1",
    numGuia: 5,
    numRemision: "R-1",
    destinatario: "Ana",
    telefonoDest: "099",
    direccion: "calle 1",
    producto: "caja",
    montoCobrar: new Prisma.Decimal(100),
    // Feature 97: coords geocodificadas (feature 91) como Decimal, igual que en la DB.
    latitud: new Prisma.Decimal("9.9281244"),
    longitud: new Prisma.Decimal("-84.0907246"),
    notas: null,
    mensajeroAsignadoId: "m1",
    // Feature 246 (T3.7, R35): dia de reparto CRUDO (`@db.Date`: medianoche UTC de la fecha CR).
    fechaReparto: new Date("2026-08-21T00:00:00.000Z"),
    estatus: { value: "por_recoger" },
    tienda: { nombre: "Tienda X" },
    zona: { nombre: "Centro" },
    provincia: { nombre: "Pichincha" },
    canton: { nombre: "Quito" },
    distrito: { nombre: "Centro Historico" },
    ...overrides,
  };
}

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia del choke point es de fallo CERRADO (catalogo real + pares legales)
});

describe("GestionOrdenRepository.findMisAsignaciones (R9/R13)", () => {
  it("R13: filtra por mensajero_asignado_id + no borradas + estados, en el WHERE", async () => {
    const findMany = vi.fn(async () => [fakeAsignacionRow()]);
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);

    const rows = await repo.findMisAsignaciones("m1", ["por_recoger", "en_reparto"]);

    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = (findMany.mock.calls[0] as unknown[])[0] as { where: Record<string, unknown> };
    expect(arg.where.mensajeroAsignadoId).toBe("m1");
    expect(arg.where.deletedAt).toBeNull();
    expect(arg.where.estatus).toEqual({ value: { in: ["por_recoger", "en_reparto"] } });
    // Proyeccion: nombres legibles + montoCobrar como number.
    expect(rows[0].tiendaNombre).toBe("Tienda X");
    expect(rows[0].montoCobrar).toBe(100);
    expect(rows[0].estatusValue).toBe("por_recoger");
  });

  // Feature 246 (T3.7, R35/R26): el dia de reparto viaja en la proyeccion QUE YA EXISTE. Sin
  // consulta nueva: seria un N+1 sobre la pantalla mas caliente del portal del mensajero.
  it("246/R35: pide `fechaReparto` en el select y la emite CRUDA, sin interpretarla", async () => {
    const findMany = vi.fn(async () => [fakeAsignacionRow()]);
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);

    const rows = await repo.findMisAsignaciones("m1", ["por_recoger"]);

    const arg = (findMany.mock.calls[0] as unknown[])[0] as { select: Record<string, unknown> };
    expect(arg.select.fechaReparto).toBe(true);
    // CRUDA a proposito: quien decide si es «para mañana» es el SERVICIO, que tiene reloj. Un
    // repositorio que devolviera el booleano tendria que leer la hora, y entonces dos filas del
    // mismo listado podrian caer a distinto lado de la medianoche.
    expect(rows[0].fechaReparto).toBeInstanceOf(Date);
    expect((rows[0].fechaReparto as Date).toISOString()).toBe("2026-08-21T00:00:00.000Z");
    expect(rows[0]).not.toHaveProperty("esParaManana");
    // Y UNA sola consulta para todo el listado.
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("246/R35: una orden sin reserva emite `null`, no `undefined`", async () => {
    const findMany = vi.fn(async () => [fakeAsignacionRow({ fechaReparto: null })]);
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);

    const rows = await repo.findMisAsignaciones("m1", ["por_recoger"]);

    expect(rows[0].fechaReparto).toBeNull();
  });

  it("R9: estados vacios -> no consulta y devuelve []", async () => {
    const findMany = vi.fn();
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);
    expect(await repo.findMisAsignaciones("m1", [])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  // Feature 97: las coords de la parada (feature 91) viajan en el DTO. La query las PIDE
  // (select) y las SERIALIZA Decimal -> number (mismo patron que montoCobrar).
  it("F97: proyecta latitud/longitud en el select y las serializa Decimal -> number", async () => {
    const findMany = vi.fn(async () => [fakeAsignacionRow()]);
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);

    const rows = await repo.findMisAsignaciones("m1", ["en_reparto"]);

    const arg = (findMany.mock.calls[0] as unknown[])[0] as { select: Record<string, unknown> };
    expect(arg.select.latitud).toBe(true);
    expect(arg.select.longitud).toBe(true);
    expect(rows[0].latitud).toBe(9.9281244);
    expect(rows[0].longitud).toBe(-84.0907246);
    // Y son numbers puros, no Decimal (serializacion aplicada).
    expect(typeof rows[0].latitud).toBe("number");
    expect(typeof rows[0].longitud).toBe("number");
  });

  // Feature 97: orden aun sin geocodificar -> coords null; null -> null (no revienta el .toNumber()).
  it("F97: orden sin geocodificar (latitud/longitud null) -> null", async () => {
    const findMany = vi.fn(async () => [
      fakeAsignacionRow({ latitud: null, longitud: null }),
    ]);
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);

    const rows = await repo.findMisAsignaciones("m1", ["en_reparto"]);

    expect(rows[0].latitud).toBeNull();
    expect(rows[0].longitud).toBeNull();
  });
});

describe("GestionOrdenRepository.contarEntregadas (feature 61)", () => {
  // Ventana de un dia de CR: 15/07 00:00 CR = 06:00Z, cota superior EXCLUSIVA en 16/07 06:00Z.
  const DIA = {
    desde: new Date("2026-07-15T06:00:00.000Z"),
    hasta: new Date("2026-07-16T06:00:00.000Z"),
  };

  it("cuenta por mensajero + estado entregada + no borradas, en el WHERE", async () => {
    const count = vi.fn(async () => 5);
    const repo = new GestionOrdenRepository({ orden: { count } } as never);

    const total = await repo.contarEntregadas("m1", DIA);

    expect(total).toBe(5);
    expect(count).toHaveBeenCalledTimes(1);
    const arg = (count.mock.calls[0] as unknown[])[0] as { where: Record<string, unknown> };
    expect(arg.where.mensajeroAsignadoId).toBe("m1");
    expect(arg.where.deletedAt).toBeNull();
    // ⏳ 2026-09-23 (FICHA 454, T1.12/R53): antes `{ value: "entregada" }`. La entrega de HOY sigue
    // `en_reparto` (pendiente de confirmar) hasta que se aprueba su cierre; el KPI la cuenta igual.
    // Lo que decide es la gestion `entregada` vigente de hoy (caso de abajo).
    expect(arg.where.estatus).toEqual({ value: { in: ["entregada", "en_reparto"] } });
  });

  // El KPI es de JORNADA, no acumulado: el acote va sobre la GESTION vigente que entrego
  // (la orden no tiene `entregada_at`), con rango HALF-OPEN para cubrir el dia sin invadir
  // el siguiente. Si esto se rompe, el mensajero vuelve a ver su historico completo.
  it("acota al dia por la gestion VIGENTE que entrego, con rango half-open", async () => {
    const count = vi.fn(async () => 2);
    const repo = new GestionOrdenRepository({ orden: { count } } as never);

    await repo.contarEntregadas("m1", DIA);

    const arg = (count.mock.calls[0] as unknown[])[0] as { where: { gestiones: { some: unknown } } };
    expect(arg.where.gestiones.some).toEqual({
      mensajeroId: "m1", // ancla a QUIEN entrego: una reasignacion posterior no regala el KPI
      resultado: "entregada",
      anuladaAt: null, // feature 67/R11: una entrega deshecha deja de contar
      createdAt: { gte: DIA.desde, lt: DIA.hasta }, // `lt`, NO `lte`
    });
  });

});

describe("GestionOrdenRepository.sumMontoCobrarGestionadas (KPI 'Total a cobrar')", () => {
  const DIA = {
    desde: new Date("2026-07-15T06:00:00.000Z"),
    hasta: new Date("2026-07-16T06:00:00.000Z"),
  };

  function repoConAggregate(sum: Prisma.Decimal | null) {
    const aggregate = vi.fn(async () => ({ _sum: { montoCobrar: sum } }));
    return { repo: new GestionOrdenRepository({ orden: { aggregate } } as never), aggregate };
  }

  // NO filtra por `resultado`: el total del dia mide todo lo que paso por las manos del
  // mensajero. Si se filtrara a `entregada`, el total BAJARIA cada vez que una orden no se
  // entrega —justo cuando el mensajero necesita que el numero no se mueva—.
  it("cuenta la gestion del dia con CUALQUIER resultado, no solo entregada", async () => {
    const { repo, aggregate } = repoConAggregate(new Prisma.Decimal(750));

    const total = await repo.sumMontoCobrarGestionadas("m1", DIA);

    expect(total).toBe(750);
    const arg = (aggregate.mock.calls[0] as unknown[])[0] as {
      where: { gestiones: { some: Record<string, unknown> } };
    };
    expect(arg.where.gestiones.some).toEqual({
      mensajeroId: "m1",
      anuladaAt: null, // feature 67/R11: una gestion deshecha deja de contar
      createdAt: { gte: DIA.desde, lt: DIA.hasta }, // `lt`, NO `lte`
    });
    expect(arg.where.gestiones.some.resultado).toBeUndefined();
  });

  // La guardia del doble conteo: `totalACobrar` suma ESTE resultado + el COD de las que
  // siguen en reparto. Si la query no excluyera `en_reparto`, una orden gestionada hoy como
  // reprogramada y liberada de vuelta a reparto el mismo dia (feature 46) caeria en los DOS
  // conjuntos y su monto se sumaria dos veces.
  it("EXCLUYE lo que el mensajero LLEVA EN LA MANO, para no solaparse con la otra mitad", async () => {
    const { repo, aggregate } = repoConAggregate(null);

    const total = await repo.sumMontoCobrarGestionadas("m1", DIA);

    expect(total).toBe(0); // sin gestionadas / montos nulos -> 0, no null
    const arg = (aggregate.mock.calls[0] as unknown[])[0] as { where: Record<string, unknown> };
    // FEATURE 235 (R21, 2026-08-19): de UN value a DOS. El otro sumando (`porCobrar`) se calcula
    // sobre `porGestionar UNION conAyuda`, asi que el conjunto «en la mano» crecio y esta red
    // tenia que crecer con el. Censo CERRADO: uno de mas dejaria fuera dinero que si se gestiono.
    // ⏳ 2026-09-23 (FICHA 454, T1.12/R53): «no esta en la mano» = fuera de esos estados O con una
    // gestion PENDIENTE de confirmar (sigue `en_reparto` pero ya se gestiono y el portal no la cuenta
    // en `porCobrar`). La condicion pasa a un `OR` de las dos.
    const or = arg.where.OR as Record<string, unknown>[];
    expect(or[0]).toEqual({ estatus: { value: { notIn: ["en_reparto", "ayuda_tienda"] } } });
    expect(or[1]).toMatchObject({ estatus: { value: "en_reparto" } });
    expect(arg.where.mensajeroAsignadoId).toBe("m1");
    expect(arg.where.deletedAt).toBeNull();
  });

  // Feature 235 (R21): el predicado, aplicado a filas, para que el caso de arriba no afirme solo
  // una forma. Los dos estados «en la mano» quedan fuera; los desenlaces, dentro.
  it("235/R21: el predicado deja fuera `en_reparto` Y `ayuda_tienda`, y deja dentro los desenlaces", async () => {
    const { repo, aggregate } = repoConAggregate(null);

    await repo.sumMontoCobrarGestionadas("m1", DIA);
    // ⏳ 2026-09-23 (FICHA 454): la lista vive ahora en la primera rama del `OR` (ver arriba).
    const arg = (aggregate.mock.calls[0] as unknown[])[0] as {
      where: { OR: [{ estatus: { value: { notIn: string[] } } }, unknown] };
    };
    const cuenta = (estatus: string) => !arg.where.OR[0].estatus.value.notIn.includes(estatus);

    expect(cuenta("en_reparto")).toBe(false);
    expect(cuenta("ayuda_tienda")).toBe(false);
    for (const dentro of ["entregada", "reprogramada", "rechazada", "devolucion_por_confirmar"]) {
      expect(cuenta(dentro), `${dentro} SI cuenta como gestionada del dia`).toBe(true);
    }
  });
});

describe("GestionOrdenRepository.findByIdsParaGestion (feature 47/R5 · zonaId)", () => {
  it("proyecta y devuelve zonaId (insumo del ruteo a bodega en un reintento)", async () => {
    const findMany = vi.fn(async () => [
      {
        id: "o1",
        deletedAt: null,
        mensajeroAsignadoId: "m1",
        montoCobrar: new Prisma.Decimal(100),
        zonaId: "z-satelite",
        estatus: { value: "en_reparto" },
      },
    ]);
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);

    const rows = await repo.findByIdsParaGestion(["o1"]);

    // La proyeccion pide zonaId al select...
    const arg = (findMany.mock.calls[0] as unknown[])[0] as { select: Record<string, unknown> };
    expect(arg.select.zonaId).toBe(true);
    // ...y lo mapea a la fila.
    expect(rows[0].zonaId).toBe("z-satelite");
    expect(rows[0].estatusValue).toBe("en_reparto");
    expect(rows[0].montoCobrar).toBe(100);
  });

  it("zonaId null (orden sin zona) se preserva", async () => {
    const findMany = vi.fn(async () => [
      {
        id: "o1",
        deletedAt: null,
        mensajeroAsignadoId: "m1",
        montoCobrar: null,
        zonaId: null,
        estatus: { value: "en_reparto" },
      },
    ]);
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);
    const rows = await repo.findByIdsParaGestion(["o1"]);
    expect(rows[0].zonaId).toBeNull();
  });

  it("ids vacios -> no consulta y devuelve []", async () => {
    const findMany = vi.fn();
    const repo = new GestionOrdenRepository({ orden: { findMany } } as never);
    expect(await repo.findByIdsParaGestion([])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});


/**
 * Feature 92 (R16/R19): `GestionOrdenRepository` inyecta ahora un `IJobRepository` para el
 * encolado TRANSACTIONAL OUTBOX de la reoptimizacion de ruta. Este doble registra las
 * llamadas para que los tests de la 36/47/49 sigan midiendo lo suyo Y ADEMAS puedan
 * afirmar que el encolado va DENTRO de la transaccion del writer (4.º argumento).
 * El comportamiento del debounce y del namespace disjunto se prueba aparte, en
 * `tests/integration/repositories/optimizacion-ruta-enqueue.test.ts`.
 */
function colaFake() {
  const enqueue = vi.fn(async () => null);
  return {
    enqueue,
    claimBatch: vi.fn(async () => []),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    findByDedupeKeys: vi.fn(async () => []),
  };
}

/**
 * Feature 261 (B5): el DIA DE COSTA RICA EN CURSO que el servicio resuelve y pasa a la
 * escritura, en la convencion `@db.Date` (medianoche UTC de la fecha calendario CR).
 */
const DIA_CR = new Date("2026-07-20T00:00:00.000Z");

describe("GestionOrdenRepository.recogerLote (R15 · feature 49/#8)", () => {
  // Feature 49/#8: recogerLote pasa a `$queryRaw ... RETURNING "id"` en un `$transaction`;
  // el count = rows.length y el append cubre EXACTAMENTE los ids retornados (R8).
  function buildRecogerRepo(queryResult: { id: string }[]) {
    const $queryRaw = vi.fn(async () => queryResult);
    const createMany = vi.fn();
    const tx = { $queryRaw, ordenHistorialEstado: { createMany } };
    const $transaction = vi.fn(async (cb: (t: typeof tx) => Promise<number>) => cb(tx));
    const cola = colaFake();
    const repo = new GestionOrdenRepository({ $transaction } as never, cola as never);
    return { repo, $queryRaw, createMany, $transaction, cola, tx };
  }

  it("guardia propiedad + origen en el SQL; devuelve filas afectadas (rows.length)", async () => {
    const { repo, $queryRaw } = buildRecogerRepo([{ id: "o1" }, { id: "o2" }]);

    const n = await repo.recogerLote(
      ["o1", "o2"],
      "m1",
      idEstado("por_recoger"),
      idEstado("en_reparto"),
      DIA_CR,
    );

    expect(n).toBe(2);
    const call = $queryRaw.mock.calls[0] as unknown[];
    const strings = (call[0] as string[]).join(" ");
    const values = call.slice(1);
    // Guardia por propiedad + origen + no borrada en el propio UPDATE.
    expect(strings).toMatch(/mensajero_asignado_id/);
    expect(strings).toMatch(/estatus_id/);
    expect(strings).toMatch(/deleted_at" IS NULL/);
    expect(strings).toMatch(/RETURNING "id"/);
    expect(values).toContain("m1"); // propiedad
    expect(values).toContain(idEstado("por_recoger")); // origen
    expect(values).toContain(idEstado("en_reparto")); // destino en_reparto
  });

  // FEATURE 261 (B5, R1/R8) — LA CUARTA GUARDIA. Ojo con lo que este caso PUEDE y NO PUEDE
  // demostrar: con un doble, el `$queryRaw` no ejecuta nada, asi que esto afirma la FORMA del
  // SQL y el valor del parametro, no que Postgres seleccione las filas que decimos. Eso se
  // prueba contra la base real en `tests/integration/db/recoger-lote-dia-reserva.int.test.ts`
  // — y es esa la que mata las mutaciones M-d y M-e, no esta.
  it("261/R1: el `WHERE` lleva el dia de reparto, y el dia entra como TEXTO con `::date`", async () => {
    const { repo, $queryRaw } = buildRecogerRepo([{ id: "o1" }]);

    await repo.recogerLote(["o1"], "m1", idEstado("por_recoger"), idEstado("en_reparto"), DIA_CR);

    const call = $queryRaw.mock.calls[0] as unknown[];
    const strings = (call[0] as string[]).join(" ");
    const values = call.slice(1);
    // El predicado COPIADO del corte: `(IS NULL OR <= dia)`. Una orden sin dia se recoge (R8).
    expect(strings).toMatch(/"fecha_reparto" IS NULL OR "fecha_reparto" <=/);
    expect(strings).toMatch(/::date/);
    // El dia viaja como `YYYY-MM-DD`, NO como `Date`: un `Date` lo serializa el driver `pg` como
    // `timestamptz` y Postgres lo convierte a `date` con el `TimeZone` DE LA SESION.
    expect(values).toContain("2026-07-20");
    expect(values.some((v) => v instanceof Date)).toBe(false);
    // Y ninguna aritmetica de zona horaria dentro de la sentencia: el dia lo decide el servidor
    // de aplicacion y entra como parametro.
    expect(strings).not.toMatch(/NOW\(\)\s*::\s*date/i);
    expect(strings).not.toMatch(/CURRENT_DATE/i);
    expect(strings).not.toMatch(/AT TIME ZONE/i);
  });

  // Feature 49/#8 (R16/R8): 1 historial por orden recogida (actor = el mensajero); una
  // que perdio la guarda no aparece en el RETURNING -> no deja rastro.
  it("R16/R8: registra historial (recoleccion) solo de los ids retornados", async () => {
    const { repo, createMany } = buildRecogerRepo([{ id: "o1" }]); // solo 1 de 2 gano la guarda

    await repo.recogerLote(["o1", "o2"], "m1", idEstado("por_recoger"), idEstado("en_reparto"), DIA_CR);

    const arg = (createMany.mock.calls[0] as unknown[])[0] as { data: unknown[] };
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("por_recoger"),
        estatusDestinoId: idEstado("en_reparto"),
        actorUsuarioId: "m1", // el mensajero que recoge
        origenTipo: "recoleccion",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  it("lista vacia -> no abre transaccion y devuelve 0", async () => {
    const { repo, $transaction } = buildRecogerRepo([]);
    expect(await repo.recogerLote([], "m1", "a", "b", DIA_CR)).toBe(0);
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe("GestionOrdenRepository.setOrdenEnGestion (R19-R21)", () => {
  it("fija el puntero cuando estaba libre (count>0 -> true)", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const findUnique = vi.fn();
    const repo = new GestionOrdenRepository({
      usuario: { updateMany, findUnique },
    } as never);

    expect(await repo.setOrdenEnGestion("m1", "o1")).toBe(true);
    const arg = (updateMany.mock.calls[0] as unknown[])[0] as { where: { OR: unknown } };
    expect(arg.where.OR).toEqual([{ ordenEnGestionId: null }, { ordenEnGestionId: "o1" }]);
  });

  it("R21: con OTRA orden activa (count 0 y puntero distinto) -> false", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const findUnique = vi.fn(async () => ({ ordenEnGestionId: "o-otra" }));
    const repo = new GestionOrdenRepository({
      usuario: { updateMany, findUnique },
    } as never);

    expect(await repo.setOrdenEnGestion("m1", "o1")).toBe(false);
  });

  it("idempotente: count 0 pero ya apuntaba a la misma orden -> true", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const findUnique = vi.fn(async () => ({ ordenEnGestionId: "o1" }));
    const repo = new GestionOrdenRepository({
      usuario: { updateMany, findUnique },
    } as never);

    expect(await repo.setOrdenEnGestion("m1", "o1")).toBe(true);
  });
});

describe("GestionOrdenRepository.liberarOrdenEnGestion (R35)", () => {
  it("limpia SOLO si el puntero del mismo mensajero apunta a esa orden (count>0 -> true)", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repo = new GestionOrdenRepository({ usuario: { updateMany } } as never);

    expect(await repo.liberarOrdenEnGestion("m1", "o1")).toBe(true);
    const arg = (updateMany.mock.calls[0] as unknown[])[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    // WHERE guardado: solo el propio actor + puntero apuntando a ESA orden.
    expect(arg.where.id).toBe("m1");
    expect(arg.where.ordenEnGestionId).toBe("o1");
    expect(arg.data.ordenEnGestionId).toBeNull();
  });

  it("no limpia si el puntero apunta a otra orden / es de otro actor (count 0 -> false)", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const repo = new GestionOrdenRepository({ usuario: { updateMany } } as never);

    expect(await repo.liberarOrdenEnGestion("m1", "o1")).toBe(false);
    // El WHERE nunca permite tocar el puntero de otro actor u otra orden.
    const arg = (updateMany.mock.calls[0] as unknown[])[0] as { where: Record<string, unknown> };
    expect(arg.where.id).toBe("m1");
    expect(arg.where.ordenEnGestionId).toBe("o1");
  });
});

// ⏳ 2026-09-23 (FICHA 454, T1.4): esta suite medía `crearGestionYTransicionar` (INSERT + UPDATE de
// estado + append al historial). El metodo se SUSTITUYE por `registrarGestionPendiente`: la gestion
// se registra SIN transicion (R1) y el estado real se aplica al aprobar el cierre. Los casos de
// forma de la fila (causa, pagos, fechas, Decimal, atomicidad) se conservan tal cual contra el metodo
// nuevo; los que afirmaban la TRANSICION se invierten a «no hay `orden.update` ni historial» y a la
// FAMILIA DE APLICACION que viaja en el evento `gestion_registrada` (R2/R8). La barrera de
// concurrencia (candado + re-lectura) se mide contra Postgres en
// `tests/integration/db/454/registro-gestion-*-sql-real.test.ts`.
describe("GestionOrdenRepository.registrarGestionPendiente (ficha 454; antes crearGestionYTransicionar)", () => {
  function buildTxRepo(opts: { gestionable?: boolean; eventoCreate?: ReturnType<typeof vi.fn> } = {}) {
    const gestionCreate = vi.fn(async () => ({ id: "g1" }));
    const ordenUpdate = vi.fn(async () => ({}));
    const usuarioUpdate = vi.fn(async () => ({}));
    const historialCreateMany = vi.fn();
    const eventoCreate = opts.eventoCreate ?? vi.fn(async () => ({ id: "ev1" }));
    // Feature 212 (R17): las lineas del desglose del recaudo se insertan por el cliente
    // TRANSACCIONAL. `dentroDeTx` registra si la llamada ocurrio mientras la tx estaba abierta.
    let txAbierta = false;
    const dentroDeTx: boolean[] = [];
    const pagoCreateMany = vi.fn(async () => {
      dentroDeTx.push(txAbierta);
      return { count: 0 };
    });
    // `$queryRaw`: el candado y la re-lectura de «gestionable» devuelven la orden (o nada), y la
    // consulta de suscripcion de webhook no devuelve ninguna (sin encolado).
    const $queryRaw = vi.fn(async (q: { strings?: readonly string[] } | TemplateStringsArray) => {
      const texto = Array.isArray(q) ? q.join(" ") : ((q as { strings?: readonly string[] }).strings ?? []).join(" ");
      if (texto.includes("webhook_suscripcion")) return [];
      if (opts.gestionable === false && texto.includes("order_status")) return [];
      return [{ id: "o1" }];
    });
    const tx = {
      $queryRaw,
      gestionOrden: { create: gestionCreate },
      gestionOrdenPago: { createMany: pagoCreateMany },
      ordenEvento: { create: eventoCreate },
      orden: { update: ordenUpdate },
      usuario: { update: usuarioUpdate },
      ordenHistorialEstado: { createMany: historialCreateMany },
    };
    const $transaction = vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => {
      txAbierta = true;
      try {
        return await cb(tx);
      } finally {
        txAbierta = false;
      }
    });
    const cola = colaFake();
    const repo = new GestionOrdenRepository({ $transaction } as never, cola as never);
    return {
      repo,
      gestionCreate,
      ordenUpdate,
      usuarioUpdate,
      historialCreateMany,
      pagoCreateMany,
      eventoCreate,
      dentroDeTx,
      cola,
      tx,
    };
  }

  it("R1/R2/R5: INSERT gestion + evento + limpiar puntero, SIN tocar el estado de la orden", async () => {
    const { repo, gestionCreate, ordenUpdate, usuarioUpdate, historialCreateMany, eventoCreate } =
      buildTxRepo();

    const r = await repo.registrarGestionPendiente({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: {
        resultado: "entregada",
        montoRecibido: 100,
        metodoPago: "efectivo",
        evidenciaStoragePath: "o1/entregada-1.jpg",
        evidenciaContentType: "image/jpeg",
      },
    });

    expect(r).toEqual({ gestionId: "g1", ordenEventoId: "ev1" });
    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(gArg.data.resultado).toBe("entregada");
    expect(gArg.data.evidenciaStoragePath).toBe("o1/entregada-1.jpg");
    expect((gArg.data.montoRecibido as Prisma.Decimal).toString()).toBe("100");
    // R1: ni `orden.update` ni fila de historial.
    expect(ordenUpdate).not.toHaveBeenCalled();
    expect(historialCreateMany).not.toHaveBeenCalled();
    // R2: el evento, con el actor y su rol congelado.
    expect((eventoCreate.mock.calls[0] as unknown[])[0]).toMatchObject({
      data: {
        ordenId: "o1",
        tipo: "gestion_registrada",
        gestionOrdenId: "g1",
        familiaAplicacion: "gestion",
        resultado: "entregada",
        mensajeroId: "m1",
        actorUsuarioId: "m1",
        actorRol: "mensajero",
      },
    });
    // R19 (36) / R5 (454): libera el puntero de bloqueo dentro de la transaccion.
    expect((usuarioUpdate.mock.calls[0] as unknown[])[0]).toMatchObject({
      where: { id: "m1" },
      data: { ordenEnGestionId: null },
    });
  });

  it("R4: si la orden ya no es gestionable al llegar al candado -> `null` SIN ningun efecto", async () => {
    const { repo, gestionCreate, eventoCreate, usuarioUpdate, pagoCreateMany } = buildTxRepo({
      gestionable: false,
    });
    const r = await repo.registrarGestionPendiente({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "entregada", montoRecibido: 1, metodoPago: "efectivo", pagos: [{ metodo: "efectivo", monto: 1 }] },
    });
    expect(r).toBeNull();
    expect(gestionCreate).not.toHaveBeenCalled();
    expect(pagoCreateMany).not.toHaveBeenCalled();
    expect(eventoCreate).not.toHaveBeenCalled();
    expect(usuarioUpdate).not.toHaveBeenCalled();
  });

  it("R26: reprogramada persiste fecha (DATE) y motivo, sin evidencia", async () => {
    const { repo, gestionCreate } = buildTxRepo();
    await repo.registrarGestionPendiente({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "reprogramada", fechaReprogramacion: "2027-01-01", motivo: "x" },
    });
    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(gArg.data.fechaReprogramacion).toBeInstanceOf(Date);
    expect(gArg.data.evidenciaStoragePath).toBeNull();
    expect(gArg.data.montoRecibido).toBeNull();
  });

  it("158/R9: el INSERT de la gestion lleva la causa del incidente en su columna propia", async () => {
    const { repo, gestionCreate } = buildTxRepo();

    await repo.registrarGestionPendiente({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: {
        resultado: "incidente",
        causaIncidente: "robado",
        motivo: "me asaltaron en la parada",
      },
    });

    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(gArg.data.resultado).toBe("incidente");
    expect(gArg.data.causaIncidente).toBe("robado");
    expect(gArg.data.motivo).toBe("me asaltaron en la parada");
    // R22 (158): el monto de la indemnizacion NO se escribe al reportar.
    expect(gArg.data).not.toHaveProperty("indemnizacion");
    expect(gArg.data.montoRecibido).toBeNull();
    expect(gArg.data.metodoPago).toBeNull();
    expect(gArg.data.causaDevolucion).toBeNull();
  });

  // ⏳ 2026-09-23 (FICHA 454, R8): antes «el historial de la transicion usa la familia `incidente`».
  // Ya no hay transicion al registrar: la familia viaja en el EVENTO y es la que la aprobacion usara.
  it("R8: el incidente se registra con familia de aplicacion `incidente`; los otros cuatro con `gestion`", async () => {
    const { repo, eventoCreate } = buildTxRepo();
    await repo.registrarGestionPendiente({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "incidente", causaIncidente: "danado", motivo: "caja aplastada" },
    });
    expect((eventoCreate.mock.calls[0] as unknown[])[0]).toMatchObject({
      data: { familiaAplicacion: "incidente", motivo: "danado" },
    });
    for (const resultado of ["entregada", "reprogramada", "devuelta"] as const) {
      const b = buildTxRepo();
      await b.repo.registrarGestionPendiente({
        ordenId: "o1",
        mensajeroId: "m1",
        gestion: { resultado, motivo: "x", fechaReprogramacion: "2099-01-01" },
      });
      expect(
        ((b.eventoCreate.mock.calls[0] as unknown[])[0] as { data: { familiaAplicacion: string } }).data
          .familiaAplicacion,
        resultado,
      ).toBe("gestion");
    }
  });

  it("R2: el evento guarda la causa TIPIFICADA y nunca el texto libre del mensajero", async () => {
    const { repo, eventoCreate } = buildTxRepo();
    await repo.registrarGestionPendiente({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "devuelta", causaDevolucion: "wrong_number", motivo: "telefono errado" },
    });
    const data = ((eventoCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> }).data;
    expect(data.motivo).toBe("wrong_number");
    expect(JSON.stringify(data)).not.toContain("telefono errado");
  });

  // --- Feature 73 (R11/R12/R13): la causa llega al INSERT, dentro de la MISMA tx ---

  it("R11: devuelta con causa -> el INSERT lleva `causaDevolucion` en su columna propia", async () => {
    const { repo, gestionCreate } = buildTxRepo();

    await repo.registrarGestionPendiente({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "devuelta", causaDevolucion: "wrong_number", motivo: "telefono errado" },
    });

    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(gArg.data.causaDevolucion).toBe("wrong_number");
    // R12: el texto libre se persiste tal cual, sin decorarlo con la causa.
    expect(gArg.data.motivo).toBe("telefono errado");
  });

  it("R13: si el evento falla, el INSERT con causa no se confirma (atomicidad)", async () => {
    // ⏳ 2026-09-23 (FICHA 454): antes «si el append de la transicion falla». Sin transicion, el
    // paso posterior al INSERT que puede fallar es el evento: la tx revierte igual.
    const eventoCreate = vi.fn(async () => {
      throw new Error("evento falla");
    });
    const { repo } = buildTxRepo({ eventoCreate });

    await expect(
      repo.registrarGestionPendiente({
        ordenId: "o1",
        mensajeroId: "m1",
        gestion: { resultado: "devuelta", causaDevolucion: "wrong_address", motivo: "x" },
      }),
    ).rejects.toThrow("evento falla");
  });

  it("R10/R16: una rama sin causa -> la columna se escribe NULL (nunca undefined)", async () => {
    const { repo, gestionCreate } = buildTxRepo();

    await repo.registrarGestionPendiente({
      ordenId: "o1",
      mensajeroId: "m1",
      // ⏳ 2026-09-23 (FICHA 454): antes `rechazada`; su aviso N1 sale ahora en este metodo y
      // necesitaria el cliente de notificaciones. `reprogramada` es igual de «sin causa».
      gestion: { resultado: "reprogramada", fechaReprogramacion: "2099-01-01", motivo: "otro dia" },
    });

    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(gArg.data.causaDevolucion).toBeNull();
  });

  // --- Feature 212 (R17/R20): el DESGLOSE del recaudo, en la MISMA transaccion --------------

  it("212/R17: las lineas se insertan con el cliente de la MISMA tx, tras crear la gestion", async () => {
    const { repo, pagoCreateMany, dentroDeTx } = buildTxRepo();

    await repo.registrarGestionPendiente({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: {
        resultado: "entregada",
        montoRecibido: 8000,
        metodoPago: null, // R19: mixta -> la columna deprecada va NULL
        pagos: [
          { metodo: "efectivo", monto: 5000 },
          { metodo: "transferencia", monto: 3000 },
        ],
      },
    });

    expect(pagoCreateMany).toHaveBeenCalledTimes(1);
    expect(dentroDeTx).toEqual([true]);
    const arg = (pagoCreateMany.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown>[] };
    expect(arg.data).toHaveLength(2);
    expect(arg.data[0].gestionId).toBe("g1");
    expect(arg.data[1].gestionId).toBe("g1");
    expect(arg.data[0].metodo).toBe("efectivo");
    expect(arg.data[1].metodo).toBe("transferencia");
  });

  it("212/R20: el monto de cada linea entra como Prisma.Decimal, nunca como float", async () => {
    const { repo, pagoCreateMany } = buildTxRepo();

    await repo.registrarGestionPendiente({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: {
        resultado: "entregada",
        montoRecibido: 99.99,
        metodoPago: null,
        pagos: [
          { metodo: "efectivo", monto: 66.66 },
          { metodo: "SINPE", monto: 33.33 },
        ],
      },
    });

    const arg = (pagoCreateMany.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown>[] };
    for (const fila of arg.data) {
      expect(fila.monto).toBeInstanceOf(Prisma.Decimal);
    }
    expect((arg.data[0].monto as Prisma.Decimal).toString()).toBe("66.66");
    expect((arg.data[1].monto as Prisma.Decimal).toString()).toBe("33.33");
    const suma = (arg.data[0].monto as Prisma.Decimal).plus(arg.data[1].monto as Prisma.Decimal);
    expect(suma.toString()).toBe("99.99");
  });

  it("212/R17: si el evento falla, la tx se revierte con las lineas dentro", async () => {
    const eventoCreate = vi.fn(async () => {
      throw new Error("evento falla");
    });
    const { repo, pagoCreateMany, dentroDeTx } = buildTxRepo({ eventoCreate });

    await expect(
      repo.registrarGestionPendiente({
        ordenId: "o1",
        mensajeroId: "m1",
        gestion: {
          resultado: "entregada",
          montoRecibido: 5000,
          metodoPago: "efectivo",
          pagos: [{ metodo: "efectivo", monto: 5000 }],
        },
      }),
    ).rejects.toThrow("evento falla");

    expect(dentroDeTx).toEqual([true]);
    expect(pagoCreateMany).toHaveBeenCalledTimes(1);
  });

  it("212/R14: lista de pagos VACIA -> no se inserta ninguna linea", async () => {
    const { repo, pagoCreateMany, gestionCreate } = buildTxRepo();

    await repo.registrarGestionPendiente({
      ordenId: "o1",
      mensajeroId: "m1",
      gestion: { resultado: "entregada", montoRecibido: 0, metodoPago: null, pagos: [] },
    });

    expect(pagoCreateMany).not.toHaveBeenCalled();
    const gArg = (gestionCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect((gArg.data.montoRecibido as Prisma.Decimal).toString()).toBe("0");
    expect(gArg.data.metodoPago).toBeNull();
  });

  it("212/R5: una gestion sin `pagos` (rama sin recaudo) no toca la tabla del desglose", async () => {
    const { repo, pagoCreateMany } = buildTxRepo();

    await repo.registrarGestionPendiente({
      ordenId: "o1",
      mensajeroId: "m1",
      // ⏳ 2026-09-23 (FICHA 454): antes `rechazada` (ver la nota del caso R10/R16).
      gestion: { resultado: "devuelta", causaDevolucion: "not_found", motivo: "no aparece" },
    });

    expect(pagoCreateMany).not.toHaveBeenCalled();
  });
});
