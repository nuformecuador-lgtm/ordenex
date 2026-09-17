# 443 — la tienda y el satélite y su número de efectividad (backend)

Rama `fix/443-efectividad-por-rol`, desde `origin/dev` (`8e602bf8`, con la 441 y la 442 ya
dentro). Ficha sin SDD: los requisitos son los del encargo y los dos diseños aprobados
(`design-analitica/Tienda.dc.html`, `Satelite.dc.html`), y se numeran aquí para poder mapearlos.

## 1. Lo primero, porque cambia la ficha: EL HUECO YA ESTÁ CERRADO

El encargo dice «la tienda y el satélite no tienen ningún número de efectividad». **Medido hoy en
el navegador, con sesión real de los tres roles, sobre esta rama (= `origin/dev`), a 1440 y a
390 px: es falso.** El héroe de la 441 aparece para los tres, y con el alcance de cada uno.

| rol | alto a 1440 | héroe | cargadas | lo que escribe |
| --- | --- | --- | --- | --- |
| `maestro` (`.env`) | 3221 px | sí, cifra a **68 px** | **69** | «17,4 %» · «37,5 % de las 32 órdenes con desenlace terminaron entregadas» |
| `adminTienda` (`tienda.qa`) | 3149 px | sí, cifra a **68 px** | **68** | «17,6 %» · barra 12 · 20 · 36 |
| `adminSatelite` (`satelite.qa`) | 1635 px | sí | **8** | «1 entregada de 8 órdenes» + «Son muy pocas para un porcentaje: con menos de 20, una sola orden movería la cifra más de 5 %» |

**68 y no 69 para la tienda** es el alcance funcionando a la vista: hay una orden en la base que
no es suya. **8 para el satélite** es su zona (Quepos). A 390 px el héroe baja a **52 px** y
ningún rol desborda en horizontal (`scrollWidth` = 390 en los tres).

Lo que el encargo midió —«1457 px, sin fila de KPIs, sin tabla de productos»— **no puede
reproducirse contra el código**: `<KpisEfectividad />` se monta en el único camino JSX de
`app/(app)/analitica/page.tsx` y **ya lo hacía antes de la 441** (`git show
df11f220:app/(app)/analitica/page.tsx:288` lo tiene fuera de toda rama por rol). La tabla de
productos sí se le pinta a la tienda, con su alcance (`Tienda: Tania`, sin columna «Tienda»), y
al satélite no —`ALCANCE_PRODUCTOS.adminSatelite = "prohibido"`, que es lo que el diseño de
satélite también pide—. Los 1457 px se parecen a los **1635 del satélite**, no a los 3149 de la
tienda: sospecho que la fila «tienda · satélite» del encargo es una sola medición del satélite.
**No lo persigo más: lo que vale es lo medido hoy, y queda arriba.**

Así que lo que faltaba no era el número: era que **nada impidiera perderlo**. Eso es lo que
entrega esta pasada.

## 2. Archivos

### Creados

| archivo | qué es |
| --- | --- |
| `tests/integration/db/efectividad-por-rol.int.test.ts` | 6 casos contra Postgres real: el `WHERE` del héroe con filas AJENAS en la base, y el caso Puntarenas entero. |
| `tests/unit/analytics/heroe-por-rol.test.ts` | 14 casos: el héroe tiene cifra para TODO rol con puerta (datos) y se monta en LOS DOS caminos de la página (censo). |

### Modificados

**Ninguno.** Ni `lib/`, ni `app/`, ni migraciones. El comportamiento medido es el correcto; lo
que no existía era la red que lo sostiene.

## 3. Requisitos → test

