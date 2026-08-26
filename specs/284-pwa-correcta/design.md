# 284-pwa-correcta — design.md

> Arregla lo evidenciado. **No rediseña la PWA.** El diff cabe en cinco archivos de
> producción: `app/layout.tsx`, `public/manifest.json`, `public/sw.js`,
> `public/icons/icon-180.png` (nuevo) y nada más.

## 1 · Lo que NO se toca, y por qué importa decirlo

| Capa | Decisión |
| --- | --- |
| Modelo de datos | **ninguna tabla, ninguna columna, ninguna migración, ningún RLS.** Esta feature no toca Postgres. |
| Endpoints / rutas Next | **ninguna ruta nueva**. Ni route handler, ni server action, ni página. |
| Contratos de servicio | ninguno. No hay `lib/services/` ni `lib/repositories/` en juego. |
| Integraciones | sólo el despliegue de **Vercel** (HTTPS, que es lo que hace posible el SW). |
| `lib/auth/menu-visibility.ts` | **se LEE, no se toca.** Es la fuente de verdad de qué rol llega a dónde y aquí entra sólo como entrada de una guardia. |

Consecuencia práctica para el gate: ninguna de las rutas tocadas está en
`RUTAS_SENSIBLES` ni casa `NOMBRES_DE_DINERO` (`init.sh:158-159`), así que
`./init.sh --rapido` **no se niega**. Eso NO significa que baste: ver §7.

## 2 · Inventario del cambio

| Archivo | Qué cambia | Requisitos |
| --- | --- | --- |
| `app/layout.tsx` | `lang="en"` → `lang="es"`; `<meta name="mobile-web-app-capable">` nuevo junto al de Apple; `apple-touch-icon` → `/icons/icon-180.png` | R1, R18, R19 |
| `public/manifest.json` | `+ "id": "/"`; **nada más** (el resto es no regresión) | R14, R15, R16 |
| `public/sw.js` | rama de producción: fuera `skipWaiting()`; `activate` purga por lista; nombres de caché a `v2`; tope FIFO en el `fetch` de estáticos; sólo se cachea `response.ok` | R3–R5, R7–R13 |
| `public/icons/icon-180.png` | nuevo, 180×180 | R19, R20 |
| `tests/unit/guards/*` | tres guardias nuevas | R24 y toda la trazabilidad |
| `docs/release.md` | entradas en «Pendiente para la PRÓXIMA release» | R21–R23 |

---

## 3 · LA decisión de la ficha: cómo se coordina el relevo del SW

### El problema, en una frase

`install` llama `skipWaiting()` y `activate` llama `clients.claim()`
(`sw.js:42,47`). Eso pone al SW **nuevo** al mando **con la página vieja todavía
viva**: esa página sigue pidiendo los chunks de la build anterior, y el despliegue
nuevo ya los quitó del servidor. Resultado: error de carga de chunk en la cara del
mensajero, a mitad de lo que estuviera haciendo. Y es el defecto más urgente
porque **el propio despliegue de mañana es el disparador**.

### La decisión: el SW nuevo espera; el viejo sirve hasta que no quede nadie

Se **quita `self.skipWaiting()`** de la rama de producción. El SW nuevo se instala,
se queda en `waiting` y **no toca nada**. El SW viejo sigue controlando la página
viva **con su caché intacta**, así que la página vieja siempre encuentra los chunks
que pide. El relevo ocurre cuando ya no queda ningún cliente controlado —el usuario
cierra la PWA— y entonces el SW nuevo activa y purga con la casa vacía.

`clients.claim()` **se conserva** en `activate`. Sin `skipWaiting`, un `activate`
sólo puede ocurrir con **cero** clientes controlados, así que `claim` deja de ser
un riesgo: su único efecto real es la **primera instalación** de la vida del
navegador, donde no hay ninguna página vieja que romper y sí conviene que la
protección empiece cuanto antes.

**Esta decisión y la de la purga son la misma decisión.** La regla «no hay relevo
bajo una página viva» es exactamente lo que hace **seguro** borrar cachés en
`activate`: cuando el borrado corre, no hay nadie usándolas. Sin R3, la purga de R7
sería una forma nueva de romper al usuario, no un arreglo.

### El precio, dicho antes de cobrarlo

