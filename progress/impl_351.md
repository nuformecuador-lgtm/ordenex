# impl_351 — los filtros dejan de ofrecer cuentas dadas de baja

Rama `fix/351-filtros-sin-inactivos`, worktree `R:\wt\351`. BACKEND_DEV.
Reportado por el humano: «muestra tiendas o mensajeros que tenemos desactivos y eso es información
que no debe mostrarse». Criterio de referencia: «los filtros de las órdenes de la central son los
que están casi perfectos (sin contar los filtros que muestran info de inactivos)».

---

## 1. El censo: TODAS las consultas que alimentan un desplegable con usuarios

Doce sitios revisados, uno por uno, en el árbol real (no solo en el grafo). Las líneas son las de
este worktree DESPUÉS del cambio.

| # | Consulta | Archivo:línea | A qué desplegable llega | Estado antes | Qué se hizo |
|---|---|---|---|---|---|
| 1 | `UserRepository.listCuentasTienda` | `lib/repositories/UserRepository.ts:149` | filtro **Tienda** de `/ordenes`, de la barra de entregas del panel y del tablero operativo | sin filtro de `estado` (decisión (e) de la 144) | **FILTRADO** |
| 2 | `UserRepository.listMensajerosParaFiltro` | `lib/repositories/UserRepository.ts:211` | filtro **Mensajero** de `/ordenes`, de `/recepcion-satelite` y de `/historico/conversaciones` | sin filtro de `estado` (pedido 2026-08-25) | **FILTRADO** |
| 3 | `CierresAdminRepository.findCatalogoFiltros` → `zonas` | `lib/repositories/CierresAdminRepository.ts:1038` | filtro **Bodega** de `/cierres-admin` (3 módulos) | zona con `adminSatelite` de CUALQUIER estado | **FILTRADO** |
| 4 | `CierresAdminRepository.findCatalogoFiltros` → `mensajeros` | mismo método | filtro **Mensajero** de `/cierres-admin` **Y** universo de `DescargarGestionesDialog` | sin filtro de `estado` | **SEPARADO** en dos campos (ver §3) |
| 5 | `OrdenRepository.findMensajerosByZona` vía `listarMensajerosParaAsignacion` | `lib/repositories/OrdenRepository.ts:2608` · `lib/actions/ordenes-guia.ts:182` | modales de asignación (correcto) **Y** filtro Mensajero de `FiltrosEntregas` (`app/(app)/_components/FiltrosEntregas.tsx:81`) | sin filtro de `estado` | **NO SE TOCA EL BACKEND** — el arreglo es de UI (ver §6) |
| 6 | `UserRepository.listByRol` | `lib/repositories/UserRepository.ts:116` | filtro Mensajero de la analítica operativa; selectores de tienda de API keys y de tarifas | ya `estado: "activo"` | ya estaba limpio |
| 7 | `OrdenRepository.findAllMensajeros` | `lib/repositories/OrdenRepository.ts:2598` | **NADIE** | sin filtro | **no se toca**: 0 llamadores (ver §5) |
| 8 | `ZonaRepository.listLite` | `lib/repositories/ZonaRepository.ts:161` | filtro **Zona** de `/ordenes` | — | nada que hacer: `zona` no tiene columna de estado |
| 9 | Opciones de `/novedades` | `app/(app)/novedades/_components/novedades-filtros.ts:213,228` | filtros de esa pantalla | derivadas de las FILAS cargadas | **no se toca**: son DATOS, no catálogo |
| 10 | Filtro de `/configuracion` (usuarios) | `app/(app)/configuracion/_components/usuarios-filtros-def.ts` | filtro por **rol** | — | **no se toca**: es la pantalla de administración, ahí los inactivos DEBEN verse |
| 11 | `UserRepository.listMensajeros` | `lib/repositories/UserRepository.ts:173` | ranking y resumen de carga masiva | ya `estado: "activo"` | no aplica (no es filtro) |
| 12 | `usuario.findMany` por ids en los ledger | `PagoMensajeroMovimientoRepository.ts:260` · `WalletTiendaMovimientoRepository.ts:245` | nombres de las filas de saldo | — | **no se toca**: son DATOS |