| # | requisito | test |
| --- | --- | --- |
| R1 | la tienda no alcanza NINGUNA orden de otra tienda | `efectividad-por-rol.int.test.ts` › «la TIENDA no alcanza la orden de la tienda vecina…» |
| R2 | …y SÍ alcanza las suyas de otra zona (el recorte es por tienda, no por zona de rebote) | mismo caso, segunda mitad |
| R3 | el satélite no alcanza NINGUNA orden de otra zona | mismo archivo › «el SATELITE no alcanza NINGUNA de las seis ordenes de la otra zona» |
| R4 | **el caso Puntarenas**: 27 cargadas y 0 cerradas → ninguna de las dos cifras se escribe | mismo archivo › «EL CASO PUNTARENAS · 27 cargadas y 0 cerradas: el satelite NO recibe un 0 %» |
| R5 | D9: la zona es la de la ORDEN, aunque la gestione un mensajero de otra | mismo archivo › «D9 · el satelite SI ve su orden aunque la gestione un mensajero de otra zona» |
| R6 | …y no entra la de otra zona por haberla gestionado ESE MISMO mensajero | mismo archivo › «D9 · y NO ve la de la otra zona…» |
| R7 | el fixture no está vacío: con alcance global las tres poblaciones están ahí | mismo archivo › «ANTI-VACIO · con alcance GLOBAL las tres poblaciones estan ahi» |
| R8 | todo rol con puerta a `/analitica` recibe una consulta CONCEDIDA (el héroe tiene cifra) | `heroe-por-rol.test.ts` › «`%s` obtiene una consulta CONCEDIDA, no un `forbidden`» (×4, recorriendo `ROLES_ACCESO_ANALITICA`) |
| R9 | el alcance con el que se calcula la cifra es el MISMO que rotula la pantalla | mismo archivo › «`%s` recibe EL MISMO alcance que la pantalla dice que tiene» |
| R10 | el recorte por rol recorta de verdad (no todos ven lo mismo) | mismo archivo › «los roles con puerta NO resuelven todos el mismo alcance» |
| R11 | el héroe se monta en LOS DOS `return` de la página | mismo archivo › «TODO `<AnaliticaShell` recibe el slot que lleva el heroe dentro» |
| R12 | el bloque del héroe no se decide por rol | mismo archivo › «el bloque que contiene el heroe no se decide por rol» |

## 4. Mutaciones ejecutadas, con su rojo real

Aplicadas de una en una sobre el árbol y revertidas después. Tras cada reversión, verde de nuevo
(`git status --short lib/ app/` limpio, comprobado).

| # | mutación | resultado | mensaje real |
| --- | --- | --- | --- |
| M1 | `resolverAlcanceConteoEntregas`: el `adminTienda` pasa a `{tipo:"global"}` (**el alcance de la tienda se ensancha a todas las órdenes**) | **ROJO** 1 caso | `AssertionError: entro la orden de OTRA tienda (la unica con "incidente"): expected 1 to be undefined` |
| M2 | ídem para el `adminSatelite` (**pierde su recorte por zona**) | **ROJO** 3 casos | `AssertionError: entraron ordenes de OTRA zona (las seis entregadas de GAM): expected 6 to be undefined` · `expected 34 to be 27` · `AssertionError: entro una orden de OTRA zona porque la gestiono el mismo mensajero` |
| M3 | el recorte de zona pasa a mirar **la zona del MENSAJERO** (la confusión D9) | **ROJO** 4 casos | `AssertionError: se perdio una orden de SU zona por haberla gestionado un mensajero de otra: expected undefined to be 1` |
| M4a | **el héroe desaparece para un rol, por DATOS**: el satélite se deniega | **ROJO** 2 casos | `AssertionError: adminSatelite entra a /analitica pero el heroe no tendria ninguna cifra que pintar: expected 'forbidden' to be 'ok'` |
| M4b | **…por MONTAJE**: el `return` sin acceso total monta el shell sin `destacado` | **ROJO** 1 caso | `AssertionError: hay un camino de la pagina que monta el shell SIN el bloque donde vive el heroe: expected 1 to be 2` |
| M4c | **…por CONDICIONAL**: `{esAccesoTotal(actor.rol) ? <KpisEfectividad /> : null}` | **ROJO** 1 caso | `AssertionError: el bloque del heroe razona sobre el rol (esAccesoTotal): expected true to be false` |

### El intento que salió VERDE, y lo que enseña

La primera versión de M1 fue la obvia: `condicionDeAlcance`, `case "tienda"` → `Prisma.sql\`TRUE\``.
**Salió verde**, y no es un fallo del test: **el recorte de tienda viaja por DOS capas**. Además de
la condición de `WHERE`, `recortarFiltroConteoEntregas` escribe el id concedido dentro del propio
`filtro` («cinturón y tirantes», su comentario lo dice), y `condicionesDeConsulta` lo traduce a un
`o."tienda_id" IN (...)`. Con una capa rota, la otra sigue recortando.

