import type { RolValue } from "@prisma/client";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Sidebar } from "./_components/Sidebar";
import { ToastProvider } from "@/providers/ToastProvider";
import { AvisoVersionNueva } from "@/components/shared/AvisoVersionNueva";
import { PushReactivacion } from "@/components/shared/PushReactivacion";
import { RevisionSinpeBodega } from "@/components/shared/RevisionSinpeBodega";
import { TemaProvider } from "@/providers/TemaProvider";
import { AyudaProvider } from "@/providers/AyudaProvider";
import { leerResumenesAyuda } from "@/lib/ayuda/catalogo";
import { mapaRutaDocumento } from "@/lib/ayuda/documento";
import { COOKIE_TEMA, normalizarTema } from "@/lib/tema/tema";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { resolverRevisionSinpePendiente } from "@/lib/auth/revision-sinpe-pendiente";
import { puedeEditarAlgunSinpe } from "@/lib/types/sinpe-bodega";
import { itemsVisibles, SIDEBAR_ITEMS } from "@/lib/auth/menu-visibility";
import { ROL_LABELS } from "@/lib/auth/rol-label";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { UsuarioPreferenciaRepository } from "@/lib/repositories/UsuarioPreferenciaRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { nombreCompletoUsuario } from "@/lib/utils/nombre-usuario";

