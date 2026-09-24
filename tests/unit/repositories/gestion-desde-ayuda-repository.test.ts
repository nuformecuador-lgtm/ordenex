import { beforeEach, describe, expect, it, vi } from "vitest";

import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 237 (T5.1, R2/R3/R4/R5/R9/R10/R18/R24/R25/R28) — `crearGestionDesdeAyuda` con Prisma
// mockeado (sin DB, mismo patron que `gestion-orden-evidencia.test.ts`).
//
// ⏳ 2026-09-23 (FICHA 454, T1.15; design §4.2/§5) — LA FORMA DE LA ESCRITURA CAMBIA, Y ESTA SUITE
// CON ELLA. La ayuda deja de ser el estado `ayuda_tienda`: la orden sigue `en_reparto` con la ayuda
// ABIERTA (derivacion de `ayuda-abierta.ts`), y la gestion de la tienda queda PENDIENTE de confirmar
// —sin transicion— hasta que la aprobacion del cierre del mensajero la aplica. Por eso:
//   - la guarda de la carrera ya no es un `updateMany` guardado por estatus: es el CANDADO de la fila
//     (`SELECT … FOR UPDATE`) y la RE-LECTURA de «ayuda abierta + suya + dia» en una sentencia
//     posterior. La SEMANTICA de esa barrera se mide contra Postgres en
//     `tests/integration/db/454/ayuda-evento-sql-real.test.ts` y `gestion-desde-ayuda-dia-reserva`;
//     aqui se afirma que va ANTES de escribir y que perderla no deja NI UN efecto (R25/R28);
//   - el historial de estados NO se escribe: quien la registro y con que familia viajan en el
//     evento `gestion_registrada` (actor = la tienda, familia `gestion_tienda_ayuda`, R4/R5), que
//     es con el que la aprobacion escribira la transicion.
// Lo que NO cambia y aqui sigue afirmado caso por caso: 💰 la fila se atribuye AL MENSAJERO, nace
// sin cierre y sin importes (R3/R9/R11), su forma es la del mensajero (R2), las evidencias van en la
// misma tx (R15), sin ubicacion (R18), sin tocar el puntero del mensajero (R10) y sin reoptimizar.

function colaFake() {
  return {
    enqueue: vi.fn(async () => null),
    claimBatch: vi.fn(async () => []),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    findByDedupeKeys: vi.fn(async () => []),
  };
}

type Sql = { strings?: readonly string[] };
const textoDe = (q: Sql | readonly string[]) =>
  Array.isArray(q) ? q.join(" ") : ((q as Sql).strings ?? []).join(" ");

function buildTxRepo(overrides: { admite?: () => boolean } = {}) {
  const admite = overrides.admite ?? (() => true);
  const orden: string[] = [];
  // `$queryRaw`: (1) el candado `FOR UPDATE`, (2) la re-lectura de «ayuda abierta», y (3) la
  // consulta de suscripcion del encolado del webhook (sin suscripcion en esta suite).
  const $queryRaw = vi.fn(async (q: Sql) => {
    const t = textoDe(q);
    if (t.includes("FOR UPDATE")) {
      orden.push("candado");
      return [{ id: "o1" }];
    }
    if (t.includes("webhook_suscripcion")) return [];
    orden.push("relectura");
    return admite() ? [{ id: "o1" }] : [];
  });
  const gestionCreate = vi.fn(async () => {
    orden.push("gestion");
    return { id: "g-ayuda" };
  });
  const evidenciaCreateMany = vi.fn(async () => ({ count: 0 }));
  const pagoCreateMany = vi.fn(async () => ({ count: 0 }));
  const ordenUpdate = vi.fn(async () => ({}));
  const ordenUpdateMany = vi.fn(async () => ({ count: 1 }));
  const usuarioUpdate = vi.fn(async () => ({}));
  const historialCreateMany = vi.fn(async () => ({ count: 1 }));
  const eventoCreate = vi.fn(async () => ({ id: "ev-ayuda" }));
  const tx = {
    $queryRaw,
    orden: { update: ordenUpdate, updateMany: ordenUpdateMany },
    gestionOrden: { create: gestionCreate },
    gestionOrdenEvidencia: { createMany: evidenciaCreateMany },
    gestionOrdenPago: { createMany: pagoCreateMany },
    usuario: { update: usuarioUpdate },
    ordenHistorialEstado: { createMany: historialCreateMany },
    ordenEvento: { create: eventoCreate },
  };
  const $transaction = vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
  const cola = colaFake();
  const repo = new GestionOrdenRepository({ $transaction } as never, cola as never);
  return {
    repo,
    orden,
    $queryRaw,
    gestionCreate,
    evidenciaCreateMany,
    pagoCreateMany,
    ordenUpdate,
    ordenUpdateMany,
    usuarioUpdate,
    historialCreateMany,
    eventoCreate,
    $transaction,
    cola,
  };
}

