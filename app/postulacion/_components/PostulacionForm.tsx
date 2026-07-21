"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { postularMensajero } from "@/lib/actions/postulacion-mensajero";
import {
  postulacionSchema,
  DOCUMENTO_TIPOS,
  type DocumentoTipo,
} from "@/lib/types/postulacion-mensajero";
import { POSTULACION_ALLOWED_MIME } from "@/lib/config/postulacion";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, type SelectOption } from "@/components/ui/select";
import { FormField } from "@/components/shared/FormField";

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

type FieldErrors = Record<string, string[]>;

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

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const setDocumento = (tipo: DocumentoTipo, file: File | null) => {
    setDocumentos((prev) => ({ ...prev, [tipo]: file }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

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

    startTransition(async () => {
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
          setGeneralError(
            "Has enviado demasiadas postulaciones. Espera unos minutos e inténtalo de nuevo.",
          );
          break;
        case "error":
          setGeneralError(
            "No se pudo enviar la postulación. Inténtalo de nuevo más tarde.",
          );
          break;
      }
    });
  };

  // R26: vista de confirmacion. Sin redireccion a ninguna zona autenticada.
  if (submitted) {
    return (
      <Card className="w-full max-w-md border-t-4 border-t-brand p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-center text-navy dark:text-foreground">
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
        <h1 className="text-2xl font-semibold text-center text-navy dark:text-foreground">
          Postulación de mensajero
        </h1>
        <p className="text-sm text-muted-foreground text-center mt-2">
          Completa tus datos y adjunta los documentos requeridos. Tu solicitud
          quedará pendiente de aprobación.
        </p>
      </div>

      {generalError && (
        <Alert variant="destructive" role="alert" aria-live="assertive">
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
          <Input
            type="password"
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
          <Input
            type="password"
            value={confirmacionPassword}
            onChange={(e) => setConfirmacionPassword(e.target.value)}
            disabled={isPending}
          />
        </FormField>

        {/* Documentos (R3, R10): 5 imagenes */}
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
                onChange={(e) => setDocumento(tipo, e.target.files?.[0] ?? null)}
                disabled={isPending}
              />
            </FormField>
          ))}
        </fieldset>

        <Button type="submit" loading={isPending} className="w-full">
          {isPending ? "Enviando..." : "Enviar postulación"}
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
