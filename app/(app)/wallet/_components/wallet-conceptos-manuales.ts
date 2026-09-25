import type {
  TipoEgresoManual,
  WalletMovimientoCategoria,
  WalletMovimientoTipo,
} from "@/lib/types/wallet";
import { TIPO_EGRESO_MANUAL_A_CATEGORIA } from "@/lib/types/wallet";
import type { WalletTiendaMovimientoCategoria } from "@/lib/types/wallet-tienda";

import { CATEGORIA_TIENDA_LABEL } from "../../mi-wallet/_components/mi-wallet-labels";
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
// FICHA 381 (T H.1, design §4) — entra un QUINTO concepto y ya no todos van a la caja: cobrarle
// un costo a una tienda escribe en el libro de ESA tienda (`wallet_tienda_movimiento`) y no
// produce ningún movimiento en la caja de Ordenex (R24, decisión D1 del humano). Eso obliga al
// único cambio de forma de este módulo: la `categoria` se muda DENTRO de `destino`, porque la de
// la caja y la de la tienda son dos enums distintos y `nombreEnElLibro` las busca en dos
// diccionarios distintos. Con la categoría fuera del destino, un concepto de caja con una
// categoría de tienda compilaría.
//
// FICHA 459 (T B.15, design §9) — entran DOS conceptos más y el catálogo se AGRUPA por lo que le
// pasa a la caja (R59): «Sale dinero de la caja», «Entra dinero a la caja» y «No mueve la caja».
// El pago por cuenta de una tienda escribe en los DOS libros (sale de la caja y baja el saldo de
// la tienda); el saldo inicial o aporte de capital entra a la caja como dinero de Ordenex que NO
// es ganancia. Cada concepto dice con una frase qué le pasa a la caja, a la tienda y a la ganancia
// (R60), y el pago por cuenta y el cobro de un costo dicen cosas OPUESTAS sobre la caja.
//
// Módulo PURO: sin React y sin leer ningún reloj. La fecha del movimiento la pone el diálogo.

/**
 * Los SIETE conceptos, en el orden en que se ofrecen: tres tramos CONSECUTIVOS, uno por grupo
 * (el `Select` agrupa por tramos, `components/ui/select.tsx`). `gasto_fijo` NO está: lo emite el
 * cron. El primero sigue siendo el gasto variable: quien abre y registra sin tocar el selector
 * registra lo mismo que antes.
 */
export const CONCEPTO_MANUAL_IDS = [
  "gasto_variable",
  "sueldo",
  "pago_por_cuenta_tienda",
  "ajuste_egreso",
  "aporte_capital",
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
      readonly categoria: WalletTiendaMovimientoCategoria;
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
    };

/**
 * FICHA 381 (R4) — EN QUÉ LIBRO acaba el movimiento. No es lo mismo que la clase del destino:
 * dos clases distintas (gasto administrativo y ajuste manual) caen en el MISMO libro, y por eso
 * lo que la pantalla le dice al usuario se resuelve por esto y no por la clase.
 *
 * FICHA 459 (design §9.1): el pago por cuenta cae en los DOS.
 */
export type LibroDestino = "caja" | "tienda" | "caja_y_tienda";

/** FICHA 459 (R59) — los tres grupos del selector, por lo que le pasa a la caja. */
export type GrupoConcepto = "sale" | "entra" | "no_mueve";

