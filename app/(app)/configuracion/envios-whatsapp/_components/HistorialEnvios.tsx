"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Pagination } from "@/components/shared/Pagination";
import { useToast } from "@/hooks/useToast";
import { firmarPdfEjecucion, listarEjecuciones, obtenerEjecucion } from "@/lib/actions/envios-whatsapp";
import type { EjecucionItemDTO, EntregaDetalleDTO } from "@/lib/types/envios-whatsapp";

import {
  ESTADO_EJECUCION,
  ESTADO_ENTREGA,
  ORIGEN_EJECUCION,
  claveDia,
  encabezadoDia,
  horaCR,
  resumenConteos,
} from "./envios-textos";

const RUTA = "/configuracion/envios-whatsapp/historial";
const TAMANOS = [20, 50, 100];

export interface HistorialPagina {
  items: EjecucionItemDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface HistorialEnviosProps {
  inicial: HistorialPagina;
  /** Para el filtro «por envío» (R42). */
  envios: readonly { id: string; nombre: string }[];
  envioId: string | null;
}

/**
 * Ficha 474 (R42–R44) — el HISTORIAL de ejecuciones, sobre `Historial.dc.html`: lo más reciente
 * arriba, agrupado por día de Costa Rica, filtrable por envío y paginado. Cada ejecución dice su
 * origen (a hora fija, por un aviso o prueba), su estado —`vacia` es «Sin novedades», una fila y no
 * un hueco—, su motivo y el conteo de entregas; y se abre para ver a cada destinatario con el
 * teléfono enmascarado (solo los 4 últimos dígitos, que es lo que trae el servidor).
 *
 * El PDF se descarga con un enlace firmado de pocos minutos que se pide al pulsar (R43); pasado su
 * plazo se muestra «caducado» (R44) y no hay botón.
 */
export function HistorialEnvios({ inicial, envios, envioId: envioInicial }: HistorialEnviosProps) {
  const router = useRouter();
  const [envioId, setEnvioId] = useState<string | null>(envioInicial);
  const [page, setPage] = useState(inicial.page);
  const [pageSize, setPageSize] = useState(inicial.pageSize);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());

  const esInicial = envioId === envioInicial && page === inicial.page && pageSize === inicial.pageSize;
  const { data, error, isLoading } = useSWR(
    ["envios-whatsapp:historial", envioId, page, pageSize],
    async (): Promise<HistorialPagina> => {
      const r = await listarEjecuciones({ ...(envioId ? { envioId } : {}), page, pageSize });
      if (r.status !== "ok") throw new Error("historial_failed");
      return { items: r.items, total: r.total, page: r.page, pageSize: r.pageSize };
    },
    { fallbackData: esInicial ? inicial : undefined },
  );

  const ahora = new Date();
  const items = data?.items ?? [];
  const grupos: { clave: string; titulo: string; items: EjecucionItemDTO[] }[] = [];
  for (const e of items) {
    const clave = claveDia(e.instante);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.clave === clave) ultimo.items.push(e);
    else grupos.push({ clave, titulo: encabezadoDia(e.instante, ahora), items: [e] });
  }

  function filtrar(valor: string) {
    const id = valor === "" ? null : valor;
    setEnvioId(id);
    setPage(1);
    router.replace(id ? `${RUTA}?envio=${encodeURIComponent(id)}` : RUTA, { scroll: false });
  }

  function alternar(id: string) {
    setAbiertas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Envío"
          labelPrefix="Envío"
          className="min-w-56"
          value={envioId ?? ""}
          onValueChange={filtrar}
          options={[{ value: "", label: "Todos" }, ...envios.map((e) => ({ value: e.id, label: e.nombre }))]}
        />
        <span className="text-sm text-muted-foreground sm:ml-auto">
          {data ? `${data.total} ${data.total === 1 ? "ejecución" : "ejecuciones"}` : null}
        </span>
      </div>

      {error && items.length === 0 ? (
        <p role="alert" className="text-sm text-danger-strong">
          No se pudo cargar el historial.
        </p>
      ) : null}

      {!isLoading && items.length === 0 && !error ? (
        <p className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Todavía no hay nada en el historial{envioId ? " de este envío" : ""}.
        </p>
      ) : null}

      {grupos.map((g) => (
        <section key={g.clave} aria-label={g.titulo} className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.titulo}</h2>
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
            {g.items.map((e) => (
              <FilaEjecucion
                key={e.id}
                ejecucion={e}
                mostrarEnvio={envioId === null}
                abierta={abiertas.has(e.id)}
                onAlternar={() => alternar(e.id)}
              />
            ))}
          </ul>
        </section>
      ))}

      {data && data.total > pageSize ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data.total}
          disabled={isLoading}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
          pageSizeOptions={TAMANOS}
        />
      ) : null}

      <p className="text-xs text-muted-foreground">
        Una persona nunca recibe dos veces el mismo envío programado en el mismo día, aunque se reintente. Las
        pruebas no cuentan.
      </p>
    </div>
  );
}

