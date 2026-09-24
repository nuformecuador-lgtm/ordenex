import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { IOrdenDiaRepartoCambioRepository } from "@/lib/interfaces/repositories/IOrdenDiaRepartoCambioRepository";
import type { IOrdenHistorialRepository } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenTraspasoRepository } from "@/lib/interfaces/repositories/IOrdenTraspasoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenHistorialService, fusionarLineaDeTiempo } from "@/lib/services/OrdenHistorialService";
import type { OrdenDTO } from "@/lib/types/orden";
import type {
  OrdenHistorialEventoDTO,
  OrdenHistorialTransicionDTO,
} from "@/lib/types/orden-historial";

// FICHA 454 (T1.21, design §12.4; R30) — LA CUARTA CLASE DE LA LINEA DE TIEMPO: los HECHOS sin
// transicion (`orden_evento`). Con la 454 la gestion de calle deja de mover la orden hasta que se
// aprueba el cierre, y la ayuda a la tienda deja de ser estado: sin esta clase la linea de tiempo no
// diria nada entre «En reparto» y la aplicacion.
//
// Tres niveles, como sus hermanas (262, 427):
//  (a) la FUSION pura: la clase entra, y en el empate de instante va DETRAS de la transicion;
//  (b) el SERVICIO: la lee DESPUES de autorizar y con la misma regla (R30: «a los mismos roles»);
//  (c) el REPOSITORIO: la forma de la consulta (orden, filtro, sin `motivo`) y el mapeo del DTO.
//
// Lo que un doble NO puede probar (el `WHERE` real y el orden de Postgres) lo cubre la integracion
// de la 454 (`tests/integration/db/454/*`), que escribe los eventos que esta clase lee.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const MENSAJERO_AJENO: Actor = { usuarioId: "m9", rol: "mensajero" };

function transicion(iso: string): OrdenHistorialTransicionDTO {
  return {
    clase: "transicion",
    estatusOrigenValue: "ayuda_tienda",
    estatusDestinoValue: "en_reparto",
    origenTipo: "ajuste_estado",
    actorNombre: null,
    motivo: "migracion 454: retiro de ayuda_tienda",
    createdAt: new Date(iso),
  };
}

function evento(
  iso: string,
  overrides: Partial<OrdenHistorialEventoDTO> = {},
): OrdenHistorialEventoDTO {
  return {
    clase: "evento_orden",
    tipo: "gestion_registrada",
    resultado: "entregado",
    resultadoAnterior: null,
    actorNombre: "Andy Cortes",
    actorRol: "mensajero",
    createdAt: new Date(iso),
    ...overrides,
  };
}

describe("454/R30 (a) — la fusion incluye los hechos y los ordena", () => {
  it("un hecho entra en la linea, en su sitio cronologico entre las otras clases", () => {
    const t = transicion("2026-09-23T10:00:00.000Z");
    const e = evento("2026-09-23T11:00:00.000Z");
    const t2 = transicion("2026-09-23T12:00:00.000Z");
    expect(fusionarLineaDeTiempo([t, t2], [], [], [e])).toEqual([t, e, t2]);
  });

  it("EMPATE de instante con una transicion: la transicion va PRIMERO (rango 3 = el ultimo)", () => {
    // El caso real es M3: el rastro `ayuda_tienda -> en_reparto` y el evento de ayuda abierta se
    // escriben en el MISMO instante. La ayuda se lee DESPUES de volver a `en_reparto`.
    const iso = "2026-09-23T09:00:00.000Z";
    const e = evento(iso, { tipo: "ayuda_solicitada", resultado: null });
    const t = transicion(iso);
    expect(fusionarLineaDeTiempo([t], [], [], [e])).toEqual([t, e]);
    // Y no depende del orden en que entran las listas.
    expect(fusionarLineaDeTiempo([t], [], [], [e]).map((x) => x.clase)).toEqual([
      "transicion",
      "evento_orden",
    ]);
  });

  it("dos hechos del mismo instante salen como los entrego el repositorio (sort estable)", () => {
    const iso = "2026-09-23T09:00:00.000Z";
    const a = evento(iso, { tipo: "gestion_registrada" });
    const b = evento(iso, { tipo: "gestion_anulada" });
    expect(fusionarLineaDeTiempo([], [], [], [a, b])).toEqual([a, b]);
    expect(fusionarLineaDeTiempo([], [], [], [b, a])).toEqual([b, a]);
  });
});

// --------------------------------------------------------------------------------------------
// (b) el servicio
// --------------------------------------------------------------------------------------------

