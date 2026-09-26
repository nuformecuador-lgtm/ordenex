import { money } from "@/lib/config/moneda";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";
import type {
  CajaResumenDTO,
  ModoComposicionCaja,
  NaturalezaMovimiento,
  TipoEgresoManual,
  WalletMovimientoDTO,
  WalletMovimientoTipo,
} from "@/lib/types/wallet";
import { TIPO_EGRESO_MANUAL_SEED } from "@/lib/types/wallet";
import type { MotivoNoAnulable } from "@/lib/types/wallet-tienda";
import { fechaLegible } from "@/lib/utils/dia-reparto-textos";
import { proximoCobro, type PeriodicidadUnidad } from "@/lib/utils/periodicidad";

// Feature 42 (T12) — etiquetas i18n-ready y helper de moneda de la wallet, separados
// de la lógica (docs/conventions: textos de UI fuera del componente). Money-safe (R21/
// R25): `money` recibe un monto que YA viene como STRING desde el Server Component y solo
// le da formato; NUNCA parseFloat/Number sobre montos (no se pierde precisión).

/**
 * Feature 201 (tanda B): `money` se PROMOVIÓ a `lib/config/moneda.ts` sin cambiarle la
 * firma ni el marcador de ausencia (`"—"`), porque era la misma función copiada byte a byte
 * en siete archivos de etiquetas y por eso los importes se pintaban sin separador de miles
 * (`₡13331832.72`) sin que nadie pudiera arreglarlo en un solo sitio. Se re-exporta desde
 * aquí para que sus consumidores sigan importándola del mismo sitio: es una mudanza —el
 * mismo precedente que `montoValido` al final de este archivo—, y lo único que cambia es el
 * ASPECTO del importe, que es justamente el objetivo de la feature.
 *
 * Feature 231: pasa de `export { money } from …` a importar + re-exportar, porque este
 * módulo la NECESITA para componer el nombre accesible de la barra (R13). La forma
 * `export … from` no crea enlace local; el import sí, y los ~37 consumidores siguen
 * importándola de aquí sin cambiar una línea.
 */
export { money };

/**
 * Etiqueta legible de la DIRECCIÓN del movimiento. FICHA 458-E (R55, design §5.2): «Entra» / «Sale»,
 * las palabras del filtro Todo / Entra / Sale y del panel «Ver»; antes «Ingreso» / «Egreso».
 */
export const TIPO_LABEL: Record<WalletMovimientoTipo, string> = {
  ingreso: "Entra",
  egreso: "Sale",
};

export { CATEGORIA_LABEL } from "@/lib/constants/wallet-rotulos";

// ── Feature 173 (T G.1/T G.2, design §8) — las DOS cifras de la caja ──

/**
 * Rotulos de la tarjeta de la caja `[P1]`. Van aqui y no dentro del componente por la misma
 * regla que el resto del archivo (docs/conventions: textos de UI fuera del componente), y
 * porque los dos avisos de abajo se COMPONEN con ellos: el dia que alguien renombre una cifra,
 * el aviso la sigue en vez de quedarse hablando de un rotulo que ya no existe.
 *
 * `enCajaPeriodo` es el rotulo condicional `[P7]`: con filtros puestos, «Dinero en caja» ya no
 * es el dinero que hay sino el neto del periodo. El NUMERO no cambia; cambia el nombre. Y el
 * hecho de que haya filtros lo dice el SERVIDOR (`CajaResumenDTO.periodoFiltrado`), no una
 * deduccion del cliente sobre el estado de los `Select`.
 */
