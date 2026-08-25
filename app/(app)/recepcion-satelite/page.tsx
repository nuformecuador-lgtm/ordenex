import { redirect } from "next/navigation";

/**
 * Feature 278 (T2.3, R13/R14, decisión del humano del 2026-08-24): el portal del
 * `adminSatelite` se partió en dos pantallas hermanas —`/recepcion-satelite/por-recibir` y
 * `/recepcion-satelite/en-bodega`— con un subítem de menú cada una. Esta ruta deja de
 * renderizar nada y se convierte en un REDIRECT a «Por recibir».
 *
 * No se borra: `/recepcion-satelite` está en enlaces viejos, en el historial de los
 * navegadores de la calle y en la PWA ya instalada. Borrarla daría 404 a quien la tuviera
 * guardada. Es el mismo precedente, y por los mismos motivos, que `/mis-asignaciones`.
 *
 * **A «Por recibir» y no a «En bodega»**, aunque el `adminSatelite` pase más rato en la
 * segunda: el aterrizaje post-login de este rol es el primer subítem del ítem de menú
 * (`primerDestino`), o sea «Por recibir». Si el redirect apuntara a la otra, el rol
 * tendría DOS puertas de entrada distintas —una al iniciar sesión y otra desde un enlace
 * guardado— que es justo lo que R14 prohíbe.
 *
 * **Sin gate de rol propio, y sin resolver la sesión** (R13): `redirect` no expone nada,
 * así que repetir aquí el `notFound` sólo añadiría una consulta a la base de datos por
 * cada enlace viejo que alguien abra. El permiso lo aplica la página de destino,
 * server-side, como siempre. Este archivo no importa ninguna Server Action ni el
 * resolvedor de actor a propósito.
 */
export default function RecepcionSatelitePage() {
  redirect("/recepcion-satelite/por-recibir");
}
