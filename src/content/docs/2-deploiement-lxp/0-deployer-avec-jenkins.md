---
title: Déployer le LXP avec Jenkins
description: Déploiement direct ou raccordé au Caddy partagé, avec les secrets fournis par Infisical
---

Le dépôt LXP conserve deux pipelines de déploiement et un pipeline de
construction. Tous récupèrent leurs secrets dans Infisical avec une Machine
Identity, et aucun ne porte plus de fichier d’environnement.

| Mode   | Jenkinsfile                     | Accès public                                                                              |
| ------ | ------------------------------- | ----------------------------------------------------------------------------------------- |
| Direct | `deployment/direct/Jenkinsfile` | Le conteneur `app` publie le port 80 du serveur                                           |
| Caddy  | `deployment/caddy/Jenkinsfile`  | Le conteneur `app` rejoint le réseau externe `caddy` et porte les labels du proxy partagé |

Le mode Caddy ne déploie aucun conteneur Caddy. Le proxy reste dans
`/home/martin/caddy-step-http` et lit les labels Docker.

Les bases de données utilisent le réseau interne de la stack. Le service IA rejoint ce
réseau et un réseau de sortie dédié aux API Mistral et Hugging Face. Aucun de
ces services ne publie de port sur l’hôte.

## Ce que le serveur héberge

Les pipelines pilotent le démon Docker distant par `DOCKER_HOST=ssh://`. Le
serveur ne reçoit ni fichier Compose, ni script SQL, ni fichier d’environnement :
il ne conserve que `data/`, `uploads/` et `logs/` sous le répertoire cible.

