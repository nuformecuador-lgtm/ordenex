"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

import { CATEGORIA_OPTIONS, TIPO_OPTIONS } from "./wallet-labels";

// Feature 42 (T12, R20) — filtros del libro: tipo, categoría (poblada desde el SEED) y
// rango de fechas (desde/hasta). Mantiene un BORRADOR local; al pulsar "Aplicar" emite
// los filtros al módulo, que recarga libro + cifras de la caja por Server Action (la
// cabecera refleja el conjunto filtrado, R20). "Limpiar" resetea a sin filtros.
//
// Feature 173 (T G.2, R61): este `Select` de categoría se puebla del SEED desde la 42, así
// que las dos categorías de tesorería entraron SOLAS. No hay una línea que las nombre aquí
// —y no debe haberla—: lo que hay es un test que afirma que la lista sigue siendo el SEED.
//
// Feature 200 (tanda 3) — de BLOQUE a BARRA. Antes eran cuatro campos con su rótulo encima
// y dos botones en `flex-wrap items-end gap-4`: dos alturas de pantalla para cuatro
// controles, empujando la tabla —que es lo que se viene a mirar— hacia abajo. Ahora es una
// sola línea en pantallas grandes que envuelve limpio en las chicas, y vive dentro de la
// tarjeta del libro como su banda superior. Ni el contrato (`onAplicar`/`onLimpiar`/
// `disabled`), ni el borrador local, ni los cuatro campos cambian.

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

/**
 * Ficha 339 (T5.6, design §5.4) — los filtros VIGENTES traducidos al input de un borde, con los
 * vacios FUERA. Una cadena vacia no es «no filtres»: seria un filtro que no filtra nada… o un
 * `validation_error`, segun el campo.
 *
 * Vive aqui —junto al tipo y al valor vacio que ya viven aqui— y no dentro de `WalletModule`
 * porque la usan TRES caminos: la descarga del libro completo, el listado paginado (compuesta
 * con la pagina) y el detalle de una fila de la tarjeta de la ganancia. Dos constructores
 * distintos de los mismos filtros es exactamente como el detalle acabaria enseñando un conjunto
 * que no es el del importe de su fila (R20).
 */
export function inputDeFiltros(filtros: WalletFiltrosValue): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (filtros.tipo) input.tipo = filtros.tipo;
  if (filtros.categoria) input.categoria = filtros.categoria;
  if (filtros.desde) input.desde = filtros.desde;
  if (filtros.hasta) input.hasta = filtros.hasta;
  return input;
}

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
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onAplicar(draft);
      }}
    >
      {/* Los dos `Select` ya dicen su nombre en el PLACEHOLDER («Todos los tipos», «Todas las
          categorías»), que además informa mejor que el rótulo: dice qué se está viendo ahora,
          no cómo se llama el campo. Por eso el rótulo pasa a `sr-only` en vez de desaparecer.

          El `id` es NUEVO y arregla un defecto real: estos dos `htmlFor` apuntaban a
          `wallet-filtro-tipo` / `wallet-filtro-categoria`, ids que NO existían en el
          documento —la primitiva `Select` acepta `id` pero nadie se lo pasaba—, así que las
          dos etiquetas colgaban de la nada. El nombre accesible del control lo sigue dando su
          `aria-label`, que tiene precedencia sobre la etiqueta nativa: no se mueve. */}
      <Label htmlFor="wallet-filtro-tipo" className="sr-only">
        Tipo
      </Label>
      <Select
        id="wallet-filtro-tipo"
        aria-label="Filtrar por tipo"
        value={draft.tipo}
        onValueChange={(v) => set("tipo", v)}
        options={TIPO_OPTIONS}
        placeholder="Todos los tipos"
        disabled={disabled}
        className="h-9 w-full sm:w-44"
      />

      <Label htmlFor="wallet-filtro-categoria" className="sr-only">
        Categoría
      </Label>
      <Select
        id="wallet-filtro-categoria"
        aria-label="Filtrar por categoría"
        value={draft.categoria}
        onValueChange={(v) => set("categoria", v)}
        options={CATEGORIA_OPTIONS}
        placeholder="Todas las categorías"
        disabled={disabled}
        className="h-9 w-full sm:w-56"
      />

      {/* Las dos fechas NO tienen placeholder que las nombre (`input[type=date]` pinta su
          propio `dd/mm/aaaa`), así que conservan un rótulo CORTO y visible pegado al campo.
          Ese rótulo es también su nombre accesible: no se le superpone ningún `aria-label`,
          que taparía la palabra que se ve en pantalla con otra distinta. */}
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <Label
          htmlFor="wallet-filtro-desde"
          className="shrink-0 text-xs font-normal text-muted-foreground"
        >
          Desde
        </Label>
        <Input
          id="wallet-filtro-desde"
          type="date"
          value={draft.desde}
          onChange={(e) => set("desde", e.target.value)}
          disabled={disabled}
          className="h-9 w-full sm:w-40"
        />
      </div>

      <div className="flex w-full items-center gap-2 sm:w-auto">
        <Label
          htmlFor="wallet-filtro-hasta"
          className="shrink-0 text-xs font-normal text-muted-foreground"
        >
          Hasta
        </Label>
        <Input
          id="wallet-filtro-hasta"
          type="date"
          value={draft.hasta}
          onChange={(e) => set("hasta", e.target.value)}
          disabled={disabled}
          className="h-9 w-full sm:w-40"
        />
      </div>

      {/* `sm:ml-auto`: los dos botones se van al extremo derecho de la barra en cuanto hay
          ancho para una sola línea. En móvil quedan al principio de su propia fila.

          «Limpiar» se queda en `outline` y no baja a `ghost`: la barra vive sobre un fondo
          tintado (`bg-muted/30`) y un botón sin borde ahí se lee como texto suelto, no como
          algo que se pueda pulsar. El foco visible de los dos lo trae la primitiva
          (`focus-visible:ring-3 ring-ring/50`). */}
      <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
        <Button type="submit" disabled={disabled} className="h-9">
          Aplicar
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="h-9"
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
