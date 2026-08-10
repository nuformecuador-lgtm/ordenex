import { describe, it, expect, vi } from "vitest";
import { listarCierresPasadosCompleto } from "@/lib/actions/cierre-dia";
import type {
  CierrePasadoDTO,
  ICierreDiaService,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 184 — Tanda C (T C.1, R4/R6/R7/R17) — el BORDE del conjunto de «Cierres solicitados»
// del mensajero.
//
// Este listado no tiene filtros, así que su lista blanca —derivada de la de su página quitando
// `page`/`pageSize`— no deja NINGUNA clave. Eso no hace el borde prescindible: lo hace más
// estricto. Y aquí la clave que importa tiene nombre propio: `mensajeroId`. Es el ÚNICO listado
// del Anexo A cuyo alcance es el propio usuario, de modo que una clave de alcance que el servicio
// llegara a leer algún día abriría el histórico de dinero de otro mensajero. `page`/`pageSize`
// son las que demuestran que la lista blanca es una DERIVADA del schema de la página y no una
// lista escrita a mano que casualmente hoy coincide.

const MENSAJERO: Actor = { usuarioId: "m-a", rol: "mensajero" };

const CIERRE: CierrePasadoDTO = {
  cierreId: "11111111-1111-4111-8111-111111111111",
  estado: "aprobado",
  destinoTipo: "bodega_central",
  destinoZonaId: "z-central",
  totales: { efectivo: "80.00", simpe: "0.00", transferencia: "0.00", general: "80.00" },
  totalPagoMensajero: "8.00",
  totalIngresoBodegaRechazos: "0.00",
  solicitadoAt: "2026-04-05T00:00:00.000Z",
  resueltoAt: null,
  motivoRechazo: null,
};

function fakeService(resultado: unknown) {
  const metodo = vi.fn().mockResolvedValue(resultado);
  return {
    service: { listarCierresPasadosCompleto: metodo } as unknown as ICierreDiaService,
    metodo,
  };
}

describe("borde del conjunto de «Cierres solicitados» del mensajero (feature 184, T C.1)", () => {
  it("una clave no declarada muere con validation_error sin tocar el service (R17)", async () => {
    // `mensajeroId` es la que importa: el alcance sale de la sesión y jamás de la petición.
    // `page` y `pageSize` son las que prueban que la lista blanca se DERIVA de la de la página:
    // si alguien reescribiera el schema a mano copiando el de la página, estas dos pasarían.
    const coladas: Record<string, unknown>[] = [
      { mensajeroId: "m-b" },
      { usuarioId: "m-b" },
      { page: 2 },
      { pageSize: 100 },
      { page: 1, pageSize: 25 },
      { estado: "aprobado" },
    ];

    for (const input of coladas) {
      const f = fakeService({ status: "ok", items: [CIERRE], total: 1 });
      const r = await listarCierresPasadosCompleto(input, {
        service: f.service,
        getActor: async () => MENSAJERO,
      });

      const etiqueta = JSON.stringify(input);
      expect(r.status, etiqueta).toBe("validation_error");
      expect(r, etiqueta).not.toHaveProperty("items");
      expect(f.metodo, etiqueta).not.toHaveBeenCalled();
    }
  });

  it("sin entrada, o con un objeto vacío, delega en el service con SOLO el actor", async () => {
    for (const input of [undefined, {}]) {
      const f = fakeService({ status: "ok", items: [CIERRE], total: 1 });
      const r = await listarCierresPasadosCompleto(input, {
        service: f.service,
        getActor: async () => MENSAJERO,
      });

      const etiqueta = String(input);
      expect(r, etiqueta).toEqual({ status: "ok", items: [CIERRE], total: 1 });
      // Un solo argumento —el actor— y nada de recorte: este listado no tiene entrada que
      // transportar, y el `page` de la página no puede colarse por aquí.
      expect(f.metodo, etiqueta).toHaveBeenCalledWith(MENSAJERO);
      expect(f.metodo.mock.calls[0], etiqueta).toHaveLength(1);
    }
  });

  it("sin sesión devuelve unauthenticated y ninguna fila, sin tocar el service (R7)", async () => {
    const f = fakeService({ status: "ok", items: [CIERRE], total: 1 });
    const r = await listarCierresPasadosCompleto({}, {
      service: f.service,
      getActor: async () => null,
    });

    expect(r.status).toBe("unauthenticated");
    expect(r).not.toHaveProperty("items");
    expect(f.metodo).not.toHaveBeenCalled();
  });

  it("el actor se resuelve ANTES de validar: sin sesión no se filtra la lista blanca", async () => {
    // Sin sesión y con una clave de alcance en la entrada, la respuesta es `unauthenticated`, no
    // `validation_error`: quien no tiene sesión no debe poder deducir qué claves acepta esta
    // superficie probando entradas.
    const f = fakeService({ status: "ok", items: [], total: 0 });
    const r = await listarCierresPasadosCompleto({ mensajeroId: "m-b" }, {
      service: f.service,
      getActor: async () => null,
    });

    expect(r.status).toBe("unauthenticated");
    expect(f.metodo).not.toHaveBeenCalled();
  });

  it("forbidden del service pasa tal cual, sin filas ni total (R7)", async () => {
    const f = fakeService({ status: "forbidden" });
    const r = await listarCierresPasadosCompleto({}, {
      service: f.service,
      getActor: async () => ({ usuarioId: "u-maestro", rol: "maestro" }),
    });

    expect(r).toEqual({ status: "forbidden" });
    expect(r).not.toHaveProperty("items");
    expect(r).not.toHaveProperty("total"); // un conteo también es información
  });

  it("limite_excedido del service pasa tal cual: conteos y NINGUNA fila (R6)", async () => {
    const f = fakeService({ status: "limite_excedido", total: 5432, limite: 5000 });
    const r = await listarCierresPasadosCompleto({}, {
      service: f.service,
      getActor: async () => MENSAJERO,
    });

    expect(r).toEqual({ status: "limite_excedido", total: 5432, limite: 5000 });
    expect(r).not.toHaveProperty("items");
  });
});
