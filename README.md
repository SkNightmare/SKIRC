# Projet SKIRC

![Status](https://img.shields.io/badge/status-active-brightgreen)
![Build](https://img.shields.io/badge/build-manual-blue)
![Platform](https://img.shields.io/badge/platform-Tauri-orange)

---

## Description

Ce projet est une application basée sur **Tauri** avec une interface web.
Il inclut un système modifiable permettant d’ajouter des plugins et de modifier le comportement de l’application directement depuis les fichiers compilés.
Ce a pour but d'avoir un IRC-CORE CrossPlatforme afin d'avoir 1 code pour tout les platforme.

---



## ⚠️ Problèmes connus

* Les fichiers **APK sont actuellement buggés**
* Le build Android peut échouer selon la configuration
* Certaines fonctionnalités peuvent être instables en version mobile
---
## Prérequis (Modding)

Avant de commencer, assure-toi d’avoir installé :

* **Node.js**
* **npm / npx**
* **Tauri CLI**
* **Android Studio** (pour le build Android)

---

## Modding

Clone le repo :

```bash
git clone https://github.com/SkNightmare/SKIRC.git
cd SKIRC
```

Installe les dépendances :

```bash
npm install
```

---

## Commandes principales

### Mode développement

Lance l'application en mode dev :

```bash
npx run dev
```

---

### Build Desktop (Tauri)

```bash
npx run build
```

---

### Build Android (Tauri)

```bash
tauri android build
```


---

## Plugins & Modifications

Le projet permet des modifications directes après compilation.

### Emplacement des fichiers modifiables :

```
dist/
```

### Contenu important :

* **Interface de l'application**
* **Core IRC**
* Scripts frontend compilés

Tous les fichiers nécessaires pour :

* modifier l’interface
* créer des plugins
* patcher le comportement

sont accessibles dans ce dossier.

---

## Recommandations

* Modifier le code source avant compilation (meilleure stabilité)
* Utiliser `dist/` pour des modifications rapides ou du modding
* Éviter de modifier directement en production sans backup

---

## Structure du projet (simplifiée)

```
/src        → Code source principal
/dist       → Code compilé modifiable
/src-tauri  → Configuration Tauri
```

---

## Contribution

Les contributions sont les bienvenues !

### Pour contribuer :

1. Fork le projet
2. Crée une branche :

   ```bash
   git checkout -b feature/ma-feature
   ```
3. Commit :

   ```bash
   git commit -m "Ajout d'une feature"
   ```
4. Push :

   ```bash
   git push origin feature/ma-feature
   ```
5. Ouvre une Pull Request

---

## Roadmap

* [ ] Fix build APK
* [ ] Stabiliser Android
* [ ] Ajouter système de plugins officiel
* [ ] Documentation avancée

---

## Auteur

Projet développé par Jcc74

## Vue
<img src="https://count.getloli.com/@SKIRC?name=SkNightMare&theme=rule34"> <br/>
