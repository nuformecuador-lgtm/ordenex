import { money } from "@/lib/config/moneda";
import type { CierreEstado } from "@/lib/types/cierre";
import type {
  CuentaPorPagarSigno,
  PagoMensajeroMovimientoCategoria,
  PagoMensajeroMovimientoTipo,
} from "@/lib/types/wallet-mensajero";

// Feature 44 (T14) — etiquetas i18n-ready y helper de moneda de la vista del MAESTRO
// (cuentas por pagar a mensajeros), separados de la logica (docs/conventions: textos de UI
// fuera del componente). Money-safe (R21/R27): `money` recibe un monto que YA viene como
// STRING desde el Server Component y solo le da formato; NUNCA parseFloat/Number.

/**
 * Feature 201 (tanda B): `money` se PROMOVIO a `lib/config/moneda.ts` sin cambiarle la firma
 * ni el marcador de ausencia (`"—"`), porque era la misma funcion copiada byte a byte en
 * siete archivos de etiquetas. Se re-exporta desde aqui para que sus consumidores sigan
 * importandola del mismo sitio: es una mudanza, y lo unico que cambia es el ASPECTO del
 * importe (ahora con separador de miles), que es el objetivo de la feature.
 */
export { money };

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
 *
 * Deuda 203 (cabo suelto) — cada pista lleva AHORA la salvedad de la limitación N1. Antes, el
 * desglose repetía el párrafo entero de la tabla (`CUENTAS_AVISO_BRUTOS`) con los rótulos
 * cambiados, y las dos copias se veían A LA VEZ: medido en la app el 2026-08-12 con la primera
 * fila desplegada, una en y=181 y la otra en y=457 de una ventana de 900 px. Como la tabla
 * admite varias filas abiertas a la vez, cada fila añadía otra copia del mismo párrafo.
 *
 * Lo que NO se podía hacer es borrarlo sin más y dejar que hablara el de la tabla:
 *
 *  - estos tres importes son los del CONJUNTO FILTRADO (R22), no los de la fila de la tabla:
 *    filtrar por fecha los cambia, y el párrafo de arriba habla de otras cifras y con otros
 *    rótulos («Pagado», no «Total pagado»);
 *  - para las filas de abajo, el párrafo de la tabla ni siquiera está en pantalla: con el
 *    tamaño de página por defecto (25) y filas de 42 px, desplegar la 19.ª deja el aviso de la
 *    cabecera a más de 900 px por encima del desglose.
 *
 * Así que la salvedad se queda donde estaba el importe que describe, en una línea y con las
 * MISMAS palabras que ya usan las cabeceras del archivo descargable (más abajo). Deja de ser un
 * párrafo repetido y pasa a ser lo que la cifra promete.
 */
export const DESGLOSE_LABEL = {
  devengado: "Total devengado",
  devengadoHint:
    "Lo que Ordenex le debe por sus entregas. Incluye la devolución de los pagos anulados.",
  pagado: "Total pagado",
  pagadoHint: "Lo ya entregado (del efectivo recaudado). Incluye los pagos anulados.",
  cuentaPorPagar: "Cuenta por pagar",
  cuentaPorPagarHint:
    "Lo pendiente de pagar al mensajero. Es el número correcto: ya tiene descontado lo anulado.",
} as const;

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
 * AGREGADO que incluya lo anulado; no donde solo se listen movimientos. Las DOS superficies con
 * agregados lo llevan, y NO lo lleva la tabla de movimientos del desglose, donde el pago y su
 * reverso se ven los dos.
 *
 * Deuda 203 — lo que cambió es la FORMA, no la regla: este párrafo se pinta UNA sola vez por
 * pantalla, en la cabecera de la tabla, porque es la única superficie que se ve sin desplegar
 * nada. La otra superficie con agregados —la cabecera del desglose— lleva la misma salvedad
 * pegada a cada importe (`DESGLOSE_LABEL`, arriba), que es donde no puede sobrar.
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

/**
 * Etiquetas de los filtros server-side del desglose por cierre (fecha/cierre, R22).
 *
 * Deuda 203 (cabo suelto) — el campo del cierre decía «ID del cierre», o sea le pedía a una
 * persona que tecleara un uuid de 36 caracteres. Comprobado en la app el 2026-08-12: ese
 * identificador NO se ve en ninguna parte de la pantalla. En el enlace «Ver el cierre» viaja en
 * un `sr-only`, solo para lectores de pantalla (`CIERRE_ENLACE.identificacion`), así que la
 * única forma de conseguirlo es copiar la DIRECCIÓN de ese enlace —o leerla de la barra del
 * navegador tras abrirlo—, y eso es exactamente lo que la ayuda dice ahora.
 *
 * El filtro NO se quita: el `cierreId` va al WHERE server-side (R22), viaja también en la
 * descarga del desglose completo (`buildInputCompleto`) y lo fijan dos casos de
 * `tests/integration/wallet-mensajeros-page.test.tsx`. Lo que se arregla es lo que la pantalla
 * PROMETE: se pega, no se teclea, y dice de dónde sale.
 */
