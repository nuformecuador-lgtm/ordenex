// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

import { consultarAnaliticaOperativa } from "@/lib/actions/analitica-operativa";
import type { EntradaOperativa } from "@/lib/actions/analitica-operativa";
import type { ErrorLogger } from "@/lib/errors/logger";

import type { PanelTablero } from "@/app/(app)/analitica/_components/operativo/catalogo-paneles";
import {
  TEXTO_EXPORT_PROHIBIDO,
  filasDelPanel,
} from "@/app/(app)/analitica/_components/operativo/ExportarOperativoPanel";
import type { FiltroTablero } from "@/app/(app)/analitica/_components/operativo/filtro-tablero";

import { AHORA, MAESTRO, TIENDA } from "./_fake-operativa";

// Feature 134 — R5, R6 y R18. LOS ESTADOS QUE NO PRODUCEN ARCHIVO.
//
// Aqui NO se mockea la accion: se ejecuta LA DE VERDAD, con el logger y el actor inyectados.
// Es la unica forma honesta de afirmar R6, porque lo que hay que comprobar no es el status
// —un 403 mudo tambien lo devuelve— sino que el intento quedo REGISTRADO antes de responder.
// La trampa esta documentada en `lib/analytics/auditoria.ts:10-16`: `normalizeError` solo
// llama al logger en la rama del error DESCONOCIDO, asi que un borde que lanzara
// `ForbiddenError` y confiara en `withErrorHandler` responderia bien y no dejaria rastro.
//
// Y por que el export tiene que auditar sin escribir una linea de auditoria: porque REUSA el
// borde. Si tuviera su propio camino, tendria tambien su propia forma de olvidarse.

const PANEL: PanelTablero = {
  id: "egresos-falso",
  titulo: "Egresos",
  grafica: "lineas",
  // Una metrica del DINERO: un `adminTienda` pidiendola es `metrica_prohibida`, garantizado.
  metricas: [{ metricaId: "egresos", etiqueta: "Egresos" }],
};

const PANEL_OK: PanelTablero = {
  id: "ordenes-creadas",
  titulo: "Ordenes creadas",
  grafica: "lineas",
  metricas: [{ metricaId: "ordenes_creadas", etiqueta: "Ordenes creadas" }],
};

const FILTRO: FiltroTablero = {
  rango: "dia",
  desde: "",
  hasta: "",
  zonaIds: [],
  tiendaIds: [],
  mensajeroIds: [],
};

/** Filtro que el esquema `.strict()` de la 135 rechaza: `quincena` no es un preset. */
const FILTRO_INVALIDO = { ...FILTRO, rango: "quincena" } as unknown as FiltroTablero;

/**
 * La accion REAL con las dependencias de test enchufadas. El export la recibe por el mismo
 * parametro por el que en produccion recibe la accion desnuda.
 */
function accionCon(logError: ReturnType<typeof vi.fn>, actor = TIENDA) {
  const logger: ErrorLogger = { logError };
  return (entrada: EntradaOperativa) =>
    consultarAnaliticaOperativa(entrada, {
      logger,
      now: () => AHORA,
      getActor: async () => actor,
      service: {
        async consultar() {
          throw new Error("el servicio NO debe llegar a invocarse en estos casos");
        },
        async consultarAgregado(): Promise<never> {
          throw new Error("este doble sirve la SERIE, no el agregado");
        },
      },
    });
}

