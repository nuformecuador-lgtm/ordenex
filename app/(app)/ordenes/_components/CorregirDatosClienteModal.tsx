"use client";

import { useEffect, useId, useState } from "react";
import useSWR from "swr";

import { Modal } from "@/components/shared/Modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/useToast";
import type { CorregirDatosClienteActionResult } from "@/lib/actions/corregir-datos-cliente";
import { obtenerUbicacionOrden } from "@/lib/actions/corregir-datos-cliente";
import { obtenerCatalogoFiltrosOrdenes } from "@/lib/actions/filtros-ordenes";
import type { AvisoCambioUbicacion } from "@/lib/interfaces/services/ICorregirDatosClienteService";
import {
  corregirDatosClienteSchema,
  type CorregirDatosClienteEntrada,
} from "@/lib/types/correccion-datos-cliente";
import type { GeografiaFiltrosDTO, OpcionConPadre } from "@/lib/types/filtros-ordenes";

import { corregirDatosClienteErrorMessage } from "./corregir-datos-cliente-error-messages";
import { CorregirUbicacionAviso } from "./CorregirUbicacionAviso";

// =================================================================================================
// FICHA 312 (E1) + FICHA 327 (E2) — LA VENTANA CON LA QUE SE CORRIGEN LOS DATOS DE UNA ORDEN.
// =================================================================================================
//
// **Que problema cierra.** La carga masiva entra con el destinatario, el telefono o LA DIRECCION mal
// escritos y hasta la 312 la aplicacion no ofrecia NINGUNA superficie para arreglarlo: la unica via
// era un `UPDATE` a mano contra produccion.
//
// **La comparten LAS DOS superficies** (312/design §9.3): el modulo de ordenes (`maestro`/`admin`,
// por su disparador de fila) y las cards de `/novedades` (`adminTienda`, en los DOS grupos). Vive
// aqui —donde nace y donde esta su consumidor principal— y `/novedades` la IMPORTA, igual que
// `/recepcion-satelite` importa `ReportarIncidenteAccion`. Una sola implementacion sirve a las dos,
// que es literalmente 327/R32.
//
// **NUEVE CAMPOS** (312/D1 + 327/D1): `destinatario`, `telefonoDest`, `producto`, `notas` —los
// cuatro de la 312— mas `direccion`, `provinciaId`, `cantonId`, `distritoId` y `peso`. La direccion
// habia quedado fuera A SABIENDAS de que era el error de carga mas caro (312/D1) y el humano reabrio
// esa decision el 2026-08-28. Siguen fuera `montoCobrar`, `numRemision`, `cobraComision`,
// `estatusId`, `mensajeroAsignadoId`, `tiendaId` y `numGuia` (327/D2).
//
// ⚠️ **NO HAY SELECTOR DE ZONA, Y NO PUEDE HABERLO** (327/R5). La zona la DERIVA EL SERVIDOR del
// distrito recibido; el `.strict()` del schema rechaza a quien mande `zonaId`. Ofrecer aqui un
// desplegable de zonas seria abrir a mano la puerta que la ficha cierra por tipo.
//
// 💰 **ESTA VENTANA MUEVE DINERO, Y POR ESO TIENE DOS FASES** (327/D5, design §4.1). Cambiar el
// distrito recalcula la zona, y la zona decide la tarifa. Al pulsar «Guardar cambios» se envia
// SIEMPRE `confirmaCambioDeUbicacion: false`; si el distrito cambio, el servidor NO ESCRIBE NADA y
// responde `confirmacion_requerida` con la zona actual, la propuesta y los importes de cada una.
// Solo entonces se monta `CorregirUbicacionAviso`, y solo SU boton reenvia confirmando.
//
// **Por que el gate vive en el servidor y no aqui.** Porque asi es IMPOSIBLE guardar sin que el
// servidor haya enseñado los importes: el gate y el aviso son la misma respuesta, de la misma
// peticion. Una previsualizacion que esta pantalla pidiera al elegir el distrito seria un adorno que
// un cliente hecho a mano se salta, y volveria a dejar el dinero cambiando en silencio — que es
// literalmente lo que D5 vino a impedir. Si algun dia alguien mueve la decision al cliente, ha
// reabierto D5 y eso va a la puerta de aprobacion humana.
//
// ⚠️ **SIN RASTRO** (312/D4, RATIFICADO por 327/D3). Corregir NO publica nota en el hilo, NO escribe
// historial y NO deja auditoria: el unico rastro es el `updated_at` de la fila. Por eso NINGUN texto
// de esta ventana promete un registro («se guardara quien lo cambio» y similares estan prohibidos):
// no se registra, y una promesa falsa en la pantalla es peor que el silencio (327/R35).
//
// ⚠️ **NI UN `console` EN ESTE ARCHIVO** (R26), y no es estilo: el destinatario, el telefono, el
// producto, las notas y la direccion son datos de una persona real. Una guardia lo vigila
// (`tests/unit/guards/corregir-datos-sin-rastro.guardia.test.ts`).
//
// **NO OFRECE REIMPRIMIR LA ETIQUETA** (312/P4): R36 AVISA y nada mas. La reimpresion ya existe como
// gesto propio en la fila del listado (`EtiquetaOrdenAccion`) y esta ficha no lo duplica aqui dentro.

