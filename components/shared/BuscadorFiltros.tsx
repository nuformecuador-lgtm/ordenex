"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { Popover } from "@base-ui/react/popover";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  avisoMinimoCaracteres,
  DEBOUNCE_MS_DEFAULT,
} from "@/components/shared/FilterComponent";
import {
  VistasFiltro,
  type VistasFiltroBarra,
} from "@/components/shared/VistasFiltro";
import { useFiltrosUrl } from "@/hooks/useFiltrosUrl";
import {
  activosDesdeUrl,
  PARAM_TERMINO_DEFAULT,
  terminoDesdeUrl,
} from "@/lib/utils/filtros-url";
import { cn } from "@/lib/utils";

/**
 * Alto del campo y del selector de filtros. Es el alto POR DEFECTO de un `Button` y
 * de un `Input` de la casa (`h-8`), que es justo lo que mide el botón de descarga con
 * el que esta barra comparte línea dentro de `DataTable`: dos controles a distinta
 * altura en la misma fila se leen como dos filas mal alineadas.
 *
 * Los controles que se van montando (Zona, Estado…) ya traen ese mismo alto por
 * defecto, así que no hace falta forzárselo.
 */
const ALTO_CONTROL = "h-8";

/** Un filtro OFRECIDO en el selector: su clave y como se llama. Nada mas. */
export interface FiltroDisponible {
  key: string;
  label: string;
}

export interface BuscadorFiltrosProps {
  /**
   * Nombre accesible del campo. NO se pinta como etiqueta visible: el contenedor ES
   * la zona de filtros y una etiqueta encima solo añadiría ruido. Default `"Buscar"`.
   */
  label?: string;
  /**
   * Qué se puede teclear ahí. En un buscador que alcanza VARIOS datos (guía,
   * remisión, teléfono…) el placeholder ES la documentación: sin él el usuario no
   * tiene forma de saber que el campo cubre más que lo primero que se le ocurra.
   */
  placeholder?: string;
  /**
   * Mínimo de caracteres —ya recortados los extremos— con el que el término EMPIEZA
   * a viajar. Por debajo se emite `""` (sin búsqueda) y el control avisa de cuántos
   * faltan; no es un error de validación, es "todavía no hay búsqueda". Default `0`.
   */
  minChars?: number;
  /**
   * Espera (ms) entre la última pulsación y la emisión. El campo responde al
   * instante; lo que se aplaza es AVISAR al consumidor, para que teclear una guía no
   * dispare una consulta por letra. `0` emite en el acto.
   */
  debounceMs?: number;
  disabled?: boolean;
  /** Recibe el término ya recortado, o `""` cuando no hay búsqueda aplicada. */
  onChange: (termino: string) => void;
  /**
   * Filtros que el selector OFRECE. Vacío o ausente: el botón no se monta —no se
   * ofrece una acción que abriría una lista vacía— y el campo se queda la barra.
   */
  filtros?: FiltroDisponible[];
  /**
   * Claves de los filtros PUESTOS, en el orden en que deben aparecer. Controlado: el
   * consumidor es dueño de la lista porque es él quien decide qué control monta para
   * cada clave.
   */
  activos?: string[];
  /** Se emite con la lista completa de claves puestas en cada cambio. */
  onActivosChange?: (keys: string[]) => void;
  /**
   * Los controles de los filtros PUESTOS. Se pintan ANTES del campo, en la misma
   * línea: el filtro elegido aparece a la izquierda y el buscador se encoge hasta su
   * ancho mínimo, no debajo.
   */
  children?: ReactNode;
  /** Texto del botón que abre el selector de filtros. Default `"Filtros"`. */
  filtrosLabel?: string;
  /**
   * Deja el buscador y los filtros como recién abiertos. La barra se encarga de SU
   * parte —vaciar el campo y emitir `""`—; esto es lo que hay que hacer con el resto,
   * que la barra no posee. Sin la prop, "Limpiar todo" no se ofrece.
   */
  onLimpiarTodo?: () => void;
  /**
   * ¿Hay algún filtro aplicado ahora mismo? Lo sabe el consumidor, que es quien tiene
   * la selección. Con esto (o con texto escrito) aparece "Limpiar todo"; sin nada
   * aplicado no se ofrece una acción que no haría nada.
   */
  hayFiltrosAplicados?: boolean;
  /**
   * Lee el estado inicial de la URL al entrar —término libre y qué filtros montar— y
   * RETIRA sus params en los dos únicos casos en que la barra escribe: «Limpiar todo»
   * (todos los propios) y vaciar el campo de búsqueda (solo `terminoKey`, R26).
   * `false` deja la barra exactamente como estaba antes de la ficha 339: ni lee la query
   * ni la toca (R23). Default `true`.
   */
  leerDeUrl?: boolean;
  /**
   * Nombre del query param del término libre. Default `"q"`
   * (`PARAM_TERMINO_DEFAULT`): la convención universal de la web, que además no choca
   * con ninguna clave de filtro declarada hoy. Existe para la pantalla cuyo back llame
   * a eso de otra forma y quiera que el enlace hable el idioma del endpoint.
   */
  terminoKey?: string;
  /**
   * FICHA 453 (design §7) — IMPONER EL TÉRMINO DESDE FUERA, sin remontar y sin tirar el
   * foco. Es el hueco 1 de la ficha 328: hasta hoy el campo nacía de un `useState` con lo
   * que traía la URL y la única vía para ponerle otra cosa era remontar la barra con
   * `key`, que relee la query y no sirve para reponer un filtro guardado.
   *
   * **Semántica:** cuando `senal` CAMBIA, el campo pasa a mostrar `termino` y la barra
   * **no emite** —quien impuso el valor es el consumidor, que ya lo sabe—. El mismo
   * número dos veces no hace nada: es una señal, no un valor.
   *
   * **Ausente, la barra se comporta exactamente como antes** (R31): los otros quince
   * consumidores no cambian ni un píxel.
   */
  siembra?: { senal: number; termino: string };
  /**
   * FICHA 453 (design §9) — enciende el control de VISTAS GUARDADAS al principio de la
   * fila, antes del campo y antes de los `children`.
   *
   * **Ausente, no se monta nada** —ni un control, ni una petición, ni una emisión—, que es
   * exactamente la regla que ya siguen `filtros` y `onLimpiarTodo` (R31). Hoy solo la
   * declara `/ordenes`; encender otra superficie es pasar esta prop y añadir su nombre a
   * `SUPERFICIES_VISTA`, sin migración ninguna (R32).
   *
   * Tiene que renderizarlo la barra y no la pantalla: el sitio pedido está ANTES de los
   * `children`, y una pantalla solo puede inyectar `children`, que se pintan después.
   */
  vistas?: VistasFiltroBarra;
  className?: string;
}

