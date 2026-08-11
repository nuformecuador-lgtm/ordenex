// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

import { consultarMetricaFinanciera } from "@/lib/actions/analitica-financiera";
import type { AnaliticaFinancieraActionDeps } from "@/lib/actions/analitica-financiera";
import type { ErrorLogger } from "@/lib/errors/logger";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IAnaliticaFinancieraService } from "@/lib/interfaces/services/IAnaliticaFinancieraService";
import type { RespuestaFinanciera } from "@/lib/types/analitica-financiera";

import {
  prepararExportFinanciero,
  TEXTO_EXPORT_PROHIBIDO,
  type ConsultarFinanciera,
} from "@/app/(app)/analitica/_components/export-financiero/ExportarVistaFinanciera";
import { FILTRO_FINANCIERO_POR_DEFECTO } from "@/app/(app)/analitica/_components/financiero/rango";

// Feature 184 — analitica financiera: export de la serie (T4.3, BLINDADO). R6, R7, R8 y R9.
//
// ⚠ AVISO DE NUMERACION: «184» en los comentarios de este arbol suele referirse a la ficha
// renumerada a la 188. Esta feature se rotula con nombre, no solo con numero.
//
// AQUI NO SE MOCKEA EL BORDE: se ejecuta EL DE VERDAD, con el actor y el logger inyectados por su
// tercer argumento (que es el punto de inyeccion PARA TESTS, y por eso produccion no lo usa: R5).
// Es la unica forma honesta de afirmar R7, porque lo que hay que comprobar no es el status —un 403
// MUDO tambien lo devuelve— sino que el intento quedo REGISTRADO ANTES de responder. La trampa
// esta documentada en `lib/analytics/auditoria.ts`: `normalizeError` solo llama al logger en la
// rama del error DESCONOCIDO, asi que un borde que lanzara `ForbiddenError` y confiara en
// `withErrorHandler` responderia bien y no dejaria rastro de nada.
//
// Y LA ASERCION ES SOBRE LA **SECUENCIA**, no sobre el numero de llamadas (§9.1 T-A del design):
// contar llamadas pasa igual si el registro ocurre DESPUES del 403, que es exactamente el defecto.
//
// Por que el export tiene que registrar sin escribir una linea de auditoria: porque REUSA el
// borde. Si tuviera su propio camino, tendria tambien su propia forma de olvidarse.

/** Reloj congelado: sin el, el rango dependeria del momento en que corra la suite. */
const AHORA = new Date("2026-08-03T15:00:00.000Z");

/** Una metrica del DINERO: un `adminTienda` pidiendola es `metrica_prohibida`, garantizado. */
const METRICA_DE_DINERO = "egresos";

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro", zonaId: null };
const TIENDA: Actor = { usuarioId: "t-propia", rol: "adminTienda", zonaId: null };

/** Servicio doble que REVIENTA si se le llama: en estos casos no debe llegar a invocarse. */
const SERVICIO_QUE_NO_DEBE_LLAMARSE: IAnaliticaFinancieraService = {
  async consultar() {
    throw new Error("el servicio NO debe llegar a invocarse en un denegado ni en un 400");
  },
};

/** Servicio doble que responde `dominio_invalido`: la via del `error` saneado del borde (R9). */
const SERVICIO_DOMINIO_INVALIDO: IAnaliticaFinancieraService = {
  async consultar() {
    return { status: "dominio_invalido", metricaId: METRICA_DE_DINERO };
  },
};

interface Espia {
  /** La secuencia COMPARTIDA: lo que de verdad separa «auditar antes» de «auditar despues». */
  readonly secuencia: string[];
  readonly registros: unknown[];
  readonly logger: ErrorLogger;
}

function espiaDeLogger(): Espia {
  const secuencia: string[] = [];
  const registros: unknown[] = [];
  const logError = vi.fn((registro: unknown) => {
    secuencia.push("auditoria");
    registros.push(registro);
  });
  return { secuencia, registros, logger: { logError } };
}