/**
 * Forma MINIMA que la ventana necesita de una orden. La cumplen POR ESTRUCTURA tanto
 * `OrdenListItemDTO` (listado de `/ordenes`) como `NovedadDTO` (cards de `/novedades`), asi que las
 * dos superficies comparten un solo cuerpo sin arrastrar ninguno de los dos DTO completos. Mismo
 * patron que `ReportarIncidenteOrdenUI` y `EliminarOrdenUI`.
 *
 * ⚠️ **LA UBICACION NO ESTA AQUI Y ES DELIBERADO** (327/design §9.3). `/ordenes` tiene los ids de
 * geografia pero `/novedades` solo tiene los NOMBRES, y ese DTO lo comparte el portal del mensajero:
 * ampliarlo obligaria a emitir tres ids en dos listas donde nadie los lee. La ventana pide los nueve
 * valores actuales al abrirse, con una lectura propia que sirve IGUAL a las dos superficies.
 */
export interface CorregirDatosClienteOrdenUI {
  id: string;
  numRemision: string;
  numGuia?: number | null;
  destinatario: string;
  telefonoDest: string;
  producto: string;
  notas?: string | null;
  /** El estado decide si la accion se OFRECE (312/R22-R24). Lo mira el disparador, no esta ventana. */
  estatusValue?: string | null;
}

/**
 * Como se dispara la correccion. **La ventana no importa la Server Action de ESCRITURA: se la pasa
 * la superficie que la monta**, y las dos pasan LA MISMA (`corregirDatosCliente`).
 *
 * ⚠️ Esto NO es una preferencia de estilo y conviene no «simplificarlo» de vuelta. `/novedades`
 * tiene una guardia propia —`novedad-acciones-sin-maqueta.guardia.test.ts`, nacida de ocho dias de
 * un boton que avisaba por toast sin mutar nada— que exige que **algun archivo de
 * `app/(app)/novedades/` importe Y LLAME** a la operacion que su fila declara en
 * `PRODUCTOR_POR_ACCION`. Con la llamada escondida aqui dentro, en otra carpeta, esa guardia veria
 * un boton sin cable y estaria en lo cierto: el cable se ve en la pantalla que ofrece el boton.
 *
 * La LECTURA de precarga (`obtenerUbicacionOrden`) SI se importa aqui dentro, y no contradice lo
 * anterior: no es la operacion de ningun boton de fila —es lo que esta ventana necesita para
 * abrirse—, y ese mismo censo inverso obliga a que no viaje por `/novedades` (ver `geografiaFetcher`).
 */
export type EnviarCorreccion = (
  entrada: CorregirDatosClienteEntrada,
) => Promise<CorregirDatosClienteActionResult>;

export interface CorregirDatosClienteModalProps {
  open: boolean;
  /** Orden UNA, nunca un lote: los nueve campos son propios de cada orden (312/design §8/F). */
  orden: CorregirDatosClienteOrdenUI;
  onOpenChange: (open: boolean) => void;
  /** El disparo real. Ver `EnviarCorreccion`. */
  corregir: EnviarCorreccion;
  /** Exito: el padre cierra y RELEE el estado DEL SERVIDOR (312/R29). Nada de optimismo local. */
  onSuccess: () => void;
}

// --- Textos visibles (separados de la logica, i18n-ready, como el resto del modulo) --------------

export const CORREGIR_TITULO = "Corregir los datos del cliente";
export const CORREGIR_CONFIRMAR = "Guardar cambios";

/**
 * 327/D2 dicho en la ventana: lo que NO se corrige aqui, para que nadie lo busque. Y la regla de la
 * zona, que explica por que no hay un desplegable de zonas (R5).
 *
 * ⚠️ CAMBIA LITERALMENTE RESPECTO DE LA 312, y ese cambio es el corazon de esta ficha: aquel texto
 * decia «la direccion, la zona y el monto a cobrar no se tocan desde aqui». La direccion SI se toca
 * desde hoy, asi que dejarlo habria sido una pantalla mintiendo sobre su propio alcance.
 */
export const CORREGIR_ALCANCE =
  "El monto a cobrar, el estado, la tienda y el mensajero asignado no se cambian desde aquí. La zona se calcula a partir del distrito.";