La versión nueva de la app llega al teléfono **en el siguiente arranque completo**
de la PWA. Si el mensajero deja la app abierta tres días, sigue con la versión de
hace tres días. Es un precio real y va como pregunta abierta (Q7). Hoy los
instalados son ~0, así que el precio empieza a correr **después** del lanzamiento,
no durante.

### Lo que se rompe con los otros caminos

| Alternativa | Qué la hace atractiva | Por qué se descarta |
| --- | --- | --- |
| **A1 · `skipWaiting()` + recarga forzada** (`controllerchange` → `location.reload()`) | el usuario siempre tiene la última versión, y no hay ventana de desajuste | **recarga al mensajero a mitad de una gestión**. Con la app instalada eso es peor que el problema que arregla: se lleva el formulario a medio llenar, la foto del comprobante sin subir y el escáner abierto. El propio encargo lo señala. |
| **A2 · esperar en `waiting` + avisar con un botón «actualizar»** | conserva la garantía de A y elimina el precio de Q7 | es **UI nueva** —componente, estado, `postMessage` al SW, `controllerchange`, tests de componente— la víspera del lanzamiento. Y su parte peligrosa (el `reload` tras aceptar) es exactamente A1, sólo que consentida. Es la evolución natural de esta ficha: **ficha aparte**, no hoy. |
| **A3 · dejar que el SW viejo sirva hasta cerrar, pero además `clients.claim()` agresivo** | ninguna | es lo que hay hoy: `claim()` con `skipWaiting()` es justo el defecto 3. |
| **A4 · no registrar el SW en absoluto hasta después del lanzamiento** | cero riesgo de relevo | tira la PWA entera —instalabilidad, pantalla offline, caché— por un defecto que se arregla quitando una línea. Y `beforeinstallprompt` deja de dispararse: el botón de instalar de la ficha 164 desaparece. |

---

## 4 · La política de purga

Tres mecanismos, cada uno con su disparador. Ninguno puede borrar lo que una página
viva está usando, y por razones distintas.

### P1 · En `activate`: borrar toda caché fuera de la lista vigente (R7)

```
activate → for (const nombre of await caches.keys())
             if (!VIGENTES.has(nombre)) await caches.delete(nombre)
           → clients.claim()
```

Seguro **porque** R3 garantiza que `activate` corre sin clientes controlados.

### P2 · Los nombres suben a `v2` (R8)

`next-static-v1` → `next-static-v2`, `pages-cache-v1` → `pages-cache-v2`. Sin esto,
P1 no borraría **nada**: la caché acumulada por el SW anterior se llama igual que la
nueva y sobreviviría entera. Con esto, el primer `activate` del SW nuevo se lleva de
una vez todo lo que se acumuló en el teléfono desde la ficha 64. Es un barrido
**único**, no una convención de versionado por despliegue (ver A5).

### P3 · Tope FIFO en la caché de estáticos (R9, R10)

```
fetch(/_next/static/…) → cache-first
  miss → red → if (!response.ok) devolver SIN cachear      (R11)
              → cache.put(request, clone)
              → event.waitUntil(recortar(cache, TOPE))     (R9, R10)
```

`recortar` lee `cache.keys()` —que devuelve las claves **en orden de inserción**— y
borra desde el principio hasta que quedan `TOPE` entradas.

**Por qué P3 es imprescindible y P1+P2 no bastan.** Los chunks cambian de hash en
**cada** despliegue; `sw.js` **no**. Si un despliegue no toca el SW, no hay SW nuevo,
no hay `activate`, no hay P1 — y la caché sigue engordando dentro del mismo nombre.
P3 es el único mecanismo que acota **siempre**.

**Por qué borrar por FIFO no rompe la página viva.** Lo primero que sale es lo que
entró antes, o sea lo de los despliegues **más viejos** — justo lo que ya no sirve.
Y si el recorte llegara a tocar una entrada de la build **vigente**, el coste es una
**recarga desde red**: ese archivo sigue existiendo en el servidor. El daño real de
esta ficha nunca fue «falta en la caché», fue «falta en la caché **y** ya no está en
el servidor», y eso sólo le pasa a lo viejo.

**El tope (R13).** Una sola constante, `TOPE_ESTATICOS`, en la cabecera del SW. Se
fija midiendo cuántos `/_next/static/` **distintos** carga un recorrido completo del
mensajero (DevTools → Network, filtro `_next/static`, contar) y poniendo al menos el
doble, para que un turno entero quepa sin que el recorte entre en bucle. Si no se
puede medir hoy: **200 y la palabra «sin calibrar» escrita**, con el precedente de
`RUTA_ORIGEN_MAX_KM` en este repo.

