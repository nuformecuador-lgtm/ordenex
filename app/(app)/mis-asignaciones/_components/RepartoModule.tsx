"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";
import {
  escogerParaGestion,
  liberarGestion,
} from "@/lib/actions/mis-asignaciones";
// Feature 111/R12: aviso accionable de BLOQUEO TOTAL (texto separado, i18n-ready). Desde la
// 167 lo COMPARTEN los dos portales del mensajero (Entregas y Recolección), así que vive en
// `lib/constants/` para que no puedan divergir en un mensaje que el humano declaró preciso.
import { BLOQUEO_AVISO } from "@/lib/constants/bloqueo-mensajero";
import type {
  MiAsignacionDTO,
  RutaResumenDTO,
} from "@/lib/interfaces/services/IMisAsignacionesService";
// Feature 261 (F3, R15): el motivo del bloqueo por reserva sale de la fuente ÚNICA — la misma
// frase que pinta la card, la que devuelve el servidor y la que lee la tienda.
import { avisoReservaParaOtroDia } from "@/lib/utils/dia-reparto-textos";
import { normalizeName } from "@/lib/utils/normalize";

import { coincideBusqueda } from "./mis-asignaciones-buscador";
import { FiltroCantonDistrito } from "./FiltroCantonDistrito";
import { useFiltroCantonDistrito } from "./useFiltroCantonDistrito";
import { MarcarLuegoToggle } from "./MarcarLuegoToggle";
import { GestionarOrdenPanel } from "./GestionarOrdenPanel";
import { GestionarOrdenCardButton } from "./GestionarOrdenCardButton";
import { HiloNotasAyudaModal } from "./HiloNotasAyudaModal";
import { ChatFlotante } from "./chat/ChatFlotante";
import { PosOrderCardDetalle } from "./pos-card/PosOrderCardDetalle";
import { RecuperarAyudaButton } from "./RecuperarAyudaButton";
import { PosOrderCardMosaico } from "./pos-card/PosOrderCardMosaico";
import { RutaMapa } from "./RutaMapa";
import { useSeguimientoUbicacion } from "./useSeguimientoUbicacion";
import { SincronizarRutaButton } from "./SincronizarRutaButton";
import { TrayectoVivoButton } from "./TrayectoVivoButton";
import { CarruselCards } from "@/components/shared/CarruselCards";

import { VistaCardsToggle, type VistaCards } from "./VistaCardsToggle";
import { CLASE_FASE, useTransicionVista } from "./useTransicionVista";
import { useSeccionColapsable } from "@/hooks/useSeccionColapsable";
import type {
  RutaMapaOrigen,
  RutaMapaParada,
  RutaMapaTrazado,
} from "./ruta-mapa-tipos";

// Feature 36 (T15-T17) / rediseño 63 (pedido humano): pantalla de REPARTO del mensajero.
// Recibe el grupo ya resuelto por el Server Component padre (datos sensibles por props,
// sin fetch de cliente) y el puntero de bloqueo `ordenEnGestionId` (backend, robusto a
// recarga). Las mutaciones van por Server Action (escoger / gestionar / liberar) y
// refrescan la ruta (router.refresh) para releer el estado del servidor.
//
// 2026-07-31 (decisión del humano) — CORTE: este módulo era `MisAsignacionesModule` y
// montaba TAMBIÉN el apartado "Por recoger" (escáner + listado). Ahora esa mitad vive en
// su propia pantalla (`/mis-asignaciones/recoger`, `RecogerModule`) con su subítem de
// menú: el escáner quedaba enterrado bajo el panel de gestión y el mensajero no lo veía.
// Consecuencia buscada del corte: el MODO FOCO ya no necesita ocultar "Por recoger"
// (feature 113/R8) — no está en esta pantalla; sigue ocultando la grilla y el mapa.
//
// UX "En reparto" (feature 113): cada card muestra el detalle COMPLETO inline
// (Pedido/Entrega/Cobro, vía `AsignacionDetalle`), no una vista compacta. Cuando el
// puntero 1-a-1 (`ordenEnGestionId`) queda fijado y el mensajero NO está bloqueado, la
// vista entra en MODO FOCO y colapsa a SOLO el panel de la orden activa: se ocultan la
// grilla de cards y el mapa/ruta para gestionar sin distracciones. Al liberar/finalizar la
// gestión el puntero vuelve a `null` (router.refresh) y se restaura la vista completa. El
// bloqueo 1-a-1 (R19/R20) sigue siendo una restricción de ACCIÓN (no se puede escoger otra
// orden), no de visibilidad.

