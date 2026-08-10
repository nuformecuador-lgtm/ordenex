import { describe, it, expect, vi } from "vitest";
import {
  listarHistoricoIncidentesCompleto,
  listarPendientesIncidentesCompleto,
} from "@/lib/actions/incidentes";
import type {
  IIncidenteAdminService,
  IncidenteAdminDTO,
} from "@/lib/interfaces/services/IIncidenteAdminService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 184 — Tanda F (T F.2, R4/R6/R7/R17) — el BORDE de los dos conjuntos de «Incidentes».
//
// Estos listados no tienen filtros, así que su lista blanca —derivada de la de su página quitando
// `page`/`pageSize`— no deja NINGUNA clave. Eso no hace el borde prescindible: lo hace más
// estricto. Aquí la clave que importa es `zonaId`: el alcance de estas dos tablas es la zona de la
// ORDEN, resuelta server-side desde el actor, y un `zonaId` que llegara a leerse convertiría el
// archivo de un `adminSatelite` en el de la zona vecina —con las indemnizaciones de la vecina
// dentro—. `estado` es la otra: el corte cola/histórico lo decide la base, no la petición.
// `page`/`pageSize` son las que demuestran que la lista blanca es una DERIVADA del schema de la
// página y no una lista escrita a mano que hoy coincide.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

const INCIDENTE: IncidenteAdminDTO = {
  incidenteId: "11111111-1111-4111-8111-111111111111",
  ordenId: "22222222-2222-4222-8222-222222222222",
  numGuia: 101,
  numRemision: "REM-1",
  destinatario: "Ana",
  zonaNombre: "Zona Uno",
  estatusValue: "incidente",
  causa: "danado",
  motivo: "Caja aplastada",
  estado: "aprobado",
  indemnizacion: "100.00",
  reportadoPorNombre: "Autor Uno",
  resueltoPorNombre: "Maestro Uno",
  resueltoAt: "2026-03-07T12:00:00.000Z",
  motivoRechazo: null,
  createdAt: "2026-03-07T00:00:00.000Z",
  // El archivo NO lleva evidencias (R22 de la 170) y el conjunto no las firma: el DTO que sale de
  // este camino trae la lista vacía, y así viaja por el borde.
  evidenciaUrls: [],
  esPropio: false,
};

function fakeService(metodo: string, resultado: unknown) {
  const espia = vi.fn().mockResolvedValue(resultado);
  return {
    service: { [metodo]: espia } as unknown as IIncidenteAdminService,
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
    accion: listarPendientesIncidentesCompleto,
    metodo: "listarPendientesIncidentesCompleto" as const,
  },
  {
    nombre: "historico",
    accion: listarHistoricoIncidentesCompleto,
    metodo: "listarHistoricoIncidentesCompleto" as const,
  },
];

describe("borde de los conjuntos de «Incidentes» (feature 184, T F.2)", () => {
  it("una clave no declarada muere con validation_error sin tocar el service (R17)", async () => {
    const coladas: Record<string, unknown>[] = [
      { zonaId: "z-vecina" },
      { estado: "solicitado" },
      { page: 2 },
      { pageSize: 100 },
      { page: 1, pageSize: 25 },
      { busqueda: "" },
    ];

    for (const { nombre, accion, metodo } of BORDES) {
      for (const entrada of coladas) {
        const f = fakeService(metodo, { status: "ok", items: [INCIDENTE], total: 1 });
        const r = await accion(entrada, { service: f.service, getActor: async () => MAESTRO });

        const etiqueta = `${nombre} / ${JSON.stringify(entrada)}`;
        expect(r.status, etiqueta).toBe("validation_error");
        expect(r, etiqueta).not.toHaveProperty("items");
        expect(f.espia, etiqueta).not.toHaveBeenCalled();
      }
    }
  });

  it("sin entrada, o con un objeto vacío, delega en el service con SOLO el actor", async () => {
    for (const { nombre, accion, metodo } of BORDES) {
      for (const entrada of [undefined, {}]) {
        const f = fakeService(metodo, { status: "ok", items: [INCIDENTE], total: 1 });
        const r = await accion(entrada, { service: f.service, getActor: async () => MAESTRO });

        const etiqueta = `${nombre} / ${String(entrada)}`;
        expect(r, etiqueta).toEqual({ status: "ok", items: [INCIDENTE], total: 1 });
        // Un solo argumento —el actor— y nada de recorte: estos listados no tienen entrada que
        // transportar, y el `page` de la página no puede colarse por aquí.
        expect(f.espia, etiqueta).toHaveBeenCalledWith(MAESTRO);
        expect(f.espia.mock.calls[0], etiqueta).toHaveLength(1);
      }
    }
  });

  it("sin sesión devuelve unauthenticated y ninguna fila, sin tocar el service (R7)", async () => {
    for (const { nombre, accion, metodo } of BORDES) {
      const f = fakeService(metodo, { status: "ok", items: [INCIDENTE], total: 1 });
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
      const r = await accion({ zonaId: "z-vecina" }, { service: f.service, getActor: async () => null });

      expect(r.status, nombre).toBe("unauthenticated");
      expect(f.espia, nombre).not.toHaveBeenCalled();
    }
  });

  it("forbidden del service pasa tal cual, sin filas ni total (R7)", async () => {
    for (const { nombre, accion, metodo } of BORDES) {
      const f = fakeService(metodo, { status: "forbidden" });
      const r = await accion(
        {},
        { service: f.service, getActor: async () => ({ usuarioId: "g1", rol: "mensajero" }) },
      );

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
