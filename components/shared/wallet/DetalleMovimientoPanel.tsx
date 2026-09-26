"use client";

import { useState, type ReactNode } from "react";
import useSWR from "swr";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/useToast";
import { comoQuedoAction } from "@/lib/actions/como-quedo";
import { adjuntarComprobanteAction, verComprobanteAction } from "@/lib/actions/wallet-comprobante";
import { money } from "@/lib/config/moneda";
import type { ComoQuedoDTO } from "@/lib/types/como-quedo";
import type { RegistroDTO } from "@/lib/types/estado-cuenta";
import type { AQuienDTO } from "@/lib/types/libro-caja-autoria";
import type { AdjuntarComprobanteResult, VerComprobanteResult } from "@/lib/types/wallet-comprobante-lateral";
import { cn } from "@/lib/utils";

import { CAJA_RESUMEN_LABEL, rotuloCifraPrincipal } from "@/app/(app)/wallet/_components/wallet-labels";

import { AnularMovimientoDialog } from "./AnularMovimientoDialog";
import { ComprobanteCampo } from "./ComprobanteCampo";
import {
  COMO_QUEDO_TEXTO,
  COMPROBANTE_PANEL_TEXTO,
  NO_ADMITE_COMPROBANTE_LABEL,
  PANEL_TEXTO,
  textoRegistro,
} from "./detalle-movimiento-panel-labels";

// FICHA 458-C (T C.3/C.4, design §3.7/§5.1; R58, R63–R67, R71, R72, R74–R80, R100) — el panel «Ver»
// de UN movimiento, compartido por el libro de la caja (hoy) y los estados de cuenta (458-D).
//
// Qué dice (R58): quién, por qué, cómo, comprobante, quién lo registró, el estado de anulación y
// «Cómo quedó». Todo lo que decide dinero o estado llega del SERVIDOR:
//  - el estado «vigente / anulado» (R71) viaja en la fila (`estado`), decidido en el servidor: el panel
//    no mira ninguna otra fila de la página;
//  - «Anular…» se ofrece solo si la fila dice `anulable` (R63/R65);
//  - «Cómo quedó» lo calcula `comoQuedoAction` (misma derivación que la tarjeta), con cargando y error
//    sin cifras;
//  - el comprobante se ve por un enlace temporal que genera el servidor tras comprobar el alcance (R77),
//    y se nombra por un rótulo legible, nunca por su ruta (R80). Adjuntar después (R79) solo donde la
//    fila lo admite, una vez; el servidor decide (`no_admite`, `ya_tiene`).
// Money-safe (R90): los importes llegan como STRING y se pintan con `money`. Ningún id se pinta (H6).

export interface DetalleMovimiento {
  /** La fila de un libro: viaja al servidor, nunca se pinta. */
  destino: { libro: "caja" | "tienda" | "mensajero"; movimientoId: string };
  /** El nombre del concepto desde Ordenex. */
  concepto: string;
  /** El día CR ya legible. */
  fecha: string;
  /** STRING escala 2 del servidor. */
  monto: string;
  direccion: "entra" | "sale";
  /** El motivo / descripción tal como se guardó. */
  motivo: string | null;
  /** De dónde sale (el origen legible de la 458-A), ya compuesto. */
  origen?: ReactNode;
  /** Cómo (método y referencia) si la superficie lo conoce; `undefined` = no se pinta la línea. */
  como?: string | null;
  /**
   * Estado de anulación, DECIDIDO EN EL SERVIDOR (R71/R72). `null` = el servidor no lo dijo (una fila
   * sin documento: un contra-asiento, lo del cierre): el panel NO afirma «Vigente» (B3 de la revisión).
   */
  estado: {
    anulado: boolean;
    motivoNoRegistrado?: boolean;
    detalle?: { motivo: string | null; por: string | null; fecha: string | null } | null;
  } | null;
  /** R63/R65 — el servidor dice si se ofrece «Anular…». */
  anulable: boolean;
  /** «el sueldo», «el cobro por rechazo a una tienda»: para el título de «Anular …». */
  nombreParaAnular: string;
  tieneComprobante: boolean;
  /** R79 — la fila admite adjuntar un comprobante lateral (y no tiene uno). */
  admiteAdjuntar: boolean;
  /** R100 / R73 — una explicación en palabras (el cobro por rechazo es un cargo). */
  nota?: string | null;
}

