"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Input } from "@/components/ui/input";
// Feature 111/R12 -> FEATURE 271 (T9.1/T9.2): el aviso del bloqueo dejó de ser una constante y
// pasó a ser un FORMATEADOR (texto separado, i18n-ready). El MISMO de Reparto, Recolección y
// Cierre del día: vive en `lib/constants/` para que las cuatro pantallas no puedan divergir en un
// mensaje que el humano declaró preciso, y ahora además CUENTA (cuántos cierres arrastra y cuál
// toca primero, R43). `conCta: true` porque desde aquí hay que decirle a dónde ir (R52).
import { avisoBloqueo } from "@/lib/constants/bloqueo-mensajero";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import type { BloqueoDetalle } from "@/lib/utils/bloqueo-cierre";
import { CarruselCards } from "@/components/shared/CarruselCards";

import { filtrarAsignaciones } from "./mis-asignaciones-buscador";
import { RecogerPaqueteCard } from "./RecogerPaqueteCard";
import { PosOrderCardDetalle } from "./pos-card/PosOrderCardDetalle";
import { PosOrderCardMosaico } from "./pos-card/PosOrderCardMosaico";
import { VistaCardsToggle, type VistaCards } from "./VistaCardsToggle";
import { CLASE_FASE, useTransicionVista } from "./useTransicionVista";

// 2026-07-31 (decisión del humano) — pantalla POR RECOGER del mensajero. Es la mitad que
// se sacó de `MisAsignacionesModule` (hoy `RepartoModule`), donde el escáner quedaba
// enterrado bajo el mapa y el panel de gestión: aquí es lo primero que se ve.
//
// Qué se conserva, sin cambios de comportamiento:
//   - Las DOS vías de recogida en una sola tarjeta plegable (`RecogerPaqueteCard`, feature
//     96): input de número de guía y escáner de cámara. Ambas resuelven el num_guia contra
//     `porRecoger` (restricción "asignada a mí") y aceptan con la MISMA action.
//   - El listado de solo-visualización con su banner de contador.
//   - El buscador de guías (feature 114), ahora propio de esta pantalla.
//   - El aviso de BLOQUEO TOTAL (feature 111/R12/R14), que oculta los controles de
//     recogida y deja el listado en solo-visualización.
//
// Qué es NUEVO (pedido humano): el conmutador mosaico/detalle y el carrusel que Reparto
// ya tenía, replicados aquí sobre las MISMAS piezas (`VistaCardsToggle`,
// `useTransicionVista`, `CarruselCards`, cards POS) para que las dos pantallas del portal
// se manejen igual.
//
// Qué NO se trajo (decisión del humano): el filtro cantón/distrito y los KPIs, que siguen
// solo en Reparto. Tampoco el chat flotante: conversa sobre gestiones en curso, y aquí no
// hay ninguna.

export interface RecogerModuleProps {
  /** Órdenes en `por_recoger`. */
  porRecoger: MiAsignacionDTO[];
  /**
   * Feature 111/R12/R14 -> FEATURE 271 (T9.1): el DETALLE del bloqueo, no un booleano. Trae el
   * veredicto y con qué se llega a él (cuántos cierres arrastra, cuántos espera que él reenvíe y
   * cuál toca primero), calculado por el MISMO predicado que aplica el servidor (R10).
   *
   * Con `bloqueado` se muestra el aviso y se ocultan los controles de recogida. Defensa SUAVE;
   * el backend (R25) es la defensa real.
   */
  bloqueo: BloqueoDetalle;
}

// Feature 114: textos del buscador (separados para i18n futura, lenguaje claro). La
// región y la etiqueta del campo son DISTINTAS a propósito: si coincidieran, el nombre
// accesible del `searchbox` (de su `<label>`) chocaría con el de la región.
const BUSCADOR_REGION = "Buscar guías por recoger";
const BUSCADOR_LABEL = "Buscar guías";
const BUSCADOR_PLACEHOLDER =
  "Filtra por número de guía, remisión, teléfono o nombre";
// R6: mensaje de "sin resultados", distinto del vacío sin búsqueda; contiene la frase
// «coincide con la búsqueda» para ser reconocible.
const SIN_RESULTADOS_RECOGER =
  "Ninguna guía por recoger coincide con la búsqueda.";
const VACIO_RECOGER = "No hay órdenes por recoger.";

