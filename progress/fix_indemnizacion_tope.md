# fix/indemnizacion-tope-negocio — tope de NEGOCIO del monto de indemnizacion

Rama: `fix/indemnizacion-tope-negocio` (desde `origin/dev` @ `25ff5eee`).
Decision humana del 2026-08-04. Backend puro: no se toca UI, ni componentes, ni paginas.

---

## 1. El defecto, y donde estaba de verdad

No faltaba validacion. `INDEMNIZACION_MONTO_MAX` existia y **los dos emisores lo aplicaban**.
Lo que fallaba es que ese tope es **tecnico**: el mayor valor representable en un
`DECIMAL(12,2)` (`9999999999.99`), puesto para que Postgres no responda `numeric field
overflow`. El propio codigo ya lo decia por escrito («no es un limite de negocio»).

Consecuencia real, ocurrida en produccion el 2026-08-04: una indemnizacion de
₡9.999.999.999,99 registrada por el camino automatico. Paso todas las validaciones porque
cabia en la columna.

**Ahora el tope de negocio es `orden.monto_cobrar`**, y se aplica **ademas** del tecnico.

---

## 2. Que cambio, por emisor

### Emisor 1 — aprobacion del CIERRE (`lib/actions/cierres-admin.ts:91`, 158/T1.14, R22/R26)

| Archivo | Cambio |
|---|---|
| `lib/interfaces/repositories/ICierresAdminRepository.ts` | nuevo tipo `GestionIncidenteDelCierre`; `findGestionesIncidenteDelCierre` pasa de `Promise<string[]>` a `Promise<GestionIncidenteDelCierre[]>` (`{ gestionId, ordenMontoCobrar }`) |
| `lib/repositories/CierresAdminRepository.ts` | el `select` gana `orden: { select: { montoCobrar: true } }` — **misma consulta, mismo WHERE de alcance, ninguna query nueva**; se proyecta con `decimalToString` (STRING escala 2) |
| `lib/services/CierresAdminService.ts` | `validarCoberturaIndemnizaciones` usa un `Map<gestionId, ordenMontoCobrar>` en vez de un `Set` y llama a `excesoIndemnizacion(monto, tope)` por cada entrada que SI pertenece al cierre. El error entra en `fieldErrors[gestionId]`, la clave que la pantalla ya pinta por fila |

El cambio de firma del repo es deliberado: al pasar de `string[]` a objetos, **el typecheck
obliga a todo doble de test a declarar el valor de la orden**. Devolver solo los ids era
exactamente lo que dejaba al servicio sin nada con que acotar el dinero.

### Emisor 2 — aprobacion del INCIDENTE del admin (`lib/actions/incidentes.ts:77`, 158/R52)

**Es el camino que se uso en produccion.**

| Archivo | Cambio |
|---|---|
| `lib/interfaces/repositories/IIncidenteAdminRepository.ts` | `IncidenteAdminRow` gana `ordenMontoCobrar: string \| null` |
| `lib/repositories/IncidenteAdminRepository.ts` | `INCIDENTE_SELECT.orden.select` gana `montoCobrar: true`; `toRow` lo proyecta `toFixed(2)` |
| `lib/services/IncidenteAdminService.ts` | `aprobar` llama a `excesoIndemnizacion(monto, previo.incidente.ordenMontoCobrar)` justo despues de `montoValido` y **antes** de `repo.resolver` → `fieldErrors.monto` |

`ordenMontoCobrar` vive en la FILA DEL REPO y **no** en `IncidenteAdminDTO`: es un dato para
decidir en el servidor, no para pintar. El payload al cliente no cambia.

### La regla, en un solo sitio

`lib/utils/tope-indemnizacion.ts` (nuevo) — `excesoIndemnizacion(monto, ordenMontoCobrar)`
devuelve el **mensaje del tope superado** o `null`. Los dos emisores la consultan; ninguno la
reimplementa.

Se decide en el SERVICE y no en zod porque **el borde no sabe que orden es ni cuanto valia**:
el dato solo existe tras leer la gestion / el incidente. El rechazo ocurre igualmente antes de
abrir la transaccion del dinero, que es la propiedad que importa.

Money-safe intacto: el monto viaja **STRING** de extremo a extremo y se compara con
`Prisma.Decimal`. Ni un `number`, ni un `parseFloat`, en ningun punto nuevo.

---

## 3. Decisiones tomadas (y por que)

