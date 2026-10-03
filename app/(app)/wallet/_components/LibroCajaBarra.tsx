"use client";

import { BuscadorFiltros } from "@/components/shared/BuscadorFiltros";
import { FilterComponent, type FilterSelection } from "@/components/shared/FilterComponent";
import { SegmentedToggle } from "@/components/shared/SegmentedToggle";
import { SelectorBuscable } from "@/components/shared/SelectorBuscable";
import { CONCEPTOS_FILTRO_AVISO, opcionesDeConceptos } from "@/components/shared/wallet/conceptos-filtro";
import { useConceptosConMovimientos } from "@/components/shared/wallet/use-conceptos-con-movimientos";
import { ORDEN_LIBRO, ZONA_LIBRO_TEXTO } from "@/components/shared/wallet/zonas-filtros-labels";
import { BUSQUEDA_LIBRO_MIN_CHARS } from "@/lib/config/libro-wallet";
import type { DireccionOrden } from "@/lib/types/ordenamiento-listado";
import type { WalletMovimientoTipo } from "@/lib/types/wallet";

import { A_QUIEN_FILTRO, A_QUIEN_SELECTOR_TEXTOS, valorDeAQuien } from "./a-quien-selector";
import { BUSCADOR_LIBRO_CAJA_PLACEHOLDER } from "./libro-caja-labels";
import { CASILLA, CASILLAS_CAJA, DECLARACION_PERIODO, declaracionesCaja, seleccionDeCaja } from "./libro-caja-filtros";
import { useQuienesDelLibroCaja } from "./use-quienes-del-libro-caja";
import { CATEGORIA_LABEL } from "./wallet-labels";
import type { FiltrosLibro, FiltrosWallet } from "./wallet-filtros-input";

// FICHA 467 (T5, design §2/§3.2; R1–R11, R17–R20, R23–R26, R29, R30, R32) — la BARRA ÚNICA del libro de
// la caja, igual que la de `/ordenes`: en la misma fila que «Descargar» y el botón de columnas (prop
// `filtros` de `DataTable`). Sustituye a las dos zonas de la 463 (la tarjeta de arriba con «Aplicar» y
// los controles sueltos del libro).
//
//  [↓↑ orden] [controles de las casillas marcadas…] [buscador — flex-1] [Filtros ▾] [Limpiar todo]
//
//  - El orden es un `SegmentedToggle soloIcono` (R4), el primer hijo: un sitio fijo.
//  - «Filtros» ofrece Periodo, A quién, Entra/Sale y Concepto (R6). Marcar una casilla monta su control
//    delante del buscador y no lee nada (R8); los controles siguen el orden de las casillas (R9).
//  - Periodo, Entra/Sale y Concepto son `FilterComponent`; «A quién» es `SelectorBuscable`, porque busca
//    en el servidor y el orquestador no sabe hacerlo (design §6.3). Para que «A quién» quede SEGUNDO
//    como su casilla (R9), el Periodo va en su propio orquestador, delante, y Entra/Sale y Concepto en
//    otro, detrás: los dos con la misma espera, la de siempre.
//  - Nada se deshabilita mientras se lee (R29): el módulo da turno a cada lectura y pinta la última.
//  - Ni lee ni escribe la URL (R30).
//
// La barra NO decide qué se relee: emite y el módulo (`WalletModule`) sabe que Periodo y «A quién»
// mueven las cifras y el libro (R12) y el resto, solo el libro (R13).

export interface LibroCajaBarraProps {
  /** La wallet APLICADA (la de las cifras): acota las opciones de «A quién» y de Concepto (R18/R20). */
  filtrosWallet: FiltrosWallet;
  /** El libro APLICADO: su dirección acota las opciones de Concepto (R20). */
  libroAplicado: FiltrosLibro;
  /**
   * Lo PEDIDO —lo último elegido, aplicado o en vuelo—: es lo que dicen los controles. Tras un fallo el
   * módulo lo devuelve a lo aplicado (R28).
   */
  pedido: { wallet: FiltrosWallet; libro: FiltrosLibro };
  /** Las casillas marcadas (controlado: el módulo las repone tras un fallo, R27/R28). */
  activos: string[];
  onActivos: (claves: string[]) => void;
  /** Lo emitido por el orquestador del Periodo (solo trae `periodo`). */
  onPeriodo: (seleccion: FilterSelection) => void;
  /** Lo emitido por el orquestador de Entra/Sale y Concepto (solo trae `tipo` y `categoria`). */
  onLibro: (seleccion: FilterSelection) => void;
  /** El `value` elegido en «A quién» (`null` = todos). */
  onAQuien: (valor: string | null) => void;
  onOrden: (sortDir: DireccionOrden) => void;
  onTermino: (termino: string) => void;
  /** R25 — «Limpiar todo»: término, valores y casillas fuera; el orden se queda. */
  onLimpiar: () => void;
  /**
   * R28 — sube cuando una lectura falla: los orquestadores reponen la selección de `pedido` (que el
   * módulo acaba de devolver a lo aplicado) sin emitir.
   */
  senalSiembra: number;
  /** R28 — el término que sigue aplicado, repuesto en el campo sin emitir. */
  siembraTermino?: { senal: number; termino: string };
}

