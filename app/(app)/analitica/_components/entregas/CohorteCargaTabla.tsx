"use client";

// FICHA 411 (B7/T7.1) — LA COHORTE DE CARGA: que paso con las ordenes que entraron cada dia.
//
// Contesta «de las N ordenes que CARGUE el lunes, cuantas se entregaron, cuantas se devolvieron,
// cuantas siguen vivas y en cuantos dias». Es la octava lectura de la seccion de entregas y
// comparte con las otras siete todo lo que se puede compartir: el mismo filtro
// (`FiltroEntregasProvider`), el mismo prefijo de clave SWR —asi el boton «Actualizar» la
// revalida sin conocerla—, los mismos cuatro textos de error y la misma regla de que un problema
// de permisos NO se degrada a una tabla vacia.
//
// ⚠ NO ES LA MISMA PREGUNTA QUE LAS DE ARRIBA, y conviene tenerlo claro al leer la pantalla: el
// anillo y el desglose por estado reparten las ordenes por su DESENLACE con la ventana sobre la
// fecha efectiva; el KPI de ciclo de vida pone la ventana sobre el CIERRE («de lo que cerro esta
// semana, cuanto tardo»). Esta tabla pone la ventana sobre la CARGA y sigue cada orden hasta su
// desenlace, caiga donde caiga en el tiempo. Por eso sus totales pueden no coincidir con los de
// las otras secciones para el mismo filtro: son universos distintos sobre el mismo recorte, no un
// descuadre.
//
// ─── LAS CINCO COSAS QUE ESTE COMPONENTE NO HACE, Y CADA UNA POR SU MOTIVO ──────────────────
//
//  1. **No reordena `porDia`.** Llega DESCENDENTE (la cohorte mas reciente primero) y ese orden
//     es contrato del `ORDER BY` del repositorio. Diverge a proposito de `CargadasPorDiaBarras`,
//     que es ascendente porque pinta un eje temporal; esta es una tabla que se lee de arriba
//     abajo. Una serie con dos criterios de orden —uno en la base y otro aqui— acaba pintandose
//     distinto segun quien la toque al final.
//  2. **No rellena con nada que no sea 0.** Los cubos con `n = 0` NO viajan (contrato del DTO):
//     un hueco significa cero, y esta pantalla —que si conoce los cuatro cubos— los rellena con
//     CERO para poder dibujar sus columnas. Rellenar un cubo ausente con cualquier otra cosa
//     produce una cohorte con numeros plausibles y equivocados, que es el modo de fallo de esta
//     ficha: no rompe nada visible.
//  3. **No omite la columna `Vivas`, ni siquiera cuando vale 0.** Sin ella la tabla MIENTE POR
//     OMISION: diria «12 entregadas de 40» y callaria que 25 siguen en la calle. Ver
//     `ETIQUETA_CUBO`.
//  4. **No escribe un promedio sin su `n`.** El denominador va PEGADO a la cifra con el modulo
//     unico de base de KPI (`base-del-kpi.ts`): «1,2 dias» en una cohorte joven es una cifra
//     sobre las tres faciles que ya cerraron.
//  5. **No decide por su cuenta que no hay rango.** Aunque el filtro venga vacio, SIEMPRE
//     pregunta a la Server Action. Cortocircuitar aqui convertiria la invitacion en una sonda de
//     permisos: un `mensajero` —que no puede leer esta seccion— veria «elige un periodo» y
//     averiguaria por el texto que la seccion existe. La denegacion PRECEDE a la invitacion, y
//     eso se decide en el borde, no en la pantalla.
//
// ─── LA UNICA PUERTA A LOS DATOS ES `consultarCohorteCarga` ─────────────────────────────────
//
// Ni servicio, ni repositorio, ni Prisma, ni una ruta bajo `app/api/`. Lo vigila
// `tests/unit/analytics/cohorte-frontera.guardia.test.ts` con su caso discriminante.

import { useMemo } from "react";
import { CalendarDays, PackageSearch } from "lucide-react";
import useSWR from "swr";

