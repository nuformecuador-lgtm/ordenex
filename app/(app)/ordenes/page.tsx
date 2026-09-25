import { RolValue } from "@prisma/client";
import { notFound } from "next/navigation";
import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
// FICHA 424 (R20): la MISMA función que autoriza el borrado en el servidor decide si la pantalla
// lo ofrece. Es pura (sin Prisma, sin `next/`, sin entorno), como `esAccesoTotal`.
import { resolverAlcanceBorradoOrden } from "@/lib/services/alcance-borrado-orden";
import { obtenerCatalogoFiltrosOrdenes } from "@/lib/actions/filtros-ordenes";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";
import { fechaCalendarioCR, mananaCalendarioCR } from "@/lib/utils/fecha-cr";
// FICHA 462 (T3.5, S4) — la franja de reprogramados retenidos: la lectura (Server Action de solo
// lectura, acotada al ámbito central), su DTO y el bloque que la pinta. Las tres líneas de import,
// `resolverRetenidasCentral` y las dos líneas del render son TODO lo que esta ficha pone en la página
// (R39: bloque removible).
import { resumenReprogramadasRetenidasCentral } from "@/lib/actions/reprogramadas-retenidas";
import type { ResumenRetenidas } from "@/lib/interfaces/services/IReprogramadasRetenidasService";
import { defaultLogger } from "@/lib/errors";

import { OrdenesModule } from "./_components/OrdenesModule";
import { OrdenesListado } from "./_components/OrdenesListado";
import { FranjaReprogramadasRetenidas } from "./_components/FranjaReprogramadasRetenidas";
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

/**
 * FICHA 462 (R37): el resumen de reprogramados retenidos del ámbito central, o `null` si no se
 * pudo leer. NUNCA lanza: la franja es un aviso, y una lectura que falla no puede tumbar el listado.
 * El fallo se REGISTRA con su causa (no se traga en silencio: memoria «los fallos mudos son la
 * familia»). `forbidden`/`unauthenticated` también dan `null` sin registrar nada: no son fallos.
 */
