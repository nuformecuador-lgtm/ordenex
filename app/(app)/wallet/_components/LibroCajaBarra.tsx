"use client";

import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { BuscadorFiltros } from "@/components/shared/BuscadorFiltros";
import { SegmentedToggle } from "@/components/shared/SegmentedToggle";
import { CONCEPTOS_FILTRO_AVISO, opcionesDeConceptos } from "@/components/shared/wallet/conceptos-filtro";
import { useConceptosConMovimientos } from "@/components/shared/wallet/use-conceptos-con-movimientos";
import { ORDEN_LIBRO, ZONA_LIBRO_TEXTO } from "@/components/shared/wallet/zonas-filtros-labels";
import { BUSQUEDA_LIBRO_MIN_CHARS } from "@/lib/config/libro-wallet";
import type { DireccionOrden } from "@/lib/types/ordenamiento-listado";
import type { WalletMovimientoTipo } from "@/lib/types/wallet";

import { BUSCADOR_LIBRO_CAJA_PLACEHOLDER, FILTRO_DIRECCION, type DireccionFiltro } from "./libro-caja-labels";
import { CATEGORIA_LABEL, CATEGORIA_TODAS_OPTION } from "./wallet-labels";
import { hayFiltrosDeLibro, type FiltrosLibro, type FiltrosWallet } from "./wallet-filtros-input";

// FICHA 463 (T7, design §5.2; R1, R2, R5, R9, R13, R23–R25, R29–R33) — la ZONA DEL LIBRO de la caja,
// encima de la tabla y en la misma línea que la descarga (`filtros` de `DataTable`, como `/ordenes`).
// Lo que se elige aquí filtra SOLO el libro y su descarga: las cifras de la wallet no se mueven (R9).
//
//  - El buscador es el CANÓNICO (`BuscadorFiltros`): mínimo de 3 caracteres con aviso (R24), su propia
//    espera antes de avisar, y el campo nunca se deshabilita mientras se lee (R32). No lee ni escribe
//    la URL (R31).
//  - El orden (R33) y Todo/Entra/Sale son conmutadores SIEMPRE a la vista, con texto.
//  - La categoría (R13) ofrece los conceptos con movimientos bajo el periodo y «A quién» APLICADOS y la
//    dirección vigente, cada uno con su número (458-A). Va a la vista y no detrás del selector
//    «Filtros»: es el único filtro de la barra y esconderlo costaría un clic sin ganar sitio.
//  - «Limpiar todo» vacía el término, la dirección y la categoría y NO toca el orden ni la zona de la
//    wallet (R30).

export interface LibroCajaBarraProps {
  /** La zona de la wallet APLICADA: acota las opciones de la categoría (R13). */
  filtrosWallet: FiltrosWallet;
  /** La zona del libro APLICADA. */
  valor: FiltrosLibro;
  /** Un cambio de UN control del libro: el módulo lo compone con lo vigente y relee solo el libro. */
  onCambiar: (cambio: Partial<FiltrosLibro>) => void;
  /** R30 — «Limpiar todo»: término, dirección y categoría fuera; el orden se queda. */
  onLimpiar: () => void;
  /**
   * Deshabilita la categoría mientras se relee. El buscador NUNCA (R32), y los conmutadores tampoco:
   * su clic se pide igual y el módulo, con sus turnos, pinta el último (revisión m1).
   */
  disabled?: boolean;
}

/** El `tipo` aplicado ↔ la opción del filtro segmentado («» = todo). */
function direccionDe(tipo: string): DireccionFiltro {
  return tipo === "ingreso" || tipo === "egreso" ? tipo : "todo";
}

export function LibroCajaBarra({ filtrosWallet, valor, onCambiar, onLimpiar, disabled = false }: Readonly<LibroCajaBarraProps>) {
  const tipo = (valor.tipo || undefined) as WalletMovimientoTipo | undefined;

  // R13: los conceptos del periodo y «A quién» APLICADOS y de la dirección vigente, no del catálogo.
  const conceptos = useConceptosConMovimientos({
    libro: "caja",
    tipo,
    desde: filtrosWallet.desde || undefined,
    hasta: filtrosWallet.hasta || undefined,
    aQuien: filtrosWallet.aQuien,
  });
  const opcionesCategoria = opcionesDeConceptos(
    conceptos.conceptos,
    CATEGORIA_LABEL,
    valor.categoria,
    CATEGORIA_TODAS_OPTION,
  );

  return (
    <section aria-label={ZONA_LIBRO_TEXTO.nombre} className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">{ZONA_LIBRO_TEXTO.alcance}</p>
      <BuscadorFiltros
        label={ZONA_LIBRO_TEXTO.buscar}
        placeholder={BUSCADOR_LIBRO_CAJA_PLACEHOLDER}
        minChars={BUSQUEDA_LIBRO_MIN_CHARS}
        leerDeUrl={false}
        onChange={(termino) => onCambiar({ termino })}
        onLimpiarTodo={onLimpiar}
        hayFiltrosAplicados={hayFiltrosDeLibro(valor)}
      >
        <SegmentedToggle<DireccionOrden>
          options={ORDEN_LIBRO.opciones}
          valor={valor.sortDir}
          // Revisión m1: un clic mientras se lee NO se ignora. El módulo lo compone con lo PEDIDO y
          // le da turno propio (`turnoLibro`): se pinta la última lectura pedida, no la primera.
          onChange={(sortDir) => onCambiar({ sortDir })}
          ariaLabel={ORDEN_LIBRO.nombre}
        />
        {/* FICHA 458-E (R54): Todo / Entra / Sale. Mismo `tipo` del borde de siempre. */}
        <SegmentedToggle
          options={FILTRO_DIRECCION.opciones}
          valor={direccionDe(valor.tipo)}
          onChange={(d) => onCambiar({ tipo: d === "todo" ? "" : d })}
          ariaLabel={FILTRO_DIRECCION.nombre}
        />
        <Label htmlFor="wallet-filtro-categoria" className="sr-only">
          Categoría
        </Label>
        <Select
          id="wallet-filtro-categoria"
          aria-label="Filtrar por categoría"
          value={valor.categoria}
          onValueChange={(v) => {
            if (v !== valor.categoria) onCambiar({ categoria: v });
          }}
          options={opcionesCategoria}
          placeholder={CATEGORIA_TODAS_OPTION.label}
          disabled={disabled}
          className="h-8 w-full sm:w-56"
        />
        {conceptos.error ? <span className="text-xs text-destructive">{CONCEPTOS_FILTRO_AVISO.error}</span> : null}
      </BuscadorFiltros>
    </section>
  );
}
