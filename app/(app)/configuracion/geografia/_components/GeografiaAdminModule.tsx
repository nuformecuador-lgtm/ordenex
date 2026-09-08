"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";

import { FormField } from "@/components/shared/FormField";
import { Modal } from "@/components/shared/Modal";
import { SegmentedToggle } from "@/components/shared/SegmentedToggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";
import {
  cambiarActivacionGeografica,
  contarOrdenesSinEntregarDeNodo,
  crearNodoGeografico,
  listarArbolGeografico,
  renombrarNodoGeografico,
} from "@/lib/actions/geografia";
import {
  GEO_NOMBRE_MAX,
  NIVEL_LABELS,
  normalizarNombreGeografico,
  type NivelGeografico,
  type ProvinciaArbolDTO,
} from "@/lib/types/geografia-nodo";
import {
  filtrarArbolGeografico,
  type FiltroEstadoGeografico,
} from "@/app/(app)/configuracion/_shared/filtrar-arbol-geografico";
import {
  AYUDA_SIN_ZONA,
  MARCA_SIN_ZONA,
  estadoGeografico,
  etiquetaEstadoGeografico,
  motivoActivarApagado,
  type EstadoGeografico,
} from "@/app/(app)/configuracion/_shared/geografia-estado-label";

import { zonasQueQuedarianSinDistritos } from "./zonas-sin-distritos";

// FICHA 374 (design §7.2, §7.3 y §7.5) — LA ADMINISTRACION DEL CATALOGO GEOGRAFICO.
//
// ⚠️ POR QUE ESTE ARBOL ES NUEVO Y NO SE EXTRAJO DE `GeografiaSelector`. Aquel componente es, EN SU
// TOTALIDAD, una seleccion multiple de hojas con cascada tri-estado: `selDist` es su fuente de
// verdad, `stateFor` deriva el estado de los padres y `toggleGrupo` marca en bloque. Esta pantalla
// no tiene seleccion: tiene ACCIONES POR FILA. Compartir el componente obligaria a inventarle un
// modo sin casillas dentro de un componente cuyo unico tema son las casillas.
//
// LO QUE SI SE COMPARTE es lo que de verdad es comun: el filtro de texto, promovido a
// `_shared/filtrar-arbol-geografico.ts` y ahora con `normalizeName` en vez de la tercera copia de
// una normalizacion que ya existia dos veces.
//
// ⚠️ QUITAR NO ES BORRAR. No hay ninguna accion de borrado (R5): retirar un nodo es apagar SU
// flag, y ni siquiera toca a sus descendientes (R8) ni a `zona_distrito` (R50). Por eso reactivar
// devuelve el arbol exactamente como estaba (R9).
//
// ⭑ FICHA 375 — RENOMBRAR YA EXISTE. La 374 lo dejo fuera por una causa medida, no por gusto:
// mientras `scripts/seed-zonas.ts` cruzara por NOMBRE, renombrar un distrito hacia que la
// siguiente corrida del seed creara un DUPLICADO ACTIVO con el nombre viejo, y a partir de ahi
// toda carga masiva que lo mencionara moria con «distrito ambiguo en el canton». La 375 le da al
// catalogo una clave estable (`codigo_dta`), el seed cruza por ella y el nombre pasa a ser una
// ETIQUETA. Por eso el boton de esta pantalla puede existir.

type FieldErrors = Record<string, string[]>;

/** El formulario de alta, con su padre YA fijado por la fila desde la que se abrio (R43). */
interface AltaEnCurso {
  nivel: NivelGeografico;
  /** `null` solo para provincia, que no tiene padre. */
  padreId: string | null;
  padreNombre: string | null;
}

/** El nodo cuya retirada se esta confirmando. */
interface NodoObjetivo {
  nivel: NivelGeografico;
  id: string;
  nombre: string;
}

/** El conteo de ordenes sin entregar de la confirmacion (R60/R62). */
type EstadoConteo =
  | { estado: "cargando" }
  | { estado: "ok"; ordenes: number }
  | { estado: "error" };

const OPCIONES_ESTADO: readonly { valor: FiltroEstadoGeografico; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "activos", etiqueta: "Activos" },
  { valor: "retirados", etiqueta: "Retirados" },
];

export interface GeografiaAdminModuleProps {
  initialProvincias: ProvinciaArbolDTO[];
}

