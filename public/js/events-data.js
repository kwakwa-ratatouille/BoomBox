// Textes des thèmes d'événements (bandeau d'accueil, playlists de saison, titre du récap), repris de la planche
// design/themes-evenements/planche-themes.html (objet EV). « Matis » y est remplacé par le prénom du profil.
export const EVENT_TEXT = {
  "noel": {
    "banner": [
      "Joyeux Noël, Matis !",
      "Tes playlists de saison sont prêtes"
    ],
    "playlists": [
      {
        "name": "Noël au chaud",
        "icon": "mug",
        "desc": "Pop douce et feu de cheminée"
      },
      {
        "name": "Classiques de Noël",
        "icon": "tree",
        "desc": "Les chansons de toujours"
      },
      {
        "name": "Noël rap FR",
        "icon": "mic",
        "desc": "Rap français sous le sapin"
      },
      {
        "name": "Calendrier de l’Avent",
        "icon": "gift",
        "desc": "Un titre de plus chaque jour"
      }
    ],
    "card": {
      "title": "Ton Noël en musique",
      "period": "Du 1er au 26 décembre",
      "enter": "drop",
      "exit": "rise",
      "fill": "#eef3ff"
    }
  },
  "nouvel-an": {
    "banner": [
      "Bonne année, Matis !",
      "Ton récap 2026 et tes playlists de fête t’attendent"
    ],
    "playlists": [
      {
        "name": "Countdown 2027",
        "icon": "clock",
        "desc": "Les derniers titres avant minuit"
      },
      {
        "name": "Réveillon dansant",
        "icon": "disco",
        "desc": "Tubes pour la piste"
      },
      {
        "name": "Ton année 2026",
        "icon": "star",
        "desc": "Tes titres les plus écoutés"
      },
      {
        "name": "Lendemain de fête",
        "icon": "moon",
        "desc": "Doux, très doux"
      }
    ],
    "card": {
      "title": "Ton année 2026",
      "period": "Récap de l’année",
      "enter": "pop",
      "origin": [
        540,
        700
      ],
      "exit": "radial",
      "fillOrigin": [
        540,
        700
      ],
      "fill": "#ffcf4d"
    }
  },
  "valentin": {
    "banner": [
      "Joyeuse Saint-Valentin, Matis !",
      "Tes love songs sont prêtes"
    ],
    "playlists": [
      {
        "name": "Love songs",
        "icon": "heart",
        "desc": "Pour les cœurs qui battent"
      },
      {
        "name": "Cœur brisé",
        "icon": "broken",
        "desc": "Pour les autres"
      },
      {
        "name": "Slow à deux",
        "icon": "notes",
        "desc": "Tempo lent, lumière basse"
      },
      {
        "name": "Lettre d’amour",
        "icon": "letter",
        "desc": "Les textes qui disent tout"
      }
    ],
    "card": {
      "title": "Ta Saint-Valentin",
      "period": "Du 7 au 14 février",
      "enter": "pop",
      "origin": [
        160,
        1632
      ],
      "exit": "radial",
      "fillOrigin": [
        160,
        1632
      ],
      "fill": "#ff6b9a"
    }
  },
  "paques": {
    "banner": [
      "Joyeuses Pâques, Matis !",
      "Pars à la chasse aux sons dans tes playlists de saison"
    ],
    "playlists": [
      {
        "name": "Chasse aux œufs",
        "icon": "egg",
        "desc": "Des pépites à dénicher"
      },
      {
        "name": "Printemps chill",
        "icon": "flower",
        "desc": "Fenêtres ouvertes"
      },
      {
        "name": "Brunch de Pâques",
        "icon": "bunny",
        "desc": "Café, jazz et soleil"
      }
    ],
    "card": {
      "title": "Tes Pâques en sons",
      "period": "Semaine de Pâques",
      "enter": "drop",
      "exit": "rise",
      "fill": "#9be38c"
    }
  },
  "musique": {
    "banner": [
      "Bonne Fête de la musique, Matis !",
      "Monte le son : tes playlists de rue sont prêtes"
    ],
    "playlists": [
      {
        "name": "Fête de la musique",
        "icon": "note",
        "desc": "Le son de la rue ce soir"
      },
      {
        "name": "Live dans la rue",
        "icon": "speaker",
        "desc": "Enregistrements live"
      },
      {
        "name": "Scène ouverte",
        "icon": "mic",
        "desc": "Nouveaux talents"
      },
      {
        "name": "Guitare & soleil",
        "icon": "guitar",
        "desc": "Acoustique"
      }
    ],
    "card": {
      "title": "Ta Fête de la musique",
      "period": "Du 18 au 21 juin",
      "enter": "slide",
      "beat": true,
      "exit": "eq",
      "fill": "#2ef28b"
    }
  },
  "ete": {
    "banner": [
      "Bonnes vacances, Matis !",
      "Tes playlists d’été sont prêtes"
    ],
    "playlists": [
      {
        "name": "Vacances d’été",
        "icon": "palm",
        "desc": "Sable chaud, son léger"
      },
      {
        "name": "Road trip",
        "icon": "car",
        "desc": "Fenêtres baissées"
      },
      {
        "name": "Apéro au soleil",
        "icon": "glass",
        "desc": "En terrasse"
      },
      {
        "name": "Hits de l’été",
        "icon": "sun",
        "desc": "Ceux que tu vas entendre partout"
      }
    ],
    "card": {
      "title": "Ton été en musique",
      "period": "Juillet et août",
      "enter": "slideR",
      "exit": "wave",
      "fill": "#3fd0c9"
    }
  },
  "rentree": {
    "banner": [
      "Bonne rentrée, Matis !",
      "De quoi te motiver le matin"
    ],
    "playlists": [
      {
        "name": "Rentrée motivée",
        "icon": "backpack",
        "desc": "Pour se lever du bon pied"
      },
      {
        "name": "Focus devoirs",
        "icon": "pencil",
        "desc": "Sans paroles, sans distraction"
      },
      {
        "name": "Trajet du matin",
        "icon": "headphones",
        "desc": "Bus, métro, vélo"
      },
      {
        "name": "Café & cours",
        "icon": "mug",
        "desc": "Lo-fi tranquille"
      }
    ],
    "card": {
      "title": "Ta rentrée en sons",
      "period": "Du 1er au 15 septembre",
      "enter": "write",
      "exit": "wipe",
      "fill": "#e9e4d8"
    }
  },
  "halloween": {
    "banner": [
      "Joyeux Halloween, Matis !",
      "Tes playlists qui font peur sont prêtes"
    ],
    "playlists": [
      {
        "name": "Halloween",
        "icon": "pumpkin",
        "desc": "La soirée commence ici"
      },
      {
        "name": "Sons qui font peur",
        "icon": "ghost",
        "desc": "À écouter dans le noir"
      },
      {
        "name": "Bal des monstres",
        "icon": "bat",
        "desc": "Pour danser jusqu’à minuit"
      },
      {
        "name": "Nuit blanche",
        "icon": "moon",
        "desc": "Ambiances et B.O."
      }
    ],
    "card": {
      "title": "Ton Halloween",
      "period": "Du 20 au 31 octobre",
      "enter": "pop",
      "origin": [
        880,
        720
      ],
      "exit": "fog",
      "fill": "#4a3d5e"
    }
  },
  "anniversaire": {
    "banner": [
      "Joyeux anniversaire, Matis !",
      "On t’a préparé un mix rien que pour toi"
    ],
    "playlists": [
      {
        "name": "Joyeux anniversaire",
        "icon": "cake",
        "desc": "Ton mix du jour"
      },
      {
        "name": "Ton année en sons",
        "icon": "star",
        "desc": "Depuis ton dernier anniversaire"
      },
      {
        "name": "Tes sons de toujours",
        "icon": "disc",
        "desc": "Tes classiques perso"
      },
      {
        "name": "Soirée surprise",
        "icon": "balloon",
        "desc": "Pour faire la fête ce soir"
      }
    ],
    "card": {
      "title": "Joyeux anniversaire, Matis",
      "period": "Ton année depuis ton dernier anniversaire",
      "enter": "drop",
      "exit": "radial",
      "fillOrigin": [
        540,
        960
      ],
      "fill": "#ff7ac6"
    }
  },
  "base": {
    "banner": null,
    "playlists": [],
    "card": {
      "title": "Ton récap",
      "period": "Ce mois-ci",
      "enter": "slide",
      "exit": "rise",
      "fill": "#b07cf7"
    }
  }
};
