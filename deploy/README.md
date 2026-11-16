# Deploy stabile di Moonrizon

Frontend su **Cloudflare Pages** (statico, gratis), backend su una **VM** con Docker
(Oracle Always Free, oppure qualsiasi VPS) dietro Caddy con HTTPS automatico.

```
Browser ──► moonrizon.pages.dev  (Cloudflare Pages, build di frontend/)
   │
   └─────► api.tuodominio.it/api (Caddy :443 ──► backend FastAPI :8000 ──► dati su disco)
```

## 1. Server (una volta sola)

1. Crea la VM (Ubuntu 24.04, ARM o x86, almeno 2 GB di RAM e 20 GB di disco) e apri le porte
   **80 e 443** sia nel firewall del provider sia in `iptables`/`ufw` (su Oracle servono
   entrambi: Security List della VCN + `sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT`, idem 443).
2. Installa Docker: `curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER`.
3. Aggiungi un record DNS `A`: `api.tuodominio.it` → IP pubblico della VM
   (senza dominio: `IP-con-trattini.sslip.io`, es. `203-0-113-10.sslip.io`).
4. Clona il repository e prepara la configurazione:
   ```bash
   sudo mkdir -p /opt/moonrizon/{catalog-data,engine-data,engine-cache} && sudo chown -R $USER /opt/moonrizon
   git clone <url-del-repo> ~/moonrizon && cd ~/moonrizon
   cp deploy/.env.prod.example deploy/.env.prod && nano deploy/.env.prod
   ```

## 2. Dati (una volta sola)

Il backend scarica i dati mancanti da NASA al primo uso, ma è lento. Per un portfolio conviene
copiare quelli già calcolati sul tuo Mac (circa 1,5 GB, meglio solo `terrain`, `ephemerides`,
`analysis` e `jobs/scientific` se ti servono i risultati già pronti):

```bash
# dal tuo Mac, nella radice del progetto
rsync -avz --progress data/            utente@IP:/opt/moonrizon/catalog-data/
rsync -avz --progress backend/data/    utente@IP:/opt/moonrizon/engine-data/
rsync -avz --progress backend/cache/   utente@IP:/opt/moonrizon/engine-cache/
```

Se `catalog-data` resta vuoto, sul server: 
`docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod run --rm backend python -m app.cli init-regions`.

## 3. Avvio del backend

```bash
cd ~/moonrizon
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
curl https://api.tuodominio.it/api/health
```

`restart: unless-stopped` lo riavvia dopo un riavvio della VM. Aggiornamenti: `./deploy/update.sh`.

## 4. Frontend su Cloudflare Pages

Opzione A, automatica (GitHub Actions, `.github/workflows/deploy.yml`):

1. Cloudflare → Workers & Pages → crea il progetto `moonrizon` (Direct Upload).
2. Crea un API token con permesso *Cloudflare Pages: Edit* e prendi l'Account ID.
3. Su GitHub → Settings → Secrets and variables → Actions:
   - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - Variables: `CF_PAGES_PROJECT=moonrizon`, `API_BASE_URL=https://api.tuodominio.it/api`
4. Push su `main`: il workflow compila e pubblica.

Opzione B, collegando il repo da Cloudflare: comando di build
`npm ci && npm run build --workspace @meowrizon/frontend`, cartella di output `frontend/dist`,
variabili `VITE_DATA_SOURCE=api` e `VITE_API_BASE_URL=https://api.tuodominio.it/api`.
(`VITE_*` entrano nel bundle in fase di build: cambiarle richiede una nuova build.)

Dominio personalizzato: Pages → Custom domains. Poi aggiungi quell'origine a `CORS_ORIGINS`
in `deploy/.env.prod` e rilancia `up -d`.

## 5. Che resti sempre online

- Oracle Always Free può recuperare le istanze quasi inattive: fai un controllo esterno
  (UptimeRobot, gratis) su `https://api.tuodominio.it/api/health` ogni 5 minuti, e fai
  passare il tuo account a Pay As You Go (resta a costo zero entro i limiti Always Free)
  per evitare il recupero.
- Backup: copia periodicamente `/opt/moonrizon` (`rsync` verso il tuo Mac).
- Le rotte `POST` che avviano analisi sono pubbliche: in Cloudflare, se proxy il dominio API,
  aggiungi una regola di rate limiting su `/api/*`.