function ordenDTO(overrides: Partial<OrdenDTO> = {}): OrdenDTO {
  return {
    id: "o1",
    numGuia: 10,
    numRemision: "R-1",
    estatusId: "s-reparto",
    destinatario: "Ana",
    telefonoDest: "099",
    tiendaId: "u-tienda",
    zonaId: "z-limon",
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "caja",
    peso: null,
    notas: null,
    mensajeroAsignadoId: "m1",
    createdAt: new Date("2026-09-20T09:00:00.000Z"),
    updatedAt: new Date("2026-09-20T09:00:00.000Z"),
    ...overrides,
  };
}

const E_REGISTRADA = evento("2026-09-23T15:00:00.000Z");
const T_RECOGIDA = transicion("2026-09-23T08:00:00.000Z");

function montar() {
  const historialRepo = {
    findHistorialByOrden: vi.fn(async () => [T_RECOGIDA]),
    findEventosByOrden: vi.fn(async () => [E_REGISTRADA]),
    findSenalesGestion: vi.fn(async () => ({ gestionPendiente: null, ayudaAbierta: false })), // 454/R29
    existeActuacionDe: vi.fn(async () => false),
    contarIntentosVigentes: vi.fn(async () => 0),
  };
  const ordenRepo = {
    findById: vi.fn(async () => ordenDTO()),
    findUsuarioZonaId: vi.fn(async () => "z-limon"),
  };
  const correccionRepo: IOrdenDiaRepartoCambioRepository = {
    findCorreccionesByOrden: vi.fn(async () => []),
  };
  const traspasoRepo: IOrdenTraspasoRepository = { findTraspasosByOrden: vi.fn(async () => []) };
  const service = new OrdenHistorialService(
    ordenRepo as unknown as IOrdenRepository,
    historialRepo as unknown as IOrdenHistorialRepository,
    correccionRepo,
    traspasoRepo,
  );
  return { service, historialRepo };
}

describe("454/R30 (b) — el servicio lee los hechos DESPUES de autorizar", () => {
  it("el `ok` trae los hechos de ESTA orden, fusionados con las transiciones", async () => {
    const { service, historialRepo } = montar();
    const r = await service.obtenerHistorial("o1", MAESTRO);
    if (r.status !== "ok") throw new Error(`esperaba ok, llego ${r.status}`);
    expect(historialRepo.findEventosByOrden).toHaveBeenCalledWith("o1");
    expect(r.entradas).toEqual([T_RECOGIDA, E_REGISTRADA]);
  });

  it("quien no ve la linea de tiempo tampoco emite la lectura de hechos (sin regla nueva)", async () => {
    const { service, historialRepo } = montar();
    const r = await service.obtenerHistorial("o1", MENSAJERO_AJENO);
    expect(r.status).toBe("forbidden");
    expect(historialRepo.findEventosByOrden).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------------------------
// (c) el repositorio
// --------------------------------------------------------------------------------------------

describe("454/R30 (c) — `findEventosByOrden`: forma de la consulta y del DTO", () => {
  it("filtra por la orden, ordena `created_at asc, id asc` y mapea con el rol CONGELADO", async () => {
    const findMany = vi.fn(async () => [
      {
        tipo: "gestion_corregida",
        resultado: "devolucion_a_origen_por_rechazo",
        resultadoAnterior: "entregado",
        actorRol: "admin",
        createdAt: new Date("2026-09-23T18:00:00.000Z"),
        actor: { nombre: "Ana", primerApellido: "Solis", segundoApellido: null },
      },
    ]);
    const repo = new OrdenHistorialRepository({
      ordenEvento: { findMany },
    } as unknown as PrismaClient);

    const filas = await repo.findEventosByOrden("o1");

    expect(filas).toEqual([
      {
        clase: "evento_orden",
        tipo: "gestion_corregida",
        resultado: "devolucion_a_origen_por_rechazo",
        resultadoAnterior: "entregado",
        actorNombre: "Ana Solis",
        actorRol: "admin",
        createdAt: new Date("2026-09-23T18:00:00.000Z"),
      },
    ]);
    const args = findMany.mock.calls[0] as unknown as [
      { where: unknown; orderBy: unknown; select: Record<string, unknown> },
    ];
    expect(args[0].where).toEqual({ ordenId: "o1" });
    expect(args[0].orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
    // R30 pide actor e instante: ni `motivo` ni el mensajero salen de aqui.
    expect(Object.keys(args[0].select)).not.toContain("motivo");
    expect(Object.keys(args[0].select)).not.toContain("mensajero");
  });
});
