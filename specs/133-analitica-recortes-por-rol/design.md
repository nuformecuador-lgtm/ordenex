# 133 — analítica: recortes por rol · design

> Lee antes `requirements.md` (§1 trae el inventario de hechos con archivo y línea; §4, la
> decisión sobre la deuda heredada).

## 1. El problema, en una frase

Las dos superficies existen (131 operativa, 132 financiera) y el recorte de **datos** existe
(122). Falta decidir **qué se dibuja** para cada rol y **abrir la puerta** a los tres roles que
hoy reciben `notFound()`. Nada más. En particular: no se toca el catálogo (135/175), no se abre
ninguna métrica financiera (D7), y no se recorta ni una fila en el cliente.

## 2. Qué hay hoy en pantalla (enumerado, no supuesto)

**Ruta `/analitica`** → `AnaliticaShell` con **tres slots** (`AnaliticaShell.tsx:52-90`):

| Slot / región | Contenido real hoy | Quién lo puso |
|---|---|---|
| `filtros` (`aria-label="Filtros"`) | Rango (4 presets) · fechas (`personalizado`) · Zona · Tienda · Mensajero · nota de degradado | 131 (`FiltrosOperativos.tsx:152-203`) |
| `operativo` (`aria-label="Tablero operativo"`) | botón **Actualizar** · aviso único de cobertura · rejilla `role="group"` con **6 paneles** | 131 (`PanelesOperativos.tsx:77-110`) |
| `financiero` (`aria-label="Tablero financiero"`) | una `<section>` **por vista** de las **8** métricas servidas; `cod_recaudado` aporta dos (por método → donut, por tienda → barras + tabla); `conciliacion_cierres` va por `PanelConciliacion` | 132 (`TableroFinanciero.tsx:310-343`) |

**Los seis paneles operativos** (`catalogo-paneles.ts:63-108`), tal cual están escritos:
`ordenes-creadas` (líneas) · `ordenes-por-estado` (donut, desagregación `estatus`) ·
`resultado-gestiones` (barras: entregas, devoluciones, rechazos, **incidentes**) ·
`sin-gestionar` (líneas) · `tasa-entrega` (líneas) · `tiempo-ciclo` (líneas).

**Las ocho métricas financieras** (`lib/types/analitica-financiera.ts:225-234`): `cod_recaudado`,
`ingreso_flete`, `ingreso_comision_cod`, `ingreso_iva`, `egresos`, `cuenta_por_pagar_tienda`,
`cuenta_por_pagar_mensajero`, `conciliacion_cierres`.

## 3. Decisiones

### D1 · Abrir la ruta editando UNA constante, derivándola del dominio

`ROLES_ACCESO_ANALITICA` es **una sola constante** consumida por el `roles` del ítem de menú
(`menu-visibility.ts:110`) y por el gate `notFound()` de la página (`page.tsx:63`). Ampliar es
editarla; **no** se desengancha el ítem con un literal ni se escribe una segunda lista, o R10 de
la 129 (`tests/unit/auth/menu-visibility.test.ts:399-410`) se pone rojo.

Como el conjunto ampliado **coincide** con `ROLES_ANALITICA` (los cinco lectores), la constante
pasa a **derivarse** de él:

```ts
// lib/auth/menu-visibility.ts
export const ROLES_ACCESO_ANALITICA = ROLES_ANALITICA;  // importado de lib/analytics/types
```

`lib/analytics/types.ts` es un módulo **sin runtime** (`types.ts:5-8`: sólo `import type`), así
que esta arista no arrastra Prisma ni nada de servidor al Sidebar cliente. Y deja de existir la
posibilidad de que las dos listas diverjan: es la misma.

**Coste asumido, declarado:** el caso (b) del guard de no-convergencia se pone rojo por diseño y
**se reexpresa** (nunca se borra) — ver §5 y **Q1**.

### D2 · La región financiera: se reusa el criterio de la 132, no se inventa otro