export interface DetalleMovimientoPanelProps {
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  movimiento: DetalleMovimiento;
  /** R56/R57 — quién y quién lo registró; `undefined` = cargando; `null` = no se pudo leer. */
  autoria?: { aQuien: AQuienDTO; registro: RegistroDTO } | null;
  /** Tras anular o adjuntar: quien monta relee lo suyo (R60). */
  onCambio?: () => void;
}

function textoAQuien(a: AQuienDTO): string {
  if (a.esOrdenex) return PANEL_TEXTO.esOrdenex;
  if (a.nombre === null) return PANEL_TEXTO.sinDato;
  return a.beneficiario === null ? a.nombre : `${a.nombre} · ${PANEL_TEXTO.aTercero(a.beneficiario)}`;
}

async function leerComoQuedo(destino: DetalleMovimiento["destino"]): Promise<ComoQuedoDTO> {
  const r = await comoQuedoAction({ destino });
  if (r.status !== "ok") throw new Error(r.status);
  return r.comoQuedo;
}

function Fila({ nombre, children }: { nombre: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 py-1.5">
      <dt className="text-sm text-muted-foreground">{nombre}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function ComoQuedo({ destino, abierto }: { destino: DetalleMovimiento["destino"]; abierto: boolean }) {
  const { data, error, isLoading } = useSWR(
    abierto ? (["wallet:como-quedo", destino.libro, destino.movimientoId] as const) : null,
    () => leerComoQuedo(destino),
    { shouldRetryOnError: false, revalidateOnFocus: false },
  );
  let cuerpo: ReactNode;
  if (error !== undefined) {
    cuerpo = (
      <p role="alert" className="text-sm text-destructive">
        {COMO_QUEDO_TEXTO.error}
      </p>
    );
  } else if (isLoading || data === undefined) {
    cuerpo = (
      <p role="status" className="text-sm text-muted-foreground">
        {COMO_QUEDO_TEXTO.cargando}
      </p>
    );
  } else {
    cuerpo = (
      <dl className="divide-y divide-border">
        {data.caja === null ? (
          <p className="py-1.5 text-sm text-muted-foreground">{COMO_QUEDO_TEXTO.sinCaja}</p>
        ) : (
          <>
            <Fila nombre={rotuloCifraPrincipal({ periodoFiltrado: false, estado: data.caja.rotulo })}>
              <span className="tabular-nums">{money(data.caja.cifraPrincipal)}</span>
            </Fila>
            <Fila nombre={CAJA_RESUMEN_LABEL.ganancia}>
              <span className="tabular-nums">{money(data.caja.ganancia)}</span>
            </Fila>
            <Fila nombre={CAJA_RESUMEN_LABEL.deTerceros}>
              <span className="tabular-nums">{money(data.caja.deTiendas)}</span>
            </Fila>
            <Fila nombre={CAJA_RESUMEN_LABEL.capital}>
              <span className="tabular-nums">{money(data.caja.capital)}</span>
            </Fila>
          </>
        )}
        {data.cuenta === null ? null : (
          <Fila nombre={data.cuenta.tipo === "tienda" ? COMO_QUEDO_TEXTO.cuentaTienda : COMO_QUEDO_TEXTO.cuentaMensajero}>
            <span className="tabular-nums">{money(data.cuenta.saldo)}</span>
          </Fila>
        )}
      </dl>
    );
  }
  return (
    <section aria-label={COMO_QUEDO_TEXTO.titulo} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <h3 className="mb-1 text-sm font-semibold">{COMO_QUEDO_TEXTO.titulo}</h3>
      {cuerpo}
    </section>
  );
}

export function DetalleMovimientoPanel({
  abierto,
  onAbiertoChange,
  movimiento,
  autoria,
  onCambio,
}: Readonly<DetalleMovimientoPanelProps>) {
  const toast = useToast();
  const [anulando, setAnulando] = useState(false);
  const [adjuntando, setAdjuntando] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [errorArchivo, setErrorArchivo] = useState<string | undefined>(undefined);
  const [avisoComprobante, setAvisoComprobante] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const m = movimiento;
  const montoPintado = money(m.monto);
  const rotuloComprobante = COMPROBANTE_PANEL_TEXTO.rotulo(m.concepto, m.fecha);
  const destinoComprobante = { libro: m.destino.libro, movimientoId: m.destino.movimientoId };

  async function verComprobante() {
    // La pestaña se abre ANTES de esperar al servidor: un `window.open` tras un `await` lo bloquean
    // los navegadores como emergente. Si el enlace no llega, se cierra.
    const pestana = window.open("", "_blank");
    let r: VerComprobanteResult;
    try {
      r = await verComprobanteAction({ destino: destinoComprobante });
    } catch {
      pestana?.close();
      toast.error(COMPROBANTE_PANEL_TEXTO.verFallo);
      return;
    }
    if (r.status === "ok") {
      if (pestana) {
        pestana.opener = null;
        pestana.location.href = r.url;
      } else {
        window.open(r.url, "_blank", "noopener,noreferrer");
      }
      return;
    }
    pestana?.close();
    const mensaje: Record<Exclude<VerComprobanteResult["status"], "ok">, string> = {
      sin_comprobante: COMPROBANTE_PANEL_TEXTO.verSin,
      no_encontrado: COMPROBANTE_PANEL_TEXTO.verNoEncontrado,
      forbidden: COMPROBANTE_PANEL_TEXTO.verForbidden,
      unauthenticated: COMPROBANTE_PANEL_TEXTO.unauthenticated,
      validation_error: COMPROBANTE_PANEL_TEXTO.verFallo,
    };
    toast.error(mensaje[r.status]);
  }

  async function adjuntar() {
    if (archivo === null) {
      setErrorArchivo(COMPROBANTE_PANEL_TEXTO.sinArchivo);
      return;
    }
    const fd = new FormData();
    // El destino viaja como JSON (un FormData no anida objetos); nunca se pinta.
    fd.set("destino", JSON.stringify(destinoComprobante));
    fd.set("comprobante", archivo);
    setEnviando(true);
    setAvisoComprobante(null);
    let r: AdjuntarComprobanteResult;
    try {
      r = await adjuntarComprobanteAction(fd);
    } catch {
      setAvisoComprobante(COMPROBANTE_PANEL_TEXTO.fallo);
      return;
    } finally {
      setEnviando(false);
    }
    switch (r.status) {
      case "ok":
        toast.success(COMPROBANTE_PANEL_TEXTO.adjuntado);
        setAdjuntando(false);
        setArchivo(null);
        onCambio?.();
        return;
      case "validation_error":
        setErrorArchivo(r.fieldErrors.comprobante?.[0] ?? COMPROBANTE_PANEL_TEXTO.fallo);
        return;
      case "ya_tiene":
        setAvisoComprobante(COMPROBANTE_PANEL_TEXTO.yaTiene);
        return;
      case "no_admite":
        setAvisoComprobante(NO_ADMITE_COMPROBANTE_LABEL[r.motivo]);
        return;
      case "no_encontrado":
        setAvisoComprobante(COMPROBANTE_PANEL_TEXTO.noEncontrado);
        return;
      case "comprobante_no_guardado":
        setAvisoComprobante(COMPROBANTE_PANEL_TEXTO.noGuardado);
        return;
      case "forbidden":
        setAvisoComprobante(COMPROBANTE_PANEL_TEXTO.forbidden);
        return;
      case "unauthenticated":
        setAvisoComprobante(COMPROBANTE_PANEL_TEXTO.unauthenticated);
        return;
    }
  }

  const anulado = m.estado?.anulado === true;
  const estado =
    m.estado === null ? (
      // B3 (revisión 458-C): sin estado del servidor no se afirma nada.
      <span>{PANEL_TEXTO.sinDato}</span>
    ) : m.estado.anulado ? (
      <Badge variant="secondary">
        {m.estado.detalle
          ? PANEL_TEXTO.anuladoDetalle(m.estado.detalle.fecha, m.estado.detalle.por, m.estado.detalle.motivo)
          : m.estado.motivoNoRegistrado
            ? PANEL_TEXTO.motivoNoRegistrado
            : PANEL_TEXTO.anulado}
      </Badge>
    ) : (
      <span>{PANEL_TEXTO.vigente}</span>
    );

  // R79: «Adjuntar» solo sin comprobante, si la fila lo admite y NO está anulada (m6 de la 458-B).
  const ofreceAdjuntar = !m.tieneComprobante && m.admiteAdjuntar && !anulado;

  return (
    <>
      <Sheet open={abierto} onOpenChange={onAbiertoChange}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{m.concepto}</SheetTitle>
            <SheetDescription>
              {`${m.fecha} · ${m.direccion === "entra" ? PANEL_TEXTO.entra : PANEL_TEXTO.sale} `}
              <span
                className={cn(
                  "font-medium tabular-nums",
                  m.direccion === "entra" ? "text-success-strong" : "text-danger-strong",
                )}
              >
                {montoPintado}
              </span>
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-4 px-4 pb-6">
            {m.nota ? <p className="text-sm text-foreground">{m.nota}</p> : null}

            <dl className="divide-y divide-border">
              <Fila nombre={PANEL_TEXTO.aQuien}>
                {autoria === undefined ? PANEL_TEXTO.cargando : autoria === null ? PANEL_TEXTO.sinDato : textoAQuien(autoria.aQuien)}
              </Fila>
              <Fila nombre={PANEL_TEXTO.porQue}>{m.motivo ?? PANEL_TEXTO.sinDato}</Fila>
              {m.origen === undefined ? null : <Fila nombre={PANEL_TEXTO.origen}>{m.origen}</Fila>}
              {m.como === undefined ? null : <Fila nombre={PANEL_TEXTO.como}>{m.como ?? PANEL_TEXTO.sinDato}</Fila>}
              <Fila nombre={PANEL_TEXTO.comprobante}>
                <div className="flex flex-col items-start gap-2">
                  {m.tieneComprobante ? (
                    <>
                      <span>{rotuloComprobante}</span>
                      <Button type="button" variant="outline" size="sm" aria-label={`${COMPROBANTE_PANEL_TEXTO.ver}: ${rotuloComprobante}`} onClick={() => void verComprobante()}>
                        {COMPROBANTE_PANEL_TEXTO.ver}
                      </Button>
                    </>
                  ) : (
                    <span>{COMPROBANTE_PANEL_TEXTO.sin}</span>
                  )}
                  {ofreceAdjuntar && !adjuntando ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setAdjuntando(true)}>
                      {COMPROBANTE_PANEL_TEXTO.adjuntar}
                    </Button>
                  ) : null}
                  {ofreceAdjuntar && adjuntando ? (
                    <div className="flex w-full flex-col gap-2">
                      <ComprobanteCampo
                        id="panel-comprobante"
                        archivo={archivo}
                        onCambiar={setArchivo}
                        error={errorArchivo}
                        onError={setErrorArchivo}
                      />
                      <div className="flex gap-2">
                        <Button type="button" size="sm" disabled={enviando} onClick={() => void adjuntar()}>
                          {COMPROBANTE_PANEL_TEXTO.adjuntarConfirmar}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setAdjuntando(false);
                            setArchivo(null);
                            setErrorArchivo(undefined);
                            setAvisoComprobante(null);
                          }}
                        >
                          {COMPROBANTE_PANEL_TEXTO.adjuntarCancelar}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {avisoComprobante === null ? null : (
                    <p role="alert" className="text-sm text-destructive">
                      {avisoComprobante}
                    </p>
                  )}
                </div>
              </Fila>
              <Fila nombre={PANEL_TEXTO.registro}>
                {autoria === undefined ? PANEL_TEXTO.cargando : autoria === null ? PANEL_TEXTO.errorAutoria : textoRegistro(autoria.registro)}
              </Fila>
              <Fila nombre={PANEL_TEXTO.estado}>{estado}</Fila>
            </dl>

            <ComoQuedo destino={m.destino} abierto={abierto} />

            {m.anulable && !anulado ? (
              <div>
                <Button type="button" variant="destructive" onClick={() => setAnulando(true)}>
                  {PANEL_TEXTO.anular}
                </Button>
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {m.anulable && !anulado ? (
        <AnularMovimientoDialog
          open={anulando}
          onOpenChange={setAnulando}
          destino={m.destino}
          nombre={m.nombreParaAnular}
          resumen={`${m.concepto} · ${m.fecha} · ${montoPintado}`}
          montoPintado={montoPintado}
          onAnulado={() => {
            onAbiertoChange(false);
            onCambio?.();
          }}
        />
      ) : null}
    </>
  );
}
