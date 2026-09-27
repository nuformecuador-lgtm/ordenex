# Revisión de la ficha 433 — el módulo de ayuda dentro de la app

> Rama `feat/433-modulo-de-ayuda`, SHA **87af5131**. Revisión hecha sobre el árbol de ese commit.
> La ficha es `sdd: false` y no tiene carpeta `specs/`: **la especificación es el `status_note`**
> de `feature_list.json` en `dev`, y contra él se traza todo lo de abajo.

**VEREDICTO: RECHAZADO.** Un solo bloqueante, y es **deuda de test, no un defecto de
comportamiento**: las tres piezas que CABLEAN el módulo —el `notFound()` del servidor, el gate del
layout y el montaje del «?» en `PageHeader`— no las cubre ningún test. Está demostrado con
mutaciones: las tres sobreviven a la suite. El resto del trabajo es de calidad alta y el gate
completo pasa en verde en mi propia corrida.

---

## Cómo se revisó (lo que el navegador no ve)

- **Árbol.** No detaché la copia principal del repo: la rama ya estaba en el worktree
  `.claude/worktrees/agent-addcbde70379ddcc6`, exactamente en `87af5131` y limpia, y detachar la
  copia compartida habría movido el HEAD de la sesión que me lanzó. Mismo árbol, mismo SHA.
- **Gate completo, corrido por mí** (no el del implementador): `./init.sh`, 2017 archivos,
  **29434 tests pasados, 26 saltados, INIT_EXIT=0**, typecheck y lint en verde, `.env` presente
  y **279 archivos de `tests/integration/db` ejecutados** (no saltados). Los 26 saltados son los
  mismos que trae `dev`. El aviso «migraciones sin down.sql» es de tres migraciones del
  2026-08-14, **ajeno a esta ficha**.
- **Mutaciones.** Cinco, aplicadas y revertidas una a una, con control previo (el set relacionado
  verde: 9 archivos / 134 tests) y con una mutación de contraste que SÍ muere, para no repetir el
  arnés de mutaciones que miente. El árbol quedó idéntico a `87af5131` (`git status` limpio).
- **Grafo (`codebase-memory`).** Disponible y usado, pero **su índice es de `dev`**: no conoce
  ningún símbolo de `lib/ayuda/**` (devuelve el otro «ayuda» del repo: `orden-ayuda`,
  `rescate-ayuda`). Todo lo de esta rama se verificó **leyendo los archivos reales**.
- **`outputFileTracingIncludes`** se comprobó ejecutando el propio `picomatch` y el propio
  `glob` del Next instalado (16.2.10), no leyendo la documentación.

### Las cinco mutaciones

| # | Mutación | Qué se corrió | Resultado |
|---|---|---|---|
| M1 | `app/(app)/ayuda/[...slug]/page.tsx:39` — quitar `!documentoVisiblePara(...)` del `notFound()` | set relacionado (7 arch.) + **las 230 guardias (3346 tests)** | **SOBREVIVE** |
| M2 | `app/(app)/ayuda/layout.tsx:29` — neutralizar el gate `ROLES_AYUDA` | set relacionado | **SOBREVIVE** |
| M3 | `lib/ayuda/documento.ts:129` — `documentoVisiblePara` devuelve siempre `true` | set relacionado | **MUERE** (13 fallos / 3 archivos) |
| M4 | `components/shared/PageHeader.tsx:97` — el montaje del botón pasa a `{null}` (el import se queda) | 230 guardias + **`tests/components` + `tests/integration` enteros: 727 archivos, 9375 tests** | **SOBREVIVE** |
| M5 | `next.config.ts:59-61` — borrar `outputFileTracingIncludes` | 230 guardias | **SOBREVIVE** |

M3 es el control: el arnés sí mata cuando hay con qué. M1, M2 y M4 son el bloqueante.

---

## Trazabilidad: cada afirmación del status_note y su test

