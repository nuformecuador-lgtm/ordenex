"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { PorAceptarSection } from "@/app/(app)/_components/PorAceptarSection";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";
import {
  escogerParaGestion,
  liberarGestion,
} from "@/lib/actions/mis-asignaciones";
import type {
  MiAsignacionDTO,
  RutaResumenDTO,
} from "@/lib/interfaces/services/IMisAsignacionesService";
import { normalizeName } from "@/lib/utils/normalize";

import {
  coincideBusqueda,
  filtrarAsignaciones,
} from "./mis-asignaciones-buscador";
import { FiltroCantonDistrito } from "./FiltroCantonDistrito";
import { useFiltroCantonDistrito } from "./useFiltroCantonDistrito";
import { RecogerPaqueteCard } from "./RecogerPaqueteCard";
import { RecoleccionTiendaPanel } from "./RecoleccionTiendaPanel";
import { MarcarLuegoToggle } from "./MarcarLuegoToggle";
import { GestionarOrdenPanel } from "./GestionarOrdenPanel";
import { ChatFlotante } from "./chat-demo/ChatFlotante";
import { PosOrderCardDetalle } from "./pos-card/PosOrderCardDetalle";
import { PosOrderCardMosaico } from "./pos-card/PosOrderCardMosaico";
import { RutaMapa } from "./RutaMapa";
import { SincronizarRutaButton } from "./SincronizarRutaButton";
import { CarruselCards } from "@/components/shared/CarruselCards";

import { VistaCardsToggle, type VistaCards } from "./VistaCardsToggle";
import { CLASE_FASE, useTransicionVista } from "./useTransicionVista";
import type { RutaMapaOrigen, RutaMapaParada } from "./ruta-mapa-tipos";

// Feature 36 (T15-T17) / rediseño 63 (pedido humano): módulo del mensajero.
// Recibe los DOS grupos ya resueltos por el Server Component padre (datos
// sensibles por props, sin fetch de cliente) y el puntero de bloqueo
// `ordenEnGestionId` (backend, robusto a recarga). Las mutaciones van por Server
// Action (recoger / escoger / gestionar / liberar) y refrescan la ruta
// (router.refresh) para releer el estado del servidor.
//
// UX "En reparto" (feature 113): cada card muestra el detalle COMPLETO inline
// (Pedido/Entrega/Cobro, vía `AsignacionDetalle`), no una vista compacta. Cuando el
// puntero 1-a-1 (`ordenEnGestionId`) queda fijado y el mensajero NO está bloqueado, la
// vista entra en MODO FOCO y colapsa a SOLO el panel de la orden activa: se ocultan la
// grilla de cards, el mapa/ruta y la sección "Por recoger" para gestionar sin
// distracciones. Al liberar/finalizar la gestión el puntero vuelve a `null`
// (router.refresh) y se restaura la vista completa. El bloqueo 1-a-1 (R19/R20) sigue
// siendo una restricción de ACCIÓN (no se puede escoger otra orden), no de visibilidad.

export interface MisAsignacionesModuleProps {
  /** Órdenes en `por_recoger`. */
  porRecoger: MiAsignacionDTO[];
  /**
   * Feature 157 (R11): TERCER grupo — lo que el mensajero va a recoger EN LA TIENDA. No entra
   * en `unionAsignaciones` (no aporta opciones al filtro cantón/distrito ni se filtra por él,
   * R40) ni en el mapa ni en los KPIs (R39): el paquete todavía no está en la calle.
   *
   * Opcional por el patrón aditivo del repo: los fixtures que montan el módulo para probar
   * otra cosa no tienen que declarar un grupo que no les interesa. La página SIEMPRE lo pasa.
   */
  porRecolectar?: MiAsignacionDTO[];
  /** Órdenes en `en_reparto` (por gestionar), YA ordenadas por la ruta (R28). */
  porGestionar: MiAsignacionDTO[];
  /** Orden activa en gestión (R19/R20); `null` = ninguna, todas gestionables. */
  ordenEnGestionId: string | null;
  /** Feature 97 (R27/R28/R30): estado de la ruta optimizada que produjo el orden. */
  ruta: RutaResumenDTO;
  /**
   * Feature 111/R12/R14: `true` si el mensajero está BLOQUEADO (cierre pendiente).
   * El bloqueo es TOTAL: se muestra el aviso y se desactivan/guardan los controles de
   * recoger, escoger y gestionar. Defensa SUAVE; el backend (R1/R4) es la defensa real.
   */
  bloqueado: boolean;
}

