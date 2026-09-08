"use client";

import { useMemo, useRef, useState } from "react";
import { SearchX, Users } from "lucide-react";
import useSWR from "swr";

import { DataTable } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/ui/button";
import { BuscadorFiltros } from "@/components/shared/BuscadorFiltros";
import {
  FilterComponent,
  type FilterSelection,
} from "@/components/shared/FilterComponent";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { useToast } from "@/hooks/useToast";
import { usuariosConfig } from "@/lib/config/usuarios";
import {
  cambiarEstadoUsuario,
  consultarImpactoCambioUsuario,
  obtenerUsuario,
  listarUsuarios,
  listarUsuariosCompleto,
  restablecerContrasenaUsuario,
} from "@/lib/actions/usuarios";
import { ROL_LABELS } from "@/lib/auth/rol-label";
import { formatMontoString } from "@/lib/config/moneda";
import type { UsuarioListItemDTO } from "@/lib/types/usuario";
import { USUARIO_BUSQUEDA_MIN_CHARS } from "@/lib/types/usuario";
import type { UsuarioPublico } from "@/lib/interfaces/repositories/IUserRepository";
import type {
  CambioUsuarioEvaluable,
  ImpactoSalidaAdminSatelite,
} from "@/lib/interfaces/services/IUsuarioService";

import { buildUsuariosColumns } from "./usuarios-columns";
import {
  COLUMNAS_DESCARGA_USUARIOS,
  filaDescargaUsuario,
} from "./usuarios-descarga-columnas";
import {
  construirFiltrosUsuarios,
  PLACEHOLDER_BUSQUEDA,
} from "./usuarios-filtros-def";
import {
  hayFiltroUsuarios,
  seleccionAFiltroUsuarios,
  serializarFiltroUsuarios,
  type FiltroUsuariosUI,
} from "./seleccion-a-filtro-usuarios";
import { ContrasenaGeneradaPanel } from "./ContrasenaGeneradaPanel";
import { UsuarioForm, type UsuarioFormHandle } from "./UsuarioForm";

/** R12/R13: nombre visible del listado; da nombre a la hoja, al archivo y al control. */
const TITULO_DESCARGA = "Usuarios";

// R13: opciones acotadas por MAX_PAGE_SIZE del backend.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= usuariosConfig.MAX_PAGE_SIZE,
);

export interface UsuariosPageData {
  items: UsuarioListItemDTO[];
  total: number;
  pageSize: number;
}

export interface UsuariosModuleProps {
  /** Listado pre-cargado en el servidor (R13); alimenta el fallback de SWR. */
  initialData: UsuariosPageData;
}

/**
 * Feature 287/R21/R24 — la contraseña recién generada, viva SOLO en el estado de React de
 * este componente y solo hasta que se cierre el panel. No se guarda en `localStorage`, ni en
 * cookie, ni en la caché de SWR, ni se vuelve a pedir: el backend la devuelve exactamente una
 * vez, en la rama `ok`, y no existe ninguna lectura que la repita.
 */
interface ContrasenaRevelada {
  /** A quién pertenece; solo para nombrarlo en el encabezado del panel. */
  nombre: string;
  /** El claro. Se descarta al cerrar el panel (R29). */
  contrasena: string;
}

/**
 * Feature 285/R20 — vacío CON filtros puestos. El mensaje de siempre ("No hay usuarios /
 * crea el primer usuario") es literalmente FALSO bajo un filtro: sí hay usuarios, lo que
 * no hay es coincidencias. Y no es solo impreciso: ofrece crear una cuenta a quien
 * probablemente ya la tiene, escondida detrás del filtro que acaba de poner. Un listado
 * vacío por filtro no es un listado vacío.
 */
const VACIO_CON_FILTROS = {
  title: "Ningún usuario coincide con los filtros",
  description:
    "Revisa el texto que escribiste o quita algún filtro para ver más resultados.",
};

