"use client";

import type { TotalesIngresoOrdenex } from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreEstado } from "@/lib/types/cierre";

import { CascadaDinero, type LineaCascada } from "./CascadaDinero";
import {
  CASCADA_DUENO_TITULO,
  CASCADA_FACTURA_TIENDA_TITULO,
  CASCADA_NETO_ORDENEX_TITULO,
  COBRADO_SOBRE_RECAUDADO_LABEL,
  COBRADO_SOBRE_RECAUDADO_NOTA,
  FACTURADO_ORDENEX_LABEL,
  FLETE_DEV_CON_IVA_LABEL,
  FLETE_RECHAZO_AUN_NO_COBRADO_NOTA,
  FLETE_RECHAZO_NO_DEDUCIBLE_NOTA,
  FLETE_RECHAZO_NO_SE_COBRARA_NOTA,
  FLETE_RECHAZO_YA_COBRADO_NOTA,
  GANA_LA_TIENDA_LABEL,
  GANA_LA_TIENDA_NEGATIVO_NOTA,
  GANA_LA_TIENDA_NOTA,
  INGRESO_BODEGA_RECHAZOS_LABEL,
  NETO_ORDENEX_LABEL,
  NETO_ORDENEX_NEGATIVO_NOTA,
  NETO_ORDENEX_NOTA,
  PAGO_MENSAJERO_LABEL,
  PAGO_TIENDA_HOY_NOTA,
  PAGO_TIENDA_LABEL,
  TOTAL_GENERAL_LABEL,
  esMontoCero,
  esMontoNegativo,
} from "./cierre-detalle-shared";

/**
 * 💰 FICHA 395 (2026-09-08) — LAS TRES CASCADAS DEL DETALLE DEL CIERRE DE **MENSAJERO**.
 *
 * ── EL FALLO QUE ESTO ARREGLA, Y ES DE DINERO
 * El detalle enseñaba «Pago a tienda ₡225.176,33» y «Total Ordenex ₡70.946,67» SUELTOS, uno al
 * lado del otro, e invitaba a restarlos. **Esa resta no da**, porque los dos números no salen de
 * la misma bolsa: el pago a la tienda no descuenta el flete por rechazo —ese flete se le factura
 * pero nunca entró en lo recaudado, porque un rechazo no cobra contra entrega—. El humano se
 * confundió leyendo su propia pantalla, dedujo solo cuál era la cuenta buena, y lo dijo así: «si
 * yo me confundo, no quiero imaginar los operarios». La pantalla debería habérsela dado.
 *
 * ── EL ORDEN ES EL ARREGLO, NO UN DETALLE DE MAQUETACIÓN
 * **Primero la partición** (`CASCADA_DUENO_TITULO`), que es la única que cualquiera entiende sin
 * que se la expliquen y la que contesta «qué plata es para quién»:
 *
 *     Total general            285.275,00
 *     − Lo que Ordenex facturó  70.946,67
 *     = Gana la tienda         214.328,33
 *
 * La identidad `ganaLaTienda + totalesIngreso.total === totales.general` cierra SIEMPRE.
 *
 * **Y sólo DESPUÉS** el desglose de esos 70.946,67 y el pago de hoy. Si el desglose fuera
 * primero, la pantalla volvería a empezar por el número que confunde. Por eso la partición se
 * monta arriba y con su propia región: el orden es lo que se está arreglando.
 *
 * ── «PAGO A TIENDA» Y «GANA LA TIENDA» NO SON UN DESCUADRE
 * `pagoTienda − fleteDevolucionConIva === ganaLaTienda` es una identidad, no un error: son dos
 * preguntas distintas —«cuánto se le paga hoy» y «cuánto gana en total»— y la pantalla tiene que
 * dejar claro que son DOS. Cada una lleva su nota, y las dos notas son un par que se lee junto
 * (`PAGO_TIENDA_HOY_NOTA` / `GANA_LA_TIENDA_NOTA`).
 *
 * ── NI UNA OPERACIÓN ARITMÉTICA (money-safe)
 * Los tres importes nuevos llegan YA DERIVADOS del servidor, como STRING con su signo. Aquí sólo
 * se eligen rótulos, orden, notas y qué línea es el resultado. No hay `Number(`, `parseFloat(`,
 * `parseInt(` ni `.toFixed(`: los únicos que tocan un importe son `money()` —dentro de
 * `CascadaDinero`— y los dos lectores del TEXTO, `esMontoNegativo` y `esMontoCero`.
 *
 * ── LOS NEGATIVOS SE PINTAN CON SU SIGNO
 * `ganaLaTienda` y `netoOrdenex` pueden ser negativos y salen CON SU SIGNO, nunca recortados a
 * cero ni en valor absoluto. `CascadaDinero` los tiñe con `text-danger-strong` sólo cuando son el
 * RESULTADO destacado, que es el precedente que dejaron los cierres de bodega (393/R11/R36): un
 * negativo no es un fallo de la pantalla, es lo que pasó.
 *
 * ── POR QUÉ ES UN COMPONENTE Y NO JSX DENTRO DEL MÓDULO
 * Para que la pantalla de dinero tenga un archivo con nombre —está censada en
 * `tests/components/DineroIdentidadesEnPantalla.test.tsx`— y para que sus identidades se puedan
 * montar y leer del DOM sin arrastrar la cola, el histórico y las cuatro Server Actions del
 * módulo entero.
 */

