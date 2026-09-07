"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/shared/Modal";
import { SelectAllCheckbox } from "@/components/shared/SelectAllCheckbox";
import { DescargarDatasetButton } from "@/components/shared/DescargarDatasetButton";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import type { DescargaFilasResult } from "@/components/shared/DataTable";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import type { CierreGestionDescargaDTO } from "@/lib/interfaces/services/ICierresAdminService";
import type { DescargaColumna } from "@/lib/types/descarga";
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";
import type {
  CatalogoFiltrosCierresDTO,
  FiltrosDescargaGestiones,
} from "@/lib/types/filtros-cierres";

import { filaDescargaGestionFundida } from "./cierres-gestiones-fundida-descarga-columnas";

/**
 * Feature 230 (T4.1, design §7) — el DIÁLOGO de la descarga DETALLADA de cierres: elegir uno o
 * varios mensajeros y, opcionalmente, un rango de fechas, y bajarse la hoja fundida (una fila
 * por GESTIÓN).
 *
 * ── DÓNDE ENCAJA HOY (unificación de la descarga de cierres) ──────────────────────────────
 * Ya no lo dispara un botón propio junto al general. Las dos pantallas montan UN solo botón
 * «Descargar» (`DescargarCierresButton`) cuyo selector elige primero el NIVEL DE DETALLE; este
 * diálogo es lo que ese botón abre cuando el nivel elegido es «Detalle». De ahí que las
 * columnas lleguen por prop: quien las elige es el selector del botón, y esta ventana es el
 * paso siguiente —el CONJUNTO de filas—, no un segundo sitio donde volver a decidir columnas.
 *
 * Lo que ese cambio NO toca: los filtros de mensajero y rango siguen siendo suyos y siguen sin
 * heredar nada de la barra de la pantalla (D11, R34/R35).
 *
 * **UN componente para las DOS pantallas.** Lo único que cambia entre `cierres-admin` y los
 * cierres de bodega del maestro es la Server Action, que llega por prop (`accion`). No es un
 * lujo: los dos listados cubren conjuntos DISJUNTOS (design §2.6 — el maestro solo ve la GAM en
 * cierres del día, y lo satélite solo consolidado en cierres de bodega), así que hacen falta dos
 * bordes; pero las 29 columnas, la proyección y esta interacción son las mismas, y duplicarlas
 * sería garantizar que divergen (R26).
 *
 * **El conjunto lo redacta ESTE diálogo, no la pantalla** (D11, R34/R35). El componente no
 * recibe, no lee y no modifica los filtros de la barra: lo único que sale de aquí hacia el borde
 * son `mensajeroIds` y, si el usuario los puso, `desde`/`hasta`. Es una cesión consciente de la
 * mitad «el archivo es lo que la pantalla enseña» de la puerta única (design §4): aquí no se
 * RECONSTRUYE ningún criterio de pantalla —no hay ninguno que replicar—, y el diálogo es
 * explícito sobre qué se va a llevar.
 *
 * **Los controles de fecha no son una comodidad** (R31): sin ellos NO HABRÍA forma de acotar, y
 * el conjunto sería siempre el histórico entero del mensajero. Que EXISTAN es R31; que vengan
 * RELLENOS es otra cosa, y desde la ficha 384 vienen vacíos (dos párrafos más abajo).
 *
 * El «choca contra el tope de 5000 filas casi siempre» que decía este párrafo se escribió en
 * agosto de 2026 y NO se ha vuelto a medir; lo que sí está medido es que el 2026-09-07 producción
 * tenía 52 cierres en total, así que el tope queda lejos. Y cuando no quede lejos, el que avisa
 * es el servidor, con el total, el tope y qué acotar.
 *
 * **LOS VALORES POR DEFECTO**: se abre con TODOS los mensajeros del alcance marcados (pedido
 * humano 2026-08-19) y con el rango de fechas **VACÍO** (ficha 384, 2026-09-07).
 *
 * **FICHA 384 — POR QUÉ EL RANGO YA NO ARRANCA EN HOY.** Entre el 2026-08-19 y el 2026-09-07
 * esta ventana abría con el rango puesto en el DÍA DE HOY en sus dos extremos. Era cómodo, y
 * produjo el fallo que reportó el humano el 2026-09-07: «si no tengo filtros aplicados no me
 * deja descargar lo que se está mostrando en los cierres». Tenía razón: no había aplicado
 * ningún filtro —se lo aplicó el diálogo—. Medido contra producción ese día: 52 cierres,
 * CERO solicitados hoy, el último del 2026-09-06. El archivo salía vacío y el aviso le echaba
 * la culpa a unos filtros que no puso.
 *
 * Se quita el defecto en vez de solo mejorar el texto porque **el texto ya estaba**: la ayuda de
 * abajo decía «Arranca en el día de hoy» y aun así el usuario no lo leyó como un recorte suyo.
 * Un filtro que se aplica solo y solo se anuncia en letra pequeña es un fallo mudo. Y el modo de
 * fallo contrario sale más barato: pedir demasiado choca contra el tope de 5000 filas que aplica
 * el SERVIDOR (`CierresAdminService`, `descargaConfig.MAX_FILAS`), y ese aviso sí es ruidoso y
 * accionable —dice el total, dice el tope y dice que acotes el rango—. Se cambia un resultado
 * callado y equivocado por un aviso correcto.
 *
 * Lo que NO se pierde del pedido del 2026-08-19: la descarga que se pide a diario —el cierre del
 * día de toda la flota— sigue estando a UN clic, el del atajo «Hoy», que es menos que los «dos
 * clics de fecha» que aquel defecto vino a ahorrar. Lo que cambia es de quién es el rango.
 *
 * Siguen siendo controles y no una decisión del diálogo: se pueden desmarcar todos (y entonces
 * R39 corta, como siempre) y se puede vaciar cualquiera de las dos fechas; una fecha vacía
 * significa «sin ese extremo» y no viaja al borde.
 *
 * **Sin mensajeros elegidos no se llama al servidor** (R39): «ninguno» no es «todos», es una
 * llamada que no debió ocurrir. Se corta aquí, y el borde lo corta otra vez con su lista blanca.
 *
 * La generación del archivo, el tope y el binario los pone `DescargarDatasetButton` +
 * `filasDesdeResultado`, exactamente igual que la descarga general. Los mensajes también, salvo
 * UNO: el de «no hay filas», que desde la ficha 384 se redacta aquí porque el compartido culpa a
 * unos filtros que en esta ventana pueden no existir (ver `MENSAJE_SIN_DATOS_EN_RANGO`).
 *
 * D12/R38 sigue saliendo gratis, y ese mensaje propio no lo debilita: «este mensajero no tiene
 * cierres en el rango» y «este mensajero no es de tu alcance» llegan los dos como
 * `{ ok, items: [] }` y no hay ninguna rama que los distinga. La única que existe mira las
 * FECHAS QUE PUSO EL USUARIO —estado del cliente, idéntico en las dos llamadas— y nunca la
 * respuesta del servidor.
 */

