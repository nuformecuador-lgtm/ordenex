# 65-lestura-de-qr — requirements.md

Feature id 65 · zone: frontend · complexity: low · branch: feature/65-lestura-de-qr ·
depends_on: null

Página de lectura de código QR accesible desde el menú lateral para todos los
roles. El usuario abre la página, activa la cámara, escanea un código QR que
codifica una ruta interna de la app, y es redirigido a esa ruta. Sin backend
nuevo, sin migraciones, sin Server Actions.

Notación EARS. Requisitos verificables mediante pruebas manuales en navegador
(Chrome/Edge con cámara real o modo dispositivo) y chequeo de archivos en disco.

---

## Menú de navegación

- **R1 — Ubicuo.** El sistema DEBE incluir un ítem "QR" en el menú lateral
  (`SIDEBAR_ITEMS` en `lib/auth/menu-visibility.ts`) visible para todos los roles
  (`maestro`, `admin`, `mensajero`, `adminTienda`, `adminSatelite`), usando
  `ROLES_SEED` como arreglo de roles.

- **R2 — De estado.** MIENTRAS el usuario esté autenticado, el sistema DEBE
  mostrar el ítem "QR" en el menú lateral con el icono `QrCode` de `lucide-react`
  y enlace a `/qr`.

- **R3 — De estado.** MIENTRAS el usuario NO esté autenticado (rutas públicas
  como `/login`), el sistema NO DEBE mostrar el ítem "QR" en el menú lateral.

## Página del escáner QR

- **R4 — Ubicuo.** DEBE existir una página en `app/(app)/qr/page.tsx` que
  resuelva la sesión server-side (`resolveActorFromSession`) y muestre un lector
  de códigos QR usando la cámara trasera del dispositivo.

- **R5 — De seguridad.** SI el usuario no tiene sesión válida (cookie ausente o
  expirada), la página DEBE redirigir a `/login` (vía el guard del
  `middleware.ts`).

- **R6 — Por evento (cámara).** CUANDO el usuario abre la página por primera vez,
  el sistema NO DEBE activar la cámara automáticamente; DEBE mostrar un botón
  "Escanear con cámara" que active el lector al pulsarlo.

- **R7 — Por evento (escaneo).** CUANDO el lector de cámara decodifica un código
  QR, el sistema DEBE extraer la ruta del texto decodificado, desactivar la
  cámara y redirigir al usuario a esa ruta dentro de la misma app.

- **R8 — Condicional (ruta inválida).** SI el texto decodificado del QR no
  contiene una ruta interna válida de la app, el sistema DEBE mostrar un mensaje
  de error ("El código QR no contiene una ruta válida de la app") y DEBE permitir
  volver a escanear.

- **R9 — Condicional (cámara denegada).** SI el usuario deniega el permiso de
  cámara o el dispositivo no tiene cámara disponible, el sistema DEBE mostrar un
  mensaje de error ("No se pudo acceder a la cámara. Verifica los permisos del
  navegador.") y DEBE mantener el botón de escaneo accionable para reintentar.

- **R10 — De estado (cámara activa).** MIENTRAS la cámara está activa y
  escaneando, el sistema DEBE mostrar el visor de cámara (`<div>` renderizado por
  `Html5Qrcode`) y un botón "Cerrar cámara" que detenga el lector y oculte el
  visor.

- **R11 — De estado (procesando).** MIENTRAS el sistema está procesando un QR
  decodificado (validando la ruta + redirigiendo), el sistema DEBE mostrar un
  indicador de carga y NO DEBE permitir un segundo escaneo simultáneo.

- **R12 — Condicional (cámara cerrada tras escaneo exitoso).** SI un QR se
  decodifica y la ruta es válida, el sistema DEBE cerrar la cámara antes de
  redirigir, de modo que al volver atrás la cámara no quede activa.

## Responsive y accesibilidad

- **R13 — Ubicuo (responsive).** La página DEBE centrar el contenido vertical y
  horizontalmente, con un ancho máximo `max-w-sm` en desktop y ancho completo en
  móvil, usando Tailwind CSS. El diseño DEBE ser legible en dispositivos de 320px
  de ancho o más.

- **R14 — Ubicuo (accesibilidad).** El botón "Escanear con cámara" DEBE ser
  operable por teclado (elemento `<button>`) y tener etiqueta accesible. El visor
  de cámara DEBE tener un `aria-label` descriptivo.

## No regresiones

- **R15** `pnpm typecheck` DEBE pasar sin errores.
- **R16** `pnpm build` DEBE compilar sin errores.
- **R17** Los tests existentes NO DEBEN romperse (`pnpm test` pasa sin
  regresiones).

---

## Decisiones cerradas (humano, 2026-07-15)

- **[RESUELTO-A] Ruta de la página: `/qr`.** Se usa una ruta plana dentro del
  grupo autenticado `(app)`, sin parámetros dinámicos ni subrutas. Ver
  `design.md`.
- **[RESUELTO-B] Biblioteca: `html5-qrcode` v2.3.8.** Ya instalada y usada en
  `EscanerRecepcion.tsx` (feature 33). No se introduce nueva dependencia. Ver
  `design.md`.
- **[RESUELTO-C] Validación de ruta: misma-origen.** El QR codifica una URL
  completa; el sistema extrae el `pathname` + `search` y solo redirige si el
  `origin` es el mismo de la app. Ver `design.md`.
