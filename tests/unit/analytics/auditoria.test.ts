import { describe, it, expect, vi, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/errors/app-error";
import { normalizeError } from "@/lib/errors/normalize";
import type { ErrorLogger } from "@/lib/errors/logger";
import { ACTOR_DESCONOCIDO, describirDenegado } from "@/lib/analytics/auditoria";
import type { RegistroDenegado } from "@/lib/analytics/auditoria";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ActorAnalitica } from "@/lib/analytics/alcance";

// Feature 122 / T4.6 — R40: el intento denegado deja rastro, y lo deja el BORDE.
//
// D10 eligio el canal que ya existe: `ErrorLogger` (`lib/errors/logger.ts`), el mismo de
// los crons y del webhook de WhatsApp. El modulo puro NO loguea (R31/R34): construye el
// registro y el borde lo emite con una llamada EXPLICITA.
//
// ⚠ La trampa que este archivo documenta con un test: envolver el borde en
// `withErrorHandler` NO BASTA. `normalizeError` devuelve la shape del `AppError` en su
// primera linea y solo llama a `logger.logError` en la rama del error DESCONOCIDO. Un
// `ForbiddenError` propagado produce un 403 MUDO. Por eso el test de R40 espia el logger y
// no el status: el status puede estar bien y la auditoria no existir.

const TIENDA: ActorAnalitica = { usuarioId: "tienda-propia", rol: "adminTienda" };

function loggerEspia(): { logger: ErrorLogger; logError: ReturnType<typeof vi.fn> } {
  const logError = vi.fn();
  return { logger: { logError }, logError };
}

/** Borde CORRECTO: audita explicitamente y responde 403. */
function bordeQueAudita(
  raw: unknown,
  actor: ActorAnalitica | null,
  metricaId: string,
  logger: ErrorLogger,
): { status: number } {
  const r = prepararConsultaAnalitica(raw, actor, metricaId, new Date("2026-07-31T15:00:00.000Z"));
  if (r.status === "forbidden") {
    logger.logError(describirDenegado({ motivo: r.motivo, actor, metricaId, filtro: raw }));
    return { status: 403 };
  }
  if (r.status === "validation_error") return { status: 400 };
  return { status: 200 };
}

/** Borde INFRACTOR: confia en el wrapper. El registro no ocurre (la trampa de §3.7). */
async function bordeQueDelegaEnElWrapper(logger: ErrorLogger): Promise<unknown> {
  try {
    throw new ForbiddenError();
  } catch (err) {
    return normalizeError(err, logger);
  }
}

