---
title: Suivi de la documentation
description: État de la couverture documentaire du serveur de développement step.eco
---

Ce tableau classe les sujets selon l’état de leur documentation. Une carte passe dans **Documenté** lorsque sa page fournit des instructions utilisables et passe le contrôle de compilation du site.

```mermaid
kanban
  todo[À documenter]
    backups[Sauvegardes et restauration]
    monitoring[Supervision et alertes]
  inProgress[En cours]
    infrastructure[Infrastructure du VPS]
    prerequisites[Prérequis serveur]
    dns[Configuration DNS]
  done[Documenté]
    appDeployment[Publication d'une application sur le VPS]
    secretManagement[Gestion des secrets avec Infisical et Docker Compose]
    lxpJenkins[LXP - déploiement avec Jenkins]
    lxpActions[LXP - déploiement avec GitHub Actions]
```

Mettez ce tableau à jour dans le même changement que la page concernée. Les cartes **En cours** correspondent à des pages présentes mais incomplètes. Les cartes **À documenter** n’ont pas encore de page dédiée.