//
// ── Ficha 459 (design §3.1–§3.3, R15–R26) — la cifra principal cambia de NOMBRE según el estado ──
//
// El servidor decide el estado (`CajaResumenDTO.estado`, R14): «saldo» solo si una persona
// registró un saldo inicial vigente; «flujo» en cualquier otro caso. El NUMERO no cambia con el
// estado; cambia como se llama y lo que la tarjeta explica. Mientras sea «flujo», las palabras
// «Dinero en caja» no pueden aparecer en ningun rotulo, pista, aviso ni nombre accesible (R16):
// la app no sabe con cuanto dinero empezo Ordenex y no lo inventa (HF4, R27).
//
// Textos LITERALES de design §3.3. La pista y el aviso viejos de la 173 (la cifra «incluido el
// dinero de las tiendas» y el «de las tiendas es MÁS que lo que se les debe») se retiran: desde
// esta ficha «De las tiendas» SI es lo que se les debe (R23, R24), y una guardia vigila que no
// vuelvan (`tests/unit/guards/caja-textos-459.guardia.test.ts`).
export const CAJA_RESUMEN_LABEL = {
  /** R15 — estado «flujo», sin filtros. */
  flujo: "Flujo de dinero registrado",
  /** R15 — desde que dia cuenta y que NO es el saldo del banco. `dia` ya viene legible. */
  flujoPista: (dia: string) =>
    `Lo que entró menos lo que salió desde el ${dia}. No es el saldo del banco: la app no sabe con cuánto dinero empezó Ordenex.`,
  /** El libro de la caja esta vacio (`flujoDesde` null): no hay «desde» que decir. */
  flujoVacio: "Todavía no hay movimientos registrados.",
  /** R18 — estado «saldo», sin filtros. */
  enCaja: "Dinero en caja",
  enCajaPista:
    "El saldo inicial registrado más todo lo que entró menos todo lo que salió desde entonces, incluido el dinero de las tiendas.",
  /** R20 — con filtros, en cualquiera de los dos estados. */
  enCajaPeriodo: "Movimiento neto del periodo",
  entradas: "Entró",
  salidas: "Salió",
  ganancia: "Ganancia de Ordenex",
  gananciaPista: "Lo que Ordenex gana menos lo que gasta",
  ingresosPropios: "Ingresos de Ordenex",
  egresosPropios: "Gastos de Ordenex",
  /** R23 — desde esta ficha «De las tiendas» ES lo que Ordenex les debe. */
  deTerceros: "Lo que Ordenex les debe a las tiendas",
  deTercerosEnlace: "Ver la deuda de cada tienda",
  /** R25 — el capital de Ordenex, cifra propia junto a la ganancia. */
  capital: "Saldo inicial y aportes",
  capitalPista: "Dinero de Ordenex que no es ganancia.",
  // Feature 200 (tanda 1) — el TERCER tile de la cabecera. No es dinero: es cuántos registros
  // hay en el conjunto que se está mirando, y por eso se pinta en color neutro y sin insignia
  // de signo. La pista no nombra el control que recorta el conjunto: dice lo que la persona
  // ve, que es el periodo elegido.
  movimientos: "Movimientos",
  movimientosPista: "Registros del periodo que estás viendo",
} as const;

/** R17 — estado «flujo», sin filtros y la cifra principal negativa. */
export const CAJA_RESUMEN_AVISO_FLUJO_NEGATIVO =
  "Sale negativo porque parte de los pagos se hicieron con dinero que Ordenex ya tenía antes de usar la app, y ese dinero no está registrado aquí.";

/** R19 — estado «saldo», sin filtros y la cifra principal negativa. */
export const CAJA_RESUMEN_AVISO_SALDO_NEGATIVO =
  "El dinero en caja no puede ser negativo. Revisá el saldo inicial y los pagos registrados.";

/** R23 — «De las tiendas» negativo: son las tiendas las que le deben a Ordenex, y cuánto. */
export function CAJA_RESUMEN_TIENDAS_DEBEN(monto: string): string {
  return `Las tiendas le deben a Ordenex ${monto}.`;
}

