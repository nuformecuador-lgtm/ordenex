"use client";

import { useRef, useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import {
  obtenerWebhook,
  desactivarWebhook,
  rotarSecretoWebhook,
} from "@/lib/actions/webhooks";

import {
  RegistrarWebhookForm,
  type RegistrarWebhookFormHandle,
} from "./RegistrarWebhookForm";
import { RevelarWebhookSecretoModal } from "./RevelarWebhookSecretoModal";

export interface WebhookAccionCellProps {
  /** Owner (usuario de rol `apiKey`) de la fila. */
  ownerUsuarioId: string;
  /** Identificador humano de la API key, para dar contexto en el modal. */
  identificador: string;
}

/** Estado de la suscripción leído con `obtenerWebhook` (NUNCA el secreto, R5). */
type WebhookEstado = { url: string; activa: boolean } | null;

/** `undefined` = aún no leído / cargando; `null` = sin suscripción. */
type EstadoCarga = WebhookEstado | undefined;

/**
 * Celda de la columna "Webhook" (feature 105/T4, D1). Dueña del ciclo de vida de
 * los modales de gestión de la suscripción de un owner. Al abrir el modal (y tras
 * cada mutación, R18) lee el estado con `obtenerWebhook` (D2) —correcto también en
 * páginas paginadas por el cliente—. Orquesta: registrar/editar la URL (abre el
 * revelado del secreto SOLO si el resultado es `creada`, R7/R7b), "Rotar secreto"
 * con confirmación (R19–R21) y dar de baja con confirmación (R13–R15). El secreto
 * vive solo en `useState` local (R17). Anti-doble-submit por la fase `pending` del
 * `Modal` (R16).
 */
export function WebhookAccionCell({
  ownerUsuarioId,
  identificador,
}: WebhookAccionCellProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [estado, setEstado] = useState<EstadoCarga>(undefined);
  const [avisoNoCampo, setAvisoNoCampo] = useState<string | null>(null);

  const [confirmBaja, setConfirmBaja] = useState(false);
  const [confirmRotar, setConfirmRotar] = useState(false);
  const [secreto, setSecreto] = useState<string | null>(null);

  const formRef = useRef<RegistrarWebhookFormHandle>(null);

  /** R18: (re)lee el estado del owner tras abrir y tras cada mutación `ok`. */
  async function refrescar() {
    const res = await obtenerWebhook({ ownerUsuarioId });
    if (res.status === "ok") {
      setEstado(res.webhook);
      setAvisoNoCampo(null);
    } else {
      setAvisoNoCampo(mensajeError(res.status));
    }
  }

  async function abrir() {
    setAvisoNoCampo(null);
    setEstado(undefined);
    setOpen(true);
    await refrescar(); // D2: lectura on-demand al abrir el modal.
  }

  const activa = estado?.activa === true;

  async function onConfirmRegistrar() {
    // R16: el `Modal` bloquea el segundo submit mientras esta promesa corre.
    const res = await formRef.current?.submit();
    if (!res) return;
    if (res.status === "creada") {
      await refrescar(); // R18
      setSecreto(res.secret); // R7: revelado del secreto (única vez).
    } else if (res.status === "actualizada") {
      // R7b: editar la URL NO muestra secreto; confirma y refresca.
      await refrescar(); // R18
      toast.success("URL de webhook actualizada");
    } else if (
      res.status === "forbidden" ||
      res.status === "unauthenticated"
    ) {
      // R12: mensaje claro; el modal NO se cierra (lo ingresado se conserva).
      setAvisoNoCampo(mensajeError(res.status));
    }
    // validation_error / owner_invalido / config_error → los pinta el formulario.
  }

  async function onConfirmBaja() {
    const res = await desactivarWebhook({ ownerUsuarioId });
    setConfirmBaja(false);
    if (res.status === "ok") {
      await refrescar(); // R14/R18: refleja "sin webhook activo" sin recargar.
      toast.success("Webhook dado de baja");
    } else {
      setAvisoNoCampo(mensajeError(res.status)); // R12
    }
  }

  async function onConfirmRotar() {
    const res = await rotarSecretoWebhook({ ownerUsuarioId });
    setConfirmRotar(false);
    if (res.status === "ok") {
      await refrescar(); // R18
      setSecreto(res.secret); // R21: secreto NUEVO, una sola vez.
    } else {
      setAvisoNoCampo(mensajeError(res.status)); // R12/config_error/not_found
    }
  }

  const cargando = estado === undefined;
  const confirmLabel = activa ? "Guardar URL" : "Registrar";

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={abrir}
        aria-label={`Gestionar webhook de ${identificador}`}
      >
        Webhook
      </Button>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title={`Webhook de "${identificador}"`}
        confirmLabel={confirmLabel}
        cancelLabel="Cerrar"
        closeOnConfirm={false}
        confirmDisabled={cargando}
        onConfirm={onConfirmRegistrar}
      >
        <div className="flex flex-col gap-4">
          <div role="status" className="text-sm">
            {cargando ? (
              <span className="text-muted-foreground">Cargando estado…</span>
            ) : activa ? (
              <span>
                Suscripción <strong>activa</strong>. URL registrada:{" "}
                <span className="font-mono break-all">{estado?.url}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">
                No hay webhook registrado para este owner.
              </span>
            )}
          </div>

          {!cargando ? (
            <RegistrarWebhookForm
              key={estado?.url ?? "nuevo"}
              ref={formRef}
              ownerUsuarioId={ownerUsuarioId}
              initialUrl={estado?.url ?? ""}
            />
          ) : null}

          {activa ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmRotar(true)}
              >
                Rotar secreto
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setConfirmBaja(true)}
              >
                Dar de baja
              </Button>
            </div>
          ) : null}

          {avisoNoCampo ? (
            <p role="alert" className="text-sm text-destructive">
              {avisoNoCampo}
            </p>
          ) : null}
        </div>
      </Modal>

      {/* R13: confirmación explícita antes de dar de baja. */}
      <Modal
        open={confirmBaja}
        onOpenChange={setConfirmBaja}
        title="Dar de baja el webhook"
        description="El owner dejará de recibir notificaciones hasta que se registre una nueva URL."
        confirmLabel="Sí, dar de baja"
        confirmVariant="destructive"
        cancelLabel="Cancelar"
        closeOnConfirm={false}
        onConfirm={onConfirmBaja}
      >
        <p className="text-sm">
          ¿Seguro que quieres dar de baja la suscripción de{" "}
          <strong>{identificador}</strong>?
        </p>
      </Modal>

      {/* R20: confirmación que advierte que la rotación invalida el secreto anterior. */}
      <Modal
        open={confirmRotar}
        onOpenChange={setConfirmRotar}
        title="Rotar el secreto del webhook"
        description="Se generará un secreto nuevo y el anterior dejará de ser válido de inmediato."
        confirmLabel="Sí, rotar secreto"
        confirmVariant="destructive"
        cancelLabel="Cancelar"
        closeOnConfirm={false}
        onConfirm={onConfirmRotar}
      >
        <p role="alert" className="text-sm text-destructive">
          Rotar el secreto invalida el secreto anterior. Las integraciones que lo
          usen para verificar la firma dejarán de funcionar hasta actualizarlo.
        </p>
      </Modal>

      {secreto !== null ? (
        <RevelarWebhookSecretoModal
          secret={secreto}
          identificador={identificador}
          onClose={() => setSecreto(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Traduce los `status` de error que llegan como aviso no-campo a un mensaje de UI
 * claro, sin exponer internals (R11/R12).
 */
function mensajeError(status: string): string {
  switch (status) {
    case "unauthenticated":
      return "Tu sesión expiró. Vuelve a iniciar sesión.";
    case "forbidden":
      return "No tienes permiso para esta acción.";
    case "config_error":
      return "La configuración de webhooks del servidor está pendiente. Contacta al administrador del sistema.";
    case "not_found":
      return "Este owner no tiene una suscripción activa que rotar.";
    default:
      return "No se pudo completar la operación. Inténtalo de nuevo.";
  }
}