describe("Feature 134 (R5) — un denegado no produce archivo y no se confunde con el vacio", () => {
  it("un forbidden no produce archivo y su mensaje no es el de sin datos", async () => {
    const logError = vi.fn();
    const resultado = await filasDelPanel(PANEL, FILTRO, accionCon(logError));

    // No hay filas que entregar: el control no llega siquiera a llamar al generador.
    expect(resultado.status).toBe("error");
    if (resultado.status !== "error") throw new Error("no es error");
    expect(resultado.mensaje).toBe(TEXTO_EXPORT_PROHIBIDO);

    // Y el mensaje habla de PERMISOS, no de datos. Fundirlo con el de «sin datos» convertiria
    // un problema de acceso en un problema de negocio que no existe, y el usuario ajustaria
    // filtros para siempre buscando unas cifras que nunca va a poder descargar.
    expect(resultado.mensaje).toMatch(/acceso/i);
    expect(resultado.mensaje).not.toMatch(/no hay datos/i);
    expect(resultado.mensaje).not.toMatch(/ajusta los filtros/i);
    // Y no filtra el motivo del denegado, que es dato de auditoria y no del cliente.
    expect(resultado.mensaje).not.toContain("metrica_prohibida");
  });
});

describe("Feature 134 (R6) — el intento denegado queda auditado", () => {
  it("el intento de descarga denegado deja rastro en el logger antes de responder", async () => {
    const orden: string[] = [];
    const logError = vi.fn(() => {
      orden.push("log");
    });

    const resultado = await filasDelPanel(PANEL, FILTRO, accionCon(logError));
    orden.push("respuesta");

    expect(logError).toHaveBeenCalledTimes(1);
    const registro = logError.mock.calls[0][0] as Record<string, unknown>;
    expect(registro.evento).toBe("analitica_denegado");
    expect(registro.motivo).toBe("metrica_prohibida");
    expect(registro.rol).toBe("adminTienda");
    expect(registro.usuarioId).toBe(TIENDA.usuarioId);
    expect(registro.metricaId).toBe("egresos");

    // El rastro precede al retorno: auditar DESPUES de responder deja una ventana en la que
    // el intento existe y nadie lo ha registrado.
    expect(orden).toEqual(["log", "respuesta"]);
    expect(resultado.status).toBe("error");
  });

  it("y una descarga concedida no ensucia el canal de auditoria", async () => {
    // El canal de auditoria sirve para buscar el intento REAL. Registrar tambien lo
    // concedido lo llena de ruido justo donde hay que mirar.
    const logError = vi.fn();
    await filasDelPanel(PANEL_OK, FILTRO, (entrada) =>
      consultarAnaliticaOperativa(entrada, {
        logger: { logError },
        now: () => AHORA,
        getActor: async () => MAESTRO,
        service: {
          async consultar() {
            return {
              metricaId: "ordenes_creadas",
              unidad: "conteo" as const,
              unidadDeConteo: "orden" as const,
              rango: {
                preset: "dia" as const,
                desde: AHORA,
                hasta: AHORA,
                desdeFecha: "2026-08-03",
                hastaFecha: "2026-08-03",
              },
              puntos: [{ fecha: "2026-08-03", valor: 3 }],
              cobertura: {
                fechasNoComparables: [],
                penumbra: "ordenes_vivas_al_horizonte_sin_transicion_posterior" as const,
              },
            };
          },
          async consultarAgregado(): Promise<never> {
            throw new Error("este doble sirve la SERIE, no el agregado");
          },
        },
      }),
    );
    expect(logError).not.toHaveBeenCalled();
  });
});

describe("Feature 134 (R18) — un filtro invalido no es un intento de acceso", () => {
  it("un validation_error no produce archivo y no llama al logger", async () => {
    const logError = vi.fn();
    const resultado = await filasDelPanel(
      PANEL_OK,
      FILTRO_INVALIDO,
      accionCon(logError, MAESTRO),
    );

    expect(resultado.status).toBe("error");
    if (resultado.status !== "error") throw new Error("no es error");
    // Los errores de campo llegan al usuario: son lo unico que le permite corregir.
    expect(resultado.mensaje).toMatch(/rango/i);
    expect(resultado.mensaje).not.toBe(TEXTO_EXPORT_PROHIBIDO);

    // Y NO se audita. Un filtro malformado no es un intento de ver datos ajenos, y meterlo
    // en el mismo canal llenaria de ruido el sitio donde se busca el intento real.
    expect(logError).not.toHaveBeenCalled();
  });
});
