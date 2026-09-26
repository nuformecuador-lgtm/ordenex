"use client";

import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  type Column,
  type DescargaFilasResult,
} from "@/components/shared/DataTable";
import { OrigenMovimiento } from "@/components/shared/wallet/OrigenMovimiento";
import { PANEL_TEXTO } from "@/components/shared/wallet/detalle-movimiento-panel-labels";
import type { NaturalezaMovimiento, WalletMovimientoDTO } from "@/lib/types/wallet";
import { cn } from "@/lib/utils";

import { DetalleMovimientoCierre } from "./DetalleMovimientoCierre";
import { DETALLE_MOVIMIENTO_NOMBRE } from "./detalle-movimiento-labels";
import { VerMovimientoCaja } from "./VerMovimientoCaja";
import { COLUMNAS_DESCARGA_WALLET_CAJA } from "./wallet-ledger-descarga-columnas";
import {
  CATEGORIA_LABEL,
  DUENO_LABEL,
  ORIGEN_LABEL,
  TIPO_LABEL,
  money,
} from "./wallet-labels";
import { fechaDiaMovimientoCR } from "@/lib/utils/fecha-dia-iso";

// Feature 42 (T12, R18/R21) — libro de movimientos (tabla, más reciente primero: el
// backend ya lo devuelve ordenado). Datos por props desde el módulo. Money-safe: la
// columna monto renderiza el STRING tal cual con `money`, sin parseFloat/Number.
//
// Feature 45 (T11, R13/R14/R22c/R32) — se añade la acción "Reversar" por fila SOLO sobre
// egresos administrativos (`origen_tipo=gasto` ∧ `tipo=egreso`, incluye los generados por
// el cron). La reversa se confirma con un `Modal` y dispara la Server Action
// `reversarEgresoAdministrativoAction`; el backend crea el `ingreso_ajuste` compensatorio
// (append-only, idempotente) — la UI solo dispara y refresca. No hay editar/borrar (R14).
//
// FICHA 458-C (T C.5, design §5.2, D11; R58, R63, R65, R71) — la columna de acciones pasa a «Ver»:
// cada fila abre el panel compartido (`VerMovimientoCaja` → `DetalleMovimientoPanel`), que es donde
// viven «Anular…» (uniforme, con motivo, por `anularMovimientoAction`), el comprobante y «Cómo quedó».
// «Reversar» y su `Modal` se RETIRAN (D11: dos palabras para lo mismo era la falencia), igual que
// `DocumentoCajaAcciones`. Y con ellos se va la deducción que la 461 hacía EN EL CLIENTE de «ya
// reversado» mirando las filas de la página: desde la 458-B el estado viaja en la fila (`documento`,
// decidido en el servidor, R71), y este libro no mira ninguna otra fila para decidirlo (guardia R98).
// Este archivo vuelve a no importar ninguna Server Action.

/**
 * Badge de color por tipo: ingreso (entra) vs egreso (sale).
 *
 * Feature 200 (tanda 3): pasa de `default`/`destructive` a las variantes SEMÁNTICAS de la
 * primitiva (`success`/`danger`), el mismo arreglo que la tanda 2 hizo en el badge de signo
 * de la cabecera. `default` es el naranja de MARCA —acción primaria/selección, según
 * `DESIGN.md`—, y usarlo para «Ingreso» hacía que la fila más común de la tabla compitiera en
 * color con los botones. Los textos siguen saliendo de `TIPO_LABEL`, intactos.
 */
function TipoBadge({ tipo }: { tipo: WalletMovimientoDTO["tipo"] }) {
  return (
    <Badge variant={tipo === "ingreso" ? "success" : "danger"}>
      {TIPO_LABEL[tipo]}
    </Badge>
  );
}


/**
 * Importe de una fila. El STRING se pinta TAL CUAL con `money(...)`: money-safe (R21/R25),
 * sin `Number`/`parseFloat`/`toFixed`, y SIN anteponerle signo — el `+`/`-` sería un dato
 * inventado por la pantalla, y quien dice la dirección del movimiento es la columna «Tipo».
 * Lo único que añade el color es LEGIBILIDAD: verde entra, rojo sale, en el tono `-strong`
 * que es el que `DESIGN.md` exige para texto (contraste ≥ 4.5:1 sobre la tarjeta).
 * `tabular-nums` mantiene las cifras en rejilla de una fila a otra.
 */