export const CORREGIR_DESTINATARIO_LABEL = "Destinatario";
export const CORREGIR_TELEFONO_LABEL = "Teléfono del destinatario";
export const CORREGIR_PRODUCTO_LABEL = "Producto";
export const CORREGIR_NOTAS_LABEL = "Notas";
export const CORREGIR_NOTAS_AYUDA = "Se puede dejar vacío.";

// --- Ficha 327 — la ubicacion --------------------------------------------------------------------

export const CORREGIR_DIRECCION_LABEL = "Dirección";
export const CORREGIR_PROVINCIA_LABEL = "Provincia";
export const CORREGIR_CANTON_LABEL = "Cantón";
export const CORREGIR_DISTRITO_LABEL = "Distrito";
export const CORREGIR_PESO_LABEL = "Peso (kg)";

export const CORREGIR_PROVINCIA_PLACEHOLDER = "Elige una provincia";
export const CORREGIR_CANTON_PLACEHOLDER = "Elige un cantón";
export const CORREGIR_DISTRITO_PLACEHOLDER = "Elige un distrito";

/** Mientras la lectura de precarga esta en vuelo, los controles de ubicacion van deshabilitados. */
export const CORREGIR_UBICACION_CARGANDO = "Cargando la ubicación actual de la orden…";

/**
 * DEGRADACION, NO PANTALLA MUERTA (design §10.1). Si la precarga falla, la ventana sigue
 * permitiendo corregir los cuatro campos de la 312 — y lo DICE, porque unos controles vacios y
 * apagados sin explicacion se leen como «esta orden no tiene direccion», que es otra cosa.
 */
export const CORREGIR_UBICACION_FALLO =
  "No se pudo cargar la ubicación de esta orden, así que ahora no se puede corregir. El resto de los datos sí. Cierra y vuelve a abrir esta ventana para reintentarlo.";

/** El catalogo geografico no llego: sin el no hay opciones que ofrecer en los tres desplegables. */
export const CORREGIR_GEOGRAFIA_FALLO =
  "No se pudo cargar el catálogo de provincias, cantones y distritos.";

/**
 * R36 — EL AVISO DE LA ETIQUETA, solo cuando la orden YA tiene guia. El papel pegado al paquete se
 * imprimio con los datos viejos y ninguna correccion lo cambia: quien esta delante de la pantalla
 * tiene que saberlo ANTES de confirmar, no despues.
 *
 * ⚠️ **NOMBRA LA DIRECCION EXPRESAMENTE** desde la 327, y no es un adorno del texto: la etiqueta
 * lleva la direccion IMPRESA, y la direccion es justo lo que esta ficha permite corregir. Decir
 * «los datos anteriores» a secas dejaba al lector adivinando si el papel se queda viejo en lo que
 * mas importa para entregar el paquete.
 *
 * Nombra la guia concreta porque es el dato con el que se busca ese paquete en la bodega.
 */
export function corregirAvisoEtiqueta(numGuia: number): string {
  return `Esta orden ya tiene la guía ${numGuia} impresa: la etiqueta pegada al paquete seguirá mostrando la dirección y los datos anteriores.`;
}

/**
 * 312/R28 — EL AVISO DE WHATSAPP, solo cuando el telefono cambio respecto del precargado. La
 * conversacion anterior se queda donde esta, intacta: si el numero estaba mal escrito, ese hilo es
 * una conversacion con OTRA persona y no sirve de nada, asi que no se migra ni se fusiona.
 */
export const CORREGIR_AVISO_WHATSAPP =
  "Los mensajes nuevos irán al número corregido. La conversación anterior se conserva, pero no se traslada.";

/** 312/R6-R30 — el bloqueo, con PALABRAS. Un botón apagado dice QUE no se puede, no POR QUÉ. */
export const CORREGIR_FALTAN_CAMPOS_PREFIJO = "Falta completar:";
export const CORREGIR_FALTA_DESTINATARIO = "el destinatario";
export const CORREGIR_FALTA_TELEFONO = "el teléfono";
export const CORREGIR_FALTA_PRODUCTO = "el producto";
export const CORREGIR_FALTA_DIRECCION = "la dirección";
export const CORREGIR_FALTA_DISTRITO = "el distrito";
export const CORREGIR_FALTA_PESO = "el peso (mayor que cero)";

export const CORREGIR_EXITO = "Datos corregidos.";
/** 312/R4 — el servidor no escribió nada porque no había nada que cambiar. No es un error. */
export const CORREGIR_SIN_CAMBIOS = "No había nada que cambiar: los datos ya eran esos.";

// --- La geografia, pedida desde el cliente y cacheada --------------------------------------------

/**
 * FICHA 327 — CLAVE SWR DEL CATALOGO GEOGRAFICO. Compartida por las dos superficies a proposito: es
 * el MISMO catalogo, es de solo lectura y no depende de la orden, asi que abrir la ventana por
 * segunda vez no vuelve a pedirlo.
 */
export const CLAVE_GEOGRAFIA_CORRECCION = "correccion:geografia";

