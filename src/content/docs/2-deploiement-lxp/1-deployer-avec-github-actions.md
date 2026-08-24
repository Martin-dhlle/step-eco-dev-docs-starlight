---
title: Déployer le LXP avec GitHub Actions
description: Déploiement de la branche beta sur le VPS de développement, avec des secrets obtenus par OIDC
---

Le workflow `.github/workflows/deploy-dev.yml` du dépôt LXP déploie chaque push
sur `beta`. Il accepte un lancement manuel depuis cette même branche. Les jobs
refusent les autres branches.

Le workflow construit `studiostep/lxp:dev-<sha>`, publie l’image sur Docker Hub,
puis déploie la stack dans `/home/martin/lxp-dev`. Il utilise le tag du commit au
lieu de `latest`, ce qui rend le retour arrière possible.

**Le dépôt ne porte aucun secret.** L’authentification passe par OIDC : GitHub
signe lui-même le jeton d’identité, Infisical le valide, et la clé SSH de
déploiement comme le jeton du registre vivent dans le coffre.

## Préparer le VPS

Le compte `martin` doit se connecter par clé SSH, écrire dans son répertoire et
exécuter Docker sans `sudo`. Le workflow crée les répertoires applicatifs sous :

```text
/home/martin/lxp-dev
├── data/
├── logs/
└── uploads/
```

Rien d’autre. Ni `.env`, ni fichier Compose, ni script SQL : le runner pilote le
démon Docker distant et son propre disque disparaît avec le job. Le workflow
retire d’ailleurs les fichiers laissés par ses versions précédentes.

Le proxy partagé et son réseau doivent exister avant le premier déploiement :

```sh
docker network inspect caddy
docker ps --filter name=caddy
```

Le Compose raccorde `lxp-dev-app` aux réseaux `caddy` et `lxp-dev_backend`. Les
services `ai`, `db-pg`, `db-ai` et `db-mongo` rejoignent le réseau interne
`lxp-dev_backend`. Le service `ai` utilise `lxp-dev_egress` pour appeler Mistral
et Hugging Face. Aucun service LXP ne publie de port sur l’hôte.

## Configurer l’identité Infisical

Créez une Machine Identity `lxp-github-dev` dans le projet LXP, avec la méthode
**OIDC Auth** et la lecture de `/ci` et `/runtime` sur l’environnement `dev`.

| Champ                | Valeur                                                  |
| -------------------- | ------------------------------------------------------- |
| Discovery URL        | `https://token.actions.githubusercontent.com`           |
| Issuer               | `https://token.actions.githubusercontent.com`           |
| Audience (`aud`)     | `https://github.com/StudioFabrique`                     |
| Subject (`sub`)      | `repo:StudioFabrique/lxp:environment:development`       |
| Access Token TTL     | 600 s                                                   |

Le sujet fonctionne parce que les jobs `image` et `deploy` déclarent tous deux
`environment: development`. Le job `verify`, qui tourne sur les pull requests,
n’a pas d’environnement et n’a besoin d’aucun secret.

## Configurer le dépôt GitHub

Créez l’environnement GitHub `development`, puis ajoutez trois **variables** —
et aucun secret :

| Variable                  | Valeur                                       |
| ------------------------- | -------------------------------------------- |
| `INFISICAL_PROJECT_SLUG`  | slug du projet LXP dans Infisical            |
| `INFISICAL_IDENTITY_ID`   | identifiant de la Machine Identity           |
| `APP_HOST`                | `lxp.dev.step.eco`                           |

Ces trois valeurs ne sont pas sensibles.

Supprimez les anciens secrets `APP_ENV`, `REGISTRY_USER`, `REGISTRY_TOKEN`,
`VPS_HOST`, `VPS_USERNAME`, `VPS_SSH_PRIVATE_KEY` et `VPS_SSH_PORT` une fois le
premier déploiement validé. Conservez-les inutilisés le temps de valider : le
retour arrière est alors un `git revert` d’un seul fichier.

:::caution[Permission requise]
Le workflow déclare `id-token: write`. Sans cette permission, GitHub ne signe pas
le jeton d’identité et l’étape Infisical échoue avant toute récupération.
:::

## Renseigner Infisical

L’environnement `dev` du projet LXP porte les deux chemins. Le contrat complet
se trouve dans `deployment/env.example`.

`/ci` :

```dotenv
REGISTRY_USER=
REGISTRY_TOKEN=
VPS_HOST=
VPS_USERNAME=
VPS_SSH_PORT=22
VPS_SSH_PRIVATE_KEY=
```

`/runtime` porte la configuration de l’application : `PORT`, `ENVIRONMENT`,
`FRONT_URL`, les chaînes de connexion, les réglages SMTP, les clés Mistral et
Unsplash.

