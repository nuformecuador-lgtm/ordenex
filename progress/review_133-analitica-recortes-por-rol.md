# 133 — analitica: recortes por rol · REVIEW

> Rama `feature/133-analitica-recortes-por-rol`, HEAD `b468b69d`, worktree `C:/w133`.
> Base de la revision: `7b850f2e` (spec + puerta cerrada). Nacida de `origin/dev` @ `35940b0d`.
> **Todo lo que sigue esta MEDIDO por el reviewer en esta rama.** Las mutaciones son PROPIAS:
> se aplicaron, se vio el rojo y se revirtieron (arbol limpio al cerrar, `git status` vacio).

## VEREDICTO: **APROBADO-CON-NOTAS**

**Bloqueantes: 0. Menores: 6.**
**R verificados hasta un test no vacuo: 29/29** (R28 con la salvedad declarada del menor 3).
**Mutaciones: 18 lanzadas / 18 discriminaron / 0 supervivientes.**
**Guards relajados: NINGUNO.**

---

## 1. Checklist de CHECKPOINTS.md

### Especificacion
- [x] `requirements.md` con EARS numerados R1-R29.
- [x] `design.md` con alternativas descartadas (A5 «copiar la lista» entre ellas).
- [~] `tasks.md`: **32/35 marcadas**. Las tres pendientes son del **leader** (T8.2 `./init.sh --rapido`, T8.3 `./init.sh` completo, T8.4 PR). Ver menor 2.

### Trazabilidad
- [x] Cada R mapea a test concreto **verificado por mi, no leido del mapa** (seccion 2).
- [x] `progress/impl_133-....md` contiene el mapa R -> test.

### Calidad de codigo (medido aqui)
- [x] `pnpm typecheck` -> `tsc --noEmit`, **0 errores**.
- [x] `pnpm lint` -> **44 problems (0 errors, 44 warnings)**. Los 44 son baseline ajeno; la feature anade 0.
- [x] `pnpm exec vitest run` -> **895 archivos / 11 175 tests**, `Test Files 1 failed | 886 passed | 8 skipped`, `Tests 3 failed | 11042 passed | 130 skipped`. **Sin bloque `Errors` de workers**: la suite arranco entera y no reporta de menos. Los 3 rojos son `tests/integration/db/analytics-daily-migration.test.ts` por `DATABASE_URL` ausente (trampa de worktree, no regresion). Coincide con la referencia del implementer.
- [x] `pnpm exec next build` -> compila, **41 paginas**, `/analitica` incluida. **NUNCA se corrio `pnpm build`.**
- [~] E2E: escrito, **no ejecutado**. Ver menor 3.

### Datos y seguridad
- [x] **Cero migraciones, cero tablas, cero RLS que revisar**: el diff no toca `db/` ni `prisma/`. Nada de webhooks, firmas ni idempotencia aplicable.
- [x] Sin secretos: ninguna `process.env` nueva; `presentacion.ts` esta dentro del censo de `modulo-puro.guardia.test.ts`, que prohibe `process.env`.
- [x] Sin hardcode de pais/moneda/cuenta en produccion. Los simbolos de moneda aparecen **solo** en la lista de censo de un test.

### Patron de capas
- [x] `lib/analytics/presentacion.ts` es modulo puro de dominio: sin React, sin `next/headers`, sin repos ni servicios. Deriva de `resolverAlcance` (fuente unica de la 122) y **no declara ninguna tabla rol -> facetas** (verificado: no se nombra ni un rol).
- [x] La decision se toma en el **Server Component** (`page.tsx`) y baja por props planas. Los dos componentes de cliente solo hacen `import type`, asi que no arrastran `metrics` ni `@prisma/client` al bundle. Lo confirma el `next build` verde.
- [x] `lib/auth/menu-visibility.ts` pasa a importar **valor** desde `lib/analytics/types.ts`; verificado que ese modulo solo tiene `import type` (linea 18), asi que la arista no arrastra runtime al Sidebar cliente.

