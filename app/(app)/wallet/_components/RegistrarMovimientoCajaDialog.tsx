"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { FormField } from "@/components/shared/FormField";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import { registrarMovimientoManualAction } from "@/lib/actions/wallet";
import { registrarEgresoAdministrativoAction } from "@/lib/actions/wallet-egresos";
import { registrarCobroTiendaAction } from "@/lib/actions/wallet-tienda";
import { listarAdminTiendas } from "@/lib/actions/usuarios-por-rol";
import { money } from "@/lib/config/moneda";
import { primerDiaMovimientoAdmisible, problemaDeFechaMovimiento } from "@/lib/types/wallet";
import type { UsuarioPorRolDTO } from "@/lib/types/usuario-por-rol";
import type { SaldoTiendaDTO } from "@/lib/types/wallet-tienda";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

import { SALDO_SIGNO_LABEL } from "../tiendas/_components/saldo-tienda-signo-label";
import {
  CABECERA_POR_LIBRO,
  CONCEPTO_MANUAL_OPTIONS,
  CONCEPTOS_MANUALES,
  conceptoPorId,
  fraseDelLibro,
  libroDelConcepto,
  type ConceptoManual,
} from "./wallet-conceptos-manuales";
import { montoValido } from "./wallet-labels";

// Ficha 334 (T D3, design §10) — el ÚNICO control para mover dinero a mano en la caja
// principal. Sustituye a los dos diálogos que había (`RegistrarMovimientoManualDialog` y
// `RegistrarEgresoAdministrativoDialog`), que pedían lo mismo con dos vocabularios distintos y
// obligaban a adivinar cuál abrir.
//
// Se unifica la INTERFAZ, no el backend (design §6): el concepto elegido decide a qué Server
// Action va el registro, porque los cuatro escriben `origen_tipo` distinto (`gasto` vs
// `manual`) y de ese campo cuelga qué movimiento se puede reversar. Una action única volvería
// reversables los ajustes —un cambio en dinero que nadie pidió— colado en un cambio de forma.
//
// FICHA 381 (T H.2, design §8) — entra una TERCERA rama de enrutado: «Cobrar un costo a una
// tienda» no escribe en la caja, sino en el libro de esa tienda, y por eso pide UN campo más.
// Tres propiedades de esa rama, y las tres son requisito:
//
//  - **El campo de la tienda es CONDICIONAL** (R2/R3): con cualquiera de los otros cuatro
//    conceptos no se monta y el payload no gana ni una clave.
//  - **El payload del cobro lleva SOLO lo que el usuario decide** (`tiendaId`, `monto`,
//    `descripcion` y la fecha si eligió otra). El tipo, la categoría, quién lo registra y el
//    origen los fija el SERVIDOR: su schema es `.strict()` y colar cualquiera de ellos desde
//    aquí sería un `validation_error`, no un atajo.
//  - **No hay rama de «saldo insuficiente»** y no debe haberla (R27). Un cobro nunca se compara
//    contra el disponible de nadie: si la tienda no tiene dinero a favor, su saldo queda
//    NEGATIVO y se cobra cuando la gestión vuelva a generarle dinero. El aviso de éxito lo dice
//    con la cifra que devuelve el servidor, con su signo y tal cual.
//
// Money-safe (R15/381-R18): el monto viaja como STRING de punta a punta y NUNCA se convierte a
// punto flotante en este archivo; el borde lo re-valida con aritmetica decimal. El saldo que
// vuelve del servidor se PINTA tal cual (`money` formatea el STRING dígito a dígito): ni se
// compara, ni se convierte, ni se recorta.
// Mutación interna por Server Action (NO fetch a /api). El movimiento es INMUTABLE (R17): no
// hay editar ni borrar.

/** El concepto que el diálogo trae elegido al abrirse: el primero del catálogo. */
const CONCEPTO_INICIAL: ConceptoManual = CONCEPTOS_MANUALES[0];

/** Clave SWR del catálogo de tiendas destinatarias (R5). */
const SWR_KEY_TIENDAS_COBRO = "wallet:registrar-movimiento:tiendas";