La 132 ya resolvió esto y lo dejó escrito: si la prop `financiero` no llega, **la región no se
renderiza en absoluto** — ni encabezado, ni `EmptyState` (`AnaliticaShell.tsx:38-50, 80-87`). El
gate es `esAccesoTotal(rol)` en la página (`page.tsx:71-75`), que además evita **pedir** el dato
(R8). Esta feature **no cambia una línea de ese mecanismo**: sólo cambia que ahora hay tres roles
que **entran a la página** y llegan hasta esa bifurcación, donde antes se los comía el `notFound`.

Lo que sí se añade es la **atadura al catálogo**, que hasta ahora era implícita: un test comprueba
para los cinco roles la equivalencia

```
se ofrece la región financiera   ⟺   listarMetricas({ dominio: "financiera", rol }).length > 0
```

Dos fuentes independientes (`esAccesoTotal` y el catálogo de la 135) que deben decir lo mismo. Si
alguien abriera una financiera a `adminTienda`, este test y
`financiera-alcance.guardia.test.ts:35-64` caerían **a la vez** — y la respuesta sería diseñar el
recorte del dinero, no aflojar nada.

**Por qué no se usa `listarMetricas` como el gate en sí:** el guard de la 132
(`tablero-financiero.guardia.test.ts:356-364`) exige que la página **llame a `esAccesoTotal(`**;
sustituirlo por otra condición lo pondría rojo y crearía una segunda autoridad sobre quién ve el
dinero. El catálogo se usa para **verificar** la equivalencia, no para reemplazarla.

### D3 · Ningún panel operativo se retira por rol (y es un hecho, no una preferencia)

Las 15 operativas declaran `acotado` —no `prohibido`— para los tres roles nuevos
(`metrics.ts:50-56`), luego `listarMetricas({ rol })` devuelve **las 15 para los cinco roles**.
Retirar paneles operativos por rol sería inventar una regla que el catálogo no tiene.

Y la lista de paneles sigue siendo **declarativa**: no se deriva de `listarMetricas()` ni se
filtra por `estadoProduccion` (R21/D6 de la 131, `catalogo-paneles.ts:1-30`). La ficha **175**
acaba de corregir ese campo para `incidentes` y `sin_gestionar` (⟨D11⟩, 2026-08-03) **porque esta
feature decide paneles** y los habría ocultado teniendo datos. Su test
(`tablero-catalogo-paneles.test.ts:30-142`) fue reexpresado para no afirmar valores concretos:
**esta feature no lo devuelve a afirmarlos**.

### D4 · El recorte real de presentación: las **facetas de filtro** y el **rótulo de alcance**

Si los paneles no cambian y la región financiera ya la resuelve D2, ¿qué recorta esta feature?
Dos cosas, y las dos son presentación pura:

1. **La faceta que el alcance del actor ya tiene fijada no se ofrece** (R14): `adminTienda` sin
   «Tienda», `adminSatelite` sin «Zona», `mensajero` sin «Mensajero». Un selector cuyo único
   valor legal es el propio actor no informa: sugiere que hay algo que elegir.
2. **El rótulo de alcance** (R24): una frase, una sola vez, diciendo sobre qué universo están
   las cifras. Sin ella, un `adminTienda` lee «Órdenes creadas: 812» como el total del negocio.

Y una que **no es cosmética**: **`adminTienda` no ve el selector «Mensajero»** (R15). Verificado
en `UsuariosPorRolService.ts:15,24`: ese servicio autoriza a `adminTienda`, de modo que el
desplegable le serviría **nombre real + uuid** de cada mensajero — precisamente lo que R38/R39 de
la 122 (identidad seudónima) existen para impedir. Abrir la ruta sin tocar el filtro habría
publicado el directorio en la primera pantalla.

### D5 · De dónde sale «qué faceta está fijada»: del alcance de la 122, no de una tabla nueva

R8 y R37 de la 122 prohíben una segunda tabla `rol → …`. Así que **no se escribe** un
`Record<rol, facetas>`. Se añade un módulo **puro** de servidor:

```
lib/analytics/presentacion.ts          (NUEVO — módulo puro, sin React, sin datos)

  export type Faceta = "zona" | "tienda" | "mensajero";

  export interface RecortePresentacion {
    /** el `tipo` del alcance resuelto por la 122, o `denegado` */
    readonly alcance: "global" | "zona" | "tienda" | "mensajero" | "denegado";
    /** las facetas que la barra DEBE ofrecer (nunca contiene la fijada por el alcance) */
    readonly facetas: readonly Faceta[];
  }

  export function recorteDePresentacion(actor: ActorAnalitica | null): RecortePresentacion
```

