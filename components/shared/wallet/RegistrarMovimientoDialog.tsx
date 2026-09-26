"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/shared/FormField";
import { Modal } from "@/components/shared/Modal";
import { SelectorBuscable, type SelectorBuscableEstado } from "@/components/shared/SelectorBuscable";
import { METODO_LIQUIDACION_OPTIONS } from "@/components/shared/liquidacion/liquidacion-labels";
import { montoValido } from "@/components/shared/monto-cliente";
import { useToast } from "@/hooks/useToast";
import { registrarAbonoTiendaAction } from "@/lib/actions/abono-tienda";
import { registrarAporteCapitalAction } from "@/lib/actions/aporte-capital";
import { registrarPagoTiendaAction, registrarRepartoMensajeroAction } from "@/lib/actions/liquidacion";
import { registrarPagoPorCuentaTiendaAction } from "@/lib/actions/pago-por-cuenta-tienda";
import { listarAdminTiendas, listarUsuariosPorRol } from "@/lib/actions/usuarios-por-rol";
import { registrarMovimientoManualAction } from "@/lib/actions/wallet";
import { registrarEgresoAdministrativoAction } from "@/lib/actions/wallet-egresos";
import { registrarCobroTiendaAction } from "@/lib/actions/wallet-tienda";
import { primerDiaMovimientoAdmisible, problemaDeFechaMovimiento } from "@/lib/types/wallet";
import type { UsuarioPorRolDTO } from "@/lib/types/usuario-por-rol";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

import {
  CLAVE_DE_LA_CUENTA,
  CONCEPTOS_MANUALES,
  CONCEPTO_REGISTRO_DE,
  FRASE_DEL_EFECTO,
  GRUPO_CONCEPTO_LABEL,
  aQuienDelConcepto,
  cabeceraDelConcepto,
  conceptoPorId,
  cuentaDelConcepto,
  fraseDelLibro,
  type ConceptoManual,
  type ConceptoManualId,
  type GrupoConcepto,
} from "@/app/(app)/wallet/_components/wallet-conceptos-manuales";

import { AsiQueda, type PeticionAsiQueda } from "./AsiQueda";
import { ComprobanteCampo } from "./ComprobanteCampo";
import {
  APORTE_TEXTO,
  CAMPO_TEXTO,
  COMPROBANTE_CAMPO_TEXTO,
  CUENTA_TEXTO,
  PAGO_TEXTO,
  PISTA_CUENTA,
  REGISTRAR_MOVIMIENTO_TEXTO,
  RESPUESTA_TEXTO,
} from "./registrar-movimiento-labels";

// FICHA 458-C (T C.1–C.3, design §4.1/§4.4/§5.1, R37–R52, R74–R76) — el diálogo ÚNICO «Registrar un
// movimiento». Sustituye a `RegistrarMovimientoCajaDialog` (334/381/459/461/457): el catálogo de los
// DIEZ conceptos a la izquierda en los tres grupos de la 461, el formulario del concepto a la derecha
// y «Así queda» debajo (en móvil, el catálogo arriba como lista).
//
// Se unifica la INTERFAZ, no el backend (la 334 lo decidió: `origen_tipo` decide qué se anula). El
// concepto elegido decide a qué Server Action va el registro, y cada una recibe un `FormData` con
// SOLO sus claves (R39): lo que no pertenece a su camino no viaja, y el `.strict()` del borde lo
// rechazaría si viajara.
//
// Reglas que este archivo hace cumplir y que son requisito:
//  - R51: la clave de idempotencia se genera AL ABRIR y viaja en TODOS los conceptos.
//  - R42 (D5): «a quién» es obligatorio en sueldo y gasto de Ordenex, opcional en la corrección.
//  - R27 (459): el monto arranca VACÍO y solo cambia por lo que teclea la persona.
//  - R49: un rechazo de validación conserva lo escrito y pinta el motivo bajo SU campo.
//  - R48: el aviso de éxito lleva el saldo o la cifra que devolvió el SERVIDOR, tal cual.
//  - R90: ni `Number(` ni `parseFloat(`: el monto es un STRING de punta a punta; «Así queda» lo
//    calcula el servidor.
// Mutación interna por Server Action (NO fetch a /api). Los datos de la cuenta se piden AL ABRIR.

