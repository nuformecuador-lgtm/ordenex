"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

import { CATEGORIA_OPTIONS, TIPO_OPTIONS } from "./wallet-labels";

// Feature 42 (T12, R20) — filtros del libro: tipo, categoría (poblada desde el SEED) y
// rango de fechas (desde/hasta). Mantiene un BORRADOR local; al pulsar "Aplicar" emite
// los filtros al módulo, que recarga libro + balance por Server Action (el balance
// mostrado refleja el conjunto filtrado, R20). "Limpiar" resetea a sin filtros.

export interface WalletFiltrosValue {
  tipo: string;
  categoria: string;
  desde: string;
  hasta: string;
}

export const FILTROS_VACIOS: WalletFiltrosValue = {
  tipo: "",
  categoria: "",
  desde: "",
  hasta: "",
};

export interface WalletFiltrosProps {
  /** Emite los filtros aplicados (recarga con page reseteada a 1). */
  onAplicar: (value: WalletFiltrosValue) => void;
  /** Emite el reset a sin filtros. */
  onLimpiar: () => void;
  /** Deshabilita los controles mientras corre una recarga. */
  disabled?: boolean;
}

export function WalletFiltros({ onAplicar, onLimpiar, disabled = false }: WalletFiltrosProps) {
  const [draft, setDraft] = useState<WalletFiltrosValue>(FILTROS_VACIOS);

  function set<K extends keyof WalletFiltrosValue>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <form
      aria-label="Filtros del libro"
      className="flex flex-wrap items-end gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onAplicar(draft);
      }}
    >
      <div className="flex min-w-44 flex-col gap-1.5">
        <Label htmlFor="wallet-filtro-tipo">Tipo</Label>
        <Select
          aria-label="Filtrar por tipo"
          value={draft.tipo}
          onValueChange={(v) => set("tipo", v)}
          options={TIPO_OPTIONS}
          placeholder="Todos los tipos"
          disabled={disabled}
        />
      </div>

      <div className="flex min-w-56 flex-col gap-1.5">
        <Label htmlFor="wallet-filtro-categoria">Categoría</Label>
        <Select
          aria-label="Filtrar por categoría"
          value={draft.categoria}
          onValueChange={(v) => set("categoria", v)}
          options={CATEGORIA_OPTIONS}
          placeholder="Todas las categorías"
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wallet-filtro-desde">Desde</Label>
        <Input
          id="wallet-filtro-desde"
          type="date"
          value={draft.desde}
          onChange={(e) => set("desde", e.target.value)}
          disabled={disabled}
          className="w-40"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wallet-filtro-hasta">Hasta</Label>
        <Input
          id="wallet-filtro-hasta"
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
            setDraft(FILTROS_VACIOS);
            onLimpiar();
          }}
        >
          Limpiar
        </Button>
      </div>
    </form>
  );
}