// Feature 111/R12: aviso accionable de BLOQUEO TOTAL (texto separado, i18n-ready).
const BLOQUEO_AVISO =
  "No puedes gestionar ni recibir nuevas asignaciones hasta resolver tu cierre pendiente. Ve a «Cierre del día» para resolverlo.";

// Feature 114: textos del buscador (separados para i18n futura, lenguaje claro). La
// región y la etiqueta del campo son DISTINTAS a propósito: si coincidieran, el nombre
// accesible del `searchbox` (de su `<label>`) chocaría con el de la región.
const BUSCADOR_REGION = "Buscar guías asignadas";
const BUSCADOR_LABEL = "Buscar guías";
const BUSCADOR_PLACEHOLDER =
  "Filtra por número de guía, remisión, teléfono o nombre";
// R6: mensajes de "sin resultados", distintos del vacío sin búsqueda; contienen la
// frase «coincide con la búsqueda» para ser reconocibles.
const SIN_RESULTADOS_RECOGER = "Ninguna guía por recoger coincide con la búsqueda.";
const SIN_RESULTADOS_REPARTO = "Ninguna guía en reparto coincide con la búsqueda.";

// Feature 117/R11: mensajes de "sin coincidencias con el filtro" (cantón/distrito),
// distintos del vacío base ("No hay órdenes…") y del "sin resultados" del buscador (114).
// Contienen la frase «coincide con el filtro» para ser reconocibles.
const SIN_COINCIDENCIAS_RECOGER = "Ninguna guía por recoger coincide con el filtro.";
const SIN_COINCIDENCIAS_REPARTO = "Ninguna guía en reparto coincide con el filtro.";