/** Una clave nueva por apertura del diálogo (R51): el doble clic no registra dos veces. */
function nuevaClave(): string {
  return crypto.randomUUID();
}

/** Los tres grupos, en orden, con sus conceptos (tramos consecutivos del catálogo). */
const GRUPOS: readonly GrupoConcepto[] = ["sale", "entra", "descuenta"];

const CLAVE_TIENDAS = "wallet:registrar-movimiento:tiendas";
const CLAVE_MENSAJEROS = "wallet:registrar-movimiento:mensajeros";

async function cargarTiendas(): Promise<UsuarioPorRolDTO[]> {
  const res = await listarAdminTiendas();
  if (res.status !== "ok") throw new Error(res.status);
  return res.usuarios;
}

async function cargarMensajeros(): Promise<UsuarioPorRolDTO[]> {
  const res = await listarUsuariosPorRol("mensajero");
  if (res.status !== "ok") throw new Error(res.status);
  return res.usuarios;
}

interface ErroresCampo {
  monto?: string;
  fecha?: string;
  descripcion?: string;
  cuenta?: string;
  aQuien?: string;
  beneficiario?: string;
  metodo?: string;
  referencia?: string;
  comprobante?: string;
  clase?: string;
}

/** Lo que `registrar()` le devuelve a `confirmar()`, ya normalizado. */
type ResultadoRegistro =
  | { status: "ok"; mensajeExito: string }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "aviso"; mensaje: string }
  | { status: "forbidden" }
  | { status: "unauthenticated" };

/** Los estados que las diez actions comparten y se tratan igual. */
function comun(res: { status: string; fieldErrors?: Record<string, string[]> }): ResultadoRegistro {
  switch (res.status) {
    case "validation_error":
      return { status: "validation_error", fieldErrors: res.fieldErrors ?? {} };
    case "comprobante_no_guardado":
      return { status: "aviso", mensaje: COMPROBANTE_CAMPO_TEXTO.noGuardado };
    case "forbidden":
      return { status: "forbidden" };
    case "unauthenticated":
      return { status: "unauthenticated" };
    case "no_encontrado":
      return { status: "aviso", mensaje: RESPUESTA_TEXTO.noEncontrado };
    default:
      // Un estado que el diálogo no conoce no se da por bueno ni se calla.
      throw new Error(`registrar-movimiento: estado inesperado ${res.status}`);
  }
}

export interface RegistrarMovimientoDialogProps {
  /** Tras registrar: el módulo relee lo suyo (libro, cifras, composición, desglose; R48/R60). */
  onRegistrado?: () => void;
  /** R40: el concepto con el que se abre. Defecto: el primero del catálogo. */
  conceptoInicial?: ConceptoManualId;
  /**
   * R40 (457 D8): la cuenta, FIJA. Con ella el concepto no se puede cambiar, la cuenta se muestra
   * por su nombre y no se pide ninguna lista.
   */
  cuentaFija?: { readonly id: string; readonly nombre: string };
  /** El texto del botón que abre el diálogo. Defecto: «Registrar un movimiento». */
  etiquetaBoton?: string;
  /** R37: el enlace a las plantillas de gasto fijo. */
  hrefPlantillas?: string;
}

