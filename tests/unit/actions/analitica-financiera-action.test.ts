import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import { consultarMetricaFinanciera } from "@/lib/actions/analitica-financiera";
import type { AnaliticaFinancieraActionDeps } from "@/lib/actions/analitica-financiera";
import type { ErrorLogger } from "@/lib/errors/logger";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IAnaliticaFinancieraService } from "@/lib/interfaces/services/IAnaliticaFinancieraService";
import { armarServicio, AHORA } from "../services/_dobles-analitica-financiera";

// Feature 127 / T E.1, E.2 y E.5 — EL BORDE: los tres pasos, el 400 contra el 403 y el error
// con contexto.
//
// Lo que se mide aqui NO es la forma de la respuesta sino el ORDEN y las AUSENCIAS:
//
//  - E.1 / R11 — ante un `forbidden` hay UNA llamada al `ErrorLogger` y ocurre ANTES de
//    responder. La trampa que documenta `lib/analytics/auditoria.ts:10-16` (lanzar
//    `ForbiddenError` y confiar en `withErrorHandler`) produce un 403 correcto y MUDO, asi que
//    el test espia el logger, no el status.
//  - E.2 / R13 — una entrada malformada responde 400 y **no audita**. Las dos mitades se
//    comprueban por separado: que el 400 llega, y que el logger espiado NO recibe nada. Si se
//    auditaran tambien los 400, la señal de los denegados reales se perderia entre el ruido.
//  - E.5 / R32 — un fallo de la consulta se reporta con contexto (metrica y rango) y SIN PII.
//    El mensaje se construye con lo que el actor envio; el error original, que puede arrastrar
//    una fila entera de la base, va al logger y no a la respuesta.
//
// E.3 (cuerpo generico del 403) y E.4 (barrido de identidad) viven en
// `tests/unit/analytics/financiera-borde.guardia.test.ts`: son guardias de seguridad y siguen
// el patron de `alcance-bordes.guardia.test.ts` de la 122.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const ARCHIVO_ACCION = "lib/actions/analitica-financiera.ts";

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro", zonaId: null };
const TIENDA: Actor = { usuarioId: "t-propia", rol: "adminTienda", zonaId: null };

/** Datos con los que las ocho metricas devuelven algo distinto de cero. */
const DATOS = {
  caja: [
    { categoria: "ingreso_flete", tipo: "ingreso", suma: "1500.00" },
    { categoria: "ingreso_flete_devolucion", tipo: "ingreso", suma: "250.00" },
  ],
} as const;

function espiaDeLogger(): { logger: ErrorLogger; logError: ReturnType<typeof vi.fn> } {
  const logError = vi.fn();
  return { logger: { logError }, logError };
}

function deps(extra: Partial<AnaliticaFinancieraActionDeps> = {}): AnaliticaFinancieraActionDeps {
  return { now: AHORA, ...extra };
}

/* -------------------------------------------------------------------------- */
/* E.1 / R11 · R12 · R15 — auditar y DESPUES responder                         */
/* -------------------------------------------------------------------------- */

describe("E.1 / R11 · el forbidden se audita con una llamada explicita, antes de responder", () => {
  it("un adminTienda pidiendo `egresos` ve UNA llamada a logger.logError y estado forbidden", async () => {
    const { logger, logError } = espiaDeLogger();
    const { servicio, consultasHechas } = armarServicio(DATOS);

    const respuesta = await consultarMetricaFinanciera(
      "egresos",
      { rango: "dia" },
      deps({ getActor: async () => TIENDA, logger, service: servicio }),
    );

    expect(respuesta).toEqual({ status: "forbidden", code: "FORBIDDEN" });
    expect(logError).toHaveBeenCalledTimes(1);
    // R10 — un denegado no consulta nada: ni una llamada a ninguno de los cuatro repositorios.
    expect(consultasHechas()).toBe(0);
  });

  it("el registro que recibe el logger es el de `describirDenegado`, con motivo, rol y usuarioId", async () => {
    const { logger, logError } = espiaDeLogger();

    await consultarMetricaFinanciera(
      "egresos",
      { rango: "dia", tienda_id: ["t-propia"] },
      deps({ getActor: async () => TIENDA, logger, service: armarServicio().servicio }),
    );

    expect(logError.mock.calls[0][0]).toEqual({
      evento: "analitica_denegado",
      motivo: "metrica_prohibida",
      rol: "adminTienda",
      usuarioId: "t-propia",
      metricaId: "egresos",
      alcancePedido: { tiendaId: "t-propia" },
      filtroRechazado: { tienda_id: ["t-propia"] },
    });
  });

  it("el orden es auditar → responder: si el logger revienta, NO sale un 403 igualmente", async () => {
    // Es la sonda del ORDEN. Un borde que respondiera primero y auditara despues (o que
    // delegara la auditoria en un `finally`, o en `withErrorHandler`) devolveria su 403 sin
    // enterarse de que el registro no ocurrio.
    const logger: ErrorLogger = {
      logError: () => {
        throw new Error("el canal de auditoria esta caido");
      },
    };

    await expect(
      consultarMetricaFinanciera(
        "egresos",
        { rango: "dia" },
        deps({ getActor: async () => TIENDA, logger, service: armarServicio().servicio }),
      ),
    ).rejects.toThrow("el canal de auditoria esta caido");
  });

  it("sin sesion tampoco se responde `ok`: se audita y se deniega", async () => {
    const { logger, logError } = espiaDeLogger();
    const { servicio, consultasHechas } = armarServicio(DATOS);

    const respuesta = await consultarMetricaFinanciera(
      "ingreso_flete",
      { rango: "dia" },
      deps({ getActor: async () => null, logger, service: servicio }),
    );

    expect(respuesta.status).toBe("forbidden");
    expect(logError).toHaveBeenCalledTimes(1);
    expect(consultasHechas()).toBe(0);
  });

  it("y el camino concedido responde `ok` SIN auditar nada", async () => {
    const { logger, logError } = espiaDeLogger();
    const { servicio, consultasHechas } = armarServicio(DATOS);

    const respuesta = await consultarMetricaFinanciera(
      "ingreso_flete",
      { rango: "dia" },
      deps({ getActor: async () => MAESTRO, logger, service: servicio }),
    );

    expect(respuesta.status).toBe("ok");
    expect(logError).not.toHaveBeenCalled();
    // No pasa por conjunto vacio: el camino feliz consulto de verdad y trajo una cifra real.
    expect(consultasHechas()).toBeGreaterThan(0);
    if (respuesta.status !== "ok" || respuesta.datos.tipo !== "vistas") throw new Error("forma");
    expect(respuesta.datos.vistas[0].total.bruto).toBe("1750.00");
  });
});

