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

// Feature 182 (T3.1-T3.3) — EL MODO AGREGADO, CABLEADO.
//
// Un panel de `porcentaje`/`segundos` dispara TRES consultas en la MISMA oleada (R11): la
// serie de la 126 y los dos granos del agregado de la 176 (`periodo` y `semana`). Los tres
// hooks son de primer nivel del mismo render: no hay un `await` de la serie antes de pedir
// el agregado, porque encadenarlas convertiria el panel mas lento en el doble de lento sin
// que nada avisara (es la mutacion que mide `TableroOperativoLatencia.test.tsx`).
//
// Los dos granos SIEMPRE, y no «el que haga falta» (Q2): saber de antemano si se excede el
// techo exigiria resolver el rango en el cliente, o sea una SEGUNDA definicion del techo, y
// dos definiciones se desincronizan solas.
//
// R8 — un `conteo` no pide el agregado: el borde responderia `validation_error` por
// contrato (`UNIDADES_AGREGABLES`), asi que seria una llamada que solo puede fallar. La
// unidad la DECLARA el catalogo de paneles, que es lo que permite decidirlo antes de la
// primera respuesta.
//
// R13 — las tres respuestas entran en la MISMA precedencia (`unauthenticated` > `forbidden`
// > `validation_error` > `ok`). Un agregado denegado no se degrada a «no hay cifra»: seria
// convertir un problema de permisos en un problema de negocio que no existe, que es el
// mismo pecado que R2 de la 131 persigue para la serie.

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import useSWR from "swr";

import { GraficaBarras } from "@/components/private/analytics/GraficaBarras";
import { GraficaDonut } from "@/components/private/analytics/GraficaDonut";
import { GraficaLineas } from "@/components/private/analytics/GraficaLineas";
import { KpiCard } from "@/components/private/analytics/KpiCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  consultarAgregadoOperativo,
  consultarAnaliticaOperativa,
} from "@/lib/actions/analitica-operativa";
import {
  esUnidadAgregable,
  type Cobertura,
  type CuboAgregado,
  type GranoAgregado,
  type ResultadoAgregado,
  type ResultadoOperativo,
} from "@/lib/types/analitica-operativa";

