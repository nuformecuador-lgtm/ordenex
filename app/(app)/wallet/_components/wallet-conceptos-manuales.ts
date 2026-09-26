import type {
  TipoEgresoManual,
  WalletMovimientoCategoria,
  WalletMovimientoTipo,
} from "@/lib/types/wallet";
import { TIPO_EGRESO_MANUAL_A_CATEGORIA } from "@/lib/types/wallet";
import type { WalletTiendaMovimientoCategoria } from "@/lib/types/wallet-tienda";
import type { ConceptoRegistro } from "@/lib/types/efecto-movimiento";
import type { PagoMensajeroMovimientoCategoria } from "@/lib/types/wallet-mensajero";

// Ficha 461 (R46, P4): el diálogo promete el nombre DESDE ORDENEX del libro de la tienda, que es el
// que la oficina lee en `/wallet/tiendas`; la tienda lo lee desde su lado en `/mi-wallet`.
import { CATEGORIA_TIENDA_LABEL } from "../tiendas/_components/desglose-tienda-labels";
// Ficha 458-C (R52): el nombre en el libro del MENSAJERO sale del diccionario que pinta ese libro.
import { CATEGORIA_PAGO_LABEL } from "../mensajeros/_components/wallet-mensajeros-labels";
import {
  CATEGORIA_LABEL,
  DESCRIPCION_EGRESO_LABEL,
  DESCRIPCION_EGRESO_PLACEHOLDER,
} from "./wallet-labels";

// Ficha 334 (D1, design §9) — el CATÁLOGO de conceptos que una persona puede registrar a mano
// en la caja principal. Es la ÚNICA fuente de los conceptos, y por eso la regla del gasto FIJO se
// puede afirmar sobre él con un test (R11): lo que no está aquí no se puede elegir.
//
// POR QUÉ NO VIVE EN `wallet-labels.ts`. Ese archivo es texto de pantalla; esto además lleva el
// ENRUTADO —a qué Server Action va cada concepto y con qué payload—, que es lo que hace posible
// que el usuario vea UN formulario mientras la base sigue recibiendo escrituras distintas
// (design §6: `origen_tipo` decide qué es reversable, y fusionarlo cambiaría eso en silencio).
//
// FICHA 381 (T H.1, design §4) — entró el QUINTO concepto, el cobro a una tienda, y la `categoria`
// se mudó DENTRO de `destino`, porque la de la caja y la de la tienda son dos enums distintos y el
// nombre prometido se busca en dos diccionarios distintos.
//
// FICHA 459 (T B.15, design §9) — entraron DOS conceptos más y el catálogo se AGRUPÓ por lo que le
// pasa al dinero (R59); cada concepto dice con una frase qué le pasa a la caja, a la tienda y a la
// ganancia (R60).
//
// FICHA 461 (T C.4, design §7.1/§7.6/§8, HD1/HD3) — TODOS los nombres se dicen desde Ordenex y
// diciendo quién le paga a quién («Ordenex le cobra a una tienda», «Ordenex paga un gasto de una
// tienda», «Corrección de caja (resta)»), y el cobro DEJA de ser el concepto que «no mueve la
// caja»: desde esta ficha escribe también su línea en la caja (un cargo, como el flete: sube la
// ganancia y baja «De las tiendas» sin tocar «Entró»), así que cae en los DOS libros como el pago
// de un gasto, y su grupo se llama por lo que hace («Se descuenta del saldo de una tienda»).
//
// FICHA 457 (design §8.1/§8.2, R54/R55/R67) — entra el OCTAVO concepto, «Una tienda le paga a
// Ordenex», en el grupo «Llega dinero a la caja»: una tienda con saldo en contra le paga a Ordenex
// lo que debe. Escribe en los DOS libros (el crédito en la tienda y el ingreso de terceros en la
// caja) y es el ÚNICO concepto que acredita dinero a una tienda (la guardia de alcance lo exige).
//
// FICHA 458-C (T C.1, design §4.1, R37–R43, R52) — el registro ÚNICO: entran «Ordenex le paga a una
// tienda» (172) y «Ordenex le paga a un mensajero» (205), los dos en «Sale dinero de Ordenex». Son
// DIEZ. Cada concepto dice además con qué clave del catálogo del servidor (`ConceptoRegistro`, la de
// `EFECTO_POR_TIPO`) se pide su «Así queda»: `CONCEPTO_REGISTRO_DE` es un `Record` total, así que un
// concepto nuevo no compila sin decidir su efecto. El pago a un mensajero NO tiene línea de caja
// ([P2] de la 173): su libro es el del mensajero y su `categoria` de caja es `null`.
//
// Módulo PURO: sin React y sin leer ningún reloj. La fecha del movimiento la pone el diálogo.

