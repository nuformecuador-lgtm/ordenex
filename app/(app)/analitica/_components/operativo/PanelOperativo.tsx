"use client";

// Feature 131 (T3.1/T3.3) — UN panel del tablero operativo.
//
// R1 — TODA cifra de este panel sale de la Server Action `consultarAnaliticaOperativa`
// (126) y de ninguna otra puerta: ni servicio, ni repositorio, ni Prisma, ni una ruta
// `app/api`. R10 — y lo que llega se pinta TAL CUAL: aqui no se filtra por permiso, no se
// reordena por rol y no se intenta deshacer la seudonimizacion. El alcance ya lo aplico el
// servidor (`prepararConsultaAnalitica` interseca el filtro ANTES de tocar la base) y el
// uuid real del mensajero no cruza la frontera.
//
// R2/R3/R4/R24 — «prohibido», «filtro invalido», «sesion no valida», «se rompio» y «no hay
// datos» son CINCO estados distintos con CINCO pixeles distintos. Meter `forbidden` en el
// vacio de la grafica convierte un problema de permisos en un problema de negocio que no
// existe: el vacio de una grafica habla de la metrica sin datos EN EL RANGO
// (`components/private/analytics/tipos.ts:51-57`).
//
// R24 — cada panel tiene su propio estado SWR y su propia frontera de error: un panel que
// lanza no tumba a los demas. No hay un `Promise.all` del tablero entero cuyo rechazo se
// propague hacia arriba.

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import useSWR from "swr";

import { GraficaBarras } from "@/components/private/analytics/GraficaBarras";
import { GraficaDonut } from "@/components/private/analytics/GraficaDonut";
import { GraficaLineas } from "@/components/private/analytics/GraficaLineas";
import { KpiCard } from "@/components/private/analytics/KpiCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { consultarAnaliticaOperativa } from "@/lib/actions/analitica-operativa";
import type { Cobertura, ResultadoOperativo } from "@/lib/types/analitica-operativa";

import { prepararPanel, type FuenteSerie } from "./agregacion";
import type { PanelTablero } from "./catalogo-paneles";
import { serializarFiltro, type FiltroTablero } from "./filtro-tablero";
import {
  TEXTO_ERROR_PANEL,
  TEXTO_NOTA_SIN_GESTIONAR,
  TEXTO_PROHIBIDO,
  TEXTO_RANGO_EXCEDIDO,
  TEXTO_SESION_NO_VALIDA,
  TITULO_FILTRO_INVALIDO,
  TITULO_RANGO_EXCEDIDO,
  VACIO_PANEL,
  avisoRecorte,
  categoriaDePunto,
  lineasDeValidacion,
  textoGrano,
  textoOtros,
  textoTotalParcial,
} from "./textos";

/** Prefijo comun de todas las claves SWR del tablero: lo usa el boton «Actualizar» (R23). */
export const CLAVE_TABLERO = "analitica-operativa";

/* -------------------------------------------------------------------------- */
/* D1 — la cobertura se anuncia UNA sola vez, para todo el tablero             */
/* -------------------------------------------------------------------------- */

/**
 * Cada panel publica hacia arriba la `cobertura` que recibio; la rejilla pinta UN aviso
 * (D1). Una nota al pie por grafica repetiria el mismo texto seis veces hasta volverlo
 * invisible, que es justo lo que la decision descarto.
 *
 * Vive aqui y no en `PanelesOperativos.tsx` para no crear un ciclo de imports: la rejilla
 * importa el panel, nunca al reves.
 */
export type ReportarCobertura = (panelId: string, cobertura: Cobertura | null) => void;

const CoberturaContexto = createContext<ReportarCobertura>(() => {});

export const CoberturaProvider = CoberturaContexto.Provider;

/* -------------------------------------------------------------------------- */
/* Consulta                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * D4 — una llamada POR METRICA, disparadas juntas desde la clave SWR del panel. La Server
 * Action compuesta esta descartada por el humano: pondria a una feature de zona
 * `frontend` a escribir en `lib/actions/`, que es justo donde la 128 va a colgar su cache.
 */
async function consultarPanel(
  panel: PanelTablero,
  filtro: FiltroTablero,
): Promise<ResultadoOperativo[]> {
  const raw = JSON.parse(serializarFiltro(filtro)) as unknown;
  return Promise.all(
    panel.metricas.map((metrica) =>
      consultarAnaliticaOperativa({
        metricaId: metrica.metricaId,
        raw,
        ...(panel.desagregacion ? { desagregacion: panel.desagregacion } : {}),
      }),
    ),
  );
}