/**
 * La Server Action que este diálogo consume. Las dos que existen (cierres del día y cierres de
 * bodega) encajan aquí sin adaptador: misma entrada validada y mismo resultado.
 */
export type AccionGestionesDescarga = (
  input: FiltrosDescargaGestiones,
) => Promise<ListarCompletoResult<CierreGestionDescargaDTO>>;

// --- Textos (separados de la lógica, i18n-ready) --------------------------

/** Nombre de la hoja, base del nombre de archivo y nombre accesible del control (R51). */
const TITULO_DESCARGA = "Gestiones de cierres";
/**
 * El texto VISIBLE del disparador es «Descargar» a secas: desde la unificación no hay un segundo
 * botón del que distinguirlo — es EL botón de la pantalla, con el nivel «Detalle» elegido.
 *
 * El nombre ACCESIBLE sí dice qué va a pasar («por mensajero»), porque este disparador no
 * descarga: abre la ventana donde se elige el conjunto. Empieza por la palabra visible, así que
 * quien navega por voz sigue pudiendo decir «Descargar» (WCAG 2.5.3).
 */
const DISPARADOR_LABEL = "Descargar";
const DISPARADOR_ARIA = "Descargar detallada por mensajero";
const MODAL_TITULO = "Descargar gestiones por mensajero";
const MODAL_DESCRIPCION =
  "Una fila por gestión, cruzando los cierres de los mensajeros que elijas. Esta descarga es independiente de los filtros de la pantalla: lo que se lleva es lo que elijas acá.";