export function MisAsignacionesModule({
  porRecoger,
  porRecolectar = [],
  porGestionar,
  ordenEnGestionId,
  ruta,
  bloqueado,
}: MisAsignacionesModuleProps) {
  const router = useRouter();
  const toast = useToast();

  // Feature 97: última ubicación GPS capturada por el botón de sincronización. Se usa como
  // punto de partida del mapa. Sobrevive a `router.refresh()` (estado de cliente), así que el
  // origen se mantiene dibujado tras recalcular la ruta. NO se pide GPS al montar (R25: nunca
  // se fuerza el permiso; solo se captura cuando el mensajero pulsa "Sincronizar ruta").
  const [ubicacionActual, setUbicacionActual] = useState<RutaMapaOrigen | null>(
    null,
  );
  const [mostrarMapa, setMostrarMapa] = useState(true);

  // Rediseño ux: apertura del CHAT (el modal del botón flotante). Vive aquí porque tiene
  // DOS disparadores: el propio botón flotante y la acción "Mensaje" del panel de detalle.
  const [chatAbierto, setChatAbierto] = useState(false);

  // Rama ux (pedido humano): presentación de las cards de "En reparto / por gestionar".
  // Estado de UI EFÍMERO de un solo consumidor (no sube a URL ni a contexto) y puramente
  // visual: NO filtra ni reordena nada, solo cambia el componente que pinta cada orden.
  // Arranca en "mosaico" (más órdenes visibles de un vistazo en la calle). El cambio va
  // ANIMADO en dos tramos encadenados (bajan las viejas, suben las nuevas): de eso se
  // encarga `useTransicionVista`, que sostiene la vista vieja hasta terminar la salida.
  const {
    vista: vistaCards,
    vistaPedida: vistaCardsPedida,
    fase: faseVista,
    cambiarVista,
  } = useTransicionVista<VistaCards>("mosaico");

  // Feature 114: texto del buscador de guías. Estado de UI EFÍMERO, de un solo consumidor
  // (no sube a URL ni a contexto). Se muestra solo en la VISTA COMPLETA; en modo foco no
  // hay cards que filtrar. `buscando` distingue "hay búsqueda activa" de "grupo vacío".
  const [query, setQuery] = useState("");
  const buscarId = useId();
  const buscando = query.trim() !== "";

  // Feature 117: filtro por cantón/distrito (100% cliente, R12). Las OPCIONES se derivan
  // de la UNIÓN de ambos grupos SIN filtrar (R13: el conjunto COMPLETO cargado, para que
  // la selección actual no borre otras opciones de cantón disponibles). Se compone en AND
  // con el buscador (114) sobre las MISMAS listas visibles (ver `porRecogerFiltrado` /
  // `porGestionarFiltrado`); la orden en gestión nunca se oculta (salvaguarda R10/R14).
  const unionAsignaciones = useMemo<MiAsignacionDTO[]>(
    () => [...porRecoger, ...porGestionar],
    [porRecoger, porGestionar],
  );
  const filtro = useFiltroCantonDistrito(unionAsignaciones);
  const aplicarFiltroZona = filtro.aplicar;

  // Feature 114/R2/R7 + 117/R6: "Por recoger" = buscador(texto) ∧ filtro(cantón/distrito),
  // compuestos en AND sobre la misma lista. Query vacío y filtro vacío ⇒ lista intacta
  // (R5/R7). Independiente de "En reparto" (no comparte salvaguarda: la orden en gestión
  // solo existe en reparto).
  const porRecogerFiltrado = useMemo<MiAsignacionDTO[]>(
    () => aplicarFiltroZona(filtrarAsignaciones(porRecoger, query)),
    [porRecoger, query, aplicarFiltroZona],
  );

  // Feature 114/R8+R9 + 117/R6/R14: "En reparto" filtrado, ÚNICA fuente para grilla, mapa
  // y panel de detalle (coherencia lista↔mapa↔panel, gate F1.4). Composición EN AND:
  // primero el buscador (114) y sobre su salida el filtro cantón/distrito (117). Salvaguarda
  // (R9 de 114 / R10 de 117): la orden EN GESTIÓN (`ordenEnGestionId`) permanece SIEMPRE,
  // aunque no coincida con el texto NI con el filtro; ningún filtro oculta la gestión en
  // curso. Con `ordenEnGestionId === null` la salvaguarda no aplica a nadie.
  const porGestionarFiltrado = useMemo<MiAsignacionDTO[]>(() => {
    const q = normalizeName(query);
    // 114: buscador, con la orden en gestión siempre incluida.
    const trasBuscador = porGestionar.filter(
      (o) => o.id === ordenEnGestionId || coincideBusqueda(o, q),
    );
    // 117: filtro cantón/distrito EN AND sobre la misma lista.
    const trasFiltro = aplicarFiltroZona(trasBuscador);
    if (
      ordenEnGestionId === null ||
      trasFiltro.some((o) => o.id === ordenEnGestionId)
    ) {
      return trasFiltro;
    }
    // La orden en gestión quedó fuera del filtro cantón/distrito: reinsertarla
    // preservando el orden de ruta (salvaguarda R10 — nunca se oculta la gestión).
    const visibles = new Set(trasFiltro.map((o) => o.id));
    visibles.add(ordenEnGestionId);
    return trasBuscador.filter((o) => visibles.has(o.id));
  }, [porGestionar, query, ordenEnGestionId, aplicarFiltroZona]);

  // R28/mapa: paradas dibujables = las en reparto CON coordenadas (feature 91). Las que no
  // tienen coords se omiten del mapa pero siguen en la lista (no se pierden). Feature
  // 114/R8: deriva del conjunto FILTRADO, así el mapa refleja la búsqueda (con la orden en
  // gestión siempre presente por R9).
  const paradasMapa = useMemo<RutaMapaParada[]>(
    () =>
      porGestionarFiltrado
        .filter((o) => o.latitud !== null && o.longitud !== null)
        .map((o) => ({
          id: o.id,
          secuencia: o.secuenciaRuta,
          lat: o.latitud as number,
          lng: o.longitud as number,
          etiqueta: `${o.numRemision} · ${o.destinatario}`,
        })),
    [porGestionarFiltrado],
  );

  // Feature 115/R19 — orden VISUAL de las cards. El server ya manda `porGestionar` en el
  // orden de la ruta (feature 92). Aquí SOLO se añade un criterio secundario de PRESENTACIÓN:
  // hundir al final las marcadas como "gestionar más tarde", preservando entre las no
  // marcadas (y entre las marcadas) el orden de ruta que ya llega. El `sort` de JS es ESTABLE
  // (ES2019), así que comparar solo por la marca conserva el orden previo dentro de cada grupo.
  // Copia (`[...]`) para NO mutar la lista ni la ruta persistida (R16/R19). Feature 114:
  // ordena sobre el conjunto FILTRADO (la grilla muestra lo filtrado), preservando el
  // reordenado de 115 dentro de ese subconjunto.
  const porGestionarVisual = useMemo<MiAsignacionDTO[]>(
    () =>
      [...porGestionarFiltrado].sort(
        (a, b) => Number(a.marcarLuego ?? false) - Number(b.marcarLuego ?? false),
      ),
    [porGestionarFiltrado],
  );

  // R30: la ruta no refleja el estado real si la última optimización falló
  // (`desactualizada`) o si entraron paradas nuevas sin posición todavía.
  const rutaDesactualizada =
    ruta.estado === "desactualizada" || ruta.paradasSinOptimizar > 0;
  // R24: aviso de que el punto de partida usado es aproximado (no GPS reciente).
  const origenAproximado =
    ruta.origenFuente === "centroide" || ruta.origenFuente === "ultima_conocida";

  // Orden que el mensajero eligió explícitamente para el panel de detalle. Es
  // solo una PREFERENCIA: la orden mostrada se DERIVA (ver `detalleOrden`) para
  // no quedar pegada a una orden que ya no existe tras `router.refresh()`.
  const [seleccionId, setSeleccionId] = useState<string | null>(null);

  // Orden mostrada en el panel de detalle. Nunca `null` si hay al menos una en
  // reparto. Prioridad: (1) la ACTIVA (puntero fijado); (2) la elegida por el
  // mensajero si sigue existiendo; (3) la PRIMERA de la lista. Derivada en cada
  // render → estable ante cambios de `porGestionar`/`ordenEnGestionId`.
  // Feature 114/R8: deriva del conjunto FILTRADO (coherencia lista↔panel). La orden en
  // gestión siempre está en `porGestionarFiltrado` (salvaguarda R9), así que el puntero
  // sigue mandando en el panel. Si el filtro deja "En reparto" sin coincidencias, no hay
  // orden en el panel (la grilla muestra el estado "sin resultados", R6).
  const detalleOrden = useMemo<MiAsignacionDTO | null>(() => {
    if (porGestionarFiltrado.length === 0) return null;
    if (ordenEnGestionId !== null) {
      return (
        porGestionarFiltrado.find((o) => o.id === ordenEnGestionId) ??
        porGestionarFiltrado[0]
      );
    }
    if (seleccionId !== null) {
      const elegida = porGestionarFiltrado.find((o) => o.id === seleccionId);
      if (elegida) return elegida;
    }
    return porGestionarFiltrado[0];
  }, [porGestionarFiltrado, ordenEnGestionId, seleccionId]);

  // Feature 113/R5 — MODO FOCO: flag DERIVADO de una sola fuente de verdad
  // (`ordenEnGestionId`, backend, robusto a recarga). Con una gestión activa y sin
  // bloqueo, la vista colapsa a SOLO el panel de la orden activa (R5–R9). Al volver el
  // puntero a `null` tras `router.refresh()` deja de cumplirse y se restaura la vista
  // completa (R10) sin estado extra. `bloqueado` tiene precedencia: anula el foco (R12).
  const modoFoco =
    !bloqueado && ordenEnGestionId !== null && detalleOrden !== null;

  // Seleccionar una card la lleva al panel de detalle. Bloqueada si hay otra
  // gestión activa (R19/R20): no se puede cambiar la orden del panel. Feature
  // 111/R14: si el mensajero está BLOQUEADO no se puede escoger (defensa suave).
  function seleccionar(orden: MiAsignacionDTO) {
    if (bloqueado) return;
    if (ordenEnGestionId !== null && ordenEnGestionId !== orden.id) return;
    setSeleccionId(orden.id);
  }

  // R17 (T17): al pulsar "Gestionar pedido" se fija el puntero de bloqueo 1-a-1
  // sobre la orden del panel de detalle. Devuelve `true` si quedó fijado (el
  // panel revela los 4 botones).
  async function gestionarPedido(): Promise<boolean> {
    if (!detalleOrden) return false;
    // Feature 111/R14: guarda suave. El mensajero bloqueado no puede escoger para
    // gestión; se le remite a resolver su cierre. El backend (R1/R4) rechaza igual.
    if (bloqueado) {
      toast.error(BLOQUEO_AVISO);
      return false;
    }
    const result = await escogerParaGestion({ ordenId: detalleOrden.id });
    if (result.status === "ok") {
      router.refresh(); // refleja el bloqueo de las demás (ordenEnGestionId)
      return true;
    }
    toast.error(
      result.status === "conflict"
        ? "Ya tienes otra orden activa en gestión."
        : "No puedes gestionar esta orden.",
    );
    return false;
  }

  function handleGestionSuccess() {
    // Path de ÉXITO: el backend YA limpió el puntero dentro de la transacción de
    // `gestionar`. NO se llama a `liberarGestion` aquí (evita doble limpieza).
    setSeleccionId(null);
    router.refresh();
  }

  // R35: "Cancelar gestión" libera el puntero de bloqueo (`orden_en_gestion_id`)
  // para que las demás vuelvan a ser gestionables, sin cambiar de orden en el
  // panel. Solo se ofrece cuando el puntero está fijado. Best-effort; sin Toast.
  async function cancelarGestion() {
    if (!detalleOrden) return;
    await liberarGestion({ ordenId: detalleOrden.id });
    router.refresh();
  }

  /**
   * Una card de "En reparto". Extraída para que el CARRUSEL (vista mosaico) y la LISTA
   * (vista detalle) rendericen exactamente la misma card con las mismas señales: el
   * conmutador solo cambia el envoltorio y el componente de presentación.
   *
   * Feature 111/R14 + 113/R3: con el mensajero BLOQUEADO todas las cards quedan
   * deshabilitadas (no puede escoger para gestión); el porqué lo explica el aviso de bloqueo
   * total de arriba. La deshabilitación restringe la ACCIÓN, no la visibilidad: el detalle
   * completo sigue montado (R3). Fuera de foco `ordenEnGestionId` es null (una gestión activa
   * sin bloqueo colapsa a foco, R5), así que no existe aquí el estado "card visible con
   * detalle oculto" que introducía el spec 36 (eliminado).
   *
   * Rediseño POS (rama ux): las dos vistas comparten interfaz de props con la card completa
   * (`PosOrderCardMosaico`, que "Por recoger" también usa). Conserva las señales
   * del módulo (parada/ruta, "gestionar más tarde", nota privada, intentos) y el gate de
   * selección: pulsar la card fija esta orden en el panel de gestión de arriba (R19/R20),
   * donde vive el detalle completo. Pedido humano: el toggle "gestionar más tarde" va DENTRO
   * de la card (slot `acciones`, al pie), no como hermano suelto debajo. La card es un
   * `<article>`, no un botón, así que alojar controles es HTML válido y el gate de selección
   * los ignora (no seleccionan de rebote).
   */
  function renderCardEnReparto(orden: MiAsignacionDTO, vista: VistaCards) {
    const CardVista =
      vista === "mosaico" ? PosOrderCardMosaico : PosOrderCardDetalle;
    return (
      <CardVista
        orden={orden}
        total={porGestionar.length}
        esActiva={ordenEnGestionId === orden.id}
        esDetalle={detalleOrden?.id === orden.id}
        bloqueado={bloqueado}
        onGestionar={() => seleccionar(orden)}
        acciones={
          // Feature 115/R5/R6: puramente informativo (no cambia estado ni ruta), así que
          // sigue disponible aunque la card esté deshabilitada por el cierre pendiente.
          <MarcarLuegoToggle
            ordenId={orden.id}
            marcada={orden.marcarLuego ?? false}
            numRemision={orden.numRemision}
          />
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ---------- Aviso de BLOQUEO TOTAL del mensajero (feature 111/R12) ---------- */}
      {/* Precede a todo y tiene precedencia sobre el modo foco (feature 113/R12): un
          mensajero BLOQUEADO no colapsa a foco; ve el aviso, la lista con detalle inline
          y las cards deshabilitadas, sin panel de gestión. */}
      {bloqueado ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {BLOQUEO_AVISO}
        </p>
      ) : null}

      {modoFoco && detalleOrden ? (
        /* ---------- MODO FOCO (feature 113/R5–R9) ---------- */
        /* Vista sin distracciones para gestionar la orden activa en la calle: SOLO el
           panel (que ya incluye el detalle completo + el flujo de 4 resultados y
           "Cancelar gestión"). Se omiten la grilla de cards (R6), el mapa/ruta y
           "Sincronizar ruta" (R7) y la sección "Por recoger" (R8). Arranca en `yaActiva`
           (el puntero 1-a-1 ya está fijado). Al liberar/finalizar la gestión el puntero
           vuelve a `null` y la vista completa se restaura sola (R10). */
        <GestionarOrdenPanel
          key={detalleOrden.id}
          orden={detalleOrden}
          yaActiva
          onGestionarPedido={gestionarPedido}
          onCancelarGestion={cancelarGestion}
          onSuccess={handleGestionSuccess}
          count={1}
          onAbrirChat={() => setChatAbierto(true)}
        />
      ) : (
        /* ---------- VISTA COMPLETA (fuera de foco) ---------- */
        <>
          {/* ---------- Feature 117: filtro por cantón y distrito (solo vista de lista) ----------
              Se compone en AND con el buscador sobre AMBOS grupos. Las opciones se derivan del
              conjunto completo cargado (R13); elegir cantón resetea el distrito (R5) y el
              distrito va deshabilitado sin cantón (R3). En modo foco no se renderiza (no hay
              cards que filtrar). Puro filtro de cliente, así que permanece aunque el mensajero
              esté bloqueado (la lista sigue como solo-visualización). */}
          <FiltroCantonDistrito
            canton={filtro.canton}
            distrito={filtro.distrito}
            cantones={filtro.cantones}
            distritos={filtro.distritos}
            hayFiltro={filtro.hayFiltro}
            onCantonChange={filtro.setCantonYReset}
            onDistritoChange={filtro.setDistrito}
            onLimpiar={filtro.limpiar}
          />

          {/* ---------- Apartado: Por recolectar en tienda (feature 157) ---------- */}
          {/* Va ENCIMA de "Por recoger" porque es lo primero del viaje: el paquete sigue en
              la tienda y hay que ir por él. El buscador SÍ se le aplica (buscar una guía por
              número sirve igual recolectando); el filtro cantón/distrito NO (R40): esas
              órdenes no son paradas de la ruta y su geografía no dice dónde hay que ir, que
              es la tienda. El panel se oculta solo cuando no hay nada que recolectar. */}
          <RecoleccionTiendaPanel
            porRecolectar={filtrarAsignaciones(porRecolectar, query)}
            bloqueado={bloqueado}
            onRecolectada={() => router.refresh()}
          />

          {/* ---------- Apartado: Por recoger (por_recoger) ---------- */}
          {/* Feature 96: la recogida queda SOLO por dos vías, ambas resuelven el num_guia
              contra `porRecoger` (restricción "asignada a mí") y aceptan con la MISMA action
              `recogerAsignaciones`, directo al confirmar (sin modal):
                (1) input de número de guía tecleado + Enter/botón;
                (2) escáner de cámara (QR de la etiqueta -> num_guia).
              Feature 111/R14: BLOQUEADO oculta ambos controles de recogida (defensa suave;
              la lista de "Por recoger" sigue visible, solo-visualización).
              Pedido humano: sin NADA por recoger la card tampoco se muestra — no hay guía
              que resolver, así que el input y el escáner solo estorbarían. Se mira
              `porRecoger` COMPLETO, no el filtrado: el buscador/filtro de la lista no debe
              quitarle al mensajero la forma de recoger lo que sigue pendiente. */}
          {bloqueado || porRecoger.length === 0 ? null : (
            <RecogerPaqueteCard
              porRecoger={porRecoger}
              onRecogida={() => router.refresh()}
            />
          )}

          {/* Lista de SOLO-VISUALIZACIÓN (feature 96): reutiliza la sección compartida "por
              aceptar" con `mostrarAcciones={false}` (ya no hay botones "Recoger todas" /
              "Recoger"). El mensajero sigue viendo qué guías tiene por recoger; la acción
              vive en el input y el escáner de arriba.
              Rediseño POS (rama ux): las cards son las MISMAS que "En reparto"
              (`PosOrderCardMosaico`, misma grilla y mismo lenguaje visual), pero sin selección
              (`onGestionar` ausente): aquí no hay nada que gestionar. También se omiten
              las señales de ruta (`mostrarRuta={false}`): estas órdenes todavía no están
              en la ruta. */}
          <PorAceptarSection
            titulo="Por recoger"
            nuevasLabel={(n) => `${n} Órdenes nuevas asignadas`}
            ordenes={porRecogerFiltrado}
            mostrarAcciones={false}
            vacio={
              buscando
                ? SIN_RESULTADOS_RECOGER
                : filtro.hayFiltro
                  ? SIN_COINCIDENCIAS_RECOGER
                  : "No hay órdenes por recoger."
            }
            listClassName="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            renderItem={(orden) => (
              <PosOrderCardMosaico
                orden={orden}
                total={porRecogerFiltrado.length}
                estado="Por recoger"
                mostrarRuta={false}
              />
            )}
          />

          {/* ---------- Apartado: En reparto / por gestionar (en_reparto) ---------- */}          
          {/* Feature 113/R1: cada card en grilla (1/2/3 col) muestra el detalle COMPLETO
              inline (`AsignacionDetalle`). Seleccionar una la lleva también al panel de
              gestión grande de abajo (donde vive el gate "Gestionar pedido"). El bloqueo
              1-a-1 (R19/R20) es una restricción de ACCIÓN: en cuanto hay una gestión
              activa sin bloqueo la vista ya está en foco (R5) y las demás no se muestran. */}
          <section
            aria-label="En reparto / por gestionar"
            className="flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">
                En reparto / por gestionar
              </h2>
              {/* R31/R32: sincronización manual de la ruta. El botón captura el GPS del
                  navegador (best-effort) y lo eleva aquí para dibujar el origen en el mapa. */}
              <SincronizarRutaButton onUbicacion={setUbicacionActual} />
            </div>

            {/* R30: aviso VISIBLE de que el orden mostrado no está actualizado. */}
            {rutaDesactualizada ? (
              <Alert variant="destructive">
                <AlertTitle>El orden mostrado no está actualizado</AlertTitle>
                <AlertDescription>
                  La ruta cambió desde el último cálculo. Pulsa «Sincronizar
                  ruta» para recalcular el orden de entrega.
                </AlertDescription>
              </Alert>
            ) : null}

            {/* R28/mapa: recorrido optimizado sobre OpenStreetMap. Solo si hay paradas
                con coordenadas; las paradas sin coords van igual en la lista de abajo. */}
            {paradasMapa.length > 0 && mostrarMapa ? (
              <div
                aria-label="Mapa de ruta"
                role="group"
                className="flex flex-col gap-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">
                    Mapa de ruta
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setMostrarMapa(false)}
                  >
                    Ocultar mapa
                  </Button>
                </div>
                {origenAproximado ? (
                  <p className="text-xs text-muted-foreground">
                    El punto de partida es aproximado (no se usó tu ubicación GPS
                    reciente).
                  </p>
                ) : null}
                <RutaMapa paradas={paradasMapa} origen={ubicacionActual} />
              </div>
            ) : null}
            {paradasMapa.length > 0 && !mostrarMapa ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="w-fit"
                onClick={() => setMostrarMapa(true)}
              >
                Mostrar mapa de ruta
              </Button>
            ) : null}
            {/* Panel de detalle grande e inline (gate "Gestionar pedido"): muestra la
                orden seleccionada o la primera. Fuera de foco el puntero está en `null`,
                así que arranca en el paso de detalle (`yaActiva=false`); al fijarse el
                puntero la vista pasa a MODO FOCO (arriba). Feature 111/R14: BLOQUEADO no
                renderiza el panel (debe resolver su cierre antes de operar con las guías).
                Pedido humano (rama ux): el detalle va PRIMERO y la lista de cards debajo,
                así el mensajero ve la orden con la que está trabajando sin desplazarse. */}
            {detalleOrden && !bloqueado ? (
              <GestionarOrdenPanel
                key={detalleOrden.id}
                orden={detalleOrden}
                yaActiva={ordenEnGestionId === detalleOrden.id}
                onGestionarPedido={gestionarPedido}
                onCancelarGestion={cancelarGestion}
                onSuccess={handleGestionSuccess}
                count={porGestionar.length}
                onAbrirChat={() => setChatAbierto(true)}
              />
            ) : null}

            {/* ---------- Feature 114: buscador de guías (solo en vista de lista) ----------
              Filtra AMBOS grupos por número de guía, remisión, teléfono o nombre del
              destinatario (parcial,
              insensible a mayúsculas/acentos). En modo foco no se renderiza: no hay cards
              que filtrar. Es un filtro puro de cliente, así que permanece visible aunque el
              mensajero esté bloqueado (la lista sigue como solo-visualización). */}
            {/* Buscador y conmutador de vista comparten fila: son los dos controles de la
                lista. En pantallas angostas se apilan (`flex-col`) para que el input no se
                estruje; desde `sm` van en la MISMA línea, el input ocupando el espacio libre
                y el conmutador alineado a su base. */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
              <section
                aria-label={BUSCADOR_REGION}
                className="flex min-w-0 flex-1 flex-col gap-1"
              >
                <label htmlFor={buscarId} className="text-sm font-medium">
                  {BUSCADOR_LABEL}
                </label>
                <Input
                  id={buscarId}
                  type="search"
                  autoComplete="off"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={BUSCADOR_PLACEHOLDER}
                />
              </section>
              {/* Rama ux: conmutador mosaico/detalle de las cards de abajo. Puramente
                  visual (no filtra ni reordena), pegado al buscador que sí filtra. */}
              <VistaCardsToggle
                vista={vistaCardsPedida}
                onVistaChange={cambiarVista}
              />
            </div>
            {porGestionarFiltrado.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {buscando
                  ? SIN_RESULTADOS_REPARTO
                  : filtro.hayFiltro
                    ? SIN_COINCIDENCIAS_REPARTO
                    : "No hay órdenes en reparto."}
              </p>
            ) : vistaCards === "mosaico" ? (
              /* Pedido humano: en MOSAICO las cards van en carrusel (`CarruselCards`,
                 componente shared sobre la primitiva shadcn), no en grilla. Se ven de 3 en 3
                 según el ancho —1 en móvil, 2 desde `sm`, 3 desde `lg`, los mismos cortes que
                 tenía la grilla— y debajo queda la etiqueta de posición ("Órdenes 1-3 de 5").
                 La vista "detalle" NO se toca: sigue siendo la lista de una fila por orden. */
              <div className={CLASE_FASE[faseVista]}>
                <CarruselCards
                  items={porGestionarVisual}
                  getKey={(orden) => orden.id}
                  ariaLabel="Órdenes en reparto"
                  singular="Orden"
                  plural="Órdenes"
                  renderItem={(orden) => renderCardEnReparto(orden, "mosaico")}
                />
              </div>
            ) : (
              /* La clase de fase anima la lista ENTERA como bloque (bajar+desvanecer /
                 subir+aparecer). Sin transición (`estable`) no añade nada, así que la
                 lista no queda con estilos de animación colgando. */
              <ul className={`flex flex-col gap-3 ${CLASE_FASE[faseVista]}`}>
                {porGestionarVisual.map((orden) => (
                  <li key={orden.id}>
                    {renderCardEnReparto(orden, "detalle")}
                  </li>
                ))}
              </ul>
            )}

          </section>
        </>
      )}

      {/* Rediseño del chat (rama ux) — MAQUETA: botón flotante fijo abajo a la derecha que
          abre el chat con los clientes como modal. Se muestra en las dos vistas (foco y
          lista) porque el mensajero puede necesitar escribir en cualquier momento.
          Contactos = SOLO las órdenes EN REPARTO (`porGestionar`, sin filtrar: el chat es
          una capa aparte del buscador/filtro de la lista); las de "Por recoger" no tienen
          gestión que conversar. La marcada "en gestión" es la que el módulo tiene en
          DETALLE, y es por donde entra al abrirse. El hilo y las plantillas son los MISMOS
          que consume `ChatWhatsappPanel` dentro del panel del detalle (feature 120/87):
          los dos conviven y muestran la misma conversación. */}
      <ChatFlotante
        ordenes={porGestionar}
        ordenEnDetalleId={detalleOrden?.id ?? null}
        abierto={chatAbierto}
        onAbiertoChange={setChatAbierto}
      />
    </div>
  );
}
