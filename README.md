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

## Premier déploiement sur le VPS

Le Compose attache le conteneur au réseau Docker externe `caddy`. Les labels déclarent `docs.dev.step.eco`, importent la règle `dev_access` et ajoutent le site au tableau de bord Homepage.

Connectez-vous au VPS avec l'utilisateur `martin`, puis clonez le dépôt :

```sh
cd /home/martin
git clone git@github.com:Martin-dhlle/step-eco-dev-docs-starlight.git step-eco-server-docs
cd step-eco-server-docs
docker network inspect caddy >/dev/null
docker compose up --detach --build --wait --wait-timeout 120
docker compose ps
```

Un dépôt GitHub privé demande une clé de déploiement en lecture sur le VPS. Ajoutez la clé publique dans **Settings > Deploy keys** du dépôt, sans autoriser l'écriture.

Testez le serveur statique depuis son conteneur :

```sh
docker compose exec -T docs wget -qO- http://127.0.0.1:8080/healthz
```

La réponse attendue est `ok`. Testez ensuite `https://docs.dev.step.eco` depuis une adresse IP autorisée par `dev_access`.

## Déploiement GitHub Actions

Le workflow `.github/workflows/deploy.yml` construit chaque pull request vers `main`. Un push sur `main`, ou un lancement manuel, construit le site puis met à jour le clone `/home/martin/step-eco-server-docs` par SSH et recrée le conteneur.

Créez un environnement GitHub nommé `development`, puis ajoutez ces secrets :

| Secret | Valeur |
| --- | --- |
| `VPS_HOST` | Adresse IP ou nom SSH du VPS |
| `VPS_USERNAME` | `martin` |
| `VPS_SSH_PRIVATE_KEY` | Clé privée dédiée à GitHub Actions |
| `VPS_SSH_FINGERPRINT` | Empreinte SHA256 de la clé hôte SSH du VPS |
| `VPS_SSH_PORT` | Port SSH, facultatif si le serveur utilise `22` |

Ajoutez la clé publique associée à `VPS_SSH_PRIVATE_KEY` dans `/home/martin/.ssh/authorized_keys`. Cette clé sert à la connexion GitHub Actions vers le VPS. La clé de déploiement GitHub installée sur le VPS sert au `git fetch`; ce sont deux clés distinctes.

Calculez l'empreinte de la clé hôte depuis une machine qui connaît le VPS :

```sh
ssh-keyscan -p 22 -t ed25519 VOTRE_VPS 2>/dev/null | ssh-keygen -lf -
```

Copiez la valeur qui commence par `SHA256:` dans `VPS_SSH_FINGERPRINT`. Adaptez le port dans la commande si votre serveur SSH n'utilise pas le port 22.

## Commandes d'exploitation

Exécutez ces commandes dans `/home/martin/step-eco-server-docs` :

```sh
docker compose ps
docker compose logs --tail=100 docs
docker compose restart docs
docker compose down
```

`docker compose down` retire le conteneur et laisse le réseau externe `caddy` intact.
