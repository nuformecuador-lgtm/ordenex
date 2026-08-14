# Feature 92 — Credenciales de Google Route Optimization

Route Optimization (`routeoptimization.googleapis.com`) **no acepta API key**: exige
`Authorization: Bearer <access_token>` de una service account. Este documento explica los
**tres modos** de obtener ese token que soporta el código, y cómo configurar el recomendado.

El selector vive en `construirTokenProvider` (`lib/auth/google-sa-token.ts`). Precedencia:

1. `GOOGLE_ROUTE_OPT_USE_ADC=true` → **ADC** (solo desarrollo local).
2. Las tres vars `GOOGLE_WIF_*` presentes → **WIF keyless** (recomendado para producción).
3. Si no → **JWT-bearer** con clave privada de larga vida (fallback).

En los tres modos hace falta el id del proyecto —variable de entorno
**`GOOGLE_CLOUD_PROJECT_ID`**, que la config expone como `GOOGLE_ROUTE_OPT_PROJECT_ID`— porque
lo consume la URL de `optimizeTours`; y la service account debe tener el rol
`roles/routeoptimization.editor` en el proyecto `rapidisimo-app-496106`.

---

## Modo recomendado — WIF keyless en Vercel (producción)

Workload Identity Federation: Vercel emite un token OIDC por invocación, GCP lo canjea en su
STS y **impersona** la service account. **No se almacena ninguna clave privada.**

Guía oficial: <https://vercel.com/docs/oidc/gcp>

### Configuración en GCP (consola, una sola vez)

1. **IAM & Admin → Workload Identity Federation → Create Pool**. Nombre/ID: `vercel`.
2. **Add provider → OpenID Connect (OIDC)**:
   - Provider ID: `vercel`
   - **Issuer URL**: `https://oidc.vercel.com/<TEAM_SLUG>`
   - **Audience**: opción **"Allowed audiences"** con valor `https://vercel.com/<TEAM_SLUG>`
     (así el código NO necesita pasar audiencia custom).
   - **Attribute mapping**: `google.subject = assertion.sub`
3. **IAM & Admin → Service Accounts → Create** (o reutiliza una). Rol:
   `roles/routeoptimization.editor`.
4. **Grant users access to the service account** — concede la impersonación pegando el
   IAM Principal del pool (rol `roles/iam.workloadIdentityUser`):
   ```
   principal://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/vercel/subject/owner:<TEAM_SLUG>:project:<VERCEL_PROJECT>:environment:production
   ```
   (añade un principal por cada entorno de Vercel al que quieras dar acceso).

### Configuración en Vercel

5. **Project Settings → Secure Backend Access / OIDC Federation**: activar.
6. **Environment Variables** (Production), con los nombres que lee el código:
   ```
   GOOGLE_WIF_PROJECT_NUMBER   = <número del proyecto>   # IAM & Admin → Settings
   GOOGLE_WIF_POOL_ID          = vercel
   GOOGLE_WIF_PROVIDER_ID      = vercel
   GOOGLE_ROUTE_OPT_SA_EMAIL   = vercel@rapidisimo-app-496106.iam.gserviceaccount.com
   GOOGLE_CLOUD_PROJECT_ID     = rapidisimo-app-496106
   ```
   NO poner `GOOGLE_ROUTE_OPT_USE_ADC` ni ninguna private key.

   > **Alias aceptados.** El entorno ya desplegado nombra tres de estas piezas de otra
   > forma, y el código lee **ambos** nombres (gana el canónico si están los dos), así que
   > no hace falta renombrar nada en Vercel:
   >
   > | Canónico | Alias ya presente en `.env` |
   > |---|---|
   > | `GOOGLE_WIF_PROJECT_NUMBER` | `GOOGLE_CLOUD_PROJECT_NUMBER` |
   > | `GOOGLE_WIF_POOL_ID` | `GOOGLE_CLOUD_WORKLOAD_IDENTITY_POOL_ID` |
   > | `GOOGLE_WIF_PROVIDER_ID` | `GOOGLE_CLOUD_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` |
   >
   > `GOOGLE_ROUTE_OPT_SA_EMAIL` **no tiene alias**: es la única pieza que hay que añadir
   > para encender WIF. Sin ella el selector cae al modo fallback.

### Verificar

Desplegar a Preview/Production y disparar una optimización. Un `403` suele significar que el
principal del paso 4 no coincide con lo que emite Vercel (revisar `owner:...:project:...:environment:...`),
o que falta el rol `routeoptimization.editor` en la SA.

---

## Modo desarrollo local — ADC

Para probar el flujo real en local sin el token OIDC de Vercel:

```bash
gcloud auth application-default login
gcloud config set project rapidisimo-app-496106
gcloud services enable routeoptimization.googleapis.com   # una vez, requiere billing
```

Para reflejar producción (impersonar la SA), tu cuenta necesita poder impersonarla:

```bash
gcloud iam service-accounts add-iam-policy-binding <SA_EMAIL> \
  --member="user:<tu-correo>" \
  --role="roles/iam.serviceAccountTokenCreator"
```

En `.env.local`:
```
GOOGLE_ROUTE_OPT_USE_ADC=true
GOOGLE_CLOUD_PROJECT_ID=rapidisimo-app-496106
GOOGLE_ROUTE_OPT_SA_EMAIL=<SA_EMAIL>   # omítela para usar tu credencial directa
```
> Alternativa sin impersonar: da `roles/routeoptimization.editor` a tu propia cuenta y
> **no** pongas `GOOGLE_ROUTE_OPT_SA_EMAIL`.

**Cómo disparar el job en local**: el job `optimizacion_ruta` se encola por evento (una
recogida con debounce), no por reloj. Con `pnpm dev`, entra como maestro en `/ordenes`,
registra una recogida con paradas, y drena la cola con el botón temporal "Probar jobs"
(`_TmpProbarJobsButton`, que reutiliza el handler del cron `procesar-jobs`).

---

## Modo fallback — JWT-bearer con clave privada

El más simple de arrancar pero el menos seguro (clave de larga vida en el entorno). Se activa
solo cuando NO hay ADC ni WIF. Requiere las tres piezas por separado:

```
GOOGLE_ROUTE_OPT_SA_EMAIL       = <SA_EMAIL>
GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY = -----BEGIN PRIVATE KEY-----\n...   # los \n van escapados
GOOGLE_CLOUD_PROJECT_ID         = rapidisimo-app-496106
```

> ⚠️ El código **no** lee el JSON completo de la SA (`GOOGLE_SERVICE_ACCOUNT_KEY` /
> `GOOGLE_CLOUD_SERVICE_ACCOUNT_KEY`): hay que partirlo a mano en `client_email` →
> `GOOGLE_ROUTE_OPT_SA_EMAIL` y `private_key` → `GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY`. Además,
> el valor que hoy hay en `.env` es un OAuth *web client* (`{"web":{...}}`), **no** una
> service account: no tiene `client_email` ni `private_key`, así que este modo no arranca
> con él tal cual.
