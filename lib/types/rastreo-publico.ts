import { z } from "zod";

import type { OrderStatusValue } from "@/lib/types/order-status";

// Feature 229 (design §3) — CONTRATO COMPARTIDO del rastreo publico del envio.
//
// Modulo de TIPOS + tablas puras. NO importa `repositories/`, `services/`, `@/lib/db` ni
// `next/headers`: el Client Component del modal importa de aqui las etiquetas de los hitos,
// y cualquiera de esos imports lo convertiria en codigo de servidor (mismo criterio que
// `lib/types/tablero-dia.ts:1-8`).

/* -------------------------------------------------------------------------- */
/* 1. El vocabulario publico (requirements §D2, decision G5)                    */
/* -------------------------------------------------------------------------- */

/**
 * Los NUEVE hitos firmados en el gate (G5) mas `en_proceso`, que NO es uno de los nueve:
 * es la red de seguridad para filas del historial que referencian un estatus fuera del
 * catalogo vigente (R17, caso real de la feature 155). Se declara aqui, junto a los otros,
 * porque es un valor que el modal tiene que saber pintar.
 */
export const HITOS_PUBLICOS = [
  "registrado",
  "en_bodega",
  "en_transito",
  "en_reparto",
  "entregado",
  "reprogramado",
  "no_entregado",
  "devolucion_en_curso",
  "devuelto",
  "en_proceso",
] as const;

export type HitoPublico = (typeof HITOS_PUBLICOS)[number];

/**
 * R15 — el texto que ve el destinatario. Es lo UNICO que se pinta: ningun
 * `order_status.value` interno cruza la frontera. Copiado literal de la tabla de nueve
 * hitos de `requirements.md` §D2, mas el texto neutral del hito por defecto.
 */
export const ETIQUETA_POR_HITO: Record<HitoPublico, string> = {
  registrado: "Envío registrado",
  en_bodega: "En nuestras instalaciones",
  en_transito: "En tránsito",
  en_reparto: "En reparto",
  entregado: "Entregado",
  reprogramado: "Entrega reprogramada",
  no_entregado: "No fue posible entregarlo",
  devolucion_en_curso: "En devolución a la tienda",
  devuelto: "Devuelto a la tienda",
  en_proceso: "En proceso",
};

/* -------------------------------------------------------------------------- */
/* 2. El mapeo estatus interno -> hito publico (R16/R17)                        */
/* -------------------------------------------------------------------------- */

/**
 * R16 — TRANSCRIPCION LITERAL de la tabla firmada de `requirements.md` §D2 (los 20 values
 * de `ORDER_STATUS_SEED`). Esa tabla es la fuente; esto es su copia.
 *
 * El `satisfies Record<OrderStatusValue, HitoPublico>` es TOTAL a proposito (patron de
 * `ORDER_STATUS_LABELS`, `EstatusBadge.tsx:13`, no el parcial de `tablero-dia.ts`): añadir
 * un value al catalogo debe ROMPER EL BUILD aqui, no caer en silencio en el hito neutral.
 *
 * Tres asignaciones son decisiones firmadas y NO se "arreglan" en implementacion:
 *  - `recolectando` -> `registrado` (G6): el mensajero va en camino a la tienda, pero el
 *    paquete todavia no esta con nosotros; decir "en transito" adelantaria un hecho.
 *  - `incidente` -> `no_entregado` (G7): colapsado, sin hito propio; un hito "incidencia"
 *    insinuaria daño o perdida antes de que la tienda hable con el cliente.
 *  - `sin_gestionar` -> `en_reparto` (G8, RIESGO ACEPTADO, design §5.ter): el cliente ve
 *    "En reparto" y no se entera de que su envio se quedo sin gestionar. Es deliberado.
 */
export const HITO_POR_ESTATUS = {
  en_preparacion: "registrado",
  por_recolectar_en_tienda: "registrado",
  recolectando: "registrado", // G6
  por_recoger: "en_bodega",
  en_bodega_central: "en_bodega",
  en_bodega_satelite: "en_bodega",
  en_ruta_bodega_central: "en_transito",
  en_ruta_bodega_satelite: "en_transito",
  en_reparto: "en_reparto",
  sin_gestionar: "en_reparto", // G8 — riesgo aceptado (design §5.ter)
  entregada: "entregado",
  reprogramada: "reprogramado",
  devuelta: "no_entregado",
  rechazada: "no_entregado",
  incidente: "no_entregado", // G7
  por_devolver: "devolucion_en_curso",
  devolviendo_a_bodega_central: "devolucion_en_curso",
  por_devolver_a_tienda: "devolucion_en_curso",
  devolviendo_a_tienda: "devolucion_en_curso",
  devuelta_a_tienda: "devuelto",
} as const satisfies Record<OrderStatusValue, HitoPublico>;