| Afirmación de la ficha | Test que la verifica | ¿Mata mutaciones? |
|---|---|---|
| Ítem «Ayuda» **al final** del menú lateral | `tests/unit/auth/menu-ayuda.test.ts:33` (+ `menu-mi-bodega`, `menu-historial-acciones`, `menu-visibility` actualizados) | **Sí.** Índice literal del último elemento, y `roles` comparado por **identidad** (`toBe(ROLES_AYUDA)`), no por valor |
| Lo ven las cinco cuentas de persona; `apiKey` no | `menu-ayuda.test.ts:49,64` | Sí |
| **Ningún aterrizaje post-login cambia** | `menu-ayuda.test.ts:73-98` (cinco literales a mano) + `tests/unit/auth/destino-post-login.test.ts` **sin tocar**, con su `toEqual` literal intacto | **Sí.** El ítem no lleva `destinoInicial: false`, que era la trampa de la 429: el `toEqual` literal sigue verde sin haberse relajado |
| «?» en `PageHeader` con la ayuda **de esa pantalla** | `tests/components/AyudaBoton.test.tsx` (13 casos, sobre los .md reales) | Sí para el COMPONENTE. **No para el montaje** (M4) |
| «?» resuelve `/ordenes` distinto por rol | `AyudaBoton.test.tsx:93` y `tests/unit/ayuda/acotamiento-por-rol.test.ts:107` | Sí |
| «?» **no se pinta** donde no hay documento | `AyudaBoton.test.tsx:62-80` | Sí |
| Acotamiento por rol del índice | `acotamiento-por-rol.test.ts` (slugs **escritos a mano**, no derivados) + `tests/components/AyudaIndice.test.tsx` | **Sí.** M3 lo pone rojo en 13 casos |
| Acotamiento por rol de la **URL** (el `notFound()` del servidor) | **NINGUNO** | **No existe** → bloqueante B1 |
| Buscador dentro del módulo | `AyudaIndice.test.tsx:74-111` (monta de verdad, teclea, cuenta enlaces) | Sí |
| Los .md son la **única fuente**; no se copia el texto | `lib/ayuda/catalogo.ts` lee con `fs`; sin artefacto generado, sin tabla, sin migración; `progress/decision_433_lectura_de_los_md.md` lo argumenta | **Verificado a mano sobre el diff:** no añade ni un .md, ni un script de volcado, ni toca `docs/ayuda/**` |
| Los 31 declaran `pantalla:` y las 31 rutas existen | `tests/unit/guards/ayuda-pantalla-ruta-existe.guardia.test.ts` | **Sí, y con anclas anti-vacuidad** (30 documentos mínimo, más de 20 rutas de app, `/ordenes` presente) |
| `fuentes` no se muestra nunca | `ayuda-render-sin-filtracion.guardia.test.ts` + el tipo `DocumentoAyuda` **no tiene el campo** | Sí (la defensa fuerte es el tipo, no la guardia) |

**Medición propia de los .md** (sin fiarme del índice ni de la ficha): 31 documentos + README;
0 `pantalla:` apuntando a una ruta inexistente; visibles por rol 22 / 21 / 9 / 8 / 7
(maestro / admin / adminSatelite / mensajero / adminTienda) — coincide con lo medido en el
navegador.

---

## CHECKPOINTS.md, punto por punto

**Especificación**
- [—] `specs/433/requirements.md`, `design.md`, `tasks.md`: **no aplican**, la ficha es
  `sdd: false` (la regla 2 de `CLAUDE.md` exige SDD sólo para `sdd: true`). `init.sh`
  valida «specs en su sitio» y pasa.

**Trazabilidad**
- [x] Cada afirmación de la ficha tiene test **salvo el gate del servidor** (tabla de arriba).
- [ ] **`progress/impl_433.md` NO EXISTE.** Es la convención viva del repo (`impl_279`,
  `impl_281`…) y el sitio donde vive el mapa requisito→test. Los tests numeran R1…R15 por su
  cuenta y **no hay documento que defina esos R**. Ver m6.

**Calidad de código**
- [x] `pnpm run typecheck` verde. [x] `pnpm run lint` verde (sólo warnings pre-existentes).
- [x] `pnpm test` verde: 29434 pasados, 0 rojos nuevos sobre el baseline.
- [—] E2E: no hay harness de Playwright vivo en este repo; checkpoint inaplicable, y la ficha no
  toca auth, pagos, recaudo, ingesta ni webhooks.