### Alternativas descartadas de la purga

| Alternativa | Por qué se descarta |
| --- | --- |
| **A5 · versionar el nombre de la caché por despliegue** (`next-static-${SHA}`) | es lo correcto en teoría y **no hay de dónde sacar el SHA**: `public/sw.js` es un archivo estático que Next no procesa. Las dos vías serían servir el SW desde un route handler —cambiar cómo se entrega el SW la víspera del lanzamiento, con sus cabeceras y su `Service-Worker-Allowed`— o que un paso de build **reescriba un archivo versionado**, que en este repo tiene nombre: drift. |
| **A6 · borrar la caché estática ENTERA en cada `activate`** | seguro (por R3) y más simple que P3, pero tira el caché caliente completo cada vez que cambia el SW **y no acota nada cuando el SW no cambia**, que es la mayoría de los despliegues. P3 cubre los dos casos. |
| **A7 · dejar de cachear `/_next/static/` y confiar en la caché HTTP** (`immutable`, la desaloja el navegador) | **elimina la clase entera de bug** y es la alternativa más fuerte que se consideró. Se descarta porque **reduce** lo que hoy existe: es la mitad de la razón por la que la app arranca rápido en un teléfono barato con mala señal, y tocar el alcance del caché es materia de la ficha **285**, no de un arreglo. Queda anotada aquí para que la 285 la evalúe con el problema entero delante. |
| **A8 · purgar por edad (`Date` de la respuesta) en vez de por número** | la respuesta cacheada no lleva una edad fiable (`Date` es del origen y las respuestas `immutable` de Next se reusan), y `cache.keys()` ya da un orden **real** de inserción. Más complejidad, misma garantía. |

---

## 5 · Los atajos del manifiesto (`shortcuts`)

### El hecho incómodo

Los atajos son **por app**, no por rol. Un atajo a `/ordenes` es lo que ve el
`mensajero` en el menú largo del icono, y al pulsarlo el middleware lo deja pasar
—tiene sesión— y la página resuelve su rol y le devuelve `notFound()`. Sin sesión es
peor: `/login?redirect=/ordenes`. **Cada** destino de `SIDEBAR_ITEMS` es invisible
para al menos un rol; el único destino universal es `/dashboard`, que despacha por
rol (`app/(app)/dashboard/page.tsx:43-44`) y que **ya es** el `start_url` a efectos
prácticos (`middleware.ts:56-58` redirige `/` → `/dashboard` con sesión). Un atajo a
`/dashboard` no es un atajo: es abrir la app.

### La decisión

**No se declara ningún atajo, y se pone una guardia que impide declarar uno malo.**
La guardia deriva las reglas de `SIDEBAR_ITEMS` en vez de repetirlas:

```
rolesConMenu   = unión de item.roles sobre SIDEBAR_ITEMS        (hoy 5)
rolesQueLlegan = roles del ítem (o del padre del subítem) cuyo href === url
regla          = ∀ atajo: rolesQueLlegan(url) ⊇ rolesConMenu
                          ∨ url ∈ DESPACHADORAS (lista declarada, con motivo)
```

`DESPACHADORAS = ["/dashboard"]` y su motivo va escrito en el propio archivo de la
guardia: es la única ruta que resuelve el destino por rol en vez de negarlo. Nada de
listas de roles copiadas: el día que entre un rol nuevo al menú, la regla se entera
sola.

Esto **resuelve el defecto declarándolo**, que es lo que pedía el encargo: la ficha
deja de tener «shortcuts en 0 por olvido» y pasa a tener «shortcuts en 0 por una
razón escrita y vigilada». Q2 abre la puerta a las otras dos salidas.

### Alternativas descartadas de los atajos

