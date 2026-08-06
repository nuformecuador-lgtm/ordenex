import { describe, it, expect, vi } from "vitest";
import { listarPlantillasCompletoAction } from "@/lib/actions/gasto-fijo-plantilla";
import { listarSaldosTiendasCompletoAction } from "@/lib/actions/wallet-tienda";
import type { IGastoFijoPlantillaService } from "@/lib/interfaces/services/IGastoFijoPlantillaService";
import type { IWalletTiendaService } from "@/lib/interfaces/services/IWalletTiendaService";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";
import type { SaldoTiendaResumenDTO } from "@/lib/types/wallet-tienda";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 184 — Tanda G (T G.1, R4/R6/R7/R17) — los BORDES de los dos conjuntos de la wallet:
// «Plantillas de gasto fijo» (listado 11) y «Saldos de tiendas» (listado 12).
//
// Ninguno de los dos listados tiene filtros, asi que su lista blanca —derivada de la de su
// pagina quitando `page`/`pageSize`— no deja NINGUNA clave. Eso no hace el borde prescindible:
// lo hace maximamente estricto. Las claves que importan:
//
//  - `tiendaId` en los saldos: la unica que convertiria el saldo de TODAS las tiendas en el de
//    una tienda elegida por quien pide;
//  - `page`/`pageSize` en los dos: son las que demuestran que la lista blanca es una DERIVADA
//    del schema de la pagina y no una lista escrita a mano que hoy casualmente coincide.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const TIENDA: Actor = { usuarioId: "t-1", rol: "adminTienda" };

const PLANTILLA: GastoFijoPlantillaDTO = {
  id: "11111111-1111-4111-8111-111111111111",
  concepto: "Alquiler",
  monto: "80000.00",
  activa: true,
  periodicidadUnidad: "meses",
  periodicidadCantidad: 1,
  fechaCobro: "2026-07-13",
  createdAt: "2026-07-13T10:00:00.000Z",
  updatedAt: "2026-07-13T10:00:00.000Z",
};

const SALDO: SaldoTiendaResumenDTO = {
  tiendaId: "t-1",
  tiendaNombre: "Tienda Uno",
  saldo: "8500.00",
  signo: "positivo",
};

/** El borde de las plantillas con su servicio doblado; devuelve el espia del metodo. */
function montarPlantillas(resultado: unknown) {
  const espia = vi.fn().mockResolvedValue(resultado);
  const service = { listarPlantillasCompleto: espia } as unknown as IGastoFijoPlantillaService;
  return {
    espia,
    llamar: (input: unknown, getActor: () => Promise<Actor | null>) =>
      listarPlantillasCompletoAction(input, { service, getActor }),
  };
}

/** Idem para el borde de los saldos por tienda. */
function montarSaldos(resultado: unknown) {
  const espia = vi.fn().mockResolvedValue(resultado);
  const service = { listarSaldosTiendasCompleto: espia } as unknown as IWalletTiendaService;
  return {
    espia,
    llamar: (input: unknown, getActor: () => Promise<Actor | null>) =>
      listarSaldosTiendasCompletoAction(input, { service, getActor }),
  };
}

const BORDES = [
  {
    nombre: "listarPlantillasCompletoAction",
    fila: PLANTILLA as unknown,
    montar: montarPlantillas,
  },
  {
    nombre: "listarSaldosTiendasCompletoAction",
    fila: SALDO as unknown,
    montar: montarSaldos,
  },
] as const;

const CON_SESION = async () => MAESTRO;
const SIN_SESION = async () => null;

describe("bordes de los conjuntos de la wallet (feature 184, T G.1)", () => {
  it("una clave no declarada muere con validation_error sin tocar el service (R17)", async () => {
    const coladas: Record<string, unknown>[] = [
      { tiendaId: "t-2" }, // la que abriria el saldo de una tienda elegida por quien pide
      { page: 2 }, // las dos que prueban que la lista blanca se DERIVA de la de la pagina
      { pageSize: 100 },
      { page: 1, pageSize: 25 },
      { activa: true }, // un "filtro" que este listado no tiene
      { busqueda: "" },
    ];

    for (const b of BORDES) {
      for (const input of coladas) {
        const { espia, llamar } = b.montar({ status: "ok", items: [b.fila], total: 1 });
        const r = await llamar(input, CON_SESION);

        const etiqueta = `${b.nombre} / ${JSON.stringify(input)}`;
        expect(r.status, etiqueta).toBe("validation_error");
        expect(r, etiqueta).not.toHaveProperty("items");
        expect(espia, etiqueta).not.toHaveBeenCalled();
      }
    }
  });

  it("sin entrada, o con un objeto vacio, delega en el service con SOLO el actor", async () => {
    for (const b of BORDES) {
      for (const input of [undefined, {}]) {
        const { espia, llamar } = b.montar({ status: "ok", items: [b.fila], total: 1 });
        const r = await llamar(input, CON_SESION);

        const etiqueta = `${b.nombre} / ${String(input)}`;
        expect(r, etiqueta).toEqual({ status: "ok", items: [b.fila], total: 1 });
        // Un solo argumento —el actor— y nada de recorte: estos listados no tienen entrada que
        // transportar, y el `page` de la pagina no puede colarse por aqui.
        expect(espia, etiqueta).toHaveBeenCalledWith(MAESTRO);
        expect(espia.mock.calls[0], etiqueta).toHaveLength(1);
      }
    }
  });

  it("sin sesion devuelve unauthenticated y ninguna fila, sin tocar el service (R7)", async () => {
    for (const b of BORDES) {
      const { espia, llamar } = b.montar({ status: "ok", items: [b.fila], total: 1 });
      const r = await llamar({}, SIN_SESION);

      expect(r.status, b.nombre).toBe("unauthenticated");
      expect(r, b.nombre).not.toHaveProperty("items");
      expect(espia, b.nombre).not.toHaveBeenCalled();
    }
  });

  it("el actor se resuelve ANTES de validar: sin sesion no se filtra la lista blanca", async () => {
    // Sin sesion y con basura en la entrada, la respuesta es `unauthenticated`, no
    // `validation_error`: quien no tiene sesion no debe poder deducir que claves acepta esta
    // superficie probando entradas.
    for (const b of BORDES) {
      const { espia, llamar } = b.montar({ status: "ok", items: [], total: 0 });
      const r = await llamar({ tiendaId: "t-2" }, SIN_SESION);

      expect(r.status, b.nombre).toBe("unauthenticated");
      expect(espia, b.nombre).not.toHaveBeenCalled();
    }
  });

  it("forbidden del service pasa tal cual, sin filas ni total (R7)", async () => {
    for (const b of BORDES) {
      const { llamar } = b.montar({ status: "forbidden" });
      const r = await llamar({}, async () => TIENDA);

      expect(r, b.nombre).toEqual({ status: "forbidden" });
      expect(r, b.nombre).not.toHaveProperty("items");
      expect(r, b.nombre).not.toHaveProperty("total"); // un conteo tambien es informacion
    }
  });

  it("limite_excedido del service pasa tal cual: conteos y NINGUNA fila (R6)", async () => {
    for (const b of BORDES) {
      const { llamar } = b.montar({ status: "limite_excedido", total: 5432, limite: 5000 });
      const r = await llamar({}, CON_SESION);

      expect(r, b.nombre).toEqual({ status: "limite_excedido", total: 5432, limite: 5000 });
      expect(r, b.nombre).not.toHaveProperty("items");
    }
  });
});
