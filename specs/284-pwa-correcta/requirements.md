# 284-pwa-correcta — requirements.md

Feature id 284 · zone: frontend · complexity: media · rama `feature/284-pwa` ·
sin migraciones · sin endpoints nuevos.

**Contexto que manda sobre todo lo demás:** la app sale a uso comercial el
**2026-08-26**. Producción se vació hoy a propósito y ya no se harán pruebas allí.
Esta ficha tiene que poder implementarse y desplegarse **hoy**. Por eso los
requisitos van agrupados por lo que rompe en manos de un usuario, y el orden de
ejecución vive en `tasks.md` (P0 → P2), no en la numeración.

Notación EARS. Convenciones de vocabulario:

- **El SW** = el service worker de `public/sw.js`. Tiene DOS ramas y no son lo
  mismo: la de **desarrollo** (`hostname` `localhost`/`127.0.0.1`, se autodestruye)
  y la de **producción** (todo lo demás). Cuando un requisito no dice cuál, habla
  de la de producción.
- **El manifiesto** = `public/manifest.json`.
- **Rol con menú** = cualquier rol que aparezca en el `roles` de algún ítem de
  `SIDEBAR_ITEMS` (`lib/auth/menu-visibility.ts`). Hoy son cinco: `maestro`,
  `admin`, `adminTienda`, `mensajero`, `adminSatelite`. `apiKey` queda fuera por
  construcción: es una cuenta de máquina que no navega.
- **Cliente controlado** = pestaña o ventana de la PWA que un SW ya activo está
  gobernando.

---

## Lo medido antes de escribir, y una corrección a la ficha

Los cuatro defectos se confirmaron abriendo los archivos. Tres se confirman tal
cual; el cuarto **estaba mal en parte** y se dice en vez de arrastrarlo:

| # | Lo que dice la ficha | Lo que hay en el árbol | Veredicto |
| --- | --- | --- | --- |
| 1 | `<html lang="en">` en una app en español | `app/layout.tsx:34` → `lang="en"` | **confirmado** |
| 2 | la caché crece sin límite; nombre fijo | `public/sw.js:31` → `static: "next-static-v1"`, fijo; `sw.js:46-48` → `activate` sólo hace `clients.claim()` | **confirmado** |
| 3 | el relevo no está coordinado | `sw.js:42` → `skipWaiting()` en `install`; `sw.js:47` → `clients.claim()` en `activate` | **confirmado** |
| 4a | `shortcuts` en 0 | el manifiesto no declara `shortcuts` | **confirmado** |
| 4b | sin `id` | el manifiesto no declara `id` | **confirmado** |
| 4c | **sin `orientation` ni `categories`** | `manifest.json:8` → `"orientation": "portrait-primary"`; `manifest.json:11` → `"categories": ["business","productivity"]` | ❌ **FALSO: los dos están** |
| 4d | `apple-mobile-web-app-capable` deprecado | `app/layout.tsx:40`, presente y sin su equivalente moderno | **confirmado** |
| 4e | `apple-touch-icon` de 192 y iOS quiere 180 | `app/layout.tsx:43` → `/icons/icon-192.png`; en `public/icons/` **no existe** ningún 180 | **confirmado** |

Por eso `orientation` y `categories` aparecen abajo como **requisito de no
regresión** (R15) y no como trabajo nuevo: lo único que hay que hacer con ellos
es no perderlos.

**Dos hallazgos más, encontrados al especificar.** No estaban en los cuatro:

- **(H1) Una respuesta que falla se cachea para siempre.** El `fetch` de
  `/_next/static/` (`sw.js:83-86`) guarda la respuesta **sin mirar su estado**, y
  la estrategia es cache-first: si durante un despliegue un chunk vuelve 404, ese
  404 queda en el teléfono y la app se queda rota **en ese dispositivo** hasta que
  el navegador desaloje la caché. Es de la misma familia que el defecto 3 —el daño
  aparece justo al desplegar sobre alguien— y cuesta una condición. Entra: **R11**.
- **(H2) El precaché de `/` guarda la sesión de quien instaló.** `install`
  precachea `"/"` (`sw.js:35`) con las cookies del navegador, y `/` responde
  redirigiendo (`middleware.ts:56-58`): con sesión a `/dashboard`, sin ella a la
  landing. Lo que quede guardado bajo la clave `/` puede ser la página de otra
  sesión, y servir una respuesta redirigida a una navegación es además un error
  conocido del navegador. **NO entra aquí**: es material de la ficha **285**
  (offline de verdad). Se deja escrito y se mide en T0 para que nadie lo descubra
  el día que toque el offline.

---

## A · El idioma del documento

- **R1** El documento HTML raíz de la app DEBE declarar `lang="es"`.
- **R2** Todo documento HTML **completo** que emita código de producción —el layout
  raíz, la página de documentación de la API y la página offline— DEBE declarar un
  atributo `lang` con el valor `es`. (Hoy los otros dos ya lo cumplen; el requisito
  existe para que el que se arregla no vuelva a divergir en solitario.)