| Alternativa | Por qué se descarta |
| --- | --- |
| **A9 · atajos del mensajero** (`/mis-asignaciones/reparto`, `/mis-asignaciones/recoger`, `/cierre-dia`) aceptando el 404 para los otros cuatro roles | el mensajero es la mayoría de las instalaciones, pero no es la totalidad, y el precio del error es un **404 en el menú del icono de la app**. En una app que estrena, eso se lee como «la app está rota», no como «ese atajo no es para ti». |
| **A10 · una ruta despachadora** (`/ir/<destino>` que resuelve el rol y redirige o cae a `primerDestino`) | es **la** solución correcta y es **código de producción nuevo** —ruta, guard, tests— para una mejora de comodidad, la víspera del lanzamiento. Ficha aparte, ya escrita como opción en Q2. |
| **A11 · manifiesto dinámico por rol** (route handler que lee la sesión y emite los atajos del rol) | el manifiesto se descarga **sin credenciales** salvo que el `<link>` declare `crossorigin="use-credentials"`, el navegador lo **congela al instalar** y el rol de un usuario puede cambiar después. Se acaba con atajos de otro rol grabados en el icono, que es peor que no tener atajos. |

---

## 6 · Cómo se prueba un service worker, que no es trivial

### 6.1 · Lo que SÍ se automatiza: un arnés que ejecuta el SW de verdad

`public/sw.js` no lo importa nadie y no se puede `import`: usa `self`,
`addEventListener`, `caches` y `clients`. La guardia lo **ejecuta**:

1. lee el fuente con `readFileSync`;
2. lo envuelve en `new Function("self","caches","fetch","URL","Response", fuente)` —
   los parámetros **tapan** los globales, así que el SW no puede tocar nada real;
3. le pasa un `self` falso (`addEventListener` que registra los manejadores,
   `location.hostname`, `skipWaiting` y `clients.claim` **espiados**,
   `registration.unregister`), un `CacheStorage` falso en memoria (un `Map` de
   `Map`s que **conserva el orden de inserción**, que es justo lo que P3 explota) y
   un `fetch` falso programable;
4. **dispara los eventos**: fabrica un `event` con `waitUntil`/`respondWith` que
   guarda las promesas, llama al manejador y **espera** esas promesas. Nada de
   `setTimeout`: el test es determinista.

Con eso se afirma **comportamiento**, no texto:

| Caso | Afirma |
| --- | --- |
| `install` en producción | precachea `/` y `/offline.html`, y **`skipWaiting` no se llamó ni una vez** (R3, R12) |
| `activate` con `next-static-v1`, `pages-cache-v1` y una caché ajena sembradas | quedan **sólo** las vigentes; las tres se borraron (R7, R8) |
| `fetch` de un estático con la caché al tope | quedan `TOPE` entradas, se fueron las **más antiguas** y **la recién guardada sigue estando** (R9, R10) |
| `fetch` de un estático que devuelve 404 | la caché **no crece** y la respuesta se devuelve igual (R11) |
| `fetch` de `/api/…` y de `*.supabase.co` | `respondWith` **no** se llama (no regresión de la 64) |
| el SW en `localhost` | limpia, `unregister` y renavega: el kill-switch sigue vivo (R6) |
| todo el fuente de producción | **cero** llamadas a `client.navigate` / `location.reload` (R5) |

Ese último caso es el único que se afirma **leyendo** en vez de ejecutando, y se
dice por qué: R5 es una prohibición universal («en ninguna circunstancia»), y una
prohibición no se demuestra ejecutando un puñado de caminos.

### 6.2 · Lo que NO se puede automatizar aquí, y se dice en vez de fingirlo

- **Que el navegador de verdad deje al SW en `waiting`.** El arnés prueba que el
  SW **no pide** el relevo; que el navegador lo **respete** es el estándar, y sólo
  se ve en un navegador. → comprobación manual **M2**.
- **Que la página vieja siga cargando sus chunks durante un despliegue.** Exige dos
  builds distintas servidas de verdad. → **M3**.
- **Que la app siga siendo instalable** y que el diálogo salga bien. → **M4**.
- **El `lang` en el documento servido** (no en el fuente). → lo mide Lighthouse, **M5**.
- **E2E con Playwright: no.** Hay `e2e/` y `playwright.config.ts`, pero `vitest`
  sólo incluye `tests/**` (`vitest.config.ts:68`) y las specs de este repo declaran
  sus e2e `NOT EXECUTED`. Escribir aquí un `e2e/pwa.spec.ts` sería **cobertura
  fingida**. No se escribe.

### 6.3 · El guion manual, con su criterio (R23)

Se corre sobre un despliegue **HTTPS que no sea `localhost`** (Q3). En `localhost` el
SW de producción no existe: se autodestruye (`sw.js:7-9`) sin mirar `NODE_ENV`, y
`pnpm build && pnpm start` **tampoco** sirve — está medido y escrito en
`progress/current.md:4755-4759`.

