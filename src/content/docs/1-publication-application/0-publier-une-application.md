---
title: Publier une application sur le VPS
description: Règles et procédure de déploiement d’une application sur un sous-domaine dev.step.eco
---

Chaque application tourne dans sa propre stack Docker Compose. Caddy détecte les labels Docker, applique la restriction d’accès `dev_access` et transmet les requêtes au conteneur web. Homepage utilise d’autres labels pour ajouter l’application au tableau de bord `https://dev.step.eco`.

Le service public rejoint le réseau Docker partagé `caddy`. Les bases de données, API et workers restent sur un réseau interne à la stack.

La page [Gérer les secrets avec Infisical](/1-publication-application/1-gerer-les-secrets/)
définit la norme de configuration des postes, du VPS et des pipelines. Appliquez-la
avant la première publication.

```text
Internet → accès HTTPS → Caddy → service web
                                  │
                                  └── réseau backend → API / base de données
```

## Informations à préparer

Choisissez les valeurs suivantes avant de créer la stack :

| Élément           | Exemple                        | Règle                                              |
| ----------------- | ------------------------------ | -------------------------------------------------- |
| Identifiant       | `facturation`                  | Minuscules et tirets, sans espace                  |
| Répertoire VPS    | `/home/martin/facturation-dev` | Un répertoire par application                      |
| Nom de la stack   | `facturation-dev`              | Ajoutez le suffixe `-dev`                          |
| Sous-domaine      | `facturation.dev.step.eco`     | Utilisez un nom libre sous `dev.step.eco`          |
| Service public    | `facturation-dev-web`          | Le nom doit être unique sur le VPS                 |
| Port interne      | `3000`                         | Le port écouté par l’application dans le conteneur |
| Source de l’image | registre ou `Dockerfile.dev`   | Préférez une image avec un tag de version          |

Vérifiez le sous-domaine choisi :

```sh
dig +short facturation.dev.step.eco
```

Le DNS générique de `*.dev.step.eco` peut déjà couvrir le sous-domaine. Si la commande ne renvoie pas l’adresse attendue, consultez la page [Configuration du DNS](/0-server-config/2-config-dns/).

## Règles à respecter

### Réseaux et ports

- Déclarez `caddy` comme réseau `external: true`. Le VPS fournit ce réseau.
- Raccordez au réseau `caddy` le seul service qui reçoit du trafic web.
- Placez la base de données et les services privés sur un réseau `backend` avec `internal: true`.
- Utilisez `expose` pour documenter les ports internes. N’utilisez pas `ports` pour publier un port sur l’hôte.
- Référencez le port du conteneur dans `caddy.reverse_proxy`, jamais un port de l’hôte.

### Accès et routage

Le service public doit porter les labels Caddy suivants :

```yaml
labels:
  caddy: "http://${DEV_APP_HOST}"
  caddy.import: "dev_access"
  caddy.reverse_proxy: "facturation-dev-web:3000"
  caddy.reverse_proxy.header_up_0: "X-Forwarded-Proto {http.request.header.X-Forwarded-Proto}"
  caddy.reverse_proxy.header_up_1: "X-Forwarded-For {http.request.header.X-Forwarded-For}"
  caddy_ingress_network: "caddy"
```

Conservez le préfixe `http://` dans le label `caddy`, même si les utilisateurs ouvrent l’application en HTTPS. Cette valeur correspond au raccordement entre le point d’entrée du VPS et Caddy.

Le `caddy.import: "dev_access"` limite l’accès aux adresses IP autorisées dans le Caddyfile central. Toute demande d’ajout ou de retrait d’une adresse IP concerne la configuration Caddy partagée, située dans `/home/martin/caddy-step-http`.

:::caution[Point d’attention]
Ne retirez pas `dev_access`. Une application de développement sans cet import deviendrait accessible hors du réseau autorisé.
:::

### Sécurité et données

- Ajoutez `restart: unless-stopped` et `security_opt: [no-new-privileges:true]` à chaque service.
- Stockez les mots de passe et clés sous `/runtime` dans le projet Infisical de l’application.
- Montez les valeurs sensibles avec les secrets Docker Compose et la convention `*_FILE` quand l’image la prend en charge.
- Donnez un nom fixe aux volumes qui contiennent des données. Le changement du nom de la stack ne créera pas un volume vide par erreur.
- Ajoutez un healthcheck à la base de données et au service web. Faites dépendre les services du healthcheck quand l’ordre de démarrage compte.
- Utilisez des tags d’image immuables pour pouvoir revenir à la version précédente. Évitez `latest` pour un déploiement issu d’un registre.

Le fichier `.deploy.env` fournit les valeurs non sensibles utilisées pour
remplacer `${DEV_APP_HOST}` et les autres paramètres Compose. Le wrapper
Infisical fournit les secrets au même processus sans écrire de fichier `.env`.