type EstadoPanel =
  | { readonly tipo: "cargando" }
  | { readonly tipo: "error" }
  | { readonly tipo: "forbidden" }
  | { readonly tipo: "unauthenticated" }
  | { readonly tipo: "validation_error"; readonly fieldErrors: Record<string, string[]> }
  | {
      readonly tipo: "ok";
      readonly fuentes: FuenteSerie[];
      readonly cobertura: Cobertura;
      readonly hayNota: boolean;
    };

/**
 * Reduce los N resultados del panel a UN estado visual. La precedencia no es arbitraria:
 * una sesion caida explica cualquier otra cosa, un denegado explica un filtro raro, y solo
 * cuando TODOS los resultados son `ok` hay algo que pintar.
 *
 * Punto de mutacion de R2: devolver aqui un `ok` con `puntos: []` para el denegado hace
 * caer el panel al `EmptyState` de la grafica, y entonces «no puedes verlo» y «no hubo
 * actividad» son el mismo pixel.
 */
export function reducirResultados(
  panel: PanelTablero,
  resultados: readonly ResultadoOperativo[],
): EstadoPanel {
  if (resultados.some((r) => r.status === "unauthenticated")) return { tipo: "unauthenticated" };
  if (resultados.some((r) => r.status === "forbidden")) return { tipo: "forbidden" };

  const invalido = resultados.find((r) => r.status === "validation_error");
  if (invalido && invalido.status === "validation_error") {
    return { tipo: "validation_error", fieldErrors: invalido.fieldErrors };
  }

  const fuentes: FuenteSerie[] = [];
  let cobertura: Cobertura | null = null;
  let hayNota = false;
  resultados.forEach((resultado, indice) => {
    if (resultado.status !== "ok") return;
    const metrica = panel.metricas[indice];
    fuentes.push({ etiqueta: metrica?.etiqueta ?? resultado.datos.metricaId, serie: resultado.datos });
    cobertura ??= resultado.datos.cobertura;
    if (resultado.datos.nota !== undefined) hayNota = true;
  });

  // `cobertura` es OBLIGATORIA en toda respuesta `ok` (su tipo se declara sin `?`), asi
  // que solo falta si no hubo ni un `ok`.
  if (cobertura === null) return { tipo: "cargando" };
  return { tipo: "ok", fuentes, cobertura, hayNota };
}

/* -------------------------------------------------------------------------- */
/* El componente                                                               */
/* -------------------------------------------------------------------------- */

export interface PanelOperativoProps {
  readonly panel: PanelTablero;
  readonly filtro: FiltroTablero;
}

