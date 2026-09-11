import { Prisma } from "@prisma/client";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import type { ApiOrdenCostoDTO } from "@/lib/types/api-orden";
import { derivarIngresoOrden } from "@/lib/utils/ingreso-ordenex";
import { serializarMontoCotizacion } from "@/lib/utils/monto-cotizacion";

/**
 * ⏳ 2026-09-10 — FEATURE 415 (T2): los CINCO conceptos de costo de UNA orden para el canal
 * integrador, en el escenario **ENTREGADA**.
 *
 * MODULO PURO: sin Prisma Client, sin repositorios y sin reloj. Lo unico que importa de Prisma es
 * `Decimal`, que es aritmetica, no acceso a datos.
 *
 * ⛔ CERO FORMULAS PROPIAS (R16). Aqui no se multiplica, no se divide y no se redondea: los cuatro
 * primeros conceptos salen de `derivarIngresoOrden`, **la misma funcion que liquida el cierre y
 * que cotiza el canal**, y el quinto (`fulfillment`) sale del monto que el llamador pasa, porque
 * el fulfillment vive FUERA de la formula de liquidacion desde el 2026-08-19 y se congela aparte
 * en `cierre_detail.tarifa_fulfillment`. Si un dia cambia la formula del cierre, esto cambia con
 * ella; no pueden divergir por construccion. El precedente esta medido: la feature 204 encontro
 * 14 de 66 ordenes con un centimo de desviacion cuando alguien recalculo por su cuenta.
 *
 * ⛔ NI UN `number` MONETARIO (R17 / design §D9). Todo importe cruza como CADENA de escala 2 y se
 * opera con `Prisma.Decimal`. En particular, el `montoCobrar` que el canal PUBLICA es un `number`
 * (`Decimal.toNumber()`, feature 106) y **no se usa como entrada del calculo**: el llamador tiene
 * que traer su propia cadena.
 *
 * ⛔ NINGUN SEXTO CAMPO (R11). No hay `total` ni equivalente con otro nombre: ver la cabecera de
 * `ApiOrdenCostoDTO`.
 *
 * ⚠️ DOS ENVOLTORIOS EXPLICITOS, NO UN PARAMETRO DE MODO. `costoEstimadoDe` y `costoRealDe` hacen
 * lo mismo con las mismas entradas y difieren SOLO en que responden al hueco de tarifa
 * («no hay tarifa que resuelva») de forma OPUESTA. Un booleano `esReal` escondería esa diferencia
 * justo donde hay que verla, y la diferencia es de dinero. Ver los dos bloques de abajo.
 */

/**
 * Las entradas de la orden que alimentan los cinco conceptos. La tarifa va aparte, porque es lo
 * unico que cambia entre el estimado (la VIGENTE) y el real (la CONGELADA).
 *
 * `montoCobrar` es `string | null` a proposito (R17): `null` es «sin COD» y entra como cero, pero
 * un `number` no entra nunca.
 */
export interface EntradasCostoOrden {
  /** `zona.es_central`: elige la COLUMNA de flete (variante GAM vs estandar). */
  esCentral: boolean;
  /** `distrito.zona_especial IS TRUE`: elige el pacto especial del distrito si lo hay. */
  esZonaEspecial: boolean;
  /** COD a recaudar, como CADENA de escala 2. `null` -> cero (money-safe). */
  montoCobrar: string | null;
  /** `orden.cobra_comision`: con `false`, comision e IVA de comision salen `"0.00"` (R13). */
  cobraComision: boolean;
}

/** `Decimal` -> cadena money-safe; un concepto AUSENTE del derivado es un cero AFIRMADO (R13). */
function serializar(monto: Prisma.Decimal | undefined): string {
  return serializarMontoCotizacion(monto ?? new Prisma.Decimal(0));
}

/**
 * Los cinco conceptos, con la tarifa que sea. Un concepto que `derivarIngresoOrden` deja AUSENTE
 * —el caso real es `cobraComision: false`, que no emite comision ni su IVA— sale como `"0.00"`
 * explicito y NUNCA se omite ni se emite `null` (R13): la ausencia se declara en el campo que
 * contiene el objeto, no dentro de el.
 */
