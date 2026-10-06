"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { apagarEnvio, encenderEnvio, listarEnvios, reprogramarEnvio } from "@/lib/actions/envios-whatsapp";
import type { EnvioListItemDTO } from "@/lib/types/envios-whatsapp";

import { ESTADO_EJECUCION, instanteCorto, resumenCuando } from "./envios-textos";

const RUTA = "/configuracion/envios-whatsapp";

export interface EnviosModuleProps {
  initialItems: EnvioListItemDTO[];
}

async function fetcher(): Promise<EnvioListItemDTO[]> {
  const r = await listarEnvios();
  if (r.status !== "ok") throw new Error("list_failed");
  return r.items;
}

/**
 * Ficha 474 (T10.3) — la LISTA de envíos automáticos, sobre la maqueta aprobada: tabla en
 * escritorio (`Main.dc.html`), tarjetas en el teléfono (`ListaMovil.dc.html`) y el estado vacío
 * (`Vacio.dc.html`).
 *
 * El interruptor es el ÚNICO sitio (con la edición) donde un envío se enciende: nace apagado (R15)
 * y encenderlo puede fallar con su motivo (R18), que se dice aquí sin dejar el interruptor
 * encendido en falso. Un envío encendido a hora fija muestra su próximo envío, y si no tiene
 * ninguno programado, un aviso con «Reprogramar» (R25).
 */
