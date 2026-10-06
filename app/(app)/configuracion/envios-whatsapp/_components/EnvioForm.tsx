"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { RolValue } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FormField } from "@/components/shared/FormField";
import { FieldError } from "@/components/shared/FieldError";
import { Modal } from "@/components/shared/Modal";
import { SegmentedToggle } from "@/components/shared/SegmentedToggle";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import {
  actualizarEnvio,
  apagarEnvio,
  borrarEnvio,
  crearEnvio,
  encenderEnvio,
  previsualizarDestinatarios,
  probarEnvioWhatsapp,
} from "@/lib/actions/envios-whatsapp";
import type {
  DestinatarioPreviewDTO,
  EnvioDetalleDTO,
  EventoDisponibleDTO,
  GuardarEnvioInput,
  GuardarEnvioResult,
  InformeDTO,
  PreviewDestinatariosDTO,
  ProbarEnvioResult,
} from "@/lib/types/envios-whatsapp";

import { DestinatariosField } from "./DestinatariosField";
import { ParametrosInforme } from "./ParametrosInforme";
import { VistaPreviaMensaje } from "./VistaPreviaMensaje";
import { DIAS_SEMANA, ESTADO_EJECUCION, ESTADO_ENTREGA } from "./envios-textos";

/** Una plantilla DE INFORME aprobada (activa y enlazada con Meta), lo único que se puede elegir (R12). */
export interface PlantillaDeInformeOpcion {
  id: string;
  nombre: string;
  cuerpo: string;
  informeClave: string;
  llevaDocumento: boolean;
}

export interface EnvioFormProps {
  /** `null` = crear. */
  envio: EnvioDetalleDTO | null;
  informes: readonly InformeDTO[];
  eventos: readonly EventoDisponibleDTO[];
  plantillas: readonly PlantillaDeInformeOpcion[];
  /** Todas las personas que pueden recibir (activas, de un rol permitido). */
  personas: readonly DestinatarioPreviewDTO[];
}

const RUTA_LISTA = "/configuracion/envios-whatsapp";
/** Espera antes de recalcular la lista resuelta de destinatarios mientras se marca/desmarca. */
export const PREVIEW_DESTINATARIOS_DEBOUNCE_MS = 250;

const PREVIEW_VACIA: PreviewDestinatariosDTO = { destinatarios: [], total: 0, avisos: [], excedeTope: false, tope: 50 };

/** Las claves de error que pinta un campo; el resto va al resumen de arriba para no perderse. */
const CAMPOS_CON_SITIO = ["nombre", "informeClave", "plantillaId", "disparo", "diasSemana", "hora", "eventoClave"];

type Errores = Record<string, string[]>;
type Resultado = { tono: "ok" | "error"; texto: string };

function defaultsDe(informe: InformeDTO | undefined): Record<string, unknown> {
  const d = informe?.parametrosPorDefecto;
  return d !== null && typeof d === "object" ? { ...(d as Record<string, unknown>) } : {};
}

/**
 * Ficha 474 (T10.3) — crear y editar un envío, sobre la maqueta APROBADA (`Formulario.dc.html` y
 * `FormularioMovil.dc.html`): «Qué se manda / A quién / Cuándo», vista previa a la derecha (plegada
 * en el teléfono) y la botonera fija abajo en el teléfono.
 *
 * Decisiones de la maqueta que esta pantalla hace cumplir, no solo pinta:
 *  - **Nace apagado** (R15): «Guardar» no enciende. El interruptor vive en la lista (y aquí, al
 *    editar, como en `FormularioMovil`).
 *  - **La plantilla manda sobre el PDF**: si el informe genera documento y la plantilla elegida NO
 *    lo lleva, el aviso sale en el acto y NO deja guardar ni probar (anotación «plantilla-documento»
 *    del canvas): si no, el envío saldría cada mañana sin el PDF.
 *  - **«Probar ahora» solo a quien pulsa** (R39–R41), con lo guardado: si hay cambios, se guardan
 *    antes; el resultado llega en la misma respuesta y se dice aquí.
 *  - Los avisos de teléfono NO impiden guardar (R17).
 */
