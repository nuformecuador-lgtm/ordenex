// Ficha 476 (design §4.2/§4.4, R1-R2, R6-R8, R16, R24-R28) — el informe «Picking» del catalogo de
// envios automaticos (contrato `InformeWhatsapp<P>` de la 474).
//
// UNA tienda por envio (D1). La foto se toma al generar y NO se escribe nada (R9): lo que sigue en
// preparacion vuelve a salir en el envio siguiente; lo que avanzo de estado, no.
//
// Tres desenlaces de `generar`:
//   - la tienda ya no existe / no es tienda / no esta activa / perdio el fulfillment → `{ tipo: "error" }` (D4/R7):
//     terminal y visible en el historial, nunca «Sin novedades»;
//   - sin ordenes en preparacion → `{ tipo: "vacio" }` (R8);
//   - contenido: valores y, si la plantilla lleva documento, el PDF (R16/R24).
// Un fallo de LECTURA se propaga con el nombre de la operacion (mismo criterio que la 475): el motor
// lo trata como fallo reintentable del job, no como un «vacio».
import type { IPickingRepository } from "@/lib/interfaces/repositories/IPickingRepository";
import type { InformeWhatsapp, ResultadoInforme } from "@/lib/whatsapp-envios/informes/tipos";
import type { TiendaPicking, TiendaPickingDTO } from "@/lib/whatsapp-envios/informes/picking/tipos";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { PickingRepository } from "@/lib/repositories/PickingRepository";
import {
  PARAMETROS_PICKING_POR_DEFECTO,
  parametrosPickingSchema,
  type ParametrosPicking,
} from "@/lib/whatsapp-envios/informes/picking/parametros";
import {
  compararCodigo,
  construirModeloPicking,
  contarPorTienda,
  type ModeloPicking,
} from "@/lib/whatsapp-envios/informes/picking/modelo";
import { pdfDePicking } from "@/lib/whatsapp-envios/informes/picking/pdf";

export const CLAVE_INFORME_PICKING = "picking";

export interface DepsInformePicking {
  repo: IPickingRepository;
  /** Inyectable para que un test cuente las llamadas (R24: sin documento, no se llama). */
  pdf?: (modelo: ModeloPicking) => Uint8Array;
}

/**
 * El motivo SANEADO de un fallo de lectura: el nombre de la clase y, si lo trae, el codigo
 * (`P2028`, `40P01`…). Nunca el `message` de la causa: el de Prisma copia la invocacion con sus
 * argumentos. Sin esto, `jobs.last_error` (que guarda solo `error.message`) decia «falló» sin el
 * porque, y el `cause` se perdia en el salto por la cola.
 */
export function detalleDeCausa(cause: unknown): string {
  if (!(cause instanceof Error)) return "error desconocido";
  const codigo = (cause as { code?: unknown }).code;
  return typeof codigo === "string" && /^[A-Za-z0-9_]{1,20}$/.test(codigo) ? `${cause.name} ${codigo}` : cause.name;
}

/** Envuelve un fallo de lectura con la operacion y el motivo saneado, y lo propaga. */
async function leer<T>(operacion: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    throw new Error(`informe picking: ${operacion} falló (${detalleDeCausa(cause)})`, { cause });
  }
}

/** R7 — el motivo cuando la tienda del envio ya no sirve. */
export function motivoTiendaNoValida(tienda: TiendaPicking | null): string {
  if (tienda === null) return "La tienda del envío ya no existe: revisa el envío y elige otra tienda.";
  if (!tienda.esTienda) return `«${tienda.nombre}» ya no es una tienda con fulfillment: revisa el envío.`;
  if (!tienda.activo) return `La tienda «${tienda.nombre}» no está activa: revisa el envío.`;
  return `La tienda «${tienda.nombre}» ya no tiene fulfillment: revisa el envío.`;
}

/** R8 — el motivo «vacio». */
export function motivoSinOrdenes(nombre: string): string {
  return `La tienda ${nombre} no tiene órdenes en preparación.`;
}

/**
 * R3 — las tiendas del selector con sus conteos AHORA para `diasAtraso`. Dos lecturas fijas (las
 * tiendas y las entradas), ordenadas por nombre por unidades de codigo (y por id en empate).
 */
export async function resumenTiendasPicking(
  repo: IPickingRepository,
  ahora: Date,
  diasAtraso: number,
): Promise<TiendaPickingDTO[]> {
  const [tiendas, entradas] = await Promise.all([
    leer("tiendasFulfillment", () => repo.tiendasFulfillment()),
    leer("entradasEnPreparacion", () => repo.entradasEnPreparacion()),
  ]);
  const conteo = contarPorTienda(entradas, ahora, diasAtraso);
  return [...tiendas]
    .sort((a, b) => compararCodigo(a.nombre, b.nombre) || compararCodigo(a.id, b.id))
    .map((t) => ({
      tiendaId: t.id,
      nombre: t.nombre,
      ordenes: conteo.get(t.id)?.ordenes ?? 0,
      atrasadas: conteo.get(t.id)?.atrasadas ?? 0,
    }));
}

