/* GENERATED FILE - do not edit by hand.
   Run `python scripts/build_parks.py` after changing
   assets/parks/stadium_dimensions.xlsx.

   One record per ballpark, keyed by its venue name stripped to letters
   and digits -- which is how the name the MLB feed sends resolves to a
   park without string-matching punctuation it may or may not include.

     fence       wall distance at -45, -22.5, 0, +22.5, +45 degrees,
                 0 being the center-field line and + toward first base.
                 `est` marks a distance not posted on the wall.
     wallHeight  fence height at the two lines and at center, in feet
     fairArea    fair territory in sq ft, as listed. NOT derived from
                 `fence` -- it is the independent number the built
                 geometry is checked against.
     foulArea    foul territory in sq ft; the side walls are placed to
                 enclose it (see replay/field/park.js)
     backstop    home plate to the backstop, in feet
     azimuth     compass bearing to center field, degrees clockwise
                 from north -- this is what aims the sun
     decks       seating rows in the 1st, 2nd and upper decks; a deck
                 built in two tiers has two entries
*/

export const PARKS = {
  "americanfamilyfield": {
    "azimuth": 135.0,
    "backstop": 56.0,
    "bearing": "SE",
    "capacity": 41900,
    "decks": [
      [
        27
      ],
      [
        21,
        7
      ],
      [
        20
      ]
    ],
    "fairArea": 111200,
    "fence": [
      {
        "distance": 344.0,
        "theta": -45.0
      },
      {
        "distance": 370.0,
        "theta": -22.5
      },
      {
        "distance": 400.0,
        "theta": 0.0
      },
      {
        "distance": 374.0,
        "theta": 22.5
      },
      {
        "distance": 345.0,
        "theta": 45.0
      }
    ],
    "foulArea": 21100,
    "key": "americanfamilyfield",
    "name": "American Family Field",
    "retired": false,
    "team": "MIL",
    "wallHeight": {
      "center": 8.0,
      "left": 8.0,
      "right": 8.0
    }
  },
  "angelstadium": {
    "azimuth": 45.0,
    "backstop": 59.0,
    "bearing": "NE",
    "capacity": 67335,
    "decks": [
      [
        33
      ],
      [
        12
      ],
      [
        24
      ]
    ],
    "fairArea": 106700,
    "fence": [
      {
        "distance": 330.0,
        "theta": -45.0
      },
      {
        "distance": 387.0,
        "theta": -22.5
      },
      {
        "distance": 404.0,
        "theta": 0.0
      },
      {
        "distance": 370.0,
        "theta": 22.5
      },
      {
        "distance": 330.0,
        "theta": 45.0
      }
    ],
    "foulArea": 21500,
    "key": "angelstadium",
    "name": "Angel Stadium",
    "retired": false,
    "team": "LAA",
    "wallHeight": {
      "center": 8.0,
      "left": 5.0,
      "right": 18.0
    }
  },
  "astrodome": {
    "azimuth": 90.0,
    "backstop": 67.0,
    "bearing": "E",
    "capacity": 54816,
    "decks": [
      [
        52
      ],
      [
        7
      ],
      [
        18
      ]
    ],
    "fairArea": 109800,
    "fence": [
      {
        "distance": 325.0,
        "theta": -45.0
      },
      {
        "distance": 375.0,
        "theta": -22.5
      },
      {
        "distance": 400.0,
        "theta": 0.0
      },
      {
        "distance": 375.0,
        "theta": 22.5
      },
      {
        "distance": 325.0,
        "theta": 45.0
      }
    ],
    "foulArea": 26900,
    "key": "astrodome",
    "name": "Astrodome",
    "retired": true,
    "team": "HOU",
    "wallHeight": {
      "center": 10.0,
      "left": 10.0,
      "right": 10.0
    }
  },
  "buschstadium": {
    "azimuth": 45.0,
    "backstop": 52.0,
    "bearing": "NE",
    "capacity": 43975,
    "decks": [
      [
        36
      ],
      [
        13
      ],
      [
        20
      ]
    ],
    "fairArea": 112100,
    "fence": [
      {
        "distance": 336.0,
        "theta": -45.0
      },
      {
        "distance": 375.0,
        "theta": -22.5
      },
      {
        "distance": 400.0,
        "theta": 0.0
      },
      {
        "distance": 375.0,
        "theta": 22.5
      },
      {
        "distance": 335.0,
        "theta": 45.0
      }
    ],
    "foulArea": 25200,
    "key": "buschstadium",
    "name": "Busch Stadium",
    "retired": false,
    "team": "STL",
    "wallHeight": {
      "center": 8.0,
      "left": 8.0,
      "right": 8.0
    }
  },
  "chasefield": {
    "azimuth": 0.0,
    "backstop": 55.0,
    "bearing": "N",
    "capacity": 48633,
    "decks": [
      [
        39
      ],
      [
        11
      ],
      [
        40
      ]
    ],
    "fairArea": 114200,
    "fence": [
      {
        "distance": 330.0,
        "theta": -45.0
      },
      {
        "distance": 376.0,
        "theta": -22.5
      },
      {
        "distance": 407.0,
        "theta": 0.0
      },
      {
        "distance": 376.0,
        "theta": 22.5
      },
      {
        "distance": 335.0,
        "theta": 45.0
      }
    ],
    "foulArea": 25500,
    "key": "chasefield",
    "name": "Chase Field",
    "retired": false,
    "team": "AZ",
    "wallHeight": {
      "center": 25.0,
      "left": 8.0,
      "right": 8.0
    }
  },
  "citifield": {
    "azimuth": 22.5,
    "backstop": 46.0,
    "bearing": "NNE",
    "capacity": 41922,
    "decks": [
      [
        38
      ],
      [
        12
      ],
      [
        23
      ]
    ],
    "fairArea": 110600,
    "fence": [
      {
        "distance": 335.0,
        "theta": -45.0
      },
      {
        "distance": 362.0,
        "est": true,
        "theta": -22.5
      },
      {
        "distance": 408.0,
        "theta": 0.0
      },
      {
        "distance": 375.0,
        "theta": 22.5
      },
      {
        "distance": 330.0,
        "theta": 45.0
      }
    ],
    "foulArea": 20700,
    "key": "citifield",
    "name": "Citi Field",
    "retired": false,
    "team": "NYM",
    "wallHeight": {
      "center": 8.0,
      "left": 8.0,
      "right": 8.0
    }
  },
  "citizensbankpark": {
    "azimuth": 22.5,
    "backstop": 50.0,
    "bearing": "NNE",
    "capacity": 43651,
    "decks": [
      [
        35
      ],
      [
        9
      ],
      [
        24
      ]
    ],
    "fairArea": 105000,
    "fence": [
      {
        "distance": 329.0,
        "theta": -45.0
      },
      {
        "distance": 360.0,
        "est": true,
        "theta": -22.5
      },
      {
        "distance": 401.0,
        "theta": 0.0
      },
      {
        "distance": 355.0,
        "est": true,
        "theta": 22.5
      },
      {
        "distance": 330.0,
        "theta": 45.0
      }
    ],
    "foulArea": 24500,
    "key": "citizensbankpark",
    "name": "Citizens Bank Park",
    "retired": false,
    "team": "PHI",
    "wallHeight": {
      "center": 6.0,
      "left": 11.0,
      "right": 13.0
    }
  },
  "comericapark": {
    "azimuth": 157.5,
    "backstop": 55.0,
    "bearing": "SSE",
    "capacity": 41255,
    "decks": [
      [
        43
      ],
      [
        3
      ],
      [
        26
      ]
    ],
    "fairArea": 113700,
    "fence": [
      {
        "distance": 345.0,
        "theta": -45.0
      },
      {
        "distance": 370.0,
        "theta": -22.5
      },
      {
        "distance": 420.0,
        "theta": 0.0
      },
      {
        "distance": 388.0,
        "est": true,
        "theta": 22.5
      },
      {
        "distance": 330.0,
        "theta": 45.0
      }
    ],
    "foulArea": 26500,
    "key": "comericapark",
    "name": "Comerica Park",
    "retired": false,
    "team": "DET",
    "wallHeight": {
      "center": 9.0,
      "left": 7.0,
      "right": 9.0
    }
  },
  "coorsfield": {
    "azimuth": 0.0,
    "backstop": 50.0,
    "bearing": "N",
    "capacity": 50398,
    "decks": [
      [
        38
      ],
      [
        14
      ],
      [
        25
      ]
    ],
    "fairArea": 119200,
    "fence": [
      {
        "distance": 347.0,
        "theta": -45.0
      },
      {
        "distance": 390.0,
        "theta": -22.5
      },
      {
        "distance": 415.0,
        "theta": 0.0
      },
      {
        "distance": 375.0,
        "theta": 22.5
      },
      {
        "distance": 350.0,
        "theta": 45.0
      }
    ],
    "foulArea": 24900,
    "key": "coorsfield",
    "name": "Coors Field",
    "retired": false,
    "team": "COL",
    "wallHeight": {
      "center": 8.0,
      "left": 8.0,
      "right": 17.0
    }
  },
  "daikinpark": {
    "azimuth": 67.5,
    "backstop": 49.0,
    "bearing": "ENE",
    "capacity": 42060,
    "decks": [
      [
        38
      ],
      [
        11
      ],
      [
        26
      ]
    ],
    "fairArea": 107000,
    "fence": [
      {
        "distance": 315.0,
        "theta": -45.0
      },
      {
        "distance": 335.0,
        "est": true,
        "theta": -22.5
      },
      {
        "distance": 436.0,
        "theta": 0.0
      },
      {
        "distance": 373.0,
        "theta": 22.5
      },
      {
        "distance": 326.0,
        "theta": 45.0
      }
    ],
    "foulArea": 21000,
    "key": "daikinpark",
    "name": "Daikin Park",
    "retired": false,
    "team": "HOU",
    "wallHeight": {
      "center": 9.0,
      "left": 21.0,
      "right": 7.0
    }
  },
  "dodgerstadium": {
    "azimuth": 22.5,
    "backstop": 53.0,
    "bearing": "NNE",
    "capacity": 56000,
    "decks": [
      [
        40
      ],
      [
        20
      ],
      [
        29
      ]
    ],
    "fairArea": 111100,
    "fence": [
      {
        "distance": 330.0,
        "theta": -45.0
      },
      {
        "distance": 375.0,
        "theta": -22.5
      },
      {
        "distance": 395.0,
        "theta": 0.0
      },
      {
        "distance": 375.0,
        "theta": 22.5
      },
      {
        "distance": 330.0,
        "theta": 45.0
      }
    ],
    "foulArea": 19300,
    "key": "dodgerstadium",
    "name": "Dodger Stadium",
    "retired": false,
    "team": "LAD",
    "wallHeight": {
      "center": 8.0,
      "left": 4.0,
      "right": 4.0
    }
  },
  "fenwaypark": {
    "azimuth": 45.0,
    "backstop": 54.0,
    "bearing": "NE",
    "capacity": 37499,
    "decks": [
      [
        45
      ],
      [
        4
      ],
      [
        10
      ]
    ],
    "fairArea": 105500,
    "fence": [
      {
        "distance": 310.0,
        "theta": -45.0
      },
      {
        "distance": 335.0,
        "est": true,
        "theta": -22.5
      },
      {
        "distance": 390.0,
        "est": true,
        "theta": 0.0
      },
      {
        "distance": 378.0,
        "est": true,
        "theta": 22.5
      },
      {
        "distance": 302.0,
        "theta": 45.0
      }
    ],
    "foulArea": 18100,
    "key": "fenwaypark",
    "name": "Fenway Park",
    "retired": false,
    "team": "BOS",
    "wallHeight": {
      "center": 18.0,
      "left": 37.0,
      "right": 5.0
    }
  },
  "globelifefield": {
    "azimuth": 67.5,
    "backstop": 42.0,
    "bearing": "ENE",
    "capacity": 40300,
    "decks": [
      [
        22
      ],
      [
        18
      ],
      [
        11,
        12
      ]
    ],
    "fairArea": 110400,
    "fence": [
      {
        "distance": 329.0,
        "theta": -45.0
      },
      {
        "distance": 372.0,
        "theta": -22.5
      },
      {
        "distance": 407.0,
        "theta": 0.0
      },
      {
        "distance": 374.0,
        "theta": 22.5
      },
      {
        "distance": 326.0,
        "theta": 45.0
      }
    ],
    "foulArea": 23100,
    "key": "globelifefield",
    "name": "Globe Life Field",
    "retired": false,
    "team": "TEX",
    "wallHeight": {
      "center": 8.0,
      "left": 8.0,
      "right": 8.0
    }
  },
  "greatamericanballpark": {
    "azimuth": 112.5,
    "backstop": 50.0,
    "bearing": "ESE",
    "capacity": 42319,
    "decks": [
      [
        38
      ],
      [
        14
      ],
      [
        28
      ]
    ],
    "fairArea": 106900,
    "fence": [
      {
        "distance": 328.0,
        "theta": -45.0
      },
      {
        "distance": 368.0,
        "est": true,
        "theta": -22.5
      },
      {
        "distance": 404.0,
        "theta": 0.0
      },
      {
        "distance": 370.0,
        "theta": 22.5
      },
      {
        "distance": 325.0,
        "theta": 45.0
      }
    ],
    "foulArea": 23600,
    "key": "greatamericanballpark",
    "name": "Great American Ballpark",
    "retired": false,
    "team": "CIN",
    "wallHeight": {
      "center": 8.0,
      "left": 12.0,
      "right": 8.0
    }
  },
  "guaranteedratefield": {
    "azimuth": 112.5,
    "backstop": 60.0,
    "bearing": "ESE",
    "capacity": 44702,
    "decks": [
      [
        38
      ],
      [
        4
      ],
      [
        21
      ]
    ],
    "fairArea": 105300,
    "fence": [
      {
        "distance": 335.0,
        "theta": -45.0
      },
      {
        "distance": 365.0,
        "est": true,
        "theta": -22.5
      },
      {
        "distance": 400.0,
        "theta": 0.0
      },
      {
        "distance": 365.0,
        "est": true,
        "theta": 22.5
      },
      {
        "distance": 330.0,
        "theta": 45.0
      }
    ],
    "foulArea": 25000,
    "key": "guaranteedratefield",
    "name": "Guaranteed Rate Field",
    "retired": false,
    "team": "CWS",
    "wallHeight": {
      "center": 8.0,
      "left": 8.0,
      "right": 8.0
    }
  },
  "jarrypark": {
    "azimuth": 337.5,
    "backstop": 62.0,
    "bearing": "NNW",
    "capacity": 28456,
    "decks": [
      [
        50
      ],
      [],
      []
    ],
    "fairArea": 112000,
    "fence": [
      {
        "distance": 340.0,
        "theta": -45.0
      },
      {
        "distance": 368.0,
        "theta": -22.5
      },
      {
        "distance": 420.0,
        "theta": 0.0
      },
      {
        "distance": 368.0,
        "theta": 22.5
      },
      {
        "distance": 340.0,
        "theta": 45.0
      }
    ],
    "foulArea": 25300,
    "key": "jarrypark",
    "name": "Jarry Park",
    "retired": true,
    "team": null,
    "wallHeight": {
      "center": 5.0,
      "left": 5.0,
      "right": 5.0
    }
  },
  "kauffmanstadium": {
    "azimuth": 45.0,
    "backstop": 45.0,
    "bearing": "NE",
    "capacity": 40793,
    "decks": [
      [
        38
      ],
      [
        6
      ],
      [
        40
      ]
    ],
    "fairArea": 118500,
    "fence": [
      {
        "distance": 330.0,
        "theta": -45.0
      },
      {
        "distance": 385.0,
        "theta": -22.5
      },
      {
        "distance": 410.0,
        "est": true,
        "theta": 0.0
      },
      {
        "distance": 385.0,
        "theta": 22.5
      },
      {
        "distance": 330.0,
        "theta": 45.0
      }
    ],
    "foulArea": 22900,
    "key": "kauffmanstadium",
    "name": "Kauffman Stadium",
    "retired": false,
    "team": "KC",
    "wallHeight": {
      "center": 9.0,
      "left": 9.0,
      "right": 9.0
    }
  },
  "loandepotpark": {
    "azimuth": 112.5,
    "backstop": 50.0,
    "bearing": "ESE",
    "capacity": 37442,
    "decks": [
      [
        40
      ],
      [
        10
      ],
      [
        22
      ]
    ],
    "fairArea": 114600,
    "fence": [
      {
        "distance": 344.0,
        "theta": -45.0
      },
      {
        "distance": 386.0,
        "theta": -22.5
      },
      {
        "distance": 407.0,
        "theta": 0.0
      },
      {
        "distance": 392.0,
        "theta": 22.5
      },
      {
        "distance": 335.0,
        "theta": 45.0
      }
    ],
    "foulArea": 21000,
    "key": "loandepotpark",
    "name": "Loan Depot Park",
    "retired": false,
    "team": "MIA",
    "wallHeight": {
      "center": 15.0,
      "left": 10.0,
      "right": 10.0
    }
  },
  "nationalspark": {
    "azimuth": 22.5,
    "backstop": 45.0,
    "bearing": "NNE",
    "capacity": 41418,
    "decks": [
      [
        41
      ],
      [
        11
      ],
      [
        22
      ]
    ],
    "fairArea": 109100,
    "fence": [
      {
        "distance": 336.0,
        "theta": -45.0
      },
      {
        "distance": 377.0,
        "theta": -22.5
      },
      {
        "distance": 402.0,
        "theta": 0.0
      },
      {
        "distance": 370.0,
        "est": true,
        "theta": 22.5
      },
      {
        "distance": 335.0,
        "theta": 45.0
      }
    ],
    "foulArea": 23100,
    "key": "nationalspark",
    "name": "Nationals Park",
    "retired": false,
    "team": "WSH",
    "wallHeight": {
      "center": 12.0,
      "left": 10.0,
      "right": 9.0
    }
  },
  "oaklandcoliseum": {
    "azimuth": 45.0,
    "backstop": 53.0,
    "bearing": "NE",
    "capacity": 48219,
    "decks": [
      [
        35
      ],
      [
        16
      ],
      [
        16
      ]
    ],
    "fairArea": 108700,
    "fence": [
      {
        "distance": 330.0,
        "theta": -45.0
      },
      {
        "distance": 362.0,
        "theta": -22.5
      },
      {
        "distance": 400.0,
        "theta": 0.0
      },
      {
        "distance": 362.0,
        "theta": 22.5
      },
      {
        "distance": 330.0,
        "theta": 45.0
      }
    ],
    "foulArea": 40700,
    "key": "oaklandcoliseum",
    "name": "Oakland Coliseum",
    "retired": true,
    "team": "ATH",
    "wallHeight": {
      "center": 8.0,
      "left": 8.0,
      "right": 8.0
    }
  },
  "oraclepark": {
    "azimuth": 112.5,
    "backstop": 54.0,
    "bearing": "ESE",
    "capacity": 41915,
    "decks": [
      [
        36
      ],
      [
        12
      ],
      [
        25
      ]
    ],
    "fairArea": 110800,
    "fence": [
      {
        "distance": 339.0,
        "theta": -45.0
      },
      {
        "distance": 365.0,
        "est": true,
        "theta": -22.5
      },
      {
        "distance": 399.0,
        "theta": 0.0
      },
      {
        "distance": 385.0,
        "est": true,
        "theta": 22.5
      },
      {
        "distance": 309.0,
        "theta": 45.0
      }
    ],
    "foulArea": 25500,
    "key": "oraclepark",
    "name": "Oracle Park",
    "retired": false,
    "team": "SF",
    "wallHeight": {
      "center": 8.0,
      "left": 8.0,
      "right": 25.0
    }
  },
  "orioleparkatcamdenyards": {
    "azimuth": 22.5,
    "backstop": 54.0,
    "bearing": "NNE",
    "capacity": 45971,
    "decks": [
      [
        42
      ],
      [
        9
      ],
      [
        25
      ]
    ],
    "fairArea": 108100,
    "fence": [
      {
        "distance": 333.0,
        "theta": -45.0
      },
      {
        "distance": 364.0,
        "theta": -22.5
      },
      {
        "distance": 400.0,
        "est": true,
        "theta": 0.0
      },
      {
        "distance": 373.0,
        "theta": 22.5
      },
      {
        "distance": 318.0,
        "theta": 45.0
      }
    ],
    "foulArea": 23600,
    "key": "orioleparkatcamdenyards",
    "name": "Oriole Park at Camden Yards",
    "retired": false,
    "team": "BAL",
    "wallHeight": {
      "center": 7.0,
      "left": 7.0,
      "right": 21.0
    }
  },
  "petcopark": {
    "azimuth": 0.0,
    "backstop": 45.0,
    "bearing": "N",
    "capacity": 42524,
    "decks": [
      [
        38
      ],
      [
        15
      ],
      [
        27
      ]
    ],
    "fairArea": 110900,
    "fence": [
      {
        "distance": 334.0,
        "theta": -45.0
      },
      {
        "distance": 380.0,
        "est": true,
        "theta": -22.5
      },
      {
        "distance": 396.0,
        "theta": 0.0
      },
      {
        "distance": 372.0,
        "est": true,
        "theta": 22.5
      },
      {
        "distance": 322.0,
        "theta": 45.0
      }
    ],
    "foulArea": 23900,
    "key": "petcopark",
    "name": "PETCO Park",
    "retired": false,
    "team": "SD",
    "wallHeight": {
      "center": 7.0,
      "left": 4.0,
      "right": 10.0
    }
  },
  "pncpark": {
    "azimuth": 112.5,
    "backstop": 51.0,
    "bearing": "ESE",
    "capacity": 38362,
    "decks": [
      [
        44
      ],
      [
        2
      ],
      [
        30
      ]
    ],
    "fairArea": 111200,
    "fence": [
      {
        "distance": 325.0,
        "theta": -45.0
      },
      {
        "distance": 388.0,
        "est": true,
        "theta": -22.5
      },
      {
        "distance": 399.0,
        "theta": 0.0
      },
      {
        "distance": 365.0,
        "est": true,
        "theta": 22.5
      },
      {
        "distance": 320.0,
        "theta": 45.0
      }
    ],
    "foulArea": 22200,
    "key": "pncpark",
    "name": "PNC Park",
    "retired": false,
    "team": "PIT",
    "wallHeight": {
      "center": 10.0,
      "left": 6.0,
      "right": 21.0
    }
  },
  "progressivefield": {
    "azimuth": 0.0,
    "backstop": 60.0,
    "bearing": "N",
    "capacity": 43000,
    "decks": [
      [
        32
      ],
      [
        18
      ],
      [
        27
      ]
    ],
    "fairArea": 105400,
    "fence": [
      {
        "distance": 325.0,
        "theta": -45.0
      },
      {
        "distance": 360.0,
        "est": true,
        "theta": -22.5
      },
      {
        "distance": 405.0,
        "theta": 0.0
      },
      {
        "distance": 375.0,
        "theta": 22.5
      },
      {
        "distance": 325.0,
        "theta": 45.0
      }
    ],
    "foulArea": 21900,
    "key": "progressivefield",
    "name": "Progressive Field",
    "retired": false,
    "team": "CLE",
    "wallHeight": {
      "center": 9.0,
      "left": 19.0,
      "right": 9.0
    }
  },
  "rogerscentre": {
    "azimuth": 337.5,
    "backstop": 54.0,
    "bearing": "NNW",
    "capacity": 49282,
    "decks": [
      [
        30
      ],
      [
        12
      ],
      [
        24
      ]
    ],
    "fairArea": 109500,
    "fence": [
      {
        "distance": 328.0,
        "theta": -45.0
      },
      {
        "distance": 375.0,
        "theta": -22.5
      },
      {
        "distance": 400.0,
        "theta": 0.0
      },
      {
        "distance": 375.0,
        "theta": 22.5
      },
      {
        "distance": 328.0,
        "theta": 45.0
      }
    ],
    "foulArea": 29000,
    "key": "rogerscentre",
    "name": "Rogers Centre",
    "retired": false,
    "team": "TOR",
    "wallHeight": {
      "center": 8.0,
      "left": 8.0,
      "right": 8.0
    }
  },
  "targetfield": {
    "azimuth": 90.0,
    "backstop": 48.0,
    "bearing": "E",
    "capacity": 39021,
    "decks": [
      [
        40
      ],
      [
        13
      ],
      [
        21
      ]
    ],
    "fairArea": 108900,
    "fence": [
      {
        "distance": 339.0,
        "theta": -45.0
      },
      {
        "distance": 377.0,
        "theta": -22.5
      },
      {
        "distance": 404.0,
        "theta": 0.0
      },
      {
        "distance": 367.0,
        "theta": 22.5
      },
      {
        "distance": 328.0,
        "theta": 45.0
      }
    ],
    "foulArea": 20700,
    "key": "targetfield",
    "name": "Target Field",
    "retired": false,
    "team": "MIN",
    "wallHeight": {
      "center": 8.0,
      "left": 8.0,
      "right": 23.0
    }
  },
  "tmobilepark": {
    "azimuth": 45.0,
    "backstop": 56.0,
    "bearing": "NE",
    "capacity": 47476,
    "decks": [
      [
        42
      ],
      [
        12
      ],
      [
        26
      ]
    ],
    "fairArea": 106100,
    "fence": [
      {
        "distance": 331.0,
        "theta": -45.0
      },
      {
        "distance": 367.0,
        "est": true,
        "theta": -22.5
      },
      {
        "distance": 401.0,
        "theta": 0.0
      },
      {
        "distance": 367.0,
        "est": true,
        "theta": 22.5
      },
      {
        "distance": 326.0,
        "theta": 45.0
      }
    ],
    "foulArea": 24300,
    "key": "tmobilepark",
    "name": "T-Mobile Park",
    "retired": false,
    "team": "SEA",
    "wallHeight": {
      "center": 7.0,
      "left": 15.0,
      "right": 7.0
    }
  },
  "tropicanafield": {
    "azimuth": 45.0,
    "backstop": 50.0,
    "bearing": "NE",
    "capacity": 45200,
    "decks": [
      [
        38
      ],
      [
        8
      ],
      [
        28
      ]
    ],
    "fairArea": 108900,
    "fence": [
      {
        "distance": 315.0,
        "theta": -45.0
      },
      {
        "distance": 370.0,
        "theta": -22.5
      },
      {
        "distance": 404.0,
        "theta": 0.0
      },
      {
        "distance": 370.0,
        "theta": 22.5
      },
      {
        "distance": 322.0,
        "theta": 45.0
      }
    ],
    "foulArea": 25300,
    "key": "tropicanafield",
    "name": "Tropicana Field",
    "retired": false,
    "team": "TB",
    "wallHeight": {
      "center": 9.0,
      "left": 11.0,
      "right": 11.0
    }
  },
  "truistpark": {
    "azimuth": 157.5,
    "backstop": 53.0,
    "bearing": "SSE",
    "capacity": 41500,
    "decks": [
      [
        33
      ],
      [
        19
      ],
      [
        13,
        12
      ]
    ],
    "fairArea": 109300,
    "fence": [
      {
        "distance": 335.0,
        "theta": -45.0
      },
      {
        "distance": 385.0,
        "theta": -22.5
      },
      {
        "distance": 400.0,
        "theta": 0.0
      },
      {
        "distance": 375.0,
        "theta": 22.5
      },
      {
        "distance": 325.0,
        "theta": 45.0
      }
    ],
    "foulArea": 22300,
    "key": "truistpark",
    "name": "Truist Park",
    "retired": false,
    "team": "ATL",
    "wallHeight": {
      "center": 8.0,
      "left": 6.0,
      "right": 16.0
    }
  },
  "wrigleyfield": {
    "azimuth": 45.0,
    "backstop": 55.0,
    "bearing": "NE",
    "capacity": 41019,
    "decks": [
      [
        56
      ],
      [
        2
      ],
      [
        21
      ]
    ],
    "fairArea": 107800,
    "fence": [
      {
        "distance": 355.0,
        "theta": -45.0
      },
      {
        "distance": 352.0,
        "est": true,
        "theta": -22.5
      },
      {
        "distance": 395.0,
        "est": true,
        "theta": 0.0
      },
      {
        "distance": 368.0,
        "theta": 22.5
      },
      {
        "distance": 353.0,
        "theta": 45.0
      }
    ],
    "foulArea": 18600,
    "key": "wrigleyfield",
    "name": "Wrigley Field",
    "retired": false,
    "team": "CHC",
    "wallHeight": {
      "center": 11.0,
      "left": 16.0,
      "right": 16.0
    }
  },
  "yankeestadium": {
    "azimuth": 67.5,
    "backstop": 52.0,
    "bearing": "ENE",
    "capacity": 50291,
    "decks": [
      [
        28
      ],
      [
        23
      ],
      [
        7,
        14
      ]
    ],
    "fairArea": 108800,
    "fence": [
      {
        "distance": 318.0,
        "theta": -45.0
      },
      {
        "distance": 382.0,
        "est": true,
        "theta": -22.5
      },
      {
        "distance": 408.0,
        "theta": 0.0
      },
      {
        "distance": 360.0,
        "est": true,
        "theta": 22.5
      },
      {
        "distance": 314.0,
        "theta": 45.0
      }
    ],
    "foulArea": 19700,
    "key": "yankeestadium",
    "name": "Yankee Stadium",
    "retired": false,
    "team": "NYY",
    "wallHeight": {
      "center": 8.0,
      "left": 8.0,
      "right": 8.0
    }
  }
};