**El humano vio dos casos (tiendas y mensajeros); son cuatro consultas que arreglar y una quinta
que solo se arregla desde la UI.** El «1 mensajero inactivo, 2 tiendas inactivas y 1 bodega
satélite inactiva» medido en producción se reparte así: el mensajero y las tiendas son (1) y (2);
la bodega satélite es (3) — `zona` no tiene estado, así que «bodega inactiva» solo puede
significar *zona cuyo `adminSatelite` está dado de baja*.

---

## 2. Qué se cambió

- `lib/constants/estado-usuario-asignable.ts` — se AMPLÍA el docstring: la misma lista
  (`ESTADOS_USUARIO_NO_ASIGNABLES`) manda ahora en los catálogos de filtro. **No hay segunda
  lista.** Queda escrita la frontera catálogo/datos y la decisión sobre `pendiente`.
- `lib/repositories/UserRepository.ts` — `estado: { notIn: [...ESTADOS_USUARIO_NO_ASIGNABLES] }`
  en `listCuentasTienda` y en `listMensajerosParaFiltro` (en esta última, HERMANO del `zonaId`,
  no dentro de su rama condicional).
- `lib/repositories/CierresAdminRepository.ts` — el `some` de `zonas` exige un `adminSatelite` en
  pie; `mensajeros` se parte en dos listas.
- `lib/types/filtros-cierres.ts` — `CatalogoFiltrosCierresDTO` gana `mensajerosFiltro` (campo
  REQUERIDO, no opcional: un opcional con `?? mensajeros` sería fail-open y silencioso).
- `lib/types/filtros-ordenes.ts`, `lib/interfaces/repositories/IUserRepository.ts` — los
  docstrings decían exactamente lo contrario de lo que ahora hace el código.
- Tests: 1 archivo nuevo de integración, 15 archivos de test actualizados.

Nada de UI, nada de migraciones, nada de RLS. El cambio es de `WHERE` y de contrato de DTO.

---

## 3. Cómo se separó CATÁLOGO de DATOS

**Encontrado un sitio donde la misma consulta alimentaba las dos cosas**, y es el que habría hecho
el daño que la ficha prohíbe:

`CierresAdminRepository.findCatalogoFiltros` servía UNA lista de mensajeros a dos consumidores:

- `FiltrosCierresBarra.tsx:173` — un **catálogo de filtro**;
- `DescargarGestionesDialog.tsx:132` — un **universo de datos**: `idsCatalogo` es la selección
  POR DEFECTO de la descarga («no tocar nada = todos»), y esos ids viajan al servidor como
  `mensajeroIds`. Recortar esa lista **habría borrado del archivo Excel las gestiones históricas
  de todo mensajero dado de baja, en silencio y sin poner rojo ningún test.**

Solución: `mensajeros` **conserva su significado** (universo completo del histórico) y se AÑADE
`mensajerosFiltro`. Se eligió ese reparto y no el inverso a propósito: si me equivoco en esta
dirección, el desplegable de `/cierres-admin` sigue mostrando inactivos hasta que se cambie una
línea de UI; si me equivocara en la otra, se perderían filas de una descarga sin que nadie se
entere. **Consecuencia honesta: el filtro de `/cierres-admin` NO queda arreglado hasta que
`FiltrosCierresBarra.tsx:173` lea `catalogo.mensajerosFiltro`** (§6).

Los otros tres casos NO tenían esa doble función —se comprobó consumidor por consumidor— y por eso
ahí el `WHERE` sí vive en la consulta.

Y la mitad que protege el histórico está afirmada, no supuesta: `OrdenRepository.list` no mira el
estado de la tienda ni del mensajero, y hay dos tests que lo exigen (T4 y T5).

---

## 4. Qué pasa con `pendiente`, y por qué

**Se OFRECE en los catálogos de filtro** (no está en `ESTADOS_USUARIO_NO_ASIGNABLES`).

Tres razones, en orden de peso:

1. **Un `pendiente` puede tener trabajo vivo HOY.** No está en la lista de no-asignables, así que
   el sistema permite asignarle órdenes y el servidor no lo rechaza. Esconderlo del filtro dejaría
   sin poder buscar órdenes que existen y están en curso — exactamente el daño que esta ficha
   prohíbe, solo que con otra cara.
2. **El humano nombró «desactivos».** `pendiente` es una cuenta recién creada sin verificar, no una
   dada de baja. Rellenarlo por mi cuenta sería inventar (CLAUDE.md, regla 6).
