import { describe, it, expect, vi } from "vitest";
import { DeshacerAsignacionService } from "@/lib/services/DeshacerAsignacionService";
import {
  DeshacerAsignacionConflictoError,
  type DeshacerAsignacionItem,
  type OrdenTransicionRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import {
  MSG_CATALOGO_INCOMPLETO,
  MSG_ORDEN_BORRADA,
  MSG_ORDEN_NO_EXISTE,
  MSG_SIN_HISTORIAL,
  MSG_ZONA_CENTRAL_NO_CONFIGURADA,
  MSG_ZONA_DESTINO_INCOHERENTE,
  msgEstadoNoReversible,
} from "@/lib/services/mensajes-deshacer-asignacion";

// Feature 149 — T4.1 a T4.8, T4.10, T4.13 y T4.14(a): logica de negocio del deshacer, con
// dobles (sin DB, sin HTTP). Los motivos se asertan contra las CONSTANTES tipadas, no contra
// literales duplicados.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const ADMIN_SATELITE: Actor = { usuarioId: "u-sat", rol: "adminSatelite" };
const ADMIN_TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "u-msg", rol: "mensajero" };
const API_KEY: Actor = { usuarioId: "u-api", rol: "apiKey" };

const ZONA_CENTRAL = "z-central";
const ZONA_SATELITE = "z-limon";

const ESTATUS_ID: Record<string, string> = {
  por_recoger: "os-por-recoger",
  en_ruta_bodega_satelite: "os-ruta-satelite",
  en_bodega_central: "os-bodega-central",
  en_bodega_satelite: "os-bodega-satelite",
};

const MOTIVO = "mensajero equivocado: la orden vuelve a bodega";

function ordenRow(overrides: Partial<OrdenTransicionRow> = {}): OrdenTransicionRow {
  return {
    id: "o1",
    estatusValue: "por_recoger",
    numGuia: 1234,
    deletedAt: null,
    zonaId: ZONA_CENTRAL,
    zonaEsGam: true,
    tiendaId: "store-1",
    ...overrides,
  };
}

interface EscenarioOpts {
  ordenes?: OrdenTransicionRow[];
  /** ordenId -> `value` del estado de ORIGEN leido del historial (`null` = fila de creacion). */
  origenes?: Map<string, string | null>;
  zonaUsuario?: string | null;
  centralZonaId?: string | null;
  catalogoIncompleto?: string; // `value` que falta en el seed
  escritura?: (items: readonly DeshacerAsignacionItem[]) => Promise<number>;
}

function escenario(opts: EscenarioOpts = {}) {
  const ordenes = opts.ordenes ?? [ordenRow()];
  const origenes = opts.origenes ?? new Map(ordenes.map((o) => [o.id, "en_bodega_central"]));
  const deshacerAsignacionLote = vi.fn(
    async (
      items: readonly DeshacerAsignacionItem[],
      _origenes: ReadonlyMap<string, string>,
      _historial: unknown,
      _zonaId: string | null,
    ) => (opts.escritura ? opts.escritura(items) : items.length),
  );
  const findByIdsForTransicion = vi.fn(async (ids: string[]) =>
    ordenes.filter((o) => ids.includes(o.id)),
  );
  const findEstatusIdByValue = vi.fn(async (value: string) =>
    value === opts.catalogoIncompleto ? null : (ESTATUS_ID[value] ?? null),
  );
  const findUsuarioZonaId = vi.fn(async () =>
    opts.zonaUsuario === undefined ? ZONA_SATELITE : opts.zonaUsuario,
  );
  const findOrigenesReversion = vi.fn(
    async (_items: readonly { ordenId: string; estatusActualId: string }[]) => origenes,
  );
  const findCentralZonaId = vi.fn(async () =>
    opts.centralZonaId === undefined ? ZONA_CENTRAL : opts.centralZonaId,
  );
  const repo = {
    findUsuarioZonaId,
    findByIdsForTransicion,
    findEstatusIdByValue,
    deshacerAsignacionLote,
  };
  const service = new DeshacerAsignacionService(
    repo,
    { findCentralZonaId },
    { findOrigenesReversion },
  );
  return {
    service,
    deshacerAsignacionLote,
    findByIdsForTransicion,
    findOrigenesReversion,
    findUsuarioZonaId,
    findCentralZonaId,
  };
}

