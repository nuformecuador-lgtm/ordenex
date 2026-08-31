"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useFiltrosUrl } from "@/hooks/useFiltrosUrl";
import { cn } from "@/lib/utils";
import {
  opcionesVisibles,
  podarSeleccion,
} from "@/lib/utils/filter-dependencies";
import { seleccionDesdeUrl } from "@/lib/utils/filtros-url";

import { DateRangeFilter } from "./DateRangeFilter";
import { MultiSelectFilter } from "./MultiSelectFilter";

/**
 * Tipos de control soportados (decision (k) del spec). `boolean` es un INTERRUPTOR:
 * o el filtro esta puesto o no esta, sin opciones que elegir.
 *
 * Feature 169 (design §8.1): `text` es un campo de TEXTO LIBRE. Sigue siendo generico
 * —el componente no sabe que se busca ni contra que— y su unica particularidad es
 * `minChars`: por debajo de ese minimo la clave NO viaja.
 */
export type FilterKind = "multi" | "single" | "dateRange" | "boolean" | "text";

export interface FilterOption {
  /** Valor emitido TAL CUAL (R5): id de catalogo, o valor de atajo en `dateRange`. */
  value: string;
  /** Texto visible y texto sobre el que busca el buscador interno. */
  label: string;
  /**
   * Valor del filtro PADRE al que pertenece esta opcion. Solo lo leen los filtros
   * que declaran `dependsOn` (R23/R24). El componente NO sabe que significa.
   */
  parentValue?: string;
  /** Grupo al que pertenece la opcion (R28). Puro contrato de opciones. */
  group?: string;
  /**
   * Solo en `dateRange`: el RANGO de fechas calendario (`YYYY-MM-DD`) que este atajo
   * representa. El control no lo calcula ni lo interpreta: pinta ese rango en el
   * calendario y emite sus dos extremos. Sin el, el atajo no se ofrece.
   */
  defaultRange?: { desde: string; hasta: string };
}

export interface FilterDef {
  /** Clave con la que este filtro aparece en la salida (R2). */
  key: string;
  /** Etiqueta visible y nombre accesible del control (R2, R29). */
  label: string;
  kind: FilterKind;
  /**
   * `multi`/`single`: las opciones seleccionables.
   * `dateRange`: los ATAJOS ofrecidos dentro del control (R9). Vacio/ausente = solo
   * desde/hasta.
   * `boolean`: no lleva opciones; su unico valor es el de `BOOLEAN_MARCADO`.
   */
  options?: FilterOption[];
  /** Clave del UNICO filtro padre del que depende (R23). No aplica a `dateRange`. */
  dependsOn?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  /**
   * Solo en `text` (feature 169, design §8.1): minimo de caracteres —ya recortados los
   * extremos— con el que el termino EMPIEZA a viajar. Por debajo, la clave desaparece
   * de la salida y el control avisa de cuantos hacen falta; no es un error de
   * validacion, es "todavia no hay busqueda". Default `0` (sin minimo): un filtro de
   * texto que no lo declara emite en cuanto haya algo escrito.
   */
  minChars?: number;
}

/** Salida agnostica y uniforme (R16/R18/R19/R20). */
export type FilterSelection = Record<string, string[]>;

export interface FilterComponentProps {
  /** Filtros a montar, EN EL ORDEN en que deben renderizarse (R3). */
  filters: FilterDef[];
  /** Recibe la seleccion COMPLETA y agregada en cada cambio de valor (R16). */
  onChange: (selection: FilterSelection) => void;
  /** Ofrece la accion "Limpiar todo" (R22). Default: `false`. */
  showClearAll?: boolean;
  /** Deshabilita TODOS los controles; ninguno emite (R15). */
  disabled?: boolean;
  /**
   * Espera (ms) entre el último cambio y la emisión de `onChange`. Los controles
   * responden al instante; lo que se aplaza es AVISAR al consumidor, para que marcar
   * cuatro casillas seguidas no dispare cuatro consultas. `0` emite en el acto (útil
   * en tests y en consumidores que no consultan nada).
   */
  debounceMs?: number;
  /**
   * Feature 335 (R3, R23): siembra la seleccion inicial con lo que traiga la URL, leyendo
   * cada param por la clave EXACTA de su filtro. `false` deja el orquestador como estaba
   * antes de la ficha: arranca en `{}` y no mira la query. Default `true`.
   *
   * Solo se LEE, y solo al entrar (R7): esta prop no escribe la URL nunca. Quien la borra
   * al «Limpiar todo» es `BuscadorFiltros`, que es la duena de esa accion.
   */
  leerDeUrl?: boolean;
  className?: string;
}