Deriva el `alcance` llamando a `resolverAlcance` (fuente única, `alcance.ts:149`) sobre una
métrica **operativa** del catálogo, y mapea `tipo → facetas` quitando la homónima. Devuelve
**enums y nada más**: ni filas, ni ids, ni nombres. Un test comprueba que el `tipo` es el mismo
para **todas** las operativas (no depende de cuál se elija).

**Por qué vive en `lib/analytics/` y no en la ruta:** el guardia de frontera de la 131
(`tablero-operativo-frontera.guardia.test.ts:88-94`) prohíbe que cualquier archivo de
`app/(app)/analitica/` importe los módulos de alcance o invoque `resolverAlcance`. Esa prohibición
es correcta y **no se toca**: lo que persigue es recortar **datos** en el cliente. Aquí no se
recorta ningún dato: se decide, **en el servidor**, qué control se dibuja, y lo que cruza a los
componentes es una lista de tres strings.

Para que esto no quede como un rodeo tácito al guardia, **el guardia se amplía** (R20, R29):
`lib/analytics/presentacion` entra como **arista nominal única y justificada** —mismo patrón que
la allowlist de una arista de `modulo-puro.guardia.test.ts` (R36 de la 122)— con dos aserciones
nuevas: (a) ningún archivo de la ruta importa nada más de `lib/analytics/alcance*`; (b) el tipo
de retorno del módulo no contiene ningún campo de datos. La excepción escrita y vigilada es
honesta; la excepción no escrita es un agujero.

### D6 · El cableado: props planas desde el Server Component

```
app/(app)/analitica/page.tsx  (servidor)
  ├─ gate notFound()  ← ROLES_ACCESO_ANALITICA (D1)
  ├─ recorte = recorteDePresentacion(actor)             (D5)
  ├─ <FiltrosOperativos facetas={recorte.facetas} />    (R14-R18)
  ├─ <PanelesOperativos alcance={recorte.alcance} />    (R24-R25)
  └─ if (esAccesoTotal(rol)) financiero={<TableroFinanciero paneles={await cargar…()} />}
```

Todas las props son **datos serializables** (strings y arrays de strings): ninguna función cruza
la frontera RSC, que es lo que exige y censa `tablero-financiero.guardia.test.ts:289-297`. Los
valores por defecto de las dos props nuevas son «todo» (las tres facetas, alcance `global`), para
que los componentes sigan montándose sin props en los tests existentes.

`AnaliticaPage` **sigue sin parámetros** (`AnaliticaPage.length === 0`, R5 de la 129) y **sigue
sin importar** `lib/actions`, `lib/services` ni `lib/repositories` (censo de fuente,
`AnaliticaPage.test.tsx:234-246`): `lib/analytics/presentacion` no es ninguna de esas capas.

### D7 · El aterrizaje post-login no se mueve (R5)

`/dashboard` redirige al **primer ítem visible** del sidebar (`dashboard/page.tsx:34`), y
"Analítica" ocupa la **posición 2** de `SIDEBAR_ITEMS`. En cuanto se le haga visible al
`mensajero` y al `adminSatelite`, su aterrizaje pasaría de `/mis-asignaciones/reparto` y
`/recepcion-satelite` a `/analitica` — **sin que ningún test se ponga rojo**, porque el que lo
cubre (`HomePageMaestro.test.tsx:150`) deriva el esperado de la misma función que juzga.

Propuesta (sujeta a **Q2**): marcar el ítem como **no elegible como destino inicial** —un campo
opcional del `MenuItem`, no un literal de ruta dentro de `primerDestino`— y añadir un test que
enumere los cinco roles y afirme su destino **por valor**. Mover el ítem de posición está
descartado: rompería R16 de la 129.

## 4. Contratos de entrada/salida