async function resolverRetenidasCentral(): Promise<ResumenRetenidas | null> {
  try {
    const r = await resumenReprogramadasRetenidasCentral();
    return r.status === "ok" ? r.resumen : null;
  } catch (err) {
    defaultLogger.logError(
      new Error("ordenes/page: la franja de reprogramados retenidos no se pudo leer; la página sigue sin ella", {
        cause: err,
      }),
    );
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
  // Feature 158 (T2.7, Q-H): acción POR FILA "Reportar incidente", para roles de ACCESO
  // TOTAL. NO va por `accionesLote` aunque hoy coincida el predicado: un incidente pide causa,
  // motivo y fotos POR ORDEN y no puede ser una acción de lote, así que se declara aparte para
  // que nadie lo meta en la barra de selección al leer esto dentro de seis meses.
  //
  // ⚠️ Declarado, no disimulado: el service admite además al `adminSatelite` acotado a su zona
  // (R48), pero `/ordenes` le hace `notFound` (arriba) porque su superficie es
  // `/recepcion-satelite`. Hoy, en la práctica, sólo maestro/admin tienen desde dónde reportar.
  const puedeReportarIncidente = rol ? esAccesoTotal(rol) : false;

  // Ficha 312 (E2, design §9.1): accion POR FILA "Corregir datos" (destinatario, telefono,
  // producto y notas), para roles de ACCESO TOTAL.
  //
  // NO va por `accionesLote` aunque hoy coincida el predicado, y no es duplicacion: un lote no
  // tiene un «destinatario» comun, asi que la correccion no puede ser una accion de barra. Se
  // declara aparte para que nadie la meta ahi al leer esto dentro de seis meses.
  //
  // ⚠️ El `adminTienda` NO la recibe, y es deliberado (D2): tambien opera en `/ordenes`
  // (`usaFiltroEstado` lo incluye), pero su superficie de correccion son las cards de
  // `/novedades` —sobre sus propias ordenes y en los dos grupos—. El servidor lo autoriza
  // igualmente ahi, no aqui.
  const puedeCorregirDatos = rol ? esAccesoTotal(rol) : false;

  // Pedido humano (2026-08-27): ELIMINAR una orden —y RECUPERAR una eliminada, y verlas
  // siquiera— es SOLO del `maestro`. No es `esAccesoTotal` y no es un descuido que no lo sea:
  // el borrado retira la orden de los listados de la tienda dueña y del mensajero asignado, y
  // con dos roles capaces de hacerlo el rastro de quién lo hizo deja de ser una sola persona.
  //
  // ⭑ FICHA 358 (2026-09-02): la prop se PARTE EN DOS, porque desde hoy las dos mitades no van
  // al mismo rol. El humano abrió ELIMINAR a la tienda, acotado a lo suyo (la misma regla que ya
  // tenía por API key desde la 320); RECUPERAR y ver las eliminadas siguen siendo del `maestro`
  // y solo suyas —`RecuperarOrdenService` corta por rol y `listar` responde `forbidden` a quien
  // pida el interruptor «Eliminadas» sin serlo—. Mantenerlas en una sola prop le habría puesto a
  // la tienda un interruptor y un botón que el servidor rechaza, que es justo lo que el campo
  // `eliminable` del DTO existe para evitar.
  //
  // ⭑ FICHA 424 (2026-09-14, pedido humano): el `admin` SÍ entra en la primera —vuelve a poder
  // ELIMINAR, revirtiendo el estrechamiento del 2026-08-27— y NO entra en la segunda: no recupera
  // ni ve las eliminadas (D1: «que borre»; la papelera no se le abre, y si se equivoca se lo pide
  // al `maestro`). Las Server Actions y el propio listado revalidan el rol server-side; esto
  // decide qué se OFRECE, nunca qué se permite.
  //
  // ⚠️ Y AQUÍ NO HAY UNA SEGUNDA LISTA DE ROLES (R20, confirmado por el humano). `puedeEliminar`
  // NO dice `|| rol === RolValue.admin`: se DERIVA de `resolverAlcanceBorradoOrden`, el MISMO
  // punto que autoriza el borrado en el servidor (`EliminarOrdenService`) y que decide si el
  // listado anota `eliminable` en cada fila (`OrdenService.marcarEliminable`). Dos listas que
  // contestan la misma pregunta es EXACTAMENTE el defecto que reportó la ficha 358 («Nuform
  // quiere eliminar NA-495 y no le aparece el checkbox»): una se amplía y la otra se queda, y el
  // fallo se ve como un botón que no aparece, no como un error. La función es pura —sin Prisma,
  // sin `next/`, sin entorno—, así que importarla desde un Server Component no arrastra nada.
  //
  // `puedeVerEliminadas` se queda como literal A PROPÓSITO: es OTRA pregunta (R18) y tiene que
  // poder divergir de la primera, que es justo lo que la 358 partió en dos props.
  const puedeEliminar = actor
    ? resolverAlcanceBorradoOrden(actor).alcance !== "denegado"
    : false;
  const puedeVerEliminadas = rol === RolValue.maestro;

  // Feature 144/TB2.5 (R47, R64): el catálogo de los filtros (zonas, cuentas tienda,
  // mensajeros y geografía) se resuelve AQUÍ, en el servidor, tras las guardias de rol; sus
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
  // "Reasignables" es un filtro de despacho (prioridad + no reprogramada + sin
  // mensajero): solo le sirve a quien reasigna mensajeros. `adminTienda` no opera esa
  // transición, así que el interruptor no se le declara.
  const incluirFiltroReasignables = rol !== RolValue.adminTienda;
  // Pedido humano (2026-08-25): filtro por MENSAJERO asignado, encadenado a la zona. Se le
  // declara a quien despacha (maestro/admin) y NO al `adminTienda`, por la misma razón que el
  // de tienda: el directorio de mensajeros es del personal interno y su catálogo tampoco se lo
  // entrega, así que el control se le montaría vacío.
  const incluirFiltroMensajero = rol !== RolValue.adminTienda;
  // FICHA 370: «Salida a reparto» parte las órdenes que están en bodega entre las que ya
  // salieron con un mensajero y las que sólo tienen la guía generada. Es la MISMA puerta que
  // «Reasignables» y por la misma razón: es una pregunta de DESPACHO, y el `adminTienda` no
  // despacha. Lo que decide aquí es qué se OFRECE; el alcance lo sigue imponiendo el servicio.
  const incluirFiltroSalioAReparto = rol !== RolValue.adminTienda;

  // Feature 246 (T4.2, R5/R29): las etiquetas del selector de día se resuelven AQUÍ, en el
  // servidor, con el día de Costa Rica. No bajan como `Date` ni como instante: bajan como las dos
  // fechas calendario ya decididas, `YYYY-MM-DD`. El navegador no vuelve a interpretar nada — un
  // portátil con la hora corrida no puede etiquetar mal una opción.
  //
  // ⚠️ Esto se calcula UNA VEZ, al renderizar la página. Es el caso de la medianoche (decisión
  // D6, `design.md` §4.4): una pestaña abierta desde ayer enseña las fechas de ayer, aunque el
  // día al que va el lote lo decide el servidor al ENVIAR. Está medido (M1: la asignación más
  // tardía de los últimos 30 días es a las 20:00) y el escape está diseñado y NO implementado a
  // propósito. El porqué entero vive en `components/shared/SelectorDiaReparto.tsx`.
  const fechasDiaReparto = {
    hoy: fechaCalendarioCR(),
    manana: mananaCalendarioCR(),
  };

  // FICHA 462 (T3.5, R32/R36): la franja de reprogramados retenidos se lee SOLO para acceso total
  // (`maestro`/`admin`), que es quien puede aprobar los cierres del ámbito central. Para el
  // `adminTienda` no se ejecuta ni una consulta (R36). MUTACIÓN OBLIGATORIA (design §8.2-13): quitar
  // `esAccesoTotal` de aquí pone rojo el test de la página («adminTienda no dispara la lectura»).
  const retenidasCentral = rol && esAccesoTotal(rol) ? await resolverRetenidasCentral() : null;

  return (
    <AppPage title="Órdenes" description="Listado y gestión de órdenes">
      {/* FICHA 462 (S4): ANTES del listado. Con `null` o 0 retenidas no pinta nada (R35/R37). */}
      <FranjaReprogramadasRetenidas resumen={retenidasCentral} />
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
          incluirFiltroReasignables={incluirFiltroReasignables}
          incluirFiltroMensajero={incluirFiltroMensajero}
          incluirFiltroSalioAReparto={incluirFiltroSalioAReparto}
          puedeReportarIncidente={puedeReportarIncidente}
          puedeCorregirDatos={puedeCorregirDatos}
          puedeEliminar={puedeEliminar}
          puedeVerEliminadas={puedeVerEliminadas}
          fechasDiaReparto={fechasDiaReparto}
        />
      ) : (
        // adminSatelite / mensajero / sin sesión: listado plano previo, SIN
        // regresión (R20). Feature 49: "Ver historial" por fila.
        <OrdenesModule puedeCargarMasiva={puedeCargarMasiva} mostrarHistorial />
      )}
    </AppPage>
  );
}
