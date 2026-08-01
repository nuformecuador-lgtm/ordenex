"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/shared/Modal";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { filasLocales } from "@/components/shared/descarga-resultado";
import { useToast } from "@/hooks/useToast";
import {
  verCierreDetalle,
  aprobarCierre,
  rechazarCierre,
  forzarSolicitudVencido,
  listarHistoricoCierresAdminPaginado,
} from "@/lib/actions/cierres-admin";
import type { CierreAdminResumen } from "@/lib/interfaces/services/ICierresAdminService";
import type {
  CierreDetalleGestion,
  CierreGrupos,
  TotalesIngresoOrdenex,
} from "@/lib/interfaces/services/ICierreDiaService";
import { montoValido } from "@/app/(app)/wallet/_components/wallet-labels";
// Feature 158 (m5 del review): el tope del monto se IMPORTA del borde del servidor, no se
// reescribe. Sale de la precisión de la columna (`DECIMAL(12,2)` → 9999999999.99); si algún
// día cambia, un literal duplicado aquí se quedaría desalineado en silencio y volvería el
// mismo callejón: el cliente habilitando un monto que la transacción no puede escribir.
import { INDEMNIZACION_MONTO_MAX } from "@/lib/types/cierres-admin";
// Feature 158/R34: la etiqueta visible de la causa sale del catálogo derivado del SEED (mismo
// módulo que usa el panel del mensajero para capturarla). El admin decide el monto MIRANDO la
// causa: no puede ser un slug crudo ni, peor, no estar.
import { CAUSA_INCIDENTE_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-incidente-options";
import {
  money,
  EstadoCierreBadge,
  PAGO_MENSAJERO_COL,
  INGRESO_BODEGA_RECHAZOS_COL,
} from "./cierre-detalle-shared";
import {
  CierreFacturaResumen,
  CierreFacturaDetalle,
} from "./cierre-factura";
import { destinoCierre } from "./cierre-labels";
import {
  CierresAdminHistoricoTabla,
  type CierresAdminHistoricoPagina,
} from "./CierresAdminHistoricoTabla";
import {
  COLUMNAS_DESCARGA_CIERRES_PENDIENTES,
  filaDescargaCierrePendiente,
} from "./cierres-admin-descarga-columnas";

// Feature 38 (T13, R3-R11): módulo cliente de "Cierres del día" del admin. Recibe
// del Server Component padre los cierres del alcance ya resueltos (pendientes de
// decisión + histórico de solo lectura) y `sinZona`. Al abrir un cierre pide el
// detalle por Server Action (evidencias firmadas, R7) y muestra los totales
// snapshot (R8) + las 4 secciones por resultado (reuso del render de la 37, R6).
// Las decisiones (aprobar/rechazar) van por Server Action y refrescan la ruta. Los
// montos llegan como STRING (money-safe, R9): se renderizan tal cual, sin
// `parseFloat`/`Number`. Los helpers de detalle (money/columnas/etiquetas) viven en
// `cierre-detalle-shared` (compartidos con los módulos de cierre de bodega, feat 40).

export interface CierresAdminModuleProps {
  /** Cierres en estado `solicitado` del alcance del admin (cola de decisión, R4). */
  pendientes: CierreAdminResumen[];
  /**
   * Feature 170 — FASE 2 (T I.2, R40/R41): PÁGINA 1 del histórico de resueltos (R5), ya
   * resuelta server-side, más el `total` del conjunto. Deja de ser el array entero: ese es
   * justo el que crecía sin techo (design §11.3).
   */
  historico: CierresAdminHistoricoPagina;
  /** `true` si el adminSatelite no tiene zona asignada (R3). */
  sinZona: boolean;
}

/** Nombre visible de la cola: hoja, base del archivo y nombre del control (R12/R13). */
const TITULO_DESCARGA_PENDIENTES = "Cierres pendientes de decisión";

/**
 * Feature 170 — FASE 2 (T I.2, R40/R41): una página del histórico. El alcance NO viaja en el
 * input —lo resuelve el servicio desde la sesión, igual que el listado sin paginar (R44)—;
 * aquí solo van el número de página y el tamaño.
 */
async function leerHistorico(
  page: number,
  pageSize: number,
): Promise<CierresAdminHistoricoPagina> {
  const res = await listarHistoricoCierresAdminPaginado({ page, pageSize });
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total, pageSize: res.pageSize };
}