/**
 * Los DIEZ conceptos (ficha 458-C), en el orden en que se ofrecen: tres tramos CONSECUTIVOS, uno por
 * grupo. `gasto_fijo` NO está: lo emite el cron desde su plantilla (R38). El primero sigue siendo el
 * gasto de Ordenex: quien abre y registra sin tocar el catálogo registra lo mismo que antes.
 */
export const CONCEPTO_MANUAL_IDS = [
  "gasto_variable",
  "sueldo",
  "pago_por_cuenta_tienda",
  "ajuste_egreso",
  "pago_a_tienda",
  "pago_a_mensajero",
  "aporte_capital",
  "abono_tienda",
  "ajuste_ingreso",
  "cobro_tienda",
] as const;

export type ConceptoManualId = (typeof CONCEPTO_MANUAL_IDS)[number];

/**
 * A dónde va el concepto cuando se registra. Unión DISCRIMINADA a propósito: el diálogo no
 * elige action con un `if` sobre el id, sino sobre esta clase, así que un concepto nuevo que
 * olvidara declarar su destino no compila.
 *
 * FICHA 381 — la `categoria` viaja DENTRO de cada rama y con el tipo de SU libro. Declarar la del
 * libro equivocado no compila.
 *
 * FICHA 461 — el cobro escribe en los DOS libros (HD1): `categoria` es su línea en la CAJA (el
 * cargo `ingreso_cobro_tienda`) y `categoriaTienda` su débito en el libro de la tienda. Es la misma
 * forma que el pago de un gasto de una tienda. Ninguna de las dos VIAJA al servidor: el payload del
 * cobro sigue siendo tienda, monto, descripción, fecha y clave (R53); las decide el servicio.
 */
export type DestinoConcepto =
  | {
      readonly clase: "egreso_administrativo";
      readonly tipoEgreso: TipoEgresoManual;
      readonly categoria: WalletMovimientoCategoria;
    }
  | {
      readonly clase: "ajuste_manual";
      readonly tipo: WalletMovimientoTipo;
      readonly categoria: WalletMovimientoCategoria;
    }
  | {
      readonly clase: "cobro_tienda";
      readonly categoria: WalletMovimientoCategoria;
      readonly categoriaTienda: WalletTiendaMovimientoCategoria;
    }
  | {
      // FICHA 459 (R29): escribe en los DOS libros — la salida en la caja y el cargo en la tienda.
      readonly clase: "pago_por_cuenta_tienda";
      readonly categoria: WalletMovimientoCategoria;
      readonly categoriaTienda: WalletTiendaMovimientoCategoria;
    }
  | {
      // FICHA 459 (R68): entrada de capital de Ordenex en la caja.
      readonly clase: "aporte_capital";
      readonly categoria: WalletMovimientoCategoria;
    }
  | {
      // FICHA 457 (design §8.1): el pago de una tienda a Ordenex. Escribe en los DOS libros — el
      // ingreso de terceros en la caja y el CRÉDITO en la tienda. Ninguna de las dos viaja: las
      // decide el servicio.
      readonly clase: "abono_tienda";
      readonly categoria: "ingreso_abono_tienda";
      readonly categoriaTienda: "abono_tienda";
    }
  | {
      // FICHA 458-C (design §4.1): el pago de Ordenex a una tienda (172). Escribe en los DOS libros:
      // la salida en la caja y el DÉBITO en la tienda. Ninguna de las dos viaja.
      readonly clase: "pago_tienda";
      readonly categoria: "egreso_pago_tienda";
      readonly categoriaTienda: "pago_tienda";
    }
  | {
      // FICHA 458-C (design §4.1): el pago de Ordenex a un mensajero (reparto de la 205). NO tiene
      // línea de caja ([P2] de la 173): cae SOLO en el libro del mensajero.
      readonly clase: "pago_mensajero";
      readonly categoria: null;
      readonly categoriaMensajero: PagoMensajeroMovimientoCategoria;
    };

