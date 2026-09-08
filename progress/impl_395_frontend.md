# impl_395 (frontend) — la pantalla del cierre de MENSAJERO dice qué plata es para quién

Sin spec (`sdd: false`). Sin migración. Sin tocar `lib/`, ni rutas de API, ni Server Actions. La
mitad de servidor ya estaba en `dev` (PR #753, ver `progress/impl_395.md`); esto es la pantalla.

## El fallo, dicho como lo vivió quien lo reportó

El detalle enseñaba **«Pago a tienda ₡225.176,33»** y **«Total Ordenex ₡70.946,67»** sueltos, uno
al lado del otro, e invitaba a restarlos. **Esa resta no da**: los dos números no salen de la
misma bolsa —el pago a la tienda no descuenta el flete por rechazo, que se le factura pero nunca
entró en lo recaudado—. El humano se confundió leyendo su propia pantalla, dedujo solo cuál era la
cuenta buena, y lo dijo así: «píntalo de la manera más clara posible, porque si yo me confundo no
quiero imaginar los operarios».

## Lo que hay ahora, y EL ORDEN es la mitad del arreglo

Al abrir el detalle, **antes que nada** —antes del comprobante y antes de la tarjeta «Pago a
tienda»— van tres cascadas. Cada una es una cuenta que CIERRA, y se leen en este orden:

**1. «De quién es el dinero»** (`CASCADA_DUENO_TITULO`, el mismo título que en el cierre de
bodega: es la misma pregunta). La partición, que es la que cualquiera entiende sin que se la
expliquen:

```
Total general                    285.275,00
− Lo que Ordenex facturó          70.946,67
= Gana la tienda                 214.328,33     ← rótulo NUEVO
```

**2. «Lo que Ordenex le factura a la tienda»** — el desglose de esos 70.946,67 y por qué hoy se
le paga otra cifra. Dos cuentas encadenadas, con la misma forma que la cascada «de quién es el
dinero» del cierre de bodega (un resultado destacado a media cascada y la cuenta que sigue
debajo):

```
Cobrado sobre lo recaudado        60.098,67      ← la LÍNEA PUENTE, va SIEMPRE
+ Flete por rechazo + IVA         10.848,00
= Lo que Ordenex facturó          70.946,67

Total general                    285.275,00
− Cobrado sobre lo recaudado      60.098,67
= Pago a tienda                  225.176,33
```

**3. «Lo que le queda a Ordenex»**:

```
Lo que Ordenex facturó            70.946,67
− Pago al mensajero
− Ingreso de bodega por rechazos
= Neto de Ordenex
```

`pagoTienda − fleteRechazoConIva === ganaLaTienda` **no es un descuadre**: son dos preguntas
distintas. La pantalla lo dice con dos notas que son un PAR y se leen juntas —«No es lo que se le
paga hoy» bajo *Gana la tienda*, «No es lo que gana en total» bajo *Pago a tienda*—.

## Lo que NO se tocó, a propósito

- **Ni un rótulo de los que ya existían.** `PAGO_TIENDA_LABEL` sigue diciendo «Pago a tienda» y
  sigue significando `pagoTienda`; su tarjeta y su nota del comprobante siguen donde estaban.
  `INGRESO_BODEGA_RECHAZOS_LABEL` sigue siendo el de esta superficie —en un cierre de MENSAJERO la
  bodega puede ser la CENTRAL, así que el «Gana la bodega satélite» del cierre de bodega sería
  falso aquí, y lo dejó escrito la propia 393—.
- **`ganancia` y `pagoTienda`** siguen viajando y siguen pintándose como antes (la «Liquidación»
  del comprobante sigue enseñando «Debe» cuando la ganancia es negativa).
- **`CascadaDinero` no se modificó.** Se REUSA tal cual, con sus `signo`/`destacado`/`notas`.
- **No se estrenó ninguna forma de pintar dinero.** Los negativos salen con su signo y el
  resultado destacado va en `text-danger-strong`, que es exactamente lo que ya hacían los cierres
  de bodega (393/R11/R36).

## El tiempo verbal del cargo a la wallet — la trampa

El cargo del flete por rechazo se escribe en el saldo de la tienda **al APROBAR** el cierre. En un
cierre `Vencido` —el de la captura del humano— escribir «se le cargó» es MENTIRA.

`fleteRechazoYaCobradoATienda` llega **ya resuelto** del servidor (exige aprobado **y** flete por
rechazo > 0) y NO se infiere aquí. El `estado` sólo distingue «todavía no» de «ya no». Tres frases
y un cuarto caso:

| situación | qué se pinta |
| --- | --- |
| aprobado **y** con flete por rechazo | «Ya se le cargó al saldo de la tienda…» |
| `solicitado` / `vencido` con flete | «Todavía no se le ha cargado al saldo de la tienda…» |
| `rechazado` con flete | «Este cierre se rechazó, así que ese cargo no se le hizo… ni se le va a hacer.» |
| **sin flete por rechazo** (cualquier estado) | **ninguna de las tres**: no hay cargo del que hablar |

## Decisiones de redacción y de forma que tomé yo (`frontend_dev`)

1. **«Gana la tienda»** para `ganaLaTienda`. El encargo lo escribió «La tienda gana»; le di la
   vuelta para que rime con `GANA_BODEGA_SATELITE_LABEL` («Gana la bodega satélite»): mismo verbo,
   misma forma, misma familia. Y **no** reusé `PARA_LA_TIENDA_LABEL` («Para la tienda»), que en el
   cierre de BODEGA nombra `pagoTienda`: darle aquí un segundo significado haría que la misma
   etiqueta valiera dos cifras según por qué pantalla se entre — el defecto que la 393 cerró.
2. **«al saldo de la tienda»**, no «a su wallet». «Saldo a favor» y «Cargos de Ordenex» es lo que
   la tienda lee en su propia pantalla (`mi-wallet-labels`).
3. **Tres cascadas y no una.** Cada bloque es una cuenta que cierra por sí sola; metidas en una
   sola, la partición dejaría de ser lo primero que se lee.
4. **Las cascadas van en el MODAL, encima del comprobante, y no dentro de `cierre-factura.tsx`.**
   Tres motivos: (i) el orden es el arreglo y así la partición es literalmente lo primero;
   (ii) es el mismo sitio en que las monta el cierre de bodega (`CierresBodegaAdminModule`);
   (iii) el DOM del comprobante está congelado por `factura-contraste.guardia` —inventario CERRADO
   de pares de color y conjunto CERRADO de utilidades no cromáticas—, y meter un bloque nuevo ahí
   lo pondría rojo por un cambio que no es de color, que el propio archivo declara que es otra ficha.
5. **`esMontoCero` se MOVIÓ**, no se copió. Vivía privada en `cierre-factura.tsx`; ahora vive junto
   a `esMontoNegativo` en `cierre-detalle-shared.tsx` y la leen las dos superficies.

## Una cosa que dejo ABIERTA, no resuelta

`/cierres-admin` lo alcanzan `maestro`/`admin` **y `adminSatelite`**. La cascada «lo que le queda a
Ordenex» enseña el margen de Ordenex, y en el cierre de BODEGA esa cascada es **sólo del maestro**
(393/R39: «la satélite ve lo suyo y nadie ve un margen que no le toca»). Aquí no la escondo, por
dos razones: el encargo la pide explícitamente y `verCierreDetalle` **ya envía `netoOrdenex` al
navegador del satélite** desde el PR #753 —o sea, la decisión de exponerlo ya está tomada aguas
arriba, y taparla en la pantalla no la revertiría—. Hoy ese rol ya ve «Total Ordenex» y el «Debe»
de la ganancia negativa en este mismo detalle. **Si la respuesta correcta es que el satélite no lo
vea, hay que recortarlo en el SERVIDOR, y eso es otra ficha.**

## Una fixtura ajena que sigue incoherente (no la arreglé)

`tests/components/CierresAdminModule.test.tsx` tiene varias fixturas con `ganaLaTienda: "0.00"`
junto a importes reales; el servidor las dejó así a propósito para no ensanchar el alcance. Con
las cascadas montadas, esas pantallas de test pintan una partición que no cuadra —pero **ninguna
aserción la mira** y el gate sigue verde—. No la toqué: no es mi alcance y arreglarla de tapadillo
sería esconder el aviso. Queda dicho aquí.

## Archivos

**Creados**

- `app/(app)/cierres-admin/_components/CascadasCierreMensajero.tsx` — las tres cascadas. Ni una
  operación aritmética: los cuatro campos llegan derivados del servidor.
- `tests/components/CierreMensajeroDetalleCascadas.test.tsx` — 29 casos. Monta el módulo de
  verdad, abre el detalle y **lee las cadenas del DOM** para comprobar que cada cuenta cierra:
  comparar contra los `Decimal` de origen sería una aserción contra su propia fuente.
- `progress/impl_395_frontend.md` (este archivo).

**Modificados**

- `app/(app)/cierres-admin/_components/cierre-labels.ts` — **sólo se AÑADEN** los doce rótulos y
  notas de la ficha. Ninguna constante existente se tocó.
- `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` — re-exporta los doce por la
  puerta de siempre, y gana `esMontoCero` (movida, no copiada).
- `app/(app)/cierres-admin/_components/cierre-factura.tsx` — **sólo** pierde la copia privada de
  `esMontoCero` y la importa. Ni una clase, ni un renglón, ni un rótulo cambian.
- `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` — guarda los cuatro campos nuevos y
  monta `CascadasCierreMensajero` encima del comprobante.
- `tests/components/DineroIdentidadesEnPantalla.test.tsx` — el censo de pantallas de dinero pasa de
  **15 a 16** con la superficie nueva y su identidad declarada. Es una AMPLIACIÓN de la foto, no una
  relajación: el propio censo dice que una pantalla de dinero nueva «tiene que pasar por aquí».

**No tocados**: `feature_list.json`, `progress/current.md`, `lib/**`, `db/**`, rutas de API,
`CascadaDinero.tsx`.

## Mapa punto del encargo → test

Todos en `tests/components/CierreMensajeroDetalleCascadas.test.tsx` salvo donde se diga.

| punto del encargo | test |
| --- | --- |
| La partición se pinta PRIMERO | `la partición se pinta ANTES que el desglose de lo facturado y que el neto` |
| …y antes que la tarjeta que confundía | `la partición se pinta ANTES que la tarjeta «Pago a tienda» del comprobante` |
| La partición cierra: recaudado − facturado = gana la tienda | `la partición es UNA resta de tres líneas, y cierra con lo que se lee` |
| «Gana la tienda» ≠ «Pago a tienda», y cada una con su nota | `son dos cifras distintas, cada una con la nota que la separa de la otra` |
| La diferencia entre las dos es el flete por rechazo | `la diferencia entre las dos es EXACTAMENTE el flete por rechazo, y se lee en pantalla` |
| Puente + flete por rechazo = lo facturado | `la línea puente más el flete por rechazo dan lo facturado` |
| Recaudado − puente = el pago de hoy | `lo recaudado menos la línea puente da el pago de hoy` |
| La puente va SIEMPRE, también con el flete en cero | `la línea puente sale IGUAL cuando el flete por rechazo es cero: no es condicional` |
| Sin rechazos, gana y se le paga coinciden y siguen siendo dos líneas | `sin rechazos, lo que gana y lo que se le paga coinciden…` |
| Facturado − pago mensajero − ingreso de bodega = neto | `facturado − pago al mensajero − ingreso de bodega da el neto, y cierra` |
| Los negativos con su signo, nunca recortados ni en valor absoluto | `lo que gana la tienda sale negativo…` · `el neto de Ordenex negativo…` |
| El negativo va en el tono que ya usan los cierres de bodega | `el resultado negativo va en el tono de atención que ya usan los cierres de bodega` |
| Un cierre NO aprobado no dice «se le cargó» | `cierre VENCIDO: dice que TODAVÍA no se ha cargado, nunca que ya se cargó` |
| Aprobado con rechazos: ya se cargó | `cierre APROBADO con rechazos: dice que YA se cargó` |
| Rechazado: ni se hizo ni se hará | `cierre RECHAZADO: dice que ese cargo no se hizo ni se va a hacer` |
| Sin flete por rechazo: ninguna de las tres frases | `sin flete por rechazo NO se escribe ninguna de las tres…` · `un cierre APROBADO sin un solo rechazo…` |
| Los rótulos no se confunden (valor escrito A MANO) | `%s dice exactamente lo aprobado` · `los tres estados del cargo dicen tres cosas distintas` |
| Money-safe: cero aritmética de dinero en el navegador | `%s no convierte ni un importe a número` |
| Identidades del dinero en pantalla | `tests/components/DineroIdentidadesEnPantalla.test.tsx` (censo, 16) |

## Gate — `./init.sh` completo

El rápido se niega solo con este diff (nombres de dinero en `app/`), así que se corrió el completo.
`INIT_EXIT` escrito **dentro** del log, sin `tail`.

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ feature_list.json: sin ids duplicados (391 fichas), cupo por zona respetado (in_progress=1) y specs en su sitio
-> pnpm run typecheck
✓ typecheck paso
-> pnpm run lint
✓ lint paso
✓ DATABASE_URL resuelta: los 141 archivos de tests contra Postgres SI se ejecutan
-> pnpm run test:json

 Test Files  1812 passed (1812)
      Tests  25999 passed | 26 skipped (26025)
   Duration  660.01s

✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1812 ejecutado(s), todos en el baseline conocido)
✓ .env presente
== init OK ==
INIT_EXIT=0
```

Los **26 skipped** son los conocidos. El `.env` de la raíz se copió antes del gate (por eso los 141
archivos contra Postgres SÍ se ejecutaron) y se borró antes de commitear.

## Mutaciones — 6 aplicadas, 6 muertas

Arnés con autocomprobación (en el scratchpad, borrado tras usarlo): corrida de **control** verde
antes de medir; el sustituidor **aborta** si el texto no aparece **exactamente una vez** y se
comprueba con `diff` que el archivo cambió de verdad; se exige haber **visto** la línea de
resultados de vitest (sin ella, «no hubo fallo» puede ser «no corrió nada»); y se restaura
copiando el original y comparando con `diff`.

| # | mutación | resultado |
| --- | --- | --- |
| 1 | la partición **desaparece** | **ROJO** — 22 de 29 casos |
| 2 | la partición se pinta **DESPUÉS** del desglose | **ROJO** — «el desglose de lo facturado se pinta antes que la partición…: expected false to be true» |
| 3 | la línea puente **se omite** cuando el flete por rechazo es cero | **ROJO** — `expected [ '-₡24.000,40' ] to deeply equal [ '₡24.000,40', '-₡24.000,40' ]` |
| 4 | un negativo se **recorta** a cero | **ROJO** — `expected '₡0' to be '-₡3.400,75'` (2 casos) |
| 5 | el texto del cargo se escribe **SIEMPRE en pasado** | **ROJO** — 3 casos |
| 6 | `ganaLaTienda` se confunde con `pagoTienda` | **ROJO** — `expected '₡225.176,33' to be '₡214.328,33'`, y la identidad «se lee ₡225.176,33 +₡10.848 = ₡225.176,33, y no da» |

`MUTACIONES_FALLIDAS=0`; tras restaurar, la suite vuelve a 29 passed.

## Visto en la app, con cifras

Servidor propio (`next dev -p 3395`, `.next` del worktree), login `admin.qa@ordenex.test`,
enlace directo `?cierre=<id>`. **Nada se rotó ni se resembró de las cuentas QA.**

**1. Cierre real `bf01f56d…` (Marco, aprobado, sin tarifa congelada).** Leído del DOM:

```
De quién es el dinero:      Total general ₡0 · Lo que Ordenex facturó -₡0 · Gana la tienda ₡0
Lo que le queda a Ordenex:  ₡0 · Pago al mensajero -₡0 · Ingreso de bodega -₡1.000
                            Neto de Ordenex -₡1.000  (+ «…ese neto es una pérdida, no una ganancia»)
