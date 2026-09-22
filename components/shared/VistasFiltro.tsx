"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Bookmark, ChevronDown, Pencil, Trash2 } from "lucide-react";
import { Popover } from "@base-ui/react/popover";

import { Modal } from "@/components/shared/Modal";
import { VistaIncompletaAviso } from "@/components/shared/VistaIncompletaAviso";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";
import {
  actualizarVistaFiltro,
  eliminarVistaFiltro,
  guardarVistaFiltro,
  listarVistasFiltro,
  renombrarVistaFiltro,
} from "@/lib/actions/vistas-filtro";
import {
  MSG_VISTA,
  NOMBRE_VISTA_MAX,
  type SuperficieVista,
  type VistaFiltroDTO,
  type VistaFiltroError,
  type VistaFiltroPayload,
} from "@/lib/types/vista-filtro";
import {
  evaluarVista,
  type Aplicabilidad,
  type CatalogoVistas,
  type PartePerdida,
} from "@/lib/utils/vista-filtro-aplicabilidad";
import { cn } from "@/lib/utils";

// FICHA 453 (design §9, T4.2) — EL CONTROL DE VISTAS GUARDADAS, dentro de la barra compartida.
//
// Lo monta `BuscadorFiltros` cuando la pantalla pasa la prop `vistas`, y SOLO entonces: ausente,
// no se monta nada (R31). Va al PRINCIPIO de la fila —antes del campo y antes de los `children`—
// porque la lectura de la barra es «qué estoy mirando → afinarlo → limpiarlo», y porque el extremo
// derecho ya lo ocupa «Limpiar todo», que aparece y desaparece: un control al lado de otro que
// baila es un control que hay que buscar (R36).
//
// ⚠️ ESTE CONTROL NO APLICA NADA POR SU CUENTA (R16, R19). Decide QUÉ se puede reponer y se lo
// entrega al consumidor por `onAplicar`; quien es dueño del filtro de la pantalla es él. Por eso
// aquí no hay ninguna traducción al transporte, ninguna consulta al listado y ninguna escritura al
// aplicar: las únicas cuatro escrituras son guardar, renombrar, actualizar y borrar.
//
// ⚠️ LA LISTA SE PIDE AL ABRIR, NO AL MONTAR. Es deliberado y se mide en las otras pantallas: la
// barra la montan dieciséis consumidores, y una petición al entrar sería una consulta más por
// pantalla para una lista que casi siempre no se mira. Con la clave a `null` hasta la primera
// apertura, `/ordenes` no pide nada hasta que alguien pulsa el botón.

/** Lo que la pantalla tiene que pasarle a la barra para encender las vistas. */
export interface VistasFiltroBarra {
  /**
   * El juego de filtros de esta pantalla, declarado en `SUPERFICIES_VISTA`. No es la ruta:
   * una misma ruta puede montar la barra con juegos distintos (design §10).
   */
  superficie: SuperficieVista;
  /** Lo que la barra tiene puesto AHORA, en el formato guardado. Es lo que se guarda. */
  filtroActual: VistaFiltroPayload;
  /**
   * Las opciones de la pantalla CON SU ESTADO DICHO EN VOZ ALTA. Si no están resueltas, aquí
   * no se clasifica ninguna vista como incompleta ni se aplica ninguna (R29): «el catálogo no
   * está» no es «el valor desapareció», y confundirlos marcaría todas las vistas como rotas a
   * la vez por una lectura que falló medio segundo antes.
   */
  catalogo: CatalogoVistas;
  /** La vista que está puesta ahora mismo, o `null`. La posee el consumidor (R22). */
  vistaPuestaId: string | null;
  /**
   * Repón este filtro en la pantalla. Lo que llega es lo APLICABLE —puede venir recortado si
   * la persona eligió «Aplicar sin eso»—, nunca lo guardado a secas.
   */
  onAplicar: (vistaId: string, filtro: VistaFiltroPayload) => void;
  /**
   * Acaba de guardarse una vista con el filtro que ya está en pantalla, así que esa vista ES la
   * puesta. Sin esto habría que aplicarla para poder ofrecer «Guardar cambios», que es un viaje
   * de ida y vuelta por un estado que ya se conoce.
   */
  onGuardada?: (vistaId: string) => void;
}