/**
 * R23/R24 de la 459 — la explicacion de «De las tiendas». Sustituye al aviso de la 173 que decia
 * que la cifra era MAYOR que la deuda: con la derivacion de la 459 ya no lo es.
 *
 * Ficha 461 (HD1/HD2, R50): desde esta ficha el cobro de Ordenex a una tienda SI pasa por la caja
 * (es un cargo, como el flete: sube la ganancia y baja «De las tiendas»), asi que la frase de la 459
 * que afirmaba lo contrario de los cobros se RETIRA (la guardia `caja-textos-459` la vigila, y por
 * eso este comentario no la repite) y la suma nombra tambien lo que Ordenex les cobro.
 */
export const CAJA_RESUMEN_AVISO_TERCEROS =
  "Es la suma de los saldos de todas las tiendas, ya descontados el flete, la comisión, el impuesto y lo que Ordenex les cobró. El detalle de cada tienda está en Wallet → Tiendas.";

/** El dia del «desde» en palabras y con año: «25 de agosto de 2026» (design §3.1). */
function diaLegibleConAnio(fecha: string): string {
  return `${fechaLegible(fecha)} de ${fecha.slice(0, 4)}`;
}

/** Lo unico que el rotulo necesita saber del resumen: el hecho de los filtros y el estado. */
type EstadoDelRotulo = Pick<CajaResumenDTO, "periodoFiltrado" | "estado">;

/**
 * R15/R18/R20 — el NOMBRE de la cifra principal. UNA sola funcion para la tarjeta de `/wallet` y
 * para los KPIs de la analitica (T A.9): la misma cifra con dos nombres en dos pantallas se lee
 * como dos cifras. Los dos hechos los da el SERVIDOR; aqui solo se elige la palabra.
 */
export function rotuloCifraPrincipal(resumen: EstadoDelRotulo): string {
  if (resumen.periodoFiltrado) return CAJA_RESUMEN_LABEL.enCajaPeriodo;
  return resumen.estado === "saldo" ? CAJA_RESUMEN_LABEL.enCaja : CAJA_RESUMEN_LABEL.flujo;
}

/**
 * R15/R18 — la pista bajo la cifra principal, o `null` con filtros puestos: entonces lo que
 * explica la cifra es `CAJA_RESUMEN_AVISO_PERIODO`, porque ni «desde el primer dia» ni «el saldo
 * inicial mas…» describen un periodo recortado.
 */
export function pistaCifraPrincipal(
  resumen: EstadoDelRotulo & Pick<CajaResumenDTO, "flujoDesde">,
): string | null {
  if (resumen.periodoFiltrado) return null;
  if (resumen.estado === "saldo") return CAJA_RESUMEN_LABEL.enCajaPista;
  return resumen.flujoDesde === null
    ? CAJA_RESUMEN_LABEL.flujoVacio
    : CAJA_RESUMEN_LABEL.flujoPista(diaLegibleConAnio(resumen.flujoDesde));
}

/**
 * R17/R19 — la linea que explica una cifra principal negativa, o `null` si no toca. Solo sin
 * filtros: con un periodo elegido, un neto negativo es solo que salio mas de lo que entro. El
 * signo lo da el SERVIDOR (`signoEnCaja`); aqui no se compara ningun importe.
 */
export function avisoCifraNegativa(
  resumen: EstadoDelRotulo & Pick<CajaResumenDTO, "signoEnCaja">,
): string | null {
  if (resumen.periodoFiltrado || resumen.signoEnCaja !== "negativo") return null;
  return resumen.estado === "saldo"
    ? CAJA_RESUMEN_AVISO_SALDO_NEGATIVO
    : CAJA_RESUMEN_AVISO_FLUJO_NEGATIVO;
}

/** Pantalla donde SI vive la deuda con cada tienda, derivada del ledger por tienda (R35). */
export const CAJA_TIENDAS_HREF = "/wallet/tiendas";

/**
 * R60 de la 173, reescrita por la 459 (design §3.3) — en que se diferencian las dos cifras. Se
 * compone con el rotulo VIGENTE de la cifra principal, asi que en estado «flujo» tampoco aqui
 * aparece «Dinero en caja» (R16).
 */
