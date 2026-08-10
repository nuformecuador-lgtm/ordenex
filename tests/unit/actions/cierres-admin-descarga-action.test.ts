import { describe, it, expect, vi } from "vitest";
import {
  listarHistoricoCierresAdminCompleto,
  listarPendientesCierresAdminCompleto,
} from "@/lib/actions/cierres-admin";
import type {
  CierreAdminResumen,
  ICierresAdminService,
} from "@/lib/interfaces/services/ICierresAdminService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 184 — Tanda D (T D.2, R4/R6/R7/R17) — el BORDE de los dos conjuntos de «Cierres del
// día» del admin.
//
// Estos listados no tienen filtros, así que su lista blanca —derivada de la de su página quitando
// `page`/`pageSize`— no deja NINGUNA clave. Eso no hace el borde prescindible: lo hace más
// estricto. Y aquí la clave que importa tiene nombre propio: `destinoZonaId`. El alcance de esta
// pantalla es rol + zona DESTINO, de modo que una clave de alcance que el servicio llegara a leer
// algún día abriría el dinero de la bodega vecina. `page`/`pageSize` son las que demuestran que
// la lista blanca es una DERIVADA del schema de la página y no una lista escrita a mano que
// casualmente hoy coincide.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

const CIERRE: CierreAdminResumen = {
  cierreId: "11111111-1111-4111-8111-111111111111",
  mensajeroId: "22222222-2222-4222-8222-222222222222",
  mensajeroNombre: "Ana",
  estado: "aprobado",
  destinoTipo: "bodega_central",
  destinoZonaId: "33333333-3333-4333-8333-333333333333",
  destinoZonaNombre: "Central",
  totales: { efectivo: "80.00", simpe: "0.00", transferencia: "0.00", general: "80.00" },
  totalPagoMensajero: "8.00",
  totalIngresoBodegaRechazos: "0.00",
  pendientePagoMensajero: "8.00",
  solicitadoAt: "2026-04-05T00:00:00.000Z",
  resueltoAt: "2026-04-06T00:00:00.000Z",
  motivoRechazo: null,
};

/**
 * Los DOS bordes, con el mismo contrato. Cada caso los recorre enteros: un olvido en uno solo de
 * los dos —el `.parse` que no se escribió, el schema de la página en vez del derivado— es
 * exactamente el modo de fallo que este archivo tiene que ver.
 */
const BORDES = [
  {
    nombre: "histórico",
    accion: listarHistoricoCierresAdminCompleto,
    metodo: "listarHistoricoCierresAdminCompleto" as const,
  },
  {
    nombre: "cola de pendientes",
    accion: listarPendientesCierresAdminCompleto,
    metodo: "listarPendientesCierresAdminCompleto" as const,
  },
];

function fakeService(metodo: string, resultado: unknown) {
  const espia = vi.fn().mockResolvedValue(resultado);
  return {
    service: { [metodo]: espia } as unknown as ICierresAdminService,
    espia,
  };
}

describe("borde de los conjuntos de «Cierres del día» del admin (feature 184, T D.2)", () => {
  it("una clave no declarada muere con validation_error sin tocar el service (R17)", async () => {
    // `destinoZonaId` y `destinoTipo` son las que importan: el alcance sale de la sesión y jamás
    // de la petición. `page`/`pageSize` son las que prueban que la lista blanca se DERIVA de la
    // de la página: si alguien la reescribiera a mano copiando aquella, estas dos pasarían.
    const coladas: Record<string, unknown>[] = [
      { destinoZonaId: "z-vecina" },
      { destinoTipo: "bodega_satelite" },
      { page: 2 },
      { pageSize: 100 },
      { page: 1, pageSize: 25 },
      { estado: "aprobado" },
    ];

    for (const { nombre, accion, metodo } of BORDES) {
      for (const input of coladas) {
        const f = fakeService(metodo, { status: "ok", items: [CIERRE], total: 1 });
        const r = await accion(input, { service: f.service, getActor: async () => MAESTRO });

        const etiqueta = `${nombre} / ${JSON.stringify(input)}`;
        expect(r.status, etiqueta).toBe("validation_error");
        expect(r, etiqueta).not.toHaveProperty("items");
        expect(f.espia, etiqueta).not.toHaveBeenCalled();
      }
    }
  });

  it("sin entrada, o con un objeto vacío, delega en el service con SOLO el actor", async () => {
    for (const { nombre, accion, metodo } of BORDES) {
      for (const input of [undefined, {}]) {
        const f = fakeService(metodo, { status: "ok", items: [CIERRE], total: 1 });
        const r = await accion(input, { service: f.service, getActor: async () => MAESTRO });

        const etiqueta = `${nombre} / ${String(input)}`;
        expect(r, etiqueta).toEqual({ status: "ok", items: [CIERRE], total: 1 });
        // Un solo argumento —el actor— y nada de recorte: estos listados no tienen entrada que
        // transportar, y el `page` de la página no puede colarse por aquí.
        expect(f.espia, etiqueta).toHaveBeenCalledWith(MAESTRO);
        expect(f.espia.mock.calls[0], etiqueta).toHaveLength(1);
      }
    }
  });

  it("sin sesión devuelve unauthenticated y ninguna fila, sin tocar el service (R7)", async () => {
    for (const { nombre, accion, metodo } of BORDES) {
      const f = fakeService(metodo, { status: "ok", items: [CIERRE], total: 1 });
      const r = await accion({}, { service: f.service, getActor: async () => null });

      expect(r.status, nombre).toBe("unauthenticated");
      expect(r, nombre).not.toHaveProperty("items");
      expect(f.espia, nombre).not.toHaveBeenCalled();
    }
  });

  it("el actor se resuelve ANTES de validar: sin sesión no se filtra la lista blanca", async () => {
    // Sin sesión y con una clave de alcance en la entrada, la respuesta es `unauthenticated`, no
    // `validation_error`: quien no tiene sesión no debe poder deducir qué claves acepta esta
    // superficie probando entradas.
    for (const { nombre, accion, metodo } of BORDES) {
      const f = fakeService(metodo, { status: "ok", items: [], total: 0 });
      const r = await accion(
        { destinoZonaId: "z-vecina" },
        { service: f.service, getActor: async () => null },
      );

      expect(r.status, nombre).toBe("unauthenticated");
      expect(f.espia, nombre).not.toHaveBeenCalled();
    }
  });

  it("forbidden del service pasa tal cual, sin filas ni total (R7)", async () => {
    for (const { nombre, accion, metodo } of BORDES) {
      const f = fakeService(metodo, { status: "forbidden" });
      const r = await accion({}, {
        service: f.service,
        getActor: async () => ({ usuarioId: "g1", rol: "mensajero" }),
      });

      expect(r, nombre).toEqual({ status: "forbidden" });
      expect(r, nombre).not.toHaveProperty("items");
      expect(r, nombre).not.toHaveProperty("total"); // un conteo también es información
    }
  });

  it("limite_excedido del service pasa tal cual: conteos y NINGUNA fila (R6)", async () => {
    for (const { nombre, accion, metodo } of BORDES) {
      const f = fakeService(metodo, { status: "limite_excedido", total: 5432, limite: 5000 });
      const r = await accion({}, { service: f.service, getActor: async () => MAESTRO });

      expect(r, nombre).toEqual({ status: "limite_excedido", total: 5432, limite: 5000 });
      expect(r, nombre).not.toHaveProperty("items");
    }
  });
});
