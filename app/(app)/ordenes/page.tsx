import { RolValue } from "@prisma/client";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

import { OrdenesModule } from "./_components/OrdenesModule";
import { OrdenesTabs } from "./_components/OrdenesTabs";
import { Container } from "@/components/shared/Container";

/**
 * Feature 63/C5 (R12/R20, design.md §4.3, F1.4-h): el rol se resuelve SOLO
 * server-side vía `resolveActorFromSession` (patrón `app/(app)/page.tsx`). Los
 * roles ≠ mensajero que operan en `/ordenes` — `maestro`, `admin`, `adminTienda`
 * — ven las órdenes agrupadas por estado en `OrdenesTabs` (R12), con `exclude`
 * por rol. `adminSatelite` queda FUERA del v1 (opera en `/mis-asignaciones`,
 * feature 33) y `mensajero` NO usa este componente: su experiencia sigue siendo
 * `/mis-asignaciones` (R20). Cualquier otro caso conserva el listado plano previo
 * (features 6/7/8), SIN regresión.
 */

// Roles que ven las tabs en `/ordenes` (F1.4-h). `adminSatelite` NO está aquí.
const ROLES_CON_TABS = new Set<string>([
  RolValue.maestro,
  RolValue.admin,
  RolValue.adminTienda,
]);

// F1.4-c (R13): `exclude` por rol, por `value` del estado. Default `["pendiente"]`
// (borrador transitorio recién sembrado). Un rol sin override cae al default.
const EXCLUDE_POR_ROL: Record<string, string[]> = {
  [RolValue.maestro]: ["pendiente"],
  [RolValue.admin]: ["pendiente"],
  [RolValue.adminTienda]: ["pendiente", "devuelta", "en_bodega", "en_bodega_satelite", "en_ruta_bodega_satelite"],
};

export default async function OrdenesPage() {
  const actor = await resolveActorFromSession();
  const rol = actor?.rol;
  // Guardia por rol: `/ordenes` es solo para maestro/admin/adminTienda. El mensajero
  // opera en `/mis-asignaciones` y el adminSatelite en `/recepcion-satelite`; ninguno
  // debe alcanzar el listado plano de todas las ordenes aqui (defensa junto al
  // acotamiento server-side de OrdenService.listar).
  if (rol === RolValue.mensajero || rol === RolValue.adminSatelite) notFound();
  const puedeCargarMasiva = rol === RolValue.adminTienda;
  // Escaneo del QR de la etiqueta para saltar a la orden: solo adminTienda.
  const puedeEscanearQr = rol === RolValue.adminTienda;
  const usaTabs = rol ? ROLES_CON_TABS.has(rol) : false;
  // Selección por checkbox + acciones por lote (asignar mensajero, rutear a bodega
  // satélite, etc.) SOLO para `maestro`: las Server Actions son maestro-only. `admin`
  // es solo-lectura y `adminTienda` no opera estas transiciones.
  const accionesLote = rol === RolValue.maestro;

  return (
    <>
      <PageHeader title="Órdenes" description="Listado y gestión de órdenes" />
      <Container>
        {usaTabs ? (
          <OrdenesTabs
            exclude={EXCLUDE_POR_ROL[rol as string] ?? ["pendiente"]}
            puedeCargarMasiva={puedeCargarMasiva}
            puedeEscanearQr={puedeEscanearQr}
            mostrarHistorial
            accionesLote={accionesLote}
          />
        ) : (
          // adminSatelite / mensajero / sin sesión: listado plano previo, SIN
          // regresión (R20). Feature 49: "Ver historial" por fila.
          <OrdenesModule puedeCargarMasiva={puedeCargarMasiva} mostrarHistorial />
        )}
      </Container>
    </>
  );
}