async function usuariosFetcher(
  page: number,
  pageSize: number,
  filtro: FiltroUsuariosUI,
): Promise<UsuariosPageData> {
  // Sin filtros el objeto está vacío, así que el input es `{ page, pageSize }` — la
  // MISMA petición que antes de esta feature (R1), no una equivalente.
  const res = await listarUsuarios({ page, pageSize, ...filtro });
  if (res.status !== "ok") throw new Error("list_failed");
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

/**
 * FICHA 379 (R10-R13, R20) — un cambio EVALUADO y todavía SIN APLICAR, esperando la decisión
 * del maestro.
 *
 * ⚠️ `impacto: null` aquí NO significa «no hay nada que avisar»: ese caso ni siquiera abre el
 * diálogo (R15, se aplica directo). Significa que la consulta previa **no se pudo resolver**
 * (R20), y entonces se dice eso mismo y se deja continuar: ni silencio ni bloqueo.
 *
 * ⚠️ Y el aviso NO es una guarda (R14). Lo único que cambia respecto de hoy es que el maestro
 * lo sabe antes de decidir; el cambio que pidió sigue estando a un clic.
 */
interface AvisoZonaPendiente {
  /** Lo que dijo el servidor, o `null` si no se pudo comprobar (R20). */
  impacto: ImpactoSalidaAdminSatelite | null;
  /**
   * Nombre de la zona SEGÚN LA FILA del listado, y solo para la rama de R20: cuando la
   * consulta falla, el servidor no llega a decir de qué zona hablamos, y la fila sí lo pinta.
   * Con impacto manda siempre el nombre que vino del servidor. `null` = la fila no tiene zona.
   */
  zonaNombreFila: string | null;
  /**
   * El cambio, SIN aplicar. R11: mientras este objeto exista y el diálogo esté en pantalla,
   * esta función no se ha ejecutado ni una vez.
   */
  aplicar: () => Promise<void>;
}

type FormMode = "crear" | "editar";

/**
 * Módulo cliente de gestión de usuarios: DataTable + Pagination (R26), botón
 * Crear + Modal async con `UsuarioForm` (R27), activar/inactivar por fila
 * (R20/R21) y feedback vía `useToast` (R28). Cablea las Server Actions.
 */
export function UsuariosModule({ initialData }: UsuariosModuleProps) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialData.pageSize);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("crear");
  const [editUsuario, setEditUsuario] = useState<UsuarioPublico | null>(null);
  // FICHA 379 — el nombre de la zona que la FILA ya pintaba cuando se abrió el editor.
  // `UsuarioPublico` trae el `zonaId` pero no el nombre, y para la rama de R20 (la consulta
  // previa falló) hace falta poder nombrar la zona sin una lectura nueva.
  const [editZonaNombre, setEditZonaNombre] = useState<string | null>(null);
  const [estadoPendienteId, setEstadoPendienteId] = useState<string | null>(null);
  // FICHA 379 (R11) — el aviso pendiente de decisión. Mientras no sea `null`, el cambio que
  // guarda dentro NO se ha aplicado.
  const [aviso, setAviso] = useState<AvisoZonaPendiente | null>(null);
  const formRef = useRef<UsuarioFormHandle>(null);

  // Feature 287 (T10). Tres estados, y ninguno de los tres guarda nada fuera de React:
  // a quién se le va a restablecer (la confirmación de R26), qué fila está en curso, y la
  // contraseña revelada (R28), que se descarta al cerrar (R29).
  const [restablecerObjetivo, setRestablecerObjetivo] =
    useState<UsuarioListItemDTO | null>(null);
  const [restablecerPendienteId, setRestablecerPendienteId] = useState<string | null>(
    null,
  );
  const [contrasenaRevelada, setContrasenaRevelada] =
    useState<ContrasenaRevelada | null>(null);

  // Feature 285 (design §4.4) — estado de la barra compartida.
  //
  // El TÉRMINO vive aparte de la selección, y no es un detalle: `FilterComponent` emite
  // SU selección completa en cada cambio, así que si el término se guardara ahí dentro,
  // marcar un rol lo borraría.
  const [termino, setTermino] = useState("");
  const [seleccion, setSeleccion] = useState<FilterSelection>({});
  // Claves de los filtros PUESTOS desde el selector. Arranca vacía: la barra nace con el
  // buscador solo y el usuario pide el filtro que va a usar.
  const [filtrosActivos, setFiltrosActivos] = useState<string[]>([]);
  // Contador de "Limpiar todo". `FilterComponent` es dueño de su selección y no expone
  // forma de vaciarla desde fuera, así que se le cambia la `key` para remontarlo limpio.
  const [resetFiltros, setResetFiltros] = useState(0);

  /** R21: deja la barra como recién abierta — sin término, sin valores y sin controles. */
  function limpiarFiltros() {
    setSeleccion({});
    // También se retiran los filtros PEDIDOS: "limpiar todo" es volver al punto de
    // partida, y una barra que se queda con un control vacío no lo es.
    setFiltrosActivos([]);
    setResetFiltros((n) => n + 1);
  }

  const filtrosBarra = useMemo(() => construirFiltrosUsuarios(), []);
  const filtrosOfrecidos = useMemo(
    () => filtrosBarra.map((f) => ({ key: f.key, label: f.label })),
    [filtrosBarra],
  );
  // Solo se montan los filtros PEDIDOS, en el orden en que se declararon (no en el de
  // los clics), para que los controles no bailen de sitio.
  const filtrosMontados = useMemo(
    () => filtrosBarra.filter((f) => filtrosActivos.includes(f.key)),
    [filtrosBarra, filtrosActivos],
  );

  const filtro = useMemo(
    () => seleccionAFiltroUsuarios(seleccion, termino),
    [seleccion, termino],
  );
  const hayFiltro = hayFiltroUsuarios(filtro);
  // Escalar estable: dos selecciones equivalentes comparten caché en vez de refetchear
  // en cada render (los roles van ORDENADOS).
  const filtroKey = serializarFiltroUsuarios(filtro);

  // R18: al cambiar el término o la selección de roles, la página actual puede no existir
  // en el resultado nuevo (estabas en la 3 y ahora hay 1). Patrón "ajustar estado durante
  // el render", igual que `OrdenesModule`: sin efecto, y sin el parpadeo de un fetch a la
  // página vieja que un `useEffect` provocaría.
  const [filtroKeyPrevio, setFiltroKeyPrevio] = useState(filtroKey);
  if (filtroKey !== filtroKeyPrevio) {
    setFiltroKeyPrevio(filtroKey);
    setPage(1);
  }

  const { data, error, isLoading, mutate } = useSWR(
    ["usuarios:list", page, pageSize, filtroKey],
    () => usuariosFetcher(page, pageSize, filtro),
    {
      // ⚠️ `!hayFiltro` es la parte que NO puede faltar. `initialData` es el listado SIN
      // FILTRAR que precargó el servidor; sin esa condición, el primer render de una
      // búsqueda pintaría ese listado completo como si fuera el resultado filtrado —filas
      // que no casan, y un total que no es el suyo— hasta que la consulta volviera. No es
      // un parpadeo cosmético: es una respuesta incorrecta, mostrada como correcta.
      fallbackData:
        page === 1 && pageSize === initialData.pageSize && !hayFiltro
          ? initialData
          : undefined,
    },
  );

  function abrirCrear() {
    setFormMode("crear");
    setEditUsuario(null);
    setFormOpen(true);
  }

  async function abrirEditar(row: UsuarioListItemDTO) {
    const res = await obtenerUsuario(row.id);
    if (res.status !== "ok") {
      toast.error(mensajeError(res.status));
      return;
    }
    setFormMode("editar");
    setEditUsuario(res.usuario);
    setEditZonaNombre(row.zonaNombre);
    setFormOpen(true);
  }

  /**
   * FICHA 379 (R9/R15/R20/R21) — la consulta PREVIA, y la única puerta por la que pasan los
   * tres cambios que pueden dejar una zona satélite sin quien consolide su dinero.
   *
   * Se pregunta SIEMPRE y decide el SERVIDOR (AS5). La alternativa —que la pantalla filtre
   * por el rol de la fila— metería literales de rol aquí dentro y reabriría el modo de fallo
   * de esta ficha: quien olvidara una rama produciría un cambio silencioso.
   *
   * ⚠️ NINGUNA de sus tres salidas impide nada (R14): con impacto abre el aviso, sin impacto
   * aplica con los mismos clics de siempre (R15), y si la consulta falla lo DICE y deja
   * continuar (R20). Lo que cambia no es lo que el maestro puede hacer, es lo que sabe.
   */
  async function evaluarYAplicar(
    id: string,
    cambio: CambioUsuarioEvaluable,
    zonaNombreFila: string | null,
    aplicar: () => Promise<void>,
  ): Promise<void> {
    let impacto: ImpactoSalidaAdminSatelite | null = null;
    let sePudoComprobar = false;
    try {
      const res = await consultarImpactoCambioUsuario(id, cambio);
      if (res.status === "ok") {
        sePudoComprobar = true;
        impacto = res.impacto;
      }
    } catch {
      // R20 — «no se puede resolver» incluye que la llamada REVIENTE (red caída, sesión
      // perdida). Tragarse esto dejaría un cambio que el maestro pidió, que no se aplicó y
      // del que nadie se entera: el fallo mudo exacto que esta ficha combate. Cae en la
      // misma rama que un error del borde y se dice en pantalla.
      sePudoComprobar = false;
    }

    // R15: nada que avisar es el caso normal — ni un clic de más.
    if (sePudoComprobar && impacto === null) {
      await aplicar();
      return;
    }

    // R10 (hay impacto) y R20 (no se pudo comprobar) salen por el MISMO punto, que es lo que
    // R20 pide: se dice justo donde se diría el aviso. `impacto` es null en el segundo caso.
    setAviso({ impacto, zonaNombreFila, aplicar });
  }

  /** R12 — confirmar aplica el cambio pedido, con el mismo resultado que si el aviso no existiera. */
  async function confirmarAviso() {
    const pendiente = aviso;
    if (!pendiente) return;
    setAviso(null);
    await pendiente.aplicar();
  }

  /**
   * El guardado de siempre. FICHA 379: se extrae tal cual para poder DIFERIRLO detrás del
   * aviso sin cambiarle una línea — R12 pide el mismo resultado, no uno equivalente.
   */
  async function guardarFormulario() {
    const res = await formRef.current?.submit();
    if (!res) return;
    if (res.status === "ok") {
      await mutate();
      const conPassword = "generatedPassword" in res && !!res.generatedPassword;
      toast.success(
        formMode === "crear" ? "Usuario creado" : "Usuario actualizado",
      );
      // R33: si hay contraseña generada, el modal permanece abierto para
      // mostrarla una vez; el usuario lo cierra manualmente.
      if (!conPassword) setFormOpen(false);
    } else {
      toast.error(mensajeError(res.status));
    }
  }

  async function onConfirmForm() {
    // FICHA 379 (R21): en edición se evalúa ANTES de escribir. `cambioPendiente()` devuelve
    // `null` cuando no hay nada que evaluar —modo crear— o cuando la validación de cliente
    // acaba de fallar; en ese segundo caso el guardado sigue el camino de siempre y tampoco
    // escribe nada, así que no hay cambio aplicado sin evaluar.
    const cambio =
      formMode === "editar" ? formRef.current?.cambioPendiente() : null;
    if (formMode === "editar" && editUsuario && cambio) {
      await evaluarYAplicar(
        editUsuario.id,
        cambio,
        editZonaNombre,
        guardarFormulario,
      );
      return;
    }
    await guardarFormulario();
  }

  /**
   * La escritura del cambio de estado, sin ninguna comprobación dentro: es EXACTAMENTE lo
   * que se aplica, con aviso de por medio o sin él (R12).
   */
  async function aplicarCambioEstado(
    id: string,
    destino: "activo" | "inactivo",
  ) {
    setEstadoPendienteId(id);
    try {
      const res = await cambiarEstadoUsuario(id, { estado: destino });
      if (res.status === "ok") {
        await mutate();
        toast.success(
          destino === "inactivo" ? "Usuario inactivado" : "Usuario activado",
        );
      } else {
        toast.error(mensajeError(res.status));
      }
    } finally {
      setEstadoPendienteId(null);
    }
  }

  async function cambiarEstado(row: UsuarioListItemDTO) {
    const destino = row.estado === "activo" ? "inactivo" : "activo";
    // La fila queda en curso ya durante la consulta previa: es un viaje al servidor, y sin
    // esto el botón parecería no haber hecho nada hasta que apareciera el diálogo.
    setEstadoPendienteId(row.id);
    try {
      await evaluarYAplicar(row.id, { estado: destino }, row.zonaNombre, () =>
        aplicarCambioEstado(row.id, destino),
      );
    } finally {
      setEstadoPendienteId(null);
    }
  }

  /**
   * Feature 287 (R26/R27/R28/R30) — el confirmar del modal, y NADA antes que él. El botón de
   * la fila solo abrió esta ventana; hasta aquí no se ha tocado ninguna contraseña.
   *
   * La acción recibe SOLO el `id` y eso es el requisito (R6/R10): no hay objeto de entrada,
   * luego no hay dónde meter una contraseña elegida por el maestro. Si alguna vez le crece un
   * segundo argumento de entrada, el test de forma de esta llamada se pone rojo.
   */
  async function confirmarRestablecer() {
    const objetivo = restablecerObjetivo;
    if (!objetivo) return;
    setRestablecerPendienteId(objetivo.id);
    try {
      const res = await restablecerContrasenaUsuario(objetivo.id);
      setRestablecerObjetivo(null);
      if (res.status === "ok") {
        // R28: el claro pasa al estado efímero del panel. R19: se dice cuántas sesiones
        // se cerraron, porque cerrar sesiones ajenas no puede ser un efecto invisible.
        setContrasenaRevelada({
          nombre: objetivo.nombre,
          contrasena: res.generatedPassword,
        });
        toast.success(mensajeSesionesRevocadas(res.sesionesRevocadas));
      } else {
        // R30: el error se informa y el panel NO se abre. Ninguna rama que no sea `ok`
        // lleva contraseña —lo impide el tipo—, y aquí tampoco se pinta ninguna.
        toast.error(mensajeError(res.status));
      }
    } finally {
      setRestablecerPendienteId(null);
    }
  }

  const columns = buildUsuariosColumns({
    onEditar: (row) => {
      void abrirEditar(row);
    },
    onCambiarEstado: (row) => {
      void cambiarEstado(row);
    },
    estadoPendienteId,
    // R27: abrir la confirmación es TODO lo que hace el botón de la fila.
    onRestablecerContrasena: (row) => {
      setRestablecerObjetivo(row);
    },
    restablecerPendienteId,
  });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button type="button" onClick={abrirCrear}>
          Crear usuario
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        rowKey="id"
        ariaLabel="Usuarios"
        /**
         * Feature 285/R28 — la barra COMPARTIDA, no controles propios. Va dentro de la
         * tabla, en la misma línea que el control de descarga, igual que en órdenes: el
         * buscador manda la barra (por nombre o correo, con el mínimo de caracteres que
         * valida el borde) y el botón "Filtros" ofrece el rol.
         *
         * Toda la lógica de selección, búsqueda interna, marcado y limpieza vive en
         * `BuscadorFiltros`/`FilterComponent`; aquí solo se declara y se traduce lo
         * emitido.
         */
        filtros={
          <BuscadorFiltros
            label="Buscar"
            placeholder={PLACEHOLDER_BUSQUEDA}
            // R29: el mínimo sale de la MISMA constante que valida el borde. Si cambiara
            // allí, el campo lo seguiría sin tocar esta línea; escribir un `2` aquí es
            // exactamente cómo los dos números se separan a la primera.
            minChars={USUARIO_BUSQUEDA_MIN_CHARS}
            // R10: la espera es la de la casa (`DEBOUNCE_MS_DEFAULT`, 500 ms) y no se
            // sobrescribe. Lo que cuesta no es la consulta —la tabla es diminuta—, es el
            // viaje de la Server Action, que cuesta lo mismo aquí que en órdenes.
            onChange={setTermino}
            filtros={filtrosOfrecidos}
            activos={filtrosActivos}
            onActivosChange={setFiltrosActivos}
            // R21: una sola acción se lleva por delante la búsqueda Y los filtros.
            onLimpiarTodo={limpiarFiltros}
            // Basta con tener el filtro PUESTO —aunque esté vacío— para ofrecer la
            // limpieza: retirarlo de la barra también es algo que limpiar.
            hayFiltrosAplicados={
              filtrosActivos.length > 0 || Object.keys(seleccion).length > 0
            }
          >
            {filtrosMontados.length > 0 ? (
              <FilterComponent
                key={resetFiltros}
                filters={filtrosMontados}
                onChange={setSeleccion}
              />
            ) : null}
          </BuscadorFiltros>
        }
        /**
         * Feature 170 (T B.4, R1/R9/R12/R13) — descarga del listado COMPLETO, no de la
         * página visible: la tabla es de Familia A (el `data` de arriba es un recorte
         * server-side de `pageSize`), así que las filas las trae la Server Action del
         * modo completo, con el mismo guard de rol y el mismo tope que el listado.
         *
         * Se construye EN EL RENDER (design §5), y ese día llegó: la feature 285 le da
         * filtros, así que el closure lee los de ESTE render y no los de un memo caducado.
         *
         * Feature 285/R22 — CON los filtros puestos. El control vive DENTRO de la tabla, en
         * la misma línea que la barra: un botón ahí que ignorara los filtros entregaría un
         * archivo que no es lo que la pantalla muestra, y eso no se descubre mirando el
         * botón, se descubre abriendo el archivo. El schema del modo completo se DERIVA del
         * listado, así que acepta `q`/`rol` sin haberlo editado.
         *
         * R23 — sin filtros, `{}` LITERAL: la petición de hoy, byte a byte. El schema es
         * `.strict()` y sin `page`/`pageSize` (mandarlos sería `validation_error`), y
         * `sortBy`/`sortDir` caen en el MISMO default que usa `listarUsuarios`, así que el
         * archivo sale en el orden de pantalla.
         */
        descarga={{
          titulo: TITULO_DESCARGA,
          columnas: COLUMNAS_DESCARGA_USUARIOS,
          obtenerFilas: () =>
            filasDesdeResultado(
              listarUsuariosCompleto(hayFiltro ? filtro : {}),
              filaDescargaUsuario,
            ),
        }}
        isLoading={isLoading}
        error={error ? "No se pudieron cargar los usuarios" : null}
        /**
         * R20: el vacío depende de si hay filtros puestos. Con filtros, el mensaje dice
         * que ninguno COINCIDE y NO ofrece "Crear usuario": la cuenta que se busca puede
         * existir perfectamente, escondida detrás del filtro. Sin filtros, el de siempre,
         * intacto — que ahí sí es cierto que no hay ninguno y crear el primero es el
         * próximo paso.
         */
        emptyState={
          hayFiltro
            ? { icon: SearchX, ...VACIO_CON_FILTROS }
            : {
                icon: Users,
                title: "No hay usuarios",
                description: "Crea el primer usuario para dar acceso al sistema.",
                action: (
                  <Button type="button" onClick={abrirCrear}>
                    Crear usuario
                  </Button>
                ),
              }
        }
      />

      <Pagination
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
        disabled={isLoading}
        showFirstLast
        siblingCount={1}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
      />

      <Modal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={formMode === "crear" ? "Crear usuario" : "Editar usuario"}
        confirmLabel="Guardar"
        cancelLabel="Cerrar"
        closeOnConfirm={false}
        onConfirm={onConfirmForm}
      >
        <UsuarioForm
          key={`${formMode}:${editUsuario?.id ?? "nuevo"}`}
          ref={formRef}
          mode={formMode}
          usuario={editUsuario}
        />
      </Modal>

      {/* Feature 287/R26 — la confirmación explícita. Va en `description` y no en el cuerpo
          para que el Modal la cuelgue de `aria-describedby`: quien usa lector de pantalla
          oye la advertencia al abrirse, no solo quien la ve. */}
      <Modal
        open={restablecerObjetivo !== null}
        onOpenChange={(next) => {
          // R27: cerrar por Cancelar, Escape u overlay descarta el objetivo sin ejecutar nada.
          if (!next) setRestablecerObjetivo(null);
        }}
        title="Restablecer contraseña"
        description={
          restablecerObjetivo
            ? `Se generará una contraseña nueva para ${restablecerObjetivo.nombre}. La actual dejará de servir y se cerrarán sus sesiones abiertas. La verás una sola vez.`
            : null
        }
        confirmLabel="Restablecer"
        cancelLabel="Cancelar"
        confirmVariant="destructive"
        closeOnConfirm={false}
        onConfirm={confirmarRestablecer}
      />

      {/* FICHA 379 (R10/R11/R12/R13/R20) — el aviso, antes de tocar nada.

          Va en `description` y no en el cuerpo por lo mismo que la confirmación de arriba:
          ahí el Modal lo cuelga de `aria-describedby`, así que quien usa lector de pantalla
          lo OYE al abrirse.

          El confirmar NO es `destructive`: no se está destruyendo nada, se está avisando. */}
      <Modal
        open={aviso !== null}
        onOpenChange={(next) => {
          // R13: Cancelar, Escape o clic fuera descartan el cambio sin ejecutar nada y sin
          // dejar rastro — la función diferida se va con el estado.
          if (!next) setAviso(null);
        }}
        title={aviso ? tituloAvisoZona(aviso) : null}
        description={aviso ? textoAvisoZona(aviso) : null}
        confirmLabel="Continuar"
        cancelLabel="Cancelar"
        closeOnConfirm={false}
        onConfirm={confirmarAviso}
      />

      {/* R28/R29 — la contraseña, una sola vez. Al cerrar, el estado se descarta y no queda
          ningún control que la reponga: el único camino de vuelta es restablecer OTRA. */}
      <Modal
        open={contrasenaRevelada !== null}
        onOpenChange={(next) => {
          if (!next) setContrasenaRevelada(null);
        }}
        title="Contraseña restablecida"
        confirmLabel="Cerrar"
        hideCancel
        onConfirm={() => setContrasenaRevelada(null)}
      >
        {contrasenaRevelada ? (
          <ContrasenaGeneradaPanel
            contrasena={contrasenaRevelada.contrasena}
            encabezado={`Contraseña nueva de ${contrasenaRevelada.nombre}. Entrégasela por un canal directo: nadie le ha avisado.`}
            inputId="contrasena-restablecida"
          />
        ) : null}
      </Modal>
    </section>
  );
}