// --- Feature 158 (R19/R34): captura del monto de indemnización al aprobar. Textos
// separados de la lógica (i18n-ready), como el resto del módulo. ---
const INDEMNIZACION_TITULO = "Indemnizar los incidentes del cierre";
const INDEMNIZACION_DETALLE =
  "Este cierre trae paquetes dañados, perdidos o robados. Indicá cuánto se indemniza por cada uno: al aprobar, la suma sale de la caja principal como un solo egreso.";
const INDEMNIZACION_CONFIRMAR = "Aprobar e indemnizar";
const INDEMNIZACION_MONTO_LABEL = "Monto de la indemnización";
/**
 * Feature 158 (m5 del review) — mensajes POR FILA del monto inválido. Dicen QUÉ corregir, no
 * sólo que está mal: un «monto inválido» deja al admin adivinando si sobra un dígito, si el
 * problema es la coma o si el tope es otro. El máximo se interpola del contrato, no se teclea.
 */
const INDEMNIZACION_MONTO_EXCEDE = `El monto no puede superar ₡${INDEMNIZACION_MONTO_MAX} (10 dígitos y 2 decimales). Revisá si sobra un dígito.`;
const INDEMNIZACION_MONTO_FORMATO =
  "Escribí un monto mayor que 0, con punto decimal y sin separador de miles (por ejemplo 12500.00).";
/** R34: rótulo de la causa en la fila del incidente (el dato que justifica el monto). */
const INDEMNIZACION_CAUSA_LABEL = "Causa";
/** Causa ausente: no debería pasar (el borde la exige, R9), pero no se inventa un valor. */
const INDEMNIZACION_CAUSA_DESCONOCIDA = "Sin causa registrada";
const INDEMNIZACION_MONTO_AYUDA = `Mayor que 0 y hasta ₡${INDEMNIZACION_MONTO_MAX}, con hasta 2 decimales (por ejemplo 12500.00).`;
const INDEMNIZACION_FALTAN =
  "Falta el monto de al menos un incidente, o alguno no es válido. No se puede aprobar así.";

/** Detalle abierto: la cabecera del cierre + sus gestiones agrupadas por resultado. */
interface DetalleAbierto {
  cierre: CierreAdminResumen;
  grupos: CierreGrupos;
  /** Ingreso de Ordenex del cierre por concepto (derivado del snapshot, money-safe). */
  totalesIngreso: TotalesIngresoOrdenex;
  /**
   * Feature 102/R8/R10: desglose del ingreso de bodega por rechazos particionado por origen
   * (SLA del cron 99 / manual del mensajero). `total` = snapshot leído; `sla + manual === total`
   * (server-side). Llega igual al alcance satélite por el mismo camino (`verCierreDetalle`).
   */
  desgloseIngresoBodegaRechazos: { sla: string; manual: string; total: string };
  /** Ingreso bruto menos el pago al mensajero, derivado server-side (puede ser negativo). */
  ganancia: string;
  /** Total general menos flete + IVA y comisión + IVA, derivado server-side (puede ser negativo). */
  pagoTienda: string;
}

