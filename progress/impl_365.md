# Ficha 365 — Red para errores de render

- **Rama:** `feature/365-red-para-errores` · **árbol:** `R:\wt\349`
- **Fecha:** 2026-09-02
- **Punto de partida medido:** NI UN `error.tsx` ni `global-error.tsx` en todo el árbol. Cualquier
  fallo de render dejaba al usuario sin pantalla, incluida la aprobación de cierres.

---

## 1. Dónde se puso la red, y por qué ahí

**Tres archivos, tres alturas. No son tres copias: cada uno cubre lo que el de abajo no puede.**

Un `error.tsx` se renderiza **DENTRO** del layout de su propio segmento. De ahí sale toda la
geometría:

| Archivo | Cubre | Lo que NO puede cubrir |
|---|---|---|
| `app/(app)/error.tsx` | las páginas de las 16 secciones del portal y sus subrutas | `app/(app)/layout.tsx` (sesión, sidebar, tema) |
| `app/error.tsx` | ese layout del portal **+** las 5 rutas públicas (`/login`, landing, `/paquete`, `/postulacion`, `/recuperar-contrasena`), que no tenían ninguna red | `app/layout.tsx` |
| `app/global-error.tsx` | el layout raíz (fuentes, service worker, `metadataBase`) | — |

**Una sola para el portal, no dieciséis.** La frontera de la raíz del grupo protege su segmento y
todo lo que cuelga debajo. Dieciséis copias del mismo texto no cubrirían nada nuevo y divergirían
a la primera corrección. **La regla que se siguió: se añade frontera de sección sólo cuando esa
sección necesita decir algo DISTINTO, no por simetría.**

**Y hay exactamente una así: `app/(app)/cierres-admin/error.tsx`.** No por importancia simbólica
del dinero, sino por un hecho verificable: en esa pantalla **«reintentar» no es evidentemente
inocuo**. Las acciones de aprobar/rechazar capturan su propio error y avisan por `toast`
(`CierresAdminModule`), así que un fallo de la acción no llega a la frontera; lo que sí llega es un
fallo al RENDERIZAR — y el render se dispara también con el `router.refresh()` que va **después de
una aprobación correcta**. O sea: esa pantalla de error puede aparecer con el cierre ya resuelto.

Por eso ahí **no se escribe «no se guardó nada»** (sería el tranquilizante que no podemos
sostener) sino lo que sí es cierto y accionable: *«Antes de repetir una aprobación, mirá cómo
quedó»*. Hay un test que prohíbe explícitamente la frase tranquilizadora.

**`global-error.tsx` sí hacía falta**, y con un caso concreto de este repo: `app/layout.tsx`
construye `metadataBase` con `new URL(process.env.NEXT_PUBLIC_SITE_URL ?? …)`, un `URL` que
**lanza** si esa variable llega mal escrita desde el panel de Vercel. No es hipotético.

**Reuso, no invención.** `app/(app)/error.tsx` y el de cierres montan `AppPage` —el único armazón
de página del repo (DESIGN.md)—, así que la pantalla de error conserva sidebar, `PageHeader` con
su `<h1>`, el tinte por rol y los controles. Y el cuerpo es `EmptyState` + `Button`, el vocabulario
que la app ya usa para «mensaje centrado + salida». **No parece una página rota de otro sitio.**

Nota deliberada sobre `global-error.tsx`: es el ÚNICO archivo con estilos en línea y hex crudos.
Sustituye al documento entero, y si el layout raíz no llegó a renderizar nada garantiza que su hoja
de estilos esté en el documento: una pantalla hecha con clases de Tailwind podría salir sin ningún
estilo. Es la misma decisión que toma la pantalla interna de Next. Los valores son los de
`--color-navy-deep` y `--color-brand`.

---

## 2. Cómo se garantizó que el error SIGUE llegando al registro

### 2.1 Lo que se descubrió leyendo Next 16.2.10 (no suponiendo)

`node_modules/next/dist/client/react-client-callbacks/error-boundary-callbacks.js`:

- **SIN un `error.tsx` propio**, el límite que atrapa el fallo es el interno de Next, y Next lo
  trata como NO capturado (`isImplicitErrorBoundary` → `onUncaughtError` → `reportGlobalError`,
  que es `reportError` del navegador: **un evento `error` en `window`**, el canal que ve cualquier
  monitor).
- **CON un `error.tsx` propio**, se va por la otra rama y en producción queda
  `originConsoleError(thrownValue)` — **una línea de consola, no un evento global**.

O sea: **poner la red, sin más, DEGRADA la señal del lado cliente.** Nadie lo nota, porque la
pantalla mejora. Es exactamente la mordaza que la ficha venía a evitar.

