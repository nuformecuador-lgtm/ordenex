"use client";

import { useEffect, useState, type ComponentType, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartColumn,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Gauge,
  History,
  Home,
  Megaphone,
  Package,
  Settings,
  ShieldAlert,
  Store,
  Trophy,
  Truck,
  User,
  Wallet,
  type LucideProps,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_ITEMS,
  type IconKey,
  type MenuItem,
} from "@/lib/auth/menu-visibility";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/shared/Logo";

type SidebarIcon = ComponentType<LucideProps>;

/** Datos mínimos del usuario para el footer del sidebar. */
export interface SidebarUsuario {
  nombre: string;
  /** Etiqueta legible del rol (p. ej. "Maestro"). */
  rolLabel: string;
}

/**
 * Iniciales del nombre para el avatar: máx 2 letras. Con ≥2 palabras toma la
 * inicial de las dos primeras; con una sola, sus dos primeras letras. Mayúsculas.
 */
function iniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return "?";
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
  return (palabras[0][0] + palabras[1][0]).toUpperCase();
}

/**
 * Footer del sidebar (esquina inferior izquierda): avatar con iniciales + nombre y
 * rol debajo. Al colapsar (`collapsible=icon`) el texto se oculta y queda solo el
 * avatar, centrado.
 */
function SidebarUsuarioFooter({ usuario }: { usuario: SidebarUsuario }) {
  return (
    <SidebarFooter className="border-t border-sidebar-border p-2">
      <div className="flex items-center gap-2 rounded-md p-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0">
        <div
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground"
        >
          {iniciales(usuario.nombre)}
        </div>
        <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
          <span className="truncate text-sm font-medium text-sidebar-foreground">
            {usuario.nombre}
          </span>
          {/* Feature 208: el rol iba en `/70` y medía 4.47:1 sobre el navy del
              sidebar en tema claro (4.54 en oscuro) — por debajo/al filo del 4.5
              de AA. A `/85` da 5.94 / 6.01 y sigue leyéndose como secundario
              frente al nombre, que va a opacidad plena. */}
          <span className="truncate text-xs text-sidebar-foreground/85">
            {usuario.rolLabel}
          </span>
        </div>
      </div>
    </SidebarFooter>
  );
}

/**
 * Botón circular de colapsar/expandir del sidebar en desktop. Va montado sobre
 * el borde derecho (patrón "rail"): mitad dentro, mitad fuera. Vive dentro del
 * <SidebarProvider> (se renderiza desde el layout), por lo que useSidebar()
 * tiene contexto. Se oculta en móvil: allí el off-canvas se controla con el
 * <SidebarTrigger>/Sheet de la cabecera.
 *
 * Color: mismo naranja que el <Button> por defecto ("Carga masiva") vía tokens
 * bg-primary / text-primary-foreground (--primary), sin hex hardcodeado.
 */
function SidebarCollapseToggle() {
  const { toggleSidebar, state } = useSidebar();
  const expanded = state === "expanded";
  // Expandido: el chevron apunta "hacia dentro" (izquierda) = acción colapsar.
  // Colapsado: apunta "hacia fuera" (derecha) = acción expandir.
  const Chevron = expanded ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={expanded ? "Colapsar menú" : "Expandir menú"}
      // top-full + -translate-y-1/2 → centrado sobre la línea header/content.
      // right-0 (arista de padding del header sin borde = borde del sidebar) +
      // translate-x-1/2 → mitad del botón sobresale fuera. hidden md:flex → solo
      // desktop. z-20 lo pone por encima de sus hermanos DENTRO del sidebar; quedar por
      // encima de la barra de filtros de la página es cosa del `z-30` del contenedor (ver
      // `SidebarRoot` más abajo), porque ése es el contexto de apilamiento que cuenta.
      className={cn(
        "absolute top-full right-0 z-20 hidden size-7 -translate-y-1/2 translate-x-1/2",
        "md:flex items-center justify-center rounded-full cursor-pointer",
        "bg-primary text-primary-foreground shadow-sm",
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
      )}
    >
      <Chevron className="size-5" aria-hidden="true" />
    </button>
  );
}