const MENSAJEROS_LEGEND = "Mensajeros";
const TODOS_LABEL = "Todos";
const SIN_MENSAJEROS_EN_ALCANCE = "No hay mensajeros en tu alcance.";
const DESDE_LABEL = "Desde";
const HASTA_LABEL = "Hasta";
/**
 * FICHA 384: la ayuda ya no anuncia un recorte —no hay ninguno hasta que el usuario lo ponga—.
 * Dice qué recortan estos controles y qué significa dejarlos vacíos, que es el estado inicial.
 */
const RANGO_AYUDA =
  "Recorta por la fecha de solicitud del cierre. Vacías no recortan nada: se lleva todo el historial de los mensajeros elegidos.";
/** Atajo al caso diario (ficha 384): el cierre del día de toda la flota, en un clic. */
const HOY_LABEL = "Hoy";
/**
 * «Hoy» a secas no nombra una acción; el nombre accesible sí dice qué va a pasar (WCAG 2.4.6).
 * EMPIEZA por la palabra visible, igual que `DISPARADOR_ARIA` y por el mismo motivo: quien
 * navega por voz tiene que poder decir «Hoy» y que el control responda (WCAG 2.5.3).
 */
const HOY_ARIA = "Hoy: poner el rango de fechas en el día de hoy";
const CERRAR_LABEL = "Cerrar";

/** R39: el aviso accionable de confirmar sin nadie elegido. No se llama al servidor. */
const MENSAJE_SIN_MENSAJERO =
  "Elegí al menos un mensajero para descargar sus gestiones. Sin mensajeros no hay archivo.";
/** R32: el rango invertido se corta acá; el borde lo vuelve a rechazar con su schema. */
const MENSAJE_RANGO_INVERTIDO =
  "El rango de fechas está invertido: «Desde» tiene que ser anterior o igual a «Hasta».";

/**
 * FICHA 384 — el aviso de «no hay nada», redactado AQUÍ y no en `DescargarDatasetButton`.
 *
 * El control común dice «No hay datos que descargar con los filtros aplicados. Ajusta los
 * filtros», y ese texto lo comparten las ~26 tablas del árbol: cambiarlo allí las cambiaría
 * todas, y para la mayoría es correcto —descargan con la barra de filtros de su pantalla—. En
 * ESTA ventana el usuario puede no haber puesto ningún recorte de fecha, y entonces «ajusta los
 * filtros» le manda a arreglar algo que no rompió. Se entra por la puerta que el propio control
 * ya ofrece: el mensaje que venga de `obtenerFilas` tiene prioridad sobre el suyo.
 *
 * ⚠️ La variante se elige por lo que el USUARIO puso en el diálogo, JAMÁS por lo que devolvió el
 * servidor: «este mensajero no tiene cierres» y «este mensajero no es de tu alcance» siguen
 * llegando los dos como `{ ok, items: [] }` y produciendo el MISMO texto (D12/R38). Distinguirlos
 * filtraría información sobre el alcance ajeno.
 */