export default async function AppLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const actor = await resolveActorFromSession();
  const items = itemsVisibles(SIDEBAR_ITEMS, actor);

  // Feature 211 — el tema se resuelve EN EL SERVIDOR, aquí y no en el layout raíz.
  // Aquí ya se estaba leyendo la sesión, así que este layout ya era dinámico y la cookie
  // no cuesta nada; hacerlo arriba volvería dinámica la landing pública, que hoy es
  // estática y se cachea. Al llegar el HTML con la clase puesta no hay parpadeo: no se
  // corrige nada después del primer pintado porque no hay nada que corregir.
  const tema = normalizarTema((await cookies()).get(COOKIE_TEMA)?.value);

  // Datos del usuario para el footer del sidebar (nombre completo + rol legible). Se resuelve
  // el nombre por id (el actor solo trae usuarioId + rol). Sin sesión -> null. Se pinta la
  // identidad COMPLETA —nombre y apellidos—: es el único sitio donde la persona se reconoce a
  // sí misma en la aplicación, y dos mensajeros con el mismo nombre de pila veían el mismo pie.
  //
  // FICHA 422 (T5.2 — R14, R18, R24) — y, en la MISMA espera, la preferencia de avisos de esa
  // persona. Se lee AQUÍ, en el servidor, y baja por props: es un dato privado, y el patrón de
  // `docs/architecture.md` para eso es el componente padre que ya resolvió al actor. Una acción de
  // lectura desde el cliente sería una ida y vuelta más por carga para un dato que el servidor ya
  // tiene en la mano. `avisosPushDe` NO crea ninguna fila al leer.
  //
  // Las dos lecturas van en `Promise.all` y no encadenadas a propósito: este layout se pinta en
  // TODAS las páginas del portal, así que una segunda consulta en serie le sumaría su latencia a
  // cada carga. En paralelo, el coste en tiempo es el de la más lenta de las dos.
  //
  // ⭑ FICHA 429 (T19 — R26, R28, R31) — LA TERCERA LECTURA: ¿hay un SINPE que poner delante de
  // esta persona? `null` es la respuesta NORMAL; la mayoría de las cargas del portal no piden
  // nada. Sale del SERVIDOR y con la zona que la BASE le asigna al actor, nunca con un dato que
  // venga en la petición (R20).
  //
  // ⚠️ LOS QUE NO PAGAN NI UNA CONSULTA (R31). `mensajero`, `adminTienda` y las cuentas de API
  // no entran en el `Promise.all`: la tercera posición es `null` LITERAL, así que ni se crea la
  // promesa ni se construye el `ZonaRepository`. Este layout se pinta en TODAS las páginas del
  // portal, y una consulta de más para quien no puede hacer nada con ella se paga en todas.
  //
  // ⚠️ ESTO NO DECIDE ACCESO (R28). Es un dato para PINTAR un aviso: ninguna rama de aquí
  // redirige, ninguna devuelve 403 y ninguna deja de pintar `{children}`.
  const pideRevisionSinpe = actor !== null && puedeEditarAlgunSinpe(actor.rol);
  const [usuarioRow, avisosRecordados, revisionSinpe] = actor
    ? await Promise.all([
        new UserRepository(getPrismaClient()).findById(actor.usuarioId),
        new UsuarioPreferenciaRepository(getPrismaClient()).avisosPushDe(actor.usuarioId),
        pideRevisionSinpe
          ? resolverRevisionSinpePendiente(actor, new ZonaRepository(getPrismaClient()))
          : null,
      ])
    : ([null, false, null] as const);
  const usuario =
    actor && usuarioRow
      ? { nombre: nombreCompletoUsuario(usuarioRow), rolLabel: ROL_LABELS[actor.rol] }
      : null;

  // ⭑ FICHA 433 — EL MAPA RUTA→DOCUMENTO DEL «?» DEL ENCABEZADO, acotado por rol.
  //
  // Se resuelve AQUÍ y baja por props (al proveedor) por la razón de `docs/architecture.md`:
  // el dato depende de la sesión, y el único que la tiene resuelta es este layout. El botón
  // vive en `PageHeader`, que es presentación pura y se monta desde páginas server Y client.
  //
  // ⚠️ `mapaRutaDocumento(..., actor.rol)` RECORTA ANTES DE CRUZAR AL CLIENTE. Lo que viaja
  // son sólo las rutas cuyo documento esta persona puede leer, así que un mensajero no
  // recibe ni el slug de la ayuda de Wallet. Si el acotamiento se hiciera en el botón, el
  // mapa entero estaría en el HTML de cualquiera.
  //
  // NO CUESTA UNA CONSULTA A LA BASE: son 31 archivos del repositorio, leídos una vez por
  // proceso y memorizados (`leerCatalogoAyuda`). Este layout se pinta en TODAS las páginas
  // del portal y por eso importa que el coste por carga sea cero.
  const mapaAyuda = await mapaAyudaDelActor(actor?.rol ?? null);

  return (
    <TemaProvider temaInicial={tema}>
      <ToastProvider>
        <SidebarProvider>
          <Sidebar items={items} usuario={usuario} />
          {/* overflow-x-clip: la columna de contenido nunca empuja el ancho más
              allá del viewport (evita scroll horizontal accidental en responsive).
              El contenido genuinamente ancho (tablas) scrollea dentro de su propio
              contenedor overflow-x-auto, así que este clip no lo recorta. clip (no
              hidden) para no convertir el main en contenedor de scroll vertical. */}
          {/* `pb-12` (48px): aire al final de TODAS las páginas del portal. Sin él, el
              último elemento queda pegado al borde inferior y, en el módulo del mensajero,
              debajo del botón flotante del chat. */}
          {/* `data-rol` + `group/app`: el rol del actor viaja por CSS hasta el `PageHeader`,
              que se tiñe con un color claro distinto por portal (pedido humano). Se pone aquí
              porque es el único sitio que ya resuelve al actor; el header sigue siendo
              presentación pura, usable desde páginas server y client. */}
          <SidebarInset
            data-rol={actor?.rol}
            className="group/app overflow-x-clip pb-12"
          >
            <SidebarTrigger className={"relative md:hidden"} />
            {/* ⭑ Ficha 433 — el proveedor envuelve SÓLO a `{children}` porque es ahí donde
                vive el `PageHeader` que consume el mapa, y así el cambio no re-indenta el
                resto del layout. No pinta ninguna caja: es un proveedor de contexto. */}
            <AyudaProvider mapa={mapaAyuda}>{children}</AyudaProvider>
          </SidebarInset>
        </SidebarProvider>
        {/* Feature 284 — aviso de version nueva del service worker. Va en el portal y no en el
            layout raiz: aqui viven las sesiones de trabajo (y la PWA instalada), y el layout
            raiz cubre ademas la landing publica, que hoy es estatica y no necesita este JS.
            El componente decide solo cuando pintarse; mientras el usuario tenga algo a medias
            no aparece. */}
        <AvisoVersionNueva />
        {/* Ficha 422 — la reactivación silenciosa de los avisos. Va aquí, y solo aquí, por dos
            razones que no son de estilo:
              · R24 — este layout NO SE PINTA sin sesión, así que nada puede intentar reactivar a
                quien no ha entrado. Montarlo en el layout raíz lo intentaría en la landing.
              · R23 — el layout persiste entre navegaciones del portal, así que el intento ocurre
                una vez por CARGA y no una por página visitada.
            Dentro del panel de la campana no serviría: ese panel es un portal sin `keepMounted` y
            no existe hasta que alguien ABRE la campana — justo el gesto que esta ficha evita.
            La guardia `push-alta-punto-unico.guardia.test.ts` exige que éste sea el único montaje
            del árbol. El componente no pinta nada: decide solo y en silencio. */}
        {actor && <PushReactivacion avisosRecordados={avisosRecordados} />}
        {/* ⭑ Ficha 429 (T19/T22 — R26/R28) — el aviso de la revisión del primer ingreso.
            ⚠️ HERMANO de `{children}`, JAMÁS envolviéndolo, y montado justo aquí al lado de
            `PushReactivacion` por el mismo motivo por el que aquel vive aquí: este layout no se
            pinta sin sesión, y persiste entre navegaciones del portal, así que el aviso aparece
            una vez por CARGA y no una por página visitada.
            Un envoltorio PODRÍA dejar de pintar el contenido con un `return null`; un hermano no
            tiene dónde hacerlo — eso es lo que hace R28 estructural en vez de una promesa, y
            `revision-sinpe-no-bloquea.guardia.test.ts` lo vigila sobre la forma del árbol.
            La condición es el DATO, no el rol: `resolverRevisionSinpePendiente` ya devolvió
            `null` para todo el que no tenga nada que revisar. */}
        {actor && revisionSinpe && <RevisionSinpeBodega bodega={revisionSinpe} />}
      </ToastProvider>
    </TemaProvider>
  );
}