**Datos y seguridad (Supabase)**
- [—] Sin tablas nuevas, RLS no aplica. Sin migraciones, down.sql no aplica. Sin webhooks.
- [x] Sin secretos ni variables de entorno nuevas. Sin logs de PII.

**Patrón de capas**
- [x] No hay controller/service/repository nuevos: el módulo no toca la base. `lib/ayuda/` queda
  como librería, con `catalogo.ts` como **único** módulo que importa `node:fs` y
  `documento.ts` puro — por eso `menu-visibility.ts` puede importarlo sin arrastrar Prisma ni
  `fs` al Sidebar cliente (**verificado leyendo los imports**, no sólo el comentario).

**Permisos**
- [x] Las páginas validan en el servidor vía `resolveActorFromSession()` (cookies).
- [x] El mapa cruza al cliente **ya recortado por rol** (`app/(app)/layout.tsx:100`): un mensajero
  no recibe ni el slug de la ayuda de Wallet.
- [x] **Sin travesía de rutas**: el slug pedido por el usuario se busca con un find sobre el
  catálogo ya leído y **nunca** llega a `fs`. Un `/ayuda/../../.env` no tiene por dónde
  entrar.
- [ ] Pero el gate por rol **no tiene test** (B1).

**Multi-país / configuración**
- [x] Sin hardcode de país, moneda ni cuenta. `fechaLegible()` parte la ISO a mano justamente
  para no depender de la zona horaria.

**Verificación final**
- [x] `./init.sh` verde (corrido por mí, no heredado).
- [x] `progress/review_433.md` existe (este archivo).
- [ ] **Falta la entrada en `progress/history.md`** (m7).

---

## Hallazgos

### BLOQUEANTE B1 — el cableado del módulo no lo cubre ningún test: tres mutaciones sobreviven

No es un fallo de comportamiento: en el navegador todo funciona (está medido). Es que **nada impide
que deje de funcionar**, y las tres cosas que pueden romperse en silencio son las tres promesas
centrales de la ficha.

1. **`app/(app)/ayuda/[...slug]/page.tsx:39-41`** — el `notFound()` por rol. Su propio
   comentario dice que «que el índice no pinte el enlace es presentación; **la defensa real es
   ésta**». M1 la quita y **la suite sigue verde**: un mensajero leyendo
   `/ayuda/oficina/wallet-caja` no rompería nada. Las cuentas de tienda y de satélite son de
   gente ajena a la empresa.
2. **`app/(app)/ayuda/layout.tsx:29-31`** — el gate de `/ayuda` contra `ROLES_AYUDA`. M2
   lo neutraliza y nada se pone rojo.
3. **`components/shared/PageHeader.tsx:97`** — el montaje del botón. M4 lo sustituye por un
   `null` dejando el import, y pasan **las 230 guardias y los 727 archivos de
   `tests/components` + `tests/integration` (9375 tests)**. El «?» —«el acceso que hace que
   el módulo se use», según la propia ficha— desaparecería de las 29 pantallas con el gate en
   verde. `superficie-de-uso.guardia.test.ts` **sólo** lo caza si además se borra el import:
   mide que alguien lo importe, no que alguien lo MONTE. Es la familia «el composition root que no
   inyecta» y «la guardia mide por método, no por escritura», las dos ya conocidas en este repo.

**Qué falta para cerrarlo.** Un archivo de test de página, con el patrón que el repo ya tiene
escrito: `tests/components/RankingHistoricoPage.test.tsx:37-144` mockea `next/navigation`
para que `notFound()` lance `NEXT_NOT_FOUND`, mockea `resolveActorFromSession` y afirma
que llamar a la página rechaza con ese error, rol por rol. Mismos precedentes en
`tests/components/CierresAdminPage.test.tsx` y `tests/integration/wallet-page.test.tsx`. Hay
que cubrir: (a) los tres roles no-oficina contra `oficina/wallet-caja`; (b) sin sesión; (c) un
slug inexistente; (d) el caso positivo (el maestro sí lo abre), para que no sea un test que siempre
lanza; (e) el gate del layout con `apiKey` y sin sesión; y (f) que `PageHeader` monta el «?»
—basta renderizarlo dentro de `AyudaProvider` con un mapa y una ruta y afirmar que aparece el
enlace «Ayuda de esta pantalla»; hoy `AyudaBoton.test.tsx` monta el componente suelto y por eso
no ve el montaje—.