export interface CascadasCierreMensajeroProps {
  /** Da nombre PROPIO a cada una de las tres regiones (393/R32). */
  mensajeroNombre: string;
  /**
   * El estado del cierre. **Sólo** decide el TIEMPO VERBAL del cargo del flete por rechazo, y
   * sólo entre «todavía no» y «ya no»: si el cargo ocurrió o no lo dice
   * `fleteRechazoYaCobradoATienda`, que llega ya resuelto. Aquí no se infiere.
   */
  estado: CierreEstado;
  /** Lo recaudado: `cierre.totales.general` (snapshot). */
  general: string;
  /** El ingreso de Ordenex por concepto (derivado del snapshot). */
  totalesIngreso: TotalesIngresoOrdenex;
  /** Snapshot del pago al mensajero. */
  totalPagoMensajero: string;
  /** Snapshot del ingreso de bodega por rechazos. */
  totalIngresoBodegaRechazos: string;
  /** Lo que se le paga a la tienda DE ESTE DINERO. Ya existía; no cambia de significado. */
  pagoTienda: string;
  /** La LÍNEA PUENTE: `fleteConIva + comisionConIva`. Se pinta SIEMPRE (ver abajo). */
  cobradoSobreRecaudado: string;
  /** Facturado − pago al mensajero − ingreso de bodega. NO es `ganancia`. */
  netoOrdenex: string;
  /** Recaudado − facturado. NO es `pagoTienda`. */
  ganaLaTienda: string;
  /** ¿El cargo del flete por rechazo YA está en el saldo de la tienda? Resuelto en el servidor. */
  fleteRechazoYaCobradoATienda: boolean;
}

/**
 * LA PARTICIÓN. Tres líneas y una sola resta: de todo lo que se recaudó, esto se lo lleva Ordenex
 * y esto le queda a la tienda. Es lo primero que se lee, y es lo único que hace falta leer para
 * entender de quién es el dinero.
 */
function lineasParticion(
  general: string,
  facturado: string,
  ganaLaTienda: string,
): LineaCascada[] {
  // La nota fija dice de qué resta sale y la separa del pago de hoy; la condicional dice qué
  // significa que salga negativo. Van SUELTAS y no unidas en un párrafo, igual que en las
  // cascadas del cierre de bodega: cada una está o no está, y fundirlas dejaría sin poder
  // distinguir cuál se puso.
  const notas = [GANA_LA_TIENDA_NOTA];
  if (esMontoNegativo(ganaLaTienda)) notas.push(GANA_LA_TIENDA_NEGATIVO_NOTA);

  return [
    // Reusa el rótulo del total que YA está en esta pantalla («Total general», el KPI y el
    // renglón del comprobante de abajo). Estrenar un «Lo recaudado» sería dar dos nombres a la
    // misma cifra en la misma superficie, que es el defecto que esta ficha viene a arreglar.
    { label: TOTAL_GENERAL_LABEL, monto: general, signo: "neutro" },
    { label: FACTURADO_ORDENEX_LABEL, monto: facturado, signo: "resta" },
    { label: GANA_LA_TIENDA_LABEL, monto: ganaLaTienda, signo: "neutro", destacado: true, notas },
  ];
}

/**
 * EL TIEMPO VERBAL del cargo del flete por rechazo al saldo de la tienda.
 *
 * `null` cuando no hay flete por rechazo: ahí no hay ningún cargo del que hablar y una frase en
 * cualquier tiempo verbal sería ruido junto a un ₡0. Con flete y sin el cargo hecho, el estado
 * distingue «ya no» (`rechazado`: ese cierre no se va a aprobar nunca) de «todavía no».
 */
function notaDelCargoAlSaldo(
  fleteRechazoConIva: string,
  yaCobrado: boolean,
  estado: CierreEstado,
): string | null {
  if (esMontoCero(fleteRechazoConIva)) return null;
  if (yaCobrado) return FLETE_RECHAZO_YA_COBRADO_NOTA;
  return estado === "rechazado"
    ? FLETE_RECHAZO_NO_SE_COBRARA_NOTA
    : FLETE_RECHAZO_AUN_NO_COBRADO_NOTA;
}

/**
 * DE QUÉ SE COMPONE LO QUE ORDENEX FACTURA, Y POR QUÉ HOY SE LE PAGA OTRA CIFRA.
 *
 * Dos cuentas encadenadas, con la misma forma que la cascada «de quién es el dinero» del cierre
 * de bodega (un resultado destacado a media cascada y la cuenta que sigue debajo):
 *
 *     Cobrado sobre lo recaudado   60.098,67
 *     + Flete por rechazo + IVA    10.848,00
 *     = Lo que Ordenex facturó     70.946,67
 *
 *     Total general               285.275,00
 *     − Cobrado sobre lo recaudado 60.098,67
 *     = Pago a tienda             225.176,33
 *
 * LA LÍNEA PUENTE («Cobrado sobre lo recaudado») va SIEMPRE, también con el flete por rechazo en
 * "0.00", y por eso aparece dos veces: es la ÚNICA que hace cuadrar las dos cuentas. Sin ella la
 * pantalla enseñaría «recaudado − facturado = pago a tienda», que es justo la resta que no da en
 * cuanto hay un rechazo. No es una línea condicional.
 */
