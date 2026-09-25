"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select, type SelectOption } from "@/components/ui/select";
import { FormField } from "@/components/shared/FormField";
import { Modal } from "@/components/shared/Modal";
import { METODO_LIQUIDACION_OPTIONS } from "@/components/shared/liquidacion/liquidacion-labels";
import { useToast } from "@/hooks/useToast";
import { registrarMovimientoManualAction } from "@/lib/actions/wallet";
import { registrarEgresoAdministrativoAction } from "@/lib/actions/wallet-egresos";
import { registrarCobroTiendaAction } from "@/lib/actions/wallet-tienda";
import { registrarPagoPorCuentaTiendaAction } from "@/lib/actions/pago-por-cuenta-tienda";
import { registrarAporteCapitalAction } from "@/lib/actions/aporte-capital";
import { listarAdminTiendas } from "@/lib/actions/usuarios-por-rol";
import { money } from "@/lib/config/moneda";
import { WALLET_COMPROBANTE_MIME } from "@/lib/config/wallet-comprobante";
import { primerDiaMovimientoAdmisible, problemaDeFechaMovimiento } from "@/lib/types/wallet";
import type { UsuarioPorRolDTO } from "@/lib/types/usuario-por-rol";
import type { SaldoTiendaDTO } from "@/lib/types/wallet-tienda";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

import { SALDO_SIGNO_LABEL } from "../tiendas/_components/saldo-tienda-signo-label";
import {
  CABECERA_POR_LIBRO,
  CONCEPTO_MANUAL_OPTIONS,
  CONCEPTOS_MANUALES,
  FRASE_DEL_EFECTO,
  conceptoPorId,
  fraseDelLibro,
  libroDelConcepto,
  type ConceptoManual,
} from "./wallet-conceptos-manuales";
import { montoValido } from "./wallet-labels";

// Ficha 334 (T D3, design §10) — el ÚNICO control para mover dinero a mano en la caja
// principal. Sustituye a los dos diálogos que había, que pedían lo mismo con dos vocabularios
// distintos y obligaban a adivinar cuál abrir.
//
// Se unifica la INTERFAZ, no el backend (design §6): el concepto elegido decide a qué Server
// Action va el registro, porque cada concepto escribe `origen_tipo` distinto y de ese campo
// cuelga qué movimiento se puede reversar.
//
// FICHA 381 (T H.2, design §8) — «Cobrar un costo a una tienda» no escribe en la caja, sino en
// el libro de esa tienda, y por eso pide UN campo más. El campo de la tienda es CONDICIONAL
// (R2/R3), el payload del cobro lleva SOLO lo que el usuario decide y no hay rama de «saldo
// insuficiente» (R27 de la 381).
//
// FICHA 459 (T B.15, design §9) — DOS conceptos más, y el selector agrupado por lo que le pasa a
// la caja (R59). Bajo el selector, una frase dice qué le pasa a la caja, al saldo de la tienda y a
// la ganancia con el concepto elegido (R60): el pago por cuenta dice que SALE dinero de la caja y
// el cobro de un costo dice que NO. Tres propiedades que son requisito:
//
//  - **Cada concepto manda SOLO sus claves** (R61): el `FormData` del pago por cuenta y el del
//    saldo inicial o aporte se arman campo a campo; el payload del cobro no gana ni una (R64).
//  - **El monto del saldo inicial arranca VACÍO y así se queda hasta que una persona lo teclea**
//    (R27, HF4): la app no propone, no calcula, no sugiere ni rellena ningún importe.
//  - **El saldo que devuelve el servidor se pinta tal cual**, con su signo (R63): un pago por
//    cuenta que deja a la tienda en contra se anuncia en contra, y se dice que la tienda le debe
//    ese dinero a Ordenex.
//
// Money-safe (R15 de la 334 / R28 de la 459): el monto viaja como STRING de punta a punta y NUNCA
// se convierte a punto flotante en este archivo; el borde lo re-valida con aritmetica decimal.
// Mutación interna por Server Action (NO fetch a /api).