## Modèle de fichier Compose

Créez `/home/martin/facturation-dev/compose.dev.yml`, puis adaptez les noms, l’image, le port et le healthcheck :

```yaml
name: facturation-dev

services:
  db:
    image: postgres:17
    container_name: facturation-dev-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:?Set POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER:?Set POSTGRES_USER}
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    secrets:
      - postgres_password
    expose:
      - "5432"
    volumes:
      - database_data:/var/lib/postgresql/data
    networks:
      - backend
    healthcheck:
      test: ["CMD-SHELL", 'pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"']
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s
    stop_grace_period: 30s
    security_opt:
      - no-new-privileges:true

  web:
    image: "${APP_IMAGE:?Set APP_IMAGE}:${APP_IMAGE_TAG:?Set APP_IMAGE_TAG}"
    container_name: facturation-dev-web
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_HOST: db
      DATABASE_NAME: ${POSTGRES_DB:?Set POSTGRES_DB}
      DATABASE_USER: ${POSTGRES_USER:?Set POSTGRES_USER}
      DATABASE_PASSWORD_FILE: /run/secrets/postgres_password
    secrets:
      - postgres_password
    expose:
      - "3000"
    networks:
      - caddy
      - backend
    labels:
      caddy: "http://${DEV_APP_HOST:?Set DEV_APP_HOST}"
      caddy.import: "dev_access"
      caddy.reverse_proxy: "facturation-dev-web:3000"
      caddy.reverse_proxy.header_up_0: "X-Forwarded-Proto {http.request.header.X-Forwarded-Proto}"
      caddy.reverse_proxy.header_up_1: "X-Forwarded-For {http.request.header.X-Forwarded-For}"
      caddy_ingress_network: "caddy"

      homepage.group: "Applications"
      homepage.name: "Facturation"
      homepage.href: "https://${DEV_APP_HOST:?Set DEV_APP_HOST}"
      homepage.description: "Gestion de la facturation"
    healthcheck:
      test:
        ["CMD", "wget", "--quiet", "--spider", "http://127.0.0.1:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    security_opt:
      - no-new-privileges:true

networks:
  caddy:
    external: true
  backend:
    internal: true

volumes:
  database_data:
    name: facturation-dev-postgres

secrets:
  postgres_password:
    environment: POSTGRES_PASSWORD
```

L’image du service `web` doit contenir la commande utilisée par son healthcheck. Remplacez `wget` et `/health` par une commande et une route prises en charge par l’image.

Adaptez les noms `DATABASE_*` au contrat de l’application. Si elle ne lit pas
encore `DATABASE_PASSWORD_FILE`, utilisez l’injection transitoire décrite dans la
page de gestion des secrets, puis ajoutez la lecture du fichier au code.

Une application sans base de données peut supprimer le service `db`, le réseau `backend`, le volume et le bloc `depends_on`.

### Construire l’image sur le VPS

Remplacez `image` par un bloc `build` si le VPS construit l’application depuis un `Dockerfile.dev` présent dans le répertoire :

```yaml
build:
  context: .
  dockerfile: Dockerfile.dev
image: facturation-dev-web:${APP_IMAGE_TAG:-latest}
```

Gardez `image` avec un tag. Docker peut alors identifier la version construite et faciliter un retour arrière.

## Configuration du déploiement

Créez `/home/martin/facturation-dev/.deploy.env` avec les valeurs non sensibles :

```dotenv
DEV_APP_HOST=facturation.dev.step.eco
APP_IMAGE=studiofabrique/facturation
APP_IMAGE_TAG=1.4.2

POSTGRES_DB=facturation
POSTGRES_USER=facturation

INFISICAL_DOMAIN=https://app.infisical.com
INFISICAL_PROJECT_ID='<project-id>'
INFISICAL_ENVIRONMENT=dev
INFISICAL_SECRET_PATH=/runtime
INFISICAL_CREDENTIALS_FILE=/home/martin/.config/infisical/facturation-dev.credentials
```