| # | Paso | Criterio de «pasa» |
| --- | --- | --- |
| **M0** | Antes de tocar nada: DevTools → Application → Service Workers y Cache Storage sobre el despliegue **vigente** | se anotan: si el SW está `activated`, los nombres de caché y **cuántas entradas** tiene cada una. Es la línea base de la ficha (T0, Q8) |
| **M1** | Con la app abierta, desplegar la versión nueva y recargar | aparece un SW **`waiting`** y el que dice **`activated`** sigue siendo el anterior |
| **M2** | Sin cerrar la app, navegar por tres pantallas | **cero** errores de carga de chunk en Console; la caché **`next-static-v1` sigue existiendo** (nadie la borró bajo la página viva) |
| **M3** | Cerrar TODAS las ventanas de la app y volver a abrirla | el SW nuevo está `activated`; en Cache Storage quedan **sólo** `next-static-v2` y `pages-cache-v2`; las `v1` **desaparecieron** |
| **M4** | Navegar hasta superar el tope y mirar Cache Storage | el número de entradas de `next-static-v2` **no pasa** de `TOPE_ESTATICOS` |
| **M5** | Application → Manifest | **sin errores de instalabilidad**; `id` presente; la app **no** aparece duplicada en el lanzador de un teléfono que ya la tuviera instalada |

Cada fila se responde con un **número o un nombre**, nunca con «se ve bien», y va a
`progress/impl_284-pwa-correcta.md`. Las que sólo se pueden hacer tras desplegar van
además a `docs/release.md` → «Pendiente para la PRÓXIMA release», que es el
mecanismo que este repo ya tiene para que una comprobación no caduque en el
`tasks.md` de una ficha cerrada.

---

## 7 · Lighthouse: cómo se mide de verdad

**El antecedente que hay que no repetir.** La R17 de la ficha 64 se aprobó con esta
frase: «los elementos necesarios están presentes y correctos, **lo que asegura el
puntaje**» (`progress/review_64-pwa-basic.md:43`). Eso es un razonamiento, no una
medida, y en este repo un razonamiento ya fue desmentido por la primera medición que
se tomó en serio. Aquí no se aprueba nada sin número.

**No se añade dependencia.** No hay `lighthouse` en `package.json` y añadirlo (a) es
tocar `package.json`, que **niega el gate rápido** (`init.sh:158`), y (b) mete una
instalación la víspera del lanzamiento. **La medida es manual**, y por eso se
escribe con precisión suficiente para que sea repetible.

### El procedimiento

1. Abrir en **Chrome de escritorio**, ventana **de incógnito** (sin extensiones), la
   URL del despliegue de Q3.
2. Iniciar sesión con una cuenta de **mensajero** —es quien usa la PWA— y quedarse en
   la pantalla que resulte.
3. DevTools → **Lighthouse** → dispositivo **Mobile**, categorías **Accesibilidad** y
   **Prácticas recomendadas** (y **PWA** si esa categoría existe en esa versión;
   Q4) → *Analyze page load*.
4. Anotar, en `progress/impl_284-pwa-correcta.md`: **URL exacta**, **fecha**,
   **versión de Chrome**, **versión de Lighthouse** (la escribe el propio informe),
   y **el número de cada categoría**.
5. Abrir en el informe las auditorías `html-has-lang` y `html-lang-valid` y anotar
   su estado.
6. DevTools → Application → **Manifest** y anotar la lista de errores de
   instalabilidad (**cero** es lo esperado).

### El umbral que se exige

| Medida | Umbral | Requisito |
| --- | --- | --- |
| `html-has-lang` | **PASS** | R21 |
| `html-lang-valid` | **PASS** | R21 |
| Categoría **Accesibilidad** | **≥ 90** | R21 |
| Errores de instalabilidad en el panel Manifest | **0** | R22 |
| Categoría **PWA** | **sólo si existe** en esa versión de Lighthouse. Si no existe, se escribe literalmente «no existe en Lighthouse vX» y el umbral lo cubren las dos filas de arriba | Q4 |

El umbral se expresa así **a propósito**: no depende de que exista una categoría
"PWA" —que puede no estar en la versión instalada—, y las dos auditorías de idioma
son binarias, así que R1 queda medido con un PASS/FAIL y no con un promedio que
podría pasar de 90 con el `lang` roto.

