import { beforeEach, describe, expect, it, vi } from "vitest";

import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 237 (T5.1, R2/R3/R4/R5/R9/R10/R18/R24/R25/R28) — `crearGestionDesdeAyuda` con Prisma
// mockeado (sin DB, mismo patron que `gestion-orden-evidencia.test.ts` y
// `gestion-orden-reprogramar.test.ts`).
//
// Es LA ESCRITURA de la ficha mas delicada en dinero de la pila, asi que aqui se mira la FORMA
// EXACTA de cada sentencia, no solo el resultado:
//   - el `where` del `updateMany` (R24: la guarda de la carrera vive AHI y no en el service);
//   - el `data` del `updateMany` (R10/R11: SOLO `estatusId`);
//   - `mensajero_id` = EL MENSAJERO y `cierre_id` NULO (💰 R3/R9: es lo que mete la fila en el
//     cierre del mensajero y lo que hace que el dinero salga solo por los cinco feeds);
//   - el actor y la familia del append (R4/R5);
//   - y que `usuario.update` NO se llame (R10), que es el fallo que copiar
//     `crearGestionYTransicionar` habria traido.
//
// El catalogo de estados se siembra porque la guardia del choke point (140) es de FALLO CERRADO:
// valida el par `ayuda_tienda -> reprogramada|rechazada` contra `TRANSICIONES` de verdad. Si las
// aristas #65/#66 no estuvieran declaradas, estos casos reventarian aqui — que es justo lo que se
// quiere.

function colaFake() {
  return {
    enqueue: vi.fn(async () => null),
    claimBatch: vi.fn(async () => []),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    findByDedupeKeys: vi.fn(async () => []),
  };
}

