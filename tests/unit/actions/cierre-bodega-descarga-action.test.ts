import { describe, it, expect, vi } from "vitest";
import {
  listarCierresBodegaSolicitadosCompleto,
  listarConsolidablesCompleto,
} from "@/lib/actions/cierre-bodega";
import type {
  CierreBodegaResumen,
  CierreBodegaResumenLite,
  ICierreBodegaService,
} from "@/lib/interfaces/services/ICierreBodegaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 184 — Tanda B (T B.1, R4/R6/R7/R17) — los BORDES de los dos conjuntos de la
// consolidación.
//
// Los dos listados no tienen filtros, así que su lista blanca —derivada de la de su página
// quitando `page`/`pageSize`— no deja NINGUNA clave. Eso no hace el borde prescindible: lo hace
// más estricto. La clave que importa es `zonaId`, la única que, si el servicio llegara a
// leerla algún día, abriría el dinero de la bodega vecina; y `page`/`pageSize` son las que
// demuestran que la lista blanca es una DERIVADA del schema de la página y no una lista escrita
// a mano que casualmente hoy coincide.

const SAT: Actor = { usuarioId: "u-sat-a", rol: "adminSatelite" };

const CIERRE: CierreBodegaResumen = {
  cierreBodegaId: "11111111-1111-4111-8111-111111111111",
  zonaId: "z-a",
  zonaNombre: "Zona A",
  solicitadoPorId: "u-sat-a",
  solicitadoPorNombre: "Sat A",
  estado: "aprobado",
  totales: { efectivo: "300.00", simpe: "0.00", transferencia: "0.00", general: "300.00" },
  totalPagoMensajero: "30.00",
  totalIngresoBodegaRechazos: "0.00",
  cantidadCierres: 2,
  solicitadoAt: "2026-03-05T00:00:00.000Z",
  resueltoAt: null,
  motivoRechazo: null,
};

const CONSOLIDABLE: CierreBodegaResumenLite = {
  cierreDiaId: "c-1",
  mensajeroId: "m-1",
  mensajeroNombre: "Mensajero 1",
  totales: { efectivo: "100.00", simpe: "0.00", transferencia: "0.00", general: "100.00" },
  totalPagoMensajero: "30.00",
  totalIngresoBodegaRechazos: "5.00",
};

function fakeService(resultado: unknown) {
  const listarCierresBodegaSolicitadosCompletoSvc = vi.fn().mockResolvedValue(resultado);
  const listarConsolidablesCompletoSvc = vi.fn().mockResolvedValue(resultado);
  return {
    cierreBodegaService: {
      listarCierresBodegaSolicitadosCompleto: listarCierresBodegaSolicitadosCompletoSvc,
      listarConsolidablesCompleto: listarConsolidablesCompletoSvc,
    } as unknown as ICierreBodegaService,
    seis: listarCierresBodegaSolicitadosCompletoSvc,
    siete: listarConsolidablesCompletoSvc,
  };
}

/** Los dos bordes de la tanda, con el doble de su método y una fila de ejemplo cada uno. */
const BORDES = [
  {
    nombre: "listarCierresBodegaSolicitadosCompleto",
    llamar: listarCierresBodegaSolicitadosCompleto,
    metodo: (f: ReturnType<typeof fakeService>) => f.seis,
    fila: CIERRE as unknown,
  },
  {
    nombre: "listarConsolidablesCompleto",
    llamar: listarConsolidablesCompleto,
    metodo: (f: ReturnType<typeof fakeService>) => f.siete,
    fila: CONSOLIDABLE as unknown,
  },
] as const;

