"use client";

import { useState } from "react";
import useSWR from "swr";

import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { SegmentedToggle } from "@/components/shared/SegmentedToggle";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import {
  listarSaldosSatelitesAction,
  listarSaldosSatelitesCompletoAction,
} from "@/lib/actions/conciliacion-satelites";
import { cierreBodegaConfig } from "@/lib/config/cierre-bodega";
import type { ResumenSatelitesDTO, SaldoSateliteDTO } from "@/lib/types/conciliacion-satelites";

import { DesgloseConsolidacionesSatelite } from "./DesgloseConsolidacionesSatelite";
import {
  COLUMNAS_DESCARGA_SALDOS_SATELITES,
  filaDescargaSaldoSatelite,
} from "./saldos-satelites-descarga-columnas";
import {
  RECIBIDO_INCOMPLETO_LABEL,
  RESUMEN_SATELITES,
  SALDOS_SATELITES_COLUMNAS,
  SALDOS_SATELITES_ERROR,
  SALDOS_SATELITES_FILTRO,
  SALDOS_SATELITES_NOMBRE,
  SALDOS_SATELITES_VACIO_CON_PENDIENTE,
  SALDOS_SATELITES_VACIO_TODAS,
  SALDO_NO_ES_CAJA_NOTA_A,
  SALDO_NO_ES_CAJA_NOTA_B,
  SALDO_NO_ES_CAJA_NOTA_DESTACADO,
  SALDO_NO_ES_CAJA_TITULO,
  SIN_DATO,
  ULTIMA_RECIBIDA,
  antiguedadLabel,
  diaCR,
  hayFaltantePorRecibir,
  money,
} from "./satelites-labels";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 (T21, R17/R21/R23) — LOS SALDOS DE LAS BODEGAS SATÉLITE.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// La tercera pantalla de la misma familia: `SaldosTiendasTable` pregunta cuánto le debemos a cada
// tienda, `CuentasPorPagarTable` cuánto a cada mensajero, y ésta cuánto **nos deben a nosotros**,
// en efectivo y todavía dentro de una bodega. Mismo patrón: tabla → desglose desplegable →
// acciones, con los datos por props desde un Server Component que ya resolvió el rol.
//
// ── MONEY-SAFE (R20): CERO `Number(`, CERO `parseFloat`, CERO sumas.
// Cada `saldoSinConciliar` llega como STRING ya cuadrado y se pinta tal cual. Las TRES CIFRAS DE
// CABECERA **no se suman aquí**: llegan de `obtenerResumenSatelitesAction` porque sumar cinco
// importes en el navegador es exactamente la aritmética de dinero que R20 prohíbe.
//
// ── EL CONMUTADOR RECORTA EN EL CLIENTE, Y ESTÁ DICHO
// «Con pendiente (N)» filtra sobre las filas que ya están en la página, sin volver al servidor.
// Es correcto AQUÍ y no lo sería en las tablas grandes de este repo: el conjunto son las bodegas
// satélite de la operación —CINCO en producción— y caben enteras en la primera página. No es una
// decisión de comodidad: con un filtro server-side, la cuenta «(3)/(5)» de las dos pestañas
// exigiría dos lecturas más por render para contar lo que la página ya tiene delante.
// El límite, escrito: si un día hubiera más bodegas que `pageSize`, este recorte hablaría sólo de
// la página visible y habría que subirlo al servidor con su propio `total`.

/** Prefijo de la clave SWR de la tabla de saldos. El desglose la invalida por aquí tras marcar. */
const CLAVE_SALDOS = "wallet-satelites:saldos";

/** Nombre visible del listado: hoja, base del archivo y nombre del control. */
const TITULO_DESCARGA = SALDOS_SATELITES_NOMBRE.tabla;

/** R40: el tamaño sale de la config del dominio, nunca de un literal de pantalla. */
const PAGE_SIZE_OPTIONS = [10, 25, 50].filter((s) => s <= cierreBodegaConfig.MAX_PAGE_SIZE);

/** Los dos conjuntos del conmutador. */
type FiltroSaldos = "con_pendiente" | "todas";

export interface SaldosSatelitesPagina {
  items: SaldoSateliteDTO[];
  total: number;
  pageSize: number;
}

