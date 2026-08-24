import { describe, it, expect, vi } from "vitest";
import { DeshacerAsignacionService } from "@/lib/services/DeshacerAsignacionService";
import { GuiaAsignacionService } from "@/lib/services/GuiaAsignacionService";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";
import type { IOrdenRepository, OrdenTransicionRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  EstadoAsignabilidad,
  IAsignabilidadCoordenadasService,
  OrdenAsignabilidadRow,
} from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 149 — T4.9 (R19): aqui vivia una ASIMETRIA DELIBERADA entre ASIGNAR y DESHACER cuando
// el mensajero tiene un cierre de dia pendiente (Q1 CERRADA, design §8-Q1):
//
//   deshacer  -> el cierre NO bloquea: `ok`, y el service NI SIQUIERA consulta el gate.
//   asignar   -> el cierre SI bloqueaba: `conflict`.
//
// PEDIDO HUMANO 2026-08-18 — LA ASIMETRIA DESAPARECIO, y por el lado que faltaba: ahora asignar
// tampoco consulta el gate. Los dos caminos coinciden, asi que este archivo deja de custodiar una
// diferencia y pasa a custodiar la COINCIDENCIA — que sigue mereciendo un testigo, porque el
// bloqueo por cierre existio en uno de los dos durante meses y su retirada fue una decision, no un
// descuido.
//
// ⚠️ FEATURE 241 (2026-08-20) — LA ASIMETRIA VOLVIO, PERO EN OTRO EJE, y conviene decirlo aqui para
// que nadie lea esta coincidencia como «los cierres ya no bloquean nada». Hoy el corte no pasa
// entre asignar y deshacer-asignacion —los dos son movimientos de BODEGA y ninguno bloquea— sino
// entre RECIBIR TRABAJO y GESTIONARLO:
//
//   asignar / deshacer asignacion / rutear  -> NUNCA bloquean, con cierre o sin el (regla 2).
//   gestionar / recoger / escoger / deshacer GESTION / recolectar en tienda
//                                           -> SI bloquean, y solo con `vencido` o `rechazado`.
//
// Los dos casos de este archivo siguen en el lado que no bloquea, asi que siguen verdes tal cual.
// Ojo con el detalle que los mantiene ciertos por partida doble: el mensajero de aqui arrastra un
// cierre `solicitado`, que desde la 241 NO bloquea NINGUNA de las dos cosas.
//
// Los dos asertos siguen siendo sobre EL MISMO mensajero (`m-cierre`) con un cierre `solicitado`.

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
  // Feature 262 (B3): `fechaReparto` pasa a ser OBLIGATORIO en la fila de transicion. Ninguna
  // asercion de este archivo cambia: lo que aqui se mide es que un cierre pendiente no bloquea.
  fechaReparto: null,
};

describe("T4.9(a)/R19 — DESHACER con el mensajero en cierre pendiente: `ok`", () => {
  it("revierte la orden y NO consulta findMensajerosBloqueadosPorCierres (el gate no aplica)", async () => {
    // El espia esta DISPONIBLE en el doble; el service no puede invocarlo porque su `Pick` no
    // lo incluye. El aserto fija esa decision de diseño, no solo la implementacion actual.
    const findMensajerosBloqueadosPorCierres = vi.fn(
      async (): Promise<Set<string>> => new Set([MENSAJERO_CON_CIERRE]),
    );
    const deshacerAsignacionLote = vi.fn(async () => 1);
    const repo = {
      findUsuarioZonaId: vi.fn(async () => null),
      findByIdsForTransicion: vi.fn(async () => [ORDEN]),
      findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID[v] ?? null),
      deshacerAsignacionLote,
      findMensajerosBloqueadosPorCierres,
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
    expect(findMensajerosBloqueadosPorCierres).not.toHaveBeenCalled();
  });
});

// ⚠️ ESTE BLOQUE SE DIO LA VUELTA EL 2026-08-23 (FEATURE 271, R28). Se llamaba «ASIGNAR a ese MISMO
// mensajero YA NO se bloquea (2026-08-18)» y era la otra mitad de la asimetria que la 241 firmo. El
// humano revirtio esa mitad: asignar SI se bloquea. La asimetria que este archivo mide sigue
// existiendo, pero es la CONTRARIA: DESASIGNAR (quitarle trabajo a quien esta atascado) no se
// bloquea; ASIGNAR (darselo) si.
describe("T4.9(b) — ASIGNAR a ese MISMO mensajero SI se bloquea (feature 271, 2026-08-23)", () => {
  it("GuiaAsignacionService.asignarDesdeBodega -> conflict, consultando el gate de cierres", async () => {
    const asignarBodegaLote = vi.fn(async (ids: string[]) => ids.length);
    const findMensajerosBloqueadosPorCierres = vi.fn(
      async (): Promise<Set<string>> => new Set([MENSAJERO_CON_CIERRE]),
    );
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
      // El doble sigue diciendo que este mensajero esta bloqueado: el punto es que ya nadie
      // pregunta.
      findMensajerosBloqueadosPorCierres,
      findMensajerosConOrdenesEn: vi.fn(async (): Promise<Set<string>> => new Set()),
      asignarBodegaLote,
    } as unknown as IOrdenRepository;
    const zonaRepo = {
      findCentralZonaId: vi.fn(async () => ZONA_CENTRAL),
    } as unknown as IZonaRepository;
    const gate: IAsignabilidadCoordenadasService = {
      evaluar: async (ordenes: OrdenAsignabilidadRow[]) =>
        new Map<string, EstadoAsignabilidad>(ordenes.map((o) => [o.id, "asignable"])),
    };
    const service = new GuiaAsignacionService(repo, zonaRepo, gate, fakeIntentosEnLote() /* 276: la puerta del tope; 0 intentos = no interfiere */);

    const r = await service.asignarDesdeBodega(
      { ordenIds: ["o1"], mensajeroId: MENSAJERO_CON_CIERRE },
      MAESTRO,
    );

    expect(r.status).toBe("conflict");
    // R30: todo-o-nada. La guarda va ANTES de cualquier escritura.
    expect(asignarBodegaLote).not.toHaveBeenCalled();
    // LA ASIMETRIA, con el signo nuevo: `deshacer` NO consulta el gate (quitar trabajo no bloquea)
    // y `asignar` SI lo consulta (darlo si). Antes los dos lo ignoraban.
    expect(findMensajerosBloqueadosPorCierres).toHaveBeenCalledWith([MENSAJERO_CON_CIERRE]);
  });
});
