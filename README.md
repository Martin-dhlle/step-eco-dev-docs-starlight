# Documentation du serveur step.eco

Site Astro/Starlight publié sur `https://docs.dev.step.eco`.

## Développement

Installez les dépendances puis démarrez Astro en arrière-plan :

```sh
npm ci
npm run astro -- dev --background
```

Astro fournit les commandes suivantes pour gérer le serveur :

```sh
npm run astro -- dev status
npm run astro -- dev logs
npm run astro -- dev stop
```

Construisez le site avec :

```sh
npm run build
```

Astro écrit le site statique dans `dist/`.

## Déploiement GitHub Actions

Le workflow `.github/workflows/deploy.yml` contrôle le build de chaque pull request vers `main`. Un push sur `main`, ou un lancement manuel depuis `main`, exécute le déploiement suivant :

1. GitHub Actions récupère le commit et contrôle le build Astro.
2. Le runner remplace `/home/martin/step-eco-server-docs` par les fichiers du commit via SCP.
3. Le runner lance Docker Compose par SSH et attend le healthcheck du conteneur.

Le VPS ne clone pas le dépôt. Il n'a besoin ni d'un accès au dépôt privé ni d'une deploy key GitHub.

Créez un environnement GitHub nommé `development`, puis ajoutez ces secrets :

| Secret | Valeur |
| --- | --- |
| `VPS_HOST` | Adresse IP ou nom SSH du VPS |
| `VPS_USERNAME` | `martin` |
| `VPS_SSH_PRIVATE_KEY` | Clé privée dédiée à GitHub Actions |
| `VPS_SSH_PORT` | Port SSH, facultatif si le serveur utilise `22` |

Ajoutez la clé publique associée à `VPS_SSH_PRIVATE_KEY` dans `/home/martin/.ssh/authorized_keys`. Le workflow peut ensuite effectuer le premier déploiement et les mises à jour sans préparation du répertoire applicatif.

Le réseau Docker externe `caddy` doit déjà exister. Le Compose déclare `docs.dev.step.eco`, importe la règle `dev_access` et ajoute le site au tableau de bord Homepage.

Lancez **Build and deploy documentation** depuis l'onglet Actions, ou poussez un commit sur `main`. Le workflow crée `/home/martin/step-eco-server-docs`, construit l'image et démarre le conteneur.

Testez ensuite `https://docs.dev.step.eco` depuis une adresse IP autorisée par `dev_access`.

## Commandes d'exploitation

Exécutez ces commandes dans `/home/martin/step-eco-server-docs` :

```sh
docker compose ps
docker compose logs --tail=100 docs
docker compose restart docs
docker compose down
```

`docker compose down` retire le conteneur et laisse le réseau externe `caddy` intact.
