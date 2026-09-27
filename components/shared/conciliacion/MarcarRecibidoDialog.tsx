"use client";

import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/shared/FormField";
import { Modal } from "@/components/shared/Modal";
import { montoValido } from "@/components/shared/monto-cliente";
import { money } from "@/lib/config/moneda";
import type { MarcaConciliacionActionResult } from "@/lib/actions/conciliacion-satelites";

import {
  CONCILIACION_ACCION,
  CONCILIACION_NOTA_MAX,
  CONCILIACION_RESPUESTA,
  MARCAR_RECIBIDO_ERROR,
  MARCAR_RECIBIDO_TEXTO,
} from "./conciliacion-labels";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 (R9/R10) — EL DIÁLOGO DE «MARCAR RECIBIDO».
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// COMPARTIDO, y por eso NO sabe a qué consolidación marca: recibe `onMarcar`, y quien lo monta le
// añade el `cierreBodegaId`. Lo montan las DOS pantallas donde se concilia —el desglose de
// `/wallet/satelites` y la cola de `/cierres-admin`— y ésa es la razón de que viva aquí
// (`docs/architecture.md`: se promueve cuando dos features lo necesitan con la misma API). Molde:
// `components/shared/liquidacion/RegistrarPagoDialog`.
//
// ── MONEY-SAFE (R20): CERO `Number(`, CERO `parseFloat` y CERO restas en este archivo.
// El declarado entra como STRING del servidor, PREFIJA el campo tal cual y sale como STRING. La
// única comparación de dinero es la de FORMA del monto, y la hace `montoValido` por texto.
//
// ── EL MONTO NACE PRECARGADO CON LO DECLARADO, Y ES LA DECISIÓN DE DISEÑO DEL DIÁLOGO
// El caso abrumadoramente mayoritario es que el bulto llegue entero: en producción, 32 de 32
// consolidaciones en dos semanas. Con el campo vacío, cada conciliación normal costaría teclear
// un importe de seis cifras, y ahí es donde se cuelan los errores de tecleo en una marca que
// después hay que deshacer. Precargado, la conciliación normal es un clic y la EXCEPCIÓN —contar
// una cantidad distinta— es la que pide trabajo. La pista lo dice con todas sus letras.
//
// ⚠️ PRECARGAR NO ES AUTO-MARCAR. La alternativa E del diseño —que consolidar creara la
// consolidación ya marcada— se descartó porque pone el saldo en cero por defecto y hace invisible
// el bulto que no llegó. Aquí sigue habiendo un acto explícito de una persona: lo que se ahorra
// es teclear, no mirar.
//
// ── QUÉ NO HACE ESTE DIÁLOGO
// No compara el monto contra el declarado ni avisa de la diferencia: recibir MENOS es legítimo
// (R18, es el caso entero de la ficha) y recibir MÁS también (llegó de más, §1.2). Un aviso de
// «no coincide» convertiría el caso que hay que poder registrar en algo que parece un error.

/** Lo que este formulario sabe componer. El `cierreBodegaId` lo pone quien lo monta. */
export interface MarcarRecibidoCampos {
  montoRecibido: string;
  nota?: string;
}

export interface MarcarRecibidoDialogProps {
  /** Visibilidad controlada por el padre (mismo contrato que `Modal`). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nombre de la bodega: da nombre accesible al diálogo y distingue un bulto de otro. */
  bodega: string;
  /** Día de la consolidación, YA formateado por quien lo monta (aquí no se formatean fechas). */
  fecha: string;
  /**
   * `total_efectivo` de la consolidación, STRING del servidor. Es lo que la bodega DECLARÓ que
   * metió en el bulto, y lo que prefija el campo. No se opera con él: sólo se pinta y se copia.
   */
  declarado: string;
  /**
   * El monto ya marcado, si se está CORRIGIENDO una conciliación existente. Cuando llega, el
   * campo arranca con él —no con lo declarado— porque corregir es partir de lo que se dijo antes,
   * y el título cambia para que nadie crea que está marcando algo que ya estaba marcado.
   */
  montoActual?: string | null;
  /** Nota ya guardada, si se corrige. Misma lógica que `montoActual`. */
  notaActual?: string | null;
  /** Envía la marca. La aporta quien monta, que es quien sabe de qué consolidación se trata. */
  onMarcar: (campos: MarcarRecibidoCampos) => Promise<MarcaConciliacionActionResult>;
  /** Se invoca cuando el servidor confirmó, con el monto que quedó registrado. */
  onMarcado?: (montoRecibido: string) => void | Promise<void>;
}