## B · El relevo del service worker

- **R3** MIENTRAS el SW en curso controle al menos un cliente, un SW recién
  instalado NO DEBE tomar el control ni activarse.
- **R4** CUANDO el SW nuevo termine de instalarse y siga habiendo clientes
  controlados, el SW nuevo DEBE quedar en espera **sin borrar ninguna caché** y sin
  alterar ninguna respuesta que reciba la página viva.
- **R5** El SW NO DEBE navegar, recargar ni reemplazar la página de ningún cliente
  en producción, en ninguna circunstancia.
- **R6** DONDE el `hostname` sea `localhost` o `127.0.0.1`, el SW DEBE conservar
  intacto su comportamiento actual de autodestrucción —limpiar cachés,
  desregistrarse y renavegar los clientes—, y R3, R4 y R5 NO le aplican. Esa rama
  es el kill-switch de desarrollo y esta ficha no la toca.

## C · La política de purga de caché

- **R7** CUANDO el SW se active, DEBE borrar toda caché de su origen cuyo nombre no
  esté en la lista de cachés vigentes que el propio SW declara.
- **R8** Los nombres de las cachés de producción DEBEN cambiar en este despliegue,
  de modo que R7 recoja **una vez** todo lo acumulado por el SW anterior en
  `next-static-v1` y `pages-cache-v1`.
- **R9** El SW DEBE mantener el número de entradas de la caché de estáticos por
  debajo de un tope declarado: CUANDO al guardar un estático la caché supere ese
  tope, el SW DEBE eliminar las entradas **más antiguas** hasta volver al tope.
- **R10** CUANDO se ejecute el recorte de R9, el SW NO DEBE eliminar la entrada que
  acaba de guardar, y el recorte NO DEBE retrasar la respuesta que se devuelve al
  cliente.
- **R11** El SW NO DEBE guardar en caché una respuesta que no sea satisfactoria
  (`response.ok` falso).
- **R12** El SW NO DEBE precachear en `install` nada más allá de `/` y
  `/offline.html`. Ampliar el precaché es de la ficha 285.
- **R13** El tope de R9 DEBE existir como **una sola** constante declarada en el
  SW, y su valor DEBE quedar escrito con la medición que lo respalda o, si no se
  puede medir hoy, **declarado sin calibrar** con esa palabra.

## D · El manifiesto

- **R14** El manifiesto DEBE declarar `id` con el valor `"/"` —el mismo que
  `start_url`—, de modo que la identidad de la app ya instalada no cambie.
- **R15** El manifiesto DEBE seguir declarando `name`, `short_name`, `description`,
  `start_url`, `scope`, `display`, `orientation`, `theme_color`,
  `background_color`, `categories`, sus dos iconos y sus tres capturas, con los
  valores que ya tiene.
- **R16** El manifiesto NO DEBE declarar ningún atajo cuyo destino sea inalcanzable
  para algún rol con menú. MIENTRAS no exista una ruta que resuelva el destino por
  rol, el manifiesto NO DEBE declarar `shortcuts`.
- **R17** SI el manifiesto declara `shortcuts`, ENTONCES cada entrada DEBE traer
  `name` y `url`, y esa `url` DEBE resolver contra un ítem o subítem de
  `SIDEBAR_ITEMS` visible para **todos** los roles con menú, o figurar en la lista
  de rutas despachadoras que el propio guardia declara con su motivo escrito.

## E · Los metadatos de iOS

- **R18** El `<head>` DEBE declarar `mobile-web-app-capable` con valor `yes` y DEBE
  seguir declarando `apple-mobile-web-app-capable` con valor `yes`.
- **R19** El `<head>` DEBE declarar un `apple-touch-icon` que apunte a un PNG de
  **180×180** existente en `public/`.
- **R20** Todo PNG referenciado por el `<head>` o por el manifiesto DEBE existir en
  `public/` y medir exactamente lo que declara.

## F · La medición, y que quede escrita

- **R21** El documento raíz DEBE pasar las auditorías `html-has-lang` y
  `html-lang-valid` de Lighthouse, y la categoría **Accesibilidad** DEBE quedar en
  **≥ 90**. El número medido DEBE quedar escrito con la URL, la fecha y la versión
  de Chrome/Lighthouse con que se midió.
- **R22** La app DEBE quedar sin errores de instalabilidad en el panel del
  manifiesto del navegador, y ese veredicto DEBE quedar escrito con la misma
  trazabilidad de R21.
- **R23** El comportamiento del SW —relevo y purga— DEBE comprobarse sobre un
  despliegue **HTTPS que no sea `localhost`**, y el resultado de esa comprobación
  DEBE quedar escrito paso a paso. En `localhost` el SW de producción **no existe**:
  se autodestruye (`sw.js:7-9`) sin mirar `NODE_ENV`, así que `pnpm build && pnpm
  start` tampoco sirve. Ya está medido y escrito en `progress/current.md:4755-4759`.
