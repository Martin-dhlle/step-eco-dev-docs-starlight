---
title: Déployer le LXP avec GitHub Actions
description: Déploiement de la branche beta sur le VPS de développement avec le Caddy partagé
---

Le workflow `.github/workflows/deploy-dev.yml` du dépôt LXP déploie chaque push
sur `beta`. Il accepte un lancement manuel depuis cette même branche. Les jobs
refusent les autres branches.

Le workflow construit `studiostep/lxp:dev-<sha>`, publie l'image sur Docker Hub,
puis déploie la stack dans `/home/martin/lxp-dev`. Il utilise le tag du commit au
lieu de `latest`. Le service IA garde le tag `studiostep/lxp-ai:latest`.

:::Point d'attention[Pipeline hérité]
Les GitHub Secrets `APP_ENV` et `REGISTRY_TOKEN` décrits sur cette page
correspondent au workflow LXP actuel. Les nouveaux workflows suivent la
[norme Infisical](/1-publication-application/1-gerer-les-secrets/) : OIDC donne
accès à `/ci`, tandis que le VPS charge `/runtime` avec sa Machine Identity.
:::

## Préparer le VPS

Le compte `martin` doit se connecter par clé SSH, écrire dans son répertoire et
exécuter Docker sans `sudo`. Le workflow crée les répertoires applicatifs sous :

```text
/home/martin/lxp-dev
├── .deploy.env
├── .env
├── api/
├── data/
├── deployment/
├── logs/
└── uploads/
```

Le proxy partagé et son réseau doivent exister avant le premier déploiement :

```sh
docker network inspect caddy
docker ps --filter name=caddy
```

Le Compose raccorde `lxp-dev-app` aux réseaux `caddy` et
`lxp-dev_backend`. Les services `ai`, `db-pg`, `db-ai` et `db-mongo` rejoignent
le réseau interne `lxp-dev_backend`. Le service `ai` utilise
`lxp-dev_egress` pour appeler Mistral et Hugging Face. Aucun service LXP ne publie
de port sur l'hôte.

## Configurer l'environnement GitHub actuel

Créez un environnement GitHub nommé `development`, puis ajoutez ces secrets :

| Secret                | Valeur                                                    |
| --------------------- | --------------------------------------------------------- |
| `APP_ENV`             | contenu du fichier applicatif décrit dans la page Jenkins |
| `REGISTRY_USER`       | compte Docker Hub autorisé à publier `studiostep/lxp`     |
| `REGISTRY_TOKEN`      | jeton Docker Hub du compte                                |
| `VPS_HOST`            | adresse IP ou nom SSH du VPS                              |
| `VPS_USERNAME`        | `martin`                                                  |
| `VPS_SSH_PRIVATE_KEY` | clé privée dédiée au déploiement                          |
| `VPS_SSH_PORT`        | port SSH, facultatif si le serveur utilise `22`           |

Ajoutez la clé publique associée à `VPS_SSH_PRIVATE_KEY` dans
`/home/martin/.ssh/authorized_keys`.

Créez la variable d'environnement `DEV_APP_HOST` avec la valeur
`lxp.dev.step.eco`. Le workflow utilise ce domaine par défaut si la variable
n'existe pas.

Le secret `APP_ENV` reprend le modèle de la page
[Déployer le LXP avec Jenkins](/2-deploiement-lxp/0-deployer-avec-jenkins/). Ses
URL publiques doivent correspondre au VPS de développement :

```dotenv
PORT=3000
ENVIRONMENT=production
FRONT_URL=https://lxp.dev.step.eco/
LXP_PUBLIC_BASE=https://lxp.dev.step.eco
```

Le workflow crée `.deploy.env` avec le domaine, le chemin cible, le nom de la
stack et les tags d'image. Gardez ces valeurs hors de `APP_ENV` afin que le
workflow choisisse le tag du commit.

## Déroulement du workflow

Le job `image` :

1. construit le Dockerfile racine avec Buildx ;
2. publie `studiostep/lxp:dev-<sha>` et met à jour `studiostep/lxp:beta`.

Le job `deploy` :

1. valide le Compose avec `APP_ENV` et `.deploy.env` ;
2. copie le Compose, les scripts SQL et le contenu initial de `api/uploads` ;
3. vérifie le réseau `caddy` et récupère les images ;
4. démarre les bases et applique les migrations Prisma ;
5. installe les triggers ANDRIA et provisionne la base IA ;
6. démarre `ai` et `app`, puis attend leurs healthchecks.

Le conteneur `lxp-dev-app` porte ces règles d'intégration au VPS :

- le domaine `http://lxp.dev.step.eco` pour le proxy Docker Caddy ;
- l'import `dev_access`, les en-têtes transférés et le réseau d'entrée `caddy` ;
- les informations de la carte LXP affichée sur Homepage.

Le préfixe `http://` du label décrit la liaison entre l'entrée du VPS et Caddy.
Les utilisateurs ouvrent l'application sur `https://lxp.dev.step.eco`.

## Contrôler le déploiement

Ouvrez l'exécution **Build and deploy LXP to development** dans l'onglet
**Actions**. Les jobs `image` et `deploy` doivent réussir.

Contrôlez ensuite la stack sur le VPS :

```sh
cd /home/martin/lxp-dev

docker compose --env-file .env --env-file .deploy.env \
  -f deployment/caddy/compose.yml ps
docker logs --tail=100 lxp-dev-app
docker logs --tail=100 lxp-dev-ai
```

Les cinq services doivent être démarrés. `app`, `ai` et les bases affichent un
état sain après leurs healthchecks.

Testez l'URL depuis une adresse autorisée par `dev_access` :

```sh
curl --fail --head https://lxp.dev.step.eco
```

Ouvrez `https://dev.step.eco` et contrôlez la carte **LXP** dans le groupe
**Applications**. Caddy lit les labels Docker. Vous ne modifiez aucun Caddyfile
pour publier le LXP.

## Revenir à une image précédente

Chaque build conserve un tag `dev-<sha>`. Modifiez `LXP_IMAGE_TAG` dans
`/home/martin/lxp-dev/.deploy.env`, puis exécutez :

```sh
cd /home/martin/lxp-dev

docker compose --env-file .env --env-file .deploy.env \
  -f deployment/caddy/compose.yml pull app
docker compose --env-file .env --env-file .deploy.env \
  -f deployment/caddy/compose.yml up -d --wait --wait-timeout 240 app
```

Contrôlez la compatibilité des migrations avant ce changement. Le push suivant
sur `beta` remplace `.deploy.env` avec le tag du nouveau commit.
