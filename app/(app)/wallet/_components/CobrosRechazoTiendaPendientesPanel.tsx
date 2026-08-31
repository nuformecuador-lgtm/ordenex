"use client";

import { useState } from "react";
import useSWR from "swr";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { useToast } from "@/hooks/useToast";
import {
  aprobarCobroRechazoTiendaAction,
  listarCobrosRechazoTiendaAction,
  rechazarCobroRechazoTiendaAction,
} from "@/lib/actions/rechazo-tienda-cobro";
import type {
  RechazarCobroRechazoTiendaResult,
  RechazoTiendaCobroDTO,
} from "@/lib/types/rechazo-tienda-cobro";

import {
  COBROS_RECHAZO_COLUMNA,
  COBROS_RECHAZO_DESCRIPCION,
  COBROS_RECHAZO_SECCION,
  COBROS_RECHAZO_TITULO,
  COBROS_RECHAZO_VACIO,
  COBRO_RECHAZO_ACCION,
  COBRO_RECHAZO_MENSAJE,
  SIN_GUIA,
  rechazadoElLegible,
  totalPorCobrarTexto,
} from "./cobro-rechazo-tienda-labels";
import { money } from "./wallet-labels";

// 💰 FICHA 337 (segunda mitad) — LA COLA DE COBROS POR RECHAZO DESDE NOVEDADES.
//
// Desde la primera mitad de esta ficha, la gestión que nace cuando la tienda rechaza desde
// novedades YA NO entra al cierre del mensajero —era el defecto: el mensajero firmaba trabajo que
// no hizo—, y con ella se fue, en pausa, el cobro del flete de devolución. Ésta es su vía propia:
// cada rechazo deja un COBRO PENDIENTE contra la tienda que alguien tiene que decidir, y aquí se
// decide. Decisión del humano del 2026-08-31: **la aprobación va ANTES del cobro**.
//
// ESTE ARCHIVO ES EL ESPEJO DE `CobrosGastoFijoPendientesPanel` (ficha 333), copiado a propósito
// y NO generalizado: aquél salió a producción hace horas, y hacer genérico un panel de dinero con
// la operación andando es el riesgo que no toca correr. Duplicar la forma es más aburrido y mucho
// más seguro.
//
// ⚠️ LO QUE LLAMA LA ATENCIÓN ES UNA INSIGNIA DEL TEMA, NO UN COLOR NUEVO. Se pinta con las MISMAS
// primitivas que el resto del módulo desde el rediseño de la 200 —`Card`/`CardHeader`/
// `CardAction`/`Badge`/`DataTable`— y el único acento es `Badge variant="warning"`, que es un
// token del sistema (`bg-warning-soft`/`text-warning-strong`, con su contraste AA atado por
// `contraste-tokens.guardia` en los DOS temas). Aquí no se inventa ni un banner, ni una animación,
// ni un color fuera del tema: en modo oscuro cualquiera de las tres se rompería.
//
// ⚠️ EL NÚMERO DE LA INSIGNIA ES EL `total` DEL SERVIDOR, NO EL LARGO DEL ARRAY PINTADO. `items`
// viene recortado por el tope del dominio, así que su longitud sería el tamaño del recorte y no la
// cola. Además `WalletModule` monta `<Pagination>`, así que este archivo entra en el alcance de
// `contadores-cabecera.guardia`, que prohíbe —con razón— derivar el contador de la cabecera de la
// longitud de un array en una pantalla paginada. Aquí ni siquiera se escribe.
//
// ⚠️ MONEY-SAFE, Y SIN NINGUNA SUMA. Los dos importes llegan como STRING de dos decimales y se
// pintan TAL CUAL con `money`, en columnas separadas. Ni `parseFloat`, ni `Number(`, ni una
// columna «Total»: sumarlos sería la única operación de dinero de la ficha y existiría sólo para
// pintar una celda. El detalle del cierre enseña esos mismos dos conceptos por separado.
//
// ⚠️ LOS BOTONES DE DECIDIR SON COMODIDAD, NO SEGURIDAD. La autorización real la hace el servicio
// con `esAccesoTotal`; esconder el botón sólo evita que alguien pulse algo que va a fallar.

/** La cola tal como la entrega el servidor: el recorte + el `total` REAL del conjunto. */
export interface CobrosRechazoTiendaPendientes {
  items: RechazoTiendaCobroDTO[];
  /** El número del SERVIDOR. NUNCA `items.length`. */
  total: number;
}