// Mapa iconKey -> componente de lucide. Vive en el cliente porque los datos que
// cruzan el borde RSC (menu-visibility) solo traen la clave string serializable;
// aqui la resolvemos al render.
//
// EXPORTADO desde la feature 318 (T1.2) para que el test de menu pueda comprobar en
// RUNTIME que toda `iconKey` declarada en SIDEBAR_ITEMS resuelve a un componente. El
// tipo `Record<IconKey, SidebarIcon>` sigue siendo la garantia FUERTE (una clave nueva
// sin entrada es error de typecheck); la exportacion solo abre la red de seguridad.
export const ICON_BY_KEY: Record<IconKey, SidebarIcon> = {
  home: Home,
  settings: Settings,
  user: User,
  package: Package,
  clipboardCheck: ClipboardCheck,
  truck: Truck,
  megaphone: Megaphone,
  trophy: Trophy,
  wallet: Wallet,
  // Feature 158 (T2.8): cola de incidentes. Icono propio, distinto del de "Cierres del
  // dia": un incidente no es un cierre.
  shieldAlert: ShieldAlert,
  // Feature 129: tablero de analitica. Icono propio (no otro existente).
  chartColumn: ChartColumn,
  // Feature 167: apartado de recoleccion en tienda. Icono propio, distinto del `truck` de
  // "Entregas": es la TIENDA a la que hay que ir, no la calle en la que se reparte. Es el
  // mismo icono que ya encabezaba el bloque de escaneo de la recoleccion, asi que el
  // lenguaje visual del mensajero no cambia.
  store: Store,
  // Feature 192 (R53): tablero del dia "Monitoreo". Icono PROPIO, distinto del
  // `chartColumn` de "Analitica": el cierre analitico del negocio y el pulso del dia en
  // curso son dos pantallas distintas.
  gauge: Gauge,
  // Feature 318 (R6): historico de conversaciones. Icono PROPIO, distinto del
  // `clipboardCheck` de "Cierres del dia" y del `chartColumn` de "Analitica": leer el
  // chat pasado no es cerrar el dia ni analizar el negocio.
  history: History,
};

// Entrada escalonada de los items al cargar (solo la primera vez). Cada item
// entra desplazandose de izquierda a derecha con un fade 0 -> 1; el retardo
// crece con el indice para que aparezcan uno tras otro.
const ENTRADA_DURACION_MS = 340;
const ENTRADA_STAGGER_MS = 80;

// Se usa TRANSICION (no @keyframes): el estado inicial y el final son clases
// normales y el retardo por item va en `transitionDelay`. Es mas predecible que
// las utilidades animate-in/slide-in de tw-animate-css, que dependen de
// variables de tema y se anulan enteras bajo prefers-reduced-motion.
const ENTRADA_TRANSICION = "ease-out will-change-[opacity,translate]";
/** Estado inicial: invisible y desplazado a la izquierda. */
const ENTRADA_OCULTO = "opacity-0 -translate-x-6";
/** Estado final: en su sitio, opaco. */
const ENTRADA_VISIBLE = "opacity-100 translate-x-0";

function entradaStyle(index: number): CSSProperties {
  return {
    // OJO: en Tailwind v4 `translate-x-*` usa la propiedad CSS `translate`, no
    // `transform`. Si solo se transiciona `transform` el desplazamiento no se
    // anima (solo el fade). Se declara aqui, inline, para no depender de que la
    // utilidad arbitraria transition-[...] se genere con la lista correcta.
    transitionProperty: "opacity, translate, transform",
    transitionDuration: `${ENTRADA_DURACION_MS}ms`,
    transitionDelay: `${index * ENTRADA_STAGGER_MS}ms`,
  };
}