export interface RepartoModuleProps {
  /** Órdenes en `en_reparto` (por gestionar), YA ordenadas por la ruta (R28). */
  porGestionar: MiAsignacionDTO[];
  /**
   * Feature 235 (R18/R19): órdenes en `ayuda_tienda` del mensajero, YA SEPARADAS POR EL
   * SERVIDOR. Hasta el 2026-08-19 esta lista se derivaba AQUÍ, con un `useMemo` sobre la bandera
   * `orden.ayuda`, y por eso las órdenes con ayuda seguían siendo paradas del mapa, contactos del
   * chat y candidatas del panel: el corte era MAQUETACIÓN. Ahora llega hecho y este módulo no
   * vuelve a decidirlo.
   */
  conAyuda: MiAsignacionDTO[];
  /** Orden activa en gestión (R19/R20); `null` = ninguna, todas gestionables. */
  ordenEnGestionId: string | null;
  /** Feature 97 (R27/R28/R30): estado de la ruta optimizada que produjo el orden. */
  ruta: RutaResumenDTO;
  /**
   * Feature 111/R12/R14: `true` si el mensajero está BLOQUEADO (cierre pendiente).
   * El bloqueo es TOTAL: se muestra el aviso y se desactivan/guardan los controles de
   * escoger y gestionar. Defensa SUAVE; el backend (R1/R4) es la defensa real.
   */
  bloqueado: boolean;
}

// Feature 114: textos del buscador (separados para i18n futura, lenguaje claro). La
// región y la etiqueta del campo son DISTINTAS a propósito: si coincidieran, el nombre
// accesible del `searchbox` (de su `<label>`) chocaría con el de la región.
const BUSCADOR_REGION = "Buscar guías asignadas";
const BUSCADOR_LABEL = "Buscar guías";
const BUSCADOR_PLACEHOLDER =
  "Filtra por número de guía, remisión, teléfono o nombre";
// R6: mensaje de "sin resultados", distinto del vacío sin búsqueda; contiene la
// frase «coincide con la búsqueda» para ser reconocible.
const SIN_RESULTADOS_REPARTO = "Ninguna guía en reparto coincide con la búsqueda.";

// Pedido humano 2026-08-18 — textos de la sección de órdenes con ayuda solicitada. El de la
// ayuda dice DÓNDE llegó la solicitud y CÓMO se deshace, que es lo que no se puede deducir
// mirando la sección.
const AYUDA_SECCION_TITULO = "Con ayuda solicitada";
const AYUDA_SECCION_AYUDA =
  "Tu tienda las está viendo en Novedades. Con «Recuperar» retirás la solicitud y la orden vuelve arriba.";
// Feature 235 (R35): rótulo de la acción que abre el hilo desde la card de ayuda. Dice de qué es
// la pantalla que abre, no qué componente monta.
const AYUDA_ACCION_HILO = "Conversación";
// Feature 235 (T8.1) — CHIP DE ESTADO de la card de ayuda. Sigue la gramática de los otros cuatro
// («En gestión», «En detalle», «En reparto», «Por recoger»: preposición + sustantivo) y comparte la
// palabra «ayuda» con el encabezado de la sección y con el `EstatusBadge` de la tienda, así que no
// es un tercer sinónimo. La forma CORTA se descartó en `/ordenes` por ambigua —allí maestro/admin
// la ven suelta entre veintiún estados y no sabrían a quién se le pidió (R37)—, pero aquí la
// desambiguación está pegada: el chip vive DENTRO de la sección «Con ayuda solicitada», cuyo texto
// de ayuda ya dice que la tienda las está viendo en Novedades.
const AYUDA_CARD_ESTADO = "En ayuda";
const SIN_PENDIENTES_TODAS_CON_AYUDA =
  "Todas tus órdenes en reparto tienen ayuda solicitada; están abajo.";