/** El concepto que el diálogo trae elegido al abrirse: el primero del catálogo. */
const CONCEPTO_INICIAL: ConceptoManual = CONCEPTOS_MANUALES[0];

/** Clave SWR del catálogo de tiendas destinatarias (R5 de la 381). */
const SWR_KEY_TIENDAS_COBRO = "wallet:registrar-movimiento:tiendas";

/**
 * FICHA 381 — los textos del cobro a una tienda, agrupados para que una futura pasada de i18n
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
   * y la marca legible que el propio servidor derivó.
   */
  registrado: (tienda: string, saldo: SaldoTiendaDTO) =>
    `Cobro registrado. El saldo de ${tienda} queda en ${money(saldo.saldo)} · ${SALDO_SIGNO_LABEL[saldo.signo]}.`,
} as const;

/** FICHA 459 (design §9.3) — los textos del pago por cuenta de una tienda. */
const TEXTO_PAGO_POR_CUENTA = {
  tienda: "Tienda por la que se paga",
  sinTienda: "Elegí la tienda por la que se paga.",
  catalogoCaido:
    "No se pudo cargar la lista de tiendas, así que no se puede registrar un pago por cuenta ahora mismo. Cerrá y volvé a abrir para reintentarlo; los otros conceptos siguen funcionando.",
  /** R62 — antes de confirmar, sin comparar nada: es una frase fija. */
  pistaSaldo:
    "Si la tienda no tiene saldo suficiente, su saldo queda en contra: ella le deberá ese dinero a Ordenex.",
  beneficiario: "A quién se le pagó",
  beneficiarioPlaceholder: "Ej. Facebook, Jet Cargo, nombre de la persona",
  sinBeneficiario: "Escribí a quién se le pagó.",
  metodo: "Método de pago",
  metodoPlaceholder: "Elegí el método",
  sinMetodo: "Elegí el método de pago.",
  referencia: "Referencia",
  referenciaHint: "Obligatoria en SINPE y transferencia.",
  sinReferencia: "La referencia es obligatoria en SINPE y transferencia.",
  /**
   * R63 — el saldo que devolvió el SERVIDOR, con su signo; y si quedó en contra, en palabras.
   * El «en contra» lo dice el `signo` que manda el servidor: aquí no se compara ningún importe.
   */
  registrado: (tienda: string, saldo: SaldoTiendaDTO) =>
    `Pago registrado. El saldo de ${tienda} queda en ${money(saldo.saldo)} · ${SALDO_SIGNO_LABEL[saldo.signo]}.` +
    (saldo.signo === "negativo" ? " La tienda le debe ese dinero a Ordenex." : ""),
} as const;

/** FICHA 459 (design §9.3) — los textos del saldo inicial o aporte de capital. */
const TEXTO_APORTE = {
  clase: "Qué es",
  sinClase: "Elegí si es el saldo inicial o un aporte de capital.",
  clases: [
    {
      value: "saldo_inicial",
      label:
        "Saldo inicial — el dinero que Ordenex tenía al empezar a usar la app. Solo puede haber uno.",
    },
    { value: "aporte", label: "Aporte de capital — dinero de Ordenex que entra después." },
  ],
  nombreClase: { saldo_inicial: "Saldo inicial", aporte: "Aporte de capital" },
  /** R70 — ya hay un saldo inicial vigente. */
  yaHaySaldoInicial:
    "Ya hay un saldo inicial registrado y solo puede haber uno. Si hay que cambiarlo, anulá el vigente desde el libro de la caja.",
  registrado: (clase: "saldo_inicial" | "aporte", monto: string) =>
    `Registrado. ${TEXTO_APORTE.nombreClase[clase]} de ${money(monto)}.`,
} as const;

/** FICHA 459 (R54/R56) — el comprobante, opcional. */
const TEXTO_COMPROBANTE = {
  label: "Comprobante (opcional)",
  hint: "Imagen JPEG, PNG o WebP, o un PDF, de hasta 4 MB.",
  noGuardado: "No se pudo guardar el comprobante, así que no se registró nada. Probá de nuevo.",
} as const;

