import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { AdminTiendaDashboard } from "@/app/(app)/_components/AdminTiendaDashboard";
import { AdminMaestroDashboard } from "@/app/(app)/_components/AdminMaestroDashboard";
import { AppPage } from "@/components/shared/AppPage";

export default async function Home() {
  // Ramificación por rol resuelta SOLO server-side (feature 26, R5): el
  // `adminTienda` ve su dashboard/apartado (R1); cualquier otro rol o sesión
  // ausente conserva el placeholder "Bienvenido" (R3, R4).
  const actor = await resolveActorFromSession();
  if (actor?.rol === "adminTienda") {
    return <AdminTiendaDashboard />;
  }

  // Feature 23 (R1): maestro/admin ven el dashboard del admin maestro con el
  // panel de postulaciones pendientes. Va DESPUÉS de la rama adminTienda (R2) y
  // ANTES del placeholder "Bienvenido" (R3, R4), sin alterar ninguna de ambas.
  if (actor?.rol === "maestro" || actor?.rol === "admin") {
    return <AdminMaestroDashboard />;
  }

  // El control "Cerrar sesión" vive ahora en el shell (SidebarFooter de
  // app/(app)/_components/Sidebar.tsx), único y visible para todos los roles
  // (feature 57, R14). La home ya no renderiza su propio botón ad-hoc.
  return (
    <AppPage
      title="Bienvenido"
      description="Has iniciado sesión correctamente"
    />
  );
}