export function CAJA_RESUMEN_NOTA_DIFERENCIA(rotulo: string): string {
  return (
    `«${rotulo}» cuenta todo el dinero, también el que es de las tiendas. ` +
    `«${CAJA_RESUMEN_LABEL.ganancia}» es solo lo que Ordenex gana menos lo que gasta: no incluye ` +
    `el dinero de las tiendas ni el saldo inicial o los aportes.`
  );
}

/** `[P7]` — por que la cifra grande cambia de nombre cuando hay filtros puestos. */
export const CAJA_RESUMEN_AVISO_PERIODO =
  `Con filtros puestos esta cifra no es el dinero que hay hoy en la caja: es lo que entró ` +
  `menos lo que salió en el periodo que elegiste.`;

// ── Feature 231 (T4.1, design §4.2) — la caja partida en DOS BOLSILLOS ──

/**
 * Rotulos de la barra de composicion y de sus dos bloques (R2/R3). Van aqui, y no dentro del
 * componente, por la misma regla que el resto del archivo (docs/conventions: textos de UI
 * fuera del componente) y porque el nombre accesible de la barra se COMPONE con ellos: el dia
 * que alguien renombre un bolsillo, lo que oye un lector de pantalla lo sigue.
 *
 * Vocabulario de maestro, no de contador (R59 de la 173): «de las tiendas» y «de Ordenex»,
 * nunca «terceros», «propio» ni el nombre de ningun enum.
 */
export const CAJA_COMPOSICION_LABEL = {
  barra: "Reparto del dinero en caja",
  tiendas: "De las tiendas",
  ordenex: "De Ordenex",
} as const;

/**
 * Lo que hay que DECIR en cada modo, cuando la barra no se puede partir en dos (R16/R17/R18).
 *
 * `Record` TOTAL sobre los cuatro modos: un modo nuevo en el servidor rompe el build de la
 * pantalla en vez de caer en un `default` mudo. `null` en `dos_bolsillos` NO es un hueco: es
 * el caso normal, donde los dos bloques se explican solos con su importe y su pista.
 */
//
// Ficha 459 (design §3.4, R26) — los tres mensajes, reescritos con el significado nuevo: «De las
// tiendas» es lo que se les DEBE (R5) y «De Ordenex» es ganancia MAS aportes (R11). La barra y
// estos mensajes solo se pintan en estado «saldo» (R22).
export const CAJA_COMPOSICION_MENSAJE: Record<ModoComposicionCaja, string | null> = {
  dos_bolsillos: null,
  // R16 de la 231: con todas sus letras. Es el aviso mas importante de la pantalla.
  solo_tiendas:
    "Lo de Ordenex (ganancia más aportes) está en negativo, así que hay dinero de las tiendas cubriendo ese saldo. Lo que hay en la caja no alcanza para entregarles todo lo suyo.",
  // R17 de la 231 (D4): el espejo — «De las tiendas» negativo.
  solo_ordenex:
    "Las tiendas le deben a Ordenex, así que todo lo que hay en la caja es de Ordenex y además hay dinero por cobrarles.",
  // R18 de la 231: nada que repartir. Ni se enuncia porcentaje ni se pinta segmento alguno.
  sin_reparto:
    "No hay nada que repartir: ni Ordenex ni las tiendas tienen dinero a favor en la caja.",
};

/**
 * R13 de la 231 — el nombre accesible de la barra: las DOS porciones, cada una con su rotulo y
 * su importe. Ficha 459 (design §3.4): el bolsillo de Ordenex es «De Ordenex» (ganancia y
 * aportes), no la ganancia a secas. La barra solo se monta en estado «saldo», asi que «dinero en
 * caja» es cierto donde aparece (R16).
 *
 * NO enuncia el porcentaje a proposito (R20): fuera de `dos_bolsillos` no existe reparto que
 * enunciar, y un nombre accesible que dependiera del modo diria cosas distintas segun el dia.
 */
