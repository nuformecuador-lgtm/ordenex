import { describe, it, expect, vi } from "vitest";

import { DevolucionSlaService } from "@/lib/services/DevolucionSlaService";
import { reintentosConfig } from "@/lib/config/reintentos";
import type {
  DevueltaSlaRow,
  EscalarDevueltaSlaInput,
  IDevolucionSlaRepository,
} from "@/lib/interfaces/repositories/IDevolucionSlaRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";

/**
 * FEATURE 273 (T10) — EL CRON DE SLA MIRA EL CONTADOR EN LA RAMA `wrong_*`. R28, R29, R30.
 *
 * 💰 Es la PRIMERA vez que este sistema ADELANTA un cobro. Lo que lo hace aceptable, y lo que este
 * archivo fija caso a caso:
 *
 *  · NO cambia QUE pasa, solo CUANDO: esa rama YA escalaba a `rechazada` de forma INCONDICIONAL al
 *    vencer sus cinco dias. Mirar el contador no puede producir un desenlace distinto;
 *  · POR DEBAJO del umbral la ventana de cinco dias se aplica EXACTAMENTE como hoy (R29);
 *  · `not_found` conserva su comportamiento entero en los dos lados del umbral (no-regresion).
 *
 * Medido y citado: la guia `28098171` llevaba 89,1 h de 120 esperando un desenlace ya decidido.
 */

const CENTRAL = "z-central";
const SATELITE = "z-limon";
const NOW = new Date("2026-07-20T12:00:00.000Z");
const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

const UMBRAL = reintentosConfig.MIN_INTENTOS_ENTREGA;

const ESTATUS: Record<string, string> = {
  devuelta: "os-devuelta",
  en_bodega_central: "os-en-bodega",
  en_bodega_satelite: "os-en-bodega-satelite",
  rechazada: "os-rechazada",
};

function row(overrides: Partial<DevueltaSlaRow> = {}): DevueltaSlaRow {
  return {
    ordenId: "o1",
    zonaId: SATELITE,
    mensajeroId: "m1",
    causa: "not_found",
    ancladaAt: new Date(NOW.getTime() - 2 * HORA), // por defecto: RECIEN anclada
    origenAncla: "aprobacion",
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<IDevolucionSlaRepository> = {}): IDevolucionSlaRepository {
  return {
    findDevueltasSla: vi.fn(async () => [row()]),
    liberarDevueltaSla: vi.fn(async () => true),
    escalarDevueltaSla: vi.fn(async () => true),
    ...overrides,
  };
}

/** Doble del derivador EN LOTE. Devuelve `porOrden[id] ?? 0`, y registra sus llamadas (R30). */
function fakeHistorial(
  porOrden: Record<string, number> = {},
): Pick<IOrdenHistorialService, "contarIntentosEnLote"> {
  return {
    contarIntentosEnLote: vi.fn(
      async (ids: string[]) => new Map(ids.map((id) => [id, porOrden[id] ?? 0])),
    ),
  };
}

function newService(
  repo: IDevolucionSlaRepository,
  historial: Pick<IOrdenHistorialService, "contarIntentosEnLote">,
) {
  return new DevolucionSlaService(
    repo,
    { findCentralZonaId: vi.fn(async () => CENTRAL) } as unknown as IZonaRepository,
    {
      findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS[v] ?? null),
    } as unknown as IOrdenRepository,
    historial as unknown as IOrdenHistorialService,
    { warn: vi.fn() },
  );
}

/* -------------------------------------------------------------------------- */
/* 1 · R28 — en el umbral, escala sin esperar la ventana                       */
/* -------------------------------------------------------------------------- */

describe("273/T10 · R28 — `wrong_*` en el umbral escala en la PRIMERA corrida", () => {
  it.each(["wrong_number", "wrong_address"] as const)(
    "1. %s con `intentos = umbral` y 2 h desde el anclaje -> ESCALA",
    async (causa) => {
      const repo = fakeRepo({
        findDevueltasSla: vi.fn(async () => [
          row({ causa, ancladaAt: new Date(NOW.getTime() - 2 * HORA) }),
        ]),
      });

      const res = await newService(repo, fakeHistorial({ o1: UMBRAL })).ejecutar(NOW);

      expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 1, omitidas: 0, legadas: 0 });
      expect(repo.escalarDevueltaSla).toHaveBeenCalledTimes(1);
      const arg = (repo.escalarDevueltaSla as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as EscalarDevueltaSlaInput;
      expect(arg.ordenId).toBe("o1");
      // La atribucion no cambia: el mensajero de la gestion `devuelta` vigente y el motivo de
      // siempre. Es el MISMO escalado, adelantado.
      expect(arg.mensajeroId).toBe("m1");
      expect(arg.motivo).toBe(`escalado SLA ${causa}`);
      expect(repo.liberarDevueltaSla).not.toHaveBeenCalled();
    },
  );

  it("1.bis — POR ENCIMA del umbral tambien escala ya (`>=`, no `===`)", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ causa: "wrong_address", ancladaAt: new Date(NOW.getTime() - 1 * HORA) }),
      ]),
    });

    const res = await newService(repo, fakeHistorial({ o1: UMBRAL + 2 })).ejecutar(NOW);

    expect(res.escaladas).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 2 · R29 — por debajo del umbral, la ventana INTACTA                         */