### Permisos
- [x] El gate sigue siendo server-side (`resolveActorFromSession` + `notFound()`), y quien ve el dinero lo sigue decidiendo `esAccesoTotal`. Dos permisos distintos, dos fuentes distintas.

### Verificacion final
- [~] `./init.sh`: **rojo**, y solo por los 3 tests de `.env`. Ver menor 1.
- [x] Este archivo existe.
- [ ] `progress/history.md`: pendiente del leader.

---

## 2. Trazabilidad verificada por el reviewer (29/29)

Metodo: para cada R se abrio el test nombrado, se comprobo que **existe**, que **afirma el
requisito** y que **no pasa por vacio** (anti-vacio explicito o control positivo). Donde se
pudo, se aplico la mutacion. **No se acepto ninguna fila del mapa del implementer sin
abrirla**: en la 132 un mapa asi declaro letal una mutacion que no lo era.

| R | Test | Verificado | Mutacion propia -> resultado |
|---|---|---|---|
| R1 | `AnaliticaPage.test.tsx:234` + `menu-visibility.test.ts:353` | no vacuo (los que entran afirman que el shell SE PINTA) | **M12** estrechar el acceso a maestro/admin -> **25 rojos** en 2 archivos |
| R2 | `menu-visibility.test.ts` R10 (intacto) | no vacuo | cubierto por M12/M3 |
| R3 | `roles-analitica-acceso-vs-dominio.test.ts:133` (b1)+(b2) | no vacuo, con autocomprobacion del censo | **M3** reescribir la lista a mano -> **2 rojos** (b1 y b2) |
| R4 | `menu-visibility.test.ts:397` (rol SINTETICO) | no vacuo | leido: afirma whitelist con un `RolValue` inexistente |
| R5 | `destino-post-login.test.ts` | **5 destinos por VALOR, escritos a mano**; cabecera con «PROHIBIDO derivar» | **M1** quitar `destinoInicial: false` -> **5 rojos**, y `HomePageMaestro.test.tsx` **VERDE** |
| R6 | `AnaliticaPage.test.tsx:396`, `:476` con la pagina renderizada | anti-vacio triple | **M2** -> **13 rojos** |
| R7 | `AnaliticaPage.test.tsx:476`, censo sobre el `textContent` entero | control positivo con `maestro` | **M2**; ademas medicion directa del cuerpo pintado (seccion 3) |
| R8 | `AnaliticaPage.test.tsx:634` | anti-vacio: la pagina se pinto | **M16** pre-cargar el dinero antes del gate -> **3 rojos** |
| R9 | `AnaliticaPage.test.tsx:759` (5 roles) + caso «no pasa por vacio» | no vacuo | **M2** -> equivalencia rota |
| R10 | `AnaliticaPage.test.tsx:816` | anti-vacio: la pantalla TIENE controles | **M15** anadir un enlace que la nombra -> **6 rojos** |
| R11 | `TableroOperativo.test.tsx:428` | anti-vacio: el catalogo declara 6 | **M6** filtro que quita un panel para alcance acotado -> **11 rojos** |
| R12 | `TableroOperativo.test.tsx:597` (censo) + `tablero-catalogo-paneles.test.ts` intacto | el censo se autocomprueba y **no afirma ningun valor** de `estadoProduccion` | **M18** -> **4 rojos** |
| R13 | idem `:597` | idem | **M18** |
| R14 | `FiltrosOperativos.test.tsx:296` | tabla rol->facetas escrita A MANO (oraculo independiente) | **M17** ignorar la prop -> **5 rojos**; **M5** -> 10 rojos |
| R15 | `FiltrosOperativos.test.tsx:382` (nombres y uuids reconocibles, censo sobre `textContent` **y** `innerHTML`) | no vacuo | **M5** -> `presentacion.test.ts` rojo en el caso nominal |
| R16 | `FiltrosOperativos.test.tsx:342` (ni `disabled`, ni nota de degradado, ni peticion del catalogo) | no vacuo | **M17** |
| R17 | `FiltrosOperativos.test.tsx:317`, los 5 roles | no vacuo | leido |
| R18 | `presentacion.test.ts`, 25 casos por valor | no vacuo | **M5** -> **7 rojos** |
| R19 | `AnaliticaNoSustitucion.test.tsx` | no vacuo | **M7** -> **7 rojos** (R19+R21) |
| R20 | `tablero-operativo-frontera.guardia.test.ts:378` | allowlist nominal + autocomprobaciones | **M10** arista `alcance-columnas` -> 2 rojos (doble candado); **M11** arista `consulta` -> **solo la caza la parte NUEVA** |
| R21 | `AnaliticaNoSustitucion.test.tsx` | el caso «y la barra SI cambia» impide leerlo como test complaciente | **M7** |
| R22 | `TableroOperativo.test.tsx:533` | el caso fuerte pinta denegado y vacio a la vez | **M6** los tumba de paso |
| R23 | `AnaliticaPage.test.tsx:907` | **control positivo**: con alcance global los 3 nombres SI se pintan | **M5** -> 3 rojos con nombres ajenos en el cuerpo |
| R24 | `TableroOperativo.test.tsx:460` | rotulo UNICO, y ausente si global | **M13** `textoAlcance` -> `null` -> **5 rojos** |
| R25 | `TableroOperativo.test.tsx:491` | uuid, hueco interpolado, `undefined` | **M14** meter un uuid en el texto -> **2 rojos** |
| R26 | `presentacion-etiquetas-mensajero.test.ts` (11 casos) | censo real + **tripwire declarado** | **M9** panel con desagregacion `mensajero` -> **2 rojos** |
| R27 | `presentacion-oraculo-frontera.test.ts` (10 casos) | la premisa se afirma, y el caso «con politica real el mismo raw se acepta» impide afirmar una constante | **M8** el borde deja de decidir -> **2 rojos** |
| R28 | `e2e/analitica-roles.spec.ts`, 8 casos | escrito, oraculos a mano, **NO EJECUTADO** | — (menor 3) |
| R29 | esta revision, seccion 4 | — | — |