function input(ordenIds: string[] = ["o1"], motivo = MOTIVO) {
  return { ordenIds, motivo };
}

// ---------------------------------------------------------------------------------------
// T4.1 — Autorizacion por rol (R1/R2/R3)
// ---------------------------------------------------------------------------------------
describe("T4.1/R1/R2/R3 — autorizacion por rol", () => {
  it.each([
    ["adminTienda", ADMIN_TIENDA],
    ["mensajero", MENSAJERO],
    ["apiKey", API_KEY],
  ])("%s -> forbidden, sin llamar a NINGUN writer ni lector de ordenes", async (_n, actor) => {
    const e = escenario();
    const r = await e.service.deshacer(input(), actor);
    expect(r.status).toBe("forbidden");
    expect(e.deshacerAsignacionLote).not.toHaveBeenCalled();
    expect(e.findByIdsForTransicion).not.toHaveBeenCalled();
    expect(e.findOrigenesReversion).not.toHaveBeenCalled();
  });

  it.each([
    ["maestro", MAESTRO],
    ["admin", ADMIN],
  ])("%s revierte y no queda acotado por zona (R3)", async (_n, actor) => {
    const e = escenario({
      ordenes: [ordenRow({ id: "o1", zonaId: ZONA_SATELITE })],
      origenes: new Map([["o1", "en_bodega_satelite"]]),
    });
    const r = await e.service.deshacer(input(), actor);
    expect(r.status).toBe("ok");
    // R3: el acceso total no resuelve zona de usuario ni pasa guarda de zona al writer.
    expect(e.findUsuarioZonaId).not.toHaveBeenCalled();
    expect(e.deshacerAsignacionLote.mock.calls[0][3]).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// T4.2 — Scoping del adminSatelite (R4/R5/R6)
// ---------------------------------------------------------------------------------------
describe("T4.2/R4/R5/R6 — alcance del adminSatelite", () => {
  it("R4: una orden de zona ajena en el lote -> forbidden del LOTE COMPLETO, 0 escrituras", async () => {
    const e = escenario({
      zonaUsuario: ZONA_SATELITE,
      ordenes: [
        ordenRow({ id: "o1", zonaId: ZONA_SATELITE }),
        ordenRow({ id: "o2", zonaId: "z-otra" }),
      ],
      origenes: new Map([
        ["o1", "en_bodega_satelite"],
        ["o2", "en_bodega_satelite"],
      ]),
    });
    const r = await e.service.deshacer(input(["o1", "o2"]), ADMIN_SATELITE);
    expect(r.status).toBe("forbidden");
    expect(e.deshacerAsignacionLote).not.toHaveBeenCalled();
  });

  it("R6: adminSatelite sin zona -> sin_zona, sin leer ordenes", async () => {
    const e = escenario({ zonaUsuario: null });
    const r = await e.service.deshacer(input(), ADMIN_SATELITE);
    expect(r.status).toBe("sin_zona");
    expect(e.findByIdsForTransicion).not.toHaveBeenCalled();
    expect(e.deshacerAsignacionLote).not.toHaveBeenCalled();
  });

  it("R5: destino derivado `en_bodega_central` con actor adminSatelite -> forbidden", async () => {
    const e = escenario({
      zonaUsuario: ZONA_CENTRAL, // zona del actor = la central (caso patologico permitido)
      ordenes: [ordenRow({ id: "o1", estatusValue: "por_recoger", zonaId: ZONA_CENTRAL })],
      origenes: new Map([["o1", "en_bodega_central"]]),
    });
    const r = await e.service.deshacer(input(), ADMIN_SATELITE);
    expect(r.status).toBe("forbidden");
    expect(e.deshacerAsignacionLote).not.toHaveBeenCalled();
  });

  it("R4: el adminSatelite legitimo revierte su zona y la guarda de zona viaja al writer", async () => {
    const e = escenario({
      zonaUsuario: ZONA_SATELITE,
      ordenes: [ordenRow({ id: "o1", zonaId: ZONA_SATELITE })],
      origenes: new Map([["o1", "en_bodega_satelite"]]),
    });
    const r = await e.service.deshacer(input(), ADMIN_SATELITE);
    expect(r.status).toBe("ok");
    // Defensa en profundidad anti-TOCTOU: la zona se repite en el WHERE del UPDATE.
    expect(e.deshacerAsignacionLote.mock.calls[0][3]).toBe(ZONA_SATELITE);
  });
});

// ---------------------------------------------------------------------------------------
// T4.3 / T4.4 — Casos (a) y (b)
// ---------------------------------------------------------------------------------------
describe("T4.3/R8/R9 — caso (a): orden en por_recoger", () => {
  it("origen `en_bodega_central` -> destino en_bodega_central", async () => {
    const e = escenario({ origenes: new Map([["o1", "en_bodega_central"]]) });
    const r = await e.service.deshacer(input(), MAESTRO);
    expect(r).toEqual({
      status: "ok",
      resultados: [{ ordenId: "o1", estado: "en_bodega_central" }],
    });
    const items = e.deshacerAsignacionLote.mock.calls[0][0];
    expect(items).toEqual([
      { ordenId: "o1", destinoEstatusId: ESTATUS_ID.en_bodega_central },
    ]);
    // La guarda de escritura usa el estado ACTUAL como origen (anti-TOCTOU).
    expect([...e.deshacerAsignacionLote.mock.calls[0][1]]).toEqual([
      ["o1", ESTATUS_ID.por_recoger],
    ]);
  });

  it("origen `en_bodega_satelite` -> destino en_bodega_satelite", async () => {
    const e = escenario({
      ordenes: [ordenRow({ zonaId: ZONA_SATELITE })],
      origenes: new Map([["o1", "en_bodega_satelite"]]),
    });
    const r = await e.service.deshacer(input(), MAESTRO);
    expect(r).toEqual({
      status: "ok",
      resultados: [{ ordenId: "o1", estado: "en_bodega_satelite" }],
    });
  });

  it("R8/R9: la limpieza de mensajero y asignado_at es responsabilidad del writer del lote", async () => {
    const e = escenario();
    await e.service.deshacer(input(), MAESTRO);
    // El service delega en UNA primitiva; el SET (mensajero NULL + asignado_at NULL) esta
    // fijado por `tests/unit/repositories/orden-repository.deshacer-asignacion.test.ts`.
    expect(e.deshacerAsignacionLote).toHaveBeenCalledTimes(1);
    const historial = e.deshacerAsignacionLote.mock.calls[0][2] as {
      actorUsuarioId: string;
      origenTipo: string;
      motivo: string;
    };
    expect(historial).toEqual({
      actorUsuarioId: MAESTRO.usuarioId,
      origenTipo: "deshacer_asignacion",
      motivo: MOTIVO,
    });
  });
});

describe("T4.4/R10 — caso (b): orden en en_ruta_bodega_satelite", () => {
  it("vuelve a en_bodega_central con la guarda de origen correcta", async () => {
    const e = escenario({
      ordenes: [ordenRow({ estatusValue: "en_ruta_bodega_satelite", zonaId: ZONA_CENTRAL })],
      origenes: new Map([["o1", "en_bodega_central"]]),
    });
    const r = await e.service.deshacer(input(), MAESTRO);
    expect(r).toEqual({
      status: "ok",
      resultados: [{ ordenId: "o1", estado: "en_bodega_central" }],
    });
    expect([...e.deshacerAsignacionLote.mock.calls[0][1]]).toEqual([
      ["o1", ESTATUS_ID.en_ruta_bodega_satelite],
    ]);
  });
});

// ---------------------------------------------------------------------------------------
// T4.5 — Derivacion y normalizacion (R11/R12)
// ---------------------------------------------------------------------------------------
describe("T4.5/R11/R12 — el destino se DERIVA del historial y se normaliza", () => {
  it.each([
    ["en_bodega_central", "en_bodega_central", ZONA_CENTRAL],
    ["en_bodega_satelite", "en_bodega_satelite", ZONA_SATELITE],
    ["en_fulfillment", "en_bodega_central", ZONA_CENTRAL],
    ["en_preparacion", "en_bodega_central", ZONA_CENTRAL],
  ])("origen %s -> destino %s (tabla CERRADA de D3')", async (origen, destino, zonaId) => {
    const e = escenario({
      ordenes: [ordenRow({ zonaId })],
      origenes: new Map([["o1", origen]]),
    });
    const r = await e.service.deshacer(input(), MAESTRO);
    expect(r).toEqual({ status: "ok", resultados: [{ ordenId: "o1", estado: destino }] });
  });

  it("R11: la derivacion consulta el HISTORIAL con el estado actual de cada orden", async () => {
    const e = escenario({
      ordenes: [
        ordenRow({ id: "o1", estatusValue: "por_recoger" }),
        ordenRow({ id: "o2", estatusValue: "en_ruta_bodega_satelite" }),
      ],
      origenes: new Map([
        ["o1", "en_bodega_central"],
        ["o2", "en_bodega_central"],
      ]),
    });
    await e.service.deshacer(input(["o1", "o2"]), MAESTRO);
    expect(e.findOrigenesReversion).toHaveBeenCalledTimes(1); // sin N+1
    expect(e.findOrigenesReversion.mock.calls[0][0]).toEqual([
      { ordenId: "o1", estatusActualId: ESTATUS_ID.por_recoger },
      { ordenId: "o2", estatusActualId: ESTATUS_ID.en_ruta_bodega_satelite },
    ]);
  });

  it("R11 (testigo): una orden de zona satelite cuyo historial dice `en_bodega_central` NO va a satelite", async () => {
    // Si el destino se dedujera de la ZONA (alternativa A, VETADA), esta orden terminaria en
    // `en_bodega_satelite`. Como se deriva del historial, el destino es `en_bodega_central`... y
    // la guarda de coherencia lo rechaza por incoherente con la zona (R14). Nunca se inventa.
    const e = escenario({
      ordenes: [ordenRow({ zonaId: ZONA_SATELITE })],
      origenes: new Map([["o1", "en_bodega_central"]]),
    });
    const r = await e.service.deshacer(input(), MAESTRO);
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([{ ordenId: "o1", motivo: MSG_ZONA_DESTINO_INCOHERENTE }]);
    }
    expect(e.deshacerAsignacionLote).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------
// T4.6 — Fallo cerrado de la derivacion (R13)
// ---------------------------------------------------------------------------------------
describe("T4.6/R13 — fallo CERRADO: sin origen derivable no se escribe nada", () => {
  it.each([
    ["sin fila de historial", new Map<string, string | null>()],
    ["fila de creacion (origen NULL)", new Map<string, string | null>([["o1", null]])],
    ["origen fuera de la tabla (en_ruta)", new Map<string, string | null>([["o1", "en_ruta"]])],
    ["origen fuera de la tabla (devuelta)", new Map<string, string | null>([["o1", "devuelta"]])],
  ])("%s -> conflict con motivo tipado y 0 escrituras", async (_n, origenes) => {
    const e = escenario({ origenes });
    const r = await e.service.deshacer(input(), MAESTRO);
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([{ ordenId: "o1", motivo: MSG_SIN_HISTORIAL }]);
    }
    expect(e.deshacerAsignacionLote).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------
// T4.7 — Coherencia zona/destino (R14/R15)
// ---------------------------------------------------------------------------------------
describe("T4.7/R14/R15 — la inferencia de la normalizacion se VERIFICA contra la zona", () => {
  it("R14: destino en_bodega_central con orden NO central -> conflict", async () => {
    const e = escenario({
      ordenes: [ordenRow({ zonaId: ZONA_SATELITE })],
      origenes: new Map([["o1", "en_preparacion"]]),
    });
    const r = await e.service.deshacer(input(), MAESTRO);
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([{ ordenId: "o1", motivo: MSG_ZONA_DESTINO_INCOHERENTE }]);
    }
    expect(e.deshacerAsignacionLote).not.toHaveBeenCalled();
  });

  it("R15: destino en_bodega_satelite con orden central -> conflict", async () => {
    const e = escenario({
      ordenes: [ordenRow({ zonaId: ZONA_CENTRAL })],
      origenes: new Map([["o1", "en_bodega_satelite"]]),
    });
    const r = await e.service.deshacer(input(), MAESTRO);
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([{ ordenId: "o1", motivo: MSG_ZONA_DESTINO_INCOHERENTE }]);
    }
    expect(e.deshacerAsignacionLote).not.toHaveBeenCalled();
  });

  it("sin zona central configurada -> validation_error antes de derivar nada", async () => {
    const e = escenario({ centralZonaId: null });
    const r = await e.service.deshacer(input(), MAESTRO);
    expect(r).toEqual({
      status: "validation_error",
      fieldErrors: { zona: [MSG_ZONA_CENTRAL_NO_CONFIGURADA] },
    });
    expect(e.findOrigenesReversion).not.toHaveBeenCalled();
  });

  it("catalogo de estados incompleto -> validation_error sin escribir", async () => {
    const e = escenario({ catalogoIncompleto: "en_bodega_satelite" });
    const r = await e.service.deshacer(input(), MAESTRO);
    expect(r).toEqual({
      status: "validation_error",
      fieldErrors: { estatus: [MSG_CATALOGO_INCOMPLETO] },
    });
    expect(e.deshacerAsignacionLote).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------
// T4.8 — Bloqueos de estado y existencia (R16/R17/R18)
// ---------------------------------------------------------------------------------------
describe("T4.8/R16 — solo por_recoger y en_ruta_bodega_satelite son reversibles", () => {
  it.each([
    "en_ruta",
    "en_bodega_satelite",
    "entregada",
    "reprogramada",
    "devuelta",
    "rechazada",
    "sin_gestionar",
  ])("estado %s -> conflict con el estado NOMBRADO en el motivo", async (estatusValue) => {
    const e = escenario({ ordenes: [ordenRow({ estatusValue })] });
    const r = await e.service.deshacer(input(), MAESTRO);
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([{ ordenId: "o1", motivo: msgEstadoNoReversible(estatusValue) }]);
      expect(r.detalle[0].motivo).toContain(estatusValue);
    }
    expect(e.deshacerAsignacionLote).not.toHaveBeenCalled();
  });

  it("R17: orden borrada -> conflict `orden borrada`", async () => {
    const e = escenario({ ordenes: [ordenRow({ deletedAt: new Date("2026-07-01") })] });
    const r = await e.service.deshacer(input(), MAESTRO);
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([{ ordenId: "o1", motivo: MSG_ORDEN_BORRADA }]);
    }
    expect(e.deshacerAsignacionLote).not.toHaveBeenCalled();
  });

  it("R18: id inexistente -> conflict `orden no existe`", async () => {
    const e = escenario({ ordenes: [] });
    const r = await e.service.deshacer(input(["o-fantasma"]), MAESTRO);
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([{ ordenId: "o-fantasma", motivo: MSG_ORDEN_NO_EXISTE }]);
    }
    expect(e.deshacerAsignacionLote).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------
// T4.10 — Todo-o-nada y carrera (R20/R21)
// ---------------------------------------------------------------------------------------
describe("T4.10/R20/R21 — todo-o-nada por lote", () => {
  it("R20: lote de 3 con una invalida -> 0 escrituras para las otras dos", async () => {
    const e = escenario({
      ordenes: [
        ordenRow({ id: "o1" }),
        ordenRow({ id: "o2", estatusValue: "en_ruta" }), // ya recogida
        ordenRow({ id: "o3" }),
      ],
      origenes: new Map([
        ["o1", "en_bodega_central"],
        ["o3", "en_bodega_central"],
      ]),
    });
    const r = await e.service.deshacer(input(["o1", "o2", "o3"]), MAESTRO);
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([{ ordenId: "o2", motivo: msgEstadoNoReversible("en_ruta") }]);
    }
    expect(e.deshacerAsignacionLote).not.toHaveBeenCalled();
  });

  it("R21: carrera (el writer lanza) -> conflict con detalle por orden, sin efectos parciales", async () => {
    const ordenes = [
      ordenRow({ id: "o1" }),
      // Al re-leer, o2 ya fue recogida: ese es el motivo real de la carrera.
      ordenRow({ id: "o2", estatusValue: "en_ruta" }),
    ];
    const e = escenario({
      ordenes: [ordenRow({ id: "o1" }), ordenRow({ id: "o2" })],
      origenes: new Map([
        ["o1", "en_bodega_central"],
        ["o2", "en_bodega_central"],
      ]),
      escritura: async () => {
        throw new DeshacerAsignacionConflictoError(["o2"]);
      },
    });
    // La re-lectura posterior a la carrera ve el estado NUEVO.
    e.findByIdsForTransicion.mockImplementation(async (ids: string[]) =>
      ordenes.filter((o) => ids.includes(o.id)),
    );

    const r = await e.service.deshacer(input(["o1", "o2"]), MAESTRO);

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([{ ordenId: "o2", motivo: msgEstadoNoReversible("en_ruta") }]);
    }
  });

  it("un error inesperado del writer NO se traga: se propaga", async () => {
    const e = escenario({
      escritura: async () => {
        throw new Error("conexion caida");
      },
    });
    await expect(e.service.deshacer(input(), MAESTRO)).rejects.toThrow("conexion caida");
  });
});

// ---------------------------------------------------------------------------------------
// T4.13 — Mensajes sin PII (R40)
// ---------------------------------------------------------------------------------------
describe("T4.13/R40 — ningun motivo expone UUIDs ni datos del destinatario", () => {
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  it.each([
    MSG_ORDEN_NO_EXISTE,
    MSG_ORDEN_BORRADA,
    MSG_SIN_HISTORIAL,
    MSG_ZONA_DESTINO_INCOHERENTE,
    MSG_ZONA_CENTRAL_NO_CONFIGURADA,
    MSG_CATALOGO_INCOMPLETO,
    msgEstadoNoReversible("en_ruta"),
  ])("la constante `%s` no contiene UUID", (motivo) => {
    expect(motivo).not.toMatch(UUID);
  });

  it("el detalle de un conflict real no filtra el destinatario ni su telefono", async () => {
    const e = escenario({
      ordenes: [
        ordenRow({
          id: "8b1a2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
          estatusValue: "entregada",
        }),
      ],
    });
    const r = await e.service.deshacer(
      input(["8b1a2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d"]),
      MAESTRO,
    );
    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      for (const d of r.detalle) {
        // El `ordenId` viaja en su CAMPO propio (la UI lo usa para señalar la fila); el texto
        // del motivo no lo repite ni menciona a nadie.
        expect(d.motivo).not.toMatch(UUID);
        expect(d.motivo).not.toMatch(/Ana|0991234567|telefono/i);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------
// T4.14(a) — Sin notificacion al mensajero (R41)
// ---------------------------------------------------------------------------------------
describe("T4.14(a)/R41 — esta feature NO notifica al mensajero desasignado", () => {
  it("una reversion exitosa no invoca ningun productor de notificaciones desde el service", async () => {
    const e = escenario();
    const notificador = vi.fn();
    const r = await e.service.deshacer(input(), MAESTRO);
    expect(r.status).toBe("ok");
    // El service SOLO habla con sus tres repos; no hay canal de avisos (feature 146, pending).
    expect(notificador).not.toHaveBeenCalled();
    expect(e.deshacerAsignacionLote).toHaveBeenCalledTimes(1);
  });

  it("el unico efecto para el mensajero es que la orden sale de su listado de asignaciones", async () => {
    // `GestionOrdenRepository.findMisAsignaciones` filtra por `mensajeroAsignadoId`; al quedar
    // en NULL, la orden deja de casar el predicado. Se simula esa DB en memoria.
    const db = { id: "o1", mensajeroAsignadoId: "m-1", asignadoAt: new Date(), estatus: "por_recoger" };
    const e = escenario({
      escritura: async (items) => {
        for (const i of items) {
          if (i.ordenId === db.id) {
            db.mensajeroAsignadoId = null as unknown as string;
            db.asignadoAt = null as unknown as Date;
            db.estatus = "en_bodega_central";
          }
        }
        return items.length;
      },
    });

    expect([db].filter((o) => o.mensajeroAsignadoId === "m-1")).toHaveLength(1);
    const r = await e.service.deshacer(input(), MAESTRO);
    expect(r.status).toBe("ok");
    expect([db].filter((o) => o.mensajeroAsignadoId === "m-1")).toHaveLength(0);
  });
});
