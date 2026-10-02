"use client";

import { Label } from "@/components/ui/label";
import { FilterComponent, type FilterDef, type FilterSelection } from "@/components/shared/FilterComponent";
import { SelectorBuscable } from "@/components/shared/SelectorBuscable";
import { ZONA_WALLET_TEXTO } from "@/components/shared/wallet/zonas-filtros-labels";

import { A_QUIEN_FILTRO, A_QUIEN_SELECTOR_TEXTOS, aQuienDeValor, valorDeAQuien } from "./a-quien-selector";
import { useQuienesDelLibroCaja } from "./use-quienes-del-libro-caja";
import type { FiltrosWallet } from "./wallet-filtros-input";

// FICHA 463 (T7, design §5.2; R1–R3, R8, R15–R20, R31) — la ZONA DE LA WALLET de la caja: el periodo y
// «A quién», ENCIMA de las cifras. Lo que se elige aquí mueve toda la wallet: resumen, composición,
// desglose, detalle de una fila de la composición y libro.
//
//  - El periodo es un `FilterComponent` en modo «Aplicar» (R15–R18): editar el calendario no lee nada;
//    «Aplicar» lee UNA vez; «Quitar periodo» vuelve a la caja sin periodo (R19).
//  - «A quién» se aplica al ELEGIRLO (R20): es una elección de una lista, no algo que se teclea y se
//    confirma. Sus opciones se leen con el periodo APLICADO, no con el que se está editando.
//  - Ni lee la URL ni la escribe (R31).

/** La clave del filtro de fechas dentro del orquestador. */
const CLAVE_PERIODO = "periodo";

const FILTROS: FilterDef[] = [{ key: CLAVE_PERIODO, label: ZONA_WALLET_TEXTO.periodo, kind: "dateRange" }];

/** El periodo aplicado como selección del orquestador (la terna `[atajo, desde, hasta]`). */
export function seleccionDePeriodo(desde: string, hasta: string): FilterSelection {
  return desde === "" && hasta === "" ? {} : { [CLAVE_PERIODO]: ["", desde, hasta] };
}

/** La selección emitida por el orquestador, de vuelta a `desde`/`hasta` (vacío = sin ese extremo). */
export function periodoDeSeleccion(seleccion: FilterSelection): { desde: string; hasta: string } {
  const [, desde = "", hasta = ""] = seleccion[CLAVE_PERIODO] ?? [];
  return { desde, hasta };
}

export interface WalletFiltrosCajaProps {
  /** Los filtros de la wallet APLICADOS (los que ya pintan las cifras). */
  aplicado: FiltrosWallet;
  /** Se emite al aplicar o quitar el periodo, y al elegir o quitar «A quién». */
  onCambiar: (siguiente: FiltrosWallet) => void;
  /**
   * R49 — si una lectura falla, el módulo REPONE en el control el periodo que sigue aplicado, para que
   * la pantalla no diga que hay puesto un periodo que las cifras no reflejan.
   */
  siembra?: { senal: number; seleccion: FilterSelection };
  /** Deshabilita los controles mientras corre una recarga de la wallet entera. */
  disabled?: boolean;
}

export function WalletFiltrosCaja({ aplicado, onCambiar, siembra, disabled = false }: Readonly<WalletFiltrosCajaProps>) {
  // R59 (458-E): las opciones de «A quién» son las del periodo APLICADO. Sin dirección: Entra/Sale es
  // de la zona del libro y no acota la wallet.
  const quienes = useQuienesDelLibroCaja({
    desde: aplicado.desde || undefined,
    hasta: aplicado.hasta || undefined,
  });

  function aplicarPeriodo(seleccion: FilterSelection) {
    const { desde, hasta } = periodoDeSeleccion(seleccion);
    onCambiar({ ...aplicado, desde, hasta });
  }

  function elegirAQuien(valor: string | null) {
    if (disabled) return;
    const aQuien = aQuienDeValor(valor);
    const siguiente: FiltrosWallet = { desde: aplicado.desde, hasta: aplicado.hasta };
    if (aQuien !== undefined) siguiente.aQuien = aQuien;
    onCambiar(siguiente);
  }

  return (
    <section
      aria-label={ZONA_WALLET_TEXTO.nombre}
      className="flex flex-col gap-2 rounded-xl border bg-muted/30 px-4 py-3"
    >
      <p className="text-xs text-muted-foreground">{ZONA_WALLET_TEXTO.alcance}</p>
      <div className="flex flex-wrap items-start gap-3">
        <FilterComponent
          filters={FILTROS}
          onChange={aplicarPeriodo}
          leerDeUrl={false}
          disabled={disabled}
          siembra={siembra}
          aplicarConBoton={{ etiqueta: ZONA_WALLET_TEXTO.aplicar, etiquetaQuitar: ZONA_WALLET_TEXTO.quitar }}
          className="items-start"
        />

        {/* FICHA 458-E (R59): «A quién», con búsqueda en el servidor por nombre de tienda, de mensajero
            o por el nombre anotado. */}
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Label htmlFor="wallet-filtro-a-quien" className="shrink-0 text-xs font-normal text-muted-foreground">
            {A_QUIEN_FILTRO.rotulo}
          </Label>
          <SelectorBuscable
            id="wallet-filtro-a-quien"
            etiqueta={A_QUIEN_FILTRO.etiqueta}
            opciones={quienes.opciones}
            valor={aplicado.aQuien ? valorDeAQuien(aplicado.aQuien) : null}
            onCambiar={elegirAQuien}
            onBuscar={quienes.buscar}
            estado={quienes.estado}
            hayMas={quienes.hayMas}
            textos={A_QUIEN_SELECTOR_TEXTOS}
            disabled={disabled}
            className="w-full sm:w-56"
          />
        </div>
      </div>
    </section>
  );
}
