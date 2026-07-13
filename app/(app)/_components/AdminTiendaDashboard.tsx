"use client";

import { OrdenesModule } from "@/app/(app)/ordenes/_components/OrdenesModule";
import { PageHeader } from "@/components/shared/PageHeader";
import { Container } from "@/components/shared/Container";

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
    <>
      <PageHeader
        title="Panel de tienda"
        description="Órdenes de mi tienda"
      />
      <Container>
        <OrdenesModule columns={ordenesColumnsAdminTienda} puedeCargarMasiva />
      </Container>
    </>
  );
}
