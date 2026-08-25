import { AppPage } from "@/components/shared/AppPage";

import { PostulacionesPendientesPanel } from "./PostulacionesPendientesPanel";
import { PostulacionRecursoPanel } from "./PostulacionRecursoPanel";
import { ContenedorSeccion } from "@/components/shared/ContenedorSeccion";

/**
 * Dashboard del admin maestro (feature 23, R5). Server Component al estilo de
 * `AdminTiendaDashboard` (feature 26): compone el shell (`AppPage`) y los bloques
 * funcionales. No obtiene datos sensibles por props; los paneles cliente consumen
 * las Server Actions (que autorizan por rol en el backend).
 *
 * NADA de entregas vive aqui. La barra de filtros se fue a la pagina de analitica (pedido
 * humano del 2026-08-17) y el encabezado «Entregas» que quedaba encima del panel —un
 * contenedor sin cuerpo, solo titulo— se retiro por pedido humano del 2026-08-20.
 * Aqui NO hay nada de entregas, y es a proposito: la BARRA DE FILTROS de entregas se movio
 * a la pagina de analitica por pedido humano del 2026-08-17, que es su sitio. Fuera del
 * shell, este dashboard no pinta mas que los dos paneles de postulaciones.
 *
 * Feature 253 (T7.3, design §7) — el panel de VEHICULOS Y BODEGAS entra DEBAJO del de
 * mensajeros, cada uno en su `ContenedorSeccion` con su titulo. Sin ruta nueva y sin item de
 * sidebar: `/dashboard` ya es la pantalla de aterrizaje de `maestro` y `admin`, asi que lo ven
 * al entrar.
 *
 * ⚠️ Feature 281 — LA COMPOSICION ES EXACTAMENTE ESTA Y NO ADMITE UN PANEL SUELTO: dos bloques,
 * cada uno DENTRO de su `ContenedorSeccion` con titulo, y NINGUN panel fuera de seccion. Un
 * `<PostulacionesPendientesPanel />` suelto —sin contenedor, encima de los dos bloques— vivio aqui
 * hasta el 2026-08-25 y pintaba una TERCERA tarjeta de «No hay postulaciones pendientes», la de
 * arriba, sin titulo; con datos duplicaba la lista entera y dejaba dos regiones accesibles con el
 * mismo nombre. No entro escribiendolo: lo dejo una RESOLUCION DE MERGE que deshizo el arreglo del
 * dia anterior, y por eso el defecto tiene test propio que cuenta montajes por region
 * (`tests/components/AdminMaestroDashboard.test.tsx`) y no solo tarjetas de vacio. Si vuelves a ver
 * dos apariciones del mismo panel en este JSX, es la regresion, no una decision.
 *
 * ⚠️ R36 — LA DESCRIPCION DE LA PAGINA SE CORRIGIO EN LA MISMA TANDA. Decia "Postulaciones de
 * mensajeros pendientes", que describia la pantalla ENTERA; con dos paneles esa frase pasaba a
 * ser falsa en pequeno, y un texto que dejo de ser cierto es exactamente lo que esta ficha vino
 * a cerrar una capa mas arriba.
 */
export function AdminMaestroDashboard() {
  return (
    <AppPage
      title="Panel maestro"
      description="Postulaciones pendientes: mensajeros, y vehículos o bodegas ofrecidos desde la web"
    >
      <ContenedorSeccion titulo="Postulaciones de mensajeros">
        <PostulacionesPendientesPanel />
      </ContenedorSeccion>

      <ContenedorSeccion titulo="Vehículos y bodegas ofrecidos">
        <PostulacionRecursoPanel />
      </ContenedorSeccion>
    </AppPage>
  );
}