/** El aviso de éxito de los CUATRO conceptos de la caja de la ficha 334, byte a byte (R11). */
const MENSAJE_EXITO_CAJA = "Movimiento registrado correctamente.";

interface ErroresCampo {
  monto?: string;
  fecha?: string;
  descripcion?: string;
  /** FICHA 381 (R7/R10): el campo de la tienda tiene su propio error, del cliente o del borde. */
  tiendaId?: string;
  /** FICHA 459: los campos del pago por cuenta y del saldo inicial o aporte. */
  beneficiario?: string;
  metodo?: string;
  referencia?: string;
  comprobante?: string;
  clase?: string;
}

/**
 * Lo que `registrar()` le devuelve a `confirmar()`, ya normalizado: las actions tienen resultados
 * distintos y el diálogo solo necesita saber si salió bien, con qué frase avisarlo, qué campo
 * señalar o qué aviso general pintar.
 */
type ResultadoRegistro =
  | { status: "ok"; mensajeExito: string }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "aviso"; mensaje: string }
  | { status: "forbidden" }
  | { status: "unauthenticated" };

/**
 * FICHA 381 (R5) — las tiendas que pueden recibir un cobro (y, desde la 459, un pago por cuenta).
 * Reusa `listarAdminTiendas`, que ya autoriza y proyecta id/nombre de las cuentas de tienda
 * ACTIVAS ordenadas por nombre. El fallo se propaga a propósito (R6).
 */
async function cargarTiendas(): Promise<UsuarioPorRolDTO[]> {
  const res = await listarAdminTiendas();
  if (res.status !== "ok") throw new Error(res.status);
  return res.usuarios;
}

/** Una clave nueva por apertura del diálogo (R41/R73): el doble clic no registra dos veces. */
function nuevaClave(): string {
  return crypto.randomUUID();
}

export interface RegistrarMovimientoCajaDialogProps {
  /** Callback opcional para que el módulo recargue su vista (libro + cifras + desglose, R18/R65). */
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
  // FICHA 459 — los campos propios del pago por cuenta y del saldo inicial o aporte.
  const [beneficiario, setBeneficiario] = useState("");
  const [metodo, setMetodo] = useState("");
  const [referencia, setReferencia] = useState("");
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [clase, setClase] = useState("");
  const [clave, setClave] = useState("");
  const [avisoGeneral, setAvisoGeneral] = useState<string | null>(null);
  const [errores, setErrores] = useState<ErroresCampo>({});
  // La ventana admisible se congela AL ABRIR y no se recalcula en cada render.
  const [ventana, setVentana] = useState({ min: "", max: "" });

  // R5 de la 381 — el catálogo se pide AL ABRIR el diálogo y no antes.
  const {
    data: tiendas,
    error: errorTiendas,
    isLoading: cargandoTiendas,
  } = useSWR(open ? SWR_KEY_TIENDAS_COBRO : null, cargarTiendas, {
    shouldRetryOnError: false,
  });