3. **Una sola lista.** La ficha pide reutilizar `ESTADOS_USUARIO_NO_ASIGNABLES`; escribir
   `estado: "activo"` habría sido una segunda regla con vida propia.

Queda una **incoherencia conocida y aceptada**: `listByRol` (analítica operativa) sí exige
`activo`, así que ahí un `pendiente` no se ofrece y en `/ordenes` sí. No se unificó porque
`listByRol` es anterior, sirve a más superficies (API keys, tarifas) y tocarlo excede la ficha.
Está anotado como dudoso en §7.

---

## 5. `OrdenRepository.findAllMensajeros`: medido, pero muerto

La ficha lo señalaba como parte del problema. **No lo es: no tiene ni un llamador de producción.**
Comprobado por las dos vías que exige `CLAUDE.md`: `trace_path` del grafo devuelve
`"callers": []`, y un `grep` en el árbol real solo encuentra la interfaz, la implementación y
mocks de test (`tests/unit/services/*` lo declaran en sus dobles de `IOrdenRepository`). Además no
es un catálogo de filtro: nació en R28/T15, para la generación de guías.

**No se tocó.** Cambiar el `WHERE` de código que nadie ejecuta habría dado una sensación de
arreglo sin arreglar nada.

---

## 6. Lo que falta, y es de FRONTEND (no lo toqué, por alcance)

Tres cambios, ninguno de datos. Sin ellos el arreglo está a medias:

1. **`app/(app)/cierres-admin/_components/FiltrosCierresBarra.tsx:173`** — cambiar
   `catalogo.mensajeros` por `catalogo.mensajerosFiltro`. Es la única línea que hace visible el
   arreglo en `/cierres-admin`. ⚠️ **NO tocar `DescargarGestionesDialog`**: ese debe seguir leyendo
   `catalogo.mensajeros` (hay un test que lo vigila, ver §8).
2. **`app/(app)/_components/FiltrosEntregas.tsx:81`** (`mensajerosFetcher`) — el filtro de
   mensajero de la barra de entregas se sirve de `listarMensajerosParaAsignacion`, que es la lista
   de ASIGNACIÓN y por diseño incluye a los dados de baja (los modales los muestran deshabilitados
   con su motivo; eso es correcto y no se toca). Ese componente **ya pide** el catálogo de
   `/ordenes` en la misma oleada: debería tomar los mensajeros de ahí. Ojo: el docstring de esa
   función argumenta lo contrario, y hay que reescribirlo con la decisión nueva.
3. **Limpieza del sufijo «(inactiva)»** en `app/(app)/ordenes/_components/ordenes-filtros-def.ts:138`
   y `app/(app)/_components/entregas-filtros-def.ts:162`: código ya inalcanzable, porque
   `CuentaTiendaDTO.activa` ahora es siempre `true`. No molesta, pero miente al lector.

---

## 7. Lo dudoso, dicho en voz alta

- **Esta ficha REVIERTE dos decisiones humanas escritas, y hay que saberlo.** La decisión (e) de
  la feature 144 (cuentas tienda inactivas en el filtro) y el pedido del 2026-08-25 (mensajeros
  «TODOS») decían literalmente lo contrario, con este argumento: «excluirlas haría invisibles esas
  órdenes bajo el filtro». El argumento era **falso en su premisa**: las órdenes no se vuelven
  invisibles —el listado no filtra por estado del dueño— y lo único que se pierde es poder acotar
  POR esa cuenta. Aun así, es una reversión, y el humano puede querer el matiz de vuelta (por
  ejemplo: ofrecerlas solo cuando el filtro ya viene puesto por URL). No lo implementé.
- **`/cierres-admin` no queda arreglado con este PR solo** (§3 y §6.1). Es deliberado.
- **La incoherencia de `pendiente` entre `listByRol` y los catálogos nuevos** (§4).
- **Una zona con DOS `adminSatelite`, uno activo y otro de baja, se sigue ofreciendo** como bodega.
  Es lo correcto (sigue habiendo quien la opere), pero no está medido en producción si ese caso
  existe.
- **`findCatalogoFiltros` proyecta `nombre` a secas** para los mensajeros aunque el `select` trae
  los apellidos (`NOMBRE_USUARIO_SELECT`), a diferencia del resto del repo, que compone con
  `nombreCompletoUsuario`. Parece un olvido del commit `95517ff2` («nombre y apellidos en toda la
  aplicación»). **No lo toqué**: no es de esta ficha y cambiaría etiquetas visibles.