/**
 * # `BuscadorFiltros` — contenedor principal de la zona de filtros
 *
 * Una barra con un campo de búsqueda que ocupa todo el alto y todo el ancho que le
 * queda y, al final, un botón que abre el SELECTOR de filtros. Elegir "Zona" ahí
 * monta el control de zona en la propia barra, delante del campo; desmarcarlo lo
 * retira.
 *
 * El reparto no es estético: quien llega a un listado casi siempre trae un dato
 * concreto en la mano (una guía, un teléfono) y quiere escribirlo. Armar una
 * combinación de zona + provincia + fecha es el caso MENOS frecuente, y además cada
 * usuario repite las suyas: por eso los filtros se PIDEN uno a uno en vez de ocupar
 * media pantalla en todas las visitas.
 *
 * ## Lo que NO hace
 * - **No hace fetch ni construye la consulta**: emite un string y nada más.
 * - **No sabe contra qué se busca ni qué filtros ofrece**: guía, remisión o provincia
 *   son cosas del dominio del consumidor; aquí solo hay un `placeholder`, una lista
 *   de `{key, label}` y unos `children` que se pintan sin mirarlos.
 * - **No monta los controles**: recibe montados los de las claves activas. Quien sabe
 *   traducir clave → control es el consumidor.
 *
 * ## Emisión
 * El campo responde al instante (estado interno) y `onChange` se emite `debounceMs`
 * después de la última pulsación, con el término YA recortado. No emite si lo que
 * emitiría es lo ya aplicado: teclear por debajo del mínimo, o añadir un espacio al
 * final de un término vigente, no avisa al consumidor. Sin esa guarda cada pulsación
 * inerte reprogramaría el debounce y la caché de arriba.
 *
 * Comparte contrato (mínimo de caracteres, aviso, limpieza con X) con el
 * `kind: "text"` de `FilterComponent` y REUTILIZA su aviso y su espera por defecto,
 * para que los dos caminos no se separen con el tiempo.
 *
 * ## Qué hace con la URL (con `leerDeUrl`, que es lo normal)
 * La lee UNA vez, al entrar (R7), y a partir de ahí **solo la RESTA**, nunca la
 * reescribe:
 * - «Limpiar todo» retira el param del término y los de las claves ofrecidas (R19-R22);
 * - vaciar el campo de búsqueda retira **solo** el param del término (R26).
 *
 * Filtrar, marcar opciones o escribir un término NO tocan la query (R18), así que un
 * término escrito después de haber vaciado el campo tampoco vuelve a aparecer en la URL:
 * la barra desactiva enlaces obsoletos, no los genera.
 *
 * FICHA 453 añade el TERCER caso en que la URL se resta: aplicar una vista guardada retira
 * los params propios (R21), por el mismo `borrarParams` y con la misma lista.
 *
 * ## Las dos props de la ficha 453, las dos OPCIONALES y las dos apagadas por defecto
 * - `siembra`: imponer el término desde fuera sin remontar (el hueco 1 de la 328).
 * - `vistas`: encender el control de vistas guardadas al principio de la fila.
 *
 * Sin ellas esta barra es EXACTAMENTE la de antes: ni un control nuevo, ni una petición
 * nueva, ni una emisión nueva (R31). Es lo que permite que de los dieciséis consumidores
 * solo `/ordenes` cambie.
 */
