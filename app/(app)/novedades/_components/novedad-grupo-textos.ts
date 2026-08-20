import type { GrupoNovedad } from "@/lib/types/novedad-grupo";

// Feature 236 (T4.2, design §5 — R13/R14/R16) — LOS TEXTOS DE CADA PESTAÑA DE `/novedades`, en un
// solo sitio y parametrizados por GRUPO.
//
// POR QUE UNA TABLA Y NO DUPLICAR EL MODULO. `NovedadesModule` sabe hacer exactamente lo mismo para
// los dos grupos —conmutador de vista, paginacion por Server Action, cards POS, modales—; lo unico
// que cambia son los ROTULOS. Duplicar el componente para cambiar cinco cadenas habria dejado dos
// pantallas que se parecen, que es justo lo que la 236 vino a deshacer en la card (design §6.1).
//
// POR QUE INDEXADO POR `GrupoNovedad` Y CON `satisfies`. Un grupo nuevo en `ESTATUS_POR_GRUPO` deja
// de compilar aqui hasta que alguien escriba sus textos. Sin eso, la pestaña nueva saldria con el
// estado vacio de la otra —diciendo «cuando una de tus ordenes vuelva a la tienda» sobre una
// poblacion que nunca se devolvio—, que es la misma clase de afirmacion falsa que R14 prohibe.
//
// MODULO PURO: sin React, sin DOM, sin Server Actions. Lo consumen `NovedadesTabs` (los rotulos de
// las pestañas, en el orden de `GRUPOS_NOVEDAD`) y `NovedadesModule` (todo lo demas), asi que no
// puede arrastrar ninguna de las dos capas a la otra.

export interface TextosGrupoNovedad {
  /** Rotulo de la pestaña. Español con tildes, sin siglas ni jerga interna (R13). */
  pestana: string;
  /** Nombre accesible de la `<ul>` de la lista. Propio de cada grupo: son dos listas distintas. */
  listaAriaLabel: string;
  /** Nombre accesible de la `Pagination` del pie. Idem. */
  paginacionAriaLabel: string;
  /** Titulo del estado vacio (R16). Dice QUE aparecera ahi, no «no hay nada». */
  vacioTitulo: string;
  /** Detalle del estado vacio (R16). Dice CUANDO aparecera. */
  vacioDetalle: string;
  /**
   * Chip de la card cuando el grupo lo fija. `null` = el chip lo decide el dato de la fila (para
   * la devolucion, la CAUSA: es su unica señal).
   */
  chipFijo: string | null;
}

/**
 * **D6, firmada por el humano el 2026-08-19.** Los cinco textos de cada grupo, tal cual se firmaron.
 *
 * ⚠️ «Ayuda solicitada» y NO «Ayuda a gestionar» (que era lo que decia §F2 del diseño de la pila).
 * La razon, firmada: **«gestionar» es en este repo el verbo del MENSAJERO** —«por gestionar»,
 * «Gestionar mas tarde», «Gestionar esta orden»—, asi que usarlo en la pantalla de la TIENDA le
 * atribuye un gesto que no es suyo. Y menos aun ahora, que gestionar desde ayuda es la ficha 237 y
 * todavia no existe. En cambio «ayuda solicitada» es la palabra que la tienda YA ve en tres sitios:
 * el chip de la card de hoy, el encabezado del portal del mensajero («Con ayuda solicitada») y la
 * etiqueta del estatus («Ayuda solicitada a la tienda»).
 *
 * ⚠️ EL CHIP DE LA CARD DE AYUDA CAMBIA A «Esperando tu respuesta», y por dos motivos: dentro de una
 * pestaña que ya se llama «Ayuda solicitada», repetirlo en cada card no informa; y el texto que
 * tenia —«Ayuda · \<causa\>»— es un ARRASTRE, porque esa causa viene de una devolucion anterior ya
 * deshecha y no describe esta orden (R26 prohibe atribuirle una causa, mostrarla **o anunciar su
 * ausencia**).
 *
 * ⚠️ EL ESTADO VACIO NO ES UN CASO MARGINAL. Medido el 2026-08-19 en produccion sobre 141 ordenes
 * vivas en 11 estatus (`progress/medicion_236.md`): `ayuda_tienda` = 0 y `devuelta` = 0. Es el
 * PRIMER estado que la tienda va a conocer de esta pestaña, y durante un tiempo el unico. Un vacio
 * mudo se lee como una pantalla rota, asi que dice que aparecera ahi y cuando (R16).
 */
export const TEXTOS_POR_GRUPO = {
  ayuda: {
    pestana: "Ayuda solicitada",
    listaAriaLabel: "Órdenes con ayuda solicitada",
    paginacionAriaLabel: "Paginación de las órdenes con ayuda solicitada",
    vacioTitulo: "Ningún mensajero te pidió ayuda",
    vacioDetalle:
      "Cuando un mensajero necesite que resuelvas algo de una orden que lleva encima, aparecerá acá con su mensaje.",
    chipFijo: "Esperando tu respuesta",
  },
  devolucion: {
    pestana: "En devolución",
    listaAriaLabel: "Órdenes en devolución",
    // Se conserva TAL CUAL el de hoy: esta ficha no tiene ningun motivo para mover el nombre
    // accesible de un control que ya estaba bien, y cambiarlo de paso seria copy sin firma.
    paginacionAriaLabel: "Paginación de novedades",
    vacioTitulo: "No tenés órdenes en devolución",
    vacioDetalle:
      "Cuando una de tus órdenes vuelva a la tienda, aparecerá acá con su causa y los botones de contacto.",
    // La devolucion NO tiene chip fijo: su señal es la CAUSA, que es lo unico que distingue una
    // devolucion de otra en la lista (R7/R11 de la 87).
    chipFijo: null,
  },
} as const satisfies Record<GrupoNovedad, TextosGrupoNovedad>;

/**
 * Subtitulo de la pagina (R14, D6). Nombra **las TRES** superficies que contiene.
 *
 * Lo que decia hasta el 2026-08-19: «Tus órdenes en devolución y las que llegaron a rechazo por
 * vencerse el plazo». Era falso de una parte de lo que listaba —una orden sobre la que el mensajero
 * pidio ayuda ni esta en devolucion ni llego a rechazo por plazo vencido: sigue en la calle, con el
 * paquete encima—, y R14 prohibe describir la pantalla con un texto que afirme de las ordenes que
 * lista algo que no es cierto.
 */
export const SUBTITULO_NOVEDADES =
  "Las órdenes en las que tus mensajeros piden ayuda, tus órdenes en devolución y las que llegaron a rechazo por vencerse el plazo";
