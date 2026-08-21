// Feature 255 — Tipos y validacion del borde de COTIZACION por API key
// (`POST /api/ordenes/api-key/cotizacion`). Contrato de entrada de `design.md`
// §2.1 y contrato de salida de §2.2.
import { z } from "zod";

import { cargaMasivaConfig } from "@/lib/config/carga-masiva";

/**
 * Un decimal NO NEGATIVO serializado como texto (`"25900"`, `"25900.50"`).
 *
 * `monto_cobrar` se conserva como STRING de punta a punta y no pasa por
 * `Number(`: es la BASE de la comision COD y `derivarIngresoOrden` espera
 * `montoCobrar: string | null` para meterlo tal cual en un `Prisma.Decimal`
 * (R33). Aqui esta la diferencia deliberada con `filaCargaSchema`
 * (`lib/types/carga-masiva.ts`), que si lo convierte a numero porque la columna
 * lo recibe como numero.
 */
const DECIMAL_NO_NEGATIVO = /^\d+(\.\d+)?$/;

function textoObligatorio(campo: string) {
  return z
    .string()
    .trim()
    .min(1, `${campo} es obligatorio`);
}

/**
 * Una fila de cotizacion (decision D5): la terna geografica en columnas
 * SEPARADAS (contrato publico de la feature 88), la direccion y el monto a
 * cobrar; `num_remision` es OPCIONAL y solo sirve de correlacion (R9).
 *
 * NO ES `filaCargaSchema` Y NO SE REUTILIZA: alli `num_remision`,
 * `destinatario`, `telefono` y `producto` son obligatorios y aqui no aportan al
 * precio. Cotizar no persiste nada, asi que exigir los datos del destinatario
 * seria pedir datos personales para calcular un precio.
 *
 * NO-STRICT A PROPOSITO: zod descarta en silencio las claves desconocidas, para
 * que el integrador pueda mandar el MISMO cuerpo que le manda a `/carga` sin
 * recortarlo — que es el punto entero de la feature (R7). Convertirlo en
 * `.strict()` rompe ese contrato; es el mismo ancla que ya lleva escrito
 * `filaCargaSchema` por el round-trip de la feature 143.
 */
export const filaCotizacionSchema = z.object({
  provincia: textoObligatorio("provincia"),
  canton: textoObligatorio("canton"),
  distrito: textoObligatorio("distrito"),
  // Se acepta y no participa del precio (design.md §2.1).
  direccion: z.string().trim().optional().default(""),
  // R9/D5: si viene se devuelve tal cual; si no, el resultado lleva `null`. Un
  // valor vacio se trata como AUSENTE y no como error: es un dato de
  // correlacion, no una entrada del precio, y rechazar el lote por el seria
  // exigir `num_remision` para cotizar, que es justo lo que R9 prohibe.
  num_remision: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === "" ? undefined : value)),
  // R32: vacio o ausente -> `null`, y la base de la comision es cero. El valor
  // NO se convierte a numero: se valida su FORMA y se entrega como texto.
  monto_cobrar: z
    .string()
    .trim()
    .optional()
    .default("")
    .transform((value, ctx) => {
      if (value === "") return null;
      if (!DECIMAL_NO_NEGATIVO.test(value)) {
        ctx.addIssue({ code: "custom", message: "monto_cobrar debe ser numerico y no negativo" });
        return z.NEVER;
      }
      return value;
    }),
});

export type FilaCotizacionInput = z.infer<typeof filaCotizacionSchema>;

/**
 * El cuerpo de la peticion. Las filas viajan CRUDAS (clave = columna, valor =
 * texto), igual que en la carga por API key: `filaCotizacionSchema` se aplica
 * FILA A FILA dentro del service, porque una fila invalida se marca como error
 * en su propio resultado y no tumba el lote entero (R21). Lo que si rechaza este
 * schema con un 422 es el lote vacio o por encima del tope (R8).
 */
export const cotizacionBodySchema = z.object({
  ordenes: z
    .array(z.record(z.string(), z.string()))
    .min(1, "el lote no puede estar vacío")
    .max(cargaMasivaConfig.MAX_CHUNK_ROWS, "el lote excede el máximo permitido"),
});

export type CotizacionBody = z.infer<typeof cotizacionBodySchema>;

/**
 * Los cinco importes del escenario ENTREGADO (R26). Todos STRING y todos YA
 * FORMATEADOS: no existe un campo crudo de escala 2 en paralelo (R34, decision
 * firmada A3).
 */
export interface CostosEntregado {
  flete: string;
  iva: string;
  comision: string;
  ivaComision: string;
  /** R30/D1: lo que RECIBE la tienda = monto a cobrar − los cuatro conceptos. */
  total: string;
}

/**
 * Los cuatro importes del escenario DEVUELTO (R27). SIN `ivaComision`: una
 * devolucion no cobra comision COD, asi que su IVA no existe. `comision` es el
 * cero EXPLICITO de R28 — nunca falta y nunca es `null`.
 */
export interface CostosDevuelto {
  flete: string;
  iva: string;
  comision: string;
  /** R31/D1: la DEUDA de la tienda = −(flete + iva), negativo. */
  total: string;
}

/** Los dos escenarios de una fila cubierta (R23). */
export interface CostosCotizacion {
  entregado: CostosEntregado;
  devuelto: CostosDevuelto;
}

/** No existe `"duplicada"` (R10): sin persistencia no significaria nada. */
export type ResultadoCotizacionFila = "cotizada" | "error";

/** El resultado de UNA fila (design.md §2.2). */
export interface FilaCotizacionResultado {
  /** Indice 1-based dentro del array recibido (R46). */
  fila: number;
  /** R9: el `num_remision` tal cual si vino; `null` si no vino. */
  numRemision: string | null;
  resultado: ResultadoCotizacionFila;
  /** Solo en `"cotizada"`: una fila en error NO trae costos (R22). */
  costos?: CostosCotizacion;
  /** Solo en `"error"`: mensajes por campo, reusados tal cual de la carga. */
  errores?: Record<string, string[]>;
}

/**
 * Los totales del LOTE (decision D2, R51–R56). Espeja EXACTAMENTE la forma de
 * los costos de una fila —`entregado` con cinco conceptos, `devuelto` con
 * cuatro— porque una suma de devoluciones tampoco lleva IVA de comision.
 *
 * Los dos contadores son parte del contrato, no un extra de cortesia (R54): un
 * total que calla las filas que dejo fuera se lee como "esto cuesta el lote"
 * cuando no lo es. `filasSumadas + filasExcluidas` es siempre el total de filas
 * recibidas, y solo aportan importes las filas `"cotizada"` (R53).
 */
export interface TotalesCotizacion {
  filasSumadas: number;
  filasExcluidas: number;
  entregado: CostosEntregado;
  devuelto: CostosDevuelto;
}

/**
 * La respuesta 200 completa (design.md §2.2). El bloque `totales` se emite
 * SIEMPRE, tambien cuando ninguna fila cotiza: entonces va en cero con
 * `filasSumadas: 0` (R56). Cero es una afirmacion; ausente seria un dato que
 * falta.
 */
export interface CotizacionResumen {
  total: number;
  cotizadas: number;
  conError: number;
  totales: TotalesCotizacion;
  filas: FilaCotizacionResultado[];
}