export function composicionCajaNombreAccesible(resumen: CajaResumenDTO): string {
  return (
    `${CAJA_COMPOSICION_LABEL.barra}. ` +
    `${CAJA_COMPOSICION_LABEL.tiendas}: ${money(resumen.deTerceros)}. ` +
    `${CAJA_COMPOSICION_LABEL.ordenex}: ${money(resumen.deOrdenex)} (ganancia y aportes).`
  );
}

/**
 * R33/R34 — de quien es el dinero de un movimiento, en palabras. El servidor manda el campo
 * `dueno` ya derivado (R31/R36): esto solo lo bautiza.
 *
 * `Record` TOTAL sobre `NaturalezaMovimiento`: una naturaleza nueva rompe el build hasta que
 * alguien decida como se llama en pantalla. SINGULAR («Tienda», no «Tiendas») porque rotula
 * UNA fila del libro, no un conjunto.
 */
export const DUENO_LABEL: Record<NaturalezaMovimiento, string> = {
  propio: "Ordenex",
  terceros: "Tienda",
  // Ficha 459 (design §5) — el saldo inicial y los aportes de capital.
  capital: "Ordenex (capital)",
};

export { ORIGEN_LABEL } from "@/lib/constants/wallet-rotulos";

// ── Ficha 459 (design §9.4, R66/R67) — las acciones del libro sobre un DOCUMENTO ──
//
// Solo la fila ORIGINAL de un documento lleva `documento` (`WalletMovimientoDTO.documento`,
// resuelto en el servidor): el pago de un gasto de una tienda, el aporte de dinero a la caja y,
// desde la ficha 461, la linea de caja de un cobro de Ordenex a una tienda (propia o completada,
// R20/R37) y la correccion de caja (R71). Los contra-asientos y las salidas de los cobros
// reclasificados llegan con `documento: null` y no ofrecen nada (R66). Ningun texto nombra un
// identificador interno (R100): el documento se nombra por lo que la persona ve en la fila (el
// concepto, la fecha y el importe).

/** Que tipo de documento es, en palabras de la fila (para el titulo del dialogo de anulacion). */
export const DOCUMENTO_CAJA_NOMBRE: Record<
  NonNullable<WalletMovimientoDTO["documento"]>["tipo"],
  string
> = {
  // Ficha 461 (design §7): los nombres desde Ordenex, en minuscula porque van dentro de «Anular …».
  pago_por_cuenta_tienda: "el pago de un gasto de una tienda",
  aporte_capital: "el aporte de dinero a la caja",
  cobro_tienda: "el cobro de Ordenex a una tienda",
  ajuste_caja: "la corrección de caja",
  // Ficha 457 (design §2/§8.5).
  abono_tienda: "el pago de una tienda a Ordenex",
  // Ficha 458-B (design §3.6): los egresos sin documento, la indemnización y el cobro por rechazo.
  egreso_caja: "el gasto de la caja",
  indemnizacion: "la indemnización por un incidente",
  rechazo_tienda_cobro: "el cobro por rechazo a una tienda",
};

/**
 * Ficha 461 (design §9, R17) — por que un cobro NO se puede anular desde el libro, en palabras.
 * `Record` total sobre los dos motivos que el servidor puede devolver en `no_anulable`.
 */
export const MOTIVO_NO_ANULABLE_LABEL: Record<MotivoNoAnulable, string> = {
  reclasificado: "se reclasificó como pago de un gasto de la tienda",
  sin_linea_de_caja: "no tiene su línea en la caja",
};

export const DOCUMENTO_CAJA_ACCION = {
  anular: "Anular…",
  anulado: "Anulado",
  verComprobante: "Ver comprobante",
  /** Nombre accesible de «Anular…», con la fila dentro: una tabla con N botones iguales no identifica nada. */
  anularNombre: (concepto: string, fecha: string, monto: string) =>
    `Anular ${concepto} del ${fecha} por ${monto}`,
  verComprobanteNombre: (concepto: string, fecha: string) =>
    `Ver comprobante de ${concepto} del ${fecha}`,
} as const;