function buildTxRepo(overrides: { updateManyCount?: number } = {}) {
  const ordenUpdateMany = vi.fn(async () => ({
    count: overrides.updateManyCount ?? 1,
  }));
  const gestionCreate = vi.fn(async () => ({ id: "g-ayuda" }));
  const evidenciaCreateMany = vi.fn(async () => ({ count: 0 }));
  const pagoCreateMany = vi.fn(async () => ({ count: 0 }));
  const ordenUpdate = vi.fn(async () => ({}));
  const ordenFindFirst = vi.fn(async () => ({
    estatusId: idEstado("ayuda_tienda"),
  }));
  const usuarioUpdate = vi.fn(async () => ({}));
  const historialCreateMany = vi.fn(async () => ({ count: 1 }));
  const tx = {
    orden: {
      updateMany: ordenUpdateMany,
      update: ordenUpdate,
      findFirst: ordenFindFirst,
    },
    gestionOrden: { create: gestionCreate },
    gestionOrdenEvidencia: { createMany: evidenciaCreateMany },
    gestionOrdenPago: { createMany: pagoCreateMany },
    usuario: { update: usuarioUpdate },
    ordenHistorialEstado: { createMany: historialCreateMany },
  };
  const $transaction = vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
  const repo = new GestionOrdenRepository({ $transaction } as never, colaFake() as never);
  return {
    repo,
    ordenUpdateMany,
    gestionCreate,
    evidenciaCreateMany,
    pagoCreateMany,
    ordenUpdate,
    usuarioUpdate,
    historialCreateMany,
    $transaction,
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

/**
 * Feature 261 (B17): el DIA DE COSTA RICA EN CURSO que el servicio resuelve y pasa a la
 * escritura (convencion `@db.Date`). Aqui entra como `Date` —no como texto— porque el `where`
 * es de Prisma, que conoce el tipo de la columna.
 */
const DIA_CR = new Date("2026-08-21T00:00:00.000Z");

/** El caso base: la tienda RECHAZA. Los dos ids de usuario son personas distintas. */
const INPUT = {
  ordenId: "o1",
  estatusAyudaId: idEstado("ayuda_tienda"),
  estatusDestinoId: idEstado("rechazada"),
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
  estatusDestinoId: idEstado("reprogramada"),
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
/* (a) R24 — la guarda de la carrera vive EN EL WHERE                           */
/* -------------------------------------------------------------------------- */

describe("crearGestionDesdeAyuda — la guarda va en el WHERE que muta (R24)", () => {
  it("R24 + 261/R30: el `where` del `updateMany` lleva estado, borrado y DIA DE REPARTO", async () => {
    // El literal ES el contrato: cualquier condicion de mas o de menos cambia QUE filas puede tocar
    // la tienda. Si `estatusId` desapareciera (mutacion T8.3), la tienda podria resolver una orden
    // que el mensajero ya recupero o que el corte de la noche ya se llevo — y sobre esa fila hay
    // DOS actores, asi que no es un caso hipotetico.
    //
    // FEATURE 261 (B17, R30): + el `OR` del dia. Con un doble esto afirma la FORMA del `where`,
    // no que Postgres seleccione las filas que decimos: eso lo prueba
    // `tests/integration/db/gestion-desde-ayuda-dia-reserva.int.test.ts`, y es esa la que mata
    // la mutacion M-o.
    const { repo, ordenUpdateMany } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);

    const arg = (ordenUpdateMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      where: unknown;
      data: unknown;
    };
    expect(arg.where).toEqual({
      id: "o1",
      estatusId: idEstado("ayuda_tienda"),
      deletedAt: null,
      // Predicado COPIADO del corte, no reinventado: `NULL` entra por la primera rama (una orden
      // sin dia se resuelve igual que siempre) y es `lte` —no `lt`— porque una orden reservada
      // para HOY es de hoy.
      OR: [{ fechaReparto: null }, { fechaReparto: { lte: DIA_CR } }],
    });
  });

  it("💰 R10/R11: el `data` del `updateMany` toca UNICAMENTE `estatusId`", async () => {
    // Money-safe y R10 a la vez: ni mensajero asignado, ni prioridad, ni un solo importe. Si esta
    // sentencia creciera, la tienda estaria escribiendo columnas de la orden que no decidio.
    const { repo, ordenUpdateMany } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);

    const arg = (ordenUpdateMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data).toEqual({ estatusId: idEstado("rechazada") });
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

describe("crearGestionDesdeAyuda — `count = 0` no deja NI UN rastro (R25/R28)", () => {
  it("devuelve `null` y no crea gestion, ni evidencias, ni historial", async () => {
    const { repo, gestionCreate, evidenciaCreateMany, historialCreateMany } = buildTxRepo({
      updateManyCount: 0,
    });

    const r = await repo.crearGestionDesdeAyuda(INPUT);

    expect(r).toBeNull();
    expect(gestionCreate).not.toHaveBeenCalled();
    expect(evidenciaCreateMany).not.toHaveBeenCalled();
    expect(historialCreateMany).not.toHaveBeenCalled();
  });

  it("R28: el SEGUNDO envio simultaneo encuentra la orden fuera de ayuda y no crea una segunda", async () => {
    // La idempotencia sale por CONSTRUCCION de la guarda del WHERE: no hay codigo de idempotencia
    // que pueda divergir de ella. Se simula el par de envios: el primero gana la guarda, el
    // segundo la pierde.
    let intento = 0;
    const ordenUpdateMany = vi.fn(async () => ({
      count: ++intento === 1 ? 1 : 0,
    }));
    const gestionCreate = vi.fn(async () => ({ id: "g-ayuda" }));
    const tx = {
      orden: {
        updateMany: ordenUpdateMany,
        update: vi.fn(),
        findFirst: vi.fn(),
      },
      gestionOrden: { create: gestionCreate },
      gestionOrdenEvidencia: { createMany: vi.fn(async () => ({ count: 0 })) },
      gestionOrdenPago: { createMany: vi.fn(async () => ({ count: 0 })) },
      usuario: { update: vi.fn() },
      ordenHistorialEstado: { createMany: vi.fn(async () => ({ count: 1 })) },
    };
    const repo = new GestionOrdenRepository(
      {
        $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
      } as never,
      colaFake() as never,
    );

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

describe("crearGestionDesdeAyuda — la fila que cobra el dinero (R2/R3/R9)", () => {
  it("💰 R3: `mensajero_id` es EL MENSAJERO de la orden, NO el actor que la registro", async () => {
    // ESTE es el caso que sostiene la ficha entera. `crearCierre` vincula por
    // `{ mensajeroId, cierreId: null, anuladaAt: null }` y `findGestionesPendientes` filtra igual:
    // con el id de la tienda aqui, la gestion no se vincularia a NINGUN cierre nunca, quedaria
    // fuera de los cinco feeds de dinero, fuera del snapshot, fuera del escaneo de la confirmacion
    // fisica (238) y fuera del conteo de intentos. La ficha dejaria de cumplirse sin que nada
    // fallara. Es la mutacion T8.1.
    const { repo, gestionCreate } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);

    const data = (
      (gestionCreate as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;
    expect(data.mensajeroId).toBe("mensajero-1");
    expect(data.mensajeroId).not.toBe("tienda-1");
  });

  it("💰 R9: la gestion nace con `cierre_id` NULO — la vincula el MISMO mecanismo que las del mensajero", async () => {
    const { repo, gestionCreate } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);

    const data = (
      (gestionCreate as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;
    // `cierreId` no se escribe EN ABSOLUTO: la columna es nullable y su default es NULL, que es
    // exactamente lo que `crearCierre` busca (`{ mensajeroId, cierreId: null, anuladaAt: null }`)
    // para vincularla. Escribir cualquier valor aqui seria un camino propio, y R9 pide justo lo
    // contrario: que la vincule EL MISMO mecanismo que las del mensajero.
    expect(data).not.toHaveProperty("cierreId");
    // Y la fila tampoco nace anulada: si naciera, no entraria en ningun cierre ni contaria.
    expect(data).not.toHaveProperty("anuladaAt");
  });

  it("💰 R11: la fila NO lleva ningun importe (ni monto recibido, ni ingreso, ni pago)", async () => {
    const { repo, gestionCreate, pagoCreateMany } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);

    const data = (
      (gestionCreate as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;
    expect(data.montoRecibido).toBeNull();
    expect(data.metodoPago).toBeNull();
    expect(data).not.toHaveProperty("ingresoBodegaRechazo");
    expect(data).not.toHaveProperty("pagoMensajero");
    // Y ni una linea de desglose de recaudo: esta via no cobra al cliente.
    expect(pagoCreateMany).not.toHaveBeenCalled();
  });

  it("R2: `rechazada` produce la MISMA forma de fila que la del mensajero para ese resultado", async () => {
    const { repo, gestionCreate } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);

    const data = (
      (gestionCreate as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;
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

    const data = (
      (gestionCreate as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;
    expect(data.resultado).toBe("reprogramada");
    expect(data.fechaReprogramacion).toEqual(new Date("2027-01-05T00:00:00.000Z"));
  });

  it("R2/R15: las N evidencias se insertan en la MISMA tx, con su indice, y la 0 es la portada", async () => {
    const { repo, evidenciaCreateMany, gestionCreate } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);

    expect(evidenciaCreateMany).toHaveBeenCalledTimes(1);
    const filas = (
      (evidenciaCreateMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        data: unknown[];
      }
    ).data;
    expect(filas).toEqual([
      {
        gestionId: "g-ayuda",
        storagePath: "o1/ayuda-rechazada-1-0.jpg",
        contentType: "image/jpeg",
        indice: 0,
      },
      {
        gestionId: "g-ayuda",
        storagePath: "o1/ayuda-rechazada-1-1.png",
        contentType: "image/png",
        indice: 1,
      },
    ]);
    // Dual-write de la portada (119/R12): los consumidores que muestran UNA foto siguen viendo la
    // del indice 0 sin cambios, tambien para las gestiones de la tienda.
    const data = (
      (gestionCreate as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;
    expect(data.evidenciaStoragePath).toBe("o1/ayuda-rechazada-1-0.jpg");
    expect(data.evidenciaContentType).toBe("image/jpeg");
  });

  it("R18: NO escribe ubicacion — la tienda gestiona desde un escritorio", async () => {
    const { repo, gestionCreate } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);

    const data = (
      (gestionCreate as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        data: Record<string, unknown>;
      }
    ).data;
    expect(data.ubicacionLat).toBeNull();
    expect(data.ubicacionLng).toBeNull();
    expect(data.ubicacionAusencia).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* (d) R4/R5 — el append: quien la registro y con que familia                   */
/* -------------------------------------------------------------------------- */

describe("crearGestionDesdeAyuda — el historial dice la verdad (R4/R5)", () => {
  it("R4/R5: actor = LA TIENDA, familia `gestion_tienda_ayuda`, origen = el estatus de ayuda", async () => {
    const { repo, historialCreateMany } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);

    expect(historialCreateMany).toHaveBeenCalledTimes(1);
    const filas = (
      (historialCreateMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        data: Record<string, unknown>[];
      }
    ).data;
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      ordenId: "o1",
      estatusOrigenId: idEstado("ayuda_tienda"),
      estatusDestinoId: idEstado("rechazada"),
      // R4: el historial es la UNICA evidencia de quien decidio el rechazo que se le cobra a la
      // tienda. Si aqui fuera el mensajero, el sistema le atribuiria un acto que no hizo.
      actorUsuarioId: "tienda-1",
      // R5: familia propia. Es la que hace que la gestion cuente como intento (R6) sin que el
      // historial mienta, y la que permite responder «¿puede el mensajero deshacerla?» (D3).
      origenTipo: "gestion_tienda_ayuda",
      motivo: "el cliente no la quiere",
      gestionOrdenId: "g-ayuda",
    });
  });

  it("R5: `reprogramada` usa la MISMA familia (lo que cambia es el destino, no el origen)", async () => {
    const { repo, historialCreateMany } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT_REPROGRAMADA);

    const filas = (
      (historialCreateMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        data: Record<string, unknown>[];
      }
    ).data;
    expect(filas[0].origenTipo).toBe("gestion_tienda_ayuda");
    expect(filas[0].estatusDestinoId).toBe(idEstado("reprogramada"));
  });
});

/* -------------------------------------------------------------------------- */
/* (e) R10 — el testigo: `usuario.update` NO se llama                           */
/* -------------------------------------------------------------------------- */

describe("crearGestionDesdeAyuda — lo que NO toca (R10)", () => {
  it("R10: `usuario.update` NO se llama — copiar ese bloque le arrancaria OTRA orden al mensajero", async () => {
    // `crearGestionYTransicionar` limpia `usuario.ordenEnGestionId` del mensajero SEA CUAL SEA la
    // orden a la que apunte. Una orden en `ayuda_tienda` no puede ser su orden en gestion
    // (`escogerParaGestion` exige `en_reparto` y la solicitud de ayuda ya libero el puntero,
    // 235/R7), asi que ese puntero apunta a OTRA orden que el mensajero podria estar gestionando
    // en la calle en ese momento. Reutilizar el bloque se la quitaria de las manos.
    const { repo, usuarioUpdate } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);
    expect(usuarioUpdate).not.toHaveBeenCalled();
  });

  it("R10: `orden.update` (por PK, sin guarda) tampoco se usa: la unica escritura es el `updateMany`", async () => {
    const { repo, ordenUpdate, ordenUpdateMany } = buildTxRepo();
    await repo.crearGestionDesdeAyuda(INPUT);
    expect(ordenUpdate).not.toHaveBeenCalled();
    expect(ordenUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("no encola reoptimizacion de ruta (paridad con `transicionarAyuda`)", async () => {
    // La orden salio de la ruta al entrar en ayuda; sacarla otra vez no cambia el conjunto de
    // paradas. `transicionarAyuda` (235) tampoco encola: es paridad deliberada, no olvido. El
    // doble de la cola falla ruidosamente si alguien encola.
    const cola = colaFake();
    const tx = {
      orden: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(),
        findFirst: vi.fn(),
      },
      gestionOrden: { create: vi.fn(async () => ({ id: "g-ayuda" })) },
      gestionOrdenEvidencia: { createMany: vi.fn(async () => ({ count: 0 })) },
      gestionOrdenPago: { createMany: vi.fn(async () => ({ count: 0 })) },
      usuario: { update: vi.fn() },
      ordenHistorialEstado: { createMany: vi.fn(async () => ({ count: 1 })) },
    };
    const repo = new GestionOrdenRepository(
      {
        $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
      } as never,
      cola as never,
    );

    await repo.crearGestionDesdeAyuda(INPUT);
    expect(cola.enqueue).not.toHaveBeenCalled();
  });
});