/**
 * ⭑ FICHA 433 — EL MAPA DEL «?», Y LA RAZÓN DE QUE ESTA FUNCIÓN EXISTA: **la ayuda puede
 * fallar; el portal no.**
 *
 * Este layout se pinta en TODAS las páginas de la zona autenticada, así que lo que se rompa
 * aquí no rompe el módulo de ayuda: rompe la aplicación entera. Y la lectura del catálogo es
 * la única pieza de este layout que depende de que 31 archivos estén en el disco de la función
 * —un trazado mal declarado, un archivo ilegible— en vez de de la base de datos.
 *
 * Sin este `catch`, un tropiezo de lectura daría un 500 en `/ordenes`, en `/monitoreo` y en
 * todo lo demás. Con él, lo único que se pierde es el «?»: el mapa vacío hace que `AyudaBoton`
 * no se pinte (su salida temprana), que es exactamente el fallo seguro que el módulo ya aplica
 * en `useMapaAyuda`. Degradar la ayuda es aceptable; tumbar el portal, no —y es la condición
 * que el humano puso a las cuatro funcionalidades de SF-001: no dañar lo que ya funciona—.
 *
 * El error NO se traga en silencio (`docs/conventions.md`): se vuelca a `console.error`, que es
 * lo que se lee en los logs de Vercel cuando alguien pregunte por qué no hay «?». Y el catálogo
 * NO se queda envenenado: `leerCatalogoAyuda` limpia su memoria al rechazar, así que la
 * siguiente carga vuelve a intentarlo.
 */
async function mapaAyudaDelActor(rol: RolValue | null): Promise<Record<string, string>> {
  try {
    return mapaRutaDocumento(await leerResumenesAyuda(), rol);
  } catch (error) {
    console.error("[ayuda] no se pudo leer docs/ayuda; el portal sigue sin «?»", error);
    return {};
  }
}
