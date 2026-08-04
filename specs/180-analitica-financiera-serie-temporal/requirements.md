# Feature 180 — analitica financiera: desglose por fecha para las series temporales · requirements (EARS)

> Zona: `backend`. Complejidad: `medium`. `depends_on: 127` (**done**, PR #269).
> Rama: sin crear. Spec escrita sobre `chore/cierre-175-178` (cortada de `dev` @ `e4cf28ad`).
> Estado: **spec sin aprobar**. Las preguntas `Q1..Q6` del final son la puerta humana.

---

## 0. Contexto heredado (no se reabre)

- **La 127 es `done` y mergeada.** Esta feature AMPLIA su DTO; no lo reescribe. Todo lo que la 127
  decidio sobre money-safety (`R20`/`R27`: la resta con signo sale de `derivarBalance`,
  `derivarCaja`, `derivarSaldoTienda` y `derivarCuentaPorPagar`, nunca de un `.sub(` nuevo) sigue
  vigente palabra por palabra.
- **La 132 cerro su Q3 el 2026-08-03 «sin grafica de lineas»** y dirigio expresamente esta ficha
  (`specs/132-analitica-tablero-financiero/requirements.md` Q3 y `design.md` §7.6). Su `design.md`
  §5 deja el hueco declarado: cuando exista el dato, la linea se anade al tablero sin rehacerlo.
- **El dia operativo de la analitica es el dia natural de Costa Rica**, resuelto por
  `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc` (`lib/analytics/ranges.ts`, D6 de la 135).
  Esta feature **no declara otra ventana de dia**.
- **El alcance por rol (122) es frontera de seguridad.** La consulta entra entera como
  `ConsultaAnalitica` (tipo opaco con `unique symbol`) y el guardia
  `tests/unit/analytics/alcance-obligatorio.guardia.test.ts` censa a quien consulte una tabla de
  analitica sin recibirla. El desglose por fecha **no puede abrir una via nueva** a esa tabla.
- **Techo de puntos: 62** (`components/private/analytics/topes.ts:32`), y fuera de produccion el
  paquete **lanza**. El tope de rango es **366 dias** (`RANGO_TOPE_DIAS`,
  `tests/unit/analytics/types.test.ts:96`). 366 puntos diarios superan el techo por 6x: la
  granularidad es una decision obligatoria de esta feature, no del consumidor (ver `design.md` §4 y Q3).

## 1. Hechos verificados en el codigo (no supuestos)

| Hecho | Donde se comprobo |
|---|---|
| `deCaja` y `deTesoreria` publican `grano: "fecha"` con `filas: []` | `lib/services/AnaliticaFinancieraService.ts:212-230, 253-279` |
| `deCuentaDeMensajeros` publica `grano: "fecha"` con `filas: []` | `AnaliticaFinancieraService.ts:377-395` |
| Las metricas de caja son **SEIS**, no cuatro: las 4 de `deCaja` mas `dinero_en_caja` y `ganancia_ordenex` (feature 173) | `AnaliticaFinancieraService.ts:131-149`; `lib/types/analitica-financiera.ts:230-241` |
| `IngresosAnaliticaRepository.sumarPorCategoria` agrupa por `(categoria, tipo)` sobre la ventana ENTERA | `lib/repositories/IngresosAnaliticaRepository.ts:83-99` |
| `CuentasPorPagarAnaliticaRepository` agrega con `fecha_movimiento < hasta` y **sin cota inferior** (saldo al corte) | `lib/repositories/CuentasPorPagarAnaliticaRepository.ts:56-92` |
| Las diez financieras declaran el grano `fecha` en el catalogo | `lib/analytics/metrics.ts:424,439,454,469,495,533,569,603,631,648` |
| `esAcumulado: true` exactamente en las dos cuentas por pagar | `lib/types/analitica-financiera.ts:250-258` |
| `fecha_movimiento` es un `DateTime` (instante), no un `@db.Date`: no hay columna de fecha CR que agrupar | `db/schema.prisma:1103, 1166, 1228` |
| `analytics_daily` **no tiene ninguna columna de dinero** y la 127 tiene prohibido leerla | `db/schema.prisma:1876-1899`; `tests/unit/analytics/financiera-fuente.guardia.test.ts:107-110` |
| El guardia de repositorios congela el numero de metodos publicos en **8** | `tests/unit/analytics/financiera-repositorios.guardia.test.ts:238-242` |
| SQL crudo sobre las CINCO tablas de `TablaDinero` esta permitido si el archivo recibe `ConsultaAnalitica` | `financiera-fuente.guardia.test.ts:112-118`; `alcance-obligatorio.guardia.test.ts:74-124` |
| El adaptador del tablero ya sabe convertir `filas` en serie y en tabla | `app/(app)/analitica/_components/financiero/adaptar.ts:72-113` |

**Consecuencia directa del octavo hecho:** la NOTA de la ficha («comprobar si el rollup diario de
la 123 ya guarda el grano por fecha») queda **respondida y cerrada**: no lo guarda, y leerlo estaria
ademas prohibido. Esto es **producir** el desglose desde los ledgers, no exponerlo.

## 2. Alcance

DENTRO:

1. Publicar filas por cubo temporal en la vista de grano `fecha` de las metricas del **conjunto con
   desglose** (R2), que hoy publican `filas: []`.
2. La decision de granularidad (dia / semana) y su tope, dentro del servidor (R14, R15).
3. Los metodos de repositorio necesarios para agregar por cubo temporal y, en las acumuladas, el
   saldo anterior al rango.
4. Actualizar los guardias de la 127 que congelan superficie (numero de metodos, censo de archivos).

FUERA, con su razon:

- **La grafica de lineas del tablero (frontend)** → ver Q4. La ficha es de zona `backend` y su
  descripcion dice «para que el tablero **pueda** tener grafica de lineas».
- **`conciliacion_cierres`** → no produce importes por cubo (`tipo: "conciliacion"`), asi que no
  tiene vista donde poner filas.
- **Cubos compuestos `fecha x tienda`** → no se crean (R28). Es lo que mantiene la ficha **181**
  (etiquetas de tienda) fuera del camino critico.
- **Cache e invalidacion** → feature **179**. Esta feature no anade ni retira `cacheTag`; el guardia
  R15 de la 128 sigue prohibiendo cachear el dominio financiera y aqui se respeta.
- **Retirar `neto`** → feature **182**, decision humana ya tomada. Estos requisitos estan escritos
  para no dar por hecho que `neto` sobrevive en las metricas de caja (ver R27 y Q5).
- **Persistir un rollup financiero diario** → descartado en `design.md` §8, no es una omision.

---

## 3. Requisitos

### 3.1 Que se publica y en que metricas

**R1.** Para cada metrica del **conjunto con desglose**, el sistema DEBE publicar, en la vista cuyo
grano es `fecha`, una fila por cada cubo temporal del rango consultado.

**R2.** El conjunto con desglose DEBE declararse en **una unica constante exportada**, DEBE ser
subconjunto de `IDS_FINANCIERAS_SERVIDAS` y ninguna otra lista de ids DEBE escribirse a mano en esta
feature.

**R3.** MIENTRAS una metrica financiera NO pertenezca al conjunto con desglose, su DTO DEBE
mantenerse identico al que la 127 publica hoy: mismas vistas, mismos ids de vista, mismas filas y
mismos importes.

**R4.** Toda vista financiera DEBE declarar su granularidad temporal como campo **obligatorio** con
valor `dia`, `semana` o `no_temporal`; el sistema NO DEBE declararlo opcional ni omitirlo en las
vistas que no son temporales.

**R5.** El sistema NO DEBE anadir a la vista por fecha ninguna dimension adicional: cada fila
corresponde a un cubo temporal y a ninguna otra coordenada.

### 3.2 Forma de la serie

**R6.** El sistema DEBE emitir las filas en orden **cronologico ascendente** y sin dos filas con la
misma clave de cubo.

**R7.** El sistema DEBE emitir **exactamente una fila por cubo del rango**, incluidos los cubos en
los que ningun movimiento ocurrio.

**R8.** SI un cubo no tiene movimiento Y la metrica es de flujo (`esAcumulado: false`), ENTONCES el
importe de esa fila DEBE ser cero con escala 2 en todos sus campos.

**R9.** SI un cubo no tiene movimiento Y la metrica es acumulada (`esAcumulado: true`), ENTONCES la
fila DEBE repetir el saldo del cubo inmediatamente anterior, y NO DEBE valer cero.

**R10.** La clave (`cubo`) de cada fila DEBE ser la fecha calendario de Costa Rica en formato
`YYYY-MM-DD` del **primer dia incluido** en ese cubo.

**R11.** El sistema DEBE derivar la frontera de cada cubo exclusivamente de `inicioDelDiaCREnUtc` /
`inicioDelDiaSiguienteCREnUtc`, y NO DEBE construir ninguna otra ventana de dia, offset horario ni
conversion de zona propia.

### 3.3 Fidelidad de las cifras

**R12.** MIENTRAS la metrica sea de flujo, la suma de los importes de todas las filas DEBE ser
exactamente igual al `total` de la vista, campo a campo, comparada como decimal y no como numero de
coma flotante.

**R13.** MIENTRAS la metrica sea acumulada, el importe de la **ultima** fila DEBE ser exactamente
igual al `total` de la vista, campo a campo.

**R14.** MIENTRAS la metrica sea acumulada, el importe de cada fila DEBE ser el saldo **al cierre**
de ese cubo calculado sobre todo el libro anterior a ese instante, sin cota inferior, y NO DEBE ser
el movimiento ocurrido dentro del cubo.

**R15.** CUANDO se anade el desglose por fecha, el `total` publicado por cada metrica DEBE seguir
siendo exactamente el que la 127 publica hoy para la misma consulta.

**R16.** El sistema DEBE hacer toda la aritmetica de importes con decimales exactos y publicar todo
importe como cadena de escala 2; NO DEBE existir ninguna conversion de dinero a `number` en el
servicio ni en los repositorios.

**R17.** El sistema DEBE obtener todo importe con signo llamando a las funciones derivadoras ya
existentes (`derivarBalance`, `derivarCaja`, `derivarCuentaPorPagar`, `derivarSaldoTienda`); NO DEBE
escribir ninguna resta de dinero nueva en el servicio ni en los repositorios.

### 3.4 El techo de puntos

**R18.** SI el rango consultado abarca un numero de dias menor o igual al tope de puntos por serie,
ENTONCES la granularidad DEBE ser `dia`; SI lo supera, ENTONCES la granularidad DEBE ser `semana`
con los cubos alineados al lunes de Costa Rica.

**R19.** Para **todo** rango admisible por el borde (hasta `RANGO_TOPE_DIAS` dias), el numero de
filas de la vista por fecha NO DEBE superar el tope de puntos por serie.

**R20.** El numero que el servidor usa como tope de puntos DEBE ser el mismo que
`MAX_PUNTOS_SERIE`, y esa igualdad DEBE quedar comprobada por un test que lea las dos fuentes.

**R21.** SI el primer cubo de una granularidad `semana` empieza despues del lunes (porque el rango
empieza a mitad de semana), ENTONCES ese cubo DEBE empezar en el primer dia del rango y su clave
DEBE ser ese dia, y NO DEBE incluir movimiento anterior al rango.

### 3.5 Seguridad, capas y determinismo

**R22.** Toda lectura nueva DEBE recibir la `ConsultaAnalitica` preparada por
`prepararConsultaAnalitica`; el sistema NO DEBE construirla, forjarla con una asercion de tipo ni
reconstruir el filtro a mano.

**R23.** El sistema NO DEBE leer ninguna tabla fuera del universo `TablaDinero` (los tres ledgers y
los dos snapshots de cierre), ni con Prisma ni con SQL crudo.

**R24.** Ninguna clave de cubo ni ningun campo nuevo del DTO DEBE contener un identificador de
persona (mensajero o tienda).

**R25.** Los repositorios nuevos o ampliados NO DEBEN contener `try`/`catch` ni devolver ceros por
defecto: un fallo de la base DEBE propagarse tal cual.

**R26.** El resultado DEBE ser funcion pura de la consulta y de los datos: para la misma
`ConsultaAnalitica` y el mismo estado de los ledgers, dos ejecuciones DEBEN producir el mismo DTO,
sin depender del reloj del proceso ni del orden del plan de la base.

### 3.6 Convivencia con las fichas hermanas vivas

**R27.** El sistema DEBE construir el importe de cada fila con **la misma funcion** que construye el
`total` de esa misma vista, de modo que retirar un campo de `ImporteAnalitico` (feature 182) sea un
cambio en un solo lugar y no requiera rehacer el desglose.

**R28.** El sistema NO DEBE introducir cubos compuestos de fecha con tienda ni con ninguna otra
dimension: la superficie que la feature **181** tiene que etiquetar DEBE quedar exactamente como
esta.

**R29.** La decision de granularidad y el troceo del rango en cubos DEBEN vivir en un modulo
**puro** de `lib/analytics/`, reutilizable por la feature **176** sin arrastrar Prisma, HTTP ni
acceso a datos.

**R30.** El sistema NO DEBE anadir, retirar ni modificar ningun `cacheTag` ni ninguna invalidacion:
el guardia que hoy prohibe cachear el dominio financiera DEBE seguir verde.

### 3.7 Verificacion y trazabilidad

**R31.** Los guardias de la 127 que congelan superficie (numero de metodos publicos de repositorio,
censo de archivos de la feature, censo de fuentes permitidas) DEBEN actualizarse para cubrir los
archivos y metodos nuevos y DEBEN quedar verdes.

**R32.** Cada requisito `R1..R32` DEBE tener al menos un test nombrado por el comportamiento que
verifica, y el mapa `R<n> → test` DEBE quedar escrito en `progress/impl_180.md`.

---

## 4. Verificacion

- Tests unitarios de servicio con dobles de repositorio (patron
  `tests/unit/services/_dobles-analitica-financiera.ts`): R1, R3, R6-R15, R17, R26, R27.
- Tests unitarios del modulo puro de cubos temporales: R10, R11, R18, R19, R21, R29.
- Test de guardia que compara el tope del servidor con `MAX_PUNTOS_SERIE`: R20.
- Guardias de censo (texto) para R2, R5, R16, R22-R25, R28, R30, R31.
- Test de **integracion** contra la base de test para la frontera de dia CR (un movimiento a
  `T05:59:59.999Z` y otro a `T06:00:00.000Z` caen en dias distintos) y para el saldo anterior al
  rango: R11, R14.
- Cierre con `./init.sh` completo antes del PR.

---

## 5. Preguntas abiertas (puerta humana)

**Q1 — BLOQUEANTE. ¿Que metricas entran en el conjunto con desglose?** La ficha dice «las cuatro
metricas de caja y la cuenta por pagar de mensajeros», pero en el codigo las metricas de caja son
**seis** desde la 173 (`dinero_en_caja` y `ganancia_ordenex` salen del mismo repositorio y del mismo
material). Ademas, `cod_recaudado` y `cuenta_por_pagar_tienda` **tambien declaran el grano `fecha`**
en el catalogo, aunque hoy publican sus cubos por metodo y por tienda.
Opciones: **(a)** las SIETE que hoy no tienen ningun cubo (las seis de caja + `cuenta_por_pagar_mensajero`);
**(b)** las NUEVE de tipo `vistas`, anadiendo una vista por fecha tambien a `cod_recaudado` y a
`cuenta_por_pagar_tienda`; **(c)** literalmente las cinco que nombra la ficha.
*Recomendacion:* **(a)**. Es donde la afirmacion «no existe serie temporal que dibujar» es
literalmente cierta; (c) dejaria fuera dos metricas de caja identicas a las otras cuatro por pura
inercia del texto de la ficha, y (b) abre una vista NUEVA por metrica (mas ids de vista, mas
`sumableCon` que declarar) que ninguna pantalla ha pedido todavia. Afecta a R2.

**Q2 — no bloqueante. ¿Se marca como parcial el cubo en curso?** Con los presets `dia`, `semana` y
`mes` el `rango.hasta` es el comienzo del dia CR **siguiente**, asi que el ultimo cubo siempre esta
a medias. La analitica operativa si lo marca (`PuntoSerie.parcial` / `corteAt`,
`lib/types/analitica-operativa.ts:84-95`). Opciones: **(a)** no marcarlo; **(b)** marcarlo,
inyectando un reloj en el servicio financiero.
*Recomendacion:* **(a)** en esta feature. Hoy `AnaliticaFinancieraService` no tiene reloj y es
determinista sin el (R26); anadirlo por un marcador de presentacion cambia su constructor y su
superficie de test. El consumidor ya recibe `rango.hastaFecha` en la cabecera y sabe que dia es hoy.
Si el humano prefiere (b), afecta a R26 y anade un campo al DTO.

**Q3 — BLOQUEANTE. ¿Que hace el servidor cuando el rango excede el techo de 62 puntos?** El borde
admite hasta 366 dias y el paquete de graficas **lanza** fuera de produccion por encima de 62
puntos. Opciones: **(a)** el servidor agrega en cubos semanales por encima del umbral y lo declara
en el DTO (R18); **(b)** el servidor devuelve siempre grano diario y el techo es problema del
tablero (que es lo que hace hoy la operativa, y por eso la 131 decidio en su D3 **no pintar** cifra
ni serie en rangos largos); **(c)** el borde rechaza el rango.
*Recomendacion:* **(a)**. El propio comentario de `topes.ts:28-31` justifica el 62 como «53 semanas
(el peor caso legitimo ya agregado en un rango de 366 dias) mas margen»: el numero fue elegido
suponiendo esta agregacion. (b) reproduce en el dominio del dinero el agujero que la 176 existe para
tapar en el operativo; (c) rompe un rango que el borde declara valido. Afecta a R18-R21.

**Q4 — BLOQUEANTE. ¿Esta feature cablea la grafica de lineas en el tablero financiero, o solo
publica el dato?** La ficha es de zona `backend` y su texto dice «para que el tablero **pueda**
tener grafica de lineas»; el hueco esta declarado en `specs/132-.../design.md` §5.
Opciones: **(a)** solo backend, y el cableado va en una ficha nueva (o en la 133, que ya toca los
paneles por rol); **(b)** incluir aqui el panel de lineas, convirtiendo la ficha en `fullstack`.
*Recomendacion:* **(a)**. La zona declarada es `backend`, el paralelismo del arnes se controla por
zona y el tablero es propiedad de una feature `done` con sus propios guardias de censo
(`tests/unit/guards/tablero-financiero.guardia.test.ts`). Afecta a la seccion 2 (Alcance).

**Q5 — BLOQUEANTE. ¿Orden de aterrizaje entre la 180 y la 182?** La 182 retira `neto` de las cuatro
metricas de caja (decision humana del 2026-08-04) y esta feature multiplica por ~62 los sitios donde
ese campo se emite.
Opciones: **(a)** **182 primero**, y la 180 nace publicando solo los campos que sobreviven;
**(b)** 180 primero, con R27 como seguro (todas las filas y el total salen del mismo constructor de
importe, de modo que retirar el campo sigue siendo un cambio de un archivo).
*Recomendacion:* **(a)**. La 182 ya esta decidida y tocar dos veces el mismo DTO cuesta dos puertas
humanas y dos revisiones. Si el humano prefiere (b), R27 lo deja barato pero no gratis: los tests de
invariante de R12/R13 se escribirian sobre dos campos y habria que reducirlos a uno.

**Q6 — no bloqueante. ¿Se acepta SQL crudo acotado dentro de un repositorio de dinero?** Agrupar por
fecha calendario de Costa Rica no se puede expresar con `groupBy` de Prisma: `fecha_movimiento` es
un instante y no existe columna de fecha (y una columna generada no es declarable en el datamodel de
Prisma, ver `design.md` §5.2). Los guardias **permiten** SQL crudo sobre las cinco tablas de dinero
si el archivo recibe `ConsultaAnalitica`, pero la cabecera de `IngresosAnaliticaRepository` dice en
prosa «ni un `$queryRaw`».
Opciones: **(a)** SQL crudo acotado y parametrizado, con las fronteras de dia calculadas en
TypeScript por `fecha-cr.ts` y pasadas como parametros (ver `design.md` §5.1); **(b)** traer las
filas crudas y agrupar en memoria; **(c)** una migracion que anada columna de fecha CR a los tres
ledgers.
*Recomendacion:* **(a)**, actualizando esa prosa en el mismo PR. (b) trae un volumen no acotado de
un libro append-only; (c) no es viable con Prisma y anade una reescritura de tabla a tres tablas de
dinero. Afecta a `design.md` §5 y a R23/R25.

---

## 6. Respuestas de la puerta humana (2026-08-04)

Registradas por el leader. **No se reabren**: quien implemente parte de aquí.

| | Decisión | Efecto |
|---|---|---|
| **Q1** | **(a)** — las **SIETE** métricas que hoy no tienen ningún cubo: las **seis** de caja (incluidas `dinero_en_caja` y `ganancia_ordenex`, que la 173 añadió) más `cuenta_por_pagar_mensajero`. **No** las nueve de tipo `vistas`, **no** las cinco literales de la ficha. | Fija **R2**. `cod_recaudado` y `cuenta_por_pagar_tienda` **no** ganan vista por fecha en esta feature. |
| **Q3** | **(a)** — por encima del umbral el **servidor** agrega en **cubos semanales** y lo declara en el DTO. | Fija **R18–R21**. La granularidad es decisión del servidor, no del consumidor. |
| **Q4** | **(a)** — **solo backend**. El cableado de la gráfica de líneas va en ficha aparte. | Fija la §2 (Alcance). La ficha sigue siendo de zona `backend`. |
| **Q5** | **(a)** — **la 183 aterriza primero** (retirar `neto` de las métricas de caja) y la 180 nace publicando solo los campos que sobreviven. | La 180 **no arranca** hasta que la 183 esté mergeada. **R27** sigue siendo obligatorio de todos modos: un único constructor de importe. |

**Q2** y **Q6 siguen abiertas.** No bloquean el arranque, pero **Q6 hay que responderla antes de T2**
(condiciona `design.md` §5 y **R23/R25**): decide si se acepta `$queryRaw` acotado y parametrizado
dentro de un repositorio de dinero. La recomendación del spec es **(a)**, actualizando en el mismo PR
la prosa de la cabecera de `IngresosAnaliticaRepository` que hoy promete «ni un `$queryRaw`».

### ⚠️ Revisión obligatoria antes de T0: este spec se escribió contra un `dev` sin la 176

La feature **176** (modo agregado de tasas y tiempos en la analítica **operativa**) se mergeó a `dev`
en el **PR #285** *mientras se escribía este spec*. Al spec_author se le pidió alinear la forma del
cubo temporal con «lo que la 176 va a necesitar», tratándola como **hipotética**. Ya no lo es:
`consultarAgregadoOperativo`, sus cubos semanales y su cubo `periodo` **están en el código**.

**Antes de la primera tarea hay que releer `design.md` §4 y §5 contra la 176 real** y declarar si la
forma de cubo coincide. Si no coincide, el módulo se queda con **dos contratos temporales
incompatibles** —justo lo que esta alineación existía para evitar—. Esa comprobación **no se ha hecho**.
