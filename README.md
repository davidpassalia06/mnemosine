# Mnemosyne

App di ripasso con algoritmo SM-2, offline-first, senza backend.  
Gira interamente nel browser — i dati vengono salvati in `localStorage`.

## Struttura

```
mnemosyne/
├── index.html              ← pagina principale
├── manifest.json           ← PWA manifest (nome, icone, colori)
├── sw.js                   ← Service Worker (cache offline)
├── css/
│   └── master.css
├── js/
│   └── script.js
├── icons/
│   ├── icon-192.png        ← icona PWA
│   └── icon-512.png
└── .github/
    └── workflows/
        └── deploy.yml      ← deploy automatico su GitHub Pages
```

---

## PWA — installazione e aggiornamenti offline

L'app funziona come **Progressive Web App**: dopo la prima visita tutti gli asset (HTML, CSS, JS, font, icone CDN) vengono messi in cache e l'app funziona **senza connessione**.

### Installare sul telefono

- **Android (Chrome):** apri il sito → menu ⋮ → *Aggiungi a schermata Home*
- **iPhone (Safari):** apri il sito → condividi → *Aggiungi a schermata Home*

### Come funzionano gli aggiornamenti

Quando fai il push di una nuova versione, il Service Worker si aggiorna in background. La prossima volta che l'utente apre l'app comparirà un **banner verde** in basso:

> 🔄 Nuova versione disponibile — **Aggiorna ora**

Toccando il pulsante la pagina si ricarica con la nuova versione.

---

## Dati utente e aggiornamenti

I dati (mazzi, carte, progressi) sono salvati nel `localStorage` del browser, **non** nel codice. Aggiornare i file del repo **non cancella mai i tuoi dati**.

Per spostare i dati su un altro dispositivo o browser usa il pulsante **Backup JSON** nell'app.