const KINDS_SOPORTADOS = new Set<string>([
  "multi",
  "single",
  "dateRange",
  "boolean",
  "text",
]);

/**
 * Valor UNICO que emite un filtro `boolean` marcado (R19: la salida siempre es una
 * lista de cadenas por clave). Desmarcado no emite `["false"]`: la clave DESAPARECE,
 * como cualquier otro filtro sin seleccion (R18).
 */
export const BOOLEAN_MARCADO = "true";

/** Espera por defecto entre el último cambio y la emisión (ms). */
export const DEBOUNCE_MS_DEFAULT = 500;
/** Los tipos basados en opciones: sin opciones ofrecidas, su control va deshabilitado (R14). */
const KINDS_CON_OPCIONES = new Set<string>(["multi", "single"]);

/**
 * Separador con el que el juego de claves montadas se aplana a un string comparable.
 * Es el byte NUL: una clave de filtro no puede contenerlo, asi que dos juegos distintos
 * nunca se aplanan al mismo texto. Va ESCAPADO (`\u0000`) y no crudo en el fuente —lo
 * estuvo hasta hoy—, porque un byte de control dentro de una cadena hace que git
 * clasifique el archivo como binario y deje de mostrar sus diffs.
 */
const SEPARADOR_CLAVES = "\u0000";

/**
 * Feature 335 (R10) — el rango con el que arranca un `dateRange` sembrado desde la URL.
 *
 * La terna tiene dos formas y solo una es un rango: por ATAJO (`30d,,`) el rango son las
 * fechas que ese atajo representa, declaradas en su opcion; por RANGO (`,desde,hasta`)
 * son los dos extremos tal cual. Sin esto el control se pintaria vacio con el filtro ya
 * aplicado.
 */
function rangoInicial(
  filtro: FilterDef,
  terna: string[],
): { desde: string; hasta: string } | undefined {
  const [atajo = "", desde = "", hasta = ""] = terna;
  if (atajo !== "") {
    return (filtro.options ?? []).find((o) => o.value === atajo)?.defaultRange;
  }
  if (desde === "" && hasta === "") return undefined;
  return { desde, hasta };
}

/**
 * Aviso del filtro de texto MIENTRAS lo escrito no alcanza su minimo (feature 169, R35).
 * No es un error: es "sigue escribiendo". Se expone como funcion para que quien lo
 * afirme en un test no reescriba la cadena a mano.
 */
export function avisoMinimoCaracteres(minChars: number): string {
  return `Escribe al menos ${minChars} caracteres para buscar`;
}

/**
 * Filtro de TEXTO LIBRE (feature 169, design §8.1). Vive aqui, junto al orquestador,
 * porque no tiene nada que no sea el orquestador: un `Input`, su limpieza y la regla
 * del minimo.
 *
 * Reglas (R33-R37, R41):
 * - **el campo responde al instante** (estado interno); lo que se aplaza es la EMISION,
 *   que ya hace `FilterComponent` con su debounce. No hay un segundo temporizador aqui:
 *   sumaria dos esperas y una rafaga de pulsaciones dispararia mas de una consulta;
 * - emite `[termino]` —recortado— solo con `>= minChars`; por debajo, la clave DESAPARECE
 *   (patron `boolean`/`dateRange`), de modo que 1-2 caracteres no viajan y el borde nunca
 *   responde `validation_error` por algo que el usuario esta todavia escribiendo;
 * - **no emite si lo que emitiria es lo ya aplicado**: teclear por debajo del minimo, o
 *   añadir un espacio al final de un termino ya aplicado, no avisa al consumidor. Sin esta
 *   guarda, cada pulsacion inerte reprogramaria el debounce y la cache del consumidor;
 * - se vacia con su propia X y con "Limpiar todo" (via `resetSignal`);
 * - `aria-label` propio + aviso del minimo en una region `status`, que el campo referencia
 *   con `aria-describedby`.
 */