### `monto_cobrar` NULL → el tope de negocio NO aplica; queda el tecnico
Decision del leader, escrita en el codigo como decision y no como caso olvidado
(`lib/utils/tope-indemnizacion.ts`, «Decision 1»). Bloquearlo impediria indemnizar un paquete
legitimo cuyo envio ya estaba pagado. El coste queda declarado: sobre esas ordenes la unica
cota sigue siendo la de la columna. Tres tests lo fijan por los tres lados: no bloquea, no es
«sin limite», y el tecnico sigue cayendo.

### `monto_cobrar = 0.00` → **igual que NULL**: no acota
Decision mia, motivada (`lib/utils/tope-indemnizacion.ts`, «Decision 2»):

1. `monto_cobrar` es lo que se cobra AL ENTREGAR (COD). Un `0.00` admite dos lecturas —«envio
   ya pagado» y «nadie lo relleno»— y **la columna no puede distinguirlas**. En la misma tabla
   conviven filas NULL y filas `0.00`: el campo no se usa de forma consistente para significar
   «desconocido», asi que el cero no es una senal fiable de nada.
2. Si el cero se tomara como tope literal, **ninguna indemnizacion seria posible** sobre esas
   ordenes (el monto debe ser `> 0`). Eso es el bloqueo total que el leader ya descarto para el
   NULL, y por el mismo motivo.
3. Queda una regla sola, no dos que se parecen: **el tope de negocio se aplica si y solo si la
   orden declara un valor POSITIVO**. En el codigo es una unica condicion (`v.gt(0) ? v : null`).

Si el negocio quiere algun dia «cero = no se indemniza», hara falta una senal explicita
distinta del monto COD (una bandera de prepago). Queda escrito en el modulo.

### Limite **INCLUSIVO**: `monto == valor de la orden` se ACEPTA
Compensar exactamente lo que valia el paquete es el caso normal de una perdida total; con un
limite exclusivo, la indemnizacion completa seria justo la unica cifra imposible de registrar.
Se rechaza solo el estrictamente mayor. Lo fija un test en cada uno de los tres niveles
(regla, emisor 1, emisor 2), y la mutacion M3 lo demuestra.

### El tope TECNICO no se quita, y se evalua PRIMERO
Es la ultima barrera contra el `numeric field overflow`. **No** se confia en «el de negocio ya
es mas bajo»: hoy lo es porque las dos columnas son `DECIMAL(12,2)`, pero eso es una
coincidencia de precision que un `ALTER TABLE` podria romper en silencio. El mensaje devuelto
dice cual de los dos se supero (dos textos distintos, fijados por test).

### Orden de las guardias existentes: no se pisan
Una gestion AJENA sigue diciendo «no corresponde» (no tiene valor de orden con el que
comparar); un monto que FALTA sigue diciendo «falta el monto»; un monto no positivo sigue
diciendo «obligatorio»; R51 (quien reporta no aprueba) sigue ganando al tope. Cuatro tests.

---

## 4. Censo de produccion — NO verificado por mi

El encargo daba un censo medido (73 ordenes · 2 NULL · 2 en `0.00` · max ₡42.000 · promedio
₡11.091,62 · 1 incidente) y pedia comprobarlo antes de citarlo. **No he podido**: este agente
no tiene el MCP de Supabase en su toolset y el worktree no tiene `.env`, asi que no hay via de
consulta a produccion. **Por tanto no lo cito como medido por mi.**

Lo que si esta verificado y es lo que el diseno necesita: `db/schema.prisma:494` declara
`montoCobrar Decimal? @db.Decimal(12,2)`, es decir, **la columna admite NULL**, y `0.00` es un
valor legal en ella. Las dos decisiones cubren esos dos casos por construccion, no por
frecuencia: no cambiarian aunque las cuentas fueran otras. El leader deberia confirmar el censo
antes de citarlo en el cierre.

---

## 5. Mutaciones ejecutadas — 9 aplicadas, 9 mataron su test

Metodo: aplicar la mutacion sobre el codigo de produccion, correr las suites, `git checkout` para
deshacer. Ninguna mutacion sobrevivio.

### M1 — quitar el tope de negocio SOLO del emisor 1 (cierre)
`lib/services/CierresAdminService.ts`: se elimina la llamada a `excesoIndemnizacion`.