const EVIDENCIAS = [
  {
    storagePath: "o1/ayuda-rechazada-1-0.jpg",
    contentType: "image/jpeg",
    indice: 0,
  },
  {
    storagePath: "o1/ayuda-rechazada-1-1.png",
    contentType: "image/png",
    indice: 1,
  },
];

/** Feature 261 (B17): el DIA DE COSTA RICA EN CURSO que el servicio resuelve y pasa a la escritura. */
const DIA_CR = new Date("2026-08-21T00:00:00.000Z");

/** El caso base: la tienda RECHAZA. Los dos ids de usuario son personas distintas. */
const INPUT = {
  ordenId: "o1",
  mensajeroId: "mensajero-1", // 💰 R3: a quien se ATRIBUYE
  actorUsuarioId: "tienda-1", // R4: quien la REGISTRA
  diaEnCurso: DIA_CR, // feature 261 (R30): la segunda capa del bloqueo por reserva
  gestion: {
    resultado: "rechazada" as const,
    motivo: "el cliente no la quiere",
    evidencias: EVIDENCIAS,
  },
};

const INPUT_REPROGRAMADA = {
  ...INPUT,
  gestion: {
    resultado: "reprogramada" as const,
    motivo: "el cliente pidio otro dia",
    fechaReprogramacion: "2027-01-05",
    evidencias: EVIDENCIAS,
  },
};

beforeEach(async () => {
  await sembrarCatalogoEstados();
});

/* -------------------------------------------------------------------------- */
/* (a) R24 — la barrera va ANTES de escribir, bajo candado                      */
/* -------------------------------------------------------------------------- */

