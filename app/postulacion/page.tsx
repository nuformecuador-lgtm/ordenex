import { getPrismaClient } from "@/lib/db/prisma-client";
import { VehiculoRepository } from "@/lib/repositories/VehiculoRepository";
import type { SelectOption } from "@/components/ui/select";
import { Logo } from "@/components/shared/Logo";
import { VolverAlInicioLink } from "@/components/shared/VolverAlInicioLink";
import { PostulacionForm } from "./_components/PostulacionForm";

// Opt-out del prerender estatico: esta pagina publica consulta catalogos de DB
// (tipos de identificacion y vehiculos) en request time y NO lee cookies()/headers(),
// asi que Next intentaria prerenderizarla en build; sin DB eso rompe el build
// (Prisma P2021). Forzarla dinamica difiere la consulta al request real.
export const dynamic = "force-dynamic";

// Feature 21 — pagina PUBLICA de postulacion de mensajero (R1). Es la unica via
// de auto-registro. Acceso sin sesion ni cookie (R22): no se verifica ni concede
// sesion aqui, a diferencia de app/login/page.tsx. Server Component minimo: solo
// carga los catalogos publicos (tipos de identificacion y vehiculos) para
// poblar los selects; los datos NO son sensibles.

// Etiquetas de presentacion de los catalogos. Se mantienen aqui (capa de
// presentacion) y no en la DB, listas para i18n futura. El fallback a capitalizar
// el valor crudo dejo de ser una precaucion: desde que `vehiculos.name` es TEXT y
// el catalogo se administra por CRUD, un tipo nuevo NO tiene etiqueta aqui y sale
// capitalizado. Por eso la clave es `string` y no el enum.
const VEHICULO_LABELS: Record<string, string> = {
  moto: "Moto",
  carro: "Carro",
  camion: "Camión",
};

const TIPO_IDENTIFICACION_LABELS: Record<string, string> = {
  cedula: "Cédula",
  ruc: "RUC",
  pasaporte: "Pasaporte",
};

function capitalizar(valor: string): string {
  return valor.length > 0 ? valor[0].toUpperCase() + valor.slice(1) : valor;
}

export default async function PostulacionPage() {
  const prisma = getPrismaClient();
  const vehiculoRepo = new VehiculoRepository(prisma);

  const [vehiculos, tipos] = await Promise.all([
    vehiculoRepo.findMany(),
    prisma.tipoIdentificacion.findMany({ orderBy: { value: "asc" } }),
  ]);

  const vehiculoOptions: SelectOption[] = vehiculos.map((v) => ({
    value: v.id,
    label: VEHICULO_LABELS[v.name] ?? capitalizar(v.name),
  }));

  const tipoOptions: SelectOption[] = tipos.map((t) => ({
    value: t.id,
    label: TIPO_IDENTIFICACION_LABELS[t.value] ?? capitalizar(t.value),
  }));

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Panel de marca: visible desde md, oculto en movil para no forzar scroll */}
      <div className="relative hidden overflow-hidden bg-navy px-12 py-16 text-white md:flex md:w-1/2 md:flex-col md:justify-between lg:w-[45%]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(242,100,25,0.16),transparent_55%)]"
        />
        <div className="relative">
          <Logo />
          <div className="mt-3 h-1 w-10 rounded-full bg-brand" />
        </div>
        <p className="relative max-w-sm text-sm leading-relaxed text-white/70">
          Postúlate como mensajero y forma parte de la operación. Tu solicitud
          quedará pendiente de aprobación.
        </p>
      </div>

      {/* Panel de formulario. La salida a la landing ocupa su propia franja
        ARRIBA, en el flujo del flex, y el formulario se centra en el espacio
        que queda (el hijo `flex-1` con `justify-center`).

        Antes iba `absolute left-3 top-3` sobre un panel `relative`, para no
        empujar el formulario hacia abajo. Eso pisaba la tarjeta: con `py-12`
        la tarjeta arranca en y=48 en cuanto es más alta que el panel —ahí
        `justify-center` ya no centra nada— y el enlace, de 44 px desde y=12,
        acaba en y=56; su `hover:bg-muted` se metía sobre la esquina superior
        izquierda (medido aquí, con el formulario de 1420 px: franja de 54x8
        px). Con el enlace en el flujo el solape es imposible por
        construcción, no evitado con un desplazamiento afinado a mano que
        volvería a romperse al cambiar el tamaño de la tarjeta. Por eso el
        panel ya no necesita `relative`: era el ancla de ese absoluto y nada
        más colgaba de él.

        Va en ESTE panel y no en el de marca (`hidden ... md:flex`), porque en
        móvil el de marca no existe y es justo ahí donde esta es la única
        salida de la pantalla. */}
      <div className="flex flex-1 flex-col gap-6 bg-background px-6 py-12">
        <VolverAlInicioLink className="self-start" />
        <div className="flex flex-1 flex-col items-center justify-center gap-8">
          {/* Wordmark compacto, solo visible en movil */}
          <div className="md:hidden">
            {/* Feature 208: el wordmark de móvil vive sobre `bg-background`, que gira
              con el tema; en `navy` fijo medía 1.06:1 en oscuro. (El panel de marca de
              escritorio, `bg-navy` con texto blanco, es superficie FIJA y se conserva.) */}
            <Logo className="text-xl text-foreground" />
          </div>
          <PostulacionForm
            tiposIdentificacion={tipoOptions}
            vehiculos={vehiculoOptions}
          />
        </div>
      </div>
    </div>
  );
}
