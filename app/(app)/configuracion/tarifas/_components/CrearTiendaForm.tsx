"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, type SelectOption } from "@/components/ui/select";
import { useToast } from "@/hooks/useToast";
import { crearTarifa, actualizarTarifa } from "@/lib/actions/tarifas";
import type { UsuarioPorRolDTO } from "@/lib/types/usuario-por-rol";

/**
 * Campos numéricos que pueblan la tabla `tarifas`, OMITIENDO `nombre` y
 * `zona_id`. `monto` valida >= 0; `porcentaje` valida 0..100. Todos obligatorios.
 */
export const TIENDA_CAMPOS = [
  { key: "valorFlete", label: "Valor flete", tipo: "monto" },
  { key: "valorFleteDevuelto", label: "Valor flete devuelto", tipo: "monto" },
  { key: "valorFleteGam", label: "Valor flete GAM", tipo: "monto" },
  { key: "valorFleteDevueltoGam", label: "Valor flete devuelto GAM", tipo: "monto" },
  { key: "fulfillment", label: "Fulfillment", tipo: "monto" },
  { key: "comisionCod", label: "Comisión COD (%)", tipo: "porcentaje" },
  { key: "ivaFlete", label: "IVA flete (%)", tipo: "porcentaje" },
  { key: "ivaComisionCod", label: "IVA comisión COD (%)", tipo: "porcentaje" },
] as const;

export type TiendaCampoKey = (typeof TIENDA_CAMPOS)[number]["key"];

/** Valores del formulario como strings (lo que teclea el usuario). */
export type TiendaValores = Record<TiendaCampoKey, string>;

export const tiendaValoresVacios = (): TiendaValores =>
  TIENDA_CAMPOS.reduce((acc, c) => {
    acc[c.key] = "";
    return acc;
  }, {} as TiendaValores);

/** Datos pre-cargados en edición. */
export interface TiendaFormInitial {
  tarifaId?: string;
  tiendaId: string;
  valores: TiendaValores;
}

type FieldErrors = Record<string, string[]>;

/**
 * Formulario de crear/editar "tienda": un `select` de administrador de tienda
 * (tienda_id, vacío inicialmente) + los campos numéricos de `tarifas` (sin
 * nombre ni zona_id). Todos obligatorios. Reusa las Server Actions de tarifas.
 */
export function CrearTiendaForm({
  mode,
  adminTiendas,
  initial,
  onSaved,
  onCancel,
}: {
  mode: "crear" | "editar";
  adminTiendas: UsuarioPorRolDTO[];
  initial?: TiendaFormInitial;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const esEditar = mode === "editar";

  const [tiendaId, setTiendaId] = useState(initial?.tiendaId ?? "");
  const [valores, setValores] = useState<TiendaValores>(
    initial?.valores ?? tiendaValoresVacios(),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [guardando, setGuardando] = useState(false);

  const opciones: SelectOption[] = adminTiendas.map((u) => ({
    value: u.id,
    label: u.nombre,
  }));

  function setCampo(key: TiendaCampoKey, value: string) {
    setValores((prev) => ({ ...prev, [key]: value }));
  }

  /** Valida en cliente (todos obligatorios + rangos) y arma el payload numérico. */
  function validar(): { ok: true; payload: Record<string, unknown> } | { ok: false } {
    const next: FieldErrors = {};
    if (!tiendaId) next.tiendaId = ["Selecciona un administrador de tienda."];

    const numericos: Record<string, number> = {};
    for (const campo of TIENDA_CAMPOS) {
      const raw = valores[campo.key].trim();
      if (raw === "") {
        next[campo.key] = ["Este campo es obligatorio."];
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        next[campo.key] = ["Debe ser un número válido."];
        continue;
      }
      if (n < 0) {
        next[campo.key] = ["No puede ser negativo."];
        continue;
      }
      if (campo.tipo === "porcentaje" && n > 100) {
        next[campo.key] = ["Debe estar entre 0 y 100."];
        continue;
      }
      numericos[campo.key] = n;
    }

    if (Object.keys(next).length > 0) {
      setErrors(next);
      return { ok: false };
    }
    setErrors({});
    // Contrato objetivo: tienda_id + campos numéricos (sin nombre ni zona_id).
    return { ok: true, payload: { tiendaId, ...numericos } };
  }

  async function guardar() {
    const res = validar();
    if (!res.ok) return;

    setGuardando(true);
    try {
      const result =
        esEditar && initial?.tarifaId
          ? await actualizarTarifa(initial.tarifaId, res.payload)
          : await crearTarifa(res.payload);

      if (result.status === "ok") {
        toast.success(esEditar ? "Tienda actualizada" : "Tienda creada");
        onSaved();
        return;
      }
      if (result.status === "validation_error") {
        setErrors(result.fieldErrors);
      }
      toast.error(mensajeDeError(result.status));
    } catch {
      toast.error("Ocurrió un error inesperado.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 rounded-md border border-border p-4">
      <h3 className="text-sm font-semibold">
        {esEditar ? "Editar tienda" : "Nueva tienda"}
      </h3>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tienda-admin">Administrador de tienda</Label>
        <Select
          value={tiendaId}
          onValueChange={setTiendaId}
          options={opciones}
          placeholder="Selecciona un administrador de tienda"
          disabled={opciones.length === 0}
          aria-label="Administrador de tienda"
        />
        {errors.tiendaId?.length ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.tiendaId.join(", ")}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {TIENDA_CAMPOS.map((campo) => (
          <div key={campo.key} className="flex flex-col gap-1.5">
            <Label htmlFor={`tienda-${campo.key}`}>{campo.label}</Label>
            <Input
              id={`tienda-${campo.key}`}
              type="number"
              inputMode="decimal"
              min={0}
              max={campo.tipo === "porcentaje" ? 100 : undefined}
              step="0.01"
              value={valores[campo.key]}
              aria-invalid={errors[campo.key] ? true : undefined}
              onChange={(e) => setCampo(campo.key, e.target.value)}
            />
            {errors[campo.key]?.length ? (
              <p role="alert" className="text-sm text-destructive">
                {errors[campo.key].join(", ")}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" onClick={guardar} loading={guardando}>
          {guardando ? "Guardando…" : "Guardar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={guardando}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/** Mensaje legible para los estados de error de crear/actualizar tarifa. */
function mensajeDeError(status: string): string {
  switch (status) {
    case "validation_error":
      return "Revisa los campos: el formulario está incompleto.";
    case "unauthenticated":
      return "Tu sesión expiró.";
    case "forbidden":
      return "No tienes permiso para esta acción.";
    case "not_found":
      return "La tienda no existe.";
    default:
      return "No se pudo guardar la tienda.";
  }
}