---

## 8. Verificación

### Tests contra Postgres (no con dobles)

`tests/integration/db/filtros-catalogo-sin-inactivos.test.ts` — 6 casos, transacción siempre
revertida, `serializarEscriturasReales` como primera sentencia. Siembra las CUATRO formas de
`EstadoUsuario` en tienda y en mensajero, dos zonas (una con admin en pie, otra con admin de baja)
y **una orden de la tienda dada de baja llevada por el mensajero dado de baja**. Sin catálogos en
la base **revienta con mensaje**; no hay ningún `if (!x) return`.

```
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

| Caso | Qué afirma |
|---|---|
| T1 | `listCuentasTienda` ofrece `activo` y `pendiente`, y NO `inactivo` ni `bloqueado` |
| T2 | `listMensajerosParaFiltro` igual, con y sin acotar por zona |
| T3 | la zona con admin de baja NO se ofrece como bodega; la del admin en pie SÍ (contraprueba primero) |
| **T4** | **la orden histórica SIGUE en el listado** |
| **T5** | **filtrar por la tienda o el mensajero dados de baja SIGUE devolviendo su orden** |
| T6 | `mensajerosFiltro` los deja fuera y `mensajeros` los CONSERVA |

### Mutaciones — 7 aplicadas, 7 muertas, 0 supervivientes

Todas ejecutadas de verdad y revertidas; `git diff | grep "MUTACION M"` vuelve vacío.

| # | Mutación | Test que cae | Línea y mensaje reales |
|---|---|---|---|
| M1 | quitar el `estado` de `listCuentasTienda` (**la (a) obligatoria**) | T1 | `filtros-catalogo-sin-inactivos.test.ts:248` · `expected [ 'activo', 'bloqueado', …(2) ] to deeply equal [ 'activo', 'pendiente' ]` |
| M2 | quitar el `estado` de `listMensajerosParaFiltro` | T2 | `:269` · `expected [ 'activo', 'bloqueado', …(2) ] to deeply equal [ 'activo', 'pendiente' ]` |
| M3 | quitar el `estado` del `some` del admin de zona | T3 | `:293` · `expected [ …(4) ] to not include '517a5e2c-…'` |
| M4 | `mensajerosFiltro` sin filtrar | T6 | `:363` · `expected [ 'activo', 'bloqueado', …(2) ] to deeply equal [ 'activo', 'pendiente' ]` |
| M5 | recortar `mensajeros` (el universo de la descarga) | T6 | `:361` · `expected [ 'activo', 'pendiente' ] to deeply equal [ 'activo', 'bloqueado', …(2) ]` |
| **M6** | **meter `tienda: { estado: { notIn: … } }` en el `where` de `OrdenRepository.list` — el filtro aplicado a los DATOS (la (b) obligatoria)** | **T4 y T5** | `:313` · `expected [ …(67) ] to include '497a3e28-…'` — y `:340` · `expected [] to deeply equal [ Array(1) ]` |
| M7 | endurecer a `estado: "activo"` (esconder también a `pendiente`) | T1 y T2 | `:248` y `:269` · `expected [ 'activo' ] to deeply equal [ 'activo', 'pendiente' ]` |

M6 es la que protege el histórico: se puso roja por partida doble (la orden desaparece del listado
y el filtro por sus ids devuelve vacío). M5 protege la descarga de gestiones.

Además, en el fixture de `tests/components/descarga/DescargarGestionesDialog.test.tsx`,
`mensajerosFiltro` es a propósito MÁS CORTO que `mensajeros`: si alguien «arregla» ese diálogo
para que lea la lista del filtro, los casos de las líneas 218 y 407 se ponen rojos.

### Comandos

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm lint
✖ 145 problems (0 errors, 145 warnings)      ← todas heredadas (`_foo is defined but never used`)

$ pnpm run test:cambiados
 Test Files  431 passed (431)
      Tests  5832 passed | 26 skipped (5858)
EXIT=0

$ pnpm run test:guardias
 Test Files  1 failed | 171 passed (172)
      Tests  1 failed | 2586 passed (2587)
EXIT=1
```

