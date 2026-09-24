/**
 * Engrams — surreal acronym / backronym experience.
 * Type any word; each letter expands into a thought-provoking word
 * biased toward the seed's meaning so communication cues of the
 * original word survive elongation.
 */
(function () {
  "use strict";

  var HISTORY_KEY = "engrams_history_v1";
  var HISTORY_MAX = 40;
  var LENS_KEY_PREFIX = "engrams_lens_v1_";
  var MAX_SEED_LEN = 64;
  var LEN_MIN = 1;
  var LEN_MAX = 15;
  var LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  /** Curated surreal / philosophical / artistic lexicon per letter. */
  var LEXICON = {
    A: [
      "Arise", "Abyss", "Aurora", "Alchemy", "Aether", "Axiom", "Amethyst",
      "Aphelion", "Arcane", "Astral", "Anamnesis", "Aperture", "Avalanche",
      "Allegory", "Aeon", "Atelier", "Ambrosia", "Aporia", "Artificial",
      "Algorithm", "Affection", "Altar", "Armor", "Anger", "Art", "Atlas",
      "Agency", "Avatar", "Ash", "Anchor", "Amity", "Absence"
    ],
    B: [
      "Beacon", "Bloom", "Bardo", "Babel", "Benthos", "Becoming", "Bricolage",
      "Breath", "Boreal", "Buddhafield", "Basalt", "Beloved", "Brume", "Byzantine",
      "Binary", "Brain", "Bond", "Battle", "Blood", "Bone", "Body", "Blaze",
      "Belief", "Ballad", "Brother", "Birth", "Bridge", "Balance"
    ],
    C: [
      "Chorus", "Chiaroscuro", "Cipher", "Cascade", "Cosmos", "Chrysalis",
      "Catharsis", "Cathedral", "Cartography", "Crescent", "Chimera", "Cadence",
      "Celestial", "Cloister", "Chronicle", "Code", "Circuit", "Cognition",
      "Canvas", "Color", "Compassion", "Conflict", "Chaos", "Child", "City",
      "Crown", "Compute", "Creation", "Communion", "Courage", "Calm",
      "Curiosity", "Clan"
    ],
    D: [
      "Dream", "Depth", "Dawn", "Dialect", "Diaspora", "Duet", "Daimon",
      "Dissonance", "Dwelling", "Dervish", "Diaphanous", "Destiny", "Delta", "Doctrine",
      "Data", "Digital", "Devotion", "Death", "Dark", "Day", "Desire", "Dialogue",
      "Design", "Dominion", "Daughter", "Dread", "Delight", "Dust",
      "Dictionary", "Discourse", "Dedicated", "Dimension"
    ],
    E: [
      "Echo", "Eclipse", "Ember", "Epiphany", "Elysium", "Entropy", "Eden",
      "Emanation", "Ether", "Eloquent", "Eunoia", "Exegesis", "Elegy", "Emergence",
      "Engine", "Emotion", "Earth", "Enemy", "Empire", "Essence", "Energy",
      "Expression", "Eternity", "Empathy", "Edenic", "Education", "Edge"
    ],
    F: [
      "Fold", "Fractal", "Fathom", "Flame", "Fugue", "Filament", "Fable",
      "Frontier", "Fiction", "Fluence", "Formless", "Forge", "Fervor", "Fenestration",
      "Future", "Father", "Friend", "Fear", "Fire", "Faith", "Freedom", "Form",
      "Frequency", "Family", "Frame", "Forest", "Feeling", "Force"
    ],
    G: [
      "Glyph", "Gossamer", "Gravity", "Genesis", "Grail", "Gnostic", "Garden",
      "Glimpse", "Golem", "Golden", "Gyre", "Galaxy", "Grace", "Geometry",
      "God", "Gallery", "Game", "Gift", "Grief", "Glory", "Guidance", "Gesture",
      "Grammar", "Growth", "Guardian", "Glow", "Ground", "Gospel"
    ],
    H: [
      "Horizon", "Halo", "Hymn", "Hologram", "Hearth", "Hush", "Helix",
      "Hypothesis", "Harbor", "Hermetic", "Hue", "Harbinger", "Hollow", "Hyperion",
      "Heart", "Human", "Home", "Hope", "Harmony", "History", "Hardware",
      "Holy", "Hunger", "Heir", "Heat", "Honor"
    ],
    I: [
      "Interest", "Infinite", "Iris", "Ink", "Incantation", "Icarus", "Island",
      "Illusion", "Insight", "Icon", "Idyll", "Ineffable", "Ion", "Intuition",
      "Intelligence", "Idea", "Identity", "Image", "Interface", "Inference",
      "Inspiration", "Intimacy", "Iron", "Ignition", "Inner", "Idiom", "Imagination"
    ],
    J: [
      "Journey", "Jewel", "Juncture", "Jubilant", "Jasmine", "Jigsaw", "Joule",
      "Judgment", "Jade", "Jettison", "Joy", "Juxtapose", "Janus", "Journal",
      "Justice", "Jubilee", "Junction", "Jargon", "Join", "Jest"
    ],
    K: [
      "Key", "Kinetic", "Karma", "Kaleidoscope", "Kindling", "Kingdom", "Knot",
      "Koan", "Kyoto", "Keel", "Kismet", "Knowledge", "Kairos", "Kraken",
      "Kin", "King", "Kernel", "Kindness", "Keep", "Kiss"
    ],
    L: [
      "Lumen", "Labyrinth", "Liminal", "Lotus", "Lattice", "Lucid", "Legacy",
      "Lantern", "Lyric", "Lapis", "Leviathan", "Lullaby", "Lexicon", "Longitude",
      "Love", "Light", "Life", "Language", "Learning", "Logic", "Labor", "Liberty",
      "Letter", "Lore", "Loss", "Laughter", "Landscape", "Law",
      "Longing", "Loyalty", "Luminosity"
    ],
    M: [
      "Myth", "Mirror", "Mosaic", "Metamorphosis", "Moon", "Mnemonic", "Muse",
      "Monad", "Meridian", "Manifest", "Mystery", "Mandala", "Murmur", "Memory",
      "Mind", "Machine", "Music", "Mother", "Magic", "Money", "Model", "Meaning",
      "Message", "Motion", "Mercy", "Mortal", "Matrix", "Melody"
    ],
    N: [
      "Nexus", "Night", "Nebula", "Notion", "Numinous", "Nest", "Narrative",
      "Nadir", "Nocturne", "Nemesis", "Nectar", "Nova", "Nameless", "Needle",
      "Name", "Network", "Nature", "Now", "Neural", "Nurture", "Noise", "Nation",
      "Note", "Number", "Nearness", "Null"
    ],
    O: [
      "Oracle", "Orbit", "Origin", "Omen", "Opaline", "Odyssey", "Ocean",
      "Obsidian", "Overture", "Omniscient", "Opus", "Outlet", "Oasis", "Ontology",
      "Order", "Output", "Opera", "Offspring", "Oath", "Offering", "Openness",
      "Oxide", "Outlook", "Overmind",
      "Oration"
    ],
    P: [
      "Prism", "Portal", "Poem", "Paradox", "Phoenix", "Pulse", "Palette",
      "Pilgrim", "Pneuma", "Pinnacle", "Phantom", "Praxis", "Pyre", "Presence",
      "Paint", "Power", "Peace", "Play", "Pain", "Past", "Person", "Prayer",
      "Process", "Pattern", "Promise", "Passion", "Path", "Purpose"
    ],
    Q: [
      "Quest", "Quantum", "Quiet", "Quill", "Quasar", "Quiver", "Quintessence",
      "Query", "Quorum", "Quartz", "Quixotic", "Quotient", "Quake", "Quondam",
      "Queen", "Question", "Quicken", "Quality", "Quench"
    ],
    R: [
      "Riddle", "Radiance", "Rune", "Reverie", "River", "Resonance", "Ritual",
      "Rose", "Realm", "Rapture", "Root", "Rhapsody", "Relic", "Revelation",
      "Robot", "Reason", "Romance", "Rage", "Road", "Rhythm", "Recall", "Reign",
      "Render", "Relation", "Refuge", "Reckoning", "Radiant", "Reply"
    ],
    S: [
      "Surreal", "Silence", "Spiral", "Star", "Synapse", "Solstice", "Shadow",
      "Symphony", "Seed", "Sigil", "Solitude", "Spectrum", "Sutra", "Seraph",
      "Soul", "Story", "Speech", "System", "Science", "Spell", "Sun", "Sea",
      "Sky", "Self", "Space", "Strength", "Sorrow", "Signal", "Syntax", "Spirit"
    ],
    T: [
      "Threshold", "Temple", "Tide", "Tapestry", "Truth", "Twilight", "Talisman",
      "Tesseract", "Testament", "Thread", "Trance", "Totem", "Topology", "Tremor",
      "Time", "Thought", "Tech", "Tree", "Trust", "Terror", "Tenderness", "Theory",
      "Token", "Tongue", "Triumph", "Transit", "Texture", "Teaching"
    ],
    U: [
      "Umbra", "Universe", "Unfold", "Utopia", "Ultraviolet", "Undercurrent",
      "Ursine", "Unity", "Urn", "Uprising", "Ultramarine", "Unspoken", "Umbilical", "Uplift",
      "Understanding", "Union", "Utility", "Urge", "Ultrahuman", "Upstream"
    ],
    V: [
      "Vision", "Vortex", "Veil", "Vesper", "Voyage", "Vivid", "Vault",
      "Verse", "Vigil", "Vapor", "Vernacular", "Vesperal", "Vertex", "Vita",
      "Voice", "Virtue", "Victory", "Voltage", "Vessel", "Value", "Void", "Vow",
      "Velvet", "Vitality"
    ],
    W: [
      "Wonder", "Woven", "Whisper", "Wyrd", "Watershed", "Womb", "Wavelength",
      "Wilderness", "Waking", "Witness", "Wreathe", "Wayfarer", "Wisdom", "Wisp",
      "Word", "Work", "Water", "War", "Will", "Warmth", "Writing", "World",
      "Wound", "Wealth", "Wave", "Worship"
    ],
    X: [
      "Xenolith", "Xanadu", "Xylem", "Xenial", "Xeric", "Xylograph", "Xenogenesis",
      "X-factor", "Xenon", "Xanthic", "Xylophone", "Xenogamy", "Xiphoid", "Xyst",
      "Xenotype", "X-axis", "Xenogeny"
    ],
    Y: [
      "Yearn", "Yonder", "Yarn", "Yugen", "Yellow", "Yoke", "Yarrow",
      "Yield", "Ylem", "Yogic", "Youth", "Yaw", "Yggdrasil", "Yes",
      "Year", "Yester", "Yowl"
    ],
    Z: [
      "Zenith", "Zephyr", "Zodiac", "Ziggurat", "Zeitgeist", "Zone", "Zest",
      "Zircon", "Zero", "Zen", "Zigzag", "Zealous", "Zither", "Zoar",
      "Zeal", "Zonal"
    ]
  };
  var WORD_TAGS = {
    "absence": ["silence", "void", "loss"],
    "abyss": ["dark", "mystery", "depth"],
    "ache": ["pain", "hurt", "body"],
    "aeon": ["time", "eternity"],
    "aether": ["spirit", "cosmos", "space"],
    "affection": ["love", "emotion", "heart"],
    "agency": ["power", "self", "mind"],
    "algorithm": ["tech", "code", "logic", "learning"],
    "allegory": ["language", "hermeneutic", "interpretation"],
    "altar": ["divine", "spirit", "ritual"],
    "amity": ["friend", "peace", "love"],
    "amusement": ["play", "game", "joy"],
    "anamnesis": ["memory", "mind"],
    "anchor": ["home", "order", "hope"],
    "anger": ["anger", "emotion", "conflict"],
    "anxiety": ["fear", "dread", "dark"],
    "aperture": ["art", "light", "vision"],
    "aquifer": ["water", "sea", "flow"],
    "arcane": ["magic", "mystery", "spell"],
    "archive": ["past", "memory", "history"],
    "arena": ["game", "play", "rule"],
    "armor": ["war", "body", "power"],
    "art": ["art", "creation", "beauty"],
    "artificial": ["tech", "mind", "machine", "learning"],
    "ash": ["fire", "death", "past"],
    "astral": ["space", "spirit", "cosmos"],
    "atelier": ["art", "paint", "creation"],
    "atlas": ["earth", "nature", "ground"],
    "aurora": ["light", "sky", "beauty"],
    "avatar": ["identity", "tech", "self"],
    "avenue": ["road", "journey", "path"],
    "axiom": ["truth", "logic", "knowledge"],
    "babel": ["language", "chaos", "story"],
    "balance": ["order", "peace", "body"],
    "ballad": ["music", "story", "voice"],
    "base": ["bone", "body", "structure"],
    "battle": ["war", "conflict", "power"],
    "beacon": ["light", "hope", "guide"],
    "becoming": ["life", "self", "future"],
    "belief": ["faith", "mind", "truth"],
    "beloved": ["love", "heart", "emotion"],
    "benthos": ["sea", "depth", "earth"],
    "binary": ["tech", "code", "logic"],
    "birth": ["life", "child", "beginning"],
    "blaze": ["fire", "light", "anger"],
    "blood": ["blood", "life", "body", "family"],
    "body": ["body", "human", "self"],
    "bond": ["love", "friend", "family"],
    "bone": ["bone", "body", "death"],
    "brain": ["mind", "body", "learning"],
    "breath": ["life", "body", "spirit"],
    "bridge": ["road", "connection", "peace"],
    "brother": ["family", "friend", "human"],
    "cadence": ["music", "rhythm", "voice"],
    "calm": ["peace", "silence", "order"],
    "canvas": ["art", "paint", "creation"],
    "cascade": ["chaos", "disorder", "entropy"],
    "catharsis": ["emotion", "art", "release"],
    "celestial": ["sky", "space", "divine"],
    "chaos": ["chaos", "disorder"],
    "charm": ["magic", "spell", "wonder"],
    "chiaroscuro": ["art", "light", "dark"],
    "child": ["child", "family", "life"],
    "chorus": ["music", "voice", "harmony"],
    "chronicle": ["story", "time", "memory"],
    "cipher": ["code", "language", "mystery"],
    "circuit": ["tech", "machine", "energy"],
    "city": ["city", "human", "home"],
    "code": ["code", "tech", "language"],
    "cognition": ["mind", "learning", "knowledge"],
    "color": ["art", "paint", "beauty"],
    "compassion": ["love", "peace", "emotion"],
    "compute": ["tech", "machine", "mind"],
    "conflict": ["war", "conflict", "chaos"],
    "cosmos": ["space", "cosmos", "order"],
    "courage": ["hope", "war", "power"],
    "craft": ["work", "labor", "creation"],
    "creation": ["creation", "art", "life"],
    "crowd": ["city", "people", "home"],
    "crown": ["royalty", "power", "order"],
    "curiosity": ["child", "youth", "family"],
    "dark": ["dark", "night", "mystery"],
    "data": ["tech", "knowledge", "code"],
    "daughter": ["family", "child", "human"],
    "dawn": ["day", "light", "beginning"],
    "day": ["day", "light", "time"],
    "death": ["death", "end", "silence"],
    "delight": ["joy", "emotion", "light"],
    "depth": ["dream", "mind", "night"],
    "design": ["art", "creation", "order"],
    "desire": ["love", "emotion", "want"],
    "devotion": ["love", "divine", "faith"],
    "dialect": ["language", "voice", "identity"],
    "dialogue": ["language", "voice", "story"],
    "digital": ["tech", "machine", "code"],
    "doctrine": ["truth", "order", "knowledge"],
    "dominion": ["power", "order", "royalty"],
    "dread": ["fear", "dark", "emotion"],
    "dream": ["dream", "mind", "night"],
    "drift": ["road", "journey", "path"],
    "dust": ["earth", "death", "past"],
    "dwelling": ["home", "body", "place"],
    "earth": ["earth", "nature", "home"],
    "ease": ["peace", "calm", "order"],
    "echo": ["voice", "memory", "sound"],
    "eclipse": ["dark", "sun", "moon"],
    "eddy": ["water", "sea", "flow"],
    "eden": ["garden", "peace", "beginning"],
    "edge": ["enemy", "conflict", "war"],
    "education": ["learning", "knowledge", "mind"],
    "elegance": ["royalty", "power", "order"],
    "elegy": ["death", "memory", "voice"],
    "elm": ["tree", "nature", "life"],
    "eloquent": ["language", "voice", "beauty"],
    "elysium": ["peace", "divine", "afterlife"],
    "ember": ["fire", "hope", "past"],
    "embrace": ["love", "hold", "warmth"],
    "emergence": ["life", "future", "creation"],
    "emotion": ["emotion", "heart", "feeling"],
    "empathy": ["love", "mind", "emotion"],
    "empire": ["power", "royalty", "order"],
    "emptiness": ["silence", "quiet", "peace"],
    "enemy": ["enemy", "war", "conflict"],
    "energy": ["energy", "force", "tech"],
    "engage": ["game", "play", "rule"],
    "engine": ["machine", "tech", "power", "engine"],
    "entropy": ["chaos", "time", "physics"],
    "eon": ["time", "past", "future"],
    "epiphany": ["mind", "insight", "truth"],
    "essence": ["spirit", "self", "truth"],
    "eternity": ["time", "divine", "forever"],
    "ether": ["spirit", "space", "aether"],
    "example": ["family", "parent", "guide"],
    "exchange": ["money", "value", "wealth"],
    "exegesis": ["language", "hermeneutic", "interpretation"],
    "exhibit": ["gallery", "art", "paint"],
    "expression": ["art", "language", "emotion"],
    "fable": ["story", "myth", "language"],
    "faith": ["faith", "divine", "hope"],
    "family": ["family", "home", "love"],
    "father": ["family", "human", "parent"],
    "fear": ["fear", "emotion", "dark"],
    "feeling": ["emotion", "heart", "body"],
    "fiction": ["story", "language", "dream"],
    "fire": ["fire", "energy", "passion"],
    "flame": ["fire", "light", "passion"],
    "flesh": ["body", "human", "life"],
    "force": ["power", "war", "energy"],
    "forest": ["tree", "nature", "earth"],
    "forge": ["creation", "fire", "work"],
    "form": ["art", "order", "body"],
    "foundation": ["family", "parent", "guide"],
    "frame": ["art", "order", "vision"],
    "freedom": ["liberty", "power", "self"],
    "friend": ["friend", "love", "human"],
    "frontier": ["future", "space", "journey"],
    "frost": ["fear", "dread", "dark"],
    "fugue": ["music", "mind", "pattern"],
    "future": ["future", "time", "hope"],
    "galaxy": ["space", "cosmos", "star"],
    "gallery": ["art", "gallery", "paint"],
    "gambit": ["game", "play", "rule"],
    "game": ["game", "play", "rule"],
    "garden": ["nature", "home", "life"],
    "gear": ["engine", "machine", "tech"],
    "genesis": ["beginning", "creation", "life"],
    "gesture": ["body", "language", "art"],
    "gift": ["gift", "skill", "ability", "giving"],
    "gloom": ["night", "dark", "dream"],
    "glory": ["royalty", "power", "order"],
    "glow": ["light", "warmth", "hope"],
    "glyph": ["language", "code", "symbol"],
    "god": ["divine", "spirit", "power"],
    "golem": ["magic", "creation", "body"],
    "gospel": ["truth", "divine", "story"],
    "grace": ["beauty", "divine", "peace"],
    "grammar": ["language", "order", "code"],
    "grief": ["sorrow", "death", "emotion"],
    "ground": ["earth", "home", "truth"],
    "growth": ["life", "nature", "future"],
    "guardian": ["protect", "power", "friend"],
    "guidance": ["hope", "path", "wisdom"],
    "halo": ["divine", "light", "holy"],
    "harbor": ["home", "sea", "refuge"],
    "hardware": ["tech", "machine", "body"],
    "harmony": ["music", "peace", "order"],
    "havoc": ["chaos", "disorder", "entropy"],
    "heart": ["heart", "love", "emotion"],
    "hearth": ["home", "fire", "family"],
    "heat": ["fire", "energy", "passion"],
    "heir": ["family", "legacy", "future"],
    "history": ["past", "story", "memory"],
    "hologram": ["tech", "illusion", "light"],
    "holy": ["divine", "spirit", "sacred"],
    "home": ["home", "family", "place"],
    "honesty": ["truth", "reality", "light"],
    "honor": ["virtue", "war", "truth"],
    "hope": ["hope", "future", "light"],
    "horizon": ["sky", "future", "journey"],
    "hue": ["color", "art", "light"],
    "human": ["human", "self", "body"],
    "humus": ["earth", "nature", "ground"],
    "hush": ["silence", "peace", "night"],
    "hymn": ["music", "divine", "voice"],
    "hypothesis": ["mind", "science", "learning"],
    "icon": ["symbol", "art", "tech"],
    "idea": ["mind", "creation", "thought"],
    "identity": ["self", "name", "human"],
    "idiom": ["language", "meaning", "voice"],
    "ignition": ["fire", "start", "energy"],
    "illusion": ["mind", "dream", "trick"],
    "image": ["art", "vision", "memory"],
    "incantation": ["magic", "spell", "voice"],
    "inference": ["mind", "logic", "learning"],
    "injury": ["pain", "hurt", "body"],
    "ink": ["language", "art", "writing"],
    "inner": ["self", "mind", "spirit"],
    "innocence": ["child", "youth", "family"],
    "insight": ["mind", "truth", "learning"],
    "inspiration": ["art", "creation", "spirit"],
    "intelligence": ["mind", "tech", "learning", "knowledge"],
    "interface": ["tech", "code", "connection"],
    "intersection": ["city", "people", "home"],
    "interval": ["time", "past", "future"],
    "intimacy": ["love", "close", "emotion"],
    "intuition": ["mind", "feeling", "insight"],
    "iris": ["eye", "color", "vision"],
    "iron": ["royalty", "power", "order"],
    "jargon": ["language", "hermeneutic", "speech"],
    "jest": ["play", "joy", "voice"],
    "journal": ["story", "writing", "memory"],
    "journey": ["road", "life", "quest"],
    "joy": ["joy", "emotion", "light"],
    "jubilant": ["joy", "emotion", "celebration"],
    "jubilee": ["joy", "celebration", "freedom"],
    "justice": ["truth", "order", "law"],
    "kairos": ["time", "moment", "fate"],
    "kernel": ["code", "core", "essence"],
    "kin": ["family", "blood", "friend"],
    "kindling": ["fire", "start", "hope"],
    "kindness": ["love", "peace", "emotion"],
    "king": ["royalty", "power", "order"],
    "kingdom": ["royalty", "power", "order"],
    "kiss": ["love", "intimacy", "emotion"],
    "kite": ["sky", "air", "space"],
    "knowledge": ["knowledge", "mind", "learning"],
    "kohl": ["dark", "night", "mystery"],
    "labor": ["work", "body", "creation"],
    "landscape": ["earth", "art", "nature"],
    "language": ["language", "word", "voice"],
    "lantern": ["light", "guide", "night"],
    "laughter": ["joy", "voice", "emotion"],
    "law": ["order", "truth", "power"],
    "learning": ["learning", "mind", "knowledge"],
    "legacy": ["past", "family", "memory"],
    "letter": ["language", "writing", "word"],
    "lexicon": ["language", "hermeneutic", "word"],
    "liberty": ["freedom", "power", "self"],
    "life": ["life", "living", "body"],
    "light": ["light", "day", "hope"],
    "logic": ["logic", "mind", "order"],
    "longing": ["love", "desire", "yearn"],
    "lore": ["story", "knowledge", "myth"],
    "loss": ["death", "grief", "absence"],
    "love": ["love", "heart", "emotion"],
    "lucid": ["mind", "dream", "clarity"],
    "lull": ["silence", "quiet", "peace"],
    "lumen": ["light", "vision", "tech"],
    "machine": ["machine", "tech", "engine"],
    "magic": ["magic", "spell", "wonder"],
    "mark": ["name", "identity", "word"],
    "matrix": ["tech", "code", "structure"],
    "meaning": ["meaning", "truth", "language"],
    "melody": ["music", "beauty", "voice"],
    "memory": ["memory", "past", "mind"],
    "menace": ["enemy", "conflict", "war"],
    "mercy": ["peace", "compassion", "divine"],
    "meridian": ["moon", "night", "sky"],
    "message": ["language", "communication", "word"],
    "mind": ["mind", "thought", "learning"],
    "mint": ["money", "value", "wealth"],
    "mirror": ["self", "reflection", "truth"],
    "mnemonic": ["memory", "past", "learning"],
    "model": ["tech", "learning", "form"],
    "moment": ["time", "past", "future"],
    "money": ["money", "power", "value"],
    "moon": ["moon", "night", "sky"],
    "mortal": ["human", "death", "life"],
    "mosaic": ["art", "pattern", "pieces"],
    "mother": ["family", "parent", "life"],
    "motion": ["motion", "body", "time"],
    "move": ["game", "play", "rule"],
    "muse": ["art", "inspiration", "creation"],
    "music": ["music", "sound", "art"],
    "mystery": ["mystery", "unknown", "spirit"],
    "myth": ["story", "myth", "spirit"],
    "name": ["name", "identity", "word"],
    "narrative": ["story", "language", "time"],
    "nation": ["royalty", "power", "order"],
    "nature": ["nature", "earth", "life"],
    "nearness": ["love", "close", "presence"],
    "nebula": ["space", "star", "cosmos"],
    "needle": ["pain", "hurt", "body"],
    "nemesis": ["anger", "rage", "fire"],
    "nest": ["home", "family", "safety"],
    "network": ["tech", "connection", "system"],
    "neural": ["mind", "tech", "learning"],
    "nexus": ["engine", "machine", "tech"],
    "night": ["night", "dark", "dream"],
    "nocturne": ["music", "night", "dream"],
    "noir": ["silence", "quiet", "peace"],
    "note": ["music", "language", "memory"],
    "notion": ["mind", "idea", "thought"],
    "nova": ["star", "space", "explosion"],
    "now": ["present", "time", "moment"],
    "nucleus": ["bone", "body", "structure"],
    "null": ["void", "zero", "absence"],
    "numinous": ["divine", "spirit", "mystery"],
    "nurture": ["care", "family", "growth"],
    "oasis": ["water", "refuge", "hope"],
    "oath": ["promise", "truth", "power"],
    "ocean": ["sea", "water", "depth"],
    "odyssey": ["journey", "story", "quest"],
    "offering": ["gift", "divine", "ritual"],
    "omen": ["moon", "night", "sky"],
    "omniscient": ["knowledge", "divine", "mind"],
    "ontology": ["language", "hermeneutic", "interpretation"],
    "openness": ["open", "trust", "light"],
    "opera": ["music", "drama", "voice"],
    "opus": ["art", "creation", "work"],
    "oracle": ["prophecy", "truth", "mystery"],
    "oration": ["voice", "speech", "language"],
    "orbit": ["space", "order", "cycle"],
    "order": ["order", "structure", "peace"],
    "ore": ["money", "value", "wealth"],
    "organ": ["body", "flesh", "human"],
    "origin": ["beginning", "source", "past"],
    "ossuary": ["bone", "body", "structure"],
    "output": ["tech", "result", "code"],
    "overmind": ["mind", "tech", "power"],
    "overture": ["hope", "future", "light"],
    "oxygen": ["blood", "life", "family"],
    "pain": ["pain", "body", "emotion"],
    "paint": ["paint", "art", "color"],
    "palette": ["art", "paint", "color"],
    "pall": ["peace", "calm", "order"],
    "paradox": ["mind", "truth", "contradiction"],
    "passion": ["love", "fire", "emotion"],
    "past": ["past", "memory", "time"],
    "path": ["road", "journey", "life"],
    "pattern": ["order", "art", "code"],
    "peace": ["peace", "calm", "order"],
    "person": ["human", "self", "identity"],
    "phantom": ["ghost", "memory", "illusion"],
    "pierce": ["pain", "hurt", "body"],
    "planet": ["space", "cosmos", "void"],
    "play": ["play", "game", "joy"],
    "pneuma": ["spirit", "breath", "life"],
    "poem": ["language", "art", "poetry"],
    "portal": ["door", "magic", "space"],
    "power": ["power", "force", "control"],
    "praxis": ["action", "practice", "work"],
    "prayer": ["divine", "hope", "spirit"],
    "precedent": ["past", "memory", "history"],
    "presence": ["now", "being", "awareness"],
    "process": ["work", "tech", "order"],
    "promise": ["hope", "word", "future"],
    "pulse": ["life", "body", "rhythm"],
    "purpose": ["meaning", "will", "life"],
    "pyre": ["fire", "death", "ritual"],
    "quantum": ["tech", "physics", "space"],
    "queen": ["royalty", "power", "order"],
    "query": ["question", "tech", "mind"],
    "quiet": ["silence", "peace", "calm"],
    "quill": ["writing", "language", "art"],
    "radiance": ["light", "beauty", "glory"],
    "radiant": ["light", "beauty", "joy"],
    "rage": ["anger", "fire", "emotion"],
    "realm": ["dark", "night", "mystery"],
    "reason": ["mind", "logic", "truth"],
    "recall": ["memory", "past", "mind"],
    "refuge": ["home", "safety", "peace"],
    "reign": ["royalty", "power", "order"],
    "relation": ["connection", "family", "love"],
    "relay": ["robot", "machine", "tech"],
    "render": ["art", "tech", "creation"],
    "reply": ["language", "voice", "communication"],
    "resonance": ["sound", "echo", "harmony"],
    "revelation": ["truth", "divine", "insight"],
    "reverie": ["dream", "mind", "soft"],
    "rhapsody": ["music", "emotion", "art"],
    "rhythm": ["music", "time", "body"],
    "riddle": ["mystery", "language", "mind"],
    "rigor": ["fear", "dread", "dark"],
    "rise": ["future", "hope", "time"],
    "ritual": ["ritual", "spirit", "order"],
    "river": ["water", "flow", "journey"],
    "road": ["road", "journey", "path"],
    "robot": ["robot", "machine", "tech"],
    "romance": ["love", "story", "emotion"],
    "root": ["origin", "earth", "family"],
    "route": ["road", "journey", "path"],
    "rule": ["order", "structure", "law"],
    "rune": ["magic", "language", "symbol"],
    "saga": ["story", "narrative", "language"],
    "science": ["knowledge", "learning", "tech"],
    "sea": ["sea", "water", "depth"],
    "seed": ["beginning", "life", "potential"],
    "self": ["self", "identity", "mind"],
    "seraph": ["divine", "angel", "light"],
    "shadow": ["dark", "self", "mystery"],
    "sigil": ["magic", "symbol", "spell"],
    "signal": ["tech", "communication", "code"],
    "silence": ["silence", "peace", "void"],
    "sky": ["sky", "space", "air"],
    "solstice": ["sun", "light", "day"],
    "sorrow": ["grief", "pain", "emotion"],
    "soul": ["soul", "spirit", "self"],
    "space": ["space", "void", "cosmos"],
    "spark": ["star", "sky", "space"],
    "spectrum": ["light", "color", "range"],
    "speech": ["voice", "language", "word"],
    "spell": ["magic", "spell", "word"],
    "spirit": ["spirit", "soul", "life"],
    "star": ["star", "sky", "hope"],
    "still": ["silence", "quiet", "peace"],
    "storm": ["chaos", "disorder", "entropy"],
    "story": ["story", "language", "narrative"],
    "strength": ["power", "body", "will"],
    "summit": ["sky", "air", "space"],
    "sun": ["sun", "light", "day"],
    "surge": ["sea", "water", "depth"],
    "symphony": ["music", "harmony", "art"],
    "syntax": ["language", "code", "order"],
    "system": ["order", "tech", "structure"],
    "tale": ["story", "narrative", "language"],
    "talisman": ["magic", "protect", "object"],
    "tapestry": ["art", "story", "woven"],
    "teaching": ["learning", "knowledge", "wisdom"],
    "tech": ["tech", "machine", "code"],
    "temple": ["divine", "sacred", "silence"],
    "tenderness": ["love", "care", "soft"],
    "terrain": ["earth", "nature", "ground"],
    "terror": ["fear", "dark", "emotion"],
    "testament": ["truth", "story", "faith"],
    "texture": ["art", "touch", "surface"],
    "theory": ["mind", "knowledge", "science"],
    "thesis": ["truth", "reality", "light"],
    "thought": ["mind", "idea", "thinking"],
    "threshold": ["boundary", "transition", "door"],
    "tide": ["sea", "time", "cycle"],
    "time": ["time", "duration", "change"],
    "token": ["symbol", "value", "tech"],
    "tongue": ["language", "voice", "body"],
    "torch": ["light", "day", "hope"],
    "torque": ["robot", "machine", "tech"],
    "trace": ["past", "memory", "history"],
    "transit": ["city", "people", "home"],
    "tree": ["tree", "nature", "life"],
    "trunk": ["tree", "nature", "life"],
    "trust": ["trust", "love", "faith"],
    "truth": ["truth", "reality", "light"],
    "twilight": ["night", "dark", "dream"],
    "ultrahuman": ["human", "tech", "future"],
    "ultraviolet": ["sun", "light", "day"],
    "umbra": ["shadow", "dark", "eclipse"],
    "understanding": ["mind", "knowledge", "empathy"],
    "unfold": ["future", "hope", "time"],
    "union": ["love", "join", "peace"],
    "unity": ["music", "sound", "harmony"],
    "universe": ["space", "cosmos", "all"],
    "unspoken": ["silence", "secret", "emotion"],
    "unveiling": ["truth", "reality", "light"],
    "utility": ["use", "tech", "function"],
    "utopia": ["ideal", "future", "peace"],
    "value": ["worth", "money", "ethic"],
    "vernacular": ["language", "hermeneutic", "speech"],
    "verse": ["poetry", "language", "music"],
    "victory": ["win", "war", "triumph"],
    "virtue": ["good", "moral", "strength"],
    "vision": ["vision", "future", "sight"],
    "vita": ["life", "living", "vital"],
    "voice": ["voice", "language", "expression"],
    "void": ["void", "empty", "space"],
    "voltage": ["energy", "tech", "power"],
    "vow": ["promise", "love", "oath"],
    "voyage": ["journey", "sea", "adventure"],
    "war": ["war", "conflict", "violence"],
    "warmth": ["heat", "love", "comfort"],
    "water": ["water", "life", "flow"],
    "wave": ["water", "motion", "energy"],
    "wavelength": ["energy", "tech", "signal"],
    "wayfarer": ["journey", "road", "travel"],
    "wealth": ["money", "abundance", "power"],
    "weapon": ["war", "conflict", "power"],
    "whisper": ["voice", "soft", "secret"],
    "will": ["will", "power", "self"],
    "wisdom": ["wisdom", "knowledge", "mind"],
    "witness": ["see", "truth", "memory"],
    "wonder": ["wonder", "awe", "curiosity"],
    "word": ["word", "language", "meaning"],
    "work": ["work", "labor", "creation"],
    "world": ["world", "earth", "all"],
    "worship": ["divine", "devotion", "ritual"],
    "wound": ["pain", "injury", "scar"],
    "writing": ["writing", "language", "art"],
    "yard": ["enemy", "conflict", "war"],
    "yarn": ["story", "thread", "telling"],
    "year": ["time", "cycle", "measure"],
    "yearn": ["desire", "love", "longing"],
    "yes": ["joy", "delight", "light"],
    "yield": ["play", "game", "joy"],
    "yonder": ["sky", "air", "space"],
    "youth": ["youth", "life", "beginning"],
    "zeitgeist": ["time", "spirit", "culture"],
    "zen": ["peace", "mind", "spirit"],
    "zero": ["void", "null", "beginning"],
    "zest": ["joy", "energy", "flavor"],
  };

  var SEED_MEANINGS = {
    AI: { gloss: "artificial intelligence", themes: ["tech", "mind", "machine", "learning", "code"], classic: ["Artificial", "Intelligence"] },
    ART: { gloss: "creative expression", themes: ["art", "creation", "beauty", "paint"], classic: ["Atelier", "Render", "Tapestry"] },
    DAY: { gloss: "daylight hours", themes: ["day", "light", "sun", "time"], classic: ["Dawn", "Aurora", "Yield"] },
    DID: { gloss: "a question that asks for thought", themes: ["thought", "question", "mind", "imagination", "dedication"], classic: ["Dedicated", "Imagination", "Dimension"] },
    GOD: { gloss: "the divine", themes: ["divine", "spirit", "holy", "power"], classic: ["Grace", "Omniscient", "Doctrine"] },
    JOY: { gloss: "glad emotion", themes: ["joy", "delight", "light", "emotion"], classic: ["Jubilee", "Openness", "Yes"] },
    NOW: { gloss: "the present", themes: ["present", "now", "moment", "awareness"], classic: ["Nexus", "Openness", "Witness"] },
    SEA: { gloss: "ocean waters", themes: ["sea", "water", "depth", "voyage"], classic: ["Surge", "Eddy", "Abyss"] },
    SKY: { gloss: "heavens above", themes: ["sky", "air", "space", "light"], classic: ["Summit", "Kite", "Yonder"] },
    SUN: { gloss: "day star", themes: ["sun", "light", "day", "heat"], classic: ["Solstice", "Ultraviolet", "Nova"] },
    WAR: { gloss: "armed conflict", themes: ["war", "conflict", "power", "violence"], classic: ["Weapon", "Armor", "Rage"] },
    BODY: { gloss: "physical form", themes: ["body", "flesh", "human", "form"], classic: ["Breath", "Organ", "Depth", "Yield"] },
    BONE: { gloss: "skeletal matter", themes: ["bone", "body", "structure", "death"], classic: ["Base", "Ossuary", "Nucleus", "Edge"] },
    CITY: { gloss: "urban place", themes: ["city", "people", "home", "street"], classic: ["Crowd", "Intersection", "Transit", "Yard"] },
    CODE: { gloss: "program and cipher", themes: ["code", "tech", "language", "logic"], classic: ["Cipher", "Output", "Data", "Engine"] },
    DARK: { gloss: "absence of light", themes: ["dark", "night", "mystery", "shadow"], classic: ["Depth", "Abyss", "Realm", "Kohl"] },
    FEAR: { gloss: "anxious dread", themes: ["fear", "dread", "dark", "emotion"], classic: ["Frost", "Echo", "Anxiety", "Rigor"] },
    FIRE: { gloss: "flame and heat", themes: ["fire", "heat", "passion", "energy"], classic: ["Flame", "Ignition", "Radiance", "Ember"] },
    GAME: { gloss: "structured play", themes: ["game", "play", "rule", "sport"], classic: ["Gambit", "Arena", "Move", "Engage"] },
    HOME: { gloss: "dwelling place", themes: ["home", "family", "refuge", "hearth"], classic: ["Hearth", "Oasis", "Nest", "Eden"] },
    HOPE: { gloss: "expectant desire", themes: ["hope", "future", "light", "faith"], classic: ["Horizon", "Overture", "Promise", "Ember"] },
    KING: { gloss: "male sovereign", themes: ["royalty", "power", "order", "rule"], classic: ["Kingdom", "Iron", "Nation", "Glory"] },
    LIFE: { gloss: "living existence", themes: ["life", "living", "body", "breath"], classic: ["Lumen", "Iris", "Flame", "Emergence"] },
    LOVE: { gloss: "affection and devotion", themes: ["love", "heart", "emotion", "intimacy"], classic: ["Longing", "Openness", "Vow", "Embrace"] },
    MIND: { gloss: "thought and awareness", themes: ["mind", "thought", "learning", "self"], classic: ["Memory", "Insight", "Notion", "Dream"] },
    MOON: { gloss: "night satellite", themes: ["moon", "night", "sky", "tide"], classic: ["Meridian", "Orbit", "Omen", "Nocturne"] },
    NAME: { gloss: "personal label", themes: ["name", "identity", "word", "self"], classic: ["Notion", "Allegory", "Mark", "Essence"] },
    PAIN: { gloss: "hurt sensation", themes: ["pain", "hurt", "body", "emotion"], classic: ["Pierce", "Ache", "Injury", "Needle"] },
    PAST: { gloss: "time behind", themes: ["past", "memory", "history", "before"], classic: ["Precedent", "Archive", "Story", "Trace"] },
    PLAY: { gloss: "joyful activity", themes: ["play", "game", "joy", "fun"], classic: ["Pulse", "Laughter", "Amusement", "Yield"] },
    ROAD: { gloss: "path of travel", themes: ["road", "journey", "path", "travel"], classic: ["Route", "Odyssey", "Avenue", "Drift"] },
    SELF: { gloss: "one's own being", themes: ["self", "identity", "mind", "soul"], classic: ["Soul", "Essence", "Lucid", "Form"] },
    SOUL: { gloss: "immaterial essence", themes: ["soul", "spirit", "self", "essence"], classic: ["Spirit", "Origin", "Umbra", "Lumen"] },
    STAR: { gloss: "distant sun", themes: ["star", "sky", "space", "hope"], classic: ["Spark", "Transit", "Aurora", "Radiance"] },
    TIME: { gloss: "duration and change", themes: ["time", "past", "future", "memory"], classic: ["Tide", "Interval", "Moment", "Eon"] },
    TREE: { gloss: "woody plant", themes: ["tree", "nature", "life", "root"], classic: ["Trunk", "Root", "Eden", "Elm"] },
    WORD: { gloss: "unit of language", themes: ["language", "word", "voice", "communication", "meaning"], classic: ["Writing", "Oracle", "Reply", "Dialect"] },
    WORK: { gloss: "labor and effort", themes: ["work", "labor", "effort", "skill"], classic: ["Will", "Output", "Rigor", "Craft"] },
    ANGER: { gloss: "hostile emotion", themes: ["anger", "rage", "fire", "conflict"], classic: ["Ash", "Nemesis", "Grief", "Ember", "Rage"] },
    BLOOD: { gloss: "vital fluid", themes: ["blood", "life", "family", "body"], classic: ["Bond", "Legacy", "Oxygen", "Origin", "Depth"] },
    CHAOS: { gloss: "disorder", themes: ["chaos", "disorder", "entropy", "wild"], classic: ["Cascade", "Havoc", "Abyss", "Overture", "Storm"] },
    CHILD: { gloss: "young person", themes: ["child", "youth", "family", "innocence"], classic: ["Curiosity", "Hope", "Innocence", "Laughter", "Dream"] },
    DEATH: { gloss: "end of life", themes: ["death", "end", "silence", "memory"], classic: ["Dust", "Elegy", "Ash", "Threshold", "Hush"] },
    DREAM: { gloss: "vision in sleep", themes: ["dream", "mind", "night", "vision"], classic: ["Depth", "Reverie", "Eden", "Astral", "Myth"] },
    EARTH: { gloss: "ground and world", themes: ["earth", "nature", "ground", "world"], classic: ["Eden", "Atlas", "Root", "Terrain", "Humus"] },
    ENEMY: { gloss: "adversary", themes: ["enemy", "conflict", "war", "rival"], classic: ["Edge", "Nemesis", "Ember", "Menace", "Yard"] },
    HEART: { gloss: "seat of feeling", themes: ["heart", "love", "emotion", "body"], classic: ["Hope", "Emotion", "Affection", "Rhythm", "Tenderness"] },
    HUMAN: { gloss: "person", themes: ["human", "person", "body", "self"], classic: ["Heart", "Unity", "Memory", "Agency", "Nature"] },
    LIGHT: { gloss: "illumination", themes: ["light", "day", "hope", "vision"], classic: ["Lumen", "Iris", "Glow", "Halo", "Torch"] },
    MAGIC: { gloss: "supernatural art", themes: ["magic", "spell", "wonder", "arcane"], classic: ["Mystery", "Arcane", "Glyph", "Incantation", "Charm"] },
    MONEY: { gloss: "currency and value", themes: ["money", "value", "wealth", "trade"], classic: ["Mint", "Ore", "Note", "Exchange", "Yield"] },
    MUSIC: { gloss: "organized sound", themes: ["music", "sound", "harmony", "rhythm"], classic: ["Melody", "Unity", "Symphony", "Interval", "Cadence"] },
    NIGHT: { gloss: "dark hours", themes: ["night", "dark", "dream", "moon"], classic: ["Nocturne", "Iris", "Gloom", "Hush", "Twilight"] },
    ORDER: { gloss: "structured arrangement", themes: ["order", "structure", "law", "peace"], classic: ["Orbit", "Rule", "Doctrine", "Eden", "Rhythm"] },
    PAINT: { gloss: "pigment and image", themes: ["paint", "art", "color", "creation"], classic: ["Palette", "Atelier", "Image", "Notion", "Texture"] },
    PEACE: { gloss: "tranquility", themes: ["peace", "calm", "order", "silence"], classic: ["Pall", "Ease", "Amity", "Calm", "Eden"] },
    POWER: { gloss: "force and control", themes: ["power", "force", "control", "strength"], classic: ["Pulse", "Orbit", "Will", "Empire", "Reign"] },
    QUEEN: { gloss: "female sovereign", themes: ["royalty", "power", "order", "grace"], classic: ["Quiet", "Unity", "Empire", "Elegance", "Nation"] },
    ROBOT: { gloss: "mechanical agent", themes: ["robot", "machine", "tech", "automation"], classic: ["Relay", "Output", "Binary", "Orbit", "Torque"] },
    SPACE: { gloss: "cosmic expanse", themes: ["space", "cosmos", "void", "star"], classic: ["Star", "Planet", "Aurora", "Cosmos", "Ether"] },
    SPELL: { gloss: "incantation", themes: ["spell", "magic", "word", "ritual"], classic: ["Sigil", "Power", "Echo", "Lore", "Lexicon"] },
    STORY: { gloss: "narrative account", themes: ["story", "narrative", "language", "myth"], classic: ["Saga", "Tale", "Oracle", "Riddle", "Yarn"] },
    TRUTH: { gloss: "what is real", themes: ["truth", "reality", "light", "honesty"], classic: ["Testament", "Revelation", "Unveiling", "Thesis", "Honesty"] },
    VOICE: { gloss: "spoken sound", themes: ["voice", "speech", "language", "expression"], classic: ["Verse", "Oration", "Idiom", "Cadence", "Echo"] },
    WATER: { gloss: "fluid of life", themes: ["water", "sea", "flow", "life"], classic: ["Wave", "Aquifer", "Tide", "Eddy", "River"] },
    ENGINE: { gloss: "machine that works", themes: ["engine", "machine", "tech", "power"], classic: ["Energy", "Nexus", "Gear", "Ignition", "Network", "Ember"] },
    FATHER: { gloss: "male parent", themes: ["family", "parent", "guide", "legacy"], classic: ["Foundation", "Anchor", "Testament", "Harbor", "Example", "Root"] },
    FRIEND: { gloss: "companion", themes: ["friend", "bond", "trust", "love"], classic: ["Faith", "Refuge", "Intimacy", "Embrace", "Nearness", "Devotion"] },
    FUTURE: { gloss: "time ahead", themes: ["future", "hope", "time", "tomorrow"], classic: ["Frontier", "Unfold", "Transit", "Utopia", "Rise", "Emergence"] },
    MEMORY: { gloss: "recalled past", themes: ["memory", "past", "mind", "recall"], classic: ["Mnemonic", "Echo", "Moment", "Origin", "Recall", "Yarn"] },
    MOTHER: { gloss: "female parent", themes: ["family", "parent", "care", "life"], classic: ["Mercy", "Origin", "Tenderness", "Hearth", "Embrace", "Root"] },
    GALLERY: { gloss: "hall of art", themes: ["gallery", "art", "paint", "display"], classic: ["Glyph", "Atelier", "Lumen", "Legacy", "Exhibit", "Render", "Yarn"] },
    SILENCE: { gloss: "absence of sound", themes: ["silence", "quiet", "peace", "void"], classic: ["Still", "Interval", "Lull", "Emptiness", "Noir", "Calm", "Ease"] },
    PAINTING: { gloss: "painted image", themes: ["paint", "art", "image", "creation"], classic: ["Palette", "Atelier", "Image", "Notion", "Texture", "Ink", "Notion", "Gesture"] },
    TALENT: { gloss: "natural skill and gift", themes: ["gift", "skill", "ability", "excellence", "growth"], classic: ["Triumph", "Aptitude", "Learning", "Excellence", "Nuance", "Tenacity"] },
    TALENTED: { gloss: "natural skill and gift", themes: ["gift", "skill", "ability", "excellence", "growth"], classic: ["Triumph", "Ability", "Learning", "Excellence", "Nuance", "Tenacity", "Expertise", "Dexterity"] },
    GIFTED: { gloss: "born with natural ability", themes: ["gift", "skill", "ability", "excellence", "growth"], classic: ["Gift", "Insight", "Flair", "Talent", "Excellence", "Dexterity"] },
    SKILL: { gloss: "practiced ability", themes: ["gift", "skill", "ability", "excellence", "growth"], classic: ["Strength", "Knack", "Insight", "Learning", "Labor"] },
    SKILLED: { gloss: "highly practiced ability", themes: ["gift", "skill", "ability", "excellence", "growth"], classic: ["Strength", "Knack", "Insight", "Learning", "Labor", "Expertise", "Dexterity"] },
    GENIUS: { gloss: "exceptional intellect and ability", themes: ["gift", "skill", "ability", "excellence", "mind", "growth"], classic: ["Gift", "Expertise", "Nuance", "Insight", "Uniqueness", "Sharp"] },
    MASTER: { gloss: "complete command of a craft", themes: ["gift", "skill", "ability", "excellence", "growth"], classic: ["Mastery", "Aptitude", "Skill", "Tenacity", "Excellence", "Rigor"] },
    HAPPY: { gloss: "glad and content", themes: ["joy", "delight", "emotion", "heart", "cheer"], classic: ["Heart", "Amity", "Pleasure", "Peace", "Yes"] },
    SAD: { gloss: "sorrowful feeling", themes: ["sorrow", "grief", "emotion", "loss", "heart"], classic: ["Sorrow", "Ache", "Dread"] },
    KIND: { gloss: "gentle goodwill", themes: ["kindness", "care", "love", "heart", "peace"], classic: ["Kindness", "Intimacy", "Nurture", "Devotion"] },
    BRAVE: { gloss: "facing fear with courage", themes: ["courage", "strength", "honor", "power", "heart"], classic: ["Bold", "Resolve", "Armor", "Valor", "Edge"] },
    SMART: { gloss: "quick of mind", themes: ["mind", "insight", "learning", "skill", "ability"], classic: ["Sharp", "Memory", "Aptitude", "Reason", "Thought"] },
  };



  // Semantic coverage boosts for high-value letters
  (function boostTags() {
    var extra = {
      openness: ["love", "heart", "trust", "emotion"],
      offering: ["love", "gift", "devotion"],
      ocean: ["water", "depth", "emotion"],
      orbit: ["space", "cycle", "devotion"],
      oath: ["love", "promise", "vow"],
      opus: ["art", "creation", "work"],
      oracle: ["language", "voice", "wisdom", "meaning"],
      oration: ["language", "voice", "speech"],
      origin: ["beginning", "source", "identity"],
      vessel: ["body", "spirit", "heart"],
      vow: ["love", "promise", "devotion"],
      virtue: ["good", "moral", "love"],
      vitality: ["life", "energy", "heart"],
      velvet: ["soft", "intimacy", "beauty"],
      laughter: ["joy", "love", "emotion"],
      longing: ["love", "desire", "yearn", "heart"],
      loyalty: ["love", "devotion", "trust"],
      luminosity: ["light", "beauty", "hope"],
      lexicon: ["language", "hermeneutic", "word"],
      letter: ["language", "word", "writing"],
      lyric: ["language", "poetry", "music"],
      dialect: ["language", "word", "voice"],
      dialogue: ["language", "communication", "voice"],
      dictionary: ["language", "hermeneutic", "interpretation"],
      discourse: ["language", "hermeneutic", "speech"],
      exegesis: ["language", "hermeneutic", "interpretation"],
      allegory: ["language", "hermeneutic", "interpretation"],
      ontology: ["language", "hermeneutic", "interpretation"],
      jargon: ["language", "hermeneutic", "speech"],
      vernacular: ["language", "hermeneutic", "speech"],
      writing: ["language", "word", "writing"],
      word: ["language", "word", "meaning"],
      whisper: ["voice", "language", "intimacy"],
      wisdom: ["mind", "knowledge", "learning"],
      algorithm: ["tech", "code", "machine", "learning"],
      artificial: ["tech", "mind", "machine", "learning"],
      intelligence: ["mind", "tech", "learning", "code"],
      interface: ["tech", "machine", "code"],
      inference: ["mind", "learning", "logic"],
      inner: ["mind", "self", "emotion"],
      insight: ["mind", "learning", "wisdom"],
      affection: ["love", "emotion", "heart"],
      amity: ["love", "friendship", "peace"],
      embrace: ["love", "intimacy", "heart"],
      empathy: ["love", "emotion", "mind"],
      emotion: ["emotion", "heart", "feeling"],
      canvas: ["art", "creation", "paint"],
      creation: ["art", "creation", "making"],
      curiosity: ["mind", "learning", "wonder"],
      clan: ["family", "bond", "identity"],
      clancy: ["name", "identity", "story"],
      aptitude: ["gift", "skill", "ability", "excellence"],
      excellence: ["gift", "skill", "ability", "excellence"],
      nuance: ["gift", "skill", "ability", "excellence"],
      tenacity: ["gift", "skill", "growth", "strength"],
      expertise: ["gift", "skill", "ability", "excellence"],
      dexterity: ["gift", "skill", "ability", "excellence"],
      legerdemain: ["skill", "craft", "magic"],
      knack: ["gift", "skill", "ability"],
      flair: ["gift", "skill", "ability", "excellence"],
      mastery: ["gift", "skill", "ability", "excellence"],
      pleasure: ["joy", "delight", "emotion"],
      bold: ["courage", "strength", "power"],
      resolve: ["courage", "strength", "will"],
      valor: ["courage", "honor", "strength"],
      sharp: ["mind", "insight", "skill"],
      happy: ["joy", "delight", "emotion", "heart"],
      kind: ["kindness", "care", "love", "heart"],
      brave: ["courage", "strength", "honor", "heart"],
      smart: ["mind", "insight", "learning", "skill"],
      ability: ["gift", "skill", "ability", "excellence"],
      adept: ["gift", "skill", "ability", "excellence"],
      capable: ["gift", "skill", "ability", "excellence"],
      competence: ["gift", "skill", "ability", "excellence"],
      practice: ["skill", "ability", "growth", "work"],
      practiced: ["skill", "ability", "growth", "work"],
      prowess: ["gift", "skill", "ability", "excellence"],
      talent: ["gift", "skill", "ability", "excellence"],
      skilled: ["gift", "skill", "ability", "excellence"],
      gifted: ["gift", "skill", "ability", "excellence"],
      acumen: ["mind", "skill", "ability", "insight"],
      achieve: ["growth", "excellence", "effort", "ability"],
      achievement: ["growth", "excellence", "effort", "ability"],
      care: ["care", "kindness", "heart", "love"],
      cheer: ["joy", "delight", "emotion", "heart"],
      courage: ["courage", "strength", "honor", "heart"],
      glad: ["joy", "delight", "emotion", "heart"],
      content: ["joy", "peace", "emotion", "heart"],
      skill: ["gift", "skill", "ability", "excellence"],
      growth: ["growth", "learning", "ability", "future"],
      learning: ["learning", "mind", "growth", "skill"],
      beginning: ["beginning", "origin", "start"],
      start: ["beginning", "origin", "start"],
      dedicated: ["thought", "dedication", "mind", "question"],
      imagination: ["thought", "imagination", "mind", "question"],
      dimension: ["thought", "imagination", "mind", "question"],
      did: ["thought", "question", "mind"]
    };
    Object.keys(extra).forEach(function (k) {
      WORD_TAGS[k] = extra[k];
    });
  })();

  // Ensure classic expansion words exist in the letter banks
  Object.keys(SEED_MEANINGS).forEach(function (seed) {
    var classic = SEED_MEANINGS[seed].classic;
    if (!classic) return;
    classic.forEach(function (w, i) {
      var L = seed.charAt(i);
      if (!L || !LEXICON[L]) return;
      if (LEXICON[L].indexOf(w) === -1) LEXICON[L].push(w);
      var key = w.toLowerCase();
      if (!WORD_TAGS[key]) {
        WORD_TAGS[key] = (SEED_MEANINGS[seed].themes || []).slice(0, 3);
      }
    });
  });

  // Everyday definitional words — prefer these over studio jargon for non-art seeds.
  (function addPlainLexicon() {
    var plain = {
      A: ["Ability", "Adept", "Acumen", "Achieve", "Aware", "Action"],
      B: ["Brave", "Bright", "Best", "Build", "Belong"],
      C: ["Capable", "Care", "Courage", "Competence", "Commitment", "Cheer"],
      D: ["Dedication", "Drive", "Do", "Develop"],
      E: ["Effort", "Earnest", "Excel", "Ease"],
      F: ["Focus", "Facility", "Fluent", "Fortitude"],
      G: ["Growth", "Grit", "Good", "Glad"],
      H: ["Honest", "Help", "Hardy"],
      I: ["Improve", "Invent", "Idle"],
      K: ["Know", "Keen"],
      L: ["Learn", "Level", "Lead"],
      M: ["Might", "Method", "Mastery"],
      N: ["Natural", "Nimble", "Need"],
      P: ["Practice", "Prowess", "Progress", "Patient"],
      Q: ["Quick", "Qualify"],
      R: ["Ready", "Reliable", "Raise"],
      S: ["Skill", "Skilled", "Steady", "Simple", "Strong"],
      T: ["Talent", "Tenacity", "Try", "Train"],
      U: ["Useful", "Upward"],
      V: ["Value", "Versatile"],
      W: ["Worthy", "Workable", "Willing"]
    };
    var tags = {
      ability: ["gift", "skill", "ability", "excellence"],
      adept: ["gift", "skill", "ability", "excellence"],
      acumen: ["mind", "skill", "ability", "insight"],
      achieve: ["growth", "excellence", "effort", "ability"],
      aware: ["mind", "insight", "learning"],
      action: ["effort", "work", "ability"],
      brave: ["courage", "strength", "honor", "heart"],
      bright: ["mind", "insight", "light", "learning"],
      best: ["excellence", "ability", "skill"],
      build: ["growth", "work", "creation", "effort"],
      belong: ["home", "heart", "bond"],
      capable: ["gift", "skill", "ability", "excellence"],
      care: ["care", "kindness", "heart", "love"],
      courage: ["courage", "strength", "honor", "heart"],
      competence: ["gift", "skill", "ability", "excellence"],
      commitment: ["effort", "growth", "loyalty", "work"],
      cheer: ["joy", "delight", "emotion", "heart"],
      dedication: ["effort", "growth", "work", "loyalty"],
      drive: ["effort", "power", "growth", "will"],
      do: ["work", "effort", "action"],
      develop: ["growth", "learning", "ability", "skill"],
      effort: ["work", "labor", "effort", "growth"],
      earnest: ["effort", "truth", "heart"],
      excel: ["excellence", "skill", "ability", "growth"],
      ease: ["peace", "calm", "joy"],
      focus: ["mind", "skill", "ability", "attention"],
      facility: ["skill", "ability", "ease"],
      fluent: ["skill", "ability", "language"],
      fortitude: ["courage", "strength", "honor"],
      growth: ["growth", "learning", "ability", "future"],
      grit: ["strength", "growth", "effort", "courage"],
      good: ["kindness", "heart", "peace"],
      glad: ["joy", "delight", "emotion", "heart"],
      honest: ["truth", "reality", "honor"],
      help: ["care", "kindness", "friend"],
      hardy: ["strength", "courage", "body"],
      improve: ["growth", "learning", "ability"],
      invent: ["mind", "creation", "idea"],
      know: ["knowledge", "mind", "learning"],
      keen: ["mind", "insight", "skill"],
      learn: ["learning", "mind", "growth", "skill"],
      level: ["skill", "ability", "order"],
      lead: ["power", "guidance", "strength"],
      might: ["power", "strength", "ability"],
      method: ["skill", "order", "work"],
      natural: ["gift", "nature", "ability"],
      nimble: ["skill", "ability", "body"],
      need: ["desire", "emotion", "body"],
      practice: ["skill", "ability", "growth", "work"],
      prowess: ["gift", "skill", "ability", "excellence"],
      progress: ["growth", "future", "learning"],
      patient: ["calm", "care", "time"],
      quick: ["mind", "skill", "ability"],
      qualify: ["skill", "ability", "excellence"],
      ready: ["ability", "will", "start"],
      reliable: ["trust", "honor", "work"],
      raise: ["growth", "effort", "power"],
      skill: ["gift", "skill", "ability", "excellence"],
      skilled: ["gift", "skill", "ability", "excellence"],
      steady: ["strength", "calm", "trust"],
      simple: ["truth", "clarity", "ease"],
      strong: ["strength", "power", "courage"],
      talent: ["gift", "skill", "ability", "excellence"],
      try: ["effort", "growth", "will"],
      train: ["skill", "learning", "growth", "ability"],
      useful: ["work", "value", "ability"],
      upward: ["growth", "hope", "future"],
      value: ["value", "worth", "truth"],
      versatile: ["skill", "ability", "gift"],
      worthy: ["honor", "value", "excellence"],
      workable: ["work", "skill", "ability"],
      willing: ["will", "effort", "heart"]
    };
    Object.keys(plain).forEach(function (L) {
      plain[L].forEach(function (w) {
        if (LEXICON[L].indexOf(w) === -1) LEXICON[L].push(w);
        var key = w.toLowerCase();
        if (tags[key]) WORD_TAGS[key] = tags[key];
        else if (!WORD_TAGS[key]) WORD_TAGS[key] = ["ability", "skill", "growth"];
      });
    });
  })();


  /**
   * Light POS / role hints for readable weaving.
   * Default is noun; cover frequent lexicon / classic / relatable words.
   */
  var WORD_POS = {
    // Clear verbs (ambiguous noun/verb expansions default to noun)
    arise: "verb",
    achieve: "verb",
    excel: "verb",
    engage: "verb",
    yield: "verb",
    become: "verb",
    becoming: "verb",
    compute: "verb",
    create: "verb",
    design: "verb",
    // embrace stays noun by default
    learn: "verb",
    move: "verb",
    seek: "verb",
    teach: "verb",
    unite: "verb",
    write: "verb",
    writing: "verb",
    yearn: "verb",
    breathe: "verb",
    build: "verb",
    choose: "verb",
    dance: "verb",
    find: "verb",
    grow: "verb",
    heal: "verb",
    ignite: "verb",
    inspire: "verb",
    know: "verb",
    listen: "verb",
    make: "verb",
    reach: "verb",
    remember: "verb",
    speak: "verb",
    stand: "verb",
    think: "verb",
    transform: "verb",
    understand: "verb",
    walk: "verb",
    want: "verb",
    // adjectives
    artificial: "adj",
    astral: "adj",
    binary: "adj",
    boreal: "adj",
    byzantine: "adj",
    capable: "adj",
    celestial: "adj",
    dedicated: "adj",
    digital: "adj",
    diaphanous: "adj",
    eloquent: "adj",
    inner: "adj",
    kind: "adj",
    lucid: "adj",
    quiet: "adj",
    ultraviolet: "adj",
    sacred: "adj",
    radiant: "adj",
    eternal: "adj",
    fierce: "adj",
    gentle: "adj",
    golden: "adj",
    holy: "adj",
    human: "adj",
    infinite: "adj",
    luminous: "adj",
    noble: "adj",
    open: "adj",
    pure: "adj",
    silent: "adj",
    soft: "adj",
    true: "adj",
    vast: "adj",
    vital: "adj",
    wild: "adj",
    wise: "adj",
    zealous: "adj",
    bright: "adj",
    nimble: "adj",
    clear: "adj",
    deep: "adj",
    vivid: "adj",
    tender: "adj"
  };

  var state = {
    seedRaw: "",
    seedLetters: "",
    words: [],
    poem: "",
    gloss: "",
    themes: [],
    nonce: 0,
    filterLetter: "",
    history: [],
    debounce: 0,
    inited: false,
    targetLens: [],
    lensKey: "",
    lensTouched: false,
    lensDrag: null
  };

  function $(id) {
    return document.getElementById(id);
  }

  function hashStr(s) {
    var h = 2166136261 >>> 0;
    var i;
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      var t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function extractLetters(raw) {
    return String(raw || "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
  }

  /**
   * Split raw seed into word groups for vertical layout.
   * Each group keeps the display token (punctuation stripped for the label)
   * and the A–Z letters with their global offset into seedLetters/words.
   */
  function tokenizeSeedWords(raw) {
    var parts = String(raw || "").trim().split(/\s+/);
    var groups = [];
    var globalIdx = 0;
    var i;
    if (!String(raw || "").trim()) return groups;
    for (i = 0; i < parts.length; i++) {
      var token = parts[i];
      if (!token) continue;
      var letters = extractLetters(token);
      var label = token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "") || token;
      if (!letters.length) continue;
      groups.push({
        word: label,
        letters: letters,
        startIndex: globalIdx
      });
      globalIdx += letters.length;
    }
    return groups;
  }

  function unique(arr) {
    var seen = {};
    var out = [];
    var i;
    for (i = 0; i < arr.length; i++) {
      if (!arr[i] || seen[arr[i]]) continue;
      seen[arr[i]] = true;
      out.push(arr[i]);
    }
    return out;
  }

  function letterSoftThemes(letters) {
    var soft = [];
    var map = {
      A: ["ability", "beginning"],
      B: ["body", "bond"],
      C: ["care", "courage"],
      D: ["dream", "depth"],
      E: ["energy", "emotion"],
      F: ["fire", "feeling"],
      G: ["growth", "grace"],
      H: ["heart", "home"],
      I: ["insight", "idea"],
      J: ["joy", "journey"],
      K: ["knowledge", "kin"],
      L: ["life", "love"],
      M: ["mind", "memory"],
      N: ["nature", "now"],
      O: ["origin", "order"],
      P: ["power", "path"],
      Q: ["quest", "quiet"],
      R: ["root", "rhythm"],
      S: ["spirit", "story"],
      T: ["time", "truth"],
      U: ["unity", "understanding"],
      V: ["value", "vitality"],
      W: ["will", "warmth"],
      X: ["mystery", "unknown"],
      Y: ["yearn", "youth"],
      Z: ["zeal", "zone"]
    };
    var i;
    // Soft themes are a weak hint only — never let many letters dominate scoring.
    for (i = 0; i < Math.min(letters.length, 3); i++) {
      var pair = map[letters.charAt(i)];
      if (pair) soft.push(pair[0]);
    }
    return soft;
  }

  var ABILITY_STEM_RE = /^(TALENT|GIFT|SKILL|ABLE|SMART|CLEVER|BRIGHT|MASTER|EXPERT)/;
  var QUALITY_SUFFIX_RE = /(ED|FUL|ING|NESS|LY)$/;

  function morphologyThemes(letters) {
    var themes = [];
    var isQuality = QUALITY_SUFFIX_RE.test(letters);
    var isAbility = ABILITY_STEM_RE.test(letters);
    if (isQuality) {
      themes.push("character", "emotion");
    }
    if (isAbility || (isQuality && ABILITY_STEM_RE.test(letters.replace(QUALITY_SUFFIX_RE, "")))) {
      themes = themes.concat(["gift", "skill", "ability", "excellence", "growth"]);
    }
    return themes;
  }

  function resolveSeedMeaning(letters) {
    if (!letters) {
      return { gloss: "", themes: ["mystery"], classic: null, source: "empty" };
    }

    if (SEED_MEANINGS[letters]) {
      var hit = SEED_MEANINGS[letters];
      return {
        gloss: hit.gloss,
        themes: hit.themes.slice(),
        classic: hit.classic ? hit.classic.slice() : null,
        source: "dictionary"
      };
    }

    var keys = Object.keys(SEED_MEANINGS);
    var best = null;
    var bestScore = 0;
    var i;
    for (i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.length < 3) continue;
      var score = 0;
      if (letters.indexOf(k) !== -1) score = k.length * 3;
      else if (k.indexOf(letters) !== -1 && letters.length >= 3) score = letters.length * 2;
      else {
        var p = 0;
        while (p < k.length && p < letters.length && k.charAt(p) === letters.charAt(p)) p++;
        if (p >= 3) score = p;
      }
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    }

    var morph = morphologyThemes(letters);
    var titled = letters.charAt(0) + letters.slice(1).toLowerCase();

    if (best && bestScore >= 3) {
      var partial = SEED_MEANINGS[best];
      // Soft letter themes are a light accent only; never dump abstract defaults on every unknown.
      return {
        gloss: morph.length
          ? "the quality named by " + titled
          : "echoing the sense of " + partial.gloss,
        themes: unique(partial.themes.concat(morph).concat(letterSoftThemes(letters).slice(0, 2))),
        classic: null,
        source: "substring:" + best
      };
    }

    var soft = letterSoftThemes(letters);
    var themes = unique(morph.concat(soft));
    if (!themes.length) themes = ["mystery"];
    var gloss;
    if (morph.length) {
      gloss = "the quality named by " + titled;
    } else {
      gloss = "echoing the sense of " + titled;
    }
    return {
      gloss: gloss,
      themes: themes,
      classic: null,
      source: "heuristic"
    };
  }

  function themeOverlap(word, themes) {
    var tags = WORD_TAGS[String(word).toLowerCase()] || [];
    if (!tags.length || !themes.length) return 0;
    var set = {};
    var i;
    for (i = 0; i < themes.length; i++) set[themes[i]] = true;
    var n = 0;
    for (i = 0; i < tags.length; i++) {
      if (set[tags[i]]) n++;
    }
    return n;
  }

  // Words that describe the *tool* (mnemonic / cryptic knowledge) rather than a seed's meaning.
  // Allowed only when the seed itself is about memory, language, ritual, or mystery.
  // Studio / gallery jargon — heavy penalty unless the seed is literally about art.
  var ART_BUZZ = {
    art: true,
    atelier: true,
    palette: true,
    canvas: true,
    tapestry: true,
    aperture: true,
    chiaroscuro: true,
    texture: true,
    render: true,
    exhibit: true,
    mural: true,
    ultramarine: true,
    opus: true,
    mosaic: true,
    muse: true,
    hue: true,
    landscape: true,
    inspiration: true,
    xylograph: true,
    fresco: true,
    easel: true,
    gesso: true,
    impasto: true,
    sfumato: true,
    collage: true,
    vignette: true,
    gallery: true,
    brushwork: true,
    studio: true,
    pigment: true,
    frescoes: true,
    frame: true,
    gesture: true,
    design: true
  };

  var ART_SEED_THEMES = {
    art: true,
    paint: true,
    gallery: true
  };

  function seedAllowsArtBuzz(themes) {
    var i;
    for (i = 0; i < (themes || []).length; i++) {
      if (ART_SEED_THEMES[themes[i]]) return true;
    }
    return false;
  }

  var META_WORDS = {
    exegesis: true,
    dictionary: true,
    discourse: true,
    lexicon: true,
    ontology: true,
    vernacular: true,
    jargon: true,
    allegory: true,
    mnemonic: true,
    anamnesis: true,
    koan: true,
    hermetic: true,
    hermeticism: true,
    gnostic: true,
    sutra: true,
    sigil: true,
    praxis: true,
    cipher: true,
    aporia: true,
    bricolage: true,
    cartography: true,
    topology: true,
    fenestration: true,
    xenolith: true,
    xenogenesis: true,
    xenogamy: true,
    xenogeny: true,
    xylograph: true,
    ylem: true,
    yggdrasil: true,
    ziggurat: true,
    buddhafield: true,
    diaphanous: true,
    pneuma: true,
    numinous: true,
    omniscient: true
  };

  var LANGUAGE_SEED_THEMES = {
    language: true,
    word: true,
    meaning: true,
    speech: true,
    hermeneutic: true,
    interpretation: true,
    voice: true,
    communication: true,
    writing: true,
    memory: true,
    learning: true,
    ritual: true,
    magic: true,
    mystery: true,
    spell: true
  };

  // Everyday / high-relatability expansions — prefer when themes overlap.
  var RELATABLE_WORDS = {
    gift: true, skill: true, talent: true, craft: true, work: true, ability: true,
    adept: true, capable: true, practice: true, prowess: true, growth: true,
    love: true, heart: true, hope: true, joy: true, care: true, trust: true,
    strength: true, courage: true, growth: true, learning: true, insight: true,
    passion: true, power: true, peace: true, play: true, path: true, purpose: true,
    friend: true, family: true, home: true, life: true, light: true, dream: true,
    fire: true, water: true, earth: true, sky: true, star: true, sun: true,
    voice: true, story: true, song: true, color: true, paint: true, art: true,
    triumph: true, aptitude: true, excellence: true, nuance: true, tenacity: true,
    expertise: true, dexterity: true, genius: true, flair: true, knack: true,
    mastery: true, rigor: true, grace: true, glory: true, honor: true, will: true,
    warmth: true, breath: true, bloom: true, bridge: true, balance: true, belief: true,
    calm: true, child: true, city: true, dawn: true, desire: true, delight: true,
    effort: true, energy: true, emotion: true, expression: true, feeling: true,
    force: true, form: true, freedom: true, future: true, guidance: true,
    harmony: true, human: true, hunger: true, idea: true, image: true, inner: true,
    journey: true, justice: true, kind: true, kindness: true, knowledge: true,
    labor: true, laughter: true, legacy: true, liberty: true, longing: true,
    loyalty: true, magic: true, memory: true, mercy: true, mind: true, motion: true,
    music: true, name: true, nature: true, need: true, note: true, offering: true,
    openness: true, order: true, origin: true, passion: true, pattern: true,
    person: true, promise: true, quality: true, quiet: true, radiance: true,
    reason: true, relation: true, rhythm: true, river: true, romance: true,
    root: true, self: true, silence: true, soul: true, spirit: true, strength: true,
    teaching: true, tenderness: true, thought: true, time: true, tongue: true,
    trust: true, truth: true, understanding: true, unity: true, value: true,
    vessel: true, victory: true, virtue: true, vision: true, vitality: true,
    voice: true, vow: true, warmth: true, water: true, wealth: true, will: true,
    wisdom: true, wonder: true, word: true, work: true, world: true, writing: true,
    yearn: true, youth: true, zeal: true
  };

  function seedAllowsMeta(themes) {
    var i;
    for (i = 0; i < themes.length; i++) {
      if (LANGUAGE_SEED_THEMES[themes[i]]) return true;
    }
    return false;
  }

  function pickWord(letter, rng, preferredLen, used, themes, classicHint, neighbor, strongLen) {
    var bank = (LEXICON[letter] || [letter + "ther"]).slice();
    if (classicHint && bank.indexOf(classicHint) === -1) {
      bank.push(classicHint);
    }

    var allowMeta = seedAllowsMeta(themes || []);
    var allowArtBuzz = seedAllowsArtBuzz(themes || []);
    var lenWeight = strongLen ? 4.5 : 0.25;

    var scored = bank.map(function (w, idx) {
      var key = String(w).toLowerCase();
      var len = w.replace(/[^a-zA-Z]/g, "").length;
      var dist = Math.abs(len - preferredLen);
      var usedPenalty = used[w] ? 50 : 0;
      var overlap = themeOverlap(w, themes);
      var themeBonus = -overlap * 28;
      var classicBonus = classicHint && w === classicHint ? -10 : 0;
      // Prefer plain, relatable words that still carry the seed's meaning.
      var relateBonus = RELATABLE_WORDS[key] && overlap > 0 ? -14 : 0;
      var commonBonus = overlap > 0 && len <= 10 ? -Math.max(0, 8 - Math.abs(len - 7)) * 0.4 : 0;
      var crypticPenalty = 0;
      if (META_WORDS[key] && !allowMeta) crypticPenalty = 600;
      else if (META_WORDS[key] && allowMeta && overlap < 2) crypticPenalty = 600;
      else if (META_WORDS[key]) crypticPenalty = 8;
      // Long ornate words without theme overlap feel like cryptic filler.
      if (!META_WORDS[key] && overlap === 0 && len >= 10) crypticPenalty += 6;
      // Art-studio jargon only when the seed itself is about art/paint/gallery.
      var artBuzzPenalty = 0;
      if (ART_BUZZ[key] && !allowArtBuzz) artBuzzPenalty = 650;
      var nestPenalty = 0;
      var nestSkip = false;
      if (neighbor && isNestedExpansion(w, neighbor)) {
        nestPenalty = 700;
        nestSkip = true;
      }
      var jitter = rng() * 3;
      var metaSkip = crypticPenalty >= 500 || artBuzzPenalty >= 500 || nestSkip;
      return {
        w: w,
        score: dist * lenWeight + usedPenalty + themeBonus + classicBonus + relateBonus + commonBonus + crypticPenalty + artBuzzPenalty + nestPenalty + jitter,
        overlap: overlap,
        metaSkip: metaSkip,
        idx: idx
      };
    });

    scored.sort(function (a, b) {
      return a.score - b.score;
    });

    var withTheme = scored.filter(function (s) {
      return s.overlap > 0 && !used[s.w] && !s.metaSkip;
    });
    var pool;
    if (strongLen) {
      // Explicit dial: let length compete with theme in the score (theme still heavily rewarded).
      // Avoid theme-only pools that ignore a 3 vs 12 dial when few themed lengths exist.
      pool = scored.filter(function (s) {
        return !used[s.w] && !s.metaSkip;
      }).slice(0, Math.min(4, scored.length));
      if (!pool.length) {
        pool = scored.filter(function (s) {
          return !s.metaSkip;
        }).slice(0, Math.min(4, scored.length));
      }
      if (!pool.length) pool = scored.slice(0, Math.min(4, scored.length));
    } else if (withTheme.length >= 1) {
      pool = withTheme.slice(0, Math.min(6, withTheme.length));
    } else {
      pool = scored.filter(function (s) {
        return !s.metaSkip;
      }).slice(0, Math.min(5, scored.length));
      if (!pool.length) pool = scored.slice(0, Math.min(5, scored.length));
    }

    var choice = pool[Math.floor(rng() * pool.length)].w;
    used[choice] = true;
    return choice;
  }

  function preferredWordLen(seedLen, letterIndex) {
    var base = Math.max(3, Math.min(14, 4 + (seedLen % 8)));
    var wobble = ((letterIndex * 3 + seedLen) % 5) - 2;
    return Math.max(3, Math.min(14, base + wobble));
  }

  function clampPreferredLen(n) {
    var v = Math.round(Number(n));
    if (!isFinite(v)) v = 7;
    return Math.max(LEN_MIN, Math.min(LEN_MAX, v));
  }

  function defaultTargetLens(letters) {
    var out = [];
    var i;
    for (i = 0; i < letters.length; i++) {
      out.push(clampPreferredLen(preferredWordLen(letters.length, i)));
    }
    return out;
  }

  function lensForIndex(i, letters) {
    var lens = state.targetLens;
    if (lens && lens.length === letters.length && lens[i] != null) {
      return clampPreferredLen(lens[i]);
    }
    return clampPreferredLen(preferredWordLen(letters.length, i));
  }

  function loadStoredLens(letters) {
    try {
      var raw = localStorage.getItem(LENS_KEY_PREFIX + letters);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length !== letters.length) return null;
      return parsed.map(clampPreferredLen);
    } catch (e) {
      return null;
    }
  }

  function persistTargetLens(letters) {
    if (!letters || !state.targetLens || state.targetLens.length !== letters.length) return;
    try {
      localStorage.setItem(LENS_KEY_PREFIX + letters, JSON.stringify(state.targetLens));
    } catch (e) {}
  }

  /** Keep targetLens aligned to current seed letters; init from defaults or localStorage. */
  function ensureTargetLens(letters) {
    if (!letters) {
      state.targetLens = [];
      state.lensKey = "";
      state.lensTouched = false;
      return;
    }
    if (state.lensKey === letters && state.targetLens.length === letters.length) {
      return;
    }
    var stored = loadStoredLens(letters);
    if (stored) {
      state.targetLens = stored;
      state.lensKey = letters;
      state.lensTouched = true;
      return;
    }
    state.targetLens = defaultTargetLens(letters);
    state.lensKey = letters;
    state.lensTouched = false;
  }

  function angleToPreferredLen(angleDeg) {
    var t = ((angleDeg % 360) + 360) % 360;
    var span = 360 / (LEN_MAX - LEN_MIN + 1);
    var idx = Math.floor(t / span);
    return clampPreferredLen(LEN_MIN + idx);
  }

  function preferredLenToAngle(len) {
    var n = clampPreferredLen(len);
    var span = 360 / (LEN_MAX - LEN_MIN + 1);
    return (n - LEN_MIN + 0.5) * span;
  }

  function wordPos(w) {
    var key = String(w || "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    if (!key) return "other";
    if (WORD_POS[key]) return WORD_POS[key];
    // Light heuristics for uncovered lexicon entries (avoid false verbs like "promise").
    if (/(ous|ful|ive|ical|less|ish|able|ible|esque|ble)$/.test(key)) return "adj";
    if (/^[a-z]+ize$/.test(key) && key.length > 6) return "verb";
    return "noun";
  }

  function capitalizeSentence(s) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function ensurePeriod(s) {
    s = String(s || "").trim();
    if (!s) return "";
    if (/[.!?]$/.test(s)) return s;
    return s + ".";
  }

  /**
   * Format a short noun-ish run as readable English (lists, of-phrases).
   * Preserves word order; keeps clauses short so long seeds stay sensible.
   */
  function formatChunk(chunk, rng) {
    chunk = (chunk || []).filter(Boolean);
    if (!chunk.length) return "";
    if (chunk.length === 1) return chunk[0];
    if (chunk.length === 2) {
      var a = wordPos(chunk[0]);
      var b = wordPos(chunk[1]);
      if (a === "adj" && b === "noun") return chunk[0] + " " + chunk[1];
      if (b === "verb") return chunk[0] + " that can " + chunk[1].toLowerCase();
      if (a === "verb" && b === "noun") return chunk[0] + " the " + chunk[1];
      var two = ["and", "of", "with", "for"];
      return chunk[0] + " " + two[Math.floor(rng() * two.length)] + " " + chunk[1];
    }
    if (chunk.length === 3) {
      var p0 = wordPos(chunk[0]);
      var p1 = wordPos(chunk[1]);
      var p2 = wordPos(chunk[2]);
      if (p0 === "adj" && p1 === "noun") {
        return chunk[0] + " " + chunk[1] + " and " + chunk[2];
      }
      if (p1 === "verb") {
        return chunk[0] + " " + chunk[1].toLowerCase() + " " + chunk[2];
      }
      var three = Math.floor(rng() * 4);
      if (three <= 1) return chunk[0] + ", " + chunk[1] + ", and " + chunk[2];
      if (three === 2) return chunk[0] + " of " + chunk[1] + " and " + chunk[2];
      return chunk[0] + " and " + chunk[1] + " with " + chunk[2];
    }
    // 4+: "A, B, and C" style on the whole chunk
    var head = chunk.slice(0, -1);
    var last = chunk[chunk.length - 1];
    return head.join(", ") + ", and " + last;
  }

  /**
   * Weave expansion words into one coherent clause (no trailing period).
   * Long runs are split into 2–3 word chunks and joined with light verbs
   * so the line reads as English instead of stacked surreal prepositions.
   */
  function weaveSense(words, rng) {
    words = (words || []).filter(Boolean);
    if (!words.length) return "";
    if (words.length === 1) return words[0];
    if (words.length <= 4) return formatChunk(words, rng);

    var chunks = [];
    var i = 0;
    while (i < words.length) {
      var left = words.length - i;
      var take = 3;
      if (left === 4) take = 2;
      else if (left === 1) take = 1;
      else if (left === 2) take = 2;
      else if (rng() < 0.35) take = 2;
      chunks.push(words.slice(i, i + take));
      i += take;
    }

    var bridges = [
      "and",
      "then",
      "along with",
      "together with",
      "beside",
      "and then"
    ];
    var parts = [];
    var b;
    for (b = 0; b < chunks.length; b++) {
      parts.push(formatChunk(chunks[b], rng));
      if (b < chunks.length - 1) {
        parts.push(bridges[Math.floor(rng() * bridges.length)]);
      }
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  /**
   * Build the poem: one sensible sentence for a single-word seed,
   * or one sentence/clause per seed word for multi-word seeds.
   */
  function weavePoem(words, seed, nonce, themes, seedRaw) {
    if (!words.length) return "";
    var rng = mulberry32(hashStr(seed + "|poem|" + nonce));
    var groups = tokenizeSeedWords(seedRaw || "");
    var oneClause = function (slice) {
      return ensurePeriod(capitalizeSentence(weaveSense(slice, rng)));
    };

    if (groups.length <= 1) {
      return oneClause(words);
    }

    var last = groups[groups.length - 1];
    var covered = last.startIndex + last.letters.length;
    if (covered !== words.length) {
      return oneClause(words);
    }

    var clauses = [];
    var g;
    for (g = 0; g < groups.length; g++) {
      var gr = groups[g];
      var slice = words.slice(gr.startIndex, gr.startIndex + gr.letters.length);
      if (!slice.length) continue;
      clauses.push(oneClause(slice));
    }
    return clauses.join(" ");
  }

  function lettersOnly(w) {
    return String(w || "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
  }

  /** True when one expansion is tucked inside the other (a "word from" the earlier word). */
  function isNestedExpansion(a, b) {
    var x = lettersOnly(a);
    var y = lettersOnly(b);
    if (!x || !y || x === y) return x === y && !!x;
    // Ignore tiny accidental hits (at, in, or) — real words start at 3+ letters.
    if (x.length >= 3 && y.indexOf(x) !== -1) return true;
    if (y.length >= 3 && x.indexOf(y) !== -1) return true;
    return false;
  }

  function generate(raw, nonce) {
    var letters = extractLetters(raw);
    var note = "";
    if (letters.length > MAX_SEED_LEN) {
      letters = letters.slice(0, MAX_SEED_LEN);
      note = "Long seed trimmed quietly to its first " + MAX_SEED_LEN + " letters.";
    }
    if (!letters.length) {
      return {
        seedRaw: raw || "",
        seedLetters: "",
        words: [],
        poem: "",
        gloss: "",
        themes: [],
        note: "Type at least one letter (A–Z)."
      };
    }

    ensureTargetLens(letters);

    var meaning = resolveSeedMeaning(letters);
    var themes = meaning.themes || [];
    var classic = meaning.classic;
    var strongLen = !!state.lensTouched;
    // Classic lock only on untouched first generate; dials must be able to override.
    var useClassic =
      nonce === 0 &&
      classic &&
      classic.length === letters.length &&
      !state.lensTouched;

    if (useClassic) {
      var ok = true;
      var ci;
      for (ci = 0; ci < classic.length; ci++) {
        if (classic[ci].charAt(0).toUpperCase() !== letters.charAt(ci)) {
          ok = false;
          break;
        }
      }
      if (!ok) useClassic = false;
    }

    var rng = mulberry32(hashStr(letters + "|" + nonce + "|sem"));
    var used = {};
    var words = [];
    var i;
    for (i = 0; i < letters.length; i++) {
      var L = letters.charAt(i);
      var hint =
        classic && classic[i] && classic[i].charAt(0).toUpperCase() === L
          ? classic[i]
          : null;
      var prefLen = lensForIndex(i, letters);
      var nextWord;
      if (useClassic) {
        nextWord = classic[i];
        used[nextWord] = true;
      } else {
        nextWord = pickWord(
          L,
          rng,
          prefLen,
          used,
          themes,
          hint,
          i > 0 ? words[i - 1] : null,
          strongLen
        );
      }
      words.push(nextWord);

      // If this expansion is a word taken from the prior expansion, the prior letter re-picks.
      if (i > 0 && isNestedExpansion(words[i], words[i - 1])) {
        var prevL = letters.charAt(i - 1);
        var attempts = 0;
        while (isNestedExpansion(words[i], words[i - 1]) && attempts < 10) {
          delete used[words[i - 1]];
          var prevHint =
            classic &&
            classic[i - 1] &&
            classic[i - 1].charAt(0).toUpperCase() === prevL
              ? classic[i - 1]
              : null;
          // Never re-offer the nested pair; forbid the current word as neighbor.
          words[i - 1] = pickWord(
            prevL,
            rng,
            lensForIndex(i - 1, letters),
            used,
            themes,
            prevHint,
            words[i],
            strongLen
          );
          used[words[i - 1]] = true;
          attempts++;
        }
        // If still nested after prior re-picks, re-pick the current letter instead.
        if (isNestedExpansion(words[i], words[i - 1])) {
          delete used[words[i]];
          words[i] = pickWord(
            L,
            rng,
            lensForIndex(i, letters),
            used,
            themes,
            null,
            words[i - 1],
            strongLen
          );
          used[words[i]] = true;
        }
      }
    }

    return {
      seedRaw: raw || "",
      seedLetters: letters,
      words: words,
      poem: weavePoem(words, letters, nonce, themes, raw || ""),
      gloss: meaning.gloss || "",
      themes: themes,
      note: note
    };
  }

  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list.slice(0, HISTORY_MAX);
    } catch (e) {
      return [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, HISTORY_MAX)));
    } catch (e) {}
  }

  function pushHistory(entry) {
    if (!entry || !entry.seedLetters) return;
    var key = entry.seedLetters + "|" + (entry.words || []).join(",") + "|" + (entry.poem || "");
    state.history = state.history.filter(function (h) {
      return (h.seedLetters + "|" + (h.words || []).join(",") + "|" + (h.poem || "")) !== key;
    });
    state.history.unshift({
      id: String(Date.now()) + "-" + Math.floor(Math.random() * 1e6),
      seedRaw: entry.seedRaw,
      seedLetters: entry.seedLetters,
      words: entry.words.slice(),
      poem: entry.poem,
      gloss: entry.gloss || "",
      at: Date.now()
    });
    if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
    saveHistory();
    renderHistory();
  }

  function buildLetterRail() {
    var rail = $("engrams-rail");
    if (!rail || rail.dataset.ready === "1") return;
    rail.innerHTML = "";
    LETTERS.forEach(function (L) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "engrams-letter";
      btn.dataset.letter = L;
      btn.textContent = L;
      btn.title = "Seed / filter with " + L;
      btn.addEventListener("click", function () {
        onLetterClick(L);
      });
      rail.appendChild(btn);
    });
    rail.dataset.ready = "1";
  }

  function onLetterClick(L) {
    var input = $("engrams-prompt");
    if (!input) return;
    if (state.filterLetter === L && !input.value) {
      state.filterLetter = "";
      updateRailActive();
      return;
    }
    state.filterLetter = L;
    if (!input.value) {
      input.value = L;
    } else {
      input.value = input.value + L;
    }
    updateRailActive();
    runGenerate(false);
    input.focus();
  }

  function updateRailActive() {
    var rail = $("engrams-rail");
    if (!rail) return;
    var seedSet = {};
    var i;
    for (i = 0; i < state.seedLetters.length; i++) {
      seedSet[state.seedLetters.charAt(i)] = true;
    }
    Array.prototype.forEach.call(rail.querySelectorAll(".engrams-letter"), function (btn) {
      var L = btn.dataset.letter;
      btn.classList.toggle("is-in-seed", !!seedSet[L]);
      btn.classList.toggle("is-filter", state.filterLetter === L);
    });
  }

  function updateRadialVisual(radial, len) {
    var n = clampPreferredLen(len);
    var angle = preferredLenToAngle(n);
    radial.style.setProperty("--radial-angle", angle + "deg");
    radial.setAttribute("aria-valuenow", String(n));
    var valEl = radial.querySelector(".engrams-radial-value");
    if (valEl) valEl.textContent = String(n);
  }

  function setTargetLen(idx, len, regenerate) {
    var letters = state.seedLetters || "";
    if (!letters || idx < 0 || idx >= letters.length) return;
    ensureTargetLens(letters);
    var n = clampPreferredLen(len);
    var prev = state.targetLens[idx];
    var wasTouched = state.lensTouched;
    state.targetLens[idx] = n;
    state.lensTouched = true;
    persistTargetLens(letters);
    updateRadialAtIndex(idx, n);
    // Regen when length changes, or first touch (so classic lock yields to the dial).
    if (regenerate && (prev !== n || !wasTouched)) {
      state.nonce = (state.nonce + 1) % 1e9;
      runGenerate(false);
    }
  }

  function updateRadialAtIndex(idx, len) {
    var slots = $("engrams-slots");
    if (!slots) return;
    var radial = slots.querySelector('.engrams-radial[data-idx="' + idx + '"]');
    if (radial) updateRadialVisual(radial, len);
  }

  function clientPoint(ev) {
    if (ev.touches && ev.touches.length) {
      return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
    }
    if (ev.changedTouches && ev.changedTouches.length) {
      return { x: ev.changedTouches[0].clientX, y: ev.changedTouches[0].clientY };
    }
    return { x: ev.clientX, y: ev.clientY };
  }

  function lenFromRadialEvent(radial, ev) {
    var rect = radial.getBoundingClientRect();
    var pt = clientPoint(ev);
    var dx = pt.x - (rect.left + rect.width / 2);
    var dy = pt.y - (rect.top + rect.height / 2);
    // 0° at top, clockwise — matches dial mapping.
    var angle = Math.atan2(dx, -dy) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    return angleToPreferredLen(angle);
  }

  function endLensDrag() {
    if (!state.lensDrag) return;
    state.lensDrag = null;
    document.removeEventListener("mousemove", onLensDragMove);
    document.removeEventListener("mouseup", onLensDragEnd);
    document.removeEventListener("touchmove", onLensDragMove);
    document.removeEventListener("touchend", onLensDragEnd);
    document.removeEventListener("touchcancel", onLensDragEnd);
  }

  function onLensDragMove(ev) {
    if (!state.lensDrag) return;
    ev.preventDefault();
    var idx = state.lensDrag.idx;
    var slots = $("engrams-slots");
    var radial = slots
      ? slots.querySelector('.engrams-radial[data-idx="' + idx + '"]')
      : null;
    if (!radial) return;
    var len = lenFromRadialEvent(radial, ev);
    if (state.targetLens[idx] !== len) {
      setTargetLen(idx, len, true);
    } else {
      updateRadialVisual(radial, len);
    }
  }

  function onLensDragEnd(ev) {
    if (!state.lensDrag) return;
    var idx = state.lensDrag.idx;
    var slots = $("engrams-slots");
    var radial = slots
      ? slots.querySelector('.engrams-radial[data-idx="' + idx + '"]')
      : null;
    if (radial && (ev.type === "mouseup" || ev.type === "touchend")) {
      var len = lenFromRadialEvent(radial, ev);
      setTargetLen(idx, len, true);
    }
    endLensDrag();
  }

  function bindRadial(radial, idx, letter) {
    radial.addEventListener("mousedown", function (ev) {
      if (ev.button != null && ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      endLensDrag();
      state.lensDrag = { idx: idx };
      setTargetLen(idx, lenFromRadialEvent(radial, ev), true);
      document.addEventListener("mousemove", onLensDragMove);
      document.addEventListener("mouseup", onLensDragEnd);
    });
    radial.addEventListener(
      "touchstart",
      function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        endLensDrag();
        state.lensDrag = { idx: idx };
        setTargetLen(idx, lenFromRadialEvent(radial, ev), true);
        document.addEventListener("touchmove", onLensDragMove, { passive: false });
        document.addEventListener("touchend", onLensDragEnd);
        document.addEventListener("touchcancel", onLensDragEnd);
      },
      { passive: false }
    );
    radial.addEventListener("keydown", function (ev) {
      var cur = clampPreferredLen(
        (state.targetLens && state.targetLens[idx]) || lensForIndex(idx, state.seedLetters)
      );
      if (ev.key === "ArrowRight" || ev.key === "ArrowUp") {
        ev.preventDefault();
        setTargetLen(idx, cur + 1, true);
      } else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") {
        ev.preventDefault();
        setTargetLen(idx, cur - 1, true);
      } else if (ev.key === "Home") {
        ev.preventDefault();
        setTargetLen(idx, LEN_MIN, true);
      } else if (ev.key === "End") {
        ev.preventDefault();
        setTargetLen(idx, LEN_MAX, true);
      }
    });
  }

  function makeRadialDial(idx, letter, len) {
    var radial = document.createElement("div");
    radial.className = "engrams-radial";
    radial.dataset.idx = String(idx);
    radial.setAttribute("role", "slider");
    radial.setAttribute("tabindex", "0");
    radial.setAttribute("aria-valuemin", String(LEN_MIN));
    radial.setAttribute("aria-valuemax", String(LEN_MAX));
    radial.setAttribute("aria-valuenow", String(clampPreferredLen(len)));
    radial.setAttribute(
      "aria-label",
      "Preferred length for letter " + (letter || "?")
    );
    radial.title = "Preferred word length 1–15";

    var knob = document.createElement("span");
    knob.className = "engrams-radial-knob";
    knob.setAttribute("aria-hidden", "true");
    var value = document.createElement("span");
    value.className = "engrams-radial-value";
    value.textContent = String(clampPreferredLen(len));
    radial.appendChild(knob);
    radial.appendChild(value);
    updateRadialVisual(radial, len);
    bindRadial(radial, idx, letter);
    return radial;
  }

  function renderStage(result) {
    state.seedRaw = result.seedRaw;
    state.seedLetters = result.seedLetters;
    state.words = result.words;
    state.poem = result.poem;
    state.gloss = result.gloss || "";
    state.themes = result.themes || [];
    ensureTargetLens(result.seedLetters || "");

    var seedEl = $("engrams-seed-display");
    var slots = $("engrams-slots");
    var poemEl = $("engrams-poem");
    var noteEl = $("engrams-note");
    var metaEl = $("engrams-meta");
    var groups = tokenizeSeedWords(result.seedRaw || "");
    var letterCount = (result.seedLetters || "").length;

    if (seedEl) {
      var labels = [];
      var gi;
      for (gi = 0; gi < groups.length; gi++) {
        if (groups[gi].startIndex >= letterCount) break;
        labels.push(groups[gi].word);
      }
      seedEl.textContent = labels.length ? labels.join(" · ") : "—";
    }
    if (slots) {
      var dragIdx = state.lensDrag ? state.lensDrag.idx : -1;
      slots.innerHTML = "";
      if (!result.words.length) {
        slots.innerHTML = '<p class="engrams-empty">Type a word — each letter becomes an engram expansion.</p>';
      } else {
        var stack = document.createElement("div");
        stack.className = "engrams-word-stack";
        groups.forEach(function (group) {
          if (group.startIndex >= letterCount) return;
          var end = Math.min(group.startIndex + group.letters.length, letterCount);
          if (end <= group.startIndex) return;

          var groupEl = document.createElement("div");
          groupEl.className = "engrams-word-group";

          var label = document.createElement("div");
          label.className = "engrams-word-label";
          label.textContent = group.word;
          groupEl.appendChild(label);

          var wordSlots = document.createElement("div");
          wordSlots.className = "engrams-word-slots";

          var idx;
          for (idx = group.startIndex; idx < end; idx++) {
            var w = result.words[idx];
            if (w == null) continue;
            var card = document.createElement("div");
            card.className = "engrams-slot";
            var head = document.createElement("div");
            head.className = "engrams-slot-head";
            var letter = document.createElement("span");
            letter.className = "engrams-slot-letter";
            var L = result.seedLetters.charAt(idx) || "";
            letter.textContent = L;
            var pref = lensForIndex(idx, result.seedLetters);
            var radial = makeRadialDial(idx, L, pref);
            head.appendChild(letter);
            head.appendChild(radial);
            var word = document.createElement("span");
            word.className = "engrams-slot-word";
            word.textContent = w;
            card.appendChild(head);
            card.appendChild(word);
            wordSlots.appendChild(card);
          }

          if (!wordSlots.childNodes.length) return;
          groupEl.appendChild(wordSlots);
          stack.appendChild(groupEl);
        });

        // Fallback: flat letter list had no whitespace groups (or raw empty) —
        // still show every expansion in one horizontal wrapping row.
        if (!stack.childNodes.length) {
          var fallback = document.createElement("div");
          fallback.className = "engrams-word-group";
          var fbLabel = document.createElement("div");
          fbLabel.className = "engrams-word-label";
          fbLabel.textContent = result.seedLetters || "seed";
          fallback.appendChild(fbLabel);
          var fbSlots = document.createElement("div");
          fbSlots.className = "engrams-word-slots";
          result.words.forEach(function (w, idx) {
            var card = document.createElement("div");
            card.className = "engrams-slot";
            var head = document.createElement("div");
            head.className = "engrams-slot-head";
            var letter = document.createElement("span");
            letter.className = "engrams-slot-letter";
            var L = result.seedLetters.charAt(idx) || "";
            letter.textContent = L;
            var pref = lensForIndex(idx, result.seedLetters);
            var radial = makeRadialDial(idx, L, pref);
            head.appendChild(letter);
            head.appendChild(radial);
            var word = document.createElement("span");
            word.className = "engrams-slot-word";
            word.textContent = w;
            card.appendChild(head);
            card.appendChild(word);
            fbSlots.appendChild(card);
          });
          fallback.appendChild(fbSlots);
          stack.appendChild(fallback);
        }

        slots.appendChild(stack);
        if (dragIdx >= 0) {
          var keep = slots.querySelector('.engrams-radial[data-idx="' + dragIdx + '"]');
          if (keep) keep.classList.add("is-dragging");
        }
      }
    }
    if (poemEl) {
      poemEl.textContent = result.poem || "…";
    }
    if (noteEl) {
      noteEl.textContent = result.note || "";
      noteEl.hidden = !result.note;
    }
    if (metaEl) {
      var n = result.seedLetters.length;
      var bits = ["Seed " + n + " letters"];
      if (result.gloss) {
        bits.push("echoing: " + result.gloss);
      }
      metaEl.textContent = bits.join(" · ");
    }
    updateRailActive();
  }

  function runGenerate(save) {
    var input = $("engrams-prompt");
    var raw = input ? input.value : state.seedRaw;
    var result = generate(raw, state.nonce);
    renderStage(result);
    if (save && result.words.length) {
      pushHistory(result);
    }
  }

  function reshuffle() {
    state.nonce = (state.nonce + 1) % 1e9;
    runGenerate(false);
  }

  function copyCurrent() {
    var text =
      (state.seedLetters || "") +
      "\n" +
      (state.words || []).join(" · ") +
      "\n" +
      (state.poem || "") +
      (state.gloss ? "\n(echoing: " + state.gloss + ")" : "");
    if (!state.seedLetters) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(flashCopy).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
    function fallbackCopy() {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        flashCopy();
      } catch (e) {}
    }
  }

  function flashCopy() {
    var btn = $("engrams-copy");
    if (!btn) return;
    var prev = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(function () {
      btn.textContent = prev;
    }, 1200);
  }

  function renderHistory() {
    var list = $("engrams-history");
    if (!list) return;
    list.innerHTML = "";
    if (!state.history.length) {
      list.innerHTML = '<p class="engrams-empty">No saved engrams yet.</p>';
      return;
    }
    state.history.forEach(function (h) {
      var item = document.createElement("article");
      item.className = "engrams-hist-item";
      item.dataset.id = h.id;

      var head = document.createElement("header");
      var seed = document.createElement("strong");
      seed.textContent = h.seedLetters;
      var sub = document.createElement("span");
      sub.className = "engrams-hist-sub";
      sub.textContent = (h.words || []).join(" · ");
      head.appendChild(seed);
      head.appendChild(sub);

      var poem = document.createElement("p");
      poem.className = "engrams-hist-poem";
      poem.textContent = h.poem || "";

      var actions = document.createElement("div");
      actions.className = "engrams-hist-actions";

      var openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "engrams-btn engrams-btn-ghost";
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", function () {
        reopen(h);
      });

      var copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "engrams-btn engrams-btn-ghost";
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", function () {
        var t =
          h.seedLetters +
          "\n" +
          (h.words || []).join(" · ") +
          "\n" +
          (h.poem || "") +
          (h.gloss ? "\n(echoing: " + h.gloss + ")" : "");
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(t).catch(function () {});
        }
      });

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "engrams-btn engrams-btn-ghost";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", function () {
        state.history = state.history.filter(function (x) {
          return x.id !== h.id;
        });
        saveHistory();
        renderHistory();
      });

      actions.appendChild(openBtn);
      actions.appendChild(copyBtn);
      actions.appendChild(delBtn);
      item.appendChild(head);
      item.appendChild(poem);
      item.appendChild(actions);
      list.appendChild(item);
    });
  }

  function reopen(h) {
    var input = $("engrams-prompt");
    if (input) input.value = h.seedRaw || h.seedLetters;
    state.nonce = 0;
    state.seedLetters = h.seedLetters || "";
    state.words = (h.words || []).slice();
    state.poem = h.poem || "";
    state.gloss = h.gloss || "";
    renderStage({
      seedRaw: h.seedRaw || h.seedLetters,
      seedLetters: state.seedLetters,
      words: state.words,
      poem: state.poem,
      gloss: state.gloss,
      themes: [],
      note: ""
    });
  }

  function bind() {
    var input = $("engrams-prompt");
    var gen = $("engrams-generate");
    var reshuf = $("engrams-reshuffle");
    var copy = $("engrams-copy");
    var save = $("engrams-save");
    var clearHist = $("engrams-clear-history");

    if (input) {
      input.addEventListener("input", function () {
        clearTimeout(state.debounce);
        state.nonce = 0;
        state.debounce = setTimeout(function () {
          runGenerate(false);
        }, 220);
      });
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          runGenerate(true);
        }
      });
    }
    if (gen) {
      gen.addEventListener("click", function () {
        runGenerate(true);
      });
    }
    if (reshuf) {
      reshuf.addEventListener("click", reshuffle);
    }
    if (copy) {
      copy.addEventListener("click", copyCurrent);
    }
    if (save) {
      save.addEventListener("click", function () {
        runGenerate(true);
      });
    }
    if (clearHist) {
      clearHist.addEventListener("click", function () {
        state.history = [];
        saveHistory();
        renderHistory();
      });
    }
  }

  function init() {
    if (state.inited) {
      runGenerate(false);
      return;
    }
    state.inited = true;
    state.history = loadHistory();
    buildLetterRail();
    bind();
    var input = $("engrams-prompt");
    if (input && !input.value) {
      input.value = "AI";
    }
    renderHistory();
    runGenerate(false);
  }

  function onShow() {
    init();
  }

  function onHide() {
    clearTimeout(state.debounce);
  }

  window.Engrams = {
    onShow: onShow,
    onHide: onHide,
    generate: generate,
    resolveSeedMeaning: resolveSeedMeaning,
    LEXICON: LEXICON,
    SEED_MEANINGS: SEED_MEANINGS,
    WORD_TAGS: WORD_TAGS,
    weaveSense: weaveSense,
    weavePoem: weavePoem,
    wordPos: wordPos,
    tokenizeSeedWords: tokenizeSeedWords
  };

  window.addEventListener("engrams-show", onShow);
  window.addEventListener("engrams-hide", onHide);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if ($("panel-engrams")) buildLetterRail();
    });
  } else if ($("panel-engrams")) {
    buildLetterRail();
  }
})();