/**
 * FICHA 381 (R4) — EN QUÉ LIBRO acaba el movimiento. No es lo mismo que la clase del destino:
 * dos clases distintas (gasto administrativo y ajuste manual) caen en el MISMO libro, y por eso
 * lo que la pantalla le dice al usuario se resuelve por esto y no por la clase.
 *
 * FICHA 461: el cobro cae en los DOS, como el pago de un gasto. Ya no hay ningún concepto que
 * escriba SOLO en el libro de la tienda, así que esa variante desaparece del tipo.
 */
export type LibroDestino = "caja" | "caja_y_tienda" | "mensajero";

/**
 * FICHA 459 (R59) — los tres grupos del selector, por lo que le pasa al dinero.
 *
 * FICHA 461 (R40): «Sale dinero de Ordenex», «Llega dinero a la caja» y «Se descuenta del saldo de
 * una tienda». El tercero se llamaba `no_mueve` porque el cobro no tocaba la caja; ya la toca, y la
 * clave dice ahora lo que el grupo hace.
 */
export type GrupoConcepto = "sale" | "entra" | "descuenta";

export const GRUPO_CONCEPTO_LABEL: Record<GrupoConcepto, string> = {
  sale: "Sale dinero de Ordenex",
  entra: "Llega dinero a la caja",
  descuenta: "Se descuenta del saldo de una tienda",
};

export interface ConceptoManual {
  readonly id: ConceptoManualId;
  /** Cómo se llama el concepto DENTRO del selector. */
  readonly label: string;
  /** Etiqueta del campo de descripción (o motivo), adaptada al concepto (R9). */
  readonly descripcionLabel: string;
  /** Ejemplo de descripción, para que el campo no arranque mudo. */
  readonly descripcionPlaceholder: string;
  readonly destino: DestinoConcepto;
  /** FICHA 459 (R59): el grupo del selector. */
  readonly grupo: GrupoConcepto;
}

/**
 * Ficha 461 (design §7.1, R39): los nombres, desde Ordenex y diciendo quién le paga a quién.
 * Ficha 457: ocho.
 */
