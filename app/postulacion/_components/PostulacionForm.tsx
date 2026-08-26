"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { postularMensajero } from "@/lib/actions/postulacion-mensajero";
import {
  postulacionSchema,
  DOCUMENTO_TIPOS,
  type DocumentoTipo,
} from "@/lib/types/postulacion-mensajero";
import { POSTULACION_ALLOWED_MIME, postulacionConfig } from "@/lib/config/postulacion";
import { comprimirImagen } from "@/lib/utils/comprimir-imagen";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, type SelectOption } from "@/components/ui/select";
import { FormField } from "@/components/shared/FormField";
import { PasswordInput } from "@/components/shared/PasswordInput";

// Feature 21 — formulario de postulacion de mensajero (T9: R2, R3, R10, R11, R26).
// Cliente. Valida con el MISMO schema zod del backend (postulacionSchema) para no
// duplicar reglas; el servidor revalida en el borde. Envia FormData a la Server
// Action publica postularMensajero y no maneja sesion (R22).

/** Etiquetas de los campos de texto. Aisladas para i18n futura (no hardcode en JSX). */
const TEXTO_LABELS: Record<string, string> = {
  nombre: "Nombres",
  primer_apellido: "Primer apellido",
  segundo_apellido: "Segundo apellido (opcional)",
  email: "Correo electrónico",
  telefono: "Teléfono",
  cedula: "Número de documento",
  placa: "Placa",
  password: "Contraseña",
  confirmacion_password: "Confirmar contraseña",
};

/** Etiquetas de los 5 documentos (R3). */
const DOCUMENTO_LABELS: Record<DocumentoTipo, string> = {
  cedula_anverso: "Cédula (anverso)",
  cedula_reverso: "Cédula (reverso)",
  propiedad_anverso: "Tarjeta de propiedad (anverso)",
  propiedad_reverso: "Tarjeta de propiedad (reverso)",
  foto_rostro: "Foto de rostro",
};

/** Mensajes de conflicto por campo (A3: error especifico, no generico). */
const CONFLICT_MESSAGES: Record<"email" | "cedula", string> = {
  email: "Este correo ya está registrado",
  cedula: "Este número de documento ya está registrado",
};

/**
 * Textos de estado del envio. Aislados para i18n futura, igual que las labels.
 * `errorEnvio` es el ULTIMO recurso: se pinta ante cualquier fallo que no sea
 * un desenlace conocido de la action (red caida, 413 del transporte que no
 * llega como respuesta, excepcion no capturada). Dice QUE HACER, porque la
 * causa mas probable siguen siendo las imagenes.
 */
const TEXTOS = {
  enviar: "Enviar postulación",
  enviando: "Enviando...",
  comprimiendo: "Procesando imágenes...",
  errorEnvio:
    "No se pudo enviar la postulación. Revisa tu conexión e inténtalo de nuevo; " +
    "si el problema persiste, adjunta imágenes más livianas (fotos de menor resolución).",
  errorTardeOTemprano:
    "No se pudo enviar la postulación. Inténtalo de nuevo más tarde.",
  rateLimited:
    "Has enviado demasiadas postulaciones. Espera unos minutos e inténtalo de nuevo.",
} as const;

type FieldErrors = Record<string, string[]>;

/**
 * Formatea bytes como MB con un decimal como mucho ("10.8 MB", "4 MB"), igual
 * que `formatBytes` de components/shared/BulkUpload.tsx.
 *
 * `redondear` va a proposito: el TOTAL se redondea hacia ARRIBA y el MAXIMO
 * hacia ABAJO, para que el mensaje nunca lea "4 MB de 4 MB" cuando el envio se
 * acaba de rechazar por unos KB de mas.
 *
 * Sin `.toFixed(`: la guardia 230 (diente 2) prohibe ese metodo en app/** y
 * components/** salvo excepcion por ARCHIVO ENTERO, y pedir la excepcion aqui
 * dejaria ciego a todo este fuente para siempre. La division por 10 ya da el
 * decimal.
 */