---

## 3. R6/R7 — la region financiera es PROHIBIDA: comprobado en las DOS formas

El implementer afirma que descubrio que **el dinero se pinta formateado** y que la asercion
heredada sobre el entero crudo no lo habria cazado. **Lo medi yo, no lo acepte escrito.**

Con la mutacion **M2** aplicada (el gate de `esAccesoTotal` neutralizado) se volco el cuerpo
renderizado real de un `adminTienda`. Termina asi:

```
...Ingreso por fleteRango: 2026-07-05 — 2026-08-03Neto817 263,45Bruto: 918 273,45
```

(con el simbolo del colon delante de cada cifra; se omite aqui para no ensuciar el censo de
otros tests que leen este archivo).

Marcas medidas sobre ese cuerpo, identicas para `maestro` (control positivo):

| forma | presente en el DOM |
|---|---|
| entero crudo `918273` | **NO** |
| digitos normalizados `91827345` (quitando espacios y separadores) | **SI** |
| simbolo de moneda | **SI** |
| etiqueta `Ingreso por flete` | **SI** |

**Conclusion, verificada:** la asercion heredada de la 132 sobre el entero crudo **no habria
cazado la mutacion**; las dos aserciones nuevas —cifra normalizada y simbolo de moneda— **si
la cazan**. La cadena aborta antes, en la etiqueta, pero eso no las hace vacuas: se comprobo
directamente que ambas serian verdaderas sobre el documento mutado. R7 queda cubierto en sus
dos formas (cruda y formateada), sobre el cuerpo entero y con control positivo.

M2 completa: **13 rojos** en 5 bloques distintos (region, rastro del cuerpo, equivalencia con
el catalogo, el cargador invocado, R9).

---

## 4. R29 — ningun guard relajado (verificado sobre el diff, no sobre la bitacora)

**Censo del diff de `tests/`: 15 lineas de asercion retiradas frente a 241 anadidas.** Las 15
se inspeccionaron una a una: **todas** son aserciones que el ensanchamiento de roles vuelve
FALSAS (el acceso igual a maestro/admin, `acceso.length < dominio.length`, las listas de
sidebar sin «Analitica», el `puedeVer(...) === false` de los tres roles nuevos). Ninguna
asercion vigente y verdadera desaparecio.

