# Feature 230 · T6.3 — la app vista de verdad (B2 del review)

> Cierra el **B2** de `progress/review_230.md`. Lo ejecuta el leader el **2026-08-18** sobre el árbol
> ya corregido (tanda 2 del frontend incluida), con `pnpm dev` en local y Playwright conduciendo un
> Chromium real. No hay harness E2E en el repo: esto no lo sustituye, lo suple para esta feature.

## Por qué existía este bloqueante

La 230 cambia el aspecto de **todas** las pantallas de dinero a la vez (consecuencia A3), y el
checkpoint E2E es inaplicable aquí. B1 —el tope de indemnización que anunciaba `₡10.000.000.000`
mientras el validador rechazaba esa cifra— **es un texto de pantalla que 14.000 tests dieron por
bueno**: lo cazó la lectura del reviewer, no la suite. Ese es exactamente el hueco que T6.3 cubre.

## Cómo se midió

- Login real como `admin.qa@ordenex.test` (rol `admin`). La contraseña QA se rotó en la base
  **local** para poder entrar; `QA_PASSWORD` no se versiona a propósito.
- Chromium 1440×900, `networkidle` + 1,5 s de espera para los datos diferidos (SWR).
- **La evidencia es el `innerText`**, no la captura; las capturas quedan al lado sólo como respaldo.
- Detector: `/\d,\d/` — la **coma**, no el punto, y **cualquier** dígito detrás. Con la
  configuración por defecto (`es-CR`) el punto es el separador de **miles**, así que buscar
  `\d.\d` daría falsos positivos con `₡1.234`.
- **Corrección hecha tras el review (n4).** La primera pasada usó `/\d,\d{2}(?!\d)/`, que exige
  **dos** dígitos: más estrecho que R1, que prohíbe *cualquier* dígito tras el separador. `₡1.234,5`
  se le habría escapado —y la rama verbatim (C2) puede emitir justo eso—. La medición se **repitió**
  con la regex de arriba; los números de abajo son los de la segunda pasada.

## Resultado

| Ruta | HTTP | Importes vistos | Con céntimos |
| --- | --- | --- | --- |
| `/wallet` | 200 | 8 | **0** |
| `/wallet/mensajeros` | 200 | 3 | **0** |
| `/cierres-admin` | 200 | 8 | **0** |
| `/ordenes` | 200 | 8 | **0** |
| `/analitica` | 200 | 8 | **0** |
| `/ranking`, `/incidentes`, `/dashboard`, `/monitoreo`, `/ranking/historico` | 200 | 0 | 0 |
| `/cierres-admin/historico` | 404 | — | — |

**488 importes reales en pantalla, cero con decimal de ningún tipo** (medido sobre las 11 rutas
volcadas, con `/\d,\d/`). La tabla de arriba lista 35 porque el guion topaba la muestra en 8 por
ruta: era un tope del muestreo, no el número de importes. Citables:
`₡13.495.820` · `₡13.512.620` · `₡16.801` · `₡13.342.920` · `₡152.900` · `₡12.500` · `₡1.700` · `₡0`.

## El cero está autocomprobado — no es un cero de universo vacío

Un detector roto habría dado cero igual. Sobre el **mismo** `innerText` de `/wallet`:

| Prueba | Resultado |
| --- | --- |
| texto real de las 11 pantallas | **0** hallazgos sobre 488 importes |
| el texto de `/wallet` con los importes en formato viejo (`₡…,50`) | **32** hallazgos |
| `"Total ₡1.234 y ₡12.345.678"` (solo separador de miles) | **0** hallazgos |
| `₡1.234,5` (un solo decimal, el caso que n4 destapó) | **cazado** por la regex nueva; la vieja **no** lo veía |

La segunda fila es la que da valor a la primera: el detector muerde. La tercera descarta el falso
positivo del punto de miles.

## Lo que NO se pudo ver, dicho en voz alta

1. **El mensaje del tope de indemnización no llegó a renderizarse.** Vive en el modal de indemnizar,
   que sólo aparece con un incidente **pendiente de decisión**, y la base local no tiene ninguno
   (`Pendientes de decisión (0)`). Queda cubierto por la **invariante** de
   `IncidentesAdminModule.test.tsx`, que extrae la cifra del propio mensaje y comprueba que el
   validador la acepta — más fuerte que verlo una vez, pero **no es lo mismo que haberlo visto**.
2. **Cinco rutas salieron sin un solo importe** por falta de datos, no por estar correctas. Su cero
   no afirma nada y no se cuenta como evidencia.
3. **`/mi-wallet` y `/recepcion-satelite` quedan fuera de alcance**: `adminTienda` y `adminSatelite`
   piden OTP de 6 dígitos y no se alcanzan con login de email y contraseña.
4. **`/cierres-admin/historico` devuelve 404.** No es de esta feature —la ruta no existe— pero queda
   anotado por si alguien la da por viva.
5. **La tabla del resumen de carga masiva (R13, la fuga corregida) no se vio en pantalla**: sólo
   aparece tras subir un fichero. La cubren su test de componente y el diente 2 de la guardia.

## Veredicto de T6.3

**Hecho, con el alcance declarado arriba.** En las pantallas de dinero con datos, ninguno de los 488
importes muestra decimal alguno, y el cero está autocomprobado con la regex que R1 exige. Los cinco huecos de arriba son lo que esta
medición **no** cubre, y no se presentan como cubiertos.
