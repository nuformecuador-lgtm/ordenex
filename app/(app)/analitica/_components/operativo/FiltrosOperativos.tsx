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
// Feature 133 (T4.1) — SOLO EL TIPO. `import type` se borra en compilacion, asi que este
// modulo de cliente no arrastra `lib/analytics/presentacion` (ni su cierre transitivo:
// `alcance`, `metrics`, `@prisma/client`) al bundle del navegador. La DECISION de que
// facetas se ofrecen se toma en el servidor (`page.tsx`) y baja por prop como un array de
// strings; aqui solo se dibuja lo que se recibio.
import type { Faceta } from "@/lib/analytics/presentacion";

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

/**
 * Feature 133 (T4.1) — R14/R15/R16: QUE FACETAS SE DIBUJAN.
 *
 * Por defecto las TRES, para que este componente siga montandose sin props (los tests de
 * la 131 lo hacen, y `design.md §D6` lo fija como contrato). Quien recorta es el Server
 * Component: `page.tsx` pasa `recorteDePresentacion(actor).facetas`.
 *
 * NO se decide nada por rol aqui dentro: este archivo no sabe quien es el actor, y el
 * guardia de frontera de la 131 prohibe que lo sepa. Llega una lista de strings.
 */
const FACETAS_TODAS: readonly Faceta[] = ["zona", "tienda", "mensajero"];

export interface FiltrosOperativosProps {
  /** Las dimensiones cuyo selector DEBE dibujarse. Ausente = las tres. */
  readonly facetas?: readonly Faceta[];
}

export function FiltrosOperativos({ facetas = FACETAS_TODAS }: FiltrosOperativosProps = {}) {
  const router = useRouter();
  const params = useSearchParams();
  const filtro = useMemo(() => desdeSearchParams(params), [params]);

  // R16 — «no ofrecer es no dibujar». Una faceta ausente no aparece deshabilitada, ni
  // vacia, ni con la nota de degradado en su lugar.
  const ofreceZona = facetas.includes("zona");
  const ofreceTienda = facetas.includes("tienda");
  const ofreceMensajero = facetas.includes("mensajero");

  /**
   * R16, segunda consecuencia — NO SE PIDE UN CATALOGO CUYO SELECTOR NO SE DIBUJA.
   *
   * `useSWR` con clave `null` no dispara el fetcher (contrato de SWR: conditional
   * fetching). Motivos, los dos verificados:
   *
   *  (a) Es una peticion cuyo resultado nadie podria mirar: `FiltrosOrdenesService` y
   *      `UsuariosPorRolService` responden `forbidden` justo a los roles a los que esa
   *      faceta no se ofrece, asi que el unico efecto seria un `forbidden` auditado por
   *      pantalla cargada.
   *  (b) Si se pidiera igual, `disponible === false` encenderia la nota de degradado y el
   *      tablero anunciaria que «algun filtro no esta disponible» refiriendose a un
   *      control que NO EXISTE en la pantalla. Eso es el mismo control muerto que R16
   *      prohibe, servido en forma de texto en vez de en forma de selector.
   */
  const claveCatalogoOrdenes = ofreceZona || ofreceTienda ? "analitica-catalogo-ordenes" : null;
  const claveMensajeros = ofreceMensajero ? "analitica-catalogo-mensajeros" : null;

  const { data: catalogo } = useSWR(claveCatalogoOrdenes, cargarCatalogoOrdenes, {
    revalidateOnFocus: false,
  });
  const { data: mensajeros } = useSWR(claveMensajeros, cargarMensajeros, {
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
  //
  // R16 — pero solo se anuncia el degradado de un catalogo que alimenta a un selector
  // DIBUJADO. Un aviso sobre un filtro que el actor no tiene delante no le informa de
  // nada: le habla de un control que nunca vera.
  const hayFiltroDegradado =
    ((ofreceZona || ofreceTienda) && catalogo?.disponible === false) ||
    (ofreceMensajero && mensajeros?.disponible === false);

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

      {/* R14/R16 — la faceta que no se ofrece NO SE DIBUJA. Ni deshabilitada, ni vacia.
          R15 en particular: para un `adminTienda` el bloque «Mensajero» de abajo no llega
          a existir, y con el no llega a existir el desplegable que le serviria el nombre
          real y el uuid de cada mensajero (`UsuariosPorRolService.ts:15` SI le autoriza
          ese catalogo). R27 — eso NO cierra el oraculo residual contra R39 de la 122: el
          `mensajero_id` sigue viajando por la URL y por el argumento de la Server Action;
          la prohibicion efectiva es del BORDE. */}
      {ofreceZona ? (
        <MultiSelectFilter
          label={ETIQUETA_ZONA}
          options={zonas.opciones}
          value={[...filtro.zonaIds]}
          disabled={!zonas.disponible}
          onChange={(zonaIds) => escribir({ ...filtro, zonaIds })}
        />
      ) : null}
      {ofreceTienda ? (
        <MultiSelectFilter
          label={ETIQUETA_TIENDA}
          options={tiendas.opciones}
          value={[...filtro.tiendaIds]}
          disabled={!tiendas.disponible}
          onChange={(tiendaIds) => escribir({ ...filtro, tiendaIds })}
        />
      ) : null}
      {ofreceMensajero ? (
        <MultiSelectFilter
          label={ETIQUETA_MENSAJERO}
          options={opcionesMensajero.opciones}
          value={[...filtro.mensajeroIds]}
          disabled={!opcionesMensajero.disponible}
          onChange={(mensajeroIds) => escribir({ ...filtro, mensajeroIds })}
        />
      ) : null}

      {hayFiltroDegradado ? (
        <p role="note" className="w-full text-xs text-muted-foreground">
          {TEXTO_FILTROS_DEGRADADOS}
        </p>
      ) : null}
    </div>
  );
}