import { serializarFiltroEntregas } from "@/app/(app)/_components/entregas-filtro-analitica";
import { useFiltroEntregas } from "@/app/(app)/_components/filtro-entregas";
import { formatearValor } from "@/components/private/analytics/formato";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { consultarCohorteCarga } from "@/lib/actions/cohorte-carga";
import { monedaConfig, SIN_MONTO } from "@/lib/config/moneda";
import type {
  CohorteDeDia,
  CohorteDesenlace,
  ResultadoCohorteCarga,
} from "@/lib/types/cohorte-carga";
import { ESTADOS_TERMINALES } from "@/lib/types/order-status-transiciones";

import {
  TEXTO_ERROR_PANEL,
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
  TITULO_FILTRO_INVALIDO,
} from "../operativo/textos";
import { CLAVE_TABLERO } from "../operativo/PanelOperativo";

import { textoSello, textoSelloCompleto } from "./ActualizarAnalitica";
import { contarOrdenes, ORDENES, ORDENES_CERRADAS, rotuloConBase } from "./base-del-kpi";

/* -------------------------------------------------------------------------- */
/* Textos                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * TODOS los textos de esta seccion, en un solo objeto y fuera del JSX: es lo que la deja lista
 * para i18n sin volver a tocar el arbol de componentes.
 */
export const COHORTE_TEXTOS = {
  tabla: "Cohortes de carga, de la mas reciente a la mas antigua",
  columnaFecha: "Fecha de carga",
  columnaCargadas: "Cargadas",
  /** El reloj de la cohorte, y por eso la columna dice DIAS y no horas. Ver `formatearDias`. */
  columnaDias: "Días hasta entregar",
  /**
   * R24 — LA ADVERTENCIA QUE NO PUEDE FALTAR, y va junto al titulo, no en un tooltip.
   *
   * Una orden no la carga un mensajero, asi que esta lectura NO se recorta por esa faceta
   * mientras las demas secciones si. Sin la frase, quien tenga un mensajero puesto lee esta
   * tabla creyendo que habla de EL.
   */
  avisoMensajero:
    "Esta sección no responde al filtro de mensajero: una orden no la carga un mensajero, así que las cohortes se calculan sin ese recorte. Las demás secciones de arriba sí lo aplican.",
  /** R39 — el estado que no es ni dato ni error: aun no se ha elegido periodo. */
  invitacionTitulo: "Elige un periodo para ver las cohortes",
  invitacionDescripcion:
    "Esta tabla sigue las órdenes que entraron cada día, así que necesita un rango de fechas. Elígelo en el filtro de arriba.",
  vacioTitulo: "Ningún día con órdenes cargadas",
  vacioDescripcion:
    "En el periodo elegido no entró ninguna orden con el filtro seleccionado.",
  /**
   * El total del recorte. Se llama `cargadasDelPeriodo` y NO `universo` a proposito: ese nombre
   * es un campo del catalogo de metricas (`DefinicionMetrica.universo`) y
   * `catalogo-produccion.guardia` censa en todo `app/` quien lo LEE, porque ninguna cifra de
   * produccion puede depender de el. Un texto que se llamara igual da rojo en ese censo — con
   * razon, porque el detector no puede distinguir un campo del catalogo de una clave homonima.
   */
  cargadasDelPeriodo: (base: string) => `Cargadas en el periodo: ${base}.`,
  entregadas: (rotulo: string) => `${rotulo}.`,
} as const;

/* -------------------------------------------------------------------------- */
/* Los cubos: los del dominio, no una segunda lista                            */
/* -------------------------------------------------------------------------- */

/**
 * Las columnas de desenlace, EN ESTE ORDEN: los terminales del dominio y, al final, el cubo de
 * las que no han cerrado.
 *
 * DERIVADO de `ESTADOS_TERMINALES` y no escrito a mano, igual que el tipo `CohorteDesenlace`: el
 * dia que el dominio de de alta un cuarto terminal, la tabla gana su columna sola en vez de
 * quedarse callando un cubo que si viaja en el DTO — y una columna que falta es exactamente
 * como esta tabla puede mentir sin que nada se ponga rojo.
 */
const CUBOS: readonly CohorteDesenlace[] = [...ESTADOS_TERMINALES, "viva"];