  const claseDestino = concepto.destino.clase;
  const esCobro = claseDestino === "cobro_tienda";
  const esPagoPorCuenta = claseDestino === "pago_por_cuenta_tienda";
  const esAporte = claseDestino === "aporte_capital";
  /** Los dos conceptos que eligen una tienda. */
  const pideTienda = esCobro || esPagoPorCuenta;
  /** R6 de la 381 — el catálogo no se pudo leer. Solo bloquea a los conceptos que lo usan. */
  const catalogoCaido = errorTiendas !== undefined;
  const conceptoBloqueado = pideTienda && catalogoCaido;
  /** R34 — la referencia se pide solo con SINPE y transferencia. */
  const pideReferencia = esPagoPorCuenta && metodo !== "" && metodo !== "efectivo";

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
    // R27 (459): el monto arranca VACÍO para TODOS los conceptos, y ningún camino lo rellena.
    setMonto("");
    // R19: el campo arranca en el día calendario EN CURSO de Costa Rica.
    setFecha(hoy);
    setVentana({ min: primerDiaMovimientoAdmisible(), max: hoy });
    setDescripcion("");
    // FICHA 381: la tienda elegida también se limpia: un cobro heredado de la vez anterior sería
    // dinero cobrado a quien no tocaba. Lo mismo vale para un pago por cuenta.
    setTiendaId("");
    setBeneficiario("");
    setMetodo("");
    setReferencia("");
    setComprobante(null);
    setClase("");
    setClave(nuevaClave());
    setAvisoGeneral(null);
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
    // La descripción ya escrita se conserva; los errores de los campos que cambian o desaparecen
    // se limpian (eran de otro rótulo o de un campo que ya no está en pantalla).
    setAvisoGeneral(null);
    setErrores((previos) => ({
      ...previos,
      descripcion: undefined,
      tiendaId: undefined,
      beneficiario: undefined,
      metodo: undefined,
      referencia: undefined,
      comprobante: undefined,
      clase: undefined,
    }));
  }

  /** Lo que está mal ANTES de llamar al borde (que re-valida todo). */
  function validar(): ErroresCampo {
    const nuevos: ErroresCampo = {};
    if (!montoValido(monto)) {
      nuevos.monto = "El monto debe ser un número mayor que 0.";
    }
    if (esAporte) {
      // P7: el saldo inicial o aporte NO tiene ventana hacia atrás; solo no puede ser futuro. El
      // tope del saldo inicial contra el primer día de la caja lo aplica el servidor (R71).
      if (fecha === "") nuevos.fecha = "Elegí la fecha.";
      else if (fecha > fechaCalendarioCR()) nuevos.fecha = "La fecha no puede ser posterior a hoy.";
      if (clase === "") nuevos.clase = TEXTO_APORTE.sinClase;
    } else {
      // Los textos de rechazo son los MISMOS que emite el borde (`problemaDeFechaMovimiento`).
      const problemaFecha = problemaDeFechaMovimiento(fecha);
      if (problemaFecha !== null) nuevos.fecha = problemaFecha;
    }
    if (descripcion.trim().length === 0) {
      nuevos.descripcion =
        esPagoPorCuenta || esAporte ? "El motivo es obligatorio." : "La descripción es obligatoria.";
    }
    if (esCobro && tiendaId === "") nuevos.tiendaId = TEXTO_COBRO_TIENDA.sinElegir;
    if (esPagoPorCuenta) {
      if (tiendaId === "") nuevos.tiendaId = TEXTO_PAGO_POR_CUENTA.sinTienda;
      if (beneficiario.trim().length === 0) {
        nuevos.beneficiario = TEXTO_PAGO_POR_CUENTA.sinBeneficiario;
      }
      if (metodo === "") nuevos.metodo = TEXTO_PAGO_POR_CUENTA.sinMetodo;
      if (pideReferencia && referencia.trim().length === 0) {
        nuevos.referencia = TEXTO_PAGO_POR_CUENTA.sinReferencia;
      }
    }
    return nuevos;
  }

  /**
   * R23 de la 334 — la fecha SOLO viaja si el usuario eligió un día distinto del de hoy. Vale para
   * los cuatro conceptos de la 334, el cobro de la 381 y el pago por cuenta de la 459. El saldo
   * inicial o aporte la manda SIEMPRE: su schema la exige.
   */
  function fechaAEnviar(): string | undefined {
    return fecha === fechaCalendarioCR() ? undefined : fecha;
  }

  /** El nombre de la tienda elegida, para el aviso de éxito del cobro. */
  function nombreTiendaElegida(): string {
    return (tiendas ?? []).find((t) => t.id === tiendaId)?.nombre ?? "la tienda";
  }

  /** FICHA 459 (R61) — el `FormData` del pago por cuenta, SOLO con sus claves. */
  function formDataPagoPorCuenta(): FormData {
    const fd = new FormData();
    fd.set("claveIdempotencia", clave);
    fd.set("tiendaId", tiendaId);
    fd.set("beneficiario", beneficiario.trim());
    fd.set("monto", monto.trim());
    fd.set("metodo", metodo);
    if (pideReferencia) fd.set("referencia", referencia.trim());
    fd.set("motivo", descripcion.trim());
    const elegida = fechaAEnviar();
    if (elegida !== undefined) fd.set("fecha", elegida);
    if (comprobante !== null) fd.set("comprobante", comprobante);
    return fd;
  }

  /** FICHA 459 (R68/R69) — el `FormData` del saldo inicial o aporte, SOLO con sus claves. */
  function formDataAporte(): FormData {
    const fd = new FormData();
    fd.set("claveIdempotencia", clave);
    fd.set("clase", clase);
    fd.set("monto", monto.trim());
    fd.set("fecha", fecha);
    fd.set("motivo", descripcion.trim());
    if (comprobante !== null) fd.set("comprobante", comprobante);
    return fd;
  }

  async function registrar(): Promise<ResultadoRegistro> {
    // El enrutado sigue siendo por la CLASE del destino, nunca por el id del concepto.
    const destino = concepto.destino;

    if (destino.clase === "pago_por_cuenta_tienda") {
      const res = await registrarPagoPorCuentaTiendaAction(formDataPagoPorCuenta());
      if (res.status === "ok" || res.status === "ya_registrado") {
        return {
          status: "ok",
          mensajeExito: TEXTO_PAGO_POR_CUENTA.registrado(res.pago.tiendaNombre, res.saldo),
        };
      }
      if (res.status === "comprobante_no_guardado") {
        return { status: "aviso", mensaje: TEXTO_COMPROBANTE.noGuardado };
      }
      return res;
    }

    if (destino.clase === "aporte_capital") {
      const res = await registrarAporteCapitalAction(formDataAporte());
      if (res.status === "ok" || res.status === "ya_registrado") {
        return {
          status: "ok",
          mensajeExito: TEXTO_APORTE.registrado(res.aporte.clase, res.aporte.monto),
        };
      }
      if (res.status === "ya_hay_saldo_inicial") {
        return { status: "validation_error", fieldErrors: { clase: [TEXTO_APORTE.yaHaySaldoInicial] } };
      }
      if (res.status === "comprobante_no_guardado") {
        return { status: "aviso", mensaje: TEXTO_COMPROBANTE.noGuardado };
      }
      return res;
    }

    const elegida = fechaAEnviar();
    const comun = {
      // Ficha 461 (R66): la misma clave por apertura, como el pago de un gasto y el aporte.
      claveIdempotencia: clave,
      monto: monto.trim(),
      descripcion: descripcion.trim(),
      ...(elegida === undefined ? {} : { fecha: elegida }),
    };

    if (destino.clase === "cobro_tienda") {
      const res = await registrarCobroTiendaAction({ tiendaId, ...comun });
      // Ficha 461 (R68): `ya_registrado` = el doble envio devolvio el cobro original; es un exito.
      return res.status === "ok" || res.status === "ya_registrado"
        ? {
            status: "ok",
            mensajeExito: TEXTO_COBRO_TIENDA.registrado(nombreTiendaElegida(), res.saldo),
          }
        : res;
    }

    if (destino.clase === "egreso_administrativo") {
      const res = await registrarEgresoAdministrativoAction({
        tipoEgreso: destino.tipoEgreso,
        ...comun,
      });
      return res.status === "ok" || res.status === "ya_registrado"
        ? { status: "ok", mensajeExito: MENSAJE_EXITO_CAJA }
        : res;
    }

    const res = await registrarMovimientoManualAction({
      tipo: destino.tipo,
      categoria: destino.categoria,
      ...comun,
    });
    return res.status === "ok" || res.status === "ya_registrado"
      ? { status: "ok", mensajeExito: MENSAJE_EXITO_CAJA }
      : res;
  }

  async function confirmar() {
    const problemas = validar();
    if (Object.values(problemas).some((mensaje) => mensaje !== undefined)) {
      setErrores(problemas);
      return;
    }

    setAvisoGeneral(null);
    const result = await registrar();

    if (result.status === "ok") {
      toast.success(result.mensajeExito);
      setOpen(false);
      reset();
      onRegistrado?.(); // R18/R65: el módulo relee libro, cifras y composición
      router.refresh(); // datos frescos server-side
      return;
    }
    if (result.status === "validation_error") {
      // R10 — lo tecleado NO se toca: solo se pinta el motivo bajo el campo que lo produce. El
      // motivo del pago por cuenta y del aporte viaja como `motivo` y se pinta bajo el mismo campo.
      const f = result.fieldErrors;
      setErrores({
        monto: f.monto?.[0],
        fecha: f.fecha?.[0],
        descripcion: f.descripcion?.[0] ?? f.motivo?.[0],
        tiendaId: f.tiendaId?.[0],
        beneficiario: f.beneficiario?.[0],
        metodo: f.metodo?.[0],
        referencia: f.referencia?.[0],
        comprobante: f.comprobante?.[0],
        clase: f.clase?.[0],
      });
      return;
    }
    if (result.status === "aviso") {
      setAvisoGeneral(result.mensaje);
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
        // R4/381 — la cabecera nombra el LIBRO al que va el concepto elegido.
        title={cabecera.titulo}
        description={cabecera.descripcion}
        confirmLabel="Registrar"
        // R6 de la 381 — con el catálogo caído no se deja confirmar un concepto que lo necesita.
        confirmDisabled={conceptoBloqueado}
        onConfirm={confirmar}
        closeOnConfirm={false}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="movimiento-concepto">Concepto</Label>
            <Select
              id="movimiento-concepto"
              aria-label="Concepto del movimiento"
              aria-describedby="movimiento-concepto-efecto movimiento-concepto-libro"
              value={concepto.id}
              onValueChange={elegirConcepto}
              options={CONCEPTO_MANUAL_OPTIONS}
            />
            {/* R60 (459): qué le pasa a la caja, a la tienda y a la ganancia. */}
            <p id="movimiento-concepto-efecto" className="text-sm font-medium text-foreground">
              {FRASE_DEL_EFECTO[concepto.id]}
            </p>
            {/* R4: en qué libro cae y con qué nombre aparecerá el movimiento. */}
            <p id="movimiento-concepto-libro" className="text-sm text-muted-foreground">
              {fraseDelLibro(concepto)}
            </p>
          </div>

          {avisoGeneral === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {avisoGeneral}
            </p>
          )}

          {/* R2/R3 de la 381 y R61 de la 459 — el campo de la tienda existe SOLO para los dos
              conceptos que la eligen. Con los otros no se monta y su valor no puede viajar. */}
          {pideTienda ? (
            <FormField
              id="movimiento-tienda"
              label={esCobro ? TEXTO_COBRO_TIENDA.label : TEXTO_PAGO_POR_CUENTA.tienda}
              error={errores.tiendaId}
              hint={esCobro ? TEXTO_COBRO_TIENDA.hint : TEXTO_PAGO_POR_CUENTA.pistaSaldo}
            >
              {(control) => (
                <>
                  {/* `Select` no acepta `aria-required`, así que se cablea a mano lo que sí. */}
                  <Select
                    id={control.id}
                    aria-invalid={control["aria-invalid"]}
                    aria-describedby={control["aria-describedby"]}
                    aria-label={esCobro ? TEXTO_COBRO_TIENDA.label : TEXTO_PAGO_POR_CUENTA.tienda}
                    value={tiendaId}
                    onValueChange={(v) => {
                      setTiendaId(v);
                      if (errores.tiendaId) setErrores((p) => ({ ...p, tiendaId: undefined }));
                    }}
                    options={opcionesTienda}
                    disabled={catalogoCaido || cargandoTiendas}
                    placeholder={placeholderTienda()}
                  />
                  {catalogoCaido ? (
                    <p role="alert" className="mt-1.5 text-sm text-destructive">
                      {esCobro
                        ? TEXTO_COBRO_TIENDA.catalogoCaido
                        : TEXTO_PAGO_POR_CUENTA.catalogoCaido}
                    </p>
                  ) : null}
                </>
              )}
            </FormField>
          ) : null}

          {esPagoPorCuenta ? (
            <FormField
              id="movimiento-beneficiario"
              label={TEXTO_PAGO_POR_CUENTA.beneficiario}
              error={errores.beneficiario}
              required
            >
              {(control) => (
                <Input
                  {...control}
                  value={beneficiario}
                  maxLength={120}
                  onChange={(e) => {
                    setBeneficiario(e.target.value);
                    if (errores.beneficiario)
                      setErrores((p) => ({ ...p, beneficiario: undefined }));
                  }}
                  placeholder={TEXTO_PAGO_POR_CUENTA.beneficiarioPlaceholder}
                />
              )}
            </FormField>
          ) : null}

          {/* FICHA 459 (design §9.3): la clase del saldo inicial o aporte, con su explicación. */}
          {esAporte ? (
            <FormField id="movimiento-clase" label={TEXTO_APORTE.clase} error={errores.clase} required>
              {(control) => (
                <RadioGroup
                  aria-label={TEXTO_APORTE.clase}
                  aria-invalid={control["aria-invalid"]}
                  value={clase}
                  onValueChange={(v) => {
                    setClase(v);
                    if (errores.clase) setErrores((p) => ({ ...p, clase: undefined }));
                  }}
                  options={TEXTO_APORTE.clases}
                />
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
                // R27 (459): en el saldo inicial o aporte ni siquiera un ejemplo de importe.
                placeholder={esAporte ? undefined : "0.00"}
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
                // P7 (459): el saldo inicial o aporte no tiene ventana hacia atrás.
                min={esAporte ? undefined : ventana.min}
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

          {esPagoPorCuenta ? (
            <FormField
              id="movimiento-metodo"
              label={TEXTO_PAGO_POR_CUENTA.metodo}
              error={errores.metodo}
              required
            >
              {(control) => (
                <Select
                  id={control.id}
                  aria-invalid={control["aria-invalid"]}
                  aria-describedby={control["aria-describedby"]}
                  aria-label={TEXTO_PAGO_POR_CUENTA.metodo}
                  value={metodo}
                  onValueChange={(v) => {
                    setMetodo(v);
                    setErrores((p) => ({ ...p, metodo: undefined, referencia: undefined }));
                  }}
                  options={METODO_LIQUIDACION_OPTIONS}
                  placeholder={TEXTO_PAGO_POR_CUENTA.metodoPlaceholder}
                />
              )}
            </FormField>
          ) : null}

          {/* R34 — la referencia se ve y se exige solo con SINPE o transferencia. */}
          {pideReferencia ? (
            <FormField
              id="movimiento-referencia"
              label={TEXTO_PAGO_POR_CUENTA.referencia}
              hint={TEXTO_PAGO_POR_CUENTA.referenciaHint}
              error={errores.referencia}
              required
            >
              {(control) => (
                <Input
                  {...control}
                  value={referencia}
                  maxLength={60}
                  onChange={(e) => {
                    setReferencia(e.target.value);
                    if (errores.referencia) setErrores((p) => ({ ...p, referencia: undefined }));
                  }}
                />
              )}
            </FormField>
          ) : null}

          {/* R54 — el comprobante es OPCIONAL (H1 de la 458). */}
          {esPagoPorCuenta || esAporte ? (
            <FormField
              id="movimiento-comprobante"
              label={TEXTO_COMPROBANTE.label}
              hint={TEXTO_COMPROBANTE.hint}
              error={errores.comprobante}
            >
              {(control) => (
                <Input
                  {...control}
                  type="file"
                  accept={WALLET_COMPROBANTE_MIME.join(",")}
                  onChange={(e) => {
                    setComprobante(e.target.files?.[0] ?? null);
                    if (errores.comprobante) setErrores((p) => ({ ...p, comprobante: undefined }));
                  }}
                />
              )}
            </FormField>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
