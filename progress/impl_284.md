# impl_284 — la PWA correcta: idioma, relevo consentido, purga, manifiesto e iconos

Rama `feature/284-pwa` · zone frontend · sin migraciones · sin endpoints nuevos.
Spec: `specs/284-pwa-correcta/`. Implementado el **2026-08-25**, la víspera del arranque
comercial.

> **Lo que manda sobre el spec.** El humano firmó **tres decisiones que van CONTRA lo que el
> `design.md` recomendaba**. No se re-abren; lo que sigue documenta qué obligó cada una y cómo
> se pagó. Donde el spec y la decisión chocan, gana la decisión y se dice.

---

## 1 · Las tres decisiones y lo que obligaron

### D1 · Aviso con botón, en vez de esperar callado (el spec lo dejaba fuera de alcance)

El SW nuevo **no toma el control solo**: `install` ya no llama a `skipWaiting()` y sólo lo llama
al recibir el mensaje `ordenex:relevo-ahora`, que **únicamente** dispara el botón del aviso.

**Lo que eso obliga, y no era opcional: la recarga no puede llevarse una gestión a medio hacer.**
Dos garantías, las dos con test que las ejecuta:

- **G1 · Sólo se recarga la pestaña que lo pidió.** `controllerchange` se dispara en **todas** las
  pestañas cuando el SW nuevo toma el control. Si cualquiera recargara, el mensajero perdería el
  formulario que estaba llenando en otra ventana. La recarga está condicionada a `solicitadoRef`;
  las demás pestañas sólo se enteran de que hay versión nueva y recargan cuando el usuario quiera.
  → `pwa-aviso-sin-recarga.guardia.test.ts` › *G1: si el relevo lo pidió OTRA pestaña, esta no se
  recarga*.
- **G2 · El aviso espera.** No se pinta mientras `hayTrabajoEnCurso(document)` diga que sí, y se
  **vuelve a comprobar al pulsar**, por si algo empezó entre el pintado y el clic. La regla es una
  heurística sobre el DOM —se dice en vez de fingir que es exacta— con cinco señales: diálogo
  abierto, campo distinto de su valor por defecto, archivo ya elegido y sin subir, `aria-busy` y
  un `<video>` (el escáner con la cámara encendida). **Se equivoca siempre hacia el mismo lado**:
  ante la duda, el aviso espera.
  → mismo archivo › *con una gestión a medias el aviso espera…* y *G2: si el usuario empieza algo
  entre el aviso y el clic, no se pide el relevo*.

**El relevo y la purga son la misma decisión, y así se resolvió.** Con el relevo a petición,
`activate` puede correr **con una página viva delante**, así que barrer `next-static-v1` en ese
momento sería romperla. La purga quedó condicionada en tres piezas:

1. `activate` anota **qué ventanas existían** en el instante del relevo (son las de la build
   anterior) y **sólo purga si no queda ninguna viva**;
2. mientras alguna siga viva, la caché vieja **no se borra Y ADEMÁS se sigue leyendo**: el `fetch`
   de estáticos usa `caches.match(request)`, que mira **todas** las cachés del origen y no sólo la
   vigente — o sea que la página vieja sigue encontrando sus chunks;
3. cada vez que una página avisa de que cargó (`ordenex:pagina-lista`) se **reintenta** la purga:
   ese es justo el momento en que la última página vieja acaba de desaparecer.

Casos que lo ejecutan: *con una página de la build anterior viva NO se borra nada*, *la purga
aplazada corre en cuanto esa página desaparece*, *mientras la caché vieja siga ahí, la página
vieja encuentra sus chunks*.

**Lo que esto NO garantiza, dicho:** si el SW se termina (el navegador lo apaga por inactividad)
antes de que la última página vieja muera, la marca de «purga pendiente» vive en memoria y se
pierde; la caché `v1` sobreviviría hasta el siguiente `activate` con la casa vacía. No es un
crecimiento sin límite —`TOPE_ESTATICOS` acota siempre la `v2`— sino un barrido que puede llegar
un arranque más tarde.

### D2 · Cero atajos, con la guardia que vigila la regla

Se implementa como **`shortcuts` ausente a propósito**, no por olvido. **La medición del humano se
re-deriva en la guardia** (no se copia) sobre `SIDEBAR_ITEMS`, contando destinos navegables
(subítems si los hay, si no el `href` del ítem):

| rol | destinos |
| --- | --- |
| maestro | **16** |
| admin | **11** |
| adminSatelite | **6** |
| mensajero | **6** |
| adminTienda | **3** |
| **intersección de los cinco** | **∅ (vacía)** |

Por eso el cero no es pereza: **cualquier atajo llevaría a alguien a un `notFound()`**. La única
ruta que despacha por rol es `/dashboard`, y un atajo a `/dashboard` no es un atajo: es abrir la
app. La guardia trae su **caso anti-vacuidad**: un manifiesto de mentira con un atajo a `/ordenes`
que la regla debe **rechazar** (y lo rechaza nombrando a `mensajero`). Sin ese caso, la regla
estaría verde por no haber atajos y no por funcionar.

### D3 · Se verifica en producción → hacía falta una red de seguridad

Un service worker roto **persiste en el dispositivo**: no se arregla desplegando otra vez, porque
el navegador busca la versión nueva **a través del mecanismo que se acaba de romper**. Y con D1 el
problema **empeora**: si nadie pulsa «actualizar» y nadie cierra la app, el SW nuevo se queda en
`waiting` indefinidamente.

El camino de rescate va en **dos mitades**, porque un solo lado no cubre los dos modos de fallo:

| mitad | dónde | para cuándo |
| --- | --- | --- |
| `RESCATE_FORZOSO` | `public/sw.js`, constante en `false` | el SW nuevo **sí** llega al teléfono: pide el relevo sin esperar a nadie, borra **todas** las cachés (también las vigentes) y **se des-registra** |
| `?rescate=sw` | `lib/pwa/rescate-inline.ts`, **inline en el `<head>`** | lo roto es **la app**: si los chunks de JavaScript fallan, ningún componente llega a ejecutarse. Este código viaja dentro del HTML y se ejecuta igual |

**Ninguna de las dos renavega ni recarga la página de nadie** (R5 intacto): el rescate limpia, y
la recarga la decide el usuario (en el segundo caso, abriendo él mismo la URL).

**Cómo se probó** (no sólo escrito):
- la mitad del SW se **ejecuta** en la guardia encendiendo la bandera sobre el fuente real —misma
  mecánica que una mutación— y afirmando las tres cosas que importarán ese día: `skipWaiting`
  llamado **1** vez, **0** cachés restantes, `unregister` llamado **1** vez. Con su **par
  anti-vacuidad**: con la bandera en `false`, ni `unregister` ni borrado (si no, «el rescate
  funciona» estaría verde porque el SW siempre se desaloja, que es lo contrario de lo que se
  quiere). Y una mutación (#12) apaga la bandera y pone la guardia roja.
- la mitad del documento se **ejecuta** con `new Function` sobre `RESCATE_INLINE`, con y sin el
  parámetro: sin él no hace absolutamente nada; con él des-registra, borra las dos cachés y hace
  `location.replace("/mis-asignaciones/reparto")` (sin la query, para que no entre en bucle).
- **queda M7 en `docs/release.md`**: probarlo una vez en un teléfono real ahora que no hace falta.

---

## 2 · Los defectos cerrados

| # | Defecto | Qué se hizo |
| --- | --- | --- |
| 1 | `<html lang="en">` en una app en español | `lang="es"` + guardia que **censa los tres** documentos HTML completos del árbol y exige `es` en todos |
| 2 | la caché crece sin purgar; nombre fijo | nombres a **v2** (para que el barrido se lleve de una vez lo acumulado desde la 64), purga por lista de vigentes condicionada a D1, y **tope FIFO** que acota **siempre** —también cuando un despliegue no toca `sw.js` y por tanto no hay `activate`— |
| 3 | el `fetch` cachea sin mirar el estado | `if (!respuesta.ok) return respuesta;` antes de guardar, en estáticos **y** en navegaciones. Era el peor de los cuatro: un 404 de chunk durante un despliegue quedaba **permanente** en ese teléfono |
| 4 | manifiesto sin `id` ni `shortcuts` | `"id": "/"` (exactamente `/`: cualquier otro valor cambia la identidad y el teléfono acaba con dos Ordenex). `shortcuts` **ausente a propósito**, ver D2. `orientation` y `categories` ya estaban y no se tocaron |
| 5 | iOS: `apple-touch-icon` de 192 y doble redondeo | `icon-180.png` **a sangre** (iOS redondea él solo) y `<meta name="mobile-web-app-capable">` junto a la de Apple, **las dos** |
| 6 | un solo icono con `purpose: "any maskable"` | **dos variantes del mismo vector**: `any` con rx=108 y `maskable` a sangre (rx=0) con el monograma recentrado |

**Por qué el maskable recentra** (medido, no estético): con la colocación del icono vigente, el
vértice más lejano de la tinta queda a **208,7 px** del centro sobre un lienzo de 512, y la zona
segura de un maskable es la circunferencia de radio **204,8**. Se salía por 4 px. Recentrado, el
vértice más lejano queda a **175 px**, y la tinta ocupa el **61 %** del ancho: dentro del 80 %
seguro por los dos criterios (círculo y caja central).

---

## 3 · LA TRAMPA DEL ICONO: medida, y ya había mordido

El vector `public/icons/fuente/*.svg` pedía `font-family: Poppins`. La app usa Poppins, pero **vía
`next/font/google`, que la descarga en el navegador**: en la máquina que rasteriza, Poppins **no
está instalada**. El fallo es mudo — el archivo compila, el PNG se genera y la letra no es la de
la marca.

**No es un riesgo teórico: es lo que ya había pasado.** Medido el 2026-08-25 rasterizando el
vector vigente en esta máquina y comparándolo con el `icon-512.png` que la app servía:

| render del vector vigente con… | píxeles distintos vs. el `icon-512.png` servido | diferencia media |
| --- | --- | --- |
| **`Segoe UI`** | **0,282 %** | **0,71** |
| `Arial` | 9,306 % | 45,25 |
| `Poppins` (pedida por nombre; no instalada → respaldo) | 8,575 % | 41,69 |

O sea: **el icono que se servía estaba en Segoe UI Bold**, no en la tipografía de marca. La caja
de tinta lo confirma por otra vía: la «e» servida medía 142×155 px (proporción 0,916) y la «e» de
Poppins Bold mide 153×157 (0,975).

**Lo que se hizo:** el texto está **convertido a trazados**. Se extrajeron los contornos de los
glifos `e` y `x` de **Poppins Bold (700)** y se emitieron como `<path>`; el vector ya no nombra
ninguna fuente. Autocomprobación del extractor: la caja calculada desde **mis puntos** coincide
con la que **el propio archivo de fuente declara** en la cabecera de cada glifo —`e`
`28,-8,588,566`; `x` `5,0,584,558`—.

**Cómo se comprobó que conserva la marca, mirando el PNG y midiendo:**
1. **Mirándolo**: se abrió el PNG resultante y se comparó recorte a recorte con el vigente; la
   forma de la «e» de Poppins (apertura grande, terminal horizontal) es la que sale.
2. **Midiendo**: la caja de tinta del nuevo `icon-512.png` cae **exactamente** donde la del
   vigente —`(104,234)`–`(416,390)`, 313×157 px—, así que la diferencia que queda **no es de
   escala ni de posición: es de letra**. Y es del **2,283 %** de los píxeles (media 9,75), que es
   justo la distancia Poppins↔Segoe UI a ese tamaño.
3. **Cinturón permanente**: `scripts/generate-pwa-icons.mjs` **aborta** si un vector fuente
   contiene `<text>`. Mejor no generar nada que generar un icono con otra letra.

**Q6 queda RESUELTA, no aplazada:** `scripts/generate-pwa-icons.mjs` apuntaba a `public/next.svg`,
un archivo que ya no existe (pintaba el logo de Next sobre naranja: no podía reproducir ni uno de
los iconos servidos). Ahora lee los dos vectores de marca y emite los **cinco** PNG.

---

## 4 · Inventario del cambio

| Archivo | Qué |
| --- | --- |
| `public/sw.js` | relevo a petición, purga condicionada, lectura cruzada de cachés, tope FIFO, `ok` obligatorio, `RESCATE_FORZOSO` |
| `app/layout.tsx` | `lang="es"`, las dos metas de capacidad, `apple-touch-icon` 180, script de rescate **inline** |
| `app/(app)/layout.tsx` | monta `<AvisoVersionNueva />` |
| `components/shared/AvisoVersionNueva.tsx` | el aviso (`role="status"`, textos por props para i18n futuro) |
| `hooks/useActualizacionPwa.ts` | G1 y G2 |
| `lib/pwa/actualizacion.ts` | contrato de mensajes + `hayTrabajoEnCurso` |
| `lib/pwa/rescate-inline.ts` | la mitad del rescate que vive en el HTML |
| `public/manifest.json` | `id`, dos variantes de icono |
| `public/icons/fuente/icon-any.svg`, `icon-maskable.svg` | **nuevos**, con trazados (sustituyen a `icon-192.svg`/`icon-512.svg`, que eran texto y por tamaño en vez de por variante) |
| `public/icons/icon-{180,192,512,192-maskable,512-maskable}.png` | regenerados / nuevos |
| `scripts/generate-pwa-icons.mjs` | arreglado |
| `tests/unit/guards/{pwa-relevo-y-purga,pwa-manifiesto-atajos,pwa-aviso-sin-recarga,html-lang}.guardia.test.ts` | 56 casos |
| `docs/release.md` | M1–M7 |

`tests/unit/pwa/manifest.test.ts` **no se tocó** (lo citan ocho filas de la 164 y hay una guardia
que castiga que un test citado desaparezca); sigue verde y ahora comprueba también los dos PNG
nuevos.

---

## 5 · Trazabilidad R → test

| R | Dónde |
| --- | --- |
| R1 | `html-lang` › el layout raíz declara español |
| R2 | `html-lang` › los tres documentos completos y su censo |
| R3 | `pwa-relevo-y-purga` › install no llama skipWaiting · solo el mensaje del usuario pide el relevo |
| R4 | `pwa-relevo-y-purga` › instalar no toca las caches existentes |
| R5 | `pwa-relevo-y-purga` › la rama de produccion no renavega a nadie (ejecutado **y** leído: una prohibición universal no se demuestra ejecutando caminos) |
| R6 | `pwa-relevo-y-purga` › en localhost limpia, se desregistra y renavega · 127.0.0.1 también es desarrollo |
| R7 | `pwa-relevo-y-purga` › activate purga las caches fuera de lista |
| R8 | `pwa-relevo-y-purga` › las caches v1 desaparecen y las v2 quedan |
| R9 | `pwa-relevo-y-purga` › el tope recorta las entradas mas antiguas |
| R10 | `pwa-relevo-y-purga` › la entrada recien guardada sobrevive al recorte |
| R11 | `pwa-relevo-y-purga` › un 404 no entra en la cache · las paginas que no son 2xx tampoco se graban |
| R12 | `pwa-relevo-y-purga` › install precachea exactamente dos urls |
| R13 | `pwa-relevo-y-purga` › el tope vive en una sola constante, declarada y entera |
| R14 | `pwa-manifiesto-atajos` › el id preserva la identidad instalada |
| R15 | `pwa-manifiesto-atajos` › conserva sus diez claves con su valor |
| R16 | `pwa-manifiesto-atajos` › ningún atajo deja fuera a un rol con menú |
| R17 | `pwa-manifiesto-atajos` › un atajo a una ruta por rol se rechaza (**anti-vacuidad**) |
| R18 | `pwa-manifiesto-atajos` › el head declara las dos metas de capacidad |
| R19 | `pwa-manifiesto-atajos` › el apple-touch-icon mide 180 |
| R20 | `pwa-manifiesto-atajos` › cada png referenciado existe y mide lo declarado · **y la diferencia se ve en el píxel de la esquina** |
| R21 | ✋ **M6** (Lighthouse) — `docs/release.md` |
| R22 | ✋ **M5** (instalabilidad) — `docs/release.md` |
| R23 | ✋ **M1–M4** (relevo y purga sobre HTTPS real) — `docs/release.md` |
| R24 | los cuatro archivos viven en `tests/unit/guards/`; `pnpm run test:guardias` (`vitest run guard`) los selecciona **siempre**, sin registrarlos en ninguna lista |
| D1 | `pwa-aviso-sin-recarga` › G1 · G2 · el banner se pinta con nombre accesible y un botón · **el aviso está montado en el portal** |
| D3 | `pwa-relevo-y-purga` › con la bandera en true desaloja al SW anterior · con la bandera en false no · `pwa-aviso-sin-recarga` › el camino de rescate (3 casos) |
| R25 | `pwa-servida-sin-sesion.guardia.test.ts` › los tres archivos no pasan por el guard · ANTI-VACUIDAD: el resto de la app sigue detrás · la exclusión va por nombre y no por extensión — **más** la medida `curl -I` sobre un build de producción (§12) y **M8** en `docs/release.md` |
| R26 | `pwa-servida-sin-sesion.guardia.test.ts` › el `<link rel="manifest">` no declara crossorigin |
| B1 | `pwa-aviso-sin-recarga` › un input CONTROLADO con texto tecleado cuenta como trabajo · el caso REAL del panel de gestión (3 casos) · G3: el banner va arriba, se puede quitar y no promete |

**Requisitos sin test automático: R21, R22, R23** — los tres son medidas en un navegador contra un
despliegue HTTPS. Se declaran así a propósito y no se finge cobertura.

---

## 6 · Mutaciones: 13 de 13 muertas, control verde

Salida **real** del runner, pegada. Cada mutación se aplicó sobre el árbol, se corrió **sólo** la
guardia afectada y se revirtió con `git checkout --`. El arnés aborta si el texto no cambió o si
el runner no ejecutó ningún test (en este repo un arnés reportó «9/9 supervivientes» dos veces sin
haber ejecutado un solo test).

```
== 1  reponer skipWaiting() en install
   tests/unit/guards/pwa-relevo-y-purga.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  1 failed | 24 passed (25)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
   × install no llama skipWaiting 4ms
== 2  quitar el borrado de caches fuera de lista
   tests/unit/guards/pwa-relevo-y-purga.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  3 failed | 22 passed (25)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
   × activate purga las caches fuera de lista 6ms
   × las caches v1 desaparecen y las v2 quedan 1ms
   × la purga aplazada corre en cuanto esa pagina desaparece 1ms
== 3  TOPE_ESTATICOS = Infinity
   tests/unit/guards/pwa-relevo-y-purga.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  3 failed | 22 passed (25)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
   × el tope vive en una sola constante, declarada y entera 5ms
   × el tope recorta las entradas mas antiguas 1ms
   × la entrada recien guardada sobrevive al recorte 1ms
== 4  cachear tambien cuando !response.ok
   tests/unit/guards/pwa-relevo-y-purga.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  1 failed | 24 passed (25)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
   × un 404 no entra en la cache 5ms
== 5  invertir el FIFO (borrar las ultimas)
   tests/unit/guards/pwa-relevo-y-purga.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  2 failed | 23 passed (25)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
   × el tope recorta las entradas mas antiguas 4ms
   × la entrada recien guardada sobrevive al recorte 3ms
== 6  lang="es" -> lang="en"
   tests/unit/guards/html-lang.guardia.test.ts -> SUPERVIVIENTE (verde)
   Test Files  1 passed (1)
   Tests  3 passed (3)
== 7  añadir un atajo a /ordenes
   tests/unit/guards/pwa-manifiesto-atajos.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  2 failed | 8 passed (10)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
   × ningun atajo deja fuera a un rol con menu 5ms
   × hoy no hay ni un destino que vean todos los roles: por eso son cero atajos 1ms
== 8  id "/" -> "/?source=pwa"
   tests/unit/guards/pwa-manifiesto-atajos.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  1 failed | 9 passed (10)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
   × el id preserva la identidad instalada 5ms
== 9  purgar sin mirar si queda alguna pagina viva
   tests/unit/guards/pwa-relevo-y-purga.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  3 failed | 22 passed (25)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
   × con una pagina de la build anterior viva NO se borra nada 6ms
   × la purga aplazada corre en cuanto esa pagina desaparece 1ms
   × mientras la cache vieja siga ahi, la pagina vieja encuentra sus chunks 2ms
== 10 recargar aunque el relevo lo pidiera otra pestaña (G1)
   tests/unit/guards/pwa-aviso-sin-recarga.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  1 failed | 17 passed (18)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
   × G1: si el relevo lo pidio OTRA pestaña, esta no se recarga 80ms
== 11 avisar aunque haya una gestion a medias (G2)
   tests/unit/guards/pwa-aviso-sin-recarga.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  3 failed | 15 passed (18)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
   × con una gestion a medias el aviso espera, y aparece cuando el usuario termina 81ms
   × G2: si el usuario empieza algo entre el aviso y el clic, no se pide el relevo 1068ms
   × el banner se pinta con nombre accesible y un boton, y calla si hay trabajo 130ms
== 12 dejar inerte la bandera de rescate
   tests/unit/guards/pwa-relevo-y-purga.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  2 failed | 23 passed (25)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
   × la rama de produccion no renavega a nadie 5ms
   × con la bandera en true desaloja al service worker anterior, aunque su relevo este roto 1ms
== control  reordenar un comentario
   tests/unit/guards/pwa-relevo-y-purga.guardia.test.ts -> SUPERVIVIENTE (verde)
   Test Files  1 passed (1)
   Tests  25 passed (25)

RESULTADO: 11 de 12 mutaciones muertas.
CONTROL (cambio inocuo): SUPERVIVIENTE (verde) -- tiene que ser SUPERVIVIENTE (verde).

== 6b lang="es" -> lang="en" EN EL ATRIBUTO
   tests/unit/guards/html-lang.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  3 failed (3)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
   × el layout raiz declara español 9ms
   × los tres documentos completos y su censo 1ms
   × el escaner distingue un `es` de un `en` (anti-vacuidad) 1ms
== 13 el maskable con esquinas redondeadas (doble redondeo)
   tests/unit/guards/pwa-manifiesto-atajos.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  1 failed | 9 passed (10)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
   × y la diferencia se ve en el pixel de la esquina, no solo en el texto del purpose 93ms

arbol restaurado: limpio
```

**Un hallazgo del propio arnés, que vale la pena escribir.** La mutación 6 en su primera forma
—reemplazar el **primer** `lang="es"` del archivo— salió **SUPERVIVIENTE (verde)**: había tocado
el **comentario** que explica el atributo, no el atributo. Re-expresada sobre el atributo real
(`6b`), mata la guardia con sus tres casos. Es exactamente el modo de fallo por el que este
ejercicio existe: una mutación que no muta no prueba nada, y se lee igual de verde.

---

## 7 · Gate

`pnpm run db:generate` corrido antes del gate. Gate **completo** (`./init.sh` a secas), con el
código de salida escrito **dentro** del log y sin `tail` en medio:

```
{ ./init.sh; echo "INIT_EXIT=$?"; } > gate-completo.log 2>&1
```

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=5)
✓ specs presentes para features sdd en vuelo
✓ typecheck paso
✓ lint paso
     × ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación `@sin-superficie` 11ms
 FAIL  tests/unit/guards/superficie-de-uso.guardia.test.ts > R-A — toda Server Action tiene superficie, o dice por escrito por qué no > ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación `@sin-superficie`
 Test Files  1 failed | 1405 passed (1406)
      Tests  1 failed | 19166 passed | 26 skipped (19193)
