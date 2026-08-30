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
  aprobarCobroGastoFijoAction,
  listarCobrosPendientesAction,
  rechazarCobroGastoFijoAction,
} from "@/lib/actions/gasto-fijo-cobro";
import type {
  GastoFijoCobroDTO,
  RechazarCobroGastoFijoResult,
} from "@/lib/types/gasto-fijo-cobro";

import {
  COBROS_PENDIENTES_COLUMNA,
  COBROS_PENDIENTES_DESCRIPCION,
  COBROS_PENDIENTES_SECCION,
  COBROS_PENDIENTES_TITULO,
  COBROS_PENDIENTES_VACIO,
  COBRO_ACCION,
  COBRO_MENSAJE,
  generadoElLegible,
  periodoCobroLegible,
  totalPorAprobarTexto,
} from "./cobro-gasto-fijo-labels";
import { money } from "./wallet-labels";

// FICHA 333 (G1, design §7 · R37–R43) — LA COLA DE COBROS DE GASTO FIJO POR APROBAR.
//
// Desde esta ficha el cron ya no escribe el egreso del gasto fijo directo en el libro cuando la
// plantilla «requiere aprobación»: crea un COBRO pendiente que alguien tiene que decidir. Esta
// sección es donde se decide, y por eso vive DENTRO de `/wallet`, entre la tarjeta de la caja y
// la de la ganancia: es lo primero que se lee después del dinero.
//
// ⚠️ LO QUE LLAMA LA ATENCIÓN ES UNA INSIGNIA DEL TEMA, NO UN COLOR NUEVO (R37). Se pinta con las
// MISMAS primitivas que el resto del módulo desde el rediseño de la 200 —`Card`/`CardHeader`/
// `CardAction`/`Badge`/`DataTable`— y el único acento es `Badge variant="warning"`, que es un
// token del sistema (`bg-warning-soft`/`text-warning-strong`, con su contraste AA atado por
// `contraste-tokens.guardia` en los DOS temas). Aquí no se inventa ni un banner, ni una
// animación, ni un color fuera del tema: en modo oscuro cualquiera de las tres se rompería.
//
// ⚠️ EL NÚMERO DE LA INSIGNIA ES EL `total` DEL SERVIDOR, NO EL LARGO DEL ARRAY PINTADO (R41).
// `items` viene recortado por el tope del dominio, así que su longitud sería el tamaño del recorte
// y no la cola. Además `WalletModule` monta `<Pagination>`, así que este archivo entra en el
// alcance de `contadores-cabecera.guardia`, que prohíbe —con razón— derivar el contador de la
// cabecera de la longitud de un array en una pantalla paginada. Aquí ni siquiera se escribe.
//
// ⚠️ MONEY-SAFE (R43): el monto llega como STRING de dos decimales y se pinta TAL CUAL con
// `money`. Ni `parseFloat`, ni `Number(`, ni aritmética: este archivo está censado en
// `tests/unit/guards/gasto-fijo-cobro-money-safe.guardia.test.ts`.
//
// ⚠️ LOS BOTONES DE DECIDIR SON COMODIDAD, NO SEGURIDAD (R40 vs R24). La autorización real la
// hace el servicio con `puedeDecidirCobroGastoFijo` (`maestro` y nadie más) y responde
// `forbidden` al `admin` aunque tenga acceso total. Esconder el botón sólo evita que el admin
// pulse algo que va a fallar; no es lo que impide que ocurra.

/** La cola tal como la entrega el servidor: el recorte + el `total` REAL del conjunto (R41). */
export interface CobrosGastoFijoPendientes {
  items: GastoFijoCobroDTO[];
  /** El número del SERVIDOR. NUNCA `items.length` (R41). */
  total: number;
}

export interface CobrosGastoFijoPendientesPanelProps {
  /**
   * R44 — la cola PRE-OBTENIDA en el servidor (`page.tsx`), que alimenta el `fallbackData` de
   * SWR. La pantalla no estrena la lista pidiéndosela al navegador: la primera lectura ya pasó
   * por la autorización de la página.
   */
  initialData: CobrosGastoFijoPendientes;
  /**
   * R40 — si el actor puede DECIDIR (`maestro`). Se calcula en el servidor y baja por props,
   * igual que `puedeEliminar` en `/ordenes`: la pantalla no deduce roles.
   */
  puedeDecidir: boolean;
  /**
   * R42 — aviso al módulo padre tras una decisión, para que recargue las cifras de la caja. La
   * sección ya relee LO SUYO por su cuenta (`mutate`).
   */
  onCambio?: () => void;
}

