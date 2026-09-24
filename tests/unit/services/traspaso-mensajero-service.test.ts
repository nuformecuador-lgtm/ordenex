import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";

import { TraspasoMensajeroConflictoError } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { OrdenTransicionRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { TraspasoOrdenesContexto } from "@/lib/notificaciones/emitir";
import {
  ESTADOS_TRASPASABLES,
  TraspasoMensajeroService,
  type TraspasoMensajeroRepo,
} from "@/lib/services/TraspasoMensajeroService";
import {
  MSG_CARRERA_TRASPASO,
  MSG_DESTINO_IGUAL_A_ORIGEN,
  MSG_DESTINO_NO_VALIDO,
  MSG_MENSAJERO_BLOQUEADO_POR_CIERRES,
  MSG_MENSAJERO_CON_RECOLECCION,
  MSG_MENSAJERO_NO_ASIGNABLE,
  MSG_MENSAJERO_SIN_VEHICULO,
  MSG_ORDEN_BORRADA,
  MSG_ORDEN_DE_OTRO_MENSAJERO,
  MSG_ORDEN_NO_EXISTE,
  MSG_ORIGEN_NO_UNICO,
} from "@/lib/services/mensajes-traspaso";

// FICHA 427 (T16) — LAS REGLAS del traspaso, con dobles y sin base.
//
// ⚠️ LO QUE ESTE ARCHIVO **NO** PRUEBA, Y HAY QUE SABERLO AL LEERLO: el `WHERE`. Un test de
// servicio con dobles pasa en VERDE con el `WHERE` mutado —medido cuatro veces en este repo—, asi
// que el movimiento real, el chat, el rastro, los jobs y la atomicidad se prueban contra Postgres
// en `tests/integration/db/traspaso-mensajero.int.test.ts`. Aqui viven las GUARDAS: quien puede,
// que estados, que destino y que pasa con los avisos.

const ORIGEN = "u-andy";
const DESTINO = "u-carlos";
const ZONA = "zona-gam";
const ORDEN_A = "11111111-1111-4111-8111-111111111111";
const ORDEN_B = "22222222-2222-4222-8222-222222222222";
const MOTIVO = "Andy se enfermo a media jornada y no puede seguir la ruta";

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" as RolValue };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" as RolValue };

function orden(overrides: Partial<OrdenTransicionRow> = {}): OrdenTransicionRow {
  return {
    id: ORDEN_A,
    estatusValue: "en_reparto",
    numGuia: 1001,
    deletedAt: null,
    zonaId: ZONA,
    zonaEsGam: true,
    tiendaId: "tienda-1",
    mensajeroAsignadoId: ORIGEN,
    fechaReparto: new Date("2026-09-14T00:00:00.000Z"),
    ...overrides,
  };
}

interface Dobles {
  repo: TraspasoMensajeroRepo;
  espias: {
    findByIdsForTransicion: ReturnType<typeof vi.fn>;
    findEstatusIdByValue: ReturnType<typeof vi.fn>;
    findMensajeroIdsValidosByZona: ReturnType<typeof vi.fn>;
    findMensajeroIdsConVehiculo: ReturnType<typeof vi.fn>;
    findMensajerosNoAsignablesPorEstado: ReturnType<typeof vi.fn>;
    findMensajerosBloqueadosPorCierres: ReturnType<typeof vi.fn>;
    findMensajerosConOrdenesEn: ReturnType<typeof vi.fn>;
    findUsuarioNombre: ReturnType<typeof vi.fn>;
    traspasarMensajeroLote: ReturnType<typeof vi.fn>;
  };
}

function buildRepo(overrides: Partial<Record<keyof Dobles["espias"], unknown>> = {}): Dobles {
  const espias = {
    findByIdsForTransicion: vi.fn(async () => [orden()]),
    findEstatusIdByValue: vi.fn(async (v: string) => `estatus-${v}`),
    findMensajeroIdsValidosByZona: vi.fn(async () => new Set([DESTINO])),
    findMensajeroIdsConVehiculo: vi.fn(async () => new Set([DESTINO])),
    findMensajerosNoAsignablesPorEstado: vi.fn(async () => new Set<string>()),
    findMensajerosBloqueadosPorCierres: vi.fn(async () => new Set<string>()),
    findMensajerosConOrdenesEn: vi.fn(async () => new Set<string>()),
    findUsuarioNombre: vi.fn(async (id: string) =>
      id === ORIGEN ? "Andy Cortés" : "Carlos Eduardo",
    ),
    traspasarMensajeroLote: vi.fn(async (input: { loteId: string; ordenes: unknown[] }) => ({
      loteId: input.loteId,
      movidas: input.ordenes.length,
      conversaciones: input.ordenes.length,
    })),
    // FICHA 454 (R54): por defecto ninguna orden tiene gestion pendiente de confirmar.
    findIdsConGestionPendiente: vi.fn(async () => new Set<string>()),
    ...overrides,
  } as Dobles["espias"];
  return { repo: espias as unknown as TraspasoMensajeroRepo, espias };
}