/**
 * Feature 287/R19 — cuántas sesiones se cerraron. El número viene del repositorio, no de una
 * suposición del cliente, y se dice siempre: revocar el acceso de otra persona no puede ser un
 * efecto que solo se vea en la base de datos.
 */
/**
 * FICHA 379/R23 — LOS TRES ROLES QUE EL AVISO NOMBRA salen de `ROL_LABELS`, la misma fuente que
 * usa la tabla de usuarios y el pie del sidebar. Nunca el identificador técnico del enum ni jerga
 * interna: el aviso lo lee quien administra usuarios, no quien escribió el `RolValue`.
 *
 * ⚠️ El copy de `design.md` §4.6 decía «ni el maestro ni un admin». `admin` **es** el valor del
 * enum, y el texto de cara al usuario de esta app no lo usa en ningún sitio: las dos frases del
 * árbol que mencionan ese rol dicen «un administrador»
 * (`ExportarVistaFinanciera.tsx:92`, `cierre-confirmacion-fisica.tsx:66`). Se toma la etiqueta
 * porque es lo que pide R23 al pie de la letra y porque es la casa; la decisión es del
 * frontend_dev de esta tanda, no del humano, y la vuelta atrás es escribir el literal aquí.
 */
const ETIQUETA_ADMIN_SATELITE = ROL_LABELS.adminSatelite;
const ETIQUETA_MAESTRO = ROL_LABELS.maestro;
const ETIQUETA_ADMIN = ROL_LABELS.admin;