describe("crearGestionDesdeAyuda — la barrera va antes de escribir (R24; ficha 454)", () => {
  it("R24 + 261/R30: candado de la fila y RE-LECTURA (ayuda abierta, suya, dia) ANTES de la gestion", async () => {
    const { repo, orden, $queryRaw } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);

    expect(orden.slice(0, 3)).toEqual(["candado", "relectura", "gestion"]);
    const relectura = textoDe(($queryRaw.mock.calls as unknown as Sql[][])[1][0]);
    // El dia entra como TEXTO con `::date` (SQL crudo) y la condicion de reserva es la del corte.
    expect(relectura).toContain('"fecha_reparto" IS NULL OR "o"."fecha_reparto" <=');
    expect(relectura).toContain('"mensajero_asignado_id" =');
    expect(relectura).toContain('"deleted_at" IS NULL');
  });

  it("💰 R10/R11 (454): la orden NO se escribe — ni `updateMany` ni `update` (sin transicion)", async () => {
    const { repo, ordenUpdate, ordenUpdateMany } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);
    expect(ordenUpdateMany).not.toHaveBeenCalled();
    expect(ordenUpdate).not.toHaveBeenCalled();
  });

  it("todo ocurre bajo UNA sola `$transaction` (todo-o-nada)", async () => {
    const { repo, $transaction } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* (b) R25/R28 — carrera perdida: NI UN efecto                                  */
/* -------------------------------------------------------------------------- */

describe("crearGestionDesdeAyuda — sin ayuda abierta no deja NI UN rastro (R25/R28)", () => {
  it("devuelve `null` y no crea gestion, ni evidencias, ni evento, ni historial", async () => {
    const { repo, gestionCreate, evidenciaCreateMany, historialCreateMany, eventoCreate } =
      buildTxRepo({ admite: () => false });

    const r = await repo.crearGestionDesdeAyuda(INPUT);

    expect(r).toBeNull();
    expect(gestionCreate).not.toHaveBeenCalled();
    expect(evidenciaCreateMany).not.toHaveBeenCalled();
    expect(eventoCreate).not.toHaveBeenCalled();
    expect(historialCreateMany).not.toHaveBeenCalled();
  });

  it("R28: el SEGUNDO envio simultaneo encuentra la ayuda ya cerrada y no crea una segunda", async () => {
    // La idempotencia sale por CONSTRUCCION de la barrera: el primero deja una gestion pendiente, y
    // con ella la ayuda deja de estar abierta; el segundo la re-lee bajo candado y no pasa.
    let intento = 0;
    const { repo, gestionCreate } = buildTxRepo({ admite: () => ++intento === 1 });

    const primero = await repo.crearGestionDesdeAyuda(INPUT);
    const segundo = await repo.crearGestionDesdeAyuda(INPUT);

    expect(primero).toBe("g-ayuda");
    expect(segundo).toBeNull();
    expect(gestionCreate).toHaveBeenCalledTimes(1); // UNA gestion, no dos
  });
});

/* -------------------------------------------------------------------------- */
/* (c) 💰 R2/R3/R9 — la fila: a quien se atribuye y en que cierre cae           */
/* -------------------------------------------------------------------------- */

function dataDe(gestionCreate: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return (gestionCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
}

describe("crearGestionDesdeAyuda — la fila que cobra el dinero (R2/R3/R9)", () => {
  it("💰 R3: `mensajero_id` es EL MENSAJERO de la orden, NO el actor que la registro", async () => {
    // ESTE es el caso que sostiene la ficha entera. `crearCierre` vincula por
    // `{ mensajeroId, cierreId: null, anuladaAt: null }`: con el id de la tienda aqui, la gestion no
    // se vincularia a NINGUN cierre nunca y quedaria fuera de los cinco feeds de dinero.
    const { repo, gestionCreate } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);
    const data = dataDe(gestionCreate);
    expect(data.mensajeroId).toBe("mensajero-1");
    expect(data.mensajeroId).not.toBe("tienda-1");
  });

  it("💰 R9: la gestion nace con `cierre_id` NULO — la vincula el MISMO mecanismo que las del mensajero", async () => {
    const { repo, gestionCreate } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);
    const data = dataDe(gestionCreate);
    expect(data).not.toHaveProperty("cierreId");
    expect(data).not.toHaveProperty("anuladaAt");
  });

  it("💰 R11: la fila NO lleva ningun importe (ni monto recibido, ni ingreso, ni pago)", async () => {
    const { repo, gestionCreate, pagoCreateMany } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);
    const data = dataDe(gestionCreate);
    expect(data.montoRecibido).toBeNull();
    expect(data.metodoPago).toBeNull();
    expect(data).not.toHaveProperty("ingresoBodegaRechazo");
    expect(data).not.toHaveProperty("pagoMensajero");
    expect(pagoCreateMany).not.toHaveBeenCalled();
  });

  it("R2: `rechazada` produce la MISMA forma de fila que la del mensajero para ese resultado", async () => {
    const { repo, gestionCreate } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);
    const data = dataDe(gestionCreate);
    expect(data).toMatchObject({
      ordenId: "o1",
      mensajeroId: "mensajero-1",
      resultado: "rechazada",
      motivo: "el cliente no la quiere",
    });
    expect(data.fechaReprogramacion).toBeNull();
  });

  it("R2: `reprogramada` persiste la fecha como DATE a medianoche UTC (mismo trato que el mensajero)", async () => {
    const { repo, gestionCreate } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT_REPROGRAMADA);
    const data = dataDe(gestionCreate);
    expect(data.resultado).toBe("reprogramada");
    expect(data.fechaReprogramacion).toEqual(new Date("2027-01-05T00:00:00.000Z"));
  });

  it("R2/R15: las N evidencias se insertan en la MISMA tx, con su indice, y la 0 es la portada", async () => {
    const { repo, evidenciaCreateMany, gestionCreate } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);

    expect(evidenciaCreateMany).toHaveBeenCalledTimes(1);
    const filas = (evidenciaCreateMany.mock.calls[0] as unknown[])[0] as { data: unknown[] };
    expect(filas.data).toEqual([
      { gestionId: "g-ayuda", storagePath: "o1/ayuda-rechazada-1-0.jpg", contentType: "image/jpeg", indice: 0 },
      { gestionId: "g-ayuda", storagePath: "o1/ayuda-rechazada-1-1.png", contentType: "image/png", indice: 1 },
    ]);
    const data = dataDe(gestionCreate);
    expect(data.evidenciaStoragePath).toBe("o1/ayuda-rechazada-1-0.jpg");
    expect(data.evidenciaContentType).toBe("image/jpeg");
  });

  it("R18: NO escribe ubicacion — la tienda gestiona desde un escritorio", async () => {
    const { repo, gestionCreate } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);
    const data = dataDe(gestionCreate);
    expect(data.ubicacionLat).toBeNull();
    expect(data.ubicacionLng).toBeNull();
    expect(data.ubicacionAusencia).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* (d) R4/R5 (454) — quien la registro y con que familia, en el EVENTO          */
/* -------------------------------------------------------------------------- */

describe("crearGestionDesdeAyuda — el evento dice la verdad (R4/R5; ficha 454)", () => {
  it("R4/R5: evento `gestion_registrada`, actor = LA TIENDA, familia `gestion_tienda_ayuda`; SIN historial", async () => {
    const { repo, eventoCreate, historialCreateMany } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);

    expect(historialCreateMany).not.toHaveBeenCalled();
    expect(eventoCreate).toHaveBeenCalledTimes(1);
    expect((eventoCreate.mock.calls[0] as unknown[])[0]).toMatchObject({
      data: {
        ordenId: "o1",
        tipo: "gestion_registrada",
        gestionOrdenId: "g-ayuda",
        // R5: la familia con la que la APROBACION escribira la transicion — la que la hace contar
        // como intento (237/R6) y la que dice «la resolvio la tienda» al deshacer (D3).
        familiaAplicacion: "gestion_tienda_ayuda",
        resultado: "rechazada",
        mensajeroId: "mensajero-1",
        // R4: la UNICA evidencia de quien decidio el rechazo que se le cobra a la tienda.
        actorUsuarioId: "tienda-1",
        actorRol: "adminTienda",
      },
    });
  });

  it("R5: `reprogramada` usa la MISMA familia", async () => {
    const { repo, eventoCreate } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT_REPROGRAMADA);
    expect((eventoCreate.mock.calls[0] as unknown[])[0]).toMatchObject({
      data: { familiaAplicacion: "gestion_tienda_ayuda", resultado: "reprogramada" },
    });
  });
});

/* -------------------------------------------------------------------------- */
/* (e) R10 — lo que NO toca                                                     */
/* -------------------------------------------------------------------------- */

describe("crearGestionDesdeAyuda — lo que NO toca (R10)", () => {
  it("R10: `usuario.update` NO se llama — copiar ese bloque le arrancaria OTRA orden al mensajero", async () => {
    const { repo, usuarioUpdate } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);
    expect(usuarioUpdate).not.toHaveBeenCalled();
  });

  it("no encola reoptimizacion de ruta (la orden salio de la ruta al pedir ayuda)", async () => {
    const { repo, cola } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);
    expect(cola.enqueue).not.toHaveBeenCalled();
  });
});
