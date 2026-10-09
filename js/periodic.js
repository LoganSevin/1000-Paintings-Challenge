/**
 * Periodic Table — 118 elements, and how they bond.
 */
(function () {
  "use strict";

  var FAMILIES = [
    ["alkali", "Alkali"],
    ["alkaline", "Alkaline earth"],
    ["transition", "Transition"],
    ["post", "Post-transition"],
    ["metalloid", "Metalloid"],
    ["nonmetal", "Nonmetal"],
    ["halogen", "Halogen"],
    ["noble", "Noble gas"],
    ["lanthanide", "Lanthanide"],
    ["actinide", "Actinide"],
  ];

  var FAMILY_LABEL = {
    alkali: "Alkali metal",
    alkaline: "Alkaline earth metal",
    transition: "Transition metal",
    post: "Post-transition metal",
    metalloid: "Metalloid",
    nonmetal: "Nonmetal",
    halogen: "Halogen",
    noble: "Noble gas",
    lanthanide: "Lanthanide",
    actinide: "Actinide",
  };

  var GROUP_TITLE = {
    1: "Group 1. Hydrogen, then the alkali metals.",
    2: "Group 2. The alkaline earth metals.",
    13: "Group 13. The boron group.",
    14: "Group 14. The carbon group.",
    15: "Group 15. The pnictogens.",
    16: "Group 16. The chalcogens.",
    17: "Group 17. The halogens.",
    18: "Group 18. The noble gases.",
  };

  var SPECIAL = {
    H: "Hydrogen is the first element: one proton and one electron, configuration 1s1. It sits in group 1 because of that single electron, and it is a nonmetal, not an alkali metal. Two hydrogen atoms share their electrons as one pair. That shared pair is a covalent bond, and the molecule is H2. The pull is equal, so the bond is nonpolar. Hydrogen can also lose the electron and become H+, the proton of acids, or gain one and become H−, a hydride.",
    He: "Helium has two electrons, configuration 1s2. The first shell holds only two, and it is full. A full shell is stable, so helium does not form ordinary bonds. The gas is single atoms, not pairs. It has the lowest boiling point of every element.",
    C: "Carbon has four outer electrons, configuration [He] 2s2 2p2. Four sits in the middle of a shell of eight, so carbon almost never gains or loses four electrons. It shares them. Each shared pair is a covalent bond, and carbon makes four of them. Those bonds build chains, rings, graphite sheets, and diamond. Organic chemistry is the chemistry of carbon's covalent bonds.",
    N: "Nitrogen has five outer electrons. In the N2 molecule that makes up most of air, the two atoms share three pairs: a triple covalent bond. That bond is very strong, which is why nitrogen gas is slow to react. In ammonia, NH3, nitrogen shares three pairs with hydrogen and keeps one lone pair. The lone pair bends the molecule into a pyramid.",
    O: "Oxygen has six outer electrons and is two short of a full shell. In water it shares one pair with each hydrogen and keeps two lone pairs. The pairs repel, so water is bent, and because oxygen pulls harder than hydrogen the bonds are polar covalent. The O2 molecule is drawn as a double bond, two shared pairs. That drawing is useful and incomplete: real oxygen gas is paramagnetic, so it has unpaired electrons the simple picture hides.",
    F: "Fluorine is the most electronegative element, 3.98 on the Pauling scale. Seven outer electrons leave room for one covalent bond, or for one captured electron that makes F−. In HF the shared pair sits close to fluorine, so the bond is polar covalent. Elemental fluorine is F2, and it reacts with almost everything.",
    Na: "Sodium is an alkali metal with one outer electron, configuration [Ne] 3s1. That electron is loosely held. Chlorine can take it: sodium becomes Na+ and chloride becomes Cl−. The attraction between those ions is an ionic bond, and the crystal is table salt. As a pure metal, sodium atoms pool their outer electrons in a sea. That is metallic bonding. The metal is soft, and it reacts with water.",
    Cl: "Chlorine is a halogen with seven outer electrons. Two chlorine atoms share one pair and make Cl2, a covalent molecule. A metal can hand chlorine an electron instead. Chlorine becomes Cl− and the bond is ionic, as in sodium chloride. Electronegativity is 3.16, so chlorine is the taker when the other atom pulls more weakly.",
    Fe: "Iron is a transition metal, configuration [Ar] 3d6 4s2. The outer shell shows two electrons, and the d electrons under them join the chemistry, so iron is commonly Fe2+ or Fe3+. In the metal those electrons enter a shared sea. That metallic bond is why iron conducts and can be forged. Rust is iron that has given electrons to oxygen.",
    Si: "Silicon sits under carbon and has the same four outer electrons, so it also prefers covalent bonds. It is a metalloid: the bonds are covalent, and the crystal conducts electricity only partly, which is why chips are made of silicon. In quartz, each silicon atom shares bonds with four oxygen atoms. That is a covalent network, SiO2, not a pile of small molecules.",
  };

  var MOLECULES = [
    {
      id: "h2",
      formula: "H2",
      name: "Hydrogen",
      kind: "Nonpolar covalent",
      pair: ["H", "H"],
      sea: false,
      atoms: [{ sym: "H", x: 50, y: 58 }, { sym: "H", x: 140, y: 58 }],
      bonds: [[0, 1, 1]],
      lesson: "Each hydrogen brings one electron. They share that pair. The pull is equal, so the bond is nonpolar covalent. This is the smallest covalent bond.",
    },
    {
      id: "n2",
      formula: "N2",
      name: "Nitrogen",
      kind: "Nonpolar covalent",
      pair: ["N", "N"],
      atoms: [{ sym: "N", x: 50, y: 58 }, { sym: "N", x: 140, y: 58 }],
      bonds: [[0, 1, 3]],
      lesson: "Three shared pairs make a triple bond. N2 is most of the air, and the bond is strong enough that the gas is slow to burn or react.",
    },
    {
      id: "o2",
      formula: "O2",
      name: "Oxygen",
      kind: "Nonpolar covalent",
      pair: ["O", "O"],
      atoms: [{ sym: "O", x: 50, y: 58 }, { sym: "O", x: 140, y: 58 }],
      bonds: [[0, 1, 2]],
      lesson: "The classroom drawing is a double bond, two shared pairs. Real O2 is paramagnetic, so a perfect Lewis picture is not the whole molecule.",
    },
    {
      id: "cl2",
      formula: "Cl2",
      name: "Chlorine",
      kind: "Nonpolar covalent",
      pair: ["Cl", "Cl"],
      atoms: [{ sym: "Cl", x: 50, y: 58 }, { sym: "Cl", x: 140, y: 58 }],
      bonds: [[0, 1, 1]],
      lesson: "Each chlorine is one electron short of eight. Sharing one pair fills both atoms. The bond is a single covalent bond.",
    },
    {
      id: "h2o",
      formula: "H2O",
      name: "Water",
      kind: "Polar covalent",
      pair: ["H", "O"],
      atoms: [{ sym: "O", x: 95, y: 40 }, { sym: "H", x: 40, y: 92 }, { sym: "H", x: 150, y: 92 }],
      bonds: [[0, 1, 1], [0, 2, 1]],
      lesson: "Oxygen shares one pair with each hydrogen and keeps two lone pairs. The shape is bent, about 104.5°. Oxygen pulls the pairs closer, so each O–H bond is polar, and the bend means the molecule is polar too.",
    },
    {
      id: "hf",
      formula: "HF",
      name: "Hydrogen fluoride",
      kind: "Polar covalent",
      pair: ["H", "F"],
      atoms: [{ sym: "H", x: 50, y: 58 }, { sym: "F", x: 140, y: 58 }],
      bonds: [[0, 1, 1]],
      lesson: "One shared pair. Fluorine pulls it much harder than hydrogen does. The bond is still covalent, and it is strongly polar. Both atoms are nonmetals, so the electron is not handed over as an ion.",
    },
    {
      id: "co2",
      formula: "CO2",
      name: "Carbon dioxide",
      kind: "Polar covalent",
      pair: ["C", "O"],
      atoms: [{ sym: "O", x: 28, y: 58 }, { sym: "C", x: 95, y: 58 }, { sym: "O", x: 162, y: 58 }],
      bonds: [[0, 1, 2], [1, 2, 2]],
      lesson: "Each carbon–oxygen link is a polar double bond. The molecule is linear, so the two pulls point opposite ways and cancel. The bonds are polar. The molecule is not.",
    },
    {
      id: "ch4",
      formula: "CH4",
      name: "Methane",
      kind: "Nonpolar covalent",
      pair: ["C", "H"],
      atoms: [
        { sym: "C", x: 95, y: 58 },
        { sym: "H", x: 95, y: 20 },
        { sym: "H", x: 36, y: 88 },
        { sym: "H", x: 154, y: 88 },
        { sym: "H", x: 128, y: 70 },
      ],
      bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]],
      lesson: "Carbon shares one pair with each of four hydrogens. The real shape is a tetrahedron. This flat drawing only shows that there are four bonds. The pulls cancel, so methane is nonpolar.",
    },
    {
      id: "nh3",
      formula: "NH3",
      name: "Ammonia",
      kind: "Polar covalent",
      pair: ["N", "H"],
      atoms: [{ sym: "N", x: 95, y: 36 }, { sym: "H", x: 36, y: 92 }, { sym: "H", x: 154, y: 92 }, { sym: "H", x: 95, y: 78 }],
      bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1]],
      lesson: "Nitrogen shares three pairs and keeps a lone pair. The lone pair pushes the hydrogens into a pyramid. Nitrogen pulls harder than hydrogen, so the bonds and the molecule are polar.",
    },
    {
      id: "nacl",
      formula: "NaCl",
      name: "Sodium chloride",
      kind: "Ionic",
      pair: ["Na", "Cl"],
      atoms: [{ sym: "Na", x: 50, y: 58 }, { sym: "Cl", x: 140, y: 58 }],
      bonds: [[0, 1, 0]],
      lesson: "Sodium gives its one outer electron to chlorine. The particles are Na+ and Cl−. There is no shared pair. Opposite charges hold the crystal together. That is an ionic bond.",
    },
    {
      id: "mgo",
      formula: "MgO",
      name: "Magnesium oxide",
      kind: "Ionic",
      pair: ["Mg", "O"],
      atoms: [{ sym: "Mg", x: 50, y: 58 }, { sym: "O", x: 140, y: 58 }],
      bonds: [[0, 1, 0]],
      lesson: "Magnesium has two outer electrons. Oxygen wants two. The transfer leaves Mg2+ and O2−. The bond is ionic, and the electronegativity gap is wide.",
    },
    {
      id: "fe",
      formula: "Fe",
      name: "Iron metal",
      kind: "Metallic",
      pair: ["Fe", "Fe"],
      sea: true,
      atoms: [{ sym: "Fe", x: 40, y: 58 }, { sym: "Fe", x: 95, y: 58 }, { sym: "Fe", x: 150, y: 58 }],
      bonds: [],
      lesson: "Iron atoms sit in a lattice and release outer electrons into a shared sea. The sea is the metallic bond. It is why the metal conducts and can be bent. In rust and other compounds the atom is often Fe2+ or Fe3+.",
    },
  ];

  var elements = [];
  var bySymbol = {};
  var buttons = [];
  var selected = null;
  var filter = { q: "", family: "", group: 0, row: 0 };
  var built = false;
  var loading = null;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function family(el) {
    var category = el.category || "";
    if (el.group === 18) return "noble";
    if (el.group === 17) return "halogen";
    if (el.n >= 57 && el.n <= 71) return "lanthanide";
    if (el.n >= 89 && el.n <= 103) return "actinide";
    if (el.group === 1 && el.n !== 1) return "alkali";
    if (el.group === 2) return "alkaline";
    if (el.group >= 3 && el.group <= 12) return "transition";
    if (category.indexOf("metalloid") >= 0) return "metalloid";
    if (category.indexOf("nonmetal") >= 0) return "nonmetal";
    if (category.indexOf("post-transition") >= 0) return "post";
    if (el.block === "p" && el.group >= 13 && el.group <= 16) return "post";
    return "transition";
  }

  function isMetal(el) {
    var f = family(el);
    return f === "alkali" || f === "alkaline" || f === "transition" || f === "post" || f === "lanthanide" || f === "actinide";
  }

  function rowOf(y) {
    if (y <= 7) return y + 1;
    if (y >= 9) return y + 1;
    return y;
  }

  function groupTitle(g) {
    if (GROUP_TITLE[g]) return GROUP_TITLE[g];
    if (g >= 3 && g <= 12) return "Group " + g + ". Transition metals.";
    return "Group " + g + ".";
  }

  function massText(m) {
    if (m == null || isNaN(m)) return "—";
    return String(Math.round(Number(m) * 1000) / 1000);
  }

  function tempText(k) {
    if (k == null || isNaN(k)) return "—";
    var c = Math.round(k - 273.15);
    var kelvin = (Math.round(k * 10) / 10).toFixed(1);
    return c + " °C (" + kelvin + " K)";
  }

  function densityText(el) {
    if (el.density == null || isNaN(el.density)) return "—";
    var unit = el.densityUnit === "g/L" ? "g/L" : "g/cm³";
    var n = Number(el.density);
    var s = n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(2) : Number(n.toPrecision(3)).toString();
    return s + " " + unit;
  }

  function configText(el) {
    var c = el.config || "—";
    if (c.charAt(0) === "*") return c.slice(1) + " (predicted)";
    return c;
  }

  function lesson(el) {
    if (SPECIAL[el.symbol]) return SPECIAL[el.symbol];
    var f = family(el);
    var shells = el.shells || [];
    var outer = shells.length ? shells[shells.length - 1] : 0;
    var bits = [el.name + " is element " + el.n + ", a " + (FAMILY_LABEL[f] || "element").toLowerCase() + "."];
    if (f === "alkali") {
      bits.push("One outer electron is easy to lose, so the common ion is " + el.symbol + "+. With a nonmetal the bond is ionic. In the pure metal the outer electrons form a sea, which is metallic bonding.");
    } else if (f === "alkaline") {
      bits.push("Two outer electrons leave as a pair, so the common ion is " + el.symbol + "2+. Bonds with nonmetals are ionic. The element itself is held by metallic bonding.");
    } else if (f === "lanthanide") {
      bits.push("This row is where 4f fills. Most lanthanides lose three electrons and make a 3+ ion. The pure element is a metal, held together by a sea of electrons.");
    } else if (f === "actinide") {
      bits.push("This row is where 5f fills. Many actinides are radioactive. The pure element is a metal, and the ions vary more than the lanthanides do.");
    } else if (f === "transition") {
      bits.push("The outer shell holds " + outer + " electron" + (outer === 1 ? "" : "s") + ", and the d electrons under it also take part, so the charge in a compound can vary. The pure metal is held by a sea of electrons.");
    } else if (f === "post") {
      bits.push("It is a metal after the transition block. With other metals the bond is metallic. With a nonmetal, read the electronegativity gap: a wide gap is ionic, a narrow one is still partly covalent.");
    } else if (f === "metalloid") {
      bits.push("A metalloid stands on the stair between metals and nonmetals. Its bonds are often covalent, and the solid conducts electricity only partly.");
    } else if (f === "halogen") {
      bits.push("Seven outer electrons leave room for one covalent bond, or for one gained electron that makes " + el.symbol + "−. With a metal the result is usually an ionic salt.");
    } else if (f === "noble") {
      bits.push("The outer shell is full, so a bond is rare. The heavier noble gases can be pushed into a few compounds. The atom by itself is stable.");
    } else {
      bits.push("The outer shell holds " + outer + " electron" + (outer === 1 ? "" : "s") + ". It fills that shell by sharing pairs in covalent bonds.");
    }
    if (shells.length) bits.push("Shells from the nucleus hold " + shells.join(", ") + " electrons.");
    if (el.en != null) bits.push("Pauling electronegativity is " + el.en + ".");
    else bits.push("A settled Pauling electronegativity is not listed.");
    if (/^unknown/i.test(el.category || "")) {
      bits.push("Only a few atoms have been made, or the chemistry is still a prediction.");
    }
    return bits.join(" ");
  }

  function matches(el) {
    if (filter.q) {
      var q = filter.q;
      var sym = el.symbol.toLowerCase();
      var name = el.name.toLowerCase();
      var asNumber = /^\d+$/.test(q) && String(el.n).indexOf(q) === 0;
      var asText = sym.indexOf(q) === 0 || name.indexOf(q) === 0;
      if (!asNumber && !asText) return false;
    }
    if (filter.family && family(el) !== filter.family) return false;
    if (filter.row && el.y !== filter.row) return false;
    if (filter.group) {
      var inColumn = el.x === filter.group && el.y <= 7;
      var fBlock = filter.group === 3 && el.y >= 9;
      if (!inColumn && !fBlock) return false;
    }
    return true;
  }

  function applyFilter() {
    var i;
    for (i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var el = bySymbol[btn.getAttribute("data-symbol")];
      if (!el) continue;
      btn.classList.toggle("is-dim", !matches(el));
    }
    var heads = document.querySelectorAll("#pt-grid .pt-ghead");
    for (i = 0; i < heads.length; i++) {
      var g = parseInt(heads[i].getAttribute("data-group"), 10);
      heads[i].classList.toggle("is-on", !!filter.group && g === filter.group);
    }
    var seats = document.querySelectorAll("#pt-grid .pt-seat");
    for (i = 0; i < seats.length; i++) {
      var seatRow = parseInt(seats[i].getAttribute("data-row"), 10);
      var dimSeat = false;
      if (filter.family) dimSeat = true;
      if (filter.row && seatRow !== filter.row) dimSeat = true;
      if (filter.group && filter.group !== 3) dimSeat = true;
      if (filter.q) dimSeat = true;
      seats[i].classList.toggle("is-dim", dimSeat);
      seats[i].classList.toggle("is-on", !!filter.row && seatRow === filter.row);
    }
    var legend = document.querySelectorAll("#pt-legend button");
    for (i = 0; i < legend.length; i++) {
      legend[i].classList.toggle("is-on", legend[i].getAttribute("data-family") === filter.family);
      legend[i].setAttribute("aria-pressed", legend[i].classList.contains("is-on") ? "true" : "false");
    }
  }

  function bohrSvg(shells) {
    var parts = ['<svg class="pt-bohr" viewBox="0 0 220 220" role="img" aria-label="Electron shells">'];
    parts.push('<circle class="pt-nucleus" cx="110" cy="110" r="6"></circle>');
    var n = shells.length || 1;
    var i;
    var k;
    for (i = 0; i < shells.length; i++) {
      var radius = n === 1 ? 46 : 26 + i * (74 / (n - 1));
      parts.push('<circle class="pt-ring" cx="110" cy="110" r="' + radius.toFixed(1) + '"></circle>');
      var count = shells[i];
      var dot = count > 16 ? 1.5 : count > 8 ? 2.1 : 3;
      for (k = 0; k < count; k++) {
        var ang = -Math.PI / 2 + (k * 2 * Math.PI) / count;
        var x = 110 + radius * Math.cos(ang);
        var y = 110 + radius * Math.sin(ang);
        parts.push('<circle class="pt-electron" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + dot + '"></circle>');
      }
    }
    parts.push("</svg>");
    return parts.join("");
  }

  function factRow(label, value) {
    return "<dt>" + escapeHtml(label) + "</dt><dd>" + escapeHtml(value) + "</dd>";
  }

  function renderDetail(el) {
    var root = $("pt-detail");
    if (!root || !el) return;
    var meta = "Period " + el.period + " · Group " + el.group + " · " + el.block + " block · " + (FAMILY_LABEL[family(el)] || "");
    var facts = "";
    facts += factRow("Atomic mass", massText(el.mass));
    facts += factRow("Phase", el.phase || "—");
    facts += factRow("Density", densityText(el));
    facts += factRow("Melting point", tempText(el.melt));
    facts += factRow("Boiling point", tempText(el.boil));
    facts += factRow("Configuration", configText(el));
    facts += factRow("Electronegativity", el.en == null ? "—" : String(el.en));
    facts += factRow("Ionization", el.ion == null ? "—" : Math.round(el.ion) + " kJ/mol");
    facts += factRow("Covalent radius", el.covalent == null ? "—" : el.covalent + " pm");
    if (el.discovered) facts += factRow("Discovered by", el.discovered);
    var shells = (el.shells || []).join(", ");
    root.innerHTML =
      "<h3>" + escapeHtml(el.name) + "</h3>" +
      '<p class="pt-meta">' + escapeHtml(el.n + " · " + el.symbol + " · " + meta) + "</p>" +
      bohrSvg(el.shells || []) +
      '<p class="pt-shells">Electrons in each shell, from the nucleus outward: ' + escapeHtml(shells || "—") + "</p>" +
      '<p class="pt-lesson">' + escapeHtml(lesson(el)) + "</p>" +
      '<dl class="pt-facts">' + facts + "</dl>" +
      '<button type="button" class="pt-pair-go" id="pt-pair-this">Estimate a bond with ' + escapeHtml(el.name) + "</button>";
  }

  function select(symbol, focus) {
    var el = bySymbol[symbol];
    if (!el) return;
    selected = el;
    var i;
    for (i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute("data-symbol") === symbol;
      buttons[i].classList.toggle("is-on", on);
      buttons[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    renderDetail(el);
    if (focus) {
      var btn = document.querySelector('#pt-grid .pt-cell[data-symbol="' + symbol + '"]');
      if (btn) btn.focus();
    }
  }

  function predict(a, b) {
    var metalA = isMetal(a);
    var metalB = isMetal(b);
    var nobleA = family(a) === "noble";
    var nobleB = family(b) === "noble";
    if (nobleA && nobleB) {
      return {
        type: "No bond",
        text: "Two noble-gas atoms leave each other alone. Each outer shell is already full, so there is nothing to share or to transfer.",
      };
    }
    if (nobleA || nobleB) {
      var gas = nobleA ? a : b;
      var other = nobleA ? b : a;
      return {
        type: "Unlikely",
        text: gas.name + " already has a full outer shell, so a bond with " + other.name + " is not the ordinary case. A few heavy noble gases can be forced into compounds. Those are the exception.",
      };
    }
    if (metalA && metalB) {
      return {
        type: "Metallic",
        text: a.name + " and " + b.name + " are both metals. Their outer electrons enter a shared sea around the positive cores. That sea is the metallic bond. It conducts electricity, and the solid can bend.",
      };
    }
    var bothShare = !metalA && !metalB;
    if (a.en == null || b.en == null) {
      var missing = a.en == null ? a.name : b.name;
      if (bothShare) {
        return {
          type: "Covalent",
          text: "Pauling electronegativity is missing for " + missing + ". Two nonmetals usually share electrons, so the classroom guess is a covalent bond. It is an estimate, not a measurement.",
        };
      }
      return {
        type: "Ionic",
        text: "Pauling electronegativity is missing for " + missing + ". A metal beside a nonmetal usually gives electrons away, so the classroom guess is ionic. It is an estimate, not a measurement.",
      };
    }
    var gap = Math.abs(a.en - b.en);
    var gapText = "The electronegativity difference is " + (Math.round(gap * 100) / 100).toFixed(2) + ". ";
    var puller = a.en >= b.en ? a : b;
    var weaker = puller === a ? b : a;
    if (bothShare) {
      if (gap < 0.4) {
        return {
          type: "Nonpolar covalent",
          text: gapText + "The atoms pull about equally, so they share a pair and the pair sits in the middle. The bond is nonpolar covalent.",
        };
      }
      return {
        type: "Polar covalent",
        text: gapText + "They share a pair, and " + puller.name + " pulls that pair closer than " + weaker.name + " does. The bond stays covalent, and it is polar. Nonmetals do not hand the electron off as an ion.",
      };
    }
    if (gap > 1.7) {
      return {
        type: "Ionic",
        text: gapText + puller.name + " pulls hard enough that the electron is treated as transferred. " + weaker.name + " becomes the positive ion and " + puller.name + " becomes the negative ion. The attraction between the ions is the ionic bond. The 1.7 line is a classroom guide.",
      };
    }
    return {
      type: "Polar covalent",
      text: gapText + "A metal is involved, and the gap is still under 1.7, so the classroom rule calls the bond polar covalent rather than a full transfer. Real bonds of this kind sit on the line between sharing and giving.",
    };
  }

  function setPair(symbolA, symbolB) {
    var a = $("pt-a");
    var b = $("pt-b");
    if (a && symbolA) a.value = symbolA;
    if (b && symbolB) b.value = symbolB;
    renderBond();
  }

  function renderBond() {
    var root = $("pt-bond-result");
    var aSel = $("pt-a");
    var bSel = $("pt-b");
    if (!root || !aSel || !bSel) return;
    var a = bySymbol[aSel.value];
    var b = bySymbol[bSel.value];
    if (!a || !b) return;
    var call = predict(a, b);
    root.innerHTML =
      '<p class="pt-type">' + escapeHtml(call.type) + "</p>" +
      '<p class="pt-type-body">' + escapeHtml(a.name + " and " + b.name + ". " + call.text) + "</p>";
  }

  function moleculeSvg(mol) {
    var parts = ['<svg viewBox="0 0 190 116" role="img" aria-label="' + escapeHtml(mol.formula) + '">'];
    if (mol.sea) {
      parts.push('<rect class="pt-sea" x="18" y="34" width="154" height="48" rx="24"></rect>');
    }
    var i;
    for (i = 0; i < mol.bonds.length; i++) {
      var bond = mol.bonds[i];
      var p = mol.atoms[bond[0]];
      var q = mol.atoms[bond[1]];
      var order = bond[2];
      var dx = q.x - p.x;
      var dy = q.y - p.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len;
      var uy = dy / len;
      var px = -uy;
      var py = ux;
      var ax = p.x + ux * 16;
      var ay = p.y + uy * 16;
      var bx = q.x - ux * 16;
      var by = q.y - uy * 16;
      var offsets = order >= 3 ? [-3.5, 0, 3.5] : order === 2 ? [-2.6, 2.6] : [0];
      var k;
      for (k = 0; k < offsets.length; k++) {
        var off = offsets[k];
        var dash = order === 0 ? ' stroke-dasharray="3 3"' : "";
        parts.push(
          '<line class="pt-bond-line" x1="' + (ax + px * off).toFixed(1) +
          '" y1="' + (ay + py * off).toFixed(1) +
          '" x2="' + (bx + px * off).toFixed(1) +
          '" y2="' + (by + py * off).toFixed(1) + '"' + dash + "></line>"
        );
      }
    }
    for (i = 0; i < mol.atoms.length; i++) {
      var atom = mol.atoms[i];
      parts.push('<circle class="pt-atom" cx="' + atom.x + '" cy="' + atom.y + '" r="15"></circle>');
      parts.push('<text class="pt-atom-text" x="' + atom.x + '" y="' + (atom.y + 4) + '" text-anchor="middle">' + escapeHtml(atom.sym) + "</text>");
    }
    parts.push("</svg>");
    return parts.join("");
  }

  function showView(name) {
    var table = $("pt-table-view");
    var bonds = $("pt-bonds-view");
    var tableBtn = $("pt-view-table");
    var bondsBtn = $("pt-view-bonds");
    if (table) table.hidden = name !== "table";
    if (bonds) bonds.hidden = name !== "bonds";
    if (tableBtn) {
      tableBtn.classList.toggle("is-on", name === "table");
      tableBtn.setAttribute("aria-pressed", name === "table" ? "true" : "false");
    }
    if (bondsBtn) {
      bondsBtn.classList.toggle("is-on", name === "bonds");
      bondsBtn.setAttribute("aria-pressed", name === "bonds" ? "true" : "false");
    }
  }

  function buildLegend() {
    var host = $("pt-legend");
    if (!host || host.dataset.built) return;
    host.dataset.built = "1";
    host.innerHTML = FAMILIES.map(function (row) {
      return '<button type="button" data-family="' + row[0] + '" aria-pressed="false"><span class="pt-swatch" data-family="' + row[0] + '"></span>' + row[1] + "</button>";
    }).join("");
    host.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-family]");
      if (!btn || !host.contains(btn)) return;
      var next = btn.getAttribute("data-family");
      filter.family = filter.family === next ? "" : next;
      filter.group = 0;
      filter.row = 0;
      applyFilter();
    });
  }

  function buildLessons() {
    var host = $("pt-bond-lessons");
    if (!host || host.dataset.built) return;
    host.dataset.built = "1";
    host.className = "pt-lessons";
    host.innerHTML =
      '<article class="pt-card"><h3>Covalent</h3><p>A covalent bond is a shared pair of electrons. One pair is a single bond, two pairs are a double bond, and three pairs are a triple bond. Hydrogen and helium are full at two electrons. Other main-group atoms are taught as wanting eight in the outer shell. When the atoms pull equally, the bond is nonpolar. When one pulls harder, the pair sits closer to that atom and the bond is polar.</p></article>' +
      '<article class="pt-card"><h3>Ionic</h3><p>A metal that holds an outer electron loosely meets a nonmetal that attracts electrons strongly. The metal gives the electron away and becomes a positive ion. The nonmetal takes it and becomes a negative ion. Opposite charges hold the crystal. A Pauling gap above about 1.7, between a metal and a nonmetal, is the classroom sign of an ionic bond. The line is a guide.</p></article>' +
      '<article class="pt-card"><h3>Metallic</h3><p>Metal atoms release outer electrons into a shared sea. The positive cores stay in a lattice and the electrons move through it. That sea is why metals conduct electricity and heat, and why they can bend instead of shattering. Two metals together are estimated as a metallic bond.</p></article>';
  }

  function buildMolecules() {
    var host = $("pt-molecules");
    if (!host || host.dataset.built) return;
    host.dataset.built = "1";
    host.innerHTML = MOLECULES.map(function (mol) {
      return (
        '<button type="button" class="pt-mol" data-pair="' + mol.pair.join(",") + '">' +
        moleculeSvg(mol) +
        '<span class="pt-mol-kind">' + escapeHtml(mol.kind) + "</span>" +
        '<span class="pt-mol-name">' + escapeHtml(mol.name + " " + mol.formula) + "</span>" +
        '<span class="pt-mol-lesson">' + escapeHtml(mol.lesson) + "</span>" +
        "</button>"
      );
    }).join("");
    host.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-pair]");
      if (!btn) return;
      var parts = btn.getAttribute("data-pair").split(",");
      showView("bonds");
      setPair(parts[0], parts[1]);
      var result = $("pt-bond-result");
      if (result && result.scrollIntoView) result.scrollIntoView({ block: "nearest" });
    });
  }

  function buildPresets() {
    var host = $("pt-presets");
    if (!host || host.dataset.built) return;
    host.dataset.built = "1";
    var presets = [
      ["H", "H", "H–H"],
      ["H", "O", "O–H"],
      ["N", "N", "N–N"],
      ["C", "H", "C–H"],
      ["H", "F", "H–F"],
      ["Na", "Cl", "Na–Cl"],
      ["Mg", "O", "Mg–O"],
      ["Fe", "Fe", "Fe–Fe"],
    ];
    host.innerHTML = presets.map(function (row) {
      return '<button type="button" data-a="' + row[0] + '" data-b="' + row[1] + '">' + row[2] + "</button>";
    }).join("");
    host.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-a]");
      if (!btn) return;
      setPair(btn.getAttribute("data-a"), btn.getAttribute("data-b"));
    });
  }

  function buildSelects() {
    var html = elements.map(function (el) {
      return '<option value="' + el.symbol + '">' + el.n + " " + el.symbol + " " + escapeHtml(el.name) + "</option>";
    }).join("");
    var a = $("pt-a");
    var b = $("pt-b");
    if (a) a.innerHTML = html;
    if (b) b.innerHTML = html;
    if (a) a.value = "H";
    if (b) b.value = "O";
    renderBond();
  }

  function buildGrid() {
    var grid = $("pt-grid");
    if (!grid) return;
    var html = [];
    var g;
    for (g = 1; g <= 18; g++) {
      html.push('<button type="button" class="pt-ghead" data-group="' + g + '" style="grid-column:' + g + ';grid-row:1" title="' + escapeHtml(groupTitle(g)) + '">' + g + "</button>");
    }
    elements.forEach(function (el) {
      html.push(
        '<button type="button" class="pt-cell" data-n="' + el.n + '" data-symbol="' + el.symbol + '" data-family="' + family(el) + '" style="grid-column:' + el.x + ";grid-row:" + rowOf(el.y) + '" aria-label="' + escapeHtml(el.name) + ", atomic number " + el.n + '" aria-pressed="false">' +
        '<span class="pt-n">' + el.n + "</span>" +
        '<span class="pt-sym">' + el.symbol + "</span>" +
        "</button>"
      );
    });
    html.push('<button type="button" class="pt-seat" data-row="9" style="grid-column:3;grid-row:7" title="Lanthanides, lanthanum through lutetium">57–71</button>');
    html.push('<button type="button" class="pt-seat" data-row="10" style="grid-column:3;grid-row:8" title="Actinides, actinium through lawrencium">89–103</button>');
    html.push('<p class="pt-f-label" style="grid-column:1 / -1;grid-row:9">Lanthanides and actinides</p>');
    grid.innerHTML = html.join("");
    buttons = Array.prototype.slice.call(grid.querySelectorAll(".pt-cell"));
    grid.addEventListener("click", function (e) {
      var head = e.target.closest(".pt-ghead");
      if (head) {
        var group = parseInt(head.getAttribute("data-group"), 10);
        filter.group = filter.group === group ? 0 : group;
        filter.family = "";
        filter.row = 0;
        applyFilter();
        return;
      }
      var seat = e.target.closest(".pt-seat");
      if (seat) {
        var seatRow = parseInt(seat.getAttribute("data-row"), 10);
        filter.row = filter.row === seatRow ? 0 : seatRow;
        filter.family = "";
        filter.group = 0;
        applyFilter();
        var label = grid.querySelector(".pt-f-label");
        if (label && label.scrollIntoView) label.scrollIntoView({ block: "nearest", inline: "start" });
        return;
      }
      var cell = e.target.closest(".pt-cell");
      if (!cell) return;
      select(cell.getAttribute("data-symbol"), false);
    });
    grid.addEventListener("keydown", function (e) {
      if (!selected) return;
      var dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      var dy = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
      if (!dx && !dy) return;
      var next = null;
      var i;
      for (i = 0; i < elements.length; i++) {
        if (elements[i].x === selected.x + dx && elements[i].y === selected.y + dy) next = elements[i];
      }
      if (!next) return;
      e.preventDefault();
      select(next.symbol, true);
    });
  }

  function build() {
    if (built) return;
    built = true;
    buildLegend();
    buildLessons();
    buildMolecules();
    buildPresets();
    buildGrid();
    buildSelects();
    bindChrome();
    select("C", false);
    applyFilter();
  }

  function bindChrome() {
    var shell = document.querySelector("#panel-periodic .pt-shell");
    if (!shell || shell.dataset.bound) return;
    shell.dataset.bound = "1";
    var tableBtn = $("pt-view-table");
    var bondsBtn = $("pt-view-bonds");
    if (tableBtn) tableBtn.addEventListener("click", function () { showView("table"); });
    if (bondsBtn) bondsBtn.addEventListener("click", function () { showView("bonds"); });
    var search = $("pt-search");
    if (search) {
      search.addEventListener("input", function () {
        filter.q = String(search.value || "").trim().toLowerCase();
        applyFilter();
        var exact = null;
        var hits = [];
        var i;
        for (i = 0; i < elements.length; i++) {
          if (!matches(elements[i])) continue;
          hits.push(elements[i]);
          if (elements[i].symbol.toLowerCase() === filter.q) exact = elements[i];
        }
        if (exact) select(exact.symbol, false);
        else if (hits.length === 1) select(hits[0].symbol, false);
      });
      search.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        var i;
        for (i = 0; i < elements.length; i++) {
          if (matches(elements[i])) {
            e.preventDefault();
            select(elements[i].symbol, false);
            return;
          }
        }
      });
    }
    var detail = $("pt-detail");
    if (detail) {
      detail.addEventListener("click", function (e) {
        var btn = e.target.closest("#pt-pair-this");
        if (!btn || !selected) return;
        showView("bonds");
        setPair(selected.symbol, null);
        var result = $("pt-bond-result");
        if (result && result.scrollIntoView) result.scrollIntoView({ block: "nearest" });
      });
    }
    var a = $("pt-a");
    var b = $("pt-b");
    if (a) a.addEventListener("change", renderBond);
    if (b) b.addEventListener("change", renderBond);
  }

  function onShow() {
    bindChrome();
    if (built) return;
    if (!loading) {
      loading = fetch("data/periodic/elements.json", { cache: "force-cache" })
        .then(function (r) {
          if (!r.ok) throw new Error("elements");
          return r.json();
        })
        .then(function (rows) {
          elements = rows;
          bySymbol = {};
          rows.forEach(function (el) { bySymbol[el.symbol] = el; });
          build();
        })
        .catch(function () {
          var detail = $("pt-detail");
          if (detail) detail.innerHTML = '<p class="pt-status">The elements did not load.</p>';
        });
    }
  }

  document.addEventListener("periodic-show", onShow);
  window.Periodic = { onShow: onShow };
})();