export const CONCEPTOS_MANUALES: readonly ConceptoManual[] = [
  {
    id: "gasto_variable",
    label: "Gasto de Ordenex",
    // Las dos etiquetas de la ficha 45 se conservan BYTE A BYTE (R9): se derivan de su
    // `Record` en vez de copiarse, que es lo que impide que la fusión las cambie sin querer.
    descripcionLabel: DESCRIPCION_EGRESO_LABEL.gasto_variable,
    descripcionPlaceholder: DESCRIPCION_EGRESO_PLACEHOLDER.gasto_variable,
    destino: {
      clase: "egreso_administrativo",
      tipoEgreso: "gasto_variable",
      categoria: TIPO_EGRESO_MANUAL_A_CATEGORIA.gasto_variable,
    },
    grupo: "sale",
  },
  {
    id: "sueldo",
    label: "Sueldo",
    descripcionLabel: DESCRIPCION_EGRESO_LABEL.sueldo,
    descripcionPlaceholder: DESCRIPCION_EGRESO_PLACEHOLDER.sueldo,
    destino: {
      clase: "egreso_administrativo",
      tipoEgreso: "sueldo",
      categoria: TIPO_EGRESO_MANUAL_A_CATEGORIA.sueldo,
    },
    grupo: "sale",
  },
  {
    // ⭑ FICHA 459 (R29/R61) — Ordenex SACA dinero de la caja para pagarle a un tercero en nombre
    // de la tienda, y se lo descuenta de su saldo. No es un cobro a la tienda (ese NO saca dinero
    // de la caja): la frase del efecto lo dice en voz alta (R60).
    id: "pago_por_cuenta_tienda",
    label: "Ordenex paga un gasto de una tienda",
    descripcionLabel: "Motivo del pago",
    descripcionPlaceholder: "Ej. Pauta de publicidad de la tienda",
    destino: {
      clase: "pago_por_cuenta_tienda",
      categoria: "egreso_pago_por_cuenta_tienda",
      categoriaTienda: "pago_por_cuenta",
    },
    grupo: "sale",
  },
  {
    id: "ajuste_egreso",
    label: "Corrección de caja (resta)",
    descripcionLabel: "Motivo de la corrección",
    descripcionPlaceholder: "Ej. Faltante encontrado al cuadrar la caja",
    destino: { clase: "ajuste_manual", tipo: "egreso", categoria: "egreso_ajuste" },
    grupo: "sale",
  },
  {
    // ⭑ FICHA 458-C (design §4.1, R37) — Ordenex le entrega a una tienda lo que tiene a su favor
    // (172). Sale dinero de la caja y baja «De las tiendas»; el tope (el saldo a favor) lo decide
    // el servidor.
    id: "pago_a_tienda",
    label: "Ordenex le paga a una tienda",
    descripcionLabel: "Motivo del pago",
    descripcionPlaceholder: "Ej. Entrega de lo recaudado en la primera quincena",
    destino: { clase: "pago_tienda", categoria: "egreso_pago_tienda", categoriaTienda: "pago_tienda" },
    grupo: "sale",
  },
  {
    // ⭑ FICHA 458-C (design §4.1, R37) — el reparto de la 205: el servidor imputa el importe a los
    // cierres pendientes del mensajero. Baja su cuenta por pagar; la caja no tiene línea propia
    // ([P2] de la 173).
    id: "pago_a_mensajero",
    label: "Ordenex le paga a un mensajero",
    descripcionLabel: "Motivo del pago",
    descripcionPlaceholder: "Ej. Pago de los cierres de la semana",
    destino: { clase: "pago_mensajero", categoria: null, categoriaMensajero: "liquidacion" },
    grupo: "sale",
  },
  {
    // ⭑ FICHA 459 (R68, R27) — dinero de Ordenex que entra a la caja y NO es ganancia. El importe
    // lo teclea una persona: la app nunca propone ni calcula uno. La clase (saldo inicial o
    // aporte) se sigue eligiendo dentro (P6 de la 461).
    id: "aporte_capital",
    label: "Aporte de dinero a la caja",
    descripcionLabel: "Motivo",
    descripcionPlaceholder: "Ej. Dinero con el que Ordenex empezó a usar la app",
    destino: { clase: "aporte_capital", categoria: "ingreso_aporte_capital" },
    grupo: "entra",
  },
  {
    // ⭑ FICHA 457 (design §8.1, R54) — una tienda con saldo en contra le paga a Ordenex lo que debe.
    // Llega dinero DE LA TIENDA (terceros): su saldo sube y la ganancia no cambia (ya se contó al
    // aprobar cada cierre). Solo con saldo en contra y hasta lo que debe: lo decide el servidor.
    id: "abono_tienda",
    label: "Una tienda le paga a Ordenex",
    descripcionLabel: "Motivo del pago",
    descripcionPlaceholder: "Ej. Pago de lo que debía por los fletes de septiembre",
    destino: {
      clase: "abono_tienda",
      categoria: "ingreso_abono_tienda",
      categoriaTienda: "abono_tienda",
    },
    grupo: "entra",
  },
  {
    // R7 — la corrección que SUMA. El nombre dice lo que le pasa al dinero, no el nombre del enum:
    // «ingreso_ajuste» no se le enseña a nadie.
    id: "ajuste_ingreso",
    label: "Corrección de caja (suma)",
    descripcionLabel: "Motivo de la corrección",
    descripcionPlaceholder: "Ej. Devolución de un pago hecho de más",
    destino: { clase: "ajuste_manual", tipo: "ingreso", categoria: "ingreso_ajuste" },
    grupo: "entra",
  },
  {
    // ⭑ FICHA 381 (R1) / FICHA 461 (HD1) — Ordenex le QUITA dinero disponible a una tienda; si no
    // lo tiene, su saldo queda en contra y se cobra más adelante, cuando la gestión vuelva a
    // generarle dinero a favor. Desde la 461 ese dinero pasa a ser ganancia de Ordenex y deja su
    // línea en la caja: un cargo, como el flete. No llega dinero nuevo.
    //
    // El nombre del selector dice la ACCIÓN y quién le paga a quién, no el nombre del enum.
    id: "cobro_tienda",
    label: "Ordenex le cobra a una tienda",
    descripcionLabel: "Motivo del cobro",
    descripcionPlaceholder: "Ej. Material de despacho entregado en bodega",
    destino: {
      clase: "cobro_tienda",
      categoria: "ingreso_cobro_tienda",
      categoriaTienda: "cobro_manual",
    },
    grupo: "descuenta",
  },
];

