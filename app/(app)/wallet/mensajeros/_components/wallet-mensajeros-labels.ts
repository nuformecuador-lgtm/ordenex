import { money, moneyTope } from "@/lib/config/moneda";
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
  // Feature 293 (T1.6, R34, Q4 cerrada por el leader): rotulo PROPIO y distinguible del de los
  // ajustes. Sin esta linea el `Record` deja de compilar: el compilador es la guardia.
  premio_ranking: "Premio del ranking",
};

/** Etiqueta legible del origen de un movimiento (WalletOrigenTipo, subconjunto de la 44). */
export const ORIGEN_PAGO_LABEL: Record<string, string> = {
  cierre_dia: "Cierre del día",
  pago_mensajero: "Liquidación",
  manual: "Manual",
  // Feature 293 (T1.6): origen de las filas de CAJA del premio. No aparece en este libro
  // —aqui el premio va con `cierre_dia`—, pero el mapa es de `WalletOrigenTipo` y dejarlo fuera
  // haria que un dia se pintara el valor crudo.
  ranking_snapshot_fila: "Premio del ranking",
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
  /**
   * R38 — el importe no cabe. Las dos cifras las derivó el servidor.
   *
   * FICHA 359 — el `imputable` es un MÁXIMO y se pinta con `moneyTope`, no con `money`.
   * Cuando el formateador cuadraba al colón esto era un defecto vivo: `money("4500.35")`
   * daba `₡4.501` y la frase anunciaba como aplicable un importe que
   * `reparto-liquidacion-mensajero.ts` rechaza al céntimo. Hoy el formateador ya es exacto a
   * escala 2 y las dos funciones dan la MISMA cadena para todo lo que emite el servidor
   * (`imputable` sale de un `Decimal.toFixed(2)`), así que la identidad
   * `imputable + sobrante = importe tecleado` sigue cerrando con lo que se lee en pantalla.
   * `moneyTope` está aquí por lo que GARANTIZA, no por lo que cambia: si algún día llegara
   * un importe con más cola de la que se pinta, este número seguiría quedando por debajo.
   */
  excede: (sobrante: string, imputable: string) =>
    `El monto supera lo que se puede pagar ahora: sobran ${money(sobrante)}. ` +
    `Como máximo se pueden aplicar ${moneyTope(imputable)}.`,
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

/**
 * Feature 293 (T5.1) — rótulo EN MINÚSCULA de cada estado de cierre, para meterlo dentro de
 * una frase: «El cierre de ese día está rechazado» (R12).
 *
 * No se reusa `ESTADO_LABEL` de `cierres-admin`: aquél está capitalizado porque encabeza una
 * celda, y «El cierre de ese día está Rechazado» no es español. Y no se deriva con
 * `toLowerCase()` del otro mapa: eso ataría el texto de esta frase al de una columna ajena y
 * un rótulo compuesto («Aprobado con reparos») saldría partido.
 *
 * `Record` EXHAUSTIVO por el mismo motivo que su hermano de arriba: el día que el catálogo
 * gane un estado, esto rompe el build y alguien escribe su palabra.
 */
export const ESTADO_CIERRE_EN_FRASE: Record<CierreEstado, string> = {
  solicitado: "solicitado",
  aprobado: "aprobado",
  rechazado: "rechazado",
  vencido: "vencido",
};

/**
 * Feature 293 (T5.1, design §9) — textos del panel de PREMIOS DEL RANKING, la única puerta
 * desde la que se registra el premio del podio de un día (R1).
 *
 * Los seis estados de R9 se dicen SIEMPRE con texto, nunca con la ausencia del control: un
 * botón que no está no explica por qué no está, y aquí las tres razones para que no esté
 * —sin premio, sin cierre, cierre no aprobado— son cosas distintas que el maestro tiene que
 * poder distinguir sin abrir otra pantalla (R11/R12/R32).
 *
 * Money-safe (R35): los importes llegan como STRING del servidor y solo pasan por `money`.
 */
export const PREMIOS_RANKING = {
  /** Nombre accesible de la sección entera y su encabezado visible. */
  seccion: "Premios del ranking",
  descripcion:
    "El premio del podio de un día se registra como devengo del mensajero y se cobra con el " +
    "cierre de ese día.",
  /** Rótulo del selector de día. Habla del DÍA DEL PODIO, no del día de hoy. */
  selectorFecha: "Día del podio",
  selectorAyuda:
    "Por defecto, el último día que el ranking congeló. No se pueden elegir días futuros.",
  cargando: "Cargando el podio de ese día…",
  error: "No se pudo cargar el podio de ese día. Volvé a intentarlo.",
  /** R6 — la fecha no tiene snapshot: se dice, y no se ofrece ninguna acción. */
  sinPodio: "Ese día no tiene ranking congelado: no hay ningún premio que registrar.",
  /** Nombre accesible de la lista del podio. */
  listaAria: "Podio del día",
  /** «1.º», «2.º», «3.º» — la posición congelada de la fila. */
  posicion: (posicion: number) => `${posicion}.º`,
  /**
   * R5 — el dato que va PEGADO al premio y que nunca se oculta, ni cuando es cero.
   *
   * Es el aviso del 26/08: con todos los mensajeros al 0 % el podio lo decidió el orden
   * alfabético y el primer puesto fue 0 de 21. Quien pulsa «Registrar» tiene que ver eso
   * antes de pulsar, así que el par se pinta igual que cualquier otro y sin sustituirlo por
   * una raya.
   */
  entregadasAsignadas: (entregadas: number, asignadas: number) =>
    `${entregadas} / ${asignadas} entregadas`,
  entregadasAyuda:
    "Entregadas de asignadas ese día. Quien no entregó nada no ocupa podio ni cobra premio.",
  /** R7/R9 — la fila no tenía premio congelado ese día. */
  sinPremio: "Sin premio asignado ese día.",
  /**
   * Feature 297 — la fila congelada tiene CERO entregas. Se dice la causa EXACTA, igual que
   * `sinCierre` o `cierreNoAprobado`: el podio de un día anterior a la 297 pudo salir por orden
   * alfabético con todos en cero, y ese premio se sigue viendo aunque ya no se pueda cobrar.
   */
  sinEntregas: "Ese día no entregó ninguna orden: el premio no se puede cobrar.",
  /** R11 — la causa EXACTA, no un error genérico. Esta feature no crea cierres. */
  sinCierre: "Ese día no tiene cierre: el premio no se puede imputar todavía.",
  /** R12 — la causa exacta, nombrando el estado en que está ese cierre. */
  cierreNoAprobado: (estado: string) =>
    `El cierre de ese día está ${estado}: el premio no se puede imputar todavía.`,
  /** R9 — ya registrado: se cobra con el flujo de pago por cierre que ya existía. */
  registrado: "Registrado: se cobra con el cierre de ese día.",
  /** R32 — anular consume el cupo para siempre, y se dice con TEXTO. */
  anuladoEstado: "Anulado — no se puede volver a registrar.",
  /** Nombres accesibles ÚNICOS por fila: el podio tiene hasta tres botones iguales. */
  registrar: (mensajero: string) => `Registrar el premio de ${mensajero}`,
  anular: (mensajero: string) => `Anular el premio de ${mensajero}`,
  /** Confirmación del registro, con el importe que devolvió el SERVIDOR. */
  registradoOk: (monto: string) =>
    `Premio de ${money(monto)} registrado: se cobra con el cierre de ese día.`,
  /** R18 — el reintento idempotente. No es un error. */
  yaRegistrado: "Ese premio ya estaba registrado: no se escribió una segunda vez.",
  /** R32 — se pidió registrar uno anulado. */
  yaAnulado: "Ese premio está anulado: no se puede volver a registrar.",
  /** R29/R33 — la anulación quedó escrita. */
  anuladoOk: "Premio anulado: se escribió la compensación y lo pagable de ese cierre bajó.",
  /** R31 — la segunda anulación. Tampoco es un error. */
  anuladoRepetido: "Ese premio ya estaba anulado: no se escribió una segunda compensación.",
  /** Se pidió anular algo que no está registrado. */
  noRegistrado: "Ese premio no está registrado: no hay nada que anular.",
  /** La fila del podio ya no está donde estaba (otra pestaña, otro día cargado). */
  noEncontrado: "Esa fila del podio ya no existe. Volvé a cargar el día.",
  forbidden: "No tenés permiso para registrar ni anular premios del ranking.",
  unauthenticated: "Tu sesión terminó. Volvé a entrar para registrar el premio.",
  validacion: "El día elegido no es válido: revisá la fecha.",
  /** Fallo de red o del servidor: reintentar es seguro (la base solo deja escribir una vez). */
  fallo: "No se pudo completar la operación. Volvé a intentarlo.",
} as const;

/**
 * Feature 293 (T5.2, R30) — textos del diálogo que pide el MOTIVO antes de anular.
 *
 * Molde: `AnularPagoDialog` (172/T F.5), que es el otro sitio del repo donde una decisión
 * irreversible exige un motivo escrito. Aquí es todavía más irreversible: por la guarda de
 * R17 el cupo de ese (mensajero, día) queda consumido y el premio no se puede volver a
 * registrar (Q2, cerrada), así que el diálogo lo dice antes de confirmar.
 */
export const ANULAR_PREMIO_TEXTO = {
  titulo: (mensajero: string) => `Anular el premio de ${mensajero}`,
  descripcion:
    "Se escribe un movimiento compensatorio por el mismo importe y su reverso en la caja. " +
    "Las filas originales no se tocan y el premio NO se podrá volver a registrar.",
  /** Qué se anula exactamente: el importe congelado y el día del podio. */
  resumen: (monto: string | null, fecha: string) =>
    `Premio de ${money(monto)} del podio del ${fecha}.`,
  motivo: "Motivo de la anulación",
  motivoAyuda: "Queda registrado en el movimiento compensatorio.",
  /** R30 — sin motivo no se llama a la action. El servidor lo revalida igualmente. */
  motivoRequerido: "Escribí el motivo de la anulación.",
  confirmar: "Anular el premio",
  cancelar: "Cancelar",
} as const;

/**
 * FICHA 298 (2026-08-27, pedido del humano) — LOS RÓTULOS DE LAS DOS PESTAÑAS de
 * `/wallet/mensajeros`.
 *
 * El día que la 293 estrenó el panel de premios lo dejó APILADO encima de la tabla de cuentas
 * por pagar, dentro de la misma sección: dos bloques con su propio selector, su propia tabla y
 * sus propios botones, uno detrás del otro. Acá no cambia ninguna regla —ni el registro del
 * premio ni lo que cada bloque enseña—: cambia DÓNDE vive cada uno.
 *
 * El ORDEN no es alfabético ni cronológico: a esta pantalla se entra a PAGAR lo que se debe, y
 * registrar el premio del podio es lo excepcional. Por eso «Cuentas por pagar» va primera y es
 * la que abre (`TabsGroup` selecciona la primera habilitada si nadie pide otra).
 *
 * El nombre accesible del grupo es DISTINTO del de la sección, del `<h1>` y del de la tabla
 * («Cuentas por pagar a mensajeros» los tres): si coincidiera, el nombre del `tablist` chocaría
 * con el de la región y el de la tabla, que es el fallo que la 277 ya documentó en «Por recoger».
 */
export const PESTANAS_MENSAJEROS = {
  /** Nombre accesible del `tablist`. */
  grupo: "Secciones de mensajeros",
  /** La de entrada: lo que se le debe a cada mensajero. */
  cuentas: "Cuentas por pagar",
  /** La excepcional: el premio del podio de un día (293/R1). */
  premios: "Premios del ranking",
} as const;