export function RegistrarMovimientoDialog({
  onRegistrado,
  conceptoInicial,
  cuentaFija,
  etiquetaBoton,
  hrefPlantillas = "/wallet#gastos-fijos",
}: RegistrarMovimientoDialogProps) {
  const conceptoDeApertura: ConceptoManual =
    (conceptoInicial === undefined ? undefined : conceptoPorId(conceptoInicial)) ?? CONCEPTOS_MANUALES[0];
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [concepto, setConcepto] = useState<ConceptoManual>(conceptoDeApertura);
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [cuentaId, setCuentaId] = useState<string | null>(null);
  const [aQuien, setAQuien] = useState("");
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

  const clase_ = concepto.destino.clase;
  const cuenta = cuentaDelConcepto(concepto);
  const aQuienPide = aQuienDelConcepto(concepto);
  const esPagoPorCuenta = clase_ === "pago_por_cuenta_tienda";
  const esAporte = clase_ === "aporte_capital";
  const esAbono = clase_ === "abono_tienda";
  const esPagoTienda = clase_ === "pago_tienda";
  const esPagoMensajero = clase_ === "pago_mensajero";
  /** Los cuatro conceptos que piden el método de pago. */
  const pideMetodo = esPagoPorCuenta || esAbono || esPagoTienda || esPagoMensajero;
  /** R43 — la referencia obligatoria solo donde hoy lo es (método distinto de efectivo). */
  const referenciaObligatoria = pideMetodo && metodo !== "" && metodo !== "efectivo";
  /** R42/R43 — la referencia OPCIONAL de los registros de caja a mano (458-B, TB.11). */
  const referenciaOpcional = aQuienPide !== null;
  /** Los conceptos cuya fecha es la del pago: no tiene ventana hacia atrás (solo no futura). */
  const fechaSinVentana = esAporte || esAbono || esPagoTienda || esPagoMensajero;

  // R41 — las listas se piden AL ABRIR y solo para el tipo de cuenta del concepto elegido.
  const tiendas = useSWR(open && cuenta === "tienda" && cuentaFija === undefined ? CLAVE_TIENDAS : null, cargarTiendas, {
    shouldRetryOnError: false,
  });
  const mensajeros = useSWR(
    open && cuenta === "mensajero" && cuentaFija === undefined ? CLAVE_MENSAJEROS : null,
    cargarMensajeros,
    { shouldRetryOnError: false },
  );
  const lista = cuenta === "mensajero" ? mensajeros : tiendas;
  const catalogoCaido = cuenta !== null && cuentaFija === undefined && lista.error !== undefined;

  const opcionesCuenta =
    cuentaFija !== undefined
      ? [{ value: cuentaFija.id, label: cuentaFija.nombre }]
      : (lista.data ?? []).map((u) => ({ value: u.id, label: u.nombre }));
  const estadoCuenta: SelectorBuscableEstado = catalogoCaido
    ? "error"
    : lista.isLoading
      ? "cargando"
      : opcionesCuenta.length === 0
        ? "vacio"
        : "listo";
  const nombreCuenta = opcionesCuenta.find((o) => o.value === cuentaId)?.label ?? null;

  function reset() {
    const hoy = fechaCalendarioCR();
    setConcepto(conceptoDeApertura);
    // R27 (459): el monto arranca VACÍO para TODOS los conceptos, y ningún camino lo rellena.
    setMonto("");
    setFecha(hoy);
    setVentana({ min: primerDiaMovimientoAdmisible(), max: hoy });
    setDescripcion("");
    // La cuenta elegida también se limpia: un cobro heredado de la vez anterior sería dinero
    // cobrado a quien no tocaba. Con la cuenta fija, vuelve a ser la fija.
    setCuentaId(cuentaFija?.id ?? null);
    setAQuien("");
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
    if (!siguiente || siguiente.id === concepto.id) return;
    // Cambiar de tipo de cuenta limpia la elegida: una tienda no es un mensajero.
    if (cuentaDelConcepto(siguiente) !== cuenta && cuentaFija === undefined) setCuentaId(null);
    setConcepto(siguiente);
    // R51 (M3 de la revisión) — otro concepto es otro registro: clave NUEVA. Con la misma, un gasto
    // cuya respuesta se perdió volvería como `ya_registrado` al confirmar un sueldo, y el diálogo
    // anunciaría como registrado algo que la persona no pidió. Los reintentos SIN cambiar de
    // concepto conservan la clave (el servidor los reconoce y no duplica).
    setClave(nuevaClave());
    setAvisoGeneral(null);
    setErrores((previos) => ({ monto: previos.monto, fecha: previos.fecha }));
  }

  function limpiarError(campo: keyof ErroresCampo) {
    if (errores[campo] !== undefined) setErrores((p) => ({ ...p, [campo]: undefined }));
  }

  /** Lo que está mal ANTES de llamar al borde (que re-valida todo). */
  function validar(): ErroresCampo {
    const nuevos: ErroresCampo = {};
    if (!montoValido(monto)) nuevos.monto = CAMPO_TEXTO.montoInvalido;
    if (fechaSinVentana) {
      if (fecha === "") nuevos.fecha = CAMPO_TEXTO.fechaVacia;
      else if (fecha > fechaCalendarioCR()) nuevos.fecha = CAMPO_TEXTO.fechaFutura;
    } else {
      // Los textos de rechazo son los MISMOS que emite el borde (`problemaDeFechaMovimiento`).
      const problemaFecha = problemaDeFechaMovimiento(fecha);
      if (problemaFecha !== null) nuevos.fecha = problemaFecha;
    }
    if (descripcion.trim().length === 0) {
      nuevos.descripcion = aQuienPide === null ? CAMPO_TEXTO.motivoVacio : CAMPO_TEXTO.descripcionVacia;
    }
    if (cuenta !== null && cuentaId === null) {
      nuevos.cuenta = cuenta === "tienda" ? CUENTA_TEXTO.tienda.sinElegir : CUENTA_TEXTO.mensajero.sinElegir;
    }
    if (aQuienPide === "obligatorio" && aQuien.trim().length === 0) nuevos.aQuien = CAMPO_TEXTO.aQuienVacio;
    if (esPagoPorCuenta && beneficiario.trim().length === 0) nuevos.beneficiario = PAGO_TEXTO.sinBeneficiario;
    if (esAporte && clase === "") nuevos.clase = APORTE_TEXTO.sinClase;
    if (pideMetodo) {
      if (metodo === "") nuevos.metodo = PAGO_TEXTO.sinMetodo;
      if (referenciaObligatoria && referencia.trim().length === 0) nuevos.referencia = PAGO_TEXTO.sinReferencia;
    }
    return nuevos;
  }

  /**
   * R23 de la 334 — en los registros de caja, la fecha SOLO viaja si la persona eligió un día distinto
   * del de hoy. El aporte la manda siempre; los tres pagos, siempre y como `fechaPago`.
   */
  function fechaSiCambio(): string | undefined {
    return fecha === fechaCalendarioCR() ? undefined : fecha;
  }

  /** R39 — el `FormData` del concepto, SOLO con sus claves. */
  function formData(): FormData {
    const fd = new FormData();
    const destino = concepto.destino;
    fd.set("claveIdempotencia", clave);
    fd.set("monto", monto.trim());
    switch (destino.clase) {
      case "egreso_administrativo":
      case "ajuste_manual": {
        if (destino.clase === "egreso_administrativo") {
          fd.set("tipoEgreso", destino.tipoEgreso);
        } else {
          fd.set("tipo", destino.tipo);
          fd.set("categoria", destino.categoria);
        }
        fd.set("descripcion", descripcion.trim());
        const elegida = fechaSiCambio();
        if (elegida !== undefined) fd.set("fecha", elegida);
        if (aQuien.trim() !== "") fd.set("contraparteNombre", aQuien.trim());
        if (referencia.trim() !== "") fd.set("referencia", referencia.trim());
        break;
      }
      case "cobro_tienda": {
        fd.set("tiendaId", cuentaId ?? "");
        fd.set("descripcion", descripcion.trim());
        const elegida = fechaSiCambio();
        if (elegida !== undefined) fd.set("fecha", elegida);
        break;
      }
      case "pago_por_cuenta_tienda": {
        fd.set("tiendaId", cuentaId ?? "");
        fd.set("beneficiario", beneficiario.trim());
        fd.set("metodo", metodo);
        if (referenciaObligatoria) fd.set("referencia", referencia.trim());
        fd.set("motivo", descripcion.trim());
        const elegida = fechaSiCambio();
        if (elegida !== undefined) fd.set("fecha", elegida);
        break;
      }
      case "aporte_capital":
        fd.set("clase", clase);
        fd.set("fecha", fecha);
        fd.set("motivo", descripcion.trim());
        break;
      case "abono_tienda":
        fd.set("tiendaId", cuentaId ?? "");
        fd.set("metodo", metodo);
        if (referenciaObligatoria) fd.set("referencia", referencia.trim());
        fd.set("motivo", descripcion.trim());
        fd.set("fechaPago", fecha);
        break;
      case "pago_tienda":
      case "pago_mensajero":
        fd.set(CLAVE_DE_LA_CUENTA[destino.clase === "pago_tienda" ? "tienda" : "mensajero"], cuentaId ?? "");
        fd.set("metodo", metodo);
        if (referenciaObligatoria) fd.set("referencia", referencia.trim());
        fd.set("nota", descripcion.trim());
        fd.set("fechaPago", fecha);
        break;
    }
    if (comprobante !== null) fd.set("comprobante", comprobante);
    return fd;
  }

  async function registrar(): Promise<ResultadoRegistro> {
    // El enrutado es por la CLASE del destino, nunca por el id del concepto.
    const destino = concepto.destino;
    const fd = formData();
    const nombre = nombreCuenta ?? "";

    switch (destino.clase) {
      case "egreso_administrativo": {
        const res = await registrarEgresoAdministrativoAction(fd);
        return res.status === "ok" || res.status === "ya_registrado"
          ? { status: "ok", mensajeExito: REGISTRAR_MOVIMIENTO_TEXTO.exitoCaja }
          : comun(res);
      }
      case "ajuste_manual": {
        const res = await registrarMovimientoManualAction(fd);
        return res.status === "ok" || res.status === "ya_registrado"
          ? { status: "ok", mensajeExito: REGISTRAR_MOVIMIENTO_TEXTO.exitoCaja }
          : comun(res);
      }
      case "cobro_tienda": {
        const res = await registrarCobroTiendaAction(fd);
        return res.status === "ok" || res.status === "ya_registrado"
          ? { status: "ok", mensajeExito: RESPUESTA_TEXTO.cobro(nombre, res.saldo) }
          : comun(res);
      }
      case "pago_por_cuenta_tienda": {
        const res = await registrarPagoPorCuentaTiendaAction(fd);
        return res.status === "ok" || res.status === "ya_registrado"
          ? { status: "ok", mensajeExito: RESPUESTA_TEXTO.pagoPorCuenta(res.pago.tiendaNombre, res.saldo) }
          : comun(res);
      }
      case "aporte_capital": {
        const res = await registrarAporteCapitalAction(fd);
        if (res.status === "ok" || res.status === "ya_registrado") {
          return { status: "ok", mensajeExito: APORTE_TEXTO.registrado(res.aporte.clase, res.aporte.monto) };
        }
        if (res.status === "ya_hay_saldo_inicial") {
          return { status: "validation_error", fieldErrors: { clase: [APORTE_TEXTO.yaHaySaldoInicial] } };
        }
        return comun(res);
      }
      case "abono_tienda": {
        const res = await registrarAbonoTiendaAction(fd);
        if (res.status === "ok") {
          return { status: "ok", mensajeExito: RESPUESTA_TEXTO.abono(res.abono.tiendaNombre, res.saldo) };
        }
        if (res.status === "ya_registrado") {
          return {
            status: "ok",
            mensajeExito: RESPUESTA_TEXTO.abonoYaRegistrado(res.abono.tiendaNombre, res.abono.monto, res.saldo),
          };
        }
        if (res.status === "sin_deuda") {
          return { status: "validation_error", fieldErrors: { tiendaId: [RESPUESTA_TEXTO.sinDeuda] } };
        }
        if (res.status === "excede") {
          return { status: "validation_error", fieldErrors: { monto: [RESPUESTA_TEXTO.excedeDeuda(res.deuda)] } };
        }
        return comun(res);
      }
      case "pago_tienda": {
        const res = await registrarPagoTiendaAction(fd);
        if (res.status === "ok" || res.status === "ya_registrado") {
          return { status: "ok", mensajeExito: RESPUESTA_TEXTO.pagoTienda(nombre, res.pago.monto, res.restante) };
        }
        if (res.status === "sin_saldo") {
          return { status: "validation_error", fieldErrors: { tiendaId: [RESPUESTA_TEXTO.sinSaldoTienda] } };
        }
        if (res.status === "excede") {
          return {
            status: "validation_error",
            fieldErrors: { monto: [RESPUESTA_TEXTO.excedeSaldoTienda(res.disponible)] },
          };
        }
        return comun(res);
      }
      case "pago_mensajero": {
        const res = await registrarRepartoMensajeroAction(fd);
        if (res.status === "ok" || res.status === "ya_registrado") {
          return {
            status: "ok",
            mensajeExito: RESPUESTA_TEXTO.pagoMensajero(
              nombre,
              res.reparto.totalImputado,
              res.reparto.restanteImputable,
            ),
          };
        }
        if (res.status === "sin_saldo") {
          return {
            status: "validation_error",
            fieldErrors: { [CLAVE_DE_LA_CUENTA.mensajero]: [RESPUESTA_TEXTO.sinSaldoMensajero] },
          };
        }
        if (res.status === "excede") {
          return {
            status: "validation_error",
            fieldErrors: { monto: [RESPUESTA_TEXTO.excedeSaldoMensajero(res.disponible)] },
          };
        }
        return comun(res);
      }
    }
  }

  async function confirmar() {
    const problemas = validar();
    if (Object.values(problemas).some((mensaje) => mensaje !== undefined)) {
      setErrores(problemas);
      return;
    }

    setAvisoGeneral(null);
    let result: ResultadoRegistro;
    try {
      result = await registrar();
    } catch {
      // M3 de la revisión — un fallo de red o un estado que el diálogo no conoce NO se calla: el
      // aviso queda a la vista, el diálogo sigue abierto con lo escrito y la clave se conserva, así
      // que repetir sin cambiar nada no duplica el registro.
      setAvisoGeneral(REGISTRAR_MOVIMIENTO_TEXTO.falloDeRed);
      return;
    }

    if (result.status === "ok") {
      toast.success(result.mensajeExito);
      setOpen(false);
      reset();
      onRegistrado?.(); // R48/R60: el módulo relee libro, cifras, composición y desglose
      router.refresh();
      return;
    }
    if (result.status === "validation_error") {
      // R49 — lo tecleado NO se toca: solo se pinta el motivo bajo el campo que lo produce.
      const f = result.fieldErrors;
      setErrores({
        monto: f.monto?.[0],
        fecha: f.fecha?.[0] ?? f.fechaPago?.[0],
        descripcion: f.descripcion?.[0] ?? f.motivo?.[0] ?? f.nota?.[0],
        cuenta: f[CLAVE_DE_LA_CUENTA.tienda]?.[0] ?? f[CLAVE_DE_LA_CUENTA.mensajero]?.[0],
        aQuien: f.contraparteNombre?.[0],
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
    toast.error(
      result.status === "forbidden" ? REGISTRAR_MOVIMIENTO_TEXTO.forbidden : REGISTRAR_MOVIMIENTO_TEXTO.unauthenticated,
    );
  }

  // R44 — «Así queda» se pide solo con un monto válido y, si el concepto la lleva, con la cuenta.
  const peticion: PeticionAsiQueda | null =
    montoValido(monto) && (cuenta === null || cuentaId !== null)
      ? {
          concepto: CONCEPTO_REGISTRO_DE[concepto.id],
          monto: monto.trim(),
          ...(cuenta === null || cuentaId === null ? {} : { cuentaId }),
        }
      : null;

  const cabecera = cabeceraDelConcepto(concepto);
  const textosCuenta = cuenta === "mensajero" ? CUENTA_TEXTO.mensajero : CUENTA_TEXTO.tienda;
  const etiquetaCuenta =
    cuenta === "mensajero"
      ? CUENTA_TEXTO.mensajero.etiqueta
      : clase_ === "cobro_tienda" || clase_ === "pago_por_cuenta_tienda" || clase_ === "abono_tienda" || clase_ === "pago_tienda"
        ? CUENTA_TEXTO.tienda.etiqueta[clase_]
        : "";
  const pistaCuenta =
    clase_ === "cobro_tienda" ||
    clase_ === "pago_por_cuenta_tienda" ||
    clase_ === "abono_tienda" ||
    clase_ === "pago_tienda" ||
    clase_ === "pago_mensajero"
      ? PISTA_CUENTA[clase_]
      : undefined;

  return (
    <>
      <Button type="button" onClick={abrir}>
        {etiquetaBoton ?? REGISTRAR_MOVIMIENTO_TEXTO.abrir}
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
        title={cabecera.titulo}
        description={cabecera.descripcion}
        confirmLabel={REGISTRAR_MOVIMIENTO_TEXTO.confirmar}
        // Con la lista de cuentas caída no se deja confirmar un concepto que la necesita.
        confirmDisabled={catalogoCaido}
        onConfirm={confirmar}
        closeOnConfirm={false}
        size="xl"
      >
        <div className="grid gap-6 md:grid-cols-[15rem_1fr]">
          {/* R37 — el catálogo en sus tres grupos; en móvil queda arriba, como lista. */}
          <nav aria-label={REGISTRAR_MOVIMIENTO_TEXTO.catalogo} className="flex flex-col gap-4">
            {GRUPOS.map((grupo) => (
              <div key={grupo} className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {GRUPO_CONCEPTO_LABEL[grupo]}
                </p>
                <RadioGroup
                  aria-label={GRUPO_CONCEPTO_LABEL[grupo]}
                  value={concepto.grupo === grupo ? concepto.id : ""}
                  onValueChange={(v) => {
                    if (v !== "") elegirConcepto(v);
                  }}
                  options={CONCEPTOS_MANUALES.filter((c) => c.grupo === grupo).map((c) => ({
                    value: c.id,
                    label: c.label,
                  }))}
                  // R40 (457 D8): con la cuenta fija, el concepto también lo está.
                  disabled={cuentaFija !== undefined}
                />
              </div>
            ))}
            {/* R38 — el gasto fijo no se registra a mano: el enlace lleva a sus plantillas. */}
            <p className="text-sm text-muted-foreground">
              {REGISTRAR_MOVIMIENTO_TEXTO.plantillas}{" "}
              <Link
                href={hrefPlantillas}
                onClick={() => setOpen(false)}
                className="font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring"
              >
                {REGISTRAR_MOVIMIENTO_TEXTO.plantillasEnlace}
              </Link>
            </p>
          </nav>

          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-1">
              {/* R39 — qué le pasa a la caja, a la cuenta y a la ganancia, en una línea. */}
              <p id="movimiento-concepto-efecto" className="text-sm font-medium text-foreground">
                {FRASE_DEL_EFECTO[concepto.id]}
              </p>
              {/* R52 — en qué libro cae y con qué nombre saldrá en él. */}
              <p id="movimiento-concepto-libro" className="text-sm text-muted-foreground">
                {fraseDelLibro(concepto)}
              </p>
            </div>

            {avisoGeneral === null ? null : (
              <p role="alert" className="text-sm text-destructive">
                {avisoGeneral}
              </p>
            )}

            {/* R41 — la cuenta, con buscador por nombre. Solo en los conceptos que la llevan. */}
            {cuenta === null ? null : (
              <FormField id="movimiento-cuenta" label={etiquetaCuenta} error={errores.cuenta} hint={pistaCuenta} required>
                {(control) =>
                  cuentaFija !== undefined ? (
                    // R40 (457 D8): la cuenta fija se lee por su nombre y no se puede cambiar.
                    <Input {...control} value={cuentaFija.nombre} readOnly disabled />
                  ) : (
                  <>
                    <SelectorBuscable
                      id="movimiento-cuenta"
                      etiqueta={etiquetaCuenta}
                      opciones={opcionesCuenta}
                      valor={cuentaId}
                      onCambiar={(v) => {
                        setCuentaId(v);
                        limpiarError("cuenta");
                      }}
                      estado={estadoCuenta}
                      textos={{
                        todos: textosCuenta.elegir,
                        buscar: textosCuenta.buscar,
                        buscarMarcador: textosCuenta.buscarMarcador,
                        cargando: textosCuenta.cargando,
                        error: textosCuenta.error,
                        vacio: textosCuenta.vacio,
                        hayMas: textosCuenta.hayMas,
                      }}
                      disabled={catalogoCaido}
                    />
                    {catalogoCaido ? (
                      <p role="alert" className="mt-1.5 text-sm text-destructive">
                        {textosCuenta.catalogoCaido}
                      </p>
                    ) : null}
                  </>
                  )
                }
              </FormField>
            )}

            {/* R42 (D5) — «a quién», texto libre: obligatorio en sueldo y gasto, opcional en la corrección. */}
            {aQuienPide === null ? null : (
              <FormField
                id="movimiento-a-quien"
                label={aQuienPide === "obligatorio" ? CAMPO_TEXTO.aQuien : CAMPO_TEXTO.aQuienOpcional}
                hint={CAMPO_TEXTO.aQuienAyuda}
                error={errores.aQuien}
                required={aQuienPide === "obligatorio"}
              >
                {(control) => (
                  <Input
                    {...control}
                    value={aQuien}
                    maxLength={120}
                    placeholder={CAMPO_TEXTO.aQuienMarcador}
                    onChange={(e) => {
                      setAQuien(e.target.value);
                      limpiarError("aQuien");
                    }}
                  />
                )}
              </FormField>
            )}

            {esPagoPorCuenta ? (
              <FormField id="movimiento-beneficiario" label={PAGO_TEXTO.beneficiario} error={errores.beneficiario} required>
                {(control) => (
                  <Input
                    {...control}
                    value={beneficiario}
                    maxLength={120}
                    placeholder={PAGO_TEXTO.beneficiarioPlaceholder}
                    onChange={(e) => {
                      setBeneficiario(e.target.value);
                      limpiarError("beneficiario");
                    }}
                  />
                )}
              </FormField>
            ) : null}

            {esAporte ? (
              <FormField id="movimiento-clase" label={APORTE_TEXTO.clase} error={errores.clase} required>
                {(control) => (
                  <RadioGroup
                    aria-label={APORTE_TEXTO.clase}
                    aria-invalid={control["aria-invalid"]}
                    value={clase}
                    onValueChange={(v) => {
                      setClase(v);
                      limpiarError("clase");
                    }}
                    options={APORTE_TEXTO.clases}
                  />
                )}
              </FormField>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="movimiento-monto" label={CAMPO_TEXTO.monto} error={errores.monto} required>
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    value={monto}
                    onChange={(e) => {
                      setMonto(e.target.value);
                      limpiarError("monto");
                    }}
                    // R27 (459): en el saldo inicial o aporte ni siquiera un ejemplo de importe.
                    placeholder={esAporte ? undefined : "0.00"}
                  />
                )}
              </FormField>

              <FormField
                id="movimiento-fecha"
                label={CAMPO_TEXTO.fecha}
                error={errores.fecha}
                hint={CAMPO_TEXTO.fechaAyuda}
                required
              >
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    value={fecha}
                    min={fechaSinVentana ? undefined : ventana.min}
                    max={ventana.max}
                    onChange={(e) => {
                      setFecha(e.target.value);
                      limpiarError("fecha");
                    }}
                  />
                )}
              </FormField>
            </div>

            <FormField id="movimiento-descripcion" label={concepto.descripcionLabel} error={errores.descripcion} required>
              {(control) => (
                <textarea
                  {...control}
                  value={descripcion}
                  onChange={(e) => {
                    setDescripcion(e.target.value);
                    limpiarError("descripcion");
                  }}
                  rows={3}
                  placeholder={concepto.descripcionPlaceholder}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring"
                />
              )}
            </FormField>

            {pideMetodo ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="movimiento-metodo" label={PAGO_TEXTO.metodo} error={errores.metodo} required>
                  {(control) => (
                    <Select
                      id={control.id}
                      aria-invalid={control["aria-invalid"]}
                      aria-describedby={control["aria-describedby"]}
                      aria-label={PAGO_TEXTO.metodo}
                      value={metodo}
                      onValueChange={(v) => {
                        setMetodo(v);
                        setErrores((p) => ({ ...p, metodo: undefined, referencia: undefined }));
                      }}
                      options={METODO_LIQUIDACION_OPTIONS}
                      placeholder={PAGO_TEXTO.metodoPlaceholder}
                    />
                  )}
                </FormField>
                {/* R43 — la referencia se ve y se exige solo con SINPE o transferencia. */}
                {referenciaObligatoria ? (
                  <FormField
                    id="movimiento-referencia"
                    label={PAGO_TEXTO.referencia}
                    hint={PAGO_TEXTO.referenciaHint}
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
                          limpiarError("referencia");
                        }}
                      />
                    )}
                  </FormField>
                ) : null}
              </div>
            ) : null}

            {referenciaOpcional ? (
              <FormField
                id="movimiento-referencia"
                label={CAMPO_TEXTO.referenciaOpcional}
                hint={CAMPO_TEXTO.referenciaOpcionalAyuda}
                error={errores.referencia}
              >
                {(control) => (
                  <Input
                    {...control}
                    value={referencia}
                    maxLength={60}
                    onChange={(e) => {
                      setReferencia(e.target.value);
                      limpiarError("referencia");
                    }}
                  />
                )}
              </FormField>
            ) : null}

            {/* R74 — el comprobante, opcional en TODO concepto (H1). */}
            <ComprobanteCampo
              id="movimiento-comprobante"
              archivo={comprobante}
              onCambiar={setComprobante}
              error={errores.comprobante}
              onError={(mensaje) => setErrores((p) => ({ ...p, comprobante: mensaje }))}
            />

            {/* R44–R47 — «Así queda», calculado por el servidor. */}
            <AsiQueda
              peticion={peticion}
              llevaCuenta={cuenta !== null}
              nombreCuenta={nombreCuenta}
              tope={esPagoTienda ? "pago_tienda" : esAbono ? "abono" : null}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