```
 FAIL  tests/unit/guards/tope-indemnizacion-emisores.test.ts > los UNICOS modulos de lib/ que lo aplican son los DOS aprobadores declarados
 FAIL  tests/unit/guards/tope-indemnizacion-emisores.test.ts > cada aprobador declarado EXISTE y de verdad lo aplica (la lista no es decorativa)
 FAIL  tests/unit/services/indemnizacion-tope-negocio-cierre.test.ts > EL CASO DE PRODUCCION: 9999999999.99 sobre una orden de ₡42.000 -> RECHAZADO
 FAIL  tests/unit/services/indemnizacion-tope-negocio-cierre.test.ts > un centimo por encima del valor de la orden -> rechazado, sin tocar el repo
 FAIL  tests/unit/services/indemnizacion-tope-negocio-cierre.test.ts > NULL -> pero NO es «sin limite»: sigue cayendo el tope TECNICO
 FAIL  tests/unit/services/indemnizacion-tope-negocio-cierre.test.ts > dos incidentes, uno pasado de tope: solo ese se marca y NADA se aprueba
 FAIL  tests/unit/services/indemnizacion-tope-negocio-cierre.test.ts > cada gestion se acota contra SU orden, no contra la de otra fila
 Test Files  2 failed | 3 passed (5)
      Tests  7 failed | 50 passed (57)
```
**MATA (7).** Y la suite del emisor 2 queda VERDE: son dos redes distintas, como se pidio.

### M2 — quitar el tope de negocio SOLO del emisor 2 (incidente)
`lib/services/IncidenteAdminService.ts`: se elimina el bloque de `excesoIndemnizacion`.

```
 FAIL  tests/unit/guards/tope-indemnizacion-emisores.test.ts > los UNICOS modulos de lib/ que lo aplican son los DOS aprobadores declarados
 FAIL  tests/unit/guards/tope-indemnizacion-emisores.test.ts > cada aprobador declarado EXISTE y de verdad lo aplica (la lista no es decorativa)
 FAIL  tests/unit/services/indemnizacion-tope-negocio-incidente.test.ts > EL CASO DE PRODUCCION: 9999999999.99 sobre una orden de ₡42.000 -> RECHAZADO
 FAIL  tests/unit/services/indemnizacion-tope-negocio-incidente.test.ts > un centimo por encima del valor de la orden -> rechazado, sin tocar el repo
 FAIL  tests/unit/services/indemnizacion-tope-negocio-incidente.test.ts > NULL -> pero NO es «sin limite»: sigue cayendo el tope TECNICO
 Test Files  2 failed | 3 passed (5)
      Tests  5 failed | 52 passed (57)
```
**MATA (5).** Caen tests **distintos** de los de M1, y la suite del emisor 1 queda verde.
Los dos caminos estan cubiertos por separado; ninguno hereda la cobertura del otro.

### M3 — el limite pasa a EXCLUSIVO (`m.gt(tope)` → `m.gte(tope)`)
```
 FAIL  tests/unit/utils/tope-indemnizacion.test.ts > monto IGUAL al valor de la orden -> se ACEPTA (perdida total del paquete)
 FAIL  tests/unit/utils/tope-indemnizacion.test.ts > la frontera se mide con Decimal, no con float (0.1 + 0.2 no rompe el limite)
 FAIL  tests/unit/services/indemnizacion-tope-negocio-cierre.test.ts > EXACTAMENTE el valor de la orden -> se APRUEBA (el limite es inclusivo)
 FAIL  tests/unit/services/indemnizacion-tope-negocio-incidente.test.ts > EXACTAMENTE el valor de la orden -> se APRUEBA (el limite es inclusivo)
 Test Files  3 failed (3)
      Tests  4 failed | 39 passed (43)
```
**MATA (4), en los tres niveles.** El caracter inclusivo esta FIJADO, no es un accidente.

### M4 — el NULL cae a «sin limite» (se borra la comprobacion del tope tecnico)
```
 FAIL  tests/unit/services/indemnizacion-tope-negocio-cierre.test.ts > NULL -> pero NO es «sin limite»: sigue cayendo el tope TECNICO
 FAIL  tests/unit/services/indemnizacion-tope-negocio-incidente.test.ts > NULL -> pero NO es «sin limite»: sigue cayendo el tope TECNICO
 FAIL  tests/unit/utils/tope-indemnizacion.test.ts > NULL no significa «sin limite»: por encima del maximo de la columna se RECHAZA
 FAIL  tests/unit/utils/tope-indemnizacion.test.ts > pero el tope TECNICO sigue en pie con valor 0
 FAIL  tests/unit/utils/tope-indemnizacion.test.ts > EXACTAMENTE el maximo de la columna se acepta; un centimo mas, no
 FAIL  tests/unit/utils/tope-indemnizacion.test.ts > el de negocio nombra el valor de la orden; el tecnico, el limite de la columna
 FAIL  tests/unit/utils/tope-indemnizacion.test.ts > un `monto_cobrar` ilegible cae al tope tecnico, no bloquea
 Test Files  3 failed | 1 passed (4)
      Tests  7 failed | 43 passed (50)
```
**MATA (7).**

