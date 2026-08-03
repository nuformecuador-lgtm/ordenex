"use client";

// Feature 131 (T2.1/T2.2) — la barra de filtros: el slot `filtros` del shell de la 129.
//
// Escribe el filtro en la URL (`router.replace`) y la rejilla de paneles lo lee de ahi
// (design §4.2): los dos slots del shell son HERMANOS y no hay envoltorio comun donde
// colgar un provider sin editar `AnaliticaShell.tsx`, que es de la 132. De paso el filtro
// queda compartible y recuperable al recargar.
//
// R22 — las opciones NO son un catalogo propio de esta feature: salen de las acciones que
// ya existen en el repo. Y si una de ellas falla o responde distinto de `ok`, su selector
// se queda DESHABILITADO y el resto de la pantalla sigue viva: el tablero no depende de
// que el catalogo de zonas conteste para poder pintar sus cifras.
//
// Controles reutilizados, no reinventados: `MultiSelectFilter` para las tres dimensiones y
// `DateRangeFilter` para el rango personalizado.

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";

import { DateRangeFilter } from "@/components/shared/DateRangeFilter";
import { MultiSelectFilter, type MultiSelectOption } from "@/components/shared/MultiSelectFilter";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { obtenerCatalogoFiltrosOrdenes } from "@/lib/actions/filtros-ordenes";
import { listarUsuariosPorRol } from "@/lib/actions/usuarios-por-rol";
import { RANGO_PRESETS, type RangoPreset } from "@/lib/analytics/types";

import {
  aSearchParams,
  desdeSearchParams,
  type FiltroTablero,
} from "./filtro-tablero";
import { TEXTO_FILTROS_DEGRADADOS } from "./textos";

/** Etiquetas de UI de los cuatro presets. El dominio cerrado lo declara la 135. */
const ETIQUETA_PRESET: Readonly<Record<RangoPreset, string>> = {
  dia: "Hoy",
  semana: "Esta semana",
  mes: "Ultimos 30 dias",
  personalizado: "Personalizado",
};

const OPCIONES_RANGO = RANGO_PRESETS.map((preset) => ({
  value: preset,
  label: ETIQUETA_PRESET[preset],
}));

export const ETIQUETA_RANGO = "Rango";
export const ETIQUETA_ZONA = "Zona";
export const ETIQUETA_TIENDA = "Tienda";
export const ETIQUETA_MENSAJERO = "Mensajero";
export const ETIQUETA_FECHAS = "Fechas del rango personalizado";

/**
 * R22 — el degradado, DECLARADO en vez de implicito.
 *
 * Cualquier resultado distinto de `ok` y cualquier EXCEPCION dan un `{ disponible: false }`
 * EXPLICITO, que es lo que la barra pinta: selector apagado MAS una frase que dice por que.
 *
 * Por que un resultado explicito y no dejar que la excepcion suba a SWR: si sube, SWR la
 * absorbe en su `error`, el selector se queda igual de apagado... y la pantalla no puede
 * distinguir «el catalogo dijo que no» de «todavia no ha contestado». El usuario se queda
 * con un control muerto y sin explicacion, y el tablero pierde la unica forma de decir en
 * voz alta que ese filtro esta fuera de servicio. Comprobado: la mutacion «propagar la
 * excepcion» era INDISTINGUIBLE hasta que el degradado se hizo visible.
 */
type Catalogo =
  | { readonly disponible: true; readonly zonas: MultiSelectOption[]; readonly tiendas: MultiSelectOption[] }
  | { readonly disponible: false };

type CatalogoMensajeros =
  | { readonly disponible: true; readonly mensajeros: MultiSelectOption[] }
  | { readonly disponible: false };

const NO_DISPONIBLE = { disponible: false } as const;

interface Opciones {
  readonly opciones: MultiSelectOption[];
  readonly disponible: boolean;
}

const SIN_OPCIONES: Opciones = { opciones: [], disponible: false };

async function cargarCatalogoOrdenes(): Promise<Catalogo> {
  try {
    const resultado = await obtenerCatalogoFiltrosOrdenes();
    if (resultado.status !== "ok") return NO_DISPONIBLE;
    return {
      disponible: true,
      zonas: resultado.catalogo.zonas.map((z) => ({ value: z.id, label: z.nombre })),
      tiendas: resultado.catalogo.tiendas.map((t) => ({ value: t.id, label: t.nombre })),
    };
  } catch {
    // R22 — se degrada, no se propaga: el tablero sigue vivo con este filtro apagado, y
    // ademas lo dice.
    return NO_DISPONIBLE;
  }
}