const MENSAJE_SIN_DATOS_EN_RANGO =
  "No hay gestiones de cierre en el rango de fechas elegido para esos mensajeros. Ampliá el rango o vaciá las fechas y volvé a intentarlo.";
const MENSAJE_SIN_DATOS =
  "Los mensajeros elegidos no tienen gestiones de cierre. Elegí otros mensajeros y volvé a intentarlo.";

export interface DescargarGestionesDialogProps {
  /** Opciones YA acotadas al alcance del actor, resueltas en el servidor (R29). */
  catalogo: CatalogoFiltrosCierresDTO;
  /** El ÚNICO punto de entrada de servidor de esta descarga en esta pantalla (R13). */
  accion: AccionGestionesDescarga;
  /**
   * Las columnas que salen en el archivo: las MARCADAS en el selector del botón, ya resueltas.
   *
   * OBLIGATORIA, sin valor por defecto, y a sabiendas de que un default («todas») sería cómodo:
   * ese default convertiría un cableado olvidado en un archivo con las 29 columnas y la
   * preferencia del usuario ignorada EN SILENCIO — nada fallaría, nadie se enteraría. Exigirla
   * hace que el compilador cace al montaje que no la pasa.
   */
  columnas: DescargaColumna[];
  /** Nombre de la hoja y base del nombre del archivo. Distinto del de la general (R51). */
  titulo?: string;
  /** Texto del disparador. */
  label?: string;
  /** Nombre accesible del disparador; distinto del de los demás controles (R51). */
  ariaLabel?: string;
  /** `true` mientras la pantalla tiene una lectura en vuelo. */
  disabled?: boolean;
}

