"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Store } from "lucide-react";

import { ContactoButtons } from "@/components/shared/ContactoButtons";
import { EscanerModal } from "@/components/shared/EscanerModal";
import { EscanerGuiaCard } from "@/components/shared/EscanerGuiaCard";
import { useToast } from "@/hooks/useToast";
import { BLOQUEO_AVISO } from "@/lib/constants/bloqueo-mensajero";
import { extractNumGuiaFromScan } from "@/lib/utils/paquete-url";
import type {
  RecolectadaHoyDTO,
  RecoleccionOrdenDTO,
} from "@/lib/types/recoleccion-tienda";

import { CarruselCards } from "@/components/shared/CarruselCards";
import { PosOrderCardDetalle } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardDetalle";
import { PosOrderCardMosaico } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardMosaico";
import {
  VistaCardsToggle,
  type VistaCards,
} from "@/app/(app)/mis-asignaciones/_components/VistaCardsToggle";
import {
  CLASE_FASE,
  useTransicionVista,
} from "@/app/(app)/mis-asignaciones/_components/useTransicionVista";

import { RecolectadasHoyLista } from "./RecolectadasHoyLista";
import { useRecolectarPorGuia } from "./useRecolectarPorGuia";

// Feature 157 (R13-R24) + 167 — apartado PROPIO del mensajero para lo que va a recoger EN LA
// TIENDA. Nació dentro de Entregas; la 167 lo sacó a su página (`/recoleccion`) porque allí
// el mensajero no lo encontraba, y le dio la vuelta a su regla de fondo:
//
//   ANTES: sin lista no había apartado (`if (porRecolectar.length === 0) return null`), así
//          que el bloque de escaneo desaparecía justo cuando el mensajero lo buscaba.
//   AHORA: el ESCÁNER es el contenido principal y su acceso está SIEMPRE ahí (R7); la lista
//          es su contexto. Lo único que lo apaga es el bloqueo por cierre pendiente (R9).
//
// 2026-07-31 (decisión del humano): R7 cambia de FORMA, no de fondo. El escáner pasa de
// estar "siempre montado" a estar "siempre accesible": vive tras `EscanerModal` —desde el
// 2026-08-10, en modal—, cerrado de entrada como en toda la app. Nunca desaparece —el
// disparador no depende de la lista— y a cambio la cámara deja de estar encendida detrás de
// la pantalla.
//
// Sigue sin haber ACCIONES de gestión: aquí no se entrega, ni se cobra, ni se adjunta
// evidencia, ni se elige causa ni resultado (R22). Recolectar es un acto físico de un paso
// —el paquete pasa de la tienda a la ruta hacia la bodega central— y la pantalla no ofrece
// otro control que el escáner.
//
// 2026-08-11 (decisión del humano): lo que SÍ cambió es la INFORMACIÓN. El apartado muestra la
// misma card que «Por recoger», entera: ubicación, cobro, detalle completo e intentos. El DTO
// dejó de ser pobre a propósito (`RecoleccionOrdenDTO` extiende `MiAsignacionDTO`), lo que
// retira el recorte de R38 (167): era la única razón por la que las dos pantallas hermanas del
// portal se veían distintas, y el mensajero necesita ver de la orden lo mismo en ambas.
//
// El bloque de acción es UNO para todo el apartado, no un botón por tarjeta: en la tienda se
// recogen decenas de paquetes seguidos y la acción natural es escanear en tanda (decisión del
// humano). Las tarjetas son la referencia de QUÉ hay que recoger, no controles.

const TITULO = "Por recolectar en tienda";

/** R8: el vacío se EXPLICA y el escáner se queda — es la causa raíz que la 167 vino a arreglar. */
const VACIO =
  "No tienes órdenes por recolectar en tienda ahora mismo. Puedes escanear igual: si el maestro acaba de asignarte una, se confirmará aquí.";

/** Conteo del banner. En singular/plural, sin jerga: el mensajero lee "3 paquetes". */
function textoConteo(n: number): string {
  return n === 1
    ? "1 paquete por recolectar en tienda."
    : `${n} paquetes por recolectar en tienda.`;
}

