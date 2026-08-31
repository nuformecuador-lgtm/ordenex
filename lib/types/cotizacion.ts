// Feature 255 — Tipos y validacion del borde de COTIZACION por API key
// (`POST /api/ordenes/api-key/cotizacion`). Contrato de entrada de `design.md`
// §2.1 y contrato de salida de §2.2.
import { z } from "zod";

import { cargaMasivaConfig } from "@/lib/config/carga-masiva";
import { redondearMontoCobrarTexto } from "@/lib/utils/monto-cobrar";

/**
 * Un decimal NO NEGATIVO serializado como texto (`"25900"`, `"25900.50"`).
 *
 * `monto_cobrar` se conserva como STRING de punta a punta y este modulo no
 * escribe una sola conversion a numero: es la BASE de la comision COD y
 * `derivarIngresoOrden` espera `montoCobrar: string | null` para meterlo tal
 * cual en un `Prisma.Decimal` (R33).
 *
 * FICHA 305 — LO QUE SI CAMBIA ES EL VALOR: el monto sale de aqui REDONDEADO al
 * colon, igual que en la carga. Sigue siendo un string y sigue sin convertirse
 * a numero EN ESTE ARCHIVO; el redondeo se delega en `redondearMontoCobrarTexto`
 * (`lib/utils/monto-cobrar.ts`), que es la MISMA funcion de la feature 299 que
 * usa `filaCargaSchema`. La conversion vive alli, declarada, y por eso la
 * cotizacion y la carga no pueden discrepar para ninguna entrada.
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
  // R32: vacio o ausente -> `null`, y la base de la comision es cero. El valor se
  // valida por su FORMA y se entrega como texto.
  //
  // FICHA 305 — SALE REDONDEADO AL COLON, COMO EN LA CARGA. Hasta hoy la
  // cotizacion calculaba el precio sobre el monto EXACTO y la carga persistia el
  // REDONDEADO (feature 299): quien cotizara `11898.81` recibia la comision de
  // `11898.81` y despues se le cobraba la de `11899`. Son centimos sobre la
  // comision, pero son dos cifras que no cuadran, y este endpoint publica un
  // PRECIO. Cotizar sobre el monto que de verdad se va a cobrar es la unica
  // forma de que la promesa valga.
  //
  // POR QUE AQUI Y NO EN EL SERVICE: esta es la PUERTA, el mismo sitio en que la
  // carga redondea. El service consume `monto_cobrar` en dos puntos —la base de
  // la comision COD y el `total` del escenario entregado— y redondear en uno
  // solo dejaria justo la incoherencia que se viene a cerrar.
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
      return redondearMontoCobrarTexto(value);
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
 * Los SEIS importes del escenario ENTREGADO (R26). Todos STRING y todos YA
 * FORMATEADOS: no existe un campo crudo de escala 2 en paralelo (R34, decision
 * firmada A3).
 *
 * FULFILLMENT (2026-08-25): el sexto concepto. Es el monto FIJO por orden de la
 * tarifa que resuelve, y solo aparece con valor cuando la tienda hace
 * fulfillment (`tarifas.fulfillment > 0`, ver `tieneFulfillment` en
 * `lib/utils/ingreso-ordenex.ts`). Cuando no lo hace vale CERO y no falta: es la
 * misma decision que ya tomo `comision` en el escenario devuelto (R28) — un cero
 * afirmado se lee, un campo ausente se adivina.
 */
export interface CostosEntregado {
  flete: string;
  iva: string;
  comision: string;
  ivaComision: string;
  /** Monto fijo de bodega por orden; cero explicito si la tienda no hace fulfillment. */
  fulfillment: string;
  /** R30/D1: lo que RECIBE la tienda = monto a cobrar − los CINCO conceptos. */
  total: string;
}

/**
 * Los CINCO importes del escenario DEVUELTO (R27). SIN `ivaComision`: una
 * devolucion no cobra comision COD, asi que su IVA no existe. `comision` es el
 * cero EXPLICITO de R28 — nunca falta y nunca es `null`.
 *
 * FICHA 301 (2026-08-28): "devuelto" es el escenario en que el PAQUETE VUELVE a
 * la tienda, y desde esa fecha eso es exactamente una gestion `rechazada` (ver
 * `calcularEscenarios` en `CotizacionOrdenService`). Un intento fallido que
 * queda como `devuelta` —reprogramable, recuperable— ya no factura nada. Los
 * importes de esta interfaz NO cambiaron de valor con la 301.
 */
export interface CostosDevuelto {
  flete: string;
  iva: string;
  comision: string;
  /**
   * FULFILLMENT (2026-08-25) — se cobra IGUAL que en el escenario entregado, y por eso
   * aparece tambien aqui. El servicio de bodega ya se presto cuando el paquete se preparo y
   * salio: que el destinatario no lo reciba no lo devuelve a la estanteria sin haber costado
   * nada. Cero explicito cuando la tienda no hace fulfillment.
   */
  fulfillment: string;
  /** R31/D1: la DEUDA de la tienda = −(flete + iva + fulfillment), negativo. */
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
 * La respuesta 200 completa (design.md §2.2).
 *
 * NO LLEVA BLOQUE `totales` (retirado el 2026-08-31). El agregado del lote de la 255 sumaba
 * cada fila cotizada en el escenario ENTREGADO y en el DEVUELTO al mismo tiempo: dos
 * compilados bajo las premisas de "100% entregas" y "100% rechazos", ninguna de las cuales
 * describe un lote real. Lo que este endpoint publica es el precio POR ORDEN; el agregado,
 * con la premisa de entrega que corresponda, es de quien consume.
 */
export interface CotizacionResumen {
  total: number;
  cotizadas: number;
  conError: number;
  filas: FilaCotizacionResultado[];
}