export function CierresAdminModule({
  pendientes,
  historico,
  sinZona,
}: Readonly<CierresAdminModuleProps>) {
  const router = useRouter();
  const toast = useToast();

  // Detalle del cierre abierto (null = modal cerrado).
  const [detalle, setDetalle] = useState<DetalleAbierto | null>(null);
  // Evidencia (URL firmada, R7) en el visor; null = cerrado.
  const [evidencia, setEvidencia] = useState<string | null>(null);
  // Sub-modal de rechazo (R11): true = abierto.
  const [rechazando, setRechazando] = useState(false);
  // Motivo del rechazo (obligatorio, R11) + su error de validación.
  const [motivo, setMotivo] = useState("");
  const [motivoError, setMotivoError] = useState<string | null>(null);
  // Feature 111/R16 (VÁLVULA DE ESCAPE): cierre `vencido` pendiente de confirmar el
  // destrabe; null = modal cerrado. Acción de EXCEPCIÓN, separada de aprobar/rechazar.
  const [destrabar, setDestrabar] = useState<CierreAdminResumen | null>(null);
  // Feature 158/R34: sub-modal de captura de los montos de indemnización; true = abierto.
  // Sólo se abre si el cierre TIENE incidentes; sin ellos se aprueba directo (R36).
  const [indemnizando, setIndemnizando] = useState(false);
  // Monto por `gestionId`, tal cual lo teclea el admin: STRING de extremo a extremo
  // (money-safe, R24). NUNCA se parsea a number acá; el borde y el repo lo tratan como
  // texto/Decimal.
  const [montos, setMontos] = useState<Record<string, string>>({});
  // Errores por gestión que devuelve el SERVIDOR (`fieldErrors` con clave = gestionId,
  // `CierresAdminService.validarCoberturaIndemnizaciones`). Se pintan por fila.
  const [montoErrores, setMontoErrores] = useState<Record<string, string>>({});

  // Feature 170 — FASE 2 (T I.2, R40/R43): página visible del histórico. Vive AQUÍ y no en
  // `CierresAdminHistoricoTabla` porque dos lecturas pintan los mismos cierres —la tabla y la
  // «Vista tipo factura»— y pedir la página dos veces las dejaría enseñando cosas distintas
  // (Q-I3). `fallbackData` es la página que ya resolvió el Server Component: al entrar no hay
  // segunda lectura, y las filas son EXACTAMENTE las de antes (R44).
  const [historicoPage, setHistoricoPage] = useState(1);
  const [historicoPageSize, setHistoricoPageSize] = useState(historico.pageSize);
  const { data: historicoData, error: historicoError } = useSWR(
    ["cierres-admin:historico", historicoPage, historicoPageSize],
    () => leerHistorico(historicoPage, historicoPageSize),
    {
      fallbackData:
        historicoPage === 1 && historicoPageSize === historico.pageSize
          ? historico
          : undefined,
    },
  );
  const historicoPagina: CierresAdminHistoricoPagina = historicoData ?? {
    items: [],
    total: 0,
    pageSize: historicoPageSize,
  };

  // R44: el esqueleto de carga se muestra sólo cuando NO hay nada que pintar. `isLoading` de
  // SWR sigue siendo `true` mientras revalida aunque haya `fallbackData`, y usarlo tal cual
  // haría que la página 1 —la que el Server Component ya resolvió— apareciera como esqueleto
  // antes de enseñar las filas que el usuario veía antes de paginar.
  const historicoCargando = historicoData === undefined;

  // R3: adminSatelite sin zona → aviso accionable, sin tablas de acción.
  if (sinZona) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        No tenés una zona asignada; contactá a tu administrador.
      </p>
    );
  }

  // Feature 158/R19/R34: las gestiones `incidente` del cierre abierto. Salen del MISMO
  // detalle que ya se pidió al servidor (`grupos.incidente`), no de una consulta aparte:
  // el conjunto que la UI pide indemnizar es exactamente el que el service exige cubrir.
  const incidentes: CierreDetalleGestion[] = detalle?.grupos.incidente ?? [];
  // R34: no se puede confirmar mientras falte o sea inválido algún monto. Mismo criterio
  // que el servidor (`montoValido` de la wallet: > 0, hasta 2 decimales, sin `parseFloat`) —
  // incluido el TOPE (m5): sin él la UI habilitaba «Confirmar» con un monto de 11 dígitos que
  // el servidor rechaza después, y ese rechazo llega bajo la clave `indemnizaciones` (no por
  // gestión), así que no se pintaba en ninguna celda: el admin veía que algo falló y no dónde.
  const todosLosMontosValidos =
    incidentes.length > 0 &&
    incidentes.every((g) => montoValido(montos[g.gestionId] ?? "", INDEMNIZACION_MONTO_MAX));

  /**
   * Mensaje accionable de un monto tecleado que NO pasa la validación de cliente. `undefined`
   * si el campo está vacío (ahí el aviso general del sub-modal ya dice que falta) o si es
   * válido. Distingue el tope del formato: son dos correcciones distintas.
   */
  function errorDeMonto(valor: string): string | undefined {
    const limpio = valor.trim();
    if (limpio === "" || montoValido(limpio, INDEMNIZACION_MONTO_MAX)) return undefined;
    // Bien formado pero por encima del tope → el problema es el tamaño, no la sintaxis.
    return montoValido(limpio) ? INDEMNIZACION_MONTO_EXCEDE : INDEMNIZACION_MONTO_FORMATO;
  }

  /** Abre el detalle de un cierre (pide las gestiones + evidencias firmadas). */
  async function abrirDetalle(cierreId: string) {
    // Un fallo INESPERADO de la action (que lanza ante un `AppErrorCode` que no sabe
    // traducir) rechazaba esta promesa sin que nadie la escuchara: el modal no abria y no
    // aparecia ningun mensaje, que es como se ve "el boton no funciona". El toast no
    // arregla la causa, pero convierte el silencio en algo que se puede reportar.
    let result: Awaited<ReturnType<typeof verCierreDetalle>>;
    try {
      result = await verCierreDetalle({ cierreId });
    } catch {
      toast.error("No se pudo abrir el detalle del cierre. Intentá de nuevo.");
      return;
    }
    if (result.status === "ok") {
      setDetalle({
        cierre: result.cierre,
        grupos: result.grupos,
        totalesIngreso: result.totalesIngreso,
        desgloseIngresoBodegaRechazos: result.desgloseIngresoBodegaRechazos,
        ganancia: result.ganancia,
        pagoTienda: result.pagoTienda,
      });
      return;
    }
    if (result.status === "no_encontrada") {
      toast.error("El cierre ya no está disponible. Actualizando la lista.");
      router.refresh();
      return;
    }
    if (result.status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
      return;
    }
    toast.error("No se pudo abrir el detalle del cierre. Intentá de nuevo.");
  }

  function cerrarDetalle() {
    setDetalle(null);
    setRechazando(false);
    setMotivo("");
    setMotivoError(null);
    // Feature 158: cerrar el detalle descarta también la captura en curso; el siguiente
    // cierre que se abra arranca con sus propias filas y sin montos heredados.
    setIndemnizando(false);
    setMontos({});
    setMontoErrores({});
  }

  /** Traduce un resultado de dominio de error a feedback accionable + refresco. */
  function manejarErrorDecision(
    status:
      | "conflict"
      | "no_encontrada"
      | "forbidden"
      | "unauthenticated"
      | "validation_error",
  ) {
    if (status === "conflict") {
      toast.error("Este cierre ya fue resuelto por otro administrador.");
    } else if (status === "no_encontrada") {
      toast.error("El cierre ya no está disponible.");
    } else if (status === "forbidden") {
      toast.error("No tenés permiso para resolver este cierre.");
    } else if (status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
    } else {
      toast.error("No se pudo resolver el cierre. Intentá de nuevo.");
    }
    cerrarDetalle();
    router.refresh();
  }

  /**
   * R10 + feature 158/R22/R36: aprueba el cierre abierto. `indemnizaciones` sólo viaja
   * cuando el cierre TIENE incidentes; sin ellos se manda el MISMO payload de la 38
   * (`{ cierreId }`), así el camino sin incidentes no cambia ni un byte (R36).
   */
  async function confirmarAprobacion(
    indemnizaciones?: { gestionId: string; monto: string }[],
  ) {
    if (!detalle) return;
    const result = await aprobarCierre(
      indemnizaciones === undefined
        ? { cierreId: detalle.cierre.cierreId }
        : { cierreId: detalle.cierre.cierreId, indemnizaciones },
    );
    if (result.status === "ok") {
      toast.success("Cierre aprobado correctamente.");
      cerrarDetalle();
      router.refresh();
      return;
    }
    // Feature 158/R19-R21: el servidor valida la cobertura EXACTA de los montos y devuelve
    // un error POR GESTIÓN. Se pintan en su fila y el sub-modal SIGUE ABIERTO: cerrarlo
    // obligaría a recapturar todo lo ya tecleado.
    if (result.status === "validation_error") {
      setMontoErrores(
        Object.fromEntries(
          Object.entries(result.fieldErrors).map(([campo, mensajes]) => [
            campo,
            mensajes[0] ?? INDEMNIZACION_FALTAN,
          ]),
        ),
      );
      return;
    }
    manejarErrorDecision(result.status);
  }

  /**
   * Feature 158/R34: pulsa "Aprobar" en el detalle. Con incidentes abre el sub-modal de
   * captura; sin incidentes aprueba directo, exactamente como hasta ahora (R36).
   */
  function pedirAprobacion() {
    if (incidentes.length === 0) {
      void confirmarAprobacion();
      return;
    }
    setMontoErrores({});
    setIndemnizando(true);
  }

  /** Feature 158/R34: confirma la aprobación CON los montos capturados. */
  async function confirmarAprobacionConMontos() {
    if (!todosLosMontosValidos) return; // R34: el botón ya está deshabilitado; doble candado.
    await confirmarAprobacion(
      incidentes.map((g) => ({ gestionId: g.gestionId, monto: montos[g.gestionId].trim() })),
    );
  }

  /** R11: rechaza el cierre abierto con motivo obligatorio. */
  async function confirmarRechazo() {
    if (!detalle) return;
    const motivoLimpio = motivo.trim();
    if (motivoLimpio.length === 0) {
      setMotivoError("El motivo de rechazo es obligatorio.");
      return; // R11: sin motivo NO se envía
    }
    const result = await rechazarCierre({
      cierreId: detalle.cierre.cierreId,
      motivo: motivoLimpio,
    });
    if (result.status === "ok") {
      toast.success("Cierre rechazado correctamente.");
      cerrarDetalle();
      router.refresh();
      return;
    }
    if (result.status === "validation_error") {
      const primero = Object.values(result.fieldErrors)[0]?.[0];
      setMotivoError(primero ?? "El motivo de rechazo es obligatorio.");
      return;
    }
    manejarErrorDecision(result.status);
  }

  /**
   * Feature 111/R16 (VÁLVULA DE ESCAPE, emergencia): destraba un `vencido` ABANDONADO
   * transicionándolo `vencido → solicitado` en nombre del mensajero. Es la EXCEPCIÓN al
   * flujo normal (para cuando el mensajero nunca lo solicita y quedan bloqueados él y su
   * bodega). Tras destrabar, el cierre queda `solicitado` y se resuelve por la vía normal
   * (aprobar/rechazar), que registra la auditoría (R17). NO recalcula montos (R21).
   */
  async function confirmarDestrabar() {
    const cierre = destrabar;
    if (!cierre) return;
    const result = await forzarSolicitudVencido({ cierreId: cierre.cierreId });
    if (result.status === "ok") {
      toast.success(
        "Cierre vencido destrabado; quedó como solicitado para aprobación.",
      );
      setDestrabar(null);
      router.refresh();
      return;
    }
    if (result.status === "conflict") {
      toast.error("El cierre ya no está vencido (otro proceso lo resolvió).");
    } else if (result.status === "no_encontrada") {
      toast.error("El cierre ya no está disponible.");
    } else if (result.status === "forbidden") {
      toast.error("No tenés permiso para destrabar este cierre.");
    } else if (result.status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
    } else {
      toast.error("No se pudo destrabar el cierre. Intentá de nuevo.");
    }
    setDestrabar(null);
    router.refresh();
  }

  const cierreAbierto = detalle?.cierre ?? null;
  // Feature 111/R15 (Q1-B): la vía NORMAL aprobar/rechazar aplica SOLO a `solicitado`.
  // Un `vencido` YA NO es resoluble por la vía normal (revierte la 41 R20): su único
  // camino normal es que el mensajero lo solicite (→ `solicitado`); la excepción es la
  // válvula de escape del admin (R16). El histórico sigue siendo solo lectura.
  const esResoluble = cierreAbierto?.estado === "solicitado";

  return (
    <div className="flex flex-col gap-8">
      {/* ---------- Pendientes de decisión (R4) ---------- */}
      <section
        aria-label="Pendientes de decisión"
        className="flex flex-col gap-3"
      >
        <h2 className="text-lg font-semibold">
          Pendientes de decisión{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({pendientes.length})
          </span>
        </h2>
        <div className="overflow-x-auto">
          <DataTable
            columns={columnasPendientes(abrirDetalle, setDestrabar)}
            data={pendientes}
            rowKey="cierreId"
            ariaLabel="Pendientes de decisión"
            emptyMessage="No hay cierres pendientes de decisión."
            /**
             * Feature 170 (T E.1, R1/R11/R14/R20/R26/R30/R32) — descarga de FAMILIA B: el
             * array de props ES la cola entera (la página la pide sin paginar), así que el
             * archivo se proyecta de lo que la tabla ya pinta y en el MISMO orden, sin
             * releer nada. El alcance lo puso el servidor: un `adminSatelite` sólo recibe
             * los cierres de su zona, y descargar no puede ampliar eso.
             *
             * El título no repite el de la otra tabla: dos controles en la misma pantalla
             * necesitan nombres accesibles distintos (R13).
             */
            descarga={{
              titulo: TITULO_DESCARGA_PENDIENTES,
              columnas: COLUMNAS_DESCARGA_CIERRES_PENDIENTES,
              obtenerFilas: () => filasLocales(pendientes, filaDescargaCierrePendiente),
            }}
          />
        </div>
      </section>

      {/* ---------- Histórico (solo lectura, R5) ----------
          Feature 170 — FASE 2 (T I.2): la tabla y su control viven en su propio componente;
          la página la pide este módulo (ver el comentario del `useSWR`). */}
      <CierresAdminHistoricoTabla
        pagina={historicoPagina}
        page={historicoPage}
        isLoading={historicoCargando}
        hayError={Boolean(historicoError)}
        onPageChange={setHistoricoPage}
        onPageSizeChange={(s) => {
          setHistoricoPageSize(s);
          setHistoricoPage(1);
        }}
        onAbrir={abrirDetalle}
      />

      {/* ---------- Vista tipo factura (previsualización de UX) ----------
          Lectura alternativa de LOS MISMOS cierres que las dos tablas de arriba, como
          comprobante. Va DEBAJO y a propósito no reemplaza nada: es para comparar las
          dos lecturas antes de decidir cuál se queda.

          Feature 170 — FASE 2 (T I.2, Q-I3): al paginar el histórico, esta vista SIGUE A LA
          TABLA — muestra la cola completa más la PÁGINA visible de resueltos, no todo el
          histórico. Cambia lo que el usuario ve: los cierres resueltos que caen fuera de la
          página dejan de aparecer aquí como tarjeta (su comprobante sigue a un clic, en el
          detalle, que es el MISMO componente). Se elige así porque la frase que define esta
          sección es «los mismos cierres de arriba»: alimentarla del conjunto entero la
          convertiría en la única razón por la que el histórico completo seguiría cruzando a
          la pantalla, que es justo lo que esta fase viene a quitar. */}
      <section
        aria-label="Vista tipo factura"
        className="flex flex-col gap-4 border-t pt-6"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Vista tipo factura</h2>
          <p className="text-sm text-muted-foreground">
            Previsualización: los mismos cierres de arriba leídos como comprobante.
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {[...pendientes, ...historicoPagina.items].map((c) => (
            <CierreFacturaResumen
              key={c.cierreId}
              cierre={c}
              acciones={
                // Los nombres accesibles llevan el sufijo de la vista: los botones de
                // la tabla ya se llaman "Ver / decidir" / "Destrabar cierre vencido",
                // y duplicarlos haría ambigua la localización por nombre.
                c.estado === "vencido" ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`Ver el comprobante del cierre de ${c.mensajeroNombre}`}
                      onClick={() => abrirDetalle(c.cierreId)}
                    >
                      Ver
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => setDestrabar(c)}
                      aria-label={`Destrabar desde el comprobante el cierre vencido abandonado de ${c.mensajeroNombre}`}
                    >
                      Destrabar cierre vencido
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant={c.estado === "solicitado" ? "default" : "outline"}
                    aria-label={
                      c.estado === "solicitado"
                        ? `Ver / decidir desde el comprobante el cierre de ${c.mensajeroNombre}`
                        : `Ver el comprobante del cierre de ${c.mensajeroNombre}`
                    }
                    onClick={() => abrirDetalle(c.cierreId)}
                  >
                    {c.estado === "solicitado" ? "Ver / decidir" : "Ver"}
                  </Button>
                )
              }
            />
          ))}
          {pendientes.length === 0 && historicoPagina.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay cierres para previsualizar.
            </p>
          ) : null}
        </div>
      </section>

      {/* ---------- Detalle del cierre (R6-R8) ---------- */}
      <Modal
        open={detalle !== null}
        onOpenChange={(next) => {
          if (!next) cerrarDetalle();
        }}
        title="Detalle del cierre"
        description={
          cierreAbierto
            ? `${cierreAbierto.mensajeroNombre} · ${destinoCierre(cierreAbierto)}`
            : undefined
        }
        // Sin ancho propio: el default del Modal (75% de la pantalla) es el que corresponde
        // a un detalle con tablas anchas.
        confirmLabel="Cerrar"
        hideCancel
        onConfirm={cerrarDetalle}
      >
        {detalle ? (
          <div className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto pr-1">
            {/* El detalle es UNA sola lectura: el comprobante. Reemplazó a los paneles
                sueltos + las 4 tablas por resultado (R6-R8) sin perder ningún dato: los
                totales snapshot, el ingreso de Ordenex, la liquidación y las gestiones
                (ahora en pestañas, con su desglose por fila) viven todos ahí dentro. */}
            <CierreFacturaDetalle
              cierre={detalle.cierre}
              grupos={detalle.grupos}
              totalesIngreso={detalle.totalesIngreso}
              desgloseIngresoBodegaRechazos={
                detalle.desgloseIngresoBodegaRechazos
              }
              ganancia={detalle.ganancia}
              pagoTienda={detalle.pagoTienda}
              onVerEvidencia={setEvidencia}
            />

            {/* Acciones: solo en un cierre `solicitado` (feature 111/R15); histórico y
                `vencido` = sin decisión aquí (el `vencido` se destraba desde la cola, R16). */}
            {esResoluble ? (
              <section
                aria-label="Decisión del cierre"
                className="flex flex-wrap justify-end gap-3 border-t pt-4"
              >
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    setMotivo("");
                    setMotivoError(null);
                    setRechazando(true);
                  }}
                >
                  Rechazar
                </Button>
                <Button type="button" onClick={pedirAprobacion}>
                  Aprobar
                </Button>
              </section>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* ---------- Sub-modal de rechazo con motivo obligatorio (R11) ---------- */}
      <Modal
        open={rechazando}
        onOpenChange={(next) => {
          if (!next) {
            setRechazando(false);
            setMotivoError(null);
          }
        }}
        title="Rechazar cierre"
        description="Indicá el motivo del rechazo. El mensajero lo verá para corregir."
        confirmLabel="Rechazar cierre"
        confirmVariant="destructive"
        onConfirm={confirmarRechazo}
        closeOnConfirm={false}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="motivo-rechazo" className="text-sm font-medium">
            Motivo del rechazo
          </label>
          <textarea
            id="motivo-rechazo"
            value={motivo}
            onChange={(e) => {
              setMotivo(e.target.value);
              if (motivoError) setMotivoError(null);
            }}
            rows={4}
            aria-required="true"
            aria-invalid={motivoError !== null}
            aria-describedby={motivoError ? "motivo-rechazo-error" : undefined}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {motivoError ? (
            <p
              id="motivo-rechazo-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {motivoError}
            </p>
          ) : null}
        </div>
      </Modal>

      {/* ---------- Sub-modal de captura de indemnizaciones (feature 158/R19/R34) ----------
          Espejo del sub-modal de rechazo: se abre DESDE el detalle, con un dato extra
          obligatorio antes de confirmar. Una fila por incidente; el confirmar queda
          deshabilitado mientras falte o sea inválido algún monto, con el mismo criterio
          (`montoValido`) que revalida el servidor. Los montos son STRING de punta a punta. */}
      <Modal
        open={indemnizando}
        onOpenChange={(next) => {
          if (!next) {
            setIndemnizando(false);
            setMontoErrores({});
          }
        }}
        title={INDEMNIZACION_TITULO}
        description={INDEMNIZACION_DETALLE}
        confirmLabel={INDEMNIZACION_CONFIRMAR}
        confirmDisabled={!todosLosMontosValidos}
        onConfirm={confirmarAprobacionConMontos}
        closeOnConfirm={false}
      >
        <div className="flex flex-col gap-4">
          {incidentes.map((g) => {
            const inputId = `indemnizacion-${g.gestionId}`;
            // El error del servidor manda (llegó de una decisión real); si no lo hay, se pinta
            // el del cliente, que es el que caza el tope ANTES de intentar aprobar.
            const error = montoErrores[g.gestionId] ?? errorDeMonto(montos[g.gestionId] ?? "");
            return (
              <div
                key={g.gestionId}
                className="flex flex-col gap-1.5 rounded-lg border border-border p-3"
              >
                <p className="text-sm font-medium">
                  {g.numRemision} · {g.destinatario}
                </p>
                <p className="text-xs text-muted-foreground">
                  {`Nº Guía ${g.numGuia ?? "—"} · ${g.tiendaNombre}`}
                  {g.motivo ? ` · ${g.motivo}` : ""}
                </p>
                {/* R34: la CAUSA, destacada y no escondida en la línea de contexto. Es el dato
                    que justifica el monto: no es lo mismo indemnizar un paquete raspado que uno
                    robado, y el admin lo decide mirando esto. */}
                <p className="text-sm">
                  <span className="text-muted-foreground">{INDEMNIZACION_CAUSA_LABEL}: </span>
                  <span className="font-medium">
                    {g.causaIncidente
                      ? CAUSA_INCIDENTE_LABEL[g.causaIncidente]
                      : INDEMNIZACION_CAUSA_DESCONOCIDA}
                  </span>
                </p>
                <Label htmlFor={inputId}>{INDEMNIZACION_MONTO_LABEL}</Label>
                <Input
                  id={inputId}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={montos[g.gestionId] ?? ""}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${inputId}-error` : `${inputId}-ayuda`}
                  onChange={(e) => {
                    const valor = e.target.value;
                    setMontos((prev) => ({ ...prev, [g.gestionId]: valor }));
                    // Teclear limpia el error del servidor de ESA fila (no el de las otras).
                    setMontoErrores((prev) => {
                      if (!prev[g.gestionId]) return prev;
                      const rest = { ...prev };
                      delete rest[g.gestionId];
                      return rest;
                    });
                  }}
                />
                {error ? (
                  <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : (
                  <p id={`${inputId}-ayuda`} className="text-xs text-muted-foreground">
                    {INDEMNIZACION_MONTO_AYUDA}
                  </p>
                )}
              </div>
            );
          })}
          {/* El motivo del bloqueo se dice con TEXTO, no sólo con un botón apagado. */}
          {todosLosMontosValidos ? null : (
            <p role="note" className="text-sm text-muted-foreground">
              {INDEMNIZACION_FALTAN}
            </p>
          )}
        </div>
      </Modal>

      {/* ---------- Confirmación de la VÁLVULA DE ESCAPE (feature 111/R16) ----------
          Acción de EXCEPCIÓN, diferenciada de aprobar/rechazar: destraba un `vencido`
          abandonado en nombre del mensajero. El copy lo deja claro. */}
      <Modal
        open={destrabar !== null}
        onOpenChange={(next) => {
          if (!next) setDestrabar(null);
        }}
        title="Destrabar cierre vencido abandonado"
        description={
          destrabar
            ? `Acción de excepción. Enviarás a aprobación el cierre vencido de ${destrabar.mensajeroNombre} en su nombre, porque no lo solicitó. Después deberás aprobarlo o rechazarlo por la vía normal. No se recalculan los montos ya registrados.`
            : undefined
        }
        confirmLabel="Destrabar (excepción)"
        confirmVariant="destructive"
        onConfirm={confirmarDestrabar}
        closeOnConfirm={false}
      />

      {/* ---------- Visor de evidencia (URL firmada, R7) ---------- */}
      <Modal
        open={evidencia !== null}
        onOpenChange={(next) => {
          if (!next) setEvidencia(null);
        }}
        title="Evidencia de la gestión"
        confirmLabel="Cerrar"
        hideCancel
        onConfirm={() => setEvidencia(null)}
      >
        {evidencia ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={evidencia}
            alt="Evidencia fotográfica de la gestión"
            className="max-h-[60vh] w-full rounded-md object-contain"
          />
        ) : null}
      </Modal>
    </div>
  );
}

// --- Columnas de la cola de pendientes (R4) ---
function columnasPendientes(
  abrir: (cierreId: string) => void,
  pedirDestrabar: (c: CierreAdminResumen) => void,
): Column<CierreAdminResumen>[] {
  return [
    // Feature 41 (R20): estado diferenciado (`solicitado` vs `vencido`) en la cola.
    {
      id: "estado",
      value: "Estado",
      render: (c) => <EstadoCierreBadge estado={c.estado} />,
    },
    { id: "mensajero", value: "Mensajero", render: (c) => c.mensajeroNombre },
    {
      id: "fecha",
      value: "Fecha",
      render: (c) => c.solicitadoAt.slice(0, 10),
    },
    { id: "destino", value: "Destino", render: (c) => destinoCierre(c) },
    {
      id: "general",
      value: "Total general",
      render: (c) => money(c.totales.general),
    },
    {
      id: "pagoMensajero",
      value: PAGO_MENSAJERO_COL,
      render: (c) => money(c.totalPagoMensajero),
    },
    {
      id: "ingresoBodegaRechazos",
      value: INGRESO_BODEGA_RECHAZOS_COL,
      render: (c) => money(c.totalIngresoBodegaRechazos),
    },
    {
      id: "acciones",
      value: "Acciones",
      // Feature 111/R15/R16: un `solicitado` es resoluble por la vía normal ("Ver /
      // decidir" abre el detalle con aprobar/rechazar). Un `vencido` NO es resoluble por
      // esa vía; se ofrece SOLO en sus filas la acción DIFERENCIADA de excepción
      // "Destrabar cierre vencido" (con confirmación), separada de aprobar/rechazar.
      render: (c) =>
        c.estado === "vencido" ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => abrir(c.cierreId)}
            >
              Ver
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => pedirDestrabar(c)}
              aria-label={`Destrabar cierre vencido abandonado de ${c.mensajeroNombre}`}
            >
              Destrabar cierre vencido
            </Button>
          </div>
        ) : (
          <Button type="button" size="sm" onClick={() => abrir(c.cierreId)}>
            Ver / decidir
          </Button>
        ),
    },
  ];
}