export interface RecoleccionModuleProps {
  /** Órdenes en `recolectando` asignadas al actor (R21). Puede venir VACÍA: el apartado se
   *  monta igual (R7/R8). */
  porRecolectar: RecoleccionOrdenDTO[];
  /** R24/R28: lo ya recolectado hoy por el propio actor, de lo más reciente a lo más antiguo. */
  recolectadasHoy: RecolectadaHoyDTO[];
  /** R31: hoy hay más recolecciones de las que trae `recolectadasHoy`. */
  recolectadasHoyRecortada?: boolean;
  /**
   * Feature 111/R14 + 167/R9: con un cierre pendiente el mensajero NO mueve guías. Las dos
   * listas siguen visibles (solo-visualización, R23) pero el bloque de acción no se renderiza
   * y en su lugar va el aviso que dice por qué y qué hacer.
   */
  bloqueado?: boolean;
}

export function RecoleccionModule({
  porRecolectar,
  recolectadasHoy,
  recolectadasHoyRecortada = false,
  bloqueado = false,
}: Readonly<RecoleccionModuleProps>) {
  const router = useRouter();
  const toast = useToast();
  const { recolectar, procesando } = useRecolectarPorGuia();
  // Confirmación PERSISTENTE de la última (R15): el toast se va solo y en una tanda seguida
  // el mensajero necesita ver que la anterior sí entró (mismo criterio que `RecogerPaqueteCard`).
  const [ultima, setUltima] = useState<number | null>(null);

  // Feature 196: mismo conmutador y misma transicion que Entregas/Por recoger, sobre las
  // MISMAS piezas. Estado de UI efimero de un solo consumidor: no sube a la URL.
  const {
    vista: vistaCards,
    vistaPedida: vistaCardsPedida,
    fase: faseVista,
    cambiarVista,
  } = useTransicionVista<VistaCards>("mosaico");

  const recolectarGuia = useCallback(
    async (numGuia: number): Promise<boolean> => {
      const ok = await recolectar(numGuia);
      if (ok) {
        setUltima(numGuia);
        // R14: la orden deja de estar pendiente y pasa a "Recolectadas hoy". Las dos listas
        // las resuelve el servidor, así que la verdad se relee de allí en vez de moverse a
        // mano en el cliente (que es como se desincronizan).
        router.refresh();
      }
      return ok;
    },
    [recolectar, router],
  );

  /** Camino cámara: el QR de la etiqueta codifica `/paquete/<numGuia>`. */
  const onDecoded = useCallback(
    (texto: string) => {
      const numGuia = extractNumGuiaFromScan(texto);
      if (numGuia === null) {
        // R11: código MAL FORMADO -> se corta aquí, sin viaje al servidor. Es lo único que
        // el cliente sigue decidiendo; de quién es la guía lo decide el servidor (R12).
        toast.error("Código inválido.");
        return;
      }
      void recolectarGuia(numGuia);
    },
    [recolectarGuia, toast],
  );

  /** Camino manual: lo tecleado ES el número (base 10, mismo criterio que la URL, R10). */
  const onManual = useCallback(
    async (valor: string): Promise<boolean> => {
      if (!/^\d+$/.test(valor)) return false; // R11
      return recolectarGuia(Number(valor));
    },
    [recolectarGuia],
  );

  /**
   * Una card «por recolectar». Extraida para que el CARRUSEL (mosaico) y la LISTA (detalle)
   * rendericen la MISMA card: el conmutador solo cambia el envoltorio.
   *
   * 2026-08-11 (decision del humano): la card es EXACTAMENTE la de «Por recoger», sin
   * compuertas. Ya no hay adaptador ni `secciones`: el DTO trae los mismos campos, asi que la
   * orden se pasa tal cual y navegacion, cobro, detalle e intentos se pintan con datos reales.
   *
   * Lo unico que sigue difiriendo de «Por recoger» son las dos props que describen ESTA
   * pantalla: sin `onGestionar` (aqui no se gestiona nada, asi que la card no es clickeable ni
   * enfocable) y `mostrarRuta={false}`, porque estas ordenes no son paradas de la ruta
   * optimizada. El `estado` lo dice: «Por recolectar», no «Por recoger».
   */
  function renderCardRecoleccion(
    orden: RecoleccionOrdenDTO,
    total: number,
    vista: VistaCards,
  ) {
    const CardVista =
      vista === "mosaico" ? PosOrderCardMosaico : PosOrderCardDetalle;
    return (
      <CardVista
        orden={orden}
        total={total}
        estado="Por recolectar"
        mostrarRuta={false}
      />
    );
  }

  return (
    <section aria-label={TITULO} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{TITULO}</h2>
        {porRecolectar.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="status" className="text-sm text-muted-foreground">
              {textoConteo(porRecolectar.length)}
            </p>
            {/* Feature 196: el conmutador ya no es uno por tienda —la agrupación se retiró—,
                sino uno por LISTA. La preferencia es UNA sola para todo el apartado (el estado
                vive aquí y «Recolectadas hoy» recibe el mismo), así que los dos controles se
                mueven juntos; lo que se duplica es el mando, no la decisión. */}
            <VistaCardsToggle
              vista={vistaCardsPedida}
              onVistaChange={cambiarVista}
            />
          </div>
        ) : null}
      </div>

      {/* R9: bloqueado por cierre pendiente -> las listas se ven, pero no hay cómo mover
          nada, y el apartado dice POR QUÉ por sí mismo. Cuando vivía dentro de Entregas el
          aviso lo ponía el módulo de al lado y aquí no quedaría ninguno; el texto es el
          MISMO (constante compartida) para que los dos portales no puedan divergir. */}
      {bloqueado ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {BLOQUEO_AVISO}
        </p>
      ) : (
        /* R7 en su forma vigente (decisión del humano del 2026-07-31): el acceso al
           escaneo está SIEMPRE —el disparador no depende de la lista, que era la causa
           raíz—, pero la tarjeta vive tras él (en modal desde el 2026-08-10), igual que
           en el resto de la app. Lo que se gana: la cámara no queda encendida todo el
           rato que el mensajero tiene la pantalla abierta, que es lo que pasaba con la
           tarjeta desnuda. El label NO es el de por defecto: aquí se RECOLECTA. */
        <EscanerModal label="Recolectar en tienda">
          <EscanerGuiaCard
            ariaLabel="Recolectar por número de guía o escaneo"
            titulo="Recolectar en tienda"
            descripcion="Escanea o ingresa el número de guía"
            icono={Store}
            onDecoded={onDecoded}
            procesando={procesando}
            mensajeErrorCamara="No se pudo abrir la cámara."
            manual={{ onSubmit: onManual, submitLabel: "Confirmar recolección" }}
            exito={
              ultima === null ? undefined : (
                <>
                  Guía <span className="font-semibold">{ultima}</span> recolectada
                  correctamente.
                </>
              )
            }
          />
        </EscanerModal>
      )}

      {/* R8: sin nada asignado se DICE, en vez de dejar una pantalla muda bajo el escáner. */}
      {porRecolectar.length === 0 ? (
        <p className="text-sm text-muted-foreground">{VACIO}</p>
      ) : vistaCards === "mosaico" ? (
        /* 2026-08-11 (decisión del humano): las cards van SUELTAS, en un carrusel único, igual
           que en «Por recoger». Antes iban dentro de una caja por tienda (la agrupación de
           R17), con un carrusel por grupo; esa caja se retira y con ella la cabecera de tienda
           y sus botones de contacto. La tienda de cada orden sigue estando en la card, dentro
           del detalle completo. */
        <div className={CLASE_FASE[faseVista]}>
          <CarruselCards
            items={porRecolectar}
            getKey={(orden) => orden.id}
            ariaLabel="Órdenes por recolectar"
            singular="Orden"
            plural="Órdenes"
            renderItem={(orden) =>
              renderCardRecoleccion(orden, porRecolectar.length, "mosaico")
            }
          />
        </div>
      ) : (
        <ul className={`flex flex-col gap-3 ${CLASE_FASE[faseVista]}`}>
          {porRecolectar.map((orden) => (
            <li key={orden.id}>
              {renderCardRecoleccion(orden, porRecolectar.length, "detalle")}
            </li>
          ))}
        </ul>
      )}

      {/* R24: el trabajo del día, que sale del HISTORIAL y por tanto sobrevive a que la
          bodega central ya haya recibido el paquete (R26). */}
      <RecolectadasHoyLista
        recolectadasHoy={recolectadasHoy}
        recortada={recolectadasHoyRecortada}
        vista={vistaCards}
        vistaPedida={vistaCardsPedida}
        fase={faseVista}
        onVistaChange={cambiarVista}
      />
    </section>
  );
}