- **R24** Los tests automáticos de esta ficha DEBEN vivir donde el gate rápido los
  ejecuta **siempre** (`tests/unit/guards/`). Un cambio en `public/**` no lo
  selecciona ningún grafo de imports: si los tests viven fuera de las guardias,
  `./init.sh --rapido` sale verde sin haber ejecutado ni uno.

---

## Fuera de alcance, dicho explícitamente

- **El offline de verdad** (leer sin señal) es la ficha **285**. Aquí no se amplía
  el precaché ni se añade una sola ruta a la caché.
- **Avisar al usuario de que hay versión nueva** (el aviso con botón "actualizar").
  Es la consecuencia declarada del camino elegido para el relevo; ver `design.md`
  §3, alternativa A2. Ficha aparte si el humano quiere pagarla.
- **Atajos por rol.** Requiere una ruta que despache por rol; ver `design.md` §5.
- **H2, el precaché de `/` con sesión.** Ficha 285.
- **`scripts/generate-pwa-icons.mjs` está roto**: su fuente es `public/next.svg` y
  ese archivo **ya no está en el árbol**. No se arregla aquí; ver Q6.

---

## Preguntas abiertas

- **Q1 · La ficha 284 no existe en `feature_list.json`.** En este árbol el id mayor
  es **283** (y el **282** tampoco está). El contenido de la ficha lo trae el
  encargo del leader, no el repo, así que el spec se escribe contra ese encargo.
  **Pregunta:** ¿la da de alta el leader con `id: 284`, `zone: frontend`,
  `sdd: true`, `spec_path: "specs/284-pwa-correcta"`? Sin la entrada, `./init.sh`
  falla en su comprobación 4 en cuanto la ficha pase a `in_progress`.
- **Q2 · Los atajos.** R16 elige **no declarar ninguno**, porque los atajos son por
  app y no por rol: cualquier destino de `SIDEBAR_ITEMS` es invisible para al menos
  un rol, y ahí el usuario recibe el `notFound()` de la página (o el `/login` del
  middleware si no hay sesión). Las tres salidas, con su precio, están en
  `design.md` §5. **Pregunta:** ¿se acepta salir mañana con 0 atajos y una guardia
  que impide meter uno malo, o se prefiere (a) abrir ficha para la ruta
  despachadora, o (b) declarar atajos del mensajero aceptando el 404 para los otros
  cuatro roles?
- **Q3 · Dónde se hace la comprobación manual de R23.** `localhost` no sirve. Las
  opciones son el despliegue de **preview** o **producción después de desplegar**
  (que es lo que `docs/release.md` §3 llama "las comprobaciones que sólo existen en
  producción"). Producción se vació hoy y no se harán pruebas allí. **Pregunta:**
  ¿preview con una cuenta de su propia base, o se acepta hacer las cinco
  comprobaciones en producción justo después del despliegue?
- **Q4 · Qué versión de Lighthouse hay en la máquina que va a medir.** El umbral de
  R21/R22 está escrito para no depender de que exista una categoría "PWA": se pide
  Accesibilidad ≥ 90 con las dos auditorías de idioma en PASS, más el panel del
  manifiesto sin errores. **Pregunta:** si el Chrome que mide todavía expone una
  categoría PWA con su número, ¿se exige también un mínimo ahí, y cuál?
- **Q5 · El tope de la caché estática (R9/R13).** Se fija midiendo cuántos
  `/_next/static/` distintos carga un recorrido completo del mensajero. **Pregunta:**
  ¿se mide hoy en el despliegue, o se fija en 200 y se declara **sin calibrar** —el
  precedente de `RUTA_ORIGEN_MAX_KM` en este repo— para no bloquear el lanzamiento?
- **Q6 · El icono de 180.** Hay que crearlo (R19) y el generador oficial no puede
  reproducirlo: `scripts/generate-pwa-icons.mjs` lee `public/next.svg`, que ya no
  existe. **Pregunta:** ¿se acepta generarlo reescalando `public/icons/icon-512.png`
  con `sharp` y dejar el generador roto con un ticket aparte, o se arregla el
  generador aquí (más diff, la víspera del lanzamiento)?
- **Q7 · El precio del relevo elegido.** Con R3, la versión nueva de la app llega al
  teléfono **en el siguiente arranque completo** de la PWA (cuando no quede ninguna
  ventana viva). Hoy los instalados son ~0 y el precio es teórico; a partir de la
  semana que viene no. **Pregunta:** ¿se acepta ese retraso, o se abre ya la ficha
  del aviso "hay versión nueva" (A2 del design)?
- **Q8 · ¿El SW llega hoy a `activated` en producción?** Toda esta ficha da por
  hecho que hay cachés creciendo en teléfonos. Eso no está medido: si `install`
  falla —H2 da un motivo plausible— no hay SW, no hay caché y no hay defecto 2. La
  tarea **T0** lo mide antes de tocar nada. **Pregunta:** ¿quién puede abrir el
  DevTools sobre el despliegue vigente para responderlo?
