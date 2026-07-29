import { RolValue } from "@prisma/client";
import { notFound } from "next/navigation";
import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { obtenerCatalogoFiltrosOrdenes } from "@/lib/actions/filtros-ordenes";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";

import { OrdenesModule } from "./_components/OrdenesModule";
import { OrdenesListado } from "./_components/OrdenesListado";
import { EXCLUDE_POR_ROL } from "./exclude-por-rol";

/**
 * Feature 63/C5 (R12/R20, design.md §4.3, F1.4-h): el rol se resuelve SOLO
 * server-side vía `resolveActorFromSession` (patrón `app/(app)/page.tsx`). Los
 * roles ≠ mensajero que operan en `/ordenes` — `maestro`, `admin`, `adminTienda`
 * — ven UNA tabla normal con un filtro de selección múltiple por estado
 * (`OrdenesListado`, que sustituyó a las tabs por estado), con `exclude` por rol
 * acotando los estados ofrecidos. `adminSatelite` queda FUERA del v1 (opera en
 * `/mis-asignaciones`, feature 33) y `mensajero` NO usa este componente: su
 * experiencia sigue siendo `/mis-asignaciones` (R20). Cualquier otro caso conserva
 * el listado plano previo (features 6/7/8), SIN regresión.
 */

// Roles que ven el listado con filtro por estado (F1.4-h). `adminSatelite` NO está aquí.
const ROLES_CON_FILTRO_ESTADO = new Set<string>([
  RolValue.maestro,
  RolValue.admin,
  RolValue.adminTienda,
]);

// F1.4-c (R13) + Feature 139 (R19/R20): `exclude` por rol vive en `./exclude-por-rol`
// (módulo aparte para blindarlo con test sin arrastrar las deps server-only de la page).

/** Catálogo de filtros o `null` si no se pudo resolver (R64). Nunca lanza. */
async function resolverCatalogoFiltros(): Promise<CatalogoFiltrosOrdenesDTO | null> {
  try {
    const res = await obtenerCatalogoFiltrosOrdenes();
    return res.status === "ok" ? res.catalogo : null;
  } catch {
    // El service propaga el error de la DB a propósito: el fallback lo decide la
    // página, y es "listado sin filtros nuevos", no una página rota.
    return null;
  }
}

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
  // Feature 138 (R16): recepción en la BODEGA CENTRAL (escaneo + entrada manual de
  // guía en el encabezado) solo para roles de ACCESO TOTAL (maestro/admin). Cierra
  // el callejón `en_ruta_bodega_central`; el service revalida el rol server-side.
  // `adminTienda` NO la recibe (conserva su recepción en origen `puedeEscanearQr`).
  const puedeRecibirBodegaCentral = rol ? esAccesoTotal(rol) : false;
  const usaFiltroEstado = rol ? ROLES_CON_FILTRO_ESTADO.has(rol) : false;
  // Feature 94 (paridad adm↔maestro): selección por checkbox + acciones por lote
  // (asignar mensajero, rutear a bodega satélite, etc.) para roles de ACCESO TOTAL
  // (`maestro`/`admin`); las Server Actions ya autorizan a ambos. `adminTienda` no
  // opera estas transiciones. `rol` está definido aquí (el guard previo descarta
  // sin-sesión/mensajero/adminSatelite antes de llegar).
  const accionesLote = rol ? esAccesoTotal(rol) : false;

  // Feature 144/TB2.5 (R47, R64): el catálogo de los filtros (zonas, cuentas tienda y
  // geografía) se resuelve AQUÍ, en el servidor, tras las guardias de rol; sus cinco
  // lecturas corren en paralelo dentro del service y el resultado baja por props, de
  // modo que los filtros están operativos en el primer paint, sin una petición
  // posterior ni una consulta por cada selección del usuario.
  //
  // La página NO falla si el catálogo falla: cualquier resultado que no sea `ok` —y
  // cualquier error propagado desde la DB, que el service propaga a propósito— deja
  // `null`, y la barra se monta deshabilitada con la tabla viva (R64).
  const catalogoFiltros = usaFiltroEstado ? await resolverCatalogoFiltros() : null;
  // R62: el rol acotado a su propia tienda no declara el filtro de tienda.
  const incluirFiltroTienda = rol !== RolValue.adminTienda;

  return (
    <AppPage title="Órdenes" description="Listado y gestión de órdenes">
      {usaFiltroEstado ? (
        <OrdenesListado
          exclude={EXCLUDE_POR_ROL[rol as string] ?? ["pendiente"]}
          puedeCargarMasiva={puedeCargarMasiva}
          puedeEscanearQr={puedeEscanearQr}
          puedeRecibirBodegaCentral={puedeRecibirBodegaCentral}
          mostrarHistorial
          accionesLote={accionesLote}
          catalogoFiltros={catalogoFiltros}
          incluirFiltroTienda={incluirFiltroTienda}
        />
      ) : (
        // adminSatelite / mensajero / sin sesión: listado plano previo, SIN
        // regresión (R20). Feature 49: "Ver historial" por fila.
        <OrdenesModule puedeCargarMasiva={puedeCargarMasiva} mostrarHistorial />
      )}
    </AppPage>
  );
}