```

El neto negativo sale con su signo y explicado. Sin flete por rechazo, **ninguna** de las tres
frases del cargo aparece: correcto, no hay cargo del que hablar.

**2. El caso del humano, reproducido.** Como en la base local ninguna fila congelada traía tarifa
de flete por rechazo, **sembré** en las DOS filas `cierre_detail` de las gestiones `rechazada` del
cierre `70ebf5e2…` un `tarifa_id` y `tarifa_valor_flete_devuelto[_gam]=4000`, `tarifa_iva_flete=13`
(4.000 × 1,13 = 4.520 cada una → **9.040**). Foto previa tomada y **todo restaurado** después
(`tarifa_id` y las cuatro columnas a `NULL`, `estado` de vuelta a `aprobado` con su `updated_at`
original `2026-09-08 05:49:36.92`); verificado con un `SELECT` posterior.

Con el cierre **APROBADO**:

```
Total general ₡124.100 · Lo que Ordenex facturó -₡9.040 · Gana la tienda ₡115.060
Cobrado sobre lo recaudado ₡0 · Flete por rechazo + IVA +₡9.040 · Lo que Ordenex facturó ₡9.040
Total general ₡124.100 · Cobrado sobre lo recaudado -₡0 · Pago a tienda ₡124.100
Lo que Ordenex facturó ₡9.040 · Pago al mensajero -₡10.200 · Ingreso de bodega -₡0
Neto de Ordenex -₡1.160
```

Las tres cuentas dan: `124.100 − 9.040 = 115.060` ✓ · `0 + 9.040 = 9.040` ✓ ·
`124.100 − 0 = 124.100` ✓ · `9.040 − 10.200 − 0 = −1.160` ✓. Y la que el humano tuvo que deducir
solo: `124.100 (Pago a tienda) − 9.040 (flete por rechazo) = 115.060 (Gana la tienda)` ✓.
El flete llevaba **«Ya se le cargó al saldo de la tienda: ese cargo se hace al aprobar el cierre.»**

Con el MISMO cierre puesto en **VENCIDO** (que es el estado de la captura del humano), los
importes no se movieron y la frase cambió a **«Todavía no se le ha cargado al saldo de la tienda:
ese cargo se hace al aprobar el cierre.»** — que es justo la mentira que había que no escribir.

Además, la tarjeta «Pago a tienda» del comprobante sigue igual, con su nota de siempre, y ahora
está DEBAJO de la partición: el primer número que se lee al abrir el detalle ya no es el que
confunde.

## Veredicto

Tres cascadas en el detalle del cierre de mensajero, la partición primero, los rótulos y
`CascadaDinero` reusados sin una sola copia, gate completo en verde (`INIT_EXIT=0`, 26 skipped
conocidos), 6 de 6 mutaciones muertas y las dos cuentas comprobadas en la app con cifras.
