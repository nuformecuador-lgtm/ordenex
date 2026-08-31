"use client";

import { BuscadorFiltros } from "@/components/shared/BuscadorFiltros";
import { FilterComponent } from "@/components/shared/FilterComponent";
import { Button } from "@/components/ui/button";

import {
  BUSQUEDA_MIN_CHARS_NOVEDADES,
  PLACEHOLDER_BUSQUEDA_NOVEDADES,
} from "./novedades-filtros";
import type { NovedadesFiltro } from "./useNovedadesFiltro";

// FICHA 325 — LA BARRA DE `/novedades`, con los componentes de la casa y sin variantes.
//
// Son los MISMOS dos de `/ordenes` y de las otras cinco superficies que ya los montan
// (`BuscadorFiltros` por fuera, `FilterComponent` dentro como `children`) y con el MISMO reparto:
// «Limpiar todo» lo pone la barra al final de la fila y no `FilterComponent` en medio, para que una
// sola accion se lleve por delante la busqueda Y los filtros.
//
// Aqui NO llega heredada de un `DataTable` —esta pantalla pinta cards, no tabla— asi que se monta a
// mano, exactamente igual que el `DescargarDatasetButton` que ya vive en este modulo por ese mismo
// motivo. Este componente es SOLO presentacion: todo el estado vive en `useNovedadesFiltro`.

/** Lo que se dice mientras el listado completo viaja. Region `status`: se anuncia al llegar. */
export const AVISO_CARGANDO =
  "Cargando todas tus órdenes de esta pestaña para poder buscar entre ellas…";

/** Lo que se dice cuando la lectura falla. No promete nada que no vaya a pasar. */
export const AVISO_ERROR =
  "No se pudo cargar el listado completo, así que la búsqueda no está acotando la lista.";

export const ETIQUETA_REINTENTAR = "Reintentar";

/**
 * Lo que se dice cuando el servidor devuelve `limite_excedido`: lleva el TOTAL y el TOPE, y manda
 * a la descarga, que es la via que si aguanta ese tamaño. Nunca se filtra un conjunto truncado.
 */
export function avisoLimite(total: number, limite: number): string {
  return `Tenés ${total} órdenes en esta pestaña y el máximo para buscar acá es ${limite}: la búsqueda no está acotando la lista. Descargá el listado y buscá en el archivo.`;
}

export interface NovedadesFiltrosBarraProps {
  filtro: NovedadesFiltro;
  /** Nombre accesible del campo de texto. Propio de cada pestaña: son dos barras distintas. */
  label: string;
  /** Nombre accesible de la REGIÓN que agrupa la barra. Idem. */
  regionLabel: string;
}

export function NovedadesFiltrosBarra({
  filtro,
  label,
  regionLabel,
}: NovedadesFiltrosBarraProps) {
  const aviso =
    filtro.estado === "cargando"
      ? AVISO_CARGANDO
      : filtro.estado === "excedido" && filtro.limite !== null
        ? avisoLimite(filtro.limite.total, filtro.limite.limite)
        : filtro.estado === "error"
          ? AVISO_ERROR
          : null;

  return (
    // REGION con nombre: las dos pestañas viven montadas a la vez (`keepMounted`), así que hay dos
    // barras en el árbol. Sin el nombre, quien navega por regiones —o por los dos campos de
    // búsqueda— no puede decir en cuál de las dos está.
    <section aria-label={regionLabel} className="flex flex-col gap-1">
      <BuscadorFiltros
        // Remonta la barra al limpiar: el campo de texto es estado INTERNO de `BuscadorFiltros` y
        // no se puede vaciar desde fuera, asi que se le cambia la `key`. Es el mismo gesto que
        // `/ordenes` usa con `FilterComponent`, aplicado tambien al campo para que «Limpiar todo»
        // —y el enlace del estado vacio— dejen la barra igual que recien abierta.
        key={filtro.reset}
        label={label}
        placeholder={PLACEHOLDER_BUSQUEDA_NOVEDADES}
        minChars={BUSQUEDA_MIN_CHARS_NOVEDADES}
        onChange={filtro.onTerminoChange}
        filtros={filtro.ofrecidos}
        activos={filtro.activos}
        onActivosChange={filtro.onActivosChange}
        onLimpiarTodo={filtro.limpiar}
        hayFiltrosAplicados={filtro.hayFiltrosAplicados}
      >
        {filtro.montados.length > 0 ? (
          <FilterComponent
            key={filtro.reset}
            filters={filtro.montados}
            onChange={filtro.onSeleccionChange}
          />
        ) : null}
      </BuscadorFiltros>

      {aviso === null ? null : (
        <p role="status" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{aviso}</span>
          {filtro.estado === "error" ? (
            <Button type="button" variant="outline" size="sm" onClick={filtro.reintentar}>
              {ETIQUETA_REINTENTAR}
            </Button>
          ) : null}
        </p>
      )}
    </section>
  );
}
