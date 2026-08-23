# impl 267 — analitica de la propia tienda por API key

> Worktree `C:/w267`, rama `feature/267-analitica-api-key`.
> Spec en `specs/267-analitica-api-key/` (44 requisitos, R1-R44).

## T0 — puerta cerrada y punto de partida

**SHA de `origin/dev` usado: `39115008bfbf563844d197102f0871916e219997`.**
La rama nacio en `b16c8c8e` (justo tras mergear la 268) y se adelanto por fast-forward a
`39115008` ANTES de escribir una sola linea de codigo, porque `dev` avanzo mientras se
redactaba el spec. Solape comprobado con `git log` sobre los archivos de esta feature: el unico
commit que los toca es `041d84a0` (feature 262) y solo modifica
`app/api/ordenes/api-key/carga/route.ts`, que esta feature NO toca. `lib/analytics/` intacto.
Revalidadas tras el avance las tres citas que sostienen el design: `alcance.ts:103`
(`ROLES_SIN_ANALITICA = ["apiKey"]`), la denegacion en `alcance.ts:162-165`, y el fallback
`return "real"` de `politicaIdentidadDe` en `consulta.ts`. Las tres siguen exactas.

### Las ocho respuestas de la puerta (2026-08-23)

El humano dio la orden de continuar. Las ocho preguntas se cierran **tomando la recomendacion
razonada del spec, sin variarla**. Quedan escritas una por una en
`specs/267-analitica-api-key/requirements.md > PUERTA`, y en resumen:

| # | decision |
| --- | --- |
| P1 | lista blanca CORTA y ampliable; la lista definitiva sale de comprobar los 25 ids del catalogo contra R17-R19 en T1, no de copiar la recomendacion a ojo |
| P2 | la dimension `mensajero` se PROHIBE ENTERA en este canal; `seudonima` se mantiene como defensa en profundidad |
| P3 | `desde`/`hasta` identicos a la 257 (`YYYY-MM-DD` CR), AMBOS OBLIGATORIOS, sin presets en v1 |
| P4 | `GET /api/ordenes/api-key/analitica?metrica=&desde=&hasta=`, una metrica por llamada, sin endpoint de listado |
| P5 | si se publica `parcial: true` con su `corteAt` |
| P6 | SI se autoriza estrechar las dos guardias de frontera a allowlist nominal de UN camino. PROHIBIDO renombrar la ruta para esquivar el regex |
| P7 | se acepta la lista blanca de ids: no es tabla de alcance. Se ata al catalogo por test |
| P8 | sin rate limit en esta ficha; decision consciente, no olvido |

### Baseline, medido en esta rama y ANTES de tocar nada

- `pnpm typecheck`: **verde**.
- `pnpm exec vitest run tests/unit/analytics tests/unit/api`: **155 archivos / 1782 tests / 0 rojos**.

⚠️ La PRIMERA corrida de ese mismo comando dio `3 failed | 149 passed (152)` con 3 errores de
worker. La segunda, identica, dio 155/1782 en verde. Es el patron conocido de FLAKES POR
SATURACION de este repo, y se distingue por el conteo de ARCHIVOS: 152 contra 155, o sea que tres
archivos ni se ejecutaron. No son rojos preexistentes ni deuda; pero quedan anotados aqui para
que nadie los descubra luego y los atribuya a esta feature.

## T1-T10 — implementadas (2026-08-23)

| task | que quedo |
| --- | --- |
| T1 | `lib/analytics/publicacion-api-key.ts`: lista blanca de **10** ids. Cribados los 25 del catalogo UNO A UNO. |
| T2 | `alcance.ts`: particion ternaria de roles, `CanalAnalitica`, rama de concesion; `consulta.ts`: 5.o parametro `canal`. |
| T3 | guardia de fuente unica pasa a TRES listas, disjuntas dos a dos; `alcance.test.ts:222` reexpresado. |
| T4 | identidad con fallo CERRADO: el fallback pasa de `real` a `seudonima`. |
| T5 | `lib/api/analitica-integrador.ts`: los cuatro pasos de la 126 con `canal: "api_key"` explicito. |
| T6 | `lib/api/analitica-api-key-dto.ts`: proyeccion campo a campo, `cobertura` obligatoria, sin `Date` ni `BigInt`. |
| T7 | `app/api/ordenes/api-key/analitica/route.ts`. |
| T8 | dos guardias de frontera estrechadas a allowlist nominal. **La tercera, bloqueada: ver abajo.** |
| T9 | OpenAPI: noveno path + schema `AnaliticaSerie`, `enum` DERIVADO de `METRICAS_API_KEY`; espejo YAML en LF. |
| T10 | caso nuevo: un `apiKey` que llega por SESION recibe `forbidden` desde las dos Server Actions. |