El único rojo es `tests/unit/guards/superficie-de-uso.guardia.test.ts`, señalando
`+ "lib/actions/tarifas.ts:67 obtenerTarifa"`: es exactamente la única entrada de
`tests/baseline-rojos.json`, heredada de `dev` y tolerada por el encargo. Ningún archivo rojo
nuevo. (No corrí `scripts/comparar-baseline-rojos.mjs` porque exige repetir las dos suites con
reporter JSON; la comparación por archivo está hecha a mano y da el mismo veredicto.)

**Nota para el leader:** el diff toca `lib/types/**`, así que `./init.sh --rapido` se negará por
diseño y pedirá la corrida completa. Es correcto, no es un fallo.

Durante la corrida `tests/components/TableroOperativoLatencia.test.tsx` cayó UNA vez («las
invocaciones se SOLAPAN») y pasó 5/5 en aislado y en la corrida siguiente: flake de saturación
conocido, ajeno a este cambio.

---

## 9. Archivos

**Creados**

- `tests/integration/db/filtros-catalogo-sin-inactivos.test.ts`
- `progress/impl_351.md`

**Modificados — producción (6)**

- `lib/constants/estado-usuario-asignable.ts`
- `lib/repositories/UserRepository.ts`
- `lib/repositories/CierresAdminRepository.ts`
- `lib/interfaces/repositories/IUserRepository.ts`
- `lib/types/filtros-ordenes.ts`
- `lib/types/filtros-cierres.ts`

**Modificados — tests (15)**

- `tests/unit/repositories/catalogo-filtros-ordenes.test.ts` (invierte el contrato de la 144 y
  añade el del catálogo de mensajeros)
- `tests/components/CierresAdminFiltros.test.tsx`,
  `tests/components/descarga/{CierresAdminDescargaDetallada,CierresBodegaDescargaDetallada,DescargarGestionesDialog}.test.tsx`
- 10 dobles de `ICierresAdminRepository` en `tests/unit/services/`

---

**Veredicto:** los cuatro catálogos de filtro dejan de ofrecer cuentas dadas de baja sin esconder
ni una fila del histórico —probado contra Postgres y con 7 mutaciones muertas—, pero
`/cierres-admin` y la barra de entregas necesitan tres cambios de UI (§6) para que el arreglo se
vea en pantalla.

---
---

# impl_351 — segunda parte: la UI. FRONTEND_DEV

Mismo worktree y misma rama. Cierra los tres puntos que §6 dejó abiertos. **No se tocó ni una
línea de `lib/`, ni migraciones, ni rutas de API**: todo lo de abajo es capa de presentación y
sus tests.

---

## 10. Los tres puntos, cableados

### 10.1 `/cierres-admin` deja de ofrecer mensajeros dados de baja

`app/(app)/cierres-admin/_components/FiltrosCierresBarra.tsx` — el desplegable lee
`catalogo.mensajerosFiltro` en vez de `catalogo.mensajeros`. Es la línea que hace visible en
pantalla todo lo que hizo el backend.

**`DescargarGestionesDialog` NO se tocó**, y la razón está ahora escrita en la regla 2 de la
cabecera de la barra (que decía literalmente lo contrario: «los mensajeros son todos»). Los dos
campos quedan nombrados como lo que son —`mensajeros` = universo del histórico y selección por
defecto de la descarga; `mensajerosFiltro` = opciones del desplegable— con la consecuencia dicha
en voz alta: unificarlos rompe una de las dos cosas, y la que rompe **callando** es la descarga.

### 10.2 La barra de entregas deja de beber de la lista de asignación

Dos archivos:

- `app/(app)/_components/entregas-filtros-def.ts` — `construirFiltrosEntregas` pasa de
  `(cat, mensajeros, opts)` a `(cat, opts)` y toma las opciones de `cat.mensajeros`.
- `app/(app)/_components/FiltrosEntregas.tsx` — se van `mensajerosFetcher`, su `useSWR`
  (`"entregas:mensajeros"`), el `ofreceMensajeros` y los dos imports
  (`listarMensajerosParaAsignacion`, `MensajeroLiteDTO`).

**El parámetro se BORRA, no se deja opcional.** Mientras exista, alguien puede volver a pasarle la
lista de asignación y nada se pone rojo; sin él, el error no se puede ni escribir.

Dos efectos colaterales, los dos queridos y los dos anotados en el código:

- **Una lectura menos por visita**: el catálogo ya viajaba; la segunda petición desaparece.
- **Cambia el ALCANCE de la lista, y no es cosmético.** `listarMensajerosParaAsignacion` devuelve
  solo los de la zona **GAM** y responde `forbidden` a quien no sea `maestro`/`admin`. El catálogo
  lo resuelve por ACTOR (`FiltrosOrdenesService`): maestro/admin reciben los del país y el
  `adminSatelite` los de SU zona —que hasta hoy veía el control vacío—. Es la misma regla que ya
  gobierna las otras seis facetas de esa barra, así que el filtro deja de tener una excepción
  propia. Va en §13 como lo más discutible del lote.

### 10.3 El sufijo «(inactiva)» y su constante

`SUFIJO_INACTIVA` retirada de `ordenes-filtros-def.ts`; las dos etiquetas
(`ordenes-filtros-def.ts` y `entregas-filtros-def.ts`) pasan a `label: t.nombre`.

Donde estaba la constante queda escrito, como pedía el encargo: **quién** (el humano), **cuándo**
(2026-09-02), **qué** (la decisión (e) de la feature 144 queda revertida), **por qué** ese sufijo
es hoy código inalcanzable (`activa` llega siempre `true`) y **por qué no se pierde nada**: el
argumento original —«excluirlas haría invisibles esas órdenes»— era falso en su premisa, porque
`OrdenRepository.list` no mira el estado del dueño.

---

## 11. Tests del comportamiento viejo: actualizados, ninguno borrado

Cinco archivos afirmaban la regla anterior. Todos se **invierten con su historia escrita al lado**
—de dónde venían y por qué cambian—, ninguno se elimina.

| Archivo | Qué afirmaba | Qué afirma ahora |
|---|---|---|
| `tests/unit/components/ordenes-filtros-def.test.ts` | «R51: las cuentas INACTIVAS se distinguen en el texto visible» → exigía `Tienda Cerrada (inactiva)` | la etiqueta es el nombre a secas, y **ninguna** opción casa con el paréntesis retirado |
| idem | «R50/R51: las inactivas y las de API key SIGUEN ofreciéndose» | mismo cuerpo, otro título y otro motivo: **la declaración no filtra**, el `WHERE` vive en el servidor. Si filtrara aquí también habría dos reglas para lo mismo |
| `tests/components/FiltrosEntregas.test.tsx` | «el filtro de mensajero se llena con la lista servida, **no** con el catálogo» | al revés: se llena con el catálogo. Más una contraprueba con el catálogo vacío |
| `tests/components/AsignacionBloqueoPorCierre.test.tsx` (271/R33) | la barra recibe `bloqueadosIds`/`noAsignablesIds` y no los lee; anti-vacuidad `toMatch(/listarMensajerosParaAsignacion/)` | se **parte en dos mitades**: la de `noAsignablesIds` (estado de cuenta) se revierte; la de `bloqueadosIds` (bloqueo por cierre) **se conserva** —ese mensajero está `activo` y sigue en el filtro—. La anti-vacuidad se invierte a `not.toMatch` y se ancla en `obtenerCatalogoFiltrosOrdenes` |
| `tests/unit/components/filtros-acotados-por-rol.test.ts` | llamaba con la firma vieja | firma nueva; el mensajero se muda al catálogo |

**La distinción que costó más leer**, y que estaba a punto de perderse: `bloqueadosIds` (feature
271) es *bloqueado por cierre pendiente* —operativo, temporal, el usuario está `activo`— y
`noAsignablesIds` es `ESTADOS_USUARIO_NO_ASIGNABLES` —estado de la cuenta—. Sólo la segunda la
revierte esta ficha. Confundirlas habría escondido del filtro a mensajeros con órdenes en la mano.

### Tests nuevos

- `tests/components/CierresAdminFiltros.test.tsx` — **el bloque que importa**: un catálogo donde
  `mensajerosFiltro` es subconjunto estricto de `mensajeros`, y los DOS consumidores montados
  desde el MISMO objeto en el MISMO render. Tres casos: el desplegable no ofrece a la dada de baja
  / la descarga sí la incluye y **marcada por defecto** / las dos cosas a la vez. Ese tercero es el
  que impide «simplificar» los dos campos en uno: se pueden arreglar los dos primeros por
  separado, ése no.