- Las listas de sidebar **siguen comparandose con `toEqual`**, no se degradaron a `toContain`. Un item no declarado sigue rompiendo.
- El «acceso subconjunto del dominio» **se conserva intacto**; lo que cambia es `toBeLessThan` -> `toBe` mas `not.toContain("apiKey")`.
- **`tests/unit/analytics/tablero-catalogo-paneles.test.ts`: `git diff` VACIO.** Comprobado. No se le devolvieron valores concretos de `estadoProduccion`; sus unicas menciones a ese campo siguen siendo las del **mock** que dejo la 175. La correccion de la 175 (PR #277) queda intacta, y el censo de R12/R13 se monto **en otro archivo** precisamente por eso.
- **Guard de no-convergencia**: el caso (b) paso de «los conjuntos no son iguales» a «el acceso DERIVA del dominio», partido en (b1) identidad referencial y (b2) censo del fuente. **Aplique la mutacion yo** (reescribir la lista a mano, mismo contenido): **rojo en (b1) y (b2)**, con mensaje que nombra archivo y remedio. Los casos (a) y «no vacio» siguen ahi. Ademas trae **5 autocomprobaciones** del censo (acepta la derivacion y el `as const`, rechaza el literal, rechaza el spread, rechaza la declaracion ausente, ignora los comentarios).
- **10 bloques rojos por diseno** enumerados con archivo, linea y motivo en la bitacora, incluida la **desviacion declarada** (el 129-R5 no figuraba en el design). Bien.
- **Ampliacion del guardia de frontera (+432 / -0)**: NO abre puerta mas ancha. Verificado: allowlist **nominal** de exactamente **dos** modulos (`types`, `presentacion`) con sus nombres; rechaza el namespace, el default, el import dinamico y cualquier nombre no listado; exige ademas que la arista autorizada **exista de verdad hoy**. Y aporta cobertura real: la mutacion **M11** (importar `lib/analytics/consulta` desde la ruta) **solo la caza el bloque nuevo** — el patron vigente de R10 no la cubria. La arista que antes pasaba «por silencio» ahora pasa por permiso escrito.

---

## 5. R5 — el aterrizaje post-login (lo mas delicado, revisado con lupa)

La puerta exigio que el test nuevo **enumere los cinco roles y afirme su destino POR VALOR, no
por derivacion**. **Comprobado: cumple.**

- `tests/unit/auth/destino-post-login.test.ts` escribe los cinco destinos como **literales**
  (`/dashboard`, `/dashboard`, `/ordenes`, `/recepcion-satelite`, `/mis-asignaciones/reparto`)
  y su cabecera deja escrito: «PROHIBIDO derivar el esperado de `primerDestino`, de
  `itemsVisibles` o de `SIDEBAR_ITEMS`».
- **Mutacion M1** (quitar `destinoInicial: false` del item): **5 casos rojos** en ese archivo
  y **`tests/components/HomePageMaestro.test.tsx` sigue VERDE**. Es exactamente el defecto que
  la puerta cerro, reproducido y demostrado: el test viejo deriva y no se entera; el nuevo si.
- La implementacion es un **campo del item** (`destinoInicial?: false`), no un literal de ruta
  dentro de `primerDestino`; el test lo fija aparte y afirma que «Analitica» es el unico
  excluido hoy, y que el item **sigue visible** para los cinco: no elegible como aterrizaje no
  es lo mismo que oculto.

No hay cambio silencioso de pantalla de entrada para `mensajero` ni para `adminSatelite`.

---

## 6. R15 / R27 y el oraculo M-4

Segun la correccion del leader (verificada por el, y confirmada por mi al leer
`lib/actions/analitica-operativa.ts:117-128`): **M-4 ya estaba cerrado por la 126** y la ficha
182 quedo **cancelada**. **No lo trato como hallazgo ni como defecto del implementer.**

Lo que si juzgo, que es lo que se me pidio:

- **R27 sigue siendo correcto.** Prohibir que la ocultacion del selector se presente como
  cierre sigue siendo el requisito adecuado: lo que cierra el canal es el guard del **borde**,
  no la UI. El test `presentacion-oraculo-frontera.test.ts` lo demuestra por el camino real de
  la URL y **matando la mutacion**: cuando el borde deja de decidir (M8), el test cae. Si la UI
  fuera la que decide, ese caso seguiria verde. Es la forma correcta del requisito.
- **Ni la bitacora ni ningun comentario afirman que la 133 cierre M-4.** Verificado en los
  cinco sitios donde se menciona: todos dicen lo contrario, en voz alta y con la razon escrita
  («ocultar el control quita la comodidad, no el canal»). La bitacora incluso plantea la duda
  **sin resolverla** y la deja al reviewer, que es lo correcto.
- Residuo documental: ver menor 6.

---

## 7. Hallazgos

### BLOQUEANTES: ninguno.

### Menores

**menor 1 — `./init.sh` no cierra en verde en este worktree.**
Corrido por mi: falla en `pnpm run test` por los **3** casos de
`tests/integration/db/analytics-daily-migration.test.ts`, que necesitan `DATABASE_URL` para
`prisma migrate diff`. Es la trampa de entorno ya medida (**no se creo `.env`**, y pasar un
`DATABASE_URL` falso empeora: des-saltea unos 20 tests de integracion). Las fases previas del
script —node, dependencias, typecheck, lint— pasan en verde. **El CHECKPOINT «init.sh en
verde» no puede marcarse desde aqui**: debe medirse donde haya `.env` (leader, T8.3). No
imputable a la feature: ni uno de los 18 archivos que toca esta bajo `tests/integration/db/`.

**menor 2 — `tasks.md` no esta al 100 %.**
32/35. Las tres pendientes (T8.2, T8.3, T8.4) son del **leader**, no del implementer.
CHECKPOINTS pide todas marcadas; se cierran al pasar la puerta del leader.

**menor 3 — R28: el E2E esta escrito y NO ejecutado. Riesgo residual nombrado.**
Mi juicio: **basta, con la reserva escrita**. Razones: (i) la decision humana vigente del repo
(2026-07-30) es «no mas e2e, pruebas basicas nada mas», y hay 17 specs de `e2e/` en el mismo
estado; (ii) los tres riesgos que el E2E cubriria —region financiera invisible, seis paneles,
facetas recortadas— estan cubiertos por tests de pagina que **yo mismo puse rojos con
mutaciones** (M2, M6, M17); (iii) `next build` compila `/analitica`.
**Lo que queda descubierto, y hay que decirlo:** el cableado real **sesion -> rol -> gate** no
se prueba de extremo a extremo. `AnaliticaPage.test.tsx` mockea `resolveActorFromSession`, asi
que un fallo en la resolucion real de la sesion (no en el gate, que si esta probado) no lo
cazaria nada de esta feature. El riesgo es bajo —esa resolucion es codigo compartido y
preexistente que la 133 no toca— pero no es cero.

**menor 4 — R26: media cobertura vacia. Aceptable, y bien resuelto.**
El implementer **no invento produccion para tener algo que probar**, que es la decision
correcta. El tripwire **no es decorativo**: lo verifique con la mutacion **M9** (anadir el
grano `mensajero` a un panel) y da **2 rojos**. Ademas el criterio se demuestra discriminante
con un panel sintetico dentro del propio test. Nota para quien lo encuentre: el ultimo caso
(«hoy no existe tal advertencia en `textos.ts`») se pondra rojo tambien cuando alguien anada
la advertencia **correcta**; es deliberado —obliga a tocar el test junto con la superficie—
pero conviene saberlo.

**menor 5 — el rotulo de alcance va sin acentos.**
«Estas viendo unicamente las ordenes de tu tienda...» es texto **visible al usuario**. Es
coherente con el resto de `textos.ts`, que ya estaba integramente sin acentos desde la 131,
asi que **no es regresion de esta feature**; se anota para que alguien decida si el archivo
entero se normaliza algun dia.

**menor 6 — residuo documental sobre M-4.**
La correccion del leader (`b468b69d`) alcanzo `requirements.md` y `feature_list.json`, pero
**no** los textos que ya estaban escritos. Siguen diciendo que M-4 «esta ABIERTO» y que la 182
es una ficha viva en: `tests/unit/analytics/presentacion-oraculo-frontera.test.ts` (cabecera),
`e2e/analitica-roles.spec.ts`, `tests/components/FiltrosOperativos.test.tsx`,
`tests/components/AnaliticaPage.test.tsx` y `progress/impl_133-....md`.
**No es bloqueante**: ninguno afirma que la 133 cierre nada —todos afirman lo contrario, que es
justo lo que R27 exige—, y el razonamiento que sostienen (R15 y R27) sigue siendo valido. Es
una fecha caducada, no una mentira sobre el permiso. Se corrige en este PR o en el siguiente
que pase por ahi.

---

## 8. Recuento de mutaciones (propias)

**18 lanzadas / 18 discriminaron / 0 supervivientes.**

| # | Mutacion | Archivo mutado | Resultado |
|---|---|---|---|
| M1 | quitar `destinoInicial: false` | `menu-visibility.ts` | 5 rojos (R5); `HomePageMaestro` verde |
| M2 | region financiera para todos | `page.tsx` | 13 rojos (R6, R7, R8, R9) |
| M3 | reescribir la lista de roles a mano | `menu-visibility.ts` | 2 rojos (guard b1, b2) |
| M5 | el recorte devuelve siempre las 3 facetas | `presentacion.ts` | 10 rojos (R14, R15, R18, R23) |
| M6 | filtro que quita un panel por alcance | `PanelesOperativos.tsx` | 11 rojos (R11, R22) |
| M7 | recortar el filtro en el cliente | `PanelesOperativos.tsx` | 7 rojos (R19, R21) |
| M8 | el borde deja de decidir | `oraculo-mensajero.ts` | 2 rojos (R27) |
| M9 | panel con grano `mensajero` | `catalogo-paneles.ts` | 2 rojos (R26) |
| M10 | arista `alcance-columnas` desde la ruta | `page.tsx` | 2 rojos (R20 y R10 de la 131) |
| M11 | arista `consulta` desde la ruta | `page.tsx` | 1 rojo, **solo del bloque nuevo** |
| M12 | acceso de vuelta a maestro/admin | `menu-visibility.ts` | 25 rojos (R1, R2, R3) |
| M13 | `textoAlcance` devuelve `null` | `textos.ts` | 5 rojos (R24, R25) |
| M14 | uuid dentro del texto del rotulo | `textos.ts` | 2 rojos (R25) |
| M15 | enlace que anuncia la region financiera | `PanelesOperativos.tsx` | 6 rojos (R7, R10) |
| M16 | pre-cargar el dinero antes del gate | `page.tsx` | 3 rojos (R8) |
| M17 | la barra ignora la prop `facetas` | `FiltrosOperativos.tsx` | 5 rojos (R14, R16) |
| M18 | la ruta importa el catalogo y lee `estadoProduccion` | `catalogo-paneles.ts` | 4 rojos (R12, R13) |

(M4 se fusiono con M5 durante la ejecucion; la numeracion se conserva tal como se corrio.)

Ademas, dos **mediciones directas** del DOM renderizado —no mutaciones— para comprobar la
forma en que se pinta el dinero: ver seccion 3.

**Arbol restaurado y verificado limpio** (`git status --short` vacio) al terminar. No se
ejecuto `git checkout`, `git switch` ni `git reset`; los ficheros se restauraron por copia
desde una copia de seguridad fuera del repo.

---

## 9. Que le queda al leader

1. `./init.sh` completo **en un checkout con `.env`** (T8.3) — el unico checkpoint que no
   puedo cerrar desde `C:/w133`.
2. Marcar T8.2-T8.4 en `tasks.md`.
3. PR hacia `dev` citando los 10 rojos por diseno.
4. Entrada en `progress/history.md`.
5. Opcional, en este PR o el siguiente: el menor 6 (la fecha caducada de M-4 en cinco textos).