/**
 * El borde REAL con las dependencias de test enchufadas, envuelto en la forma que el export
 * inyecta. Produccion pasa DOS argumentos; aqui se pasa el tercero porque es el punto de
 * inyeccion de los tests.
 *
 * `filtroDeLaLlamada` existe para el unico caso que necesita OTRO filtro: la region financiera no
 * tiene barra de filtros y su constante es valida siempre, asi que un `validation_error` real solo
 * se puede provocar sustituyendo el filtro en el doble.
 */
function bordeReal(
  deps: AnaliticaFinancieraActionDeps,
  filtroDeLaLlamada?: unknown,
): ConsultarFinanciera {
  return (metricaId, filtro) =>
    consultarMetricaFinanciera(metricaId, filtroDeLaLlamada ?? filtro, {
      now: AHORA,
      ...deps,
    });
}

describe("Feature 184 — analitica financiera: export de la serie (R6) · el denegado no se confunde con el vacio", () => {
  it("un forbidden no produce archivo y su mensaje no es el de sin datos", async () => {
    const espia = espiaDeLogger();
    const { resultado } = await prepararExportFinanciero(
      METRICA_DE_DINERO,
      METRICA_DE_DINERO,
      bordeReal({
        getActor: async () => TIENDA,
        logger: espia.logger,
        service: SERVICIO_QUE_NO_DEBE_LLAMARSE,
      }),
    );

    // No hay filas que entregar: el control no llega siquiera a llamar al generador.
    expect(resultado.status).toBe("error");
    if (resultado.status !== "error") throw new Error("no es error");
    expect(resultado.mensaje).toBe(TEXTO_EXPORT_PROHIBIDO);

    // Y el mensaje habla de PERMISOS, no de datos. Fundirlo con el de «sin datos» convertiria un
    // problema de acceso en un problema de negocio que no existe, y el usuario ajustaria filtros
    // para siempre buscando unas cifras que nunca va a poder descargar.
    expect(resultado.mensaje).toMatch(/acceso/i);
    expect(resultado.mensaje).not.toMatch(/no hay datos/i);
    expect(resultado.mensaje).not.toMatch(/ajusta los filtros/i);
    // Y no filtra el motivo del denegado, que es dato de auditoria y no del cliente.
    expect(resultado.mensaje).not.toContain("metrica_prohibida");
  });
});

describe("Feature 184 — analitica financiera: export de la serie (R7) · el intento denegado se audita ANTES", () => {
  it("el intento de descarga denegado deja rastro en el logger ANTES de responder", async () => {
    const espia = espiaDeLogger();

    const { resultado } = await prepararExportFinanciero(
      METRICA_DE_DINERO,
      METRICA_DE_DINERO,
      bordeReal({
        getActor: async () => TIENDA,
        logger: espia.logger,
        service: SERVICIO_QUE_NO_DEBE_LLAMARSE,
      }),
    );
    espia.secuencia.push("respuesta");

    // LA SECUENCIA, no el conteo: auditar DESPUES de responder deja una ventana en la que el
    // intento existe y nadie lo ha registrado, y un conteo pasaria igual.
    expect(espia.secuencia).toEqual(["auditoria", "respuesta"]);

    // Y el registro es el de `describirDenegado`, por el MISMO camino que usa la pantalla.
    const registro = espia.registros[0] as Record<string, unknown>;
    expect(registro.evento).toBe("analitica_denegado");
    expect(registro.motivo).toBe("metrica_prohibida");
    expect(registro.rol).toBe("adminTienda");
    expect(registro.usuarioId).toBe(TIENDA.usuarioId);
    expect(registro.metricaId).toBe(METRICA_DE_DINERO);

    expect(resultado.status).toBe("error");
  });

  it("y una descarga concedida no ensucia el canal de auditoria", async () => {
    // El canal sirve para buscar el intento REAL. Registrar tambien lo concedido lo llena de
    // ruido justo donde hay que mirar.
    const espia = espiaDeLogger();
    const datosVacios: RespuestaFinanciera = {
      status: "ok",
      datos: {
        tipo: "vistas",
        metricaId: METRICA_DE_DINERO,
        etiqueta: "Egresos",
        unidad: "moneda",
        rango: { desdeFecha: "2026-07-05", hastaFecha: "2026-08-03" },
        esAcumulado: false,
        vistas: [],
      },
    };
    const servicio: IAnaliticaFinancieraService = {
      async consultar() {
        if (datosVacios.status !== "ok") throw new Error("fixture mal formada");
        return { status: "ok", datos: datosVacios.datos };
      },
    };

    await prepararExportFinanciero(
      METRICA_DE_DINERO,
      METRICA_DE_DINERO,
      bordeReal({ getActor: async () => MAESTRO, logger: espia.logger, service: servicio }),
    );

    expect(espia.secuencia).toEqual([]);
  });
});