`lib/errors/reemitir-en-cliente.ts` la repone: `reportError` (con `console.error` de respaldo donde
no exista), de-duplicado **por identidad del objeto** —React entrega el mismo objeto mientras la
frontera siga montada, así que «mismo objeto» = «misma ocurrencia»— para que un re-render no
multiplique la línea. La llaman `ErrorState` (y por tanto las tres fronteras que la montan) y
directamente `global-error.tsx`.

### 2.2 Lo del SERVIDOR es independiente, y se midió

Un fallo de render de Server Component se registra en el servidor **antes** de que ninguna frontera
lo vea (`server/app-render/create-error-handler.js` → `onReactServerRenderError` →
`instrumentation.onRequestError` + el log del proceso). `error.tsx` **no puede silenciarlo**.

**Medido a mano contra `next dev --webpack` en el puerto 3010**, provocando el fallo real de la
ficha (`Cannot read properties of undefined (reading 'map')`) en `app/(app)/ordenes/page.tsx`:

```
⨯ TypeError: Cannot read properties of undefined (reading 'map')
    at OrdenesPage (app\(app)\ordenes\page.tsx:52:42)
> 52 |   const _provocado = catalogoRoto.items!.map((x) => x);
     |                                          ^                    {
  digest: '3839093327'
}
 GET /ordenes 500 in 12.7s
[browser] Uncaught TypeError: Cannot read properties of undefined (reading 'map')
    at OrdenesPage (app\(app)\ordenes\page.tsx:52:42)
    at ErrorDelPortal (app\(app)\error.tsx:41:7)
```

**Comparación con el estado ANTERIOR a la ficha** (se apartaron los tres archivos y se recargó):

| | Sin red (pre-365) | Con la red |
|---|---|---|
| Línea `⨯ TypeError` + code frame + `digest` en el servidor | **sí** | **sí, idéntica** |
| `GET /ordenes 500` | **sí** | **sí** (la red NO convierte el 500 en 200) |
| `[browser] Uncaught …` | **sí** (`reportGlobalError` de Next) | **sí** (nuestro `reemitirEnCliente`) |
| Lo que ve el usuario | página interna de Next, **en inglés**, «This page couldn't load», único botón «Reload», sin `role="alert"`, sin salida a ninguna parte | ver §3 |

Y el `digest` que sale impreso en la línea del servidor (`3839093327`) es **exactamente** el código
que se le enseña al usuario en pantalla. La correlación es literal.

---

## 3. Qué ve el usuario

**Nunca:** `message`, `stack`, `cause`, ni el error serializado. Hay guardia que lo sostiene (§5).
**Sí:** el `digest`, que es un hash de mensaje+stack calculado por Next — no lleva datos, y es la
clave con la que se encuentra la línea en el registro.

- **Portal (`/ordenes`, `/monitoreo`, `/wallet`…):** `<h1>` «No pudimos cargar esta pantalla» ·
  «Falló al preparar la información. No es algo que hayas hecho mal.» · aviso en `role="alert"`
  con icono de advertencia en el par semántico de `danger` · **Reintentar** + **Ir al inicio**
  (`/dashboard`, que reparte por rol) · «Código del error: 3839093327».
- **Cierres (`/cierres-admin`):** `<h1>` «No pudimos cargar los cierres» · «Antes de repetir una
  aprobación, mirá cómo quedó» · «El fallo ocurrió al mostrar la pantalla, y eso también puede
  pasar justo después de guardar. Volvé a cargar los cierres y revisá el estado del que estabas
  resolviendo antes de aprobarlo o rechazarlo otra vez.» · **Volver a cargar los cierres** +
  **Ir al inicio**.
- **Raíz y pública:** «No pudimos cargar la página» · salida a `/` (sirve con sesión y sin ella).
- **Global:** «No pudimos cargar la aplicación» · **Recargar la página** (recarga dura: `reset()`
  volvería a montar lo mismo) + enlace duro a `/`.

**El reintento es `router.refresh()` + `reset()`, no sólo `reset()`.** `reset()` a secas vacía el
estado de la frontera y vuelve a renderizar la misma carga rota: el botón parecería muerto. Va en
una transición para que el botón pueda decir que está trabajando.

**Registro:** se usa **voseo** en todo («Probá», «Volvé», «mirá», «Si nos escribís»), que es la
forma mayoritaria de la app y la corriente en Costa Rica. La ficha 331 (voseo/tuteo) sigue abierta
y es decisión del humano; si adopta otra forma, estos textos entran en ese barrido como cualquier
otro. Todos son props, no literales enterrados.