### La lista blanca: por que 10 y no 15

De las 25 metricas del catalogo, las 10 financieras caen por criterio duro. De las 15 operativas
restantes se publican 10. Las 5 excluidas, con motivo:

- `sin_gestionar` y `primer_intento_ok` — **no declaran el grano `tienda`**: no hay por donde
  recortarlas por `orden.tienda_id`. Exclusion TECNICA, no de gusto. Se anadio un aserto derivado
  extra: toda metrica publicable debe declarar ese grano, asi que nadie las cuela despues.
- `aging_por_estado` — unica operativa `clase: live`: mide antiguedad AL INSTANTE, no una serie
  del rango pedido. Servirla bajo `desde`/`hasta` publicaria una semantica que el contrato no
  puede expresar.
- `incidentes` y `motivos_devolucion` — publicables tecnicamente; alta por peticion, no por
  defecto (P1 = empezar corto).

Hallazgo colateral: **R19 no excluye a nadie**, porque las 25 son `producida` desde la D11 del
2026-08-03. El requisito se conserva igualmente como candado de futuro.

### Decisiones que el reviewer debe juzgar

1. **`construirServicio` se DUPLICA** en `lib/api/analitica-integrador.ts` respecto de
   `lib/actions/analitica-operativa.ts`. No es descuido: aquel archivo lleva `"use server"`, que
   obliga a que todo export suyo sea `async`, asi que su factory no se puede exportar. Extraer un
   modulo comun habria cambiado el cableado del canal de sesion, que R43 exige dejar intacto.
   Documentado en el propio archivo. Si el reviewer prefiere la extraccion, es ficha aparte.
2. **Los dos guardias de frontera se estrecharon con autocomprobacion negativa REAL**: se crearon
   los infractores en el arbol (un segundo handler, y un import del servicio en el camino
   autorizado), se vio caer el guardia en los dos casos, y se restauraron. No es un aserto
   sintetico: es la diferencia entre estrechar y relajar.

### Verificacion

`pnpm typecheck` verde. `pnpm lint` 0 errores (99 warnings preexistentes, ninguno en esta feature).
`vitest run tests/unit/api tests/unit/analytics tests/unit/types/intentos-no-alcance.test.ts
tests/unit/auth/menu-visibility.test.ts tests/unit/actions`:
**219 archivos / 2666 tests / 1 rojo**, y ese unico rojo es el bloqueo de abajo.

## BLOQUEO ABIERTO — hay una TERCERA guardia de frontera y P6 solo autorizo dos

`tests/unit/analytics/export-csv-frontera.guardia.test.ts:179` (feature **134/R3**) aplica la misma
prohibicion que las dos fichadas, y el spec NO la detecto. Cae **solo por el NOMBRE del archivo**:

    const porRuta = archivos(DIR_API).filter((rel) => /analitica|analytics/i.test(rel));

Verificado que el handler NO dispara ninguno de los diez patrones de codigo del guardia
(`porCodigo` sale vacio): no exporta CSV ni importa nada de `lib/analytics/`. Es un falso positivo
por nomenclatura, no una infraccion de su motivo.

Las dos salidas faciles estan descartadas POR ESCRITO: renombrar la ruta lo prohibe P6
expresamente (seria pasar el guardia sin pasar su motivo), y estrechar una tercera guardia
arquitectonica es decision del humano. Su motivo declarado es identico al de las otras dos («los
route handlers estan reservados para webhooks, **API publica** y crons»), asi que el argumento de
P6 le cabe entero — pero hay que FIRMARLO, no asumirlo.

## BLOQUEO RESUELTO — la tercera guardia, firmada el 2026-08-23

El humano extendio P6 a `export-csv-frontera.guardia.test.ts` (134/R3). Estrechada con el mismo
patron que las otras dos: constante `HANDLER_ANALITICA_AUTORIZADO`, predicado aislado
`rutasDeAnaliticaNoAutorizadas` compartido por el caso real y el sintetico, y comentario de
decision fechado dentro del propio caso. **`porCodigo` queda INTACTO**: sigue barriendo `app/api`
entero, camino autorizado incluido. El razonamiento original de la 134 se conserva palabra por
palabra encima.

La excepcion vale para el NOMBRE, no para la conducta. Comprobado con dos infractores creados EN
EL ARBOL, no con asertos sinteticos:

- **(a)** un segundo handler `app/api/reportes/analitica/route.ts`, trivial y sin analitica en su
  codigo ⇒ **2 casos rojos**. Cae por la ruta, como debe.
- **(b)** al camino AUTORIZADO se le anadio un `import ... from "@/lib/analytics/serie"` y un
  nombre de archivo `.csv` ⇒ **2 casos rojos**, incluido «el censo POR CODIGO sigue vivo SOBRE EL
  PROPIO camino autorizado». Esto es lo que demuestra que se estrecho y no se abrio un agujero.