export function RecogerModule({
  porRecoger,
  bloqueo,
}: Readonly<RecogerModuleProps>) {
  const router = useRouter();

  // FEATURE 271 (T9.1): el veredicto sale del detalle, no se re-deriva aquí.
  const bloqueado = bloqueo.bloqueado;

  // Presentación de las cards. Estado de UI EFÍMERO de un solo consumidor (no sube a URL
  // ni a contexto) y puramente visual: NO filtra ni reordena nada. Arranca en "mosaico"
  // (más órdenes visibles de un vistazo en la calle), igual que Reparto. El cambio va
  // ANIMADO en dos tramos encadenados; de eso se encarga `useTransicionVista`.
  const {
    vista: vistaCards,
    vistaPedida: vistaCardsPedida,
    fase: faseVista,
    cambiarVista,
  } = useTransicionVista<VistaCards>("mosaico");

  // Feature 114: texto del buscador. Estado de UI EFÍMERO, de un solo consumidor.
  // `buscando` distingue "hay búsqueda activa" de "grupo vacío".
  const [query, setQuery] = useState("");
  const buscarId = useId();
  const buscando = query.trim() !== "";

  // Feature 114/R2/R7: el buscador filtra por guía, remisión, teléfono o nombre del
  // destinatario (parcial, insensible a mayúsculas/acentos). Query vacío ⇒ lista intacta.
  const porRecogerFiltrado = useMemo<MiAsignacionDTO[]>(
    () => filtrarAsignaciones(porRecoger, query),
    [porRecoger, query],
  );

  /**
   * Una card "por recoger". Extraída para que el CARRUSEL (mosaico) y la LISTA (detalle)
   * rendericen exactamente la misma card: el conmutador solo cambia el envoltorio y el
   * componente de presentación.
   *
   * Sin `onGestionar`: aquí no hay nada que gestionar, así que la card es de
   * solo-visualización (ni clickeable ni enfocable). `mostrarRuta={false}` porque estas
   * órdenes todavía no entraron en la ruta optimizada, y `estado` fijo porque no se deriva
   * de un puntero de gestión que en esta pantalla no existe.
   */
  function renderCardPorRecoger(orden: MiAsignacionDTO, vista: VistaCards) {
    const CardVista =
      vista === "mosaico" ? PosOrderCardMosaico : PosOrderCardDetalle;
    return (
      <CardVista
        orden={orden}
        total={porRecogerFiltrado.length}
        estado="Por recoger"
        mostrarRuta={false}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ---------- Aviso de BLOQUEO TOTAL del mensajero (feature 111/R12) ---------- */}
      {bloqueado ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {avisoBloqueo(bloqueo, { conCta: true })}
        </p>
      ) : null}

      {/* ---------- Recogida: input de guía + escáner (feature 96) ---------- */}
      {/* Las DOS vías resuelven el num_guia contra `porRecoger` y aceptan con la MISMA
          action `recogerAsignaciones`, directo al confirmar (sin modal).
          Feature 111/R14: BLOQUEADO oculta ambos controles (defensa suave; el listado
          sigue visible, solo-visualización).
          Pedido humano: sin NADA por recoger la tarjeta tampoco se muestra — no hay guía
          que resolver, así que el input y el escáner solo estorbarían. Se mira
          `porRecoger` COMPLETO, no el filtrado: el buscador no debe quitarle al mensajero
          la forma de recoger lo que sigue pendiente. */}
      {bloqueado || porRecoger.length === 0 ? null : (
        <RecogerPaqueteCard
          porRecoger={porRecoger}
          onRecogida={() => router.refresh()}
        />
      )}

      {/* ---------- Listado de solo-visualización ---------- */}
      {/* `aria-label` y no un `<h2>` visible: el `<h1>` de la página ya dice "Por
          recoger" y repetirlo debajo sería ruido. El nombre accesible se conserva porque
          es por donde la región se identifica (y por donde la buscan los tests). */}
      <section aria-label="Por recoger" className="flex flex-col gap-3">
        {/* Banner con el contador de nuevas, arriba de la lista (sólo si hay). Mira el
            grupo COMPLETO: cuenta lo que hay pendiente de recoger, no lo que el buscador
            deja a la vista. */}
        {porRecoger.length > 0 ? (
          <p
            role="status"
            className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary"
          >
            {porRecoger.length} Órdenes nuevas asignadas
          </p>
        ) : null}

        {/* Buscador y conmutador de vista comparten fila: son los dos controles de la
            lista. En pantallas angostas se apilan (`flex-col`) para que el input no se
            estruje; desde `sm` van en la MISMA línea, el input ocupando el espacio libre
            y el conmutador alineado a su base. Es un filtro puro de cliente, así que
            permanece visible aunque el mensajero esté bloqueado. */}
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
          <VistaCardsToggle
            vista={vistaCardsPedida}
            onVistaChange={cambiarVista}
          />
        </div>

        {porRecogerFiltrado.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {buscando ? SIN_RESULTADOS_RECOGER : VACIO_RECOGER}
          </p>
        ) : vistaCards === "mosaico" ? (
          /* En MOSAICO las cards van en carrusel (`CarruselCards`), de 3 en 3 según el
             ancho —1 en móvil, 2 desde `sm`, 3 desde `lg`— con la etiqueta de posición
             debajo ("Órdenes 1-3 de 5"). Mismas piezas y mismos cortes que Reparto. */
          <div className={CLASE_FASE[faseVista]}>
            <CarruselCards
              items={porRecogerFiltrado}
              getKey={(orden) => orden.id}
              ariaLabel="Órdenes por recoger"
              singular="Orden"
              plural="Órdenes"
              renderItem={(orden) => renderCardPorRecoger(orden, "mosaico")}
            />
          </div>
        ) : (
          /* La clase de fase anima la lista ENTERA como bloque (bajar+desvanecer /
             subir+aparecer). Sin transición (`estable`) no añade nada, así que la lista
             no queda con estilos de animación colgando. */
          <ul className={`flex flex-col gap-3 ${CLASE_FASE[faseVista]}`}>
            {porRecogerFiltrado.map((orden) => (
              <li key={orden.id}>{renderCardPorRecoger(orden, "detalle")}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
