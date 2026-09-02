// FICHA 347 — el contrato del DETALLE ORDEN POR ORDEN del dinero de un producto.
//
// Modulo de TIPOS + el schema del borde. Sin Prisma (salvo el union `GestionResultado`, que es
// un tipo y se borra al compilar), sin repositorios y sin servicios: lo importan el borde, el
// servicio y la pantalla, asi que no puede arrastrar el cliente de base de datos al bundle.
//
// Money-safe (R22): TODO importe cruza la frontera como STRING escala 2. El navegador NO
// convierte, no suma y no reformatea.

import { z } from "zod";
import type { GestionResultado } from "@prisma/client";

import { conteoEntregasFiltroSchema } from "@/lib/analytics/entregas-conteo";
import { detalleMovimientoConfig } from "@/lib/config/detalle-movimiento";
import type { DineroProductoDTO } from "@/lib/types/conteo-productos";

/**
 * FICHA 347 (R32/R35/R36/R37) — UNA fila del detalle: UNA ORDEN y cuanto aporta.
 *
 * EL GRANO ES LA ORDEN, no la gestion ni el par (cierre, orden): si una orden aporta por varias
 * gestiones o aparece en varios cierres, sale UNA vez con la SUMA de sus aportes (R35), y
 * `resultados` lleva los resultados de todas las gestiones que la hicieron aportar.
 */
export interface OrdenDineroDTO {
  /** `rowKey` de la tabla. NUNCA sale en la descarga: alli no entra ningun uuid (R69). */
  readonly ordenId: string;
  /** El numero con el que se HABLA de la orden: `num_guia` si la tiene, si no `num_remision`. */
  readonly guia: string;
  readonly destinatario: string;
  /** Los resultados de SUS gestiones aportantes, sin agrupar (R37). */
  readonly resultados: readonly GestionResultado[];
  /**
   * R37 — si esa orden esta LIQUIDADA (cierre aprobado con tarifa congelada) o PENDIENTE.
   *
   * ⚠ Es el rotulo de la ORDEN y explica por que sus tres cifras derivadas pueden ser `null`:
   * de una orden pendiente no se emite reparto (R27) y no se proyecta nada (R31).
   */
  readonly estado: "liquidada" | "pendiente";
  /** Lo que sus gestiones de ENTREGA cobraron. STRING escala 2. Es un hecho, siempre existe. */
  readonly recaudado: string;
  /** Flete + IVA + comision + IVA de sus gestiones liquidadas. `null` si esta pendiente. */
  readonly ordenex: string | null;
  /** Lo recaudado liquidado menos lo anterior. `null` si esta pendiente. */
  readonly tienda: string | null;
  /** Flete de devolucion + IVA si fue rechazada y liquidada. FUERA del reparto (R19). */
  readonly retorno: string | null;
}

/**
 * FICHA 347 — lo que se muestra al abrir la fila de un producto.
 *
 * ⚠ `totales` va en la CABECERA del panel por el mismo motivo por el que la 344 pinta el
 * `monto` del movimiento: para poder COTEJAR la suma sin salir de la pantalla. Son las MISMAS
 * cifras que la fila de la tabla, y lo son por construccion —salen de la misma funcion sobre el
 * mismo conjunto—, no por una coincidencia.
 *
 * ⚠ NO HAY FILA DE SUBTOTAL DE PAGINA, y es deliberado: la pagina no es el conjunto, y un
 * subtotal al lado del total invita a restarlos.
 */
export interface DetalleDineroProductoPayload {
  /** La forma VISIBLE del producto, elegida con el mismo criterio determinista que la tabla. */
  readonly producto: string;
  readonly tiendaNombre: string;
  /** Las MISMAS cifras que la fila (R38). */
  readonly totales: DineroProductoDTO;
  /**
   * N: cuantas ORDENES tiene el conjunto entero. Lo cuenta el SERVIDOR sobre el conjunto, JAMAS
   * `ordenes.length` de la pagina que se esta pintando (R40).
   */
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly ordenes: readonly OrdenDineroDTO[];
}