export function PanelOperativo({ panel, filtro }: PanelOperativoProps) {
  const reportarCobertura = useContext(CoberturaContexto);
  const filtroSerializado = serializarFiltro(filtro);

  // R12 — el filtro ESTA en la clave: cambiarlo cambia la clave y SWR vuelve a consultar.
  // Sacarlo de aqui dejaria en pantalla el resultado del filtro anterior como si
  // correspondiera al nuevo, que es exactamente lo que R12 prohibe.
  const { data, error, isLoading } = useSWR(
    [CLAVE_TABLERO, panel.id, panel.desagregacion ?? "", filtroSerializado],
    () => consultarPanel(panel, filtro),
    { keepPreviousData: false, revalidateOnFocus: false },
  );

  const estado: EstadoPanel = useMemo(() => {
    if (error) return { tipo: "error" };
    if (!data) return { tipo: "cargando" };
    return reducirResultados(panel, data);
  }, [data, error, panel]);

  const cobertura = estado.tipo === "ok" ? estado.cobertura : null;
  const publicar = useCallback(
    (c: Cobertura | null) => reportarCobertura(panel.id, c),
    [reportarCobertura, panel.id],
  );
  useEffect(() => {
    publicar(cobertura);
  }, [publicar, cobertura]);

  const preparado = useMemo(
    () =>
      estado.tipo === "ok"
        ? prepararPanel(estado.fuentes, { grafica: panel.grafica, categoriaDePunto })
        : null,
    [estado, panel.grafica],
  );

  /* --- Los cuatro estados que NO son «sin datos» (R2, R3, R4, R24) --------- */

  if (estado.tipo === "forbidden") {
    return <PanelConAviso titulo={panel.titulo} texto={TEXTO_PROHIBIDO} />;
  }
  if (estado.tipo === "unauthenticated") {
    // R4 — texto DISTINTO al de prohibido: «no puedes» y «no sabemos quien eres» piden
    // cosas distintas del usuario.
    return <PanelConAviso titulo={panel.titulo} texto={TEXTO_SESION_NO_VALIDA} />;
  }
  if (estado.tipo === "validation_error") {
    return (
      <PanelConAviso
        titulo={panel.titulo}
        encabezado={TITULO_FILTRO_INVALIDO}
        lineas={lineasDeValidacion(estado.fieldErrors)}
      />
    );
  }
  if (estado.tipo === "error") {
    // R24 — mensaje FIJO. Nunca `error.message`: puede arrastrar ids de orden, guias o
    // telefonos, y el filtro crudo puede arrastrar ids de mensajero.
    return <PanelConAviso titulo={panel.titulo} texto={TEXTO_ERROR_PANEL} />;
  }

  /* --- R27/D3: el hueco declarado, sin ninguna cifra ----------------------- */

  if (preparado?.modo === "rango_excedido") {
    return (
      <PanelConAviso
        titulo={panel.titulo}
        encabezado={TITULO_RANGO_EXCEDIDO}
        texto={TEXTO_RANGO_EXCEDIDO}
      />
    );
  }

  /* --- Datos ---------------------------------------------------------------- */

  const Grafica =
    panel.grafica === "donut" ? GraficaDonut : panel.grafica === "barras" ? GraficaBarras : GraficaLineas;

  return (
    <div className="flex w-full flex-col gap-2">
      <Grafica
        titulo={panel.titulo}
        series={preparado?.series ?? []}
        unidad={preparado?.unidad ?? "conteo"}
        vacio={{ titulo: VACIO_PANEL.titulo, descripcion: VACIO_PANEL.descripcion }}
        avisoRecorte={avisoRecorte}
        cargando={isLoading || estado.tipo === "cargando"}
      />
      {preparado && !preparado.vacio ? (
        <div className="flex flex-col gap-2">
          {preparado.total ? (
            <>
              <KpiCard
                etiqueta={`${panel.titulo} · total del periodo`}
                valor={preparado.total.valor}
                unidad={preparado.unidad}
              />
              {/* R9/D2 — un total que incluye el dia en curso NO se presenta como cerrado. */}
              {preparado.total.parcial ? (
                <p className="text-xs text-muted-foreground">
                  {textoTotalParcial(preparado.total.corteAt)}
                </p>
              ) : null}
            </>
          ) : null}
          {/* R16 — el grano usado se anuncia; nadie tiene que deducirlo del eje. */}
          {preparado.grano === "semana" ? (
            <p className="text-xs text-muted-foreground">{textoGrano(preparado.grano)}</p>
          ) : null}
          {/* R15 — cuantas categorias se fundieron en «otros». */}
          {preparado.categoriasAgrupadas > 0 ? (
            <p className="text-xs text-muted-foreground">
              {textoOtros(preparado.categoriasAgrupadas)}
            </p>
          ) : null}
          {estado.tipo === "ok" && estado.hayNota ? (
            <p className="text-xs text-muted-foreground">{TEXTO_NOTA_SIN_GESTIONAR}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Panel SIN grafica: solo su nombre accesible y el aviso. Deliberadamente no monta
 * `GraficaMarco` — montarla pintaria el eje y el estado vacio, que es lo que R2 prohibe.
 */
function PanelConAviso({
  titulo,
  encabezado,
  texto,
  lineas,
}: {
  readonly titulo: string;
  readonly encabezado?: string;
  readonly texto?: string;
  readonly lineas?: readonly string[];
}) {
  return (
    <section aria-label={titulo} className="flex w-full flex-col gap-2">
      <h3 className="text-sm font-medium text-foreground">{titulo}</h3>
      {/* `Alert` ya declara `role="alert"` (components/ui/alert.tsx). */}
      <Alert variant="destructive">
        {encabezado ? <AlertTitle>{encabezado}</AlertTitle> : null}
        <AlertDescription>
          {texto ? <span>{texto}</span> : null}
          {lineas ? (
            <ul>
              {lineas.map((linea) => (
                <li key={linea}>{linea}</li>
              ))}
            </ul>
          ) : null}
        </AlertDescription>
      </Alert>
    </section>
  );
}
