import { Prisma } from "@prisma/client";
import type { GestionResultado } from "@prisma/client";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import type {
  IngresoOrdenexDTO,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { WalletIngresoConcepto } from "@/lib/types/wallet";
import type { OrigenFlete } from "@/lib/types/tarifa";
// Ficha 396 — `partesPorTienda` particiona el recaudo con LA MISMA funcion que produce el total
// general del cierre, no con una suma escrita aqui (R13/R15). Import de VALOR, y verificado que
// no crea ciclo: `cierre-totales.ts` importa `pago-mensajero`, `ingreso-bodega` y tipos, y
// ninguno de los tres importa este archivo.
import { computeTotales, type GestionConPagos } from "@/lib/utils/cierre-totales";

/**
 * Feature 42 (design §4, R8/R9/R26) — derivacion del INGRESO de Ordenex por gestion.
 * Funcion PURA, money-safe: toda la aritmetica con `Prisma.Decimal`, salida STRING escala 2.
 * Espejo estructural de `lib/utils/pago-mensajero.ts`/`ingreso-bodega.ts`. La gestion aporta
 * su `resultado`; la orden aporta `esCentral` (zona), `montoCobrar` (COD) y `cobraComision`.
 *
 * Reglas F1.4 aprobadas:
 * - `entregada` -> flete (valorFleteGam si esCentral, si no valorFlete) + IVA del flete; y
 *   SOLO si `cobraComision === true`: comision COD (% de montoCobrar) + su IVA. Si
 *   `cobraComision === false`, comision y su IVA quedan AUSENTES (no "0.00" forzado).
 * - `rechazada` -> flete de DEVOLUCION (valorFleteDevueltoGam si esCentral, si no
 *   valorFleteDevuelto) + su IVA (mismo % ivaFlete). SIN comision COD (no hubo recaudo).
 * - `devuelta` -> NO APORTA A NINGUN CONCEPTO (ver el bloque de abajo).
 * - `reprogramada` (u otro en transito) -> no aporta a ningun concepto.
 * - `tarifa === null` (tienda sin tarifa vigente) -> todos los conceptos 0.00, sin lanzar (R9).
 *
 * ⚠️ REGLA DE NEGOCIO CAMBIADA EL 2026-08-28 (ficha 301) — UNA `devuelta` NO GENERA NADA.
 * Hasta esa fecha `devuelta` cobraba el flete de devolucion + IVA exactamente igual que
 * `rechazada`, y NO era un bug: era el diseño original de la F1.4 y el enum del ledger lo
 * documentaba asi. El humano cambio la REGLA, no la implementacion. El motivo es el que ya
 * dice la maquina de estados: una `devuelta` es un INTENTO FALLIDO que sigue vivo —se puede
 * liberar por el cron de SLA (99), reprogramar la tienda (100) o recuperar a bodega (100)— y
 * el paquete no ha vuelto a la tienda; la que SI devuelve el paquete es `rechazada`
 * (`devolucion_rechazada` de la 139: al aprobar el cierre pasa a `por_devolver` /
 * `por_devolver_a_tienda`). Se cobra el retorno cuando el retorno ocurre, no antes.
 *
 * LA CATEGORIA `ingreso_flete_devolucion` SE QUEDA: la sigue emitiendo `rechazada`, con el
 * MISMO monto y el MISMO IVA que antes de hoy. Lo unico que se fue es la `devuelta`.
 *
 * MEDIDO ANTES DE TOCAR NADA (ficha 301): `wallet_movimiento` y `wallet_tienda_movimiento`
 * estaban a CERO y no habia ninguna `devuelta` dentro de un cierre APROBADO, asi que este
 * cambio no deja historico que corregir ni necesita backfill.
 *
 * TARIFA ESPECIAL POR DISTRITO (2026-08-25). La feature 274 declaro en su R40 que
 * `tarifas.tarifa_especial` y `distrito.zona_especial` existian y NO cobraban, y dejo un test
 * guardian para que nadie las conectara de pasada: conectarlas cambia lo que se factura y era
 * una decision de producto. Esa decision ya se tomo, y esta es su implementacion. Ahora el
 * distrito de la orden aporta `esZonaEspecial` y elige el ORIGEN del flete:
 *
 *   esZonaEspecial && tarifa.tarifaEspecial !== null          -> flete = tarifaEspecial
 *   esZonaEspecial && tarifa.tarifaEspecial === null          -> flete NORMAL, origen marcado
 *   !esZonaEspecial                                           -> flete NORMAL
 *
 * y lo mismo, por separado, para la devolucion con `tarifaEspecialDevuelta`. Lo especial es el
 * FLETE: el IVA se aplica igual (`ivaFlete`) sobre el monto pactado, y la comision COD y su IVA
 * no cambian.
 */

// Datos de la orden/gestion necesarios para derivar el ingreso (sin acoplar a Prisma models).
export interface OrdenIngresoInput {
  resultado: GestionResultado;
  esCentral: boolean;
  // `distrito.zona_especial IS TRUE` del distrito de la orden. DOS valores, no tres: la
  // columna de origen es nullable (`null` = nadie lo decidio) y esa duda se resuelve ANTES de
  // llegar aca, en el borde que lee la fila. Una orden sin distrito (el unico FK nullable de
  // `orden`) entra como `false`: sin distrito no hay marca que aplicar.
  esZonaEspecial: boolean;
  montoCobrar: string | null; // COD a recaudar; null -> 0 (money-safe)
  cobraComision: boolean;
}

// Conceptos derivados de UNA gestion. Los ausentes (undefined) NO aportan al agregado (a
// diferencia de un 0.00 explicito, que es un valor real que participa en la suma).
export interface IngresoOrdenDerivado {
  ingreso_flete?: Prisma.Decimal;
  ingreso_flete_devolucion?: Prisma.Decimal;
  ingreso_comision_cod?: Prisma.Decimal;
  ingreso_iva_flete?: Prisma.Decimal;
  ingreso_iva_flete_devolucion?: Prisma.Decimal;
  ingreso_iva_comision_cod?: Prisma.Decimal;
}

function round2(d: Prisma.Decimal): Prisma.Decimal {
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

// porcentaje: valor 0..100 -> factor / 100. Money-safe con Prisma.Decimal.
function aplicarPorcentaje(base: Prisma.Decimal, porcentaje: Prisma.Decimal): Prisma.Decimal {
  return round2(base.mul(porcentaje).div(100));
}

/**
 * `OrigenFlete` es informacion de AUDITORIA, no un monto: se re-exporta desde `lib/types/tarifa`
 * (que no importa Prisma) y vive fuera de `IngresoOrdenDerivado` a proposito, porque los
 * llamadores de esa interfaz recorren sus valores como Decimales (`Object.values(derivado)`)
 * para sumarlos.
 */
export type { OrigenFlete } from "@/lib/types/tarifa";

/** Los dos fletes de una orden con su origen. Salida de `resolverFlete`. */
export interface FleteResuelto {
  flete: Prisma.Decimal; // entrega
  origen: OrigenFlete;
  fleteDevuelto: Prisma.Decimal; // devolucion
  origenDevuelto: OrigenFlete;
}

/**
 * UNICO lugar donde se decide QUE MONTO es el flete de una orden. Existe separado de
 * `derivarIngresoOrden` para que la eleccion se pueda leer (y mostrar) sin recalcular dinero:
 * el listado necesita el `origen` para senalar el hueco de configuracion, y no puede
 * deducirlo de un importe.
 *
 * El monto pactado IGNORA `esCentral` a proposito: `tarifa_especial` es UN precio acordado
 * para ese distrito, no una tabla con variante GAM. `esCentral` solo sigue eligiendo columna
 * en el camino normal —que es tambien el fallback de `especial_sin_pacto`—.
 *
 * Entrega y devolucion se resuelven POR SEPARADO: se puede pactar una y dejar la otra en la
 * tarifa normal, porque las dos columnas del pacto son independientes.
 */
export function resolverFlete(
  tarifa: TarifaVigente,
  input: { esCentral: boolean; esZonaEspecial: boolean },
): FleteResuelto {
  const elegir = (normal: string, pactado: string | null): [Prisma.Decimal, OrigenFlete] => {
    if (!input.esZonaEspecial) return [new Prisma.Decimal(normal), "normal"];
    if (pactado === null) return [new Prisma.Decimal(normal), "especial_sin_pacto"];
    return [new Prisma.Decimal(pactado), "especial"];
  };
  const [flete, origen] = elegir(
    input.esCentral ? tarifa.valorFleteGam : tarifa.valorFlete,
    tarifa.tarifaEspecial,
  );
  const [fleteDevuelto, origenDevuelto] = elegir(
    input.esCentral ? tarifa.valorFleteDevueltoGam : tarifa.valorFleteDevuelto,
    tarifa.tarifaEspecialDevuelta,
  );
  return { flete, origen, fleteDevuelto, origenDevuelto };
}

/**
 * Deriva los conceptos de ingreso de UNA gestion segun su `resultado` y la tarifa vigente
 * de la tienda de la orden. `tarifa === null` -> objeto vacio (todos 0.00 en el agregado, R9).
 */
export function derivarIngresoOrden(
  input: OrdenIngresoInput,
  tarifa: TarifaVigente | null,
): IngresoOrdenDerivado {
  if (tarifa === null) return {}; // R9: gap seguro, no bloquea; ningun concepto aporta.

  const ivaFletePct = new Prisma.Decimal(tarifa.ivaFlete);

  if (input.resultado === "entregada") {
    const { flete } = resolverFlete(tarifa, input);
    const ivaFlete = aplicarPorcentaje(flete, ivaFletePct);
    const out: IngresoOrdenDerivado = {
      ingreso_flete: round2(flete),
      ingreso_iva_flete: ivaFlete,
    };
    // R8/R26: comision COD y su IVA SOLO si la orden cobra comision.
    if (input.cobraComision) {
      const montoCobrar = new Prisma.Decimal(input.montoCobrar ?? "0");
      const comision = aplicarPorcentaje(montoCobrar, new Prisma.Decimal(tarifa.comisionCod));
      out.ingreso_comision_cod = comision;
      out.ingreso_iva_comision_cod = aplicarPorcentaje(
        comision,
        new Prisma.Decimal(tarifa.ivaComisionCod),
      );
    }
    return out;
  }

  // Ficha 301 (2026-08-28): SOLO `rechazada`. La `devuelta` estuvo aqui hasta esa fecha y se
  // fue por decision de negocio, no por un fallo: el retorno se cobra cuando el paquete vuelve
  // de verdad a la tienda, y eso es `rechazada`. Volver a meter `devuelta` en esta condicion
  // re-abre 24.408,00 de cobro sobre los dos cierres que estaban solicitados ese dia.
  if (input.resultado === "rechazada") {
    const fleteDev = resolverFlete(tarifa, input).fleteDevuelto;
    return {
      ingreso_flete_devolucion: round2(fleteDev),
      ingreso_iva_flete_devolucion: aplicarPorcentaje(fleteDev, ivaFletePct),
    };
  }

  // `devuelta` (301), `reprogramada` (u otro en transito): no aportan a ningun concepto.
  return {};
}

/**
 * Feature 98 (design §3.2, R2/R7/R8/D1/D2) — costo del envio que la tienda paga por UNA orden
 * creada por la via API: FLETE + IVA del flete. Funcion PURA money-safe: toda la aritmetica
 * con `Prisma.Decimal`, salida STRING escala 2 (`ROUND_HALF_UP`), nunca number/parseFloat.
 *
 * Reutiliza EXACTAMENTE la seleccion de monto de `derivarIngresoOrden` —la misma
 * `resolverFlete`: pacto especial del distrito si lo hay, si no la columna GAM/estandar segun
 * `esCentral`— y el mismo `aplicarPorcentaje(flete, ivaFlete)` para el IVA, para que "cuanto
 * paga la tienda por una orden" se lea IGUAL en el cierre (feature 42/69) y en la API. Si un
 * dia divergieran, la misma plata se leeria distinta.
 *
 * `tarifa === null` (tienda sin tarifa vigente) -> "0.00" (gap D1/R8): la orden se crea igual,
 * nunca `null`, nunca `error` por ausencia de tarifa.
 */
export function costoEnvioDeTarifa(
  tarifa: TarifaVigente | null,
  esCentral: boolean,
  esZonaEspecial: boolean,
): string {
  if (tarifa === null) return "0.00"; // R8/D1: gap seguro, no bloquea la carga.
  const { flete } = resolverFlete(tarifa, { esCentral, esZonaEspecial });
  const ivaFlete = aplicarPorcentaje(flete, new Prisma.Decimal(tarifa.ivaFlete));
  return round2(flete.plus(ivaFlete)).toFixed(2); // D2: flete + IVA del flete.
}

/**
 * Feature 204 — los DOS importes derivados que el LISTADO de `/ordenes` muestra por fila:
 * "Flete + IVA" y "Comision + IVA". Salida STRING escala 2, money-safe.
 *
 * Existe porque hasta la 204 esas dos cifras se calculaban EN EL NAVEGADOR, sobre los
 * `number` de la tarifa, y NO daban lo mismo que el cierre. Medido contra las 66 ordenes
 * con tarifa activa de la base: 14 de ellas mostraban un centimo de mas o de menos.
 * Ejemplos reales (tarifa comisionCod 3.50%, ivaComisionCod 13.00%):
 *
 *   monto 14900.00 -> comision exacta 521.5; IVA exacto 67.795 -> HALF_UP -> 67.80 -> 589.30.
 *                     El navegador hacia 521.5 * 1.13, que en binario es
 *                     589.29499999999995907 (el medio exacto 589.295 no es representable) y
 *                     `toFixed(2)` bajaba a 589.29. UN CENTIMO DE MENOS.
 *   monto 16618.40 -> comision 581.644, que ESTA funcion redondea a 581.64 ANTES del IVA
 *                     (581.64 * 13% = 75.6132 -> 75.61) -> 657.25. El navegador aplicaba el
 *                     IVA a la comision SIN redondear (581.644 * 1.13 = 657.25772) y subia a
 *                     657.26. UN CENTIMO DE MAS. Y ese ni siquiera es un problema de binario:
 *                     es OTRA formula (un redondeo intermedio que el navegador no hacia).
 *
 * Por eso NO reimplementa nada: llama a `derivarIngresoOrden` con `resultado: "entregada"`,
 * que es lo que se le facturara a la tienda si la orden se entrega. Si un dia cambia la
 * formula del cierre, el listado cambia con ella; no pueden divergir por construccion.
 *
 * Los dos campos son SIEMPRE un STRING ("0.00" incluido), nunca `null`: la degradacion sin
 * tarifa vigente es cero, no "desconocido" (R9), que es lo que la columna ya mostraba.
 */
export interface CostosListadoOrden {
  fleteConIva: string; // flete (pacto especial, o GAM/estandar segun zona) + su IVA; "0.00" sin tarifa
  comisionConIva: string; // comision COD + su IVA; "0.00" sin tarifa o si no cobra comision
  // De donde salio ese flete. El listado lo usa para SENALAR `especial_sin_pacto`: mismo
  // importe que una orden normal, pero por un hueco de configuracion, no por decision. Sin
  // tarifa vigente es `normal`: no hay pacto que faltar cuando no hay tarifa ninguna.
  fleteOrigen: OrigenFlete;
}

/** Datos de la ORDEN que entran en las dos cifras (la tarifa va aparte). */
export interface CostosListadoOrdenInput {
  esCentral: boolean; // zona de la orden: elige la COLUMNA de flete (GAM vs estandar)
  esZonaEspecial: boolean; // distrito de la orden: elige el pacto especial si existe
  montoCobrar: string | null; // COD a recaudar; null -> 0 (money-safe)
  cobraComision: boolean;
}

export function costosListadoOrden(
  tarifa: TarifaVigente | null,
  orden: CostosListadoOrdenInput,
): CostosListadoOrden {
  const derivado = derivarIngresoOrden({ resultado: "entregada", ...orden }, tarifa);
  // Un concepto ausente no aporta; los dos ausentes dan "0.00" (no `null`): esta columna
  // nunca dice "no aplica", dice cero.
  const conIva = (base?: Prisma.Decimal, iva?: Prisma.Decimal): string =>
    (base ?? new Prisma.Decimal(0)).plus(iva ?? 0).toFixed(2);
  return {
    fleteConIva: conIva(derivado.ingreso_flete, derivado.ingreso_iva_flete),
    comisionConIva: conIva(derivado.ingreso_comision_cod, derivado.ingreso_iva_comision_cod),
    fleteOrigen: tarifa === null ? "normal" : resolverFlete(tarifa, orden).origen,
  };
}

/**
 * Suma el desglose por orden de un cierre en 1 total por concepto, para la vista de
 * auditoria del admin. NO es `agregarIngresosPorConcepto`: aquel emite movimientos de wallet
 * y OMITE los conceptos en 0.00 (R10); este emite SIEMPRE los 8 campos, porque una tabla de
 * auditoria con un concepto ausente y uno en cero no dicen lo mismo.
 *
 * Money-safe: suma con Prisma.Decimal sobre los STRING ya derivados, salida STRING escala 2.
 * Las gestiones sin desglose (vista en vivo, o cierre pre-snapshot) no aportan.
 */
export function totalesIngresoOrdenex(
  gestiones: Array<{ ingresoOrdenex?: IngresoOrdenexDTO | null }>,
): TotalesIngresoOrdenex {
  const acc = {
    montoCobrar: new Prisma.Decimal(0),
    fleteConIva: new Prisma.Decimal(0),
    fleteDevolucionConIva: new Prisma.Decimal(0),
    comisionConIva: new Prisma.Decimal(0),
    total: new Prisma.Decimal(0),
    flete: new Prisma.Decimal(0),
    ivaFlete: new Prisma.Decimal(0),
    fleteDevolucion: new Prisma.Decimal(0),
    ivaFleteDevolucion: new Prisma.Decimal(0),
    comisionCod: new Prisma.Decimal(0),
    ivaComisionCod: new Prisma.Decimal(0),
  };
  for (const g of gestiones) {
    const i = g.ingresoOrdenex;
    if (!i) continue;
    for (const k of Object.keys(acc) as Array<keyof typeof acc>) {
      const v = i[k];
      // `null` = el concepto no aplica a ese resultado; no aporta (no es un 0.00 real).
      if (v !== null && v !== undefined) acc[k] = acc[k].plus(v);
    }
  }
  return {
    montoCobrar: acc.montoCobrar.toFixed(2),
    fleteConIva: acc.fleteConIva.toFixed(2),
    fleteDevolucionConIva: acc.fleteDevolucionConIva.toFixed(2),
    comisionConIva: acc.comisionConIva.toFixed(2),
    total: acc.total.toFixed(2),
    flete: acc.flete.toFixed(2),
    ivaFlete: acc.ivaFlete.toFixed(2),
    fleteDevolucion: acc.fleteDevolucion.toFixed(2),
    ivaFleteDevolucion: acc.ivaFleteDevolucion.toFixed(2),
    comisionCod: acc.comisionCod.toFixed(2),
    ivaComisionCod: acc.ivaComisionCod.toFixed(2),
  };
}

/**
 * Ganancia de Ordenex: el ingreso BRUTO facturado menos lo que se le debe al mensajero.
 * Incluye los conceptos de devolucion (un rechazo tambien factura flete), asi que siempre
 * cuadra con el `total` del desglose. Puede ser NEGATIVA: un cierre de puras
 * reprogramaciones no factura nada y aun asi paga.
 *
 * Vive aca, y no duplicada en cada service, porque los dos detalles de admin (cierre de
 * mensajero y cierre de bodega) muestran el MISMO numero: si un dia divergieran, la misma
 * plata se leeria distinta segun por que pantalla se entra.
 *
 * Money-safe: resta con Prisma.Decimal sobre STRING, salida STRING escala 2.
 */
export function gananciaOrdenex(ingresoTotal: string, pagoMensajero: string): string {
  return new Prisma.Decimal(ingresoTotal).minus(pagoMensajero).toFixed(2);
}

/**
 * Pago a la tienda: la plata RECIBIDA (total general del cierre) menos los dos conceptos que
 * Ordenex le factura sobre esa plata — flete + IVA y comision + IVA.
 *
 * NO descuenta el flete de devolucion + IVA (el de los RECHAZOS desde la ficha 301): un
 * rechazo no cobra COD, asi que no aporta al total general y no se le resta a lo recibido. Si
 * un dia hay que cobrarlo tambien, se cambia ACA y las dos pantallas de admin lo reflejan a
 * la vez.
 *
 * Puede ser NEGATIVO si lo facturado supera lo recibido (p.ej. un cierre de puros rechazos
 * con algo de efectivo suelto). Un cierre de puras DEVUELTAS ya no factura nada (301).
 *
 * Money-safe: resta con Prisma.Decimal sobre STRING, salida STRING escala 2.
 */
export function pagoTiendaOrdenex(
  totalGeneral: string,
  fleteConIva: string,
  comisionConIva: string,
): string {
  return new Prisma.Decimal(totalGeneral).minus(fleteConIva).minus(comisionConIva).toFixed(2);
}

/**
 * Feature 395 — LO QUE LA TIENDA GANA EN TOTAL con un cierre: lo recaudado menos TODO lo que
 * Ordenex le factura (`totalesIngresoOrdenex().total`), incluido el flete por rechazo + IVA.
 *
 * **NO ES `pagoTiendaOrdenex`, y confundirlas es exactamente el fallo que esta ficha arregla.**
 * Son dos preguntas distintas sobre el mismo cierre:
 *
 *   `pagoTiendaOrdenex`  = lo que se le paga DE ESTE DINERO. No resta el flete por rechazo
 *                          porque ese flete nunca entro en lo recaudado (un rechazo no cobra
 *                          COD): se le cobra APARTE, contra su wallet.
 *   `ganaLaTienda`       = lo que le queda DESPUES de que tambien le cobren aquello. Es el
 *                          resultado, no el desembolso de hoy.
 *
 * Con las cifras reales de produccion del 2026-09-08 la diferencia son ₡10.848,00:
 * se le pagan 225.176,33 y gana 214.328,33, sobre 285.275,00 recaudados.
 *
 * EXISTE POR LA IDENTIDAD QUE HACE EVIDENTE LA PANTALLA, y que hasta hoy no se podia leer en
 * ningun sitio —el humano la estaba calculando a mano cada vez que miraba el cierre—:
 *
 *   lo que gana la tienda  +  lo que factura Ordenex  =  lo recaudado
 *        214.328,33        +        70.946,67         =    285.275,00
 *
 * Se deriva aca, y no restando dos celdas en el navegador, por el mismo motivo que sus
 * hermanas: si divergieran, la misma plata se leeria distinta segun por que pantalla se entra.
 *
 * Puede ser NEGATIVO —un cierre de puros rechazos factura y no recauda— y se devuelve CON SU
 * SIGNO, nunca recortado a "0.00": un cero diria «no gana ni pierde», que es falso.
 *
 * Money-safe: resta con Prisma.Decimal sobre STRING, salida STRING escala 2.
 */
export function ganaLaTienda(totalGeneral: string, ingresoTotal: string): string {
  return new Prisma.Decimal(totalGeneral).minus(ingresoTotal).toFixed(2);
}

/* -------------------------------------------------------------------------- */
/* Ficha 396 — DE QUIEN ES CADA PARTE DEL «PAGO A TIENDA»                      */
/* -------------------------------------------------------------------------- */

/**
 * 💰 Ficha 396 — UNA TIENDA de un cierre, con SUS TRES cifras. Todas STRING escala 2.
 *
 * CINCO CLAVES Y NI UNA MAS (R5). `fleteConIva` y `comisionConIva` por tienda se calculan
 * DENTRO de `partesPorTienda` —hacen falta para derivar `pagoTienda`— y NO se emiten: un
 * contrato que ofrece lo que la pantalla no debe ensenar acaba ensenandose, porque bastaria con
 * que alguien las pintara «ya que estan».
 */
export interface ParteDeTienda {
  /** La CLAVE del grupo: `cierre_detail.tienda_id`, congelado (R7). Nunca el nombre. */
  tiendaId: string;
  /** El nombre congelado, SOLO para mostrarlo. No agrupa nada (R7). */
  tiendaNombre: string;
  /**
   * Lo RECAUDADO atribuido a esta tienda. Sale de `computeTotales` sobre SUS gestiones, o sea
   * con EXACTAMENTE el mismo criterio que el `total general` del cierre entero (R13): solo las
   * `entregada`, y solo por sus lineas de pago. Puede ser "0.00" (una tienda que solo trajo
   * rechazos recauda cero y aun asi aparece, R9).
   */
  recaudado: string;
  /**
   * Lo que se le paga A ESTA TIENDA de este dinero. `pagoTiendaOrdenex` sobre SU subconjunto.
   * NO descuenta el flete por rechazo —ese se le cobra aparte, contra su wallet—. Puede ser
   * NEGATIVO y viaja con su signo.
   */
  pagoTienda: string;
  /**
   * Lo que ESTA TIENDA gana en total: lo recaudado menos TODO lo que Ordenex le factura,
   * incluido el flete por rechazo + IVA. `ganaLaTienda` sobre SU subconjunto.
   *
   * **NO ES `pagoTienda`**, y confundirlas es el fallo que la ficha 395 arreglo un nivel mas
   * arriba. La diferencia entre las dos es exactamente el flete por rechazo + IVA de esta
   * tienda —ver la CUARTA identidad en `partesPorTienda`—. Puede ser NEGATIVO (es lo normal en
   * la tienda que solo trajo rechazos) y viaja con su signo, nunca recortado a "0.00".
   */
  ganaLaTienda: string;
}

/**
 * Lo UNICO que `partesPorTienda` lee de una gestion. `GestionConPagos` se REUSA de
 * `cierre-totales.ts` en vez de re-declarar `{ resultado, pagos }` aqui: una segunda forma del
 * mismo criterio es justo lo que hace que dos sitios diverjan sin que nadie lo note.
 *
 * `CierreGestionPendienteRow` lo satisface estructuralmente, asi que los tres servicios pasan
 * sus gestiones tal cual, sin adaptador.
 */
export type GestionDeTienda = GestionConPagos & {
  tiendaId: string;
  tiendaNombre: string;
  ingresoOrdenex?: IngresoOrdenexDTO | null;
};

/**
 * 💰 FICHA 396 — DE QUIEN ES CADA PARTE. Parte las cifras de un cierre POR TIENDA.
 *
 * ─── EL PROBLEMA QUE RESUELVE ─────────────────────────────────────────────────────────────
 *
 * **El cierre es del MENSAJERO, no de la tienda.** Un mensajero reparte para quien le toque ese
 * dia, asi que un cierre puede llevar ordenes de varias tiendas — medido en produccion el
 * 2026-09-08: de 56 cierres, 39 tienen UNA y 17 tienen DOS. La pantalla ensenaba «Pago a
 * tienda» —singular— como un solo numero que era la suma de todas, sin decirlo en ninguna
 * parte, y quien lo miraba creia estar viendo lo de UNA tienda.
 *
 * **EL DINERO YA ESTABA BIEN.** `wallet_tienda_movimiento` lleva los movimientos SEPARADOS por
 * tienda desde siempre, cada uno con sus cifras. Esto es presentacion: aqui no se emite,
 * corrige ni mueve ni una fila del ledger.
 *
 * ─── NI UNA FORMULA DE DINERO NUEVA (R15) ─────────────────────────────────────────────────
 *
 * Aqui NO se calcula dinero: se PARTICIONA por `tiendaId` y se llaman, sobre CADA subconjunto,
 * las cuatro funciones que ya producen esas mismas cifras para el conjunto entero:
 *
 *   `recaudado`     -> `computeTotales(subconjunto).general`      (`lib/utils/cierre-totales.ts`)
 *   (interno)       -> `totalesIngresoOrdenex(subconjunto)`       (arriba, en este archivo)
 *   `pagoTienda`    -> `pagoTiendaOrdenex(recaudado, fleteConIva, comisionConIva)`
 *   `ganaLaTienda`  -> `ganaLaTienda(recaudado, total)`
 *
 * Es EXACTAMENTE lo que `lib/utils/dinero-por-producto.ts:200-273` (`repartoDeOrden`, ficha 347)
 * ya hace para partir el MISMO importe por OTRA dimension —el producto—, reusando
 * `pagoTiendaOrdenex` sobre subconjuntos. No es un patron nuevo: es el que el repo ya eligio
 * una vez, con su invariante escrita en la cabecera.
 *
 * ─── POR QUE VIVE AQUI ────────────────────────────────────────────────────────────────────
 *
 * Porque aqui viven las identidades que esta funcion particiona (`pagoTiendaOrdenex`,
 * `ganaLaTienda`), y una identidad tiene UN sitio. Verificado que el import de
 * `cierre-totales.ts` NO crea ciclo: ese modulo importa `pago-mensajero`, `ingreso-bodega` y
 * tipos, y ninguno importa este archivo.
 *
 * ─── UNA SOLA FUNCION PARA LAS TRES SUPERFICIES (R22) ─────────────────────────────────────
 *
 * La llaman los TRES, y desde la tanda D los tres de verdad: el detalle del cierre del MENSAJERO
 * (`CierresAdminService.verCierreDetalle`) y los DOS niveles del detalle del cierre de BODEGA
 * (`CierresBodegaAdminService.verCierreBodegaDetalle`) —el de cada mensajero, con `cd.gestiones`,
 * y el agregado de toda la bodega, con el `flatMap` de todas—. Que sea la misma funcion es lo que
 * hace cierto que la misma plata no se lea distinta segun por que pantalla se entre, sin depender
 * de que nadie se acuerde.
 *
 * ⚠️ **Cada superficie tiene que pasarle SU conjunto**, y en eso no ayuda el compilador: el nivel
 * del mensajero recibe las gestiones DE ESE MENSAJERO, no las de la bodega. De ahi sale, sin un
 * `if` que lo diga, que el umbral de presentacion de ese nivel se evalue sobre SUS tiendas. Que
 * los tres la llamen —y con el argumento correcto— lo fija
 * `tests/unit/services/cierre-desglose-tres-superficies.test.ts`: un `import` que nadie invoca no
 * rompe ni el typecheck ni ninguna guardia, solo deja la lista vacia.
 *
 * ─── LAS CUATRO IDENTIDADES ───────────────────────────────────────────────────────────────
 *
 * Las tres primeras atan las partes con su agregado, para el MISMO conjunto de gestiones:
 *
 *   R10 ·  Σ parte.pagoTienda    ===  pagoTiendaOrdenex(general, fleteConIva, comisionConIva)
 *   R11 ·  Σ parte.ganaLaTienda  ===  ganaLaTienda(general, totalesIngresoOrdenex(todas).total)
 *   R12 ·  Σ parte.recaudado     ===  computeTotales(todas).general
 *
 * Son ciertas por construccion porque la particion por `tiendaId` es exhaustiva y disjunta (cada
 * gestion cae en una y solo una tienda), porque `computeTotales` y `totalesIngresoOrdenex` son
 * sumas puras sobre gestiones, y porque las tres derivaciones son restas lineales:
 * `Σ(gᵢ − fᵢ − cᵢ) = Σgᵢ − Σfᵢ − Σcᵢ`. Sin deriva de redondeo: todos los sumandos ya vienen a
 * escala 2 y sumar decimales de escala 2 da escala 2.
 *
 * Y hay una CUARTA, esta POR TIENDA, que ata entre si las dos cifras de pago:
 *
 *   parte.pagoTienda − parte.ganaLaTienda  ===  flete por rechazo + IVA DE ESA TIENDA
 *
 * Sale de restar las dos definiciones: `(g − f − c) − (g − total) = total − f − c`, que es
 * precisamente `fleteDevolucionConIva`. **Es la que hace imposible derivar una de las dos con el
 * subconjunto equivocado sin que se note:** si la particion de una no coincidiera con la de la
 * otra, esta resta dejaria de dar.
 *
 * ⚠️ «Por construccion» es un RAZONAMIENTO, y en este repo ya se midio que un razonamiento sobre
 * el codigo puede ser desmentido por Postgres. Las cuatro llevan test propio.
 *
 * ⚠️ EL PUNTO FRAGIL es que `computeTotales` siga siendo una suma pura sobre gestiones. El dia
 * que le entrara un tope o un `min()` a nivel de cierre, R12 dejaria de ser cierta EN SILENCIO.
 * El test de identidad es lo que lo caza.
 *
 * ─── LA TERCERA CIFRA ENTRO POR FIRMA, NO DE PASO ─────────────────────────────────────────
 *
 * La revision 2 del spec PROHIBIA una tercera cifra por tienda. `ganaLaTienda` entro el
 * **2026-09-08 por firma explicita del humano** (Q7 de `specs/396-.../requirements.md`), con su
 * motivo escrito: desglosar una cifra y dejar la otra agregada es exactamente el fallo que se
 * esta arreglando, un nivel mas abajo. La guardia no se relajo, se movio: hoy prohibe la CUARTA
 * con la misma fuerza. **Una cuarta cifra necesita otra firma, no un `git push`.**
 *
 * ─── EL ORDEN (R8, Q6) ────────────────────────────────────────────────────────────────────
 *
 * Por `pagoTienda` DESCENDENTE —de las tres, la del rotulo que da nombre a la ficha—, con el
 * desempate declarado abajo. Lo fija el SERVIDOR: la pantalla pinta en el orden que recibe.
 *
 * ─── MONEY-SAFE ───────────────────────────────────────────────────────────────────────────
 *
 * Funcion PURA: sin Prisma Client, sin repositorios, sin reloj, sin efectos al importarse.
 * Toda la aritmetica y toda la COMPARACION con `Prisma.Decimal`; ni un `Number(`, `parseFloat(`
 * ni `.toFixed(` sobre algo que no sea un `Decimal`. Ordenar por el valor numerico de un STRING
 * monetario tampoco se hace con `Number()`: se hace con `comparedTo`.
 */
export function partesPorTienda(gestiones: ReadonlyArray<GestionDeTienda>): ParteDeTienda[] {
  // La particion. `Map` conserva el orden de primera aparicion, que es el que se usa para el
  // NOMBRE: dentro de un cierre el nombre esta congelado en el mismo instante para todas sus
  // filas, asi que todas dicen lo mismo. En el agregado de bodega —varios cierres de varios
  // dias— dos snapshots de la misma tienda podrian traer nombres distintos si hubo un cambio de
  // nombre entre medias; se muestra el primero que llega, que es determinista porque el orden
  // de las gestiones lo fija el `orderBy` del repositorio. Lo que NUNCA depende del nombre es el
  // AGRUPAMIENTO: ese va por `tiendaId` (R7).
  const porTienda = new Map<string, { nombre: string; gestiones: GestionDeTienda[] }>();
  for (const g of gestiones) {
    const grupo = porTienda.get(g.tiendaId);
    if (grupo === undefined) {
      porTienda.set(g.tiendaId, { nombre: g.tiendaNombre, gestiones: [g] });
    } else {
      grupo.gestiones.push(g);
    }
  }

  const partes: ParteDeTienda[] = [];
  for (const [tiendaId, grupo] of porTienda) {
    // LAS MISMAS FUNCIONES QUE EL AGREGADO, sobre el subconjunto de ESTA tienda (R15). Ni una
    // resta escrita a mano: si un dia cambia la definicion de «lo que se le paga», cambia arriba
    // y esto la sigue sola.
    const recaudado = computeTotales(grupo.gestiones).general;
    const ingreso = totalesIngresoOrdenex(grupo.gestiones);
    partes.push({
      tiendaId,
      tiendaNombre: grupo.nombre,
      recaudado,
      pagoTienda: pagoTiendaOrdenex(recaudado, ingreso.fleteConIva, ingreso.comisionConIva),
      // La CUARTA identidad se sostiene porque este `ingreso.total` es el DE ESTA TIENDA. Con el
      // total agregado aqui, `pagoTienda − ganaLaTienda` dejaria de dar su flete por rechazo.
      ganaLaTienda: ganaLaTienda(recaudado, ingreso.total),
    });
  }

  // R8/Q6 — por `pagoTienda` DESCENDENTE. La comparacion es `Prisma.Decimal.comparedTo` y no
  // `Number(a) - Number(b)`: es dinero, y pasarlo por coma flotante para ordenarlo es el mismo
  // defecto que la ficha 204 ya midio (14 de 66 ordenes con un centimo de diferencia).
  //
  // EL DESEMPATE, DECLARADO Y EN UN SOLO SITIO, para que la secuencia sea reproducible: a igual
  // importe manda `tiendaNombre` ASCENDENTE, y a igual nombre —dos tiendas homonimas, que es
  // justo el caso por el que se agrupa por id— manda `tiendaId` ascendente, que es unico y cierra
  // el orden total. Las dos comparaciones de texto van por UNIDADES DE CODIGO (`<`/`>`, como
  // `sort()` por defecto) y NO por `localeCompare`: determinismo antes que correccion
  // tipografica, la misma regla que `dinero-por-producto.ts` ya usa.
  return partes.sort((a, b) => {
    const porImporte = new Prisma.Decimal(b.pagoTienda).comparedTo(new Prisma.Decimal(a.pagoTienda));
    if (porImporte !== 0) return porImporte;
    if (a.tiendaNombre !== b.tiendaNombre) return a.tiendaNombre < b.tiendaNombre ? -1 : 1;
    if (a.tiendaId !== b.tiendaId) return a.tiendaId < b.tiendaId ? -1 : 1;
    return 0;
  });
}

/**
 * Feature 393 (R7/R10, design §3) — LA LINEA PUENTE de la cascada «de quien es el dinero»:
 * lo que Ordenex cobra SOBRE LO RECAUDADO, o sea el subconjunto DEDUCIBLE de lo facturado
 * (flete + IVA y comision COD + IVA, los dos de las entregadas).
 *
 * Existe porque `total` de `totalesIngresoOrdenex` NO es deducible entero: incluye el flete
 * por rechazo + IVA, que se le factura a la tienda pero NO sale de `total_general` —un rechazo
 * no cobra contra entrega, asi que ese dinero nunca entro—. Sin esta linea la pantalla
 * ensenaria «recaudado − facturado = para la tienda», que NO da en cuanto hay un rechazo.
 *
 * Se deriva aca, y no sumando dos celdas en el navegador, por R13: la tarjeta y el detalle
 * reciben cada linea ya derivada y solo la formatean.
 *
 * Money-safe: suma con Prisma.Decimal sobre STRING, salida STRING escala 2.
 */
export function cobradoSobreRecaudado(fleteConIva: string, comisionConIva: string): string {
  return new Prisma.Decimal(fleteConIva).plus(comisionConIva).toFixed(2);
}

/**
 * Feature 393 (R8, design §2.2) — NETO de Ordenex: lo FACTURADO menos lo que Ordenex paga,
 * que son DOS pagos y no uno: a los mensajeros y a la bodega satelite por los rechazos.
 *
 * **NO es `gananciaOrdenex`, y por eso no se implementa encadenandola.** `gananciaOrdenex`
 * resta solo el pago al mensajero; este resta ademas el ingreso de bodega por rechazos. Los
 * dos coinciden EXACTAMENTE cuando la bodega vale "0.00" —que es el caso del cierre que el
 * humano midio el 2026-09-08— y divergen en cuanto hay un rechazo. Que la identidad de R8
 * viva en un solo sitio auditable vale mas que ahorrar una resta.
 *
 * `gananciaOrdenex` NO se toca: la sigue leyendo el detalle del cierre de MENSAJERO (R30).
 *
 * Puede ser NEGATIVO (un cierre de puras reprogramaciones no factura nada y aun asi paga);
 * se devuelve con su signo, nunca recortado.
 *
 * Money-safe: resta con Prisma.Decimal sobre STRING, salida STRING escala 2.
 */
export function netoOrdenex(
  ingresoTotal: string,
  pagoMensajero: string,
  ganaBodegaSatelite: string,
): string {
  return new Prisma.Decimal(ingresoTotal)
    .minus(pagoMensajero)
    .minus(ganaBodegaSatelite)
    .toFixed(2);
}

/**
 * Feature 393 (R9/R36, H3 del humano del 2026-09-08) — LO QUE LA BODEGA SATELITE LE ENTREGA
 * A LA CENTRAL: lo recaudado menos los DOS descuentos que esa bodega registra —el pago a los
 * mensajeros y lo que ella misma gana por los rechazos—.
 *
 * No es «lo que queda en caja» (lo recaudado incluye SINPE y transferencia) ni «lo que queda
 * tras los pagos»: es el numero con el que la satelite cuadra con la central, y hasta esta
 * ficha no se veia en ninguna pantalla, ni en la de la central ni en la de la satelite.
 *
 * **PUEDE SER NEGATIVO, y no es un dato raro: sale de la estructura de la formula.**
 * `pagoPorResultado` (`lib/utils/pago-mensajero.ts:13-23`) paga un importe FIJO por cada
 * `entregada`, independiente de lo recaudado; una entrega prepagada (`monto_cobrar` nulo)
 * aporta CERO al total general y aun asi paga. Medido contra produccion el 2026-09-08: 1 de
 * 14 cierres de bodega ya tenia «Para la central» negativo. Se devuelve CON SU SIGNO —nunca
 * recortado a "0.00"—: un cero diria «no hay que entregar nada» y omitiria que la diferencia
 * la pone la central.
 *
 * Money-safe: resta con Prisma.Decimal sobre STRING, salida STRING escala 2.
 */
export function paraLaCentral(
  totalGeneral: string,
  pagoMensajero: string,
  ganaBodegaSatelite: string,
): string {
  return new Prisma.Decimal(totalGeneral)
    .minus(pagoMensajero)
    .minus(ganaBodegaSatelite)
    .toFixed(2);
}

/**
 * Feature 393 (R37, design §12.2) — ¿los dos descuentos caben en el EFECTIVO recaudado?
 *
 * Distinto de que «Para la central» sea positivo, y MAS FRECUENTE: los descuentos se pagan en
 * efectivo, pero parte de lo recaudado pudo entrar por SINPE o transferencia. Compara contra
 * `totales.efectivo`, NUNCA contra `general` — comparar contra el general responde otra
 * pregunta (la de `paraLaCentral`) y dejaria el aviso mudo justo en el caso que lo motiva.
 * Medido contra produccion el 2026-09-08: 2 de 14 cierres de bodega, el peor por −₡2.000.
 *
 * Devuelve un BOOLEANO y no un importe a proposito: lo que la pantalla necesita es un AVISO
 * (R37), no un cuarto numero que nadie pidio. Cuantificar «cuanto falta» es el reparto de
 * efectivo que vive en la consolidacion (`CierreBodegaService.repartirEfectivo`) y esta ficha
 * declara que no lo hace (Q7).
 *
 * Money-safe: comparacion con Prisma.Decimal sobre STRING; no emite ningun importe.
 */
export function efectivoCubreDescuentos(
  totalEfectivo: string,
  pagoMensajero: string,
  ganaBodegaSatelite: string,
): boolean {
  return new Prisma.Decimal(totalEfectivo).gte(
    new Prisma.Decimal(pagoMensajero).plus(ganaBodegaSatelite),
  );
}

// Un concepto de ingreso a insertar (categoria + monto STRING). El feed OMITE los que
// tengan total "0.00" (R10).
export interface ConceptoIngresoAgregado {
  categoria: WalletIngresoConcepto;
  monto: string; // STRING 2 dec (money-safe)
}

// Orden de emision de los conceptos (design §4).
const CONCEPTOS: WalletIngresoConcepto[] = [
  "ingreso_flete",
  "ingreso_flete_devolucion",
  "ingreso_comision_cod",
  "ingreso_iva_flete",
  "ingreso_iva_flete_devolucion",
  "ingreso_iva_comision_cod",
];

/**
 * Agrega los conceptos de TODAS las gestiones de un cierre en 1 total por concepto (R10),
 * resolviendo la tarifa de cada gestion por la TIENDA de su orden (feature 69/R20); la zona
 * solo elige la COLUMNA (`esCentral` -> variante GAM), sin cambio de formula (R21).
 * OMITE los conceptos cuyo total sea "0.00". Money-safe: suma con Prisma.Decimal, salida STRING.
 *
 * `gestiones` ya trae, por cada una, su input derivado y la tarifa vigente resuelta de su zona.
 */
export function agregarIngresosPorConcepto(
  gestiones: Array<{ input: OrdenIngresoInput; tarifa: TarifaVigente | null }>,
): ConceptoIngresoAgregado[] {
  const totales = new Map<WalletIngresoConcepto, Prisma.Decimal>();
  for (const c of CONCEPTOS) totales.set(c, new Prisma.Decimal(0));

  for (const g of gestiones) {
    const derivado = derivarIngresoOrden(g.input, g.tarifa);
    for (const c of CONCEPTOS) {
      const aporte = derivado[c];
      if (aporte !== undefined) {
        totales.set(c, totales.get(c)!.add(aporte));
      }
    }
  }

  const out: ConceptoIngresoAgregado[] = [];
  for (const c of CONCEPTOS) {
    const total = round2(totales.get(c)!);
    // R10: no se emite movimiento para un concepto con total 0.00.
    if (total.gt(0)) out.push({ categoria: c, monto: total.toFixed(2) });
  }
  return out;
}

/**
 * FULFILLMENT (2026-08-25) — el monto FIJO que la tienda paga por orden cuando el paquete
 * sale de NUESTRA bodega, y el predicado que dice si esa tienda hace fulfillment.
 *
 * POR QUE VIVE AQUI Y NO DENTRO DE `derivarIngresoOrden`. La columna `tarifas.fulfillment`
 * lleva desde el 2026-08-19 deliberadamente FUERA de la formula de liquidacion: se congela en
 * `cierre_detail.tarifa_fulfillment` para poder MOSTRARLA, pero no entra en las wallets ni en
 * el cierre. Esa frontera NO se mueve. Lo que estas dos funciones habilitan es otra cosa: el
 * canal por API key —cotizacion y carga— que le dice al integrador cuanto le va a costar el
 * envio ANTES de que exista una gestion. Si un dia el fulfillment tiene que liquidarse, la
 * decision se toma en `derivarIngresoOrden` y con su propia migracion de `cierre_detail`; no
 * se cuela por aqui.
 *
 * EL PREDICADO ES EL MONTO. "Esta tienda hace fulfillment" se responde con
 * `fulfillment > 0` de la tarifa que resuelve para el par (tienda, zona), y no con el flag
 * `Usuario.fulfillment`: ese flag solo puede quedar en `true` para el rol `adminTienda`
 * (`UsuarioService.resolverFulfillment`) y el dueño de una API key es un usuario de rol
 * `apiKey`, asi que por esa via la respuesta seria SIEMPRE `false`. La contrapartida hay que
 * decirla: poner el monto en `0.00` no es solo dejar de cobrar el servicio, es tambien mover
 * donde NACEN las ordenes de esa tienda (`BulkOrdenService.cargarViaApi`).
 */
export interface TarifaConFulfillment {
  fulfillment: string; // MONTO -> STRING 2 dec
}

/** El monto de fulfillment de la tarifa; CERO si no hay tarifa (mismo gap seguro que R9). */
export function montoFulfillmentDeTarifa(tarifa: TarifaConFulfillment | null): Prisma.Decimal {
  return tarifa === null ? new Prisma.Decimal(0) : new Prisma.Decimal(tarifa.fulfillment);
}

/** `true` = la tienda de esta tarifa hace fulfillment (su monto es mayor que cero). */
export function tieneFulfillment(tarifa: TarifaConFulfillment | null): boolean {
  return montoFulfillmentDeTarifa(tarifa).gt(0);
}

/**
 * Lo que la tienda paga por UNA orden creada por la via API, DESGLOSADO.
 *
 * `costoEnvio` conserva su nombre y su lugar en el contrato, pero desde hoy es la SUMA de los
 * dos conceptos —flete + IVA del flete, y el fulfillment cuando lo hay—, no solo el primero.
 * Por eso el desglose viaja al lado: un total que crece sin decir de que esta hecho es
 * exactamente lo que obliga al integrador a adivinar.
 *
 * Sin fulfillment el desglose vale `"0.00"` y `costoEnvio` da EXACTAMENTE lo que daba antes.
 */
export interface DesgloseCargaApi {
  costoEnvio: string; // flete + IVA del flete + fulfillment
  fulfillment: string; // el sumando de arriba, aparte; "0.00" si la tienda no hace fulfillment
}

export function desgloseCargaApi(
  tarifa: (TarifaVigente & TarifaConFulfillment) | null,
  esCentral: boolean,
  esZonaEspecial: boolean,
): DesgloseCargaApi {
  const envio = new Prisma.Decimal(costoEnvioDeTarifa(tarifa, esCentral, esZonaEspecial));
  const fulfillment = montoFulfillmentDeTarifa(tarifa);
  return {
    costoEnvio: round2(envio.plus(fulfillment)).toFixed(2),
    fulfillment: round2(fulfillment).toFixed(2),
  };
}
