import type {
  CuentaPorPagarSigno,
  PagoMensajeroMovimientoCategoria,
  PagoMensajeroMovimientoTipo,
} from "@/lib/types/wallet-mensajero";

// Feature 44 (T14) — etiquetas i18n-ready y helper de moneda de la vista del MAESTRO
// (cuentas por pagar a mensajeros), separados de la logica (docs/conventions: textos de UI
// fuera del componente). Money-safe (R21/R27): `money` recibe un monto que YA viene como
// STRING desde el Server Component y solo antepone el simbolo; NUNCA parseFloat/Number.

/** Antepone el simbolo de colon a un monto STRING (tal cual, sin parseo). `null` -> "—". */
export function money(value: string | null): string {
  return value === null ? "—" : `₡${value}`;
}

/** Cabeceras de la tabla de cuentas por pagar (una fila por mensajero). */
export const COLUMNAS_MAESTRO = {
  mensajero: "Mensajero",
  devengado: "Devengado",
  pagado: "Pagado",
  cuentaPorPagar: "Cuenta por pagar",
  estado: "Estado",
} as const;

/** Badge de estado por signo de la cuenta por pagar (positivo = Ordenex debe / cero = al dia). */
export const SIGNO_BADGE: Record<
  CuentaPorPagarSigno,
  { variant: "default" | "secondary" | "destructive" | "outline"; label: string }
> = {
  positivo: { variant: "default", label: "Pendiente" },
  cero: { variant: "secondary", label: "Al día" },
};

/**
 * Color del monto de la cuenta por pagar segun su signo. Positivo (Ordenex le debe al
 * mensajero) se resalta en ambar; cero es neutro. Nunca negativo en flujo normal (R16).
 */
export const CUENTA_COLOR: Record<CuentaPorPagarSigno, string> = {
  positivo: "text-warning-strong",
  cero: "text-muted-foreground",
};

/**
 * Etiquetas del saldo del desglose (split devengado/pagado/pendiente de un mensajero). En la
 * vista del maestro el saldo refleja el CONJUNTO FILTRADO (R22): al aplicar filtros de
 * fecha/cierre estos tres montos se recalculan desde `result.data.cuenta`, no del agregado.
 */
export const DESGLOSE_LABEL = {
  devengado: "Total devengado",
  devengadoHint: "Lo que Ordenex le debe por sus entregas",
  pagado: "Total pagado",
  pagadoHint: "Lo ya entregado (del efectivo recaudado)",
  cuentaPorPagar: "Cuenta por pagar",
  cuentaPorPagarHint: "Lo pendiente de pagar al mensajero",
} as const;

/** El aviso de la CABECERA del desglose, con sus tres rótulos (feature 172, T H.4). */
export const DESGLOSE_AVISO_BRUTOS = avisoImportesBrutos({
  pagado: DESGLOSE_LABEL.pagado,
  devengado: DESGLOSE_LABEL.devengado,
  correcto: DESGLOSE_LABEL.cuentaPorPagar,
});

/**
 * Feature 172 (T H.4) — el AVISO de la limitación N1, compuesto con los rótulos REALES de la
 * superficie que lo muestra.
 *
 * Por qué esta pantalla lo necesita y `SaldosTiendasTable` no: la tabla de tiendas solo pinta
 * el SALDO, que es el número correcto; esta pinta «devengado» y «pagado», que son sumas
 * BRUTAS del libro. `PagoMensajeroMovimientoRepository.agregarCuentaPorPagar` agrupa por
 * `tipo` SIN excluir nada, así que el `ajuste_devengo` del reverso engorda lo devengado y la
 * `liquidacion` anulada sigue dentro de lo pagado. La RESTA —la cuenta por pagar— sale exacta.
 *
 * Regla aplicada (decisión del leader): el aviso hace falta donde se muestre un IMPORTE
 * AGREGADO que incluya lo anulado; no donde solo se listen movimientos. Aquí lo llevan las
 * DOS superficies con agregados —la tabla de cuentas y la cabecera del desglose— y NO la
 * tabla de movimientos del desglose, donde el pago y su reverso se ven los dos.
 *
 * Sin jerga: ni «contraasiento», ni «neteo», ni siglas.
 */