Ajoutez `POSTGRES_PASSWORD` dans l’environnement `dev`, sous `/runtime`, dans le
projet Infisical. Un administrateur crée ensuite la Machine Identity
`facturation-dev-vps` et son fichier d’amorçage. Installez le wrapper
`deployment/with-infisical` selon la procédure [Configurer le VPS](/1-publication-application/1-gerer-les-secrets/#configurer-le-vps).

Le fichier `.deploy.env` peut rejoindre Git puisqu’il ne contient aucun secret.
Le pipeline peut aussi le générer pour choisir `APP_IMAGE_TAG` à partir du commit.

## Première publication

Exécutez les commandes suivantes depuis le répertoire de l’application :

```sh
cd /home/martin/facturation-dev

docker network inspect caddy
deployment/with-infisical docker compose --env-file .deploy.env -f compose.dev.yml config --quiet
deployment/with-infisical docker compose --env-file .deploy.env -f compose.dev.yml pull
deployment/with-infisical docker compose --env-file .deploy.env -f compose.dev.yml up -d --wait --remove-orphans
```

Pour une construction sur le VPS, remplacez `pull` par :

```sh
deployment/with-infisical docker compose --env-file .deploy.env -f compose.dev.yml build --pull
```

`docker network inspect caddy` doit réussir. Ne créez pas un second réseau portant un autre nom : Caddy et l’application ne pourraient pas communiquer.

## Contrôles après publication

Contrôlez l’état et les journaux :

```sh
deployment/with-infisical docker compose --env-file .deploy.env -f compose.dev.yml ps
deployment/with-infisical docker compose --env-file .deploy.env -f compose.dev.yml logs --tail=100 web
```

Le service public doit afficher l’état `healthy`. Testez ensuite l’URL depuis une adresse IP autorisée :

```sh
curl --fail --head https://facturation.dev.step.eco
```

Ouvrez `https://dev.step.eco` et vérifiez la présence de l’application dans le groupe **Applications**. Caddy et Homepage lisent les labels Docker, aucune modification manuelle de leur fichier Compose n’est requise pour une nouvelle application.

## Mettre à jour une application

### Image publiée dans un registre

Modifiez `APP_IMAGE_TAG` dans `.deploy.env`, puis lancez :

```sh
deployment/with-infisical docker compose --env-file .deploy.env -f compose.dev.yml pull
deployment/with-infisical docker compose --env-file .deploy.env -f compose.dev.yml up -d --wait --remove-orphans
deployment/with-infisical docker compose --env-file .deploy.env -f compose.dev.yml ps
```

### Image construite sur le VPS

Déposez la nouvelle version du code dans le répertoire selon le processus du projet, puis lancez :

```sh
deployment/with-infisical docker compose --env-file .deploy.env -f compose.dev.yml build --pull
deployment/with-infisical docker compose --env-file .deploy.env -f compose.dev.yml up -d --wait --remove-orphans
deployment/with-infisical docker compose --env-file .deploy.env -f compose.dev.yml ps
```

## Revenir à la version précédente

Pour une image de registre, remettez l’ancien `APP_IMAGE_TAG`, puis exécutez `pull` et `up -d`. Contrôlez les migrations de base de données avant le retour arrière : une ancienne version de l’application peut être incompatible avec un schéma récent.

Docker Compose conserve les volumes nommés avec la commande suivante :

```sh
deployment/with-infisical docker compose --env-file .deploy.env -f compose.dev.yml down
```

:::danger
N’utilisez pas `docker compose down -v` sur une stack qui contient des données. L’option `-v` supprime ses volumes nommés.
:::

## Diagnostic rapide

| Symptôme                        | Contrôle à faire                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Erreur `403 Forbidden`          | Vérifier que l’adresse IP du poste figure dans `dev_access`                                                      |
| Erreur `502 Bad Gateway`        | Vérifier le healthcheck, le port de `caddy.reverse_proxy` et la présence du service public sur le réseau `caddy` |
| Redirection vers `dev.step.eco` | Vérifier `DEV_APP_HOST` et les labels Caddy du conteneur                                                         |
| Variable `Set …` manquante      | Contrôler `.deploy.env`, `.env.example`, le chemin `/runtime` et relancer avec le wrapper Infisical              |
| Application absente de Homepage | Vérifier les quatre labels `homepage.*` et l’état du conteneur                                                   |

Les journaux du proxy se consultent depuis sa stack :

```sh
cd /home/martin/caddy-step-http
docker compose logs --tail=100 caddy
```

## Checklist

- [ ] Le répertoire suit la convention `/home/martin/<application>-dev`.
- [ ] Les noms de stack, conteneurs et volumes sont uniques.
- [ ] Le service public utilise `expose`, rejoint `caddy` et porte les labels requis.
- [ ] Les services privés rejoignent le seul réseau `backend` interne.
- [ ] `dev_access`, les en-têtes transférés et `caddy_ingress_network` sont présents.
- [ ] Infisical contient les secrets sous `/runtime` et la Machine Identity du VPS possède la lecture de ce chemin.
- [ ] Le seul fichier secret du VPS contient le credential d’amorçage Infisical et utilise le mode `600`.
- [ ] Les services ont une politique de redémarrage, un healthcheck et `no-new-privileges`.
- [ ] `deployment/with-infisical docker compose config --quiet` réussit.
- [ ] Tous les services attendus sont `healthy` après le démarrage.
- [ ] L’URL répond depuis une IP autorisée et apparaît sur Homepage.