Arbol restaurado y verificado: `app/api/reportes/` borrado, y el handler real con el mismo hash
md5 antes y despues (`ed176ceaae4b7cd021cfa5492bd338a9`).

## Verificacion final (implementer, 2026-08-23)

```
$ pnpm typecheck
> tsc --noEmit
(sin errores)

$ pnpm lint
0 errors, 100 warnings

$ pnpm exec vitest run tests/unit/api tests/unit/analytics tests/unit/actions \
    tests/unit/types/intentos-no-alcance.test.ts tests/unit/auth/menu-visibility.test.ts
 Test Files  219 passed (219)
      Tests  2669 passed (2669)
```

Los 100 warnings de lint son preexistentes y ninguno pertenece a esta feature: los dos que citan
«analitica» son `app/(app)/analitica/_components/AnaliticaShell.tsx` y
`tests/unit/services/_dobles-analitica-financiera.ts`, que la 267 no toca.

Contra el baseline (155 archivos / 1782 tests / 0 rojos sobre `tests/unit/analytics` +
`tests/unit/api`): **delta de rojos = 0**, con la cobertura subiendo a 2669 tests sobre una
superficie mas ancha.

## Trazabilidad

La tabla `R1..R44 -> test` vive en `specs/267-analitica-api-key/design.md`, y se verifico que **no
queda ningun requisito sin mapear** (comprobado recorriendo R1..R44 contra el design).

## Pendiente, y NO lo hace el implementer

- **T11 — gate y PR**: los corre el leader. El diff **no** toca `db/`, `lib/types/`,
  `middleware.ts` ni configuracion de build, asi que `--rapido` NO se niega por esas rutas; aun
  asi la decision es del leader.
- **Aviso a integradores**: coordinar con la 266 y con la 256/#434 — las tres son del bloque de
  integracion de Dropi y el aviso sale JUNTO, no en tres tandas.
- **`feature_list.json` y `progress/current.md`**: bookkeeping del leader, por instruccion expresa.

## Ronda de revision — BLOQUEANTE arreglado (2026-08-23)

El reviewer bloqueo la feature con un hallazgo mayor **reproducido**, y tenia razon.

### El agujero

`resolverAlcance` comprobaba el canal **solo dentro de la rama de los roles de integracion**. Un
actor que llegase por `canal: "api_key"` con cualquiera de los **cinco roles lectores** caia a la
rama de abajo y su alcance salia del **catalogo**, sin pasar por `esMetricaPublicableApiKey` y sin
recorte a una tienda:

- `rol: "maestro"` + `cod_recaudado` por `api_key` ⇒ `{tipo:"global"}`. Metrica **financiera**,
  **todos los inquilinos**.
- `rol: "adminTienda"` + `sin_gestionar` ⇒ concedido para una metrica **no publicable**.

Incumplia R15/R17/R18/R19/R34, que estan escritos sobre el **canal**, no sobre el rol.

### Por que se nos paso, dicho sin adornos

Es la **simetria exacta** del argumento con el que se justifico el parametro `canal`: «hoy no
existe login por cookie para `apiKey`, pero eso es una CIRCUNSTANCIA externa, no un invariante».
Ese razonamiento valia igual en el otro sentido —hoy `ApiKeyAuthService` construye el actor con el
rol de la fila y nada garantiza que sea `apiKey`— y no se aplico. Se cerro media puerta y se dio
por cerrada entera. Queda escrito en el comentario del propio guardia para que la proxima vez se
compruebe en los dos sentidos.

### El arreglo

`canal === "api_key"` <=> rol de integracion, con las dos ramas **exhaustivas sobre el canal**. La
denegacion va en el punto **unico** de decision y **antes** de mirar la metrica; no en el borde,
que es donde se olvida.

**Los quince casos** (cinco roles lectores x metrica publicable / no publicable / financiera)
deniegan, y el test es **derivado** de `ROLES_ANALITICA`: un sexto rol lector queda cubierto solo.
Con el caso positivo espejo, para que el arreglo no se pueda «cumplir» denegando todo.

**Mordida comprobada:** revertido solo el arreglo, los quince casos se ponen rojos; restaurado.

### Punto 3 — defensa en profundidad: SE HIZO, y por que

`ApiKeyAuthService` construia el actor con `encontrada.rol as RolValue`, un **cast** de la fila.
`IApiKeyRepository` ya prometia por escrito que «el service revalida (defensa en profundidad)»:
la promesa estaba, el codigo no.