/**
 * Opciones del `Select` de concepto, en el orden del catálogo y con su GRUPO (R59): el `Select`
 * pinta un encabezado por tramo consecutivo.
 */
export const CONCEPTO_MANUAL_OPTIONS = CONCEPTOS_MANUALES.map((concepto) => ({
  value: concepto.id,
  label: concepto.label,
  group: GRUPO_CONCEPTO_LABEL[concepto.grupo],
}));

/**
 * FICHA 459 (R60) / FICHA 461 (R41, design §7.6) — qué le pasa, con cada concepto, al dinero de
 * Ordenex, al saldo de la tienda (si la afecta) y a la ganancia. UNA línea por concepto. `Record`
 * TOTAL: un concepto nuevo no compila sin su frase. Textos LITERALES del diseño.
 *
 * La del cobro es la que esta ficha existe para cambiar: no llega dinero nuevo, se toma del saldo a
 * favor de la tienda y pasa a ser ganancia de Ordenex (HD1). La frase de la 459 («La caja y la
 * ganancia no cambian») queda retirada y una guardia vigila que no vuelva.
 */
export const FRASE_DEL_EFECTO: Record<ConceptoManualId, string> = {
  gasto_variable: "Sale dinero de Ordenex y baja su ganancia.",
  sueldo: "Sale dinero de Ordenex para pagar un sueldo y baja su ganancia.",
  pago_por_cuenta_tienda:
    "Sale dinero de Ordenex hacia un tercero (Facebook, Jet Cargo…) y se descuenta del saldo de la tienda; la ganancia no cambia.",
  ajuste_egreso: "Sale dinero de la caja para corregir un descuadre y baja la ganancia de Ordenex.",
  // Ficha 458-C (R39): las dos frases nuevas, con la misma regla (una línea, quién le paga a quién).
  pago_a_tienda:
    "Sale dinero de Ordenex hacia la tienda y baja lo que Ordenex le debe; la ganancia no cambia.",
  pago_a_mensajero:
    "Ordenex le paga al mensajero lo que le debe por sus cierres y baja su cuenta por pagar; la ganancia no cambia.",
  aporte_capital: "Llega dinero de Ordenex a la caja; no es ganancia, la ganancia no cambia.",
  // Ficha 457 (design §8.2, R55): literal.
  abono_tienda:
    "Llega dinero de la tienda a la caja: paga lo que debe y su saldo sube; la ganancia de Ordenex no cambia.",
  ajuste_ingreso: "Llega dinero a la caja para corregir un descuadre y sube la ganancia de Ordenex.",
  cobro_tienda:
    "No llega dinero nuevo: se descuenta del saldo a favor de la tienda y pasa a ser ganancia de Ordenex; si la tienda no tiene saldo, queda en contra.",
};

/**
 * FICHA 381 (R4) — el libro contable en el que acaba el concepto. Se decide por la CLASE del
 * destino, que es el mismo discriminante del que cuelga la Server Action: no hay forma de que
 * la pantalla prometa un libro y el registro acabe en el otro.
 *
 * FICHA 459: el pago de un gasto de una tienda escribe en los DOS libros. FICHA 461: el cobro también.
 */
export function libroDelConcepto(concepto: ConceptoManual): LibroDestino {
  // FICHA 458-C: el pago a un mensajero cae SOLO en su libro; el pago a una tienda, en los dos.
  if (concepto.destino.clase === "pago_mensajero") return "mensajero";
  if (concepto.destino.clase === "pago_tienda") return "caja_y_tienda";
  if (concepto.destino.clase === "cobro_tienda") return "caja_y_tienda";
  if (concepto.destino.clase === "pago_por_cuenta_tienda") return "caja_y_tienda";
  // FICHA 457: el pago de una tienda a Ordenex también.
  if (concepto.destino.clase === "abono_tienda") return "caja_y_tienda";
  return "caja";
}