// 2026-07-31 — RETIRADO: el mensaje de feature 117/R11 ("Ninguna guía en reparto coincide
// con el filtro."). R11 nació cuando las OPCIONES de cantón/distrito se derivaban de la
// UNIÓN de los dos grupos del portal: elegir un cantón que solo existía en "Por recoger"
// vaciaba la lista de reparto, y el mensaje explicaba por qué. Tras el corte las opciones
// salen SOLO de `porGestionar`, así que toda opción ofrecida tiene al menos una orden
// detrás y el estado dejó de ser alcanzable — comprobado por dos caminos (elegir cantón, y
// filtrar por distrito y perder esa orden en un refresh: el select suelta su selección
// cuando la opción desaparece, y la lista vuelve entera). Dejarlo escrito sería una rama
// que ningún test puede cubrir y que se leería como cubierta. Si algún día las opciones
// vuelven a derivarse de un conjunto mayor que la lista, hay que reponerlo CON su caso.

export function RepartoModule({
  porGestionar,
  conAyuda,
  ordenEnGestionId,
  ruta,
  bloqueado,
}: RepartoModuleProps) {
  const router = useRouter();
  const toast = useToast();

  // Feature 97: última ubicación GPS capturada por el botón de sincronización. Se usa como
  // punto de partida del mapa. Sobrevive a `router.refresh()` (estado de cliente), así que el
  // origen se mantiene dibujado tras recalcular la ruta. NO se pide GPS al montar (R25: nunca
  // se fuerza el permiso; solo se captura cuando el mensajero pulsa "Sincronizar ruta").
  const [ubicacionActual, setUbicacionActual] = useState<RutaMapaOrigen | null>(
    null,
  );
  // Feature 92 (seguimiento): geometría de la ruta. Arranca con la PERSISTIDA que trae el
  // servidor (migración `20260814120000_ruta_optimizada_trazado`), así que el mapa pinta las
  // calles reales ya en el primer render y sobrevive a un F5 — antes cada recarga lo devolvía
  // a la línea recta. La sincronización la sustituye por la recién calculada; ese valor es
  // estado de cliente y sobrevive a `router.refresh()`, que no remonta el componente.
  const [trazadoRuta, setTrazadoRuta] = useState<RutaMapaTrazado | null>(
    ruta.trazado !== null
      ? { encodedPolyline: ruta.trazado.encodedPolyline, fuente: ruta.trazado.fuente }
      : null,
  );
  // Mapa de ruta como ACORDEÓN: abierto de entrada, se pliega y despliega con animación
  // desde un control que no se mueve de su sitio (ver el bloque del mapa, más abajo).
  const mapa = useSeccionColapsable(true);

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
  // del grupo SIN filtrar (R13: el conjunto COMPLETO cargado, para que la selección actual
  // no borre otras opciones de cantón disponibles). Tras el corte de 2026-07-31 ese
  // conjunto es SOLO `porGestionar`: las órdenes por recoger ya no están en esta pantalla,
  // así que ofrecer sus cantones aquí daría opciones que no filtran nada. Se compone en AND
  // con el buscador (114) sobre la MISMA lista visible; la orden en gestión nunca se oculta
  // (salvaguarda R10/R14).
  const filtro = useFiltroCantonDistrito(porGestionar);
  const aplicarFiltroZona = filtro.aplicar;

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

  // Feature 235 (T3.3, R18) — ⚰️ AQUÍ VIVÍA EL CORTE DE CLIENTE, y su desaparición ES la feature.
  //
  // Eran dos `useMemo` sobre `orden.ayuda`: uno partía `porGestionarVisual` en dos listas y otro
  // calculaba las «candidatas» del panel. Funcionaban para lo que se veía y para nada más: la
  // orden con ayuda seguía dentro de `porGestionar`, así que seguía siendo parada del mapa,
  // contacto del chat, candidata de `TrayectoVivoButton` y —sobre todo— GESTIONABLE. El corte era
  // maquetación sobre un dato que no se había movido.
  //
  // Ahora el servidor manda TRES listas y este módulo pinta lo que llega. `visualSinAyuda` es
  // directamente el resultado del buscador/filtro/reordenado sobre `porGestionar`, que ya no
  // contiene ninguna orden con ayuda.
  const visualSinAyuda = porGestionarVisual;

  // R30: la ruta no refleja el estado real si la última optimización falló
  // (`desactualizada`) o si entraron paradas nuevas sin posición todavía.
  // Feature 235 (P8, firmada 2026-08-19) — EL CHAT CONSERVA A ESOS CLIENTES. Es una línea, y sin
  // ella el mensajero pierde EN SILENCIO la única entrada al chat que le queda sobre un paquete que
  // sigue llevando encima: al salir del grupo «en reparto», la orden se caía de la lista de
  // contactos. Contrapartida aceptada: la lista de contactos deja de coincidir con la de cards de
  // arriba.
  const contactosChat = useMemo<MiAsignacionDTO[]>(
    () => [...porGestionar, ...conAyuda],
    [porGestionar, conAyuda],
  );

  const rutaDesactualizada =
    ruta.estado === "desactualizada" || ruta.paradasSinOptimizar > 0;
  // R24: aviso de que el punto de partida usado es aproximado (no GPS reciente).
  const origenAproximado =
    ruta.origenFuente === "centroide" || ruta.origenFuente === "ultima_conocida";

  // Feature 92 (seguimiento): posición EN VIVO. No cuesta ninguna llamada facturada —la da el
  // navegador— y solo arranca si el permiso ya consta concedido (R25: nunca se fuerza).
  // `ubicacionActual !== null` es la prueba de que el botón ya lo obtuvo, para los navegadores
  // sin Permissions API.
  const ubicacionVivo = useSeguimientoUbicacion(ubicacionActual !== null);
  // La del seguimiento MANDA sobre la del último botón: es más reciente por definición. Se
  // cae a la del botón mientras el GPS no haya dado su primer fix bueno.
  const origenMapa = ubicacionVivo ?? ubicacionActual;

  // Trayecto en vivo pedido a mano. Cuando existe MANDA sobre el tramo persistido: el
  // mensajero acaba de pedir explícitamente «desde donde estoy», y seguir resaltando el
  // tramo que arranca en el origen de la optimización sería ignorar lo que pidió.
  const [trayectoVivo, setTrayectoVivo] = useState<string | null>(null);

  // Feature 235 (R35): la orden cuyo HILO está abierto, o `null`. Carga bajo demanda, mismo
  // montaje que `HiloNotasNovedadModal` hace del lado tienda: el hilo no viaja en el listado.
  const [hiloOrden, setHiloOrden] = useState<MiAsignacionDTO | null>(null);
  const tramoResaltado = trayectoVivo ?? ruta.tramoSiguiente?.encodedPolyline ?? null;

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
  //
  // Pedido humano 2026-08-18 — al pedir ayuda, el panel TOMA LA SIGUIENTE. El backend suelta el
  // puntero 1-a-1 y el módulo limpia su preferencia, así que la orden mostrada vuelve a decidirse
  // por «la primera de la lista».
  //
  // Feature 235: esto ya no necesita ningún filtro. Aquí había un `candidatasPanel` que excluía a
  // mano las órdenes con la bandera encendida, precisamente porque seguían en `porGestionar` y la
  // primera de la lista podía ser justo la que acababa de pedir ayuda. Ahora salen del grupo al
  // transicionar, así que `porGestionarFiltrado` ya no las contiene y la exclusión sobra.

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
    // Feature 261 (F3, R12): la orden RESERVADA para un día posterior no se lleva al panel de
    // gestión. Misma defensa suave que la de arriba —silenciosa, porque a esta función sólo se
    // llega desde un control que ya está deshabilitado— y con la misma defensa real detrás: el
    // servidor rechaza igual (R3/R5).
    if (orden.esParaManana) return;
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
    // Feature 261 (F3, R12/R13) — Y LA MISMA GUARDA AQUÍ, que no es redundante: el panel arranca
    // en la PRIMERA orden del grupo, así que una reservada puede estar delante sin haber pulsado
    // ningún botón de card. Sin esto, el `conflict` del servidor se traduciría a «ya tienes otra
    // orden activa en gestión», que es falso y manda a buscar un problema que no existe. El texto
    // sale de la fuente única, con el día que la orden trae consigo (R15).
    if (detalleOrden.esParaManana) {
      toast.error(avisoReservaParaOtroDia(detalleOrden.fechaRepartoISO));
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
   * (`PosOrderCardMosaico`, que "Por recoger" también usa en su propia pantalla). Conserva
   * las señales del módulo (parada/ruta, "gestionar más tarde", intentos) y el
   * gate de selección: pulsar la card fija esta orden en el panel de gestión de arriba
   * (R19/R20), donde vive el detalle completo. Pedido humano: el toggle "gestionar más tarde"
   * va DENTRO de la card (slot `acciones`, al pie), no como hermano suelto debajo. La card es
   * un `<article>`, no un botón, así que alojar controles es HTML válido y el gate de
   * selección los ignora (no seleccionan de rebote).
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
        // Pedido humano (ux): la card ya NO selecciona al tocarla. Cambiar la orden del panel
        // pasa por el botón "Gestionar" del pie, que además pide confirmación.
        acciones={
          <div className="flex items-center justify-between gap-2">
            {/* Feature 115/R5/R6: puramente informativo (no cambia estado ni ruta), así que
                sigue disponible aunque la card esté deshabilitada por el cierre pendiente. */}
            <MarcarLuegoToggle
              ordenId={orden.id}
              marcada={orden.marcarLuego ?? false}
              numRemision={orden.numRemision}
            />
            {/* En el EXTREMO opuesto, misma línea. Deshabilitado con el mensajero bloqueado
                (feature 111/R14) y mientras HAYA una gestión activa (R19/R20): ni las otras
                órdenes —el puntero 1-a-1 no deja cambiar de orden— ni la que se está
                gestionando, que ya está abierta en el panel y no hay nada que "gestionar"
                de nuevo desde su card.
                Feature 261 (F3, R12): y con la orden RESERVADA para un día posterior, que es
                una cuarta condición de la MISMA familia y por eso vive en la misma expresión.
                El mensajero está en la calle con el paquete en la mano: enterarse ANTES de
                intentarlo le ahorra sacar la caja de la furgoneta. El porqué no lo dice el
                botón gris —eso sería un misterio— sino el aviso en palabras que la card pinta
                encima (F2). Y la card sigue montada ENTERA: se restringe la ACCIÓN, no la
                visibilidad (R9), igual que con el cierre pendiente. */}
            <GestionarOrdenCardButton
              numRemision={orden.numRemision}
              disabled={
                bloqueado ||
                Boolean(orden.esParaManana) ||
                ordenEnGestionId !== null ||
                // La que YA está en el panel: es la que se está gestionando ahora mismo, así
                // que su botón no ofrece nada (llevaría al panel donde ya está) y confirmar
                // un aviso de "esto puede cambiar tu ruta" que no cambia nada engaña.
                detalleOrden?.id === orden.id
              }
              onConfirmar={() => seleccionar(orden)}
            />
          </div>
        }
      />
    );
  }

  /**
   * Una card de la seccion «Con ayuda solicitada». SIEMPRE en vista de DETALLE (pedido humano):
   * son las órdenes atascadas, la fila ancha deja leer de un vistazo cuál es cuál, y esta sección
   * no participa del conmutador mosaico/detalle de arriba.
   *
   * Feature 235 (T3.5/T5.2, R19/R35) — SUS ACCIONES CAMBIAN, y las dos por un motivo medible:
   *
   *  - PIERDE «Gestionar». Ese botón llamaba a `escogerParaGestion`, y desde la 235 esa acción
   *    devuelve `conflict` sobre una orden en `ayuda_tienda` (`cargarOrdenGestionable` exige
   *    `en_reparto`). Dejarlo sería un botón que siempre falla. Las gestiones DESDE ayuda son la
   *    ficha 237, con sus aristas y su productor.
   *  - GANA «Conversación». Sin ella, el mensajero tendría la ventana de escritura abierta sobre
   *    esta orden (`ayuda_tienda` está en su ventana, R34) y NINGÚN sitio donde ejercerla: el hilo
   *    del mensajero vive dentro de `GestionarOrdenPanel`, que ya no es alcanzable para estas
   *    órdenes. Es el permiso inejercitable de siempre, y R35 lo prohíbe.
   *
   *  - CONSERVA «Recuperar», que es el rescate: devuelve la orden a `en_reparto` y con ella arriba.
   *    Y lo conserva TAMBIÉN con el mensajero bloqueado (R25), ver el comentario del botón.
   */
  function renderCardConAyuda(orden: MiAsignacionDTO) {
    return (
      <PosOrderCardDetalle
        orden={orden}
        total={porGestionar.length + conAyuda.length}
        esActiva={false}
        esDetalle={false}
        /* Feature 235 (N1 de la re-revisión) — HOY ESTA PROP NO APAGA NADA, y se conserva a
           propósito. `PosOrderCardDetalle` la usa en un solo sitio: el gate de selección de
           `posSeleccionHandlers`, que calcula `Boolean(onGestionar) && !bloqueado`. Esta card NO
           pasa `onGestionar` (perdió «Gestionar», ver arriba), así que el gate ya está apagado
           venga lo que venga aquí. Queda porque es inerte por COINCIDENCIA —que esta card no monte
           acción de selección—, no por diseño: cuando la 237 le devuelva las gestiones desde ayuda,
           el bloqueo del mensajero (111/R14) tiene que valer sin que nadie lo redescubra. */
        bloqueado={bloqueado}
        /* Feature 235 (T8.1) — SIN esta prop el chip decía «En reparto», que es exactamente lo que
           esta ficha convirtió en falso: `estadoPorDefecto(false, false)` devuelve ese literal. Para
           los otros tres valores el chip describe la situación de la orden; aquí afirmaba la
           contraria. El COLOR lo DECLARA `ESTADO_CLASSNAME` con entrada propia (`bg-warning
           text-navy`, con el porqué de `warning` escrito allí). Coincide con lo que daba el fallback
           de texto libre, y aun así se declara: el fallback significa «no sé qué es este rótulo», así
           que heredar de él una decisión de color la vuelve indistinguible de un accidente y la
           movería en silencio si alguien retoca «En reparto». Lo fija `RepartoAyuda.test.tsx`. */
        estado={AYUDA_CARD_ESTADO}
        /* Feature 235 (R15) — LA CARD NO LLEVA MARCAS DE RUTA. R15 prohíbe pintar estas órdenes
           como parada y contarlas entre las pendientes de optimizar; el servicio ya las deja fuera
           de `paradasSinOptimizar` y del mapa, pero la card seguía luciendo el nº de parada («·»,
           con su «Sin posición en la ruta» accesible) y el badge «Pendiente de optimizar» — o sea,
           la lógica migró y la superficie no. Esta sección es una superficie SIN ruta, como «Por
           recoger»: estas órdenes llegan sin `secuenciaRuta` a propósito. `mostrarRuta={false}`
           apaga EXACTAMENTE esas dos marcas (comprobado en `PosOrderCardDetalle`) y nada más: la
           navegación, el nº de remisión, el destinatario, los intentos, el monto y «Gestionar más
           tarde» siguen intactos. */
        mostrarRuta={false}
        acciones={
          <div className="flex items-center justify-between gap-2">
            {/* Feature 235 (R25) — LA EXCEPCIÓN AL BLOQUEO, y es deliberada: este botón NO recibe
                `disabled={bloqueado}`. No hace falta apoyarla en que «el resto de la card sí está
                bloqueada», que además hoy es falso —el `bloqueado` de arriba no apaga nada en esta
                card, ver su comentario—: se sostiene sola, porque el rescate es justamente
                la SALIDA del deadlock que documenta `lib/services/rescate-ayuda.ts`: un mensajero
                con un cierre `vencido` y una orden en ayuda no podría ni rescatarla —bloqueado— ni
                cerrar —la orden en ayuda le bloquea el cierre, R22—. El servicio se lo permite a
                propósito; apagarlo aquí dejaba el permiso vivo en el servidor y muerto en la
                pantalla, que es el permiso inejercitable que R35 prohíbe. */}
            <RecuperarAyudaButton
              ordenId={orden.id}
              numRemision={orden.numRemision}
              onRecuperada={() => router.refresh()}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setHiloOrden(orden)}
            >
              {AYUDA_ACCION_HILO}
            </Button>
          </div>
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
           "Cancelar gestión"). Se omiten la grilla de cards (R6) y el mapa/ruta con
           "Sincronizar ruta" (R7). Arranca en `yaActiva` (el puntero 1-a-1 ya está
           fijado). Al liberar/finalizar la gestión el puntero vuelve a `null` y la vista
           completa se restaura sola (R10). */
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
              Se compone en AND con el buscador. Las opciones se derivan del conjunto completo
              cargado (R13); elegir cantón resetea el distrito (R5) y el distrito va
              deshabilitado sin cantón (R3). En modo foco no se renderiza (no hay cards que
              filtrar). Puro filtro de cliente, así que permanece aunque el mensajero esté
              bloqueado (la lista sigue como solo-visualización). */}
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
              <div className="flex flex-wrap items-center gap-2">
                <SincronizarRutaButton
                  onUbicacion={setUbicacionActual}
                  onTrazado={setTrazadoRuta}
                />
                {/* Trayecto EN VIVO: cada pulsación es una llamada facturada (no se puede
                    cachear algo que arranca donde el mensajero está AHORA), por eso es un
                    botón aparte y explícito. La siguiente parada es la primera de la lista,
                    que ya viene ordenada por secuencia desde el servidor. */}
                <TrayectoVivoButton
                  ubicacion={origenMapa}
                  ordenId={porGestionar[0]?.id ?? null}
                  onTrayecto={setTrayectoVivo}
                />
              </div>
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
            {/* Acordeón (pedido humano): la CABECERA con el título y el botón está SIEMPRE
                en el mismo sitio —abierto y cerrado—; lo único que aparece y desaparece es
                el cuerpo del mapa, con animación en los dos sentidos. Antes el control
                saltaba de sitio al cerrarlo (dentro de la cabecera para ocultar, suelto
                debajo para mostrar) y había que buscarlo. */}
            {paradasMapa.length > 0 ? (
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
                    aria-expanded={mapa.abierta}
                    onClick={mapa.abierta ? mapa.cerrar : mapa.abrir}
                  >
                    {mapa.abierta ? "Ocultar mapa" : "Mostrar mapa"}
                  </Button>
                </div>
                {mapa.montada ? (
                  <div className={`flex flex-col gap-2 ${mapa.clase}`}>
                    {origenAproximado ? (
                      <p className="text-xs text-muted-foreground">
                        El punto de partida es aproximado (no se usó tu ubicación
                        GPS reciente).
                      </p>
                    ) : null}
                    <RutaMapa
                      paradas={paradasMapa}
                      origen={origenMapa}
                      trazado={trazadoRuta}
                      tramoSiguiente={tramoResaltado}
                    />
                  </div>
                ) : null}
              </div>
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
              Filtra por número de guía, remisión, teléfono o nombre del destinatario
              (parcial, insensible a mayúsculas/acentos). En modo foco no se renderiza: no
              hay cards que filtrar. Es un filtro puro de cliente, así que permanece visible
              aunque el mensajero esté bloqueado (la lista sigue como solo-visualización). */}
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
            {porGestionarFiltrado.length === 0 && !buscando && conAyuda.length > 0 ? (
              /* Hay órdenes, pero TODAS están abajo con ayuda solicitada. Sin este caso el
                 listado principal diría «No hay órdenes en reparto» justo encima de una sección
                 llena de órdenes en reparto — que es lo contrario de lo que pasa.

                 Feature 235: la condición cambió con el corte. Antes se derivaba de que la lista
                 partida en cliente quedara vacía; ahora se lee de las DOS props, que es de donde
                 sale la verdad desde que el servidor las separa. */
              <p className="text-sm text-muted-foreground">
                {SIN_PENDIENTES_TODAS_CON_AYUDA}
              </p>
            ) : porGestionarFiltrado.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {buscando ? SIN_RESULTADOS_REPARTO : "No hay órdenes en reparto."}
              </p>
            ) : vistaCards === "mosaico" ? (
              /* Pedido humano: en MOSAICO las cards van en carrusel (`CarruselCards`,
                 componente shared sobre la primitiva shadcn), no en grilla. Se ven de 3 en 3
                 según el ancho —1 en móvil, 2 desde `sm`, 3 desde `lg`, los mismos cortes que
                 tenía la grilla— y debajo queda la etiqueta de posición ("Órdenes 1-3 de 5").
                 La vista "detalle" NO se toca: sigue siendo la lista de una fila por orden. */
              <div className={CLASE_FASE[faseVista]}>
                <CarruselCards
                  items={visualSinAyuda}
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
                {visualSinAyuda.map((orden) => (
                  <li key={orden.id}>
                    {renderCardEnReparto(orden, "detalle")}
                  </li>
                ))}
              </ul>
            )}

            {/* Pedido humano 2026-08-18 — las órdenes con AYUDA SOLICITADA, DEBAJO y aparte.
                No están escondidas ni deshabilitadas: siguen siendo órdenes en reparto de este
                mensajero y se pueden gestionar desde aquí. Lo que cambia es que dejan de
                mezclarse con las que avanzan solas, que es lo que se pidió. */}
            {conAyuda.length > 0 ? (
              <section
                aria-label={AYUDA_SECCION_TITULO}
                className="mt-6 flex flex-col gap-3 border-t border-border pt-4"
              >
                <div className="flex flex-col gap-0.5">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-warning-strong">
                    {AYUDA_SECCION_TITULO}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {AYUDA_SECCION_AYUDA}
                  </p>
                </div>
                <ul className="flex flex-col gap-3">
                  {conAyuda.map((orden) => (
                    <li key={orden.id}>{renderCardConAyuda(orden)}</li>
                  ))}
                </ul>
              </section>
            ) : null}

          </section>
        </>
      )}

      {/* Chat del mensajero — CÓDIGO VIVO Y ÚNICA ENTRADA AL CHAT. Esto NO es una maqueta:
          el hilo lo sirve `listarHiloChat` (feature 120) y las plantillas
          `listarPlantillasParaEnvio` (feature 87), las dos REALES y contra la misma
          conversación de WhatsApp que ve el cliente. Nació en el rediseño de la rama `ux`,
          de ahí el estilo; lo que nació entonces como maqueta ya se cableó a datos reales.
          Botón flotante fijo abajo a la derecha que abre el chat con los clientes como
          modal. Se muestra en las dos vistas (foco y lista) porque el mensajero puede
          necesitar escribir en cualquier momento.
          Contactos = SOLO las órdenes EN REPARTO (`porGestionar`, sin filtrar: el chat es
          una capa aparte del buscador/filtro de la lista); las de "Por recoger" no tienen
          gestión que conversar — por eso el chat vive aquí y no en su pantalla. La marcada
          "en gestión" es la que el módulo tiene en DETALLE, y es por donde entra al abrirse.
          Hasta el 2026-08-07 esta ruta convivía con `ChatWhatsappPanel` dentro del panel del
          detalle, que leía la misma conversación; ese panel se borró por decisión humana tras
          perder su montaje en `6dc18dc2`, así que este botón es hoy la ÚNICA entrada al chat:
          si se borra, el mensajero se queda sin poder escribirle al cliente. */}
      {/* Feature 235 (R35): el hilo del mensajero para una orden en ayuda. `key` por orden para que
          la lectura arranque fresca en cada apertura; se monta solo con una orden abierta. */}
      {hiloOrden !== null ? (
        <HiloNotasAyudaModal
          key={hiloOrden.id}
          orden={hiloOrden}
          onOpenChange={(open) => {
            if (!open) setHiloOrden(null);
          }}
        />
      ) : null}

      <ChatFlotante
        ordenes={contactosChat}
        ordenEnDetalleId={detalleOrden?.id ?? null}
        abierto={chatAbierto}
        onAbiertoChange={setChatAbierto}
      />
    </div>
  );
}