### menor m1 — la línea de next.config.ts que separa «funciona» de «404 en producción» no tiene guardia

`next.config.ts:59-61`. **La declaración está BIEN**, y se verificó ejecutando las piezas reales
del Next instalado (16.2.10), no leyendo la doc: `collect-build-traces.js` casa la clave con
picomatch en modo `contains` contra la ruta normalizada de cada página, y con el patrón de
todas las rutas casan **todas**, incluidas `/ayuda` y `/ayuda/[...slug]`; el valor
`./docs/ayuda/**/*.md` se resuelve con cwd = raíz del proyecto y **devuelve los 32 archivos**.
No hay `.vercelignore`, `docs/ayuda` está versionado (32 archivos) y ninguna página del
portal es estática (todas leen cookies), así que el descarte de páginas estáticas del trazador no
se las salta. El patrón de todas las rutas, en vez de sólo las dos del módulo, **es correcto y
necesario**: el layout del portal lee el catálogo en todas las pantallas.

**Lo que falta es la red:** M5 borra el bloque entero y las 230 guardias siguen verdes. Es
exactamente el fallo mudo que la propia ficha describe. Una guardia de diez líneas que lea
`next.config.ts` y afirme que hay un `outputFileTracingIncludes` cuyo valor cubre
`docs/ayuda` cierra el agujero; el precedente de la casa es
`tests/unit/guards/etiqueta-fuente-diferida.guardia.test.ts`.

### menor m2 — el comentario de AyudaBoton enumera mal las pantallas sin «?»

`components/shared/AyudaBoton.tsx:20-22` dice «seis rutas del portal sin documento
(`/`, `/configuracion/sinpe`, `/mi-bodega`, `/mis-asignaciones`,
`/ranking/historico`, `/recepcion-satelite`)». Medido sobre el árbol de este commit:

- `/` **no es una ruta del portal**: vive fuera de `app/(app)/`, no monta `PageHeader` y
  no tiene proveedor, así que ahí no había «?» que perder.
- Faltan `/ayuda` y `/ayuda/[...slug]`, que **sí** son del portal y **sí** montan encabezado
  (por el `AppPage` del layout del módulo). Que no tengan «?» está bien —ya estás en la ayuda—,
  pero la lista debería decirlo.
- `/mis-asignaciones` y `/recepcion-satelite` son páginas de **sólo redirect**: no pintan
  encabezado, así que tampoco hay «?» que falte.

**El recuento real:** 34 rutas bajo `app/(app)/`; 2 son redirecciones puras; de las 32 que
pintan encabezado, **3 se quedan sin «?» para todo el mundo** (`/configuracion/sinpe`,
`/mi-bodega`, `/ranking/historico`) y 2 son el propio módulo. El «un solo archivo cubre las
29» de la ficha es correcto: 29 `page.tsx` nombran `AppPage` o `PageHeader`
directamente, y las que no (`/analitica` vía `AnaliticaShell`, `/ayuda` vía su layout)
llegan igual por dentro. Por rol, las pantallas del portal con «?» son 19 (maestro), 18 (admin),
6 (adminSatelite), 5 (mensajero) y 4 (adminTienda).

### menor m3 — la guardia del choque de rutas RE-IMPLEMENTA la regla en vez de importarla

`tests/unit/guards/ayuda-pantalla-ruta-existe.guardia.test.ts:157-159` calcula a mano el
«este rol ve este documento» en lugar de llamar a `documentoVisiblePara`. Hoy coinciden, así que
el caso es correcto. Pero el día que alguien cambie la regla —por ejemplo para el hallazgo (a)—,
**la guardia seguirá midiendo la regla vieja** y el choque que existe para impedir (dos documentos
para la misma ruta y el mismo rol) se colaría en silencio. Importar el predicado real cuesta una
línea.

### menor m4 — el portal entero depende ahora de que docs/ayuda se pueda leer