describe("E.1 / R15 · el actor sale de resolveActorFromSession y de ningun otro sitio", () => {
  const codigo = quitarComentarios(fs.readFileSync(path.join(REPO_ROOT, ARCHIVO_ACCION), "utf8"));

  it("el borde importa `resolveActorFromSession`", () => {
    expect(codigo).toContain("resolveActorFromSession");
    expect(codigo).toMatch(/from\s+"@\/lib\/auth\/resolve-actor"/);
  });

  it("y NO lee la cookie de sesion por ningun otro camino", () => {
    for (const prohibido of ["next/headers", "cookies(", "SESSION_COOKIE_NAME"]) {
      expect(codigo, prohibido).not.toContain(prohibido);
    }
  });

  it("el censo mira el archivo de verdad y no una cadena vacia", () => {
    expect(codigo.length).toBeGreaterThan(500);
    // Autocomprobacion: el detector reconoceria la lectura directa de la cookie.
    const infractor = `import { cookies } from "next/headers";\nconst s = cookies().get("x");`;
    expect(infractor).toContain("next/headers");
    expect(infractor).toContain("cookies(");
  });
});

/* -------------------------------------------------------------------------- */
/* E.2 / R13 — 400 contra 403: la entrada malformada NO audita                 */
/* -------------------------------------------------------------------------- */

