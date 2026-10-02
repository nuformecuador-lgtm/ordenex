import { z } from "zod";
import { detalleMovimientoConfig } from "@/lib/config/detalle-movimiento";
import type { GestionResultado } from "@prisma/client";

/**
 * Ficha 344 (design §3.1/§3.2) — el contrato del DETALLE de una fila del libro de movimientos:
 * de que cierre sale ese importe y que ordenes lo componen.
 *
 * Modulo de TIPOS: sin Prisma (salvo el union `GestionResultado`, que es un tipo y se borra al
 * compilar), sin repositorios y sin servicios. Lo importan el borde, el servicio y —cuando
 * lleguen— las dos pantallas, asi que no puede arrastrar el cliente de base de datos al bundle.
 *
 * Money-safe (R44): todo importe cruza la frontera como STRING escala 2. El navegador NO
 * convierte, no suma y no reformatea (R45).
 */

/**
 * Ficha 344 (R48/R49) — POR QUE un movimiento de cierre puede no repartirse por orden.
 *
 * Vive aqui, en un modulo sin Prisma, y no junto al catalogo de fuentes (`lib/utils/
 * aporte-por-orden.ts`, que si importa Prisma), porque la PANTALLA necesita el seed para
 * construir un `Record` TOTAL de textos: un motivo nuevo sin frase rompe el build en vez de
 * pintar una fila muda.
 *
 * Los motivos, con su fuente REAL escrita al lado (esa frase es el requisito R48: la fila se abre
 * igual y dice de donde sale su importe):
 *
 *  - `no_nace_de_un_cierre`      — ajustes manuales, gastos, sueldos, pagos a tienda y sus
 *                                  reversos (y la indemnizacion que nace de un incidente). No hay
 *                                  cierre del que colgar ordenes.
 *  - `snapshot_del_cierre`       — FICHA 468: SOLO el `pago_efectivo` del libro del mensajero, que
 *                                  vale `min(P, E)` del cierre. Repartirlo por guia exigiria decidir
 *                                  a que guias se carga el faltante de efectivo (una formula nueva).
 *
 * FICHA 468 (design §2.4) — se RETIRAN `suma_del_libro_por_tienda` (el contra-entrega de la caja) y
 * `otro_productor` (la indemnizacion del cierre): esos dos conceptos y el pago al mensajero se reparten
 * ahora por guia con la columna de `gestion_orden` cuya suma ES su importe (R27, medido al 100 %).
 */
export const MOTIVO_SIN_REPARTO_SEED = [
  "no_nace_de_un_cierre",
  "snapshot_del_cierre",
] as const;

export type MotivoSinReparto = (typeof MOTIVO_SIN_REPARTO_SEED)[number];

/**
 * Ficha 344 (R10/R20, design §3.2) — UNA fila del detalle: UNA ORDEN y cuanto aporta.
 *
 * El grano es la ORDEN y no la gestion (Q1, decidido por el humano): si una orden acumula dos
 * gestiones que aportan al mismo concepto, sale UNA vez y su `aporte` es la suma de las dos, y
 * `resultados` lleva los resultados de todas sus gestiones EN ESE CIERRE.
 *
 * Todo lo descriptivo sale del SNAPSHOT congelado del cierre (R22) —`cierre_detail`—, no de la
 * orden viva: el detalle de un cierre de hace un mes tiene que leerse como se leia entonces.
 */
export interface OrdenAporteDTO {
  /** `rowKey` de la tabla. NUNCA sale en la descarga (R36). */
  ordenId: string;
  /** El numero VISIBLE congelado: `num_guia` si lo hay, si no `num_remision`. */
  guia: string;
  destinatario: string;
  /** Congelado. La pantalla de la tienda no lo pinta (R14/R15). */
  tiendaNombre: string;
  /** Los resultados de SUS gestiones en ese cierre (R10/R13/R20). */
  resultados: GestionResultado[];
  /** STRING escala 2 (R44). Ni el borde ni la pantalla lo recalculan. */
  aporte: string;
}

/**
 * Ficha 344 (design §3.2) — lo que se muestra al abrir una fila del libro.
 *
 * `total` (N) y `ordenesDelCierre` (M) son la frase que el humano fue a buscar y no encontro:
 * «14 de 23». Son dos CARDINALES, no dinero, y los dos los cuenta la BASE (R12/R28).
 */
export interface DetalleMovimientoPayload {
  /** El importe del movimiento, tal cual lo guarda el libro, para poder cotejar la suma. */
  monto: string;
  /** La cabecera: de que cierre sale (R9). `mensajeroNombre` es `null` en `/mi-wallet` (R15). */
  cierre: { fecha: string; mensajeroNombre: string | null };
  /** M: cuantas ordenes tiene el cierre DENTRO DEL ALCANCE del actor (R12). */
  ordenesDelCierre: number;
  /** N: cuantas APORTAN a este concepto. Lo cuenta la base, jamas `ordenes.length` (R28). */
  total: number;
  page: number;
  pageSize: number;
  ordenes: OrdenAporteDTO[];
}

/**
 * Ficha 344 (design §3.1, R42) — la entrada del borde: DOS claves y ninguna mas.
 *
 * No hay `tiendaId`, no hay `cierreId`, no hay `categoria` y no hay lista de conceptos. Todo
 * eso lo resuelve el SERVIDOR leyendo la fila del movimiento, que es lo que hace imposible
 * forzar el alcance de `/mi-wallet` desde fuera: el `tienda_id` sale del ACTOR y va en el
 * `WHERE` de las dos lecturas.
 *
 * `.strict()`: una clave colada —`tiendaId` la primera— muere aqui con `validation_error` y
 * SIN tocar la base. Es la misma barrera que ya protege el ledger completo de la tienda.
 *
 * EL MISMO schema sirve a los DOS libros (la caja y la tienda) a proposito, y no se declara un
 * espejo: la entrada no depende de que libro se lee —son las mismas dos claves— y el alcance
 * NUNCA viaja en ella. Dos copias identicas serian dos definiciones que pueden divergir, y la
 * que divergiera seria justo la que decide que se puede pedir.
 *
 * `pageSize` y su tope salen de la CONFIGURACION (R26/R29), nunca de un literal.
 */
export const verDetalleDeMovimientoSchema = z
  .object({
    movimientoId: z.string().uuid(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(detalleMovimientoConfig.MAX_PAGE_SIZE)
      .default(detalleMovimientoConfig.DEFAULT_PAGE_SIZE),
  })
  .strict();

export type VerDetalleDeMovimientoInput = z.infer<typeof verDetalleDeMovimientoSchema>;

/**
 * Ficha 344 (R32/R33) — el mismo detalle SIN recorte por pagina, para la descarga.
 *
 * Se DERIVA del schema paginado quitando `page`/`pageSize` (molde de
 * `listarMovimientosCompletoSchema`), para que el modo completo no pueda aceptar una entrada
 * que el paginado rechazaria. El tope de filas lo aplica el SERVICIO, no el navegador.
 */
export const verDetalleDeMovimientoCompletoSchema = verDetalleDeMovimientoSchema
  .omit({ page: true, pageSize: true })
  .strict();

export type VerDetalleDeMovimientoCompletoInput = z.infer<
  typeof verDetalleDeMovimientoCompletoSchema
>;