/* Abbreviation -> the park that club plays in now. */
export const PARK_BY_TEAM = {
  "ATL": "truistpark",
  "AZ": "chasefield",
  "BAL": "orioleparkatcamdenyards",
  "BOS": "fenwaypark",
  "CHC": "wrigleyfield",
  "CIN": "greatamericanballpark",
  "CLE": "progressivefield",
  "COL": "coorsfield",
  "CWS": "guaranteedratefield",
  "DET": "comericapark",
  "HOU": "daikinpark",
  "KC": "kauffmanstadium",
  "LAA": "angelstadium",
  "LAD": "dodgerstadium",
  "MIA": "loandepotpark",
  "MIL": "americanfamilyfield",
  "MIN": "targetfield",
  "NYM": "citifield",
  "NYY": "yankeestadium",
  "PHI": "citizensbankpark",
  "PIT": "pncpark",
  "SD": "petcopark",
  "SEA": "tmobilepark",
  "SF": "oraclepark",
  "STL": "buschstadium",
  "TB": "tropicanafield",
  "TEX": "globelifefield",
  "TOR": "rogerscentre",
  "WSH": "nationalspark"
};

/* Names the feed sends that the sheet spells differently. */
export const VENUE_ALIASES = {
  "ratefield": "guaranteedratefield"
};