function TextFilter({
  label,
  placeholder,
  minChars,
  aplicado,
  valorInicial,
  onChange,
  resetSignal,
  disabled,
}: {
  label: string;
  placeholder?: string;
  minChars: number;
  /** Valor de esta clave en la seleccion agregada (`[]` = sin busqueda aplicada). */
  aplicado: string[];
  /**
   * Feature 335 (R3, R13): texto con el que ARRANCA el campo, para el caso en que la
   * clave venga sembrada desde la URL. Sin esto la seleccion llevaria el termino y el
   * campo se veria VACIO: la pantalla mintiendo sobre lo que esta aplicado.
   *
   * Solo lo lee el inicializador perezoso (control no controlado, igual que el
   * `defaultRange` de `DateRangeFilter`): cambiarlo despues no pisa lo que el usuario
   * este escribiendo.
   */
  valorInicial: string;
  onChange: (valores: string[]) => void;
  resetSignal: number;
  disabled: boolean;
}) {
  const idBase = useId();
  const idAviso = `${idBase}-minimo`;
  const [texto, setTexto] = useState(valorInicial);

  // Limpieza externa ("Limpiar todo"): mismo patron que `DateRangeFilter` — se ajusta el
  // estado DURANTE el render, sin efecto y sin emitir (el orquestador ya emite `{}`).
  const [signalPrevio, setSignalPrevio] = useState(resetSignal);
  if (resetSignal !== signalPrevio) {
    setSignalPrevio(resetSignal);
    setTexto("");
  }

  const termino = texto.trim();
  const faltanCaracteres = termino.length > 0 && termino.length < minChars;

  function escribir(valor: string) {
    setTexto(valor);
    const recortado = valor.trim();
    // `!== ""` aparte del minimo: con `minChars` 0 (default) un campo vacio seguiria
    // cumpliendo `length >= 0`, y "sin texto" no es un filtro puesto.
    const emitido =
      recortado !== "" && recortado.length >= minChars ? [recortado] : [];
    const sinCambio =
      emitido.length === aplicado.length && emitido[0] === aplicado[0];
    if (sinCambio) return;
    onChange(emitido);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="relative flex items-center">
        <Input
          type="search"
          value={texto}
          // R41: nombre accesible propio, el mismo que la etiqueta declarada.
          aria-label={label}
          aria-describedby={faltanCaracteres ? idAviso : undefined}
          placeholder={placeholder}
          disabled={disabled}
          // `text-ellipsis`: el placeholder de un filtro de texto ENUMERA lo que se puede
          // teclear ahi, asi que es largo por necesidad y no cabe en el ancho real del campo.
          // Sin esto el navegador lo recorta a hueso, en seco y a mitad de palabra. El corte
          // lo decide el ancho de cada viewport, NO una cadena acortada a mano: el texto
          // completo sigue en el DOM, asi que quien tenga sitio —o use un lector de
          // pantalla— lo recibe entero. Acortar la constante lo habria perdido para todos.
          className="min-w-56 pr-8 text-ellipsis"
          onChange={(e) => escribir(e.target.value)}
        />
        {/* R37: limpieza individual, sin tocar el resto de la barra. */}
        {texto !== "" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={disabled}
            aria-label={`Limpiar ${label}`}
            className="absolute right-1 hover:bg-transparent hover:text-foreground"
            onClick={() => escribir("")}
          >
            <X className="h-4 w-4 opacity-60" aria-hidden />
          </Button>
        ) : null}
      </div>
      {/* R35/R41: la region vive SIEMPRE en el arbol —un `aria-live` que aparece con su
          texto ya dentro no se anuncia— y solo cambia su contenido. Vacia no ocupa alto,
          asi que la barra no se mueve al aparecer el aviso. */}
      <p id={idAviso} role="status" className="text-xs text-muted-foreground">
        {faltanCaracteres ? avisoMinimoCaracteres(minChars) : ""}
      </p>
    </div>
  );
}

