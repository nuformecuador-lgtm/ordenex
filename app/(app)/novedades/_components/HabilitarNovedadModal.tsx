"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { Label } from "@/components/ui/label";
import type { NovedadDTO } from "@/lib/types/novedad";

export interface HabilitarNovedadModalProps {
  /**
   * Orden `devuelta` a habilitar (snapshot). El padre monta el modal SOLO cuando hay una
   * orden activa, con `key={orden.id}`, de modo que la nota arranca fresca en cada apertura
   * sin un efecto de reinicio — mismo patrón que `ReprogramarNovedadModal`.
   */
  orden: NovedadDTO;
  onOpenChange: (open: boolean) => void;
  /**
   * Confirmación con la nota YA validada y recortada (nunca vacía): el modal garantiza la
   * obligatoriedad, el consumidor decide qué hacer con ella.
   *
   * Hoy el consumidor sólo avisa de que la acción no está disponible (maqueta declarada,
   * ver `NovedadAcciones`), pero la firma es la definitiva: el día que exista la Server
   * Action, se cablea aquí sin tocar este archivo.
   */
  onConfirmar: (nota: string) => void | Promise<void>;
}

/**
 * 2026-08-12 (pedido humano) — Modal de "Habilitar" con NOTA OBLIGATORIA.
 *
 * POR QUÉ LA NOTA ES OBLIGATORIA Y NO OPCIONAL, dicho aquí porque es la diferencia con el
 * modal hermano: reprogramar deja rastro por sí solo (queda una fecha nueva y una gestión),
 * así que su motivo puede ser opcional (Q1 de la feature 100). Habilitar una orden que la
 * tienda ya dio por devuelta no deja más rastro que el que alguien escriba: sin nota, el
 * historial no puede decir POR QUÉ volvió a circular.
 *
 * ⚠️ MAQUETA: la transición todavía no existe en el backend. Lo que este archivo garantiza
 * hoy es la regla de superficie —no se puede confirmar sin nota— y no hay ningún borde
 * detrás que la revalide, porque no hay borde. Cuando lo haya, la validación de zod es
 * obligatoria igual: esta guarda es de UI y una guarda de UI no protege un dato (mismo
 * criterio que `ReprogramarNovedadModal`, cuya guarda de fecha convive con el `refine` del
 * schema).
 */
export function HabilitarNovedadModal({
  orden,
  onOpenChange,
  onConfirmar,
}: HabilitarNovedadModalProps) {
  const [nota, setNota] = useState("");
  // El mensaje de error no se pinta hasta que el campo se TOCA. La nota arranca vacía —o
  // sea, inválida—, así que copiar tal cual el patrón del campo de fecha del modal hermano
  // (que arranca VÁLIDO y sólo se queja si lo rompés) recibiría al usuario con un error
  // rojo por algo que todavía no ha hecho mal. El botón sí está deshabilitado desde el
  // primer instante: la regla se comunica igual, sin regañar.
  const [tocado, setTocado] = useState(false);

  const notaLimpia = nota.trim();
  const notaInvalida = notaLimpia === "";
  const mostrarError = tocado && notaInvalida;

  const guia =
    orden.numGuia !== null ? `guía ${orden.numGuia}` : "sin guía asignada";

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      title="Habilitar orden"
      description={`Contá por qué se habilita la orden de ${orden.destinatario} (${guia}).`}
      confirmLabel="Habilitar"
      confirmDisabled={notaInvalida}
      onConfirm={() => onConfirmar(notaLimpia)}
      size="sm"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="habilitar-nota">
          Nota <span className="font-normal text-muted-foreground">(obligatoria)</span>
        </Label>
        <textarea
          id="habilitar-nota"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          onBlur={() => setTocado(true)}
          rows={3}
          required
          aria-invalid={mostrarError || undefined}
          aria-describedby={mostrarError ? "habilitar-nota-error" : undefined}
          className="w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground dark:bg-input/30"
        />
        {mostrarError ? (
          <p id="habilitar-nota-error" role="alert" className="text-sm text-destructive">
            La nota es obligatoria.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
