"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

import { CATEGORIA_TIENDA_OPTIONS } from "./mi-wallet-labels";
import { opcionesDeCierre, type CierresDeLaTienda } from "./mi-wallet-cierres";

// Feature 43 (T15, R22) — filtros del desglose: cierre, concepto (poblado desde el SEED) y
// rango de fechas (desde/hasta). Mantiene un BORRADOR local; al pulsar "Aplicar" emite los
// filtros al modulo, que recarga desglose + saldo por Server Action (el saldo mostrado
// refleja el conjunto filtrado, R22). "Limpiar" resetea a sin filtros.
//
// Ficha 335 (B3/C2) — dos cambios, y ninguno toca el contrato del componente
// (`onAplicar`/`onLimpiar`/`disabled`), ni el borrador local, ni los cuatro campos:
//
//  1. De BLOQUE a BARRA. Antes eran cuatro campos con su rotulo encima y dos botones en
//     `flex-wrap items-end gap-4`: dos alturas de pantalla para cuatro controles, empujando la
//     tabla —que es lo que se viene a mirar— hacia abajo. Ahora es una sola linea en pantallas
//     grandes, que envuelve limpio en las chicas, y vive dentro de la tarjeta del libro.
//
//  2. El filtro de cierre deja de pedir un IDENTIFICADOR ESCRITO A MANO (R22). Antes era un
//     `<input type="text" placeholder="ID del cierre">`: nadie conoce ese identificador, asi
//     que el campo era inutilizable en la practica. Ahora es un selector con los cierres de la
//     propia tienda, rotulados por su dia y su numero de movimientos.

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
  /**
   * Ficha 335 — el catalogo de cierres del selector, leido en el servidor. REQUERIDA y sin
   * default: la inyeccion la garantiza el compilador, no la buena voluntad de quien monte el
   * filtro manana.
   */
  cierres: CierresDeLaTienda;
}

export function MiWalletFiltros({
  onAplicar,
  onLimpiar,
  disabled = false,
  cierres,
}: MiWalletFiltrosProps) {
  const [draft, setDraft] = useState<MiWalletFiltrosValue>(FILTROS_TIENDA_VACIOS);

  function set<K extends keyof MiWalletFiltrosValue>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const opcionesCierre = opcionesDeCierre(cierres.opciones);
  const sinCierres = cierres.opciones.length === 0;

  /**
   * El texto corto de debajo del selector. Solo uno, y solo cuando hace falta: una barra de
   * filtros con una linea de ayuda permanente es ruido.
   *
   * NO lleva `role="note"`: la pantalla ya tiene exactamente UNO (el aviso de la tarjeta del
   * saldo) y se la busca en singular. Un segundo `note` no es mas accesible, es ambiguo.
   */
  const avisoCierres = !cierres.disponible
    ? "No pudimos cargar tus cierres. Probá recargando la página."
    : sinCierres
      ? "Todavía no hay cierres en tu wallet."
      : cierres.hayMas
        ? "Mostramos los cierres más recientes."
        : null;

  return (
    <form
      aria-label="Filtros del desglose"
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onAplicar(draft);
      }}
    >
      {/* Los dos `Select` ya dicen su nombre en el PLACEHOLDER («Todos los cierres», «Todos los
          conceptos»), que ademas informa mejor que el rotulo: dice que se esta viendo ahora, no
          como se llama el campo. Por eso el rotulo pasa a `sr-only` en vez de desaparecer.

          El `id` del `htmlFor` es REAL —la primitiva `Select` acepta `id` y aqui se le pasa—:
          es el defecto que `/wallet` documenta haber arreglado, y que no se repite. El nombre
          accesible del control lo sigue dando su `aria-label`, que tiene precedencia sobre la
          etiqueta nativa. */}
      <div className="flex w-full flex-col gap-1 sm:w-auto">
        <Label htmlFor="mi-wallet-filtro-cierre" className="sr-only">
          Cierre
        </Label>
        <Select
          id="mi-wallet-filtro-cierre"
          aria-label="Filtrar por cierre"
          value={draft.cierreId}
          onValueChange={(v) => set("cierreId", v)}
          options={opcionesCierre}
          placeholder="Todos los cierres"
          /* Sin cierres que ofrecer, el control no se esconde: se deshabilita y el texto de
             debajo dice por que. Un selector vacio y pulsable es una promesa incumplida. */
          disabled={disabled || sinCierres}
          className="h-9 w-full sm:w-72"
        />
        {avisoCierres ? (
          <span className="text-xs text-muted-foreground">{avisoCierres}</span>
        ) : null}
      </div>

      <Label htmlFor="mi-wallet-filtro-concepto" className="sr-only">
        Concepto
      </Label>
      <Select
        id="mi-wallet-filtro-concepto"
        aria-label="Filtrar por concepto"
        value={draft.categoria}
        onValueChange={(v) => set("categoria", v)}
        options={CATEGORIA_TIENDA_OPTIONS}
        placeholder="Todos los conceptos"
        disabled={disabled}
        className="h-9 w-full sm:w-56"
      />

      {/* Las dos fechas NO tienen placeholder que las nombre (`input[type=date]` pinta su
          propio `dd/mm/aaaa`), asi que conservan un rotulo CORTO y visible pegado al campo. Ese
          rotulo es tambien su nombre accesible: no se le superpone ningun `aria-label`, que
          taparia la palabra que se ve en pantalla con otra distinta. */}
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <Label
          htmlFor="mi-wallet-filtro-desde"
          className="shrink-0 text-xs font-normal text-muted-foreground"
        >
          Desde
        </Label>
        <Input
          id="mi-wallet-filtro-desde"
          type="date"
          value={draft.desde}
          onChange={(e) => set("desde", e.target.value)}
          disabled={disabled}
          className="h-9 w-full sm:w-40"
        />
      </div>

      <div className="flex w-full items-center gap-2 sm:w-auto">
        <Label
          htmlFor="mi-wallet-filtro-hasta"
          className="shrink-0 text-xs font-normal text-muted-foreground"
        >
          Hasta
        </Label>
        <Input
          id="mi-wallet-filtro-hasta"
          type="date"
          value={draft.hasta}
          onChange={(e) => set("hasta", e.target.value)}
          disabled={disabled}
          className="h-9 w-full sm:w-40"
        />
      </div>

      {/* `sm:ml-auto`: los dos botones se van al extremo derecho de la barra en cuanto hay
          ancho para una sola linea. En movil quedan al principio de su propia fila.

          «Limpiar» se queda en `outline` y no baja a `ghost`: la barra vive sobre un fondo
          tintado (`bg-muted/30`) y un boton sin borde ahi se lee como texto suelto. */}
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