/**
 * El rotulo de cada cubo, escrito a mano y EXHAUSTIVO por tipo.
 *
 * `Record<CohorteDesenlace, string>` y no `Partial<...>`: un cuarto estado terminal deja este
 * objeto incompleto y **no compila** hasta que alguien escriba su etiqueta. Es deliberado —
 * derivar el texto de `value` daria «Devuelta_a_tiendas», y una etiqueta automatica mala se
 * queda en pantalla para siempre porque nadie la revisa.
 */
const ETIQUETA_CUBO: Record<CohorteDesenlace, string> = {
  entregada: "Entregadas",
  devuelta_a_tienda: "Devueltas",
  incidente: "Incidentes",
  /** R32 — columna, no nota al pie: es la medida exacta de lo que la cohorte aun no sabe. */
  viva: "Vivas",
};

/**
 * El cubo cuyo reloj se escribe en la columna de dias.
 *
 * Tipado como `CohorteDesenlace`, asi que si el dominio dejara de tener este estado terminal
 * esto no compilaria en vez de quedarse buscando un cubo que ya no llega.
 */
const CUBO_DEL_RELOJ: CohorteDesenlace = "entregada";

/* -------------------------------------------------------------------------- */
/* Formato                                                                     */
/* -------------------------------------------------------------------------- */

const SEGUNDOS_POR_DIA = 86_400;

/**
 * Los segundos crudos del DTO puestos en DIAS, que es la unidad de una cohorte.
 *
 * No se usa `formatearValor(_, "segundos")` —el formateador comun de la analitica— porque su
 * magnitud maxima es la HORA: una cohorte de dos dias saldria «48 h» bajo una columna que dice
 * «Días». Ni un literal de idioma: la unidad la nombra `Intl` y el locale sale de
 * `monedaConfig.locale`, exactamente como hacen `formato.ts` y el sello de `ActualizarAnalitica`.
 */
function formatearDias(segundos: number): string {
  return new Intl.NumberFormat(monedaConfig.locale, {
    style: "unit",
    unit: "day",
    unitDisplay: "long",
    maximumFractionDigits: 1,
  }).format(segundos / SEGUNDOS_POR_DIA);
}

/**
 * El promedio de dias CON SU DENOMINADOR dentro, que es la unica forma que esta pantalla admite
 * de escribir una media (R33 · `base-del-kpi.ts`).
 *
 * Con `n = 0` la cifra es AUSENTE y no cero —cero dias afirmaria que se cerraron al instante— y
 * la base SI se escribe: «(0 órdenes cerradas)» es justo lo que explica el guion de al lado.
 */
export function textoDiasHastaEntregar(promedioSegundos: number | null, n: number): string {
  const cifra = promedioSegundos === null ? SIN_MONTO : formatearDias(promedioSegundos);
  return rotuloConBase(cifra, contarOrdenes(n, ORDENES_CERRADAS));
}

/* -------------------------------------------------------------------------- */
/* De DTO a filas                                                              */
/* -------------------------------------------------------------------------- */

/** Una fila de la tabla: la cohorte de un dia con sus cuatro cubos ya rellenos. */
export interface FilaCohorte {
  /** `YYYY-MM-DD` de Costa Rica, TAL CUAL llega. */
  readonly fecha: string;
  readonly cargadas: number;
  /** Un `n` por cubo, SIEMPRE los cuatro: los que no vinieron valen 0. */
  readonly porCubo: Readonly<Record<CohorteDesenlace, number>>;
  /** El reloj del cubo `entregada`: `null` si ninguna cerro. */
  readonly promedioSegundos: number | null;
  /** El denominador de ese promedio. */
  readonly cerradas: number;
}

/**
 * Proyecta el DTO a filas rellenando los cubos ausentes con CERO.
 *
 * ⚠ CONSERVA EL ORDEN DE ENTRADA. No hay ni un `sort` aqui, y no es un olvido: el orden lo
 * decide el `ORDER BY` del repositorio y es contrato (la cohorte mas reciente primero).
 */