/**
 * Deps de produccion: el repo real sobre el cliente Prisma compartido, construido EN CADA `generar`
 * (no al importar: no abre conexion). NO se memoiza: memoizado, el repo quedaba atado al cliente de
 * la PRIMERA llamada para siempre — en la integracion, una transaccion ya revertida (P2028, «R7/R8
 * por el catalogo» rojo tras «R30/R9»). Construirlo es gratis: `getPrismaClient()` es el singleton.
 */
function depsDeProduccion(): () => DepsInformePicking {
  return () => ({ repo: new PickingRepository(getPrismaClient()) });
}

/**
 * Fabrica con dependencias (los tests pasan un doble); el catalogo registra la de produccion
 * (`crearInformePicking()` sin argumentos), que no abre conexion al importarse.
 */
export function crearInformePicking(deps?: DepsInformePicking): InformeWhatsapp<ParametrosPicking> {
  const resolver = deps !== undefined ? () => deps : depsDeProduccion();
  return {
    clave: CLAVE_INFORME_PICKING,
    nombre: "Picking",
    descripcion:
      "Lo que está «En preparación» de una tienda con fulfillment en el momento del envío, agrupado por producto, con las remisiones que lo llevan.",
    parametros: parametrosPickingSchema,
    parametrosPorDefecto: PARAMETROS_PICKING_POR_DEFECTO,
    descriptores: [
      {
        campo: "picking",
        etiqueta: "Parámetros del picking",
        tipo: "panel",
        panel: "picking",
        campos: ["tiendaId", "diasAtraso"],
        ayuda: "Solo aparecen las tiendas con fulfillment. Cada tienda va en su propio envío.",
      },
    ],
    variables: [
      { clave: "tienda", nombre: "Tienda", descripcion: "Nombre de la tienda del picking.", ejemplo: "Gameos" },
      {
        clave: "ordenes",
        nombre: "Órdenes en preparación",
        descripcion: "Órdenes de la tienda que están En preparación en el momento del envío.",
        ejemplo: "25",
      },
      { clave: "unidades", nombre: "Unidades", descripcion: "Total de unidades a preparar.", ejemplo: "41" },
      { clave: "productos", nombre: "Productos distintos", descripcion: "Número de productos distintos del picking.", ejemplo: "10" },
      {
        clave: "atrasadas",
        nombre: "Órdenes atrasadas",
        descripcion: "Órdenes que llevan más días en preparación que los indicados en el envío.",
        ejemplo: "2",
      },
      {
        clave: "dias_atraso",
        nombre: "Días para marcar atrasada",
        descripcion: "Una orden se marca atrasada si lleva más de estos días en preparación.",
        ejemplo: "2",
      },
      { clave: "remision_desde", nombre: "Primera remisión", descripcion: "La primera remisión del picking.", ejemplo: "NA-1069" },
      { clave: "remision_hasta", nombre: "Última remisión", descripcion: "La última remisión del picking.", ejemplo: "NA-1101" },
      { clave: "fecha", nombre: "Fecha del picking", descripcion: "Fecha del envío (hora de Costa Rica).", ejemplo: "05/10/2026" },
      { clave: "hora", nombre: "Hora del picking", descripcion: "Hora del envío (hora de Costa Rica).", ejemplo: "06:30" },
    ],
    generaDocumento: true,
    // D3: el picking lo hace la bodega de Ordenex; no llega a una tienda.
    aptoParaAdminTienda: false,
    eventos: [],
    soloPorEvento: false,
    async generar(ctx): Promise<ResultadoInforme> {
      const { repo, pdf = pdfDePicking } = resolver();
      const { tiendaId, diasAtraso } = ctx.parametros;
      const tienda = await leer("tiendaDelPicking", () => repo.tiendaDelPicking(tiendaId));
      if (tienda === null || !tienda.esTienda || !tienda.activo || !tienda.fulfillment) {
        return { tipo: "error", motivo: motivoTiendaNoValida(tienda) };
      }
      const filas = await leer("ordenesEnPreparacion", () => repo.ordenesEnPreparacion(tiendaId));
      if (filas.length === 0) return { tipo: "vacio", motivo: motivoSinOrdenes(tienda.nombre) };
      const modelo = construirModeloPicking(filas, { ahora: ctx.ahora, diasAtraso, tienda: tienda.nombre });
      return {
        tipo: "contenido",
        valores: { ...modelo.valores },
        ...(ctx.conDocumento ? { documento: { bytes: pdf(modelo), nombreArchivo: modelo.nombreArchivo } } : {}),
      };
    },
  };
}
