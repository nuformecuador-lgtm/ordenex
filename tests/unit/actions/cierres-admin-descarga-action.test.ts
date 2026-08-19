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

  it("sin entrada, o con un objeto vacío, delega en el service con el actor y SIN filtros", async () => {
    // El título y la última afirmación cambiaron el 2026-08-16, y no por relajarse. Decían «con
    // SOLO el actor» y fijaban la aridad en 1: era exacto MIENTRAS estos listados no tenían
    // filtros. El pedido humano de ese día les dio cuatro, así que ahora el borde transporta un
    // segundo argumento — y lo que hay que afirmar es que, sin entrada, ese argumento es
    // `undefined`: quien no filtra sigue pidiendo el conjunto entero de su alcance, igual que
    // antes. Lo que NO puede colarse por aquí sigue sin poder: `page` y las claves de alcance
    // mueren en la lista blanca (ver los casos de abajo y la guardia de `filtros-cierres`).
    for (const { nombre, accion, metodo } of BORDES) {
      for (const input of [undefined, {}]) {
        const f = fakeService(metodo, { status: "ok", items: [CIERRE], total: 1 });
        const r = await accion(input, { service: f.service, getActor: async () => MAESTRO });

        const etiqueta = `${nombre} / ${String(input)}`;
        expect(r, etiqueta).toEqual({ status: "ok", items: [CIERRE], total: 1 });
        expect(f.espia, etiqueta).toHaveBeenCalledWith(MAESTRO, undefined);
      }
    }
  });

  it("los filtros de la entrada llegan al service, y el alcance sigue sin viajar", async () => {
    // La otra mitad del caso de arriba: lo que el usuario SÍ pidió tiene que llegar, porque de
    // eso depende que el archivo sea «esto que estoy viendo, entero» y no «todo lo del alcance».
    const filtros = { desde: "2026-08-01", mensajeroIds: ["11111111-1111-4111-8111-111111111111"] };
    for (const { nombre, accion, metodo } of BORDES) {
      const f = fakeService(metodo, { status: "ok", items: [CIERRE], total: 1 });
      await accion({ filtros }, { service: f.service, getActor: async () => MAESTRO });
      expect(f.espia, nombre).toHaveBeenCalledWith(MAESTRO, filtros);
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