/**
 * Los estados de fallo que comparten aprobar y rechazar (`ok` se resuelve en cada camino).
 *
 * DERIVADO del contrato y no escrito a mano: aprobar añade un dato al `ok` pero sus fallos son
 * los mismos, y si el borde estrenara un estado nuevo, `tsc` obligaría a decidir qué se le dice
 * al usuario en vez de dejarlo caer en el mensaje genérico sin que nadie lo note.
 */
type FalloDecision = Exclude<RechazarCobroGastoFijoResult, { status: "ok" }>["status"];

/** Lee la cola del servidor. Un status distinto de `ok` es un error para SWR, no una lista vacía. */
async function leerPendientes(): Promise<CobrosGastoFijoPendientes> {
  const res = await listarCobrosPendientesAction({});
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total };
}

/**
 * R39 — del MÁS ANTIGUO al más reciente, por el día en que se generó.
 *
 * El servidor ya los entrega ordenados (`generado_el`, `created_at`, `id`), y aun así se ordena
 * aquí: R39 es una promesa de LA SECCIÓN, y un test que sólo comprobara que se pintan en el orden
 * recibido estaría afirmando contra su propio fixture. El `sort` de JavaScript es ESTABLE, así
 * que dentro de un mismo día se conserva el desempate del servidor —que la pantalla no puede
 * reproducir: el DTO no expone `createdAt`, y no debe.
 */
function delMasAntiguoAlMasReciente(items: GastoFijoCobroDTO[]): GastoFijoCobroDTO[] {
  return [...items].sort((a, b) => a.generadoEl.localeCompare(b.generadoEl));
}