describe("E.2 / R13 · una entrada malformada responde 400 y no deja rastro de denegado", () => {
  it("`{ rango: 'no_valido' }` devuelve validation_error con fieldErrors", async () => {
    const { logger } = espiaDeLogger();

    const respuesta = await consultarMetricaFinanciera(
      "ingreso_flete",
      { rango: "no_valido" },
      deps({ getActor: async () => MAESTRO, logger, service: armarServicio(DATOS).servicio }),
    );

    expect(respuesta.status).toBe("validation_error");
    if (respuesta.status !== "validation_error") throw new Error("forma");
    // No pasa por conjunto vacio: hay errores de campo de verdad, y son del campo que fallo.
    expect(Object.keys(respuesta.fieldErrors)).toContain("rango");
    expect(respuesta.fieldErrors.rango.length).toBeGreaterThan(0);
  });

  it("y el logger espiado NO recibe absolutamente nada", async () => {
    const { logger, logError } = espiaDeLogger();
    const { servicio, consultasHechas } = armarServicio(DATOS);

    await consultarMetricaFinanciera(
      "ingreso_flete",
      { rango: "no_valido" },
      deps({ getActor: async () => MAESTRO, logger, service: servicio }),
    );

    expect(logError).not.toHaveBeenCalled();
    expect(consultasHechas()).toBe(0);
  });

  it("aunque el actor fuese a ser denegado, la entrada mala manda: 400 y sin auditar", async () => {
    // La mitad que de verdad importa. `adminTienda` + `egresos` es un `forbidden` seguro; con
    // una entrada malformada NO se llega a resolver el alcance (R19 de la 122), asi que no hay
    // motivo que registrar y el cliente no puede sondear permisos mandando basura.
    const { logger, logError } = espiaDeLogger();

    const respuesta = await consultarMetricaFinanciera(
      "egresos",
      { rango: "personalizado", desde: "2026-8-1", hasta: "2026-08-02" },
      deps({ getActor: async () => TIENDA, logger, service: armarServicio().servicio }),
    );

    expect(respuesta.status).toBe("validation_error");
    expect(logError).not.toHaveBeenCalled();
  });

  it("una clave que el schema no conoce tambien es 400, no un vector de escalada", async () => {
    const { logger, logError } = espiaDeLogger();

    const respuesta = await consultarMetricaFinanciera(
      "ingreso_flete",
      { rango: "dia", rol: "maestro" },
      deps({ getActor: async () => TIENDA, logger, service: armarServicio().servicio }),
    );

    expect(respuesta.status).toBe("validation_error");
    expect(logError).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* R5 en el borde — el dominio invalido es un error explicito, nunca ceros     */
/* -------------------------------------------------------------------------- */

describe("R5 · una metrica que existe pero no es financiera no se sirve con ceros", () => {
  it("`entregas` con un maestro (que SI la tiene concedida) devuelve error explicito", async () => {
    const { logger, logError } = espiaDeLogger();
    const { servicio, consultasHechas } = armarServicio(DATOS);

    const respuesta = await consultarMetricaFinanciera(
      "entregas",
      { rango: "dia" },
      deps({ getActor: async () => MAESTRO, logger, service: servicio }),
    );

    expect(respuesta.status).toBe("error");
    if (respuesta.status !== "error") throw new Error("forma");
    expect(respuesta.mensaje).toContain("entregas");
    // No es un 403 (el permiso existia) y no consulto ninguna tabla.
    expect(logError).not.toHaveBeenCalled();
    expect(consultasHechas()).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* E.5 / R32 — el fallo se reporta con contexto y sin PII                      */
/* -------------------------------------------------------------------------- */

/** Un fallo de base realista: el motor arrastra en el texto datos de la fila que reviento. */
const PII = ["t-secreta-9911", "88887777", "ana.perez@ejemplo.com", "Ana Perez"];
const FALLO = new Error(
  `insert or update violates constraint: tienda_id=t-secreta-9911, telefono=88887777, correo=ana.perez@ejemplo.com, nombre=Ana Perez`,
);

function servicioQueRevienta(): IAnaliticaFinancieraService {
  return {
    consultar: vi.fn(async () => {
      throw FALLO;
    }),
  };
}

describe("E.5 / R32 · el fallo del repositorio sube con contexto y sin PII", () => {
  it("la respuesta lleva el metricaId y las dos fechas del rango", async () => {
    const { logger } = espiaDeLogger();

    const respuesta = await consultarMetricaFinanciera(
      "cuenta_por_pagar_tienda",
      { rango: "personalizado", desde: "2026-07-01", hasta: "2026-07-31" },
      deps({ getActor: async () => MAESTRO, logger, service: servicioQueRevienta() }),
    );

    expect(respuesta.status).toBe("error");
    if (respuesta.status !== "error") throw new Error("forma");
    expect(respuesta.mensaje).toContain("cuenta_por_pagar_tienda");
    expect(respuesta.mensaje).toContain("2026-07-01");
    expect(respuesta.mensaje).toContain("2026-07-31");
  });

  it("y NO lleva ids de tienda, telefonos ni correos, aunque el error original los traiga", async () => {
    const { logger } = espiaDeLogger();

    const respuesta = await consultarMetricaFinanciera(
      "cuenta_por_pagar_tienda",
      { rango: "dia" },
      deps({ getActor: async () => MAESTRO, logger, service: servicioQueRevienta() }),
    );

    const serializada = JSON.stringify(respuesta);
    for (const dato of PII) {
      expect(serializada, dato).not.toContain(dato);
    }
    // El fixture no es inocuo: el error original SI contiene los cuatro datos. Sin esto, el
    // caso pasaria igual con un error vacio.
    for (const dato of PII) {
      expect(FALLO.message, dato).toContain(dato);
    }
  });

  it("el error INTEGRO si llega al ErrorLogger: no se silencia, se desvia", async () => {
    const { logger, logError } = espiaDeLogger();

    await consultarMetricaFinanciera(
      "egresos",
      { rango: "dia" },
      deps({ getActor: async () => MAESTRO, logger, service: servicioQueRevienta() }),
    );

    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).toBe(FALLO);
  });

  it("un fallo NUNCA se convierte en un cero ni en una lista vacia", async () => {
    const { logger } = espiaDeLogger();

    const respuesta = await consultarMetricaFinanciera(
      "ingreso_iva",
      { rango: "dia" },
      deps({ getActor: async () => MAESTRO, logger, service: servicioQueRevienta() }),
    );

    expect(respuesta.status).not.toBe("ok");
    expect(JSON.stringify(respuesta)).not.toContain("0.00");
  });
});