export function EnviosModule({ initialItems }: EnviosModuleProps) {
  const toast = useToast();
  const [pendiente, setPendiente] = useState<string | null>(null);
  const [rechazo, setRechazo] = useState<{ nombre: string; motivos: string[] } | null>(null);
  const { data, error, mutate } = useSWR(["envios-whatsapp:list"], fetcher, { fallbackData: initialItems });
  const items = data ?? [];
  const ahora = new Date();

  async function alternar(envio: EnvioListItemDTO, encender: boolean) {
    if (pendiente) return;
    setPendiente(envio.id);
    setRechazo(null);
    try {
      const r = encender ? await encenderEnvio(envio.id) : await apagarEnvio(envio.id);
      if (r.status === "ok") {
        toast.success(encender ? `«${envio.nombre}» encendido.` : `«${envio.nombre}» apagado.`);
      } else if (r.status === "no_encendible") {
        setRechazo({ nombre: envio.nombre, motivos: r.motivos });
      } else if (r.status === "not_found") {
        toast.error("Ese envío ya no existe.");
      } else {
        toast.error(mensajeError(r.status));
      }
      await mutate();
    } finally {
      setPendiente(null);
    }
  }

  async function reprogramar(envio: EnvioListItemDTO) {
    if (pendiente) return;
    setPendiente(envio.id);
    try {
      const r = await reprogramarEnvio(envio.id);
      if (r.status === "ok") toast.success(`«${envio.nombre}» vuelve a tener próximo envío.`);
      else toast.error(mensajeError(r.status));
      await mutate();
    } finally {
      setPendiente(null);
    }
  }

  if (error && items.length === 0) {
    return (
      <p role="alert" className="text-sm text-danger-strong">
        No se pudieron cargar los envíos.
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-5 py-7 text-center">
        <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary-strong">
          <Clock className="size-5" />
        </span>
        <p className="text-base font-semibold">Todavía no hay envíos automáticos</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Programa un mensaje para que salga solo: a una hora fija, o en el momento en que la app avisa de algo.
        </p>
        <Link href={`${RUTA}/nuevo`} className={cn(buttonVariants({ className: "mt-1 w-full" }))}>
          + Crear el primero
        </Link>
        <p className="text-xs text-muted-foreground">
          Necesitas al menos una plantilla aprobada en{" "}
          <Link href="/configuracion/plantillas" className="text-primary-strong underline underline-offset-2">
            Plantillas
          </Link>
          .
        </p>
      </div>
    );
  }

  const encendidos = items.filter((i) => i.activo).length;

  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>{items.length === 1 ? "1 envío" : `${items.length} envíos`}</span>
        <span aria-hidden="true">·</span>
        <span>
          <strong className="text-foreground">{encendidos}</strong> {encendidos === 1 ? "encendido" : "encendidos"}
        </span>
        <span aria-hidden="true">·</span>
        <span>Hora de Costa Rica</span>
      </p>

      {rechazo ? (
        <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm text-danger-strong">
          <p className="font-semibold">«{rechazo.nombre}» no se pudo encender. Sigue apagado porque:</p>
          <ul className="mt-1 list-disc pl-5">
            {rechazo.motivos.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Escritorio: tabla (Main.dc.html). */}
      <div className="hidden rounded-xl border border-border bg-card px-2 py-1 md:block">
        <table className="w-full text-sm" aria-label="Envíos automáticos">
          <thead>
            <tr className="border-b border-border text-left">
              <th scope="col" className="h-10 px-2 font-medium">Envío</th>
              <th scope="col" className="h-10 px-2 font-medium">Informe</th>
              <th scope="col" className="h-10 px-2 font-medium">Cuándo</th>
              <th scope="col" className="h-10 px-2 font-medium">Último envío</th>
              <th scope="col" className="h-10 px-2 font-medium">Encendido</th>
              <th scope="col" className="h-10 px-2">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id} className="border-b border-border last:border-b-0">
                <td className="px-2 py-2.5 align-middle">
                  <div className="font-medium">{e.nombre}</div>
                  <div className="text-xs text-muted-foreground">
                    Plantilla <span className="font-mono">{e.plantillaNombre}</span>
                  </div>
                </td>
                <td className="px-2 py-2.5">
                  <Badge variant="outline">{e.informeNombre}</Badge>
                </td>
                <td className="px-2 py-2.5">
                  {resumenCuando(e)}
                  <Proxima envio={e} ahora={ahora} ocupado={pendiente !== null} onReprogramar={() => void reprogramar(e)} />
                </td>
                <td className="px-2 py-2.5">
                  <UltimoEnvio envio={e} ahora={ahora} />
                </td>
                <td className="px-2 py-2.5">
                  <Switch
                    aria-label={`Encender «${e.nombre}»`}
                    checked={e.activo}
                    disabled={pendiente !== null}
                    onCheckedChange={(c) => void alternar(e, c)}
                  />
                </td>
                <td className="px-2 py-2.5 text-right whitespace-nowrap">
                  <Link href={`${RUTA}/historial?envio=${e.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                    Historial
                  </Link>
                  <Link href={`${RUTA}/${e.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    Editar
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Teléfono: tarjetas (ListaMovil.dc.html). */}
      <ul aria-label="Envíos automáticos" className="flex flex-col gap-3 md:hidden">
        {items.map((e) => (
          <li key={e.id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold">{e.nombre}</p>
                <p className="text-xs text-muted-foreground">{resumenCuando(e)}</p>
              </div>
              {/* `div` y no `<label>`: con la etiqueta envolvente Base UI nombraría el interruptor
                  «Apagado»/«Encendido», un nombre que cambia al pulsarlo. */}
              <div className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
                <span aria-hidden="true">{e.activo ? "Encendido" : "Apagado"}</span>
                <Switch
                  aria-label={`Encender «${e.nombre}»`}
                  checked={e.activo}
                  disabled={pendiente !== null}
                  onCheckedChange={(c) => void alternar(e, c)}
                />
              </div>
            </div>
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Informe</dt>
                <dd>
                  <Badge variant="outline">{e.informeNombre}</Badge>
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Plantilla</dt>
                <dd className="font-mono text-xs">{e.plantillaNombre}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Último envío</dt>
                <dd className="text-right">
                  <UltimoEnvio envio={e} ahora={ahora} />
                </dd>
              </div>
            </dl>
            <Proxima envio={e} ahora={ahora} ocupado={pendiente !== null} onReprogramar={() => void reprogramar(e)} />
            <div className="flex gap-2">
              <Link href={`${RUTA}/historial?envio=${e.id}`} className={cn(buttonVariants({ variant: "outline", className: "h-11 flex-1" }))}>
                Historial
              </Link>
              <Link href={`${RUTA}/${e.id}`} className={cn(buttonVariants({ variant: "outline", className: "h-11 flex-1" }))}>
                Editar
              </Link>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Un envío nuevo se guarda <strong className="text-foreground">apagado</strong>. Pruébalo con «Probar ahora» y
        enciéndelo aquí cuando el mensaje sea el correcto.
      </p>
    </div>
  );
}

function UltimoEnvio({ envio, ahora }: { envio: EnvioListItemDTO; ahora: Date }) {
  if (!envio.ultimaEjecucion) return <span className="text-xs text-muted-foreground">Nunca se ha enviado</span>;
  const estado = ESTADO_EJECUCION[envio.ultimaEjecucion.estado];
  return (
    <span className="inline-flex flex-col items-start gap-1 md:items-start">
      <span>{instanteCorto(envio.ultimaEjecucion.instante, ahora)}</span>
      <Badge variant={estado.tono}>{estado.etiqueta}</Badge>
    </span>
  );
}

/** R25: el próximo envío de un encendido a hora fija, o el aviso de que no tiene ninguno. */
function Proxima({
  envio,
  ahora,
  ocupado,
  onReprogramar,
}: {
  envio: EnvioListItemDTO;
  ahora: Date;
  ocupado: boolean;
  onReprogramar: () => void;
}) {
  if (!envio.activo || envio.disparo !== "hora_fija") return null;
  if (envio.avisoSinProxima || envio.proximaEjecucion === null) {
    return (
      <div role="status" className="mt-1 flex flex-wrap items-center gap-2 text-xs text-warning-strong">
        <span>Encendido pero sin próximo envío programado.</span>
        <Button type="button" size="xs" variant="outline" disabled={ocupado} onClick={onReprogramar}>
          Reprogramar
        </Button>
      </div>
    );
  }
  return <div className="text-xs text-muted-foreground">Próximo: {instanteCorto(envio.proximaEjecucion, ahora)}</div>;
}

function mensajeError(status: string): string {
  switch (status) {
    case "unauthenticated":
      return "Tu sesión expiró. Vuelve a iniciar sesión.";
    case "forbidden":
      return "No tienes permiso para esta acción.";
    default:
      return "Algo falló. Inténtalo de nuevo.";
  }
}