function FilaEjecucion({
  ejecucion: e,
  mostrarEnvio,
  abierta,
  onAlternar,
}: {
  ejecucion: EjecucionItemDTO;
  mostrarEnvio: boolean;
  abierta: boolean;
  onAlternar: () => void;
}) {
  const estado = ESTADO_EJECUCION[e.estado];
  const conteos = resumenConteos(e.conteos);
  const detalleId = `ejecucion-${e.id}-entregas`;
  const hayEntregas = Object.values(e.conteos).some((n) => (n ?? 0) > 0);
  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="w-12 font-mono text-sm">{horaCR(e.instante)}</span>
        {mostrarEnvio ? <span className="text-sm font-medium">{e.envioNombre}</span> : null}
        <Badge variant={e.origen === "prueba" ? "info" : "outline"}>{ORIGEN_EJECUCION[e.origen]}</Badge>
        <Badge variant={estado.tono}>{estado.etiqueta}</Badge>
        {conteos ? <span className="text-xs text-muted-foreground">{conteos}</span> : null}
        <span className="ml-auto flex items-center gap-2">
          <PdfEjecucion ejecucion={e} />
        </span>
      </div>
      {e.motivo ? (
        <p className={e.estado === "error" ? "text-sm text-danger-strong" : "text-sm text-muted-foreground"}>{e.motivo}</p>
      ) : null}
      {e.plantillaNombre ? (
        <p className="text-xs text-muted-foreground">
          Plantilla <span className="font-mono">{e.plantillaNombre}</span>
        </p>
      ) : null}
      {hayEntregas ? (
        <div>
          <Button type="button" variant="ghost" size="sm" aria-expanded={abierta} aria-controls={detalleId} onClick={onAlternar}>
            {abierta ? "Ocultar destinatarios" : "Ver destinatarios"}
          </Button>
          {abierta ? <Entregas id={detalleId} ejecucionId={e.id} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function Entregas({ id, ejecucionId }: { id: string; ejecucionId: string }) {
  const { data, error } = useSWR(["envios-whatsapp:ejecucion", ejecucionId], async (): Promise<EntregaDetalleDTO[]> => {
    const r = await obtenerEjecucion(ejecucionId);
    if (r.status !== "ok") throw new Error("detalle_failed");
    return r.entregas;
  });
  if (error) {
    return (
      <p id={id} role="alert" className="text-sm text-danger-strong">
        No se pudo cargar el detalle.
      </p>
    );
  }
  if (!data) {
    return (
      <p id={id} className="text-sm text-muted-foreground">
        Cargando…
      </p>
    );
  }
  return (
    <div id={id} className="mt-1 overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className="px-2 py-1.5 font-medium">Destinatario</th>
            <th scope="col" className="px-2 py-1.5 font-medium">Teléfono</th>
            <th scope="col" className="px-2 py-1.5 font-medium">Resultado</th>
            <th scope="col" className="px-2 py-1.5 font-medium">Detalle</th>
            <th scope="col" className="px-2 py-1.5 font-medium">Hora</th>
          </tr>
        </thead>
        <tbody>
          {data.map((en) => {
            const est = ESTADO_ENTREGA[en.estado];
            return (
              <tr key={en.id} className="border-b border-border last:border-b-0">
                <td className="px-2 py-1.5">{en.destinatarioNombre}</td>
                <td className="px-2 py-1.5 font-mono text-xs">{en.telefonoEnmascarado}</td>
                <td className="px-2 py-1.5">
                  <Badge variant={est.tono}>{est.etiqueta}</Badge>
                </td>
                <td className={est.tono === "danger" ? "px-2 py-1.5 text-danger-strong" : "px-2 py-1.5 text-muted-foreground"}>
                  {en.motivo ?? (en.estado === "en_curso" ? "No se sabe si WhatsApp lo recibió; no se reenvía." : "")}
                </td>
                <td className="px-2 py-1.5 font-mono text-xs">{horaCR(en.instante)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PdfEjecucion({ ejecucion: e }: { ejecucion: EjecucionItemDTO }) {
  const toast = useToast();
  const [pidiendo, setPidiendo] = useState(false);
  const [caducado, setCaducado] = useState(e.pdf?.caducado ?? false);
  if (e.pdf === null) return null;
  if (caducado) {
    return (
      <span className="text-xs text-muted-foreground" title="Los PDF se guardan 30 días">
        PDF caducado
      </span>
    );
  }
  const nombre = e.pdf.nombre;
  async function abrir() {
    setPidiendo(true);
    try {
      const r = await firmarPdfEjecucion(e.id);
      if (r.status === "ok") window.open(r.url, "_blank", "noopener,noreferrer");
      else if (r.status === "caducado") {
        setCaducado(true);
        toast.info("Ese PDF ya caducó: se guardan 30 días.");
      } else toast.error("No se pudo abrir el PDF.");
    } finally {
      setPidiendo(false);
    }
  }
  return (
    <Button type="button" variant="link" size="sm" disabled={pidiendo} onClick={() => void abrir()}>
      <FileText aria-hidden="true" />
      {nombre}
    </Button>
  );
}