export function filasDeCohorte(porDia: readonly CohorteDeDia[]): readonly FilaCohorte[] {
  return porDia.map((dia) => {
    const porCubo = Object.fromEntries(
      CUBOS.map((cubo) => [cubo, dia.cubos.find((c) => c.desenlace === cubo)?.n ?? 0]),
    ) as Record<CohorteDesenlace, number>;

    const reloj = dia.cubos.find((c) => c.desenlace === CUBO_DEL_RELOJ);

    return {
      fecha: dia.fecha,
      cargadas: dia.cargadas,
      porCubo,
      promedioSegundos: reloj?.promedioSegundos ?? null,
      cerradas: reloj?.n ?? 0,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Estados que no son «sin datos»                                              */
/* -------------------------------------------------------------------------- */

/**
 * El mensaje de error que corresponde a cada estado que no es `ok`. `null` = no hay error.
 *
 * ⚠ `sin_rango` NO ESTA AQUI, y esa ausencia es la decision: no es un error del usuario ni un
 * filtro invalido —el filtro es valido y las otras siete lecturas lo aceptan tal cual—, sino que
 * aun no ha elegido periodo. Lo traduce `esInvitacion`.
 */
export function mensajeDe(resultado: ResultadoCohorteCarga | undefined, fallo: boolean): string | null {
  if (fallo) return TEXTO_ERROR_PANEL;
  if (!resultado) return null;
  switch (resultado.status) {
    case "unauthenticated":
      // Texto DISTINTO al de prohibido: «no puedes» y «no sabemos quien eres» piden cosas
      // distintas del usuario.
      return TEXTO_SESION_NO_VALIDA;
    case "forbidden":
      return TEXTO_PROHIBIDO;
    case "validation_error":
      return TITULO_FILTRO_INVALIDO;
    default:
      return null;
  }
}

/** `true` cuando lo que toca es INVITAR a elegir periodo (R39), que no es ni dato ni error. */
export function esInvitacion(resultado: ResultadoCohorteCarga | undefined): boolean {
  return resultado?.status === "sin_rango";
}

/* -------------------------------------------------------------------------- */
/* El componente                                                               */
/* -------------------------------------------------------------------------- */

async function consultar(filtroSerializado: string): Promise<ResultadoCohorteCarga> {
  return consultarCohorteCarga(JSON.parse(filtroSerializado) as unknown);
}

const COLUMNAS: Column<FilaCohorte>[] = [
  {
    id: "fecha",
    value: COHORTE_TEXTOS.columnaFecha,
    // La fecha se pinta TAL CUAL: es una fecha de calendario de Costa Rica en `YYYY-MM-DD` y
    // convertirla a `Date` aqui la releeria en el huso del navegador, que es exactamente como se
    // reintroduce el desplazamiento de seis horas contra el que avisa `lib/analytics/ranges.ts`.
    render: (fila) => fila.fecha,
    minWidth: "8rem",
  },
  {
    id: "cargadas",
    value: COHORTE_TEXTOS.columnaCargadas,
    render: (fila) => formatearValor(fila.cargadas, "conteo"),
    align: "right",
    minWidth: "6rem",
  },
  ...CUBOS.map<Column<FilaCohorte>>((cubo) => ({
    id: cubo,
    value: ETIQUETA_CUBO[cubo],
    // Un cubo que no vino vale CERO y se escribe. Ni guion, ni celda en blanco: el hueco del
    // DTO significa cero, y una celda vacia se lee como «no se sabe».
    render: (fila) => formatearValor(fila.porCubo[cubo], "conteo"),
    align: "right",
    minWidth: "6rem",
  })),
  {
    id: "dias",
    value: COHORTE_TEXTOS.columnaDias,
    render: (fila) => textoDiasHastaEntregar(fila.promedioSegundos, fila.cerradas),
    align: "right",
    minWidth: "12rem",
  },
];

export function CohorteCargaTabla() {
  // El filtro lo publica la barra de entregas, la MISMA que mueve el resto de la seccion.
  // Cambiarlo cambia la clave y SWR vuelve a consultar: sin eso, en pantalla quedaria la cohorte
  // del filtro anterior como si fuera la del nuevo.
  const { filtro } = useFiltroEntregas();
  const filtroSerializado = serializarFiltroEntregas(filtro);

  const { data, error, isLoading } = useSWR(
    [CLAVE_TABLERO, "cohorte-carga", filtroSerializado],
    () => consultar(filtroSerializado),
    { keepPreviousData: false, revalidateOnFocus: false },
  );

  const mensaje = mensajeDe(data, error !== undefined);
  const datos = data?.status === "ok" ? data.datos : null;
  const invitacion = esInvitacion(data);

  const filas = useMemo(
    () => (datos === null ? [] : filasDeCohorte(datos.porDia)),
    [datos],
  );

  // R24 — la faceta que esta lectura NO aplica. Se mira el filtro, no la respuesta: la
  // advertencia habla del recorte que el usuario tiene puesto.
  const hayMensajero = (filtro.mensajero_id ?? []).length > 0;

  // R33 — el porcentaje de la cohorte, y su denominador son las CARGADAS y no las cerradas.
  // Sobre cerradas, una cohorte de hoy con una sola entrega saldria al 100 %. Con `total = 0` no
  // se escribe: no hay denominador, y un «0 %» seria una afirmacion que nadie ha hecho.
  const entregadas = datos?.totalPorDesenlace.find((c) => c.desenlace === CUBO_DEL_RELOJ)?.n ?? 0;
  const porcentaje =
    datos !== null && datos.total > 0
      ? rotuloConBase(
          `${ETIQUETA_CUBO[CUBO_DEL_RELOJ]} ${formatearValor(entregadas / datos.total, "porcentaje")}`,
          contarOrdenes(datos.total, ORDENES),
        )
      : null;

  return (
    <div className="flex w-full flex-col gap-3">
      {/* R24 — la advertencia va ARRIBA y junto al titulo: quien lee la tabla tiene que haber
          leido antes por que no responde al mensajero que tiene puesto. */}
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {hayMensajero ? <p>{COHORTE_TEXTOS.avisoMensajero}</p> : null}
        {/* El total del recorte, con la MISMA forma que el resto de la fila de KPIs. Solo con
            respuesta: con un error, un total de cero seria una cifra inventada. */}
        {datos === null ? null : (
          <p>{COHORTE_TEXTOS.cargadasDelPeriodo(contarOrdenes(datos.total, ORDENES))}</p>
        )}
        {porcentaje === null ? null : <p>{COHORTE_TEXTOS.entregadas(porcentaje)}</p>}
        {/* CUANDO se leyeron estas cifras DE LA BASE. La respuesta se sirve de una cache de 15
            minutos, asi que sin el sello la pantalla afirma que el numero es de este segundo. */}
        {datos === null ? null : (
          <p title={textoSelloCompleto(datos.lastSync)}>{textoSello(datos.lastSync)}</p>
        )}
      </div>

      {/* R39 — LA INVITACION, y no una tabla vacia ni un cero. Es el unico estado de esta
          pantalla que no es ni dato ni error: el filtro es valido y lo que falta es elegir
          periodo. Se pinta EN LUGAR de la tabla —no encima de ella— porque una tabla con sus
          cabeceras y sin filas ya es una respuesta, y aqui no hay ninguna que dar. */}
      {invitacion ? (
        <EmptyState
          icon={CalendarDays}
          title={COHORTE_TEXTOS.invitacionTitulo}
          description={COHORTE_TEXTOS.invitacionDescripcion}
        />
      ) : (
        <DataTable
          columns={COLUMNAS}
          data={[...filas]}
          rowKey="fecha"
          ariaLabel={COHORTE_TEXTOS.tabla}
          isLoading={isLoading}
          // R34 — «prohibido», «sesion no valida», «filtro invalido» y «se rompio» salen por el
          // estado de ERROR de la tabla, nunca por su vacio: un problema de permisos pintado como
          // «no hubo cargas» es una afirmacion de negocio que nadie ha hecho.
          error={mensaje}
          emptyState={{
            icon: PackageSearch,
            title: COHORTE_TEXTOS.vacioTitulo,
            description: COHORTE_TEXTOS.vacioDescripcion,
          }}
        />
      )}
    </div>
  );
}
