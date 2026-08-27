"use client";

import { useId, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/shared/FormField";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import {
  anularPremioAction,
  listarPremiosDelDiaAction,
  registrarPremioAction,
} from "@/lib/actions/premio-ranking-devengo";
import type {
  AnularPremioActionResult,
  RegistrarPremioActionResult,
} from "@/lib/actions/premio-ranking-devengo";
import type { PremioPodioDTO } from "@/lib/types/premio-ranking-devengo";
import type { CierreEstado } from "@/lib/types/cierre";

import {
  ANULAR_PREMIO_TEXTO,
  ESTADO_CIERRE_EN_FRASE,
  PREMIOS_RANKING,
  money,
} from "./wallet-mensajeros-labels";

// Feature 293 (T5.1/T5.2, design §9) — EL PANEL DE PREMIOS DEL RANKING, en `/wallet/mensajeros`.
//
// Es la ÚNICA puerta desde la que se registra el premio del podio de un día (R1): no hay ruta de
// API, ni cron, ni ninguna otra pantalla que lo ofrezca. Y siempre hay un acto humano (R3): esto
// no se dispara solo al aprobar un cierre ni al congelar el ranking.
//
// **EL PERMISO NO SE DECIDE ACÁ.** `page.tsx` hace `notFound()` para cualquier rol que no sea de
// acceso total, así que el rol no existe en el cliente y no hay nada que ocultar por rol. La
// barrera real es el servicio, que responde `forbidden` con el mismo predicado (R2). Es el mismo
// criterio que ya sigue `PagoMensajeroAcciones`.
//
// **LO QUE ESTA PANTALLA EXISTE PARA ENSEÑAR, y que ningún test de servidor puede medir:**
//
//  - **`entregadas / asignadas` pegado al premio** (R5). El 26/08, con todos los mensajeros al
//    0 %, el podio lo decidió el orden alfabético y el primer puesto fue **0 de 21**. El par se
//    pinta SIEMPRE, también en cero, y sin sustituirlo por una raya: la decisión es humana, pero
//    con el dato delante.
//  - **los seis estados de R9 se dicen con TEXTO**, nunca con la ausencia del botón. «Sin premio»,
//    «ese día no tiene cierre» (R11) y «el cierre de ese día está rechazado» (R12) son tres cosas
//    distintas, y un hueco donde debería haber un control las hace indistinguibles.
//  - **«Anulado — no se puede volver a registrar»** (R32): el cupo de ese (mensajero, día) lo
//    consumió la anulación y la base no dejará escribir otro. Se dice, no se deja como sorpresa.
//
// **MONEY-SAFE (R35).** Ni un `Number(`, ni un `parseFloat`, ni una resta. Los importes llegan
// como STRING de escala 2 desde el servidor y solo pasan por `money`, que les da formato. Nada de
// esta pantalla suma, resta ni compara importes: el monto congelado se pinta y se manda de vuelta
// nada más que su `filaId` (R16).
//
// **LO QUE EL CLIENTE MANDA es `filaId` y, al anular, el motivo. Nada más** (R16/R30): mensajero,
// fecha, monto y cierre los resuelve el servidor desde la fila congelada del podio.

/** Prefijo de la clave SWR de este panel. Identifica su lectura entre todas las de la app. */
const CLAVE_PREMIOS = "wallet-mensajeros:premios";

/**
 * Las claves que quedan DESFASADAS cuando se escribe (o se anula) un premio, y por qué cada una:
 *
 *  - `wallet-mensajeros:premios`  — el estado de la fila que se acaba de tocar (R9);
 *  - `wallet-mensajeros:cuentas`  — la cuenta por pagar de ese mensajero subió o bajó;
 *  - `wallet-mensajeros:desglose` — el desglose abierto tiene un movimiento más (R34);
 *  - `liquidacion:reparto-previsualizacion` — **lo pagable de su cierre cambió** (R24/R27/R33):
 *    un cierre que estaba saldado vuelve a ofrecer pago por el importe del premio.
 *
 * Es un refresco DIRIGIDO y no un `mutate()` a secas: sin la lista, se releerían también las
 * lecturas de las otras pantallas montadas, y cada una de éstas cuesta una agregación del libro
 * entero. Lo que NO se puede acotar más es el MENSAJERO: `PremioPodioDTO` no publica su id —el
 * cliente no lo necesita para nada, y pedirlo sería ampliar el contrato sin motivo—, así que se
 * alcanzan las claves de ESTA pantalla y de la del reparto, que son las únicas montadas cuando
 * este panel está a la vista.
 */