export function BuscadorFiltros({
  label = "Buscar",
  placeholder,
  minChars = 0,
  debounceMs = DEBOUNCE_MS_DEFAULT,
  disabled = false,
  onChange,
  filtros = [],
  activos = [],
  onActivosChange,
  children,
  filtrosLabel = "Filtros",
  onLimpiarTodo,
  hayFiltrosAplicados = false,
  leerDeUrl = true,
  terminoKey = PARAM_TERMINO_DEFAULT,
  siembra,
  vistas,
  className,
}: BuscadorFiltrosProps) {
  const idBase = useId();
  const idAviso = `${idBase}-minimo`;

  const { params, borrarParams } = useFiltrosUrl(leerDeUrl);

  /**
   * Lo que la URL traía AL ENTRAR, congelado en un inicializador perezoso.
   *
   * No es un efecto, y la diferencia no es de estilo. Congelar aquí convierte «la URL
   * solo se lee al entrar» (R7) en una propiedad ESTRUCTURAL —un cambio posterior de los
   * params no tiene por dónde entrar— en vez de en una promesa vigilada por una guarda
   * que alguien puede quitar. Y de paso esquiva la regla de lint del repo que prohíbe
   * `setState` dentro de un efecto para leer una fuente externa (R25): `useSearchParams`
   * ya devuelve un valor de render, no una fuente mutable, así que tampoco procedería
   * aquí el `useSyncExternalStore` que sí usan `localStorage`/`matchMedia`.
   *
   * Es un solo `useState` con las dos cosas porque el efecto de montaje de abajo depende
   * de él: al ser un valor de estado su identidad es estable, y así el efecto puede
   * declararlo como dependencia y satisfacer `exhaustive-deps` sin mentirle.
   */
  const [precarga] = useState(() => ({
    termino: leerDeUrl ? terminoDesdeUrl(params, terminoKey) : "",
    activos: leerDeUrl ? activosDesdeUrl(params, filtros) : [],
  }));

  const [texto, setTexto] = useState(precarga.termino);
  const [abierto, setAbierto] = useState(false);

  /**
   * FICHA 453 (design §7) — LA SIEMBRA, ajustando el estado DURANTE EL RENDER.
   *
   * Es el patrón que este árbol ya usa en cuatro sitios (`resetSignal` de
   * `FilterComponent`, `filterKeyPrevio` y `claveOrdenPrevia` de `OrdenesModule`): sin
   * efecto, sin parpadeo intermedio y —lo que esta ficha necesitaba— **sin remontar**, así
   * que el campo conserva el foco y el cursor. Remontarlo con `key` era la única vía hasta
   * hoy, y es justo la queja de la 328.
   */
  const [senalSembrada, setSenalSembrada] = useState(siembra?.senal ?? 0);
  if (siembra !== undefined && siembra.senal !== senalSembrada) {
    setSenalSembrada(siembra.senal);
    setTexto(siembra.termino);
  }

  const hayFiltros = filtros.length > 0;
  const puestos = new Set(activos);
  const termino = texto.trim();
  const faltanCaracteres = termino.length > 0 && termino.length < minChars;

  // `onChange` cambia de identidad en cada render del consumidor; se lee por ref para
  // que el temporizador pendiente use SIEMPRE la versión fresca sin reprogramarse.
  const onChangeRef = useRef(onChange);
  const onActivosChangeRef = useRef(onActivosChange);
  // `borrarParams` se lee por ref por el MISMO motivo que los otros dos: la emisión puede
  // llegar desde un temporizador programado varios renders antes, y la versión congelada
  // en aquel closure llevaría una foto vieja de los params.
  const borrarParamsRef = useRef(borrarParams);
  useEffect(() => {
    onChangeRef.current = onChange;
    onActivosChangeRef.current = onActivosChange;
    borrarParamsRef.current = borrarParams;
  });

  // Último término EMITIDO. Es lo que hace fiable la guarda de "sin cambio": el texto
  // en pantalla y lo aplicado no coinciden mientras el debounce está en vuelo, así
  // que compararse contra el texto no serviría.
  // Arranca con el término PRECARGADO —no con `""`— para que la guarda siga diciendo la
  // verdad: si la URL traía `?q=guia`, eso es lo que ya está aplicado, y vaciar el campo
  // debe emitir `""` una sola vez en lugar de considerarse "sin cambio".
  const emitido = useRef(precarga.termino);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Al desmontar se cancela lo pendiente: emitir sobre un consumidor que ya no está
  // sería un setState en un árbol muerto.
  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  /**
   * R2, R5 — la emisión de lo precargado, UNA sola pasada y nunca más.
   *
   * Pintar la barra ya cargada no basta: el listado tiene que llegar acotado. Se avisa al
   * consumidor de qué claves montar y del término, por el camino DIRECTO y no por
   * `escribir`, que reprogramaría el debounce y retrasaría la primera consulta sin motivo.
   *
   * R6 — si no había nada precargado no se llama a NINGUNO de los dos. No es una
   * elegancia: ~77 archivos de test del repo montan esta barra sin params y esperan
   * exactamente el silencio de hoy; emitir `[]` o `""` al montar los pondría rojos, y en
   * producción dispararía una consulta extra por pantalla.
   */
  const sembrado = useRef(false);
  useEffect(() => {
    if (sembrado.current) return;
    sembrado.current = true;
    if (precarga.activos.length > 0) onActivosChangeRef.current?.(precarga.activos);
    if (precarga.termino !== "") onChangeRef.current(precarga.termino);
  }, [precarga]);

  /**
   * FICHA 453 — LAS TRES CUENTAS DE LA SIEMBRA QUE NO SON ESTADO. Van en un efecto porque
   * son `ref`s y el render no puede tocarlas (regla `react-hooks/refs`); sin lista de
   * dependencias, como `ColumnasPopover`: corre tras cada render y sale en la primera
   * línea cuando no hay siembra nueva.
   *
   * 1. **`emitido.current` se pone al día**, y no es cosmético: es la memoria de «qué tiene
   *    aplicado el consumidor». Si se quedara con el término viejo, la guarda de «sin
   *    cambio» mentiría y el siguiente tecleo real se lo tragaría — un fallo mudo: el
   *    usuario escribe y el listado no se entera.
   * 2. **Se cancela el debounce en vuelo.** Sembrar mientras viaja una emisión anterior
   *    dejaría que esa emisión pisara medio segundo después el término recién impuesto.
   * 3. **Se cierra la siembra de la URL.** Aquí ya la cierra el efecto de montaje de
   *    arriba, así que hoy es redundante y se escribe igual: es la MISMA regla que
   *    `FilterComponent` necesita de verdad (R23), y dejarla dicha en los dos sitios evita
   *    que el día que este montaje cambie la barra empiece a reponer sobre una vista.
   */
  const senalAnotada = useRef(siembra?.senal ?? 0);
  useEffect(() => {
    if (siembra === undefined || siembra.senal === senalAnotada.current) return;
    senalAnotada.current = siembra.senal;
    // Lo que el consumidor ACABA de aplicar, que es contra lo que tiene que comparar la
    // guarda. No se le aplica el mínimo de caracteres: quien impuso el término decide.
    emitido.current = siembra.termino.trim();
    if (temporizador.current) {
      clearTimeout(temporizador.current);
      temporizador.current = null;
    }
    sembrado.current = true;
  });

  /**
   * La EMISIÓN del término, con lo único que la barra escribe en la URL colgado de ella.
   *
   * R26 — cuando el término emitido pasa a `""` (la X del campo, borrar carácter a
   * carácter, seleccionar todo y suprimir, o caer por debajo de `minChars`) se retira de
   * la URL el param del término y NADA más: los de los filtros y los ajenos siguen ahí.
   *
   * Va aquí y no en el `onChange` del input a propósito: este punto ya está detrás de la
   * guarda de "sin cambio" y del debounce, así que teclear y borrar rápido produce UNA
   * emisión —y como mucho UNA navegación—, no una ráfaga. La segunda guarda, la de "si la
   * query no cambia no se navega", la pone `borrarParams`: vaciar un campo cuando la URL
   * nunca tuvo el param no navega en absoluto.
   *
   * ASIMETRÍA DELIBERADA, no es un bug: escribir un término NUEVO después no vuelve a
   * poblar la URL. La barra sigue sin reescribir la query mientras se filtra (R18); lo
   * único que hace es RESTAR, igual que «Limpiar todo». Un enlace copiado tras teclear no
   * lleva la búsqueda, y eso es lo aprobado.
   */
  function emitir(siguiente: string) {
    if (siguiente === "") borrarParamsRef.current([terminoKey]);
    onChangeRef.current(siguiente);
  }

  function escribir(valor: string) {
    setTexto(valor);
    const recortado = valor.trim();
    // `!== ""` aparte del mínimo: con `minChars` 0 (default) un campo vacío seguiría
    // cumpliendo `length >= 0`, y "sin texto" no es una búsqueda puesta.
    const siguiente =
      recortado !== "" && recortado.length >= minChars ? recortado : "";
    if (siguiente === emitido.current) return;
    emitido.current = siguiente;

    if (temporizador.current) {
      clearTimeout(temporizador.current);
      temporizador.current = null;
    }
    if (debounceMs <= 0) {
      emitir(siguiente);
      return;
    }
    temporizador.current = setTimeout(() => {
      temporizador.current = null;
      emitir(siguiente);
    }, debounceMs);
  }

  /**
   * Pone o retira un filtro. El ORDEN es el de la lista ofrecida, no el de los clics:
   * así los controles no bailan de sitio entre sesiones ni según en qué orden se
   * marcaron, que es lo que convierte una barra en un rompecabezas.
   */
  function alternarFiltro(key: string) {
    const siguiente = puestos.has(key)
      ? activos.filter((k) => k !== key)
      : filtros.filter((f) => puestos.has(f.key) || f.key === key).map((f) => f.key);
    onActivosChange?.(siguiente);
  }

  /**
   * Vacía el campo —emitiendo `""` por el camino de siempre, con su guarda y su
   * debounce— y avisa al consumidor de que limpie lo suyo. El orden importa poco,
   * pero el reparto sí: la barra no puede limpiar una selección que no posee.
   */
  function limpiarTodo() {
    // R19-R22 — se borran de la URL SOLO los params propios: el del término y los de las
    // claves OFRECIDAS. Los ajenos (`?cierre=` en cierres-admin, `?mensajero=` en
    // monitoreo…) no entran en la lista y sobreviven (R20). Va ANTES de avisar al
    // consumidor porque su `onLimpiarTodo` puede remontar esta barra en el mismo
    // manejador —`NovedadesFiltrosBarra` lo hace con su `key={filtro.reset}`—, y lo
    // retirado tiene que estar ya apuntado cuando eso ocurra.
    //
    // Y va ANTES de `escribir("")` desde R26: ese vaciado emite `""`, y esa emisión ya
    // borra el param del término por su cuenta. Borrando aquí primero, la retirada del
    // término queda apuntada en la memoria del hook y la de R26 se topa con la guarda de
    // "sin cambio" — o sea, UNA sola navegación en vez de dos (una sin `q` y otra sin los
    // filtros) cuando `debounceMs` es 0.
    borrarParams(paramsPropios);
    escribir("");
    onLimpiarTodo?.();
  }

  /**
   * Los params que esta barra considera SUYOS: el del término y los de las claves que
   * ofrece. Es la lista que se retira de la dirección en los dos —desde la 453, tres—
   * únicos casos en que la barra toca la URL, y está escrita UNA vez para que «Limpiar
   * todo» y «aplicar una vista» no puedan divergir. Los ajenos (`?cierre=`, `?mensajero=`)
   * no entran y sobreviven.
   */
  const paramsPropios = [terminoKey, ...filtros.map((f) => f.key)];

  const resumen = activos.length > 0 ? `${filtrosLabel} (${activos.length})` : filtrosLabel;

  return (
    // El contenedor NO dibuja nada: ni marco, ni fondo, ni relleno. Cada control se ve
    // por sí mismo —el campo con el borde de `Input`, el selector con el de `Button`—,
    // que es como se ven en el resto de la app, y así el primer elemento arranca
    // pegado al borde izquierdo, sin sangría.
    <div className={cn("w-full", className)}>
      {/* `flex-wrap`: con varios filtros puestos la línea salta antes que estrujar el
          campo por debajo de su mínimo. */}
      <div className="flex w-full flex-wrap items-center gap-2">
        {/* FICHA 453 (design §9) — LAS VISTAS GUARDADAS ABREN LA FILA, antes del campo y
            antes de los `children`. La lectura de la barra es «qué estoy mirando → afinarlo
            → limpiarlo», y el extremo derecho ya lo ocupa «Limpiar todo», que aparece y
            desaparece: un control al lado de otro que baila es un control que hay que
            buscar (R36). Sin la prop no se monta nada. */}
        {vistas ? (
          <VistasFiltro
            {...vistas}
            onAplicar={(vistaId, filtro) => {
              // R21 — aplicar una vista RETIRA de la dirección los params propios de la
              // barra (los mismos que «Limpiar todo»: el del término y los de las claves
              // ofrecidas) y no añade ninguno. Sin esto, recargar la página repondría el
              // filtro que la vista acaba de reemplazar, que es un fallo mudo: la pantalla
              // volvería sola a otro filtro sin que nadie lo pidiera.
              //
              // Lo hace la barra y no la pantalla porque esta lista es SUYA —la misma que
              // usa `limpiarTodo`— y porque `borrarParams` solo RESTA: la barra sigue sin
              // escribir la query nunca.
              borrarParams(paramsPropios);
              vistas.onAplicar(vistaId, filtro);
            }}
          />
        ) : null}

        {/* Los controles de los filtros puestos van DELANTE del campo. */}
        {children}

        {/* El campo se lleva todo el espacio sobrante (`flex-1`) pero nunca baja de
            250px: por debajo de eso una guía deja de verse entera mientras se teclea.
            `min-w-0` en el contenedor flexible no aplica aquí a propósito — el mínimo
            es justamente lo que no queremos que el flex ignore. */}
        <div
          className={cn(
            "relative flex min-w-[250px] flex-1 items-center",
            ALTO_CONTROL,
          )}
        >
          <Search
            className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={texto}
            aria-label={label}
            aria-describedby={faltanCaracteres ? idAviso : undefined}
            placeholder={placeholder}
            disabled={disabled}
            // El campo ocupa el 100% de su hueco, alto incluido, y conserva su marco y
            // su anillo de foco de `Input`. `text-ellipsis` porque el placeholder
            // ENUMERA lo buscable y es largo por necesidad: sin él el navegador lo
            // corta a hueso. El texto completo sigue en el DOM para quien tenga sitio
            // —o use un lector de pantalla—; acortar la cadena lo perdería para todos.
            // La X nativa del `type="search"` se oculta: el campo ya tiene la SUYA, y
            // con las dos el usuario ve dos aspas pegadas y no sabe cuál pulsa. Se
            // quita la del navegador y no la propia porque la nativa no existe en
            // todos (Firefox no la pinta), así que dejar solo esa daría un campo sin
            // forma de limpiarse en unos navegadores sí y en otros no.
            className="h-full w-full pr-9 pl-8 text-ellipsis [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
            onChange={(e) => escribir(e.target.value)}
          />
          {texto !== "" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={disabled}
              aria-label={`Limpiar ${label}`}
              className="absolute right-1.5 hover:bg-transparent hover:text-foreground"
              onClick={() => escribir("")}
            >
              <X className="size-4 opacity-60" aria-hidden />
            </Button>
          ) : null}
        </div>

        {/* El selector va AL FINAL de la barra. `listbox` multiseleccionable con el
            mismo ARIA que `MultiSelectFilter`: marcar una opción PONE su filtro y no
            cierra el panel, para poder pedir dos o tres del tirón. */}
        {hayFiltros ? (
          <Popover.Root open={abierto} onOpenChange={setAbierto}>
            <Popover.Trigger
              disabled={disabled}
              // Mismo alto EXACTO que el campo: dos controles a distinta altura en la
              // misma fila se leen como dos filas mal alineadas.
              className={cn(
                buttonVariants({ variant: "outline" }),
                "shrink-0 gap-2 font-normal",
                ALTO_CONTROL,
              )}
            >
              <SlidersHorizontal className="size-4" aria-hidden />
              {resumen}
              <ChevronDown
                className={cn("size-4 opacity-60 transition-transform", abierto && "rotate-180")}
                aria-hidden
              />
            </Popover.Trigger>

            {/* En PORTAL y posicionado por `Popover`, no `absolute` dentro de la fila:
                cuando la barra parte en dos líneas el botón cae pegado al borde
                izquierdo, y un panel anclado a mano se salía del área de contenido y
                quedaba debajo del sidebar. El posicionador lo empuja de vuelta a la
                pantalla (`align="end"` mientras quepa) y el portal lo saca de
                cualquier recorte o apilamiento de los ancestros. */}
            <Popover.Portal>
              <Popover.Positioner sideOffset={4} align="end" className="z-50">
                <Popover.Popup
                  render={<ul />}
                  role="listbox"
                  aria-label={filtrosLabel}
                  aria-multiselectable
                  className="max-h-64 w-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md outline-none"
                >
                {filtros.map((filtro) => {
                  const marcado = puestos.has(filtro.key);
                  return (
                    <li key={filtro.key}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={marcado}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                          "hover:bg-accent hover:text-accent-foreground",
                          marcado && "font-medium",
                        )}
                        onClick={() => alternarFiltro(filtro.key)}
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-sm border border-primary",
                            marcado
                              ? "bg-primary text-primary-foreground"
                              : "opacity-50",
                          )}
                          aria-hidden
                        >
                          {marcado ? <Check className="size-3" /> : null}
                        </span>
                        <span className="truncate">{filtro.label}</span>
                      </button>
                    </li>
                  );
                })}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        ) : null}

        {/* "Limpiar todo" cierra la barra por la derecha, DESPUÉS del selector: es la
            última pieza de la fila porque es lo último que se hace con ella. Solo
            existe cuando hay algo que limpiar —búsqueda escrita o filtros aplicados—;
            sin nada puesto no se ofrece una acción que no haría nada. */}
        {onLimpiarTodo && (texto !== "" || hayFiltrosAplicados) ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            className="shrink-0"
            onClick={limpiarTodo}
          >
            Limpiar todo
          </Button>
        ) : null}
      </div>

      {/* La región vive SIEMPRE en el árbol —un `aria-live` que aparece con su texto
          ya dentro no se anuncia— y solo cambia su contenido. Su alto está RESERVADO
          (`h-4`, vacía incluida): el aviso aparece y desaparece sin empujar ni un
          píxel de lo que hay debajo, que en esta barra es la tabla entera. */}
      <p
        id={idAviso}
        role="status"
        className="mt-1 h-4 text-xs text-muted-foreground"
      >
        {faltanCaracteres ? avisoMinimoCaracteres(minChars) : ""}
      </p>
    </div>
  );
}