export function DescargarGestionesDialog({
  catalogo,
  accion,
  columnas,
  titulo = TITULO_DESCARGA,
  label = DISPARADOR_LABEL,
  ariaLabel = DISPARADOR_ARIA,
  disabled = false,
}: Readonly<DescargarGestionesDialogProps>) {
  const [abierto, setAbierto] = useState(false);

  /** Los ids del catálogo, en su orden: el universo de lo elegible y el defecto de la selección. */
  const idsCatalogo = useMemo(
    () => catalogo.mensajeros.map((mensajero) => mensajero.id),
    [catalogo.mensajeros],
  );

  /**
   * Ids de los mensajeros elegidos. El conjunto del archivo, y nada más (R30/R33).
   *
   * `null` significa **«el usuario no ha tocado nada», que es TODOS** (pedido humano
   * 2026-08-19), y no se guarda como una copia de los ids por un motivo concreto: el catálogo lo
   * resuelve el servidor y su prop tiene por defecto el catálogo VACÍO. Con
   * `useState(idsCatalogo)` esa lista quedaría congelada en lo que hubiera en el primer render y
   * el diálogo abriría sin nada marcado —lo contrario de lo que se pidió— sin que nada se ponga
   * rojo. Cualquier interacción escribe una lista explícita, incluida la vacía.
   */
  const [seleccion, setSeleccion] = useState<string[] | null>(null);
  const elegidos = seleccion ?? idsCatalogo;

  // FICHA 384: los dos extremos arrancan VACÍOS. El rango que recorte el archivo lo pone quien
  // descarga; esta ventana no aplica ninguno por su cuenta (ver la cabecera).
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const rangoInvertido = desde !== "" && hasta !== "" && desde > hasta;
  /** ¿El usuario acotó por fecha? Elige CUÁL de los dos avisos de «no hay nada» se dice. */
  const conRango = desde !== "" || hasta !== "";

  function alternar(mensajeroId: string, marcado: boolean) {
    setSeleccion(
      marcado ? [...elegidos, mensajeroId] : elegidos.filter((id) => id !== mensajeroId),
    );
  }

  /**
   * «Todos» marca o desmarca la lista ENTERA de una vez. Desmarcar deja el conjunto VACÍO a
   * propósito y no vuelve al defecto: es la forma corta de decir «ninguno de éstos, sólo el que
   * marque ahora», y sin ella quedarse con un solo mensajero de una flota de veinte son
   * diecinueve clics. Confirmar así lo sigue cortando R39.
   */
  function alternarTodos(marcado: boolean) {
    setSeleccion(marcado ? [...idsCatalogo] : []);
  }

  /**
   * FICHA 384 — el atajo del caso diario: el cierre del día de toda la flota, en un clic.
   *
   * `fechaCalendarioCR` y no `toISOString().slice(0,10)`: aquél emite la fecha en UTC, así que a
   * partir de las 18:00 de CR devolvería el día SIGUIENTE y el atajo pondría un rango de mañana
   * a mañana, vacío de cierres. Y se calcula AL PULSAR, no al montar: una pestaña abierta desde
   * ayer pondría el día de ayer si el valor se hubiera congelado en el primer render.
   */
  function ponerHoy() {
    const hoy = fechaCalendarioCR();
    setDesde(hoy);
    setHasta(hoy);
  }

  /**
   * Lo que viaja al borde: SOLO lo elegido en el diálogo (R34/R36). Las fechas que el usuario no
   * puso NO se declaran —`desde: undefined` no es «sin fecha», es una clave de más frente a una
   * lista blanca `.strict()`—, y el alcance no viaja: lo resuelve el servicio desde la sesión.
   */
  function recorteElegido(): FiltrosDescargaGestiones {
    return {
      mensajeroIds: elegidos as FiltrosDescargaGestiones["mensajeroIds"],
      ...(desde === "" ? {} : { desde }),
      ...(hasta === "" ? {} : { hasta }),
    };
  }

  /**
   * R39/R32: los dos casos en que NO se llama al servidor y NO se produce archivo. Se devuelve
   * el mismo contrato de error que usa el resto de descargas, así que el control lo dice por
   * toast y no genera nada.
   */
  async function obtenerFilas(): Promise<DescargaFilasResult> {
    if (elegidos.length === 0) {
      return { status: "error", mensaje: MENSAJE_SIN_MENSAJERO };
    }
    if (rangoInvertido) {
      return { status: "error", mensaje: MENSAJE_RANGO_INVERTIDO };
    }
    const resultado = await filasDesdeResultado(
      accion(recorteElegido()),
      filaDescargaGestionFundida,
    );
    // FICHA 384: el conjunto VACÍO se redacta aquí (ver `MENSAJE_SIN_DATOS_EN_RANGO`). El
    // comportamiento no cambia —no había archivo antes y no lo hay ahora—: cambia el texto, que
    // deja de culpar a unos filtros que el usuario pudo no haber puesto.
    if (resultado.status === "ok" && resultado.filas.length === 0) {
      return {
        status: "error",
        mensaje: conRango ? MENSAJE_SIN_DATOS_EN_RANGO : MENSAJE_SIN_DATOS,
      };
    }
    return resultado;
  }

  return (
    <>
      <Button
        type="button"
        variant="brand-outline"
        onClick={() => setAbierto(true)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
      >
        <Download aria-hidden="true" />
        {label}
      </Button>

      <Modal
        open={abierto}
        onOpenChange={setAbierto}
        title={MODAL_TITULO}
        description={MODAL_DESCRIPCION}
        // El confirmar del Modal se oculta a propósito: quien descarga es el control de
        // descarga de siempre, montado en el cuerpo. Así el archivo, el tope y los mensajes de
        // error salen del MISMO sitio que en las demás pantallas, en vez de reescribirse aquí.
        hideConfirm
        cancelLabel={CERRAR_LABEL}
        size="md"
      >
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{MENSAJEROS_LEGEND}</legend>
            {catalogo.mensajeros.length === 0 ? (
              <p className="text-sm text-muted-foreground">{SIN_MENSAJEROS_EN_ALCANCE}</p>
            ) : (
              <>
                {/* «Todos» va FUERA de la lista con scroll y separado por una línea: es un
                    control SOBRE los de abajo, no uno más de ellos. Dentro del `overflow-y-auto`
                    se perdería de vista al desplazarse por una flota larga, que es justo cuando
                    hace falta. Reusa `SelectAllCheckbox` —el mismo tri-estado de la cabecera del
                    `DataTable`, con su indeterminado cuando hay algunos— en vez de una cuarta
                    copia de la misma cuenta. */}
                <div className="flex items-center gap-2 border-b pb-2">
                  <SelectAllCheckbox
                    id="descarga-gestiones-todos"
                    selectableIds={idsCatalogo}
                    selectedIds={new Set(elegidos)}
                    onToggleAll={alternarTodos}
                    ariaLabel={TODOS_LABEL}
                  />
                  <Label
                    htmlFor="descarga-gestiones-todos"
                    className="cursor-pointer text-sm font-normal"
                  >
                    {TODOS_LABEL}
                  </Label>
                </div>
                <div className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
                  {catalogo.mensajeros.map((mensajero) => {
                    const id = `descarga-gestiones-mensajero-${mensajero.id}`;
                    return (
                      <div key={mensajero.id} className="flex items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={elegidos.includes(mensajero.id)}
                          onCheckedChange={(marcado) => alternar(mensajero.id, marcado === true)}
                        />
                        <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
                          {mensajero.nombre}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </fieldset>

          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="descarga-gestiones-desde">{DESDE_LABEL}</Label>
              <Input
                id="descarga-gestiones-desde"
                type="date"
                value={desde}
                onChange={(evento) => setDesde(evento.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="descarga-gestiones-hasta">{HASTA_LABEL}</Label>
              <Input
                id="descarga-gestiones-hasta"
                type="date"
                value={hasta}
                onChange={(evento) => setHasta(evento.target.value)}
                aria-invalid={rangoInvertido || undefined}
              />
            </div>
            {/* El atajo va CON los controles de fecha y no en el pie: es una forma de rellenarlos
                y se ve al mismo golpe de vista que lo que rellena. `self-end` lo alinea con los
                dos campos (h-8, igual que el botón) y no con sus etiquetas. */}
            <Button
              type="button"
              variant="outline"
              className="self-end"
              onClick={ponerHoy}
              aria-label={HOY_ARIA}
            >
              {HOY_LABEL}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{RANGO_AYUDA}</p>

          {rangoInvertido ? (
            <p role="alert" className="text-sm text-destructive">
              {MENSAJE_RANGO_INVERTIDO}
            </p>
          ) : null}

          <div className="flex justify-end">
            {/* El diálogo NO se cierra al descargar: el binario se arma en el navegador dentro
                de este control, y desmontarlo a mitad del vuelo sería cortar la generación del
                archivo que el usuario acaba de pedir. Se cierra cuando el usuario cierra. */}
            {/* SIN `ambitoColumnas`, y ahora por un motivo distinto al de la ficha 314.
                Entonces esta hoja se quedó sin selector porque `ColumnasPopover` era
                indivisible —ofrecía ocultar Y reordenar— y reordenar estas 29 columnas rompe el
                agrupado que las hace legibles. Hoy el selector SÍ sabe ofrecer solo la mitad
                (`permitirReordenar={false}`) y esta hoja fue su primera candidata, tal como
                aquel comentario anticipaba.

                Lo que cambia es DÓNDE vive el selector, no si existe: vive en el botón que abre
                esta ventana, junto a la elección del nivel de detalle, y de allí bajan las
                columnas ya resueltas por la prop. Declarar aquí el ámbito montaría un SEGUNDO
                selector dentro del diálogo —dos sitios para la misma decisión— y, peor, haría
                que dos módulos asignaran el mismo identificador de ámbito, que es justo lo que
                `ambito-columnas.guardia` prohíbe. */}
            <DescargarDatasetButton
              titulo={titulo}
              columnas={columnas}
              obtenerFilas={obtenerFilas}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
