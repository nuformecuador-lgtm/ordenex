"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { ManifiestoResultado } from "@/components/shared/ManifiestoResultado";
import { Select } from "@/components/ui/select";
import { useToast } from "@/hooks/useToast";
import { generarGuia } from "@/lib/actions/ordenes-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";

import { toMensajeroOptions } from "./mensajero-options";
import { guiaDecisionErrorMessage } from "./guia-decision-error-messages";

export interface GenerarGuiaModalProps {
  /** Visibilidad controlada por el padre (patrón `Modal`, feature 13). */
  open: boolean;
  /** Órdenes seleccionadas al abrir (snapshot de un único apartado, R17). */
  ordenes: OrdenListItemDTO[];
  /** TODOS los mensajeros, sin filtro de zona (R28). */
  mensajeros: MensajeroLiteDTO[];
  /** Ajuste maestro: ids de mensajeros con cierre abierto; se deshabilitan en cada selector. */
  mensajerosBloqueadosIds?: string[];
  onOpenChange: (open: boolean) => void;
  /** Se invoca tras un "ok" para que el padre refresque los apartados. */
  onSuccess: () => void;
}

const SIN_MENSAJERO_LABEL = "Sin mensajero";

/** Feature 148: lote ya cometido + su resumen, para la fase "resultado". */
interface GuiaGeneradaResumen {
  ordenIds: string[];
  mensaje: string;
}

/** `ordenId -> mensajeroId` ("" = sin mensajero). Preselecciona el sugerido (R20/R21). */
function seleccionInicial(ordenes: OrdenListItemDTO[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const orden of ordenes) {
    next[orden.id] = orden.mensajeroSugeridoId ?? "";
  }
  return next;
}

/**
 * ¿La orden es GAM? Feature 30/R7/R8: `zonaEsGam === false` → NO-GAM (se rutea a
 * satélite, sin mensajero). `true` o `undefined` (mocks/fixtures previos a la
 * feature 30 que no traen el flag) → se trata como GAM: conserva el camino de la
 * feature 17 sin regresión.
 */
function esGam(orden: OrdenListItemDTO): boolean {
  return orden.zonaEsGam !== false;
}

const SATELITE_ZONA_DESCONOCIDA = "su zona";

/** Agrupa las órdenes NO-GAM por nombre de zona para titular cada bodega satélite destino. */
function groupByZona(
  ordenes: OrdenListItemDTO[],
): { zonaNombre: string; ordenes: OrdenListItemDTO[] }[] {
  const grupos = new Map<string, OrdenListItemDTO[]>();
  for (const orden of ordenes) {
    const zona = orden.zonaNombre ?? SATELITE_ZONA_DESCONOCIDA;
    const actual = grupos.get(zona);
    if (actual) actual.push(orden);
    else grupos.set(zona, [orden]);
  }
  return Array.from(grupos, ([zonaNombre, items]) => ({
    zonaNombre,
    ordenes: items,
  }));
}

/**
 * Modal async "Generar guía" (feature 17, T18, R20/R24): agrupa la selección
 * en (a) órdenes CON `mensajeroSugeridoId` (preselecciona, permite override o
 * "sin mensajero") y (b) SIN sugerido (elige mensajero o deja "sin"). Al
 * confirmar construye `decisiones: [{ ordenId, mensajeroId | null }]` y hace
 * UNA sola llamada a `generarGuia` (R19/R21-R24), con independencia de que la
 * orden termine en `por_recoger` o `en_bodega_central` (R23).
 *
 * Feature 30 (T17, R7/R8/R9/R11): las órdenes NO-GAM (`zonaEsGam === false`) NO
 * pueden llevar mensajero. Se listan en un grupo aparte "Se enviarán a la bodega
 * satélite de <zona>" SIN select; al confirmar su `mensajeroId` va SIEMPRE `null`
 * y el service las rutea a `en_ruta_bodega_satelite` en la misma transacción del
 * lote (R11). El toast distingue los tres destinos (espera / bodega / satélite).
 */