const PREFIJOS_A_REFRESCAR: readonly string[] = [
  CLAVE_PREMIOS,
  "wallet-mensajeros:cuentas",
  "wallet-mensajeros:desglose",
  "liquidacion:reparto-previsualizacion",
];

/** `true` si esa clave de SWR es una de las que el registro deja desfasadas. */
function esClaveAfectada(clave: unknown): boolean {
  return (
    Array.isArray(clave) &&
    typeof clave[0] === "string" &&
    PREFIJOS_A_REFRESCAR.includes(clave[0])
  );
}

/** El podio de una fecha, tal como lo pinta el panel. `hayPodio: false` es R6. */
interface PodioDelDia {
  hayPodio: boolean;
  filas: PremioPodioDTO[];
}

/**
 * Fetcher: pide el podio de esa fecha y traduce un status != ok a un throw (SWR lo marca
 * `error`). `forbidden`/`unauthenticated` llegan acá sólo si la sesión cambió con la pantalla
 * abierta; el rol lo resolvió el Server Component antes de montar nada.
 */
async function leerPodio(fecha: string): Promise<PodioDelDia> {
  const res = await listarPremiosDelDiaAction({ fecha });
  if (res.status !== "ok") throw new Error(res.status);
  return { hayPodio: res.hayPodio, filas: res.filas };
}

/** El aviso del desenlace de una escritura, anclado a la fila que lo produjo. */
interface AvisoDeFila {
  filaId: string;
  texto: string;
  /** `error` lo anuncia un lector de pantalla de inmediato (`role="alert"`). */
  tono: "ok" | "error";
}

/**
 * Traduce el desenlace de registrar. El `switch` es exhaustivo sobre el contrato de la action:
 * un estado nuevo rompe el build en vez de caer en un «error genérico», que es exactamente lo
 * que R11 y R12 prohíben.
 */
function avisoDeRegistro(resultado: RegistrarPremioActionResult): AvisoDeFila["texto"] {
  switch (resultado.status) {
    case "ok":
      return PREMIOS_RANKING.registradoOk(resultado.monto);
    case "ya_registrado":
      return PREMIOS_RANKING.yaRegistrado;
    case "anulado":
      return PREMIOS_RANKING.yaAnulado;
    case "sin_premio":
      return PREMIOS_RANKING.sinPremio;
    case "sin_cierre":
      return PREMIOS_RANKING.sinCierre;
    case "cierre_no_aprobado":
      return PREMIOS_RANKING.cierreNoAprobado(estadoEnFrase(resultado.estado));
    case "no_encontrado":
      return PREMIOS_RANKING.noEncontrado;
    case "forbidden":
      return PREMIOS_RANKING.forbidden;
    case "unauthenticated":
      return PREMIOS_RANKING.unauthenticated;
    case "validation_error":
      return PREMIOS_RANKING.validacion;
  }
}

/** Ídem para la anulación. `ya_anulado` NO es un error (R31) y no se pinta como tal. */
function avisoDeAnulacion(resultado: AnularPremioActionResult): AvisoDeFila["texto"] {
  switch (resultado.status) {
    case "ok":
      return PREMIOS_RANKING.anuladoOk;
    case "ya_anulado":
      return PREMIOS_RANKING.anuladoRepetido;
    case "no_registrado":
      return PREMIOS_RANKING.noRegistrado;
    case "no_encontrado":
      return PREMIOS_RANKING.noEncontrado;
    case "forbidden":
      return PREMIOS_RANKING.forbidden;
    case "unauthenticated":
      return PREMIOS_RANKING.unauthenticated;
    case "validation_error":
      return PREMIOS_RANKING.validacion;
  }
}

/** `true` si el desenlace dejó el mundo como se pedía (y por tanto hay que releer). */
function dejoEscrito(status: string): boolean {
  return status === "ok" || status === "ya_registrado" || status === "ya_anulado";
}

/**
 * El estado del cierre, en minúscula y listo para meterse en una frase (R12).
 *
 * El contrato lo publica como `string` y no como `CierreEstado` —viene de la base—, así que un
 * valor que el mapa no conozca se pinta TAL CUAL en vez de desaparecer: un estado sin rótulo es
 * un fallo que hay que poder ver, y decir «está undefined» sería peor que decir su valor crudo.
 */
