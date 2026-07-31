"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Store } from "lucide-react";

import { ContactoButtons } from "@/components/shared/ContactoButtons";
import { EscanerGuiaCard } from "@/components/shared/EscanerGuiaCard";
import { useToast } from "@/hooks/useToast";
import { BLOQUEO_AVISO } from "@/lib/constants/bloqueo-mensajero";
import { extractNumGuiaFromScan } from "@/lib/utils/paquete-url";
import type {
  RecolectadaHoyDTO,
  RecoleccionOrdenDTO,
} from "@/lib/types/recoleccion-tienda";

import { RecolectadasHoyLista } from "./RecolectadasHoyLista";
import { useRecolectarPorGuia } from "./useRecolectarPorGuia";

// Feature 157 (R13-R24) + 167 — apartado PROPIO del mensajero para lo que va a recoger EN LA
// TIENDA. Nació dentro de Entregas; la 167 lo sacó a su página (`/recoleccion`) porque allí
// el mensajero no lo encontraba, y le dio la vuelta a su regla de fondo:
//
//   ANTES: sin lista no había apartado (`if (porRecolectar.length === 0) return null`), así
//          que el bloque de escaneo desaparecía justo cuando el mensajero lo buscaba.
//   AHORA: el ESCÁNER es el contenido principal y está SIEMPRE montado (R7); la lista es su
//          contexto. Lo único que lo apaga es el bloqueo por cierre pendiente (R9).
//
// Sigue siendo deliberadamente pobre comparado con el panel de gestión: aquí no hay entrega,
// ni cobro, ni evidencia, ni causa de devolución, ni resultado que elegir (R22). Recolectar
// es un acto físico de un paso —el paquete pasa de la tienda a la ruta hacia la bodega
// central— y la pantalla no debe sugerir lo contrario. Ni siquiera TRANSPORTA cobro: los
// datos llegan en `RecoleccionOrdenDTO`, un DTO sin monto, coordenadas ni ruta (R38).
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

interface GrupoTienda {
  tiendaNombre: string;
  tiendaTelefono: string | null;
  ordenes: RecoleccionOrdenDTO[];
}

/**
 * Agrupa por tienda (R17) conservando el orden de llegada: el mensajero recorre tiendas, no
 * órdenes sueltas, así que la lista se organiza por el sitio al que tiene que ir.
 */
function agruparPorTienda(ordenes: RecoleccionOrdenDTO[]): GrupoTienda[] {
  const grupos = new Map<string, GrupoTienda>();
  for (const orden of ordenes) {
    const grupo = grupos.get(orden.tiendaNombre);
    if (grupo) {
      grupo.ordenes.push(orden);
      continue;
    }
    grupos.set(orden.tiendaNombre, {
      tiendaNombre: orden.tiendaNombre,
      tiendaTelefono: orden.tiendaTelefono ?? null,
      ordenes: [orden],
    });
  }
  return [...grupos.values()];
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

  const grupos = useMemo(() => agruparPorTienda(porRecolectar), [porRecolectar]);

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

  return (
    <section aria-label={TITULO} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{TITULO}</h2>
        {porRecolectar.length > 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            {textoConteo(porRecolectar.length)}
          </p>
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
      )}

      {/* R8: sin nada asignado se DICE, en vez de dejar una pantalla muda bajo el escáner. */}
      {grupos.length === 0 ? (
        <p className="text-sm text-muted-foreground">{VACIO}</p>
      ) : (
        grupos.map((grupo) => (
          <div
            key={grupo.tiendaNombre}
            className="flex flex-col gap-2 rounded-2xl border border-border p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{grupo.tiendaNombre}</h3>
              {/* R19/R20: el interlocutor de una recolección es la TIENDA, no el
                  destinatario. Sin teléfono registrado no se pintan botones que no llevan
                  a ninguna parte. */}
              {grupo.tiendaTelefono ? (
                <ContactoButtons
                  telefono={grupo.tiendaTelefono}
                  nombre={grupo.tiendaNombre}
                />
              ) : null}
            </div>
            <ul className="flex flex-col gap-2">
              {grupo.ordenes.map((orden) => (
                <li
                  key={orden.id}
                  className="rounded-xl bg-muted/40 px-3 py-2 text-sm"
                >
                  <p className="font-semibold tabular-nums">
                    Guía {orden.numGuia ?? "—"}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {orden.numRemision}
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    {orden.producto} · {orden.destinatario}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {/* R24: el trabajo del día, que sale del HISTORIAL y por tanto sobrevive a que la
          bodega central ya haya recibido el paquete (R26). */}
      <RecolectadasHoyLista
        recolectadasHoy={recolectadasHoy}
        recortada={recolectadasHoyRecortada}
      />
    </section>
  );
}