✗ 'pnpm run test' fallo
INIT_EXIT=1
```

**Veredicto: `INIT_EXIT=1` por UN rojo AJENO, y el delta es 0 — medido, no razonado.**

- El rojo es `tests/unit/guards/superficie-de-uso.guardia.test.ts` › *ninguna Server Action de
  `lib/actions/**` es inalcanzable sin su anotación `@sin-superficie`*, y su único item es
  **`lib/actions/tarifas.ts:67 obtenerTarifa`** — ficha **275**, nada que ver con esta.
- **Medición del delta**: se creó un worktree limpio en `HEAD` (`4dc572e3`, sin ninguno de mis
  cambios) y se corrió **esa misma guardia** allí. Resultado idéntico:
  `Tests 1 failed | 17 passed (18)`, con el mismo `lib/actions/tarifas.ts:67 obtenerTarifa`.
  Antes: 1 rojo. Después: 1 rojo. **Delta 0.**
- Todo lo demás: `typecheck paso`, `lint paso` (0 errores; 102 warnings preexistentes, ninguno en
  archivos de esta ficha), **1405 de 1406 archivos de test en verde** y **19.166 tests pasando**.
- Las cuatro guardias nuevas suman **56 casos** y están todas en verde dentro de esa corrida.

---

## 8 · Lo que NO se pudo medir, y cómo se comprueba

**Un service worker no se puede medir en local**: el de producción se autodestruye en
`localhost`/`127.0.0.1` sin mirar `NODE_ENV` (`public/sw.js:7-9`), así que `pnpm build && pnpm
start` **tampoco** sirve. Y producción se vació el 2026-08-25 y ya no se prueba allí antes del
lanzamiento.

- **T0 / M0 (la línea base) NO se pudo tomar.** Nadie abrió DevTools sobre el despliegue vigente,
  así que **sigue sin medirse** si el SW llegaba a `activated` y cuántas entradas tenían sus
  cachés. Consecuencia honesta: si `install` estuviera fallando hoy, el defecto 2 no existiría y
  la purga sería una mejora sin daño previo. **Nada de lo implementado depende de esa respuesta**
  —purgar de más no rompe nada, y el resto de defectos están medidos leyendo los archivos—, pero
  la premisa «hay cachés creciendo en teléfonos» queda **sin confirmar** y se dice.
- **T0.2 (contar los `/_next/static/` de un recorrido del mensajero) tampoco.** Por eso
  `TOPE_ESTATICOS = 200` va **declarado SIN CALIBRAR** en el propio `sw.js`, con el precedente de
  `RUTA_ORIGEN_MAX_KM`, y la re-medición queda como **M4** en `docs/release.md`.
- **M1–M7** están en `docs/release.md` con su criterio y su número esperado, que es el mecanismo
  que este repo ya tiene para que una comprobación no caduque dentro del `tasks.md` de una ficha
  cerrada.

---

## 9 · Herencia para la ficha 285 (offline de verdad)

La 285 **no existe todavía** en `feature_list.json`; queda anotado aquí para que el leader lo
recoja al darla de alta:

- **H2 · el precaché de `/` guarda la sesión de quien instaló.** `install` precachea `"/"` con las
  cookies del navegador, y `/` responde **redirigiendo** (`middleware.ts:56-58`): con sesión a
  `/dashboard`, sin ella a la landing. Lo que quede guardado bajo la clave `/` puede ser la página
  de otra sesión, y servir una respuesta redirigida a una navegación es además un error conocido
  del navegador. **Fuera del alcance de la 284** y sin tocar aquí.
- **A7 · dejar de cachear `/_next/static/` y confiar en la caché HTTP** (`immutable`, la desaloja
  el navegador). **Elimina la clase entera de bug** de esta ficha. Se descartó aquí porque
  *reduce* lo que hoy existe —la mitad de la razón por la que la app arranca rápido en un teléfono
  barato con mala señal— y tocar el alcance del caché es materia de la 285. Debe evaluarse con el
  problema del offline entero delante.

---

## 10 · Deudas y avisos

- **`feature_list.json` sigue con la 284 en `pending`.** No la toco: el estado de la ficha es del
  leader. `./init.sh` no se queja mientras no pase a `in_progress`/`spec_ready` (la comprobación 4
  sólo mira esas dos), y la carpeta `specs/284-pwa-correcta/` existe, así que tampoco fallaría.
- **El aviso vive en `app/(app)/layout.tsx`**, no en el layout raíz: ahí es donde ocurren las
  sesiones de trabajo, y el raíz cubre además la landing pública, que hoy es estática y no
  necesita ese JavaScript. Consecuencia: **en la landing y en `/login` no hay aviso de versión
  nueva**. Es deliberado.
- **El precio de D1 sigue en pie**: quien deje la app abierta y no pulse el botón se queda en la
  versión vieja. Hoy los instalados son ~0, así que el precio empieza a correr después del
  lanzamiento.
- **`Sidebar.tsx` usa `/icons/icon-192.png`** como logotipo: al regenerarlo, el logotipo del
  sidebar también pasa a la tipografía de marca. Es coherencia, no un efecto colateral no querido.

---

# SEGUNDA RONDA — los tres bloqueantes de la revisión (2026-08-25)

La revisión salió **RECHAZADA con 4 bloqueantes**. B4 (las casillas del `tasks.md`) lo cierra el
leader. Aquí van B1, B2 y B3, y **uno de ellos cambia el sentido de la ficha entera**.

---

## 12 · B2 — la PWA no se podía instalar, y nunca se ha podido

### Lo que estaba pasando

Medido por el revisor **contra producción real** (`ordenex.vercel.app`), sin cookies:

```
/manifest.json       307 -> /login?redirect=%2Fmanifest.json
/sw.js               307 -> /login?redirect=%2Fsw.js
/offline.html        307 -> /login?redirect=%2Foffline.html
/icons/icon-512.png  200
```

El `matcher` del middleware sólo excluía **extensiones de imagen**. El navegador pide el
manifiesto **sin credenciales**: recibía el redirect y **jamás ofrecía instalar**. El service
worker tampoco se descargaba, así que **nada de lo que hace esta ficha llegaba al dispositivo**:
ni caché, ni relevo, ni pantalla offline, ni aviso de versión nueva.

**No lo introdujo esta ficha: es un defecto vivo desde la 64.** Y era un fallo mudo de manual —la
app se ve perfecta, los iconos cargan, y lo único que ocurre es que el botón de instalar no
aparece nunca—. Sin esto, todo lo demás de la 284 era decoración.

### El arreglo

Los tres archivos salen del `matcher`, **nombrados uno a uno**. Excluir `.json`, `.js` o `.html`
por extensión sí habría aflojado de verdad: dejaría fuera del guard cualquier ruta futura con esa
terminación. Son tres estáticos de `public/` sin un dato de nadie dentro, y `public/` nunca estuvo
detrás de este guard como control de acceso — el mismo argumento con el que la 86 ya había sacado
las fotos de la landing.

### La medida, antes y después, sobre un BUILD DE PRODUCCIÓN

No sobre el dev server: `pnpm exec next build` + `pnpm exec next start -p 3210`, que es el mismo
artefacto compilado que corre en Vercel. Se midieron las **dos** versiones del árbol, compilando
cada una:

**ANTES** (árbol en `HEAD`, sin el arreglo) — reproduce exactamente lo que el revisor vio en
producción:

```
/manifest.json           307 http://localhost:3210/login?redirect=%2Fmanifest.json
/sw.js                   307 http://localhost:3210/login?redirect=%2Fsw.js
/offline.html            307 http://localhost:3210/login?redirect=%2Foffline.html
/icons/icon-512.png      200
```

**DESPUÉS** (con el arreglo):

```
$ curl -sI http://localhost:3210/manifest.json | head -1
HTTP/1.1 200 OK
$ curl -sI http://localhost:3210/sw.js | head -1
HTTP/1.1 200 OK
$ curl -sI http://localhost:3210/offline.html | head -1
HTTP/1.1 200 OK

/manifest.json           200
/sw.js                   200
/offline.html            200
/icons/icon-512.png      200
/ordenes                 307 http://localhost:3210/login?redirect=%2Fordenes
```

La última línea es la mitad que importa tanto como las otras tres: **el resto de la app sigue
detrás del login**.

**Lo que esta medida NO prueba, dicho:** que Vercel se comporte igual. Es el mismo `next build` y
el mismo `middleware` compilado, pero el borde de Vercel es otra capa y yo no puedo desplegar.
Por eso queda **M8** en `docs/release.md`, con los cuatro `curl` y su número esperado, como lo
**primero** que se comprueba tras desplegar.

### `crossorigin="use-credentials"`: NO, y con la medida delante

El `design.md` §5/A11 conocía el asunto y lo aplicó a un caso **hipotético** (un manifiesto
dinámico por rol) sin medirlo sobre el manifiesto real. Medido ahora: el manifiesto responde
**200 sin ninguna cookie** y su contenido es un archivo **estático e igual para todos**, así que
pedirlo con credenciales **no cambiaría ni una respuesta**. Y traería el problema de A11: un
manifiesto que dependa de la sesión el navegador lo **congela al instalar**, y el rol de un
usuario cambia después. Queda escrito como **R26** en el spec y **vigilado** por la guardia.

### Cómo queda vigilado

`tests/unit/guards/pwa-servida-sin-sesion.guardia.test.ts` (11 casos). Extrae el `matcher` del
fuente, lo convierte en `RegExp` y afirma: los tres archivos **fuera** del guard; `/ordenes`,
`/dashboard`, `/cierre-dia`, `/mis-asignaciones/reparto`, `/configuracion`, `/api/ordenes` y
`/wallet` **dentro** (anti-vacuidad: sin esto, «no pasa por el guard» estaría verde con un
matcher que no protege nada); la exclusión **por nombre y no por extensión**
(`/reportes/export.json` sigue protegido); y el `<link rel="manifest">` **sin** `crossorigin`.

Vive en `guards/` porque lo que decide esto es **un literal de configuración que nadie importa**:
ningún grafo de imports selecciona un test cuando alguien edita `config.matcher`.

---

## 13 · B1 — la heurística no veía el trabajo del mensajero

### Lo que yo afirmé y era falso

Escribí que la heurística «se equivoca siempre hacia el mismo lado: ante la duda, el aviso
espera». **No en esta app.** Medido por el revisor con sondas RTL sobre React 19.2.4:

| caso | `value` | `defaultValue` | `hayTrabajoEnCurso` |
| --- | --- | --- | --- |
| input **controlado**, tecleado `45000` | `"45000"` | `"45000"` | **`false`** |
| textarea controlada | igual | igual | **`false`** |
| input **no** controlado | `"45000"` | `""` | `true` |

React 19 mantiene `defaultValue` sincronizado con `value` en los controlados, y **esta app no usa
otra cosa**: el campo del recaudo es `<Input value={linea.monto} onChange={…}>`
(`components/shared/DesglosePagoField.tsx`). La señal de la foto también estaba muerta:
`handleEvidenciaChange` hace `input.value = ""` justo tras elegir, a propósito. Y el panel se
pinta **inline**, no en diálogo.

**Y mi guardia estaba verde porque su caso G2 asignaba `.value` a un input suelto** — justo el
único caso que la heurística sí detectaba. Un test que se probaba a sí mismo. Lo apunto tal cual
porque es el modo de fallo que este repo lleva todo el día encontrando: **no falla, aparenta**.

El daño real: panel de gestión con dinero tecleado y fotos elegidas → el aviso se pintaba, caía
sobre «Guardar gestión» (`fixed bottom-0`, `pointer-events-auto`) y un toque **se llevaba el
desglose y las evidencias**. Mientras el banner prometía *«Tu trabajo en pantalla no se pierde»*.

### El arreglo, de raíz: el estado que se pierde vive en React, no en el DOM

**Capa 1 — registro explícito** (`lib/pwa/trabajo-en-curso.ts` + `hooks/useDeclararTrabajo.ts`).
La superficie que tiene datos sin guardar **lo declara**; el aviso sólo pregunta. Es un `Set`
fuera de React a propósito: `useActualizacionPwa` necesita la respuesta **en el instante del
clic**, y el aviso vive en el layout del portal mientras las superficies que declaran están en
cualquier rama del árbol (un contexto obligaría a envolver la app entera). Se retira solo al
desmontar. El hook `useActualizacionPwa` **se suscribe**, así que el aviso se retira **en el
acto** cuando alguien empieza algo, no hasta tres segundos después.

El panel de gestión lo declara desde que **sale del detalle** —o sea, desde que el mensajero
decidió gestionar—, y también si hay fotos elegidas, motivo escrito, o algo comprimiéndose,
enviándose, ubicándose o cancelándose.

**Capa 2 — el barrido del DOM, arreglado.** Ya no compara con `defaultValue`: mira si el campo
**tiene contenido**, que es lo único afirmable de un input controlado desde fuera. Con eso, el
texto tecleado en **cualquier** formulario de la app cuenta, no sólo en lo declarado. Los campos
de **búsqueda** quedan fuera a propósito (filtrar un listado no es trabajo que se pierda, y son
los que más a menudo tienen contenido en reposo: dejarlos dentro haría que el aviso no apareciera
**jamás** en los listados).

**El precio, dicho:** un formulario **precargado** se lee como trabajo en curso aunque el usuario
no haya tocado nada. Es el lado correcto del error: el aviso espera.

### Y el aviso, como objeto físico

1. **Va arriba.** `fixed bottom-0` ponía «Actualizar ahora» justo encima de «Guardar gestión»: el
   pulgar apunta a guardar y toca actualizar. En esta app las acciones viven abajo.
2. **Se puede quitar** («Ahora no»).
3. **El texto ya no promete.** Decía *«Tu trabajo en pantalla no se pierde»* y era falso. Ahora
   dice lo único que es seguro: *«Actualizar recarga la pantalla. Hazlo cuando hayas terminado lo
   que tengas a medias.»* Prometer menos y cumplir.

### Probado sobre el caso REAL, y encontró un error mío

La guardia monta **el `GestionarOrdenPanel` de verdad** (con la misma tramoya de mocks que
`GestionarOrdenPanelPagos.test.tsx`), abre la rama de entrega, teclea el recaudo y afirma tres
cosas:

- `monto.defaultValue === monto.value` — **la prueba de que la heurística vieja no habría visto
  nada**, sobre el componente real y no sobre un input de laboratorio;
- `hayTrabajoEnCurso(document) === true` y `trabajoDeclarado() === ["gestion:g1"]`;
- **el aviso NO se pinta** mientras «Guardar gestión» está en pantalla.

**Y el caso real cazó un error mío en el mismo commit**: escribí la condición como
`paso === "resultados"`, y al pulsar «Entregar» el paso pasa a `"formulario"` — la declaración se
habría retirado **justo al empezar a capturar**, que es el peor momento posible. Con un input de
laboratorio eso no se ve. Va como mutación **17** para que no vuelva.

### Lo que sigue SIN cubrir, dicho antes de que alguien lo suponga

El registro cubre **lo que se declara**: hoy, el panel de gestión del mensajero. Una pantalla
nueva con datos sin guardar **no se protege sola** — tiene que llamar a `useDeclararTrabajo`. La
capa 2 la cubre **si** su estado se refleja en un `input`/`textarea`, que es lo normal, pero no si
vive sólo en React (como las fotos). Por eso el banner ya no promete.

---

## 14 · B3 — el spec decía lo contrario de lo que hace el código

`specs/284-pwa-correcta/requirements.md` corregido **con marca de fecha**, diciendo qué afirmaba
cada requisito y por qué cambió — no reescrito en silencio:

- un bloque **⚠️ CORRECCIÓN del 2026-08-25** con la tabla de las cinco divergencias (R3, R5, R7,
  R15 y los dos «fuera de alcance» que dejaron de estarlo);
- y la marca **en el propio requisito**, para que nadie lea R3/R5/R7/R15 sueltos y se lleve lo
  contrario;
- más **R25** (los tres archivos se sirven sin sesión) y **R26** (nada de
  `crossorigin="use-credentials"` mientras el manifiesto sea estático), que este spec no tenía.

---

## 15 · Mutaciones de la segunda ronda: 6 de 6 muertas, control verde

```
== 14 devolver el matcher a solo-imagenes (el defecto de B2)
   tests/unit/guards/pwa-servida-sin-sesion.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  4 failed | 7 passed (11)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
   × /manifest.json no pasa por el guard de sesión 8ms
   × /sw.js no pasa por el guard de sesión 1ms
   × /offline.html no pasa por el guard de sesión 0ms
   × la exclusión va por NOMBRE y no por extensión 2ms
== 15 volver a comparar value con defaultValue (el defecto de B1)
   tests/unit/guards/pwa-aviso-sin-recarga.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  1 failed | 21 passed (22)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
   × un input CONTROLADO con texto tecleado cuenta como trabajo 38ms
== 16 que el panel de gestion deje de declarar su trabajo
   tests/unit/guards/pwa-aviso-sin-recarga.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  3 failed | 19 passed (22)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
   × con la rama de entrega abierta y el monto tecleado, hay trabajo en curso 230ms
   × y con eso, el aviso de version nueva NO se pinta sobre el panel 171ms
   × al desmontar el panel, la declaracion se retira sola 84ms
== 17 el paso equivocado: solo `resultados` (el error real que el caso destapo)
   tests/unit/guards/pwa-aviso-sin-recarga.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  2 failed | 20 passed (22)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
   × con la rama de entrega abierta y el monto tecleado, hay trabajo en curso 206ms
   × al desmontar el panel, la declaracion se retira sola 86ms
== 18 el banner vuelve abajo, encima de Guardar gestion
   tests/unit/guards/pwa-aviso-sin-recarga.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  1 failed | 21 passed (22)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
   × G3: el banner va ARRIBA y se puede quitar, y su texto no promete nada 15ms
== 19 el banner vuelve a prometer lo que no puede cumplir
   tests/unit/guards/pwa-aviso-sin-recarga.guardia.test.ts -> MUERTA (roja)
   Test Files  1 failed (1)
   Tests  1 failed | 21 passed (22)
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
   × G3: el banner va ARRIBA y se puede quitar, y su texto no promete nada 20ms
== control  reordenar un comentario del middleware
   tests/unit/guards/pwa-servida-sin-sesion.guardia.test.ts -> SUPERVIVIENTE (verde)
   Test Files  1 passed (1)
   Tests  11 passed (11)

RESULTADO: 6 de 6 mutaciones muertas.
CONTROL (cambio inocuo): SUPERVIVIENTE (verde) -- tiene que ser SUPERVIVIENTE (verde).
```

**Total de la ficha: 19 mutaciones muertas y 2 controles verdes.**

### Un incidente del propio arnés, que hay que escribir

La primera pasada de esta tanda **destruyó trabajo sin commitear**. El arnés revierte cada
mutación con `git checkout -- <archivo>`, y tres de los archivos mutados
(`middleware.ts`, `lib/pwa/actualizacion.ts`, `GestionarOrdenPanel.tsx`) **todavía no estaban
commiteados**: el `checkout` no revirtió la mutación, revirtió **mi arreglo entero** a la versión
de `HEAD`. Se recuperó de una copia y reescribiendo, y se volvió a medir **después de commitear**
—que es como se corrió la primera tanda y por eso allí no pasó—.

**La regla, para que no vuelva:** un arnés de mutaciones que revierte con `git` exige que el
árbol esté **commiteado antes de empezar**. Si no, no es un arnés: es un `git checkout` con pasos
extra. Se detectó porque la mutación siguiente cantó `MUTACION VACIA: no se encontro el texto` —o
sea que la autocomprobación del arnés hizo su trabajo—.

---

## 16 · Gate de la segunda ronda

`pnpm run db:generate` corrido antes. Gate **completo**, con el código de salida **dentro** del
log y sin `tail` en medio:

```
{ ./init.sh; echo "INIT_EXIT=$?"; } > gate2.log 2>&1
```

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=6)
✓ specs presentes para features sdd en vuelo
✓ typecheck paso
✓ lint paso
     × ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación `@sin-superficie` 8ms
 FAIL  tests/unit/guards/superficie-de-uso.guardia.test.ts > R-A — toda Server Action tiene superficie, o dice por escrito por qué no > ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación `@sin-superficie`
 Test Files  1 failed | 1406 passed (1407)
      Tests  1 failed | 19181 passed | 26 skipped (19208)
✗ 'pnpm run test' fallo
INIT_EXIT=1
```

**Veredicto: `INIT_EXIT=1` por el MISMO rojo ajeno de siempre. Delta 0.**

- El rojo es `superficie-de-uso.guardia.test.ts` › *ninguna Server Action de `lib/actions/**` es
  inalcanzable…*, con un único item: **`lib/actions/tarifas.ts:67 obtenerTarifa`** — ficha
  **275**, ajena a esta.
- El delta se midió en la primera ronda **en un worktree limpio en `4dc572e3`** (mismo fallo,
  mismo item) y se vuelve a confirmar por comparación directa: **1 rojo antes, 1 rojo después, el
  mismo nombre**. Esta ronda toca `middleware.ts`, que es entrada del grafo de alcanzabilidad de
  esa guardia, así que la comparación no era un trámite: si mi cambio hubiera dejado alguna
  Server Action sin superficie, ahí habría **dos** items y no uno.
- El resto: `typecheck paso`, `lint paso` (0 errores; los warnings son preexistentes, ninguno en
  archivos de esta ficha), **1406 de 1407 archivos de test en verde** y **19.181 tests pasando**
  — 15 más que en la primera ronda, que son los casos nuevos de B1 y B2.
- Las **cinco** guardias de la ficha suman **71 casos**, todas verdes dentro de esa corrida.