function estadoEnFrase(estado: string): string {
  return ESTADO_CIERRE_EN_FRASE[estado as CierreEstado] ?? estado;
}

export interface PremiosRankingPanelProps {
  /**
   * Día que el panel muestra al abrirse: el último que el ranking congeló (ayer en Costa Rica).
   *
   * Lo calcula el SERVIDOR y baja por props, en vez de resolverlo acá con `new Date()`. Dos
   * motivos: el mismo día tiene que salir del render del servidor y del de hidratación —si no,
   * son dos árboles distintos—, y el reloj del navegador de quien mira no es el de Costa Rica.
   */
  fechaInicial: string;
  /**
   * Hoy en Costa Rica: cota superior del selector (R8, no hay podio del futuro). También del
   * servidor, por lo mismo. El borde de la action lo revalida.
   */
  fechaMaxima: string;
}

export function PremiosRankingPanel({
  fechaInicial,
  fechaMaxima,
}: Readonly<PremiosRankingPanelProps>) {
  const idBase = useId();
  const idFecha = `${idBase}-fecha`;
  const idAyudaFecha = `${idFecha}-ayuda`;

  const { mutate } = useSWRConfig();
  const toast = useToast();

  const [fecha, setFecha] = useState(fechaInicial);
  const [aviso, setAviso] = useState<AvisoDeFila | null>(null);
  /** La fila cuya escritura está en vuelo: sólo su botón se pone a cargar. */
  const [enVuelo, setEnVuelo] = useState<string | null>(null);
  /** La fila cuyo diálogo de anulación está abierto (R30: el motivo se pide antes de enviar). */
  const [anulando, setAnulando] = useState<PremioPodioDTO | null>(null);

  const { data, error, isLoading } = useSWR([CLAVE_PREMIOS, fecha], () => leerPodio(fecha));

  /** Refresco dirigido tras escribir (design §9). */
  async function refrescar() {
    await mutate(esClaveAfectada);
  }

  async function registrar(fila: PremioPodioDTO) {
    setAviso(null);
    setEnVuelo(fila.filaId);
    let resultado: RegistrarPremioActionResult;
    try {
      // R16: del cliente sale `filaId` y NADA más. El monto que se ve al lado es el congelado
      // que el servidor va a releer por su cuenta; mandarlo sería darle al cliente un voto.
      resultado = await registrarPremioAction({ filaId: fila.filaId });
    } catch {
      setEnVuelo(null);
      setAviso({ filaId: fila.filaId, texto: PREMIOS_RANKING.fallo, tono: "error" });
      return;
    }
    setEnVuelo(null);

    const escrito = dejoEscrito(resultado.status);
    setAviso({
      filaId: fila.filaId,
      texto: avisoDeRegistro(resultado),
      tono: escrito ? "ok" : "error",
    });
    if (resultado.status === "ok") toast.success(PREMIOS_RANKING.registradoOk(resultado.monto));
    if (escrito) await refrescar();
  }

  async function anular(fila: PremioPodioDTO, motivo: string) {
    setAviso(null);
    let resultado: AnularPremioActionResult;
    try {
      resultado = await anularPremioAction({ filaId: fila.filaId, motivo });
    } catch {
      setAviso({ filaId: fila.filaId, texto: PREMIOS_RANKING.fallo, tono: "error" });
      return;
    }

    const escrito = dejoEscrito(resultado.status);
    setAviso({
      filaId: fila.filaId,
      texto: avisoDeAnulacion(resultado),
      tono: escrito ? "ok" : "error",
    });
    if (resultado.status === "ok") toast.success(PREMIOS_RANKING.anuladoOk);
    if (escrito) {
      setAnulando(null);
      await refrescar();
    }
  }

  return (
    <section
      aria-label={PREMIOS_RANKING.seccion}
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">{PREMIOS_RANKING.seccion}</h2>
        <p className="text-sm text-muted-foreground">{PREMIOS_RANKING.descripcion}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={idFecha}>{PREMIOS_RANKING.selectorFecha}</Label>
        <Input
          id={idFecha}
          type="date"
          value={fecha}
          max={fechaMaxima}
          aria-describedby={idAyudaFecha}
          onChange={(evento) => {
            // El `<input type="date">` emite "" al vaciarse; no se consulta un día que no hay.
            if (!evento.target.value) return;
            setAviso(null);
            setFecha(evento.target.value);
          }}
          className="w-44"
        />
        <p id={idAyudaFecha} className="text-xs text-muted-foreground">
          {PREMIOS_RANKING.selectorAyuda}
        </p>
      </div>

      {isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">
          {PREMIOS_RANKING.cargando}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {PREMIOS_RANKING.error}
        </p>
      ) : null}

      {/* R6 — la fecha no tiene ranking congelado: se dice, y no se monta ningún control. */}
      {data && !data.hayPodio ? (
        <p role="status" className="text-sm text-muted-foreground">
          {PREMIOS_RANKING.sinPodio}
        </p>
      ) : null}

      {data?.hayPodio ? (
        <ul aria-label={PREMIOS_RANKING.listaAria} className="flex flex-col gap-3">
          {data.filas.map((fila) => (
            <FilaDelPodio
              key={fila.filaId}
              fila={fila}
              aviso={aviso?.filaId === fila.filaId ? aviso : null}
              enVuelo={enVuelo === fila.filaId}
              onRegistrar={() => registrar(fila)}
              onAbrirAnulacion={() => setAnulando(fila)}
            />
          ))}
        </ul>
      ) : null}

      {/* R30 — el motivo se pide ANTES de enviar. Sin fila elegida no hay diálogo montado. */}
      {anulando ? (
        <AnularPremioDialog
          fila={anulando}
          fecha={fecha}
          open
          onOpenChange={(abierto) => {
            if (!abierto) setAnulando(null);
          }}
          onAnular={(motivo) => anular(anulando, motivo)}
        />
      ) : null}
    </section>
  );
}