function entrada(overrides: Record<string, unknown> = {}) {
  return { ordenIds: [ORDEN_A], mensajeroDestinoId: DESTINO, motivo: MOTIVO, ...overrides };
}

/** Ningun repo se toco: lo que R2 exige de los roles no autorizados. */
function nadaSeConsulto(espias: Dobles["espias"]) {
  for (const [nombre, espia] of Object.entries(espias)) {
    expect(espia, `se llamo a \`${nombre}\``).not.toHaveBeenCalled();
  }
}

describe("427/R1 — `maestro` y `admin` pueden traspasar", () => {
  it.each([
    ["maestro", MAESTRO],
    ["admin", ADMIN],
  ])("⭑ %s traspasa el lote y recibe las dos cifras y los dos nombres", async (_n, actor) => {
    const { repo, espias } = buildRepo();
    const service = new TraspasoMensajeroService(repo);

    const r = await service.traspasar(entrada(), actor);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.movidas).toBe(1);
    expect(r.conversaciones).toBe(1);
    expect(r.origen).toEqual({ id: ORIGEN, nombre: "Andy Cortés" });
    expect(r.destino).toEqual({ id: DESTINO, nombre: "Carlos Eduardo" });
    expect(espias.traspasarMensajeroLote).toHaveBeenCalledTimes(1);
  });

  it("⭑ R8: el ORIGEN que llega al repo sale de las ORDENES, no del input", async () => {
    // El input no tiene campo de origen (lo impide el tipo). Esto afirma que el valor que viaja al
    // `WHERE` es el `mensajero_asignado_id` LEIDO, y que es el mismo para todo el lote.
    const { repo, espias } = buildRepo({
      findByIdsForTransicion: vi.fn(async () => [orden(), orden({ id: ORDEN_B })]),
    });
    const service = new TraspasoMensajeroService(repo);

    await service.traspasar(entrada({ ordenIds: [ORDEN_A, ORDEN_B] }), MAESTRO);

    const arg = espias.traspasarMensajeroLote.mock.calls[0][0];
    expect(arg.mensajeroOrigenId).toBe(ORIGEN);
    expect(arg.mensajeroDestinoId).toBe(DESTINO);
    // R27: UN `lote_id` por acto, y lo genera el servicio.
    expect(arg.loteId).toMatch(/^[0-9a-f-]{36}$/);
    // R26: el rol del actor viaja para CONGELARSE en la fila del rastro.
    expect(arg.actor).toEqual({ usuarioId: "u-maestro", rol: "maestro" });
    expect(arg.motivo).toBe(MOTIVO);
  });

  it("dos actos seguidos generan `lote_id` DISTINTOS (R27)", async () => {
    const { repo, espias } = buildRepo();
    const service = new TraspasoMensajeroService(repo);
    await service.traspasar(entrada(), MAESTRO);
    await service.traspasar(entrada(), MAESTRO);
    const [a, b] = espias.traspasarMensajeroLote.mock.calls.map((c) => c[0].loteId);
    expect(a).not.toBe(b);
  });
});