- `tests/components/FiltrosEntregas.test.tsx` — la barra montada de verdad (SWR → acción →
  declaración → opciones), la contraprueba del catálogo vacío, y la etiqueta de tienda sin sufijo
  (está aquí **además** de en órdenes porque eran DOS sitios componiendo el sufijo).

---

## 12. Mutaciones — 5 aplicadas, 5 muertas, 0 supervivientes

Todas ejecutadas de verdad, con su línea real, y revertidas: buscar `MUTACION M` en el diff
devuelve **0**.

| # | Mutación | Test que cae | Línea y mensaje reales |
|---|---|---|---|
| **M8** | **`FiltrosCierresBarra` vuelve a leer `catalogo.mensajeros` (la obligatoria)** | los dos casos nuevos de `CierresAdminFiltros` | `CierresAdminFiltros.test.tsx:431` y `:473` · `expected document not to contain element, found <button …Nora de Baja…>` |
| M9 | `DescargarGestionesDialog` lee `mensajerosFiltro` (la unificación en la dirección cara) | 8 casos en 2 archivos | `CierresAdminFiltros.test.tsx:445` y `:465`; `DescargarGestionesDialog.test.tsx:198, 212, 347, 369, 384, 398` |
| M10 | vuelve el sufijo en `ordenes-filtros-def.ts` | el caso invertido | `ordenes-filtros-def.test.ts:201` · `expected 'Tienda Cerrada (inactiva)' to be 'Tienda Cerrada'` |
| M11 | vuelve el sufijo en `entregas-filtros-def.ts` | el caso nuevo de entregas | `FiltrosEntregas.test.tsx:494` · `expected [ 'Tienda Viva', …(1) ] to deeply equal [ 'Tienda Viva', 'Tienda Cerrada' ]` |
| **M12** | **la reversión COMPLETA del punto 2: import + `useSWR("entregas:mensajeros")` + sobrescritura del catálogo con la lista de asignación** | la guardia de `AsignacionBloqueoPorCierre` **y** el caso montado de `FiltrosEntregas` | `AsignacionBloqueoPorCierre.test.tsx:340` · `expected … not to match /listarMensajerosParaAsignacion/` — y `FiltrosEntregas.test.tsx:470` · aparece `Zulema Fantasma` en el desplegable |

### El agujero que M12 encontró, y cómo se tapó

**Primera pasada de M12: la mató SOLO la guardia que lee el archivo fuente. Ningún test de
conducta se enteró**, y el motivo es el peor posible: en jsdom la acción real falla, la barra caía
de vuelta al catálogo y daba **por casualidad** el resultado correcto. Verde por accidente.

Se tapó convirtiendo el doble retirado en una **trampa**: `FiltrosEntregas.test.tsx` vuelve a
declarar el mock de `@/lib/actions/ordenes-guia`, pero devolviendo a alguien que no existe en el
catálogo (`Zulema Fantasma`) y que ningún caso espera nunca. Como un mock de un módulo no
importado es inerte, mientras la barra esté bien no hace nada; en cuanto alguien vuelva a
enchufar la acción, Zulema aparece en el desplegable. Con la trampa puesta, M12 muere **dos
veces**: por texto y por conducta. Queda dicho en el propio archivo para que nadie la borre por
«mock muerto».

---

## 13. Lo dudoso de esta mitad

- **El cambio de alcance de §10.2 es lo más discutible del lote.** El filtro de mensajero de la
  barra de entregas pasa de «los de la GAM» a «los del alcance del actor»: el maestro ve ahora
  mensajeros de todo el país y el `adminSatelite` ve los suyos (antes: control vacío). Es
  coherente con las otras seis facetas y con la cifra que se recorta —que no está acotada a la
  GAM—, pero **no lo pidió nadie explícitamente**: sale de tomar los mensajeros del catálogo, que
  es lo que sí se pidió. Si el humano quería exactamente la lista GAM, esto hay que revisarlo.
- **Dos comentarios de `lib/` quedan desactualizados por mi cambio y NO los toqué** (encargo:
  no tocar backend). Los dos dicen que el sufijo sigue vivo en la UI, y ya no lo está:
  `lib/types/filtros-ordenes.ts:40` («el sufijo «(inactiva)» sigue declarado en la UI; retirarlo
  es limpieza de front») y `lib/repositories/UserRepository.ts:147` («lo que se lee para pintar el
  sufijo «(inactiva)» es UI y se limpia aparte»). Son dos líneas de comentario; que las corrija
  quien tenga la mano en `lib/`.