/* -------------------------------------------------------------------------- */

describe("273/T10 · R29 — por debajo del umbral, los cinco dias siguen valiendo", () => {
  it("2a. `wrong_address` con `intentos = umbral - 1` y 2 h -> NO escala, solo se evalua", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ causa: "wrong_address", ancladaAt: new Date(NOW.getTime() - 2 * HORA) }),
      ]),
    });

    const res = await newService(repo, fakeHistorial({ o1: UMBRAL - 1 })).ejecutar(NOW);

    expect(res).toEqual({ evaluadas: 1, liberadas: 0, escaladas: 0, omitidas: 0, legadas: 0 });
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
    expect(repo.liberarDevueltaSla).not.toHaveBeenCalled();
  });

  it("2b. la MISMA orden a los 5 dias SI escala: la ventana no se toco", async () => {
    // El par 2a/2b es lo que hace que R29 no sea una frase: lo unico que cambia entre los dos es
    // el tiempo transcurrido. Si la 273 hubiera roto la ventana, 2b escalaria por otra razon o 2a
    // escalaria de mas.
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ causa: "wrong_address", ancladaAt: new Date(NOW.getTime() - 5 * DIA) }),
      ]),
    });

    const res = await newService(repo, fakeHistorial({ o1: UMBRAL - 1 })).ejecutar(NOW);

    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 1, omitidas: 0, legadas: 0 });
  });

  it("2c. con `intentos = 0` y 4 dias y 23 h, sigue SIN escalar (el borde de la ventana)", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ causa: "wrong_number", ancladaAt: new Date(NOW.getTime() - (5 * DIA - HORA)) }),
      ]),
    });

    const res = await newService(repo, fakeHistorial()).ejecutar(NOW);

    expect(res.escaladas).toBe(0);
    expect(res.evaluadas).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 3 · `not_found` conserva EXACTAMENTE su comportamiento (no-regresion)       */
/* -------------------------------------------------------------------------- */

describe("273/T10 · `not_found` no cambia en ninguno de los dos lados del umbral", () => {
  it("3a. `not_found` vencida (>=24 h) con `intentos = umbral` -> ESCALA (como siempre)", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ causa: "not_found", ancladaAt: new Date(NOW.getTime() - 25 * HORA) }),
      ]),
    });

    const res = await newService(repo, fakeHistorial({ o1: UMBRAL })).ejecutar(NOW);

    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 1, omitidas: 0, legadas: 0 });
  });

  it("3b. `not_found` vencida con `intentos < umbral` -> LIBERA a bodega (reintento, como siempre)", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ causa: "not_found", ancladaAt: new Date(NOW.getTime() - 25 * HORA), zonaId: CENTRAL }),
      ]),
    });

    const res = await newService(repo, fakeHistorial({ o1: UMBRAL - 1 })).ejecutar(NOW);

    expect(res).toEqual({ evaluadas: 0, liberadas: 1, escaladas: 0, omitidas: 0, legadas: 0 });
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
  });

  it("3c. `not_found` AUN VIVA (<24 h) con `intentos = umbral` -> NO actua", async () => {
    // ⭑ EL CASO QUE SEPARA LAS DOS RAMAS. Si el adelanto por tope se hubiera escrito sin
    // condicionarlo a `wrong_*`, esta orden escalaria a las 2 h y `not_found` perderia su ventana
    // de 24 h —que existe para que la tienda corrija el telefono—.
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ causa: "not_found", ancladaAt: new Date(NOW.getTime() - 2 * HORA) }),
      ]),
    });

    const res = await newService(repo, fakeHistorial({ o1: UMBRAL })).ejecutar(NOW);

    expect(res).toEqual({ evaluadas: 1, liberadas: 0, escaladas: 0, omitidas: 0, legadas: 0 });
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
    expect(repo.liberarDevueltaSla).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* 4 · R30 — un conteo por corrida, no uno por orden                           */