export const GRUPO_CONCEPTO_LABEL: Record<GrupoConcepto, string> = {
  sale: "Sale dinero de la caja",
  entra: "Entra dinero a la caja",
  no_mueve: "No mueve la caja",
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

export const CONCEPTOS_MANUALES: readonly ConceptoManual[] = [
  {
    id: "gasto_variable",
    label: "Gasto variable",
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
    // de la tienda, y se lo descuenta de su saldo. No es un cobro de un costo (ese NO saca
    // dinero de la caja): la frase del efecto lo dice en voz alta (R60).
    id: "pago_por_cuenta_tienda",
    label: "Pago por cuenta de una tienda",
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
    label: "Ajuste que resta dinero",
    descripcionLabel: "Motivo del ajuste",
    descripcionPlaceholder: "Ej. Faltante encontrado al cuadrar la caja",
    destino: { clase: "ajuste_manual", tipo: "egreso", categoria: "egreso_ajuste" },
    grupo: "sale",
  },
  {
    // ⭑ FICHA 459 (R68, R27) — dinero de Ordenex que entra a la caja y NO es ganancia. El importe
    // lo teclea una persona: la app nunca propone ni calcula uno.
    id: "aporte_capital",
    label: "Saldo inicial o aporte de capital",
    descripcionLabel: "Motivo",
    descripcionPlaceholder: "Ej. Dinero con el que Ordenex empezó a usar la app",
    destino: { clase: "aporte_capital", categoria: "ingreso_aporte_capital" },
    grupo: "entra",
  },
  {
    // R7 — el ajuste que SUMA. El nombre dice lo que le pasa al dinero, no el nombre del enum:
    // «ingreso_ajuste» no se le enseña a nadie.
    id: "ajuste_ingreso",
    label: "Ajuste que suma dinero",
    descripcionLabel: "Motivo del ajuste",
    descripcionPlaceholder: "Ej. Devolución de un pago hecho de más",
    destino: { clase: "ajuste_manual", tipo: "ingreso", categoria: "ingreso_ajuste" },
    grupo: "entra",
  },
  {
    // ⭑ FICHA 381 (R1) — el único que no toca la caja de Ordenex. Lo que hace es QUITARLE dinero
    // disponible a una tienda; si no lo tiene, su saldo queda en negativo y se cobra más
    // adelante, cuando la gestión vuelva a generarle dinero a favor (D3).
    //
    // El nombre del selector dice la ACCIÓN y a quién afecta, no el nombre del enum.
    id: "cobro_tienda",
    label: "Cobrar un costo a una tienda",
    descripcionLabel: "Motivo del cobro",
    descripcionPlaceholder: "Ej. Material de despacho entregado en bodega",
    destino: { clase: "cobro_tienda", categoria: "cobro_manual" },
    grupo: "no_mueve",
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
 * FICHA 459 (R60, design §9.2) — qué le pasa, con cada concepto, a la caja, al saldo de la tienda
 * (si la afecta) y a la ganancia de Ordenex. `Record` TOTAL: un concepto nuevo no compila sin su
 * frase. Textos LITERALES del diseño.
 */
export const FRASE_DEL_EFECTO: Record<ConceptoManualId, string> = {
  gasto_variable: "Sale dinero de la caja y baja la ganancia de Ordenex.",
  sueldo: "Sale dinero de la caja y baja la ganancia de Ordenex.",
  ajuste_egreso: "Sale dinero de la caja y baja la ganancia de Ordenex.",
  pago_por_cuenta_tienda:
    "Sale dinero de la caja: Ordenex le paga a otro en nombre de la tienda y se lo descuenta de su saldo. La ganancia de Ordenex no cambia.",
  aporte_capital: "Entra dinero de Ordenex a la caja. No es ganancia: la ganancia no cambia.",
  ajuste_ingreso: "Entra dinero a la caja y sube la ganancia de Ordenex.",
  cobro_tienda:
    "No sale ni entra dinero: es un cobro de Ordenex a la tienda que baja su saldo. La caja y la ganancia no cambian.",
};

/**
 * FICHA 381 (R4) — el libro contable en el que acaba el concepto. Se decide por la CLASE del
 * destino, que es el mismo discriminante del que cuelga la Server Action: no hay forma de que
 * la pantalla prometa un libro y el registro acabe en el otro.
 */
export function libroDelConcepto(concepto: ConceptoManual): LibroDestino {
  if (concepto.destino.clase === "cobro_tienda") return "tienda";
  // FICHA 459: el pago por cuenta escribe en los DOS libros.
  if (concepto.destino.clase === "pago_por_cuenta_tienda") return "caja_y_tienda";
  return "caja";
}

/**
 * R4 — con qué nombre aparecerá el movimiento EN EL LIBRO. Se DERIVA del diccionario de SU
 * libro y no se copia: el día que alguien renombre una categoría, el diálogo lo sigue solo en
 * vez de prometer un nombre que el libro ya no usa.
 *
 * FICHA 381: son DOS diccionarios porque son dos libros. `CATEGORIA_TIENDA_LABEL` es el mismo
 * objeto que rotula el ledger en `/mi-wallet` y en `/wallet/tiendas`, así que el nombre que el
 * diálogo promete es literalmente el que la tienda va a leer en su wallet. Para el pago por
 * cuenta (FICHA 459) esto es el nombre en la CAJA; el de la tienda lo da `nombreEnElLibroDeLaTienda`.
 */
export function nombreEnElLibro(concepto: ConceptoManual): string {
  return concepto.destino.clase === "cobro_tienda"
    ? CATEGORIA_TIENDA_LABEL[concepto.destino.categoria]
    : CATEGORIA_LABEL[concepto.destino.categoria];
}

/** FICHA 459 — el nombre con que el pago por cuenta sale en el libro de la TIENDA. */
function nombreEnElLibroDeLaTienda(concepto: ConceptoManual): string {
  return concepto.destino.clase === "pago_por_cuenta_tienda"
    ? CATEGORIA_TIENDA_LABEL[concepto.destino.categoriaTienda]
    : "";
}

/**
 * FICHA 381 (R4) — la frase completa que el diálogo enseña bajo el selector: en qué libro cae
 * el movimiento y con qué nombre saldrá en él.
 *
 * La frase de la CAJA se conserva BYTE A BYTE (R11 de la 381); la del libro de la tienda dice de
 * qué libro habla. FICHA 459 (design §9.1): la del pago por cuenta nombra los DOS libros, cada
 * uno con el nombre de su diccionario.
 */
const FRASE_DEL_LIBRO: Record<LibroDestino, (nombre: string, nombreTienda: string) => string> = {
  caja: (nombre) => `Se registra en el libro como «${nombre}».`,
  tienda: (nombre) => `Se registra en el libro de la tienda como «${nombre}».`,
  caja_y_tienda: (nombre, nombreTienda) =>
    `Se registra en la caja como «${nombre}» y en el libro de la tienda como «${nombreTienda}».`,
};

/** R4 — «Se registra en el libro […] como «…».», ya resuelta para el concepto elegido. */
export function fraseDelLibro(concepto: ConceptoManual): string {
  return FRASE_DEL_LIBRO[libroDelConcepto(concepto)](
    nombreEnElLibro(concepto),
    nombreEnElLibroDeLaTienda(concepto),
  );
}

/**
 * FICHA 381 (R4/R11) — cabecera del diálogo, POR LIBRO.
 *
 * El título de la ficha 334 («…en la caja») deja de ser cierto en cuanto el concepto elegido
 * escribe en el libro de una tienda, y un encabezado que miente sobre dónde va el dinero es
 * exactamente el género de fallo mudo que este repo persigue. La entrada `caja` conserva sus
 * DOS textos byte a byte.
 */
export const CABECERA_POR_LIBRO: Record<
  LibroDestino,
  { readonly titulo: string; readonly descripcion: string }
> = {
  caja: {
    titulo: "Registrar movimiento en la caja",
    descripcion:
      "Elegí el concepto, el monto y la fecha. El movimiento es inmutable una vez registrado.",
  },
  tienda: {
    titulo: "Cobrar un costo a una tienda",
    // Dice en voz alta la consecuencia C1 del spec: no hay botón de deshacer, y quien cobra de
    // más tiene que esperar a que la gestión le vuelva a deber dinero a esa tienda.
    descripcion:
      "Elegí la tienda, el monto y la fecha. El cobro se descuenta de lo que Ordenex le debe a esa tienda y es inmutable: no se puede editar ni deshacer.",
  },
  // FICHA 459 (design §9.1): el título es el del concepto. R52: no se edita; si hay un error se
  // anula desde el libro de la caja con un motivo, y la anulación deja el movimiento contrario.
  caja_y_tienda: {
    titulo: "Pago por cuenta de una tienda",
    descripcion:
      "Elegí la tienda, a quién se le pagó, el monto y la fecha. El pago no se puede editar: si hay un error, se anula desde el libro de la caja con un motivo.",
  },
};

/** El concepto con ese id. `undefined` si no existe: quien lo llame decide qué hacer. */
export function conceptoPorId(id: string): ConceptoManual | undefined {
  return CONCEPTOS_MANUALES.find((concepto) => concepto.id === id);
}