### M5 — el NULL cae a «bloqueado» (`topeNegocio(null)` devuelve `Decimal(0)`)
```
 FAIL  tests/unit/utils/tope-indemnizacion.test.ts > NULL no significa «bloqueado»: un monto normal se ACEPTA
 FAIL  tests/unit/utils/tope-indemnizacion.test.ts > NULL admite EXACTAMENTE el maximo tecnico (limite inclusivo tambien aqui)
 FAIL  tests/unit/utils/tope-indemnizacion.test.ts > EXACTAMENTE el maximo de la columna se acepta; un centimo mas, no
 FAIL  tests/unit/services/indemnizacion-tope-negocio-cierre.test.ts > NULL -> el tope de negocio NO aplica: un monto normal se aprueba
 FAIL  tests/unit/services/indemnizacion-tope-negocio-incidente.test.ts > NULL -> el tope de negocio NO aplica: un monto normal se aprueba
 Test Files  3 failed (3)
      Tests  5 failed | 38 passed (43)
```
**MATA (5).** Con M4 + M5 queda acotado por los dos lados: el NULL no es «sin limite» **ni**
«bloqueado» — cae al tecnico, que es exactamente la decision declarada.

### M6 — el cero se toma como tope literal (`return v` en vez de `v.gt(0) ? v : null`)
```
 FAIL  tests/unit/utils/tope-indemnizacion.test.ts > un valor de orden `0` no bloquea la indemnizacion
 FAIL  tests/unit/utils/tope-indemnizacion.test.ts > un valor de orden `0.00` no bloquea la indemnizacion
 FAIL  tests/unit/utils/tope-indemnizacion.test.ts > un valor de orden `0.0` no bloquea la indemnizacion
 FAIL  tests/unit/services/indemnizacion-tope-negocio-cierre.test.ts > cero se trata como NULL: no bloquea la indemnizacion
 FAIL  tests/unit/services/indemnizacion-tope-negocio-incidente.test.ts > cero se trata como NULL: no bloquea la indemnizacion
 Test Files  3 failed (3)
      Tests  5 failed | 38 passed (43)
```
**MATA (5).**

### M7 — el repositorio del CIERRE deja de LEER `montoCobrar` (el fallo silencioso)
`select: { id: true, orden: {...} }` → `select: { id: true }` (+ acceso defensivo, para que no
reviente por otra via).
```
 FAIL  tests/unit/repositories/tope-negocio-lectura.test.ts > el `select` PIDE `orden.montoCobrar` (sin esto el tope no existiria en produccion)
 Test Files  1 failed | 4 passed (5)
      Tests  1 failed | 56 passed (57)
```
**MATA (1) — y solo 1.** Es el resultado mas importante de toda la tanda: **las dos suites de
servicio y el guard se quedan VERDES**. Con dobles del repo, `ordenMontoCobrar` llega porque el
test se lo pone; nadie ve la consulta. Sin `tope-negocio-lectura.test.ts`, esta mutacion —que en
produccion desactiva el tope de negocio por completo, en silencio— habria pasado el gate entero.
(Leccion «probar el WHERE donde vive», medida aqui otra vez.)

### M8 — el repositorio del INCIDENTE deja de LEER `montoCobrar`
```
 FAIL  tests/unit/repositories/tope-negocio-lectura.test.ts > el `select` PIDE `orden.montoCobrar`
 Test Files  1 failed | 4 passed (5)
      Tests  1 failed | 56 passed (57)
```
**MATA (1).** Mismo patron por el segundo camino.

### M9 — el tope se toma de la fila EQUIVOCADA (`delCierre[0]` en vez de la gestion en curso)
```
 FAIL  tests/unit/services/indemnizacion-tope-negocio-cierre.test.ts > dos incidentes, uno pasado de tope: solo ese se marca y NADA se aprueba
 FAIL  tests/unit/services/indemnizacion-tope-negocio-cierre.test.ts > cada gestion se acota contra SU orden, no contra la de otra fila
 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 26 passed (28)
```
**MATA (2).** Un cierre con varios incidentes acota cada monto contra SU orden.

**Resumen: 9 mutaciones, 9 muertas. Ninguna sobrevivio.**

---

## 6. Archivos

### Nuevos
- `lib/utils/tope-indemnizacion.ts` — la regla + las decisiones declaradas
- `tests/unit/utils/tope-indemnizacion.test.ts` — la regla aislada (23 casos)
- `tests/unit/services/indemnizacion-tope-negocio-cierre.test.ts` — emisor 1
- `tests/unit/services/indemnizacion-tope-negocio-incidente.test.ts` — emisor 2
- `tests/unit/repositories/tope-negocio-lectura.test.ts` — que la consulta LEE el valor
- `tests/unit/guards/tope-indemnizacion-emisores.test.ts` — guard estructural de aplicadores