/**
 * Las tres listas planas de provincias, cantones y distritos. Se piden desde EL CLIENTE —igual que
 * la barra de `/dashboard` (`FiltrosEntregas`) y la de analitica— y NO por props desde cada pagina,
 * y hay una razon MEDIDA para ello (2026-08-29):
 *
 * `/novedades` no tiene el catalogo, y hacer que su `page.tsx` importara
 * `obtenerCatalogoFiltrosOrdenes` pone ROJA la guardia `novedad-acciones-sin-maqueta` (su frente 4,
 * el censo inverso): esa guardia exige que TODA Server Action importada por un archivo de
 * `app/(app)/novedades/**` este declarada como accion de fila o exceptuada a mano. Medido: un solo
 * import deja el hallazgo `obtenerCatalogoFiltrosOrdenes (lo dispara app/(app)/novedades/page.tsx)`.
 * Pedirlo desde AQUI —que vive en `app/(app)/ordenes/_components/`— sirve a las dos superficies con
 * UNA implementacion, sin tocar ninguna guardia y sin ensanchar el contrato de dos paginas.
 *
 * `null` cuando no se pudo cargar: los desplegables quedan deshabilitados y la ventana lo dice. No
 * lanza — un catalogo caido no puede tumbar la correccion de los otros campos.
 */
async function geografiaFetcher(): Promise<GeografiaFiltrosDTO | null> {
  try {
    const res = await obtenerCatalogoFiltrosOrdenes();
    if (res.status !== "ok") return null;
    return {
      provincias: res.catalogo.provincias,
      cantones: res.catalogo.cantones,
      distritos: res.catalogo.distritos,
    };
  } catch {
    return null;
  }
}

/** Estado de la lectura de precarga (R31). */
type EstadoPrecarga = "cargando" | "listo" | "fallo";

/** Opciones de un nivel geografico, acotadas a su padre. Lista PLANA + `padreId`: para eso existe. */
function hijosDe(opciones: readonly OpcionConPadre[], padreId: string): SelectOption[] {
  if (padreId === "") return [];
  return opciones
    .filter((o) => o.padreId === padreId)
    .map((o) => ({ value: o.id, label: o.nombre }));
}

/** Primer mensaje del campo, si el borde marcó ese campo. */
function primerError(
  errores: Record<string, string[]>,
  campo: string,
): string | undefined {
  return errores[campo]?.[0];
}

/**
 * El peso tecleado como numero, o `null` si lo escrito no es un peso utilizable.
 *
 * `null` BLOQUEA el boton en vez de enviarse como «no lo toques»: mandar `undefined` ante un texto
 * invalido guardaria los otros ocho campos y dejaria el peso viejo EN SILENCIO, que es justo la
 * clase de fallo mudo que no rompe nada y nadie nota. R9 pide `> 0`, igual que el schema.
 */
function pesoNumerico(texto: string): number | null {
  const limpio = texto.trim();
  if (limpio === "") return null;
  const valor = Number(limpio);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  return valor;
}

/**
 * Ventana de correccion de los datos y la ubicacion de UNA orden.
 *
 * - **Nueve campos precargados** con los valores actuales (312/R26 + 327/R31). Los cuatro de la 312
 *   vienen en la prop `orden`; los cinco de la 327 los trae una lectura propia al abrir.
 * - **Valida en cliente con EL MISMO** `corregirDatosClienteSchema` que el servidor revalida en el
 *   borde: el cliente no tiene reglas propias que puedan divergir. En particular **no impone un
 *   largo maximo propio** a ningun campo (312/R6): un tope que la carga masiva no tiene produciria
 *   el caso absurdo «se pudo cargar pero no se puede corregir».
 * - **El servidor sigue siendo la guardia real** (327/R28): revalida rol, pertenencia y estado en
 *   CADA peticion —tanto la de la precarga como la que escribe—, con independencia de lo que esta
 *   ventana haya ofrecido.
 * - **Ante un rechazo, el borrador NO se limpia** (327/R34): lo tecleado sigue ahi y el motivo se
 *   pinta dentro de la ventana, que es donde esta la decision.
 */