Se anade la comprobacion porque la evidencia lo permite: la **unica** alta de una key crea su
usuario dedicado en la misma transaccion y le fija el rol por **lookup** de `"apiKey"`
(`ApiKeyRepository.createConUsuario`, R12/[D1]). No hay camino soportado que produzca una cuenta
de key con otro rol, asi que el riesgo de romper keys existentes es nulo. Si alguien cambiara el
rol despues, seria una **misconfiguracion**, y en una frontera multi-tenant una misconfiguracion
debe **cerrar** el canal, no ampliarlo. Cubre de una vez todas las superficies del canal,
presentes y futuras, en vez de una a una.

### Los cinco menores

| menor | que se hizo |
| --- | --- |
| `tasks.md` sin casillas | T0-T10 marcadas; **T11 abierta a proposito** (gate y PR son del leader) |
| trazabilidad citaba tests inexistentes | corregida a los tests REALES. Una tabla que cita archivos que no existen da por cubierto lo que nadie comprueba |
| faltaba el aserto de dos claves de cache | anadido, con sus cuatro caras (difiere por sujeto, estable consigo mismo, entra el `usuarioId` y no un comodin, y el caso del mismo id con distinto rol) |
| comentario caduco en `entregas-conteo.ts:159` | actualizado, solo prosa |
| `construirServicio` duplicado | aceptado por el reviewer y anotado como deuda, ver abajo |

## Deuda tecnica aceptada

**`construirServicio` esta duplicado** entre `lib/api/analitica-integrador.ts` y
`lib/actions/analitica-operativa.ts`. No es descuido: aquel archivo lleva `"use server"`, que
obliga a que **todo** export suyo sea `async`, asi que su factory no se puede exportar. Extraer un
modulo comun habria cambiado el cableado del canal de sesion, que **R43 exige dejar intacto**.
Anotado tambien en la cabecera del propio archivo. Si se quiere unificar, es ficha aparte.

## Verificacion tras el arreglo

`pnpm typecheck` verde · `pnpm lint` 0 errores ·
`vitest run tests/unit/analytics tests/unit/api tests/unit/services/api-key-auth-service.test.ts`:
**161 archivos / 1917 tests / 0 rojos**.

### Verificacion REAL de esta sesion (2026-08-23, 12:2x)

Corridas medidas, no citadas:

- `pnpm typecheck` -> `tsc --noEmit`, **sin salida: verde**.
- `pnpm lint` -> **99 problems (0 errors, 99 warnings)**; los 99 avisos son `no-unused-vars` de
  `_param` en tests preexistentes, ninguno en los archivos de esta correccion.
- `pnpm exec vitest run tests/unit/analytics tests/unit/api tests/unit/actions tests/unit/services/api-key-auth-service.test.ts`
  -> **218 archivos / 2652 tests / 0 rojos**.
- `pnpm exec vitest run tests/unit/auth/menu-visibility.test.ts tests/unit/types/intentos-no-alcance.test.ts tests/unit/guards`
  -> **72 archivos / 1079 tests / 0 rojos**.
- Los **once** `tests/integration/api/ordenes-api-key-*.route.test.ts` (los que atraviesan
  `ApiKeyAuthService`, por la guarda de rol nueva) -> **11 archivos / 141 tests / 0 rojos**.

**Mordida, con su salida:** desactivada SOLO la linea `if (canal === "api_key") return
denegado("rol_sin_analitica");`, el caso derivado enumera las quince combinaciones y falla; doce
de las quince pasaban a **conceder**: `maestro`/`admin` obtenian `{tipo:"global"}` para las TRES
metricas —incluida la financiera `cod_recaudado`—, `adminSatelite` `{tipo:"zona"}`, `adminTienda`
`{tipo:"tienda"}` y `mensajero` `{tipo:"mensajero"}` para la publicable y la no publicable. Las
tres restantes solo denegaban por casualidad del catalogo (`metrica_prohibida` de `cod_recaudado`
para esos tres roles), no por el canal. Restaurada la linea: 19/19 verdes.

### Nota sobre la «otra sesion» que aparecio en la mordida

El backend_dev que hizo este arreglo aviso de que este archivo se escribio «desde otra sesion» a
las 12:28:27, con conteos que no salian de sus corridas. **Falsa alarma, y comprobada:** esa
escritura fue del propio implementer, redactando y commiteando esta misma seccion (`cb64f0d9`)
mientras el agente aun verificaba. No hay dos sesiones sobre la 267. Los conteos que el agente no
reconocia (161 archivos / 1917 tests) son de la corrida del implementer sobre un subconjunto
distinto de suites; los suyos (218/2652) son de un conjunto mas ancho. Ambos verdes, ninguno
contradice al otro.

Queda anotado porque el aviso era razonable: el agente vio un archivo cambiar bajo sus pies y
PARO a decirlo en vez de sobrescribirlo, que es exactamente lo que debe hacer en un repo con
treinta worktrees vivos.