/**
 * R4 — con qué nombre aparecerá el movimiento EN EL LIBRO DE LA CAJA. Se DERIVA del diccionario
 * del libro y no se copia: el día que alguien renombre una categoría, el diálogo lo sigue solo en
 * vez de prometer un nombre que el libro ya no usa (R46).
 *
 * FICHA 461: TODOS los conceptos tienen ya una categoría de caja (el cobro escribe su cargo), así
 * que el nombre en la caja se lee siempre de `CATEGORIA_LABEL`. El nombre en el libro de la TIENDA,
 * para los dos conceptos que también escriben ahí, lo da `nombreEnElLibroDeLaTienda`.
 */
export function nombreEnElLibro(concepto: ConceptoManual): string {
  const { destino } = concepto;
  // FICHA 458-C: el pago a un mensajero no tiene línea de caja; su nombre es el de SU libro.
  if (destino.clase === "pago_mensajero") return CATEGORIA_PAGO_LABEL[destino.categoriaMensajero];
  return CATEGORIA_LABEL[destino.categoria];
}

/**
 * FICHA 459/461 — el nombre con que el concepto sale en el libro de la TIENDA, desde Ordenex
 * (`CATEGORIA_TIENDA_LABEL`, el mismo diccionario que pinta `/wallet/tiendas`; R46). Cadena vacía
 * para los conceptos que no escriben en ese libro.
 */
export function nombreEnElLibroDeLaTienda(concepto: ConceptoManual): string {
  const { destino } = concepto;
  return destino.clase === "pago_por_cuenta_tienda" ||
    destino.clase === "cobro_tienda" ||
    destino.clase === "abono_tienda" ||
    destino.clase === "pago_tienda"
    ? CATEGORIA_TIENDA_LABEL[destino.categoriaTienda]
    : "";
}

/**
 * FICHA 381 (R4) — la frase completa que el diálogo enseña bajo el selector: en qué libro cae
 * el movimiento y con qué nombre saldrá en él (R46).
 *
 * La frase de la CAJA se conserva BYTE A BYTE (R11 de la 381). FICHA 459/461 (design §9.1/§7.6):
 * la de los dos conceptos que escriben en los dos libros nombra los DOS, cada uno con el nombre de
 * su diccionario.
 */
const FRASE_DEL_LIBRO: Record<LibroDestino, (nombre: string, nombreTienda: string) => string> = {
  caja: (nombre) => `Se registra en el libro como «${nombre}».`,
  caja_y_tienda: (nombre, nombreTienda) =>
    `Se registra en la caja como «${nombre}» y en el libro de la tienda como «${nombreTienda}».`,
  // FICHA 458-C (R52): el pago a un mensajero, en el libro del mensajero y con el nombre de ese libro.
  mensajero: (nombre) => `Se registra en el libro del mensajero como «${nombre}».`,
};

/** R4 — «Se registra en el libro […] como «…».», ya resuelta para el concepto elegido. */
export function fraseDelLibro(concepto: ConceptoManual): string {
  return FRASE_DEL_LIBRO[libroDelConcepto(concepto)](
    nombreEnElLibro(concepto),
    nombreEnElLibroDeLaTienda(concepto),
  );
}

/**
 * FICHA 381 (R4/R11) — cabecera del diálogo para los conceptos que escriben SOLO en la caja. Los
 * DOS textos de la ficha 334 se conservan byte a byte.
 */
export const CABECERA_CAJA = {
  titulo: "Registrar movimiento en la caja",
  descripcion:
    "Elegí el concepto, el monto y la fecha. El movimiento es inmutable una vez registrado.",
} as const;

/**
 * FICHA 459 (design §9.1) / FICHA 461 (design §7.6) — la descripción de la cabecera de los dos
 * conceptos que escriben en los DOS libros; el título es el nombre del concepto. Ninguno se edita:
 * si hay un error, se anula desde el libro de la caja con un motivo (R19/R20). La del cobro ya no
 * dice «no se puede editar ni deshacer»: desde esta ficha SÍ se anula (HD1).
 */
const DESCRIPCION_CABECERA_DOS_LIBROS: Record<
  "pago_por_cuenta_tienda" | "cobro_tienda" | "abono_tienda" | "pago_tienda" | "pago_mensajero",
  string