:::danger[Métadonnées interdites dans le coffre]
`LXP_IMAGE`, `LXP_IMAGE_TAG`, `LXP_AI_IMAGE`, `LXP_AI_IMAGE_TAG`,
`LXP_DEPLOYMENT_NAME`, `DEPLOY_PATH`, `APP_HOST` et `DEPLOY_MODE` sont calculés
par le workflow. Une étape de contrôle fait échouer le job si l’une d’elles
revient d’Infisical — le déploiement partirait sinon sur une autre image que
celle qui vient d’être construite.
:::

## Déroulement du workflow

Le job `verify`, sur les pull requests : lint, types et tests du front et de
l’API.

Le job `image` :

1. récupère `/ci` par OIDC ;
2. construit le Dockerfile de la racine avec Buildx ;
3. publie `studiostep/lxp:dev-<sha>` et met à jour `studiostep/lxp:beta`.

Le job `deploy` :

1. récupère `/ci` puis `/runtime` par OIDC ;
2. contrôle qu’aucune métadonnée du pipeline ne vient du coffre ;
3. lance `deployment/deploy.sh`, partagé avec les pipelines Jenkins.

Le script valide la configuration avant tout appel à Docker, copie le contenu
initial de `api/uploads`, applique les migrations Prisma, installe les triggers
ANDRIA, provisionne la base IA, puis démarre `ai` et `app` en attendant leurs
healthchecks.

Le conteneur `lxp-dev-app` porte les règles d’intégration au VPS : le domaine
pour le proxy Docker Caddy, l’import `dev_access`, les en-têtes transférés, le
réseau d’entrée `caddy`, et les informations de la carte LXP affichée sur
Homepage.

Le préfixe `http://` du label décrit la liaison entre l’entrée du VPS et Caddy.
Les utilisateurs ouvrent l’application sur `https://lxp.dev.step.eco`.

## Contrôler le déploiement

Ouvrez l’exécution **Build and deploy LXP to development** dans l’onglet
**Actions**. Les étapes Infisical doivent réussir avant le déploiement.

Relisez le journal complet du job la première fois, à la recherche d’une valeur
en clair : c’est le seul moyen de confirmer que le masquage fonctionne.

Contrôlez ensuite la stack sur le VPS :

```sh
docker ps --filter name=lxp-dev
docker logs --tail=100 lxp-dev-app
docker logs --tail=100 lxp-dev-ai
```

Les cinq services doivent être démarrés et sains.

Vérifiez enfin qu’aucun résidu ne subsiste :

```sh
ls -la /home/martin/lxp-dev
find /home/martin/lxp-dev -name ".env*"
```

La seconde commande ne doit rien renvoyer.

Testez l’URL depuis une adresse autorisée par `dev_access` :

```sh
curl --fail --head https://lxp.dev.step.eco
```

Ouvrez `https://dev.step.eco` et contrôlez la carte **LXP** dans le groupe
**Applications**. Caddy lit les labels Docker ; vous ne modifiez aucun Caddyfile
pour publier le LXP.

## Revenir à une image précédente

Chaque build conserve un tag `dev-<sha>`. Relancez le job Jenkins de
déploiement en renseignant ce tag, ou déclenchez à nouveau le workflow depuis le
commit voulu. Contrôlez la compatibilité des migrations avant ce changement.

## Diagnostic

| Symptôme                                                  | Contrôle à faire                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| L’étape Infisical échoue sur l’identité                    | `id-token: write`, l’Identity ID, et le sujet OIDC configuré côté coffre |
| `Variables d’environnement manquantes : …`                 | comparer `/runtime` avec `deployment/env.example`                        |
| Le job échoue sur les métadonnées                          | une clé `LXP_*` ou `DEPLOY_PATH` se trouve dans `/ci` ou `/runtime`      |
| `required variable … is missing a value`                   | la variable manque dans Infisical, et le Compose la déclare `${VAR:?}`   |
| `502` sur le domaine public                                | healthcheck de `app`, port, raccordement au réseau `caddy`               |
| `403` sur le domaine public                                | l’adresse du poste ne figure pas dans `dev_access`                       |

## Checklist

- [ ] Le workflow déclare `id-token: write`.
- [ ] L’action `Infisical/secrets-action` est épinglée à un SHA de commit.
- [ ] L’environnement GitHub `development` ne porte que des variables, aucun
      secret.
- [ ] Le sujet OIDC de l’identité borne le dépôt **et** l’environnement.
- [ ] L’identité ne lit que l’environnement `dev`.
- [ ] Aucune métadonnée de pipeline ne figure dans le coffre.
- [ ] Le VPS ne contient que `data/`, `uploads/` et `logs/`.
- [ ] Le journal du premier déploiement a été relu, sans valeur en clair.
