import {
  itemsVisibles,
  primerDestino,
  SIDEBAR_ITEMS,
} from "@/lib/auth/menu-visibility";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { AppPage } from "@/components/shared/AppPage";
import { NoEncontradoState } from "@/components/shared/NoEncontradoState";

/**
 * ⭑ FICHA 438 — EL 404 DEL PORTAL, DENTRO DEL ARMAZÓN.
 *
 * Hasta hoy no existía NINGÚN `not-found.tsx` en el árbol, así que los 32 `notFound()` del
 * portal —`/mi-bodega`, `/mi-wallet`, `/historico/acciones`, `/ranking/historico`,
 * `/wallet/satelites`, `/configuracion/sinpe` y los 33 slugs de ayuda— caían en la pantalla
 * interna de Next: «404. This page could not be found.», EN INGLÉS, en una aplicación que
 * usan mensajeros en Costa Rica. Reportado por el humano así: «recarga, deja el sidebar y el
 * contenido en blanco; no me dice que es algo a lo que no tengo acceso».
 *
 * ── POR QUÉ ESTÁ EN LA RAÍZ DEL GRUPO `(app)`, Y NO EN CADA SECCIÓN
 *
 * Un `not-found.tsx` cubre su segmento Y TODO lo que cuelga debajo, así que puesto aquí cubre
 * las secciones del portal con un archivo. Es la misma regla que la red de errores de la
 * feature 365 (`app/(app)/error.tsx`): se añade una frontera de sección sólo cuando esa
 * sección necesita decir algo DISTINTO, nunca por simetría.
 *
 * Y está AQUÍ y no en la raíz del árbol porque se renderiza DENTRO de `app/(app)/layout.tsx`:
 * la persona conserva su barra lateral y su encabezado, y puede irse a otra sección sin
 * recargar. La de la raíz (`app/not-found.tsx`) no puede hacer eso —es la de las páginas
 * públicas, que no tienen armazón—, y por eso son dos archivos y no uno.
 *
 * ⚠️ LO QUE ESTA PANTALLA *NO* CUBRE, DICHO EN VOZ ALTA Y MEDIDO. Una URL que no case con
 * NINGUNA ruta del árbol la resuelve Next con el `not-found` de la RAÍZ, porque la petición no
 * llegó a entrar en ningún segmento de este grupo: ahí no hay armazón que conservar. Es un
 * límite del enrutador, no una decisión de esta pantalla.
 *
 * Y NO es teoría: `/wallet/caja` y `/configuracion/usuarios` —las dos que reportó el humano—
 * son exactamente eso. No existen como rutas (`app/(app)/wallet/` tiene `mensajeros`,
 * `satelites` y `tiendas`; `configuracion/` no tiene `usuarios`), así que cuando se pedían
 * «daban 404 perdiendo el armazón» por esto, no por falta de esta pantalla. Medido en el
 * navegador con sesión de mensajero: con esta pantalla puesta pasan de enseñar el 404 EN INGLÉS
 * de Next a enseñar éste en español y con salida, pero siguen sin sidebar.
 *
 * SE PROBÓ CERRAR TAMBIÉN ESE HUECO y se descartó con la medición delante. Una ruta comodín
 * `app/(app)/[...ruta]/page.tsx` que sólo llamara a `notFound()` SÍ los mete en el grupo —
 * medido: `/wallet/caja` pasaba a conservar sidebar y encabezado a 390 y a 1440—. Pero el
 * comodín se sienta en la RAÍZ del árbol, y el middleware deja pasar sin sesión todo lo que
 * empiece por un prefijo público (`matches()` casa `"/login/"`, `"/postulacion/"`,
 * `"/api-docs/"`, `"/recuperar-contrasena/"`). Resultado medido SIN sesión: `/login/xyz`
 * respondía 404 pintando el armazón del portal entero —sidebar vacía y botón «Salir»— a alguien
 * que no ha entrado. Cambiar un defecto por otro no es cerrarlo: queda como decisión del humano.
 *
 * ── LA SALIDA SALE DEL MENÚ, NO DE UNA LISTA NUEVA
 *
 * El inicio de cada persona no es el mismo: un mensajero empieza en sus entregas y la oficina
 * en el tablero. Ese destino ya lo calcula el repo —`primerDestino(itemsVisibles(...))`, el
 * mismo aterrizaje post-login que usa `/dashboard`— y se REUSA tal cual. Escribir aquí un
 * segundo mapa rol→ruta sería una lista paralela que diverge sin que nada se ponga rojo; en
 * este repo ya pasó, y por eso `no-encontrado-no-delata.guardia.test.ts` prohíbe que en este
 * archivo aparezca el nombre de un rol o una ruta de portal.
 *
 * ── EL TEXTO
 *
 * No lo decide esta pantalla: vive entero en `NoEncontradoState`, que explica por qué NO puede
 * decir «no tenés acceso» (ficha 433: el 404 y el 403 son indistinguibles a propósito).
 */
export default async function NoEncontradoEnElPortal() {
  const actor = await resolveActorFromSession();

  // `null` cuando no hay sesión válida o cuando el actor no ve ningún ítem elegible (las
  // cuentas de API no navegan la UI). Ahí no hay «su inicio» que calcular, así que la salida
  // es la raíz —el mismo criterio que `app/error.tsx`—: el middleware ya reparte desde ahí a
  // quien sí tiene sesión, y a quien no la tiene lo manda al login.
  const inicio = primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor)) ?? "/";

  return (
    <AppPage title="No encontramos esta página">
      <NoEncontradoState hrefInicio={inicio} />
    </AppPage>
  );
}