/**
 * R17 — hito NEUTRAL para values huerfanos (fuera del catalogo vigente). El historial es
 * append-only: una fila antigua puede apuntar a un `order_status` retirado del seed
 * (feature 155, `lib/types/order-status.ts:45-53`). Ni se omite la fila, ni se revienta,
 * ni se publica el value crudo.
 */
export const HITO_POR_DEFECTO: HitoPublico = "en_proceso";

/**
 * R16/R17 — hito de un estatus. Acepta `string` A PROPOSITO (mismo criterio que
 * `bucketDeEstatus`, `lib/types/tablero-dia.ts:66`): el value llega crudo de
 * `order_status.value` y puede estar fuera del catalogo vigente.
 */
export function hitoDeEstatus(value: string): HitoPublico {
  const explicito: Partial<Record<string, HitoPublico>> = HITO_POR_ESTATUS;
  return explicito[value] ?? HITO_POR_DEFECTO;
}

/* -------------------------------------------------------------------------- */
/* 3. Entrada del borde publico (design §3.1)                                   */
/* -------------------------------------------------------------------------- */

// R12 — textos FIJOS, sin interpolar nunca la guia ni el segundo factor.
const MENSAJE_GUIA = "Número de guía no válido.";
const MENSAJE_FACTOR = "Dato requerido.";

/**
 * R13 — EXACTAMENTE DOS CAMPOS. Ni uno mas: ni zona, ni tienda, ni mensajero, ni fecha, ni
 * paginacion. Un borde sin sesion con filtros es un oraculo del negocio (precedente
 * documentado en `lib/actions/conteos-publicos.ts:19-24`). Una guardia lee estas claves.
 */
export const consultaRastreoSchema = z.object({
  // La guia llega TECLEADA (cadena) o ya numerica, y por eso se coerce. Pero la union
  // previa no es decorativa: `z.coerce.number()` a secas acepta `[4321]` y `true` —
  // `Number([4321])` es 4321— y un borde publico no tiene por que admitir esas formas.
  numGuia: z
    .union([z.number(), z.string()], { error: MENSAJE_GUIA })
    .transform((valor) => Number(valor))
    .pipe(z.number({ error: MENSAJE_GUIA }).int(MENSAJE_GUIA).positive(MENSAJE_GUIA)),
  factor: z.string({ error: MENSAJE_FACTOR }).trim().min(1, MENSAJE_FACTOR),
});

export type ConsultaRastreo = z.infer<typeof consultaRastreoSchema>;

/* -------------------------------------------------------------------------- */
/* 4. Salida: lista blanca CERRADA de cuatro campos (R22, G11/G13)              */
/* -------------------------------------------------------------------------- */

export interface HitoPublicoEntrada {
  /** Vocabulario publico, nunca el value interno (R15). */
  readonly hito: HitoPublico;
  /** Dia Y hora (G12) en la zona horaria del negocio, resuelta por configuracion (R19). */
  readonly fecha: string;
}

/**
 * R22 — CUATRO campos y ninguno mas. Cualquier campo no declarado es una fuga, no una
 * mejora: la lista blanca es el mecanismo (R23/G14), no la buena intencion.
 */
export interface RastreoPublicoDTO {
  readonly numGuia: number;
  readonly hitoVigente: HitoPublico;
  readonly actualizadoEn: string;
  readonly linea: readonly HitoPublicoEntrada[];
}

/**
 * R7 — `no_encontrado` NO lleva payload: no hay donde meter una diferencia entre "la guia
 * no existe", "el segundo factor no coincide", "la orden esta borrada" y "el telefono del
 * destinatario tiene menos de 4 digitos". Ese vacio es el mecanismo, no un descuido.
 */
export type ResultadoRastreoPublico =
  | { readonly estado: "ok"; readonly envio: RastreoPublicoDTO }
  | { readonly estado: "no_encontrado" }
  | { readonly estado: "demasiados_intentos" }
  | { readonly estado: "validation_error"; readonly campos: Record<string, string> };
