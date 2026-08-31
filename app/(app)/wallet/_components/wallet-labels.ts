import { money } from "@/lib/config/moneda";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";
import type {
  CajaResumenDTO,
  ModoComposicionCaja,
  NaturalezaMovimiento,
  TipoEgresoManual,
  WalletMovimientoCategoria,
  WalletMovimientoDTO,
  WalletMovimientoTipo,
  WalletOrigenTipo,
} from "@/lib/types/wallet";
import {
  TIPO_EGRESO_MANUAL_SEED,
  WALLET_MOVIMIENTO_CATEGORIA_SEED,
  WALLET_MOVIMIENTO_TIPO_SEED,
} from "@/lib/types/wallet";
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

/** Etiqueta legible del tipo de movimiento (ingreso/egreso). */
export const TIPO_LABEL: Record<WalletMovimientoTipo, string> = {
  ingreso: "Ingreso",
  egreso: "Egreso",
};

/** Etiqueta legible de cada categoría (concepto) del libro. */
export const CATEGORIA_LABEL: Record<WalletMovimientoCategoria, string> = {
  ingreso_flete: "Flete",
  ingreso_flete_devolucion: "Flete por rechazo",
  ingreso_comision_cod: "Comisión COD",
  ingreso_iva_flete: "IVA del flete",
  ingreso_iva_flete_devolucion: "IVA del flete por rechazo",
  ingreso_iva_comision_cod: "IVA de la comisión",
  ingreso_ajuste: "Ajuste (ingreso)",
  egreso_pago_tienda: "Pago a tienda",
  egreso_pago_mensajero: "Pago a mensajero",
  egreso_gasto: "Gasto",
  egreso_sueldo: "Sueldo",
  egreso_ajuste: "Ajuste (egreso)",
  egreso_gasto_fijo: "Gasto fijo",
  egreso_gasto_variable: "Gasto variable",
  egreso_indemnizacion: "Indemnización por incidente", // feature 158/R31
  // Feature 173 (R61, design §8) — las dos categorías de TESORERÍA. `CATEGORIA_LABEL` es un
  // `Record` completo: sin estas dos claves el build NO compila, que es exactamente la red que
  // obliga a bautizar cada concepto nuevo en vez de dejarlo caer con su nombre técnico.
  ingreso_cod_recaudado: "Contra-entrega cobrado",
  ingreso_reverso_pago_tienda: "Pago a tienda anulado",
};

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
export const CAJA_RESUMEN_LABEL = {
  enCaja: "Dinero en caja",
  enCajaPeriodo: "Movimiento neto del periodo",
  enCajaPista: "Todo lo que entró y salió, incluido el dinero de las tiendas",
  entradas: "Entró",
  salidas: "Salió",
  ganancia: "Ganancia de Ordenex",
  gananciaPista: "Lo que Ordenex gana menos lo que gasta",
  ingresosPropios: "Ingresos de Ordenex",
  egresosPropios: "Gastos de Ordenex",
  deTerceros: "Contra-entrega cobrado y aún no entregado a las tiendas",
  deTercerosEnlace: "Ver la deuda de cada tienda",
  // Feature 200 (tanda 1) — el TERCER tile de la cabecera. No es dinero: es cuántos registros
  // hay en el conjunto que se está mirando, y por eso se pinta en color neutro y sin insignia
  // de signo. La pista no nombra el control que recorta el conjunto: dice lo que la persona
  // ve, que es el periodo elegido.
  movimientos: "Movimientos",
  movimientosPista: "Registros del periodo que estás viendo",
} as const;

/** Pantalla donde SI vive la deuda con cada tienda, derivada del ledger por tienda (R35). */
export const CAJA_TIENDAS_HREF = "/wallet/tiendas";

/**
 * R60 — en que se diferencian las dos cifras, en espanol llano y SIN siglas. Se compone con
 * los dos rotulos reales para que no puedan desalinearse.
 */
export const CAJA_RESUMEN_NOTA_DIFERENCIA =
  `«${CAJA_RESUMEN_LABEL.enCaja}» incluye el contra-entrega que se cobró a nombre de las ` +
  `tiendas, que no es de Ordenex y hay que entregarlo. «${CAJA_RESUMEN_LABEL.ganancia}» no lo ` +
  `incluye: es solo lo que Ordenex gana menos lo que gasta.`;

/**
 * R34 / `[P6]` — la advertencia OBLIGATORIA de la tercera linea. Esa cifra es MAYOR que la
 * deuda con las tiendas, porque de ese dinero Ordenex todavia descuenta el flete, la comision
 * y el impuesto. Decir «lo que se les debe» aqui seria inventar una segunda respuesta a una
 * pregunta que ya tiene la suya en `/wallet/tiendas`.
 */
