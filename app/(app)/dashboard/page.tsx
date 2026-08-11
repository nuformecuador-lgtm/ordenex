import { redirect } from "next/navigation";

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  itemsVisibles,
  primerDestino,
  SIDEBAR_ITEMS,
} from "@/lib/auth/menu-visibility";
import { AdminMaestroDashboard } from "@/app/(app)/_components/AdminMaestroDashboard";
import { AppPage } from "@/components/shared/AppPage";

export default async function Home() {
  // Ramificación por rol resuelta SOLO server-side (feature 26, R5).
  const actor = await resolveActorFromSession();

  // ⛔ DEROGADO (pedido humano del 2026-08-10): el `adminTienda` YA NO ve aquí su dashboard.
  // La R1 de la feature 26 le daba a este rol una home propia en `/dashboard`; el humano
  // decidió que esa pantalla no debe existir para él y que entre directo al PRIMER ítem de su
  // menú, como ya hacían mensajero y adminSatelite. Cae, por tanto, al `redirect` de abajo.
  //
  // Sin riesgo de bucle, y no por suerte: el ítem «Inicio» (`/dashboard`) está declarado solo
  // para `maestro` y `admin` en `menu-visibility.ts`, así que `primerDestino` nunca puede
  // devolver `/dashboard` para un `adminTienda`. Si algún día ese ítem se abriera a este rol,
  // el redirect se volvería circular: el guardia de eso es `destino-post-login.test.ts`.
  //
  // ⚠️ CONSECUENCIA QUE HAY QUE DECIDIR, no un descuido: con esta rama fuera,
  // `AdminTiendaDashboard` se queda SIN NINGÚN consumidor de producción —solo lo montan sus
  // propios tests—. No se borra aquí porque es la pantalla entera de la feature 26 y retirarla
  // es una decisión aparte; queda señalado para que nadie la lea como código vivo.

  // Feature 23 (R1): maestro/admin ven el dashboard del admin maestro con el
  // panel de postulaciones pendientes. Va DESPUÉS de la rama adminTienda (R2) y
  // ANTES del placeholder "Bienvenido" (R3, R4), sin alterar ninguna de ambas.
  if (actor?.rol === "maestro" || actor?.rol === "admin") {
    return <AdminMaestroDashboard />;
  }

  // Pedido humano: para el resto de roles (mensajero, adminSatelite…) esta home NO EXISTE
  // —solo había un "Bienvenido" vacío— y sin embargo es donde aterrizan tras el login
  // (`middleware.ts`). En vez de dejarlos ahí, entran al PRIMER ítem de su sidebar, que es
  // donde empieza su trabajo. Se deriva del mismo menú que pinta la barra, así que un
  // reordenamiento del sidebar mueve el aterrizaje con él, sin una segunda lista que mantener.
  const destino = primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor));
  if (destino !== null) redirect(destino);

  // Sin sesión (o sin ningún ítem visible) no hay a dónde mandar a nadie: se conserva el
  // placeholder. El control "Cerrar sesión" vive en el shell (SidebarFooter de
  // app/(app)/_components/Sidebar.tsx), único y visible para todos los roles (feature 57,
  // R14). La home ya no renderiza su propio botón ad-hoc.
  return (
    <AppPage
      title="Bienvenido"
      description="Has iniciado sesión correctamente"
    />
  );
}