/**
 * Mismo alto que el campo y que el selector de filtros (`h-8`): dos controles a distinta altura
 * en la misma fila se leen como dos filas mal alineadas.
 */
const ALTO_CONTROL = "h-8";

/**
 * Los textos visibles. Ninguno usa jerga (R39): aquí no se dice «selección», «payload», «clave»
 * ni «superficie» — se dice «filtros», «vista» y «pantalla», que es lo que la persona ve.
 */
const TXT = {
  disparador: "Vistas",
  nombreAccesible: "Vistas guardadas",
  sinVistas: "Todavía no has guardado ninguna vista en esta pantalla.",
  cargando: "Cargando tus vistas…",
  noSePudoLeer: "No se pudieron cargar tus vistas. Vuelve a abrir esto en un momento.",
  guardar: "Guardar filtros actuales…",
  guardarCambios: (nombre: string) => `Guardar cambios en «${nombre}»`,
  puesta: "Puesta ahora",
  incompleta: "Incompleta",
  renombrar: (nombre: string) => `Cambiar el nombre de «${nombre}»`,
  borrar: (nombre: string) => `Borrar «${nombre}»`,
  aplicar: (nombre: string) => `Aplicar «${nombre}»`,
  ilegible: "Se guardó con una versión del sistema que esta pantalla ya no entiende. Puedes cambiarle el nombre o borrarla.",
  tituloGuardar: "Guardar los filtros de ahora",
  tituloRenombrar: "Cambiar el nombre de la vista",
  tituloBorrar: "Borrar la vista",
  campoNombre: "Nombre",
  pistaNombre: `Como lo vas a reconocer mañana. Hasta ${NOMBRE_VISTA_MAX} caracteres.`,
  confirmarGuardar: "Guardar",
  confirmarRenombrar: "Cambiar el nombre",
  confirmarBorrar: "Borrar",
  borrarAviso: (nombre: string) =>
    `Se va a borrar «${nombre}». No hay forma de recuperarla.`,
  guardada: (nombre: string) => `Vista «${nombre}» guardada.`,
  renombrada: (nombre: string) => `Ahora se llama «${nombre}».`,
  actualizada: (nombre: string) => `«${nombre}» quedó con los filtros de ahora.`,
  borrada: (nombre: string) => `Vista «${nombre}» borrada.`,
  errorGenerico: "No se pudo completar. Inténtalo otra vez.",
  sesionCaida: "Tu sesión se cerró. Vuelve a entrar para seguir.",
  yaNoEsta: "Esa vista ya no está.",
} as const;

/** Qué formulario hay abierto encima del listado. `null` = ninguno. */
type Formulario =
  | { tipo: "guardar" }
  | { tipo: "renombrar"; vista: VistaFiltroDTO }
  | { tipo: "borrar"; vista: VistaFiltroDTO }
  | { tipo: "incompleta"; vista: VistaFiltroDTO; aplicable: VistaFiltroPayload; perdidas: PartePerdida[] };

/**
 * R13 y las reglas de nombre, traducidas a UNA frase para la persona.
 *
 * Los mensajes de nombre y de «no hay nada que guardar» llegan REDACTADOS desde el servidor, con
 * su número dentro; aquí no se reescriben. El de nombre duplicado es el único que compone la
 * pantalla, porque `conflict` no lleva carga y el nombre solo lo sabe quien lo acaba de teclear.
 */
function mensajeDeError(error: VistaFiltroError, nombre: string): string {
  switch (error.status) {
    case "validation_error": {
      const [primero] = [
        ...(error.fieldErrors.nombre ?? []),
        ...(error.fieldErrors.filtro ?? []),
        ...Object.values(error.fieldErrors).flat(),
      ];
      return primero ?? TXT.errorGenerico;
    }
    case "conflict":
      return MSG_VISTA.nombreEnUso(nombre);
    case "limite_excedido":
      return `Ya tienes ${error.actuales} vistas guardadas en esta pantalla y el máximo es ${error.maximo}. Borra alguna para guardar otra.`;
    case "not_found":
      return TXT.yaNoEsta;
    case "unauthenticated":
      return TXT.sesionCaida;
    default:
      return TXT.errorGenerico;
  }
}