export function CorregirDatosClienteModal({
  open,
  orden,
  onOpenChange,
  corregir,
  onSuccess,
}: Readonly<CorregirDatosClienteModalProps>) {
  const toast = useToast();
  const destinatarioId = useId();
  const telefonoId = useId();
  const productoId = useId();
  const notasId = useId();
  const direccionId = useId();
  const provinciaSelectId = useId();
  const cantonSelectId = useId();
  const distritoSelectId = useId();
  const pesoId = useId();

  // 312/R26 — LOS CUATRO CAMPOS PRECARGADOS con los valores actuales de ESTA orden.
  const [destinatario, setDestinatario] = useState(orden.destinatario);
  const [telefono, setTelefono] = useState(orden.telefonoDest);
  const [producto, setProducto] = useState(orden.producto);
  const [notas, setNotas] = useState(orden.notas ?? "");

  // 327/R31 — LOS CINCO DE LA UBICACION, que llegan de la lectura de precarga.
  const [direccion, setDireccion] = useState("");
  const [provincia, setProvincia] = useState("");
  const [canton, setCanton] = useState("");
  const [distrito, setDistrito] = useState("");
  const [peso, setPeso] = useState("");
  const [estadoPrecarga, setEstadoPrecarga] = useState<EstadoPrecarga>("cargando");
  const [guiaPrecargada, setGuiaPrecargada] = useState<number | null>(null);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [motivoRechazo, setMotivoRechazo] = useState<string | undefined>(undefined);
  const [enviando, setEnviando] = useState(false);

  // 💰 327/R11 — el aviso que devuelve el SERVIDOR cuando el distrito cambia y no llega la
  // confirmacion. `undefined` = todavia no hay nada que confirmar. NUNCA se rellena con datos
  // calculados aqui: sale tal cual de la respuesta que se acaba de recibir.
  const [aviso, setAviso] = useState<AvisoCambioUbicacion | undefined>(undefined);

  // El catalogo geografico. Solo se pide con la ventana ABIERTA: `null` como key deja el fetch sin
  // disparar, que es como SWR expresa «todavia no».
  const { data: geografia } = useSWR(
    open ? CLAVE_GEOGRAFIA_CORRECCION : null,
    geografiaFetcher,
    { revalidateOnFocus: false },
  );

  // Cada apertura arranca del dato de la orden, no del borrador de la anterior. Patron «ajustar
  // estado durante el render» (el de `ReportarIncidenteModal`): en un efecto, este `setState`
  // encadenaria un render extra con los valores viejos ya visibles.
  //
  // ⚠️ Se reinicia SOLO al ABRIR. Un rechazo del servidor deja la ventana abierta y el borrador
  // intacto, que es literalmente 327/R34.
  const [abiertoPrevio, setAbiertoPrevio] = useState(open);
  if (open !== abiertoPrevio) {
    setAbiertoPrevio(open);
    if (open) {
      setDestinatario(orden.destinatario);
      setTelefono(orden.telefonoDest);
      setProducto(orden.producto);
      setNotas(orden.notas ?? "");
      setDireccion("");
      setProvincia("");
      setCanton("");
      setDistrito("");
      setPeso("");
      setEstadoPrecarga("cargando");
      setGuiaPrecargada(null);
      setFieldErrors({});
      setMotivoRechazo(undefined);
      setAviso(undefined);
      setEnviando(false);
    }
  }

  // 327/R31 — LA PRECARGA. Se pide al ABRIR y no al montar: la ventana vive en el arbol junto a la
  // fila, y pedir la ubicacion de cada orden del listado seria una peticion por fila.
  //
  // ⚠️ El `try` NO ESCONDE UN FALLO: lo convierte en el estado `fallo`, que la ventana PINTA. Y no
  // hay `console` en el `catch` (R26): un `console.error("fallo", input)` volcaria la direccion
  // entera al log del navegador y de la plataforma.
  // ⚠️ EL `"cargando"` INICIAL NO SE PONE AQUI, y no es un olvido: lo pone el bloque de reinicio de
  // arriba, durante el render de la apertura. Un `setState` SINCRONO dentro de un efecto encadena
  // un render extra —el compilador de React lo marca como error, no como aviso— y ademas dejaria un
  // instante con los controles habilitados y vacios antes de deshabilitarlos.
  useEffect(() => {
    if (!open) return;
    let vigente = true;
    void (async () => {
      try {
        const res = await obtenerUbicacionOrden({ ordenId: orden.id });
        if (!vigente) return;
        if (res.status !== "ok") {
          setEstadoPrecarga("fallo");
          return;
        }
        setDireccion(res.orden.direccion ?? "");
        setProvincia(res.orden.provinciaId);
        setCanton(res.orden.cantonId);
        setDistrito(res.orden.distritoId ?? "");
        setPeso(res.orden.peso === null ? "" : String(res.orden.peso));
        setGuiaPrecargada(res.orden.numGuia);
        setEstadoPrecarga("listo");
      } catch {
        if (vigente) setEstadoPrecarga("fallo");
      }
    })();
    // Una respuesta que llega despues de cerrar (o de cambiar de orden) NO pisa el borrador vivo.
    return () => {
      vigente = false;
    };
  }, [open, orden.id]);

  const ubicacionEditable = estadoPrecarga === "listo";
  const pesoValor = pesoNumerico(peso);

  // Lo que falta para poder enviar, en el orden del formulario. `trim()` porque una linea de
  // espacios no es un destinatario, y porque es lo mismo que hace el servidor antes de comparar:
  // dos reglas distintas sobre el mismo campo dejarian un boton encendido que la accion rechaza.
  //
  // `notas` NO entra: vaciarlo es una correccion valida («notas vacia es ausencia», y el servidor
  // guarda `null`).
  //
  // Los cinco de la ubicacion solo entran cuando la precarga funciono: si no, no viajan en la
  // peticion y exigirlos dejaria la ventana bloqueada para siempre por un fallo de LECTURA.
  const faltantes: string[] = [];
  if (destinatario.trim() === "") faltantes.push(CORREGIR_FALTA_DESTINATARIO);
  if (telefono.trim() === "") faltantes.push(CORREGIR_FALTA_TELEFONO);
  if (producto.trim() === "") faltantes.push(CORREGIR_FALTA_PRODUCTO);
  if (ubicacionEditable) {
    if (direccion.trim() === "") faltantes.push(CORREGIR_FALTA_DIRECCION);
    if (distrito === "") faltantes.push(CORREGIR_FALTA_DISTRITO);
    if (pesoValor === null) faltantes.push(CORREGIR_FALTA_PESO);
  }
  const completo = faltantes.length === 0;

  // 312/R28 — ¿el telefono cambio respecto del precargado? Se compara recortado, con el mismo
  // criterio con el que el servidor decide si hay cambio: asi el aviso no aparece por un espacio.
  const telefonoTocado = telefono.trim() !== orden.telefonoDest.trim();

  // R36 — la orden ya tiene papel impreso. La precarga manda cuando ya llego (es la lectura fresca);
  // hasta entonces vale lo que trajo la fila. `null` = sin guia = sin aviso.
  const guiaImpresa = guiaPrecargada ?? orden.numGuia ?? null;

  const provincias: SelectOption[] = (geografia?.provincias ?? []).map((p) => ({
    value: p.id,
    label: p.nombre,
  }));
  const cantones = hijosDe(geografia?.cantones ?? [], provincia);
  const distritos = hijosDe(geografia?.distritos ?? [], canton);

  /**
   * Tocar la ubicacion INVALIDA el aviso que hubiera en pantalla. Sin esto, alguien podria leer los
   * importes del distrito A, cambiar al distrito B y pulsar «Confirmar el cambio» — confirmando
   * unos numeros que ya no son los de lo que va a guardar. El servidor volveria a pedir
   * confirmacion igualmente (el gate es suyo), pero la pantalla habria mentido en el intervalo.
   */
  function alCambiarUbicacion(aplicar: () => void) {
    setAviso(undefined);
    aplicar();
  }

  /**
   * 💰 EL ENVIO, con el gate del dinero como unico parametro.
   *
   * `confirma` es `false` para «Guardar cambios» —SIEMPRE, sin excepciones— y `true` solo para el
   * boton de `CorregirUbicacionAviso`. Que el boton normal no pueda mandar `true` es la mitad de
   * pantalla de R33; la otra mitad es del servidor, que rechaza igual a quien lo intente por fuera
   * (R28).
   */
  async function enviar(confirma: boolean) {
    // Guarda redundante con `confirmDisabled`: el handler no debe depender del bloqueo visual para
    // no llamar a la accion con un campo vacio (patron `ReportarIncidenteModal`).
    if (!completo || enviando) return;

    // Validacion de borde en cliente con EL MISMO schema del servidor (312/R6: sin tope propio).
    const parsed = corregirDatosClienteSchema.safeParse({
      ordenId: orden.id,
      destinatario,
      telefonoDest: telefono,
      producto,
      // "" es «vaciar las notas»: el servidor lo normaliza a `null`, igual que la carga masiva.
      notas,
      // 327/R3 — los tres de geografia viajan JUNTOS o no viajan. Con la precarga caida no viaja
      // ninguno de los cinco, y el servidor los deja como estaban.
      ...(ubicacionEditable
        ? {
            direccion,
            provinciaId: provincia,
            cantonId: canton,
            distritoId: distrito,
            peso: pesoValor ?? undefined,
          }
        : {}),
      confirmaCambioDeUbicacion: confirma,
    });
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as Record<string, string[]>);
      return;
    }
    setFieldErrors({});
    setMotivoRechazo(undefined);
    setEnviando(true);

    // Se envian los nueve campos y el SERVIDOR hace el diff (312/R4): la pantalla no decide que
    // cambio, porque su idea de «igual» y la del servidor —que compara tras normalizar— podrian no
    // coincidir. `cambios: []` es un desenlace legitimo, no un error.
    let resultado: CorregirDatosClienteActionResult;
    try {
      resultado = await corregir(parsed.data);
    } catch {
      setEnviando(false);
      setMotivoRechazo(corregirDatosClienteErrorMessage(undefined));
      return;
    }
    setEnviando(false);

    if (resultado.status === "ok") {
      toast.success(resultado.cambios.length === 0 ? CORREGIR_SIN_CAMBIOS : CORREGIR_EXITO);
      // 312/R29 — el padre cierra y RELEE del servidor. Esta ventana no pinta nada optimista.
      onSuccess();
      return;
    }

    // 💰 327/R11-R33 — NO SE ESCRIBIO NADA. El servidor devuelve la comparacion y la ventana la
    // monta; confirmar es un gesto aparte, del boton de ese panel.
    if (resultado.status === "confirmacion_requerida") {
      setAviso(resultado.aviso);
      return;
    }

    if (resultado.status === "validation_error") {
      // Se pinta junto a cada campo y la ventana NO se cierra: lo tecleado sigue ahi (R34).
      setFieldErrors(resultado.fieldErrors);
      setAviso(undefined);
      return;
    }

    // R34 — motivo accionable, DENTRO de la ventana (junto al borrador que se conserva) y sin
    // exponer ningun identificador ni el detalle del rechazo opaco (R30).
    setAviso(undefined);
    setMotivoRechazo(corregirDatosClienteErrorMessage(resultado));
  }

  const destinatarioError = primerError(fieldErrors, "destinatario");
  const telefonoError = primerError(fieldErrors, "telefonoDest");
  const productoError = primerError(fieldErrors, "producto");
  const notasError = primerError(fieldErrors, "notas");
  const direccionError = primerError(fieldErrors, "direccion");
  const distritoError = primerError(fieldErrors, "distritoId");
  const pesoError = primerError(fieldErrors, "peso");
  const ordenIdError = primerError(fieldErrors, "ordenId");

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={CORREGIR_TITULO}
      description={`Orden ${orden.numRemision}`}
      confirmLabel={CORREGIR_CONFIRMAR}
      confirmDisabled={!completo || enviando || estadoPrecarga === "cargando"}
      // ⚠️ SIEMPRE sin confirmar (design §4.1). Este boton NO puede saltarse el aviso del importe.
      onConfirm={() => enviar(false)}
      // No se cierra al confirmar: lo hace el padre cuando el servidor dijo `ok` (312/R29-R30).
      closeOnConfirm={false}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <p role="note" className="text-sm text-muted-foreground">
          {CORREGIR_ALCANCE}
        </p>

        {/* R36 — el papel ya impreso. Va ARRIBA y siempre visible: es una condicion de la accion,
            no la consecuencia de un error, asi que `role="note"` y no `alert`. Y NO lleva boton de
            reimprimir (312/P4): esa accion ya vive en la fila del listado. */}
        {guiaImpresa !== null ? (
          <p
            role="note"
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground"
          >
            {corregirAvisoEtiqueta(guiaImpresa)}
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={destinatarioId}>{CORREGIR_DESTINATARIO_LABEL}</Label>
          <Input
            id={destinatarioId}
            value={destinatario}
            onChange={(event) => setDestinatario(event.target.value)}
            required
            aria-invalid={destinatarioError ? true : undefined}
          />
          {destinatarioError ? (
            <p role="alert" className="text-sm text-destructive">
              {destinatarioError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={telefonoId}>{CORREGIR_TELEFONO_LABEL}</Label>
          <Input
            id={telefonoId}
            type="tel"
            value={telefono}
            onChange={(event) => setTelefono(event.target.value)}
            required
            aria-invalid={telefonoError ? true : undefined}
          />
          {telefonoError ? (
            <p role="alert" className="text-sm text-destructive">
              {telefonoError}
            </p>
          ) : null}
          {/* 312/R28 — solo cuando el numero cambio de verdad. */}
          {telefonoTocado ? (
            <p role="note" className="text-sm text-muted-foreground">
              {CORREGIR_AVISO_WHATSAPP}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={productoId}>{CORREGIR_PRODUCTO_LABEL}</Label>
          {/* 312/R6 — SIN `maxLength`. La carga masiva no tiene tope para este campo y la
              correccion tampoco: un tope propio aqui produciria el caso «se pudo cargar pero no se
              puede corregir» que 312/P3 descarto. */}
          <Input
            id={productoId}
            value={producto}
            onChange={(event) => setProducto(event.target.value)}
            required
            aria-invalid={productoError ? true : undefined}
          />
          {productoError ? (
            <p role="alert" className="text-sm text-destructive">
              {productoError}
            </p>
          ) : null}
        </div>

        {/* ── FICHA 327 — LA UBICACION ────────────────────────────────────────────────────────── */}

        {estadoPrecarga === "cargando" ? (
          <p role="status" className="text-sm text-muted-foreground">
            {CORREGIR_UBICACION_CARGANDO}
          </p>
        ) : null}

        {estadoPrecarga === "fallo" ? (
          <p
            role="note"
            className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
          >
            {CORREGIR_UBICACION_FALLO}
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={direccionId}>{CORREGIR_DIRECCION_LABEL}</Label>
          {/* R8 — SIN `maxLength`, por el mismo motivo que `producto`: la carga masiva no lo tiene. */}
          <Input
            id={direccionId}
            value={direccion}
            onChange={(event) => alCambiarUbicacion(() => setDireccion(event.target.value))}
            disabled={!ubicacionEditable}
            required
            aria-invalid={direccionError ? true : undefined}
          />
          {direccionError ? (
            <p role="alert" className="text-sm text-destructive">
              {direccionError}
            </p>
          ) : null}
        </div>

        {/* Tres selectores ENCADENADOS por `padreId` (design §10.1). Elegir provincia limpia el
            canton y el distrito, y elegir canton limpia el distrito: dejar colgado un distrito de
            otra provincia produciria justo la geografia incoherente que el servidor rechaza (R6). */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={provinciaSelectId}>{CORREGIR_PROVINCIA_LABEL}</Label>
            <Select
              id={provinciaSelectId}
              aria-label={CORREGIR_PROVINCIA_LABEL}
              value={provincia}
              options={provincias}
              placeholder={CORREGIR_PROVINCIA_PLACEHOLDER}
              disabled={!ubicacionEditable || provincias.length === 0}
              onValueChange={(next) =>
                alCambiarUbicacion(() => {
                  setProvincia(next);
                  setCanton("");
                  setDistrito("");
                })
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={cantonSelectId}>{CORREGIR_CANTON_LABEL}</Label>
            <Select
              id={cantonSelectId}
              aria-label={CORREGIR_CANTON_LABEL}
              value={canton}
              options={cantones}
              placeholder={CORREGIR_CANTON_PLACEHOLDER}
              disabled={!ubicacionEditable || provincia === ""}
              onValueChange={(next) =>
                alCambiarUbicacion(() => {
                  setCanton(next);
                  setDistrito("");
                })
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={distritoSelectId}>{CORREGIR_DISTRITO_LABEL}</Label>
            <Select
              id={distritoSelectId}
              aria-label={CORREGIR_DISTRITO_LABEL}
              value={distrito}
              options={distritos}
              placeholder={CORREGIR_DISTRITO_PLACEHOLDER}
              disabled={!ubicacionEditable || canton === ""}
              aria-invalid={distritoError ? true : undefined}
              onValueChange={(next) => alCambiarUbicacion(() => setDistrito(next))}
            />
            {distritoError ? (
              <p role="alert" className="text-sm text-destructive">
                {distritoError}
              </p>
            ) : null}
          </div>
        </div>

        {ubicacionEditable && geografia === null ? (
          <p role="note" className="text-sm text-muted-foreground">
            {CORREGIR_GEOGRAFIA_FALLO}
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={pesoId}>{CORREGIR_PESO_LABEL}</Label>
          {/* R9 — estrictamente mayor que cero, y no se puede dejar sin peso desde esta ventana. */}
          <Input
            id={pesoId}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={peso}
            onChange={(event) => alCambiarUbicacion(() => setPeso(event.target.value))}
            disabled={!ubicacionEditable}
            required
            aria-invalid={pesoError ? true : undefined}
          />
          {pesoError ? (
            <p role="alert" className="text-sm text-destructive">
              {pesoError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={notasId}>{CORREGIR_NOTAS_LABEL}</Label>
          <p id={`${notasId}-ayuda`} className="text-xs text-muted-foreground">
            {CORREGIR_NOTAS_AYUDA}
          </p>
          {/* 312/R6 — sin `maxLength`, por el mismo motivo que `producto`. */}
          <Textarea
            id={notasId}
            value={notas}
            onChange={(event) => setNotas(event.target.value)}
            rows={3}
            aria-describedby={`${notasId}-ayuda`}
            aria-invalid={notasError ? true : undefined}
          />
          {notasError ? (
            <p role="alert" className="text-sm text-destructive">
              {notasError}
            </p>
          ) : null}
        </div>

        {ordenIdError ? (
          <p role="alert" className="text-sm text-destructive">
            {ordenIdError}
          </p>
        ) : null}

        {/* 💰 327/R33 — LA SEGUNDA FASE. Se monta SOLO con la respuesta del servidor en la mano, y
            su boton es el UNICO que reenvia confirmando. */}
        {aviso ? (
          <CorregirUbicacionAviso
            aviso={aviso}
            enviando={enviando}
            onConfirmar={() => void enviar(true)}
          />
        ) : null}

        {/* R34 — el rechazo del servidor, junto al borrador que se conserva. */}
        {motivoRechazo ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {motivoRechazo}
          </p>
        ) : null}

        {completo ? null : (
          <p role="note" className="text-sm text-muted-foreground">
            {`${CORREGIR_FALTAN_CAMPOS_PREFIJO} ${faltantes.join(", ")}.`}
          </p>
        )}
      </div>
    </Modal>
  );
}
