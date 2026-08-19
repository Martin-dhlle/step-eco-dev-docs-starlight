---
title: Déployer le LXP avec Jenkins
description: Déploiement direct ou raccordé au Caddy partagé depuis les pipelines Jenkins du dépôt LXP
---

Le dépôt LXP conserve deux pipelines Jenkins. Les deux récupèrent les images
Docker, préparent les bases, appliquent les migrations Prisma et installent les
triggers ANDRIA.

| Mode | Jenkinsfile | Accès public |
| --- | --- | --- |
| Direct | `deployment/direct/Jenkinsfile` | Le conteneur `app` publie le port 80 du VPS |
| Caddy | `deployment/caddy/Jenkinsfile` | Le conteneur `app` rejoint le réseau externe `caddy` et porte les labels du proxy partagé |

Le mode Caddy ne déploie aucun conteneur Caddy. Le proxy reste dans
`/home/martin/caddy-step-http` et lit les labels Docker. Le dépôt LXP n'a plus de
Caddyfile ni de Dockerfile Caddy.

Les bases utilisent le réseau interne de la stack. Le service IA rejoint ce
réseau et un réseau de sortie dédié aux API Mistral et Hugging Face. Aucun de
ces services ne publie de port sur l'hôte.

## Préparer Jenkins et le serveur cible

L'agent Jenkins doit fournir Git, Docker avec le plugin Compose, SSH et rsync.
Son compte système doit pouvoir lancer Docker et ouvrir une connexion SSH vers
le serveur cible.

Le compte SSH du serveur doit :

- se connecter par clé et exécuter Docker sans `sudo` ;
- écrire dans `/home/<SSH_USER>/<SSH_TARGET>`.

Le mode direct réserve le port TCP 80 à `app`. Le mode Caddy demande un proxy
partagé en cours d'exécution et le réseau Docker externe `caddy` :

```sh
docker network inspect caddy
docker ps --filter name=caddy
```

## Créer les credentials Jenkins

Les deux pipelines utilisent les IDs suivants :

| ID | Type | Contenu |
| --- | --- | --- |
| `APP_ENV` | Secret file | fichier d'environnement applicatif |
| `APP_SSH_HOST` | Secret text | adresse IP ou nom SSH du serveur |
| `DOCKER_REGISTRY` | Username with password | compte Docker Hub et jeton |
| `SSH_USER` | Secret text | compte Linux du serveur |
| `SSH_PORT` | Secret text | port SSH |
| `SSH_TARGET` | Secret text | répertoire sous `/home/<SSH_USER>` |
| `SSH_CREDENTIALS` | SSH Username with private key | clé privée du compte de déploiement |

Le job configuré avec **Pipeline script from SCM** utilise aussi le credential
Git qui donne accès au dépôt LXP.

Le mode Caddy ajoute ce credential :

| ID | Type | Contenu |
| --- | --- | --- |
| `APP_DOMAIN` | Secret text | domaine sans protocole, par exemple `lxp.dev.step.eco` |

Le Jenkinsfile injecte `APP_DOMAIN` dans la variable Compose `DEV_APP_HOST`.
Supprimez les anciens credentials `OVH_ENDPOINT`, `OVH_APPLICATION_KEY`,
`OVH_APPLICATION_SECRET` et `OVH_CONSUMER_KEY` si aucun autre job ne les
utilise. Le proxy partagé gère la configuration Caddy.

## Préparer `APP_ENV`

Créez un fichier hors du dépôt, ajoutez-le à Jenkins sous l'ID `APP_ENV`, puis
remplacez chaque valeur entre chevrons :