/* -------------------------------------------------------------------------- */

describe("273/T10 · R30 — el conteo es UNO por corrida", () => {
  it("4. con CINCO candidatas, `contarIntentosEnLote` se llama UNA vez con las cinco", async () => {
    const ids = ["o1", "o2", "o3", "o4", "o5"];
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () =>
        ids.map((ordenId, i) =>
          row({
            ordenId,
            causa: i % 2 === 0 ? "wrong_address" : "not_found",
            ancladaAt: new Date(NOW.getTime() - 30 * HORA),
          }),
        ),
      ),
    });
    const historial = fakeHistorial({ o1: UMBRAL, o3: UMBRAL });

    await newService(repo, historial).ejecutar(NOW);

    expect(historial.contarIntentosEnLote).toHaveBeenCalledTimes(1);
    expect(historial.contarIntentosEnLote).toHaveBeenCalledWith(ids);
  });

  it("4.bis — las DOS ramas leen del MISMO Map: el numero no puede discrepar entre ellas", async () => {
    // `o-wrong` y `o-notfound` tienen el MISMO conteo (el umbral). La primera escala por el tope
    // sin esperar; la segunda escala porque su ventana de 24 h ya vencio. Las dos usan el mismo
    // numero, de la misma lectura: si cada rama contara por su cuenta habria dos formas de obtener
    // el mismo dato en el mismo servicio (215/R4).
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({
          ordenId: "o-wrong",
          causa: "wrong_address",
          ancladaAt: new Date(NOW.getTime() - 2 * HORA),
        }),
        row({
          ordenId: "o-notfound",
          causa: "not_found",
          ancladaAt: new Date(NOW.getTime() - 25 * HORA),
        }),
      ]),
    });
    const historial = fakeHistorial({ "o-wrong": UMBRAL, "o-notfound": UMBRAL });

    const res = await newService(repo, historial).ejecutar(NOW);

    expect(res.escaladas).toBe(2);
    expect(historial.contarIntentosEnLote).toHaveBeenCalledTimes(1);
  });

  it("4.ter — sin candidatas, el servicio NO pide ningun conteo", async () => {
    const repo = fakeRepo({ findDevueltasSla: vi.fn(async () => []) });
    const historial = fakeHistorial();

    const res = await newService(repo, historial).ejecutar(NOW);

    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 0, omitidas: 0, legadas: 0 });
    // Se llama con `[]` (el propio `contarIntentosEnLote` corta sin emitir consulta) o no se
    // llama: lo que NO puede pasar es que se pida el conteo de algo.
    const llamadas = (historial.contarIntentosEnLote as ReturnType<typeof vi.fn>).mock.calls;
    for (const [ids] of llamadas) expect(ids).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 5 · R30 — idempotencia y resiliencia, intactas                              */
/* -------------------------------------------------------------------------- */

describe("273/T10 · R30 — no se emite dos veces el ingreso por rechazo", () => {
  it("5. una orden que ya salio de `devuelta` entre la lectura y la escritura NO se cuenta como escalada", async () => {
    // `escalarDevueltaSla` devuelve `false` cuando su `updateMany` guardado por
    // `estatus_id = devuelta` afecta 0 filas. Es la guarda que impide el DOBLE COBRO, y esta
    // ficha no la toca: lo unico que cambia es CUANDO entra la orden a esa llamada.
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ causa: "wrong_address", ancladaAt: new Date(NOW.getTime() - 2 * HORA) }),
      ]),
      escalarDevueltaSla: vi.fn(async () => false),
    });

    const res = await newService(repo, fakeHistorial({ o1: UMBRAL })).ejecutar(NOW);

    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 0, omitidas: 1, legadas: 0 });
  });

  it("5.bis — una orden que falla no aborta la corrida: la siguiente escala igual", async () => {
    const escalar = vi
      .fn<IDevolucionSlaRepository["escalarDevueltaSla"]>()
      .mockRejectedValueOnce(new Error("base caida"))
      .mockResolvedValueOnce(true);
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({
          ordenId: "o-falla",
          causa: "wrong_address",
          ancladaAt: new Date(NOW.getTime() - 2 * HORA),
        }),
        row({
          ordenId: "o-ok",
          causa: "wrong_address",
          ancladaAt: new Date(NOW.getTime() - 2 * HORA),
        }),
      ]),
      escalarDevueltaSla: escalar,
    });

    const res = await newService(
      repo,
      fakeHistorial({ "o-falla": UMBRAL, "o-ok": UMBRAL }),
    ).ejecutar(NOW);

    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 1, omitidas: 1, legadas: 0 });
  });
});