`app/(app)/layout.tsx:100` lee el catálogo **sin try/catch**, y `leerCatalogoAyuda` memoiza
la promesa: si la lectura fallara, la promesa **rechazada queda cacheada** y **todas** las páginas
del portal darían 500 mientras viva el proceso, no sólo `/ayuda`. El radio de daño pasó de «el
módulo de ayuda no abre» a «la aplicación no abre». Con el trazado bien declarado (m1) el escenario
es improbable, pero el fallo seguro debería ser el otro: un catch que devuelva el mapa vacío deja el
portal en pie y sólo quita el «?». Es el mismo criterio de «fallar hacia esconder» que el módulo ya
aplica en `useMapaAyuda`.

### menor m5 — un comentario de otra guardia quedó desactualizado por este cambio

`tests/unit/guards/etiqueta-fuente-diferida.guardia.test.ts:29-31` afirma que
`next.config.ts` **no** declara `outputFileTracingIncludes`. Desde este commit **sí lo
declara**. Es un comentario, no una aserción: nada se pone rojo, y por eso mismo se queda
mintiendo. Una línea.

### menor m6 — falta progress/impl_433.md con el mapa requisito→test

`CHECKPOINTS.md:13` lo pide explícitamente y es la convención viva (`impl_279`,
`impl_281`, …). Hoy está `progress/decision_433_lectura_de_los_md.md`, excelente para el
**porqué** técnico, pero no contiene el mapa. Los tests numeran R1…R15 sin ningún documento que
defina esos R.

### menor m7 — falta la entrada en progress/history.md

`CHECKPOINTS.md:46`. Pendiente de cierre.

### nit — «ayuda» ya significaba otra cosa en este repo

`lib/actions/orden-ayuda.ts`, `lib/services/rescate-ayuda.ts`, `gestion-desde-ayuda.ts` y
`tests/unit/guards/ayuda-columna-retirada.guardia.test.ts` son el **otro** «ayuda»: el mensajero
pidiendo auxilio con una orden. Ahora `lib/ayuda`, `AyudaBoton`, `AyudaProvider` y
`/ayuda` son la documentación. No hay colisión de símbolos, pero cualquier búsqueda futura por
«ayuda» devuelve dos dominios sin relación. Vale la pena saberlo; no vale la pena renombrar nada.

---

## Los dos hallazgos del leader, juzgados

### (a) El maestro y el admin no pueden leer la ayuda del mensajero, la tienda ni el satélite: **lo comparto, y es decisión del humano, no defecto de esta ficha**

Severidad: **menor / puerta de producto**. No bloquea.

Los datos: 9 de los 31 documentos no declaran `maestro` —los 4 de `mensajero/` menos
`ranking`, los 2 de `satelite/` y los 3 de `tienda/`—, así que
`/ayuda/mensajero/reparto` le da 404. Confirmado leyendo el frontmatter, no el índice.

**Por qué no es un defecto del alcance:** la restricción viene de los DATOS, no del módulo. El
contrato del campo está escrito en `docs/ayuda/README.md:36` —`roles: [mensajero]` con el
comentario «quién ve esa pantalla»— y el maestro, efectivamente, **no ve** la pantalla de reparto
del mensajero. El módulo implementa literalmente lo que el campo declara, y la ficha sólo pide la
dirección contraria («un mensajero no debería tropezarse con la ayuda de Wallet»). Ensanchar la
lectura significa decidir que `roles:` pasa a significar dos cosas —quién usa la pantalla y
quién puede leer sobre ella—, y eso es una decisión de producto que nadie tomó. Con 18 mensajeros a
los que la oficina atiende, la necesidad es real; la decisión, del humano.

**Si se decide arreglarlo, la lectura del leader es la correcta, con un matiz que la refuerza.** El
sitio es `lib/ayuda/documento.ts:123-133`: un predicado **nuevo** de LECTURA (por ejemplo
`puedeLeerDocumento`) que añada `maestro` y `admin`, y que usen **sólo** el gate de la
página (`[...slug]/page.tsx:39`) y el índice; `mapaRutaDocumento`
(`documento.ts:160-171`) se queda con `documentoVisiblePara` **estricto**, porque si no el
maestro pasa a tener dos candidatos para `/ordenes` y gana el primero por orden alfabético de
slug — un desempate inventado, exactamente lo que el módulo evita hoy. El matiz: si se cambia
`documentoVisiblePara` a secas, **la guardia del choque no se entera** (m3: re-implementa la
regla), así que ese cambio tiene que ir junto con la corrección de m3. Y el índice necesitaría
separar visualmente «la ayuda de los otros portales», o el maestro pasa de 22 a 31 documentos
mezclados sin saber cuáles son los suyos.

