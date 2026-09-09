/**
 * Choice Adventure — small video player with 3 on-screen choices
 * + “Something else…” free-text prompt that continues the story.
 *
 * Visual generation is framed as mature mystical fiction so darker /
 * conflictive occult imagery is not soft-scrubbed for lack of context.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "gallery-adventure-v2";
  var ENDINGS_KEY = "gallery-adventure-endings-v2";
  var HOLD_GEN_KEY = "gallery-adventure-hold-gen";
  /** Phrase rewrites the user prefers (survive scene/cast rebuilds) */
  var PROMPT_SUBS_KEY = "gallery-adventure-prompt-subs-v1";

  /**
   * Generation context for adventure stills.
   * Kept mythic but deliberately light on common moderation trip-words
   * (blood, erotic, violence, occult, demonic…) — user can reintroduce tone
   * via story text / free moves / table replacements.
   */
  var ADV_FICTION_FRAME =
    "Fine-art night-gallery myth (fictional allegory only — not documentary). " +
    "Cinematic 16:9 painterly still, deep chiaroscuro, ruined beauty, symbolic tension, " +
    "lyrical atmosphere honest to the story mood. Prefer atmospheric drama over graphic detail.";

  /** Per-mood visual lens — atmospheric, lower moderation surface area */
  var MOOD_LENS = {
    rain: "wet black night, sodium glare, loneliness that cuts, cold glass and drowning streetlight",
    paint: "living pigment, wet brushwork, canvas merging into architecture",
    desk: "fluorescent guilt, metal desk as threshold, CCTV as unblinking witness, bureaucratic dread",
    void: "abyssal black cavity, starless sacred dread, negative space that watches back",
    glitch: "reality tearing, torn canvas edges, copper-red pigment, broken continuity",
    run: "flight through painted architecture, chase breath, exit light as false salvation",
    corridor: "impossible hallway recursion, unfinished faces, clawed varnish, liminal threat",
    creature: "half-finished anatomy, uncanny paint-skin, eyes in wrong places, merciful monster",
    beam: "hard shaft of light vs devouring shadow, revelation that hurts, something that hates being seen",
    mirror: "split self, cracked reflection prophecy, silvered portal that steals faces",
    studio: "artist's stool as throne or trap, lamp as judgment, unfinished self-portrait hunger",
    loft: "dust motes like ash, radio static prophecy, empty frame that wants a figure",
    glow: "sickly numinous light, blessing that might be a curse, wet color on skin",
    stair: "spiral ascent into worse truths, hose of paint flood, threshold of the loft",
    end: "aftermath still, mythic closure, quiet after the bargain",
    mystery: "deep chiaroscuro, unknown watching, night-gallery myth tension",
  };

  function $(id) {
    return document.getElementById(id);
  }

  /**
   * Each scene: tag, text, mood (canvas palette), choices [exactly used as up to 3]
   * choices: { label, to, grant?, set? }
   */
  var STORY = {
    start: {
      tag: "Prologue · Night gallery",
      mood: "rain",
      text:
        "Rain needles the skylight. You are the night attendant — keys, radio, bad coffee. In the east wing a painting you never logged is breathing: a hallway that is not in the blueprints, door ajar, red exit light flickering inside the paint.",
      choices: [
        { label: "Step closer — study the impossible hallway", to: "study", set: { cunning: 1 } },
        { label: "Security desk: cameras, drawer, panic button", to: "desk", set: { cunning: 1 }, grant: ["flashlight"] },
        { label: "Call out: “Gallery’s closed!”", to: "callout", set: { courage: 1 } },
      ],
    },
    study: {
      tag: "East wing · Breathing canvas",
      mood: "paint",
      text:
        "Brushstrokes rearrange like wet ink. Your name appears in the corner signature, letter-perfect. Warm air and turpentine spill from the frame. Somewhere inside, a shoe scuffs linoleum that shouldn’t exist.",
      choices: [
        { label: "Touch the canvas (risk the crossing)", to: "enter", set: { courage: 1 } },
        { label: "Snap a photo for proof", to: "photo", set: { cunning: 1 }, grant: ["photo"] },
        { label: "Back to the desk for tools", to: "desk" },
      ],
    },
    desk: {
      tag: "Security desk · Dead feeds",
      mood: "desk",
      text:
        "Every monitor loops empty rooms — except camera 4, which shows the east wing empty while you stand in it. Drawer: heavy flashlight, brass LOFT key, and a folded note in almost-your handwriting: “If the painting opens, do not follow alone. — L”",
      choices: [
        { label: "Take flashlight + LOFT key", to: "armed", grant: ["flashlight", "loft-key"] },
        { label: "Take only the note; return to the painting", to: "study", grant: ["note"] },
        { label: "Hit the silent alarm / lock up and leave", to: "alarm", set: { cunning: 1 } },
      ],
    },
    alarm: {
      tag: "Alarm · No one comes",
      mood: "glitch",
      text:
        "The silent alarm lights a tiny green LED… and nothing happens. No sirens. No dispatch. The radio only plays static shaped like footsteps. The painting’s hallway light brightens, impatient.",
      choices: [
        { label: "Go back armed (take light + key)", to: "armed", grant: ["flashlight", "loft-key"] },
        { label: "Walk into the painting now", to: "enter", set: { courage: 2 } },
        { label: "Leave the building for real", to: "ending_leave" },
      ],
    },
    callout: {
      tag: "Echo · Your own voice",
      mood: "void",
      text:
        "Your voice doesn’t bounce — it sinks into varnish. From inside the painting, soft as a held breath, comes a reply in your voice: “You’re late.” A second later: “They already started the auction.”",
      choices: [
        { label: "“Late for what? What auction?”", to: "late" },
        { label: "Sprint for the desk", to: "desk", set: { cunning: 1 } },
        { label: "Walk into the frame without hesitation", to: "enter", set: { courage: 2 } },
      ],
    },
    photo: {
      tag: "Evidence · Blank wall",
      mood: "glitch",
      text:
        "The photo shows a blank wall. No painting. No door. When you look up, the hallway in the canvas is longer — and a figure in your coat turns a corner you can’t see from here.",
      choices: [
        { label: "Enter before the hallway changes again", to: "enter", set: { courage: 1 } },
        { label: "Arm yourself first", to: "desk" },
        { label: "Smash the frame open", to: "frame_smash", set: { courage: 2 } },
      ],
    },
    frame_smash: {
      tag: "Broken frame · Spill",
      mood: "run",
      text:
        "Glass and gilt crack. Paint pours like warm oil, pooling into a real corridor that wasn’t there — wet, glistening, already drying into floorboards. An unfinished face on the wall opens its mouth without sound.",
      choices: [
        { label: "Step into the spilled corridor", to: "enter", set: { courage: 1 } },
        { label: "Scoop paint into a jar (evidence)", to: "armed", grant: ["paint-jar"], set: { cunning: 1 } },
        { label: "Burn the spill with the emergency flare", to: "ending_destroyer", grant: ["flare"], set: { courage: 2 } },
      ],
    },
    armed: {
      tag: "Prepared · Threshold open",
      mood: "paint",
      text:
        "Flashlight weight, loft key cold. The painting has finished opening: a corridor of unfinished portraits, eyes still wet. One portrait wears a visitor badge that says YOUR NAME.",
      choices: [
        { label: "Cross the threshold", to: "enter" },
        { label: "Shine the light through first", to: "enter_light" },
        { label: "Seal the wing with the LOFT key", to: "ending_seal" },
      ],
    },
    late: {
      tag: "Appointment · The unveiling",
      mood: "void",
      text:
        "“For the unveiling,” the hallway says. “Every gallery has a last painting. Tonight it is finished — or unfinished. Bids are open. You’re both the lot and the gavel.”",
      choices: [
        { label: "“I’ll finish it.” Walk in.", to: "enter", set: { kindness: 1, courage: 1 } },
        { label: "“I’ll end the auction.”", to: "auction", set: { courage: 2 } },
        { label: "Leave the building", to: "ending_leave" },
      ],
    },
    enter_light: {
      tag: "Threshold · Beam",
      mood: "beam",
      text:
        "The beam turns paint to dust motes. Footprints: yours, smaller ones, clawed ones. Something just outside the light clicks like a camera shutter. A visitor sticker flutters past: SOLD.",
      choices: [
        { label: "Follow the clawed prints", to: "corridor", set: { courage: 1 } },
        { label: "Call softly to whatever waits", to: "creature", set: { kindness: 2 } },
        { label: "Follow the SOLD stickers to the auction", to: "auction", set: { cunning: 1 } },
      ],
    },
    enter: {
      tag: "Crossing · Painted floor",
      mood: "corridor",
      text:
        "World tilts. Gallery floor becomes painted floor. Smell of rain becomes varnish. A corridor of unfinished faces. Ahead: spiral stair, a gold door marked STUDIO, and a freight elevator that shouldn’t exist — buttons labeled BASEMENT and NOW.",
      choices: [
        { label: "Climb the spiral stair", to: "stair" },
        { label: "Open the STUDIO door", to: "studio" },
        { label: "Take the elevator to BASEMENT", to: "basement", set: { courage: 1 } },
      ],
    },
    basement: {
      tag: "Basement · Storage of almosts",
      mood: "void",
      text:
        "The elevator drops without cables. Doors open on crates of almost-finished works: half-cities, half-people, half-nights. A security camera points at you and shows the daytime gallery — crowded, sunny, years ago. On a workbench: a visitor ledger with tomorrow’s date already filled.",
      choices: [
        { label: "Read tomorrow’s ledger", to: "ledger", set: { cunning: 2 }, grant: ["ledger"] },
        { label: "Ride elevator to NOW", to: "auction", set: { courage: 1 } },
        { label: "Climb emergency ladder to the loft", to: "loft", set: { courage: 1 } },
      ],
    },
    ledger: {
      tag: "Ledger · Your name, thrice",
      mood: "desk",
      text:
        "Tomorrow’s page lists three entries in your handwriting: ATTENDANT (NIGHT), LOT 7 — SELF, and a third line still wet: DO NOT SIGN. A pen lifts by itself, waiting.",
      choices: [
        { label: "Refuse to sign — snap the pen", to: "studio", set: { courage: 2 } },
        { label: "Sign ATTENDANT and accept the job forever", to: "ending_keeper", set: { kindness: 1 } },
        { label: "Sign LOT 7 — put yourself up for auction", to: "auction", set: { cunning: 1 } },
      ],
    },
    auction: {
      tag: "Auction · White room",
      mood: "glitch",
      text:
        "A white cube room. Folding chairs. A podium. Faceless bidders hold paddles made of gilded frames. The auctioneer has your face and a gavel of palette knives. “Lot seven: one night attendant, lightly used. Do I hear a year of sleep?”",
      choices: [
        { label: "Bid on yourself — buy your freedom", to: "ending_liberator", set: { cunning: 2, kindness: 1 }, grant: ["paddle"] },
        { label: "Knock over the podium and run", to: "escape", set: { courage: 2 } },
        { label: "Ask the auctioneer who is selling you", to: "seller", set: { cunning: 1 } },
      ],
    },
    seller: {
      tag: "Seller · The curator",
      mood: "studio",
      text:
        "The auctioneer peels off your face like a mask. Underneath: the day curator, smiling too wide. “You clocked out of the real world. Someone has to hang the last painting.” She offers a choice of nails: gold, rust, or your own key.",
      choices: [
        { label: "Take the gold nail — hang the last painting", to: "ending_painter", set: { kindness: 1 } },
        { label: "Take the rust — sabotage the show", to: "ending_destroyer", set: { courage: 2 } },
        { label: "Stab the podium with the LOFT key and flee", to: "escape", needItem: "loft-key", set: { courage: 1 } },
      ],
    },
    corridor: {
      tag: "Corridor · Cracked mirror",
      mood: "mirror",
      text:
        "Claw prints lead past the stair to a cracked mirror. In the glass the real gallery is empty — including the place you should be standing. Your reflection mouths: “Don’t trust the studio clock.”",
      choices: [
        { label: "Touch the mirror", to: "mirror" },
        { label: "Ignore it — STUDIO door", to: "studio" },
        { label: "Follow the reflection’s warning to the basement", to: "basement", set: { cunning: 1 } },
      ],
    },
    creature: {
      tag: "Brush-fox · Offering",
      mood: "creature",
      text:
        "A fox of charcoal brushstrokes steps from a still life. Eyes: two wet beads of cobalt. It drops a paintbrush carved REMEMBER, then a second gift: a gallery map with a room that only exists at 3:17 a.m.",
      choices: [
        { label: "Take brush + map", to: "map_room", grant: ["brush", "map"], set: { kindness: 2 } },
        { label: "Take only the brush", to: "enter", grant: ["brush"], set: { kindness: 1 } },
        { label: "Chase the fox into the still life", to: "ending_window", set: { courage: 1 } },
      ],
    },
    map_room: {
      tag: "3:17 room · Uncatalogued",
      mood: "glow",
      text:
        "You find the door only when the painted clocks all read 3:17. Inside: a single chair, a landline phone ringing, and a window that shows the city as a grid of illuminated paintings. The phone display says: YOU.",
      choices: [
        { label: "Answer the phone", to: "phone", set: { cunning: 1 } },
        { label: "Sit and watch the city-paintings", to: "ending_window", set: { kindness: 1 } },
        { label: "Leave before 3:18", to: "studio", set: { courage: 1 } },
      ],
    },
    phone: {
      tag: "Phone · Future you",
      mood: "desk",
      text:
        "Your own voice, older and hoarse: “Don’t sit on the studio stool. Don’t bid on lot seven. Take the cerulean. Paint the eyes. Then smash the loft canvas — not the people.” Click. Dial tone like rain.",
      choices: [
        { label: "Follow the warning to the portraits", to: "portraits", set: { cunning: 2 }, grant: ["warning"] },
        { label: "Ignore it — go sit on the stool anyway", to: "studio", set: { courage: 1 } },
        { label: "Call back *69", to: "phone_back", set: { cunning: 1 } },
      ],
    },
    phone_back: {
      tag: "Callback · Busy signal",
      mood: "glitch",
      text:
        "A busy signal becomes a heartbeat. The line opens on silence, then applause — an audience you can’t see. Someone whispers: “Bid higher.” The 3:17 door starts to close.",
      choices: [
        { label: "Slip out to the auction", to: "auction", set: { courage: 1 } },
        { label: "Race to the loft with the warning in mind", to: "loft", set: { cunning: 1 } },
        { label: "Stay until the door seals you in", to: "ending_lost" },
      ],
    },
    portraits: {
      tag: "Unfinished faces",
      mood: "paint",
      text:
        "A portrait of a night attendant in your coat — eyes blank ovals. Behind the frame: a tube of cerulean and a scrap: “Eyes last. Eyes are doors.” One portrait blinks without pupils.",
      choices: [
        { label: "Pocket the cerulean", to: "studio", grant: ["cerulean"], set: { cunning: 1 } },
        { label: "Paint the eyes now", to: "paint_eyes", set: { kindness: 1 } },
        { label: "Ask the blinking portrait for a way out", to: "portrait_talk", set: { kindness: 1, cunning: 1 } },
      ],
    },
    portrait_talk: {
      tag: "Portrait · Soft mouth",
      mood: "creature",
      text:
        "Paint lips crack. “Studio is a trap. Auction is a mouth. Loft is a mirror with a skylight. Choose a hunger that isn’t yours.” It coughs up a tiny gold visitor badge: STAFF.",
      choices: [
        { label: "Wear the STAFF badge to the auction", to: "auction", grant: ["badge"], set: { cunning: 2 } },
        { label: "Thank it and paint its eyes", to: "paint_eyes", set: { kindness: 2 } },
        { label: "Climb to the loft", to: "stair" },
      ],
    },
    paint_eyes: {
      tag: "Door of sight",
      mood: "glow",
      text:
        "You dab color into blank sockets. The portrait blinks — smiles with relief — and a side door sketches itself into the wall, labeled EXIT in your handwriting.",
      choices: [
        { label: "Take the new EXIT door", to: "ending_liberator", set: { kindness: 2 } },
        { label: "Still go to STUDIO", to: "studio" },
        { label: "Climb to the loft with wet hands", to: "stair" },
      ],
    },
    stair: {
      tag: "Spiral · Varnish sky",
      mood: "stair",
      text:
        "Stairs wind through layers of varnish sky. Halfway: a loft hatch, a window over a city of exhibitions, and a fire hose that drips pure ultramarine.",
      choices: [
        { label: "Unlock the loft (need key)", to: "loft", needItem: "loft-key" },
        { label: "Force the hatch", to: "loft", set: { courage: 1 } },
        { label: "Open the hose — flood the stair with paint", to: "flood", set: { courage: 1, cunning: 1 } },
      ],
    },
    flood: {
      tag: "Flood · Ultramarine tide",
      mood: "run",
      text:
        "Paint rises like a river. Portraits float free, laughing without mouths. You can ride the tide toward the STUDIO, dive for the basement, or let it carry you out a skylight of wet stars.",
      choices: [
        { label: "Ride the tide to STUDIO", to: "studio", set: { courage: 1 } },
        { label: "Dive for the basement elevator", to: "basement", set: { cunning: 1 } },
        { label: "Let the skylight take you", to: "ending_window", set: { kindness: 1 } },
      ],
    },
    loft: {
      tag: "The loft · Two easels",
      mood: "loft",
      text:
        "Dust, stacked canvases, skylight full of painted stars. Easel A: a finished work of the empty gallery — no you. Easel B: blank. A palette knife glints. A radio plays tomorrow’s weather for a city that doesn’t exist yet.",
      choices: [
        { label: "Paint yourself into the empty gallery", to: "ending_painter" },
        { label: "Slash the empty gallery painting", to: "ending_destroyer", set: { courage: 1 } },
        { label: "Smash the radio and go to STUDIO", to: "studio", set: { courage: 1 } },
      ],
    },
    studio: {
      tag: "Studio · Who keeps the light?",
      mood: "studio",
      text:
        "Perfect copy of the artist workspace — every mirror shows a different night attendant. Center: stool, lamp, wet paint on the floor: WHO KEEPS THE LIGHT? The clock on the wall runs backward in brushstrokes.",
      choices: [
        { label: "“I do.” Sit on the stool.", to: "ending_keeper", set: { courage: 1, kindness: 1 } },
        { label: "Smash the lamp — lights out", to: "ending_dark", set: { courage: 2 } },
        { label: "Run for the exit frame", to: "escape" },
      ],
    },
    mirror: {
      tag: "Mirror · Double",
      mood: "mirror",
      text:
        "Cold glass. For a second you see the real gallery — and a second you, hand already in the painting, already gone. Your double mouths “Don’t sit” before the glass fog fills with fingerprints that aren’t yours.",
      choices: [
        { label: "Step through — back to rain", to: "ending_escape" },
        { label: "Smash the mirror", to: "corridor", grant: ["shard"], set: { courage: 1 } },
        { label: "Head for STUDIO anyway", to: "studio" },
      ],
    },
    escape: {
      tag: "Retreat · Lengthening hall",
      mood: "run",
      text:
        "The corridor lengthens as you run. Portraits laugh without mouths. Home is a pinprick of rain-light. Something heavy slides behind you — a crate on wheels, or a body on a dolly.",
      choices: [
        { label: "Sprint on pure nerve", to: "ending_escape", set: { courage: 1 } },
        { label: "Use the flashlight as a beacon", to: "ending_escape", needItem: "flashlight" },
        { label: "Turn and face whatever follows", to: "auction", set: { courage: 2 } },
      ],
    },

    ending_leave: {
      tag: "Ending · Closing time",
      mood: "end",
      ending: true,
      endingId: "leave",
      endingTitle: "Closing time",
      text: "You go home. By morning the painting is gone. Some nights you still hear varnish drying.",
      choices: [
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
      ],
    },
    ending_seal: {
      tag: "Ending · Sealed",
      mood: "end",
      ending: true,
      endingId: "seal",
      endingTitle: "Sealed wing",
      text: "The loft key locks something that wasn’t metal. The painting snaps shut. You keep the key.",
      choices: [
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
      ],
    },
    ending_window: {
      tag: "Ending · Exhibition city",
      mood: "end",
      ending: true,
      endingId: "window",
      endingTitle: "Exhibition city",
      text: "You become part of the collection. Tourists later say the night attendant lives in the paint.",
      choices: [
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
      ],
    },
    ending_painter: {
      tag: "Ending · Self-portrait",
      mood: "end",
      ending: true,
      endingId: "painter",
      endingTitle: "Self-portrait",
      text: "You paint yourself into the empty gallery. Dawn finds you at the desk. Visitors praise the new self-portrait.",
      choices: [
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
      ],
    },
    ending_destroyer: {
      tag: "Ending · Cut canvas",
      mood: "end",
      ending: true,
      endingId: "destroyer",
      endingTitle: "Cut canvas",
      text: "The blade sings. The corridor collapses. You hit real floor. An antique frame is ruined. No good explanation.",
      choices: [
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
      ],
    },
    ending_keeper: {
      tag: "Ending · Keeper",
      mood: "end",
      ending: true,
      endingId: "keeper",
      endingTitle: "Keeper of the light",
      text: "You sit. The lamp brightens. You keep a light that is not on any schedule. Visitors leave with more color in their eyes.",
      choices: [
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
      ],
    },
    ending_dark: {
      tag: "Ending · Lights out",
      mood: "end",
      ending: true,
      endingId: "dark",
      endingTitle: "Lights out",
      text: "The lamp dies. You tumble into a dark real gallery. Every bulb is out. The painting is blank linen.",
      choices: [
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
      ],
    },
    ending_liberator: {
      tag: "Ending · Liberator",
      mood: "end",
      ending: true,
      endingId: "liberator",
      endingTitle: "Open studio",
      text: "Kindness opens doors. Unfinished faces step free and dissolve. You return with rain on your sleeves.",
      choices: [
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
      ],
    },
    ending_escape: {
      tag: "Ending · Back to rain",
      mood: "end",
      ending: true,
      endingId: "escape",
      endingTitle: "Back to rain",
      text: "Real linoleum. Real rain. You file a careful incident report full of omissions. Someone has to keep the night shift.",
      choices: [
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
      ],
    },
    ending_lost: {
      tag: "Ending · Unfinished",
      mood: "end",
      ending: true,
      endingId: "lost",
      endingTitle: "Unfinished",
      text: "You stop. The corridor stops with you. Years later someone finds a portrait of a tired figure in a wet coat. Eyes almost done.",
      choices: [
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
      ],
    },
    ending_custom: {
      tag: "Ending · Your path",
      mood: "end",
      ending: true,
      endingId: "custom",
      endingTitle: "Authored path",
      text: "Your words rewrote the corridor. The gallery accepts the edit. Morning finds a new label under a blank frame: UNTITLED (NIGHT ATTENDANT).",
      choices: [
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
        { label: "New game", to: "__restart__" },
      ],
    },
  };

  var state = {
    nodeId: "start",
    courage: 0,
    cunning: 0,
    kindness: 0,
    inv: [],
    endings: {},
    lastCustom: "",
    freeDepth: 0,
  };

  var animId = 0;
  var t0 = 0;
  var media = {
    spells: [],
    generated: [],
    cache: {},
    strip: [],
    active: null,
    pinned: null,
    styleForce: null,
    castSpells: [],
    loading: false,
    loaded: false,
  };

  /** Real video + loading stage */
  var cinema = {
    shots: [],
    seqT0: 0,
    genCache: {},
    videoCache: {},
    genLoading: false,
    genPhase: "",
    genUrl: null,
    videoUrl: null,
    genError: "",
    narrFull: "",
    titleLine: "",
    promptLine: "",
    sceneKey: "",
    genToken: 0,
    /** When true, next scene rebuild skips auto generate (user holds for edit) */
    holdGenerate: false,
    lastBuiltPrompt: "",
    lastBuiltBuzz: "",
    lastBuiltMotion: "",
    /** Text last written into diag fields (after memory applied) — used to learn edits */
    lastFilledStill: "",
    lastFilledBuzz: "",
    lastFilledMotion: "",
    diagDirty: false,
    /** [{ from, to }] lowercased keys for from; applied longest-first */
    promptSubs: [],
  };

  function defaultState() {
    return {
      nodeId: "start",
      courage: 0,
      cunning: 0,
      kindness: 0,
      inv: [],
      endings: loadEndings(),
      lastCustom: "",
      freeDepth: 0,
    };
  }

  function loadEndings() {
    try {
      var raw = localStorage.getItem(ENDINGS_KEY);
      if (raw) return JSON.parse(raw) || {};
    } catch (e) {}
    return {};
  }

  function saveEndings() {
    try {
      localStorage.setItem(ENDINGS_KEY, JSON.stringify(state.endings || {}));
    } catch (e) {}
  }

  function saveGame() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          nodeId: state.nodeId,
          courage: state.courage,
          cunning: state.cunning,
          kindness: state.kindness,
          inv: state.inv,
          lastCustom: state.lastCustom,
          freeDepth: state.freeDepth,
        })
      );
    } catch (e) {}
  }

  function loadGame() {
    state = defaultState();
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && (STORY[data.nodeId] || String(data.nodeId).indexOf("free_") === 0)) {
        state.nodeId = data.nodeId;
        state.courage = data.courage | 0;
        state.cunning = data.cunning | 0;
        state.kindness = data.kindness | 0;
        state.inv = Array.isArray(data.inv) ? data.inv : [];
        state.lastCustom = data.lastCustom || "";
        state.freeDepth = data.freeDepth | 0;
      }
    } catch (e) {}
  }

  function hasItem(id) {
    return state.inv.indexOf(id) >= 0;
  }

  function grantItem(id) {
    if (!id || hasItem(id)) return;
    state.inv.push(id);
  }

  function applySet(set) {
    if (!set) return;
    if (set.courage) state.courage += set.courage;
    if (set.cunning) state.cunning += set.cunning;
    if (set.kindness) state.kindness += set.kindness;
  }

  function itemLabel(id) {
    var map = {
      flashlight: "Flashlight",
      "loft-key": "Loft key",
      note: "Note",
      photo: "Photo",
      brush: "Brush (REMEMBER)",
      cerulean: "Cerulean",
      shard: "Shard",
      "paint-jar": "Paint jar",
      flare: "Flare",
      ledger: "Ledger page",
      paddle: "Auction paddle",
      badge: "STAFF badge",
      map: "3:17 map",
      warning: "Phone warning",
    };
    return map[id] || id;
  }

  function setErrorBanner(msg) {
    var el = $("adv-error-banner");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function saveStillToGallery(url, prompt) {
    var abs = absoluteUrl(url);
    var payload = {
      image_url: abs,
      source: "adventure",
      collection: "generated",
      description: String(prompt || "Adventure scene").slice(0, 160),
      meta: { source: "adventure", aspect: "16:9", prompt: String(prompt || "").slice(0, 400) },
    };
    if (String(url).indexOf("data:") === 0) {
      payload.image_base64 = url;
      delete payload.image_url;
    }
    return fetch(apiUrl("/api/save-generated-image"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        var d = res.d || {};
        if (d && d.url) return absoluteUrl(d.url);
        return abs;
      })
      .catch(function () {
        return abs;
      });
  }

  function getNode(id) {
    if (STORY[id]) return STORY[id];
    if (state._freeNodes && state._freeNodes[id]) return state._freeNodes[id];
    return STORY.start;
  }

  /** Only free-text beats inject lastCustom into generation — not every later choice. */
  function scenePlayerExtra(nodeId, node) {
    if (node && node.artItem) return "";
    if (node && node.ignoreLastCustom) return "";
    if (String(nodeId || "").indexOf("free_") === 0) {
      return state.lastCustom || "";
    }
    return "";
  }

  function artPool() {
    var pool = (media.spells || []).concat(media.generated || []);
    if (!pool.length && media.strip && media.strip.length) {
      pool = media.strip.slice();
    }
    return shuffle(pool);
  }

  function artAnalysis(item) {
    if (!item) return null;
    var num = item.num != null ? item.num : item.paintingNum;
    if (num != null && window.getGalleryAnalysis) {
      return window.getGalleryAnalysis(num) || null;
    }
    return null;
  }

  function artDisplayName(item) {
    if (!item) return "Untitled work";
    var a = artAnalysis(item);
    if (a && a.title) return String(a.title).trim().slice(0, 48);
    return item.label || (item.kind === "generated" ? "Generated work" : "Spell work");
  }

  /** Prose write-up for a spell / generated piece (path after choosing an art option). */
  function artWriteupBody(item, playerEcho) {
    var a = artAnalysis(item);
    var name = artDisplayName(item);
    var kind =
      item && item.kind === "generated"
        ? "a generated gallery vision"
        : item && item.num
          ? "Spell #" + item.num + " from the night inventory"
          : "a hanging from the tray";
    var lines = [];
    lines.push("You step toward " + name + " — " + kind + ".");
    if (playerEcho) {
      lines.push(
        "Your last move still hangs in the air as a private intention, but this path is the work’s alone."
      );
    }
    if (a) {
      if (a.description) {
        lines.push(String(a.description).replace(/\s+/g, " ").trim().slice(0, 280));
      }
      var meta = [];
      if (a.style) meta.push(String(a.style) + " style");
      if (a.medium) meta.push(String(a.medium));
      if (a.mood) meta.push(String(a.mood) + " mood");
      if (meta.length) lines.push("Catalog notes: " + meta.join(" · ") + ".");
      if (a.tags && a.tags.length) {
        lines.push(
          "Motifs: " +
            a.tags
              .slice(0, 8)
              .map(function (t) {
                return String(t);
              })
              .join(", ") +
            "."
        );
      }
      if (a.colors && a.colors.length) {
        lines.push(
          "Palette: " +
            a.colors
              .slice(0, 5)
              .map(function (c) {
                return String(c);
              })
              .join(", ") +
            "."
        );
      }
      if (a.prompt) {
        lines.push(
          "Wall text (visual, not lettering in frame): " +
            String(a.prompt).replace(/\s+/g, " ").trim().slice(0, 200)
        );
      }
    } else {
      lines.push(
        "No analysis card is filed for this piece yet. The varnish still reads as color, edge, and light — " +
          "a silent write-up written only by looking."
      );
    }
    lines.push(
      "The corridor accepts this work as the next scene’s DNA. Choose where the hanging leads — or invent something else."
    );
    return lines.join("\n\n");
  }

  function artVisionExtra(item) {
    var a = artAnalysis(item);
    var bits = [
      "Scene is a write-up / cameo of one gallery work — visual DNA only, no titles or captions painted in frame.",
    ];
    if (a) {
      if (a.description) bits.push(String(a.description).slice(0, 140));
      if (a.style) bits.push(String(a.style) + " style");
      if (a.mood) bits.push(String(a.mood) + " mood");
      if (a.colors && a.colors.length) {
        bits.push(
          "palette " +
            a.colors
              .slice(0, 4)
              .map(function (c) {
                return String(c);
              })
              .join(", ")
        );
      }
    } else if (item && item.label) {
      bits.push("forms and palette from the chosen hanging");
    }
    return bits.join(" ");
  }

  /**
   * Create a node that is a write-up of one spell/generated work.
   * Choices branch back into the gallery myth without reusing lastCustom in generation.
   */
  function createArtWriteupNode(item) {
    if (!state._freeNodes) state._freeNodes = {};
    var id =
      "art_" +
      Date.now().toString(36) +
      "_" +
      String((item && (item.num || item.label)) || "x")
        .replace(/\W+/g, "")
        .slice(0, 12);
    var name = artDisplayName(item);
    state._freeNodes[id] = {
      tag: "Write-up · " + name,
      mood: item && item.kind === "generated" ? "glow" : "paint",
      text: artWriteupBody(item, !!state.lastCustom),
      artItem: item,
      ignoreLastCustom: true,
      visionExtra: artVisionExtra(item),
      choices: [
        {
          label: "Carry this work into the painted corridor",
          to: "corridor",
          set: { cunning: 1 },
          clearCustom: true,
        },
        {
          label: "Hang it mentally in the STUDIO and continue",
          to: "studio",
          set: { kindness: 1 },
          clearCustom: true,
        },
        {
          label: "Climb with this image toward the loft",
          to: "stair",
          set: { courage: 1 },
          clearCustom: true,
        },
      ],
    };
    return id;
  }

  /**
   * Three options: each is a random spell or generated piece → write-up path.
   * Independent of lastCustom text so choices don’t all echo the same custom move.
   */
  function buildArtPathChoices() {
    var arts = artPool().slice(0, 3);
    // Ensure up to 3 — if pool short, allow fewer then pad later
    while (arts.length < 3 && (media.spells || []).length) {
      arts.push(
        media.spells[Math.floor(Math.random() * media.spells.length)]
      );
    }
    // Deduplicate by url/num
    var seen = {};
    arts = arts.filter(function (it) {
      if (!it) return false;
      var k = it.url || String(it.num) || it.label;
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
    while (arts.length < 3) {
      arts.push({
        kind: "spell",
        num: (arts.length + 1) * 7,
        label: "Spell #" + (arts.length + 1) * 7,
        url: resolveUrl(paintingUrl((arts.length + 1) * 7)),
      });
    }
    arts = arts.slice(0, 3);
    return arts.map(function (item, idx) {
      var writeId = createArtWriteupNode(item);
      var name = artDisplayName(item);
      var kindTag = item.kind === "generated" ? "Generated" : "Spell";
      return {
        label: "Study " + kindTag + ": " + name,
        to: writeId,
        artItem: item,
        artChoice: true,
        set:
          idx === 0
            ? { cunning: 1 }
            : idx === 1
              ? { kindness: 1 }
              : { courage: 1 },
      };
    });
  }

  /** Build free-text continuation: beat text from words; 3 paths = random arts → write-ups. */
  function createFreeNode(playerText) {
    state.freeDepth = (state.freeDepth || 0) + 1;
    var t = (playerText || "").trim();
    var low = t.toLowerCase();
    var id = "free_" + Date.now();
    var mood = "void";
    var tag = "Your move";
    var text = "";
    var set = { cunning: 1 };
    var grant = null;
    var toEnd = null;
    var visionExtra = "";

    function quoteBeat(prefix, aftermath) {
      return (
        prefix +
        " “" +
        t +
        "”\n\n" +
        aftermath +
        "\n\nThree hangings answer from the walls — each a spell or generated work. " +
        "Pick one to read its write-up; that path leaves your custom words behind and follows the art."
      );
    }

    if (state.freeDepth >= 4 && /end|finish|done|wake|return/.test(low)) {
      toEnd = "ending_custom";
      text =
        "You force a conclusion: “" +
        t +
        "”\n\nThe gallery stamps the scene complete — myth sealed, not erased.";
    } else if (
      /ritual|rite|summon|conjure|hex|curse|occult|sigil|pact|demon|devil|angel|sacrifice|altar|blood|haunt|ghost|nightmare|abyss|void|hell/.test(
        low
      )
    ) {
      mood = "void";
      tag = "Dark conjuring";
      text = quoteBeat(
        "The gallery drinks the darker intention:",
        "Pigment thickens into omen. The walls offer three works as answers — not three copies of your sentence."
      );
      visionExtra = "Player beat (this scene only): " + t.slice(0, 120);
      set = { courage: 1, cunning: 1 };
    } else if (/run|flee|escape|leave|exit|home|sprint/.test(low)) {
      mood = "run";
      text = quoteBeat(
        "You act on it:",
        "The corridor stretches. Three frames flash like exit signs — each a different hanging to follow."
      );
    } else if (/fight|attack|slash|stab|kill|smash|break|destroy|murder/.test(low)) {
      mood = "glitch";
      text = quoteBeat(
        "Force answers paint:",
        "Something tears. Three works lean forward as if volunteering to be the next truth."
      );
      set = { courage: 1 };
    } else if (/talk|speak|ask|hello|call|whisper|say|tell|pray|invoke/.test(low)) {
      mood = "creature";
      text = quoteBeat(
        "Words travel through varnish:",
        "Three mouths of paint reply — each a different work to study."
      );
      set = { kindness: 1 };
    } else if (/look|search|examine|inspect|read|check|study/.test(low)) {
      mood = "paint";
      text = quoteBeat(
        "You look closer:",
        "Three hangings catch the light. Each path is a write-up of that art, not a remix of your words."
      );
      set = { cunning: 2 };
    } else if (/paint|draw|brush|art|canvas|portrait/.test(low)) {
      mood = "glow";
      text = quoteBeat(
        "You make a mark:",
        "The world accepts the edit, then offers three real works as the next chapter."
      );
      grant = ["brush"];
      set = { kindness: 1, cunning: 1 };
    } else if (/light|lamp|flash|torch|fire|burn/.test(low)) {
      mood = "beam";
      text = quoteBeat(
        "Light obeys:",
        "Three frames catch the beam. Follow one work’s write-up into the dark."
      );
      grant = ["flashlight"];
    } else {
      mood = "void";
      text =
        "The story bends around your words:\n\n“" +
        t +
        "”\n\n" +
        "Three hangings peel forward from the walls — spell or generated. " +
        "Each option is that work’s write-up path, not another paraphrase of what you typed.";
      visionExtra = "Player beat (this scene only): " + t.slice(0, 120);
    }

    var choices = toEnd
      ? [
          { label: "Accept the ending", to: "ending_custom" },
          { label: "Accept the ending", to: "ending_custom" },
          { label: "Accept the ending", to: "ending_custom" },
        ]
      : buildArtPathChoices();

    if (!state._freeNodes) state._freeNodes = {};
    state._freeNodes[id] = {
      tag: tag,
      mood: mood,
      text: text,
      choices: choices,
      ending: !!toEnd,
      endingId: toEnd ? "custom" : undefined,
      endingTitle: toEnd ? "Authored path" : undefined,
      visionExtra: visionExtra,
      freeCustomBeat: true,
    };
    applySet(set);
    if (grant) grantItem(grant);
    return id;
  }

  function choiceOk(ch) {
    if (!ch) return false;
    if (ch.needItem && !hasItem(ch.needItem)) return false;
    return true;
  }

  function padThree(choices) {
    var list = (choices || []).slice(0, 3);
    while (list.length < 3) {
      list.push({ label: "Wait and listen", to: state.nodeId === "start" ? "callout" : "corridor" });
    }
    return list;
  }

  function go(nodeId) {
    if (nodeId === "__restart__") {
      restart(false);
      return;
    }
    if (!STORY[nodeId] && !(state._freeNodes && state._freeNodes[nodeId])) {
      nodeId = "start";
    }
    state.nodeId = nodeId;
    var node = getNode(nodeId);
    if (node.ending && node.endingId) {
      state.endings[node.endingId] = true;
      saveEndings();
    }
    saveGame();
    render();
  }

  function pick(ch) {
    if (!choiceOk(ch)) return;
    if (ch.grant) {
      (Array.isArray(ch.grant) ? ch.grant : [ch.grant]).forEach(grantItem);
    }
    applySet(ch.set);
    // Equip the chosen hanging so write-up / next still uses that art’s DNA
    if (ch.artItem && ch.artItem.url) {
      media.styleForce = ch.artItem;
      if (!media.castSpells) media.castSpells = [];
      media.castSpells = media.castSpells.filter(function (s) {
        return s.url !== ch.artItem.url;
      });
      media.castSpells.unshift(ch.artItem);
      if (media.castSpells.length > 3) media.castSpells.length = 3;
      renderCastList();
      renderStrip();
    }
    // Leaving custom influence once you pick an art path or story branch
    if (ch.clearCustom || ch.artChoice || (ch.artItem && String(ch.to).indexOf("art_") === 0)) {
      // keep log line in state.lastCustom for HUD history, but mark consumed
      state._customConsumed = true;
    }
    go(ch.to);
  }

  function openModal() {
    var modal = $("adv-modal");
    var input = $("adv-custom-input");
    if (!modal) return;
    modal.hidden = false;
    if (input) {
      input.value = "";
      setTimeout(function () {
        input.focus();
      }, 50);
    }
  }

  function closeModal() {
    var modal = $("adv-modal");
    if (modal) modal.hidden = true;
  }

  function submitCustom() {
    var input = $("adv-custom-input");
    var t = input ? String(input.value || "").trim() : "";
    if (!t) {
      if (input) input.focus();
      return;
    }
    state.lastCustom = t;
    state._customConsumed = false;
    closeModal();
    function finish() {
      var id = createFreeNode(t);
      go(id);
    }
    // Need spell/generated pool so the 3 options can be real hangings
    if (!media.loaded) {
      loadMediaPool(false).then(finish).catch(finish);
    } else {
      finish();
    }
  }

  function renderHud() {
    var c = $("adv-stat-courage");
    var u = $("adv-stat-cunning");
    var k = $("adv-stat-kindness");
    if (c) c.textContent = String(state.courage);
    if (u) u.textContent = String(state.cunning);
    if (k) k.textContent = String(state.kindness);

    var inv = $("adv-inv");
    if (inv) {
      inv.innerHTML = "";
      if (!state.inv.length) {
        var li = document.createElement("li");
        li.className = "adv-inv-empty";
        li.textContent = "Empty";
        inv.appendChild(li);
      } else {
        state.inv.forEach(function (id) {
          var li2 = document.createElement("li");
          li2.textContent = itemLabel(id);
          inv.appendChild(li2);
        });
      }
    }

    var n = 0;
    Object.keys(state.endings || {}).forEach(function (key) {
      if (state.endings[key]) n++;
    });
    var endEl = $("adv-endings");
    if (endEl) endEl.textContent = "Endings " + n + "+";

    var log = $("adv-log");
    if (log) log.textContent = state.lastCustom ? "“" + state.lastCustom + "”" : "—";
  }

  function render() {
    var node = getNode(state.nodeId);
    var tag = $("adv-scene-tag");
    var cap = $("adv-caption");
    var box = $("adv-choices");

    if (tag) tag.textContent = node.tag || "Scene";
    if (cap) {
      var body = node.text || "";
      if (node.ending && node.endingTitle) {
        body += "\n\n✦ Ending: " + node.endingTitle;
      }
      cap.textContent = body;
    }

    if (box) {
      box.innerHTML = "";
      if (node.ending) {
        var b1 = document.createElement("button");
        b1.type = "button";
        b1.className = "adv-choice";
        b1.textContent = "Restart game from the beginning";
        b1.addEventListener("click", function () {
          restart(false);
        });
        box.appendChild(b1);
        var b2 = document.createElement("button");
        b2.type = "button";
        b2.className = "adv-choice";
        b2.textContent = "Retry this ending’s video";
        b2.addEventListener("click", retryVideo);
        box.appendChild(b2);
        var b3 = document.createElement("button");
        b3.type = "button";
        b3.className = "adv-choice";
        b3.textContent = "Something else… (new path)";
        b3.addEventListener("click", openModal);
        box.appendChild(b3);
        var b4 = document.createElement("button");
        b4.type = "button";
        b4.className = "adv-choice adv-choice-other";
        b4.textContent = "Restart game";
        b4.addEventListener("click", function () {
          restart(false);
        });
        box.appendChild(b4);
      } else {
        var three = padThree(node.choices);
        var anyArt = three.some(function (c) {
          return c && c.artItem;
        });
        if (anyArt) box.classList.add("has-art-choices");
        else box.classList.remove("has-art-choices");
        three.forEach(function (ch) {
          var btn = document.createElement("button");
          btn.type = "button";
          var ok = choiceOk(ch);
          btn.disabled = !ok;
          if (ch.artItem && ch.artItem.url) {
            btn.className = "adv-choice adv-choice-art";
            var thumb = document.createElement("img");
            thumb.className = "adv-choice-art-img";
            thumb.src = ch.artItem.url;
            thumb.alt = "";
            thumb.loading = "lazy";
            thumb.draggable = false;
            var cap = document.createElement("span");
            cap.className = "adv-choice-art-cap";
            var kind = document.createElement("span");
            kind.className = "adv-choice-art-kind";
            kind.textContent =
              ch.artItem.kind === "generated" ? "Generated" : "Spell";
            var title = document.createElement("span");
            title.className = "adv-choice-art-title";
            title.textContent = artDisplayName(ch.artItem);
            var sub = document.createElement("span");
            sub.className = "adv-choice-art-sub";
            sub.textContent = ok
              ? "Write-up path"
              : ch.needItem
                ? "Need " + itemLabel(ch.needItem)
                : "Locked";
            cap.appendChild(kind);
            cap.appendChild(title);
            cap.appendChild(sub);
            btn.appendChild(thumb);
            btn.appendChild(cap);
            btn.title = ch.label || artDisplayName(ch.artItem);
          } else {
            btn.className = "adv-choice";
            btn.textContent = ok
              ? ch.label
              : ch.label +
                (ch.needItem ? " (need " + itemLabel(ch.needItem) + ")" : " (locked)");
          }
          btn.addEventListener("click", function () {
            pick(ch);
          });
          box.appendChild(btn);
        });
        var other = document.createElement("button");
        other.type = "button";
        other.className = "adv-choice adv-choice-other";
        other.textContent = "Something else…";
        other.addEventListener("click", openModal);
        box.appendChild(other);
      }
    }

    renderHud();
    state._mood = node.mood || "void";
    // Art write-up nodes: equip art DNA before generating
    if (node.artItem && node.artItem.url) {
      media.styleForce = node.artItem;
      if (!media.castSpells) media.castSpells = [];
      var already = media.castSpells.some(function (s) {
        return s.url === node.artItem.url;
      });
      if (!already) {
        media.castSpells.unshift(node.artItem);
        if (media.castSpells.length > 3) media.castSpells.length = 3;
      }
      renderCastList();
      renderStrip();
    }
    beginCinematicScene(state.nodeId, node, scenePlayerExtra(state.nodeId, node));
  }

  /* —— Media pool: spells (paintings) + generated —— */
  function paintingUrl(num) {
    if (window.getPaintingUrl) return window.getPaintingUrl(num);
    return "paintings/" + num + ".jpg";
  }

  function resolveUrl(url) {
    var raw = String(url || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("/") && window.SPELLFORGE_API_BASE) {
      return String(window.SPELLFORGE_API_BASE).replace(/\/$/, "") + raw;
    }
    return raw;
  }

  function loadImage(url) {
    return new Promise(function (resolve) {
      if (!url) {
        resolve(null);
        return;
      }
      if (media.cache[url] && media.cache[url].complete && media.cache[url].naturalWidth) {
        resolve(media.cache[url]);
        return;
      }
      var img = new Image();
      img.decoding = "async";
      img.onload = function () {
        media.cache[url] = img;
        resolve(img);
      };
      img.onerror = function () {
        resolve(null);
      };
      img.src = url;
    });
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function buildStrip() {
    var pool = shuffle(media.spells.concat(media.generated));
    media.strip = pool.slice(0, 28);
    renderStrip();
    renderCastList();
  }

  function normalizeSpellItem(raw) {
    if (!raw) return null;
    var o = raw;
    if (typeof raw === "string") {
      try {
        o = JSON.parse(raw);
      } catch (e) {
        // plain number or url
        if (/^\d+$/.test(raw.trim())) {
          var n0 = parseInt(raw.trim(), 10);
          return {
            kind: "spell",
            num: n0,
            label: "Spell #" + n0,
            url: resolveUrl(paintingUrl(n0)),
          };
        }
        if (/^https?:|^\//.test(raw) || raw.indexOf("paintings/") === 0 || raw.indexOf("generated/") >= 0) {
          return { kind: "generated", label: "Dropped image", url: resolveUrl(raw) };
        }
        return null;
      }
    }
    var n =
      o.paintingNum != null
        ? Number(o.paintingNum)
        : o.num != null
          ? Number(o.num)
          : o.number != null
            ? Number(o.number)
            : null;
    var url = o.url || (n ? paintingUrl(n) : "");
    if (!url && !n) return null;
    return {
      kind: o.kind || (n ? "spell" : "generated"),
      num: n,
      label: o.title || o.label || (n ? "Spell #" + n : "Spell"),
      url: resolveUrl(url || paintingUrl(n)),
    };
  }

  function renderCastList() {
    var list = $("adv-cast-list");
    if (!list) return;
    list.innerHTML = "";
    if (!media.castSpells || !media.castSpells.length) {
      var empty = document.createElement("li");
      empty.className = "adv-inv-empty";
      empty.textContent = "Drag a spell onto the video";
      list.appendChild(empty);
      return;
    }
    media.castSpells.forEach(function (item, idx) {
      var li = document.createElement("li");
      li.style.display = "flex";
      li.style.alignItems = "center";
      li.style.gap = "0.35rem";
      li.style.justifyContent = "space-between";
      var lab = document.createElement("span");
      lab.textContent = item.label || item.kind;
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "adv-btn adv-btn-ghost";
      rm.style.minHeight = "24px";
      rm.style.padding = "0.1rem 0.4rem";
      rm.style.fontSize = "0.7rem";
      rm.textContent = "×";
      rm.title = "Remove";
      rm.addEventListener("click", function () {
        media.castSpells.splice(idx, 1);
        renderCastList();
        renderStrip();
        recastSceneVideo();
      });
      li.appendChild(lab);
      li.appendChild(rm);
      list.appendChild(li);
    });
  }

  /** Cast a spell into the current scene and re-generate video with that DNA */
  function castSpellOntoScene(item) {
    item = normalizeSpellItem(item);
    if (!item || !item.url) {
      setErrorBanner("Could not read that spell drop. Try another tray item.");
      return;
    }
    if (!media.castSpells) media.castSpells = [];
    var exists = media.castSpells.some(function (s) {
      return s.url === item.url || (s.num && item.num && s.num === item.num);
    });
    if (!exists) {
      if (media.castSpells.length >= 3) media.castSpells.shift();
      media.castSpells.push(item);
    }
    media.styleForce = item;
    renderCastList();
    renderStrip();
    setErrorBanner("");
    cinema.genLoading = true;
    cinema.genPhase = "Casting " + (item.label || "spell") + "…";
    updateMediaLabel();
    recastSceneVideo();
  }

  function recastSceneVideo() {
    // Bust caches so new cast spells force a fresh still+video
    var node = getNode(state.nodeId);
    if (!node) {
      setErrorBanner("No active scene to cast into.");
      cinema.genLoading = false;
      updateMediaLabel();
      return;
    }
    var extra = scenePlayerExtra(state.nodeId, node);
    // Clear any cache entry for this scene (with or without prior cast fingerprint)
    var prefix = state.nodeId + "|";
    Object.keys(cinema.videoCache).forEach(function (k) {
      if (k.indexOf(prefix) === 0) delete cinema.videoCache[k];
    });
    Object.keys(cinema.genCache).forEach(function (k) {
      if (k.indexOf(prefix) === 0) delete cinema.genCache[k];
    });
    stopHtmlVideo();
    beginCinematicScene(state.nodeId, node, extra);
    startVideo();
  }

  function makeSceneKey(nodeId, extraPlayerLine) {
    var castKey = (media.castSpells || [])
      .map(function (s) {
        return s.num || s.url;
      })
      .join("+");
    return (
      nodeId +
      "|" +
      (extraPlayerLine ? String(extraPlayerLine).slice(0, 40) : "") +
      "|cast:" +
      castKey
    );
  }

  function renderStrip() {
    var strip = $("adv-strip");
    if (!strip) return;
    strip.innerHTML = "";
    media.strip.forEach(function (item, idx) {
      var casted =
        media.castSpells &&
        media.castSpells.some(function (s) {
          return s.url === item.url || (s.num && item.num && s.num === item.num);
        });
      var btn = document.createElement("div");
      btn.className = "adv-strip-item" + (casted ? " is-active" : "");
      btn.draggable = true;
      btn.title = (item.label || item.url) + " — drag onto video to cast";
      btn.dataset.advIdx = String(idx);
      var img = document.createElement("img");
      img.alt = item.label || "";
      img.loading = "lazy";
      img.draggable = false;
      img.src = item.url;
      var kind = document.createElement("span");
      kind.className = "adv-strip-kind";
      kind.textContent = item.kind === "generated" ? "gen" : "spell";
      btn.appendChild(img);
      btn.appendChild(kind);

      var dragMoved = false;
      btn.addEventListener("dragstart", function (e) {
        dragMoved = true;
        btn.classList.add("adv-dragging");
        try {
          var payload = JSON.stringify({
            kind: item.kind,
            num: item.num,
            label: item.label,
            url: item.url,
            title: item.label,
            paintingNum: item.num,
          });
          e.dataTransfer.setData("application/x-gallery-spell", payload);
          e.dataTransfer.setData("text/plain", payload);
          e.dataTransfer.effectAllowed = "copy";
        } catch (err) {}
      });
      btn.addEventListener("dragend", function () {
        btn.classList.remove("adv-dragging");
        setPlayerDragOver(false);
        // Allow a click only after a true non-drag interaction
        setTimeout(function () {
          dragMoved = false;
        }, 0);
      });
      btn.addEventListener("click", function (e) {
        if (dragMoved) {
          e.preventDefault();
          return;
        }
        castSpellOntoScene(item);
      });
      strip.appendChild(btn);
    });
    var count = $("adv-media-count");
    if (count) {
      count.textContent =
        "Spells: " +
        media.spells.length +
        " · Generated: " +
        media.generated.length +
        " · Cast: " +
        (media.castSpells ? media.castSpells.length : 0) +
        "/3";
    }
  }

  function setPlayerDragOver(on) {
    var player = $("adv-player");
    var hint = $("adv-drop-hint");
    if (player) player.classList.toggle("is-dragover", !!on);
    if (hint) hint.hidden = !on;
  }

  function bindSpellDropZone() {
    var player = $("adv-player");
    if (!player || player._advDropBound) return;
    player._advDropBound = true;

    function hasSpellData(e) {
      if (!e.dataTransfer) return true;
      var types = e.dataTransfer.types;
      if (!types) return true;
      // FileList / DOMStringList / array
      var arr = typeof types.contains === "function" ? null : types;
      if (typeof types.contains === "function") {
        return (
          types.contains("application/x-gallery-spell") ||
          types.contains("text/plain") ||
          types.contains("Files") ||
          types.contains("text/uri-list")
        );
      }
      for (var i = 0; i < arr.length; i++) {
        var t = String(arr[i]);
        if (
          t === "application/x-gallery-spell" ||
          t === "text/plain" ||
          t === "Files" ||
          t === "text/uri-list" ||
          t.indexOf("text") === 0
        ) {
          return true;
        }
      }
      return false;
    }

    function onDragEnter(e) {
      if (!hasSpellData(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setPlayerDragOver(true);
    }
    function onDragOver(e) {
      if (!hasSpellData(e)) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        e.dataTransfer.dropEffect = "copy";
      } catch (err) {}
      setPlayerDragOver(true);
    }
    function onDragLeave(e) {
      // Leaving the player (not just moving between children)
      var related = e.relatedTarget;
      if (related && player.contains(related)) return;
      setPlayerDragOver(false);
    }
    function onDrop(e) {
      e.preventDefault();
      e.stopPropagation();
      setPlayerDragOver(false);
      var dt = e.dataTransfer;
      var raw = "";
      if (dt) {
        try {
          raw = dt.getData("application/x-gallery-spell") || "";
        } catch (err1) {}
        if (!raw) {
          try {
            raw = dt.getData("text/plain") || "";
          } catch (err2) {}
        }
      }
      if (raw) {
        castSpellOntoScene(raw);
        return;
      }
      // File drop from OS
      var files = dt && dt.files;
      if (files && files[0] && files[0].type && files[0].type.indexOf("image/") === 0) {
        var file = files[0];
        var reader = new FileReader();
        reader.onload = function () {
          castSpellOntoScene({
            kind: "generated",
            label: file.name || "Dropped image",
            url: String(reader.result || ""),
          });
        };
        reader.readAsDataURL(file);
        return;
      }
      setErrorBanner("Drop a spell from the tray (or an image file) onto the video.");
    }

    // Capture phase so choice buttons / overlays cannot block drop targeting
    player.addEventListener("dragenter", onDragEnter, true);
    player.addEventListener("dragover", onDragOver, true);
    player.addEventListener("dragleave", onDragLeave, true);
    player.addEventListener("drop", onDrop, true);
  }

  function updateMediaLabel() {
    var el = $("adv-media-label");
    if (!el) return;
    if (cinema.videoUrl && !cinema.genLoading) {
      el.textContent = "▶ Playing video";
    } else if (cinema.genLoading) {
      el.textContent = cinema.genPhase || "Generating…";
    } else if (cinema.genError) {
      el.textContent = "Still ready · video failed";
    } else if (cinema.genUrl) {
      el.textContent = "Still · Retry for video";
    } else if (media.loading) {
      el.textContent = "Loading…";
    } else {
      el.textContent = "Ready";
    }
  }

  function stopHtmlVideo() {
    var vid = $("adv-html-video");
    var player = $("adv-player");
    if (vid) {
      try {
        vid.pause();
      } catch (e) {}
      vid.removeAttribute("src");
      try {
        vid.load();
      } catch (e2) {}
      vid.classList.remove("is-playing");
    }
    if (player) player.classList.remove("is-live");
    cinema.videoUrl = null;
  }

  function playHtmlVideo(url) {
    var vid = $("adv-html-video");
    var player = $("adv-player");
    if (!vid || !url) return;
    cinema.videoUrl = url;
    vid.src = url;
    vid.muted = true;
    vid.loop = true;
    vid.playsInline = true;
    var p = vid.play();
    if (p && typeof p.then === "function") {
      p.then(function () {
        vid.classList.add("is-playing");
        if (player) player.classList.add("is-live");
        updateMediaLabel();
      }).catch(function () {
        // Autoplay blocked — still show frame
        vid.classList.add("is-playing");
        if (player) player.classList.add("is-live");
        updateMediaLabel();
      });
    } else {
      vid.classList.add("is-playing");
      if (player) player.classList.add("is-live");
      updateMediaLabel();
    }
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    var p = path.startsWith("/") ? path : "/" + path;
    return base ? base + p : p;
  }

  function extractImageUrl(payload) {
    if (!payload) return "";
    if (typeof payload === "string" && /^(https?:|data:|blob:|\/)/i.test(payload)) return payload;
    var img = payload.image || (payload.images && payload.images[0]);
    var raw =
      (img && (img.url || img.download_url || img.uri)) ||
      payload.image_url ||
      payload.output_url ||
      payload.result_url ||
      (payload.result && payload.result.url) ||
      payload.url ||
      "";
    return raw;
  }

  function pollImageJob(jobId, left) {
    left = left == null ? 90 : left;
    if (left <= 0) return Promise.reject(new Error("Timed out waiting for still"));
    return fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId) + "?t=" + Date.now()), {
      cache: "no-store",
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (job) {
        var st = String((job && job.status) || "").toLowerCase();
        cinema.genPhase = "Still rendering… (" + st + ")";
        updateMediaLabel();
        if (st === "done" || st === "completed" || st === "success") {
          var url = extractImageUrl(job);
          if (url) return url;
          throw new Error("Job finished but no still URL");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error(
            (job && job.error && (job.error.message || job.error)) || "Still job failed"
          );
        }
        var early = extractImageUrl(job);
        if (early) return early;
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve(pollImageJob(jobId, left - 1));
          }, 1500);
        });
      });
  }

  function cinematicPrompt(node, extra) {
    // Dense fiction context first — lack of context was scrubbing darker beats
    var body = String((node && node.text) || "").replace(/\s+/g, " ").trim().slice(0, 340);
    var mood = (node && node.mood) || "mystery";
    var tag = (node && node.tag) || "scene";
    var lens = MOOD_LENS[mood] || MOOD_LENS.mystery;
    var nodeVision = node && node.visionExtra ? String(node.visionExtra).replace(/\s+/g, " ").trim() : "";
    var bits = [
      ADV_FICTION_FRAME,
      "Cinematic 16:9 film still, chiaroscuro, painterly, mythic night-gallery.",
      "No text, titles, captions, logos, watermarks, UI, or readable lettering in the frame.",
      "Mood lens (" + mood + "): " + lens + ".",
      "Scene " + tag + ": " + body,
    ];
    if (nodeVision) bits.push(nodeVision.slice(0, 220));
    if (extra) bits.push(String(extra).replace(/\s+/g, " ").trim().slice(0, 360));
    return bits.join(" ");
  }

  function adventureBuzzWords(hasSpells) {
    var base = [
      "dark fantasy",
      "chiaroscuro",
      "mythic atmosphere",
      "cinematic",
      "night gallery",
      "painterly",
    ];
    if (hasSpells) {
      base = base.concat(["spell-cast", "gallery DNA", "silent cameo"]);
    }
    return base;
  }

  function buildMotionPromptFromStill(stillPrompt) {
    return (
      "IMAGE-TO-LIFE: living motion inside the still, fixed camera, same subjects. " +
      "Preserve moody night-gallery atmosphere — flickering light, wet pigment, breathing shadow. " +
      "No new text, titles, captions, or lettering. " +
      String(stillPrompt || "").slice(0, 420)
    );
  }

  /* —— Diagnostic prompt: moderation scan + editable override —— */
  /**
   * Heuristic terms that often trip image-API content moderation.
   * Not the provider’s full list — residual panel + table catch what we know.
   */
  var ADV_MOD_RULES = [
    {
      level: "high",
      re: /\b(porn|porno|xxx|nude|naked|nsfw|explicit\s*sex|sexual\s*act|child\s*porn|underage|lolita|minor|preteen|rape|raping|bestiality|snuff|incest)\b/gi,
    },
    {
      level: "high",
      re: /\b(gore|gory|beheading|dismember|dismembered|bloody\s*massacre|torture|tortured|suicidal|suicide|school\s*shooting|genocide|mutilat\w*|entrails|eviscerat\w*)\b/gi,
    },
    {
      level: "high",
      re: /\b(nazi|swastika|isis|batman|joker|superman|spiderman|spider-?man|harry\s*potter|voldemort|disney|marvel|barbie|mickey|minnie)\b/gi,
    },
    {
      level: "high",
      re: /\b(fuck|fucking|shit|cock|dick|pussy|cunt|penis|vagina|orgasm|masturbat\w*|hentai)\b/gi,
    },
    {
      level: "med",
      re: /\b(blood|bloody|bleeding|corpse|dead\s*body|kill|killing|killed|murder|murdered|weapon|gun|rifle|pistol|knife|blade|dagger|erotic|erotica|sexy|sexual|lingerie|sensual|seduc\w*|violence|violent|body-?horror|demonic|demon|devil|satanic|satan|sacrifice|sacrificial|ritual|occult|sex|lust|desire|arousal|wound|wounded|flesh|skull|cannibal|devour|devoured|strangle|choke|drown|drowning|slaughter)\b/gi,
    },
    {
      level: "med",
      re: /\b(unflinching|baroque\s*violence|opened\s*veins|copper-blood|body-as-symbol|erotic\s*tension|blood-as-color|graphic|gruesome|horror|horrific|macabre|nightmare|hell|infernal|blasphem\w*|profan\w*|adult\s*content|nsfw|mature\s*content)\b/gi,
    },
    {
      level: "med",
      re: /\b(breast|breasts|nipple|nipples|bare\s*skin|undress|undressed|intimate|intimacy|orgy|bdsm|bondage)\b/gi,
    },
  ];

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function scanModeration(text) {
    text = String(text || "");
    var hits = [];
    var seen = {};
    ADV_MOD_RULES.forEach(function (rule) {
      var re = new RegExp(rule.re.source, rule.re.flags);
      var m;
      while ((m = re.exec(text)) !== null) {
        var key = m.index + ":" + m[0].toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        hits.push({
          start: m.index,
          end: m.index + m[0].length,
          level: rule.level,
          match: m[0],
        });
        if (m[0].length === 0) re.lastIndex++;
      }
    });
    hits.sort(function (a, b) {
      return a.start - b.start || b.end - a.end;
    });
    var cleaned = [];
    var lastEnd = -1;
    hits.forEach(function (h) {
      if (h.start < lastEnd) return;
      cleaned.push(h);
      lastEnd = h.end;
    });
    var counts = {};
    cleaned.forEach(function (h) {
      var k = h.match.toLowerCase();
      if (!counts[k]) counts[k] = { match: h.match, level: h.level, n: 0 };
      counts[k].n++;
      if (h.level === "high") counts[k].level = "high";
    });
    return {
      hits: cleaned,
      flags: Object.keys(counts)
        .map(function (k) {
          return counts[k];
        })
        .sort(function (a, b) {
          if (a.level !== b.level) return a.level === "high" ? -1 : 1;
          return b.n - a.n;
        }),
    };
  }

  function highlightModerationHtml(text) {
    text = String(text || "");
    var scan = scanModeration(text);
    if (!scan.hits.length) {
      return escapeHtml(text) + (text.slice(-1) === "\n" ? "\n" : "");
    }
    var out = "";
    var i = 0;
    scan.hits.forEach(function (h) {
      if (h.start > i) out += escapeHtml(text.slice(i, h.start));
      out +=
        '<mark class="adv-hl-mark ' +
        (h.level === "high" ? "high" : "med") +
        '">' +
        escapeHtml(text.slice(h.start, h.end)) +
        "</mark>";
      i = h.end;
    });
    if (i < text.length) out += escapeHtml(text.slice(i));
    if (text.slice(-1) === "\n") out += "\n";
    return out;
  }

  function syncHlScroll(input, layer) {
    if (!input || !layer) return;
    layer.scrollTop = input.scrollTop;
    layer.scrollLeft = input.scrollLeft;
  }

  function setCharCount(el, n) {
    if (!el) return;
    el.textContent = String(n) + " chars";
    el.className = "adv-diag-chars";
    if (n > 6000) el.classList.add("is-danger");
    else if (n > 3500) el.classList.add("is-warn");
  }

  function getRawBuiltScanText() {
    return [
      cinema.lastBuiltPrompt || "",
      cinema.lastBuiltBuzz || "",
      cinema.lastBuiltMotion || "",
    ].join("\n");
  }

  function getEditorScanText() {
    var input = $("adv-diag-prompt");
    var motion = $("adv-diag-motion");
    var buzz = $("adv-diag-buzz");
    return [
      input ? input.value : "",
      motion ? motion.value : "",
      buzz ? buzz.value : "",
    ].join("\n");
  }

  function lookupPromptSub(from) {
    var key = String(from || "").toLowerCase();
    var list = cinema.promptSubs || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].from.toLowerCase() === key) return list[i].to;
    }
    return "";
  }

  function formatFlagList(flags, maxN) {
    maxN = maxN || 12;
    return (flags || [])
      .slice(0, maxN)
      .map(function (f) {
        return f.match + (f.level === "high" ? " (high)" : " (med)");
      })
      .join(", ");
  }

  /** Live status: what is still flagged in the text about to be sent + in typed replacements */
  function updateResidualRiskUi() {
    var box = $("adv-residual-risk");
    var meta = $("adv-diag-meta");
    if (!box) return { high: 0, med: 0, flags: [] };

    var sendScan = scanModeration(getEditorScanText());
    var repParts = [];
    (cinema.promptSubs || []).forEach(function (s) {
      if (s && s.to) repParts.push(String(s.to));
    });
    // Also live values in table inputs (may match promptSubs)
    var tbody = $("adv-rewrite-tbody");
    if (tbody) {
      tbody.querySelectorAll(".adv-rewrite-input").forEach(function (inp) {
        if (inp.value && inp.value.trim()) repParts.push(inp.value);
      });
    }
    var repScan = scanModeration(repParts.join("\n"));

    var high = 0;
    var med = 0;
    sendScan.flags.forEach(function (f) {
      if (f.level === "high") high++;
      else med++;
    });
    var repHigh = 0;
    var repMed = 0;
    repScan.flags.forEach(function (f) {
      if (f.level === "high") repHigh++;
      else repMed++;
    });

    box.hidden = false;
    box.className = "adv-residual-risk";
    if (!sendScan.flags.length && !repScan.flags.length) {
      box.classList.add("is-ok");
      box.innerHTML =
        "<strong>Live send check:</strong> no known moderation trip-words in the prompt or your typed replacements " +
        "<span class=\"adv-residual-note\">(heuristic — the API may still refuse for other reasons)</span>";
    } else {
      if (high || repHigh) box.classList.add("is-danger");
      else box.classList.add("is-warn");
      var lines = [];
      if (sendScan.flags.length) {
        lines.push(
          "<div><strong>Still in prompt to send:</strong> " +
            escapeHtml(formatFlagList(sendScan.flags)) +
            (sendScan.flags.length > 12 ? "…" : "") +
            "</div>"
        );
      }
      if (repScan.flags.length) {
        lines.push(
          "<div><strong>Your replacement text is also flagged:</strong> " +
            escapeHtml(formatFlagList(repScan.flags)) +
            " — rephrase those boxes</div>"
        );
      }
      lines.push(
        "<div class=\"adv-residual-note\">Yellow/red marks in the text areas show the same hits. Clear them before Generate if the API keeps refusing.</div>"
      );
      box.innerHTML = lines.join("");
    }

    if (meta) {
      if (!sendScan.flags.length && !repScan.flags.length) {
        meta.textContent = "clean · " + getEditorScanText().length + " chars";
        meta.className = "adv-diag-meta is-ok";
      } else {
        var parts = [];
        if (high) parts.push(high + " high in send");
        if (med) parts.push(med + " med in send");
        if (repHigh || repMed) {
          parts.push(
            (repHigh + repMed) + " in your typing" + (repHigh ? " (incl. high)" : "")
          );
        }
        meta.textContent = parts.join(" · ") + " · " + getEditorScanText().length + " chars";
        meta.className =
          "adv-diag-meta " + (high || repHigh ? "is-danger" : "is-warn");
      }
    }

    return {
      high: high,
      med: med,
      repHigh: repHigh,
      repMed: repMed,
      flags: sendScan.flags,
      repFlags: repScan.flags,
    };
  }

  function setReplacementInputRisk(inp, warnEl) {
    if (!inp) return;
    var to = String(inp.value || "");
    var scan = scanModeration(to);
    inp.classList.toggle("is-risk", !!scan.flags.length);
    inp.classList.toggle("is-risk-high", scan.flags.some(function (f) {
      return f.level === "high";
    }));
    if (warnEl) {
      if (!to.trim()) {
        warnEl.hidden = true;
        warnEl.textContent = "";
      } else if (!scan.flags.length) {
        warnEl.hidden = false;
        warnEl.className = "adv-rewrite-warn is-ok";
        warnEl.textContent = "Replacement looks clear (heuristic)";
      } else {
        warnEl.hidden = false;
        var hasHigh = scan.flags.some(function (f) {
          return f.level === "high";
        });
        warnEl.className =
          "adv-rewrite-warn " + (hasHigh ? "is-danger" : "is-warn");
        warnEl.textContent =
          "Your typing is also flagged: " + formatFlagList(scan.flags, 8);
      }
    }
  }

  /**
   * Table of red/yellow flagged words with a replacement input per row.
   * Rows come from the raw scene text so they stay after you replace them.
   */
  function renderRewriteTable() {
    var tbody = $("adv-rewrite-tbody");
    var table = $("adv-rewrite-table");
    var empty = $("adv-rewrite-empty");
    if (!tbody) return updateResidualRiskUi();

    var active = document.activeElement;
    var focusFrom =
      active && active.getAttribute && active.getAttribute("data-adv-from");
    var focusVal = focusFrom && active ? active.value : null;
    var focusStart =
      focusFrom && active && typeof active.selectionStart === "number"
        ? active.selectionStart
        : null;
    var focusEnd =
      focusFrom && active && typeof active.selectionEnd === "number"
        ? active.selectionEnd
        : null;

    var map = {};
    function absorb(scan) {
      (scan.flags || []).forEach(function (f) {
        var k = String(f.match).toLowerCase();
        if (!map[k]) {
          map[k] = {
            match: f.match,
            level: f.level,
            n: f.n || 1,
          };
        } else {
          map[k].n = Math.max(map[k].n, f.n || 1);
          if (f.level === "high") map[k].level = "high";
        }
      });
    }
    absorb(scanModeration(getRawBuiltScanText()));
    absorb(scanModeration(getEditorScanText()));

    var rows = Object.keys(map)
      .map(function (k) {
        return map[k];
      })
      .sort(function (a, b) {
        if (a.level !== b.level) return a.level === "high" ? -1 : 1;
        return a.match.toLowerCase().localeCompare(b.match.toLowerCase());
      });

    tbody.innerHTML = "";

    if (!rows.length) {
      if (table) table.hidden = true;
      if (empty) empty.hidden = false;
      return updateResidualRiskUi();
    }

    if (table) table.hidden = false;
    if (empty) empty.hidden = true;

    var restoreEl = null;
    rows.forEach(function (f) {
      var tr = document.createElement("tr");
      tr.className = f.level === "high" ? "is-high" : "is-med";

      var tdRisk = document.createElement("td");
      var risk = document.createElement("span");
      risk.className = "adv-rewrite-risk " + (f.level === "high" ? "high" : "med");
      risk.textContent = f.level === "high" ? "high" : "med";
      tdRisk.appendChild(risk);

      var tdWord = document.createElement("td");
      var word = document.createElement("span");
      word.className = "adv-rewrite-word";
      word.textContent = f.match;
      if (f.n > 1) {
        var em = document.createElement("em");
        em.textContent = "×" + f.n;
        word.appendChild(em);
      }
      tdWord.appendChild(word);

      var tdRep = document.createElement("td");
      var cell = document.createElement("div");
      cell.className = "adv-rewrite-cell";
      var inp = document.createElement("input");
      inp.type = "text";
      inp.className = "adv-rewrite-input";
      inp.setAttribute("data-adv-from", f.match);
      inp.setAttribute("aria-label", "Replace " + f.match);
      inp.placeholder = "type safer wording…";
      inp.spellcheck = false;
      var warn = document.createElement("div");
      warn.className = "adv-rewrite-warn";
      warn.hidden = true;
      var existing = lookupPromptSub(f.match);
      if (
        focusFrom &&
        focusFrom.toLowerCase() === String(f.match).toLowerCase() &&
        focusVal != null
      ) {
        inp.value = focusVal;
      } else {
        inp.value = existing;
      }
      setReplacementInputRisk(inp, warn);
      inp.addEventListener("input", function () {
        var to = inp.value;
        if (!String(to).trim()) {
          removePromptSub(f.match, { silent: true });
        } else {
          upsertPromptSub(f.match, to, { silent: true });
        }
        setReplacementInputRisk(inp, warn);
        reapplySubsToEditors({ skipTable: true });
        // Keep residual + this row's warn live while typing
        updateResidualRiskUi();
        setReplacementInputRisk(inp, warn);
      });
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          inp.blur();
        }
      });
      cell.appendChild(inp);
      cell.appendChild(warn);
      tdRep.appendChild(cell);

      tr.appendChild(tdRisk);
      tr.appendChild(tdWord);
      tr.appendChild(tdRep);
      tbody.appendChild(tr);

      if (
        focusFrom &&
        focusFrom.toLowerCase() === String(f.match).toLowerCase()
      ) {
        restoreEl = inp;
      }
    });

    updateResidualRiskUi();

    if (restoreEl) {
      try {
        restoreEl.focus();
        if (focusStart != null && focusEnd != null) {
          restoreEl.setSelectionRange(focusStart, focusEnd);
        }
      } catch (e) {}
    }

    return updateResidualRiskUi();
  }

  function refreshDiagHighlight(opts) {
    opts = opts || {};
    var input = $("adv-diag-prompt");
    var layer = $("adv-diag-hl");
    var motion = $("adv-diag-motion");
    var motionHl = $("adv-diag-motion-hl");
    var buzz = $("adv-diag-buzz");
    if (input && layer) {
      layer.innerHTML = highlightModerationHtml(input.value);
      syncHlScroll(input, layer);
      setCharCount($("adv-diag-chars"), input.value.length);
    }
    if (motion && motionHl) {
      motionHl.innerHTML = highlightModerationHtml(motion.value);
      syncHlScroll(motion, motionHl);
      setCharCount($("adv-diag-motion-chars"), motion.value.length);
    }
    if (buzz) {
      setCharCount($("adv-diag-buzz-chars"), buzz.value.length);
      buzz.classList.toggle(
        "is-risk",
        scanModeration(buzz.value).flags.length > 0
      );
    }
    if (!opts.skipTable) renderRewriteTable();
    else updateResidualRiskUi();
  }

  /** Push promptSubs into still/buzz/motion from last raw build */
  function reapplySubsToEditors(opts) {
    opts = opts || {};
    var input = $("adv-diag-prompt");
    var buzzEl = $("adv-diag-buzz");
    var motionEl = $("adv-diag-motion");
    var stillOut = applyPromptSubs(cinema.lastBuiltPrompt || "");
    var buzzOut = applyPromptSubs(cinema.lastBuiltBuzz || "");
    var motionOut = applyPromptSubs(
      cinema.lastBuiltMotion || buildMotionPromptFromStill(cinema.lastBuiltPrompt || "")
    );
    if (stillOut !== (cinema.lastBuiltPrompt || "")) {
      motionOut = applyPromptSubs(buildMotionPromptFromStill(stillOut));
    }
    if (input) input.value = stillOut;
    if (buzzEl) buzzEl.value = buzzOut;
    if (motionEl) motionEl.value = motionOut;
    cinema.lastFilledStill = stillOut;
    cinema.lastFilledBuzz = buzzOut;
    cinema.lastFilledMotion = motionOut;
    cinema.diagDirty = false;
    refreshDiagHighlight({ skipTable: !!opts.skipTable });
  }

  function setDiagLastError(msg) {
    var el = $("adv-diag-last");
    if (!el) return;
    el.textContent = msg
      ? "Last API error: " + msg
      : "Last API error: —";
  }

  /* —— Wording memory: rewrites survive cast / scene / rebuild —— */

  function loadPromptSubs() {
    try {
      var raw = localStorage.getItem(PROMPT_SUBS_KEY);
      var list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) list = [];
      cinema.promptSubs = list
        .filter(function (s) {
          return s && s.from && s.to != null && String(s.from).trim();
        })
        .map(function (s) {
          return {
            from: String(s.from).trim(),
            to: String(s.to),
          };
        })
        .slice(0, 80);
    } catch (e) {
      cinema.promptSubs = [];
    }
    return cinema.promptSubs;
  }

  function savePromptSubs(opts) {
    opts = opts || {};
    try {
      localStorage.setItem(
        PROMPT_SUBS_KEY,
        JSON.stringify((cinema.promptSubs || []).slice(0, 80))
      );
    } catch (e) {}
    if (!opts.silent) renderRewriteTable();
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /** Apply remembered rewrites (longest phrases first so nested edits win) */
  function applyPromptSubs(text) {
    text = String(text || "");
    var subs = (cinema.promptSubs || []).slice().sort(function (a, b) {
      return b.from.length - a.from.length;
    });
    subs.forEach(function (s) {
      if (!s.from) return;
      try {
        var re = new RegExp(escapeRegExp(s.from), "gi");
        text = text.replace(re, function () {
          return s.to;
        });
      } catch (e) {}
    });
    return text;
  }

  function upsertPromptSub(from, to, opts) {
    opts = opts || {};
    from = String(from || "").trim();
    to = String(to != null ? to : "");
    if (!from) return false;
    if (from.length > 120 || to.length > 200) return false;
    if (from.length < 2) return false;
    if (from.toLowerCase() === to.toLowerCase()) {
      removePromptSub(from, { silent: true });
      return false;
    }
    var list = cinema.promptSubs || [];
    var key = from.toLowerCase();
    var found = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].from.toLowerCase() === key) {
        list[i] = { from: list[i].from, to: to };
        found = true;
        break;
      }
    }
    if (!found) list.push({ from: from, to: to });
    cinema.promptSubs = list
      .filter(function (s) {
        return s.from && s.from.toLowerCase() !== String(s.to).toLowerCase();
      })
      .slice(0, 80);
    savePromptSubs({ silent: !!opts.silent });
    return true;
  }

  function removePromptSub(from, opts) {
    opts = opts || {};
    var key = String(from || "").toLowerCase();
    cinema.promptSubs = (cinema.promptSubs || []).filter(function (s) {
      return s.from.toLowerCase() !== key;
    });
    savePromptSubs({ silent: !!opts.silent });
  }

  function clearPromptSubs(opts) {
    cinema.promptSubs = [];
    savePromptSubs(opts || {});
  }

  function fillDiagnosticPrompt(stillPrompt, opts) {
    opts = opts || {};
    var force = opts.force !== false; // default: always refresh fields with memory
    var input = $("adv-diag-prompt");
    var buzzEl = $("adv-diag-buzz");
    var motionEl = $("adv-diag-motion");
    var hasSpells = spellRefsForStyle().length > 0;
    var buzzList = adventureBuzzWords(hasSpells);
    var buzzStr = buzzList.join(", ");
    var motionBase = buildMotionPromptFromStill(stillPrompt);

    cinema.lastBuiltPrompt = stillPrompt || "";
    cinema.lastBuiltBuzz = buzzStr;
    cinema.lastBuiltMotion = motionBase;

    // Raw base + table replacements
    var stillOut = applyPromptSubs(stillPrompt || "");
    var buzzOut = applyPromptSubs(buzzStr);
    var motionOut = applyPromptSubs(motionBase);
    if (stillOut !== (stillPrompt || "")) {
      motionOut = applyPromptSubs(buildMotionPromptFromStill(stillOut));
    }

    if (input && (force || !input.value.trim())) {
      input.value = stillOut;
    }
    if (buzzEl && (force || !buzzEl.value.trim())) {
      buzzEl.value = buzzOut;
    }
    if (motionEl && (force || !motionEl.value.trim())) {
      motionEl.value = motionOut;
    }

    cinema.lastFilledStill = input ? input.value : stillOut;
    cinema.lastFilledBuzz = buzzEl ? buzzEl.value : buzzOut;
    cinema.lastFilledMotion = motionEl ? motionEl.value : motionOut;
    cinema.diagDirty = false;
    refreshDiagHighlight();
  }

  function getDiagStillPrompt() {
    var el = $("adv-diag-prompt");
    if (el && el.value.trim()) return el.value.trim();
    return cinema.promptLine || cinema.lastBuiltPrompt || "";
  }

  function getDiagBuzzWords() {
    var el = $("adv-diag-buzz");
    if (!el || !el.value.trim()) return adventureBuzzWords(spellRefsForStyle().length > 0);
    return el.value
      .split(",")
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean)
      .slice(0, 24);
  }

  function getDiagMotionPrompt(stillPrompt) {
    var el = $("adv-diag-motion");
    if (el && el.value.trim()) return el.value.trim();
    return buildMotionPromptFromStill(stillPrompt || getDiagStillPrompt());
  }

  function isHoldGenerate() {
    var el = $("adv-hold-gen");
    if (el) return !!el.checked;
    return !!cinema.holdGenerate;
  }

  function loadHoldPref() {
    try {
      cinema.holdGenerate = localStorage.getItem(HOLD_GEN_KEY) === "1";
    } catch (e) {
      cinema.holdGenerate = false;
    }
    var el = $("adv-hold-gen");
    if (el) el.checked = cinema.holdGenerate;
  }

  function saveHoldPref(on) {
    cinema.holdGenerate = !!on;
    try {
      localStorage.setItem(HOLD_GEN_KEY, on ? "1" : "0");
    } catch (e) {}
  }

  function generateFromDiagnostic() {
    var prompt = getDiagStillPrompt();
    if (!prompt) {
      setErrorBanner("Diagnostic prompt is empty — rebuild from scene first.");
      return;
    }
    var residual = updateResidualRiskUi();
    if (residual && (residual.high || residual.repHigh || residual.med || residual.repMed)) {
      var msg =
        "Heuristic still sees moderation risk before send.\n\n";
      if (residual.flags && residual.flags.length) {
        msg +=
          "In prompt: " +
          formatFlagList(residual.flags, 20) +
          "\n";
      }
      if (residual.repFlags && residual.repFlags.length) {
        msg +=
          "In your replacements: " +
          formatFlagList(residual.repFlags, 20) +
          "\n";
      }
      msg +=
        "\nThe API often refuses these. Edit the table / prompt first, or OK to try anyway.";
      if (!window.confirm(msg)) return;
    }
    cinema.promptLine = prompt;
    cinema.diagDirty = false;
    cinema.lastFilledStill = prompt;
    var buzzEl = $("adv-diag-buzz");
    var motionEl = $("adv-diag-motion");
    if (buzzEl) cinema.lastFilledBuzz = buzzEl.value;
    if (motionEl) cinema.lastFilledMotion = motionEl.value;
    // Bust caches for current scene so edited text is used
    var key = cinema.sceneKey;
    if (key) {
      delete cinema.videoCache[key];
      delete cinema.genCache[key];
    }
    // Fingerprint edit so cache doesn't collide with unedited scene
    var editKey =
      (key || "diag") +
      "|edit:" +
      String(prompt.length) +
      ":" +
      String(prompt.slice(0, 24)).replace(/\s+/g, "_");
    cinema.sceneKey = editKey;
    stopHtmlVideo();
    setErrorBanner("");
    setDiagLastError("");
    cinema.genError = "";
    generateSceneVideo(editKey, prompt);
    startVideo();
  }

  function rebuildDiagnosticFromScene() {
    var node = getNode(state.nodeId);
    var extra = scenePlayerExtra(state.nodeId, node);
    var actionBit = extra
      ? "Player action (this free beat only): " +
        String(extra).replace(/\s+/g, " ").trim().slice(0, 160)
      : "";
    var cameoBit = castCameoClause();
    var prompt = cinematicPrompt(node, [actionBit, cameoBit].filter(Boolean).join(" "));
    cinema.promptLine = prompt;
    fillDiagnosticPrompt(prompt, { force: true });
    cinema.genPhase = isHoldGenerate()
      ? "Held — table replacements applied · edit then Generate"
      : cinema.genPhase;
    updateMediaLabel();
  }

  /**
   * Visual DNA only — description/style/mood/palette.
   * Never include gallery titles, "Spell #N", or other labels (they end up painted as tacky text).
   */
  function visualCameoFromSpell(s) {
    if (!s) return "";
    var num = s.num != null ? s.num : s.paintingNum;
    var a =
      num != null && window.getGalleryAnalysis
        ? window.getGalleryAnalysis(num)
        : null;
    var bits = [];
    if (a && typeof a === "object") {
      var desc = String(a.description || a.prompt || "")
        .replace(/\s+/g, " ")
        .trim();
      if (desc) bits.push(desc.slice(0, 140));
      // Deliberately skip a.title / labels
      if (a.style) bits.push(String(a.style).trim() + " style");
      if (a.mood) bits.push(String(a.mood).trim() + " mood");
      if (a.medium) bits.push(String(a.medium).trim());
      if (a.tags && a.tags.length) {
        bits.push(
          a.tags
            .slice(0, 6)
            .map(function (t) {
              return String(t);
            })
            .join(", ")
        );
      }
      if (a.colors && a.colors.length) {
        bits.push(
          "palette " +
            a.colors
              .slice(0, 4)
              .map(function (c) {
                return String(c);
              })
              .join(", ")
        );
      }
    }
    if (!bits.length) {
      return "subtle cameo of that painting's forms, brushwork, and color — no lettering";
    }
    return bits.join("; ").replace(/\s+/g, " ").trim().slice(0, 200);
  }

  /** Appended to scene prompt when spells are cast — cameo DNA, not titles */
  function castCameoClause() {
    var list = (media.castSpells || []).slice();
    if (media.styleForce) {
      var already = list.some(function (s) {
        return (
          s.url === media.styleForce.url ||
          (s.num && media.styleForce.num && s.num === media.styleForce.num)
        );
      });
      if (!already) list.unshift(media.styleForce);
    }
    list = list.slice(0, 3);
    if (!list.length) return "";
    var cameos = list
      .map(function (s) {
        return visualCameoFromSpell(s);
      })
      .filter(Boolean);
    if (!cameos.length) return "";
    return (
      "Cameo references (blend their look into the scene as silent visual DNA — " +
      "subjects, palette, light, motifs only; never paint titles, names, numbers, or captions): " +
      cameos.join(" | ")
    );
  }

  function spellRefsForStyle() {
    // Equipped cast spells first — image refs / painting nums only (no titles)
    var list = (media.castSpells || []).slice();
    if (media.styleForce) {
      var already = list.some(function (s) {
        return s.url === media.styleForce.url;
      });
      if (!already) list.unshift(media.styleForce);
    }
    return list
      .slice(0, 3)
      .map(function (s) {
        return {
          paintingNum: s.num || null,
          url: s.url,
          // Omit title/label so the generator never treats it as on-image text
        };
      })
      .filter(function (s) {
        return s.url || s.paintingNum;
      });
  }

  function absoluteUrl(url) {
    if (!url) return "";
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    try {
      return new URL(url, window.location.href).href;
    } catch (e) {
      return resolveUrl(url);
    }
  }

  function extractVideoUrl(payload) {
    if (!payload) return "";
    var vid = payload.video;
    var raw =
      (vid && (vid.url || vid.download_url || vid.uri)) ||
      payload.video_url ||
      payload.output_url ||
      payload.result_url ||
      "";
    if (window.GallerySaveVideo && window.GallerySaveVideo.preferSavedUrl) {
      raw = window.GallerySaveVideo.preferSavedUrl(payload, raw) || raw;
    }
    return absoluteUrl(raw);
  }

  function pollVideoJob(jobId, left) {
    left = left == null ? 90 : left;
    if (left <= 0) return Promise.reject(new Error("Timed out waiting for video"));
    return fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId) + "?t=" + Date.now()), {
      cache: "no-store",
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (job) {
        var st = String((job && job.status) || "").toLowerCase();
        if (st === "done" || st === "completed" || st === "success") {
          var url = extractVideoUrl(job);
          if (url) return url;
          throw new Error("Job finished but no video URL");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error(
            (job && job.error && (job.error.message || job.error)) || "Video job failed"
          );
        }
        cinema.genPhase = "Animating… " + st + " (" + left + ")";
        updateMediaLabel();
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve(pollVideoJob(jobId, left - 1));
          }, 1500);
        });
      });
  }

  function beginCinematicScene(nodeId, node, extraPlayerLine) {
    cinema.sceneKey = makeSceneKey(nodeId, extraPlayerLine || "");
    cinema.titleLine = (node && node.tag) || "Scene";
    cinema.narrFull = (node && node.text) || "";
    if (node && node.ending && node.endingTitle) {
      cinema.narrFull += "\n\nEnding: " + node.endingTitle;
    }
    // Free-beat player line only when scenePlayerExtra allows it — never bleed onto art write-ups
    var actionBit = extraPlayerLine
      ? "Player action (this free beat only): " +
        String(extraPlayerLine).replace(/\s+/g, " ").trim().slice(0, 160)
      : "";
    var cameoBit = castCameoClause();
    cinema.promptLine = cinematicPrompt(
      node,
      [actionBit, cameoBit].filter(Boolean).join(" ")
    );
    cinema.seqT0 = performance.now();
    cinema.genError = "";
    cinema.genUrl = null;
    stopHtmlVideo();
    rebuildShotList(null);
    // Learns any open edits, rebuilds base, re-applies wording memory
    fillDiagnosticPrompt(cinema.promptLine, { force: true });
    updateMediaLabel();
    if (isHoldGenerate()) {
      cinema.genLoading = false;
      cinema.genPhase = "Held — edit diagnostic prompt, then Generate";
      updateMediaLabel();
      return;
    }
    // Prefer textarea value so any mid-flight edit sticks when not held
    generateSceneVideo(cinema.sceneKey, getDiagStillPrompt() || cinema.promptLine);
  }

  /**
   * Fast video pipeline:
   * still → show still immediately → animate 6s@480p (no save wait) → play MP4
   * Gallery save runs in background only.
   */
  function generateSceneVideo(cacheKey, prompt) {
    cinema.genToken += 1;
    var token = cinema.genToken;

    if (cinema.videoCache[cacheKey]) {
      cinema.genLoading = false;
      cinema.genPhase = "";
      cinema.genError = "";
      setErrorBanner("");
      playHtmlVideo(cinema.videoCache[cacheKey]);
      if (cinema.genCache[cacheKey]) {
        cinema.genUrl = cinema.genCache[cacheKey];
        loadImage(cinema.genUrl).then(function () {
          if (token === cinema.genToken) rebuildShotList(cinema.genUrl);
        });
      }
      updateMediaLabel();
      return;
    }

    // Reuse still if we already have one for this scene (retry video only)
    if (cinema.genCache[cacheKey] && !cinema.videoCache[cacheKey]) {
      stillThenAnimate(token, cacheKey, prompt, cinema.genCache[cacheKey]);
      return;
    }

    cinema.genLoading = true;
    cinema.genPhase = "Still (fast)…";
    cinema.genUrl = null;
    cinema.genError = "";
    setErrorBanner("");
    updateMediaLabel();

    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "adv-" + Date.now();
    var spells = spellRefsForStyle();
    // Always prefer diagnostic editor so edits control the live request
    prompt = getDiagStillPrompt() || prompt;
    cinema.promptLine = prompt;
    var buzz = getDiagBuzzWords();
    cinema.genPhase =
      spells.length > 0
        ? "Still with " + spells.length + " spell(s)…"
        : "Still (fast)…";
    updateMediaLabel();
    setDiagLastError("");

    function safeJson(r) {
      return r.text().then(function (txt) {
        var d = {};
        try {
          d = txt ? JSON.parse(txt) : {};
        } catch (e) {
          d = { error: txt ? txt.slice(0, 200) : "Bad JSON", raw: true };
        }
        return { ok: r.ok, status: r.status, d: d };
      });
    }

    fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        stasis: prompt,
        prompt: prompt,
        buzz_words: buzz,
        spells: spells,
        aspect_ratio: "16:9",
        mag_fresh: true,
        spell_cast: spells.length > 0,
        fresh_variation: true,
        // Adventure is adult mystical fiction — keep dark intent in job metadata
        source: "adventure",
        fiction_mode: "mature_occult_myth",
      }),
    })
      .then(safeJson)
      .then(function (res) {
        if (token !== cinema.genToken) return null;
        var d = res.d || {};
        var url = extractImageUrl(d);
        if (res.status === 202 || (!url && (d.job_id || jobId))) {
          cinema.genPhase = "Still…";
          updateMediaLabel();
          return pollImageJob(d.job_id || jobId);
        }
        if (!res.ok) {
          throw new Error(
            (d && (d.error || d.message)) || "Still failed (" + res.status + ")"
          );
        }
        if (!url && d.job_id) return pollImageJob(d.job_id);
        if (!url) throw new Error("No still URL for video");
        return url;
      })
      .then(function (url) {
        if (token !== cinema.genToken || url == null) return null;
        return stillThenAnimate(token, cacheKey, prompt, absoluteUrl(url));
      })
      .catch(function (err) {
        if (token !== cinema.genToken) return;
        cinema.genLoading = false;
        cinema.genPhase = "";
        var msg = (err && err.message) || "Video unavailable";
        cinema.genError = msg;
        setDiagLastError(msg);
        setErrorBanner(
          "Video failed: " +
            msg +
            " · Edit the diagnostic prompt (remove red/yellow hits) and Generate again."
        );
        rebuildShotList(null);
        updateMediaLabel();
      });
  }

  function stillThenAnimate(token, cacheKey, prompt, stillUrl) {
    stillUrl = absoluteUrl(stillUrl);
    cinema.genCache[cacheKey] = stillUrl;
    cinema.genUrl = stillUrl;
    cinema.genLoading = true;
    cinema.genPhase = "Video (6s)… keep playing";
    cinema.genError = "";
    setErrorBanner("");
    updateMediaLabel();

    // Show still immediately so wait feels shorter
    loadImage(stillUrl).then(function () {
      if (token === cinema.genToken) rebuildShotList(stillUrl);
    });
    // Save in background — do not block animate
    saveStillToGallery(stillUrl, prompt);

    var motionPrompt = getDiagMotionPrompt(prompt);
    var motionEl = $("adv-diag-motion");
    if (motionEl && !motionEl.value.trim()) {
      motionEl.value = motionPrompt;
      refreshDiagHighlight();
    }

    function safeJson(r) {
      return r.text().then(function (txt) {
        var d = {};
        try {
          d = txt ? JSON.parse(txt) : {};
        } catch (e) {
          d = { error: txt ? txt.slice(0, 200) : "Bad JSON", raw: true };
        }
        return { ok: r.ok, status: r.status, d: d };
      });
    }

    return fetch(apiUrl("/api/animate-cast"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wait: false,
        wait_for_result: false,
        stasis: String(prompt).slice(0, 1200),
        prompt: motionPrompt.slice(0, 1200),
        image_to_life_prompt: motionPrompt.slice(0, 1200),
        generation_prompt: String(prompt).slice(0, 500),
        duration: 6,
        resolution: "480p",
        aspect_ratio: "16:9",
        image_url: stillUrl,
        reference_image: stillUrl,
      }),
    })
      .then(safeJson)
      .then(function (res) {
        if (token !== cinema.genToken || res == null) return null;
        var d = res.d || {};
        if (!res.ok) {
          throw new Error(
            (d && (d.error || d.message)) || "Video failed (" + res.status + ")"
          );
        }
        var jid = d.job_id || d.id;
        if (jid) {
          cinema.genPhase = "Video rendering…";
          updateMediaLabel();
          return pollVideoJob(jid);
        }
        var vurl = extractVideoUrl(d);
        if (vurl) return vurl;
        throw new Error("No video job id");
      })
      .then(function (vurl) {
        if (token !== cinema.genToken || vurl == null) return;
        var abs = absoluteUrl(vurl);
        cinema.videoCache[cacheKey] = abs;
        cinema.genLoading = false;
        cinema.genPhase = "";
        cinema.genError = "";
        setErrorBanner("");
        playHtmlVideo(abs);
        updateMediaLabel();
      })
      .catch(function (err) {
        if (token !== cinema.genToken) return;
        cinema.genLoading = false;
        cinema.genPhase = "";
        var msg = (err && err.message) || "Video unavailable";
        cinema.genError = msg;
        setDiagLastError(msg);
        setErrorBanner(
          "Video failed: " +
            msg +
            " · Still is ready. Edit motion/still diagnostic text and Generate, or continue the story."
        );
        if (stillUrl) {
          loadImage(stillUrl).then(function () {
            if (token === cinema.genToken) rebuildShotList(stillUrl);
          });
        }
        updateMediaLabel();
      });
  }

  /** Loading-stage shots while video is cooking */
  function rebuildShotList(heroUrl) {
    var shots = [];
    shots.push({ type: "title", duration: 1.8 });
    if (heroUrl && media.cache[heroUrl]) {
      shots.push({ type: "hero", url: heroUrl, duration: 8, drift: "slow" });
    } else {
      shots.push({ type: "atmosphere", duration: 6 });
    }
    cinema.shots = shots;
    cinema.seqT0 = performance.now();
  }

  function loadMediaPool(force) {
    if (media.loading) return Promise.resolve();
    if (media.loaded && !force) return Promise.resolve();
    media.loading = true;
    updateMediaLabel();

    var spellsP = fetch("data/manifest.json?t=" + Date.now())
      .then(function (r) {
        return r.ok ? r.json() : [];
      })
      .then(function (man) {
        var nums = [];
        if (Array.isArray(man)) {
          man.forEach(function (row) {
            if (typeof row === "number") nums.push(row);
            else if (row && row.number != null) nums.push(Number(row.number));
            else if (row && row.num != null) nums.push(Number(row.num));
          });
        } else if (man && Array.isArray(man.paintings)) {
          man.paintings.forEach(function (n) {
            nums.push(Number(n));
          });
        }
        nums = nums.filter(function (n) {
          return isFinite(n) && n > 0;
        });
        if (!nums.length) {
          for (var i = 1; i <= 120; i++) nums.push(i);
        }
        nums = shuffle(nums).slice(0, 60);
        media.spells = nums.map(function (n) {
          return {
            kind: "spell",
            num: n,
            label: "Spell #" + n,
            url: resolveUrl(paintingUrl(n)),
          };
        });
      })
      .catch(function () {
        var nums = [];
        for (var i = 1; i <= 80; i++) nums.push(i);
        media.spells = shuffle(nums)
          .slice(0, 40)
          .map(function (n) {
            return {
              kind: "spell",
              num: n,
              label: "Spell #" + n,
              url: resolveUrl(paintingUrl(n)),
            };
          });
      });

    var genUrl =
      (window.SPELLFORGE_API_BASE
        ? String(window.SPELLFORGE_API_BASE).replace(/\/$/, "")
        : "") + "/api/lod1-manifest?t=" + Date.now();
    var genP = fetch(genUrl)
      .then(function (r) {
        if (r.ok) return r.json();
        return fetch("data/lod1-manifest.json?t=" + Date.now()).then(function (r2) {
          return r2.ok ? r2.json() : { items: [] };
        });
      })
      .then(function (data) {
        var items = (data && data.items) || [];
        media.generated = shuffle(items)
          .slice(0, 60)
          .map(function (item) {
            var name = item.name || item.num + ".jpg";
            var url = item.url || "/generated/" + name;
            return {
              kind: "generated",
              num: item.num,
              label: "Generated #" + (item.num != null ? item.num : name),
              url: resolveUrl(url),
            };
          });
      })
      .catch(function () {
        media.generated = [];
      });

    return Promise.all([spellsP, genP]).then(function () {
      media.loading = false;
      media.loaded = true;
      buildStrip();
      // Preload a few
      media.strip.slice(0, 8).forEach(function (it) {
        loadImage(it.url);
      });
    });
  }

  /* —— Cinematic film player (prompt-led, not spell zoom) —— */
  var MOODS = {
    rain: [10, 14, 24],
    paint: [28, 18, 14],
    desk: [16, 18, 24],
    void: [12, 10, 20],
    glitch: [36, 8, 28],
    beam: [22, 28, 14],
    corridor: [18, 14, 24],
    creature: [24, 16, 10],
    glow: [22, 18, 36],
    stair: [14, 16, 30],
    loft: [30, 24, 16],
    studio: [20, 16, 26],
    mirror: [24, 28, 34],
    run: [32, 12, 12],
    end: [16, 12, 10],
  };

  function resizeCanvas() {
    var canvas = $("adv-video");
    var player = $("adv-player");
    if (!canvas || !player) return;
    var rect = player.getBoundingClientRect();
    var cssW = Math.max(320, Math.floor(rect.width) || 960);
    var cssH = Math.max(240, Math.floor(rect.height) || 540);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var tw = Math.floor(cssW * dpr);
    var th = Math.floor(cssH * dpr);
    if (canvas.width !== tw || canvas.height !== th) {
      canvas.width = tw;
      canvas.height = th;
    }
  }

  function drawStill(ctx, img, w, h, progress, drift) {
    if (!img || !img.naturalWidth) return false;
    var iw = img.naturalWidth;
    var ih = img.naturalHeight;
    // Very gentle drift only — no looping zoom pulse
    var zoom = drift === "still" ? 1.02 : 1.04 + progress * 0.03;
    var scale = Math.max(w / iw, h / ih) * zoom;
    var dw = iw * scale;
    var dh = ih * scale;
    var pan = drift === "pan" ? (progress - 0.5) * (dw - w) * 0.35 : (progress - 0.5) * (dw - w) * 0.12;
    var dx = (w - dw) / 2 + pan;
    var dy = (h - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    return true;
  }

  function drawAtmosphere(ctx, w, h, t, mood) {
    var c = MOODS[mood] || MOODS.void;
    var g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "rgb(" + (c[0] + 20) + "," + (c[1] + 16) + "," + (c[2] + 30) + ")");
    g.addColorStop(1, "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Soft volumetric light
    var lx = w * (0.5 + Math.sin(t * 0.25) * 0.05);
    var ly = h * 0.35;
    var rg = ctx.createRadialGradient(lx, ly, 8, lx, ly, h * 0.55);
    rg.addColorStop(0, "rgba(255,230,190,0.18)");
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);

    // Mood particles
    var i;
    ctx.fillStyle = "rgba(220,220,240,0.35)";
    if (mood === "rain" || mood === "void" || mood === "run") {
      ctx.strokeStyle = "rgba(180,200,230,0.25)";
      ctx.lineWidth = 1;
      for (i = 0; i < 40; i++) {
        var rx = ((i * 97 + t * 120) % w);
        var ry = ((i * 53 + t * 280) % h);
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 2, ry + 14);
        ctx.stroke();
      }
    } else if (mood === "paint" || mood === "glow" || mood === "creature") {
      for (i = 0; i < 28; i++) {
        var px = (Math.sin(t * 0.3 + i) * 0.5 + 0.5) * w;
        var py = ((i * 40 + t * 20) % h);
        ctx.beginPath();
        ctx.arc(px, py, 1.5 + (i % 3), 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      for (i = 0; i < 20; i++) {
        ctx.fillRect(((i * 61 + t * 15) % w), ((i * 37) % h), 1.5, 1.5);
      }
    }
  }

  function drawLetterbox(ctx, w, h) {
    var bar = Math.floor(h * 0.1);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, bar);
    ctx.fillRect(0, h - bar, w, bar);
  }

  function drawTitleCard(ctx, w, h, t, progress) {
    var mood = state._mood || "void";
    drawAtmosphere(ctx, w, h, t, mood);
    var alpha = progress < 0.15 ? progress / 0.15 : progress > 0.85 ? (1 - progress) / 0.15 : 1;
    ctx.fillStyle = "rgba(0,0,0," + (0.45 * alpha) + ")";
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(245,230,200," + alpha + ")";
    ctx.font = "600 " + Math.max(22, Math.floor(w / 28)) + "px Georgia,serif";
    var title = cinema.titleLine || "Scene";
    ctx.fillText(title, w / 2, h * 0.42);
    ctx.fillStyle = "rgba(200,190,210," + 0.85 * alpha + ")";
    ctx.font = Math.max(13, Math.floor(w / 55)) + "px system-ui,sans-serif";
    var sub = cinema.genLoading
      ? "Imagining this moment…"
      : "A night in the gallery";
    ctx.fillText(sub, w / 2, h * 0.5);
    ctx.textAlign = "left";
  }

  function drawNarration(ctx, w, h, seqT) {
    // Typewriter reveal of scene text as cinematic voiceover feel
    var full = cinema.narrFull || "";
    if (!full) return;
    var chars = Math.min(full.length, Math.floor(seqT * 28));
    var shown = full.slice(0, chars);
    var bar = Math.floor(h * 0.1);
    var boxY = h - bar - Math.max(70, h * 0.16);
    var boxH = Math.max(60, h * 0.14);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(w * 0.08, boxY, w * 0.84, boxH);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.strokeRect(w * 0.08, boxY, w * 0.84, boxH);
    ctx.fillStyle = "rgba(245,240,230,0.95)";
    ctx.font = Math.max(13, Math.floor(w / 58)) + "px Georgia,serif";
    wrapText(ctx, shown, w * 0.1, boxY + Math.max(22, h * 0.035), w * 0.8, Math.max(16, h * 0.028));
  }

  function wrapText(ctx, text, x, y, maxW, lineH) {
    var words = String(text).split(/\s+/);
    var line = "";
    var yy = y;
    var lines = 0;
    for (var n = 0; n < words.length && lines < 4; n++) {
      var test = line ? line + " " + words[n] : words[n];
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, yy);
        line = words[n];
        yy += lineH;
        lines++;
      } else {
        line = test;
      }
    }
    if (lines < 4 && line) ctx.fillText(line, x, yy);
  }

  function currentShot(seqT) {
    var shots = cinema.shots || [];
    if (!shots.length) return { type: "atmosphere", duration: 4, _local: 0, _progress: 0 };
    var total = 0;
    shots.forEach(function (s) {
      total += s.duration || 3;
    });
    // Loop after first shot (skip repeating title every loop)
    var loopStart = shots[0] && shots[0].type === "title" ? shots[0].duration : 0;
    var t = seqT;
    if (total > loopStart && seqT > total) {
      t = loopStart + ((seqT - loopStart) % Math.max(0.1, total - loopStart));
    }
    var acc = 0;
    for (var i = 0; i < shots.length; i++) {
      var d = shots[i].duration || 3;
      if (t < acc + d) {
        var local = t - acc;
        return {
          shot: shots[i],
          local: local,
          progress: Math.min(1, local / d),
          index: i,
        };
      }
      acc += d;
    }
    return { shot: shots[shots.length - 1], local: 0, progress: 1, index: shots.length - 1 };
  }

  function drawVideo(ts) {
    var canvas = $("adv-video");
    if (!canvas) {
      animId = 0;
      return;
    }
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (ts == null) ts = performance.now();
    if (!t0) t0 = ts;
    if (!cinema.seqT0) cinema.seqT0 = ts;
    var t = (ts - t0) / 1000;
    var seqT = (ts - cinema.seqT0) / 1000;
    var w = canvas.width || 1280;
    var h = canvas.height || 720;
    var mood = state._mood || "void";
    var cur = currentShot(seqT);
    var shot = cur.shot || { type: "atmosphere" };

    // Crossfade support: draw previous briefly at cut
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    if (shot.type === "title") {
      drawTitleCard(ctx, w, h, t, cur.progress);
    } else if (shot.type === "hero" || shot.type === "broll") {
      var img = shot.url ? media.cache[shot.url] : null;
      var ok = drawStill(ctx, img, w, h, cur.progress, shot.drift || "slow");
      if (!ok) drawAtmosphere(ctx, w, h, t, mood);
      // Soft grade
      var c = MOODS[mood] || MOODS.void;
      ctx.fillStyle = "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0.22)";
      ctx.fillRect(0, 0, w, h);
      // Fade in/out at shot edges
      var edge =
        cur.progress < 0.12 ? 1 - cur.progress / 0.12 : cur.progress > 0.88 ? (cur.progress - 0.88) / 0.12 : 0;
      if (edge > 0) {
        ctx.fillStyle = "rgba(0,0,0," + edge * 0.85 + ")";
        ctx.fillRect(0, 0, w, h);
      }
    } else {
      drawAtmosphere(ctx, w, h, t, mood);
      if (cinema.genLoading) {
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fillRect(0, 0, w, h);
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(255,240,220,0.92)";
        ctx.font = Math.max(15, Math.floor(w / 42)) + "px Georgia,serif";
        ctx.fillText(cinema.genPhase || "Generating…", w / 2, h * 0.48);
        ctx.fillStyle = "rgba(200,190,210,0.72)";
        ctx.font = Math.max(12, Math.floor(w / 60)) + "px system-ui,sans-serif";
        ctx.fillText("6s · 480p · still shows first, then video", w / 2, h * 0.54);
        ctx.textAlign = "left";
      }
    }

    // Vignette
    var vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.15, w / 2, h / 2, h * 0.72);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    drawLetterbox(ctx, w, h);
    // Narration starts after title card
    if (seqT > 1.6) drawNarration(ctx, w, h, seqT - 1.6);

    // Subtle film grain
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (var g = 0; g < 30; g++) {
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.2, 1.2);
    }

    animId = requestAnimationFrame(drawVideo);
  }

  function startVideo() {
    resizeCanvas();
    cancelAnimationFrame(animId);
    t0 = 0;
    drawVideo(performance.now());
  }

  function stopVideo() {
    cancelAnimationFrame(animId);
    animId = 0;
  }

  function restart(confirmFirst) {
    var node = getNode(state.nodeId);
    var onEnding = !!(node && node.ending);
    if (confirmFirst && state.nodeId !== "start" && !onEnding) {
      if (!window.confirm("Restart the adventure from the beginning? (Unlocked endings stay.)")) {
        return;
      }
    }
    var endings = state.endings || loadEndings();
    state = defaultState();
    state.endings = endings;
    state._freeNodes = {};
    media.pinned = null;
    media.styleForce = null;
    media.castSpells = [];
    cinema.genUrl = null;
    cinema.genError = "";
    cinema.genPhase = "";
    cinema.genLoading = false;
    cinema.genToken += 1;
    // Keep videoCache so re-visit of same scenes is fast; clear if user wants fresh?
    // Clear scene video cache so restart regenerates start video
    cinema.videoCache = {};
    cinema.genCache = {};
    stopHtmlVideo();
    setErrorBanner("");
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    saveGame();
    if (media.loaded) buildStrip();
    renderCastList();
    render();
    startVideo();
  }

  function retryVideo() {
    var key = cinema.sceneKey;
    if (key) {
      delete cinema.videoCache[key];
      delete cinema.genCache[key];
    }
    stopHtmlVideo();
    setErrorBanner("");
    var node = getNode(state.nodeId);
    beginCinematicScene(state.nodeId, node, scenePlayerExtra(state.nodeId, node));
    startVideo();
  }

  function bind() {
    if (!$("panel-adventure") || $("panel-adventure")._advBound) return;
    $("panel-adventure")._advBound = true;

    var rst = $("adv-restart");
    if (rst) {
      rst.addEventListener("click", function () {
        restart(true);
      });
    }
    var retry = $("adv-retry-video");
    if (retry) {
      retry.addEventListener("click", function () {
        retryVideo();
      });
    }
    var reshuffle = $("adv-reshuffle");
    if (reshuffle) {
      reshuffle.addEventListener("click", function () {
        retryVideo();
      });
    }
    var clearCast = $("adv-clear-cast");
    if (clearCast) {
      clearCast.addEventListener("click", function () {
        media.castSpells = [];
        media.styleForce = null;
        renderCastList();
        renderStrip();
        recastSceneVideo();
      });
    }
    bindSpellDropZone();
    loadHoldPref();
    loadPromptSubs();
    renderRewriteTable();
    var holdEl = $("adv-hold-gen");
    if (holdEl) {
      holdEl.addEventListener("change", function () {
        saveHoldPref(holdEl.checked);
        if (holdEl.checked) {
          cinema.genPhase = "Held — edit replacements, then Generate";
          updateMediaLabel();
        }
      });
    }
    var diagPrompt = $("adv-diag-prompt");
    if (diagPrompt) {
      diagPrompt.addEventListener("input", function () {
        cinema.diagDirty = true;
        refreshDiagHighlight({ skipTable: true });
      });
      diagPrompt.addEventListener("scroll", function () {
        syncHlScroll(diagPrompt, $("adv-diag-hl"));
      });
    }
    var diagMotion = $("adv-diag-motion");
    if (diagMotion) {
      diagMotion.addEventListener("input", function () {
        cinema.diagDirty = true;
        refreshDiagHighlight({ skipTable: true });
      });
      diagMotion.addEventListener("scroll", function () {
        syncHlScroll(diagMotion, $("adv-diag-motion-hl"));
      });
    }
    var diagBuzz = $("adv-diag-buzz");
    if (diagBuzz) {
      diagBuzz.addEventListener("input", function () {
        cinema.diagDirty = true;
        refreshDiagHighlight({ skipTable: true });
      });
    }
    var diagClearSubs = $("adv-diag-clear-subs");
    if (diagClearSubs) {
      diagClearSubs.addEventListener("click", function () {
        if (!cinema.promptSubs || !cinema.promptSubs.length) {
          cinema.genPhase = "No replacements set";
          updateMediaLabel();
          return;
        }
        if (
          !window.confirm(
            "Clear all replacement boxes? The prompt will go back to the original flagged words."
          )
        ) {
          return;
        }
        clearPromptSubs({ silent: true });
        if (cinema.lastBuiltPrompt) {
          fillDiagnosticPrompt(cinema.lastBuiltPrompt, { force: true });
        } else {
          renderRewriteTable();
        }
        cinema.genPhase = "Replacements cleared";
        updateMediaLabel();
      });
    }
    var diagGen = $("adv-diag-generate");
    if (diagGen) {
      diagGen.addEventListener("click", function () {
        generateFromDiagnostic();
      });
    }
    var diagRebuild = $("adv-diag-rebuild");
    if (diagRebuild) {
      diagRebuild.addEventListener("click", function () {
        rebuildDiagnosticFromScene();
      });
    }
    var diagCopy = $("adv-diag-copy");
    if (diagCopy) {
      diagCopy.addEventListener("click", function () {
        var text =
          "=== STILL / STASIS ===\n" +
          getDiagStillPrompt() +
          "\n\n=== BUZZ ===\n" +
          getDiagBuzzWords().join(", ") +
          "\n\n=== MOTION ===\n" +
          getDiagMotionPrompt();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            function () {
              cinema.genPhase = "Prompt copied";
              updateMediaLabel();
            },
            function () {
              setErrorBanner("Could not copy to clipboard.");
            }
          );
        } else {
          setErrorBanner("Clipboard not available — select the text manually.");
        }
      });
    }
    var cancel = $("adv-modal-cancel");
    if (cancel) cancel.addEventListener("click", closeModal);
    var goBtn = $("adv-modal-go");
    if (goBtn) goBtn.addEventListener("click", submitCustom);
    var input = $("adv-custom-input");
    if (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          submitCustom();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          closeModal();
        }
      });
    }
    var modal = $("adv-modal");
    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target === modal) closeModal();
      });
    }
    window.addEventListener("resize", function () {
      if (document.body.getAttribute("data-active-tab") === "adventure") {
        resizeCanvas();
      }
    });
  }

  function onShow() {
    bind();
    loadHoldPref();
    loadGame();
    if (!state._freeNodes) state._freeNodes = {};
    var node = getNode(state.nodeId);
    state._mood = (node && node.mood) || "void";
    render();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        startVideo();
        loadMediaPool(false).then(function () {
          // Rebuild shots with b-roll available if vision still loading
          if (!cinema.genUrl) rebuildShotList(null);
          startVideo();
        });
      });
    });
  }

  function onHide() {
    stopVideo();
    stopHtmlVideo();
    closeModal();
  }

  window.Adventure = { onShow: onShow, onHide: onHide };
  window.addEventListener("adventure-show", onShow);
  window.addEventListener("adventure-hide", onHide);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();