interface FilaDelPodioProps {
  fila: PremioPodioDTO;
  aviso: AvisoDeFila | null;
  enVuelo: boolean;
  onRegistrar: () => void | Promise<void>;
  onAbrirAnulacion: () => void;
}

/**
 * Una fila del podio congelado: posición, nombre congelado, **`entregadas / asignadas`**, el
 * premio con su descripción y el estado con su control, si lo tiene.
 *
 * El orden de la fila no es decorativo: el par de R5 va ANTES del importe y del botón, que es el
 * orden en que se lee y el orden en que hay que enterarse.
 */
function FilaDelPodio({
  fila,
  aviso,
  enVuelo,
  onRegistrar,
  onAbrirAnulacion,
}: Readonly<FilaDelPodioProps>) {
  return (
    <li className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-sm font-medium tabular-nums">
          {PREMIOS_RANKING.posicion(fila.posicion)}
        </span>
        <span className="text-sm font-medium">{fila.mensajeroNombre}</span>

        {/*
          R5 — SIEMPRE visible y pegado al premio, también cuando vale `0 / 21`. No se esconde,
          no se sustituye por una raya y no se convierte en un aviso condicional: el día que un
          podio salga por orden alfabético, esto es lo único que lo delata en pantalla.
        */}
        <span className="text-sm tabular-nums text-muted-foreground">
          {PREMIOS_RANKING.entregadasAsignadas(fila.entregadas, fila.asignadas)}
        </span>

        {/* Money-safe: el STRING congelado del servidor, con formato y nada más. */}
        {fila.premioMonto === null ? null : (
          <span className="text-sm font-medium text-warning-strong">
            {money(fila.premioMonto)}
          </span>
        )}
        {fila.premioDescripcion ? (
          <span className="text-xs text-muted-foreground">{fila.premioDescripcion}</span>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">{PREMIOS_RANKING.entregadasAyuda}</p>

      <div className="flex flex-wrap items-center gap-3">
        <EstadoDelPremio fila={fila} />

        {/* R9 — el control sólo existe donde la acción es posible; el resto de los casos los
            explica el texto de arriba, que es lo que sigue en pantalla cuando no hay botón. */}
        {fila.estado === "no_registrado" ? (
          <Button type="button" loading={enVuelo} onClick={() => void onRegistrar()}>
            {PREMIOS_RANKING.registrar(fila.mensajeroNombre)}
          </Button>
        ) : null}

        {fila.estado === "registrado" ? (
          <Button type="button" variant="outline" onClick={onAbrirAnulacion}>
            {PREMIOS_RANKING.anular(fila.mensajeroNombre)}
          </Button>
        ) : null}
      </div>

      {aviso ? (
        <p
          role={aviso.tono === "error" ? "alert" : "status"}
          className={
            aviso.tono === "error" ? "text-sm text-destructive" : "text-sm text-success-strong"
          }
        >
          {aviso.texto}
        </p>
      ) : null}
    </li>
  );
}

/**
 * R9 — los seis estados, cada uno con su texto. El `switch` es exhaustivo sobre
 * `PremioPodioEstado`: un estado nuevo del contrato rompe el build en vez de pintar un hueco.
 */
function EstadoDelPremio({ fila }: Readonly<{ fila: PremioPodioDTO }>) {
  const texto = textoDelEstado(fila);
  // `no_registrado` no tiene texto propio: lo que hay que hacer lo dice el botón de al lado.
  if (texto === "") return null;
  return <span className="text-sm text-muted-foreground">{texto}</span>;
}

function textoDelEstado(fila: PremioPodioDTO): string {
  switch (fila.estado) {
    case "sin_premio":
      return PREMIOS_RANKING.sinPremio;
    case "sin_cierre":
      return PREMIOS_RANKING.sinCierre;
    case "cierre_no_aprobado":
      return PREMIOS_RANKING.cierreNoAprobado(estadoEnFrase(fila.cierreEstado ?? ""));
    case "registrado":
      return PREMIOS_RANKING.registrado;
    case "anulado":
      return PREMIOS_RANKING.anuladoEstado;
    case "no_registrado":
      // El único caso en el que el texto no explica una imposibilidad: el botón está al lado y
      // dice lo que falta, que es el acto humano.
      return "";
  }
}

interface AnularPremioDialogProps {
  fila: PremioPodioDTO;
  /** El día del podio, para que quien confirma vea QUÉ premio está anulando. */
  fecha: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAnular: (motivo: string) => Promise<void>;
}

/**
 * T5.2/R30 — el diálogo que pide el MOTIVO antes de anular.
 *
 * Molde de `AnularPagoDialog` (172): `Modal` con `closeOnConfirm={false}` —un rechazo del
 * servidor deja el diálogo abierto con lo escrito—, `confirmVariant="destructive"` y el motivo
 * en un `FormField` con su error asociado.
 *
 * LAS DOS BARRERAS DEL MOTIVO. El botón está deshabilitado mientras el motivo esté en blanco
 * **y** `confirmar()` vuelve a comprobarlo antes de llamar a nadie. No es redundancia: son las
 * dos direcciones del mismo requisito, y la segunda sigue en pie si alguien quita la primera.
 * El servidor lo revalida por tercera vez, en el borde de la action.
 */
function AnularPremioDialog({
  fila,
  fecha,
  open,
  onOpenChange,
  onAnular,
}: Readonly<AnularPremioDialogProps>) {
  const idBase = useId();
  const motivoId = `${idBase}-motivo`;

  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  const motivoLimpio = motivo.trim();
  /** R30 — un motivo de sólo espacios NO es un motivo. */
  const motivoOk = motivoLimpio.length > 0;

  async function confirmar() {
    if (!motivoOk) {
      // Segunda barrera: aunque el botón estuviera habilitado, de aquí no sale nada.
      setError(ANULAR_PREMIO_TEXTO.motivoRequerido);
      return;
    }
    setError(undefined);
    await onAnular(motivoLimpio);
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={ANULAR_PREMIO_TEXTO.titulo(fila.mensajeroNombre)}
      description={ANULAR_PREMIO_TEXTO.descripcion}
      confirmLabel={ANULAR_PREMIO_TEXTO.confirmar}
      cancelLabel={ANULAR_PREMIO_TEXTO.cancelar}
      confirmVariant="destructive"
      confirmDisabled={!motivoOk}
      onConfirm={confirmar}
      closeOnConfirm={false}
      size="md"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {ANULAR_PREMIO_TEXTO.resumen(fila.premioMonto, fecha)}
        </p>

        <FormField
          id={motivoId}
          label={ANULAR_PREMIO_TEXTO.motivo}
          hint={ANULAR_PREMIO_TEXTO.motivoAyuda}
          required
          error={error}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={4}
              value={motivo}
              onChange={(evento) => {
                setMotivo(evento.target.value);
                setError(undefined);
              }}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
}
