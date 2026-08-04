import { describe, it, expect, vi } from "vitest";
import type { ErrorLogger } from "@/lib/errors/logger";
import { consultarAnaliticaOperativa } from "@/lib/actions/analitica-operativa";
import type { IAnaliticaOperativaService } from "@/lib/interfaces/services/IAnaliticaOperativaService";
import { AHORA, MAESTRO, TIENDA } from "./_fake-operativa";
import type { SerieOperativa } from "@/lib/types/analitica-operativa";

// Feature 126 / T9.2 + T9.3 — R5 y R6, EN EL BORDE.
//
// ⚠ R5 ESPIA EL LOGGER, NO EL STATUS, y el motivo esta verificado en el codigo:
// `normalizeError` devuelve la shape del `AppError` en su PRIMERA linea
// (`lib/errors/normalize.ts:22`) y solo llama a `logger.logError` en la rama del error
// DESCONOCIDO (`:45`). Un borde que lanzara `ForbiddenError` y confiara en
// `withErrorHandler` responderia 403 correctamente y NO dejaria rastro: el 403 mudo. Un test
// que mirase el status aprobaria a los dos.
//
// R6 cuenta LLAMADAS al servicio: una entrada invalida no puede tocar la base ni una vez, y
// tampoco puede servir para sondear el catalogo o los permisos de un rol (por eso devuelve
// `validation_error` y no `forbidden`, sin revelar el motivo).

const SERIE_VACIA: SerieOperativa = {
  metricaId: "entregas",
  unidad: "conteo",
  unidadDeConteo: "gestion",
  rango: {
    preset: "dia",
    desde: AHORA,
    hasta: AHORA,
    desdeFecha: "2026-08-03",
    hastaFecha: "2026-08-03",
  },
  puntos: [],
  cobertura: {
    fechasNoComparables: [],
    penumbra: "ordenes_vivas_al_horizonte_sin_transicion_posterior",
  },
};

function servicioEspia(): IAnaliticaOperativaService & { llamadas: number } {
  const estado = { llamadas: 0 };
  return {
    get llamadas() {
      return estado.llamadas;
    },
    async consultar() {
      estado.llamadas += 1;
      return SERIE_VACIA;
    },
    // Feature 176 — la interfaz gano `consultarAgregado`. Este doble es de la 126 y solo
    // cuenta llamadas a `consultar`: si el borde de la serie llamara al agregado, esto lo
    // dice a gritos en vez de devolver un objeto plausible.
    async consultarAgregado(): Promise<never> {
      throw new Error("este doble sirve la SERIE, no el agregado");
    },
  };
}

function deps(actor = MAESTRO) {
  const logError = vi.fn();
  const logger: ErrorLogger = { logError };
  const service = servicioEspia();
  return {
    logError,
    service,
    opciones: {
      service,
      logger,
      now: () => AHORA,
      getActor: async () => actor,
    },
  };
}

describe("R5 · el denegado deja rastro ANTES de responder", () => {
  it("un denegado deja rastro en el logger antes de responder 403", async () => {
    // Un `adminTienda` pidiendo una metrica del dinero: `metrica_prohibida`, garantizado.
    const { logError, opciones } = deps(TIENDA);
    const r = await consultarAnaliticaOperativa(
      { metricaId: "egresos", raw: { rango: "dia" } },
      opciones,
    );
    expect(r.status).toBe("forbidden");
    expect(logError).toHaveBeenCalledTimes(1);
    const registro = logError.mock.calls[0][0] as Record<string, unknown>;
    expect(registro.evento).toBe("analitica_denegado");
    expect(registro.motivo).toBe("metrica_prohibida");
    expect(registro.rol).toBe("adminTienda");
    expect(registro.usuarioId).toBe(TIENDA.usuarioId);
  });

  it("y responde `forbidden` SIN datos y SIN motivo: nunca `ok` con ceros", async () => {
    const { opciones } = deps(TIENDA);
    const r = await consultarAnaliticaOperativa(
      { metricaId: "egresos", raw: { rango: "dia" } },
      opciones,
    );
    expect(r).toEqual({ status: "forbidden" });
    expect(JSON.stringify(r)).not.toContain("metrica_prohibida");
    expect("datos" in r).toBe(false);
  });

  it("el servicio NO se llega a invocar cuando el alcance deniega", async () => {
    const { service, opciones } = deps(TIENDA);
    await consultarAnaliticaOperativa({ metricaId: "egresos", raw: { rango: "dia" } }, opciones);
    expect(service.llamadas).toBe(0);
  });
});

describe("R6 · una entrada invalida no toca la base", () => {
  it("una entrada invalida no toca la base ni una vez", async () => {
    const { service, logError, opciones } = deps();
    const r = await consultarAnaliticaOperativa(
      { metricaId: "entregas", raw: { rango: "quincena" } },
      opciones,
    );
    expect(r.status).toBe("validation_error");
    expect(service.llamadas).toBe(0);
    // Y NO se audita: no hay denegado que registrar, y un filtro malformado no es un intento
    // de acceso a datos ajenos.
    expect(logError).not.toHaveBeenCalled();
  });

  it("devuelve fieldErrors por campo, no un mensaje suelto", async () => {
    const { opciones } = deps();
    const r = await consultarAnaliticaOperativa(
      { metricaId: "entregas", raw: { rango: "personalizado", desde: "2026-08-05", hasta: "2026-08-01" } },
      opciones,
    );
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("no es validation_error");
    expect(Object.keys(r.fieldErrors)).toContain("hasta");
  });

  it("una clave desconocida en el filtro es rechazo, no silencio", async () => {
    // `.strict()` en el schema de la 135: `{ rol: "maestro" }` seria un vector de escalada si
    // se ignorara en silencio.
    const { service, opciones } = deps();
    const r = await consultarAnaliticaOperativa(
      { metricaId: "entregas", raw: { rango: "dia", rol: "maestro" } },
      opciones,
    );
    expect(r.status).toBe("validation_error");
    expect(service.llamadas).toBe(0);
  });
});

describe("borde · el camino feliz sigue funcionando", () => {
  it("una consulta concedida llega al servicio y devuelve `ok` con la serie", async () => {
    const { service, logError, opciones } = deps();
    const r = await consultarAnaliticaOperativa(
      { metricaId: "entregas", raw: { rango: "dia" } },
      opciones,
    );
    expect(r.status).toBe("ok");
    expect(service.llamadas).toBe(1);
    expect(logError).not.toHaveBeenCalled();
  });

  it("sin sesion se deniega y se audita como `sin_sesion`", async () => {
    const logError = vi.fn();
    const r = await consultarAnaliticaOperativa(
      { metricaId: "entregas", raw: { rango: "dia" } },
      { service: servicioEspia(), logger: { logError }, now: () => AHORA, getActor: async () => null },
    );
    expect(r.status).toBe("forbidden");
    expect((logError.mock.calls[0][0] as Record<string, unknown>).motivo).toBe("sin_sesion");
  });
});
