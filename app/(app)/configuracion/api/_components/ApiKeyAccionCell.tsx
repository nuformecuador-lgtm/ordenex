"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import {
  rotarApiKey,
  activarApiKey,
  desactivarApiKey,
  eliminarApiKey,
} from "@/lib/actions/api-keys";
import type { ApiKeyListItemDTO } from "@/lib/types/api-key";

import { RevelarApiKeyModal } from "./RevelarApiKeyModal";
import { textoNoEliminable } from "./api-key-eliminable-label";

export interface ApiKeyAccionCellProps {
  /** Fila de la tabla; su `id` e `identificador` alimentan las acciones y modales. */
  row: ApiKeyListItemDTO;
  /**
   * Refresco del listado tras cada mutación `ok`. Lo inyecta `ApiKeysModule` con su
   * `mutate` de SWR, para mantener una sola fuente de verdad de la key SWR.
   */
  onMutated: () => Promise<void>;
  /**
   * FICHA 373/R35 — aviso de que la fila DESAPARECIÓ (no que cambió). Lo usa `ApiKeysModule`
   * para retroceder de página cuando el borrado deja vacía una que no es la primera. Va aquí
   * como aviso y no como decisión: **la celda no conoce la paginación** (design §7.3).
   */
  onEliminada?: () => void;
}

/** Secreto NUEVO revelado UNA sola vez tras rotar; `null` = sin revelar. */
interface Revelado {
  plainKey: string;
  identificador: string;
}

/**
 * Celda de la columna "Acciones" del listado de API keys (feature ciclo de vida).
 * Molde de `WebhookAccionCell`: dueña de los modales de confirmación de "Rotar",
 * "Activar"/"Desactivar" (según `row.estado`) y —ficha 373— "Eliminar". Al confirmar
 * llama la Server Action correspondiente; si `ok`, refresca el listado con `onMutated`
 * y —solo al rotar— abre `RevelarApiKeyModal` con el secreto nuevo (única vez que
 * existe). Los errores del backend se traducen a un toast legible. Anti-doble-submit
 * por la fase `pending` del `Modal` (`closeOnConfirm={false}`).
 *
 * FICHA 373 — «Eliminar» es IRREVERSIBLE y solo se ofrece sobre una key que el SERVIDOR
 * marcó `eliminable`. Cuando no lo es, el botón sale apagado DICIENDO POR QUÉ (R28): un
 * botón que se ofrece y luego falla enseña al usuario a desconfiar de todos los botones.
 */