/**
 * FICHA 379/R10 — «1 cierre aprobado» / «N cierres aprobados». Función pura y al lado de
 * `mensajeSesionesRevocadas` por el mismo motivo que aquélla: un plural que depende de un
 * número que viene del servidor se prueba solo, sin montar la pantalla entera.
 */
function cierresAprobados(cantidad: number): string {
  return cantidad === 1 ? "1 cierre aprobado" : `${cantidad} cierres aprobados`;
}

/**
 * FICHA 379/R10 — el título. Con impacto nombra la zona que se queda sin nadie; sin él (R20)
 * dice lo único que se sabe, que es que no se pudo comprobar. Afirmar la primera frase cuando
 * la consulta falló sería inventarse el dato que precisamente falta.
 */
function tituloAvisoZona(aviso: AvisoZonaPendiente): string {
  if (!aviso.impacto) return "No se pudo comprobar el impacto de este cambio";
  return `La zona ${aviso.impacto.zonaNombre} se queda sin ${ETIQUETA_ADMIN_SATELITE}`;
}

/**
 * FICHA 379/R10/R19/R20/R23 — el cuerpo del aviso, en tres ramas.
 *
 * El importe se pinta con `formatMontoString`, que formatea DESDE EL STRING y no pasa por
 * `Number` en ningún punto (R19): el `Decimal(12,2)` que llega del servidor sigue siendo el
 * mismo cuando se pinta.
 *
 * La rama de cero cierres existe a propósito (AS1): el daño no es el dinero de hoy, es que la
 * zona se queda sin nadie que pueda cerrarla, así que todo lo que entre después queda retenido.
 */