describe("R40 · el registro del denegado lleva los campos exactos y ningun dato ajeno", () => {
  it("construye evento, motivo, rol, usuarioId, metricaId, alcance pedido y filtro rechazado", () => {
    const registro = describirDenegado({
      motivo: "filtro_fuera_de_alcance",
      actor: TIENDA,
      metricaId: "entregas",
      filtro: { rango: "dia", tienda_id: ["tienda-ajena"], zona_id: ["z-ajena"] },
    });

    const esperado: RegistroDenegado = {
      evento: "analitica_denegado",
      motivo: "filtro_fuera_de_alcance",
      rol: "adminTienda",
      usuarioId: "tienda-propia",
      metricaId: "entregas",
      alcancePedido: { zonaId: "z-ajena", tiendaId: "tienda-ajena" },
      filtroRechazado: { zona_id: ["z-ajena"], tienda_id: ["tienda-ajena"] },
    };
    expect(registro).toEqual(esperado);
  });

  it("no arrastra nombre, telefono, correo ni contenido de sesion aunque vengan en la entrada", () => {
    const registro = describirDenegado({
      motivo: "metrica_prohibida",
      actor: { ...TIENDA, nombre: "Juan Perez", telefono: "88887777" } as ActorAnalitica,
      metricaId: "egresos",
      filtro: {
        rango: "dia",
        tienda_id: ["t1"],
        correo: "juan@example.com",
        session: "cookie-secreta",
      },
    });

    const serializado = JSON.stringify(registro);
    expect(serializado).not.toContain("Juan Perez");
    expect(serializado).not.toContain("88887777");
    expect(serializado).not.toContain("juan@example.com");
    expect(serializado).not.toContain("cookie-secreta");
    expect(registro.filtroRechazado).toEqual({ tienda_id: ["t1"] });
  });

  it("sin actor registra el motivo y marca al actor como desconocido, sin inventar ids", () => {
    const registro = describirDenegado({ motivo: "sin_sesion", actor: null, metricaId: "entregas" });
    expect(registro).toEqual({
      evento: "analitica_denegado",
      motivo: "sin_sesion",
      rol: ACTOR_DESCONOCIDO,
      usuarioId: ACTOR_DESCONOCIDO,
      metricaId: "entregas",
    });
  });

  it("omite las claves opcionales cuando el actor no pidio ninguna dimension", () => {
    const registro = describirDenegado({
      motivo: "metrica_prohibida",
      actor: TIENDA,
      metricaId: "egresos",
      filtro: { rango: "dia" },
    });
    expect(Object.keys(registro).sort()).toEqual([
      "evento",
      "metricaId",
      "motivo",
      "rol",
      "usuarioId",
    ]);
  });

  it("describirDenegado es puro: construye el registro y no escribe en consola", () => {
    const espias = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
    describirDenegado({ motivo: "sin_sesion", actor: null, metricaId: "entregas" });
    expect(espias.log).not.toHaveBeenCalled();
    expect(espias.warn).not.toHaveBeenCalled();
    expect(espias.error).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe("R40 · el borde llama al ErrorLogger de forma explicita", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("un forbidden invoca logger.logError con rol, usuarioId, tienda pedida, filtro y motivo", () => {
    const { logger, logError } = loggerEspia();
    const respuesta = bordeQueAudita(
      { rango: "dia", tienda_id: ["tienda-ajena"] },
      TIENDA,
      "entregas",
      logger,
    );

    expect(respuesta.status).toBe(403);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).toEqual({
      evento: "analitica_denegado",
      motivo: "filtro_fuera_de_alcance",
      rol: "adminTienda",
      usuarioId: "tienda-propia",
      metricaId: "entregas",
      alcancePedido: { tiendaId: "tienda-ajena" },
      filtroRechazado: { tienda_id: ["tienda-ajena"] },
    });
  });

  it("una consulta concedida no audita nada: el canal no se llena de ruido", () => {
    const { logger, logError } = loggerEspia();
    const respuesta = bordeQueAudita({ rango: "dia" }, TIENDA, "entregas", logger);
    expect(respuesta.status).toBe(200);
    expect(logError).not.toHaveBeenCalled();
  });

  it("un validation_error NO se audita: una entrada malformada no es un intento cruzado", () => {
    const { logger, logError } = loggerEspia();
    const respuesta = bordeQueAudita({ rango: "no_valido" }, TIENDA, "entregas", logger);
    expect(respuesta.status).toBe(400);
    expect(logError).not.toHaveBeenCalled();
  });
});

describe("R40 · la trampa: withErrorHandler NO registra un ForbiddenError", () => {
  it("normalizeError(new ForbiddenError(), spy) devuelve la shape y NO llama al spy", () => {
    const { logger, logError } = loggerEspia();
    const shape = normalizeError(new ForbiddenError(), logger);

    expect(shape.code).toBe("FORBIDDEN");
    expect(logError).not.toHaveBeenCalled();
  });

  it("por eso un borde que solo lanza ForbiddenError produce un 403 MUDO (fixture infractor)", async () => {
    const { logger, logError } = loggerEspia();
    await bordeQueDelegaEnElWrapper(logger);
    expect(logError, "el borde infractor no dejo rastro: es la trampa que R40 evita").not
      .toHaveBeenCalled();
  });

  it("normalizeError SI registra el error desconocido: el canal funciona, la rama es la que falta", () => {
    const { logger, logError } = loggerEspia();
    normalizeError(new Error("algo raro"), logger);
    expect(logError).toHaveBeenCalledTimes(1);
  });
});
