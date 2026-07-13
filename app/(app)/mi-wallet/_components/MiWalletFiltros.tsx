"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

import { CATEGORIA_TIENDA_OPTIONS } from "./mi-wallet-labels";

// Feature 43 (T15, R22) — filtros del desglose: cierre, concepto (poblado desde el SEED) y
// rango de fechas (desde/hasta). Mantiene un BORRADOR local; al pulsar "Aplicar" emite los
// filtros al modulo, que recarga desglose + saldo por Server Action (el saldo mostrado
// refleja el conjunto filtrado, R22). "Limpiar" resetea a sin filtros.

export interface MiWalletFiltrosValue {
  cierreId: string;
  categoria: string;
  desde: string;
  hasta: string;
}

export const FILTROS_TIENDA_VACIOS: MiWalletFiltrosValue = {
  cierreId: "",
  categoria: "",
  desde: "",
  hasta: "",
};

export interface MiWalletFiltrosProps {
  /** Emite los filtros aplicados (recarga con page reseteada a 1). */
  onAplicar: (value: MiWalletFiltrosValue) => void;
  /** Emite el reset a sin filtros. */
  onLimpiar: () => void;
  /** Deshabilita los controles mientras corre una recarga. */
  disabled?: boolean;
}

export function MiWalletFiltros({ onAplicar, onLimpiar, disabled = false }: MiWalletFiltrosProps) {
  const [draft, setDraft] = useState<MiWalletFiltrosValue>(FILTROS_TIENDA_VACIOS);

  function set<K extends keyof MiWalletFiltrosValue>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <form
      aria-label="Filtros del desglose"
      className="flex flex-wrap items-end gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onAplicar(draft);
      }}
    >
      <div className="flex min-w-56 flex-col gap-1.5">
        <Label htmlFor="mi-wallet-filtro-cierre">Cierre</Label>
        <Input
          id="mi-wallet-filtro-cierre"
          type="text"
          value={draft.cierreId}
          onChange={(e) => set("cierreId", e.target.value)}
          disabled={disabled}
          placeholder="ID del cierre"
          className="w-56"
        />
      </div>

      <div className="flex min-w-56 flex-col gap-1.5">
        <Label htmlFor="mi-wallet-filtro-concepto">Concepto</Label>
        <Select
          aria-label="Filtrar por concepto"
          value={draft.categoria}
          onValueChange={(v) => set("categoria", v)}
          options={CATEGORIA_TIENDA_OPTIONS}
          placeholder="Todos los conceptos"
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mi-wallet-filtro-desde">Desde</Label>
        <Input
          id="mi-wallet-filtro-desde"
          type="date"
          value={draft.desde}
          onChange={(e) => set("desde", e.target.value)}
          disabled={disabled}
          className="w-40"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mi-wallet-filtro-hasta">Hasta</Label>
        <Input
          id="mi-wallet-filtro-hasta"
          type="date"
          value={draft.hasta}
          onChange={(e) => set("hasta", e.target.value)}
          disabled={disabled}
          className="w-40"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={disabled}>
          Aplicar
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            setDraft(FILTROS_TIENDA_VACIOS);
            onLimpiar();
          }}
        >
          Limpiar
        </Button>
      </div>
    </form>
  );
}
