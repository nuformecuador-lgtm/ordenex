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
// en la caja principal. Es la ÚNICA fuente de los cuatro, y por eso la regla del gasto FIJO se
// puede afirmar sobre él con un test (R11): lo que no está aquí no se puede elegir.
//
// POR QUÉ NO VIVE EN `wallet-labels.ts`. Ese archivo es texto de pantalla; esto además lleva el
// ENRUTADO —a qué Server Action va cada concepto y con qué payload—, que es lo que hace posible
// que el usuario vea UN formulario mientras la base sigue recibiendo dos escrituras distintas
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
// Módulo PURO: sin React y sin leer ningún reloj. La fecha del movimiento la pone el diálogo.

/** Los CINCO conceptos, en el orden en que se ofrecen. `gasto_fijo` NO está: lo emite el cron. */
export const CONCEPTO_MANUAL_IDS = [
  "gasto_variable",
  "sueldo",
  "ajuste_ingreso",
  "ajuste_egreso",
  "cobro_tienda",
] as const;

export type ConceptoManualId = (typeof CONCEPTO_MANUAL_IDS)[number];

/**
 * A dónde va el concepto cuando se registra. Unión DISCRIMINADA a propósito: el diálogo no
 * elige action con un `if` sobre el id, sino sobre esta clase, así que un concepto nuevo que
 * olvidara declarar su destino no compila.
 *
 * FICHA 381 — la `categoria` viaja DENTRO de cada rama y con el tipo de SU libro: las dos
 * primeras escriben en la caja (`WalletMovimientoCategoria`), la tercera en el libro de la
 * tienda (`WalletTiendaMovimientoCategoria`). Declarar la del libro equivocado no compila.
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
    };

/**
 * FICHA 381 (R4) — EN QUÉ LIBRO acaba el movimiento. No es lo mismo que la clase del destino:
 * dos clases distintas (gasto administrativo y ajuste manual) caen en el MISMO libro, y por eso
 * lo que la pantalla le dice al usuario se resuelve por esto y no por la clase.
 */
export type LibroDestino = "caja" | "tienda";

export interface ConceptoManual {
  readonly id: ConceptoManualId;
  /** Cómo se llama el concepto DENTRO del selector. */
  readonly label: string;
  /** Etiqueta del campo de descripción, adaptada al concepto (R9). */
  readonly descripcionLabel: string;
  /** Ejemplo de descripción, para que el campo no arranque mudo. */
  readonly descripcionPlaceholder: string;
  readonly destino: DestinoConcepto;
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
  },
  {
    // R7 — el ajuste que SUMA. El nombre dice lo que le pasa al dinero, no el nombre del enum:
    // «ingreso_ajuste» no se le enseña a nadie.
    id: "ajuste_ingreso",
    label: "Ajuste que suma dinero",
    descripcionLabel: "Motivo del ajuste",
    descripcionPlaceholder: "Ej. Devolución de un pago hecho de más",
    destino: { clase: "ajuste_manual", tipo: "ingreso", categoria: "ingreso_ajuste" },
  },
  {
    id: "ajuste_egreso",
    label: "Ajuste que resta dinero",
    descripcionLabel: "Motivo del ajuste",
    descripcionPlaceholder: "Ej. Faltante encontrado al cuadrar la caja",
    destino: { clase: "ajuste_manual", tipo: "egreso", categoria: "egreso_ajuste" },
  },
  {
    // ⭑ FICHA 381 (R1) — el QUINTO, y el único que no toca la caja de Ordenex. Lo que hace es
    // QUITARLE dinero disponible a una tienda; si no lo tiene, su saldo queda en negativo y se
    // cobra más adelante, cuando la gestión vuelva a generarle dinero a favor (D3).
    //
    // El nombre del selector dice la ACCIÓN y a quién afecta, no el nombre del enum. Es la
    // propuesta del diseño para la pregunta Q1 del spec, que a día de hoy sigue SIN FIRMAR:
    // cambiarlo cuesta esta línea, y la etiqueta del libro, otra en `CATEGORIA_TIENDA_LABEL`.
    id: "cobro_tienda",
    label: "Cobrar un costo a una tienda",
    descripcionLabel: "Motivo del cobro",
    descripcionPlaceholder: "Ej. Material de despacho entregado en bodega",
    destino: { clase: "cobro_tienda", categoria: "cobro_manual" },
  },
];