### (b) A 390px el encabezado estrangula título y descripción: **lo comparto, es deuda pre-existente que esta ficha AGRAVA en grado, no daño nuevo**

Severidad: **menor**, y **no hay que tocar `PageHeader` dentro de esta ficha**.

Lo confirmo leyendo el componente: `PageHeader.tsx:61` es una fila flex con
`justify-between` y sin `flex-wrap`, y el grupo derecho (`:73`) son botones que traen
`shrink-0` en la clase base de `buttonVariants`. Los botones no ceden ni un píxel: **toda la
compresión la absorbe la columna del título**. El «?» nuevo (`PageHeader.tsx:97`) le quita unos
36px más (por debajo de `sm` el texto «Ayuda» se esconde y queda el icono con `px-2.5`), en
toda pantalla con documento.

Dos datos para dimensionarlo antes de abrir nada:

- Cambiar el botón a `size="icon"` **no sirve**: esa variante es `size-8` (32px) contra los
  ~36px de hoy. Se ganan 4px. El problema es el flex del encabezado, no el botón nuevo.
- Las peores medidas (`/monitoreo` 118px, `/cierres-admin` 83px) son pantallas de
  **oficina**, que se usan en escritorio. Pero el mensajero también paga: `/cierre-dia`
  («Detalle de lo gestionado, totales por método de pago y solicitud de cierre») y `/ranking`
  tienen descripciones largas y son dos de las cinco pantallas suyas que ganan «?».

Recomendación: **ficha aparte** para el encabezado a 390px (el arreglo natural es `min-w-0` en
la columna izquierda y permitir que el grupo derecho envuelva), con medición antes y después.
Meterlo aquí sería rediseñar un componente compartido por toda la app dentro de una ficha que no lo
pidió.

---

## Lo que esta ficha hace bien y conviene no perder de vista

- **No duplica ni una letra de los .md**: sin artefacto generado, sin tabla, sin migración. El fallo
  mayor que se temía **no ocurrió**, y está verificado sobre el diff completo.
- **Cero superficie de inyección**: `lib/ayuda/markdown.tsx` no usa `dangerouslySetInnerHTML`
  en ningún punto; construye elementos de React, así que un script escrito en un .md se pinta como
  las letras que es (y hay test: `markdown.test.tsx:93`).
- **Los literales son contrato de verdad, no derivados de su propia fuente.**
  `acotamiento-por-rol` escribe los slugs a mano, `menu-ayuda` escribe los cinco aterrizajes
  a mano, y `pwa-manifiesto-atajos` sube los cinco contadores a 22/14/8/7/5 y deja la
  intersección en `/ayuda` **sin** publicar el atajo. Nada de esto se debilitó para pasar: los
  tests pre-existentes que se tocaron **ganaron** aserciones (`menu-mi-bodega` pasa a afirmar
  último Y penúltimo, y además que «Mi bodega» no es el primero de su barra).
- **Las guardias nuevas traen anclas anti-vacuidad** («hay documentos que vigilar», «la lista de
  rutas se leyó de verdad», «los documentos SÍ declaran fuentes»), que es justo lo que faltaba en
  los tests que en este repo salieron verdes sin datos.

---

## Qué hace falta para que esto sea OK

1. **B1**: un archivo de test de página que mate M1, M2 y M4 (receta y precedentes arriba).
2. m6: `progress/impl_433.md` con el mapa requisito→test.
3. m7: entrada en `progress/history.md`.
4. Deseables en la misma tanda, baratos: m1 (guardia de `outputFileTracingIncludes`), m2
   (corregir el recuento del comentario), m3 (que la guardia importe el predicado), m5 (comentario
   caduco de la 282). m4 (el try/catch del layout) es una decisión, no un arreglo obvio: que quede
   dicha.
5. (a) y (b) **no** vuelven al implementador: son puertas del humano.

Nada de esto exige tocar el comportamiento medido en el navegador, que está bien.