export const ANULAR_DOCUMENTO_CAJA_TEXTO = {
  titulo: (tipo: string) => `Anular ${tipo}`,
  /** R47/R74: la anulacion no borra nada; escribe el movimiento contrario, fechado hoy. */
  descripcion: (monto: string) =>
    `Se registrará hoy un movimiento contrario por ${monto}. El registro original, su comprobante y su historial quedan intactos: no se borra nada.`,
  motivo: "Motivo de la anulación",
  motivoAyuda: "Obligatorio. Queda guardado junto a la anulación.",
  motivoVacio: "Escribí el motivo de la anulación.",
  confirmar: "Anular",
  cancelar: "Cancelar",
} as const;

export const ANULAR_DOCUMENTO_CAJA_RESPUESTA = {
  ok: "Anulado. Se registró el movimiento contrario.",
  yaAnulado: "Ya estaba anulado; no se registró nada más.",
  noEncontrado: "No se encontró ese registro.",
  forbidden: "No tenés permiso para anular este registro.",
  unauthenticated: "Tu sesión expiró. Iniciá sesión de nuevo.",
  validacion: "No se pudo anular: revisá el motivo.",
  fallo: "No se pudo anular ahora. Probá de nuevo.",
  /** Ficha 461 (design §9, R17): el servidor dice POR QUE, y la pantalla lo repite en palabras. */
  noAnulable: (motivo: MotivoNoAnulable) =>
    `Este cobro no se puede anular desde aquí: ${MOTIVO_NO_ANULABLE_LABEL[motivo]}.`,
} as const;


export const VER_COMPROBANTE_RESPUESTA = {
  sinComprobante: "Este registro no tiene comprobante.",
  noEncontrado: "No se encontró el comprobante.",
  forbidden: "No tenés permiso para ver este comprobante.",
  unauthenticated: "Tu sesión expiró. Iniciá sesión de nuevo.",
  fallo: "No se pudo abrir el comprobante ahora. Probá de nuevo.",
} as const;

// FICHA 458-E (TE.2): el `Select` de tipo (`TIPO_OPTIONS`) sale; lo sustituye el filtro Todo / Entra / Sale
// (`FILTRO_DIRECCION` en `libro-caja-labels.ts`).

/**
 * La opción «todas» del `Select` de categoría del libro. El resto de opciones ya NO sale del
 * catálogo completo (458-A, R13/R14): son los conceptos con movimientos del periodo, que lee
 * `WalletFiltros` del servidor y rotula con `CATEGORIA_LABEL` (`opcionesDeConceptos`).
 */
export const CATEGORIA_TODAS_OPTION = { value: "", label: "Todas las categorías" } as const;

// ── Feature 45 — egresos administrativos (manual) ──

// Etiqueta legible de cada TIPO de egreso manual (R22a). El gasto FIJO NO figura: lo
// emite el cron, no el formulario manual (R2/R19).
//
// Ficha 461 (design §7.1): «Gasto de Ordenex», el mismo nombre que el concepto del dialogo y que
// `CATEGORIA_LABEL.egreso_gasto_variable`; el nombre de la 45 queda retirado (design §7.9).
export const TIPO_EGRESO_MANUAL_LABEL: Record<TipoEgresoManual, string> = {
  gasto_variable: "Gasto de Ordenex",
  sueldo: "Sueldo",
};

/** Opciones del `Select` de tipo del egreso manual (solo {gasto variable, sueldo}). */
export const TIPO_EGRESO_MANUAL_OPTIONS = TIPO_EGRESO_MANUAL_SEED.map((tipo) => ({
  value: tipo,
  label: TIPO_EGRESO_MANUAL_LABEL[tipo],
}));

