// Ficha 458-A (TA.2, design §3.3, R5–R9) — el ORIGEN de un movimiento de la wallet, legible.
//
// Hasta la 458 cada libro pintaba su origen como `DICCIONARIO[origenTipo]` —«Cierre del día»,
// «Gestión de orden»— sin decir CUAL cierre ni CUAL orden, y dos de los tres diccionarios caian al
// valor tecnico (`?? origenTipo`). Desde esta ficha el SERVIDOR resuelve, EN LOTE, la entidad que
// produjo cada fila y la baja ya compuesta: el texto legible (rotulo del diccionario de la superficie
// + entidad) y, si el rol que mira tiene acceso a la pantalla de esa entidad, el enlace. El
// identificador interno viaja SOLO en `href` (D1, precedente 462 R33): nunca en `texto` ni en
// `etiqueta` (R1, R7).

import type { WalletOrigenTipo } from "@/lib/types/wallet";

/** El libro de la fila: decide con que diccionario se rotula el origen. */
export type LibroWallet = "caja" | "tienda" | "mensajero";

/** Un enlace a la pantalla de la entidad de origen. `etiqueta` es el nombre accesible completo. */
export type EnlaceOrigenDTO = {
  etiqueta: string;
  /** La direccion; el UNICO sitio donde puede ir un identificador interno (D1). */
  href: string;
};

/** El origen legible de UNA fila (R5–R8). `enlace` es `null` si el rol no accede (R8) o no hay pantalla. */
export type OrigenLegibleDTO = {
  texto: string;
  enlace: EnlaceOrigenDTO | null;
};

/** Lo minimo de una fila de cualquiera de los tres libros para resolver su origen. */
export type FilaConOrigenTecnico = {
  origenTipo: WalletOrigenTipo;
  origenId: string | null;
  categoria: string;
  descripcion: string | null;
};

/** Una fila de un libro con su origen legible adjunto (lo que baja al cliente desde la 458-A). */
export type ConOrigen<T> = T & { origen: OrigenLegibleDTO };
