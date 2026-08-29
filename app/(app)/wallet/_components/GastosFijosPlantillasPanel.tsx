"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { useToast } from "@/hooks/useToast";
import { gastoFijoConfig } from "@/lib/config/gasto-fijo";
import {
  listarPlantillasCompletoAction,
  listarPlantillasPaginadoAction,
  setActivaPlantillaAction,
} from "@/lib/actions/gasto-fijo-plantilla";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

import { GastoFijoPlantillaDialog } from "./GastoFijoPlantillaDialog";
import { estadoPlantillaGastoFijo } from "./gasto-fijo-estado-label";
import {
  COLUMNAS_DESCARGA_GASTOS_FIJOS,
  filaDescargaGastoFijo,
} from "./gastos-fijos-descarga-columnas";
import { money, periodicidadLegible, proximoCobroTexto } from "./wallet-labels";

/** Nombre visible del panel: hoja, base del archivo y nombre del control (R12/R13). */
const TITULO_DESCARGA = "Plantillas de gasto fijo";
/** Nombre accesible del control de paginación (R43). La wallet ya tiene el del libro. */
export const PAGINACION_PLANTILLAS_LABEL = "Paginación de las plantillas de gasto fijo";
const ERROR_CARGA = "No se pudieron cargar las plantillas de gasto fijo.";

// R40: el tamaño sale de la config del dominio (T H.1), nunca de un literal de pantalla.
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter(
  (s) => s <= gastoFijoConfig.MAX_PAGE_SIZE,
);

/** Feature 170 — FASE 2 (T I.2): la página de plantillas tal como la da el servidor. */
export interface GastosFijosPlantillasPagina {
  items: GastoFijoPlantillaDTO[];
  total: number;
  pageSize: number;
}

