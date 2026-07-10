import { OrdenesModule } from "@/app/(app)/ordenes/_components/OrdenesModule";

import { ordenesColumnsAdminTienda } from "./ordenes-columns-admin-tienda";

/**
 * Apartado/dashboard del `adminTienda` (feature 26). Server Component: encabezado
 * visible del apartado (R2) + el módulo de órdenes compartido (`OrdenesModule`,
 * R6, R10) con las columnas sin "Tienda" (R11). Los datos fluyen por la action
 * `listarOrdenes` dentro del módulo cliente (R7), no por props; el filtrado a la
 * tienda propia lo aplica el backend (feature 6).
 */
export function AdminTiendaDashboard() {
  return (
    <section className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex flex-col gap-1 rounded-lg bg-navy px-5 py-4 text-white">
        <h1 className="text-2xl font-semibold tracking-tight">
          Panel de tienda
        </h1>
        <p className="text-sm text-white/70">Órdenes de mi tienda</p>
      </header>
      <OrdenesModule columns={ordenesColumnsAdminTienda} />
    </section>
  );
}