describe("427/R2 y D1 — cualquier otro rol: `forbidden` SIN tocar nada", () => {
  it.each([
    ["mensajero"],
    ["adminTienda"],
    ["adminSatelite"],
    ["apiKey"],
  ])("⭑ %s -> forbidden y ni una lectura", async (rol) => {
    const { repo, espias } = buildRepo();
    const service = new TraspasoMensajeroService(repo);

    const r = await service.traspasar(entrada(), {
      usuarioId: `u-${rol}`,
      rol: rol as RolValue,
    });

    expect(r).toEqual({ status: "forbidden" });
    // R2: NI UNA lectura de ordenes, de conversaciones ni de rastro.
    nadaSeConsulto(espias);
  });

  it("⭑ D1: el `adminSatelite` esta FUERA de esta ficha, y es una decision con fecha", async () => {
    // 2026-09-14: hoy no tiene NINGUNA superficie donde ver una orden `en_reparto` —su pantalla
    // trabaja sobre `en_bodega_satelite`—, y abrirlo exige acotar por zona las ordenes Y los
    // mensajeros mas su guarda de bodega bloqueada: es otra superficie, no un `||` mas.
    // Queda como seguimiento S1. Si algun dia entra, este aserto se cambia A PROPOSITO.
    const { repo } = buildRepo();
    const r = await new TraspasoMensajeroService(repo).traspasar(entrada(), {
      usuarioId: "u-sat",
      rol: "adminSatelite" as RolValue,
    });
    expect(r).toEqual({ status: "forbidden" });
  });

  it("CONTROL: con `maestro` el mismo barrido SI consulta (si no, seria verde por vacio)", async () => {
    const { repo, espias } = buildRepo();
    await new TraspasoMensajeroService(repo).traspasar(entrada(), MAESTRO);
    expect(espias.findByIdsForTransicion).toHaveBeenCalled();
  });
});