describe("Feature 184 — analitica financiera: export de la serie (R8) · un filtro invalido no es un intento de acceso", () => {
  it("un validation_error no produce archivo y no llama al logger", async () => {
    const espia = espiaDeLogger();
    // `quincena` no es un preset: el esquema `.strict()` de la 135 lo rechaza.
    const { resultado } = await prepararExportFinanciero(
      METRICA_DE_DINERO,
      METRICA_DE_DINERO,
      bordeReal(
        {
          getActor: async () => MAESTRO,
          logger: espia.logger,
          service: SERVICIO_QUE_NO_DEBE_LLAMARSE,
        },
        { rango: "quincena" },
      ),
    );

    expect(resultado.status).toBe("error");
    if (resultado.status !== "error") throw new Error("no es error");
    // Los errores de campo llegan al usuario: son lo unico que le permite corregir.
    expect(resultado.mensaje).toMatch(/rango/i);
    expect(resultado.mensaje).not.toBe(TEXTO_EXPORT_PROHIBIDO);

    // Y NO se audita. Meterlo en el mismo canal llenaria de ruido el sitio donde se busca el
    // intento real, y ademas `prepararConsultaAnalitica` ni siquiera resolvio el ambito.
    expect(espia.secuencia).toEqual([]);

    // SANIDAD: la constante de produccion SI es valida, asi que el 400 lo provoca el filtro del
    // doble y no un defecto de la region.
    expect(FILTRO_FINANCIERO_POR_DEFECTO).toEqual({ rango: "mes" });
  });
});

describe("Feature 184 — analitica financiera: export de la serie (R9) · el error viaja ya saneado", () => {
  it("un error del borde no produce archivo y transporta el mensaje ya saneado", async () => {
    const espia = espiaDeLogger();
    const { resultado } = await prepararExportFinanciero(
      METRICA_DE_DINERO,
      METRICA_DE_DINERO,
      bordeReal({
        getActor: async () => MAESTRO,
        logger: espia.logger,
        service: SERVICIO_DOMINIO_INVALIDO,
      }),
    );

    expect(resultado.status).toBe("error");
    if (resultado.status !== "error") throw new Error("no es error");

    // EL MISMO mensaje que el borde devolvio, sin componer nada encima: el texto del error
    // original puede arrastrar una fila entera de la base hasta un toast.
    const delBorde = await consultarMetricaFinanciera(
      METRICA_DE_DINERO,
      FILTRO_FINANCIERO_POR_DEFECTO,
      {
        now: AHORA,
        getActor: async () => MAESTRO,
        logger: espia.logger,
        service: SERVICIO_DOMINIO_INVALIDO,
      },
    );
    if (delBorde.status !== "error") throw new Error("el borde no devolvio error");
    expect(resultado.mensaje).toBe(delBorde.mensaje);
    expect(resultado.mensaje).not.toBe(TEXTO_EXPORT_PROHIBIDO);
  });
});
