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
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";
import type {
  CatalogoFiltrosCierresDTO,
  FiltrosDescargaGestiones,
} from "@/lib/types/filtros-cierres";

import {
  COLUMNAS_DESCARGA_GESTIONES_FUNDIDA,
  filaDescargaGestionFundida,
} from "./cierres-gestiones-fundida-descarga-columnas";

/**
 * Feature 230 (T4.1, design §7) — el DIÁLOGO de la descarga DETALLADA de cierres: elegir uno o
 * varios mensajeros y, opcionalmente, un rango de fechas, y bajarse la hoja fundida (una fila
 * por GESTIÓN).
 *
 * **UN componente para las DOS pantallas.** Lo único que cambia entre `cierres-admin` y los
 * cierres de bodega del maestro es la Server Action, que llega por prop (`accion`). No es un
 * lujo: los dos listados cubren conjuntos DISJUNTOS (design §2.6 — el maestro solo ve la GAM en
 * cierres del día, y lo satélite solo consolidado en cierres de bodega), así que hacen falta dos
 * bordes; pero las 27 columnas, la proyección y esta interacción son las mismas, y duplicarlas
 * sería garantizar que divergen (R26).
 *
 * **El conjunto lo redacta ESTE diálogo, no la pantalla** (D11, R34/R35). El componente no
 * recibe, no lee y no modifica los filtros de la barra: lo único que sale de aquí hacia el borde
 * son `mensajeroIds` y, si el usuario los puso, `desde`/`hasta`. Es una cesión consciente de la
 * mitad «el archivo es lo que la pantalla enseña» de la puerta única (design §4): aquí no se
 * RECONSTRUYE ningún criterio de pantalla —no hay ninguno que replicar—, y el diálogo es
 * explícito sobre qué se va a llevar.
 *
 * **Los controles de fecha no son una comodidad** (R31): sin ellos el conjunto por defecto sería
 * todo el histórico del mensajero, que a grano de gestión choca contra el tope de 5000 filas casi
 * siempre y convierte el botón en uno que solo sabe fallar.
 *
 * **LOS VALORES POR DEFECTO (pedido humano 2026-08-19)**: se abre con TODOS los mensajeros del
 * alcance marcados y con el rango puesto en el DÍA DE HOY (calendario de Costa Rica) en sus dos
 * extremos. Es la descarga que se pide a diario —el cierre del día de toda la flota— y antes
 * costaba dos clics de fecha más uno por cada mensajero.
 *
 * Lo que ese defecto NO cambia: siguen siendo controles, no una decisión tomada por el diálogo.
 * Se pueden desmarcar todos (y entonces R39 corta, como siempre) y se puede vaciar cualquiera de
 * las dos fechas para ensanchar la ventana; una fecha vacía sigue significando «sin ese extremo»
 * y no viaja al borde. Y el defecto de fechas hace MÁS cierto el párrafo de arriba: el conjunto
 * inicial ya no es todo el histórico de nadie.
 *
 * **Sin mensajeros elegidos no se llama al servidor** (R39): «ninguno» no es «todos», es una
 * llamada que no debió ocurrir. Se corta aquí, y el borde lo corta otra vez con su lista blanca.
 *
 * La generación del archivo, el tope, los mensajes accionables y el binario los pone
 * `DescargarDatasetButton` + `filasDesdeResultado`, exactamente igual que la descarga general.
 * De ahí sale D12/R38 gratis: «este mensajero no tiene cierres en el rango» y «este mensajero no
 * es de tu alcance» llegan los dos como `{ ok, items: [] }` y el control dice lo MISMO, porque no
 * hay ninguna rama que los distinga.
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
const DISPARADOR_LABEL = "Descargar detallada";
const DISPARADOR_ARIA = "Descargar detallada por mensajero";
const MODAL_TITULO = "Descargar gestiones por mensajero";
const MODAL_DESCRIPCION =
  "Una fila por gestión, cruzando los cierres de los mensajeros que elijas. Esta descarga es independiente de los filtros de la pantalla: lo que se lleva es lo que elijas acá.";
const MENSAJEROS_LEGEND = "Mensajeros";
const TODOS_LABEL = "Todos";
const SIN_MENSAJEROS_EN_ALCANCE = "No hay mensajeros en tu alcance.";
const DESDE_LABEL = "Desde";
const HASTA_LABEL = "Hasta";
const RANGO_AYUDA =
  "Recorta por la fecha de solicitud del cierre. Arranca en el día de hoy; vaciá una fecha para quitar ese extremo.";
const CERRAR_LABEL = "Cerrar";

/** R39: el aviso accionable de confirmar sin nadie elegido. No se llama al servidor. */
const MENSAJE_SIN_MENSAJERO =
  "Elegí al menos un mensajero para descargar sus gestiones. Sin mensajeros no hay archivo.";
/** R32: el rango invertido se corta acá; el borde lo vuelve a rechazar con su schema. */
const MENSAJE_RANGO_INVERTIDO =
  "El rango de fechas está invertido: «Desde» tiene que ser anterior o igual a «Hasta».";

export interface DescargarGestionesDialogProps {
  /** Opciones YA acotadas al alcance del actor, resueltas en el servidor (R29). */
  catalogo: CatalogoFiltrosCierresDTO;
  /** El ÚNICO punto de entrada de servidor de esta descarga en esta pantalla (R13). */
  accion: AccionGestionesDescarga;
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

  // El rango arranca en HOY, los dos extremos. Calendario de Costa Rica y no `toISOString()`:
  // aquél emite la fecha en UTC, así que a partir de las 18:00 CR ya devuelve el día siguiente y
  // el diálogo abriría con un rango de mañana a mañana, vacío de cierres.
  const [desde, setDesde] = useState(() => fechaCalendarioCR());
  const [hasta, setHasta] = useState(() => fechaCalendarioCR());

  const rangoInvertido = desde !== "" && hasta !== "" && desde > hasta;

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
    return filasDesdeResultado(accion(recorteElegido()), filaDescargaGestionFundida);
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
            <DescargarDatasetButton
              titulo={titulo}
              columnas={COLUMNAS_DESCARGA_GESTIONES_FUNDIDA}
              obtenerFilas={obtenerFilas}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