/**
 * Fases de la entrada:
 * - `espera`: HTML del servidor y primer render en cliente. Los items estan
 *   ocultos (opacity 0). Sin esta fase la animacion arranca en el PRIMER PINTADO
 *   del HTML server-rendered, es decir antes de que la pagina se vea, y al
 *   recargar no se percibe nada.
 * - `animando`: se aplican las clases de animacion; corre la secuencia.
 * - `listo`: sin clases, estado final normal.
 */
type FaseEntrada = "espera" | "animando" | "listo";

// El Sidebar reexporta los tipos de dominio del menu para consumidores/tests.
export type SidebarItem = MenuItem;
export type { MenuChild as SidebarChild } from "@/lib/auth/menu-visibility";
export { SIDEBAR_ITEMS } from "@/lib/auth/menu-visibility";

export function Sidebar({
  items = SIDEBAR_ITEMS,
  usuario = null,
}: Readonly<{
  items?: readonly MenuItem[];
  /** Usuario autenticado para el footer (nombre + rol). `null` = sin sesión. */
  usuario?: SidebarUsuario | null;
}>) {
  const pathname = usePathname();
  // La animacion de entrada corre SOLO en la primera carga. El sidebar vive en
  // el layout y no se desmonta al navegar, pero los items con submenu si se
  // remontan (su `key` incluye el estado activo, que cambia con la ruta): sin
  // esta fase volverian a animarse en cada navegacion.
  const [fase, setFase] = useState<FaseEntrada>("espera");

  useEffect(() => {
    // Doble requestAnimationFrame: el navegador debe PINTAR el estado inicial
    // (oculto) antes de que cambie la clase, o no hay transicion que interpolar
    // y los items aparecerian de golpe.
    let interno = 0;
    const inicio = window.requestAnimationFrame(() => {
      interno = window.requestAnimationFrame(() => setFase("animando"));
    });
    const total = ENTRADA_DURACION_MS + items.length * ENTRADA_STAGGER_MS;
    const fin = window.setTimeout(() => setFase("listo"), total + 150);
    return () => {
      window.cancelAnimationFrame(inicio);
      window.cancelAnimationFrame(interno);
      window.clearTimeout(fin);
    };
  }, [items.length]);

  return (
    // `z-30` (pedido humano 2026-08-19): SUBE EL SIDEBAR ENTERO, y hay que saber por qué no
    // basta con subirle el z-index al botón de colapsar.
    //
    // Ese botón cuelga del `SidebarHeader`, que va dentro del contenedor `fixed … z-10` de
    // `components/ui/sidebar.tsx`. Un elemento posicionado CON z-index crea un contexto de
    // apilamiento: todo lo de dentro compite entre sí, pero contra el resto de la página el
    // bloque entero vale lo que valga el contenedor. Por eso el `z-20` del botón no lo sacaba
    // de debajo de la barra de filtros pegajosa de `/analítica` (también `z-20`, y posterior en
    // el DOM): no estaban compitiendo. Subir el contexto es lo único que lo levanta.
    //
    // El botón es la ÚNICA parte del sidebar que se solapa con la columna de contenido —sobre-
    // sale media anchura por el borde derecho (patrón «rail»)—, así que esto no tapa nada más.
    // Y sigue por debajo de `z-50`, que es donde viven los portales (modales, tooltips y los
    // desplegables de los filtros), que deben quedar encima de todo.
    //
    // Va aquí y no editando `components/ui/sidebar.tsx`: `cn` usa `tailwind-merge`, así que
    // esta clase gana al `z-10` del primitivo sin tocar el archivo vendorizado.
    <SidebarRoot collapsible="icon" className="z-30">
      {/* min-h-14 conserva el alto del logo al colapsar sin recortar el botón
          (que sobresale del borde); por eso NO se usa overflow-hidden aquí. */}
      <SidebarHeader className="px-3 py-4 relative min-h-14 justify-center">
        {/* Wordmark: visible cuando el sidebar está expandido. Mismo tratamiento
            que el icono: se mantiene siempre en el DOM y se cruza por opacidad
            (1 expandido → 0 colapsado) para que al expandir aparezca con un fade
            en lugar de un salto. Posición absoluta (alineado a la izquierda, como
            el padding del header) para que al colapsar no se envuelva en el rail
            angosto ni empuje el alto. */}
        <Logo
          className={cn(
            "absolute left-3 top-1/2 -translate-y-1/2 whitespace-nowrap text-base text-sidebar-foreground",
            "opacity-100 transition-opacity duration-300 ease-out",
            "group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0",
          )}
        />
        {/* Icono de marca: solo cuando está colapsado. Centrado en el ancho del
            rail y con fade de opacidad (0→1) para que no aparezca de golpe. Se
            mantiene siempre en el DOM (opacity-0 en expandido) para que la
            transición corra al colapsar en lugar de un display none→block seco. */}
        <img
          src="/icons/icon-192.png"
          alt="Ordenex"
          width={32}
          height={32}
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 rounded-md",
            "opacity-0 transition-opacity duration-300 ease-out",
            "group-data-[collapsible=icon]:opacity-100",
          )}
        />
        <SidebarCollapseToggle />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="Navegación principal">
              <SidebarMenu>
                {items.map((item, index) => {
                  const Icon = ICON_BY_KEY[item.iconKey];
                  const entrada =
                    fase === "listo"
                      ? { className: undefined, style: undefined }
                      : {
                          className: cn(
                            ENTRADA_TRANSICION,
                            fase === "espera" ? ENTRADA_OCULTO : ENTRADA_VISIBLE,
                          ),
                          style: entradaStyle(index),
                        };
                  if (item.children && item.children.length > 0) {
                    const childActive = item.children.some(
                      (child) => pathname === child.href,
                    );

                    return (
                      <Collapsible
                        // El estado activo entra en el key: al cambiar de ruta,
                        // childActive puede pasar de false a true (o viceversa) y
                        // defaultOpen es no-controlado. Sin remontar, Base UI avisa
                        // "changing the default open state after being initialized".
                        // Incluir childActive fuerza una instancia nueva por estado,
                        // manteniendo el submenu no-controlado sin el warning.
                        key={`${item.href}:${childActive}`}
                        defaultOpen={childActive}
                        className={cn("group/collapsible", entrada.className)}
                        style={entrada.style}
                        render={<SidebarMenuItem />}
                      >
                        <CollapsibleTrigger
                          render={
                            <SidebarMenuButton
                              isActive={childActive}
                              tooltip={item.label}
                            />
                          }
                        >
                          <Icon aria-hidden="true" />
                          <span>{item.label}</span>
                          <ChevronRight className="ml-auto transition-transform duration-200 group-data-[open]/collapsible:rotate-90" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item.children.map((child) => {
                              const isActive = pathname === child.href;
                              return (
                                <SidebarMenuSubItem key={child.href}>
                                  <SidebarMenuSubButton
                                    isActive={isActive}
                                    render={
                                      <Link
                                        href={child.href}
                                        aria-current={
                                          isActive ? "page" : undefined
                                        }
                                      />
                                    }
                                  >
                                    <span>{child.label}</span>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              );
                            })}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  }
                  const isActive = pathname === item.href;
                  return (
                    <SidebarMenuItem
                      key={item.href}
                      className={entrada.className}
                      style={entrada.style}
                    >
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={item.label}
                        render={
                          <Link
                            href={item.href}
                            aria-current={isActive ? "page" : undefined}
                          />
                        }
                      >
                        <Icon aria-hidden="true" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {usuario ? <SidebarUsuarioFooter usuario={usuario} /> : null}
    </SidebarRoot>
  );
}