export const DESGLOSE_FILTRO_LABEL = {
  cierre: "Cierre",
  cierrePlaceholder: "Pegá el identificador",
  cierreAyuda:
    "El identificador del cierre sale del enlace «Ver el cierre» de la tabla: copiá su dirección y pegala en «Cierre».",
  desde: "Desde",
  hasta: "Hasta",
  aplicar: "Aplicar",
  limpiar: "Limpiar",
} as const;

/** Mensaje cuando el desglose filtrado no tiene movimientos. */
export const DESGLOSE_VACIO = "No hay movimientos que coincidan con los filtros.";

// ── Feature 205 — pagar la cuenta por pagar del mensajero desde esta pantalla ──
//
// Textos separados del componente (`docs/conventions.md`: listos para i18n) y en lenguaje
// claro: ni siglas ni jerga contable. Aquí no se hace ARITMÉTICA con ningún importe: cada
// función recibe el STRING que derivó el SERVIDOR y solo le da formato con `money` (R16/R34).
// Los cardinales (cuántos cierres entran, cuántos quedan fuera, cuántos hay de cada estado)
// son `number` porque cuentan CIERRES, no dinero.

/** Nombre accesible del enlace al detalle de un cierre (R43/R44). */
export const CIERRE_ENLACE = {
  /**
   * Texto VISIBLE del enlace. Corto a propósito: va dentro de una celda o de una línea de la
   * previsualización, donde el resto de la fila ya dice de qué cierre se habla.
   */
  ver: "Ver el cierre",
  /**
   * Lo que se añade al nombre accesible, solo para lectores de pantalla. Existe porque una
   * pantalla puede tener veinte enlaces «Ver el cierre» y un lector de pantalla los leería
   * todos igual; con el identificador detrás, cada uno se nombra solo. El texto visible sigue
   * contenido en el nombre accesible, que es lo que exige «Label in Name».
   */
  identificacion: (cierreId: string) => ` (${cierreId})`,
} as const;

/** La cabecera de la columna del desglose que lleva el enlace (R43). */
export const DESGLOSE_COLUMNA_CIERRE = "Cierre";

/** Lo que se pinta en la celda de una fila que NO corresponde a ningún cierre (R43). */
export const DESGLOSE_SIN_CIERRE = "—";

/** Textos del bloque de pago del desglose (R3). */
export const PAGO_MENSAJERO_WALLET = {
  /** Nombre accesible del bloque entero, en la cabecera del desglose. */
  seccion: "Pago al mensajero",
  /** Rótulo del importe que este pago puede saldar AHORA (el imputable de la ventana). */
  disponible: "Se puede pagar ahora",
  disponibleHint:
    "La suma de los cierres aprobados que un solo pago puede saldar. Sale del servidor.",
  /** Abre el formulario. */
  abrir: "Registrar pago",
  /** R15 — sin cierres aprobados con saldo no hay nada que pagar, y se dice con texto. */
  sinImputable:
    "Este mensajero no tiene cierres aprobados con saldo pendiente: no hay nada que pagar desde acá.",
  cargando: "Calculando lo que se puede pagar…",
  error: "No se pudo calcular lo que se puede pagar. Volvé a abrir el desglose.",
  /**
   * El aviso de `sin_saldo` de ESTA pantalla: el del diálogo compartido habla de una tienda.
   * Aquí significa que entre abrir el formulario y confirmar dejó de haber cierres que cobrar.
   */
  sinSaldo:
    "Ya no queda ningún cierre aprobado con saldo pendiente: no hay nada que pagar.",
  /** Confirmación del pago, con el total que devolvió el servidor. */
  registrado: (totalImputado: string) => `Pago de ${money(totalImputado)} registrado.`,
  /** R28 — la respuesta idempotente: no se cobró dos veces. */
  yaRegistrado:
    "Este pago ya estaba registrado: se conservó el reparto original y no se cobró dos veces.",
  /** El pago no quedó registrado; el formulario sigue abierto con lo escrito. */
  noRegistrado: "No se registró el pago. Revisá el aviso del formulario e intentá de nuevo.",
} as const;