/** Normalise a venue name the way the keys above were built. */
export function venueKey(name) {
  const key = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return VENUE_ALIASES[key] || key;
}

/**
 * The key for a venue name, or null.
 *
 * Exact match first. Failing that, a park whose key the venue CONTAINS:
 * the feed sells naming rights inside the name, and sends things like
 * "UNIQLO Field at Dodger Stadium", which normalises to nothing on its
 * own but has "dodgerstadium" sitting in it. Longest match wins, and
 * short keys are not eligible, so this cannot latch onto a fragment.
 */
export function venueMatch(venue) {
  const key = venueKey(venue);
  if (!key) return null;
  if (PARKS[key]) return key;
  let best = null;
  for (const candidate of Object.keys(PARKS)) {
    if (candidate.length < 8 || !key.includes(candidate)) continue;
    if (!best || candidate.length > best.length) best = candidate;
  }
  return best;
}

/**
 * The park a game is played in: by venue name, falling back to the home
 * club's current park, and null if neither is known.
 *
 * Venue before club on purpose -- the venue is what the feed states about
 * THIS game, and the club's own park is only a good guess. A neutral-site
 * game is exactly the case where the guess is wrong.
 */
export function parkFor(venue, teamAbbr) {
  const matched = venueMatch(venue);
  if (matched) return PARKS[matched];
  const key = teamAbbr && PARK_BY_TEAM[teamAbbr.toUpperCase()];
  return (key && PARKS[key]) || null;
}