/** Las claves de cada orquestador: el del Periodo y el de Entra/Sale y Concepto. */
const CLAVES_PERIODO = new Set<string>([CASILLA.periodo]);
const CLAVES_LIBRO = new Set<string>([CASILLA.direccion, CASILLA.concepto]);

function soloClaves(seleccion: FilterSelection, claves: ReadonlySet<string>): FilterSelection {
  return Object.fromEntries(Object.entries(seleccion).filter(([k]) => claves.has(k)));
}

export function LibroCajaBarra({
  filtrosWallet,
  libroAplicado,
  pedido,
  activos,
  onActivos,
  onPeriodo,
  onLibro,
  onAQuien,
  onOrden,
  onTermino,
  onLimpiar,
  senalSiembra,
  siembraTermino,
}: Readonly<LibroCajaBarraProps>) {
  const marcadas = new Set(activos);

  // R20: los conceptos del periodo y «A quién» APLICADOS y de la dirección aplicada, no del catálogo.
  const conceptos = useConceptosConMovimientos({
    libro: "caja",
    tipo: (libroAplicado.tipo || undefined) as WalletMovimientoTipo | undefined,
    desde: filtrosWallet.desde || undefined,
    hasta: filtrosWallet.hasta || undefined,
    aQuien: filtrosWallet.aQuien,
  });
  // R18 (458-E R59): las opciones de «A quién» son las del periodo APLICADO.
  const quienes = useQuienesDelLibroCaja({
    desde: filtrosWallet.desde || undefined,
    hasta: filtrosWallet.hasta || undefined,
  });

  // Sin la opción «Todas»: en el `single` la ausencia de valor ya es «todos» (lo dice el placeholder).
  // El elegido sigue ofrecido aunque su número pase a 0 (R20).
  const declaraciones = declaracionesCaja(opcionesDeConceptos(conceptos.conceptos, CATEGORIA_LABEL, pedido.libro.categoria));
  const montadasLibro = declaraciones.filter((d) => CLAVES_LIBRO.has(d.key) && marcadas.has(d.key));
  // R28 — lo que reponen los orquestadores al subir la señal (y con lo que arrancan si se montan de nuevo):
  // a cada uno, SOLO sus claves (el orquestador no descarta las ajenas de una siembra).
  const seleccion = seleccionDeCaja(pedido.wallet, pedido.libro);
  const siembraPeriodo = { senal: senalSiembra, seleccion: soloClaves(seleccion, CLAVES_PERIODO) };
  const siembraLibro = { senal: senalSiembra, seleccion: soloClaves(seleccion, CLAVES_LIBRO) };

  return (
    <BuscadorFiltros
      label={ZONA_LIBRO_TEXTO.buscar}
      placeholder={BUSCADOR_LIBRO_CAJA_PLACEHOLDER}
      minChars={BUSQUEDA_LIBRO_MIN_CHARS}
      leerDeUrl={false}
      siembra={siembraTermino}
      onChange={onTermino}
      filtros={CASILLAS_CAJA}
      activos={activos}
      onActivosChange={onActivos}
      onLimpiarTodo={onLimpiar}
      // R26 — «Limpiar todo» aparece con texto escrito (lo mira la barra) o con alguna casilla marcada.
      hayFiltrosAplicados={activos.length > 0}
    >
      <SegmentedToggle<DireccionOrden>
        options={ORDEN_LIBRO.opciones}
        valor={pedido.libro.sortDir}
        onChange={onOrden}
        ariaLabel={ORDEN_LIBRO.nombre}
        soloIcono
      />
      {marcadas.has(CASILLA.periodo) ? (
        <FilterComponent
          filters={[DECLARACION_PERIODO]}
          onChange={onPeriodo}
          leerDeUrl={false}
          siembra={siembraPeriodo}
        />
      ) : null}
      {marcadas.has(CASILLA.aQuien) ? (
        <SelectorBuscable
          id="wallet-filtro-a-quien"
          etiqueta={A_QUIEN_FILTRO.etiqueta}
          rotuloVisible
          opciones={quienes.opciones}
          valor={pedido.wallet.aQuien ? valorDeAQuien(pedido.wallet.aQuien) : null}
          onCambiar={onAQuien}
          onBuscar={quienes.buscar}
          estado={quienes.estado}
          hayMas={quienes.hayMas}
          textos={A_QUIEN_SELECTOR_TEXTOS}
          // R23 — la altura del buscador (`h-8`) y el ancho mínimo del `single` del orquestador.
          className="h-8 w-auto min-w-56"
        />
      ) : null}
      {montadasLibro.length > 0 ? (
        <FilterComponent filters={montadasLibro} onChange={onLibro} leerDeUrl={false} siembra={siembraLibro} />
      ) : null}
      {marcadas.has(CASILLA.concepto) && conceptos.error ? (
        <span className="text-xs text-destructive">{CONCEPTOS_FILTRO_AVISO.error}</span>
      ) : null}
    </BuscadorFiltros>
  );
}
