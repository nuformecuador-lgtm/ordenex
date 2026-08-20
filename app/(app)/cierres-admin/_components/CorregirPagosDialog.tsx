"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import {
  DESGLOSE_TEXTOS,
  DesglosePagoField,
} from "@/components/shared/DesglosePagoField";
import {
  capturaCuadra,
  erroresDeLinea,
  lineasParaEnviar,
  type LineaEnEdicion,
} from "@/app/(app)/mis-asignaciones/_components/desglose-captura";
import { useToast } from "@/hooks/useToast";
import { actualizarPagosGestion } from "@/lib/actions/cierres-admin";
import type { CierreDetalleGestion } from "@/lib/interfaces/services/ICierreDiaService";

/**
 * Pedido humano (2026-08-19) — CORRECCIÓN del desglose de pago de una gestión, desde el detalle
 * de un cierre ABIERTO. Es el mismo editor que usa el mensajero en el detalle de su orden
 * (`DesglosePagoField`, compartido), montado en un diálogo.
 *
 * **Lo que este diálogo NO deja hacer, y es la mitad de su razón de ser:** mover el total. El
 * «A cobrar» del resumen es `monto_recibido` —lo que el mensajero declaró— y el editor acota
 * cada línea a ese total: aquí se reparte ese dinero entre métodos, no se decide cuánto entró.
 * El servidor lo vuelve a exigir contra el valor de la base, así que la pantalla no es la
 * barrera, solo la primera.
 *
 * **Por qué el aviso de arriba.** Quien registró estas líneas fue el mensajero, en la calle;
 * el admin las está reescribiendo desde una oficina. Decirlo en el diálogo es lo que convierte
 * la corrección en un acto consciente — y el servidor, además, deja el rastro de quién y
 * cuándo (`pagos_editados_at`/`_por`).
 */

const TITULO = "Corregir métodos de pago";
const AVISO =
  "El total recibido no cambia: se reparte entre los métodos. Queda registrado quién hizo la corrección.";
const OK_TOAST = "Métodos de pago actualizados.";
const ERROR_GENERICO = "No se pudo actualizar el desglose. Inténtalo de nuevo.";
const CONFLICTO =
  "El cierre dejó de estar abierto mientras corregías: recarga el detalle para ver su estado.";
const NO_ENCONTRADA = "Esta gestión ya no está disponible para corregir.";
const SIN_PERMISO = "No tienes permiso para corregir el desglose de pago.";

/** Las líneas VIGENTES, en la forma que el editor entiende (monto como texto sin decimales). */
function lineasDesde(g: CierreDetalleGestion): LineaEnEdicion[] {
  return g.pagos.map((p, i) => ({
    id: `${g.gestionId}-${i}`,
    metodo: p.metodo,
    // El editor trabaja en colones enteros (`soloDigitos`); el DTO trae escala 2. Se recorta el
    // ".00" en vez de reformatear: lo que se enseña es lo que el mensajero tecleó.
    monto: p.monto.replace(/\.00$/, ""),
  }));
}

export interface CorregirPagosDialogProps {
  /** La gestión a corregir; `null` cierra el diálogo. */
  gestion: CierreDetalleGestion | null;
  onOpenChange: (open: boolean) => void;
  /** Se invoca tras una corrección efectiva, para que el padre relea el detalle. */
  onCorregido: () => void | Promise<void>;
}

export function CorregirPagosDialog({
  gestion,
  onOpenChange,
  onCorregido,
}: Readonly<CorregirPagosDialogProps>) {
  const toast = useToast();
  const [lineas, setLineas] = useState<LineaEnEdicion[]>(() =>
    gestion ? lineasDesde(gestion) : [],
  );
  const [errorServidor, setErrorServidor] = useState<string | undefined>(undefined);
  const [enviando, setEnviando] = useState(false);

  /**
   * Al abrir con OTRA gestión, el editor arranca con SUS líneas: sin esto, corregir dos órdenes
   * seguidas enseñaría el desglose de la primera dentro de la segunda.
   *
   * Se AJUSTA DURANTE EL RENDER comparando con la gestión anterior, que es el patrón que React
   * documenta para derivar estado de una prop; un `useEffect` que llama a `setState` provoca un
   * render en cascada —el diálogo se pintaría una vez con las líneas viejas— y además el lint
   * lo prohíbe.
   */
  const gestionId = gestion?.gestionId ?? null;
  const [ultima, setUltima] = useState<string | null>(gestionId);
  if (gestionId !== ultima) {
    setUltima(gestionId);
    setLineas(gestion ? lineasDesde(gestion) : []);
    setErrorServidor(undefined);
  }

  // El total es el que declaró el mensajero, en colones enteros para el editor.
  const montoACobrar = Number(gestion?.montoRecibido ?? 0);
  const errores = erroresDeLinea(lineas);
  const cuadra = capturaCuadra(lineas, montoACobrar);
  const hayErrorDeLinea = errores.some((e) => e !== undefined);

  async function confirmar() {
    if (!gestion || enviando) return;
    // La barrera de verdad está en el servidor; esta solo evita el viaje.
    if (hayErrorDeLinea || !cuadra) return;

    setEnviando(true);
    setErrorServidor(undefined);
    try {
      const r = await actualizarPagosGestion({
        gestionId: gestion.gestionId,
        // Money-safe: el borde espera STRING con hasta 2 decimales. `lineasParaEnviar` ya
        // descarta las vacías y devuelve el número; se serializa aquí, sin `toFixed` sobre un
        // importe leído (el valor sale del propio editor, en colones enteros).
        lineas: lineasParaEnviar(lineas).map((l) => ({
          metodo: l.metodo,
          monto: `${l.monto}`,
        })),
      });
      if (r.status === "ok") {
        toast.success(OK_TOAST);
        onOpenChange(false);
        await onCorregido();
        return;
      }
      if (r.status === "validation_error") {
        // El servidor manda los errores por campo; el único campo de este diálogo es `lineas`.
        setErrorServidor(r.fieldErrors.lineas?.[0] ?? ERROR_GENERICO);
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
        gestion
          ? `Orden ${gestion.numRemision} · ${gestion.destinatario}. ${AVISO}`
          : AVISO
      }
      confirmLabel="Guardar"
      confirmDisabled={enviando || hayErrorDeLinea || !cuadra}
      onConfirm={confirmar}
    >
      {gestion ? (
        <DesglosePagoField
          lineas={lineas}
          montoACobrar={montoACobrar}
          errores={errores}
          // El descuadre se dice ANTES de pulsar, con el mismo texto que ve el mensajero.
          errorCuadre={cuadra ? undefined : DESGLOSE_TEXTOS.noCuadra}
          errorMetodo={undefined}
          errorServidor={errorServidor}
          onChange={setLineas}
        />
      ) : null}
    </Modal>
  );
}