---

## 4. Navegador, 1440 y 390

Un solo servidor (`next dev --webpack --port 3010`, `localhost`), Playwright, rol `admin`.

- **1440×900:** sidebar intacto, `PageHeader` con el tinte del portal, contenido centrado.
  Sin scroll horizontal.
- **390×844:** sidebar plegado a su botón, el `<h1>` envuelve en tres líneas, los dos botones se
  apilan. Sin scroll horizontal.
- **Tema oscuro comprobado en el navegador** (cookie `ordenex_tema=oscuro`): el disco del icono
  toma `dark:bg-danger/15` (leído: `oklab(… / 0.15)`) y la tinta `rgb(248,113,113)` =
  `--danger-strong` oscuro. Es el mismo par que ya usa `Badge` variante `danger`, medido en
  `contraste-tokens.guardia.test.ts`.
- **El reintento se probó con el ratón**, no sólo con dobles: el click disparó
  `GET /cierres-admin?_rsc=…` y el servidor volvió a registrar `⨯ TypeError`. O sea: pide datos de
  verdad.
- **La cadena de escalones se comprobó apartando archivos**: sin `(app)/error.tsx` cae en
  `app/error.tsx` (se pierde el sidebar, se conserva la pantalla); sin ése, en `global-error.tsx`;
  sin ninguno, la página inglesa de Next.

---

## 5. Verificación

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | **verde** |
| `pnpm lint` | **0 errores** (147 warnings, todos heredados) |
| `pnpm exec vitest run guard` (181 archivos) | **1 rojo: `superficie-de-uso` por `lib/actions/tarifas.ts:67`**, el heredado tolerado. Todo lo demás verde |
| `pnpm exec vitest run --changed origin/dev` | **171 archivos, 2550 tests, verde** |
| tests nuevos (46) | verde |

**`html-lang.guardia.test.ts` se puso ROJA con esta ficha, e hizo lo que dice su cabecera:** su
censo afirma cuántos documentos HTML completos hay en el árbol para que un cuarto no aparezca mudo.
`global-error.tsx` es ese cuarto (declara `lang="es"`). Se registró en el censo con su motivo.

### Tests nuevos

- `tests/unit/errors/reemitir-en-cliente.test.ts` (6) — la pieza sola: emite por `reportError`,
  cae a `console.error`, emite el objeto entero (con su `stack`), no repite la misma ocurrencia,
  **sí** emite una ocurrencia nueva con el mismo mensaje.
- `tests/components/RedDeErrores.test.tsx` (27, jsdom) — monta el `export default` **real** de las
  cuatro fronteras, con los MISMOS proveedores que el layout del portal (no un doble: `AppPage` →
  `PageHeader` → `LogoutButton` llama a `useToast()` y lanza sin `ToastProvider`). Una garantía,
  un test: se ve el aviso · se puede reintentar (exige `router.refresh()` **y** `reset()`) · hay
  salida · **el error se re-emite** · no se pinta el detalle técnico · sí se pinta el `digest` ·
  se calla cuando no hay `digest` · la frontera del dinero dice lo suyo y **no** promete que no se
  guardó nada.
- `tests/unit/guards/red-de-errores.guardia.test.ts` (13) — censa `app/**`: las tres fronteras
  existen, **toda** frontera del árbol re-emite, ninguna pinta detalle técnico, el re-emisor
  conserva sus dos canales. Con no-vacuidad y cada detector probado contra código que sí infringe.

### Mutaciones (5 aplicadas, 5 revertidas)

| # | Mutación | Rojo real |
|---|---|---|
| 1 | quitar `reemitirEnCliente(error)` de `ErrorState` (**la mordaza**) | `RedDeErrores.test.tsx` ×4 (`AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`) + guardia `red-de-errores` («la pantalla compartida es la que re-emite»). **Y en el navegador**: la línea `[browser] Uncaught TypeError…` **desapareció del log del servidor** (2 ocurrencias → 0) y Playwright dejó de recibir `pageerror`. Es la prueba de que la degradación de §2.1 es real y de que el re-emisor la repara |
| 2 | pintar el detalle técnico: `<code>{(error as Error).message}</code>` | `RedDeErrores.test.tsx` ×6. ⚠️ **La guardia SOBREVIVIÓ en verde** — ver abajo |
| 3 | reintento sin `router.refresh()` (sólo `reset()`) | `RedDeErrores.test.tsx` ×2 («el reintento PIDE LOS DATOS DE NUEVO», «su botón de reintento nombra lo que hace») |
| 4 | borrar `app/(app)/error.tsx` | guardia `red-de-errores`: «existe app/(app)/error.tsx» |
| 5 | quitar `role="alert"` de `ErrorState` | `RedDeErrores.test.tsx` ×2 (`Unable to find an accessible element with the role "alert"`) |