function textoAvisoZona(aviso: AvisoZonaPendiente): string {
  const { impacto } = aviso;

  // R20 — ni silencio ni bloqueo: se dice que no se pudo comprobar, y se deja continuar.
  if (!impacto) {
    const zona = aviso.zonaNombreFila
      ? `la zona ${aviso.zonaNombreFila}`
      : "la zona de este usuario";
    return `No se pudo comprobar si ${zona} se queda sin ${ETIQUETA_ADMIN_SATELITE} ni cuánto dinero tiene sin consolidar. Puedes continuar de todas formas.`;
  }

  const cabeza =
    `Es el único ${ETIQUETA_ADMIN_SATELITE} activo de la zona ${impacto.zonaNombre}. ` +
    "Si continúas, esa zona se queda sin nadie que pueda consolidar sus cierres: " +
    `ni el ${ETIQUETA_MAESTRO} ni un ${ETIQUETA_ADMIN} pueden hacerlo desde otra zona.`;

  if (impacto.cierresSinConsolidar === 0) {
    return (
      `${cabeza} Ahora mismo no hay cierres pendientes, pero los que entren después ` +
      `quedarán retenidos hasta que la zona vuelva a tener un ${ETIQUETA_ADMIN_SATELITE}.`
    );
  }

  return (
    `${cabeza} Ahora mismo hay ${cierresAprobados(impacto.cierresSinConsolidar)} sin ` +
    `consolidar, por ${formatMontoString(impacto.totalSinConsolidar)}.`
  );
}

