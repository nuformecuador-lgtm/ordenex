"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import {
  rotarApiKey,
  activarApiKey,
  desactivarApiKey,
} from "@/lib/actions/api-keys";
import type { ApiKeyListItemDTO } from "@/lib/types/api-key";

import { RevelarApiKeyModal } from "./RevelarApiKeyModal";

export interface ApiKeyAccionCellProps {
  /** Fila de la tabla; su `id` e `identificador` alimentan las acciones y modales. */
  row: ApiKeyListItemDTO;
  /**
   * Refresco del listado tras cada mutación `ok`. Lo inyecta `ApiKeysModule` con su
   * `mutate` de SWR, para mantener una sola fuente de verdad de la key SWR.
   */
  onMutated: () => Promise<void>;
}

/** Secreto NUEVO revelado UNA sola vez tras rotar; `null` = sin revelar. */
interface Revelado {
  plainKey: string;
  identificador: string;
}

/**
 * Celda de la columna "Acciones" del listado de API keys (feature ciclo de vida).
 * Molde de `WebhookAccionCell`: dueña de los modales de confirmación de "Rotar" y
 * "Activar"/"Desactivar" (según `row.estado`). Al confirmar llama la Server Action
 * correspondiente; si `ok`, refresca el listado con `onMutated` y —solo al rotar—
 * abre `RevelarApiKeyModal` con el secreto nuevo (única vez que existe). Los
 * errores del backend se traducen a un toast legible. Anti-doble-submit por la fase
 * `pending` del `Modal` (`closeOnConfirm={false}`).
 */
export function ApiKeyAccionCell({ row, onMutated }: ApiKeyAccionCellProps) {
  const toast = useToast();
  const [confirmRotar, setConfirmRotar] = useState(false);
  const [confirmEstado, setConfirmEstado] = useState(false);
  const [revelado, setRevelado] = useState<Revelado | null>(null);

  const activa = row.estado === "activa";

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