function conceptos(
  tarifa: TarifaVigente | null,
  fulfillment: string,
  entradas: EntradasCostoOrden,
): ApiOrdenCostoDTO {
  // R15: `resultado: "entregada"` FIJO. Los dos campos publicados responden «cuanto cuesta este
  // paquete SI SE ENTREGA»; el escenario del rechazo (flete de devolucion + su IVA) es otro y lo
  // sirve la cotizacion.
  const derivado = derivarIngresoOrden({ resultado: "entregada", ...entradas }, tarifa);
  return {
    flete: serializar(derivado.ingreso_flete),
    iva: serializar(derivado.ingreso_iva_flete),
    comision: serializar(derivado.ingreso_comision_cod),
    ivaComision: serializar(derivado.ingreso_iva_comision_cod),
    // El fulfillment NO sale de `derivarIngresoOrden`: esta fuera de la formula de liquidacion
    // desde el 2026-08-19 (ver `montoFulfillmentDeTarifa`). Viene ya como cadena de escala 2 del
    // llamador —de `tarifas.fulfillment` para el estimado, de `cierre_detail.tarifa_fulfillment`
    // para el real— y aqui solo se re-serializa para que pase por el MISMO validador que los
    // otros cuatro.
    fulfillment: serializarMontoCotizacion(new Prisma.Decimal(fulfillment)),
  };
}

/**
 * `costoEstimado` (R19/R22 / design §D7) — los cinco conceptos con la tarifa VIGENTE.
 *
 * **SIN TARIFA -> `null`, y JAMAS cinco `"0.00"`.** No es una preferencia de estilo: es la
 * decision que el humano firmo el 2026-08-24 para este mismo canal, y su frase esta escrita en la
 * cabecera de `tests/integration/asimetria-sin-tarifa.test.ts` (274/R39):
 *
 *   > *Los dos bordes de API los consume un INTEGRADOR que si controla su configuracion y que
 *   > toma decisiones de dinero con la respuesta. Ahi un `"0.00"` no es un dato faltante: es una
 *   > MENTIRA sobre dinero servida como precio.*
 *
 * Las otras cuatro superficies responden distinto al MISMO hueco a proposito (listado interno
 * `"0.00"`, cierre de dia columnas NULL, carga por key 409, cotizacion por key 409). Esta es la
 * QUINTA, y necesita respuesta propia porque **no puede devolver 409**: la orden existe y hay que
 * listarla. La respuesta es el hueco DECLARADO, sin mentir sobre el precio.
 */
export function costoEstimadoDe(
  tarifa: TarifaVigente | null,
  fulfillment: string,
  entradas: EntradasCostoOrden,
): ApiOrdenCostoDTO | null {
  if (tarifa === null) return null;
  return conceptos(tarifa, fulfillment, entradas);
}

/**
 * `costoReal` (R25/R28 / design §D8) — los cinco conceptos con la tarifa CONGELADA en
 * `cierre_detail`.
 *
 * **SIN TARIFA CONGELADA -> cinco `"0.00"`, y NO `null`.** Es la asimetria deliberada con
 * `costoEstimadoDe`, y va escrita junto a ella porque separadas parecen una inconsistencia:
 *
 *   · `cierre_detail.tarifa_id IS NULL` significa «la tienda no tenia tarifa vigente al
 *     SOLICITAR» (gap 69/R9, decision (c)), y ese cierre **liquido cero** por esos conceptos. El
 *     cero es VERDAD; un `null` diria «no se sabe», que seria falso: si se sabe.
 *   · En el estimado, en cambio, un cero MENTIRIA: prometeria envio gratis sobre algo que todavia
 *     no se ha cobrado y que si se cobrara en cuanto haya tarifa.
 *
 * Mismo hueco de datos, dos significados, dos respuestas. La regla que las une es una sola: decir
 * la verdad sobre dinero. (El `fulfillment` acompaña: `tarifa_id IS NULL` implica
 * `tarifa_fulfillment IS NULL` por construccion —`CierreDiaRepository.tarifaColumnas` las escribe
 * todas o ninguna—, y el llamador traduce esa columna nula a `"0.00"`, R29.)
 *
 * La AUSENCIA de fila congelada —la orden que todavia no entro en ningun cierre aprobado— no se
 * decide aqui: es `costoReal: null` y lo resuelve el llamador, que es quien sabe si hubo fila.
 */
export function costoRealDe(
  tarifa: TarifaVigente | null,
  fulfillment: string,
  entradas: EntradasCostoOrden,
): ApiOrdenCostoDTO {
  return conceptos(tarifa, fulfillment, entradas);
}