async function cargarMensajeros(): Promise<CatalogoMensajeros> {
  try {
    const resultado = await listarUsuariosPorRol("mensajero");
    if (resultado.status !== "ok") return NO_DISPONIBLE;
    return { disponible: true, mensajeros: resultado.usuarios.map((u) => ({ value: u.id, label: u.nombre })) };
  } catch {
    return NO_DISPONIBLE;
  }
}

export function FiltrosOperativos() {
  const router = useRouter();
  const params = useSearchParams();
  const filtro = useMemo(() => desdeSearchParams(params), [params]);

  const { data: catalogo } = useSWR("analitica-catalogo-ordenes", cargarCatalogoOrdenes, {
    revalidateOnFocus: false,
  });
  const { data: mensajeros } = useSWR("analitica-catalogo-mensajeros", cargarMensajeros, {
    revalidateOnFocus: false,
  });

  const zonas: Opciones =
    catalogo?.disponible === true ? { opciones: catalogo.zonas, disponible: true } : SIN_OPCIONES;
  const tiendas: Opciones =
    catalogo?.disponible === true ? { opciones: catalogo.tiendas, disponible: true } : SIN_OPCIONES;
  const opcionesMensajero: Opciones =
    mensajeros?.disponible === true
      ? { opciones: mensajeros.mensajeros, disponible: true }
      : SIN_OPCIONES;

  // R22 — «apagado porque el catalogo no contesto» es distinto de «todavia cargando», y el
  // usuario tiene derecho a saber cual de las dos esta mirando.
  const hayFiltroDegradado =
    catalogo?.disponible === false || mensajeros?.disponible === false;

  /**
   * R12 — escribir el filtro es lo unico que dispara la nueva consulta: la URL cambia, la
   * rejilla lee un filtro distinto, la clave SWR de cada panel cambia y todos vuelven a
   * consultar con el filtro NUEVO. No hay ningun camino por el que el resultado del filtro
   * anterior se quede en pantalla como si fuera del nuevo.
   */
  const escribir = useCallback(
    (siguiente: FiltroTablero) => {
      const query = aSearchParams(siguiente).toString();
      router.replace(query === "" ? "/analitica" : `/analitica?${query}`, { scroll: false });
    },
    [router],
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="analitica-rango">{ETIQUETA_RANGO}</Label>
        <Select
          id="analitica-rango"
          aria-label={ETIQUETA_RANGO}
          className="min-w-48"
          value={filtro.rango}
          options={OPCIONES_RANGO}
          onValueChange={(valor) =>
            escribir({ ...filtro, rango: (valor === "" ? filtro.rango : valor) as RangoPreset })
          }
        />
      </div>

      {/* R14 — el par de fechas solo se ofrece (y solo viaja) con `personalizado`. */}
      {filtro.rango === "personalizado" ? (
        <DateRangeFilter
          label={ETIQUETA_FECHAS}
          onChange={([, desde, hasta]) => escribir({ ...filtro, desde, hasta })}
        />
      ) : null}

      <MultiSelectFilter
        label={ETIQUETA_ZONA}
        options={zonas.opciones}
        value={[...filtro.zonaIds]}
        disabled={!zonas.disponible}
        onChange={(zonaIds) => escribir({ ...filtro, zonaIds })}
      />
      <MultiSelectFilter
        label={ETIQUETA_TIENDA}
        options={tiendas.opciones}
        value={[...filtro.tiendaIds]}
        disabled={!tiendas.disponible}
        onChange={(tiendaIds) => escribir({ ...filtro, tiendaIds })}
      />
      <MultiSelectFilter
        label={ETIQUETA_MENSAJERO}
        options={opcionesMensajero.opciones}
        value={[...filtro.mensajeroIds]}
        disabled={!opcionesMensajero.disponible}
        onChange={(mensajeroIds) => escribir({ ...filtro, mensajeroIds })}
      />

      {hayFiltroDegradado ? (
        <p role="note" className="w-full text-xs text-muted-foreground">
          {TEXTO_FILTROS_DEGRADADOS}
        </p>
      ) : null}
    </div>
  );
}