export interface CobrosRechazoTiendaPendientesPanelProps {
  /**
   * La cola PRE-OBTENIDA en el servidor (`page.tsx`), que alimenta el `fallbackData` de SWR. La
   * pantalla no estrena la lista pidiéndosela al navegador: la primera lectura ya pasó por la
   * autorización de la página.
   */
  initialData: CobrosRechazoTiendaPendientes;
  /**
   * Si el actor puede DECIDIR. Se calcula en el servidor y baja por props, igual que
   * `puedeEliminar` en `/ordenes`: la pantalla no deduce roles.
   */
  puedeDecidir: boolean;
  /**
   * Aviso al módulo padre tras una decisión, para que recargue las cifras de la caja: aprobar
   * escribe DOS ingresos en el libro. La sección ya relee LO SUYO por su cuenta (`mutate`).
   */
  onCambio?: () => void;
}

/**
 * Los estados de fallo que comparten aprobar y rechazar (`ok` se resuelve en cada camino).
 *
 * DERIVADO del contrato y no escrito a mano: aprobar añade un dato al `ok` pero sus fallos son
 * los mismos, y si el borde estrenara un estado nuevo, `tsc` obligaría a decidir qué se le dice al
 * usuario en vez de dejarlo caer en el mensaje genérico sin que nadie lo note.
 */
type FalloDecision = Exclude<RechazarCobroRechazoTiendaResult, { status: "ok" }>["status"];

/** Lee la cola del servidor. Un status distinto de `ok` es un error para SWR, no una lista vacía. */
async function leerPendientes(): Promise<CobrosRechazoTiendaPendientes> {
  const res = await listarCobrosRechazoTiendaAction({});
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total };
}

/**
 * Del MÁS ANTIGUO al más reciente, por el día del rechazo.
 *
 * El servidor ya los entrega ordenados (`generado_el`, `created_at`, `id`), y aun así se ordena
 * aquí: el orden es una promesa de LA SECCIÓN, y un test que sólo comprobara que se pintan en el
 * orden recibido estaría afirmando contra su propio fixture. El `sort` de JavaScript es ESTABLE,
 * así que dentro de un mismo día se conserva el desempate del servidor —que la pantalla no puede
 * reproducir: el DTO no expone `createdAt`, y no debe.
 */
function delMasAntiguoAlMasReciente(items: RechazoTiendaCobroDTO[]): RechazoTiendaCobroDTO[] {
  return [...items].sort((a, b) => a.generadoEl.localeCompare(b.generadoEl));
}