/**
 * FICHA 381 — los textos del quinto concepto, agrupados para que una futura pasada de i18n
 * tenga UN solo sitio que tocar (`docs/conventions`: los textos fuera del JSX).
 */
const TEXTO_COBRO_TIENDA = {
  label: "Tienda a la que se le cobra",
  hint: "El cobro se descuenta de lo que Ordenex le debe a esa tienda. Si no le debe nada, su saldo queda en negativo y se cobra cuando la gestión le vuelva a generar dinero a favor.",
  placeholder: "Elegí la tienda",
  cargando: "Cargando las tiendas…",
  vacio: "No hay tiendas activas",
  /** R7 — confirmar sin haber elegido tienda. */
  sinElegir: "Elegí la tienda a la que se le cobra.",
  /** R6 — el catálogo no se pudo leer: se dice, y este concepto queda bloqueado. */
  catalogoCaido:
    "No se pudo cargar la lista de tiendas, así que no se puede registrar un cobro ahora mismo. Cerrá y volvé a abrir para reintentarlo; los otros conceptos siguen funcionando.",
  /** Lo mismo, en el hueco del desplegable, donde no cabe la frase entera. */
  catalogoCaidoBreve: "No se pudieron cargar las tiendas",
  /**
   * R9/R27 — el aviso de éxito lleva el saldo que devolvió el SERVIDOR: el STRING con su signo
   * y la marca legible que el propio servidor derivó. Un cobro que deja a la tienda en negativo
   * se anuncia en negativo; esconderlo sería mentir sobre dinero cobrado de verdad.
   */
  registrado: (tienda: string, saldo: SaldoTiendaDTO) =>
    `Cobro registrado. El saldo de ${tienda} queda en ${money(saldo.saldo)} · ${SALDO_SIGNO_LABEL[saldo.signo]}.`,
} as const;

/** El aviso de éxito de los CUATRO conceptos de la caja, byte a byte el de la ficha 334 (R11). */
const MENSAJE_EXITO_CAJA = "Movimiento registrado correctamente.";

interface ErroresCampo {
  monto?: string;
  fecha?: string;
  descripcion?: string;
  /** FICHA 381 (R7/R10): el campo de la tienda tiene su propio error, del cliente o del borde. */
  tiendaId?: string;
}

/**
 * Lo que `registrar()` le devuelve a `confirmar()`, ya normalizado: las tres actions tienen
 * resultados distintos (una devuelve el movimiento de caja, otra el cobro y el saldo) y el
 * diálogo solo necesita saber si salió bien, con qué frase avisarlo, y qué campo señalar.
 */
type ResultadoRegistro =
  | { status: "ok"; mensajeExito: string }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" }
  | { status: "unauthenticated" };

/**
 * FICHA 381 (R5) — las tiendas que pueden recibir un cobro.
 *
 * Reusa `listarAdminTiendas`, que ya autoriza y proyecta id/nombre de las cuentas de tienda
 * ACTIVAS ordenadas por nombre; aquí no se decide ningún permiso y **no se reordena nada**: el
 * orden determinista es el del servidor.
 *
 * A diferencia de `GenerarApiKeyForm`, que se degrada en SILENCIO, aquí el fallo se propaga a
 * propósito (R6). Allí la tienda destino es opcional y no poder elegirla no impide nada; aquí
 * es obligatoria, así que un desplegable vacío sin explicación dejaría a alguien pulsando
 * «Registrar» sin entender por qué no pasa nada.
 */
async function cargarTiendas(): Promise<UsuarioPorRolDTO[]> {
  const res = await listarAdminTiendas();
  if (res.status !== "ok") throw new Error(res.status);
  return res.usuarios;
}

export interface RegistrarMovimientoCajaDialogProps {
  /** Callback opcional para que el módulo recargue su vista (libro + cifras + desglose, R18). */
  onRegistrado?: () => void;
}