Consecuencia para quien venga: **una mutación de UNA línea en `condicionDeAlcance` no es
observable por comportamiento** — por diseño, y está bien que así sea. La cubre el test de texto
que ya existía (`conteo-por-status-sql.test.ts` › «El recorte por ROL es la primera condición,
siempre»). Por eso M1/M2 se aplican en el RESOLUTOR, que es la decisión única de la que salen las
dos capas, y M3 en las dos a la vez, que es una sola decisión escrita dos veces.

## 5. Por qué estos tests y no los que ya había

Se comprobó archivo por archivo antes de escribir nada:

- `conteo-entregas-contrato.test.ts` afirma que el resolutor devuelve `{tipo:"tienda"}` /
  `{tipo:"zona"}`. Mide el RESOLUTOR, no el `WHERE`.
- `conteo-por-status-sql.test.ts` mira el TEXTO del `Prisma.Sql`. Mata una mutación escrita a
  mano; no mide nada de lo que Postgres hace con el `LEFT JOIN LATERAL`.
- `cohorte-carga-alcance.int.test.ts` sí va contra el motor, pero de **otra consulta**
  (`CohorteCargaRepository`, que arma su `where` con `condicionesSinFecha` de
  `ConteoCargadasPorDiaRepository`) y afirmando **sobre conteos**.
- `conteo-por-status-cohorte.int.test.ts` (441) sí ejercita la consulta del héroe, pero siembra
  **una sola tienda y una sola zona**: no hay fila ajena que colarse.
- `madurez-cohorte.test.ts` (441) tiene el caso «0 de 27», pero con **números escritos a mano**.
  Aquí las 27 salen de Postgres y recorren la cadena entera: buckets → `calcularEfectividad` →
  `evaluarMadurezDeCohorte`.

Las aserciones son **sobre órdenes identificables, no sobre totales**: cada población ajena lleva
un desenlace que la propia no puede producir (las 27 de Puntarenas no están gestionadas), así que
«no existe el bucket `incidente`» *es* «no entró la orden de la otra tienda». Un conteo no
distingue «se coló una ajena» de «se perdió una propia».

## 6. LA DECISIÓN QUE PEDÍA EL ENCARGO: la comparación entre bodegas queda FUERA

El diseño del satélite (`Satelite.dc.html`) pone al lado del héroe un panel «Cómo va el resto,
para comparar» con GAM 61 %, Zona Sur 21 %, El Coco 4,7 % y la suya. **No se implementa, y el
motivo está medido, no opinado:**

1. **Censo del repo: CERO superficies le dan a un `adminSatelite` un dato de otra zona.** Se
   revisaron **los 38 archivos** de `lib/services` y `lib/actions` que lo nombran, uno a uno.
   Todos dicen lo mismo, y varios por escrito: `CierreBodegaService:22` «SIEMPRE acotado a SU
   zona», `IncidenteAdminService:116` «SOLO la suya, resuelta del usuario y NUNCA aceptada del
   cliente», `RecuperacionBodegaService:98` («`adminSatelite` de otra zona» NO es responsable),
   `CierresAdminService:484` «un `adminSatelite` que pida la zona del vecino…»,
   `revision-sinpe-pendiente.ts:46` «devolver el aviso de OTRA bodega sería mucho peor que no
   pedirlo», `sinpe-bodega.ts:85` (`/mi-bodega`, **una** ficha).
2. **El repo ya se negó a filtrarle hasta la EXISTENCIA de lo ajeno**, dos veces y con las
   palabras puestas:
   - `mensajes-incidente-admin.ts:21` — no distingue dos mensajes de error porque
     «distinguirlos **revelaría a un `adminSatelite` que una orden de otra zona existe**»;
   - `FiltrosOrdenesService:52-57` — el `adminSatelite` «no recibe zonas», o sea ni los NOMBRES
     de las otras bodegas. Y el motivo escrito para el caso gemelo del `adminTienda`, cinco
     líneas más arriba (`:47`): «la lista es **el directorio de sus competidores**».

   Si el repo no le da los nombres ni admite que la orden del vecino existe, un panel con la
   tasa de cierre de las otras tres bodegas es ese mismo directorio con una cifra de desempeño
   encima.
