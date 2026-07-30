import { describe, it, expect, vi } from "vitest";
import { DeshacerAsignacionService } from "@/lib/services/DeshacerAsignacionService";
import { GuiaAsignacionService } from "@/lib/services/GuiaAsignacionService";
import type { IOrdenRepository, OrdenTransicionRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  EstadoAsignabilidad,
  IAsignabilidadCoordenadasService,
  OrdenAsignabilidadRow,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 149 — T4.9 (R19): ASIMETRIA DELIBERADA entre ASIGNAR y DESHACER cuando el mensajero
// tiene un cierre de dia pendiente (Q1 CERRADA, design §8-Q1).
//
//   deshacer  -> el cierre NO bloquea: `ok`, y el service NI SIQUIERA consulta el gate.
//   asignar   -> el cierre SIGUE bloqueando: `conflict` (gate vigente, no se toca).
//
// Los dos asertos son sobre EL MISMO mensajero (`m-cierre`) con un cierre `solicitado`. Si
// alguien "armonizara" ambos caminos, uno de los dos casos rompe.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const MENSAJERO_CON_CIERRE = "m-cierre";
const ZONA_CENTRAL = "z-central";

const ESTATUS_ID: Record<string, string> = {
  por_recoger: "os-por-recoger",
  en_ruta_bodega_satelite: "os-ruta-satelite",
  en_bodega_central: "os-bodega-central",
  en_bodega_satelite: "os-bodega-satelite",
};

const ORDEN: OrdenTransicionRow = {
  id: "o1",
  estatusValue: "por_recoger",
  numGuia: 4321,
  deletedAt: null,
  zonaId: ZONA_CENTRAL,
  zonaEsGam: true,
  tiendaId: "store-1",
};

describe("T4.9(a)/R19 — DESHACER con el mensajero en cierre pendiente: `ok`", () => {
  it("revierte la orden y NO consulta findMensajerosBloqueados (el gate no aplica)", async () => {
    // El espia esta DISPONIBLE en el doble; el service no puede invocarlo porque su `Pick` no
    // lo incluye. El aserto fija esa decision de diseño, no solo la implementacion actual.
    const findMensajerosBloqueados = vi.fn(
      async (): Promise<Set<string>> => new Set([MENSAJERO_CON_CIERRE]),
    );
    const deshacerAsignacionLote = vi.fn(async () => 1);
    const repo = {
      findUsuarioZonaId: vi.fn(async () => null),
      findByIdsForTransicion: vi.fn(async () => [ORDEN]),
      findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID[v] ?? null),
      deshacerAsignacionLote,
      findMensajerosBloqueados,
    };
    const service = new DeshacerAsignacionService(
      repo,
      { findCentralZonaId: vi.fn(async () => ZONA_CENTRAL) },
      { findOrigenesReversion: vi.fn(async () => new Map([["o1", "en_bodega_central"]])) },
    );

    const r = await service.deshacer(
      { ordenIds: ["o1"], motivo: "el mensajero renuncio hoy, la orden vuelve a bodega" },
      MAESTRO,
    );

    expect(r.status).toBe("ok"); // el cierre pendiente NO es causa de rechazo (R19)
    expect(deshacerAsignacionLote).toHaveBeenCalledTimes(1);
    expect(findMensajerosBloqueados).not.toHaveBeenCalled();
  });
});

describe("T4.9(b)/R19 — ASIGNAR a ese MISMO mensajero sigue bloqueado: `conflict`", () => {
  it("GuiaAsignacionService.asignarDesdeBodega -> conflict por cierre pendiente (no-regresion)", async () => {
    const asignarBodegaLote = vi.fn(async (ids: string[]) => ids.length);
    const repo = {
      findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID[v] ?? null),
      findByIdsForTransicion: vi.fn(async () => [
        { ...ORDEN, estatusValue: "en_bodega_central" },
      ]),
      findMensajeroIdsValidos: vi.fn(async (ids: string[]): Promise<Set<string>> => new Set(ids)),
      findMensajeroIdsValidosByZona: vi.fn(
        async (ids: string[]): Promise<Set<string>> => new Set(ids),
      ),
      findParaAsignabilidad: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({
          id,
          direccion: "x",
          latitud: 9.9,
          longitud: -84.1,
          geocodeStatus: "OK",
        })),
      ),
      // El MISMO mensajero, con su cierre `solicitado` -> bloqueado para ASIGNAR.
      findMensajerosBloqueados: vi.fn(
        async (): Promise<Set<string>> => new Set([MENSAJERO_CON_CIERRE]),
      ),
      asignarBodegaLote,
    } as unknown as IOrdenRepository;
    const zonaRepo = {
      findCentralZonaId: vi.fn(async () => ZONA_CENTRAL),
    } as unknown as IZonaRepository;
    const gate: IAsignabilidadCoordenadasService = {
      evaluar: async (ordenes: OrdenAsignabilidadRow[]) =>
        new Map<string, EstadoAsignabilidad>(ordenes.map((o) => [o.id, "asignable"])),
    };
    const service = new GuiaAsignacionService(repo, zonaRepo, gate);

    const r = await service.asignarDesdeBodega(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO_CON_CIERRE },
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    if (r.status === "conflict") {
      expect(r.detalle).toEqual([
        { ordenId: "o1", motivo: "mensajero bloqueado por cierre pendiente" },
      ]);
    }
    expect(asignarBodegaLote).not.toHaveBeenCalled(); // el gate de asignacion sigue VIGENTE
  });
});