/** Opciones del `Select` de concepto, en el orden del catálogo. */
export const CONCEPTO_MANUAL_OPTIONS = CONCEPTOS_MANUALES.map((concepto) => ({
  value: concepto.id,
  label: concepto.label,
}));

/**
 * FICHA 381 (R4) — el libro contable en el que acaba el concepto. Se decide por la CLASE del
 * destino, que es el mismo discriminante del que cuelga la Server Action: no hay forma de que
 * la pantalla prometa un libro y el registro acabe en el otro.
 */
export function libroDelConcepto(concepto: ConceptoManual): LibroDestino {
  return concepto.destino.clase === "cobro_tienda" ? "tienda" : "caja";
}

/**
 * R4 — con qué nombre aparecerá el movimiento EN EL LIBRO. Se DERIVA del diccionario de SU
 * libro y no se copia: el día que alguien renombre una categoría, el diálogo lo sigue solo en
 * vez de prometer un nombre que el libro ya no usa.
 *
 * FICHA 381: son DOS diccionarios porque son dos libros. `CATEGORIA_TIENDA_LABEL` es el mismo
 * objeto que rotula el ledger en `/mi-wallet` y en `/wallet/tiendas`, así que el nombre que el
 * diálogo promete es literalmente el que la tienda va a leer en su wallet.
 */
export function nombreEnElLibro(concepto: ConceptoManual): string {
  return concepto.destino.clase === "cobro_tienda"
    ? CATEGORIA_TIENDA_LABEL[concepto.destino.categoria]
    : CATEGORIA_LABEL[concepto.destino.categoria];
}

/**
 * FICHA 381 (R4) — la frase completa que el diálogo enseña bajo el selector: en qué libro cae
 * el movimiento y con qué nombre saldrá en él.
 *
 * La frase de la CAJA se conserva BYTE A BYTE (R11: los cuatro conceptos previos no cambian
 * ninguno de sus textos); la del libro de la tienda es nueva y dice de qué libro habla, porque
 * para ese concepto «el libro» a secas ya no identifica ninguno.
 */
const FRASE_DEL_LIBRO: Record<LibroDestino, (nombre: string) => string> = {
  caja: (nombre) => `Se registra en el libro como «${nombre}».`,
  tienda: (nombre) => `Se registra en el libro de la tienda como «${nombre}».`,
};

/** R4 — «Se registra en el libro […] como «…».», ya resuelta para el concepto elegido. */
export function fraseDelLibro(concepto: ConceptoManual): string {
  return FRASE_DEL_LIBRO[libroDelConcepto(concepto)](nombreEnElLibro(concepto));
}

/**
 * FICHA 381 (R4/R11) — cabecera del diálogo, POR LIBRO.
 *
 * El título de la ficha 334 («…en la caja») deja de ser cierto en cuanto el concepto elegido
 * escribe en el libro de una tienda, y un encabezado que miente sobre dónde va el dinero es
 * exactamente el género de fallo mudo que este repo persigue. La entrada `caja` conserva sus
 * DOS textos byte a byte: los cuatro conceptos previos siguen viendo la misma pantalla.
 *
 * El texto de `tienda` repite a propósito el rótulo del quinto concepto: es el mismo acto, y
 * dos redacciones distintas para la misma cosa harían dudar de si son la misma.
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
};

/** El concepto con ese id. `undefined` si no existe: quien lo llame decide qué hacer. */
export function conceptoPorId(id: string): ConceptoManual | undefined {
  return CONCEPTOS_MANUALES.find((concepto) => concepto.id === id);
}
