"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StickyNote } from "lucide-react";

import { PorAceptarSection } from "@/app/(app)/_components/PorAceptarSection";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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

import { AsignacionDetalle } from "./AsignacionDetalle";
import {
  coincideBusqueda,
  filtrarAsignaciones,
} from "./mis-asignaciones-buscador";
import { EscanerRecoger } from "./EscanerRecoger";
import { InputRecoger } from "./InputRecoger";
import { MarcarLuegoToggle } from "./MarcarLuegoToggle";
import { GestionarOrdenPanel } from "./GestionarOrdenPanel";
import { RutaMapa } from "./RutaMapa";
import { SincronizarRutaButton } from "./SincronizarRutaButton";
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
  /** Órdenes en `en_espera_aceptacion` (por recoger). */
  porRecoger: MiAsignacionDTO[];
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
const BUSCADOR_PLACEHOLDER = "Filtra por número de guía, remisión o destinatario";
// R6: mensajes de "sin resultados", distintos del vacío sin búsqueda; contienen la
// frase «coincide con la búsqueda» para ser reconocibles.
const SIN_RESULTADOS_RECOGER = "Ninguna guía por recoger coincide con la búsqueda.";
const SIN_RESULTADOS_REPARTO = "Ninguna guía en reparto coincide con la búsqueda.";

