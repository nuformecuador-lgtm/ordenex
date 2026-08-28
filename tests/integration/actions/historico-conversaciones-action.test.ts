import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  listarHilosHistorico,
  listarMensajesHistorico,
} from "@/lib/actions/historico-conversaciones";
import type { IHistoricoConversacionesService } from "@/lib/interfaces/services/IHistoricoConversacionesService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 321 / T3.7 — el BORDE de las dos Server Actions del histórico.
//
// QUE SE MIDE AQUI Y NO EN OTRO SITIO. El servicio ya valida por su cuenta (T3.6), pero lo que
// llega a una Server Action es `unknown`: viene del navegador. Este archivo afirma las dos
// garantias del borde, y las dos con un `not.toHaveBeenCalled()` porque el `status` por si solo
// no distingue «rechazado antes de consultar» de «consultado y luego rechazado»:
//
//   1. R38 — entrada que no valida contra su esquema `.strict()` -> `validation_error` SIN que el
//      service (y por tanto la base) se toque;
//   2. sin sesion -> `unauthenticated`, tambien sin tocar el service.
//
// El doble viaja por el SEGUNDO parametro de la accion, que el cliente nunca manda: desde el
// navegador solo cruza el primero.

const ACTOR: Actor = { usuarioId: "u-1", rol: "admin" };

function crearServiceDoble() {
  return {
    listarHilos: vi.fn(async () => ({ status: "ok", items: [], siguiente: null })),
    listarMensajes: vi.fn(async () => ({ status: "not_found" })),
  } as unknown as IHistoricoConversacionesService & {
    listarHilos: ReturnType<typeof vi.fn>;
    listarMensajes: ReturnType<typeof vi.fn>;
  };
}

describe("321 / T3.7 — Server Actions del histórico de conversaciones", () => {
  let servicio: ReturnType<typeof crearServiceDoble>;

  beforeEach(() => {
    servicio = crearServiceDoble();
  });

  const conActor = () => ({
    historicoService: servicio,
    getActor: async (): Promise<Actor | null> => ACTOR,
  });
  const sinActor = () => ({
    historicoService: servicio,
    getActor: async (): Promise<Actor | null> => null,
  });

  // ==========================================================================================
  // Sin sesion
  // ==========================================================================================

  it("sin sesion, el listado responde unauthenticated y no toca el service", async () => {
    expect(await listarHilosHistorico({}, sinActor())).toEqual({ status: "unauthenticated" });
    expect(servicio.listarHilos).not.toHaveBeenCalled();
  });

  it("sin sesion, la pagina del hilo responde unauthenticated y no toca el service", async () => {
    expect(
      await listarMensajesHistorico(
        { ordenId: "orden-1", mensajeroId: "mensajero-1" },
        sinActor(),
      ),
    ).toEqual({ status: "unauthenticated" });
    expect(servicio.listarMensajes).not.toHaveBeenCalled();
  });

  // ==========================================================================================
  // R38 — borde tipado del LISTADO
  // ==========================================================================================

  const ENTRADAS_INVALIDAS_LISTADO: [string, unknown][] = [
    ["lista de mensajeros VACIA (se omite la clave, nunca se manda [])", { filtro: { mensajero_id: [] } }],
    ["fecha que no es YYYY-MM-DD", { filtro: { fecha_desde: "28/08/2026" } }],
    ["fecha inexistente en el calendario", { filtro: { fecha_desde: "2026-02-31" } }],
    ["rango de fechas invertido", { filtro: { fecha_desde: "2026-08-20", fecha_hasta: "2026-08-01" } }],
    ["tamaño de pagina 0", { limite: 0 }],
    ["tamaño de pagina por encima del techo", { limite: 999 }],
    ["cursor incompleto", { cursor: { ordenId: "x" } }],
    ["cursor con un instante que no es ISO", { cursor: { ultimaActividadAt: "ayer", ordenId: "o", mensajeroId: "m" } }],
    ["clave desconocida", { desconocida: 1 }],
    ["termino de busqueda por debajo del minimo", { filtro: { q: "ma" } }],
  ];

  it.each(ENTRADAS_INVALIDAS_LISTADO)(
    "R38 (listado): %s -> validation_error sin consultar",
    async (_caso, entrada) => {
      const res = await listarHilosHistorico(entrada, conActor());
      expect(res.status).toBe("validation_error");
      expect(servicio.listarHilos).not.toHaveBeenCalled();
    },
  );

  it("una entrada valida llega al service YA PARSEADA", async () => {
    await listarHilosHistorico(
      { filtro: { mensajero_id: ["m-1"], q: "  maría  " }, limite: 10 },
      conActor(),
    );
    // `q` llega con `.trim()` aplicado: el borde normaliza, el service no adivina.
    expect(servicio.listarHilos).toHaveBeenCalledWith(
      { filtro: { mensajero_id: ["m-1"], q: "maría" }, limite: 10 },
      ACTOR,
    );
  });

  it("«sin filtros, primera pagina» es una entrada VALIDA: se expresa no mandando nada", async () => {
    const res = await listarHilosHistorico(undefined, conActor());
    expect(res.status).toBe("ok");
    expect(servicio.listarHilos).toHaveBeenCalledWith({}, ACTOR);
  });

  // ==========================================================================================
  // R38 / R17 — borde tipado de la PAGINA DEL HILO
  // ==========================================================================================

  const ENTRADAS_INVALIDAS_HILO: [string, unknown][] = [
    ["sin mensajeroId (el hilo es el PAR)", { ordenId: "orden-1" }],
    ["sin ordenId", { mensajeroId: "mensajero-1" }],
    ["R17: con filtro de fecha, que aqui no existe", { ordenId: "o", mensajeroId: "m", fecha_desde: "2026-08-15" }],
    ["tamaño de pagina por encima del techo", { ordenId: "o", mensajeroId: "m", limite: 101 }],
    ["cursor sin id", { ordenId: "o", mensajeroId: "m", cursor: { ocurridoAt: "2026-08-20T15:00:00.000Z" } }],
    ["entrada ausente", undefined],
  ];

  it.each(ENTRADAS_INVALIDAS_HILO)(
    "R38 (hilo): %s -> validation_error sin consultar",
    async (_caso, entrada) => {
      const res = await listarMensajesHistorico(entrada, conActor());
      expect(res.status).toBe("validation_error");
      expect(servicio.listarMensajes).not.toHaveBeenCalled();
    },
  );

  it("una pagina de hilo valida llega al service con el par y el cursor", async () => {
    await listarMensajesHistorico(
      {
        ordenId: "orden-1",
        mensajeroId: "mensajero-1",
        cursor: { ocurridoAt: "2026-08-20T15:00:00.000Z", id: "msg-1" },
      },
      conActor(),
    );
    expect(servicio.listarMensajes).toHaveBeenCalledWith(
      {
        ordenId: "orden-1",
        mensajeroId: "mensajero-1",
        cursor: { ocurridoAt: "2026-08-20T15:00:00.000Z", id: "msg-1" },
      },
      ACTOR,
    );
  });
});