- **`CuentaTiendaDTO.activa` se queda sin ningún lector en la UI.** Sigue en el DTO con sus tests
  (`catalogo-filtros-ordenes.test.ts`), pero desde este cambio nadie la usa para pintar. No la
  retiré —es contrato de servidor— y el fixture de tests la conserva a propósito, como cebo: si
  alguien vuelve a leerla para componer una etiqueta, los casos nuevos se ponen rojos.
- **El filtro de mensajero de entregas NO se encadenó a la zona**, aunque el catálogo ya trae
  `zonaId` y `/ordenes` sí lo encadena (`dependsOn`). Sería un cambio de conducta que nadie pidió
  —y dejaría fuera a los mensajeros sin zona en cuanto se elija una—, así que se quedó como
  estaba. Es la oportunidad más obvia que este diff deja sobre la mesa.
- **`FilterComponent` mete una opción «Todos» en todo filtro `multi`.** No es un mensajero; se
  descubrió midiendo (el primer intento de aserción contaba 2 opciones donde esperaba 1) y está
  anotado en el test para el próximo que compare listas.

---

## 14. Verificación

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: 0 errores)          EXIT=0

$ pnpm lint
145 problems (0 errors, 145 warnings)   <- mismo recuento que reportó el backend; todas heredadas

$ npx vitest run tests/components/CierresAdminFiltros.test.tsx \
    tests/components/FiltrosEntregas.test.tsx \
    tests/components/AsignacionBloqueoPorCierre.test.tsx \
    tests/unit/components tests/components/descarga
 Test Files  95 passed (95)
      Tests  1241 passed (1241)

$ npx vitest run tests/components/AnaliticaPage.test.tsx \
    tests/components/EntregasFiltroConectado.test.tsx \
    tests/components/TableroOperativo.test.tsx \
    tests/unit/analytics tests/unit/components tests/unit/guards
 Test Files  1 failed | 340 passed (341)
      Tests  1 failed | 4715 passed (4733)
```

El único rojo es `tests/unit/guards/superficie-de-uso.guardia.test.ts:687`, señalando
`+ "lib/actions/tarifas.ts:67 obtenerTarifa"`: la única entrada de `tests/baseline-rojos.json`,
heredada de `dev` y tolerada por el encargo. Ningún archivo rojo nuevo. Vale la pena decir que esa
misma guardia **no** marcó `listarMensajerosParaAsignacion` como huérfana: sigue teniendo
consumidores reales en `OrdenesListado` y en los dos modales, que es justo lo que debía pasar.

**No se levantó servidor de desarrollo** (encargo: carpeta de compilación compartida). Sí se
borró `.next/dev` antes del primer `typecheck`, por el problema conocido de tipos truncados.

**Para el leader:** el diff sigue tocando `lib/types/**` (del backend), así que `./init.sh --rapido`
se negará por diseño. Correcto, no es un fallo.

---

## 15. Archivos de esta mitad

**Modificados — producción (4)**

- `app/(app)/cierres-admin/_components/FiltrosCierresBarra.tsx`
- `app/(app)/_components/FiltrosEntregas.tsx`
- `app/(app)/_components/entregas-filtros-def.ts`
- `app/(app)/ordenes/_components/ordenes-filtros-def.ts`

**Modificados — tests (5)**

- `tests/components/CierresAdminFiltros.test.tsx` (el bloque cruzado filtro/descarga)
- `tests/components/FiltrosEntregas.test.tsx` (inversión + trampa + tienda sin sufijo)
- `tests/components/AsignacionBloqueoPorCierre.test.tsx` (271/R33 partido en sus dos mitades)
- `tests/unit/components/ordenes-filtros-def.test.ts`
- `tests/unit/components/filtros-acotados-por-rol.test.ts`

---

**Veredicto:** los tres puntos de UI quedan cableados y `/cierres-admin` ya no ofrece cuentas
dadas de baja —5 mutaciones muertas, incluida la obligatoria y la reversión completa del punto 2—,
con la separación «filtro recortado / descarga entera» fijada en un único render para que
unificar los dos campos sea imposible sin ponerse rojo.