export function EnvioForm({ envio, informes, eventos, plantillas, personas }: EnvioFormProps) {
  const router = useRouter();
  const toast = useToast();

  const informeInicial =
    envio?.informeClave ?? (informes.find((i) => !i.soloPorEvento) ?? informes[0])?.clave ?? "";
  const [envioId, setEnvioId] = useState<string | null>(envio?.id ?? null);
  const [nombre, setNombre] = useState(envio?.nombre ?? "");
  const [informeClave, setInformeClave] = useState(informeInicial);
  const [plantillaId, setPlantillaId] = useState(envio?.plantillaId ?? "");
  const [parametros, setParametros] = useState<Record<string, unknown>>(
    envio?.parametros ?? defaultsDe(informes.find((i) => i.clave === informeInicial)),
  );
  const [disparo, setDisparo] = useState<"hora_fija" | "evento">(
    envio?.disparo ?? (informes.find((i) => i.clave === informeInicial)?.soloPorEvento ? "evento" : "hora_fija"),
  );
  const [dias, setDias] = useState<number[]>(envio?.diasSemana ?? []);
  const [hora, setHora] = useState(envio?.hora ?? "");
  const [eventoClave, setEventoClave] = useState(envio?.eventoClave ?? "");
  const [roles, setRoles] = useState<RolValue[]>(envio?.destinatarios.roles ?? []);
  const [usuarioIds, setUsuarioIds] = useState<string[]>(envio?.destinatarios.usuarioIds ?? []);
  const [activo, setActivo] = useState(envio?.activo ?? false);

  const [calculada, setCalculada] = useState<{ clave: string; preview: PreviewDestinatariosDTO } | null>(null);
  const [errores, setErrores] = useState<Errores>({});
  const [ocupado, setOcupado] = useState<null | "guardar" | "probar" | "interruptor" | "borrar">(null);
  const [resultadoPrueba, setResultadoPrueba] = useState<Resultado | null>(null);
  const [motivosEncendido, setMotivosEncendido] = useState<string[]>([]);
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);

  const informe = informes.find((i) => i.clave === informeClave);
  const plantillasDelInforme = plantillas.filter((p) => p.informeClave === informeClave);
  const plantilla = plantillasDelInforme.find((p) => p.id === plantillaId) ?? null;
  const eventosDelInforme = eventos.filter((e) => informe?.eventos.includes(e.clave));
  const evento = eventosDelInforme.find((e) => e.clave === eventoClave) ?? null;

  // La plantilla manda sobre el PDF (anotación «plantilla-documento» de la maqueta).
  const faltaDocumento = informe?.generaDocumento === true && plantilla !== null && !plantilla.llevaDocumento;

  const input: GuardarEnvioInput = useMemo(
    () => ({
      nombre,
      informeClave,
      plantillaId,
      parametros,
      disparo,
      diasSemana: disparo === "hora_fija" ? [...dias].sort((a, b) => a - b) : [],
      hora: disparo === "hora_fija" && hora !== "" ? hora : null,
      eventoClave: disparo === "evento" && eventoClave !== "" ? eventoClave : null,
      destinatarios: { roles, usuarioIds },
    }),
    [nombre, informeClave, plantillaId, parametros, disparo, dias, hora, eventoClave, roles, usuarioIds],
  );
  // Lo último guardado: si el formulario no ha cambiado, «Probar ahora» no vuelve a guardar.
  const guardadoRef = useRef<string | null>(envio ? JSON.stringify(input) : null);
  const hayCambios = guardadoRef.current !== JSON.stringify(input);

  // R17: la lista RESUELTA de la selección, calculada por el servidor (no escribe nada).
  // La respuesta se guarda CON la selección que la pidió: mientras la selección actual no tenga la
  // suya, se pinta «Calculando…» (nunca la lista de una selección anterior).
  const claveSeleccion = JSON.stringify({ roles, usuarioIds });
  const seleccionVacia = roles.length === 0 && usuarioIds.length === 0;
  const preview: PreviewDestinatariosDTO | null = seleccionVacia
    ? PREVIEW_VACIA
    : calculada?.clave === claveSeleccion
      ? calculada.preview
      : null;
  useEffect(() => {
    if (roles.length === 0 && usuarioIds.length === 0) return;
    let vigente = true;
    const clave = JSON.stringify({ roles, usuarioIds });
    const t = setTimeout(() => {
      void previsualizarDestinatarios({ roles, usuarioIds }).then((r) => {
        if (!vigente) return;
        setCalculada({ clave, preview: r.status === "ok" ? r.preview : PREVIEW_VACIA });
      });
    }, PREVIEW_DESTINATARIOS_DEBOUNCE_MS);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [roles, usuarioIds]);

  function cambiarInforme(clave: string) {
    const nuevo = informes.find((i) => i.clave === clave);
    setInformeClave(clave);
    setPlantillaId("");
    setParametros(defaultsDe(nuevo));
    if (nuevo?.soloPorEvento) setDisparo("evento");
    else if (nuevo && nuevo.eventos.length === 0) setDisparo("hora_fija");
    if (nuevo && !nuevo.eventos.includes(eventoClave)) setEventoClave("");
  }

  function cambiarDisparo(valor: string) {
    const d = valor === "evento" ? "evento" : "hora_fija";
    setDisparo(d);
    // Design §7: con «Cuando pase algo» el informe es uno que ofrezca eventos («Aviso de la app»);
    // con hora fija, uno que no sea solo por evento. Se cambia solo, en vez de dejar una
    // combinación que el servidor va a rechazar.
    if (d === "evento" && informe && informe.eventos.length === 0) {
      const conEventos = informes.find((i) => i.eventos.length > 0);
      if (conEventos) cambiarInforme(conEventos.clave);
    } else if (d === "hora_fija" && informe?.soloPorEvento) {
      const programable = informes.find((i) => !i.soloPorEvento);
      if (programable) cambiarInforme(programable.clave);
    }
  }

  function alternarDia(dia: number) {
    setDias((ds) => (ds.includes(dia) ? ds.filter((d) => d !== dia) : [...ds, dia]));
  }

  /** Guarda (crea o actualiza). Devuelve el id guardado, o `null` si no se pudo. */
  async function guardar(): Promise<string | null> {
    const r: GuardarEnvioResult = envioId === null ? await crearEnvio(input) : await actualizarEnvio(envioId, input);
    if (r.status === "ok") {
      setErrores({});
      guardadoRef.current = JSON.stringify(input);
      setEnvioId(r.envio.id);
      return r.envio.id;
    }
    if (r.status === "validation_error") {
      setErrores(r.fieldErrors);
      toast.error("No se guardó: revisa los campos marcados.");
    } else if (r.status === "conflict") {
      setErrores({ nombre: ["Ya hay otro envío con ese nombre."] });
      toast.error("No se guardó: ya hay otro envío con ese nombre.");
    } else if (r.status === "not_found") {
      toast.error("Este envío ya no existe.");
    } else {
      toast.error(mensajeError(r.status));
    }
    return null;
  }

  async function onGuardar() {
    if (ocupado || faltaDocumento) return;
    setOcupado("guardar");
    try {
      const id = await guardar();
      if (id !== null) {
        toast.success(envio ? "Cambios guardados." : "Envío guardado. Está apagado: pruébalo y enciéndelo en la lista.");
        router.push(RUTA_LISTA);
        router.refresh();
      }
    } finally {
      setOcupado(null);
    }
  }

  async function onProbar() {
    if (ocupado || faltaDocumento) return;
    setOcupado("probar");
    setResultadoPrueba(null);
    try {
      const eraNuevo = envioId === null;
      const id = hayCambios || envioId === null ? await guardar() : envioId;
      if (id === null) return;
      const r = await probarEnvioWhatsapp(id);
      const res = describirPrueba(r);
      setResultadoPrueba(res);
      if (res.tono === "ok") toast.success(res.texto);
      else toast.error(res.texto);
      // Recién creado: la dirección pasa a la de edición, para que un segundo «Probar» no cree otro.
      if (eraNuevo) router.replace(`${RUTA_LISTA}/${id}`);
    } finally {
      setOcupado(null);
    }
  }

  async function onInterruptor(encender: boolean) {
    if (envioId === null || ocupado) return;
    setOcupado("interruptor");
    setMotivosEncendido([]);
    try {
      const r = encender ? await encenderEnvio(envioId) : await apagarEnvio(envioId);
      if (r.status === "ok") {
        setActivo(r.envio.activo);
        toast.success(r.envio.activo ? "Envío encendido." : "Envío apagado.");
      } else if (r.status === "no_encendible") {
        // R18: se queda apagado y se dice por qué.
        setActivo(false);
        setMotivosEncendido(r.motivos);
      } else {
        toast.error(mensajeError(r.status));
      }
    } finally {
      setOcupado(null);
    }
  }

  async function onBorrar() {
    if (envioId === null) return;
    setOcupado("borrar");
    try {
      const r = await borrarEnvio(envioId);
      if (r.status === "ok" || r.status === "not_found") {
        toast.success("Envío borrado. Su historial se conserva.");
        setConfirmarBorrar(false);
        router.push(RUTA_LISTA);
        router.refresh();
      } else {
        toast.error(mensajeError(r.status));
      }
    } finally {
      setOcupado(null);
    }
  }

  const erroresDestinatarios = Object.entries(errores)
    .filter(([k]) => k.startsWith("destinatarios"))
    .flatMap(([, v]) => v);
  const erroresSueltos = Object.entries(errores)
    .filter(([k]) => !CAMPOS_CON_SITIO.includes(k) && !k.startsWith("destinatarios") && !k.startsWith("parametros"))
    .flatMap(([, v]) => v);

  const bloqueado = faltaDocumento || ocupado !== null;

  return (
    <form
      noValidate
      aria-label={envio ? `Editar envío ${envio.nombre}` : "Nuevo envío"}
      onSubmit={(e) => {
        e.preventDefault();
        void onGuardar();
      }}
      className="grid gap-5 lg:grid-cols-[minmax(0,620px)_minmax(0,1fr)] lg:items-start"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {envioId !== null ? (
            // Un `div` y no un `<label>`: Base UI nombraría el interruptor con el texto de la
            // etiqueta envolvente («Apagado»), que cambia al pulsarlo. El nombre es fijo.
            <div className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
              <span aria-hidden="true">{activo ? "Encendido" : "Apagado"}</span>
              <Switch
                aria-label="Envío encendido"
                checked={activo}
                disabled={ocupado !== null}
                onCheckedChange={(c) => void onInterruptor(c)}
              />
            </div>
          ) : (
            <Badge variant="secondary">Se guarda apagado</Badge>
          )}
          {envioId !== null ? (
            <Link
              href={`${RUTA_LISTA}/historial?envio=${envioId}`}
              className="text-sm text-primary-strong underline-offset-4 hover:underline"
            >
              Ver historial
            </Link>
          ) : null}
        </div>

        {motivosEncendido.length > 0 ? (
          <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm text-danger-strong">
            <p className="font-semibold">No se pudo encender. Sigue apagado porque:</p>
            <ul className="mt-1 list-disc pl-5">
              {motivosEncendido.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {erroresSueltos.length > 0 ? (
          <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm text-danger-strong">
            {erroresSueltos.map((m) => (
              <p key={m}>{m}</p>
            ))}
          </div>
        ) : null}

        <Seccion titulo="Qué se manda" descripcion="La plantilla es el texto aprobado por WhatsApp; el informe pone los datos y, si la plantilla lo lleva, el PDF.">
          <FormField id="envio-nombre" label="Nombre del envío" error={errores.nombre} hint="Solo lo ves tú en la lista; no aparece en el mensaje.">
            <Input value={nombre} maxLength={120} onChange={(e) => setNombre(e.target.value)} />
          </FormField>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium" id="envio-informe-label">
              Informe
            </span>
            <SegmentedToggle
              ariaLabel="Informe"
              className="flex-wrap"
              options={informes.map((i) => ({ valor: i.clave, etiqueta: i.nombre }))}
              valor={informeClave}
              onChange={cambiarInforme}
            />
            {informe ? <p className="text-sm text-muted-foreground">{informe.descripcion}</p> : null}
            {errores.informeClave ? <FieldError id="envio-informe-error" messages={errores.informeClave} /> : null}
          </div>

          <FormField
            id="envio-plantilla"
            label="Plantilla"
            error={errores.plantillaId}
            hint={
              plantillasDelInforme.length === 0 ? (
                <>
                  No hay plantillas aprobadas de este informe. Créala en{" "}
                  <Link href="/configuracion/plantillas" className="underline underline-offset-2">
                    Plantillas
                  </Link>{" "}
                  como plantilla de informe y envíala a aprobación.
                </>
              ) : (
                "Solo aparecen las plantillas de este informe aprobadas por WhatsApp."
              )
            }
          >
            {(control) => (
              <Select
                id={control.id}
                aria-invalid={control["aria-invalid"]}
                aria-describedby={control["aria-describedby"]}
                aria-label="Plantilla"
                value={plantillaId}
                onValueChange={setPlantillaId}
                placeholder="Elige una plantilla"
                disabled={plantillasDelInforme.length === 0}
                options={plantillasDelInforme.map((p) => ({
                  value: p.id,
                  label: p.llevaDocumento ? `${p.nombre} · lleva documento` : p.nombre,
                }))}
              />
            )}
          </FormField>

          {faltaDocumento ? (
            <div role="alert" className="rounded-lg border border-warning/60 bg-warning-soft p-3 text-warning-strong">
              <p className="text-sm font-semibold">Esta plantilla no lleva documento</p>
              <p className="mt-1 text-xs leading-relaxed">
                WhatsApp no deja pegar el PDF a <span className="font-mono">{plantilla?.nombre}</span>. Elige una
                plantilla con documento o crea una en Plantillas. Así no se puede guardar ni probar.
              </p>
            </div>
          ) : null}

          {informe ? (
            <ParametrosInforme
              informe={informe}
              valores={parametros}
              errores={errores}
              onCambiar={(campo, valor) => setParametros((p) => ({ ...p, [campo]: valor }))}
            />
          ) : null}
        </Seccion>

        <Seccion titulo="A quién" descripcion="Por rol, para que una persona nueva lo reciba sin tocar esto; o persona por persona.">
          <DestinatariosField
            personas={personas}
            roles={roles}
            usuarioIds={usuarioIds}
            onCambiar={(sel) => {
              setRoles(sel.roles);
              setUsuarioIds(sel.usuarioIds);
            }}
            preview={preview}
            informeNoAptoAdminTienda={informe !== undefined && !informe.aptoParaAdminTienda}
            errores={erroresDestinatarios}
          />
        </Seccion>

        <Seccion titulo="Cuándo" descripcion="Hora de Costa Rica.">
          <RadioGroup
            aria-label="Cuándo se manda"
            value={disparo}
            onValueChange={cambiarDisparo}
            options={[
              { value: "hora_fija", label: "A una hora fija" },
              { value: "evento", label: "Cuando pase algo" },
            ]}
          />
          {errores.disparo ? <FieldError id="envio-disparo-error" messages={errores.disparo} /> : null}

          {disparo === "hora_fija" ? (
            <div className="flex flex-col gap-3">
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">Días</legend>
                <div className="flex flex-wrap gap-1 sm:gap-1.5">
                  {DIAS_SEMANA.map((d) => {
                    const on = dias.includes(d.dia);
                    return (
                      <button
                        key={d.dia}
                        type="button"
                        aria-pressed={on}
                        aria-label={d.largo}
                        onClick={() => alternarDia(d.dia)}
                        className={cn(
                          "flex h-11 min-w-10 items-center justify-center rounded-lg border px-2 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:h-8 sm:min-w-12",
                          on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background text-foreground",
                        )}
                      >
                        <span className="sm:hidden" aria-hidden="true">
                          {d.inicial}
                        </span>
                        <span className="hidden sm:inline" aria-hidden="true">
                          {d.corto}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {errores.diasSemana ? <FieldError id="envio-dias-error" messages={errores.diasSemana} /> : null}
              </fieldset>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="envio-hora">A las (hora de Costa Rica)</Label>
                <Input
                  id="envio-hora"
                  type="time"
                  className="w-40"
                  value={hora}
                  aria-invalid={errores.hora ? true : undefined}
                  aria-describedby={errores.hora ? "envio-hora-error" : undefined}
                  onChange={(e) => setHora(e.target.value)}
                />
                {errores.hora ? <FieldError id="envio-hora-error" messages={errores.hora} /> : null}
              </div>
            </div>
          ) : (
            <FormField
              id="envio-evento"
              label="Qué tiene que pasar"
              error={errores.eventoClave}
              hint={evento ? evento.descripcion : "Se manda cada vez que la app crea este aviso."}
            >
              {(control) => (
                <Select
                  id={control.id}
                  aria-invalid={control["aria-invalid"]}
                  aria-describedby={control["aria-describedby"]}
                  aria-label="Qué tiene que pasar"
                  value={eventoClave}
                  onValueChange={setEventoClave}
                  placeholder="Elige qué tiene que pasar"
                  options={eventosDelInforme.map((e) => ({ value: e.clave, label: e.nombre }))}
                />
              )}
            </FormField>
          )}
        </Seccion>
      </div>

      <div className="lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <VistaPreviaMensaje
          cuerpo={plantilla?.cuerpo ?? null}
          variables={informe?.variables ?? []}
          conDocumento={plantilla?.llevaDocumento === true}
          lector={preview?.destinatarios[0]?.nombre ?? null}
        />
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-border bg-background p-4 sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button type="submit" disabled={bloqueado} className="w-full sm:w-auto">
            {ocupado === "guardar" ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            Guardar
          </Button>
          <Button type="button" variant="outline" disabled={bloqueado} className="w-full sm:w-auto" onClick={() => void onProbar()}>
            {ocupado === "probar" ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            Probar ahora (solo a mí)
          </Button>
          <Link href={RUTA_LISTA} className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline sm:ml-1">
            Cancelar
          </Link>
          {envioId !== null ? (
            <Button
              type="button"
              variant="ghost"
              className="w-full text-danger-strong sm:ml-auto sm:w-auto"
              disabled={ocupado !== null}
              onClick={() => setConfirmarBorrar(true)}
            >
              Borrar envío
            </Button>
          ) : null}
        </div>
        {faltaDocumento ? (
          <p className="text-center text-xs text-muted-foreground sm:text-left">Cambia la plantilla para seguir.</p>
        ) : (
          <p className="hidden text-xs leading-relaxed text-muted-foreground sm:block">
            «Probar ahora» te lo manda solo a ti, con los datos de este momento, y queda en el historial como prueba. No
            enciende el envío. Si hay cambios sin guardar, se guardan antes.
          </p>
        )}
        {resultadoPrueba ? (
          <p
            role="status"
            className={cn("text-sm", resultadoPrueba.tono === "ok" ? "text-success-strong" : "text-danger-strong")}
          >
            {resultadoPrueba.texto}
          </p>
        ) : null}
      </div>

      <Modal
        open={confirmarBorrar}
        onOpenChange={(o) => {
          if (!o && ocupado !== "borrar") setConfirmarBorrar(false);
        }}
        title="Borrar envío"
        description={`«${nombre}» deja de mandarse. Su historial se conserva.`}
        confirmLabel="Borrar"
        cancelLabel="Cancelar"
        confirmVariant="destructive"
        closeOnConfirm={false}
        confirmDisabled={ocupado === "borrar"}
        onConfirm={onBorrar}
      />
    </form>
  );
}

function Seccion({ titulo, descripcion, children }: { titulo: string; descripcion: string; children: ReactNode }) {
  return (
    <section aria-label={titulo} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold">{titulo}</h2>
        <p className="text-sm text-muted-foreground">{descripcion}</p>
      </div>
      {children}
    </section>
  );
}

const ENTREGA_BUENA = new Set(["aceptada", "enviada", "recibida", "leida"]);

/** El resultado de «Probar ahora» en palabras (R39–R41). Exportado para el test. */
export function describirPrueba(r: ProbarEnvioResult): Resultado {
  switch (r.status) {
    case "ok": {
      if (r.entrega) {
        const base = ESTADO_ENTREGA[r.entrega.estado].etiqueta;
        const motivo = r.entrega.motivo ?? r.motivo;
        if (ENTREGA_BUENA.has(r.entrega.estado)) {
          return { tono: "ok", texto: `Prueba enviada a tu WhatsApp: ${base.toLowerCase()}.` };
        }
        return { tono: "error", texto: `La prueba no salió: ${base.toLowerCase()}${motivo ? ` — ${motivo}` : ""}.` };
      }
      const etiqueta = ESTADO_EJECUCION[r.estado].etiqueta;
      if (r.estado === "vacia") {
        return { tono: "ok", texto: `Prueba hecha: sin novedades, no se mandó nada${r.motivo ? ` (${r.motivo})` : ""}.` };
      }
      return { tono: "error", texto: `La prueba no salió: ${etiqueta.toLowerCase()}${r.motivo ? ` — ${r.motivo}` : ""}.` };
    }
    case "telefono_invalido":
      return { tono: "error", texto: r.mensaje };
    case "demasiado_pronto":
      return {
        tono: "error",
        texto: `Acabas de probar este envío. Espera ${r.segundosRestantes} segundos para volver a probarlo.`,
      };
    case "not_found":
      return { tono: "error", texto: "Este envío ya no existe." };
    case "validation_error":
      return { tono: "error", texto: "No se pudo probar: revisa el envío." };
    default:
      return { tono: "error", texto: mensajeError(r.status) };
  }
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