function MontoCelda({ movimiento }: { movimiento: WalletMovimientoDTO }) {
  return (
    <span
      className={cn(
        "tabular-nums",
        movimiento.tipo === "ingreso" ? "text-success-strong" : "text-danger-strong",
      )}
    >
      {money(movimiento.monto)}
    </span>
  );
}

/**
 * Feature 231 (T5.2, R33) — DE QUIEN es el dinero de esta fila: punto de color + texto, NO una
 * insignia. La tabla ya lleva una pastilla por fila (la del tipo) y una segunda al lado
 * convertiria cada renglon en un semaforo doble donde ninguna de las dos se lee.
 *
 * El dato llega YA DERIVADO del servidor (`dueno`, R31/R36): aqui no se mira la categoria ni se
 * consulta ninguna clasificacion, para que la tabla y la descarga no puedan decir cosas
 * distintas. El punto es DECORACION (`aria-hidden`): quien no ve color lee la palabra.
 */
const DUENO_PUNTO: Record<NaturalezaMovimiento, string> = {
  // Ordenex en neutro y las tiendas en `warning`, los MISMOS dos colores con los que la barra
  // de composicion de la tarjeta reparte la caja: es el mismo reparto, fila a fila.
  propio: "bg-muted-foreground",
  terceros: "bg-warning",
  // Ficha 459 (design §5): capital de Ordenex (saldo inicial y aportes), token semantico existente.
  capital: "bg-info",
};

function DuenoCelda({ dueno }: { dueno: NaturalezaMovimiento }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn("size-2 shrink-0 rounded-full", DUENO_PUNTO[dueno])}
        aria-hidden="true"
      />
      {DUENO_LABEL[dueno]}
    </span>
  );
}

/** Nombre visible del libro: hoja, base del nombre de archivo y nombre del control (R12/R13). */
const TITULO_DESCARGA = "Libro de movimientos";

/**
 * Ficha 344 (T6.4, R6) — QUÉ FILA SE PUEDE ABRIR.
 *
 * Sólo las que nacen del cierre del día: es de ahí de donde se llega a las órdenes que componen
 * el importe (`origen_id` apunta al cierre). Un ajuste manual, un gasto o un premio del ranking
 * no tienen órdenes detrás, y la columna «Origen» ya dice de dónde salen.
 *
 * Devolver `null` en `renderExpanded` hace que la primitiva NO pinte el botón sobre esa fila, así
 * que el control no aparece donde no llevaría a ninguna parte. Un movimiento de cierre cuyo
 * concepto no se reparte SÍ se abre, y su panel dice de dónde sale el importe (R48): ése es un
 * hueco de alcance que se ve, no uno que se esconde.
 */
function naceDeUnCierre(m: WalletMovimientoDTO): boolean {
  return m.origenTipo === "cierre_dia";
}

/** La fila, con el estado de anulación que decidió el SERVIDOR (R71): anulada = tachada y apagada. */
function claseDeFila(m: WalletMovimientoDTO): string | undefined {
  return m.documento?.anulado ? "text-muted-foreground line-through" : undefined;
}

/**
 * B2 (revisión 458-C; 457 R41, 459 R66, 461 R20/R71) — la fila anulada DICE «Anulado», con la palabra y
 * no solo con el tachado (que un lector de pantalla no anuncia). Sale del `documento` del servidor, como
 * el tachado. Va en la celda de «Ver», donde vivían las acciones: el orden de las columnas no se toca.
 * Es una insignia (caja en línea atómica), así que el tachado de la fila no la cruza.
 */
function CeldaVer({ m, onCambio }: { m: WalletMovimientoDTO; onCambio?: () => void }) {
  return (
    <div className="flex items-center gap-2">
      {m.documento?.anulado ? <Badge variant="secondary">{PANEL_TEXTO.anulado}</Badge> : null}
      <VerMovimientoCaja movimiento={m} onCambio={onCambio} />
    </div>
  );
}