export function GeografiaAdminModule({
  initialProvincias,
}: Readonly<GeografiaAdminModuleProps>) {
  const toast = useToast();

  const [provincias, setProvincias] = useState<ProvinciaArbolDTO[]>(initialProvincias);
  const [cargaError, setCargaError] = useState(false);

  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<FiltroEstadoGeografico>("todos");
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  const [alta, setAlta] = useState<AltaEnCurso | null>(null);
  const [nombre, setNombre] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [guardando, setGuardando] = useState(false);

  // FICHA 375 — el renombrado. Estado APARTE del alta y no reutilizado: son dos formularios con
  // dos desenlaces distintos, y compartir el suyo obligaria a un `modo` que hay que leer dos veces
  // para saber que hace el boton Guardar.
  const [renombrado, setRenombrado] = useState<NodoObjetivo | null>(null);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const [erroresRenombrado, setErroresRenombrado] = useState<FieldErrors>({});
  const [renombrando, setRenombrando] = useState(false);

  const [alternando, setAlternando] = useState<string | null>(null);
  const [objetivo, setObjetivo] = useState<NodoObjetivo | null>(null);
  const [conteo, setConteo] = useState<EstadoConteo>({ estado: "cargando" });
  const peticionDeConteo = useRef(0);

  /**
   * R45 — toda operacion termina releyendo el arbol visible. No se parchea el estado en memoria:
   * el arbol es la unica verdad y un parche local diverge de la base a la primera carrera.
   */
  async function refetch() {
    try {
      const res = await listarArbolGeografico();
      if (res.status === "ok") {
        setProvincias(res.provincias);
        setCargaError(false);
      } else {
        setCargaError(true);
      }
    } catch {
      setCargaError(true);
    }
  }

  // R58/R59 — el filtro es UN calculo sobre el arbol que el cliente ya tiene: cambiarlo no dispara
  // ni una llamada al servidor.
  const filtradas = useMemo(
    () => filtrarArbolGeografico(provincias, { texto, estado }),
    [provincias, texto, estado],
  );

  // Con un filtro puesto, el arbol ya viene recortado: dejarlo plegado obligaria a abrir a mano lo
  // que uno acaba de pedir. Sin filtro, 494 distritos desplegados no son una pantalla.
  const filtrando = texto.trim() !== "" || estado !== "todos";
  const abierto = (id: string) => filtrando || expandidos.has(id);

  function alternarExpansion(id: string) {
    setExpandidos((previos) => {
      const siguiente = new Set(previos);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }

  /**
   * R60 — abre la confirmacion Y pide el conteo, en el mismo gesto.
   *
   * Se pide AQUI y no en un efecto por dos motivos: es una consulta por cada DECISION y no por
   * cada fila pintada, y un efecto que llama a `setState` en su cuerpo encadena renders (lo veta
   * `react-hooks/set-state-in-effect`). El testigo descarta las respuestas de una confirmacion ya
   * cerrada o sustituida: sin el, cerrar y abrir otra pintaria el numero del nodo anterior.
   */
  function abrirConfirmacion(nodo: NodoObjetivo) {
    setObjetivo(nodo);
    setConteo({ estado: "cargando" });
    peticionDeConteo.current += 1;
    const testigo = peticionDeConteo.current;
    void (async () => {
      try {
        const res = await contarOrdenesSinEntregarDeNodo({ nivel: nodo.nivel, id: nodo.id });
        if (testigo !== peticionDeConteo.current) return;
        // R62 — cualquier desenlace que no sea `ok` es «no se pudo contar», y NO bloquea.
        setConteo(
          res.status === "ok" ? { estado: "ok", ordenes: res.ordenes } : { estado: "error" },
        );
      } catch {
        if (testigo === peticionDeConteo.current) setConteo({ estado: "error" });
      }
    })();
  }

  /** Cierra la confirmacion e invalida el conteo en vuelo. */
  function cerrarConfirmacion() {
    peticionDeConteo.current += 1;
    setObjetivo(null);
  }

  const zonasEnRiesgo = useMemo(
    () =>
      objetivo === null
        ? []
        : zonasQueQuedarianSinDistritos(provincias, {
            nivel: objetivo.nivel,
            id: objetivo.id,
          }),
    [provincias, objetivo],
  );

  function abrirAlta(nivel: NivelGeografico, padre: { id: string; nombre: string } | null) {
    setAlta({
      nivel,
      padreId: padre?.id ?? null,
      padreNombre: padre?.nombre ?? null,
    });
    setNombre("");
    setErrors({});
    // Los dos formularios son excluyentes: dos paneles abiertos con dos botones «Guardar» son dos
    // formas de equivocarse de fila.
    setRenombrado(null);
  }

  /** FICHA 375 — abre el formulario de renombrado con el nombre ACTUAL ya escrito. */
  function abrirRenombrado(nodo: NodoObjetivo) {
    setRenombrado(nodo);
    setNombreNuevo(nodo.nombre);
    setErroresRenombrado({});
    setAlta(null);
  }

  /** El cuerpo que espera el borde. Cada nivel manda EXACTAMENTE las claves que su schema admite:
   *  los tres son `.strict()`, asi que un `provinciaId` colado en un alta de provincia seria
   *  `validation_error` y no un campo ignorado en silencio. */
  function cuerpoDelAlta(enCurso: AltaEnCurso, nombreLimpio: string) {
    if (enCurso.nivel === "provincia") return { nivel: "provincia" as const, nombre: nombreLimpio };
    if (enCurso.nivel === "canton") {
      return { nivel: "canton" as const, nombre: nombreLimpio, provinciaId: enCurso.padreId ?? "" };
    }
    return { nivel: "distrito" as const, nombre: nombreLimpio, cantonId: enCurso.padreId ?? "" };
  }

  async function guardarAlta() {
    if (alta === null) return;
    // Se valida contra la MISMA normalizacion que aplica el servidor, para que nadie vea
    // «obligatorio» en un campo que a el le parece lleno de espacios.
    const limpio = normalizarNombreGeografico(nombre);
    if (limpio === "") {
      setErrors({ nombre: ["Este campo es obligatorio."] });
      return;
    }

    setGuardando(true);
    try {
      const res = await crearNodoGeografico(cuerpoDelAlta(alta, limpio));
      if (res.status === "ok") {
        toast.success(`${NIVEL_LABELS[alta.nivel]} «${limpio}» dado de alta.`);
        setAlta(null);
        await refetch();
        return;
      }
      if (res.status === "validation_error") {
        setErrors(res.fieldErrors);
        toast.error(mensajeDeValidacion(res.fieldErrors));
        await refetch();
        return;
      }
      if (res.status === "conflict") {
        setErrors({ nombre: [mensajeDeDesenlace("conflict")] });
      }
      toast.error(mensajeDeDesenlace(res.status));
      await refetch();
    } catch {
      toast.error(mensajeDeDesenlace("error"));
    } finally {
      setGuardando(false);
    }
  }

  /**
   * FICHA 375 — guarda el nombre nuevo.
   *
   * NO PIDE CONFIRMACION, y es deliberado: renombrar es reversible con otro renombrado y no deja
   * de ofrecer nada. La confirmacion se reserva para retirar, que es lo que si quita.
   *
   * GUARDAR SIN CAMBIOS FUNCIONA: el servidor devuelve `ok` cuando el nombre es el mismo (no
   * escribe ni audita), asi que aqui no hay ninguna comprobacion local que lo impida.
   */
  async function guardarRenombrado() {
    if (renombrado === null) return;
    const limpio = normalizarNombreGeografico(nombreNuevo);
    if (limpio === "") {
      setErroresRenombrado({ nombre: ["Este campo es obligatorio."] });
      return;
    }

    setRenombrando(true);
    try {
      const res = await renombrarNodoGeografico({
        nivel: renombrado.nivel,
        id: renombrado.id,
        nombre: limpio,
      });
      if (res.status === "ok") {
        toast.success(`${NIVEL_LABELS[renombrado.nivel]} «${renombrado.nombre}» ahora es «${limpio}».`);
        setRenombrado(null);
        await refetch();
        return;
      }
      if (res.status === "validation_error") {
        setErroresRenombrado(res.fieldErrors);
        toast.error(mensajeDeValidacion(res.fieldErrors));
        await refetch();
        return;
      }
      if (res.status === "conflict") {
        setErroresRenombrado({ nombre: [mensajeDeDesenlace("conflict")] });
      }
      toast.error(mensajeDeDesenlace(res.status));
      await refetch();
    } catch {
      toast.error(mensajeDeDesenlace("error"));
    } finally {
      setRenombrando(false);
    }
  }

  /**
   * ACTIVAR NO PIDE CONFIRMACION: es aditivo. Lo que hay que pensarse dos veces es retirar, que es
   * lo que deja de estar disponible para las cargas futuras.
   */
  async function activar(nodo: NodoObjetivo) {
    setAlternando(nodo.id);
    try {
      const res = await cambiarActivacionGeografica({
        nivel: nodo.nivel,
        id: nodo.id,
        activo: true,
      });
      if (res.status === "ok") {
        toast.success(`${NIVEL_LABELS[nodo.nivel]} «${nodo.nombre}» devuelto al catálogo.`);
      } else {
        toast.error(mensajeDeDesenlace(res.status));
      }
      await refetch();
    } catch {
      toast.error(mensajeDeDesenlace("error"));
    } finally {
      setAlternando(null);
    }
  }

  async function confirmarRetirada() {
    if (objetivo === null) return;
    const res = await cambiarActivacionGeografica({
      nivel: objetivo.nivel,
      id: objetivo.id,
      activo: false,
    });
    if (res.status === "ok") {
      toast.success(`${NIVEL_LABELS[objetivo.nivel]} «${objetivo.nombre}» retirado del catálogo.`);
      cerrarConfirmacion();
    } else {
      toast.error(mensajeDeDesenlace(res.status));
    }
    await refetch();
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Catálogo geográfico</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Provincias, cantones y distritos que la app ofrece al cargar y al corregir órdenes.
            Retirar un nodo no lo borra: deja de ofrecerse y se puede devolver cuando haga falta.
          </p>
        </div>
        <Button type="button" onClick={() => abrirAlta("provincia", null)}>
          <Plus aria-hidden="true" />
          Crear provincia
        </Button>
      </div>

      {cargaError ? (
        <Alert variant="destructive">
          <AlertDescription>No se pudo cargar el catálogo geográfico.</AlertDescription>
        </Alert>
      ) : null}

      {alta !== null ? (
        <div className="flex flex-col gap-4 rounded-md border border-border p-4">
          <h3 className="text-sm font-semibold">Nuevo {NIVEL_LABELS[alta.nivel].toLowerCase()}</h3>
          {alta.padreNombre !== null ? (
            <p className="text-sm text-muted-foreground">
              Dentro de {alta.padreNombre}.
            </p>
          ) : null}

          <FormField id="geografia-nombre" label="Nombre" error={errors.nombre} required>
            <Input
              value={nombre}
              maxLength={GEO_NOMBRE_MAX}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Cabagra, Buenos Aires, Puntarenas…"
            />
          </FormField>

          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => void guardarAlta()} loading={guardando}>
              {guardando ? "Guardando…" : "Guardar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAlta(null)}
              disabled={guardando}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      {/* FICHA 375 — el formulario de renombrado. El nombre es una ETIQUETA: cambiarlo no mueve el
          nodo ni toca su `codigo_dta`, que es su identidad para el seed y para las cargas. */}
      {renombrado !== null ? (
        <div className="flex flex-col gap-4 rounded-md border border-border p-4">
          <h3 className="text-sm font-semibold">
            Renombrar {NIVEL_LABELS[renombrado.nivel].toLowerCase()}
          </h3>
          <p className="text-sm text-muted-foreground">
            Se llama «{renombrado.nombre}». Cambiar el nombre no lo mueve ni lo retira: las órdenes
            que ya lo tienen siguen apuntando al mismo lugar.
          </p>

          <FormField
            id="geografia-nombre-nuevo"
            label="Nombre"
            error={erroresRenombrado.nombre}
            required
          >
            <Input
              value={nombreNuevo}
              maxLength={GEO_NOMBRE_MAX}
              onChange={(e) => setNombreNuevo(e.target.value)}
              placeholder="Cabagra, Buenos Aires, Puntarenas…"
            />
          </FormField>

          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => void guardarRenombrado()} loading={renombrando}>
              {renombrando ? "Guardando…" : "Guardar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenombrado(null)}
              disabled={renombrando}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          className="max-w-xs"
          placeholder="Buscar provincia, cantón o distrito…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          aria-label="Buscar en el catálogo geográfico"
        />
        <SegmentedToggle
          options={OPCIONES_ESTADO}
          valor={estado}
          onChange={setEstado}
          ariaLabel="Filtrar por estado"
        />
      </div>

      {filtradas.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
          Sin resultados.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {filtradas.map((provincia) => {
            const estadoProvincia = estadoGeografico({ provincia: provincia.activo });
            return (
              <li key={provincia.id} className="px-2 py-1">
                <FilaNodo
                  nivel="provincia"
                  id={provincia.id}
                  nombre={provincia.nombre}
                  estado={estadoProvincia}
                  detalle={`${provincia.cantones.length} ${
                    provincia.cantones.length === 1 ? "cantón" : "cantones"
                  }`}
                  expandible
                  expandido={abierto(provincia.id)}
                  onExpandir={() => alternarExpansion(provincia.id)}
                  alternando={alternando === provincia.id}
                  onActivar={() =>
                    void activar({
                      nivel: "provincia",
                      id: provincia.id,
                      nombre: provincia.nombre,
                    })
                  }
                  onRetirar={() =>
                    abrirConfirmacion({
                      nivel: "provincia",
                      id: provincia.id,
                      nombre: provincia.nombre,
                    })
                  }
                  onRenombrar={() =>
                    abrirRenombrado({
                      nivel: "provincia",
                      id: provincia.id,
                      nombre: provincia.nombre,
                    })
                  }
                  onAgregarHijo={() =>
                    abrirAlta("canton", { id: provincia.id, nombre: provincia.nombre })
                  }
                  etiquetaAgregarHijo={`Añadir cantón a ${provincia.nombre}`}
                  textoAgregarHijo="Añadir cantón"
                />

                {abierto(provincia.id) ? (
                  <ul className="ml-5 flex flex-col border-l border-border pl-2">
                    {provincia.cantones.map((canton) => {
                      const estadoCanton = estadoGeografico({
                        provincia: provincia.activo,
                        canton: canton.activo,
                      });
                      return (
                        <li key={canton.id}>
                          <FilaNodo
                            nivel="canton"
                            id={canton.id}
                            nombre={canton.nombre}
                            estado={estadoCanton}
                            detalle={`${canton.distritos.length} ${
                              canton.distritos.length === 1 ? "distrito" : "distritos"
                            }`}
                            expandible
                            expandido={abierto(canton.id)}
                            onExpandir={() => alternarExpansion(canton.id)}
                            alternando={alternando === canton.id}
                            onActivar={() =>
                              void activar({
                                nivel: "canton",
                                id: canton.id,
                                nombre: canton.nombre,
                              })
                            }
                            onRetirar={() =>
                              abrirConfirmacion({
                                nivel: "canton",
                                id: canton.id,
                                nombre: canton.nombre,
                              })
                            }
                            onRenombrar={() =>
                              abrirRenombrado({
                                nivel: "canton",
                                id: canton.id,
                                nombre: canton.nombre,
                              })
                            }
                            onAgregarHijo={() =>
                              abrirAlta("distrito", { id: canton.id, nombre: canton.nombre })
                            }
                            etiquetaAgregarHijo={`Añadir distrito a ${canton.nombre}`}
                            textoAgregarHijo="Añadir distrito"
                          />

                          {abierto(canton.id) ? (
                            <ul className="ml-5 flex flex-col border-l border-border pl-2">
                              {canton.distritos.map((distrito) => (
                                <li key={distrito.id}>
                                  <FilaNodo
                                    nivel="distrito"
                                    id={distrito.id}
                                    nombre={distrito.nombre}
                                    estado={estadoGeografico({
                                      provincia: provincia.activo,
                                      canton: canton.activo,
                                      distrito: distrito.activo,
                                    })}
                                    detalle={
                                      distrito.zonaNombre === null
                                        ? undefined
                                        : `zona: ${distrito.zonaNombre}`
                                    }
                                    sinZona={distrito.zonaId === null}
                                    alternando={alternando === distrito.id}
                                    onActivar={() =>
                                      void activar({
                                        nivel: "distrito",
                                        id: distrito.id,
                                        nombre: distrito.nombre,
                                      })
                                    }
                                    onRetirar={() =>
                                      abrirConfirmacion({
                                        nivel: "distrito",
                                        id: distrito.id,
                                        nombre: distrito.nombre,
                                      })
                                    }
                                    onRenombrar={() =>
                                      abrirRenombrado({
                                        nivel: "distrito",
                                        id: distrito.id,
                                        nombre: distrito.nombre,
                                      })
                                    }
                                  />
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* R44 — `closeOnConfirm={false}`: la ventana la cierra el desenlace, no el clic. */}
      <Modal
        open={objetivo !== null}
        onOpenChange={(abierta) => {
          if (!abierta) cerrarConfirmacion();
        }}
        title="Retirar del catálogo"
        confirmLabel="Retirar"
        cancelLabel="Cancelar"
        confirmVariant="destructive"
        closeOnConfirm={false}
        // R60 — mientras el conteo esta en vuelo no se puede confirmar: el dato es justo lo que
        // convierte la decision en informada. R62 — en cuanto se resuelve, ok o error, se habilita.
        confirmDisabled={conteo.estado === "cargando"}
        onConfirm={confirmarRetirada}
        onError={() => toast.error(mensajeDeDesenlace("error"))}
      >
        {/* R63 — TRES lineas y ni una mas: el nodo, las zonas y el conteo. La cuarta candidata
            («este nodo tiene cobertura») esta descartada: una confirmacion que avisa de todo no
            avisa de nada. */}
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>
            {objetivo === null
              ? ""
              : `Vas a retirar «${objetivo.nombre}» (${NIVEL_LABELS[objetivo.nivel]}).`}
          </li>
          {zonasEnRiesgo.length > 0 ? (
            <li>
              {`Estas zonas se quedarían sin ningún distrito disponible: ${zonasEnRiesgo.join(", ")}.`}
            </li>
          ) : null}
          <li>{textoDelConteo(conteo)}</li>
        </ul>
      </Modal>
    </section>
  );
}

/** Una fila del arbol: nombre, estado, marca de zona y sus acciones. */
function FilaNodo({
  nivel,
  id,
  nombre,
  estado,
  detalle,
  sinZona = false,
  expandible = false,
  expandido = false,
  alternando = false,
  onExpandir,
  onActivar,
  onRetirar,
  onRenombrar,
  onAgregarHijo,
  etiquetaAgregarHijo,
  textoAgregarHijo,
}: Readonly<{
  nivel: NivelGeografico;
  id: string;
  nombre: string;
  estado: EstadoGeografico;
  detalle?: string;
  sinZona?: boolean;
  expandible?: boolean;
  expandido?: boolean;
  alternando?: boolean;
  onExpandir?: () => void;
  onActivar: () => void;
  onRetirar: () => void;
  /** FICHA 375. */
  onRenombrar: () => void;
  onAgregarHijo?: () => void;
  etiquetaAgregarHijo?: string;
  textoAgregarHijo?: string;
}>) {
  const etiqueta = etiquetaEstadoGeografico(estado);
  const motivo = motivoActivarApagado(estado);
  const disponible = estado.tipo === "activo";

  return (
    <div
      data-nodo={`${nivel}:${id}`}
      className="flex flex-wrap items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"
    >
      {expandible ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-expanded={expandido}
          aria-label={`${expandido ? "Contraer" : "Expandir"} ${nombre}`}
          onClick={onExpandir}
        >
          <ChevronRight
            aria-hidden="true"
            className={expandido ? "rotate-90 transition-transform" : "transition-transform"}
          />
        </Button>
      ) : (
        // Hueco del mismo ancho que el boton de plegado: sin el, los distritos se alinearian con
        // el chevron de su canton y el arbol dejaria de leerse como un arbol.
        <span aria-hidden="true" className="inline-block w-6" />
      )}

      <span className={disponible ? "font-medium" : "font-medium text-muted-foreground"}>
        {nombre}
      </span>

      {detalle === undefined ? null : (
        <span className="text-xs text-muted-foreground">({detalle})</span>
      )}

      {/* R42 — la marca «sin zona» del distrito, derivada de la zona UTILIZABLE. */}
      {sinZona ? (
        <Badge variant="warning" title={AYUDA_SIN_ZONA}>
          {MARCA_SIN_ZONA}
        </Badge>
      ) : null}

      {/* R40 — dos sabores: el flag propio y el heredado, que NOMBRA al ascendiente responsable. */}
      {etiqueta === null ? null : (
        <Badge variant={estado.tipo === "inactivo_propio" ? "secondary" : "outline"}>
          {etiqueta}
        </Badge>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* FICHA 375 — RENOMBRAR. Va disponible tambien en un nodo RETIRADO: el nombre es una
            etiqueta y corregirla no depende de que el nodo se este ofreciendo. */}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label={`Renombrar ${nombre}`}
          disabled={alternando}
          onClick={onRenombrar}
        >
          Renombrar
        </Button>

        {onAgregarHijo === undefined ? null : (
          <Button
            type="button"
            variant="outline"
            size="xs"
            aria-label={etiquetaAgregarHijo}
            onClick={onAgregarHijo}
          >
            <Plus aria-hidden="true" />
            {textoAgregarHijo}
          </Button>
        )}

        {disponible ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={`Desactivar ${nombre}`}
            disabled={alternando}
            onClick={onRetirar}
          >
            Desactivar
          </Button>
        ) : (
          // R41 — en el heredado, «Activar» va APAGADO CON EL MOTIVO en el nombre accesible Y en
          // el `title`: un boton deshabilitado no recibe foco, asi que dejar el motivo solo en un
          // tooltip lo esconde a media pantalla.
          <Button
            type="button"
            variant="default"
            size="xs"
            aria-label={motivo === null ? `Activar ${nombre}` : `Activar ${nombre}. ${motivo}`}
            title={motivo ?? undefined}
            disabled={motivo !== null || alternando}
            onClick={onActivar}
          >
            Activar
          </Button>
        )}
      </div>
    </div>
  );
}

/** La tercera linea de la confirmacion (R60/R62), en sus tres estados. */
function textoDelConteo(conteo: EstadoConteo): string {
  if (conteo.estado === "cargando") return "Contando las órdenes sin entregar de este nodo…";
  if (conteo.estado === "error") {
    return "No se pudo contar las órdenes sin entregar de este nodo. Puedes retirarlo igual.";
  }
  return `Órdenes sin entregar en este nodo: ${conteo.ordenes}.`;
}

/**
 * R45 — UN mensaje por desenlace, y son SEIS: exito, conflicto, no encontrado, sin permiso, sin
 * sesion y validacion. Un «no se pudo completar la acción» para todos ellos deja a quien lo lee
 * sin saber si tiene que corregir el nombre, recargar o pedir permisos.
 */
function mensajeDeDesenlace(status: string): string {
  switch (status) {
    case "validation_error":
      return "Revisa los campos: el formulario está incompleto.";
    case "unauthenticated":
      return "Tu sesión expiró.";
    case "forbidden":
      return "No tienes permiso para esta acción.";
    case "not_found":
      return "Ese nodo ya no está en el catálogo.";
    case "conflict":
      return "Ya existe un nodo con ese nombre bajo el mismo padre.";
    default:
      return "No se pudo completar la acción.";
  }
}

/**
 * ⭑ FICHA 392 — el toast de un rechazo de validacion DEL NOMBRE repite el motivo del servidor.
 *
 * Los nombres de provincia, canton y distrito SE IMPRIMEN en la etiqueta (van al dato
 * `ubicacion`), asi que el servidor rechaza el que la fuente no puede imprimir y redacta el el
 * motivo: que caracter es, su `U+XXXX` y como escribirlo bien. Decirle «revisa los campos: el
 * formulario esta incompleto» a quien tiene el formulario COMPLETO lo manda a buscar un hueco
 * que no existe — el mismo fallo que la 376/R23 ya corrigio en el formulario de zonas, y esta es
 * su misma forma: reenviar el motivo TAL CUAL en vez de un texto propio.
 *
 * Se reenvia ENTERO, sin recortar ni resumir: el caso de la letra descompuesta —la que se pinta
 * igual que la de siempre pero esta escrita de otra forma— es largo porque explica algo que no se
 * ve en pantalla, y acortarlo se lleva por delante la unica instruccion que sirve.
 *
 * Y se repite en el toast aunque el `FieldError` ya lo pinte junto al input, por el motivo de la
 * 376: el campo puede haber quedado fuera de la pantalla.
 *
 * Solo `nombre`: cualquier otro campo (un `provinciaId` que no existe, por ejemplo) sigue con el
 * generico, que para eso es un fallo de otra clase.
 */
function mensajeDeValidacion(fieldErrors: FieldErrors): string {
  return fieldErrors.nombre?.[0] ?? mensajeDeDesenlace("validation_error");
}