/**
 * # `FilterComponent` — barra de filtros GENERICA y parametrizable
 *
 * Monta y coordina **N filtros declarados por props** (R1) y es dueño del estado
 * agregado (no controlado): el consumidor solo declara QUE filtros hay y recibe por
 * `onChange` la seleccion completa. Es el hermano un nivel arriba de
 * `MultiSelectFilter`: aquel es UN control, este ORQUESTA N.
 *
 * **Vive en `components/shared/` por decision (n) del gate F1.4**, como excepcion
 * explicita a la regla de "dos superficies antes de promover" de
 * `docs/architecture.md`: nace generico por peticion del humano y la feature 145
 * (`depends_on: 144`) es su segundo consumidor declarado. **No es un hallazgo.**
 *
 * ## Lo que NO hace
 * - **No hace fetch** (R4): todas las opciones llegan por props, sea cual sea el
 *   transporte con que el consumidor las consiguio.
 * - **No interpreta ni transforma los valores** (R5): emite exactamente los valores
 *   declarados en las opciones, o las fechas que introdujo el usuario.
 * - **No construye el objeto de consulta de ningun endpoint ni Server Action** (R20):
 *   **la traduccion al transporte es responsabilidad del consumidor**.
 * - No sabe nada de dominio: ni ordenes, ni geografia, ni fechas con huso.
 *
 * ## Contrato de props
 * `filters: FilterDef[]` (clave, etiqueta, `kind` y —si es de opciones— su lista),
 * `onChange`, `showClearAll`, `disabled`, `debounceMs`.
 *
 * ## Emision con debounce
 * Los controles responden al instante; `onChange` se emite `debounceMs` despues del
 * ultimo cambio (500 ms por defecto), de modo que una racha de clics produce UNA sola
 * emision —la del estado final— y no una consulta por clic. `debounceMs={0}` emite
 * en el acto.
 *
 * ## `dependsOn` / `parentValue` (R23-R27)
 * Un filtro declara `dependsOn: "<key de otro filtro>"` y cada opcion suya trae
 * `parentValue` = el valor del padre al que pertenece. Las opciones ofrecidas se
 * acotan a la **seleccion efectiva** del padre (su seleccion, o todas sus opciones
 * visibles si esta vacia), de forma **transitiva**; al cambiar un padre, los valores
 * que dejan de estar ofrecidos se **podan** antes de emitir, de modo que nunca se
 * emite una combinacion incoherente. `dependsOn` a una clave no declarada (o un
 * ciclo) se trata como filtro independiente.
 *
 * ## Filtros que dejan de declararse
 * Si un filtro desaparece de `filters` (p. ej. porque el consumidor deja al usuario
 * elegir QUE filtros monta), su seleccion se descarta y se emite la seleccion ya sin
 * el. Un filtro sin control en pantalla no puede seguir filtrando.
 *
 * ## `group` (R28)
 * Una opcion puede declarar `group`; las opciones se presentan bajo la cabecera
 * accesible de su grupo. Sin grupos, la lista es plana.
 *
 * ## Salida: `Record<string, string[]>` para los tres tipos
 * Las claves sin seleccion **se omiten** (R18), de modo que "sin filtros" es `{}`.
 *
 * | `kind` | Emite |
 * | --- | --- |
 * | `multi` | N valores |
 * | `single` | exactamente 1 valor |
 * | `dateRange` | exactamente 3 posiciones `[atajo, desde, hasta]`, **sin compactar** |
 * | `boolean` | `["true"]` marcado; **clave ausente** desmarcado (nunca `["false"]`) |
 * | `text` | exactamente 1 valor, el termino recortado; **clave ausente** por debajo de `minChars` |
 *
 * ### Que emite el filtro de tiempo en cada caso (R19)
 *
 * | Estado del control | Emite |
 * | --- | --- |
 * | nada elegido | **clave ausente** |
 * | atajo `30d` | `["30d","",""]` |
 * | rango completo | `["","2026-07-01","2026-07-28"]` |
 * | solo desde | `["","2026-07-01",""]` |
 * | solo hasta | `["","","2026-07-28"]` |
 * | rango invertido | **no emite** (control invalido, R12) |
 * | atajo + rango | **imposible**: son mutuamente excluyentes (R10) |
 *
 * La posicion ES el significado: `["30d"]` seria ambiguo con `["2026-07-01"]`.
 */