**No hay endpoints nuevos, ni Server Actions nuevas, ni migraciones, ni tablas, ni RLS.** Esta
feature no toca la base de datos. Las consultas siguen siendo exactamente las de la 131
(`consultarAnaliticaOperativa`, una por métrica, desde el cliente) y la 132
(`cargarTableroFinanciero`, en el servidor, sólo para acceso total).

| Módulo | Entrada | Salida |
|---|---|---|
| `recorteDePresentacion` | `ActorAnalitica \| null` | `{ alcance, facetas }` — enums, sin datos |
| `FiltrosOperativos` | `facetas?: readonly Faceta[]` (def. las tres) | escribe el filtro en la URL, igual que hoy |
| `PanelesOperativos` | `alcance?: RecortePresentacion["alcance"]` (def. `global`) | igual que hoy + rótulo si no es `global` |
| `menu-visibility` | — | `ROLES_ACCESO_ANALITICA` derivado de `ROLES_ANALITICA` |

**Lo que NO viaja al cliente:** el catálogo de métricas (`lib/analytics/metrics` es dato de
servidor, R25 de la 131), ningún uuid ajeno, ningún nombre de tienda/zona/persona, ninguna
correspondencia seudónimo → id real.

## 5. Guards afectados — con archivo, línea y veredicto

| Guard / test | Línea | Veredicto |
|---|---|---|
| `tests/unit/guards/roles-analitica-acceso-vs-dominio.test.ts` caso (b) «los dos conjuntos NO son iguales» | 54-63 | **ROJO POR DISEÑO.** Se **reexpresa** para vigilar la derivación de D1 (que nadie reescriba la lista a mano), no se borra. Su propio comentario (34-38) manda esta salida. |
| mismo archivo, caso (a) «acceso ⊆ dominio» y caso «no vacío» | 44-52, 65-67 | **VERDE.** Se conservan intactos. |
| `tests/unit/auth/menu-visibility.test.ts` R9 «el resto de roles NO ve el ítem» | 341-359 | **ROJO POR DISEÑO.** Los tres roles se mueven de la lista de excluidos a la de incluidos; `apiKey` y el actor nulo **siguen** excluidos. No se relaja: se reparte. |
| mismo archivo, listas por IGUALDAD de `adminTienda` / `mensajero` / `adminSatelite` | 161-168, 170-192, 194-200 | **ROJAS POR DISEÑO.** Hay que añadir "Analítica" en su posición. Siguen comparándose por **igualdad**: un ítem no declarado sigue rompiendo. |
| mismo archivo, R10 «ítem y gate declaran el mismo conjunto» | 399-410 | **VERDE si y sólo si** se edita la constante (D1). Es el test que castiga el atajo. |
| mismo archivo, R16 «Analítica va justo tras Inicio» | 373-383 | **VERDE.** No se mueve el ítem (D7). |
| `tests/components/AnaliticaPage.test.tsx` 129-R3 «el resto recibe notFound» | 160-171 | **ROJO POR DISEÑO.** Se reexpresa: `apiKey` y sin sesión siguen con `notFound`; los tres roles ahora **entran**. |
| ídem, 129-R6 «el gate corre antes de renderizar» (usa `adminTienda`) | 201-209 | **ROJO POR DISEÑO.** Se reexpresa con `apiKey`, que sigue denegado. |
| ídem, 132-R1/R8 «los otros cuatro siguen con notFound» | 273-300 | **ROJO POR DISEÑO.** Se parte: `apiKey` → `notFound`; los tres → entran **y no ven nada financiero**. |
| ídem, **132-R2 «ni rastro de la región financiera»** | 302-331 | **ROJO POR DISEÑO, y el más importante de reexpresar BIEN.** Hoy pasa *porque la página lanza*. Tras la 133 debe pasar **con la página renderizada**: es literalmente R6/R7 de esta feature. Se conserva la aserción sobre `document.body` entera, con las mismas cifras reconocibles. |
| ídem, 132-R3 «quién la ve se deriva de `esAccesoTotal`» | 333-360 | **VERDE.** Y ahora muerde de verdad: antes tres roles ni llegaban. |
| ídem, 132-R5 «`ROLES_ACCESO_ANALITICA` sigue siendo maestro y admin» + «acceso ⊊ dominio» | 362-387 | **ROJO POR DISEÑO.** Su propio título dice «la 133 es quien lo ensancha». Se reexpresa afirmando la derivación de D1. |
| ídem, 132-R9 «para los denegados el dinero no se consulta» | 389-421 | **ROJO POR DISEÑO en la forma, VERDE en el fondo.** El `rejects.toThrow(NotFoundError)` cae; la aserción que importa (`cargarMock` **no** llamado) debe seguir pasando, ahora por el gate de `esAccesoTotal`. |
| ídem, 131-R26 «el gate sigue siendo maestro/admin» | 440-445 | **ROJO POR DISEÑO.** |
| `tests/unit/analytics/tablero-catalogo-paneles.test.ts` | 30-200 | **VERDE, y debe seguirlo.** **No se devuelve a afirmar valores de `estadoProduccion`** (la 175 lo reexpresó a propósito). |
| `tests/unit/analytics/financiera-alcance.guardia.test.ts` | 35-64 | **VERDE.** Si se pusiera rojo, alguien abrió una financiera a un rol nuevo: prohibido (D7 de la 135). |
| `tests/unit/guards/tablero-financiero.guardia.test.ts` | 279-375 | **VERDE.** Condiciona el código: en `page.tsx`, `AnaliticaShell.tsx` y `financiero/**` — nada de `"use client"`, ninguna prop-función, ningún array literal con **dos o más nombres de rol**, ninguna lista de ids financieros, ningún símbolo de moneda. |
| `tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts` | 123-213 | **VERDE, y se AMPLÍA** (D5): la ruta sigue sin importar `alcance*`/`identidad` ni invocar `resolverAlcance`; se añade la arista nominal de `lib/analytics/presentacion` con sus dos aserciones. |
| `tests/unit/analytics/modulo-puro.guardia.test.ts` | — | **VERDE.** `lib/analytics/presentacion.ts` es un módulo nuevo dentro del árbol que ese guardia censa: debe nacer **puro** (sin `next/headers`, sin `@/lib/db`, sin servicios). |
| `tests/components/HomePageMaestro.test.tsx` | 144-158 | **VERDE… por tautología.** Deriva el esperado de la función que juzga (D7). No detecta el cambio de aterrizaje: por eso R5 pide un test **por valor**. |
| `tests/components/Sidebar.test.tsx` | — | **VERDE.** Usa ítems sintéticos, no `SIDEBAR_ITEMS`. |