/**
 * Lo que devuelve la Server Action. Discriminado, como el resto del repo.
 *
 * `forbidden` NUNCA lleva el motivo: el porque se queda en el log de auditoria (R10). Y `vacio`
 * NO es un `ok` con lista vacia ni un error: R42 exige un estado EXPLICITO para «este producto
 * no tiene ninguna orden que aporte», porque una tabla en blanco se lee como un fallo.
 */
export type ResultadoDetalleDineroProducto =
  | { readonly status: "ok"; readonly datos: DetalleDineroProductoPayload }
  | { readonly status: "vacio" }
  /** R76 — el recorte supera el tope: NO se sirve un conjunto truncado, tampoco aqui. */
  | { readonly status: "limite_excedido"; readonly limite: number }
  | { readonly status: "unauthenticated" }
  | { readonly status: "forbidden" }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> };

/**
 * FICHA 347 (design §7.2) — LA ENTRADA DEL BORDE, y por que el `tiendaId` NO es un agujero.
 *
 * El cliente manda el FILTRO DE LA SECCION —el mismo objeto `.strict()` de siempre, con las seis
 * facetas y el rango— llevando `tienda_id: [<la tienda de la fila>]` COMO UNA FACETA MAS, mas la
 * clave del producto y la pagina.
 *
 * ⚠ ESA ES LA PIEZA IMPORTANTE: el `tienda_id` NO entra por una puerta nueva. Entra por la
 * faceta que `recortarFiltroConteoEntregas` YA interseca con el alcance del actor, asi que una
 * tienda ajena produce `filtro_fuera_de_alcance` → `forbidden` (R44, y NO un resultado vacio), y
 * la tienda concedida acaba en el `WHERE` de SQL (R43, R7). CERO codigo de permisos nuevo.
 *
 * ⚠ `.strict()` HACE DE R8 UN ERROR DE VALIDACION: una clave desconocida en el filtro —`{ dinero:
 * "concedido" }`, `{ rol: "maestro" }`— muere aqui, sin tocar la base y sin resolver el alcance
 * (R73). La concesion del dinero NUNCA viaja en la entrada: la resuelve el servidor.
 *
 * ⚠ EXACTAMENTE UNA TIENDA. El panel es el de UNA fila, y una fila es `(producto, tienda)`. Sin
 * esta comprobacion, un maestro que no mandara `tienda_id` abriria un panel que mezcla tiendas y
 * cuyos `totales` NO serian los de ninguna fila de la tabla — un cuadre roto que nadie veria.
 *
 * `page`, `pageSize` y su tope salen de la CONFIGURACION de la 344 (R41), nunca de un literal:
 * es el MISMO desplegable bajo una fila de tabla a ancho completo, con el mismo tamano, y un
 * segundo numero seria un segundo sitio donde ajustarlo.
 */
export const detalleDineroProductoSchema = z
  .object({
    filtro: conteoEntregasFiltroSchema,
    /**
     * La clave del producto, tal y como la produce `claveDeProducto` (minusculas, espacios
     * colapsados, sin puntos finales). SIN tope de longitud a proposito: un tope convertiria el
     * nombre de producto largo de una tienda en un error o —peor— en un panel vacio, y el texto
     * de `orden.producto` es libre. Lo que acota el payload es el limite de cuerpo de la
     * peticion, no una regla de negocio inventada aqui.
     */
    producto_clave: z.string().min(1),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(detalleMovimientoConfig.MAX_PAGE_SIZE)
      .default(detalleMovimientoConfig.DEFAULT_PAGE_SIZE),
  })
  .strict()
  .refine((v) => v.filtro.tienda_id !== undefined && v.filtro.tienda_id.length === 1, {
    path: ["filtro", "tienda_id"],
    message: "el detalle es de UNA fila: hace falta exactamente una tienda",
  });

export type DetalleDineroProductoInput = z.infer<typeof detalleDineroProductoSchema>;
