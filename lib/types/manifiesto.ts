// Feature 148 — Tipos y schemas del backend del "manifiesto Excel al crear o mover
// ordenes". El manifiesto es un READ derivado de `orden` + zona + tienda + mensajero:
// NO hay tabla nueva, NO hay migracion (design.md §0/D3). DTOs propios (no amplian
// OrdenDTO ni ningun DTO de los 5 servicios de negocio) para no alterar su contrato
// (R27); patron `lib/types/etiqueta-guia.ts`.
import { z } from "zod";
import { cargaMasivaConfig } from "@/lib/config/carga-masiva";

/**
 * Los puntos de enganche del manifiesto (design.md §4). `generacion_guia` cubre
 * tanto "Generar guia" como su variante "asignar desde bodega" (R19): el movimiento
 * fisico y el responsable se derivan de los datos ya persistidos de la orden, no del
 * boton que se pulso.
 *
 * FEATURE 155/R24 (opcion C de la puerta T0.1, 2026-07-29): entra un SEPTIMO flujo,
 * `recoleccion_tienda`, para el lote que nace por la rama (b) de la bifurcacion de creacion
 * (la orden se queda en la tienda esperando al mensajero). Su mapeo origen/destino es el
 * MISMO que `carga_masiva` — sale de la tienda, llega a la bodega central — y aun asi no se
 * reuso aquel: el flujo es la ETIQUETA de la operacion, y llamar "carga masiva" a lo que
 * produjo un alta manual o una carga por API key seria mentir en el papel que alguien firma.
 * El mapeo igual es una coincidencia del movimiento fisico, no de la operacion.
 */
export const MANIFIESTO_FLUJOS = [
  "carga_masiva",
  "generacion_guia",
  "ruteo_satelite",
  "asignacion_satelite",
  "devolucion_central",
  "envio_tienda",
  "recoleccion_tienda", // feature 155/R24
] as const;

export type ManifiestoFlujo = (typeof MANIFIESTO_FLUJOS)[number];

/**
 * Fila del manifiesto, ya en el valor de salida.
 *
 * REGLA VIGENTE (feature 160/R28, design 160 §6.3 — DEROGA y REEMPLAZA los R2/R11 de la
 * feature 148, decision del humano del 2026-07-29):
 *
 *   > **El manifiesto refleja los datos de la orden.** Lleva una columna por cada dato propio
 *   > de la orden que el producto haya decidido exponer, y ese conjunto **crece** cuando la
 *   > orden gana un dato nuevo. El conjunto es ABIERTO: ni el codigo ni las pruebas pueden
 *   > afirmar "exactamente N columnas".
 *
 * Lo que se derogo es el NUMERO CERRADO ("EXACTAMENTE las 11 columnas"), no el filtro. SIGUE
 * VIGENTE el lado prohibitivo del viejo R11: identificadores internos (`ordenId`, `tiendaId`),
 * banderas de borrado (`deletedAt`) y datos que NO son de la orden siguen SIN entrar.
 *
 * Orden de las columnas (estable, se verifica en los tests por clave y orden RELATIVO):
 * `num_guia`, `num_remision`, `destinatario`, `telefono`, `direccion`, `zona`, `producto`,
 * `monto`, `intentos`, `origen`, `destino`, `responsable`, `fecha`.
 *
 * `numGuia` null -> celda vacia (R5). `monto` null -> celda vacia (R7). `direccion` es
 * nullable en la orden y se emite tal cual (nunca un texto inventado). `intentos` es NUMERICO
 * y NO nullable: una orden sin intentos emite `0`, no celda vacia (160/R28a).
 */
export interface ManifiestoFilaDTO {
  numGuia: number | null; // R5
  numRemision: string;
  destinatario: string;
  telefono: string; // R2/§9.4: telefono del DESTINATARIO
  direccion: string | null;
  zona: string; // R6: NOMBRE de la zona, nunca su id
  /**
   * `orden.producto` — descripcion de la mercancia. Dato propio de la orden, luego columna del
   * manifiesto por la regla 160/R28 (el conjunto CRECE cuando la orden expone un dato mas). NO
   * nullable: la columna es NOT NULL en `orden`, asi que no hay celda vacia que documentar.
   */
  producto: string;
  monto: number | null; // R7/§9.3: `orden.monto_cobrar` (COD)
  /**
   * Feature 160 (R28a): intentos de entrega VIGENTES de la orden (criterio unico de
   * `OrdenHistorialService`, design 160 §1.1). NO opcional a proposito: este DTO enumera sus
   * propiedades una a una para que el archivo no omita campos en silencio, y el `0` de una
   * orden sin intentos DEBE emitirse como `0` (en Excel una celda vacia NO es `0`).
   */
  intentos: number;
  origen: string; // R8: ubicacion de SALIDA del movimiento de ESTE flujo
  destino: string; // R8: ubicacion de LLEGADA del movimiento de ESTE flujo
  responsable: string; // R9/§9.8: mensajero asignado, si no el usuario que ejecuto
  fecha: string; // R10/§9.5: YYYY-MM-DD calendario CR de la OPERACION
}

/**
 * R12 — Referencia solicitada que NO produjo fila: `ref` es el `ordenId` o el
 * `numRemision` tal y como llego en la entrada. `no_encontrada` cubre "no existe",
 * "esta borrada" y "es de otra tienda y el actor es una API key" (R29): los tres se
 * reportan igual para no revelar la existencia de una orden ajena.
 */
export interface ManifiestoOmitidaDTO {
  ref: string;
  motivo: "no_encontrada";
}

/**
 * R30 — Entrada del borde. Union de las DOS formas de seleccion del lote
 * (design.md §2): por ids de orden (todos los flujos) o por `num_remision`, que es la UNICA
 * via de la carga masiva porque su `BulkSummary` no lleva ids.
 * Seleccion vacia, id malformado o flujo desconocido -> ZodError -> validation_error.
 * El techo de `numRemisiones` es el mismo de la carga masiva (design.md §8.5).
 *
 * Feature 155/R24: `recoleccion_tienda` se suma a la seleccion por `numRemisiones` por el
 * mismo motivo que `carga_masiva` — cuando el lote nace por la rama (b) desde la carga masiva
 * por UI, lo unico que el cliente tiene en la mano son las remisiones. Por `ordenIds` ya
 * entraba (esa rama admite todos los flujos), y es la via que usa el canal de API key.
 */
export const manifiestoSchema = z.union([
  z.object({
    flujo: z.enum(MANIFIESTO_FLUJOS),
    ordenIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    flujo: z.enum(["carga_masiva", "recoleccion_tienda"]),
    numRemisiones: z.array(z.string().min(1)).min(1).max(cargaMasivaConfig.MAX_ROWS),
  }),
]);

export type ManifiestoInput = z.infer<typeof manifiestoSchema>;

/**
 * Resultado tipado del borde (Server Action). `unauthenticated` (R28) y
 * `validation_error` (R30) los produce el borde; `ok`/`forbidden` vienen del service
 * como resultado de dominio (nunca como excepcion). Una referencia invalida NO aborta
 * el lote (R12): viaja en `omitidas`, no como error del resultado.
 */
export type ManifiestoResult =
  | { status: "ok"; filas: ManifiestoFilaDTO[]; omitidas: ManifiestoOmitidaDTO[] }
  | { status: "unauthenticated" } // R28
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // R30