**Rojos por diseño: 9 bloques**, todos en dos archivos (`menu-visibility.test.ts`,
`AnaliticaPage.test.tsx`) y todos por el mismo motivo — un rol se mueve de una lista a la otra.
**Ninguno se relaja ni se borra:** los nueve se reexpresan conservando la mutación que mataban
(R29), y el más delicado (132-R2) queda **más fuerte** que antes, porque pasa a verificarse con la
página renderizada en vez de con la página lanzando.

## 6. Alternativas descartadas

**A1 — Ocultar la región financiera renderizándola vacía (con un `EmptyState` «sin permisos» o
«sin movimientos»). DESCARTADA.** Es exactamente lo que el aviso dirigido de la 135 prohíbe
(`design.md:380-384`): para esos tres roles el dominio financiero es **prohibido**, no vacío. Una
región visible y vacía «sugiere una cifra que no existe y expone una sección de plata a roles que
ni siquiera deberían saber que existe el panel» (`AnaliticaShell.tsx:41-47`). Además la 132 ya
resolvió el caso, y reimplementarlo con otro criterio crearía dos formas distintas de no mostrar
lo mismo.

**A2 — Componer la rejilla de paneles con `listarMetricas({ rol })` (o filtrando por
`estadoProduccion === "producida"`). DESCARTADA.** Dos motivos independientes: (i) el catálogo es
**dato de servidor** —23 métricas con su alcance por rol, su fuente y sus nombres de tabla— y
arrastrarlo a un módulo de cliente lo publicaría al navegador (R25 de la 131); (ii) filtrar por
`estadoProduccion` borra KPIs vivos **en silencio**, que es la historia documentada de
`incidentes` y `sin_gestionar` y el motivo entero de la ficha **175** ⟨D11⟩. Para el dominio
operativo, además, el filtro no cambiaría nada (las 15 son `acotado` para los cinco roles): sería
un mecanismo peligroso a cambio de cero efecto.