export function RegistrarMovimientoCajaDialog({
  onRegistrado,
}: RegistrarMovimientoCajaDialogProps) {
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [concepto, setConcepto] = useState<ConceptoManual>(CONCEPTO_INICIAL);
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [tiendaId, setTiendaId] = useState("");
  const [errores, setErrores] = useState<ErroresCampo>({});
  // La ventana admisible se congela AL ABRIR y no se recalcula en cada render: leer el reloj
  // durante el render haría que el `min`/`max` del campo cambiaran solos a medianoche, debajo
  // de una persona que está escribiendo.
  const [ventana, setVentana] = useState({ min: "", max: "" });

  // R5 — el catálogo se pide AL ABRIR el diálogo y no antes: la página de la caja no debe
  // gastar una lectura de tiendas por el hecho de pintar un botón. `shouldRetryOnError: false`
  // para que el fallo de R6 sea un estado visible y estable, no un parpadeo que reintenta solo.
  const {
    data: tiendas,
    error: errorTiendas,
    isLoading: cargandoTiendas,
  } = useSWR(open ? SWR_KEY_TIENDAS_COBRO : null, cargarTiendas, {
    shouldRetryOnError: false,
  });

  const esCobro = concepto.destino.clase === "cobro_tienda";
  /** R6 — el catálogo no se pudo leer. Solo bloquea al cobro; los otros cuatro siguen igual. */
  const catalogoCaido = errorTiendas !== undefined;
  const cobroBloqueado = esCobro && catalogoCaido;

  const opcionesTienda: SelectOption[] = (tiendas ?? []).map((t) => ({
    value: t.id,
    label: t.nombre,
  }));

  function placeholderTienda(): string {
    if (catalogoCaido) return TEXTO_COBRO_TIENDA.catalogoCaidoBreve;
    if (cargandoTiendas) return TEXTO_COBRO_TIENDA.cargando;
    return opcionesTienda.length === 0
      ? TEXTO_COBRO_TIENDA.vacio
      : TEXTO_COBRO_TIENDA.placeholder;
  }

  function reset() {
    const hoy = fechaCalendarioCR();
    setConcepto(CONCEPTO_INICIAL);
    setMonto("");
    // R19: el campo arranca en el día calendario EN CURSO de Costa Rica.
    setFecha(hoy);
    setVentana({ min: primerDiaMovimientoAdmisible(), max: hoy });
    setDescripcion("");
    // FICHA 381: la tienda elegida también se limpia. Un cobro heredado de la vez anterior
    // sería el peor de los defectos posibles aquí: dinero cobrado a quien no tocaba.
    setTiendaId("");
    setErrores({});
  }

  function abrir() {
    reset();
    setOpen(true);
  }

  function elegirConcepto(id: string) {
    const siguiente = conceptoPorId(id);
    if (!siguiente) return; // el `Select` solo emite ids del catálogo; esto es la red.
    setConcepto(siguiente);
    // La descripción ya escrita se conserva: cambiar de concepto no borra lo tecleado, solo
    // cambia con qué nombre se pide. El error de descripción sí se limpia (era de otro rótulo),
    // y el de la tienda también: con otro concepto ese campo ni siquiera está en pantalla.
    setErrores((previos) => ({ ...previos, descripcion: undefined, tiendaId: undefined }));
  }

  /** Lo que está mal ANTES de llamar al borde (que re-valida todo, R14/R20/R21). */
  function validar(): ErroresCampo {
    const nuevos: ErroresCampo = {};
    if (!montoValido(monto)) {
      nuevos.monto = "El monto debe ser un número mayor que 0.";
    }
    // Los textos de rechazo son los MISMOS que emite el borde (`problemaDeFechaMovimiento`):
    // el cliente no inventa una segunda redacción de la misma regla.
    const problemaFecha = problemaDeFechaMovimiento(fecha);
    if (problemaFecha !== null) nuevos.fecha = problemaFecha;
    if (descripcion.trim().length === 0) {
      nuevos.descripcion = "La descripción es obligatoria.";
    }
    // FICHA 381 (R7) — sin tienda elegida no se llama al servidor y el fallo se señala bajo SU
    // campo. Es lo mismo que hace el borde con un uuid ausente, dicho antes del viaje.
    if (esCobro && tiendaId === "") {
      nuevos.tiendaId = TEXTO_COBRO_TIENDA.sinElegir;
    }
    return nuevos;
  }

  /**
   * R23 — la fecha SOLO viaja si el usuario eligió un día distinto del de hoy. Sin la clave, el
   * movimiento se fecha con el instante del registro, byte a byte como hasta hoy: ese es todo
   * el coste de la ampliación, y por eso el registro del día en curso sigue encabezando el libro.
   *
   * FICHA 381 (R21): el cobro a una tienda usa la MISMA regla y el mismo campo.
   */
  function fechaAEnviar(): string | undefined {
    return fecha === fechaCalendarioCR() ? undefined : fecha;
  }

  /** El nombre de la tienda elegida, para el aviso de éxito. */
  function nombreTiendaElegida(): string {
    return (tiendas ?? []).find((t) => t.id === tiendaId)?.nombre ?? "la tienda";
  }

  async function registrar(): Promise<ResultadoRegistro> {
    const elegida = fechaAEnviar();
    const comun = {
      monto: monto.trim(),
      descripcion: descripcion.trim(),
      ...(elegida === undefined ? {} : { fecha: elegida }),
    };

    // FICHA 381 — el enrutado sigue siendo por la CLASE del destino, nunca por el id del
    // concepto: un concepto nuevo que olvidara declarar su destino no compila.
    if (concepto.destino.clase === "cobro_tienda") {
      const res = await registrarCobroTiendaAction({ tiendaId, ...comun });
      return res.status === "ok"
        ? {
            status: "ok",
            mensajeExito: TEXTO_COBRO_TIENDA.registrado(nombreTiendaElegida(), res.saldo),
          }
        : res;
    }

    if (concepto.destino.clase === "egreso_administrativo") {
      const res = await registrarEgresoAdministrativoAction({
        tipoEgreso: concepto.destino.tipoEgreso,
        ...comun,
      });
      return res.status === "ok" ? { status: "ok", mensajeExito: MENSAJE_EXITO_CAJA } : res;
    }

    const res = await registrarMovimientoManualAction({
      tipo: concepto.destino.tipo,
      categoria: concepto.destino.categoria,
      ...comun,
    });
    return res.status === "ok" ? { status: "ok", mensajeExito: MENSAJE_EXITO_CAJA } : res;
  }

  async function confirmar() {
    const problemas = validar();
    if (Object.values(problemas).some((mensaje) => mensaje !== undefined)) {
      setErrores(problemas);
      return;
    }

    const result = await registrar();

    if (result.status === "ok") {
      toast.success(result.mensajeExito);
      setOpen(false);
      reset();
      onRegistrado?.(); // R18: el módulo relee libro, cifras y desglose
      router.refresh(); // datos frescos server-side
      return;
    }
    if (result.status === "validation_error") {
      // R10 — lo tecleado NO se toca: solo se pinta el motivo bajo el campo que lo produce.
      setErrores({
        monto: result.fieldErrors.monto?.[0],
        fecha: result.fieldErrors.fecha?.[0],
        descripcion: result.fieldErrors.descripcion?.[0],
        tiendaId: result.fieldErrors.tiendaId?.[0],
      });
      return;
    }
    if (result.status === "forbidden") {
      toast.error("No tenés permiso para registrar movimientos.");
      return;
    }
    // unauthenticated
    toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
  }

  const cabecera = CABECERA_POR_LIBRO[libroDelConcepto(concepto)];

  return (
    <>
      <Button type="button" onClick={abrir}>
        Registrar movimiento
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
        // R4/381 — la cabecera nombra el LIBRO al que va el concepto elegido. «…en la caja»
        // dejaría de ser cierto en cuanto se elige el cobro a una tienda.
        title={cabecera.titulo}
        description={cabecera.descripcion}
        confirmLabel="Registrar"
        // R6 — con el catálogo caído no se deja confirmar un cobro (y solo un cobro).
        confirmDisabled={cobroBloqueado}
        onConfirm={confirmar}
        closeOnConfirm={false}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="movimiento-concepto">Concepto</Label>
            <Select
              id="movimiento-concepto"
              aria-label="Concepto del movimiento"
              aria-describedby="movimiento-concepto-libro"
              value={concepto.id}
              onValueChange={elegirConcepto}
              options={CONCEPTO_MANUAL_OPTIONS}
            />
            {/* R4: en qué libro cae y con qué nombre aparecerá el movimiento, para que nadie
                tenga que registrarlo primero y buscarlo después para averiguarlo. */}
            <p id="movimiento-concepto-libro" className="text-sm text-muted-foreground">
              {fraseDelLibro(concepto)}
            </p>
          </div>

          {/* R2/R3 — el campo de la tienda existe SOLO para el cobro. Con los otros cuatro
              conceptos no se monta, y por tanto no hay forma de que su valor viaje. */}
          {esCobro ? (
            <FormField
              id="movimiento-tienda"
              label={TEXTO_COBRO_TIENDA.label}
              error={errores.tiendaId}
              hint={TEXTO_COBRO_TIENDA.hint}
            >
              {(control) => (
                <>
                  {/* `Select` no acepta `aria-required`, así que se cablea a mano lo que sí:
                      el id que casa con el `Label`, la invalidez y el descriptor del error. */}
                  <Select
                    id={control.id}
                    aria-invalid={control["aria-invalid"]}
                    aria-describedby={control["aria-describedby"]}
                    aria-label={TEXTO_COBRO_TIENDA.label}
                    value={tiendaId}
                    onValueChange={(v) => {
                      setTiendaId(v);
                      if (errores.tiendaId) setErrores((p) => ({ ...p, tiendaId: undefined }));
                    }}
                    options={opcionesTienda}
                    disabled={catalogoCaido || cargandoTiendas}
                    placeholder={placeholderTienda()}
                  />
                  {/* R6 — se DICE que el catálogo no llegó. El `Select` deshabilitado solo se
                      ve; el aviso además se anuncia. */}
                  {catalogoCaido ? (
                    <p role="alert" className="mt-1.5 text-sm text-destructive">
                      {TEXTO_COBRO_TIENDA.catalogoCaido}
                    </p>
                  ) : null}
                </>
              )}
            </FormField>
          ) : null}

          <FormField id="movimiento-monto" label="Monto" error={errores.monto}>
            {(control) => (
              <Input
                {...control}
                aria-required="true"
                inputMode="decimal"
                value={monto}
                onChange={(e) => {
                  setMonto(e.target.value);
                  if (errores.monto) setErrores((p) => ({ ...p, monto: undefined }));
                }}
                placeholder="0.00"
              />
            )}
          </FormField>

          <FormField
            id="movimiento-fecha"
            label="Fecha"
            error={errores.fecha}
            hint="Poné el día en que ocurrió. Podés elegir un día anterior si lo estás registrando después."
          >
            {(control) => (
              <Input
                {...control}
                aria-required="true"
                type="date"
                value={fecha}
                min={ventana.min}
                max={ventana.max}
                onChange={(e) => {
                  setFecha(e.target.value);
                  if (errores.fecha) setErrores((p) => ({ ...p, fecha: undefined }));
                }}
              />
            )}
          </FormField>

          <FormField
            id="movimiento-descripcion"
            label={concepto.descripcionLabel}
            error={errores.descripcion}
          >
            {(control) => (
              <textarea
                {...control}
                aria-required="true"
                aria-label={concepto.descripcionLabel}
                value={descripcion}
                onChange={(e) => {
                  setDescripcion(e.target.value);
                  if (errores.descripcion)
                    setErrores((p) => ({ ...p, descripcion: undefined }));
                }}
                rows={3}
                placeholder={concepto.descripcionPlaceholder}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            )}
          </FormField>
        </div>
      </Modal>
    </>
  );
}