// ⏳ 2026-09-23 (FICHA 454, R54/R28): la constante pasa a UN estado — `ayuda_tienda` deja de ser
// estado; una orden con ayuda abierta sigue `en_reparto` y se traspasa igual (con su ayuda). Lo que
// ya no se traspasa es la orden GESTIONADA y pendiente de confirmar (guarda aparte, abajo).
describe("427/R4 y R5 — solo `en_reparto`; el resto rechaza el lote entero", () => {
  it("⭑ la constante tiene EXACTAMENTE `en_reparto` (D4; ficha 454)", () => {
    // Literal a mano, no derivado: comparar la lista contra su propia fuente esta siempre verde.
    expect([...ESTADOS_TRASPASABLES].sort()).toEqual(["en_reparto"]);
  });

  it("⭑ FICHA 454 (R54): una orden con gestion PENDIENTE de confirmar NO se traspasa", async () => {
    const { repo, espias } = buildRepo({
      findIdsConGestionPendiente: vi.fn(async () => new Set([ORDEN_A])),
    });
    const r = await new TraspasoMensajeroService(repo).traspasar(entrada(), MAESTRO);
    expect(r.status).toBe("conflict");
    expect(espias.traspasarMensajeroLote).not.toHaveBeenCalled();
  });

  it.each([
    ["por_recoger"],
    ["devolviendo_a_tienda"],
    ["sin_gestionar"],
    ["entregada"],
    ["en_bodega_central"],
    ["reprogramada"],
  ])("⭑ `%s` -> conflict NOMBRANDO el estado, y SIN escritura", async (estatusValue) => {
    const { repo, espias } = buildRepo({
      findByIdsForTransicion: vi.fn(async () => [orden({ estatusValue })]),
    });

    const r = await new TraspasoMensajeroService(repo).traspasar(entrada(), MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([
      { ordenId: ORDEN_A, motivo: `estado no traspasable: ${estatusValue}` },
    ]);
    expect(espias.traspasarMensajeroLote).not.toHaveBeenCalled();
  });

  it("⭑ R5: UNA orden mala aborta el LOTE COMPLETO — ni la buena se mueve", async () => {
    const { repo, espias } = buildRepo({
      findByIdsForTransicion: vi.fn(async () => [
        orden(),
        orden({ id: ORDEN_B, estatusValue: "entregada" }),
      ]),
    });

    const r = await new TraspasoMensajeroService(repo).traspasar(
      entrada({ ordenIds: [ORDEN_A, ORDEN_B] }),
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    expect(espias.traspasarMensajeroLote).not.toHaveBeenCalled();
  });

  it("orden inexistente y orden borrada tienen motivo PROPIO cada una", async () => {
    const { repo } = buildRepo({
      findByIdsForTransicion: vi.fn(async () => [orden({ id: ORDEN_B, deletedAt: new Date() })]),
    });
    const r = await new TraspasoMensajeroService(repo).traspasar(
      entrada({ ordenIds: [ORDEN_A, ORDEN_B] }),
      MAESTRO,
    );
    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([
      { ordenId: ORDEN_A, motivo: MSG_ORDEN_NO_EXISTE },
      { ordenId: ORDEN_B, motivo: MSG_ORDEN_BORRADA },
    ]);
  });
});

describe("427/R6 — el lote tiene que tener UN SOLO mensajero de origen", () => {
  it("⭑ dos origenes -> conflict con una entrada POR ORDEN, y sin escritura", async () => {
    const { repo, espias } = buildRepo({
      findByIdsForTransicion: vi.fn(async () => [
        orden(),
        orden({ id: ORDEN_B, mensajeroAsignadoId: "u-tercero" }),
      ]),
    });

    const r = await new TraspasoMensajeroService(repo).traspasar(
      entrada({ ordenIds: [ORDEN_A, ORDEN_B] }),
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([
      { ordenId: ORDEN_A, motivo: MSG_ORIGEN_NO_UNICO },
      { ordenId: ORDEN_B, motivo: MSG_ORDEN_DE_OTRO_MENSAJERO },
    ]);
    expect(espias.traspasarMensajeroLote).not.toHaveBeenCalled();
  });
});

describe("427/R7 — el destino no puede ser el mismo que ya la lleva", () => {
  it("⭑ destino == origen -> rechazo sin efectos", async () => {
    const { repo, espias } = buildRepo();

    const r = await new TraspasoMensajeroService(repo).traspasar(
      entrada({ mensajeroDestinoId: ORIGEN }),
      MAESTRO,
    );

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(r.fieldErrors.mensajeroDestinoId).toEqual([MSG_DESTINO_IGUAL_A_ORIGEN]);
    expect(espias.traspasarMensajeroLote).not.toHaveBeenCalled();
  });
});

describe("427/R9-R13 — las guardas del mensajero DESTINO, cada una con su motivo", () => {
  it("⭑ R9: destino sin rol `mensajero` o de otra zona -> `mensajero destino no valido`", async () => {
    const { repo, espias } = buildRepo({
      findMensajeroIdsValidosByZona: vi.fn(async () => new Set<string>()),
    });
    const r = await new TraspasoMensajeroService(repo).traspasar(entrada(), MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(r.fieldErrors.mensajeroDestinoId).toEqual([MSG_DESTINO_NO_VALIDO]);
    expect(espias.traspasarMensajeroLote).not.toHaveBeenCalled();
  });

  it("⭑ R9: la zona se evalua contra la de CADA orden del lote, no solo la primera", async () => {
    // Un lote puede mezclar zonas, y el destino tiene que servir para TODAS: un mensajero de la
    // zona A no puede quedarse con una orden de la zona B.
    const valido = vi.fn(async (_ids: string[], zonaId: string) =>
      zonaId === ZONA ? new Set([DESTINO]) : new Set<string>(),
    );
    const { repo, espias } = buildRepo({
      findByIdsForTransicion: vi.fn(async () => [orden(), orden({ id: ORDEN_B, zonaId: "zona-b" })]),
      findMensajeroIdsValidosByZona: valido,
    });

    const r = await new TraspasoMensajeroService(repo).traspasar(
      entrada({ ordenIds: [ORDEN_A, ORDEN_B] }),
      MAESTRO,
    );

    expect(r.status).toBe("validation_error");
    expect(valido).toHaveBeenCalledTimes(2);
    expect(espias.traspasarMensajeroLote).not.toHaveBeenCalled();
  });

  it("⭑ R10: destino sin vehiculo -> motivo propio, y sin escritura", async () => {
    const { repo, espias } = buildRepo({
      findMensajeroIdsConVehiculo: vi.fn(async () => new Set<string>()),
    });
    const r = await new TraspasoMensajeroService(repo).traspasar(entrada(), MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(r.fieldErrors.mensajeroDestinoId).toEqual([MSG_MENSAJERO_SIN_VEHICULO]);
    expect(espias.traspasarMensajeroLote).not.toHaveBeenCalled();
  });

  it("⭑ R10: destino inactivo/bloqueado de cuenta -> motivo propio, y sin escritura", async () => {
    const { repo, espias } = buildRepo({
      findMensajerosNoAsignablesPorEstado: vi.fn(async () => new Set([DESTINO])),
    });
    const r = await new TraspasoMensajeroService(repo).traspasar(entrada(), MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(r.fieldErrors.mensajeroDestinoId).toEqual([MSG_MENSAJERO_NO_ASIGNABLE]);
    expect(espias.traspasarMensajeroLote).not.toHaveBeenCalled();
  });

  it("⭑ R11: destino bloqueado por cierres -> conflict con el MISMO motivo que las asignaciones", async () => {
    const { repo, espias } = buildRepo({
      findMensajerosBloqueadosPorCierres: vi.fn(async () => new Set([DESTINO])),
    });
    const r = await new TraspasoMensajeroService(repo).traspasar(
      entrada({ ordenIds: [ORDEN_A] }),
      MAESTRO,
    );
    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([
      { ordenId: ORDEN_A, motivo: MSG_MENSAJERO_BLOQUEADO_POR_CIERRES },
    ]);
    expect(espias.traspasarMensajeroLote).not.toHaveBeenCalled();
  });

  it("⭑ R13: destino con recoleccion en tienda pendiente -> conflict, y sin escritura", async () => {
    const { repo, espias } = buildRepo({
      findMensajerosConOrdenesEn: vi.fn(async () => new Set([DESTINO])),
    });
    const r = await new TraspasoMensajeroService(repo).traspasar(entrada(), MAESTRO);
    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: ORDEN_A, motivo: MSG_MENSAJERO_CON_RECOLECCION }]);
    expect(espias.traspasarMensajeroLote).not.toHaveBeenCalled();
  });

  it("R13: la consulta de dedicacion pregunta por `recolectando` y solo por el DESTINO", async () => {
    const { repo, espias } = buildRepo();
    await new TraspasoMensajeroService(repo).traspasar(entrada(), MAESTRO);
    expect(espias.findMensajerosConOrdenesEn).toHaveBeenCalledWith([DESTINO], ["recolectando"]);
  });
});

describe("427/R12 — el ORIGEN bloqueado por cierres SI se traspasa", () => {
  it("⭑⭑ el bloqueo del origen NO impide quitarle trabajo, y es el caso de la ficha", async () => {
    // ⚠️ ESTE ES EL CASO QUE MATA LA MUTACION 9 (aplicar la guarda de cierres tambien al origen).
    // Quitarle trabajo a quien esta atascado es lo CONTRARIO de darselo, y el caso que motiva la
    // ficha es alguien que no puede seguir: bloquear aqui atraparia exactamente lo que la ficha
    // existe para desatascar.
    const bloqueados = vi.fn(async (ids: string[]) =>
      ids.includes(ORIGEN) ? new Set([ORIGEN]) : new Set<string>(),
    );
    const { repo, espias } = buildRepo({ findMensajerosBloqueadosPorCierres: bloqueados });

    const r = await new TraspasoMensajeroService(repo).traspasar(entrada(), MAESTRO);

    expect(r.status).toBe("ok");
    expect(espias.traspasarMensajeroLote).toHaveBeenCalledTimes(1);
    // Y la prueba de que la asimetria es REAL: al predicado solo se le pregunta por el DESTINO.
    for (const call of bloqueados.mock.calls) {
      expect(call[0]).toEqual([DESTINO]);
      expect(call[0]).not.toContain(ORIGEN);
    }
  });
});

describe("427/R14 — ni el tope de intentos ni la falta de coordenadas bloquean", () => {
  it("⭑ una orden con el tope agotado SI se traspasa (ya esta en la calle)", async () => {
    // El tope (276) existe para que una orden agotada NO SALGA a la calle. Esta ya salio. La prueba
    // estructural es que el `Pick` del repo NI SIQUIERA EXPONE `contarIntentosEnLote`: no se puede
    // consultar por descuido. Aqui se ejercita el desenlace.
    const { repo, espias } = buildRepo();
    const r = await new TraspasoMensajeroService(repo).traspasar(entrada(), MAESTRO);
    expect(r.status).toBe("ok");
    expect((espias as unknown as Record<string, unknown>).contarIntentosEnLote).toBeUndefined();
  });

  it("⭑ una orden sin coordenadas SI se traspasa (perderia sitio en la ruta, no la custodia)", async () => {
    // Idem: `findParaAsignabilidad` no esta en el `Pick`. Sin coordenadas la orden queda como
    // parada sin posicionar, AL FINAL del recorrido — un problema de orden de visita.
    const { repo, espias } = buildRepo();
    const r = await new TraspasoMensajeroService(repo).traspasar(entrada(), MAESTRO);
    expect(r.status).toBe("ok");
    expect((espias as unknown as Record<string, unknown>).findParaAsignabilidad).toBeUndefined();
  });
});

describe("427/R24 — la carrera: el lote revierte entero, con un motivo POR ORDEN", () => {
  it("⭑ el `detalle` lleva UNA entrada por cada orden que no se movio", async () => {
    let llamada = 0;
    const { repo } = buildRepo({
      findByIdsForTransicion: vi.fn(async () => {
        llamada += 1;
        // Primera lectura: las dos validas. Segunda (la re-lectura del detalle): una ya se entrego
        // y la otra se la llevo otro mensajero.
        return llamada === 1
          ? [orden(), orden({ id: ORDEN_B })]
          : [
              orden({ estatusValue: "entregada" }),
              orden({ id: ORDEN_B, mensajeroAsignadoId: "u-tercero" }),
            ];
      }),
      traspasarMensajeroLote: vi.fn(async () => {
        throw new TraspasoMensajeroConflictoError([ORDEN_A, ORDEN_B]);
      }),
    });

    const r = await new TraspasoMensajeroService(repo).traspasar(
      entrada({ ordenIds: [ORDEN_A, ORDEN_B] }),
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([
      { ordenId: ORDEN_A, motivo: "estado no traspasable: entregada" },
      { ordenId: ORDEN_B, motivo: MSG_ORDEN_DE_OTRO_MENSAJERO },
    ]);
  });

  it("si la orden sigue igual, el motivo es el de la carrera a secas", async () => {
    const { repo } = buildRepo({
      traspasarMensajeroLote: vi.fn(async () => {
        throw new TraspasoMensajeroConflictoError([ORDEN_A]);
      }),
    });
    const r = await new TraspasoMensajeroService(repo).traspasar(entrada(), MAESTRO);
    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    expect(r.detalle).toEqual([{ ordenId: ORDEN_A, motivo: MSG_CARRERA_TRASPASO }]);
  });

  it("un error que NO es de carrera se PROPAGA: no se disfraza de conflicto", async () => {
    const { repo } = buildRepo({
      traspasarMensajeroLote: vi.fn(async () => {
        throw new Error("conexion caida");
      }),
    });
    await expect(
      new TraspasoMensajeroService(repo).traspasar(entrada(), MAESTRO),
    ).rejects.toThrow("conexion caida");
  });
});

describe("427/R38-R41 — los DOS avisos, fuera de la transaccion y sin cambiar el desenlace", () => {
  it("⭑⭑ tras un traspaso correcto se llama a CADA notificador EXACTAMENTE UNA VEZ", async () => {
    // ⚠️ ESTE ES EL CASO QUE MATA LA MUTACION 12 (emitir un aviso POR ORDEN): con 3 ordenes, un
    // emisor por orden llamaria 3 veces a cada uno.
    const recibido = vi.fn(async (_ctx: TraspasoOrdenesContexto) => {});
    const cedido = vi.fn(async (_ctx: TraspasoOrdenesContexto) => {});
    const { repo, espias } = buildRepo({
      findByIdsForTransicion: vi.fn(async () => [
        orden(),
        orden({ id: ORDEN_B }),
        orden({ id: "33333333-3333-4333-8333-333333333333" }),
      ]),
    });
    const service = new TraspasoMensajeroService(repo, recibido, cedido);

    const r = await service.traspasar(
      entrada({ ordenIds: [ORDEN_A, ORDEN_B, "33333333-3333-4333-8333-333333333333"] }),
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    expect(recibido).toHaveBeenCalledTimes(1);
    expect(cedido).toHaveBeenCalledTimes(1);

    // R38: al DESTINO, con cuantas y el nombre del de ORIGEN; la entidad es el `lote_id`.
    const ctxRecibido = recibido.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(ctxRecibido.mensajeroUsuarioId).toBe(DESTINO);
    expect(ctxRecibido.cuantas).toBe(3);
    expect(ctxRecibido.otroMensajeroNombre).toBe("Andy Cortés");
    expect(ctxRecibido.loteId).toMatch(/^[0-9a-f-]{36}$/);

    // R39: al ORIGEN, con cuantas y el nombre del DESTINO. MISMO `lote_id` que el de arriba: es el
    // mismo acto.
    const ctxCedido = cedido.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(ctxCedido.mensajeroUsuarioId).toBe(ORIGEN);
    expect(ctxCedido.cuantas).toBe(3);
    expect(ctxCedido.otroMensajeroNombre).toBe("Carlos Eduardo");
    expect(ctxCedido.loteId).toBe(ctxRecibido.loteId);

    // ⭑⭑ R42 — Y ESE VALOR ES EL `lote_id` DEL ACTO, EL MISMO QUE SE LE PASO A LA TRANSACCION.
    //
    // ⚠️ SIN ESTE BLOQUE LA MUTACION 5 DEL REVIEWER SOBREVIVIA (72/72 verde): con el servicio
    // pasando `loteId: validas[0].id` —el id de la PRIMERA ORDEN—, lo de arriba seguia cumpliendose,
    // porque solo exigia forma de uuid y que los dos avisos compartieran el valor. Y ESE es el fallo
    // que pagaron la 262, la 403, la 409 y la 412: A -> Carlos, vuelta a Andy, otra vez A -> Carlos;
    // la entidad se repite, `crear` absorbe el `P2002` y el tercer aviso queda MUDO PARA SIEMPRE.
    //
    // Se afirma contra lo que RECIBIO `traspasarMensajeroLote` —que es lo que se persiste en
    // `orden_traspaso_mensajero.lote_id`— y no contra un literal: es la unica igualdad que ata la
    // entidad del aviso al rastro del acto.
    expect(espias.traspasarMensajeroLote).toHaveBeenCalledTimes(1);
    const loteDelActo = espias.traspasarMensajeroLote.mock.calls[0][0].loteId as string;
    expect(ctxRecibido.loteId).toBe(loteDelActo);
    expect(ctxCedido.loteId).toBe(loteDelActo);
    // Y no es el id de NINGUNA orden del lote (la forma exacta de la mutacion 5).
    for (const ordenId of [ORDEN_A, ORDEN_B, "33333333-3333-4333-8333-333333333333"]) {
      expect(ctxRecibido.loteId).not.toBe(ordenId);
    }
  });

  it("⭑ R40: el contexto de los avisos NO lleva el motivo escrito por quien traspaso", async () => {
    const recibido = vi.fn(async (_ctx: TraspasoOrdenesContexto) => {});
    const cedido = vi.fn(async (_ctx: TraspasoOrdenesContexto) => {});
    const { repo } = buildRepo();
    await new TraspasoMensajeroService(repo, recibido, cedido).traspasar(
      entrada({ motivo: "Andy se enfermo, llamar al 8888-8888" }),
      MAESTRO,
    );
    for (const espia of [recibido, cedido]) {
      const ctx = JSON.stringify(espia.mock.calls[0][0]);
      expect(ctx).not.toContain("8888");
      expect(ctx).not.toContain("enfermo");
    }
  });

  it("⭑⭑ R41: un notificador que LANZA no cambia el `ok` ni las cifras", async () => {
    const recibido = vi.fn(async (_ctx: TraspasoOrdenesContexto) => {
      throw new Error("canal caido");
    });
    const cedido = vi.fn(async (_ctx: TraspasoOrdenesContexto) => {});
    const { repo } = buildRepo();

    const r = await new TraspasoMensajeroService(repo, recibido, cedido).traspasar(
      entrada(),
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.movidas).toBe(1);
    // ⭑ Y EL SEGUNDO AVISO SE EMITE IGUAL: los dos van en `try` SEPARADOS. Con un solo `try`
    // envolviendo a los dos, un fallo del aviso al destino dejaria al origen sin el suyo.
    expect(cedido).toHaveBeenCalledTimes(1);
  });

  it("⭑ R41: tambien si es el SEGUNDO el que revienta", async () => {
    const recibido = vi.fn(async (_ctx: TraspasoOrdenesContexto) => {});
    const cedido = vi.fn(async (_ctx: TraspasoOrdenesContexto) => {
      throw new Error("canal caido");
    });
    const { repo } = buildRepo();
    const r = await new TraspasoMensajeroService(repo, recibido, cedido).traspasar(
      entrada(),
      MAESTRO,
    );
    expect(r.status).toBe("ok");
    expect(recibido).toHaveBeenCalledTimes(1);
  });

  it("⭑ los avisos se emiten DESPUES de la escritura, nunca antes", async () => {
    // Si se emitieran antes, un traspaso que revierte dejaria dos avisos mintiendo.
    const orden_: string[] = [];
    const { repo } = buildRepo({
      traspasarMensajeroLote: vi.fn(async (input: { loteId: string; ordenes: unknown[] }) => {
        orden_.push("escritura");
        return { loteId: input.loteId, movidas: input.ordenes.length, conversaciones: 0 };
      }),
    });
    const recibido = vi.fn(async (_ctx: TraspasoOrdenesContexto) => {
      orden_.push("aviso-destino");
    });
    const cedido = vi.fn(async (_ctx: TraspasoOrdenesContexto) => {
      orden_.push("aviso-origen");
    });

    await new TraspasoMensajeroService(repo, recibido, cedido).traspasar(entrada(), MAESTRO);

    expect(orden_).toEqual(["escritura", "aviso-destino", "aviso-origen"]);
  });

  it("⭑ un lote RECHAZADO no emite ningun aviso", async () => {
    const recibido = vi.fn(async (_ctx: TraspasoOrdenesContexto) => {});
    const cedido = vi.fn(async (_ctx: TraspasoOrdenesContexto) => {});
    const { repo } = buildRepo({
      findByIdsForTransicion: vi.fn(async () => [orden({ estatusValue: "entregada" })]),
    });

    await new TraspasoMensajeroService(repo, recibido, cedido).traspasar(entrada(), MAESTRO);

    expect(recibido).not.toHaveBeenCalled();
    expect(cedido).not.toHaveBeenCalled();
  });

  it("el DEFAULT del constructor es el no-op: un service sin cablear no emite nada", async () => {
    // Es lo que impide que una suite escriba notificaciones en la base compartida, y lo que hace
    // que el cableado del composition root sea COMPROBABLE (ver `traspasar-mensajero.test.ts`).
    const { repo } = buildRepo();
    const r = await new TraspasoMensajeroService(repo).traspasar(entrada(), MAESTRO);
    expect(r.status).toBe("ok");
  });
});

describe("427 — guardas de forma del servicio", () => {
  it("lote vacio -> `validation_error`, sin tocar nada", async () => {
    const { repo, espias } = buildRepo();
    const r = await new TraspasoMensajeroService(repo).traspasar(
      entrada({ ordenIds: [] }),
      MAESTRO,
    );
    expect(r.status).toBe("validation_error");
    expect(espias.findByIdsForTransicion).not.toHaveBeenCalled();
  });

  it("ids repetidos se deduplican antes de leer", async () => {
    const { repo, espias } = buildRepo();
    await new TraspasoMensajeroService(repo).traspasar(
      entrada({ ordenIds: [ORDEN_A, ORDEN_A] }),
      MAESTRO,
    );
    expect(espias.findByIdsForTransicion).toHaveBeenCalledWith([ORDEN_A]);
  });

  it("catalogo de estados incompleto -> `validation_error` (fallo CERRADO), sin escritura", async () => {
    const { repo, espias } = buildRepo({
      findEstatusIdByValue: vi.fn(async () => null),
    });
    const r = await new TraspasoMensajeroService(repo).traspasar(entrada(), MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(r.fieldErrors.estatus).toEqual(["catalogo de estados incompleto (seed pendiente)"]);
    expect(espias.traspasarMensajeroLote).not.toHaveBeenCalled();
  });

  it("R24: el `estatusIdEsperado` que viaja al repo es el del estado LEIDO por el service", async () => {
    // Sin este campo el repositorio guardaria contra lo que acaba de leer: una guarda que siempre
    // se cumple y que no compara nada.
    const { repo, espias } = buildRepo({
      findByIdsForTransicion: vi.fn(async () => [
        orden(),
        // ⏳ 2026-09-23 (FICHA 454): antes la segunda era `ayuda_tienda`; ya no es estado.
        orden({ id: ORDEN_B, estatusValue: "en_reparto" }),
      ]),
    });
    await new TraspasoMensajeroService(repo).traspasar(
      entrada({ ordenIds: [ORDEN_A, ORDEN_B] }),
      MAESTRO,
    );
    expect(espias.traspasarMensajeroLote.mock.calls[0][0].ordenes).toEqual([
      { ordenId: ORDEN_A, estatusIdEsperado: "estatus-en_reparto" },
      { ordenId: ORDEN_B, estatusIdEsperado: "estatus-en_reparto" },
    ]);
  });
});