/** Las vistas de esta persona en esta pantalla, ya ordenadas por nombre en el servidor. */
async function cargarVistas(superficie: SuperficieVista): Promise<VistaFiltroDTO[]> {
  const res = await listarVistasFiltro({ superficie });
  if (res.status !== "ok") throw new Error(res.status);
  return res.vistas;
}

export function VistasFiltro({
  superficie,
  filtroActual,
  catalogo,
  vistaPuestaId,
  onAplicar,
  onGuardada,
}: Readonly<VistasFiltroBarra>) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  // Una vez pedida, la lista se queda: cerrar el panel no tira la caché ni obliga a volver a
  // consultar. Lo que se evita es la PRIMERA consulta de quien nunca abre esto.
  const [pedida, setPedida] = useState(false);
  const [formulario, setFormulario] = useState<Formulario | null>(null);
  const [nombre, setNombre] = useState("");
  const [errorFormulario, setErrorFormulario] = useState<string | null>(null);

  const { data, error, isLoading, mutate } = useSWR(
    pedida ? ["vistas-filtro", superficie] : null,
    () => cargarVistas(superficie),
  );
  // Con `useMemo` y no con `data ?? []` a secas: mientras SWR no tiene datos, esa expresión
  // fabrica un array nuevo en cada render y esa identidad inestable se propaga al memo de los
  // veredictos, que se recalcularía siempre.
  const vistas = useMemo(() => data ?? [], [data]);

  /**
   * El veredicto de cada vista contra el catálogo de AHORA (R24, R28). Se recalcula cuando
   * cambian las vistas o el catálogo, así que la marca de «incompleta» desaparece sola en cuanto
   * la vista se actualiza (R15) — y no antes, porque aplicar no escribe nada (R16).
   */
  const veredictos = useMemo<Map<string, Aplicabilidad>>(
    () => new Map(vistas.map((v) => [v.id, evaluarVista(catalogo, v.filtro)])),
    [vistas, catalogo],
  );

  const vistaPuesta = vistas.find((v) => v.id === vistaPuestaId) ?? null;

  function abrirPanel(siguiente: boolean) {
    if (siguiente) setPedida(true);
    setAbierto(siguiente);
  }

  function cerrarFormulario() {
    setFormulario(null);
    setErrorFormulario(null);
    setNombre("");
  }

  /**
   * R25/R30 — elegir una vista NO cambia el filtro hasta que se sabe que se puede reponer entera.
   * Con partes perdidas se abre el aviso y no se toca NADA; ilegible y «no se puede comprobar» ni
   * siquiera llegan aquí, porque su botón está deshabilitado.
   */
  function alElegir(vista: VistaFiltroDTO) {
    const veredicto = veredictos.get(vista.id);
    if (veredicto === undefined) return;
    if (veredicto.estado === "aplicable_entera") {
      setAbierto(false);
      onAplicar(vista.id, veredicto.aplicable);
      return;
    }
    if (veredicto.estado === "incompleta") {
      setAbierto(false);
      setFormulario({
        tipo: "incompleta",
        vista,
        aplicable: veredicto.aplicable,
        perdidas: veredicto.perdidas,
      });
    }
  }

  async function confirmarGuardar() {
    const res = await guardarVistaFiltro({ superficie, nombre, filtro: filtroActual });
    if (res.status !== "ok") {
      setErrorFormulario(mensajeDeError(res, nombre));
      return;
    }
    await mutate();
    // Lo que se acaba de guardar es exactamente lo que está puesto, así que esa vista ES la
    // puesta: sin esto habría que aplicarla para poder ofrecer «Guardar cambios».
    onGuardada?.(res.vista.id);
    toast.success(TXT.guardada(res.vista.nombre));
    cerrarFormulario();
  }

  async function confirmarRenombrar(vista: VistaFiltroDTO) {
    const res = await renombrarVistaFiltro({ id: vista.id, nombre });
    if (res.status !== "ok") {
      setErrorFormulario(mensajeDeError(res, nombre));
      return;
    }
    await mutate();
    toast.success(TXT.renombrada(res.vista.nombre));
    cerrarFormulario();
  }

  async function confirmarBorrar(vista: VistaFiltroDTO) {
    const res = await eliminarVistaFiltro({ id: vista.id });
    if (res.status !== "ok") {
      setErrorFormulario(mensajeDeError(res, vista.nombre));
      return;
    }
    await mutate();
    toast.success(TXT.borrada(vista.nombre));
    cerrarFormulario();
  }

  /** R15 — reemplaza el filtro guardado de la vista puesta por el que hay en pantalla. */
  async function guardarCambios(vista: VistaFiltroDTO) {
    const res = await actualizarVistaFiltro({ id: vista.id, filtro: filtroActual });
    if (res.status !== "ok") {
      toast.error(mensajeDeError(res, vista.nombre));
      return;
    }
    await mutate();
    toast.success(TXT.actualizada(res.vista.nombre));
    setAbierto(false);
  }

  return (
    <>
      <Popover.Root open={abierto} onOpenChange={abrirPanel}>
        <Popover.Trigger
          aria-label={TXT.nombreAccesible}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "shrink-0 gap-2 font-normal",
            ALTO_CONTROL,
          )}
        >
          <Bookmark className="size-4" aria-hidden />
          {TXT.disparador}
          <ChevronDown
            className={cn("size-4 opacity-60 transition-transform", abierto && "rotate-180")}
            aria-hidden
          />
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Positioner sideOffset={4} align="start" className="z-50">
            <Popover.Popup
              aria-label={TXT.nombreAccesible}
              className="flex w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none"
            >
              {isLoading ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">{TXT.cargando}</p>
              ) : null}

              {/* Una lectura que falla SÍ es un error y se dice; no tener vistas NO lo es (R38). */}
              {error ? (
                <p role="alert" className="px-4 py-3 text-sm text-destructive">
                  {TXT.noSePudoLeer}
                </p>
              ) : null}

              {!isLoading && !error && vistas.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">{TXT.sinVistas}</p>
              ) : null}

              {vistas.length > 0 ? (
                <ul className="flex max-h-72 flex-col overflow-y-auto py-1">
                  {vistas.map((vista) => {
                    const veredicto = veredictos.get(vista.id);
                    const sePuedeAplicar =
                      veredicto?.estado === "aplicable_entera" ||
                      veredicto?.estado === "incompleta";
                    const motivo =
                      veredicto?.estado === "no_comprobable"
                        ? veredicto.motivo
                        : veredicto?.estado === "ilegible"
                          ? TXT.ilegible
                          : null;
                    return (
                      <li key={vista.id} className="flex items-start gap-1 px-2 py-1">
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            disabled={!sePuedeAplicar}
                            aria-label={TXT.aplicar(vista.nombre)}
                            className={cn(
                              "w-full rounded-sm px-2 py-1 text-left text-sm",
                              sePuedeAplicar
                                ? "hover:bg-accent hover:text-accent-foreground"
                                : "cursor-not-allowed opacity-60",
                              vista.id === vistaPuestaId && "font-medium",
                            )}
                            onClick={() => alElegir(vista)}
                          >
                            <span className="block truncate">{vista.nombre}</span>
                          </button>
                          <div className="flex flex-wrap gap-1 px-2">
                            {vista.id === vistaPuestaId ? (
                              <span className="text-xs text-muted-foreground">{TXT.puesta}</span>
                            ) : null}
                            {/* R28 — la marca vive mientras la vista no sea aplicable entera, con
                                su motivo alcanzable en el mismo sitio. */}
                            {veredicto?.estado === "incompleta" ? (
                              <span
                                className="text-xs font-medium text-amber-700 dark:text-amber-400"
                                title={veredicto.perdidas.map((p) => p.detalle).join(" ")}
                              >
                                {TXT.incompleta}
                              </span>
                            ) : null}
                            {motivo ? (
                              <span className="text-xs text-muted-foreground">{motivo}</span>
                            ) : null}
                          </div>
                        </div>
                        {/* R14 — renombrar y borrar, desde el primer día y sin salir del listado. */}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={TXT.renombrar(vista.nombre)}
                          onClick={() => {
                            setNombre(vista.nombre);
                            setErrorFormulario(null);
                            setFormulario({ tipo: "renombrar", vista });
                            setAbierto(false);
                          }}
                        >
                          <Pencil className="size-4" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={TXT.borrar(vista.nombre)}
                          onClick={() => {
                            setErrorFormulario(null);
                            setFormulario({ tipo: "borrar", vista });
                            setAbierto(false);
                          }}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              <div className="flex flex-col gap-1 border-t border-border p-2">
                {/* R38 — sin ninguna vista guardada esto es lo único que hay, y no es un error. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  onClick={() => {
                    setNombre("");
                    setErrorFormulario(null);
                    setFormulario({ tipo: "guardar" });
                    setAbierto(false);
                  }}
                >
                  {TXT.guardar}
                </Button>
                {vistaPuesta ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="justify-start"
                    onClick={() => void guardarCambios(vistaPuesta)}
                  >
                    {TXT.guardarCambios(vistaPuesta.nombre)}
                  </Button>
                ) : null}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      {/* Los formularios y las confirmaciones van en `Modal` y no dentro del panel: el nombre pide
          un campo y un botón, y meterlos en un popover de la barra empuja la tabla. */}
      <Modal
        open={formulario?.tipo === "guardar"}
        onOpenChange={(v) => (v ? undefined : cerrarFormulario())}
        title={TXT.tituloGuardar}
        confirmLabel={TXT.confirmarGuardar}
        closeOnConfirm={false}
        size="sm"
        onConfirm={confirmarGuardar}
        onCancel={cerrarFormulario}
      >
        <CampoNombre
          valor={nombre}
          onChange={setNombre}
          error={errorFormulario}
        />
      </Modal>

      <Modal
        open={formulario?.tipo === "renombrar"}
        onOpenChange={(v) => (v ? undefined : cerrarFormulario())}
        title={TXT.tituloRenombrar}
        confirmLabel={TXT.confirmarRenombrar}
        closeOnConfirm={false}
        size="sm"
        onConfirm={() =>
          formulario?.tipo === "renombrar"
            ? confirmarRenombrar(formulario.vista)
            : undefined
        }
        onCancel={cerrarFormulario}
      >
        <CampoNombre
          valor={nombre}
          onChange={setNombre}
          error={errorFormulario}
        />
      </Modal>

      {/* R17 — la confirmación NOMBRA la vista. Sin el nombre, «¿Borrar esta vista?» con el panel
          ya cerrado detrás es una pregunta que no se puede responder. */}
      <Modal
        open={formulario?.tipo === "borrar"}
        onOpenChange={(v) => (v ? undefined : cerrarFormulario())}
        title={TXT.tituloBorrar}
        description={
          formulario?.tipo === "borrar" ? TXT.borrarAviso(formulario.vista.nombre) : undefined
        }
        confirmLabel={TXT.confirmarBorrar}
        confirmVariant="destructive"
        closeOnConfirm={false}
        size="sm"
        onConfirm={() =>
          formulario?.tipo === "borrar" ? confirmarBorrar(formulario.vista) : undefined
        }
        onCancel={cerrarFormulario}
      >
        {errorFormulario ? (
          <p role="alert" className="text-sm text-destructive">
            {errorFormulario}
          </p>
        ) : null}
      </Modal>

      <VistaIncompletaAviso
        open={formulario?.tipo === "incompleta"}
        nombre={formulario?.tipo === "incompleta" ? formulario.vista.nombre : ""}
        perdidas={formulario?.tipo === "incompleta" ? formulario.perdidas : []}
        onAplicarSinEso={() => {
          if (formulario?.tipo !== "incompleta") return;
          // R27 — se aplica EXCLUSIVAMENTE lo aplicable, y no se llama a ninguna escritura: la
          // vista guardada se queda como estaba y sigue marcada incompleta (R16, R28).
          onAplicar(formulario.vista.id, formulario.aplicable);
          cerrarFormulario();
        }}
        onCancelar={cerrarFormulario}
      />
    </>
  );
}

/** El campo del nombre, con su error debajo. Se repite en guardar y en renombrar (R14). */
function CampoNombre({
  valor,
  onChange,
  error,
}: Readonly<{ valor: string; onChange: (v: string) => void; error: string | null }>) {
  return (
    <div className="flex flex-col gap-1">
      <Input
        autoFocus
        value={valor}
        aria-label={TXT.campoNombre}
        aria-invalid={error !== null || undefined}
        placeholder={TXT.campoNombre}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{TXT.pistaNombre}</p>
      )}
    </div>
  );
}