**A3 — Declarar una tabla `Record<RolAnalitica, { paneles, facetas }>` en la feature.
DESCARTADA.** Sería la segunda tabla de alcance por rol del repo, y R8/R37 de la 122 la prohíben
por escrito: cuando una regla vive en dos sitios, un día dicen cosas distintas y nada se pone
rojo. El alcance se **pregunta** a `resolverAlcance` (D5).

**A4 — Cerrar aquí el oráculo residual contra R39 (M-4 de `review_122.md`). DESCARTADA**, con
ficha propia propuesta en `requirements.md §4`. Es un problema de **datos** (vive en
`recortarFiltro`, zona backend) y esta feature es `frontend`; taparlo con la UI sería justo la
confusión que la 122 nos avisó de no cometer. Lo que sí se hace es quitar la superficie (R15) y
**prohibir explícitamente venderlo como cierre** (R27).

**A5 — Escribir a mano `["maestro","admin","adminSatelite","adminTienda","mensajero"]` en
`ROLES_ACCESO_ANALITICA`. DESCARTADA.** Funciona y pasa el typecheck, pero deja dos listas con el
mismo contenido y significados distintos —la colisión exacta que el rename de 2026-07-31 y el
guard de no-convergencia existen para impedir— y además el censo de listas de roles a mano del
guardia de la 132 castiga esa forma en los archivos de la ruta. Se deriva (D1).

## 7. Mapa `R<n> → test` previsto

| R | Test |
|---|---|
| R1 | `AnaliticaPage.test.tsx`: los **seis** `RolValue` + sesión nula; los cinco lectores renderizan, `apiKey` y `null` lanzan `notFound`. |
| R2 | `menu-visibility.test.ts` R10 (reexpresado): inclusión mutua ítem ↔ constante. |
| R3 | `roles-analitica-acceso-vs-dominio.test.ts` (reexpresado): el acceso **deriva** del dominio; escribir la lista a mano pone rojo. |
| R4 | `menu-visibility.test.ts`: un rol sintético fuera del conjunto no ve el ítem y no pasa el gate. |
| R5 | test nuevo `destino-post-login.test.ts`: destino **por valor** de los cinco roles. |
| R6 | `AnaliticaPage.test.tsx`: para los tres roles, `queryByRole("region", {name:"Tablero financiero"})` es `null` **con la página renderizada**. |
| R7 | ídem, aserción sobre `document.body.textContent` (etiqueta + cifras + palabra de la región + «sin movimientos»). |
| R8 | ídem, `cargarMock` no invocado para los tres roles ni sin sesión. |
| R9 | test de equivalencia `esAccesoTotal(rol)` ⟺ `listarMetricas({dominio:"financiera", rol}).length > 0` sobre los cinco roles. |
| R10 | `AnaliticaPage.test.tsx`: cero enlaces/botones cuyo nombre accesible nombre la región, para los tres roles. |
| R11 | `TableroOperativo.test.tsx`: los seis `panel.titulo` presentes para cada uno de los cinco roles. |
| R12 | `tablero-catalogo-paneles.test.ts` (intacto, sin afirmar valores) + censo de `estadoProduccion` en los archivos nuevos. |
| R13 | censo: ningún módulo nuevo de la ruta importa `lib/analytics/metrics`. |
| R14 | `FiltrosOperativos.test.tsx`: por faceta fijada, `queryByLabelText` de ese selector es `null`. |
| R15 | ídem para `adminTienda` + «Mensajero», **más** una aserción de que ningún nombre de la fixture de mensajeros aparece en el documento. |
| R16 | ídem: el selector ausente no aparece deshabilitado ni con la nota de degradado. |
| R17 | ídem: el selector de rango presente para los cinco. |
| R18 | `presentacion.test.ts`: para los cinco roles, `facetas` = las tres menos la del `tipo` de `resolverAlcance`; y el `tipo` es igual para **todas** las operativas. |
| R19 | `FiltrosOperativos.test.tsx` / `TableroOperativo.test.tsx`: con el parámetro presente en la URL, el `raw` enviado al borde es el mismo que hoy y la UI no lo silencia. |
| R20 | `tablero-operativo-frontera.guardia.test.ts` (ampliado). |
| R21 | test de no-sustitución: mismo actor y filtro, con y sin recorte de presentación ⇒ **mismos argumentos** a `consultarAnaliticaOperativa`. |
| R22 | `TableroOperativo.test.tsx`: `forbidden` pinta el estado de prohibido, no el vacío de la gráfica. |
| R23 | `AnaliticaPage.test.tsx`: el documento no contiene ids/nombres de la fixture ajena. |
| R24 | `TableroOperativo.test.tsx`: rótulo presente y **único** para alcance acotado, ausente para `global`. |
| R25 | ídem: el texto del rótulo no contiene el uuid ni el nombre de la fixture. |
| R26 | censo de textos + `FiltrosOperativos.test.tsx`: no existe control de guardar/fijar filtro por etiqueta de mensajero; la advertencia aparece donde la leyenda las use. |
| R27 | test de frontera: ocultar el selector no cambia la respuesta del borde ante un `mensajero_id` inyectado (lo decide el borde, no la UI). |
| R28 | `e2e/analitica-roles.spec.ts` (Playwright): tres roles nuevos + `maestro`. |
| R29 | `progress/impl_133-analitica-recortes-por-rol.md` enumera los 9 bloques rojos por diseño con archivo, línea y su reexpresión; el reviewer lo verifica. |