async function leerPagina(page: number, pageSize: number): Promise<SaldosSatelitesPagina> {
  const res = await listarSaldosSatelitesAction({ page, pageSize });
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

/** ¿Esta bodega tiene efectivo pendiente de llegar? Money-safe: pregunta TEXTUAL sobre el STRING
 *  que el servidor cuadró, con la MISMA función que decide «Recibido incompleto» en el desglose. */
function tienePendiente(saldo: SaldoSateliteDTO): boolean {
  return hayFaltantePorRecibir(saldo.saldoSinConciliar);
}

/** Una de las tres tarjetas de cabecera. Rótulo, cifra grande y la línea que la descompone. */
function TarjetaResumen({
  rotulo,
  valor,
  detalle,
  tono,
}: Readonly<{
  rotulo: string;
  /** STRING del servidor. `null` = aún no cargado: se pinta «—», nunca un cero falso. */
  valor: string | null;
  detalle: string;
  /** Token semántico de `DESIGN.md`. Ausente = la tinta normal del texto. */
  tono?: "success" | "warning";
}>) {
  const color =
    tono === "success"
      ? "text-success-strong"
      : tono === "warning"
        ? "text-warning-strong"
        : "text-foreground";
  return (
    <div className="flex flex-1 flex-col gap-1 rounded-lg border border-border bg-card p-4">
      <span className="text-sm text-muted-foreground">{rotulo}</span>
      <span className={`text-2xl font-semibold tabular-nums ${color}`}>
        {valor === null ? SIN_DATO : money(valor)}
      </span>
      <span className="text-xs text-muted-foreground">{detalle}</span>
    </div>
  );
}

export interface SaldosSatelitesTableProps {
  /** PÁGINA 1 resuelta server-side + el `total` del conjunto. Alimenta el `fallbackData` de SWR. */
  initialData: SaldosSatelitesPagina;
  /**
   * Las TRES cifras de cabecera, resueltas server-side y YA CUADRADAS (R20). `null` si la lectura
   * degradó: las tarjetas enseñan «—» y la tabla sigue en pie — una cabecera que no carga no es
   * motivo para esconder los saldos.
   */
  resumen: ResumenSatelitesDTO | null;
  /**
   * Si el actor puede marcar y desmarcar. Lo decide el SERVIDOR con `esAccesoTotal`, el MISMO
   * predicado con el que `ConciliacionSatelitesService` responde `forbidden` (R27). **Default
   * `false`: falla cerrado** — quien monte esta tabla sin decidir el permiso no ofrece conciliar.
   */
  puedeConciliar?: boolean;
}

export function SaldosSatelitesTable({
  initialData,
  resumen,
  puedeConciliar = false,
}: Readonly<SaldosSatelitesTableProps>) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialData.pageSize);
  const [filtro, setFiltro] = useState<FiltroSaldos>("con_pendiente");

  const { data, error } = useSWR([CLAVE_SALDOS, page, pageSize], () => leerPagina(page, pageSize), {
    fallbackData: page === 1 && pageSize === initialData.pageSize ? initialData : undefined,
  });

  // El esqueleto sólo cuando NO hay nada que pintar: `isLoading` de SWR sigue en `true` mientras
  // revalida aunque haya `fallbackData`, y usarlo tal cual haría que la página 1 —la que el Server
  // Component ya resolvió— apareciera como esqueleto antes de enseñar las filas.
  const cargando = data === undefined;

  const todas = data?.items ?? [];
  const conPendiente = todas.filter(tienePendiente);
  const filas = filtro === "con_pendiente" ? conPendiente : todas;

  const COLUMNS: Column<SaldoSateliteDTO>[] = [
    {
      id: "bodega",
      value: SALDOS_SATELITES_COLUMNAS.bodega,
      render: (s) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className={tienePendiente(s) ? "font-medium" : ""}>{s.zonaNombre}</span>
          {/* La marca de «llegó incompleta» a nivel de bodega: hay saldo pendiente y NINGUNA
              consolidación sin marcar, así que lo que queda es pura diferencia de una ya
              conciliada. Es el caso que hay que poder distinguir de un bulto que no ha salido. */}
          {tienePendiente(s) && s.consolidacionesSinConciliar === 0 ? (
            <Badge variant="warning">{RECIBIDO_INCOMPLETO_LABEL}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: "pendiente",
      value: SALDOS_SATELITES_COLUMNAS.pendiente,
      // Money-safe: el STRING tal cual. Sin pendiente se pinta «—» y no «₡0,00»: una bodega al
      // día no tiene un saldo de cero que mirar, no tiene saldo.
      render: (s) =>
        tienePendiente(s) ? (
          <span className="font-medium tabular-nums">{money(s.saldoSinConciliar)}</span>
        ) : (
          <span className="text-muted-foreground">{SIN_DATO}</span>
        ),
    },
    {
      id: "masAntigua",
      value: SALDOS_SATELITES_COLUMNAS.masAntigua,
      /**
       * R21/Q6 — CUÁNTO LLEVA, y nada más.
       *
       * ⚠️ El color NO depende de la antigüedad: `warning` si hay cola, `success` si no la hay, y
       * ningún umbral en medio. Pintar de rojo «a los N días» sería inventar el número que Q6
       * dice expresamente que el spec no se inventa, y sería el bloqueo volviendo por la puerta
       * de atrás. Los días los derivó el SERVIDOR con el calendario de Costa Rica: aquí no se
       * restan fechas.
       */
      render: (s) => (
        <Badge variant={s.consolidacionesSinConciliar > 0 ? "warning" : "success"}>
          {antiguedadLabel(s.diasDeLaMasAntigua)}
        </Badge>
      ),
    },
    {
      id: "ultimaRecibida",
      value: SALDOS_SATELITES_COLUMNAS.ultimaRecibida,
      /**
       * ⭑ LA ÚLTIMA VEZ QUE LLEGÓ UN BULTO: su fecha y lo que traía. Es contexto —dice que esta
       * bodega SÍ entrega, y cuándo fue la última vez—, no deuda.
       *
       * ⚠️ NO es `totalRecibido`, que es la SUMA histórica de todo lo que ha entregado. Bajo un
       * rótulo que dice «Última recibida», el acumulado sería un número de seis cifras que
       * promete una cosa y cuenta otra. Sin ninguna recibida se pinta «—», no un cero.
       *
       * Y si esa última llegó incompleta, se dice ahí mismo («₡ 485.000 de ₡ 500.000»): es el
       * sitio donde alguien mira cuando pregunta «¿llegó lo de esta bodega?». La pregunta se
       * hace sobre el `faltaPorRecibir` que el SERVIDOR ya restó; aquí no se compara dinero.
       */
      render: (s) =>
        s.ultimaRecibida === null ? (
          <span className="text-muted-foreground">{SIN_DATO}</span>
        ) : (
          <span className="flex flex-col">
            <span className="tabular-nums text-muted-foreground">
              {ULTIMA_RECIBIDA.linea(diaCR(s.ultimaRecibida.fecha), s.ultimaRecibida.monto)}
            </span>
            {hayFaltantePorRecibir(s.ultimaRecibida.faltaPorRecibir) ? (
              <span className="text-xs tabular-nums text-warning-strong">
                {ULTIMA_RECIBIDA.deDeclarado(s.ultimaRecibida.declarado)}
              </span>
            ) : null}
          </span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Las tres tarjetas. Los importes llegan cuadrados del servidor (R20). */}
      <div className="flex flex-col gap-4 md:flex-row">
        <TarjetaResumen
          rotulo={RESUMEN_SATELITES.pendienteRotulo}
          valor={resumen?.pendienteTotal ?? null}
          detalle={
            resumen === null
              ? ""
              : resumen.consolidacionesSinConciliar === 0 && resumen.bodegasConPendiente === 0
                ? RESUMEN_SATELITES.pendienteVacio
                : RESUMEN_SATELITES.pendienteDetalle(
                    resumen.consolidacionesSinConciliar,
                    resumen.bodegasConPendiente,
                  )
          }
        />
        <TarjetaResumen
          rotulo={RESUMEN_SATELITES.recibidoRotulo}
          valor={resumen?.recibidoEsteMes ?? null}
          detalle={resumen === null ? "" : RESUMEN_SATELITES.recibidoDetalle(resumen.consolidacionesRecibidasEsteMes)}
          tono="success"
        />
        <TarjetaResumen
          rotulo={RESUMEN_SATELITES.diferenciaRotulo}
          valor={resumen?.diferenciaTotal ?? null}
          detalle={
            resumen === null
              ? ""
              : resumen.consolidacionesConDiferencia === 0
                ? RESUMEN_SATELITES.diferenciaVacio
                : RESUMEN_SATELITES.diferenciaDetalle(resumen.consolidacionesConDiferencia)
          }
          tono="warning"
        />
      </div>

      {/* El conmutador, con su cuenta en cada opción: la pestaña que no se mira sigue diciendo
          cuántas hay, que es la razón de que `SegmentedToggle` tenga `conteo`. */}
      <SegmentedToggle
        options={[
          {
            valor: "con_pendiente",
            etiqueta: SALDOS_SATELITES_FILTRO.conPendiente,
            conteo: conPendiente.length,
          },
          { valor: "todas", etiqueta: SALDOS_SATELITES_FILTRO.todas, conteo: todas.length },
        ]}
        valor={filtro}
        onChange={setFiltro}
        ariaLabel={SALDOS_SATELITES_FILTRO.ariaLabel}
      />

      <div className="overflow-x-auto">
        <DataTable
          columns={COLUMNS}
          data={filas}
          rowKey="zonaId"
          ariaLabel={TITULO_DESCARGA}
          emptyMessage={
            filtro === "con_pendiente"
              ? SALDOS_SATELITES_VACIO_CON_PENDIENTE
              : SALDOS_SATELITES_VACIO_TODAS
          }
          isLoading={cargando}
          error={error ? SALDOS_SATELITES_ERROR : null}
          /**
           * R29 — la tabla pinta UNA página; el archivo es el CONJUNTO COMPLETO, con el mismo
           * alcance y el mismo orden, y con el tope de filas evaluado en el SERVIDOR. Descargar no
           * amplía lo que el actor podía ver.
           *
           * ⚠️ El archivo lleva TODAS las bodegas, también las que el conmutador está escondiendo:
           * el recorte «Con pendiente» es de PANTALLA y no un filtro del conjunto. Un archivo que
           * cambiara según qué pestaña estuviera abierta sería la clase de sorpresa que hace que
           * nadie se fíe de una descarga.
           */
          descarga={{
            titulo: TITULO_DESCARGA,
            columnas: COLUMNAS_DESCARGA_SALDOS_SATELITES,
            obtenerFilas: () =>
              filasDesdeResultado(
                listarSaldosSatelitesCompletoAction({}),
                filaDescargaSaldoSatelite,
              ),
          }}
          /**
           * R24/R25 — cada fila despliega el DESGLOSE de SU bodega. `renderExpanded` se INVOCA en
           * cada render, pero el `DataTable` sólo MONTA el elemento cuando la fila está abierta;
           * como el `useSWR` vive dentro del desglose, listar N bodegas no dispara ninguna lectura
           * y abrir una fila dispara exactamente una, sólo la de esa bodega.
           */
          renderExpanded={(s) => (
            <DesgloseConsolidacionesSatelite
              resumen={s}
              id={`desglose-satelite-${s.zonaId}`}
              puedeConciliar={puedeConciliar}
            />
          )}
          expandAriaLabel={(s) => SALDOS_SATELITES_NOMBRE.expandir(s.zonaNombre)}
        />
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
        disabled={cargando}
        showFirstLast
        siblingCount={1}
        ariaLabel={SALDOS_SATELITES_NOMBRE.paginacion}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
      />

      {/*
        ⚠️ LA NOTA QUE IMPIDE CONTAR DOS VECES. Va aquí, bajo la tabla y sin desplegable: un
        número de siete cifras llamado «pendiente» dentro del módulo Wallet se lee como plata por
        cobrar, y quien lo sume al balance la habrá contado dos veces. Ese dinero YA entró a la
        caja cuando se aprobó el cierre de cada mensajero.
      */}
      <p role="note" className="text-xs leading-relaxed text-muted-foreground">
        <strong className="font-semibold text-foreground">{SALDO_NO_ES_CAJA_TITULO}</strong>{" "}
        {SALDO_NO_ES_CAJA_NOTA_A}{" "}
        <strong className="font-semibold text-foreground">
          {SALDO_NO_ES_CAJA_NOTA_DESTACADO}
        </strong>
        {SALDO_NO_ES_CAJA_NOTA_B}
      </p>
    </div>
  );
}