```dotenv
PORT=3000
ENVIRONMENT=production
FRONT_URL=https://lxp.dev.step.eco/
REGISTER_SECRET=<secret-activation>
SECRET=<secret-session>

POSTGRES_USER=lxp
POSTGRES_PASSWORD=<mot-de-passe-postgres>
POSTGRES_DB=lxp
DATABASE_URL=postgresql://lxp:<mot-de-passe-url>@db-pg:5432/lxp

ANDRIA_POSTGRES_USER=andria
ANDRIA_POSTGRES_PASSWORD=<mot-de-passe-postgres-ia>
ANDRIA_POSTGRES_DB=lxp_ai
ANDRIA_AI_DB_URL=postgresql://andria:<mot-de-passe-url-ia>@db-ai:5432/lxp_ai
LXP_DB_URL=postgresql://lxp:<mot-de-passe-url>@db-pg:5432/lxp

MONGO_ADMIN_USERNAME=lxp
MONGO_ADMIN_PASSWORD=<mot-de-passe-mongo>
MONGO_DATABASE=lxp
MONGO_LOCAL_URL=mongodb://lxp:<mot-de-passe-url-mongo>@db-mongo:27017/lxp?authSource=admin

DOCKER_IA_API_BASE_URL=http://ai:8000
DOCKER_IA_AUTH_SECRET=<secret-commun-lxp-ia>
SECRET_KEY=<secret-commun-lxp-ia>
MISTRAL_STUDENT_API_KEY=<cle-mistral-student>
MISTRAL_CONTENT_API_KEY=<cle-mistral-content>
MISTRAL_MODEL=mistral-small-latest
LXP_PUBLIC_BASE=https://lxp.dev.step.eco

EMAIL=contact@example.com
PASSWORD=<mot-de-passe-smtp>
SMTP=smtp.example.com
SMTP_EMAIL=contact@example.com
SMTP_PORT=587
FROM="ANDRIA <contact@example.com>"

UNSPLASH_ACCESS_KEY=<cle-unsplash>
```

Le mode direct utilise des URL en `http://` lorsqu'aucun proxy externe ne gère
TLS. Encodez les caractères réservés des mots de passe dans les URL de connexion
et gardez leur valeur brute dans les variables `*_PASSWORD`.

## Construire les images

Créez un premier job avec `build.Jenkinsfile` comme **Script Path**. Ce job
construit et publie `studiostep/lxp:latest`.

Le dépôt ANDRIA-IA publie `studiostep/lxp-ai:latest`. Attendez la fin de ce
workflow avant un déploiement qui modifie le service IA.

## Créer le job de déploiement

Créez un second job de type **Pipeline script from SCM**, puis choisissez un
chemin :

```text
deployment/direct/Jenkinsfile
deployment/caddy/Jenkinsfile
```

Le pipeline exécute ces opérations :

1. crée `data`, `uploads` et `logs` sous le répertoire cible ;
2. synchronise le contenu initial de `api/uploads` ;
3. récupère les images et démarre PostgreSQL, pgvector et MongoDB ;
4. applique les migrations Prisma et les triggers ANDRIA ;
5. provisionne la base IA, puis démarre `ai` et `app`.

Le mode Caddy vérifie le réseau externe `caddy` avant de toucher à la stack. Le
Compose attend les healthchecks de l'IA et de l'application. Lors du premier
passage depuis l'ancien déploiement, il retire le conteneur Caddy devenu orphelin
et conserve ses volumes.

## Contrôler le résultat

Le pipeline affiche l'état des services. Contrôlez les journaux sur le serveur :

```sh
docker ps --filter name=lxp
```

Le mode direct nomme ses conteneurs `lxp-app-1` et `lxp-ai-1`. Le mode Caddy
utilise `lxp-app` et `lxp-ai`. Utilisez le nom affiché par `docker ps` avec
`docker logs --tail=100 <conteneur>`.

Adaptez le test public au mode choisi :

```sh
curl --fail --head http://<adresse-du-vps>
curl --fail --head https://lxp.dev.step.eco
```

Pour le mode Caddy, ouvrez `https://dev.step.eco` et contrôlez la carte **LXP**
dans le groupe **Applications**. Une réponse `403` indique que l'adresse du
poste ne figure pas dans `dev_access`. Une réponse `502` demande de contrôler le
healthcheck de `app`, son port et son raccordement au réseau `caddy`.