describe("bordes de los conjuntos de la consolidación (feature 184, T B.1)", () => {
  it("una clave no declarada muere con validation_error sin tocar el service (R17)", async () => {
    // `zonaId` es la que importa: el alcance sale del actor y jamás de la petición. `page` y
    // `pageSize` son las que prueban que la lista blanca se DERIVA de la de la página: si alguien
    // reescribiera el schema a mano copiando el de la página, estas dos pasarían.
    const coladas: Record<string, unknown>[] = [
      { zonaId: "z-b" },
      { page: 2 },
      { pageSize: 100 },
      { page: 1, pageSize: 25 },
      { estado: "solicitado" },
      { busqueda: "" },
    ];

    for (const borde of BORDES) {
      for (const input of coladas) {
        const f = fakeService({ status: "ok", items: [borde.fila], total: 1 });
        const r = await borde.llamar(input, {
          cierreBodegaService: f.cierreBodegaService,
          getActor: async () => SAT,
        });

        const etiqueta = `${borde.nombre} / ${JSON.stringify(input)}`;
        expect(r.status, etiqueta).toBe("validation_error");
        expect(r, etiqueta).not.toHaveProperty("items");
        expect(borde.metodo(f), etiqueta).not.toHaveBeenCalled();
      }
    }
  });

  it("sin entrada, o con un objeto vacío, delega en el service con el actor y SIN filtros", async () => {
    // El título y la última afirmación cambiaron el 2026-08-16, y no por relajarse. Decían «con
    // SOLO el actor» y fijaban la aridad en 1: era exacto MIENTRAS estos listados no tenían
    // filtros. El pedido humano de ese día les dio dos (fecha y bodega; el de mensajero se omite
    // aquí a propósito: un cierre de bodega consolida los de varios), así que el borde transporta
    // un segundo argumento — y lo que hay que afirmar es que, sin entrada, ese argumento es
    // `undefined`: quien no filtra sigue pidiendo el conjunto entero de su alcance. Lo que NO
    // puede colarse sigue sin poder: `page` y `zonaId` mueren en la lista blanca.

    for (const borde of BORDES) {
      for (const input of [undefined, {}]) {
        const f = fakeService({ status: "ok", items: [borde.fila], total: 1 });
        const r = await borde.llamar(input, {
          cierreBodegaService: f.cierreBodegaService,
          getActor: async () => SAT,
        });

        const etiqueta = `${borde.nombre} / ${String(input)}`;
        expect(r, etiqueta).toEqual({ status: "ok", items: [borde.fila], total: 1 });
        // Un solo argumento —el actor— y nada de recorte: estos listados no tienen entrada que
        // transportar, y el `page` de la página no puede colarse por aquí.
        expect(borde.metodo(f), etiqueta).toHaveBeenCalledWith(SAT, undefined);
      }
    }
  });

  it("sin sesión devuelve unauthenticated y ninguna fila, sin tocar el service (R7)", async () => {
    for (const borde of BORDES) {
      const f = fakeService({ status: "ok", items: [borde.fila], total: 1 });
      const r = await borde.llamar({}, {
        cierreBodegaService: f.cierreBodegaService,
        getActor: async () => null,
      });

      expect(r.status, borde.nombre).toBe("unauthenticated");
      expect(r, borde.nombre).not.toHaveProperty("items");
      expect(borde.metodo(f), borde.nombre).not.toHaveBeenCalled();
    }
  });

  it("el actor se resuelve ANTES de validar: sin sesión no se filtra la lista blanca", async () => {
    // Sin sesión y con basura en la entrada, la respuesta es `unauthenticated`, no
    // `validation_error`: quien no tiene sesión no debe poder deducir qué claves acepta esta
    // superficie probando entradas.
    for (const borde of BORDES) {
      const f = fakeService({ status: "ok", items: [], total: 0 });
      const r = await borde.llamar({ zonaId: "z-b" }, {
        cierreBodegaService: f.cierreBodegaService,
        getActor: async () => null,
      });

      expect(r.status, borde.nombre).toBe("unauthenticated");
      expect(borde.metodo(f), borde.nombre).not.toHaveBeenCalled();
    }
  });

  it("forbidden del service pasa tal cual, sin filas ni total (R7)", async () => {
    for (const borde of BORDES) {
      const f = fakeService({ status: "forbidden" });
      const r = await borde.llamar({}, {
        cierreBodegaService: f.cierreBodegaService,
        getActor: async () => ({ usuarioId: "u-maestro", rol: "maestro" }),
      });

      expect(r, borde.nombre).toEqual({ status: "forbidden" });
      expect(r, borde.nombre).not.toHaveProperty("items");
      expect(r, borde.nombre).not.toHaveProperty("total"); // un conteo también es información
    }
  });

  it("limite_excedido del service pasa tal cual: conteos y NINGUNA fila (R6)", async () => {
    for (const borde of BORDES) {
      const f = fakeService({ status: "limite_excedido", total: 5432, limite: 5000 });
      const r = await borde.llamar({}, {
        cierreBodegaService: f.cierreBodegaService,
        getActor: async () => SAT,
      });

      expect(r, borde.nombre).toEqual({ status: "limite_excedido", total: 5432, limite: 5000 });
      expect(r, borde.nombre).not.toHaveProperty("items");
    }
  });
});