**Si el número no llega al umbral, la ficha no está hecha.** Se escribe el número
que salió y qué auditoría lo baja; no se aprueba «con nota».

---

## 8 · Dónde viven los tests, y por qué ahí (R24)

Las tres guardias van a `tests/unit/guards/`:

| Archivo | Cubre |
| --- | --- |
| `pwa-relevo-y-purga.guardia.test.ts` | R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13 |
| `pwa-manifiesto-atajos.guardia.test.ts` | R14, R15, R16, R17, R20 |
| `html-lang.guardia.test.ts` | R1, R2 |

**Por qué en `guards/` y no en `tests/unit/pwa/`.** `--rapido` selecciona por grafo
de imports y **nadie importa `public/sw.js` ni `public/manifest.json`**: un cambio
ahí selecciona **cero** tests y el gate sale verde sin haber ejecutado uno solo. Las
guardias, en cambio, corren **siempre** (`vitest run guard` casa por ruta, y
`tests/unit/guards/` contiene «guard»). Es exactamente el agujero que
`docs/verification.md:90-94` describe.

**`tests/unit/pwa/manifest.test.ts` NO se renombra ni se borra.** Ocho filas de
`specs/164-instalar-pwa/tasks.md` lo citan por nombre, y la guardia
`test-citado-desaparecido.guardia.test.ts` se pone roja si un test citado
**existió y hoy no está**. Se deja donde está y las comprobaciones nuevas van en un
archivo nuevo. (Moverlo a `guards/` **conservando el nombre exacto** sería válido
—esa guardia acepta la cita por nombre de archivo— pero no aporta nada que no aporte
el archivo nuevo, y mover archivos ajenos la víspera del lanzamiento no se paga
solo.)

---

## 9 · Contratos de entrada/salida

No hay API. Los únicos «contratos» son formas de datos estáticos:

**`public/manifest.json`** — se añade una clave y no se quita ninguna:

```jsonc
{
  "id": "/",                    // NUEVO. Exactamente "/" y no otra cosa: el id por
                                // defecto de una app instalada es su start_url, así
                                // que "/" preserva la identidad. Cualquier otro
                                // valor ("ordenex", "/?source=pwa") la CAMBIA y el
                                // teléfono acaba con dos Ordenex instalados.
  "name": "Ordenex", "short_name": "Ordenex", "description": "…",
  "start_url": "/", "scope": "/", "display": "standalone",
  "orientation": "portrait-primary",              // YA ESTABA (corrección a la ficha)
  "categories": ["business", "productivity"],     // YA ESTABA (corrección a la ficha)
  "theme_color": "#0d2444", "background_color": "#f7f8fc",
  "icons": [ … ], "screenshots": [ … ]
  // "shortcuts": ausente a propósito. Ver §5.
}
```

**`public/sw.js`** — la cabecera de la rama de producción queda con tres constantes
y ninguna más:

```
CACHE_NAMES     = { static: "next-static-v2", pages: "pages-cache-v2" }
PRECACHE_URLS   = ["/", "/offline.html"]          // R12: no se amplía
TOPE_ESTATICOS  = <medido, o 200 «sin calibrar»>  // R13
```

**`app/layout.tsx`** — el `<head>` queda con las dos metas de capacidad (la moderna
y la de Apple, **ambas**: retirar la de Apple deja fuera a los iPhone que aún la
leen) y el `apple-touch-icon` apuntando a 180.

---

## 10 · Riesgos declarados

| Riesgo | Mitigación |
| --- | --- |
| Un usuario se queda en la versión vieja hasta cerrar la app (Q7) | aceptado y escrito; hoy los instalados son ~0. La salida es A2, ficha aparte |
| El tope se fija sin medir (Q5) | se escribe la palabra «sin calibrar», con precedente en el repo, y se re-mide con tráfico real |
| `install` podría estar fallando hoy y toda la premisa caería (Q8, H2) | **T0 lo mide antes de tocar nada** |
| El precaché de `/` guarda la página de la sesión de quien instaló (H2) | fuera de alcance, **anotado para la 285**, y T0 mira qué hay guardado bajo `/` |
| `scripts/generate-pwa-icons.mjs` no puede reproducir los iconos (su fuente `public/next.svg` ya no existe) | el 180 se genera reescalando `icon-512.png`; el generador queda roto y anotado (Q6) |