/**
 * R25 — el reparto REALMENTE aplicado, que es lo que se enseña al terminar.
 *
 * No es la previsualización confirmada: entre mirar y confirmar, otro pudo haber pagado, y el
 * servidor recalcula bajo bloqueo. Por eso esta pantalla pinta lo que devolvió la escritura y
 * no lo que enseñó antes.
 */
export const REPARTO_APLICADO = {
  titulo: "Último pago registrado",
  total: "Total aplicado",
  restante: "Sigue pendiente por cierres",
  restanteHint: "Lo que queda por pagar en otro registro.",
  imputaciones: "A qué cierres se aplicó",
  /** Lo que le queda a ESE cierre después del pago. */
  quedaPendiente: (pendienteDespues: string) => `Queda pendiente: ${money(pendienteDespues)}`,
} as const;

/** Textos de la PREVISUALIZACIÓN del reparto (R32-R38, R56). */
export const REPARTO_PREVISUALIZACION = {
  /** Nombre accesible del bloque dentro del formulario. */
  seccion: "Cómo se reparte este pago",
  cargando: "Calculando el reparto…",
  error: "No se pudo calcular el reparto. Cambiá el monto o volvé a intentarlo.",
  /** Sin un monto legible todavía no hay reparto que enseñar, y se dice. */
  sinMonto: "Escribí un monto para ver a qué cierres se aplicaría.",
  /** Con monto pero sin nada que aplicar (no debería verse: el botón ya está deshabilitado). */
  sinImputaciones: "Con este monto no se aplica nada a ningún cierre.",
  /** Nombra un cierre por el día TRABAJADO, que es la antigüedad que ordena el reparto (R8). */
  cierre: (fecha: string) => `Cierre del ${fecha}`,
  /** Lo que se le aplica a ese cierre. */
  seAplica: (monto: string) => `Se aplica ${money(monto)}`,
  pendienteActual: (pendiente: string) => `Pendiente hoy: ${money(pendiente)}`,
  pendienteDespues: (pendiente: string) => `Queda pendiente: ${money(pendiente)}`,
  /** R33 — la imputación PARCIAL, marcada. Solo la última puede serlo. */
  parcial: "Pago parcial",
  /** R38 — el importe no cabe. Las dos cifras las derivó el servidor. */
  excede: (sobrante: string, imputable: string) =>
    `El monto supera lo que se puede pagar ahora: sobran ${money(sobrante)}. ` +
    `Como máximo se pueden aplicar ${money(imputable)}.`,
  /**
   * R56 — el RECORTE por el tope: deuda que sí se puede pagar acá, pero en otro registro.
   * Es un aviso DISTINTO del de abajo y no se puede fundir con él: éste habla de dinero que
   * el siguiente pago sí alcanza.
   */
  recorte: (enVentana: number, fuera: number, montoFuera: string) =>
    `Este pago alcanza a los ${enVentana} cierres más antiguos. Quedan ${fuera} cierres ` +
    `por ${money(montoFuera)}, que se pagan en el siguiente registro.`,
  /**
   * R37 — deuda que esta pantalla NO sabe pagar porque no cuelga de ningún cierre. El servidor
   * ya hizo la comparación y mandó el resultado: acá no se compara ningún importe.
   */
  deudaNoImputable: (monto: string) =>
    `${money(monto)} de la cuenta por pagar no corresponde a ningún cierre y no se puede ` +
    `pagar desde esta pantalla.`,
  /**
   * R36 — los cierres que NO pueden recibir pago por no estar aprobados. Es un CONTEO por
   * estado, no un listado: el inventario vive en la pantalla de cierres, que es adonde lleva
   * el enlace de cada fila. No se suma ningún total acá; se enumeran los estados tal cual
   * llegaron.
   */
  excluidos: (detalle: string) =>
    `Estos cierres no pueden recibir pago porque no están aprobados: ${detalle}.`,
  /** Una entrada del conteo: «9 rechazados». El plural lo pone el propio rótulo del estado. */
  excluido: (cantidad: number, estado: string) => `${cantidad} ${estado}`,
} as const;

/**
 * Rótulo en plural de cada estado de cierre, para el conteo de R36 («9 rechazados, 3
 * solicitados»).
 *
 * Es un `Record` EXHAUSTIVO y no un plural derivado del rótulo singular a base de añadirle una
 * «s»: el día que el catálogo gane un estado, esto rompe el build y alguien escribe su palabra,
 * en vez de que la pantalla invente una. `aprobado` no puede aparecer en este aviso —son
 * justamente los que SÍ reciben pago— pero se declara igual: el mapa cubre el enum entero.
 */
export const ESTADO_CIERRE_PLURAL: Record<CierreEstado, string> = {
  solicitado: "solicitados",
  aprobado: "aprobados",
  rechazado: "rechazados",
  vencido: "vencidos",
};