export function CobrosGastoFijoPendientesPanel({
  initialData,
  puedeDecidir,
  onCambio,
}: CobrosGastoFijoPendientesPanelProps) {
  const toast = useToast();

  /** id del cobro cuya decisión está en vuelo: deshabilita SÓLO su fila. */
  const [decidiendo, setDecidiendo] = useState<string | null>(null);

  const { data, error, mutate } = useSWR(
    ["gasto-fijo:cobros-pendientes"],
    leerPendientes,
    { fallbackData: initialData },
  );

  const cola = data ?? initialData;

  /** R42: la sección relee lo suyo y el módulo refresca las cifras de la caja. */
  function recargar() {
    void mutate();
    onCambio?.();
  }

  /** Traduce un fallo a un aviso legible. `ya_decidido` y `not_found` releen: la lista es vieja. */
  function avisarFallo(status: FalloDecision) {
    if (status === "ya_decidido") {
      // NO es un error del usuario (R17/R18): alguien decidió antes, o dos decisiones llegaron a
      // la vez y el motor serializó. Por eso el tono es informativo y no de fallo.
      toast.info(COBRO_MENSAJE.yaDecidido);
      recargar();
      return;
    }
    if (status === "not_found") {
      toast.error(COBRO_MENSAJE.noExiste);
      recargar();
      return;
    }
    if (status === "forbidden") {
      toast.error(COBRO_MENSAJE.sinPermiso);
      return;
    }
    if (status === "unauthenticated") {
      toast.error(COBRO_MENSAJE.sesionExpirada);
      return;
    }
    toast.error(COBRO_MENSAJE.noSePudo);
  }

  /**
   * R14/R19 — APRUEBA. El monto NO viaja: sólo el id. Lo que se cobra es la copia que el cobro
   * guardó cuando se generó, leída en el servidor (R16).
   */
  async function aprobar(cobro: GastoFijoCobroDTO) {
    setDecidiendo(cobro.id);
    try {
      const result = await aprobarCobroGastoFijoAction({ id: cobro.id });
      if (result.status === "ok") {
        // R19: los dos finales felices dicen cosas distintas, y la diferencia importa — uno
        // significa «acaba de salir de la caja» y el otro «ya había salido».
        toast.success(
          result.yaEstabaEnElLibro
            ? COBRO_MENSAJE.yaEstabaEnElLibro
            : COBRO_MENSAJE.aprobado,
        );
        recargar();
        return;
      }
      avisarFallo(result.status);
    } finally {
      setDecidiendo(null);
    }
  }

  /** R21 — RECHAZA. No escribe absolutamente nada en el libro, y el aviso lo dice. */
  async function rechazar(cobro: GastoFijoCobroDTO) {
    setDecidiendo(cobro.id);
    try {
      const result = await rechazarCobroGastoFijoAction({ id: cobro.id });
      if (result.status === "ok") {
        toast.success(COBRO_MENSAJE.rechazado);
        recargar();
        return;
      }
      avisarFallo(result.status);
    } finally {
      setDecidiendo(null);
    }
  }

  // R38: sin cobros que decidir la sección NO se renderiza. Una tarjeta vacía permanente sería
  // ruido en la pantalla del dinero; lo que se pide es que se note CUANDO hay algo. El módulo
  // padre ya no la monta con el `total` del servidor en cero; esta guarda cubre el otro camino:
  // decidir el último cobro sin recargar la página.
  if (cola.total === 0) return null;

  const columnasDeDatos: Column<GastoFijoCobroDTO>[] = [
    {
      id: "concepto",
      value: COBROS_PENDIENTES_COLUMNA.concepto,
      render: (c) => c.concepto,
    },
    {
      id: "periodo",
      value: COBROS_PENDIENTES_COLUMNA.periodo,
      // El período EN PALABRAS: «agosto de 2026» / «29 de agosto de 2026». La clave del libro
      // (`origen_id`) no cruza al navegador y aquí no hace falta para nada.
      render: (c) => periodoCobroLegible(c.periodo),
    },
    {
      id: "monto",
      value: COBROS_PENDIENTES_COLUMNA.monto,
      // Money-safe (R43): el STRING del servidor, TAL CUAL. A la derecha, como cualquier
      // columna de dinero de este repo: así las unidades quedan a la misma altura.
      align: "right",
      render: (c) => money(c.monto),
    },
    {
      id: "generadoEl",
      value: COBROS_PENDIENTES_COLUMNA.generadoEl,
      render: (c) => generadoElLegible(c.generadoEl),
    },
  ];

  /** R40: la columna de decisiones existe SÓLO para quien puede decidir. */
  const columnas: Column<GastoFijoCobroDTO>[] = puedeDecidir
    ? [
        ...columnasDeDatos,
        {
          id: "acciones",
          value: COBROS_PENDIENTES_COLUMNA.acciones,
          render: (c) => (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={decidiendo === c.id}
                onClick={() => void aprobar(c)}
              >
                {COBRO_ACCION.aprobar}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={decidiendo === c.id}
                onClick={() => void rechazar(c)}
              >
                {COBRO_ACCION.rechazar}
              </Button>
            </div>
          ),
        },
      ]
    : columnasDeDatos;

  return (
    <section aria-label={COBROS_PENDIENTES_SECCION}>
      <Card>
        <CardHeader className="border-b">
          <CardTitle>{COBROS_PENDIENTES_TITULO}</CardTitle>
          <CardDescription>{COBROS_PENDIENTES_DESCRIPCION}</CardDescription>
          <CardAction>
            {/* R41: `total` del SERVIDOR. `Badge variant="warning"` es lo que llama la atención
                sin romper el diseño: un token del tema, con contraste AA en claro y en oscuro. */}
            <Badge variant="warning">{totalPorAprobarTexto(cola.total)}</Badge>
          </CardAction>
        </CardHeader>

        <CardContent>
          <div className="overflow-x-auto">
            {/* Sin `descarga` a propósito (design §7): es una cola de decisión efímera, y lo que
                se aprueba aterriza en el libro de la caja, que sí descarga. Queda registrado con
                ese motivo en `tests/unit/descarga/censo-tablas.ts`, que es lo que la guardia de
                cobertura obliga a decidir. Sin `Pagination`: el servidor ya recorta y el `total`
                dice la verdad. */}
            <DataTable
              columns={columnas}
              data={delMasAntiguoAlMasReciente(cola.items)}
              rowKey="id"
              ariaLabel={COBROS_PENDIENTES_TITULO}
              emptyMessage={COBROS_PENDIENTES_VACIO}
              error={error ? COBRO_MENSAJE.errorCarga : null}
            />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