export function FilterComponent({
  filters,
  onChange,
  showClearAll = false,
  disabled = false,
  debounceMs = DEBOUNCE_MS_DEFAULT,
  leerDeUrl = true,
  className,
}: FilterComponentProps) {
  // R13: un `kind` no soportado no se renderiza ni entra en la salida, y el resto de
  // filtros sigue funcionando.
  const montados = useMemo(
    () => filters.filter((f) => KINDS_SOPORTADOS.has(f.kind)),
    [filters],
  );

  const { params } = useFiltrosUrl(leerDeUrl);

  /**
   * Claves ya CONSIDERADAS para la siembra desde la URL. Cada clave se siembra como
   * mucho una vez en toda la vida del componente: `filters` crece y mengua (la barra
   * activa una clave, el usuario retira un control), y sin esta memoria cada vaiven
   * volveria a leer la URL y resucitaria valores.
   */
  const sembradas = useRef<Set<string>>(new Set());

  /**
   * R3, R7, R25 — la seleccion que traia la URL AL ENTRAR, resuelta en el inicializador
   * PEREZOSO y no en un efecto.
   *
   * No es estilo: congelarla aqui convierte «la URL solo se lee al entrar» en una
   * propiedad ESTRUCTURAL —un cambio posterior de los params no tiene por donde entrar—
   * en vez de en una promesa vigilada por una guarda que alguien puede quitar. Y de paso
   * esquiva la regla de lint del repo que prohibe `setState` en un efecto para leer una
   * fuente externa (R25).
   *
   * Se poda con las mismas reglas de dependencia que cualquier otra emision: una URL
   * puede pedir «talla azul» bajo «color rojo», y el orquestador nunca emite una
   * combinacion incoherente.
   *
   * Las claves que se sembraron aqui se apuntan en `sembradas` desde el efecto de montaje
   * y no desde este inicializador: la regla `react-hooks/refs` del repo prohibe tocar una
   * ref durante el render, y ese efecto corre ANTES que el de poda y siembra, que es el
   * unico que consulta el conjunto.
   */
  const [seleccion, setSeleccion] = useState<FilterSelection>(() =>
    leerDeUrl ? podarSeleccion(montados, seleccionDesdeUrl(params, montados)) : {},
  );

  /**
   * La siembra se CIERRA con el primer cambio originado por el usuario (R7). Sin ese
   * cierre, quitar un control y volver a ponerlo resucitaria el valor de la URL que el
   * usuario acababa de descartar.
   *
   * Va en estado Y en ref a proposito: el estado lo necesita el RENDER (los controles no
   * controlados deciden ahi con que valor arrancan) y la ref la necesita el efecto de
   * abajo, que no vuelve a correr por un cambio de estado y debe leer el valor de AHORA.
   * Los dos se escriben en el mismo sitio, asi que no pueden divergir.
   */
  const [siembraCerrada, setSiembraCerrada] = useState(false);
  const siembraCerradaRef = useRef(false);

  // Contador de "Limpiar todo": los controles con estado interno (fechas) lo miran
  // para vaciarse sin que el orquestador tenga que controlarlos.
  const [resetSignal, setResetSignal] = useState(0);

  /**
   * Lo que la URL trae para las claves declaradas AHORA MISMO. Solo lo leen los controles
   * NO controlados (`text`, `dateRange`) para saber con que valor montarse: cuando una
   * clave se siembra al crecer `filters`, el control se monta en el render ANTERIOR al
   * efecto que siembra, asi que sin esto arrancaria vacio y mentiria.
   */
  const precargaUrl = useMemo(
    () =>
      leerDeUrl && !siembraCerrada ? seleccionDesdeUrl(params, montados) : {},
    [leerDeUrl, siembraCerrada, params, montados],
  );

  // `onChange` cambia de identidad en cada render del consumidor; se lee por ref para
  // que el temporizador pendiente use SIEMPRE la version fresca sin reprogramarse.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Al desmontar se cancela lo pendiente: emitir sobre un consumidor que ya no esta
  // seria un setState en un arbol muerto.
  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  /**
   * Emite la seleccion agregada con el retardo configurado. Cada cambio CANCELA el
   * anterior: una racha de clics se resuelve en UNA sola emision, la del estado final.
   */
  function emitir(seleccionFinal: FilterSelection) {
    if (temporizador.current) {
      clearTimeout(temporizador.current);
      temporizador.current = null;
    }
    if (debounceMs <= 0) {
      onChange(seleccionFinal);
      return;
    }
    temporizador.current = setTimeout(() => {
      temporizador.current = null;
      onChangeRef.current(seleccionFinal);
    }, debounceMs);
  }

  /** Aplica la poda (R26) y emite la seleccion agregada ya coherente (R16/R18). */
  function aplicar(siguiente: FilterSelection) {
    const podada = podarSeleccion(montados, siguiente);
    setSeleccion(podada);
    emitir(podada);
  }

  // Un filtro que deja de estar DECLARADO deja de filtrar. Sin esto su seleccion
  // seguiria viva en el estado interno —y viajando en cada emision— con su control
  // fuera de pantalla: un filtro invisible pero aplicado, que el usuario no puede ni
  // ver ni quitar. Se compara por CLAVES (no por identidad del array) para no
  // dispararse en cada render del consumidor.
  const clavesMontadas = montados.map((f) => f.key).join(SEPARADOR_CLAVES);
  const seleccionRef = useRef(seleccion);
  const montadosRef = useRef(montados);
  const paramsRef = useRef(params);
  useEffect(() => {
    seleccionRef.current = seleccion;
    montadosRef.current = montados;
    paramsRef.current = params;
  });

  /**
   * R5 — la seleccion precargada se emite UNA vez al montar, por el camino de siempre
   * (`emitir`, con su debounce), para que el listado llegue ya acotado y no solo la barra
   * pintada. Quien la recibe no tiene que distinguir «esto vino de la URL».
   *
   * R6 — si no habia nada precargado no se emite NADA. No es elegancia: hoy este
   * componente no avisa al montar y decenas de tests del repo dependen de ese silencio;
   * emitir `{}` al entrar ademas dispararia una consulta extra por pantalla.
   */
  const precargaInicial = useRef(seleccion);
  useEffect(() => {
    // Las claves DECLARADAS al montar quedan sembradas de salida: su turno de leer la URL
    // fue el inicializador de arriba y no lo repiten. Se apunta aqui —y no alli— porque el
    // render no puede tocar refs, y este efecto corre antes que el que siembra.
    for (const filtro of montadosRef.current) sembradas.current.add(filtro.key);
    if (Object.keys(precargaInicial.current).length === 0) return;
    emitir(precargaInicial.current);
    // Corre UNA sola vez, al montar: `emitir` se recrea en cada render y depender de el
    // reemitiria la precarga en todos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const vivas = new Set(clavesMontadas.split(SEPARADOR_CLAVES));
    const actual = seleccionRef.current;
    const sobran = Object.keys(actual).filter((clave) => !vivas.has(clave));

    // R2/R3 — siembra por CRECIMIENTO de `filters`, en ESTE mismo efecto y no en uno
    // aparte: los dos reaccionan al mismo disparador (el juego de claves) y escriben el
    // mismo estado, asi que separarlos dejaria el resultado a merced del orden en que
    // corran. Se calcula todo en una pasada, se aplica una vez y se emite una vez.
    //
    // Hace falta porque el orden de montaje REAL no es el ideal: en `/ordenes`,
    // `/cierres-admin` y `/configuracion` este componente se monta con `filters=[]` y solo
    // DESPUES la barra activa las claves que traia la URL. Sembrar unicamente en el
    // inicializador dejaria esas pantallas sin precarga.
    //
    // R17 — la poda no se lleva por delante lo sembrado: se siembran claves ya DECLARADAS
    // (`montadosRef`), asi que nunca estan entre las que sobran.
    const nuevas = siembraCerradaRef.current
      ? []
      : montadosRef.current.filter((f) => !sembradas.current.has(f.key));
    for (const filtro of nuevas) sembradas.current.add(filtro.key);
    const sembrado =
      leerDeUrl && nuevas.length > 0
        ? seleccionDesdeUrl(paramsRef.current, nuevas)
        : {};

    // Sin nada que podar ni que sembrar no se toca el estado: este efecto corre en TODOS
    // los montajes y emitir aqui romperia el silencio de R6.
    if (sobran.length === 0 && Object.keys(sembrado).length === 0) return;
    const siguiente = { ...actual, ...sembrado };
    for (const clave of sobran) delete siguiente[clave];
    aplicar(siguiente);
    // `aplicar` se recrea en cada render; depender de el volveria a correr el efecto
    // sin que haya cambiado nada. Lo unico que debe dispararlo es el juego de claves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clavesMontadas]);

  /**
   * R7 — el primer gesto del usuario cierra la siembra PARA SIEMPRE. Sin esto, quitar un
   * control y volver a ponerlo resucitaria el valor de la URL que el usuario descarto.
   */
  function cerrarSiembra() {
    siembraCerradaRef.current = true;
    setSiembraCerrada(true);
  }

  function fijar(key: string, valores: string[]) {
    cerrarSiembra();
    const siguiente: FilterSelection = { ...seleccion };
    if (valores.length === 0) delete siguiente[key];
    else siguiente[key] = valores;
    aplicar(siguiente);
  }

  function limpiarTodo() {
    cerrarSiembra();
    setSeleccion({});
    setResetSignal((n) => n + 1);
    emitir({}); // R22: una sola emision, vacia
  }

  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      {montados.map((filtro) => {
        const visibles =
          filtro.kind === "dateRange"
            ? (filtro.options ?? [])
            : opcionesVisibles(montados, seleccion, filtro.key);
        const sinOpciones =
          KINDS_CON_OPCIONES.has(filtro.kind) && visibles.length === 0;
        // R14 + R15: sin opciones ofrecidas, o con el consumidor deshabilitando.
        const inhabilitado = disabled || filtro.disabled === true || sinOpciones;
        const valores = seleccion[filtro.key] ?? [];
        /**
         * R3 — con que valor arranca un control NO controlado (`text`, `dateRange`), que
         * es el unico momento en que puede mostrarlo. Lo ya aplicado manda; si todavia no
         * lo esta —el control se monta en el render ANTERIOR al efecto que siembra— vale
         * lo que trae la URL para esa clave.
         */
        const inicial = valores.length > 0 ? valores : (precargaUrl[filtro.key] ?? []);

        if (filtro.kind === "text") {
          return (
            <TextFilter
              key={filtro.key}
              label={filtro.label}
              placeholder={filtro.placeholder}
              // Sin minimo declarado, cualquier texto viaja: el minimo es una decision
              // del consumidor (aqui, del coste de su consulta), no del control.
              minChars={filtro.minChars ?? 0}
              aplicado={valores}
              valorInicial={inicial[0] ?? ""}
              onChange={(v) => fijar(filtro.key, v)}
              resetSignal={resetSignal}
              disabled={inhabilitado}
            />
          );
        }

        if (filtro.kind === "multi") {
          return (
            <MultiSelectFilter
              key={filtro.key}
              label={filtro.label}
              options={visibles}
              value={valores}
              onChange={(v) => fijar(filtro.key, v)}
              placeholder={filtro.placeholder}
              searchPlaceholder={filtro.searchPlaceholder}
              emptyMessage={filtro.emptyMessage}
              disabled={inhabilitado}
            />
          );
        }

        if (filtro.kind === "boolean") {
          const marcado = valores[0] === BOOLEAN_MARCADO;
          return (
            <label
              key={filtro.key}
              className={cn(
                "flex h-8 items-center gap-2 rounded-lg border border-border px-2.5 text-sm select-none",
                inhabilitado
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-pointer hover:bg-muted",
              )}
            >
              <Checkbox
                checked={marcado}
                disabled={inhabilitado}
                // R18: desmarcado NO emite `["false"]`, deja la clave fuera.
                onCheckedChange={(v) =>
                  fijar(filtro.key, v ? [BOOLEAN_MARCADO] : [])
                }
              />
              {filtro.label}
            </label>
          );
        }

        if (filtro.kind === "single") {
          return (
            <Select
              key={filtro.key}
              aria-label={filtro.label}
              className="min-w-56"
              value={valores[0] ?? ""}
              // R7: elegir un valor SUSTITUYE al anterior (nunca coexisten dos).
              onValueChange={(v) => fijar(filtro.key, v ? [v] : [])}
              options={visibles}
              placeholder={filtro.placeholder}
              disabled={inhabilitado}
            />
          );
        }

        return (
          <DateRangeFilter
            key={filtro.key}
            label={filtro.label}
            // Solo son atajos ofrecibles los que declaran QUE rango representan.
            shortcuts={visibles.flatMap((o) =>
              o.defaultRange
                ? [{ value: o.value, label: o.label, ...o.defaultRange }]
                : [],
            )}
            resetSignal={resetSignal}
            disabled={inhabilitado}
            placeholder={filtro.placeholder}
            // R3/R10: sembrado desde la URL, el control debe MOSTRAR ese rango; sin esto
            // el filtro estaria aplicado y el disparador diria "Cualquier fecha".
            defaultRange={rangoInicial(filtro, inicial)}
            // R18: un rango sin atajo y sin extremos es "sin seleccion" -> clave ausente.
            onChange={(terna) =>
              fijar(filtro.key, terna.some((p) => p !== "") ? [...terna] : [])
            }
          />
        );
      })}

      {/* R22: "Limpiar todo" solo existe cuando hay algo que limpiar. Sin ningun
          filtro activo no ocupa sitio ni ofrece una accion que no haria nada. */}
      {showClearAll && Object.keys(seleccion).length > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={limpiarTodo}
        >
          Limpiar todo
        </Button>
      ) : null}
    </div>
  );
}