export interface WalletLedgerProps {
  movimientos: WalletMovimientoDTO[];
  isLoading?: boolean;
  /**
   * Ficha 459 (R65) / 458-C (R60) — tras anular o adjuntar un comprobante desde el panel «Ver»: el
   * módulo relee libro, tarjetas, composición y desglose sin recargar la página.
   */
  onCambio?: () => void;
  /**
   * Feature 170 (T C.4, design §5) — obtiene las filas del libro COMPLETO para la descarga.
   *
   * Es un CALLBACK, no unos filtros: esta tabla pinta la página que le llega por props y no
   * conoce (ni debe conocer) los filtros vigentes; quien los conoce es `WalletModule`, que
   * cierra sobre ellos al invocar la Server Action del modo completo. Bajar el callback es
   * exactamente lo que manda el design §5 —«nunca los filtros a la tabla»— y deja este
   * componente sin fetchear nada.
   *
   * Ausente ⇒ la tabla no monta el control y se comporta igual que antes (R39).
   */
  obtenerFilasDescarga?: () => Promise<DescargaFilasResult>;
}

export function WalletLedger({
  movimientos,
  isLoading = false,
  onCambio,
  obtenerFilasDescarga,
}: WalletLedgerProps) {
  // Feature 200 (tanda 3) — LOS `minWidth` Y LA ALINEACIÓN DEL DINERO.
  //
  // Cada columna declara su ancho MÍNIMO para que, cuando la pantalla no dé, aparezca el
  // scroll horizontal de la tabla ANTES de que las celdas se estrujen (la descripción libre
  // del origen es la que primero se partía en cuatro líneas).
  //
  // EL ORDEN NO SE PERMUTÓ, Y NO ES UN OLVIDO. El rediseño pedía llevar el origen junto a la
  // fecha y el dinero al final (fecha · origen · categoría · tipo · monto · acciones), que es
  // como se lee cualquier extracto. Está BLOQUEADO por una aserción que fija la secuencia
  // exacta de los encabezados visibles:
  //
  //     tests/components/descarga/WalletDescarga.test.tsx:590
  //     («R62: el listado los pinta como a los demás, sin cambiar las columnas»)
  //
  // (La referencia decía «:566» y estaba desactualizada; la aserción vive en la 590. Corregido
  // por la feature 231/T5.2, que es la que volvió a tropezar con ella.)
  //
  // Esa aserción es de la feature 173 y lo que quiere afirmar es otra cosa —que las dos
  // categorías nuevas no AÑADEN ni QUITAN columnas—; el orden se le coló dentro por usar
  // `toEqual` sobre el array.
  //
  // ── Feature 231 (D1, firmada por el humano el 2026-08-18) ──
  // La aserción pasó a afirmar lo que su propio caso dice —que las categorías de la 173 no
  // añaden ni quitan columnas, comparado contra la lista que declara ESTE componente— y la 231
  // añadió su caso propio para «Dueño». La 173 queda igual de protegida y deja de gobernar el
  // número de columnas del libro. El REORDENADO que la 200 quería sigue sin hacerse: es otra
  // decisión y no entra por la puerta de atrás de esta.
  //
  // Lo que sí llega sin tocar el orden: el dinero alineado a la DERECHA, en `tabular-nums` y
  // con su color semántico, que es de donde venía la mayor parte de la ganancia de lectura.
  const columns = useMemo<Column<WalletMovimientoDTO>[]>(
    () => [
      {
        id: "fecha",
        value: "Fecha",
        minWidth: "7rem",
        render: (m) => fechaDiaMovimientoCR(m.fechaMovimiento),
      },
      {
        id: "tipo",
        value: "Tipo",
        minWidth: "6rem",
        render: (m) => <TipoBadge tipo={m.tipo} />,
      },
      {
        id: "categoria",
        value: "Categoría",
        minWidth: "11rem",
        render: (m) => CATEGORIA_LABEL[m.categoria],
      },
      {
        id: "monto",
        value: "Monto",
        minWidth: "9rem",
        // Money-safe (R21/R25): STRING tal cual, sin parseFloat/Number.
        align: "right",
        render: (m) => <MontoCelda movimiento={m} />,
      },
      {
        id: "origen",
        value: "Origen",
        // La más ancha: lleva el origen Y la descripción libre del movimiento.
        minWidth: "18rem",
        // 458-A (R5–R8): el origen con su entidad y, si el rol accede, el enlace a ella.
        render: (m) => <OrigenMovimiento fila={m} rotulos={ORIGEN_LABEL} />,
      },
      {
        // Feature 231 (T5.2, R35): la ULTIMA de las columnas de datos, justo antes de
        // «Acciones». Se anade; ninguna de las anteriores se mueve ni se quita.
        id: "dueno",
        value: "Dueño",
        minWidth: "8rem",
        render: (m) => <DuenoCelda dueno={m.dueno} />,
      },
      {
        // FICHA 458-C (T C.5): la columna de acciones pasa a «Ver». TODA fila se puede ver (R58);
        // lo que se puede hacer con ella lo decide el panel con lo que trae la fila del servidor.
        id: "ver",
        value: "Ver",
        minWidth: "5rem",
        render: (m) => <CeldaVer m={m} onCambio={onCambio} />,
      },
    ],
    [onCambio],
  );

  return (
    <div className="overflow-x-auto">
      <DataTable
        columns={columns}
        data={movimientos}
        rowKey="id"
        ariaLabel={TITULO_DESCARGA}
        isLoading={isLoading}
        emptyMessage="No hay movimientos que coincidan con los filtros."
        // R71/R72 (458-C): anulado = tachado y apagado, decidido por el servidor.
        rowClassName={claseDeFila}
        // Ficha 344 (T6.4, R1–R6): cada fila de CIERRE despliega las órdenes que componen su
        // importe. `renderExpanded` se INVOCA en cada render, pero el `DataTable` solo MONTA el
        // elemento cuando la fila está abierta; como la LECTURA del detalle vive dentro de
        // `DetalleMovimientoCierre`, pintar el libro entero no dispara ninguna lectura de
        // detalle (R2) y abrir una fila dispara exactamente una, solo la de esa fila (R3).
        // (Este componente sigue sin leer nada: no importa ninguna Server Action de lectura ni
        // monta ningún hook de datos, y hay una guardia que lo comprueba sobre esta fuente en
        // `tests/components/descarga/WalletDescarga.test.tsx` — que la lee CRUDA, comentarios
        // incluidos, así que aquí ni siquiera se nombra el hook.)
        //
        // LAS COLUMNAS VISIBLES DEL LIBRO NO SE TOCAN: hay una aserción ajena que fija su
        // secuencia (`tests/components/descarga/WalletDescarga.test.tsx`) y esta ficha no la
        // mueve. La columna del control la antepone la primitiva, fuera de esa lista.
        renderExpanded={(m) =>
          naceDeUnCierre(m) ? (
            <DetalleMovimientoCierre
              movimientoId={m.id}
              concepto={CATEGORIA_LABEL[m.categoria]}
              fecha={fechaDiaMovimientoCR(m.fechaMovimiento)}
            />
          ) : null
        }
        // R5: el nombre accesible identifica SU fila —el concepto y la fecha— y no es un «Ver
        // detalle» repetido en cada renglón del libro. El botón de la primitiva no lleva texto
        // visible (sólo el chevron), así que éste es el único nombre que tiene.
        expandAriaLabel={(m) =>
          DETALLE_MOVIMIENTO_NOMBRE.abrir(
            CATEGORIA_LABEL[m.categoria],
            fechaDiaMovimientoCR(m.fechaMovimiento),
          )
        }
        // Feature 170 (T C.4, R1/R9/R13): el control aparece solo si el módulo bajó el
        // callback; las columnas del archivo las declara ESTA tabla, que es la que sabe
        // qué enseña. Money-safe: el monto viaja como el STRING del servidor, sin `money`
        // (el símbolo de colón convertiría una celda numérica en texto).
        descarga={
          obtenerFilasDescarga
            ? {
                titulo: TITULO_DESCARGA,
                columnas: COLUMNAS_DESCARGA_WALLET_CAJA,
                obtenerFilas: obtenerFilasDescarga,
              }
            : undefined
        }
      />

    </div>
  );
}