export function MisAsignacionesModule({
  porRecoger,
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

  // Feature 114: texto del buscador de guías. Estado de UI EFÍMERO, de un solo consumidor
  // (no sube a URL ni a contexto). Se muestra solo en la VISTA COMPLETA; en modo foco no
  // hay cards que filtrar. `buscando` distingue "hay búsqueda activa" de "grupo vacío".
  const [query, setQuery] = useState("");
  const buscarId = useId();
  const buscando = query.trim() !== "";

  // Feature 114/R2/R7: "Por recoger" filtrado por el query (parcial, insensible a
  // mayúsculas/acentos). Query vacío ⇒ misma lista sin filtrar (R5). Independiente de
  // "En reparto".
  const porRecogerFiltrado = useMemo<MiAsignacionDTO[]>(
    () => filtrarAsignaciones(porRecoger, query),
    [porRecoger, query],
  );

  // Feature 114/R8+R9: "En reparto" filtrado, ÚNICA fuente para grilla, mapa y panel de
  // detalle (coherencia lista↔mapa↔panel, gate F1.4). Salvaguarda R9: la orden EN GESTIÓN
  // (`ordenEnGestionId`) permanece SIEMPRE aunque no coincida con el texto, para no ocultar
  // la gestión en curso. Con `ordenEnGestionId === null` la salvaguarda no aplica a nadie.
  const porGestionarFiltrado = useMemo<MiAsignacionDTO[]>(() => {
    const q = normalizeName(query);
    return porGestionar.filter(
      (o) => o.id === ordenEnGestionId || coincideBusqueda(o, q),
    );
  }, [porGestionar, query, ordenEnGestionId]);

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
        />
      ) : (
        /* ---------- VISTA COMPLETA (fuera de foco) ---------- */
        <>
          {/* ---------- Feature 114: buscador de guías (solo en vista de lista) ----------
              Filtra AMBOS grupos por número de guía, remisión o destinatario (parcial,
              insensible a mayúsculas/acentos). En modo foco no se renderiza: no hay cards
              que filtrar. Es un filtro puro de cliente, así que permanece visible aunque el
              mensajero esté bloqueado (la lista sigue como solo-visualización). */}
          <section aria-label={BUSCADOR_REGION} className="flex flex-col gap-1">
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

          {/* ---------- Apartado: Por recoger (en_espera_aceptacion) ---------- */}
          {/* Feature 96: la recogida queda SOLO por dos vías, ambas resuelven el num_guia
              contra `porRecoger` (restricción "asignada a mí") y aceptan con la MISMA action
              `recogerAsignaciones`, directo al confirmar (sin modal):
                (1) input de número de guía tecleado + Enter/botón;
                (2) escáner de cámara (QR de la etiqueta -> num_guia).
              Feature 111/R14: BLOQUEADO oculta ambos controles de recogida (defensa suave;
              la lista de "Por recoger" sigue visible, solo-visualización). */}
          {bloqueado ? null : (
            <>
              <InputRecoger
                porRecoger={porRecoger}
                onRecogida={() => router.refresh()}
              />
              <EscanerRecoger
                porRecoger={porRecoger}
                onRecogida={() => router.refresh()}
              />
            </>
          )}

          {/* Lista de SOLO-VISUALIZACIÓN (feature 96): reutiliza la sección compartida "por
              aceptar" con `mostrarAcciones={false}` (ya no hay botones "Recoger todas" /
              "Recoger"). El mensajero sigue viendo qué guías tiene por recoger; la acción
              vive en el input y el escáner de arriba. */}
          <PorAceptarSection
            titulo="Por recoger"
            nuevasLabel={(n) => `${n} Órdenes nuevas asignadas`}
            ordenes={porRecogerFiltrado}
            mostrarAcciones={false}
            vacio={buscando ? SIN_RESULTADOS_RECOGER : "No hay órdenes por recoger."}
            renderDetalle={(orden) => <AsignacionDetalle orden={orden} />}
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

            {porGestionarFiltrado.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {buscando ? SIN_RESULTADOS_REPARTO : "No hay órdenes en reparto."}
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {porGestionarVisual.map((orden) => {
                  // Feature 111/R14 + 113/R3: con el mensajero BLOQUEADO todas las cards
                  // quedan deshabilitadas (no puede escoger para gestión); el porqué lo
                  // explica el aviso de bloqueo total de arriba. La deshabilitación
                  // restringe la ACCIÓN, no la visibilidad: el detalle completo sigue
                  // montado (R3). Fuera de foco `ordenEnGestionId` es null (una gestión
                  // activa sin bloqueo colapsa a foco, R5), así que no existe aquí el estado
                  // "card visible con detalle oculto" que introducía el spec 36 (eliminado).
                  const esActiva = ordenEnGestionId === orden.id;
                  const esDetalle = detalleOrden?.id === orden.id;
                  return (
                    // Feature 115/T8: la card (un `<button>`) y el toggle "gestionar más
                    // tarde" (otro `<button>`) son HERMANOS dentro del `<li>` — nunca
                    // anidados — para no producir botones dentro de botones (HTML inválido).
                    <li key={orden.id} className="flex flex-col gap-2">
                      <button
                        type="button"
                        disabled={bloqueado}
                        aria-pressed={esDetalle}
                        onClick={() => seleccionar(orden)}
                        aria-label={`Gestionar orden ${orden.numRemision} · ${orden.destinatario}`}
                        className={`group flex w-full flex-1 flex-col gap-3 rounded-xl border bg-card p-4 text-left shadow-xs transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60 ${
                          esDetalle
                            ? "border-primary ring-2 ring-primary/40"
                            : "border-border"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="flex items-center gap-2 font-semibold text-foreground">
                            {/* R28: nº de parada en la ruta optimizada. */}
                            {orden.secuenciaRuta !== null ? (
                              <>
                                <span className="sr-only">
                                  Parada {orden.secuenciaRuta} de la ruta
                                </span>
                                <span
                                  aria-hidden="true"
                                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
                                >
                                  {orden.secuenciaRuta}
                                </span>
                              </>
                            ) : null}
                            {orden.numRemision}
                          </span>
                          {esActiva ? (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                              En gestión
                            </span>
                          ) : esDetalle ? (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              En detalle
                            </span>
                          ) : null}
                        </div>
                        {/* R28 (pendiente de optimizar) + feature 115/R18 (gestionar más
                            tarde): ambas son marcas informativas de la card; van juntas en
                            una fila que envuelve. */}
                        {orden.secuenciaRuta === null || orden.marcarLuego ? (
                          <div className="flex flex-wrap gap-1.5">
                            {orden.secuenciaRuta === null ? (
                              <Badge variant="outline" className="w-fit">
                                Pendiente de optimizar
                              </Badge>
                            ) : null}
                            {/* R18: mientras la orden esté marcada, su card lo muestra. */}
                            {orden.marcarLuego ? (
                              <Badge variant="warning" className="w-fit">
                                Gestionar más tarde
                              </Badge>
                            ) : null}
                          </div>
                        ) : null}
                        {/* Feature 116/R12: indicador de la NOTA PRIVADA del mensajero en la card
                            (badge "Mi nota" + preview truncado de 1 línea, P3). Todas las cards son
                            órdenes PROPIAS (la page valida rol server-side), así que el preview es
                            privado por construcción (R6). Es DISTINTO de la "Notas" de la tienda,
                            que vive dentro del detalle (`AsignacionDetalle`). */}
                        {orden.notaPrivada ? (
                          <div className="flex items-center gap-1.5">
                            <Badge variant="secondary" className="shrink-0">
                              <StickyNote aria-hidden="true" />
                              Mi nota
                            </Badge>
                            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                              {orden.notaPrivada}
                            </span>
                          </div>
                        ) : null}
                        {/* Feature 113/R1/R2: detalle COMPLETO inline (Pedido/Entrega/Cobro)
                            reutilizando `AsignacionDetalle`. Sustituye a la vista compacta y
                            elimina la rama "card bloqueada que oculta el detalle" + el texto
                            "Termina la gestión en curso…" del spec 36. */}
                        <div className="mt-1 border-t border-border pt-3">
                          <AsignacionDetalle orden={orden} />
                        </div>
                      </button>
                      {/* Feature 115/R5/R6: toggle de "gestionar más tarde", HERMANO de la
                          card. Puramente informativo (no cambia estado ni ruta), así que sigue
                          disponible aunque la card esté deshabilitada por el cierre pendiente. */}
                      <MarcarLuegoToggle
                        ordenId={orden.id}
                        marcada={orden.marcarLuego ?? false}
                        numRemision={orden.numRemision}
                      />
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Panel de detalle grande e inline (gate "Gestionar pedido"): muestra la
                orden seleccionada o la primera. Fuera de foco el puntero está en `null`,
                así que arranca en el paso de detalle (`yaActiva=false`); al fijarse el
                puntero la vista pasa a MODO FOCO (arriba). Feature 111/R14: BLOQUEADO no
                renderiza el panel (debe resolver su cierre antes de operar con las guías). */}
            {detalleOrden && !bloqueado ? (
              <GestionarOrdenPanel
                key={detalleOrden.id}
                orden={detalleOrden}
                yaActiva={ordenEnGestionId === detalleOrden.id}
                onGestionarPedido={gestionarPedido}
                onCancelarGestion={cancelarGestion}
                onSuccess={handleGestionSuccess}
              />
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