function lineasFacturaTienda(props: CascadasCierreMensajeroProps): LineaCascada[] {
  const { totalesIngreso, general, pagoTienda, cobradoSobreRecaudado } = props;
  const notasDelFlete = [FLETE_RECHAZO_NO_DEDUCIBLE_NOTA];
  const cargo = notaDelCargoAlSaldo(
    totalesIngreso.fleteDevolucionConIva,
    props.fleteRechazoYaCobradoATienda,
    props.estado,
  );
  if (cargo !== null) notasDelFlete.push(cargo);

  return [
    {
      label: COBRADO_SOBRE_RECAUDADO_LABEL,
      monto: cobradoSobreRecaudado,
      signo: "neutro",
      notas: [COBRADO_SOBRE_RECAUDADO_NOTA],
    },
    {
      label: FLETE_DEV_CON_IVA_LABEL,
      monto: totalesIngreso.fleteDevolucionConIva,
      signo: "suma",
      notas: notasDelFlete,
    },
    {
      label: FACTURADO_ORDENEX_LABEL,
      monto: totalesIngreso.total,
      signo: "neutro",
      destacado: true,
    },
    { label: TOTAL_GENERAL_LABEL, monto: general, signo: "neutro" },
    { label: COBRADO_SOBRE_RECAUDADO_LABEL, monto: cobradoSobreRecaudado, signo: "resta" },
    {
      label: PAGO_TIENDA_LABEL,
      monto: pagoTienda,
      signo: "neutro",
      destacado: true,
      notas: [PAGO_TIENDA_HOY_NOTA],
    },
  ];
}

/**
 * LO QUE LE QUEDA A ORDENEX. `netoOrdenex` NO es la `ganancia` que este mismo detalle ya pinta
 * cuando es negativa: aquella resta SÓLO el pago al mensajero, y ésta resta ADEMÁS el ingreso de
 * bodega por rechazos. Las dos coinciden exactamente cuando ese ingreso es cero.
 *
 * El rótulo de la bodega es `INGRESO_BODEGA_RECHAZOS_LABEL` y no el «Gana la bodega satélite» del
 * cierre de bodega: en un cierre de MENSAJERO la bodega puede ser la CENTRAL, así que ahí aquel
 * rótulo sería falso. Lo dejó escrito la propia 393 en `cierre-labels`.
 */
function lineasNetoOrdenex(props: CascadasCierreMensajeroProps): LineaCascada[] {
  const notas = [NETO_ORDENEX_NOTA];
  if (esMontoNegativo(props.netoOrdenex)) notas.push(NETO_ORDENEX_NEGATIVO_NOTA);

  return [
    { label: FACTURADO_ORDENEX_LABEL, monto: props.totalesIngreso.total, signo: "neutro" },
    { label: PAGO_MENSAJERO_LABEL, monto: props.totalPagoMensajero, signo: "resta" },
    {
      label: INGRESO_BODEGA_RECHAZOS_LABEL,
      monto: props.totalIngresoBodegaRechazos,
      signo: "resta",
    },
    { label: NETO_ORDENEX_LABEL, monto: props.netoOrdenex, signo: "neutro", destacado: true, notas },
  ];
}

/**
 * Las tres cascadas, en el orden en que hay que leerlas. Cada una es una `region` accesible con
 * NOMBRE PROPIO —el título más el mensajero—: la pantalla monta varias y sin nombres distintos un
 * lector de pantalla las anunciaría todas igual.
 */
export function CascadasCierreMensajero(props: Readonly<CascadasCierreMensajeroProps>) {
  const de = `cierre de ${props.mensajeroNombre}`;

  return (
    <div className="flex flex-col gap-5">
      {/* PRIMERO la partición: el orden ES el arreglo (ver la cabecera). */}
      <CascadaDinero
        titulo={CASCADA_DUENO_TITULO}
        ariaLabel={`${CASCADA_DUENO_TITULO} · ${de}`}
        lineas={lineasParticion(props.general, props.totalesIngreso.total, props.ganaLaTienda)}
      />
      <CascadaDinero
        titulo={CASCADA_FACTURA_TIENDA_TITULO}
        ariaLabel={`${CASCADA_FACTURA_TIENDA_TITULO} · ${de}`}
        lineas={lineasFacturaTienda(props)}
      />
      <CascadaDinero
        titulo={CASCADA_NETO_ORDENEX_TITULO}
        ariaLabel={`${CASCADA_NETO_ORDENEX_TITULO} · ${de}`}
        lineas={lineasNetoOrdenex(props)}
      />
    </div>
  );
}
