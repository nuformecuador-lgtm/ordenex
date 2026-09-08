"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import { corregirResultadoGestion } from "@/lib/actions/cierres-admin";
import type {
  CierreDetalleGestion,
  CierreTotales,
} from "@/lib/interfaces/services/ICierreDiaService";

import { TotalesPanel } from "./cierre-detalle-shared";

/**
 * FICHA 398 (T4.1, R16) — CORRECCIÓN del RESULTADO de una gestión desde el detalle de un cierre
 * ABIERTO: una entrega que nunca ocurrió pasa a ser un rechazo.
 *
 * **El caso real, y por qué esta pantalla existe.** Un mensajero marcó `entregada` una orden que
 * fue rechazada y solicitó el cierre. Hasta esta ficha no había NINGUNA vía —ni directa ni
 * indirecta— de sacar de un cierre ya solicitado un cobro que nadie recaudó: anular exige que la
 * gestión no tenga cierre, la corrección del desglose solo reparte por método, y reabrir el cierre
 * no vuelve a fotografiar los totales. El 2026-09-08 hubo que corregirlo A MANO en la base de
 * producción, con el motivo «Corrección desde la central por error del mensajero».
 *
 * **Es hermano de `CorregirPagosDialog`, y a propósito:** mismo `Modal`, mismos cinco desenlaces
 * tratados con el mismo código y misma forma de avisar al padre para que RELEA el detalle. Lo que
 * cambia es lo que se corrige y el peso del acto — de ahí el aviso de las tres consecuencias y el
 * botón destructivo.
 *
 * **El nuevo resultado NO viaja desde el cliente.** El borde es `.strict()` y esta ficha concede
 * UNA sola pareja (`entregada -> rechazada`); mandar el destino abriría las demás por accidente y
 * cada una mueve dinero en una dirección distinta. Lo que viaja son dos claves: la gestión y el
 * motivo.
 *
 * **Los totales que se pintan al terminar son LOS DEL SERVIDOR, verbatim.** Llegan en la respuesta
 * como STRING de escala 2 —los recalculó él, dentro de la misma transacción, sumando los snapshots
 * congelados de las demás gestiones—; aquí no se suman, ni se restan, ni se convierten a número.
 * El navegador no tiene con qué recalcularlos: solo conoce la gestión que se corrigió, no las otras
 * del cierre.
 */

const TITULO = "Corregir el resultado de la entrega";

/**
 * El aviso de `design.md §7`, en claro y sin jerga: las TRES cosas que van a pasar. Se dicen
 * ANTES de escribir el motivo porque son la mitad de la decisión — y las tres mueven dinero.
 */
const CONSECUENCIAS = [
  "El cobro registrado de esa entrega desaparece del cierre.",
  "El pago al mensajero por esa entrega pasa a cero.",
  "El paquete se tratará como una devolución al aprobar el cierre.",
] as const;

const AVISO =
  "La entrega pasa a ser un rechazo. Queda registrado quién la corrigió, cuándo y con qué motivo.";
const CONSECUENCIAS_TITULO = "Al corregir:";

const MOTIVO_LABEL = "Motivo de la corrección";
const MOTIVO_AYUDA =
  "Obligatorio. Es lo que queda escrito para explicar por qué cambió el dinero de este cierre.";
const MOTIVO_ID = "motivo-correccion-resultado";

const CONFIRMAR_LABEL = "Marcar como rechazada";
const CERRAR_LABEL = "Cerrar";

const OK_TOAST = "Resultado corregido: la entrega pasó a rechazo.";
const HECHO_NOTA =
  "Listo. Así quedaron los totales del cierre, recalculados por el servidor:";
const TOTALES_TITULO = "Totales del cierre tras la corrección";

const ERROR_GENERICO = "No se pudo corregir el resultado. Inténtalo de nuevo.";
const CONFLICTO =
  "El cierre dejó de estar abierto mientras corregías: recarga el detalle para ver su estado.";
const NO_ENCONTRADA = "Esta gestión ya no está disponible para corregir.";
const SIN_PERMISO = "No tienes permiso para corregir el resultado de una gestión.";

export interface CorregirResultadoDialogProps {
  /** La gestión a corregir; `null` cierra el diálogo. Siempre una `entregada` (R16). */
  gestion: CierreDetalleGestion | null;
  onOpenChange: (open: boolean) => void;
  /** Se invoca tras una corrección efectiva, para que el padre relea el detalle. */
  onCorregido: () => void | Promise<void>;
}