3. **Estructuralmente hay que romper la frontera para construirlo.** Un agregado por zona exige
   una lectura que **ignore a propósito** el `alcance.zonaId` concedido — exactamente lo que
   existen para cazar `alcance-obligatorio.guardia`, `aislamiento.guardia`,
   `cache-aislamiento.guardia` y `cache-clave-alcance.guardia`, cuya cabecera avisa de que una
   clave que no distingue el alcance «NO da una cifra equivocada: **FILTRA DATOS ENTRE ROLES**».
   Sin policies RLS debajo (Prisma se conecta con credenciales de servicio) esa condición es la
   **única** separación entre inquilinos que hay.
4. **La regla del propio encargo**: «enseñar datos de otra bodega sin querer es peor que no
   comparar», y «el número propio ya es el 90 % del valor».

**Lo que sí se puede hacer sin salir de su zona**, si se quiere recuperar la intención del diseño
(«tu problema no es entregar mal, es que no se mueve»): decirlo con SUS datos —cuántas de las
suyas ya cerraron y en cuánto tiempo—, que es lo que el héroe ya escribe. Contrastar contra el
resto exige una decisión humana nueva sobre a quién pertenece el desempeño de una bodega
satélite, y esa no es de esta ficha.

## 7. Encontrado al medir, y NO tocado (es de otras fichas o de otra decisión)

- La tienda ve la tabla de productos con su alcance y **sin** columna «Tienda»; la columna
  «Recaudado» sale `—` **también para el maestro**, así que es dato ausente, no permiso.
- «Cargadas hoy (2026-09-17) · Sin datos en el rango» en los tres roles → **444**.
- El eje de «Órdenes cargadas por día» pinta `07-21 · 07-22 · 07-23 · 09-04` equiespaciados →
  **445**.
- Para el satélite, `CicloVidaKpi` dice «(0 órdenes cerradas)» mientras el héroe dice «2 con
  desenlace»: son las **tres definiciones de “cerrada”** que la 441 dejó anotadas como deuda
  abierta, ahora visibles en la misma fila. Decisión del humano, no de esta ficha.
- El panel «Por qué no llegaron» del diseño de tienda cuenta **órdenes** (91); el
  `ConteoDevolucionesRepository` que lo alimentaría cuenta **gestiones**, y su propia cabecera
  declara que sus totales no tienen por qué cuadrar con el anillo de arriba. Si el frontend lo
  sube al lado del héroe, hereda esa discrepancia. **Aviso medido para la mitad de pantalla; no
  se rediseña aquí.**

## 8. Verificación

```
pnpm run typecheck   → sin salida (tsc --noEmit)                 TYPECHECK_EXIT=0
pnpm run lint        → ✖ 202 problems (0 errors, 202 warnings)   [los mismos 202 del baseline de la 441]
```

Gate **rápido** (el diff toca sólo `tests/`: ni migraciones, ni `db/schema.prisma`, ni
`lib/types/`, ni configuración de build, ni archivos con nombre de dinero), log en
`progress/gate_443.log`:

```
✓ feature_list.json: sin ids duplicados (442 fichas), cupo por zona respetado (in_progress=0) y specs en su sitio
✓ typecheck paso
✓ lint paso
 ✓ tests/unit/analytics/heroe-por-rol.test.ts (14 tests) 12ms
 ✓ tests/integration/db/efectividad-por-rol.int.test.ts (6 tests) 692ms
 Test Files  2 passed (2)        ← los relacionados con el cambio
 Test Files  238 passed (238)    ← las guardias
      Tests  3446 passed (3446)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 240 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_… 20260814140000_… 20260814160000_…   [preexistente, de otra ficha]
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Ni un `skipped`**: `.env` presente, así que la integración corrió de verdad — y se ve, con su
tiempo (692 ms) y sus 6 casos. El aviso de `down.sql` es preexistente y de migraciones ajenas;
aquí no hay migración.

## 9. Veredicto

El héroe ya le daba a la tienda lo suyo y al satélite lo de su zona —medido en pantalla con las
tres sesiones—; lo que no había era nada que lo impidiera romper, y ahora seis casos contra
Postgres y un censo de la ruta lo sostienen. La comparación entre bodegas queda fuera, con el
censo que dice por qué.