export function CobrosRechazoTiendaPendientesPanel({
  initialData,
  puedeDecidir,
  onCambio,
}: CobrosRechazoTiendaPendientesPanelProps) {
  const toast = useToast();

  /** id del cobro cuya decisión está en vuelo: deshabilita SÓLO su fila. */
  const [decidiendo, setDecidiendo] = useState<string | null>(null);

  const { data, error, mutate } = useSWR(
    ["rechazo-tienda:cobros-pendientes"],
    leerPendientes,
    { fallbackData: initialData },
  );

  const cola = data ?? initialData;

  /** La sección relee lo suyo y el módulo refresca las cifras de la caja. */
  function recargar() {
    void mutate();
    onCambio?.();
  }

  /** Traduce un fallo a un aviso legible. `ya_decidido` y `not_found` releen: la lista es vieja. */
  function avisarFallo(status: FalloDecision) {
    if (status === "ya_decidido") {
      // NO es un error del usuario: alguien decidió antes, o dos decisiones llegaron a la vez y el
      // motor serializó. Por eso el tono es informativo y no de fallo.
      toast.info(COBRO_RECHAZO_MENSAJE.yaDecidido);
      recargar();
      return;
    }
    if (status === "not_found") {
      toast.error(COBRO_RECHAZO_MENSAJE.noExiste);
      recargar();
      return;
    }
    if (status === "forbidden") {
      toast.error(COBRO_RECHAZO_MENSAJE.sinPermiso);
      return;
    }
    if (status === "unauthenticated") {
      toast.error(COBRO_RECHAZO_MENSAJE.sesionExpirada);
      return;
    }
    toast.error(COBRO_RECHAZO_MENSAJE.noSePudo);
  }

  /**
   * APRUEBA. Los importes NO viajan: sólo el id. Lo que se cobra es la copia que el cobro congeló
   * en el instante del rechazo, leída en el servidor.
   */
  async function aprobar(cobro: RechazoTiendaCobroDTO) {
    setDecidiendo(cobro.id);
    try {
      const result = await aprobarCobroRechazoTiendaAction({ id: cobro.id });
      if (result.status === "ok") {
        // Los dos finales felices dicen cosas distintas, y la diferencia importa: uno significa
        // «acaba de entrar en la caja» y el otro «ya había entrado».
        toast.success(
          result.yaEstabaEnElLibro
            ? COBRO_RECHAZO_MENSAJE.yaEstabaEnElLibro
            : COBRO_RECHAZO_MENSAJE.aprobado,
        );
        recargar();
        return;
      }
      avisarFallo(result.status);
    } finally {
      setDecidiendo(null);
    }
  }

  /** DESCARTA el cobro. No escribe absolutamente nada en ningún libro, y el aviso lo dice. */
  async function rechazar(cobro: RechazoTiendaCobroDTO) {
    setDecidiendo(cobro.id);
    try {
      const result = await rechazarCobroRechazoTiendaAction({ id: cobro.id });
      if (result.status === "ok") {
        toast.success(COBRO_RECHAZO_MENSAJE.rechazado);
        recargar();
        return;
      }
      avisarFallo(result.status);
    } finally {
      setDecidiendo(null);
    }
  }

  // Sin cobros que decidir la sección NO se renderiza. Una tarjeta vacía permanente sería ruido en
  // la pantalla del dinero; lo que se pide es que se note CUANDO hay algo. El módulo padre ya no la
  // monta con el `total` del servidor en cero; esta guarda cubre el otro camino: decidir el último
  // cobro sin recargar la página.
  if (cola.total === 0) return null;

  const columnasDeDatos: Column<RechazoTiendaCobroDTO>[] = [
    {
      id: "tienda",
      value: COBROS_RECHAZO_COLUMNA.tienda,
      // El nombre de la tienda CONGELADA en el cobro: a quién se le va a cobrar, no a quién
      // apunte la orden hoy.
      render: (c) => c.tiendaNombre,
    },
    {
      id: "guia",
      value: COBROS_RECHAZO_COLUMNA.guia,
      // El hueco se NOMBRA: una orden puede no tener guía asignada, y una celda en blanco no
      // distingue «no tiene» de «no se pudo leer».
      render: (c) => (c.numGuia === null ? SIN_GUIA : String(c.numGuia)),
    },
    {
      id: "remision",
      value: COBROS_RECHAZO_COLUMNA.remision,
      render: (c) => c.numRemision,
    },
    {
      id: "flete",
      value: COBROS_RECHAZO_COLUMNA.flete,
      // Money-safe: el STRING del servidor, TAL CUAL. A la derecha, como cualquier columna de
      // dinero de este repo: así las unidades quedan a la misma altura.
      align: "right",
      render: (c) => money(c.montoFlete),
    },
    {
      id: "iva",
      value: COBROS_RECHAZO_COLUMNA.iva,
      align: "right",
      render: (c) => money(c.montoIva),
    },
    {
      id: "generadoEl",
      value: COBROS_RECHAZO_COLUMNA.generadoEl,
      render: (c) => rechazadoElLegible(c.generadoEl),
    },
  ];

  /** La columna de decisiones existe SÓLO para quien puede decidir. */
  const columnas: Column<RechazoTiendaCobroDTO>[] = puedeDecidir
    ? [
        ...columnasDeDatos,
        {
          id: "acciones",
          value: COBROS_RECHAZO_COLUMNA.acciones,
          render: (c) => (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={decidiendo === c.id}
                onClick={() => void aprobar(c)}
              >
                {COBRO_RECHAZO_ACCION.aprobar}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={decidiendo === c.id}
                onClick={() => void rechazar(c)}
              >
                {COBRO_RECHAZO_ACCION.rechazar}
              </Button>
            </div>
          ),
        },
      ]
    : columnasDeDatos;

  return (
    <section aria-label={COBROS_RECHAZO_SECCION}>
      <Card>
        <CardHeader className="border-b">
          <CardTitle>{COBROS_RECHAZO_TITULO}</CardTitle>
          <CardDescription>{COBROS_RECHAZO_DESCRIPCION}</CardDescription>
          <CardAction>
            {/* El `total` del SERVIDOR. `Badge variant="warning"` es lo que llama la atención sin
                romper el diseño: un token del tema, con contraste AA en claro y en oscuro. */}
            <Badge variant="warning">{totalPorCobrarTexto(cola.total)}</Badge>
          </CardAction>
        </CardHeader>

        <CardContent>
          <div className="overflow-x-auto">
            {/* Sin `descarga` a propósito, mismo criterio que la cola de gasto fijo: es una cola
                de decisión efímera, y lo aprobado aterriza en el libro de la caja y en el de la
                tienda, que sí descargan. Queda registrado con ese motivo en
                `tests/unit/descarga/censo-tablas.ts`, que es lo que la guardia de cobertura obliga
                a decidir. Sin `Pagination`: el servidor ya recorta y el `total` dice la verdad. */}
            <DataTable
              columns={columnas}
              data={delMasAntiguoAlMasReciente(cola.items)}
              rowKey="id"
              ariaLabel={COBROS_RECHAZO_TITULO}
              emptyMessage={COBROS_RECHAZO_VACIO}
              error={error ? COBRO_RECHAZO_MENSAJE.errorCarga : null}
            />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