**La mutación 2 sobrevivió en la guardia, y se dice.** El detector estaba acotado a
`/\berror\s*\.\s*(message|stack|cause)\b/`, y `(error as Error).message` **cuela un `as Error)`
entre `error` y el punto**: no casaba. Los tests de componente sí la mataron, pero la guardia
—que es la que protege el árbol después del merge— no. Se robusteció a `/\.\s*(message|stack|cause)\b/`
(romo a propósito: los cinco archivos vigilados son pequeños y hoy no tienen ningún uso legítimo de
esas tres propiedades, así que no cuesta falsos positivos). Con el detector nuevo, la misma mutación
pone rojo y **nombra el archivo**: `expected [ 'components/shared/ErrorState.tsx' ] to deeply equal []`.
La mutación quedó escrita como caso positivo del detector para que nadie la reintroduzca.

---

## 6. Lo dudoso, dicho en voz alta

1. **`app/(app)/error.tsx` depende de los proveedores del layout del portal.** Monta `AppPage` →
   `PageHeader` → `LogoutButton`, que llama a `useToast()` y **lanza** fuera de un `ToastProvider`.
   En la app no puede pasar (la frontera se renderiza dentro de ese layout, que ya los trae), y si
   pasara, React escala a `app/error.tsx`, que no depende de nada de eso — comprobado apartando
   archivos. Es un riesgo real pero acotado y con red debajo. La alternativa —una pantalla de error
   sin el armazón de la app— incumplía el encargo de que se pareciera al resto.
2. **`children` de `ErrorState` se retiró antes de cerrar**: no lo usaba ningún consumidor y una
   prop sin consumidor es superficie muerta.
3. **`EmptyState` ganó una prop, `iconClassName`**, para que el disco del icono pueda ir en el par
   de `danger` en vez del `bg-muted` neutro. Es lo único que, de un vistazo y antes de leer, separa
   «algo se rompió» de «aquí no hay nada» — el riesgo central de esta ficha. Es puramente aditiva:
   el default reproduce el render de siempre, y `EmptyState.test.tsx` + `DataTable.test.tsx` +
   los 171 archivos de `--changed` siguen verdes.
4. **En `dev` el `digest` cambia entre recompilaciones** (se calcula sobre mensaje + stack). Dentro
   de una misma versión compilada es estable — se midió: dos cargas seguidas dieron `2641025031` las
   dos veces. En producción no hay recompilación, así que el código que dicte el usuario y el de la
   línea del log serán el mismo.
5. **Hay dos `role="alert"` en la página real**: el nuestro y el `__next-route-announcer__` de Next,
   que va vacío. No es un conflicto de accesibilidad (el suyo no tiene contenido), pero conviene
   saberlo si alguien escribe un E2E con `getByRole("alert")` sin filtrar.
6. **No se tocó `instrumentation.ts`** (no existe en el repo). Enchufar un monitor de errores real
   —que es lo que daría valor pleno al `reportError` del cliente— es otra ficha; hoy la señal llega
   al log de runtime de Vercel por el canal del servidor y al canal global del navegador, que es
   exactamente donde llegaba antes.
7. **Ninguna de las otras 15 secciones recibió frontera propia**, a propósito. Si alguna resulta
   tener un consejo distinto que dar (candidata evidente: `/cierre-dia`, donde el mensajero
   solicita su cierre), se añade entonces y con su motivo escrito, no por simetría.

---

## 7. Archivos

**Nuevos**
- `lib/errors/reemitir-en-cliente.ts`
- `components/shared/ErrorState.tsx`
- `app/(app)/error.tsx`
- `app/(app)/cierres-admin/error.tsx`
- `app/error.tsx`
- `app/global-error.tsx`
- `tests/unit/errors/reemitir-en-cliente.test.ts`
- `tests/components/RedDeErrores.test.tsx`
- `tests/unit/guards/red-de-errores.guardia.test.ts`

**Modificados**
- `components/shared/EmptyState.tsx` — prop `iconClassName` (aditiva, default idéntico al render previo)
- `tests/unit/guards/html-lang.guardia.test.ts` — el censo pasa de tres a cuatro documentos

**Revertido antes de cerrar:** el fallo provocado en `app/(app)/ordenes/page.tsx` y en
`app/(app)/cierres-admin/page.tsx` (`git diff` no los toca; `/cierres-admin` se recargó después y
vuelve a pintar sus dos pestañas).