import { prepararPanel, type CubosDelPanel, type FuenteSerie, type PanelPreparado } from "./agregacion";
import { unidadDelPanel, type PanelTablero } from "./catalogo-paneles";
import { ExportarOperativoPanel } from "./ExportarOperativoPanel";
import { serializarFiltro, type FiltroTablero } from "./filtro-tablero";
import {
  TEXTO_ERROR_PANEL,
  TEXTO_GRANO_SERVIDOR,
  TEXTO_NOTA_SIN_GESTIONAR,
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
  TEXTO_SIN_GESTIONES,
  TITULO_FILTRO_INVALIDO,
  VACIO_PANEL,
  avisoRecorte,
  categoriaDePunto,
  etiquetaTotalPeriodo,
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

/**
 * Feature 182 (R11/R8) — las dos lecturas agregadas de un panel, por grano.
 *
 * Misma traduccion del filtro que la serie (`serializarFiltro`): no hay una segunda forma
 * de decir el mismo filtro que pueda divergir de la primera.
 */
async function consultarAgregadoPanel(
  panel: PanelTablero,
  filtro: FiltroTablero,
  grano: GranoAgregado,
): Promise<ResultadoAgregado[]> {
  const raw = JSON.parse(serializarFiltro(filtro)) as unknown;
  return Promise.all(
    panel.metricas.map((metrica) =>
      consultarAgregadoOperativo({
        metricaId: metrica.metricaId,
        raw,
        grano,
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
      /** Feature 182 — lo que el servidor agrego para este panel. Vacio en los conteos. */
      readonly cubos: CubosDelPanel;
    };

/** Cualquiera de las dos lecturas del borde: comparten los tres estados que no son `ok`. */
type RespuestaDelBorde = ResultadoOperativo | ResultadoAgregado;

type EstadoDenegado = Extract<
  EstadoPanel,
  { tipo: "unauthenticated" } | { tipo: "forbidden" } | { tipo: "validation_error" }
>;

/**
 * Feature 182 (R13) — LA PRECEDENCIA, en un solo sitio y para las tres lecturas.
 *
 * No es arbitraria: una sesion caida explica cualquier otra cosa, un denegado explica un
 * filtro raro, y solo cuando TODOS los resultados son `ok` hay algo que pintar. Que la
 * serie y el agregado la compartan es lo que impide que un `forbidden` del agregado se
 * lea como «este panel no tiene cifra».
 */
export function denegadoDe(resultados: readonly RespuestaDelBorde[]): EstadoDenegado | null {
  if (resultados.some((r) => r.status === "unauthenticated")) return { tipo: "unauthenticated" };
  if (resultados.some((r) => r.status === "forbidden")) return { tipo: "forbidden" };

  const invalido = resultados.find((r) => r.status === "validation_error");
  if (invalido && invalido.status === "validation_error") {
    return { tipo: "validation_error", fieldErrors: invalido.fieldErrors };
  }
  return null;
}

/** Los cubos de una respuesta agregada `ok`. Sin respuesta no hay cubos, y eso es carga. */
export function cubosDe(resultados: readonly ResultadoAgregado[] | undefined): CuboAgregado[] {
  return (resultados ?? []).flatMap((r) => (r.status === "ok" ? [...r.datos.cubos] : []));
}

/**
 * Reduce los N resultados del panel a UN estado visual.
 *
 * Punto de mutacion de R2: devolver aqui un `ok` con `puntos: []` para el denegado hace
 * caer el panel al `EmptyState` de la grafica, y entonces «no puedes verlo» y «no hubo
 * actividad» son el mismo pixel.
 */
export function reducirResultados(
  panel: PanelTablero,
  resultados: readonly ResultadoOperativo[],
  cubos: CubosDelPanel = {},
): EstadoPanel {
  const denegado = denegadoDe(resultados);
  if (denegado) return denegado;

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
  return { tipo: "ok", fuentes, cobertura, hayNota, cubos };
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

  // R8 — solo `porcentaje` y `segundos`. La unidad la declara el catalogo de paneles, y el
  // predicado es el MISMO del contrato del borde (`esUnidadAgregable`): una segunda lista
  // de unidades agregables en el cliente se desincronizaria de la del servidor.
  const pideAgregado = esUnidadAgregable(unidadDelPanel(panel));

  // R10/R11 — el grano entra en la CLAVE, junto al filtro: sin el, la cifra del filtro
  // anterior (o la del otro grano) sobreviviria a un cambio de filtro. Y las tres claves
  // comparten el prefijo `CLAVE_TABLERO`, con lo que el boton «Actualizar» las revalida
  // todas sin que la rejilla tenga que saber que existen.
  const periodo = useSWR(
    pideAgregado
      ? [CLAVE_TABLERO, panel.id, panel.desagregacion ?? "", filtroSerializado, "periodo"]
      : null,
    () => consultarAgregadoPanel(panel, filtro, "periodo"),
    { keepPreviousData: false, revalidateOnFocus: false },
  );

  const semana = useSWR(
    pideAgregado
      ? [CLAVE_TABLERO, panel.id, panel.desagregacion ?? "", filtroSerializado, "semana"]
      : null,
    () => consultarAgregadoPanel(panel, filtro, "semana"),
    { keepPreviousData: false, revalidateOnFocus: false },
  );

  const estado: EstadoPanel = useMemo(() => {
    if (error || periodo.error || semana.error) return { tipo: "error" };

    // R13 — LA MISMA precedencia para las tres lecturas, antes de mirar si falta alguna:
    // un denegado no espera a que lleguen las demas para decir lo que es.
    const denegado = denegadoDe([...(data ?? []), ...(periodo.data ?? []), ...(semana.data ?? [])]);
    if (denegado) return denegado;

    if (!data) return { tipo: "cargando" };
    // Mientras el agregado no ha llegado el panel esta EN CARGA: no hay ventana en la que
    // se pinte la serie sin su cifra, ni una serie diaria «casi completa» de un rango largo.
    if (pideAgregado && (periodo.data === undefined || semana.data === undefined)) {
      return { tipo: "cargando" };
    }

    return reducirResultados(panel, data, {
      periodo: cubosDe(periodo.data),
      semana: cubosDe(semana.data),
    });
  }, [data, error, panel, pideAgregado, periodo.data, periodo.error, semana.data, semana.error]);

  const cobertura = estado.tipo === "ok" ? estado.cobertura : null;
  const publicar = useCallback(
    (c: Cobertura | null) => reportarCobertura(panel.id, c),
    [reportarCobertura, panel.id],
  );
  useEffect(() => {
    publicar(cobertura);
  }, [publicar, cobertura]);

  // R3 — `prepararPanel` LANZA si le llega un rango largo de `porcentaje`/`segundos` sin
  // los cubos del servidor (antes que agregarlos en el cliente, que seria una media de
  // medias). Aqui esa condicion no deberia darse —el panel espera a los cubos—, y si se
  // diera igual se presenta con el pixel de error del panel: R24 de la 131 exige que un
  // panel roto no tumbe a los demas, y una excepcion en render tumbaria el tablero entero.
  const preparacion = useMemo<
    { readonly panel: PanelPreparado } | { readonly fallo: true } | null
  >(() => {
    if (estado.tipo !== "ok") return null;
    try {
      return {
        panel: prepararPanel(
          estado.fuentes,
          { grafica: panel.grafica, categoriaDePunto },
          estado.cubos,
        ),
      };
    } catch {
      return { fallo: true };
    }
  }, [estado, panel.grafica]);

  const preparado = preparacion !== null && "panel" in preparacion ? preparacion.panel : null;

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
  if (estado.tipo === "error" || (preparacion !== null && "fallo" in preparacion)) {
    // R24 — mensaje FIJO. Nunca `error.message`: puede arrastrar ids de orden, guias o
    // telefonos, y el filtro crudo puede arrastrar ids de mensajero.
    return <PanelConAviso titulo={panel.titulo} texto={TEXTO_ERROR_PANEL} />;
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
      {/* Feature 134 (R19/T4.2) — UNICA insercion del export: solo con el panel en `ok`.
          Se monta tambien con la serie vacia a proposito: quien avisa «no hay datos que
          descargar» sin producir archivo es el control (R17), y esconderlo aqui dejaria al
          usuario sin saber si no hay datos o si no puede descargarlos. */}
      {estado.tipo === "ok" ? <ExportarOperativoPanel panel={panel} filtro={filtro} /> : null}
      {preparado && (!preparado.vacio || preparado.total !== null) ? (
        <div className="flex flex-col gap-2">
          {preparado.total ? (
            <>
              <KpiCard
                etiqueta={etiquetaTotalPeriodo(panel.titulo)}
                valor={preparado.total.valor}
                unidad={preparado.unidad}
              />
              {/* R9/R6 — un total que incluye el dia en curso NO se presenta como cerrado. */}
              {preparado.total.parcial ? (
                <p className="text-xs text-muted-foreground">
                  {textoTotalParcial(preparado.total.corteAt)}
                </p>
              ) : null}
              {/* R7 — denominador cero: no hubo gestiones. No es un cero, y no es el vacio
                  de la metrica: son tres afirmaciones distintas con tres pixeles distintos. */}
              {preparado.total.sinGestiones ? (
                <p className="text-xs text-muted-foreground">{TEXTO_SIN_GESTIONES}</p>
              ) : null}
            </>
          ) : null}
          {/* R14/R16 — el grano usado se anuncia; nadie tiene que deducirlo del eje. Y se
              dice CUAL de los dos es: la semana que sumo el servidor no es la del cliente. */}
          {preparado.desdeCubos ? (
            <p className="text-xs text-muted-foreground">{TEXTO_GRANO_SERVIDOR}</p>
          ) : preparado.grano === "semana" ? (
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