> = {
  pago_por_cuenta_tienda:
    "Elegí la tienda, a quién se le pagó, el monto y la fecha. El pago no se puede editar: si hay un error, se anula desde el libro de la caja con un motivo.",
  cobro_tienda:
    "Elegí la tienda, el monto y la fecha. El cobro se descuenta de lo que Ordenex le debe a esa tienda y no se edita: si hay un error, se anula desde el libro de la caja con un motivo.",
  // FICHA 457 (design §8.1): literal.
  abono_tienda:
    "Elegí la tienda, el monto, la fecha real y el método. Solo se admite si la tienda tiene saldo en contra y hasta lo que debe. El pago no se edita: si hay un error, se anula desde el libro de la caja con un motivo.",
  // FICHA 458-C (design §4.1): los dos pagos de Ordenex.
  pago_tienda:
    "Elegí la tienda, el monto, la fecha real y el método. Solo se admite hasta lo que Ordenex le debe a la tienda. El pago no se edita: si hay un error, se anula con un motivo.",
  pago_mensajero:
    "Elegí el mensajero, el monto, la fecha real y el método. El importe se reparte entre sus cierres pendientes. El pago no se edita: si hay un error, se anula con un motivo.",
};

/**
 * FICHA 461 (R46) — la cabecera del diálogo, POR CONCEPTO: la fija de la caja para los que escriben
 * solo ahí, y el nombre del concepto como título para los que escriben en los dos libros. Un
 * encabezado que mienta sobre dónde va el dinero es exactamente el género de fallo mudo que este
 * repo persigue.
 */
export function cabeceraDelConcepto(concepto: ConceptoManual): {
  readonly titulo: string;
  readonly descripcion: string;
} {
  const { destino } = concepto;
  if (
    destino.clase === "pago_por_cuenta_tienda" ||
    destino.clase === "cobro_tienda" ||
    destino.clase === "abono_tienda" ||
    destino.clase === "pago_tienda" ||
    destino.clase === "pago_mensajero"
  ) {
    return { titulo: concepto.label, descripcion: DESCRIPCION_CABECERA_DOS_LIBROS[destino.clase] };
  }
  return CABECERA_CAJA;
}

/**
 * FICHA 458-C (design §4.4, R44) — con qué clave del catálogo del SERVIDOR se pide el «Así queda» de
 * cada concepto. `Record` TOTAL sobre los diez: es la MISMA tabla que `EFECTO_POR_TIPO` (TB.12), y
 * un concepto nuevo no compila sin decir cuál es su efecto.
 */
export const CONCEPTO_REGISTRO_DE: Record<ConceptoManualId, ConceptoRegistro> = {
  gasto_variable: "gasto_ordenex",
  sueldo: "sueldo",
  pago_por_cuenta_tienda: "pago_gasto_tienda",
  ajuste_egreso: "correccion_resta",
  pago_a_tienda: "pago_a_tienda",
  pago_a_mensajero: "pago_a_mensajero",
  aporte_capital: "aporte",
  abono_tienda: "tienda_paga_a_ordenex",
  ajuste_ingreso: "correccion_suma",
  cobro_tienda: "cobro_a_tienda",
};

/** FICHA 458-C (R41) — la cuenta que pide el concepto: una tienda, un mensajero o ninguna. */
export type CuentaDelConcepto = "tienda" | "mensajero" | null;

export function cuentaDelConcepto(concepto: ConceptoManual): CuentaDelConcepto {
  switch (concepto.destino.clase) {
    case "cobro_tienda":
    case "pago_por_cuenta_tienda":
    case "abono_tienda":
    case "pago_tienda":
      return "tienda";
    case "pago_mensajero":
      return "mensajero";
    default:
      return null;
  }
}

/**
 * FICHA 458-C (R42, D5) — «a quién» se le paga: OBLIGATORIO en sueldo y gasto de Ordenex, OPCIONAL
 * en la corrección de caja, y no se pide en los demás (el pago de un gasto de una tienda conserva su
 * beneficiario de la 459; los pagos y cobros nombran su cuenta).
 */
export function aQuienDelConcepto(concepto: ConceptoManual): "obligatorio" | "opcional" | null {
  if (concepto.destino.clase === "egreso_administrativo") return "obligatorio";
  if (concepto.destino.clase === "ajuste_manual") return "opcional";
  return null;
}

/** El concepto con ese id. `undefined` si no existe: quien lo llame decide qué hacer. */
export function conceptoPorId(id: string): ConceptoManual | undefined {
  return CONCEPTOS_MANUALES.find((concepto) => concepto.id === id);
}