function formatearMB(bytes: number, redondear: (n: number) => number): string {
  return `${redondear((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Valida la SUMA de los documentos contra el presupuesto del cuerpo de la
 * peticion (postulacionConfig.MAX_TOTAL_BYTES, unica fuente del limite).
 *
 * Por que existe: `postulacionSchema` valida CADA documento contra
 * MAX_FILE_BYTES (5 MB), pero el transporte
 * (`experimental.serverActions.bodySizeLimit`) tiene un techo PARA TODA LA
 * PETICION. Con 5 documentos de 2,2 MB cada uno se pasan las validaciones por
 * documento y aun asi Next rechaza la peticion ANTES de que corra el codigo de
 * la app: sin log, sin respuesta y sin que la persona sepa que paso.
 *
 * Devuelve el mensaje (con el peso real y el maximo) o null si cabe.
 */
function validarTotal(
  archivos: readonly File[],
  maxBytes: number = postulacionConfig.MAX_TOTAL_BYTES,
): string | null {
  const total = archivos.reduce((suma, f) => suma + f.size, 0);
  if (total <= maxBytes) return null;
  return (
    `Los documentos pesan ${formatearMB(total, Math.ceil)} en total y el máximo ` +
    `permitido es ${formatearMB(maxBytes, Math.floor)}. Adjunta imágenes más ` +
    `livianas o toma las fotos con menor resolución.`
  );
}

export interface PostulacionFormProps {
  tiposIdentificacion: SelectOption[];
  vehiculos: SelectOption[];
}

const ACCEPT_IMAGES = POSTULACION_ALLOWED_MIME.join(",");

export function PostulacionForm({
  tiposIdentificacion,
  vehiculos,
}: PostulacionFormProps) {
  const [isPending, startTransition] = useTransition();

  // Campos de texto.
  const [nombre, setNombre] = useState("");
  const [primerApellido, setPrimerApellido] = useState("");
  const [segundoApellido, setSegundoApellido] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [cedula, setCedula] = useState("");
  const [placa, setPlaca] = useState("");
  const [password, setPassword] = useState("");
  const [confirmacionPassword, setConfirmacionPassword] = useState("");

  // Catalogos (Select).
  const [tipoIdentificacionId, setTipoIdentificacionId] = useState("");
  const [vehiculoId, setVehiculoId] = useState("");

  // Documentos (R3): un File por tipo.
  const [documentos, setDocumentos] = useState<Record<DocumentoTipo, File | null>>({
    cedula_anverso: null,
    cedula_reverso: null,
    propiedad_anverso: null,
    propiedad_reverso: null,
    foto_rostro: null,
  });

  // Cuantas compresiones hay en vuelo. Contador y no booleano porque son 5
  // inputs INDEPENDIENTES: con un booleano, la primera en terminar apagaria el
  // estado mientras las otras siguen, y el envio saldria con el archivo sin
  // comprimir.
  const [comprimiendo, setComprimiendo] = useState(0);
  /** Hay al menos una imagen procesandose: el envio debe esperar. */
  const ocupado = comprimiendo > 0;

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // El aviso global vive ARRIBA del formulario, que es largo: si la persona
  // pulsa "Enviar" desde el final, el mensaje aparece fuera de la pantalla. Se
  // le lleva el foco (el contenedor es focusable con tabIndex={-1}) para que no
  // haya forma de que el fallo pase desapercibido.
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!generalError) return;
    const el = alertRef.current;
    if (!el) return;
    el.focus();
    // jsdom no implementa scrollIntoView; se llama solo si existe.
    el.scrollIntoView?.({ block: "center" });
  }, [generalError]);

  /**
   * Guarda el documento elegido COMPRIMIDO en el navegador (capa 1 del arreglo).
   * Mismo patron que GestionarOrdenPanel / GestionarDesdeAyudaModal /
   * ReportarIncidenteModal: `comprimirImagen` deja una foto de celular en
   * ~200-600 KB y, ante cualquier fallo (formato no decodable, canvas sin
   * contexto 2d, resultado mas grande), devuelve el ORIGINAL. Por eso comprimir
   * es una OPTIMIZACION y no sustituye a la validacion del total en el submit.
   */
  const handleDocumentoChange = async (tipo: DocumentoTipo, file: File | null) => {
    if (!file) {
      setDocumentos((prev) => ({ ...prev, [tipo]: null }));
      return;
    }
    setComprimiendo((n) => n + 1);
    try {
      const comprimida = await comprimirImagen(file);
      setDocumentos((prev) => ({ ...prev, [tipo]: comprimida }));
    } finally {
      setComprimiendo((n) => n - 1);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    // Aun comprimiendo: enviar ahora mandaria un archivo sin comprimir.
    if (ocupado) return;

    // Validacion de cliente con el schema del backend (R2-R11). Se arma el
    // objeto crudo en snake_case para casar con las claves de fieldErrors.
    const raw: Record<string, unknown> = {
      nombre,
      primer_apellido: primerApellido,
      segundo_apellido: segundoApellido,
      email,
      telefono,
      tipo_identificacion_id: tipoIdentificacionId,
      cedula,
      vehiculo_id: vehiculoId,
      placa,
      password,
      confirmacion_password: confirmacionPassword,
    };
    for (const tipo of DOCUMENTO_TIPOS) {
      const file = documentos[tipo];
      if (file) raw[tipo] = file;
    }

    const parsed = postulacionSchema.safeParse(raw);
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      return;
    }

    // Capa 2: el TOTAL, medido DESPUES de comprimir (lo que hay en `documentos`
    // ya paso por comprimirImagen), que es lo que de verdad viaja. El schema
    // solo mira documento a documento; el techo del transporte es de la
    // peticion entera.
    const elegidos = DOCUMENTO_TIPOS.map((t) => documentos[t]).filter(
      (f): f is File => f !== null,
    );
    const errorTotal = validarTotal(elegidos);
    if (errorTotal) {
      setGeneralError(errorTotal);
      return;
    }

    // Construir FormData (campos de texto + 5 File) para la Server Action.
    const formData = new FormData();
    formData.set("nombre", nombre);
    formData.set("primer_apellido", primerApellido);
    formData.set("segundo_apellido", segundoApellido);
    formData.set("email", email);
    formData.set("telefono", telefono);
    formData.set("tipo_identificacion_id", tipoIdentificacionId);
    formData.set("cedula", cedula);
    formData.set("vehiculo_id", vehiculoId);
    formData.set("placa", placa);
    formData.set("password", password);
    formData.set("confirmacion_password", confirmacionPassword);
    for (const tipo of DOCUMENTO_TIPOS) {
      const file = documentos[tipo];
      if (file) formData.set(tipo, file);
    }

    // Capa 3: el envio NUNCA puede salir mudo. Todo lo que no sea un desenlace
    // conocido de la action --red caida, 413 del transporte que ni siquiera
    // llega como respuesta, cualquier excepcion-- termina pintando un aviso en
    // pantalla. Sin este try/catch la promesa rechazada se pierde dentro de la
    // transicion, la persona ve la pantalla rota y pierde todo lo que escribio
    // (mismo patron de fallo que la ficha 248 y progress/impl_240.md 9.6).
    startTransition(async () => {
      try {
        const res = await postularMensajero(formData);

        switch (res.status) {
          case "ok":
            // R26: confirmacion, sin redirigir a zona autenticada.
            setSubmitted(true);
            break;
          case "validation_error":
            setFieldErrors(res.fieldErrors);
            break;
          case "conflict":
            // A3: error ESPECIFICO en el campo duplicado (email o cedula).
            setFieldErrors({ [res.field]: [CONFLICT_MESSAGES[res.field]] });
            break;
          case "rate_limited":
            setGeneralError(TEXTOS.rateLimited);
            break;
          case "error":
            setGeneralError(TEXTOS.errorTardeOTemprano);
            break;
          default: {
            // Si manana la action gana un desenlace nuevo, ESTA linea rompe el
            // typecheck y obliga a escribirle su texto (leccion de la 248: un
            // estado nuevo no puede caer en un mensaje ajeno... ni en silencio).
            const _exhaustivo: never = res;
            setGeneralError(TEXTOS.errorEnvio);
            void _exhaustivo;
            break;
          }
        }
      } catch {
        setGeneralError(TEXTOS.errorEnvio);
      }
    });
  };

  // R26: vista de confirmacion. Sin redireccion a ninguna zona autenticada.
  if (submitted) {
    return (
      <Card className="w-full max-w-md border-t-4 border-t-brand p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-center text-foreground">
            Postulación enviada
          </h1>
          <p className="text-sm text-muted-foreground text-center mt-2">
            Tu postulación fue recibida y quedó pendiente de aprobación. Te
            avisaremos cuando sea revisada. Aún no tienes acceso a la plataforma.
          </p>
        </div>
        <Link href="/login" className={buttonVariants({ className: "w-full" })}>
          Volver a iniciar sesión
        </Link>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-xl border-t-4 border-t-brand p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-center text-foreground">
          Postulación de mensajero
        </h1>
        <p className="text-sm text-muted-foreground text-center mt-2">
          Completa tus datos y adjunta los documentos requeridos. Tu solicitud
          quedará pendiente de aprobación.
        </p>
      </div>

      {generalError && (
        <Alert
          ref={alertRef}
          tabIndex={-1}
          variant="destructive"
          role="alert"
          aria-live="assertive"
        >
          <AlertDescription>{generalError}</AlertDescription>
        </Alert>
      )}

      {/*
        noValidate: evita que la validacion HTML5 nativa (type="email",
        required) interrumpa el submit antes de nuestra validacion zod y muestre
        tooltips nativos en vez de los errores accesibles (role="alert").
      */}
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Nombres */}
        <FormField id="nombre" label={TEXTO_LABELS.nombre} error={fieldErrors.nombre}>
          <Input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            disabled={isPending}
          />
        </FormField>

        {/* Primer apellido */}
        <FormField
          id="primer_apellido"
          label={TEXTO_LABELS.primer_apellido}
          error={fieldErrors.primer_apellido}
        >
          <Input
            type="text"
            value={primerApellido}
            onChange={(e) => setPrimerApellido(e.target.value)}
            disabled={isPending}
          />
        </FormField>

        {/* Segundo apellido (opcional) */}
        <FormField
          id="segundo_apellido"
          label={TEXTO_LABELS.segundo_apellido}
          error={fieldErrors.segundo_apellido}
        >
          <Input
            type="text"
            value={segundoApellido}
            onChange={(e) => setSegundoApellido(e.target.value)}
            disabled={isPending}
          />
        </FormField>

        {/* Correo electronico */}
        <FormField id="email" label={TEXTO_LABELS.email} error={fieldErrors.email}>
          <Input
            type="email"
            placeholder="tu@correo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isPending}
          />
        </FormField>

        {/* Telefono */}
        <FormField
          id="telefono"
          label={TEXTO_LABELS.telefono}
          error={fieldErrors.telefono}
        >
          <Input
            type="text"
            inputMode="numeric"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value.replace(/\D/g, ""))}
            disabled={isPending}
          />
        </FormField>

        {/* Tipo de documento (Select) */}
        <FormField
          id="tipo_identificacion_id"
          label="Tipo de documento"
          error={fieldErrors.tipo_identificacion_id}
        >
          {({
            "aria-invalid": ariaInvalid,
            "aria-describedby": ariaDescribedBy,
          }) => (
            <Select
              value={tipoIdentificacionId}
              onValueChange={setTipoIdentificacionId}
              options={tiposIdentificacion}
              placeholder="Selecciona un tipo de documento"
              disabled={isPending}
              aria-label="Tipo de documento"
              aria-invalid={ariaInvalid}
              aria-describedby={ariaDescribedBy}
            />
          )}
        </FormField>

        {/* Numero de documento */}
        <FormField id="cedula" label={TEXTO_LABELS.cedula} error={fieldErrors.cedula}>
          <Input
            type="text"
            inputMode="numeric"
            value={cedula}
            onChange={(e) => setCedula(e.target.value.replace(/\D/g, ""))}
            disabled={isPending}
          />
        </FormField>

        {/* Vehiculo (Select) */}
        <FormField
          id="vehiculo_id"
          label="Vehículo"
          error={fieldErrors.vehiculo_id}
        >
          {({
            "aria-invalid": ariaInvalid,
            "aria-describedby": ariaDescribedBy,
          }) => (
            <Select
              value={vehiculoId}
              onValueChange={setVehiculoId}
              options={vehiculos}
              placeholder="Selecciona un vehículo"
              disabled={isPending}
              aria-label="Vehículo"
              aria-invalid={ariaInvalid}
              aria-describedby={ariaDescribedBy}
            />
          )}
        </FormField>

        {/* Placa */}
        <FormField id="placa" label={TEXTO_LABELS.placa} error={fieldErrors.placa}>
          <Input
            type="text"
            value={placa}
            onChange={(e) => setPlaca(e.target.value)}
            disabled={isPending}
          />
        </FormField>

        {/* Contrasena */}
        <FormField
          id="password"
          label={TEXTO_LABELS.password}
          error={fieldErrors.password}
        >
          <PasswordInput
            etiqueta={TEXTO_LABELS.password}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isPending}
          />
        </FormField>

        {/* Confirmar contrasena */}
        <FormField
          id="confirmacion_password"
          label={TEXTO_LABELS.confirmacion_password}
          error={fieldErrors.confirmacion_password}
        >
          <PasswordInput
            etiqueta={TEXTO_LABELS.confirmacion_password}
            value={confirmacionPassword}
            onChange={(e) => setConfirmacionPassword(e.target.value)}
            disabled={isPending}
          />
        </FormField>

        {/* Documentos (R3, R10): 5 imagenes, comprimidas al elegirlas */}
        <fieldset className="space-y-4 border-t border-border pt-4">
          <legend className="text-sm font-medium text-foreground">
            Documentos (imágenes jpeg, png o webp)
          </legend>
          {DOCUMENTO_TIPOS.map((tipo) => (
            <FormField
              key={tipo}
              id={tipo}
              label={DOCUMENTO_LABELS[tipo]}
              error={fieldErrors[tipo]}
            >
              <Input
                type="file"
                accept={ACCEPT_IMAGES}
                onChange={(e) =>
                  void handleDocumentoChange(tipo, e.target.files?.[0] ?? null)
                }
                disabled={isPending}
              />
            </FormField>
          ))}
        </fieldset>

        <Button
          type="submit"
          loading={isPending || ocupado}
          disabled={ocupado}
          className="w-full"
        >
          {ocupado
            ? TEXTOS.comprimiendo
            : isPending
              ? TEXTOS.enviando
              : TEXTOS.enviar}
        </Button>
      </form>

      <div className="text-center">
        <Link
          href="/login"
          className="text-sm text-muted-foreground hover:text-foreground underline"
        >
          ¿Ya tienes cuenta? Inicia sesión
        </Link>
      </div>
    </Card>
  );
}