// Etiqueta del campo descripción, adaptada al tipo de egreso (R5/R22a): el concepto del
// gasto variable, o el nombre del trabajador + periodo del sueldo (texto libre, F1.4-c).
export const DESCRIPCION_EGRESO_LABEL: Record<TipoEgresoManual, string> = {
  gasto_variable: "Concepto del gasto",
  sueldo: "Trabajador y periodo",
};

export const DESCRIPCION_EGRESO_PLACEHOLDER: Record<TipoEgresoManual, string> = {
  gasto_variable: "Ej. Compra de suministros de oficina",
  sueldo: "Ej. Juan Pérez — julio 2026",
};

/**
 * Feature 172 (T D.1): `montoValido` se PROMOVIÓ a `components/shared/monto-cliente.ts` sin
 * cambiarle una línea, porque el formulario de pago de la liquidación —que vive en
 * `components/shared/` y no puede depender de `app/`— es la cuarta feature que lo necesita
 * con la misma API. Se re-exporta desde aquí para que los cinco consumidores actuales (42,
 * 45, 158 y sus tests) sigan importándolo del mismo sitio: es una mudanza, no un cambio de
 * comportamiento.
 */
export { montoValido } from "@/components/shared/monto-cliente";

/** Un egreso administrativo es reversable (R22c/R32): `tipo=egreso` ∧ `origen_tipo=gasto`. */
export function esEgresoAdministrativo(m: WalletMovimientoDTO): boolean {
  return m.tipo === "egreso" && m.origenTipo === "gasto";
}

// ── Feature 85 (T F.1, design §4.2) — cada cuánto se cobra una plantilla de gasto fijo ──
//
// Módulo PURO también en esta parte: sin React, sin `Intl` y SIN LEER NINGÚN RELOJ. El único
// helper que necesita un instante (`proximoCobroTexto`) lo recibe por parámetro, igual que
// `lib/utils/periodicidad.ts` y por el mismo motivo que `lib/utils/dia-reparto-textos.ts`: un
// portátil con la hora corrida no puede etiquetar mal una fila (R23).

/**
 * Las CUATRO periodicidades que nombró el pedido, con su equivalencia en el modelo
 * `unidad + cantidad` que la ficha 84 dejó en la base.
 *
 * Viven aquí —en la etiqueta de un selector— y NO como un enum de la base (design §5, A5): la
 * tabla admite «cada 3 días» o «cada 6 meses», y eso no cabe en cuatro nombres. Nadie deduce
 * que «quincenal» son 2 semanas leyendo un selector de unidades: por eso el nombre existe.
 */
export const PERIODICIDAD_PRESETS = [
  { id: "diaria", label: "Diaria", unidad: "dias", cantidad: 1 },
  { id: "semanal", label: "Semanal", unidad: "semanas", cantidad: 1 },
  { id: "quincenal", label: "Quincenal", unidad: "semanas", cantidad: 2 },
  { id: "mensual", label: "Mensual", unidad: "meses", cantidad: 1 },
] as const;

/** Id de uno de los cuatro presets del pedido. */
export type PeriodicidadPresetId = (typeof PERIODICIDAD_PRESETS)[number]["id"];

/** El ciclo que no cabe en ningún preset: «cada N días/semanas/meses». */
export const PERIODICIDAD_PERSONALIZADA = "personalizada";

/** Lo que puede estar elegido en el selector «Cada cuánto se cobra». */
export type PeriodicidadSeleccion = PeriodicidadPresetId | typeof PERIODICIDAD_PERSONALIZADA;

/** Opciones del `Select` «Cada cuánto se cobra»: los cuatro presets + «Personalizada». */
export const PERIODICIDAD_OPTIONS = [
  ...PERIODICIDAD_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
  { value: PERIODICIDAD_PERSONALIZADA, label: "Personalizada" },
];

/** Las tres unidades del modelo, en orden de menor a mayor. */
const PERIODICIDAD_UNIDADES = ["dias", "semanas", "meses"] as const;

/** Nombre de cada unidad como opción de un selector (rótulo, en mayúscula inicial). */
export const PERIODICIDAD_UNIDAD_LABEL: Record<PeriodicidadUnidad, string> = {
  dias: "Días",
  semanas: "Semanas",
  meses: "Meses",
};