export function ApiKeyAccionCell({
  row,
  onMutated,
  onEliminada,
}: ApiKeyAccionCellProps) {
  const toast = useToast();
  const [confirmRotar, setConfirmRotar] = useState(false);
  const [confirmEstado, setConfirmEstado] = useState(false);
  const [confirmEliminar, setConfirmEliminar] = useState(false);
  const [revelado, setRevelado] = useState<Revelado | null>(null);

  const activa = row.estado === "activa";
  // R28: el motivo llega RESUELTO del servidor; aquí solo se traduce a castellano.
  const motivoTexto = textoNoEliminable(row.motivoNoEliminable);

  async function onConfirmRotar() {
    // El `Modal` bloquea el segundo submit mientras esta promesa corre.
    const res = await rotarApiKey({ id: row.id });
    if (res.status === "ok") {
      await onMutated(); // refresca ANTES de cerrar/revelar.
      setConfirmRotar(false);
      // El secreto nuevo pasa al modal de revelado (única vez que existe).
      setRevelado({ plainKey: res.plainKey, identificador: row.identificador });
    } else {
      setConfirmRotar(false);
      toast.error(mensajeError(res.status));
    }
  }

  async function onConfirmEstado() {
    const res = activa
      ? await desactivarApiKey({ id: row.id })
      : await activarApiKey({ id: row.id });
    if (res.status === "ok") {
      await onMutated();
      setConfirmEstado(false);
      toast.success(activa ? "API key desactivada" : "API key activada");
    } else {
      setConfirmEstado(false);
      toast.error(mensajeError(res.status));
    }
  }

  async function onConfirmEliminar() {
    // R29/R32: solo se llega aquí desde el botón de confirmar del modal.
    const res = await eliminarApiKey({ id: row.id });
    if (res.status === "ok") {
      await onMutated(); // R33: releer el listado ANTES de cerrar.
      setConfirmEliminar(false);
      onEliminada?.(); // R35: la fila desapareció; el módulo decide si retrocede de página.
      toast.success("API key eliminada");
      return;
    }
    setConfirmEliminar(false);
    // R34: un mensaje distinto por caso. `bloqueada` (R12) no es un error del borde sino un
    // retorno del servicio, y trae SU motivo: se dice ése, no un genérico.
    toast.error(
      res.status === "bloqueada"
        ? textoNoEliminable(res.motivo)
        : mensajeError(res.status),
    );
  }

  const estadoLabel = activa ? "Desactivar" : "Activar";

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setConfirmRotar(true)}
          aria-label={`Rotar la API key ${row.identificador}`}
        >
          Rotar
        </Button>
        <Button
          type="button"
          size="sm"
          variant={activa ? "destructive" : "default"}
          onClick={() => setConfirmEstado(true)}
          aria-label={`${estadoLabel} la API key ${row.identificador}`}
        >
          {estadoLabel}
        </Button>
        {/**
         * FICHA 373/R1/R14/R28 — el tercer botón. `disabled` obedece a `row.eliminable`, que
         * resuelve el SERVIDOR; el motivo va en el NOMBRE ACCESIBLE y en el `title` porque un
         * botón deshabilitado no recibe foco: dejarlo solo en el tooltip lo haría invisible para
         * media pantalla. Rotar y Activar/Desactivar siguen habilitados pase lo que pase (R14).
         */}
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={!row.eliminable}
          title={row.eliminable ? undefined : motivoTexto}
          aria-label={
            row.eliminable
              ? `Eliminar la API key ${row.identificador}`
              : `No se puede eliminar la API key ${row.identificador}: ${motivoTexto}`
          }
          onClick={() => setConfirmEliminar(true)}
        >
          Eliminar
        </Button>
      </div>

      {/* Confirmación que advierte que la rotación invalida el secreto anterior. */}
      <Modal
        open={confirmRotar}
        onOpenChange={setConfirmRotar}
        title="Rotar la API key"
        description="Se generará un secreto nuevo y el anterior dejará de funcionar de inmediato."
        confirmLabel="Sí, rotar"
        confirmVariant="destructive"
        cancelLabel="Cancelar"
        closeOnConfirm={false}
        onConfirm={onConfirmRotar}
      >
        <p role="alert" className="text-sm text-destructive">
          El secreto actual dejará de funcionar. Las integraciones que lo usen
          dejarán de autenticar hasta actualizarlas con el secreto nuevo.
        </p>
      </Modal>

      {/* Confirmación de activar/desactivar según el estado actual. */}
      <Modal
        open={confirmEstado}
        onOpenChange={setConfirmEstado}
        title={activa ? "Desactivar la API key" : "Activar la API key"}
        description={
          activa
            ? "La API key dejará de autorizar cargas hasta que se reactive."
            : "La API key volverá a autorizar cargas."
        }
        confirmLabel={activa ? "Sí, desactivar" : "Sí, activar"}
        confirmVariant={activa ? "destructive" : "default"}
        cancelLabel="Cancelar"
        closeOnConfirm={false}
        onConfirm={onConfirmEstado}
      >
        <p className="text-sm">
          ¿Seguro que quieres {estadoLabel.toLowerCase()} la API key{" "}
          <strong>{row.identificador}</strong>?
        </p>
      </Modal>

      {/**
       * FICHA 373/R29–R32 — confirmación destructiva SIMPLE (patrón de la ficha 332): no se pide
       * teclear el identificador. La fricción ya la puso el paso previo obligatorio de desactivar
       * (R11), que es explícito, visible en el listado y reversible.
       */}
      <Modal
        open={confirmEliminar}
        onOpenChange={setConfirmEliminar}
        title="Eliminar la API key"
        confirmLabel="Sí, eliminar"
        confirmVariant="destructive"
        cancelLabel="Cancelar"
        closeOnConfirm={false}
        onConfirm={onConfirmEliminar}
      >
        <div className="flex flex-col gap-3 text-sm">
          <p>
            Vas a eliminar la API key <strong>{row.identificador}</strong>.
          </p>
          {/* R30: las TRES consecuencias, juntas y anunciadas. */}
          <ul role="alert" className="list-disc pl-5 text-destructive">
            <li>Esta acción es irreversible: no se puede deshacer.</li>
            <li>El secreto deja de funcionar de forma definitiva.</li>
            <li>
              Desaparecen también su cuenta dedicada y su suscripción de webhook.
            </li>
          </ul>
          {/* R31: la alternativa NO destructiva, que ya está en marcha. */}
          <p className="text-muted-foreground">
            La API key ya está desactivada: dejarla así revoca el acceso sin
            borrar nada.
          </p>
        </div>
      </Modal>

      {revelado ? (
        <RevelarApiKeyModal
          plainKey={revelado.plainKey}
          identificador={revelado.identificador}
          onClose={() => setRevelado(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Traduce el `status` de error del backend a un mensaje de UI legible, sin exponer
 * internals. Mismo espíritu que el `mensajeError` de `ApiKeysModule`/`WebhookAccionCell`.
 */
function mensajeError(status: string): string {
  switch (status) {
    case "unauthenticated":
      return "Tu sesión expiró. Vuelve a iniciar sesión.";
    case "forbidden":
      return "No tienes permiso para esta acción.";
    case "not_found":
      return "Esta API key ya no existe. Actualiza el listado.";
    default:
      return "No se pudo completar la operación. Inténtalo de nuevo.";
  }
}