/** Traduce la respuesta del servidor a un aviso. Fuera del componente para que el `switch` sea
 *  EXHAUSTIVO sobre el resultado: un estado nuevo en el contrato rompe el build en vez de caer
 *  en un `default` mudo. */
function avisoDe(resultado: MarcaConciliacionActionResult): string {
  switch (resultado.status) {
    case "ok":
      return "";
    case "conflict":
      return CONCILIACION_RESPUESTA.conflicto;
    case "no_encontrada":
      return CONCILIACION_RESPUESTA.noEncontrada;
    case "forbidden":
      return CONCILIACION_RESPUESTA.forbidden;
    case "unauthenticated":
      return CONCILIACION_RESPUESTA.unauthenticated;
    case "validation_error":
      // Los mensajes van por campo; el aviso general se deja vacío para no duplicarlos.
      return "";
  }
}

export function MarcarRecibidoDialog({
  open,
  onOpenChange,
  bodega,
  fecha,
  declarado,
  montoActual = null,
  notaActual = null,
  onMarcar,
  onMarcado,
}: Readonly<MarcarRecibidoDialogProps>) {
  const esCorreccion = montoActual !== null;
  const idBase = useId();
  const campoId = (nombre: string) => `${idBase}-${nombre}`;

  // El valor de partida: lo ya marcado si se corrige, lo declarado si se marca por primera vez.
  const partida = montoActual ?? declarado;

  const [monto, setMonto] = useState(partida);
  const [nota, setNota] = useState(notaActual ?? "");
  const [abiertoAntes, setAbiertoAntes] = useState(open);
  const [errorMonto, setErrorMonto] = useState<string | undefined>(undefined);
  const [errorNota, setErrorNota] = useState<string | undefined>(undefined);
  const [aviso, setAviso] = useState<string | null>(null);

  // Transición CERRADO → ABIERTO: se ajusta el estado DURANTE el render, que es la forma que
  // React documenta para reaccionar a un cambio de prop. Con un efecto sería un `setState` en
  // cascada, que en este repo es error de lint (`react-hooks/set-state-in-effect`).
  //
  // A diferencia de `RegistrarPagoDialog`, aquí el formulario SÍ se reinicia en cada apertura y
  // es correcto: esta acción no lleva clave de idempotencia porque no escribe en ningún libro de
  // dinero (R14) y su guarda es el propio estado —marcar dos veces responde `conflict` (R11)—.
  // Conservar un borrador entre aperturas haría que abrir OTRA consolidación heredara el monto
  // tecleado para la anterior, que en una pantalla de dinero es peor que volver a teclear.
  if (open !== abiertoAntes) {
    setAbiertoAntes(open);
    if (open) {
      setMonto(partida);
      setNota(notaActual ?? "");
      setErrorMonto(undefined);
      setErrorNota(undefined);
      setAviso(null);
    }
  }

  const notaLimpia = nota.trim();
  // Misma forma que revalida el borde (`montoPositivoSchema`): > 0 y hasta dos decimales. Sin
  // tope por arriba, porque el schema compartido tampoco lo tiene: el cliente no puede ser más
  // estricto que su propio servidor.
  const montoOk = montoValido(monto);
  const notaOk = notaLimpia.length <= CONCILIACION_NOTA_MAX;
  const formularioValido = montoOk && notaOk;

  async function confirmar() {
    if (!formularioValido) {
      setErrorMonto(montoOk ? undefined : MARCAR_RECIBIDO_ERROR.monto);
      setErrorNota(notaOk ? undefined : MARCAR_RECIBIDO_ERROR.notaLarga(CONCILIACION_NOTA_MAX));
      return;
    }
    setErrorMonto(undefined);
    setErrorNota(undefined);
    setAviso(null);

    const montoLimpio = monto.trim();
    let resultado: MarcaConciliacionActionResult;
    try {
      // La nota VACÍA no se manda: el schema del borde es `.strict()` y la declara opcional, así
      // que una cadena vacía sería una nota en blanco guardada como si alguien la hubiera escrito.
      resultado = await onMarcar({
        montoRecibido: montoLimpio,
        ...(notaLimpia ? { nota: notaLimpia } : {}),
      });
    } catch {
      setAviso(CONCILIACION_RESPUESTA.fallo);
      return;
    }

    if (resultado.status === "ok") {
      await onMarcado?.(montoLimpio);
      onOpenChange(false);
      return;
    }
    if (resultado.status === "validation_error") {
      setErrorMonto(resultado.fieldErrors.montoRecibido?.[0] ?? MARCAR_RECIBIDO_ERROR.monto);
      setErrorNota(resultado.fieldErrors.nota?.[0]);
      return;
    }
    setAviso(avisoDe(resultado));
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={esCorreccion ? MARCAR_RECIBIDO_TEXTO.tituloCorregir : MARCAR_RECIBIDO_TEXTO.titulo}
      description={MARCAR_RECIBIDO_TEXTO.descripcion(bodega, fecha)}
      confirmLabel={MARCAR_RECIBIDO_TEXTO.confirmar}
      cancelLabel={CONCILIACION_ACCION.cancelar}
      confirmDisabled={!formularioValido}
      onConfirm={confirmar}
      /* El cierre lo decide `confirmar`: un rechazo del servidor deja el diálogo abierto con lo
         que la persona escribió, en vez de tragarse el monto tecleado. */
      closeOnConfirm={false}
      size="md"
    >
      <div className="flex flex-col gap-4">
        {/* LO DECLARADO, en su propia banda: es el número contra el que se compara mentalmente
            lo que se contó, así que tiene que leerse sin buscarlo. `tabular-nums` para que las
            cifras se alineen con las del campo de abajo. */}
        <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2.5">
          <span className="text-sm text-muted-foreground">
            {MARCAR_RECIBIDO_TEXTO.declarado}
          </span>
          <strong className="text-base font-semibold tabular-nums text-foreground">
            {money(declarado)}
          </strong>
        </div>

        {aviso ? (
          <p role="alert" className="text-sm text-destructive">
            {aviso}
          </p>
        ) : null}

        <FormField
          id={campoId("monto")}
          label={MARCAR_RECIBIDO_TEXTO.montoRecibido}
          hint={MARCAR_RECIBIDO_TEXTO.montoAyuda}
          required
          error={errorMonto}
        >
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              className="tabular-nums focus-visible:ring-3 focus-visible:ring-ring"
              value={monto}
              onChange={(e) => {
                setMonto(e.target.value);
                setErrorMonto(undefined);
              }}
              placeholder="0.00"
            />
          )}
        </FormField>

        <FormField
          id={campoId("nota")}
          label={MARCAR_RECIBIDO_TEXTO.nota}
          hint={MARCAR_RECIBIDO_TEXTO.notaAyuda}
          error={errorNota}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              className="focus-visible:ring-3 focus-visible:ring-ring"
              value={nota}
              onChange={(e) => {
                setNota(e.target.value);
                setErrorNota(undefined);
              }}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
}