## 8. Avisos dirigidos a otras features

- **→ 134 (export CSV).** El CSV **no** hereda el recorte de presentación de esta feature: hereda
  el de **datos** de la 122. Ocultar una faceta aquí no impide que el CSV la pida. Y el CSV de un
  `adminTienda` con grano `mensajero` va **seudonimizado** (D5/R39 de la 122): una columna
  `mensajero_id` en un archivo descargable es la fuga más difícil de retirar.
- **→ la ficha del oráculo (§4 de `requirements.md`).** Cuando aterrice, **no** puede apoyarse en
  que la UI ya no ofrece el selector: R27 lo prohíbe explícitamente. El cierre es del borde.
- **→ 175 / 135 (catálogo).** Esta feature **no lee `estadoProduccion`** y no depende de su valor.
  Si mañana una métrica vuelve a marcarse `declarada`, el tablero **no** debe cambiar: el guard de
  la 131 (reexpresado por la 175) lo vigila sin afirmar valores.
- **→ quien amplíe `FiltrosOrdenesService` / `UsuariosPorRolService`** (backend, ver Q4). El día
  que `adminSatelite` o `mensajero` puedan consultar esos catálogos, la faceta correspondiente
  puede volver a ofrecerse **cambiando sólo `recorteDePresentacion`**; y si se autoriza a
  `adminTienda` a listar mensajeros en algún otro sitio, **R15 sigue vigente aquí**: en analítica
  ese directorio contradice la seudonimización.
- **→ 129 (ruta/shell).** Su punto de extensión se cumplió tal cual estaba escrito: la 133 recorta
  «pasando `undefined` (o directamente omitiendo la prop)» (`AnaliticaShell.tsx:29-30`). El shell
  **no se toca**.

## 9. Riesgos

- **El más caro es el aterrizaje post-login (D7 / Q2):** cambia el comportamiento de dos roles y
  **ningún test vigente lo detecta**. Si Q2 se responde tarde, se descubre en producción.
- **Reexpresar mal el bloque 132-R2** convertiría el test más valioso del lote (ni rastro del
  dinero) en un test que pasa por vacío. Debe pasar **con la página renderizada**.
- **La arista `presentacion.ts` frente al guardia de frontera:** si se añade sin ampliar el
  guardia, queda como un rodeo tácito. La ampliación es parte de la tarea, no un extra.
- **Ampliar el acceso sin ampliar los catálogos de filtros** deja a `adminSatelite` y `mensajero`
  con menos facetas que el resto. Es intencional y visible; no es un fallo (Q4).