/** Opciones del `Select` de unidad del ciclo propio. */
export const PERIODICIDAD_UNIDAD_OPTIONS = PERIODICIDAD_UNIDADES.map((unidad) => ({
  value: unidad,
  label: PERIODICIDAD_UNIDAD_LABEL[unidad],
}));

/** La unidad DENTRO de una frase («Cada 3 días»), en singular y en plural. */
const UNIDAD_EN_FRASE: Record<PeriodicidadUnidad, [singular: string, plural: string]> = {
  dias: ["día", "días"],
  semanas: ["semana", "semanas"],
  meses: ["mes", "meses"],
};

/**
 * R20 — cada cuánto se cobra, EN PALABRAS: el nombre del preset cuando el par
 * `unidad + cantidad` coincide con uno de los cuatro, y «Cada N días/semanas/meses» para
 * cualquier otro ciclo.
 *
 * El singular (`Cada 1 mes`) queda como red: con cantidad 1 las tres unidades SON un preset,
 * así que hoy no se alcanza. Se escribe igual para que una periodicidad nueva no estrene la
 * pantalla con un «Cada 1 meses».
 */
export function periodicidadLegible(unidad: PeriodicidadUnidad, cantidad: number): string {
  const preset = PERIODICIDAD_PRESETS.find(
    (p) => p.unidad === unidad && p.cantidad === cantidad,
  );
  if (preset) return preset.label;
  // El `??` no es paranoia decorativa: `unidad` viene de un enum cerrado y el `Record` la
  // cubre siempre, pero esta función la EJECUTA también la guardia de datos sensibles de las
  // descargas (`tests/unit/descarga/columnas-sensibles.guardia.test.ts`) con una sonda —un
  // Proxy que responde a cualquier lectura—, y una unidad que no es ninguna de las tres no
  // puede reventar la generación de un archivo. Se dice la unidad TAL CUAL en vez de
  // inventarle un nombre, mismo criterio que `fechaLegible` con lo que no es una fecha.
  const [singular, plural] = UNIDAD_EN_FRASE[unidad] ?? [String(unidad), String(unidad)];
  return `Cada ${cantidad} ${cantidad === 1 ? singular : plural}`;
}

/** Qué opción del selector representa un ciclo dado; `"personalizada"` si no es un preset. */
export function presetDePeriodicidad(
  unidad: PeriodicidadUnidad,
  cantidad: number,
): PeriodicidadSeleccion {
  const preset = PERIODICIDAD_PRESETS.find(
    (p) => p.unidad === unidad && p.cantidad === cantidad,
  );
  return preset ? preset.id : PERIODICIDAD_PERSONALIZADA;
}

/** R19 — lo que dice la celda de «Próximo cobro» de una plantilla DESACTIVADA. */
export const PROXIMO_COBRO_INACTIVA = "No se cobra";

/**
 * R18/R19 — la celda de «Próximo cobro», en palabras: «14 de septiembre de 2026».
 *
 * CON AÑO SIEMPRE: un ciclo de seis meses cruza el año, y «14 de mayo» a secas sería ambiguo
 * en una tabla que mezcla plantillas de periodicidades distintas.
 *
 * `activa` NO entra en la aritmética (design §3.4): `proximoCobro` no sabe si la plantilla
 * está apagada, y no tiene por qué —una plantilla inactiva sigue teniendo ciclo, lo que no
 * tiene es cobros—. Que eso se lea «No se cobra» es una decisión de presentación, y vive aquí.
 */
export function proximoCobroTexto(plantilla: GastoFijoPlantillaDTO, ahora: Date): string {
  if (!plantilla.activa) return PROXIMO_COBRO_INACTIVA;
  const fecha = proximoCobro(plantilla, ahora);
  return `${fechaLegible(fecha)} de ${fecha.slice(0, 4)}`;
}
