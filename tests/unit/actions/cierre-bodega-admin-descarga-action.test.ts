import { describe, it, expect, vi } from "vitest";
import {
  listarHistoricoCierresBodegaCompleto,
  listarPendientesCierresBodegaCompleto,
} from "@/lib/actions/cierre-bodega";
import type { CierreBodegaResumen } from "@/lib/interfaces/services/ICierreBodegaService";
import type { ICierresBodegaAdminService } from "@/lib/interfaces/services/ICierresBodegaAdminService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 184 — Tanda E (T E.2, R4/R6/R7/R17) — el BORDE de los dos conjuntos de «Cierres de
// bodega» del admin.
//
// Estos listados no tienen filtros, así que su lista blanca —derivada de la de su página quitando
// `page`/`pageSize`— no deja NINGUNA clave. Eso no hace el borde prescindible: lo hace más
// estricto. Aquí las claves que importan son `zonaId` y `estado`: el alcance de estas dos tablas
// es el ROL (acceso total sobre la operación entera) y el corte cola/histórico lo decide la base,
// de modo que cualquiera de las dos, si el servicio llegara a leerla algún día, convertiría un
// archivo del maestro en otra cosa. `page`/`pageSize` son las que demuestran que la lista blanca
// es una DERIVADA del schema de la página y no una lista escrita a mano que hoy coincide.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

const CIERRE: CierreBodegaResumen = {
  cierreBodegaId: "11111111-1111-4111-8111-111111111111",
  zonaId: "22222222-2222-4222-8222-222222222222",
  zonaNombre: "Zona Uno",
  solicitadoPorId: "33333333-3333-4333-8333-333333333333",
  solicitadoPorNombre: "Sat Uno",
  estado: "aprobado",
  totales: { efectivo: "500.00", simpe: "0.00", transferencia: "0.00", general: "500.00" },
  totalPagoMensajero: "50.00",
  totalIngresoBodegaRechazos: "0.00",
  cantidadCierres: 3,
  solicitadoAt: "2026-02-05T00:00:00.000Z",
  resueltoAt: "2026-02-06T00:00:00.000Z",
  motivoRechazo: null,
};

function fakeService(metodo: string, resultado: unknown) {
  const espia = vi.fn().mockResolvedValue(resultado);
  return {
    cierresBodegaAdminService: { [metodo]: espia } as unknown as ICierresBodegaAdminService,
    espia,
  };
}

/**
 * Los DOS bordes, con el mismo contrato. Cada caso los recorre enteros: un olvido en uno solo de
 * los dos —el `.parse` que no se escribió, el schema de la página en vez del derivado— es
 * exactamente el modo de fallo que este archivo tiene que ver.
 */
const BORDES = [
  {
    nombre: "pendientes",
    accion: listarPendientesCierresBodegaCompleto,
    metodo: "listarPendientesCierresBodegaCompleto" as const,
  },
  {
    nombre: "resueltos",
    accion: listarHistoricoCierresBodegaCompleto,
    metodo: "listarHistoricoCierresBodegaCompleto" as const,
  },
];

describe("borde de los conjuntos de «Cierres de bodega» del admin (feature 184, T E.2)", () => {
  it("una clave no declarada muere con validation_error sin tocar el service (R17)", async () => {
    const coladas: Record<string, unknown>[] = [
      { zonaId: "z-vecina" },
      { estado: "aprobado" },
      { page: 2 },
      { pageSize: 100 },
      { page: 1, pageSize: 25 },
      { busqueda: "" },
    ];

    for (const { nombre, accion, metodo } of BORDES) {
      for (const input of coladas) {
        const f = fakeService(metodo, { status: "ok", items: [CIERRE], total: 1 });
        const r = await accion(input, {
          cierresBodegaAdminService: f.cierresBodegaAdminService,
          getActor: async () => MAESTRO,
        });

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
        const r = await accion(input, {
          cierresBodegaAdminService: f.cierresBodegaAdminService,
          getActor: async () => MAESTRO,
        });

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
      const r = await accion(
        {},
        { cierresBodegaAdminService: f.cierresBodegaAdminService, getActor: async () => null },
      );

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
        { zonaId: "z-vecina" },
        { cierresBodegaAdminService: f.cierresBodegaAdminService, getActor: async () => null },
      );

      expect(r.status, nombre).toBe("unauthenticated");
      expect(f.espia, nombre).not.toHaveBeenCalled();
    }
  });

  it("forbidden del service pasa tal cual, sin filas ni total (R7)", async () => {
    for (const { nombre, accion, metodo } of BORDES) {
      const f = fakeService(metodo, { status: "forbidden" });
      const r = await accion(
        {},
        {
          cierresBodegaAdminService: f.cierresBodegaAdminService,
          getActor: async () => ({ usuarioId: "s1", rol: "adminSatelite" }),
        },
      );

      expect(r, nombre).toEqual({ status: "forbidden" });
      expect(r, nombre).not.toHaveProperty("items");
      expect(r, nombre).not.toHaveProperty("total"); // un conteo también es información
    }
  });

  it("limite_excedido del service pasa tal cual: conteos y NINGUNA fila (R6)", async () => {
    for (const { nombre, accion, metodo } of BORDES) {
      const f = fakeService(metodo, { status: "limite_excedido", total: 5432, limite: 5000 });
      const r = await accion(
        {},
        { cierresBodegaAdminService: f.cierresBodegaAdminService, getActor: async () => MAESTRO },
      );

      expect(r, nombre).toEqual({ status: "limite_excedido", total: 5432, limite: 5000 });
      expect(r, nombre).not.toHaveProperty("items");
    }
  });
});