export function GenerarGuiaModal({
  open,
  ordenes,
  mensajeros,
  mensajerosBloqueadosIds = [],
  onOpenChange,
  onSuccess,
}: GenerarGuiaModalProps) {
  const toast = useToast();
  // R20: preselección inicial (sugerido u "sin mensajero") calculada en el
  // primer render si ya monta abierto (inicializador perezoso), y recalculada
  // solo al transicionar a `open` en re-aperturas, sin reiniciar la selección
  // del usuario mientras el modal permanece abierto. Patrón "ajustar estado
  // durante el render" (no efecto) para evitar el render en cascada de un
  // `useEffect`.
  const [seleccion, setSeleccion] = useState<Record<string, string>>(() =>
    open ? seleccionInicial(ordenes) : {},
  );
  // Feature 148 (T11, §9.7): fase "resultado". Guarda el LOTE ya cometido (ids del
  // resultado de negocio) para poder ofrecer el manifiesto sin perderlo al cerrar.
  // `null` = fase de edición; array = la guía ya se generó.
  const [resultado, setResultado] = useState<GuiaGeneradaResumen | null>(null);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSeleccion(seleccionInicial(ordenes));
      setResultado(null);
    }
  }

  const mensajeroOptions = toMensajeroOptions(
    mensajeros,
    new Set(mensajerosBloqueadosIds),
  );
  // Feature 30/R8: primero se separa GAM (con select) de NO-GAM (a satélite, sin
  // select). Dentro de GAM se conserva el subgrupo sugerido/sin-sugerido (feat 17).
  const gamOrdenes = ordenes.filter(esGam);
  const noGamOrdenes = ordenes.filter((o) => !esGam(o));
  const conSugerido = gamOrdenes.filter((o) => o.mensajeroSugeridoId != null);
  const sinSugerido = gamOrdenes.filter((o) => o.mensajeroSugeridoId == null);
  // Grupos NO-GAM por zona: cada zona informa su bodega satélite destino (R8/R15).
  const noGamPorZona = groupByZona(noGamOrdenes);

  function handleRowChange(ordenId: string, mensajeroId: string) {
    setSeleccion((prev) => ({ ...prev, [ordenId]: mensajeroId }));
  }

  const columns: Column<OrdenListItemDTO>[] = [
    { id: "numRemision", value: "Nº Remisión", render: "numRemision" },
    { id: "destinatario", value: "Destinatario", render: "destinatario" },
    {
      id: "mensajero",
      value: "Mensajero",
      render: (row) => (
        <Select
          value={seleccion[row.id] ?? ""}
          onValueChange={(mensajeroId) => handleRowChange(row.id, mensajeroId)}
          options={mensajeroOptions}
          placeholder={SIN_MENSAJERO_LABEL}
          aria-label={`Mensajero para la orden ${row.numRemision}`}
        />
      ),
    },
  ];

  // R8: las órdenes NO-GAM NO ofrecen columna de mensajero (a satélite, sin select).
  const noGamColumns: Column<OrdenListItemDTO>[] = [
    { id: "numRemision", value: "Nº Remisión", render: "numRemision" },
    { id: "destinatario", value: "Destinatario", render: "destinatario" },
  ];

  async function handleConfirm() {
    // R9/R11: NO-GAM → `mensajeroId` null siempre (el service las rutea a
    // satélite); GAM → la selección del maestro (o null = "sin mensajero").
    const decisiones = ordenes.map((orden) => ({
      ordenId: orden.id,
      mensajeroId: esGam(orden)
        ? seleccion[orden.id]
          ? seleccion[orden.id]
          : null
        : null,
    }));

    const result = await generarGuia({ decisiones });
    if (result.status !== "ok") {
      // R25: fallo del lote → el Modal invoca `onError`, permanece abierto,
      // ninguna orden queda numerada a medias.
      throw result;
    }

    const espera = result.resultados.filter(
      (r) => r.estado === "por_recoger",
    ).length;
    const bodega = result.resultados.filter(
      (r) => r.estado === "en_bodega_central",
    ).length;
    const satelite = result.resultados.filter(
      (r) => r.estado === "en_ruta_bodega_satelite",
    ).length;
    const mensaje = `Guía generada para ${result.resultados.length} orden(es): ${espera} en espera de aceptación, ${bodega} en bodega, ${satelite} en ruta a bodega satélite.`;
    toast.success(mensaje);
    // Feature 148 (§9.7): la operación YA está cometida; en vez de cerrar, el modal
    // pasa a la fase "resultado" con el mismo resumen + el botón de manifiesto.
    // `onSuccess()` (refresco del padre) se difiere al cierre de esa fase: nada de
    // la llamada de negocio, su input ni su toast cambian (R27).
    setResultado({
      ordenIds: result.resultados.map((r) => r.ordenId),
      mensaje,
    });
  }

  function handleError(error: unknown) {
    toast.error(guiaDecisionErrorMessage(error));
  }

  /**
   * Cierre de la fase "resultado" por cualquier vía (botón, Escape, overlay): recién
   * ahí se avisa al padre para que refresque. Un fallo de la descarga no pasa por
   * aquí, así que no puede alterar el resultado ya cometido (R25).
   */
  function handleOpenChange(next: boolean) {
    if (!next && resultado) {
      setResultado(null);
      onOpenChange(false);
      onSuccess();
      return;
    }
    onOpenChange(next);
  }

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Generar guía"
      description={
        resultado
          ? "Guías generadas. Descarga el manifiesto del lote antes de cerrar."
          : "Confirma el mensajero por orden. Las órdenes sin mensajero pasan a bodega."
      }
      confirmLabel="Generar guía"
      cancelLabel={resultado ? "Cerrar" : "Cancelar"}
      hideConfirm={resultado !== null}
      // El modal NO se cierra al confirmar: pasa a la fase "resultado" (§9.7).
      closeOnConfirm={false}
      onConfirm={handleConfirm}
      onError={handleError}
      className="max-w-2xl"
    >
      {resultado ? (
        <ManifiestoResultado
          mensaje={resultado.mensaje}
          flujo="generacion_guia"
          seleccion={{ ordenIds: resultado.ordenIds }}
        />
      ) : (
      <div className="flex flex-col gap-4">
        {conSugerido.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Con mensajero sugerido</h3>
            <DataTable
              columns={columns}
              data={conSugerido}
              rowKey="id"
              ariaLabel="Órdenes con mensajero sugerido"
            />
          </div>
        ) : null}
        {sinSugerido.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Sin mensajero sugerido</h3>
            <DataTable
              columns={columns}
              data={sinSugerido}
              rowKey="id"
              ariaLabel="Órdenes sin mensajero sugerido"
            />
          </div>
        ) : null}
        {noGamPorZona.map((grupo) => {
          const titulo = `Se enviarán a la bodega satélite de ${grupo.zonaNombre}`;
          return (
            <div key={grupo.zonaNombre} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{titulo}</h3>
              <DataTable
                columns={noGamColumns}
                data={grupo.ordenes}
                rowKey="id"
                ariaLabel={titulo}
              />
            </div>
          );
        })}
      </div>
      )}
    </Modal>
  );
}
