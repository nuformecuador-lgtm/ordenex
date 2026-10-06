// Ficha 475 (design §6, R1/R2/R18-R22/R33/R40) — el informe «Informe de tránsito» del catalogo de
// envios automaticos (contrato `InformeWhatsapp<P>` de la 474).
//
// `seleccionarTransito` es LA seleccion: la usan `generar` y la vista previa del panel
// (`previsualizarInformeTransito`), asi que lo que el panel cuenta es lo que el informe manda (R39).
// Tres lecturas fijas (R40). Un fallo de lectura se PROPAGA con el nombre de la operacion (R22):
// nunca un `catch` que devuelva «vacio» — el motor de la 474 deja la ejecucion en error.
import type { IInformeTransitoRepository } from "@/lib/interfaces/repositories/IInformeTransitoRepository";
import type { InformeWhatsapp, ResultadoInforme } from "@/lib/whatsapp-envios/informes/tipos";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { detalleDeCausa } from "@/lib/whatsapp-envios/informes/causa";
import { InformeTransitoRepository } from "@/lib/repositories/InformeTransitoRepository";
import {
  PARAMETROS_POR_DEFECTO,
  estadosIncluidos,
  parametrosTransitoSchema,
  type ParametrosTransito,
  type ZonaInforme,
} from "@/lib/whatsapp-envios/informes/transito/parametros";
import {
  clasificar,
  cortesPorZona,
  variables,
  type ModeloInformeTransito,
} from "@/lib/whatsapp-envios/informes/transito/calculo";
import { nombreArchivoTransito, pdfInformeTransito } from "@/lib/whatsapp-envios/informes/transito/pdf";

export const CLAVE_INFORME_TRANSITO = "transito";

export interface DepsInformeTransito {
  repo: IInformeTransitoRepository;
}

/**
 * Envuelve un fallo de lectura con la operacion y el motivo saneado (R22) y lo propaga: el historial
 * (`jobs.last_error`, solo `message`) conserva el porque sin copiar el `message` de Prisma.
 */
async function leer<T>(operacion: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    throw new Error(`informe transito: ${operacion} falló (${detalleDeCausa(cause)})`, { cause });
  }
}

/**
 * La seleccion de una generacion: zonas → cortes → filas en alerta + sin hito (en paralelo) →
 * modelo. Exactamente 3 llamadas al repositorio, sea cual sea el numero de ordenes (R40).
 */
export async function seleccionarTransito(
  repo: IInformeTransitoRepository,
  parametros: ParametrosTransito,
  ahora: Date,
): Promise<{ zonas: ZonaInforme[]; modelo: ModeloInformeTransito }> {
  const zonas = await leer("zonas", () => repo.zonas());
  const consulta = {
    hito: parametros.hito,
    estados: estadosIncluidos(parametros),
    cortes: cortesPorZona(zonas, parametros, ahora),
  };
  const [filas, sinHito] = await Promise.all([
    leer("filasEnAlerta", () => repo.filasEnAlerta(consulta)),
    leer("contarSinHito", () => repo.contarSinHito(consulta)),
  ]);
  return { zonas, modelo: clasificar(filas, zonas, parametros, ahora, sinHito) };
}

/**
 * Deps de produccion: el repo real sobre el cliente Prisma compartido, construido EN CADA `generar`
 * (no al importar: no abre conexion). NO se memoiza (revision 476, m1): memoizado, el repo quedaba
 * atado al cliente de la PRIMERA llamada para siempre — lo que en el picking dio P2028 en la
 * integracion. Construirlo es gratis: `getPrismaClient()` es el singleton.
 */
function depsDeProduccion(): () => DepsInformeTransito {
  return () => ({ repo: new InformeTransitoRepository(getPrismaClient()) });
}

export const MOTIVO_SIN_ALERTAS = "Ningún paquete está en alerta con estos parámetros.";

/**
 * Fabrica con dependencias (los tests pasan un doble); el catalogo registra la de produccion
 * (`crearInformeTransito()` sin argumentos).
 */
export function crearInformeTransito(deps?: DepsInformeTransito): InformeWhatsapp<ParametrosTransito> {
  const resolver = deps !== undefined ? () => deps : depsDeProduccion();
  return {
    clave: CLAVE_INFORME_TRANSITO,
    nombre: "Informe de tránsito",
    descripcion:
      "Lista los paquetes sin cierre logístico que están por vencer su plazo o ya lo pasaron, con los parados arriba y un PDF por zona.",
    parametros: parametrosTransitoSchema,
    parametrosPorDefecto: PARAMETROS_POR_DEFECTO,
    descriptores: [
      {
        campo: "transito",
        etiqueta: "Parámetros del informe de tránsito",
        tipo: "panel",
        panel: "transito",
        campos: ["hito", "zonas", "estados"],
      },
      {
        campo: "enviarSiVacio",
        etiqueta: "Enviar aunque no haya nada que informar",
        tipo: "booleano",
        ayuda: "Desactivado, si ningún paquete está en alerta la ejecución queda «Sin novedades» y no se manda nada.",
      },
    ],
    variables: [
      { clave: "total_en_alerta", nombre: "Paquetes en alerta", descripcion: "Vencidos más por vencer.", ejemplo: "15" },
      { clave: "vencidos", nombre: "Vencidos", descripcion: "Paquetes que ya pasaron el plazo de su zona.", ejemplo: "7" },
      {
        clave: "por_vencer",
        nombre: "Por vencer",
        descripcion: "Paquetes en alerta que aún no pasaron el plazo de su zona.",
        ejemplo: "8",
      },
      {
        clave: "parados",
        nombre: "Parados",
        descripcion: "Paquetes en alerta que llevan más días de los permitidos sin cambiar de estado.",
        ejemplo: "8",
      },
      {
        clave: "por_cobrar",
        nombre: "Por cobrar en la calle",
        descripcion: "Suma de lo que hay que cobrar en los paquetes en alerta.",
        ejemplo: "₡322.900",
      },
      { clave: "en_alerta_gam", nombre: "En alerta en la GAM", descripcion: "Paquetes en alerta de la zona central.", ejemplo: "5" },
      {
        clave: "en_alerta_fuera_gam",
        nombre: "En alerta fuera de la GAM",
        descripcion: "Paquetes en alerta del resto de zonas.",
        ejemplo: "10",
      },
      { clave: "fecha", nombre: "Fecha del informe", descripcion: "Fecha de generación (hora de Costa Rica).", ejemplo: "05/10/2026" },
    ],
    generaDocumento: true,
    // Datos de todas las tiendas: no puede llegar a un adminTienda.
    aptoParaAdminTienda: false,
    eventos: [],
    soloPorEvento: false,
    async generar(ctx): Promise<ResultadoInforme> {
      const { modelo } = await seleccionarTransito(resolver().repo, ctx.parametros, ctx.ahora);
      if (modelo.totales.enAlerta === 0 && !ctx.parametros.enviarSiVacio) {
        return { tipo: "vacio", motivo: MOTIVO_SIN_ALERTAS };
      }
      return {
        tipo: "contenido",
        valores: variables(modelo),
        ...(ctx.conDocumento
          ? { documento: { bytes: pdfInformeTransito(modelo), nombreArchivo: nombreArchivoTransito(ctx.ahora) } }
          : {}),
      };
    },
  };
}