async function leerPagina(
  page: number,
  pageSize: number,
): Promise<GastosFijosPlantillasPagina> {
  const res = await listarPlantillasPaginadoAction({ page, pageSize });
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

// Feature 45 (T24, R22b/R23/R24/R25/R26) — panel CRUD de PLANTILLAS de gasto fijo (solo
// maestro; la página ya validó el rol). Lista todas las plantillas (activas e inactivas),
// permite crear/editar (diálogo reutilizado) y activar/desactivar (NUNCA borrar, R25: la
// desactivación es el mecanismo para dejar de generar). Deja explícito que los egresos de
// gasto fijo los emite el CRON automáticamente, no este panel. Money-safe: el monto llega
// como STRING y se renderiza TAL CUAL con `money`, sin parseFloat/Number.
//
// Feature 85 (T F.3, design §4.4) — la tabla enseña por fin el CICLO que la base guarda desde
// la 84: «Periodicidad» (en palabras) y «Próximo cobro» (la fecha, o «No se cobra» si está
// desactivada). El cron dejó de ser mensual en la 84 y los textos de este panel seguían
// prometiendo un cobro «cada mes»: ya no (R22). El instante del próximo cobro baja por props
// desde el servidor (`ahoraIso`), nunca del reloj del navegador (R23).

export interface GastosFijosPlantillasPanelProps {
  /**
   * Feature 170 — FASE 2 (T I.2, R40/R41): PÁGINA 1 resuelta server-side + el `total` del
   * conjunto. Alimenta el `fallbackData` de SWR.
   */
  initialData: GastosFijosPlantillasPagina;
  /**
   * Feature 85 (T F.3, R23) — el instante con el que se calcula la columna «Próximo cobro»,
   * en ISO, resuelto en el SERVIDOR y bajado por props.
   *
   * REQUERIDA a propósito, sin default y sin `?`. Este panel se renderiza también en el
   * servidor: si leyera `new Date()` del navegador, un cambio de día entre el render del
   * servidor y la hidratación daría dos fechas distintas para la misma fila, y además el
   * valor quedaría a merced del reloj de la máquina del usuario. Y requerida —y no opcional
   * con un default— porque este repo ya se comió un composition root que importaba una
   * dependencia y nunca la pasaba, con la suite entera en verde: así el olvido lo caza `tsc`.
   */
  ahoraIso: string;
  /**
   * Callback tras crear/editar/activar/desactivar. El panel ya recarga SU página por su
   * cuenta (`mutate`); esto sigue avisando al módulo padre, que refresca lo demás.
   */
  onCambio?: () => void;
}

export function GastosFijosPlantillasPanel({
  initialData,
  ahoraIso,
  onCambio,
}: GastosFijosPlantillasPanelProps) {
  const router = useRouter();
  const toast = useToast();

  /** El instante del servidor, una sola vez: la tabla y el archivo comparten esta fecha. */
  const ahora = useMemo(() => new Date(ahoraIso), [ahoraIso]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editando, setEditando] = useState<GastoFijoPlantillaDTO | null>(null);
  // id de la plantilla cuyo toggle activo está en vuelo (deshabilita solo esa fila).
  const [alternando, setAlternando] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialData.pageSize);
  const { data, error, mutate } = useSWR(
    ["gasto-fijo:plantillas", page, pageSize],
    () => leerPagina(page, pageSize),
    {
      fallbackData:
        page === 1 && pageSize === initialData.pageSize ? initialData : undefined,
    },
  );

  // R44: el esqueleto de carga se muestra sólo cuando NO hay nada que pintar. `isLoading` de
  // SWR sigue siendo `true` mientras revalida aunque haya `fallbackData`, y usarlo tal cual
  // haría que la página 1 —la que el Server Component ya resolvió— apareciera como esqueleto
  // antes de enseñar las filas que el usuario veía antes de paginar.
  const cargando = data === undefined;

  /** Tras un cambio del CRUD (R23), la página visible se relee: sin esto la fila editada
   *  seguiría mostrando el valor anterior hasta recargar la ruta entera. */
  function recargar() {
    void mutate();
    onCambio?.();
  }

  function abrirCrear() {
    setEditando(null);
    setDialogOpen(true);
  }

  function abrirEditar(plantilla: GastoFijoPlantillaDTO) {
    setEditando(plantilla);
    setDialogOpen(true);
  }

  async function alternarActiva(plantilla: GastoFijoPlantillaDTO) {
    setAlternando(plantilla.id);
    try {
      const result = await setActivaPlantillaAction({
        id: plantilla.id,
        activa: !plantilla.activa,
      });

      if (result.status === "ok") {
        // R22: ni el aviso de activar ni el de desactivar pueden prometer un cobro mensual.
        // Cada plantilla tiene el ciclo que le pusieron, y es el que se aplica.
        toast.success(
          plantilla.activa
            ? "Plantilla desactivada. Dejará de generar cobros."
            : "Plantilla activada. Se generará según su periodicidad.",
        );
        recargar();
        router.refresh();
        return;
      }
      if (result.status === "not_found") {
        toast.error("La plantilla ya no existe.");
        recargar();
        return;
      }
      if (result.status === "forbidden") {
        toast.error("No tenés permiso para administrar plantillas.");
        return;
      }
      if (result.status === "validation_error") {
        toast.error("No se pudo actualizar la plantilla.");
        return;
      }
      // unauthenticated
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
    } finally {
      setAlternando(null);
    }
  }

  // Columnas construidas inline (baratas): cierran sobre los handlers/estado de la fila.
  const columns: Column<GastoFijoPlantillaDTO>[] = [
    { id: "concepto", value: "Concepto", render: (p) => p.concepto },
    {
      id: "monto",
      // Feature 85 (R22): «Monto mensual» era falso desde que existe la periodicidad, y
      // `progress/impl_189.md §8` dejó la decisión dirigida por escrito a esta ficha: «dos
      // plantillas de ₡50.000, una semanal y una mensual, saldrán como filas idénticas bajo
      // esa etiqueta, y el test seguirá VERDE afirmando que está bien». Cada cuánto se cobra
      // lo dice ahora la columna de al lado.
      value: "Monto",
      // Money-safe (R12): STRING tal cual, sin parseFloat/Number.
      render: (p) => money(p.monto),
    },
    {
      id: "periodicidad",
      value: "Periodicidad",
      // R18/R20: el ciclo EN PALABRAS. El DTO ya traía los tres campos; la pantalla llevaba
      // desde la 84 sin enseñarlos.
      render: (p) => periodicidadLegible(p.periodicidadUnidad, p.periodicidadCantidad),
    },
    {
      id: "proximoCobro",
      value: "Próximo cobro",
      // R18/R19/R23: la fecha del próximo cobro, calculada con el instante del SERVIDOR;
      // «No se cobra» si la plantilla está desactivada.
      render: (p) => proximoCobroTexto(p, ahora),
    },
    {
      id: "estado",
      value: "Estado",
      // Feature 170 (T D.3): el TEXTO del estado sale de `gasto-fijo-estado-label` (módulo
      // puro), el mismo que lee el archivo de la descarga (R8). Aquí queda el color.
      render: (p) => (
        <Badge variant={p.activa ? "default" : "secondary"}>
          {estadoPlantillaGastoFijo(p.activa)}
        </Badge>
      ),
    },
    {
      id: "acciones",
      value: "Acciones",
      render: (p) => (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => abrirEditar(p)}
          >
            Editar
          </Button>
          <Button
            type="button"
            variant={p.activa ? "ghost" : "default"}
            size="sm"
            disabled={alternando === p.id}
            onClick={() => void alternarActiva(p)}
          >
            {p.activa ? "Desactivar" : "Activar"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card>
      {/* Feature 200 (tanda 2): la cabecera deja de armarse a mano con un `flex
          justify-between`. El título y la descripción son los del `CardHeader` y la acción va
          en su slot `CardAction`, que es donde la primitiva la coloca (y donde la alinea con
          la de cualquier otra tarjeta de la app). El TEXTO del botón no cambia: el icono es
          decoración (`aria-hidden`) y no entra en su nombre accesible. */}
      <CardHeader className="border-b">
        <CardTitle>Gastos fijos (plantillas)</CardTitle>
        {/* R22: la descripción decía «automáticamente cada mes», que dejó de ser cierto
            cuando la ficha 84 abrió el ciclo a días y semanas. Ahora nombra lo que manda: la
            periodicidad de cada plantilla, que es lo único que se configura acá (R25: un
            gasto variable o un sueldo no puede ser periódico, y por eso se registra en otro
            formulario). */}
        <CardDescription>
          El sistema cobra estos gastos por su cuenta, según la periodicidad que tenga cada
          una. No los registres a mano: administrá acá las plantillas y desactivá las que ya
          no correspondan.
        </CardDescription>
        <CardAction>
          <Button type="button" onClick={abrirCrear}>
            <Plus aria-hidden="true" />
            Nueva plantilla
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto">
          <DataTable
            columns={columns}
            data={data?.items ?? []}
            rowKey="id"
            ariaLabel={TITULO_DESCARGA}
            emptyMessage="Todavía no hay plantillas de gasto fijo."
            isLoading={cargando}
            error={error ? ERROR_CARGA : null}
            /**
             * Feature 170 (T I.2, R52) — la tabla pinta UNA página; el archivo sigue siendo
             * el CONJUNTO COMPLETO. Salen TODAS las plantillas, activas e inactivas, igual
             * que la tabla: aquí no hay filtro de pantalla que respetar.
             *
             * Feature 184 (T G.2, R1/R2/R6) — ese conjunto ya no se obtiene releyendo el
             * listado sin recorte (`listarPlantillasAction`), sino de la lectura DEDICADA,
             * con el mismo guard de rol. En consultas no se ahorra nada y está medido —es
             * el mismo `findMany` sin `where` sobre una tabla de configuración
             * (`progress/impl_184_tandaG_backend.md §1`)—; lo que cambia es dónde se decide
             * el TOPE: por encima de él el servidor devuelve `limite_excedido` con solo
             * conteos y el conjunto ya no cruza al navegador para descartarlo allí.
             */
            descarga={{
              titulo: TITULO_DESCARGA,
              columnas: COLUMNAS_DESCARGA_GASTOS_FIJOS,
              /**
               * Feature 85 (T F.5): el mapper cierra sobre el MISMO `ahora` con el que se
               * pinta la tabla, así que el archivo y la pantalla no pueden discrepar de
               * fecha en la columna «Próximo cobro».
               */
              obtenerFilas: () =>
                filasDesdeResultado(listarPlantillasCompletoAction(), (p) =>
                  filaDescargaGastoFijo(p, ahora),
                ),
            }}
          />
        </div>
      </CardContent>

      {/* Feature 200 (tanda 2): el control de paginación baja al PIE de la tarjeta, que la
          primitiva ya pinta como banda (`border-t bg-muted/50`) a lo ancho y apoyada en el
          borde inferior. La tabla NO se toca: sigue siendo la MISMA de este archivo —la que el
          censo de `tests/unit/descarga/censo-tablas.ts` vigila POR RUTA—, con su descarga del
          conjunto completo y su paginación server-side.

          `sticky={false}`: el `Card` tiene `overflow-hidden`, así que ya era el contenedor
          contra el que se pegaba la barra —flotar sobre el viewport nunca ocurrió aquí—, y en
          un pie con `display:flex` su envoltorio pegajoso y su centinela de 1px se colocarían
          como dos columnas. Es el mismo motivo por el que la usan así los paneles de
          `DetalleMensajeroPanel` y `DesglosePagosMensajero`. */}
      <CardFooter>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data?.total ?? 0}
          disabled={cargando}
          showFirstLast
          siblingCount={1}
          ariaLabel={PAGINACION_PLANTILLAS_LABEL}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          sticky={false}
          className="w-full justify-between gap-3 py-0"
        />
      </CardFooter>

      <GastoFijoPlantillaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        plantilla={editando}
        onGuardado={recargar}
      />
    </Card>
  );
}