C’est la [mécanique B](/1-publication-application/1-gerer-les-secrets/#choisir-le-point-dinjection)
de la norme : l’agent Jenkins lit `/ci` et `/runtime`, puis crée les conteneurs
à distance.

## Préparer l’agent Jenkins

L’agent doit fournir Git, Docker avec le plugin Compose, SSH, rsync et **la CLI
`infisical`**. Son compte système doit pouvoir lancer Docker et ouvrir une
connexion SSH vers le serveur cible.

```sh
infisical --version
```

Sans cette CLI, `deployment/with-infisical.sh` s’arrête immédiatement avec un
message explicite.

Le compte SSH du serveur doit se connecter par clé, exécuter Docker sans `sudo`
et écrire dans le répertoire cible.

Le mode direct réserve le port TCP 80 à `app`. Le mode Caddy demande un proxy
partagé en cours d’exécution et le réseau Docker externe `caddy` :

```sh
docker network inspect caddy
docker ps --filter name=caddy
```

## Créer l’identité et le credential

Créez une Machine Identity Infisical par instance déployée, avec Universal Auth
et la lecture de `/ci` et `/runtime` sur son environnement.

Enregistrez ensuite son Client ID et son Client Secret dans un credential
Jenkins de type **Username with password**, portant toujours le même identifiant :

| ID                      | Type                   | Contenu                    |
| ----------------------- | ---------------------- | -------------------------- |
| `INFISICAL_CREDENTIALS` | Username with password | Client ID et Client Secret |

Créez-le **dans le dossier Jenkins de l'instance**, pas au niveau global. Jenkins
résout un credential en remontant les portées : un job du dossier `demo` trouve
d'abord le credential de ce dossier, un job du dossier `fnp` trouve le sien. Le
même identifiant désigne donc un secret différent selon l'emplacement du job, et
le Jenkinsfile reste identique pour toutes les instances.

Un job placé hors dossier — la construction de l'image, par exemple — utilise le
credential global du même nom, ou surcharge le paramètre
`INFISICAL_CREDENTIAL_ID`.

Ce credential remplace `APP_ENV`, `APP_DOMAIN`, `APP_SSH_HOST`, `SSH_USER`,
`SSH_PORT`, `SSH_TARGET`, `SSH_CREDENTIALS` et `DOCKER_REGISTRY`. Supprimez-les
une fois le premier déploiement validé.

Le job configuré avec **Pipeline script from SCM** utilise aussi le credential
Git qui donne accès au dépôt LXP.

## Renseigner Infisical

Le contrat complet se trouve dans `deployment/env.example`, qui indique pour
chaque bloc s’il relève du pipeline, de `/ci` ou de `/runtime`.

`/ci` porte les identifiants du registre et l’accès SSH :

```dotenv
REGISTRY_USER=
REGISTRY_TOKEN=
DEPLOY_SSH_HOST=
DEPLOY_SSH_USER=
DEPLOY_SSH_PORT=22
DEPLOY_SSH_PRIVATE_KEY=
```

`/runtime` porte la configuration de l’application : secrets de session,
chaînes de connexion, réglages SMTP, clés du fournisseur d’IA, drapeaux du mode
démonstration.

:::danger[Ne versez pas l’ancien `APP_ENV` en bloc]
`LXP_IMAGE`, `LXP_IMAGE_TAG`, `LXP_AI_IMAGE`, `LXP_AI_IMAGE_TAG`,
`LXP_DEPLOYMENT_NAME`, `DEPLOY_PATH`, `APP_HOST` et `DEPLOY_MODE` sont calculés
par le job. Le script leur redonne la priorité au démarrage, mais les laisser
dans le coffre entretient une source de vérité fausse.
:::

## Paramètres des jobs

Les trois Jenkinsfile exposent leurs valeurs non sensibles en paramètres. Un job
paramétré remplace ainsi un job par instance.

| Paramètre                 | Rôle                                                          |
| ------------------------- | ------------------------------------------------------------- |
| `INFISICAL_CREDENTIAL_ID` | `INFISICAL_CREDENTIALS`, sauf job hors dossier                |
| `INFISICAL_PROJECT_ID`    | Project ID du projet LXP                                      |
| `INFISICAL_ENVIRONMENT`   | slug Infisical : `dev`, `pre-prod` ou `prod`                  |
| `INFISICAL_PATH_PREFIX`   | vide, `/demo`, ou `/clients/<slug>` pour une instance cliente |
| `DEPLOY_PATH`             | répertoire persistant sur le serveur cible                    |
| `LXP_DEPLOYMENT_NAME`     | nom stable de la stack, de ses conteneurs et de ses volumes   |
| `APP_HOST`                | domaine sans protocole, mode Caddy uniquement                 |
| `LXP_IMAGE_TAG`           | `latest`, ou un tag précis pour un retour arrière             |
| `LXP_AI_IMAGE_TAG`        | tag de l’image ANDRIA-IA                                      |

:::caution[Point d’attention]
`LXP_DEPLOYMENT_NAME` nomme les volumes. Le modifier sur une instance existante
la ferait repartir de bases vides, les anciens volumes restant orphelins.
:::

## Construire l’image

Créez un premier job avec `build.Jenkinsfile` comme **Script Path**. Il
s’authentifie sur `/ci` seulement, construit le `Dockerfile` de la racine, puis
publie l’image sous le SHA du commit et sous `latest`.

Le dépôt ANDRIA-IA publie `studiostep/lxp-ai`. Attendez la fin de son workflow
avant un déploiement qui modifie le service IA.

## Créer le job de déploiement

Créez un second job de type **Pipeline script from SCM**, puis choisissez un
chemin :

```text
deployment/direct/Jenkinsfile
deployment/caddy/Jenkinsfile
```

Le Jenkinsfile ne porte que la récupération des secrets et le calcul des
métadonnées. La séquence elle-même vit dans `deployment/deploy.sh` :

1. crée `data`, `uploads` et `logs` sous le répertoire cible ;
2. synchronise le contenu initial de `api/uploads` ;
3. récupère les images et démarre PostgreSQL, pgvector et MongoDB ;
4. applique les migrations Prisma et les triggers ANDRIA ;
5. provisionne la base IA, puis démarre `ai` et `app` en attendant leurs
   healthchecks.

Le mode Caddy vérifie le réseau externe `caddy` avant de toucher à la stack.

## Le mode démonstration

Le plan Cloud gratuit d’Infisical n’inclut que trois environnements. La
démonstration est donc un préfixe et non un environnement : elle vit dans
`prod`, sous `/demo`, et le wrapper lit `/demo/ci` et `/demo/runtime`.

`DEMO_MODE` y est une simple clé. Sur `true`, `deploy.sh` écarte la couche IA,
remet la base à zéro, restaure le jeu de démonstration et prépare les deux
comptes empruntés par les visiteurs.

L’instance de démonstration exige `DEMO_ADMIN_EMAIL` et `DEMO_STUDENT_EMAIL`, et
n’exige aucun réglage de la couche IA. Le script adapte sa validation au mode.

## Contrôler le résultat

Le pipeline affiche l’état des services et les cent dernières lignes de journal.
Contrôlez ensuite sur le serveur :

```sh
docker ps --filter name=lxp
docker logs --tail=100 lxp-app
```

Les conteneurs portent le nom de la stack : `lxp-app`, `lxp-ai`, `lxp-db-pg`,
`lxp-db-mongo`, `lxp-db-ai`.

Adaptez le test public au mode choisi :

```sh
curl --fail --head http://<adresse-du-serveur>
curl --fail --head https://lxp.dev.step.eco
```

Pour le mode Caddy, ouvrez `https://dev.step.eco` et contrôlez la carte **LXP**
dans le groupe **Applications**. Une réponse `403` indique que l’adresse du
poste ne figure pas dans `dev_access`. Une réponse `502` demande de contrôler le
healthcheck de `app`, son port et son raccordement au réseau `caddy`.

## Diagnostic

| Symptôme                                           | Contrôle à faire                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `La CLI Infisical n’est pas installée sur l’agent` | installer le paquet `infisical` sur l’agent Jenkins                           |
| `Infisical n’a renvoyé aucun jeton`                | Client ID, Client Secret, et droits de l’identité sur l’environnement visé    |
| `Variables d’environnement manquantes : …`         | comparer les clés de `/runtime` avec `deployment/env.example`                 |
| `Un fichier .env se trouve à la racine du dépôt`   | un `.env` traîne dans le workspace de l’agent ; le supprimer                  |
| `required variable … is missing a value`           | la variable manque dans Infisical et le Compose la déclare `${VAR:?}`         |
| Une image inattendue est déployée                  | une métadonnée `LXP_*` se trouve dans Infisical ; la retirer                  |
| `docker: permission denied`                        | accès au démon Docker pour le compte Jenkins et pour le compte SSH du serveur |

## Revenir à une version précédente

Chaque build publie l’image sous le SHA de son commit. Relancez le job de
déploiement en renseignant `LXP_IMAGE_TAG` avec ce SHA, après avoir contrôlé la
compatibilité des migrations.

## Checklist

- [ ] La CLI `infisical` est installée sur les agents Jenkins.
- [ ] Une Machine Identity existe par instance, avec `/ci` et `/runtime` en
      lecture sur son seul environnement.
- [ ] Chaque dossier Jenkins porte son propre `INFISICAL_CREDENTIALS`.
- [ ] Aucune métadonnée `LXP_*`, `DEPLOY_PATH` ou `APP_HOST` ne figure dans
      Infisical.
- [ ] Les anciens credentials `APP_ENV`, `APP_DOMAIN`, `SSH_*` et
      `DOCKER_REGISTRY` sont supprimés après validation.
- [ ] Le serveur cible ne contient que `data/`, `uploads/` et `logs/`.
- [ ] Un déploiement de démonstration a été contrôlé, sans conteneur `ai`.