export function CorregirResultadoDialog({
  gestion,
  onOpenChange,
  onCorregido,
}: Readonly<CorregirResultadoDialogProps>) {
  const toast = useToast();
  const [motivo, setMotivo] = useState("");
  const [errorServidor, setErrorServidor] = useState<string | undefined>(undefined);
  const [enviando, setEnviando] = useState(false);
  /**
   * Los totales que devolvió el servidor tras aplicar la corrección; `null` mientras no se ha
   * aplicado. Es el ÚNICO sitio del que salen las cuatro cifras que se pintan abajo.
   */
  const [hecho, setHecho] = useState<CierreTotales | null>(null);

  /**
   * Al abrir con OTRA gestión, el diálogo arranca limpio: sin el motivo de la anterior, sin su
   * error y sin sus totales. Se AJUSTA DURANTE EL RENDER comparando con la gestión previa —el
   * mismo patrón que `CorregirPagosDialog`—, que es lo que React documenta para derivar estado de
   * una prop; un `useEffect` con `setState` pintaría una vez con los datos viejos.
   */
  const gestionId = gestion?.gestionId ?? null;
  const [ultima, setUltima] = useState<string | null>(gestionId);
  if (gestionId !== ultima) {
    setUltima(gestionId);
    setMotivo("");
    setErrorServidor(undefined);
    setHecho(null);
  }

  // La barrera de verdad está en el servidor (`motivoSchema`, el mismo que exige una gestión
  // rechazada real); esta solo evita el viaje y dice por qué no se puede pulsar.
  const motivoVacio = motivo.trim() === "";

  async function confirmar() {
    if (!gestion || enviando || motivoVacio) return;

    setEnviando(true);
    setErrorServidor(undefined);
    try {
      const r = await corregirResultadoGestion({
        gestionId: gestion.gestionId,
        // Dos claves y ninguna más: el destino (`rechazada`) lo decide el servidor. El motivo
        // viaja tal como se escribió; `motivoSchema` lo recorta y rechaza el blanco.
        motivo,
      });
      if (r.status === "ok") {
        // Verbatim: la respuesta trae los cuatro totales ya recalculados, como STRING de escala 2.
        setHecho(r.totales);
        toast.success(OK_TOAST);
        // El padre relee el detalle del servidor mientras esta ventana enseña el resultado: así
        // el dinero de la pantalla de atrás nunca queda viejo, se cierre por donde se cierre.
        await onCorregido();
        return;
      }
      if (r.status === "validation_error") {
        // Los dos campos que puede devolver este borde: el motivo vacío (R5) y la gestión que ya
        // no es una entrega (R4).
        setErrorServidor(
          r.fieldErrors.motivo?.[0] ?? r.fieldErrors.resultado?.[0] ?? ERROR_GENERICO,
        );
        return;
      }
      setErrorServidor(
        r.status === "conflict"
          ? CONFLICTO
          : r.status === "no_encontrada"
            ? NO_ENCONTRADA
            : r.status === "forbidden"
              ? SIN_PERMISO
              : ERROR_GENERICO,
      );
    } catch {
      setErrorServidor(ERROR_GENERICO);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      open={gestion !== null}
      onOpenChange={onOpenChange}
      title={TITULO}
      description={
        gestion ? `Orden ${gestion.numRemision} · ${gestion.destinatario}. ${AVISO}` : AVISO
      }
      confirmLabel={hecho ? CERRAR_LABEL : CONFIRMAR_LABEL}
      // Destructivo mientras hay algo que destruir: al corregir desaparece un cobro registrado.
      // Ya aplicado, el único botón es el de cerrar y no destruye nada.
      confirmVariant={hecho ? "default" : "destructive"}
      hideCancel={hecho !== null}
      confirmDisabled={enviando || (hecho === null && motivoVacio)}
      // El diálogo NO se cierra al confirmar: o enseña el error del servidor, o enseña los
      // totales nuevos. Cerrarlo solo lo hace quien lo lee.
      closeOnConfirm={false}
      onConfirm={hecho ? () => onOpenChange(false) : confirmar}
    >
      {gestion === null ? null : hecho ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{HECHO_NOTA}</p>
          {/* El MISMO panel que pinta los totales snapshot en el resto de la pantalla: los cuatro
              montos llegan como STRING y se renderizan tal cual (money-safe). */}
          <TotalesPanel
            totales={hecho}
            ariaLabel={TOTALES_TITULO}
            title={TOTALES_TITULO}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <section aria-label={CONSECUENCIAS_TITULO} className="flex flex-col gap-1">
            <p className="text-sm font-medium">{CONSECUENCIAS_TITULO}</p>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {CONSECUENCIAS.map((linea) => (
                <li key={linea}>{linea}</li>
              ))}
            </ul>
          </section>

          <div className="flex flex-col gap-2">
            <label htmlFor={MOTIVO_ID} className="text-sm font-medium">
              {MOTIVO_LABEL}
            </label>
            <textarea
              id={MOTIVO_ID}
              value={motivo}
              onChange={(e) => {
                setMotivo(e.target.value);
                if (errorServidor) setErrorServidor(undefined);
              }}
              rows={3}
              aria-required="true"
              aria-invalid={errorServidor !== undefined}
              aria-describedby={
                errorServidor ? `${MOTIVO_ID}-error` : `${MOTIVO_ID}-ayuda`
              }
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p id={`${MOTIVO_ID}-ayuda`} className="text-xs text-muted-foreground">
              {MOTIVO_AYUDA}
            </p>
            {errorServidor ? (
              <p id={`${MOTIVO_ID}-error`} role="alert" className="text-sm text-destructive">
                {errorServidor}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  );
}