function mensajeSesionesRevocadas(sesiones: number): string {
  if (sesiones === 0) {
    return "Contraseña restablecida. No había sesiones abiertas.";
  }
  if (sesiones === 1) {
    return "Contraseña restablecida. Se cerró 1 sesión abierta.";
  }
  return `Contraseña restablecida. Se cerraron ${sesiones} sesiones abiertas.`;
}

/**
 * Traduce el `status` del `ActionError` del backend a un mensaje de UI. No es un
 * switch de mensajes de dominio: el detalle de validación se muestra por campo
 * en el formulario; aquí solo se da el feedback de toast (R28).
 */
function mensajeError(status: string): string {
  switch (status) {
    case "unauthenticated":
      return "Tu sesión expiró. Vuelve a iniciar sesión.";
    case "forbidden":
      return "No tienes permiso para esta acción.";
    case "not_found":
      return "El usuario no existe.";
    case "conflict":
      return "El email o la cédula ya están en uso.";
    // Feature 287/R5 — negativa PROPIA, distinta de `forbidden`: no es que no tengas permiso,
    // es que restablecerte a ti mismo te cerraría la sesión antes de poder copiar la
    // contraseña. Merece su mensaje, no el genérico (`design.md` §7, D4).
    case "self_reset_forbidden":
      return "No puedes restablecer tu propia contraseña desde aquí.";
    default:
      return "Revisa los datos e inténtalo de nuevo.";
  }
}