export function avisoImportesBrutos(rotulos: {
  pagado: string;
  devengado: string;
  correcto: string;
}): string {
  return (
    `«${rotulos.pagado}» sigue contando los pagos que se anularon, y «${rotulos.devengado}» ` +
    `suma la devolución de cada uno, así que esos dos importes quedan más altos de lo que se ` +
    `movió de verdad. «${rotulos.correcto}» ya tiene todo eso descontado: ese es el número ` +
    `correcto.`
  );
}

/** El aviso de la TABLA de cuentas por pagar, con sus cabeceras. */
export const CUENTAS_AVISO_BRUTOS = avisoImportesBrutos({
  pagado: COLUMNAS_MAESTRO.pagado,
  devengado: COLUMNAS_MAESTRO.devengado,
  correcto: COLUMNAS_MAESTRO.cuentaPorPagar,
});

/**
 * Cabeceras de los MISMOS importes cuando salen en el ARCHIVO descargable.
 *
 * En pantalla estas dos columnas se llaman «Devengado» y «Pagado» a secas porque justo encima
 * va `CUENTAS_AVISO_BRUTOS`, que dice qué incluyen. La hoja de cálculo se reenvía SIN ese
 * aviso: quien la abre ve dos importes que prometen más exactitud de la que tienen. Por eso el
 * archivo lleva la salvedad EN la cabecera, con las MISMAS palabras del aviso que el usuario ya
 * vio en pantalla («los pagos que se anularon», «la devolución de cada uno»).
 *
 * La salvedad de cada una es distinta, y por eso no se abrevian igual: «Pagado» incluye los
 * pagos anulados; «Devengado» no los incluye, incluye su DEVOLUCIÓN. «Cuenta por pagar» —la
 * resta— sale exacta y no lleva salvedad.
 *
 * El DATO no cambia: cambia lo que la cabecera promete.
 *
 * NO se llama `COLUMNAS_DESCARGA_*`: ese prefijo está reservado a los `DescargaColumna[]` que
 * vigila `columnas-asercion-de-orden.guardia`, y esto es un diccionario de rótulos. Nombrarlo
 * así metería una entrada falsa en ese censo.
 */
export const ENCABEZADOS_DESCARGA_MAESTRO = {
  ...COLUMNAS_MAESTRO,
  devengado: `${COLUMNAS_MAESTRO.devengado} (incluye la devolución de los pagos anulados)`,
  pagado: `${COLUMNAS_MAESTRO.pagado} (incluye los pagos anulados)`,
} as const;

// ── Desglose POR CIERRE del maestro (R18/R22) ──

/** Etiqueta legible del tipo de movimiento (devengo = lo devengado / pago = lo entregado). */
export const TIPO_PAGO_LABEL: Record<PagoMensajeroMovimientoTipo, string> = {
  devengo: "Devengo",
  pago: "Pago",
};

/** Etiqueta legible de cada categoria (concepto) del libro del pago al mensajero. */
export const CATEGORIA_PAGO_LABEL: Record<PagoMensajeroMovimientoCategoria, string> = {
  pago_devengado: "Pago devengado",
  pago_efectivo: "Pago del efectivo",
  liquidacion: "Liquidación",
  ajuste_devengo: "Ajuste (devengo)",
  ajuste_pago: "Ajuste (pago)",
};

/** Etiqueta legible del origen de un movimiento (WalletOrigenTipo, subconjunto de la 44). */
export const ORIGEN_PAGO_LABEL: Record<string, string> = {
  cierre_dia: "Cierre del día",
  pago_mensajero: "Liquidación",
  manual: "Manual",
};

/** Origen legible con fallback al valor crudo si no hay etiqueta conocida. */
export function origenLabel(origenTipo: string): string {
  return ORIGEN_PAGO_LABEL[origenTipo] ?? origenTipo;
}

/** Cabeceras de la tabla del desglose por cierre (mas reciente primero). */
export const DESGLOSE_COLUMNAS = {
  fecha: "Fecha",
  tipo: "Tipo",
  concepto: "Concepto",
  monto: "Monto",
  origen: "Origen",
} as const;

/** Etiquetas de los filtros server-side del desglose por cierre (fecha/cierre, R22). */
export const DESGLOSE_FILTRO_LABEL = {
  cierre: "Cierre",
  cierrePlaceholder: "ID del cierre",
  desde: "Desde",
  hasta: "Hasta",
  aplicar: "Aplicar",
  limpiar: "Limpiar",
} as const;

/** Mensaje cuando el desglose filtrado no tiene movimientos. */
export const DESGLOSE_VACIO = "No hay movimientos que coincidan con los filtros.";