export const CAJA_RESUMEN_AVISO_TERCEROS =
  "No es lo que se les debe a las tiendas: es más, porque de este dinero Ordenex todavía " +
  "descuenta el flete, la comisión y el impuesto. La deuda exacta de cada tienda está en " +
  "Wallet → Tiendas.";

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
export const CAJA_COMPOSICION_MENSAJE: Record<ModoComposicionCaja, string | null> = {
  dos_bolsillos: null,
  // R16: con todas sus letras. Es el aviso mas importante de la pantalla.
  solo_tiendas:
    "Ordenex gastó más de lo que ganó, así que hay dinero de las tiendas cubriendo ese " +
    "saldo. Lo que se ve en la caja no alcanza para entregarles todo lo suyo.",
  // R17 (D4): el espejo — se entrego a las tiendas mas contra-entrega del que se cobro.
  solo_ordenex:
    "Se entregó a las tiendas más contra-entrega del que se cobró en este periodo, así que " +
    "todo lo que queda en la caja es de Ordenex.",
  // R18: nada que repartir. Ni se enuncia porcentaje ni se pinta segmento alguno.
  sin_reparto: "No hay nada que repartir: no queda dinero de las tiendas ni ganancia de Ordenex.",
};

/**
 * R13 — el nombre accesible de la barra: las DOS porciones, cada una con su rotulo y su
 * importe. Se compone a partir de las etiquetas de arriba y de los STRING del servidor;
 * money-safe, porque `money` solo da formato y nunca convierte el monto a numero.
 *
 * NO enuncia el porcentaje a proposito (R20): fuera de `dos_bolsillos` no existe reparto que
 * enunciar, y un nombre accesible que dependiera del modo diria cosas distintas segun el dia.
 */
export function composicionCajaNombreAccesible(resumen: CajaResumenDTO): string {
  return (
    `${CAJA_COMPOSICION_LABEL.barra}. ` +
    `${CAJA_COMPOSICION_LABEL.tiendas}: ${money(resumen.deTerceros)}. ` +
    `${CAJA_COMPOSICION_LABEL.ordenex}: ${money(resumen.ganancia)}.`
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
};

/** Etiqueta legible del origen de un movimiento. */
export const ORIGEN_LABEL: Record<WalletOrigenTipo, string> = {
  cierre_dia: "Cierre del día",
  gestion_orden: "Gestión de orden",
  manual: "Manual",
  pago_tienda: "Pago a tienda",
  pago_mensajero: "Pago a mensajero",
  gasto: "Gasto",
  // Feature 158/R37: origen del egreso de indemnizacion del camino del ADMIN. Sigue la forma
  // del hermano `gestion_orden` ("Gestión de orden"): nombra la ENTIDAD que origina el
  // movimiento, no la accion. `ORIGEN_LABEL` es un `Record` completo — sin esta clave el build
  // no compila, que es exactamente la red que obliga a decidir la etiqueta.
  orden_incidente: "Incidente de orden",
  // Feature 293 (T1.6, R20/R34): origen del egreso de caja del premio del ranking y de su
  // reverso — la FILA DEL PODIO del dia congelado. Misma forma que sus hermanos: nombra la
  // ENTIDAD que origina el movimiento.
  ranking_snapshot_fila: "Premio del ranking",
};

/** Opciones del `Select` de tipo (con opción "todos" = value ""). */
export const TIPO_OPTIONS = [
  { value: "", label: "Todos los tipos" },
  ...WALLET_MOVIMIENTO_TIPO_SEED.map((tipo) => ({
    value: tipo,
    label: TIPO_LABEL[tipo],
  })),
];

/** Opciones del `Select` de categoría, pobladas desde el SEED (con opción "todas"). */
export const CATEGORIA_OPTIONS = [
  { value: "", label: "Todas las categorías" },
  ...WALLET_MOVIMIENTO_CATEGORIA_SEED.map((categoria) => ({
    value: categoria,
    label: CATEGORIA_LABEL[categoria],
  })),
];

// ── Feature 45 — egresos administrativos (manual) ──

// Etiqueta legible de cada TIPO de egreso manual (R22a). El gasto FIJO NO figura: lo
// emite el cron, no el formulario manual (R2/R19).
export const TIPO_EGRESO_MANUAL_LABEL: Record<TipoEgresoManual, string> = {
  gasto_variable: "Gasto variable",
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