### Modificados (produccion)
- `lib/interfaces/repositories/ICierresAdminRepository.ts`
- `lib/interfaces/repositories/IIncidenteAdminRepository.ts`
- `lib/repositories/CierresAdminRepository.ts`
- `lib/repositories/IncidenteAdminRepository.ts`
- `lib/services/CierresAdminService.ts`
- `lib/services/IncidenteAdminService.ts`

### Modificados (tests existentes, por el cambio de tipos)
`cierres-admin-indemnizacion` (service y repo), `incidente-admin-service`,
`incidentes-historico-paginado`, `incidentes-pendientes-paginado`,
`incidente-admin-repository`, `cierres-admin-service`, `cierres-admin-pendiente`,
`cierres-admin-historico-paginado`, `cierres-admin-pendientes-paginado`,
`CierresAdminService.aprobar.devolucion`.
En todos, el valor de la orden se pone a `null` («el tope de negocio no aplica»), asi que esas
suites siguen midiendo exactamente lo que median. El tope tiene suites propias.

### NO tocados
UI, componentes, paginas, layouts, migraciones, schema. **No hace falta migracion**: el tope
usa una columna que ya existe. Los dos modulos de UI (`CierresAdminModule.tsx`,
`IncidentesAdminModule.tsx`) ya pintan verbatim el `fieldErrors` del servidor, con las mismas
claves (`gestionId` y `monto`), asi que el mensaje del tope de negocio llega al admin sin
cambiar una linea de frontend.

### Mapeo requisito → test
| Requisito | Test |
|---|---|
| El tope de negocio es el valor de la orden | `tope-indemnizacion.test.ts` §inclusivo · `…-cierre.test.ts` §1 · `…-incidente.test.ts` §1 |
| Se aplica en el emisor 1 (cierre) | `indemnizacion-tope-negocio-cierre.test.ts` (12 casos) |
| Se aplica en el emisor 2 (incidente) | `indemnizacion-tope-negocio-incidente.test.ts` (9 casos) |
| Y en ningun tercer sitio, ni en la UI | `guards/tope-indemnizacion-emisores.test.ts` |
| Limite inclusivo | los tres archivos, caso «EXACTAMENTE el valor de la orden» |
| NULL → tope tecnico (ni sin limite ni bloqueado) | los tres archivos, §DECISION 1 |
| `0.00` → como NULL | los tres archivos, §DECISION 2 |
| El tecnico sigue en pie y el mensaje distingue | `tope-indemnizacion.test.ts` §tecnico y §mensaje |
| La consulta LEE el valor de la orden | `repositories/tope-negocio-lectura.test.ts` |
| Money-safe (STRING + Decimal) | `tope-negocio-lectura.test.ts` §proyecta · `tope-indemnizacion.test.ts` §frontera Decimal |

---

## 7. Verificacion ejecutada

Nota de entorno: el worktree venia sin `node_modules` ni cliente Prisma. Se corrio
`pnpm install --frozen-lockfile` y `prisma generate` (con `DATABASE_URL` ficticia: `generate`
no conecta) antes de poder medir nada. Sin eso, `typecheck` daba ~200 falsos negativos del
tipo «Module '@prisma/client' has no exported member 'Prisma'».

```
$ pnpm run typecheck
> ordenex@0.1.0 typecheck
> tsc --noEmit
                                   ← sin salida: 0 errores
```

```
$ pnpm run lint
✖ 44 problems (0 errors, 44 warnings)
```
0 errores. Los 44 warnings son `no-unused-vars` preexistentes en tests ajenos; **ninguno cae en
un archivo tocado por este fix** (verificado filtrando la salida por los 12 archivos del diff).

```
$ pnpm exec vitest run <los 16 archivos tocados>
 Test Files  16 passed (16)
      Tests  293 passed (293)
```

```
$ pnpm exec vitest run guard
 Test Files  60 passed (60)
      Tests  819 passed (819)
```

**NO se corrio la suite completa ni `./init.sh`** (encargo explicito: los corre el leader).
No se encontro ningun rojo ajeno.

---

## Veredicto

El tope de negocio esta puesto en **los dos** emisores, con las decisiones de NULL y cero
escritas en el codigo como decisiones, y las 9 mutaciones ejecutadas mataron las 9 su test —
incluida la que desactiva el tope en silencio quitando una columna del `select`.
